/**
 * align_affix_groups.js — v0.6.5 反馈：物品词缀数据库与 poe2db / 市集对不上（Phase C）。
 *
 * 问题（用户报告）：
 *   1. 失落的蓝玉 显示的词条 = 全部蓝玉的词条池（基底挂错分类，共享了 Sapphire 页词缀）
 *   2. 选「效果区域提高 #%」搜不到结果 —— 该词缀组 statIds 是 enchant.stat_1646093658
 *      （老 realign_official.js contains 兜底的错产物），officialText 虽已对到市集文本，
 *      但 statIds 从未被 v0.6.4 重建的 official_stat_map 刷新。
 *
 * 本脚本做两件事：
 *   A. 全库 affixGroups 重对齐（与 align_unique_mods 同链路，prio1 osm only）：
 *      - probe = g.officialText || g.text（ officialText 是市集真实下拉文本）
 *      - 匹配：osm 精确 → osm vocab（unique 检查）→ template 归一重试
 *      - statIds 只保留 osm.entries 里命中的那组（不再混 fractured/scourge/crafted）
 *      - 对不上的：删 statIds（不给假 id），officialText 保留；记录报告
 *   B. 输出对齐报告 data/tmp/align_affix_report.json
 *
 * 运行：node scripts/align_affix_groups.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DB_PATH = path.join(ROOT, 'extension', 'data', 'mods_db.json');

/** norm：与 content.js affixSig 一致，仅保留中英文 */
function norm(s) { return String(s).replace(/[^A-Za-z一-鿿]/g, ''); }

/* 受控同义词归一（与 rebuild_official_stat_map.js 保持一致的关键子集） */
const VOCAB = [
  [/获得相当于生命上限的/g, ''],
  [/移动速度提高|移动速度加快/g, '移速≡'],
  [/攻击速度降低|攻击速度提高|攻击速度加快/g, '攻速≡'],
  [/施法速度降低|施法速度提高|施法速度加快/g, '施速≡'],
  [/技能速度提高|技能速度加快/g, '技速≡'],
  [/投射物速度提高|投射物速度加快/g, '投射速≡'],
  [/战吼速度提高|战吼速度加快/g, '战吼速≡'],
  [/弩箭速度提高|弩箭速度加快/g, '弩速≡'],
  [/闪避值降低|闪避值提高/g, '闪避≡'],
  [/战弩装填速度降低|战弩装填速度提高|战弩装填速度加快/g, '战弩装填≡'],
  [/装填速度降低|装填速度提高|装填速度加快/g, '装填≡'],
  [/生命上限|最大生命/g, '生命≡'],
  [/魔力上限|最大魔力/g, '魔力≡'],
  [/能量护盾上限|最大能量护盾/g, '护盾≡'],
  [/暴击几率提高|暴击率提高/g, '暴击≡'],
  [/冷却回复速度提高|冷却时间恢复率/g, '冷却≡'],
  [/照亮范围降低|照亮范围提高|照亮范围扩大/g, '照亮≡'],
  [/近战打击范围提高|近战打击范围扩大/g, '打击范围≡'],
  [/效果范围提高|效果范围扩大/g, '效果范围≡'],
  [/效果区域提高|效果区域扩大/g, '效果区域≡'],
  [/诅咒的效果范围提高|诅咒的效果范围扩大/g, '诅咒效果范围≡'],
  [/图腾放置速度提高|图腾放置速度加快/g, '图腾放置≡'],
  [/药剂生命回复速度提高|药剂生命回复速度加快/g, '药剂生命回复速≡'],
  [/药剂魔力回复速度提高|药剂魔力回复速度加快/g, '药剂魔力回复速≡'],
  [/战吼冷却回复速度提高|战吼冷却回复速度加快/g, '战吼冷却≡'],
  [/冷却回复速度提高|冷却回复速度加快/g, '冷却≡'],
  [/击退距离提高|击退距离延长/g, '击退距离≡'],
  [/持续时间提高|持续时间延长|持续时间缩短|持续时间降低/g, '持续时间≡'],
  [/品质上限为/g, '品质上限≡'],
  [/品质上限(?!≡)/g, '品质上限≡'],
  [/你被点燃的持续时间降低|你被点燃的持续时间缩短|你被点燃的持续时间提高/g, '点燃受≡'],
  [/流血持续时间延长|流血持续时间缩短|流血持续时间提高|受到流血的持续时间降低|受到流血的持续时间提高/g, '流血≡'],
  [/敌人被冻结的持续时间提高|敌人被冻结的持续时间延长/g, '冻结≡'],
  [/耐力球持续时间降低|耐力球持续时间延长/g, '耐力球≡'],
  [/能量护盾充能时间延后|能量护盾充能时间提前|能量护盾充能开始时间延后/g, '充能时≡'],
  [/咒符位/g, '咒符栏'],
  [/该装备的/g, ''],
  [/基础(?=(?:物理|火焰|冰霜|闪电)伤害)/g, ''],
  [/会(?=转化为)/g, ''],
  [/物理攻击伤害/g, '物理伤害'],
  /* 以下为 affixGroups 对齐新增（poe2db 措辞 ↔ 官方措辞，成对有实据） */
  [/你身上的减益消失速度加快|你身上的减益效果消失速度加快/g, '减益消失≡'],           // 宝石后缀：减益消失速度
  [/你受到的异常状态的减速强度降低|你受到的异常状态的减速强度提高/g, '受异常减速≡'],   // 宝石后缀：注意 提高/降低 是不同 stat，不能归一！
  [/击中稀有和传奇敌人的伤害提高|击中稀有怪和传奇怪伤害提高/g, '稀有传奇伤害≡'],       // 官方=稀有怪和传奇怪
  [/怒火上限|最大怒火/g, '怒火上限≡'],                                               // 官方="# 最大怒火"
  [/异常状态阈值提高|异常状态阈值增加/g, '异常阈值≡'],
  [/攻击击中有几率施加创口|攻击击中施加创口/g, '施加创口≡'],                          // 宝石版带几率 vs 官方二元
  [/击中时有几率使目标恍惚|击中时使目标恍惚/g, '使恍惚≡'],                            // 同上
  [/流血持续时间提高|流血持续时间延长|流血持续时间缩短|流血持续时间降低/g, '流血持续≡'],
  [/被招架减益状态的持续时间提高|被招架减益状态的持续时间延长/g, '招架减益≡'],
  [/护甲破损持续时间提高|护甲破损持续时间延长/g, '护甲破损≡'],
  [/获得的魔力药剂充能提高|玩家获得的魔力药剂充能提高/g, '魔力药剂充能≡'],
  [/获得的生命药剂充能提高|玩家获得的生命药剂充能提高/g, '生命药剂充能≡'],
  /* 失落的珠宝天赋圈：官方「获得 #% 元素抗性」 vs poe2db「有 +(#—#)% 元素抗性」
   * 注意：norm 后「有/获得」紧跟抗性名，正则不能带 \+；「召唤生物有」与「召唤生物获得」
   * 都归一为 召唤生物≡，尾部（混沌抗性/元素抗性）保留 → 不互撞 */
  [/召唤生物有|召唤生物获得/g, '召唤生物≡'],
];
function vocabNorm(s) {
  let t = norm(s);
  for (const [re, rep] of VOCAB) t = t.replace(re, rep);
  return t;
}

/* ---------- osm（v0.6.4 重建，prio1 市集下拉 → 可筛组 ids） ---------- */
const osm = JSON.parse(fs.readFileSync(path.join(DATA, 'official_stat_map.json'), 'utf8'));
const osmEntries = osm.entries || {};

/* ---------- prio2: peer 页状态（市集真实下拉文本源，可筛组） ----------
 * prio3: trade2_stats_flat（trade 静态全量，含 enchant/fractured 等，过滤后仅留可筛组）
 * 两层都只做 exact + 受控 vocab，禁 contains；peer 命中优先于 flat。 */
const USABLE = /^(pseudo|explicit|implicit|skill)\./;
const peer = JSON.parse(fs.readFileSync(path.join(DATA, 'peer_trade2state_cn.json'), 'utf8'));
const flat = JSON.parse(fs.readFileSync(path.join(DATA, 'trade2_stats_flat.json'), 'utf8'));

/** 通用：entries[{id,text}] → norm 签名 / vocab 签名 两个索引（仅可筛组） */
function buildLayers(entries) {
  const sigIdx = new Map();   // norm sig → [{id,text}]
  const vocabIdx = new Map(); // vocab sig → [{id,text}]（多文本共存，查询时判唯一）
  for (const { id, text } of entries) {
    if (!id || !text || !USABLE.test(String(id))) continue;
    const sig = norm(text);
    if (!sig) continue;
    if (!sigIdx.has(sig)) sigIdx.set(sig, []);
    sigIdx.get(sig).push({ id, text });
    const v = vocabNorm(text);
    if (!vocabIdx.has(v)) vocabIdx.set(v, []);
    vocabIdx.get(v).push({ id, text });
  }
  return { sigIdx, vocabIdx };
}

const peerEntries = [];
for (const g of peer) for (const e of (g.entries || [])) peerEntries.push({ id: e.id, text: e.text });
const peerLayers = buildLayers(peerEntries);
const flatLayers = buildLayers(flat);

/** 在一层里查找：exact 优先；vocab 仅唯一采信。返回 {text, ids, how} 或 null */
function layerLookup(layers, probeText) {
  const sig = norm(probeText);
  if (sig) {
    const hits = layers.sigIdx.get(sig);
    if (hits && hits.length) {
      const ids = [...new Set(hits.map((h) => h.id))];
      return { text: hits[0].text, ids, how: 'exact' };
    }
  }
  const v = vocabNorm(probeText);
  if (v) {
    const hits = layers.vocabIdx.get(v);
    if (hits && hits.length) {
      const ids = [...new Set(hits.map((h) => h.id))];
      const texts = [...new Set(hits.map((h) => h.text))];
      // 歧义保护：vocab 相同但文本不同（≥2 种官方文本）→ 不猜
      if (texts.length === 1) return { text: texts[0], ids, how: 'vocab' };
      return null;
    }
  }
  return null;
}

/* ---------- osm 索引：norm 签名 → text；vocab 签名 → [text]（唯一才用） ---------- */
const sig2text = new Map();
const vocab2texts = new Map();
for (const text of Object.keys(osmEntries)) {
  const sig = norm(text);
  if (!sig) continue;
  if (!sig2text.has(sig)) sig2text.set(sig, []);
  sig2text.get(sig).push(text);
  const v = vocabNorm(text);
  if (!vocab2texts.has(v)) vocab2texts.set(v, new Set());
  vocab2texts.get(v).add(text);
}

/** osm 层查找（osm key 是下拉文本，id 列表在 entries） */
function osmLookup(probeText) {
  const sig = norm(probeText);
  if (sig) {
    const hits = sig2text.get(sig);
    if (hits && hits.length) return { text: hits[0], ids: osmEntries[hits[0]] };
  }
  const v = vocabNorm(probeText);
  if (v) {
    const texts = vocab2texts.get(v);
    if (texts && texts.size === 1) { const text = [...texts][0]; return { text, ids: osmEntries[text] }; }
  }
  return null;
}

/* ---------- A. 全库 affixGroups 重对齐 ---------- */
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const stat = { exact: 0, vocab: 0, vocabAmbig: 0, none: 0 };
const statByHow = {};
const unmatched = [];
let clearedWrong = 0;

for (const cat of db.categories) {
  for (const g of cat.affixGroups) {
    // 双探测：officialText（旧对齐文本）优先，再试 poe2db 原文
    const probes = [...new Set([g.officialText, g.text].filter(Boolean))];
    let hit = null, hitProbe = null;

    for (const probe of probes) {
      // a) osm 精确/vocab（市集下拉文本 → 可筛组 ids）
      const o = osmLookup(probe);
      if (o) { hit = { ...o, how: 'osm' }; hitProbe = probe; break; }
    }
    // b) peer 页状态（prio2）：官方措辞兜底（如 流血持续时间延长）
    if (!hit) {
      for (const probe of probes) {
        const p = layerLookup(peerLayers, probe);
        if (p) { hit = { ...p, how: 'peer-' + p.how }; hitProbe = probe; break; }
      }
    }
    // c) trade2 flat（prio3）
    if (!hit) {
      for (const probe of probes) {
        const f = layerLookup(flatLayers, probe);
        if (f) { hit = { ...f, how: 'flat-' + f.how }; hitProbe = probe; break; }
      }
    }

    if (hit) {
      if (!g.officialText || g.officialText !== hit.text) g.officialText = hit.text;
      const before = JSON.stringify(g.statIds || []);
      g.statIds = hit.ids;
      g._gMatch = hit.how;
      if (before !== JSON.stringify(hit.ids)) clearedWrong++;
      stat[hit.how.startsWith('osm') ? 'exact' : hit.how.split('-')[0] + (hit.how.endsWith('exact') ? 'Exact' : 'Vocab')]++;
      stat[hit.how.split('-')[0] + (hit.how.endsWith('vocab') ? 'Vocab' : 'Exact')] = (stat[hit.how.split('-')[0] + (hit.how.endsWith('vocab') ? 'Vocab' : 'Exact')] || 0) + 0;
      // 简化统计：直接按 how 计数
      statByHow[hit.how] = (statByHow[hit.how] || 0) + 1;
    } else {
      // 对不上：删假 id（officialText 保留旧的；若也没有则删）
      if (g.statIds && g.statIds.length) clearedWrong++;
      delete g.statIds;
      if (!g.officialText) delete g.officialText;
      g._gMatch = 'none';
      stat.none++;
      unmatched.push({ cat: cat.slug, id: g.id, preSuf: g.preSuf, source: g.source, text: g.text.slice(0, 60) });
    }
  }
}

/* ---------- B. 报告 + 写盘 ---------- */
console.log('对齐统计:', JSON.stringify(stat), '· statIds 变更/清除组数:', clearedWrong);
console.log('按匹配方式:', JSON.stringify(statByHow));

const CHECKS = [
  ['Sapphire', 'prefix|效果区域提高#%', '效果区域提高 #%', ['explicit.stat_280731498']],
  ['Sapphire', null, '冰霜伤害提高 (5—15)%', ['explicit.stat_3291658075']],
];
let bad = 0;
for (const [slug, gid, text, expectIds] of CHECKS) {
  const cat = db.categories.find((c) => c.slug === slug);
  const g = cat.affixGroups.find((x) => (gid ? x.id === gid : x.text === text));
  if (!g) { console.log('  ✗ 找不到组', slug, gid || text); bad++; continue; }
  const okIds = (expectIds || []).every((e) => (g.statIds || []).includes(e));
  if (!okIds) { console.log('  ✗', g.text, '→', JSON.stringify(g.statIds)); bad++; }
  else console.log('  ✓', g.text, '→', (g.statIds || []).join(','), '(osm:', g.officialText + ')');
}

if (bad) { console.log('自检失败，不写盘'); process.exit(1); }

db.version = 0.95;
db.builtAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db));
fs.writeFileSync(path.join(DATA, 'tmp', 'align_affix_report.json'), JSON.stringify({
  builtAt: new Date().toISOString(), stat, statByHow, clearedWrong, unmatchedCount: unmatched.length, unmatched,
}, null, 1));
console.log('已写 mods_db.json v0.95 · align_affix_report.json（', unmatched.length, '条未匹配）');
