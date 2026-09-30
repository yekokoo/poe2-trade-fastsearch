/**
 * realign_official.js — Task #11 词缀数据源切换：以市集官网真实下拉为准。
 *
 * 原则（用户 Msg C）：
 *   所有的词缀或其它下拉来源于市集官网，其余的补充信息才根据 poe2db 进行扩充，这样就不会出现匹配不了的情况。
 *
 * 做法：
 *   1. 从 data/guofu_stats_api.json 提取全部 14 组 stats →「官方模板签名 → stat ids」字典。
 *   2. 从 data/market_dropdown_real.json（496 条真实下拉文本）逐条反查 stat ids，
 *      生成 data/official_stat_map.json（官方下拉文本 → stat ids）。
 *      市集特有措辞（如「移动速度提高 #%」vs API「移动速度加快 #%」）用同义词归一兜底。
 *      stat_translation.json 已有 366 条，直接并入。
 *   3. 重写 mods_db 每条词缀的 officialText/statIds：
 *      - officialText 一律 = 市集真实下拉文本（official_stat_map 的 key，即 496 条之一）
 *      - 匹配链：签名精确 → 同义词归一 → 签名互为包含（长度≥6）→ 保留旧值
 *      - 每条标记 _oMatch: exact|vocab|contains|inherit|none
 *   4. 输出 data/realign_report.json（对齐统计 + 未对齐清单）。
 *
 * 运行：node scripts/realign_official.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const EXT = path.join(ROOT, 'extension', 'data');

/* ---------- 归一函数 ---------- */
/** 签名：仅保留中英文（与 content.js affixSig 一致） */
function norm(s) {
  return String(s).replace(/[^A-Za-z一-鿿]/g, '');
}

/* 同义词归一（官方 API 措辞 ↔ 市集下拉措辞差异，双向替换成统一形式） */
const VOCAB = [
  [/移动速度提高|移动速度加快/g, '移速≡'],
  [/照亮范围提高|照亮范围扩大/g, '照亮≡'],
  [/攻击速度提高|攻击速度加快/g, '攻速≡'],
  [/施法速度提高|施法速度加快/g, '施速≡'],
  [/技能速度提高|技能速度加快/g, '技速≡'],
  [/生命上限|最大生命/g, '生命≡'],
  [/魔力上限|最大魔力/g, '魔力≡'],
  [/能量护盾上限|最大能量护盾/g, '护盾≡'],
  [/暴击几率提高|暴击率提高/g, '暴击≡'],
  [/冷却回复速度提高|冷却时间恢复率/g, '冷却≡'],
];
function vocabNorm(s) {
  let t = norm(s);
  for (const [re, rep] of VOCAB) t = t.replace(re, rep);
  return t;
}

/* ---------- 1. 官方 stats → 签名字典 ---------- */
const st = JSON.parse(fs.readFileSync(path.join(DATA, 'guofu_stats_api.json'), 'utf-8'));
const groups = st.result || st;

/** sig → [{id,text,group}] */
const sigDict = new Map();
function addSig(sig, rec) {
  if (!sig) return;
  if (!sigDict.has(sig)) sigDict.set(sig, []);
  const arr = sigDict.get(sig);
  if (!arr.some((r) => r.id === rec.id)) arr.push(rec);
}
let totalStats = 0;
for (const k of Object.keys(groups)) {
  const arr = Array.isArray(groups[k]) ? groups[k] : (groups[k].entries || []);
  for (const s of arr) {
    if (!s || !s.id) continue;
    totalStats++;
    addSig(norm(s.text), { id: s.id, text: s.text, group: k });
  }
}
console.log('官方 stats 总数:', totalStats, '· 唯一签名:', sigDict.size);

/* ---------- 2. 市集真实下拉 496 条反查 stat ids ---------- */
const md = JSON.parse(fs.readFileSync(path.join(DATA, 'market_dropdown_real.json'), 'utf-8'));
const options = md.options || [];

/** 官方下拉文本 → stat ids（唯一 key：下拉文本本身） */
const officialMap = {};
const unmatchedOfficial = [];
for (const opt of options) {
  const sig = norm(opt);
  let ids = null;
  // a) 签名精确
  const recs = sigDict.get(sig);
  if (recs && recs.length) {
    ids = recs.map((r) => r.id);
  } else {
    // b) 同义词归一后精确
    const vOpt = vocabNorm(opt);
    for (const [sig2, recs2] of sigDict) {
      if (vocabNorm(sig2) === vOpt) { ids = recs2.map((r) => r.id); break; }
    }
  }
  if (!ids) {
    // c) 互为包含（长度≥6，取更短的官方签名=更特异）
    let best = null;
    for (const [sig2, recs2] of sigDict) {
      if (sig2 === sig) continue;
      if (sig.length >= 6 && sig2.length >= 6 && (sig2.includes(sig) || sig.includes(sig2))) {
        if (!best || sig2.length < best.sig2.length) best = { sig2, recs2 };
      }
    }
    if (best) ids = best.recs2.map((r) => r.id);
  }
  if (ids) officialMap[opt] = ids;
  else unmatchedOfficial.push(opt);
}
console.log('官方下拉', options.length, '条反查：命中', Object.keys(officialMap).length, '· 未命中', unmatchedOfficial.length);

/* ---------- 3. stat_translation.json 并入（不覆盖已命中） ---------- */
const trans = JSON.parse(fs.readFileSync(path.join(DATA, 'stat_translation.json'), 'utf-8'));
let mergedFromTrans = 0;
for (const [k, ids] of Object.entries(trans.entries || {})) {
  if (!officialMap[k]) { officialMap[k] = ids; mergedFromTrans++; }
}
console.log('stat_translation 并入', mergedFromTrans, '条 → official_stat_map 共', Object.keys(officialMap).length, '条');

/* ---------- 4. mods_db 词缀重新对齐 ---------- */
const dbPath = path.join(EXT, 'mods_db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

/* 官方模板的 vocab 签名字典（vocabNorm key → 原始下拉文本） */
const vocabDict = new Map();
for (const key of Object.keys(officialMap)) {
  const v = vocabNorm(key);
  if (!vocabDict.has(v)) vocabDict.set(v, key);
}

/* 签名互为包含用的数组（官方文本 + ids） */
const officialArr = Object.keys(officialMap).map((k) => ({ text: k, sig: norm(k), ids: officialMap[k] }));

const stat = { exact: 0, vocab: 0, contains: 0, inherit: 0, none: 0 };
const unmatched = [];
for (const cat of db.categories) {
  for (const g of cat.affixGroups) {
    const probe = g.officialText || g.template || g.text;
    const sig = norm(probe);
    const vSig = vocabNorm(probe);
    let hit = null, how = null;

    // a) 签名精确命中官方字典
    const recs = sigDict.get(sig);
    if (recs && recs.length) { hit = { text: probe, ids: recs.map((r) => r.id) }; how = 'exact'; }

    // b) vocab 归一后与官方下拉文本 vocab 相等
    if (!hit && vocabDict.has(vSig)) {
      const text = vocabDict.get(vSig);
      hit = { text, ids: officialMap[text] }; how = 'vocab';
    }

    // c) 签名互为包含（双向都要≥6，防止短词误命中；优先文本更长的官方项=更特异）
    if (!hit) {
      let best = null;
      for (const o of officialArr) {
        if (o.sig === sig) continue;
        if (sig.length >= 6 && o.sig.length >= 6 && (o.sig.includes(sig) || sig.includes(o.sig))) {
          if (!best || o.sig.length > best.sig.length) best = o;
        }
      }
      if (best) { hit = { text: best.text, ids: best.ids }; how = 'contains'; }
    }

    if (hit) {
      g.officialText = hit.text;
      g.statIds = hit.ids;
      g._oMatch = how;
      stat[how]++;
    } else if (g.officialText && g.statIds && g.statIds.length) {
      // 保留旧对齐（此前已通过其他途径对上的）
      g._oMatch = 'inherit';
      stat.inherit++;
    } else {
      g._oMatch = 'none';
      delete g.statIds; // 无对齐就不给假 ids
      stat.none++;
      unmatched.push({ cat: cat.slug, id: g.id, template: g.template });
    }
  }
}
console.log('词缀对齐统计:', JSON.stringify(stat));

/* ---------- 5. 写盘 ---------- */
db.version = '0.7';
db.builtAt = new Date().toISOString();
db.sources = Object.assign({}, db.sources, {
  dropdown: 'market_dropdown_real.json（市集官网真实下拉 496 条，词缀 officialText 唯一来源）',
  realign: 'scripts/realign_official.js（officialText 一律取市集真实下拉文本）',
});
fs.writeFileSync(dbPath, JSON.stringify(db));
fs.writeFileSync(path.join(DATA, 'official_stat_map.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  source: 'market_dropdown_real.json + guofu_stats_api.json + stat_translation.json',
  count: Object.keys(officialMap).length,
  entries: officialMap,
}, null, 1));
fs.writeFileSync(path.join(DATA, 'realign_report.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  stat, unmatchedCount: unmatched.length,
  unmatched,
  unmatchedOfficial,
}, null, 1));
console.log('已写 mods_db.json v0.7 · official_stat_map.json · realign_report.json');
