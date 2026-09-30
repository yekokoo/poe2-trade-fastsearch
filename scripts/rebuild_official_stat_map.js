/**
 * rebuild_official_stat_map.js — v0.6.4 反馈④：词缀数据分类与官网对不上，重建官方下拉映射。
 *
 * 背景：9/4 版 official_stat_map.json 用 guofu API 反查 + contains 兜底生成，49 条文本
 * 映射到错误 stat id（API 措辞 ≠ 市集下拉措辞，如 stat_1037193709 的 API 文本=
 * 「该装备附加 # - # 基础冰霜伤害 (区域)」，而市集真实下拉=「附加 # - # 冰霜伤害」），
 * 导致暗金填表选错/选不中下拉项（用户案例：寒冬噬咬 玻璃利片）。
 *
 * 原则：
 *   1. 显示文本一律以市集真实下拉 496 条为准（market_dropdown_real.json）——这是用户看到的文本。
 *   2. text→id 一律以市集页状态数据为准（peer_trade2state_cn.json 优先，guofu API 兜底），
 *      受控同义词归一后精确匹配，禁用 contains 兜底（上次错误根源）。
 *   3. 匹配不上的记录进 unmatched，绝不猜。
 *   4. 只保留市集可筛组 id（explicit/pseudo/implicit/skill），与 align usableIds 一致。
 *
 * 运行：node scripts/rebuild_official_stat_map.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

/** norm：与 content.js affixSig 一致，仅保留中英文 */
function norm(s) { return String(s).replace(/[^A-Za-z一-鿿]/g, ''); }

/* 受控同义词归一（市集下拉措辞 ↔ peer/API 页状态措辞），双向替换成统一形式。
 * 只收录有实据的成对差异，不做泛化替换——错归类比漏归更糟。 */
const VOCAB = [
  /* 荆棘：poe2db「获得相当于生命上限 N% 的物理荆棘伤害」vs 官方「# - # 物理荆棘伤害」 */
  [/获得相当于生命上限的/g, ''],
  /* 速度类：下拉用「提高」，页状态常用「加快」（POE1 措辞残留） */
  [/移动速度提高|移动速度加快/g, '移速≡'],
  [/攻击速度降低|攻击速度提高|攻击速度加快/g, '攻速≡'],
  [/施法速度降低|施法速度提高|施法速度加快/g, '施速≡'],
  [/技能速度提高|技能速度加快/g, '技速≡'],
  [/投射物速度提高|投射物速度加快/g, '投射速≡'],
  [/战吼速度提高|战吼速度加快/g, '战吼速≡'],
  [/弩箭速度提高|弩箭速度加快/g, '弩速≡'],
  [/闪避值降低|闪避值提高/g, '闪避≡'],
  /* 装填：战弩专用项与通用项是两个 stat → token 必须区分（战弩装填≡ / 装填≡），
   * 不然 peer 双条目 vocab 碰撞触发歧义保护双双 miss（v0.6.4 实测） */
  [/战弩装填速度降低|战弩装填速度提高|战弩装填速度加快/g, '战弩装填≡'],
  [/装填速度降低|装填速度提高|装填速度加快/g, '装填≡'],
  /* 资源名：下拉「生命上限」vs 页状态「最大生命」 */
  [/生命上限|最大生命/g, '生命≡'],
  [/魔力上限|最大魔力/g, '魔力≡'],
  [/能量护盾上限|最大能量护盾/g, '护盾≡'],
  [/暴击几率提高|暴击率提高/g, '暴击≡'],
  [/冷却回复速度提高|冷却时间恢复率/g, '冷却≡'],
  /* 范围/照亮：下拉「范围提高」vs 页状态「范围扩大」（照亮/效果区域/诅咒/打击范围/同场） */
  [/照亮范围降低|照亮范围提高|照亮范围扩大/g, '照亮≡'],
  [/近战打击范围提高|近战打击范围扩大/g, '打击范围≡'],
  [/效果范围提高|效果范围扩大/g, '效果范围≡'],
  [/效果区域提高|效果区域扩大/g, '效果区域≡'],
  [/诅咒的效果范围提高|诅咒的效果范围扩大/g, '诅咒效果范围≡'],
  /* 图腾放置：下拉「你的图腾放置速度提高」vs 页状态「你的图腾放置速度加快」 */
  [/图腾放置速度提高|图腾放置速度加快/g, '图腾放置≡'],
  /* 药剂回复速度：下拉「提高」vs 页状态「加快」 */
  [/药剂生命回复速度提高|药剂生命回复速度加快/g, '药剂生命回复速≡'],
  [/药剂魔力回复速度提高|药剂魔力回复速度加快/g, '药剂魔力回复速≡'],
  /* 冷却回复速度：下拉「提高」vs 页状态「加快」（战吼/通用） */
  [/战吼冷却回复速度提高|战吼冷却回复速度加快/g, '战吼冷却≡'],
  [/冷却回复速度提高|冷却回复速度加快/g, '冷却≡'],
  /* 击退距离：下拉「提高」vs 页状态「延长」 */
  [/击退距离提高|击退距离延长/g, '击退距离≡'],
  /* 持续时间：下拉「提高」vs 页状态「延长/缩短」（前缀保留，只归一动词） */
  [/持续时间提高|持续时间延长|持续时间缩短|持续时间降低/g, '持续时间≡'],
  /* 品质上限：下拉「品质上限 #%」vs 页状态「品质上限为 #%」（先吞长形态，短形态用前瞻防重复替换） */
  [/品质上限为/g, '品质上限≡'],
  [/品质上限(?!≡)/g, '品质上限≡'],
  /* 冷却时间恢复率（页状态）vs 冷却回复速度（下拉）——上条已覆盖，占位说明 */
  /* 充能次数：下拉「充能次数提高」vs 页状态「消耗的充能次数提高」不同 stat，不归一。
   * 下拉「能量护盾充能时间提前」vs API「召唤生物的能量护盾充能时间提前」是不同 stat，也不归一。 */
  /* 负 roll：页状态把「降低」写成独立措辞 */
  [/你被点燃的持续时间降低|你被点燃的持续时间缩短|你被点燃的持续时间提高/g, '点燃受≡'],
  [/流血持续时间延长|流血持续时间缩短|流血持续时间提高|受到流血的持续时间降低|受到流血的持续时间提高/g, '流血≡'],
  [/敌人被冻结的持续时间提高|敌人被冻结的持续时间延长/g, '冻结≡'],
  [/耐力球持续时间降低|耐力球持续时间延长/g, '耐力球≡'],
  [/能量护盾充能时间延后|能量护盾充能时间提前|能量护盾充能开始时间延后/g, '充能时≡'],
  /* 咒符位 vs 咒符栏 */
  [/咒符位/g, '咒符栏'],
  /* 本地词缀：下拉省略「该装备的」前缀（能量护盾提高 #% = 该装备的能量护盾提高 #%） */
  [/该装备的/g, ''],
  /* 附加伤害：下拉「附加 # - # 冰霜伤害」vs API 区域版「附加基础冰霜伤害」 */
  [/基础(?=(?:物理|火焰|冰霜|闪电)伤害)/g, ''],
  /* 偷取：API「会转化为」vs 下拉「转化为」；「物理攻击伤害」vs「物理伤害」 */
  [/会(?=转化为)/g, ''],
  [/物理攻击伤害/g, '物理伤害'],
];
function vocabNorm(s) {
  let t = norm(s);
  for (const [re, rep] of VOCAB) t = t.replace(re, rep);
  return t;
}

/* 可筛组（与 align_unique_mods usableIds 一致） */
const USABLE = /^(pseudo|explicit|implicit|skill)\./;
/** 同一 sig 的多 id 排序：explicit → implicit → pseudo → skill */
const GROUP_ORDER = { explicit: 0, implicit: 1, pseudo: 2, skill: 3 };
function sortIds(ids) {
  return [...ids].sort((a, b) => {
    const ga = GROUP_ORDER[String(a).split('.')[0]] ?? 9;
    const gb = GROUP_ORDER[String(b).split('.')[0]] ?? 9;
    return ga - gb || String(a).localeCompare(String(b));
  });
}

/* ---------- 字典构建：norm 签名 → {text, ids}（仅可筛组） ---------- */
function buildDict(entries, prio) {
  const d = new Map(); // sig → { text, ids:Set, prio }
  for (const { id, text } of entries) {
    if (!id || !text || !USABLE.test(String(id))) continue;
    const sig = norm(text);
    if (!sig) continue;
    if (!d.has(sig)) d.set(sig, { text, ids: new Set(), prio });
    const ent = d.get(sig);
    ent.ids.add(id);
    if (ent.text !== text) { /* 同签不同文本：保留先到文本，id 合并 */ }
  }
  return d;
}

const peer = JSON.parse(fs.readFileSync(path.join(DATA, 'peer_trade2state_cn.json'), 'utf8'));
const gs = JSON.parse(fs.readFileSync(path.join(DATA, 'guofu_stats_api.json'), 'utf8'));
const md = JSON.parse(fs.readFileSync(path.join(DATA, 'market_dropdown_real.json'), 'utf8'));
const options = md.options || [];

const peerEntries = [];
for (const g of peer) for (const e of (g.entries || [])) peerEntries.push({ id: e.id, text: e.text });
const apiEntries = [];
for (const g of gs.result) for (const e of (g.entries || [])) apiEntries.push({ id: e.id, text: e.text });

const peerDict = buildDict(peerEntries, 1);
const apiDict = buildDict(apiEntries, 2);
console.log('peer 可筛签名:', peerDict.size, '· api 可筛签名:', apiDict.size);

/* vocab 索引：v → sig（碰撞时记录全部，精确匹配无碰撞才用） */
function buildVocabIndex(dict) {
  const v2sigs = new Map();
  for (const sig of dict.keys()) {
    const v = vocabNorm(sig);
    if (!v) continue;
    if (!v2sigs.has(v)) v2sigs.set(v, new Set());
    v2sigs.get(v).add(sig);
  }
  return v2sigs;
}
const peerVocab = buildVocabIndex(peerDict);
const apiVocab = buildVocabIndex(apiDict);

/* ---------- 主流程：496 条下拉逐条反查 ---------- */
const entries = {};
const unmatched = [];
const stat = { peerExact: 0, peerVocab: 0, apiExact: 0, apiVocab: 0 };

for (const opt of options) {
  const sig = norm(opt);
  if (!sig) { unmatched.push({ text: opt, reason: 'empty-sig' }); continue; }

  let hit = null, how = null;
  // a) peer 签名精确
  if (peerDict.has(sig)) { hit = peerDict.get(sig); how = 'peerExact'; }
  // b) peer 同义词归一（唯一才采信，碰撞=有歧义不猜）
  if (!hit) {
    const sigs = peerVocab.get(vocabNorm(sig));
    if (sigs && sigs.size === 1) { hit = peerDict.get([...sigs][0]); how = 'peerVocab'; }
    else if (sigs && sigs.size > 1) { unmatched.push({ text: opt, reason: 'peer-vocab-ambiguous', sigs: [...sigs] }); continue; }
  }
  // c) api 签名精确
  if (!hit && apiDict.has(sig)) { hit = apiDict.get(sig); how = 'apiExact'; }
  // d) api 同义词归一（同样要求唯一）
  if (!hit) {
    const sigs = apiVocab.get(vocabNorm(sig));
    if (sigs && sigs.size === 1) { hit = apiDict.get([...sigs][0]); how = 'apiVocab'; }
    else if (sigs && sigs.size > 1) { unmatched.push({ text: opt, reason: 'api-vocab-ambiguous', sigs: [...sigs] }); continue; }
  }

  if (hit) {
    stat[how]++;
    entries[opt] = sortIds([...hit.ids]);
  } else {
    unmatched.push({ text: opt, reason: 'no-match' });
  }
}

/* ---------- 补登：peer 真实存在但 496 快照漏抓的下拉 ----------
 * 背景：市集对武器本地混沌提供的下拉是「该装备附加 # - # 基础混沌伤害」（stat_2223678961，
 * peer explicit/rune/enchant 组真实存在），但 market_dropdown_real 快照（2026-09-03 抓取）
 * 未包含该项 → 尼布洛克/怨怒塔矛的 local 混沌词条重定向拿不到 prio1 候选。
 * peer 数据来自真实页面 state，可信度与下拉一致，以 peer 文本补登。 */
const EXTRA_PEER_ENTRIES = [
  '该装备附加 # - # 基础混沌伤害',
];
let extraAdded = 0;
for (const text of EXTRA_PEER_ENTRIES) {
  if (entries[text]) continue;
  const sig = norm(text);
  const hit = peerDict.get(sig) || (() => {
    const sigs = peerVocab.get(vocabNorm(sig));
    return sigs && sigs.size === 1 ? peerDict.get([...sigs][0]) : null;
  })();
  if (hit) { entries[text] = sortIds([...hit.ids]); extraAdded++; }
  else console.warn('补登失败:', text);
}

/* ---------- 报告 ---------- */
const total = Object.keys(entries).length;
console.log(`市集下拉 ${options.length} 条：peer精确 ${stat.peerExact} · peer词表 ${stat.peerVocab} · api精确 ${stat.apiExact} · api词表 ${stat.apiVocab} · 未匹配 ${unmatched.length}`);

/* 自检：关键案例（用户反馈 + 历史坑） */
const CHECKS = [
  ['附加 # - # 冰霜伤害', ['explicit.stat_1037193709']],
  ['附加 # - # 物理伤害', ['explicit.stat_1940865751']],
  ['附加 # - # 火焰伤害', ['explicit.stat_709508406']],
  ['附加 # - # 闪电伤害', ['explicit.stat_3336890334']],
  ['物理伤害的 #% 转化为生命偷取', ['explicit.stat_55876295']],
  ['物理伤害的 #% 转化为魔力偷取', ['explicit.stat_669069897']],
  ['攻击速度提高 #%', ['explicit.stat_681332047']],
  ['攻击速度提高 #% (区域)', ['explicit.stat_210067635']],
  ['暴击伤害加成提高 #%', ['explicit.stat_3556824919']],
  ['物理攻击伤害的 #% 转化为生命偷取', ['explicit.stat_2557965901']],
  ['暴击几率 #%', ['explicit.stat_518292764']],
  ['战弩装填速度提高 #%', ['explicit.stat_3192728503']],
  ['装填速度提高 #%', ['explicit.stat_710476746']],
  ['能量护盾提高 #%', ['explicit.stat_4015621042']],
  ['效果区域提高 #%', ['explicit.stat_280731498']],
  ['照亮范围提高 #%', ['explicit.stat_1263695895']],
  ['晕眩持续时间提高 #%', ['explicit.stat_748522257']],
  ['击退距离提高 #%', ['explicit.stat_565784293']],
  ['品质上限 #%', ['implicit.stat_275498888']],
  ['+# 全属性', null],  // 只要求存在且非旧错值
];
let checkBad = 0;
for (const [text, expect] of CHECKS) {
  const got = entries[text];
  if (!got) { console.log('  ✗ 缺失:', text); checkBad++; continue; }
  if (expect && !expect.every((e) => got.includes(e))) { console.log('  ✗ 错映射:', text, '→', got.join(',')); checkBad++; }
  else console.log('  ✓', text, '→', got.join(','));
}

fs.writeFileSync(path.join(DATA, 'official_stat_map.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  source: 'market_dropdown_real.json(496 显示文本) + peer_trade2state_cn.json(权威 text→id) + guofu_stats_api.json(兜底)；受控同义词精确匹配，无 contains 兜底',
  count: total,
  entries,
  unmatched,
}, null, 1));
console.log(checkBad ? `自检 ${checkBad} 项失败！` : '自检通过');
console.log('已写 official_stat_map.json（', total, '条映射 ·', unmatched.length, '条未匹配记录）');
if (unmatched.length) {
  console.log('未匹配样本:');
  unmatched.slice(0, 20).forEach((u) => console.log('  ', u.text, '|', u.reason || ''));
}
process.exit(checkBad ? 1 : 0);
