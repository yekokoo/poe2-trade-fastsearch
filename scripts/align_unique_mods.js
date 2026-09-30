/**
 * align_unique_mods.js — Task #19：暗金固定词条对齐官方市集 stat。
 *
 * 输入：
 *   data/tmp/unique_mods_raw.json   712 个暗金的 poe2db 词条（kind/text/内部英文 stats）
 *   data/official_stat_map.json     市集真实下拉文本 → stat ids（377 条，最优先）
 *   data/trade2_stats_flat.json     市集页静态数据全量 stats（4754 条，含 skill 组）
 *   data/guofu_stats_api.json       官方 API 全量 stats（14 组）
 *
 * 匹配链（与 realign_official.js 同原则）：
 *   poe2db 词条文本「护甲提高 (150—200)%」→ 模板化「护甲提高 #%」→ norm 签名
 *   → a) 签名精确  b) 同义词归一  c) 签名互为包含（≥6）→ 匹配失败标记不可筛选
 * 字典优先级：dropdown(1) > flat(2) > api(3)；同级内 explicit 优先于 pseudo。
 *
 * 输出：
 *   data/tmp/unique_mods_aligned.json   pairKey → { slug, mods:[{kind,text,officialText,statIds,statType,match,src}] }
 *   data/tmp/align_unique_report.json   统计 + 未对齐清单
 * 运行：node scripts/align_unique_mods.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TMP = path.join(DATA, 'tmp');

/* ---------- 归一 ---------- */
/** norm：与 content.js affixSig 一致，仅保留中英文 */
function norm(s) { return String(s).replace(/[^A-Za-z一-鿿]/g, ''); }

/** poe2db 词条文本 → 官方模板形态：(150—200) → #、裸数字 → #。
 * 派生补全（官方 stat 同一文本兼容变体，由官方字典派生，非手工猜测）：
 *  - poe2db「获得技能: 架盾」缺「等级 #」→ 派生「获得技能: 等级 # 架盾」（39 处命中官方 skill 组）
 *  - 感电/触电：官方用「感电」 */
function derivedTemplates(s) {
  const list = [s];
  let m = String(s).match(/^获得技能:\s*(等级 # )?(.+)$/);
  if (m && !m[1]) list.push(`获得技能: 等级 # ${m[2]}`);
  if (/触电/.test(s)) list.push(String(s).replace(/触电/g, '感电'));
  // 咒符位：官方 explicit 组是「咒符栏 #」（基底 implicit 组的「具有 # 个咒符栏」不可筛）
  if (/具有 # 个咒符位/.test(s)) list.push('咒符栏 #');
  return list;
}
function templ(s) {
  return String(s)
    .replace(/\(\s*\d+(?:\.\d+)?\s*[—–-]\s*\d+(?:\.\d+)?\s*\)/g, '#')  // (150—200)
    .replace(/\d+(?:\.\d+)?/g, '#');                                     // 剩余裸数字（等级 9 等）
}

/* 同义词归一（官方 API 措辞 ↔ 市集措辞差异，沿用 realign_official.js 词表 + 暗金扩展）。
 * 关键背景：官方市集同一条 stat 兼容正负 roll（负值直接填负数），
 * poe2db 把负 roll 写成「X降低 N%」，官方下拉仍是「X加快/提高 #%」。 */
const VOCAB = [
  /* 暗金荆棘：poe2db「获得相当于生命上限 N%-M% 的 物理荆棘伤害」→ 官方「# - # 物理荆棘伤害」 */
  [/获得相当于生命上限的/g, ''],
  [/移动速度提高|移动速度加快/g, '移速≡'],
  [/照亮范围降低|照亮范围提高|照亮范围扩大/g, '照亮≡'],
  [/攻击速度降低|攻击速度提高|攻击速度加快/g, '攻速≡'],
  [/施法速度降低|施法速度提高|施法速度加快/g, '施速≡'],
  [/技能速度提高|技能速度加快/g, '技速≡'],
  [/闪避值降低|闪避值提高/g, '闪避≡'],
  [/装填速度降低|装填速度提高|装填速度加快/g, '装填≡'],
  [/战弩装填速度降低|战弩装填速度提高|战弩装填速度加快/g, '战弩装填≡'],
  [/生命上限|最大生命/g, '生命≡'],
  [/魔力上限|最大魔力/g, '魔力≡'],
  [/能量护盾上限|最大能量护盾/g, '护盾≡'],
  [/暴击几率提高|暴击率提高/g, '暴击≡'],
  [/冷却回复速度提高|冷却时间恢复率/g, '冷却≡'],
  /* 负 roll：受到的流血/点燃持续时间（poe2db「降低」= 官方「延长/缩短/提高」同 stat） */
  [/受到流血的持续时间降低|受到流血的持续时间提高|流血持续时间延长|流血持续时间缩短|流血持续时间提高/g, '流血≡'],
  [/你被点燃的持续时间降低|你被点燃的持续时间缩短|你被点燃的持续时间提高/g, '点燃受≡'],
  /* poe2db「咒符位」vs 官方「咒符栏」 */
  [/咒符位/g, '咒符栏'],
  [/近战打击范围提高|近战打击范围扩大/g, '打击范围≡'],
  [/此武器的近战打击范围提高|此武器的近战打击范围扩大/g, '武器打击范围≡'],
  [/效果范围提高|效果范围扩大/g, '效果范围≡'],
  [/弩箭速度提高|弩箭速度加快/g, '弩速≡'],
  [/生命药剂回复总降|生命药剂回复量降低|生命药剂回复量总降/g, '药剂回复≡'],
  [/能量护盾充能时间延后|能量护盾充能时间提前|能量护盾充能开始时间延后/g, '充能时≡'],
  [/敌人被冻结的持续时间提高|敌人被冻结的持续时间延长/g, '冻结≡'],
  [/耐力球持续时间降低|耐力球持续时间延长/g, '耐力球≡'],
  /* poe2db「附加 # - # 物理伤害」vs 官方本地版「附加基础物理伤害」（(区域) 词条） */
  [/基础(?=(?:物理|火焰|冰霜|闪电|混沌)伤害)/g, ''],
  /* poe2db「物理伤害的 #% 转化为生命偷取」(local) vs 官方区域版
   * 「物理攻击伤害的 #% 会转化为生命偷取 (区域)」：仅 local 重定向阶段用于对上区域版 */
  [/会(?=转化为)/g, ''],
  [/物理攻击伤害/g, '物理伤害'],
];
function vocabNorm(s) {
  let t = norm(s);
  for (const [re, rep] of VOCAB) t = t.replace(re, rep);
  return t;
}

/* ---------- 三层字典 ---------- */
/** dict: sig → [{ text, ids[], prio }]（同 sig 同 text 去重；ids 去重） */
const dict = new Map();
function addEntry(text, ids, prio) {
  if (!text || !ids || !ids.length) return;
  const sig = norm(text);
  if (!sig) return;
  if (!dict.has(sig)) dict.set(sig, []);
  const arr = dict.get(sig);
  let ent = arr.find((e) => e.text === text);
  if (!ent) { ent = { text, ids: [], prio }; arr.push(ent); }
  if (prio < ent.prio) ent.prio = prio; // 同文本更高优先级出现时升级
  for (const id of ids) if (!ent.ids.includes(id)) ent.ids.push(id);
}

/* 1) 市集真实下拉（经 official_stat_map 反查 stat ids） */
const osm = JSON.parse(fs.readFileSync(path.join(DATA, 'official_stat_map.json'), 'utf8'));
for (const [text, ids] of Object.entries(osm.entries || {})) addEntry(text, ids, 1);

/* 2) trade2 静态全量（含 skill/rune/desecrated 组） */
const flat = JSON.parse(fs.readFileSync(path.join(DATA, 'trade2_stats_flat.json'), 'utf8'));
for (const s of flat) if (s.id && s.text) addEntry(s.text, [s.id], 2);

/* 3) 官方 API 全量 */
const gs = JSON.parse(fs.readFileSync(path.join(DATA, 'guofu_stats_api.json'), 'utf8'));
for (const g of gs.result) for (const e of (g.entries || [])) if (e.id && e.text) addEntry(e.text, [e.id], 3);

console.log('字典签名数:', dict.size);

/* vocab 字典：vocabNorm(sig) → sig（取 prio 最小那条） */
const vocabDict = new Map();
for (const [sig, arr] of dict) {
  const v = vocabNorm(sig);
  const top = arr.reduce((a, b) => (b.prio < a.prio ? b : a));
  const prev = vocabDict.get(v);
  if (!prev || top.prio < prev.prio) vocabDict.set(v, sig);
}
/* 互为包含用的数组 */
const dictArr = [...dict.entries()].map(([sig, arr]) => ({ sig, arr, top: arr.reduce((a, b) => (b.prio < a.prio ? b : a)) }));

/** 选最佳候选：prio 小者优先；同级 explicit 优先（id 非 pseudo. 开头） */
function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.prio !== b.prio) return a.prio < b.prio ? a : b;
  const aP = a.ids.every((x) => String(x).startsWith('pseudo.'));
  const bP = b.ids.every((x) => String(x).startsWith('pseudo.'));
  if (aP !== bP) return aP ? b : a;
  return a;
}

/** 对模板文本 t 求匹配。返回 { ent, how } 或 null */
function matchTemplate(t) {
  for (const cand of derivedTemplates(t)) {
    const r = matchTemplateOne(cand);
    if (r) return r;
  }
  return null;
}

/* ---------- 本地词缀（local）重定向 v2（v0.6.4 反馈④） ----------
 * poe2db 内部 stat id 带 local 前缀的词条 = 暗金武器的本地词缀（附加伤害/攻速/护甲类等）。
 * 市集官网为这类词条提供的下拉是「该装备的X」省略前缀形态或 (区域) 后缀形态：
 *   附加 (8—10) - (15—18) 冰霜伤害 → 下拉「附加 # - # 冰霜伤害」（stat_1037193709）
 *   攻击速度提高 (12—22)%        → 下拉「攻击速度提高 #% (区域)」（stat_210067635）
 * v0.6.3 及以前：命中全局项后从 areaDict 找 (区域) 形态重定向，而 areaDict 含 API 文本
 * （API 对同 id 给出「该装备附加 # - # 基础冰霜伤害 (区域)」这种下拉里不存在的文本），
 * 造成寒冬噬咬等 69 条 local 附加伤害词条 officialText 全部错填 API 文本 → 填表选不中下拉项。
 * v2 规则：
 *   1. only-market：重定向候选只认 prio=1（市集真实下拉 496 条来源）的条目，API 文本出局；
 *   2. 若源文本经 osm 精确命中的条目本身就是 prio1（如附加伤害类，下拉省略了「该装备」），
 *      exact 命中即正确，无需再重定向——保持 officialText=下拉原文；
 *   3. 官方无本地形态的（物理伤害提高、暴击伤害加成等）保留全局项（实测可筛）。 */

/** norm 只保留中英文 → 「(区域)」全角括号被丢弃，只剩「区域」二字粘在末尾 */
const AREA_SUFFIX = '区域';
const EQUIP_PREFIX = '该装备';

/** 构建 (区域)/该装备 索引（仅 prio1 市集下拉）：
 * 去除末尾「区域」+ 开头「该装备(的)」后的 norm 签名 → 条目。
 * 复合本地词缀官方形态是双标记：「该装备的护甲与闪避提高 #% (区域)」，
 * 剥离后 key「护甲与闪避提高」才能与源文本「护甲与闪避提高 #%」签名对上。 */
const areaDict = (() => {
  const m = new Map();
  for (const [sig, arr] of dict) {
    if (!sig.endsWith(AREA_SUFFIX)) continue;
    const market = arr.filter((e) => e.prio === 1);
    if (!market.length) continue;          // 只剩 API/flat 文本的不参与重定向
    const top = market.reduce(better);
    const core = sig.slice(0, -AREA_SUFFIX.length).replace(/^该装备的/, '').replace(/^该装备/, '');
    if (!core) continue;
    const prev = m.get(core);
    if (!prev || better(top, prev) === top) m.set(core, top);
  }
  return m;
})();

/** isLocal 词条命中全局项后尝试重定向到本地形态（仅市集下拉文本）。
 * t = 模板化源文本；返回重定向条目或 null。
 * 候选来源：
 *  A) areaDict（prio1 (区域) 形态）：key 剥离标记后与源签名（或其 vocab 归一）比对
 *  B) dictArr 中 prio1 的措辞差异变体：源「物理伤害的…转化为生命偷取」vs 下拉「物理伤害的 #% 转化为生命偷取」
 *     （VOCAB 把「物理攻击伤害」归一成「物理伤害」后两签名相同——这类 prio1 变体正是本地词缀的官方下拉措辞；
 *      全局项若也 prio1 且与源签名完全相同，说明源文本本身就是全局下拉项，无需跳走） */
function redirectLocalArea(t) {
  const core = norm(t);
  if (!core) return null;
  const v = vocabNorm(core);
  let best = null;
  for (const [key, ent] of areaDict) {
    if (key === core || vocabNorm(key) === v) best = better(best, ent);
  }
  for (const d of dictArr) {
    if (d.sig === core) continue;                       // 与源签名相同 = 命中的全局项本身，跳过
    if (d.top.prio !== 1) continue;                     // v2：只认市集下拉文本
    if (vocabNorm(d.sig) === v && usableIds(d.top.ids).length) best = better(best, d.top);
  }
  return best;
}

function matchTemplateOne(t) {
  const sig = norm(t);
  if (!sig) return null;
  // a) 签名精确（过滤出可用于市集筛选的组；全不可用则视为未命中，继续走 b/c）
  let arr = dict.get(sig);
  if (arr && arr.length) {
    const hits = arr.map((e) => ({ ent: e, usable: usableIds(e.ids) })).filter((x) => x.usable.length);
    if (hits.length) return { ent: hits.map((x) => x.ent).reduce(better), how: 'exact' };
  }
  // b) vocab 归一
  const v = vocabNorm(sig);
  const vSig = vocabDict.get(v);
  if (vSig) {
    arr = dict.get(vSig);
    if (arr && arr.length) {
      const hits = arr.map((e) => ({ ent: e, usable: usableIds(e.ids) })).filter((x) => x.usable.length);
      if (hits.length) return { ent: hits.map((x) => x.ent).reduce(better), how: 'vocab' };
    }
  }
  // c) 互为包含（源≥10 且 官方≥10，且长度差≤3 倍；防「闪电」→「闪电净化」这类短词误配；
  //    优先签名更接近的：长度差最小，再长度更长，再 prio）
  let best = null;
  for (const d of dictArr) {
    if (d.sig === sig) continue;
    if (sig.length >= 10 && d.sig.length >= 10 &&
        (d.sig.includes(sig) || sig.includes(d.sig)) &&
        Math.max(sig.length, d.sig.length) <= Math.min(sig.length, d.sig.length) * 3) {
      const usable = usableIds(d.top.ids);
      if (!usable.length) continue;
      const lenDiff = Math.abs(sig.length - d.sig.length);
      const c = { ent: d.top, how: 'contains', len: d.sig.length, lenDiff };
      if (!best || c.lenDiff < best.lenDiff ||
          (c.lenDiff === best.lenDiff && (c.len > best.len || (c.len === best.len && c.ent.prio < best.ent.prio)))) best = c;
    }
  }
  return best;
}

/* ---------- 主流程 ---------- */
/** 词条 id 是否可用于市集筛选。
 * 市集真实下拉 496 条反查包含 explicit/pseudo/implicit/skill 组 id
 * （implicit=「基底」类型标签，市集下拉真实存在），其余组（crucible/enchant/fractured
 * 等装备改造类）不出现在暗金搜索的词缀下拉中。 */
function usableIds(ids) {
  return (ids || []).filter((x) => /^(explicit|pseudo|implicit|skill)\./.test(String(x)));
}

const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'unique_mods_raw.json'), 'utf8'));
const out = {};
const stat = { exact: 0, vocab: 0, contains: 0, local: 0, none: 0 };
const unmatched = [];   // { pair, text }
const multiStat = [];   // 多 stat 词条样本（检查匹配质量）

for (const [pairKey, info] of Object.entries(raw)) {
  const mods = [];
  const seen = new Set(); // kind+text 去重（poe2db 页面偶有重复条目）
  for (const m of info.mods) {
    const key = m.kind + '|' + m.text;
    if (seen.has(key)) continue;
    seen.add(key);

    if ((m.stats || []).length > 1) multiStat.push(pairKey + ' >> ' + m.text);

    const hit = matchTemplate(templ(m.text));
    const rec = { kind: m.kind, text: m.text };
    let usable = hit ? usableIds(hit.ent.ids) : [];
    // 本地词缀重定向：isLocal 且命中了全局项（无 (区域)/该装备 标记）时，
    // 优先改用官方本地形态（(区域) 后缀），保证市集筛的是「该装备的」属性
    const isLocal = (m.stats || []).some((s) => String(s).startsWith('local'));
    if (hit && usable.length && isLocal &&
        !hit.ent.text.endsWith(' (区域)') && !hit.ent.text.startsWith('该装备')) {
      const localHit = redirectLocalArea(templ(m.text));
      // 本地形态必须同样可筛才采用；找不到或不可筛 → 保留全局项（官方可能无本地形态）
      if (localHit && usableIds(localHit.ids).length) {
        hit.ent = localHit;
        hit.how = 'local';
        usable = usableIds(localHit.ids);
      }
    }
    if (hit && usable.length) {
      stat[hit.how]++;
      rec.officialText = hit.ent.text;
      // 可用组优先排序（explicit 在前），其余组丢弃
      let ids = usable.sort((a, b) => (String(a).startsWith('explicit.') ? -1 : 0) - (String(b).startsWith('explicit.') ? -1 : 0));
      let type = ids.every((x) => String(x).startsWith('pseudo.')) ? 'pseudo' : 'explicit';
      // 固有词条（implicit）→ 市集「基底」组下拉（v0.6.3 反馈③）：
      // 同一 stat 在字典里常同时注册 explicit+implicit 两份（合并进同一条目，better() 会偏向 explicit），
      // 固有词条必须只留 implicit 组 id，否则填表会选到「外延」组同名项（筛的是全局属性，搜不到该暗金）。
      // 官方无基底版（如「元素异常状态阈值提高」）→ 保留 explicit；「获得技能」类全在「技能」组 → statType=skill。
      if (m.kind === 'implicit') {
        const impIds = ids.filter((x) => String(x).startsWith('implicit.'));
        const skillIds = ids.filter((x) => String(x).startsWith('skill.'));
        if (impIds.length) { ids = impIds; type = 'implicit'; }
        else if (skillIds.length) { ids = skillIds; type = 'skill'; }
      }
      rec.statIds = ids;
      rec.statType = type;
      rec.match = hit.how;
      rec.src = hit.ent.prio === 1 ? 'dropdown' : hit.ent.prio === 2 ? 'flat' : 'api';
      if (hit.how === 'local') rec.local = true;
    } else {
      // 命中但全是 crucible/enchant 等不可筛组，与未命中同样处理
      if (hit && !usable.length) rec.badGroup = hit.ent.ids[0];
      stat.none++;
      rec.officialText = null;
      rec.statIds = [];
      rec.statType = null;
      rec.match = 'none';
      unmatched.push({ pair: pairKey, text: m.text });
    }
    mods.push(rec);
  }
  out[pairKey] = { slug: info.slug, mods };
}

/* ---------- 报告 ---------- */
const total = stat.exact + stat.vocab + stat.contains + stat.local + stat.none;
console.log(`词条总数 ${total}：exact ${stat.exact} · vocab ${stat.vocab} · contains ${stat.contains} · local重定向 ${stat.local} · none ${stat.none}`);
console.log('多 stat 词条（默认走文本匹配）样本:', multiStat.slice(0, 8));
console.log('未对齐词条数:', unmatched.length);

fs.writeFileSync(path.join(TMP, 'unique_mods_aligned.json'), JSON.stringify(out));
fs.writeFileSync(path.join(TMP, 'align_unique_report.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  total, stat,
  unmatchedCount: unmatched.length,
  unmatched,
  multiStatCount: multiStat.length,
}, null, 1));
console.log('已写 unique_mods_aligned.json · align_unique_report.json');
