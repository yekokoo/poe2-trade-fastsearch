/**
 * probe_stat_hash.js — 探测官方 stat id（explicit.stat_NNNN）能否由内部英文 id 哈希复现。
 * 样本锚点（来自 guofu_stats_api.json + poe2db Attr 区）：
 *   base maximum life        -> explicit.stat_3299347043
 *   local physical damage reduction rating +% -> local physical damage reduction rating +%（待验证样本）
 * 若哈希复现成功 → poe2db 内部 id 可 100% 精确映射官方 stat id。
 * 运行：node scripts/probe_stat_hash.js
 */
const fs = require('fs');
const path = require('path');

/* ---------- 候选哈希 ---------- */
function murmur2gc(str, seed = 0) {
  const c = (i) => str.charCodeAt(i) & 0xff;
  let l = str.length, h = seed ^ l, i = 0, k;
  while (l >= 4) {
    k = c(i) | (c(++i) << 8) | (c(++i) << 16) | (c(++i) << 24);
    k = Math.imul(k, 0x5bd1e995); k ^= k >>> 15; k = Math.imul(k, 0x5bd1e995);
    h = Math.imul(h, 0x5bd1e995) ^ k; l -= 4; ++i;
  }
  switch (l) {
    case 3: h ^= c(i + 2) << 16;
    case 2: h ^= c(i + 1) << 8;
    case 1: h ^= c(i); h = Math.imul(h, 0x5bd1e995);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 16;
  return h >>> 0;
}
function murmur3_32(key, seed = 0) {
  const c1 = 0xcc9e2d51, c2 = 0x1b873593;
  let h = seed; const len = key.length;
  const utf8 = Buffer.from(key, 'utf8');
  const rounded = Math.floor(len / 4);
  for (let i = 0; i < rounded; i++) {
    const j = i * 4;
    let k = utf8[j] | (utf8[j + 1] << 8) | (utf8[j + 2] << 16) | (utf8[j + 3] << 24);
    k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k1 = 0; const rem = len & 3;
  for (let i = rounded * 4; i < len; i++) k1 = (k1 | (utf8[i] << (8 * (i - rounded * 4)))) >>> 0;
  if (rem) {
    k1 = Math.imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = Math.imul(k1, c2); h ^= k1;
  }
  h ^= len; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function fnv1a(str) { let h = 0x811c9dc5; for (const b of Buffer.from(str, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function fnv1(str) { let h = 0x811c9dc5; for (const b of Buffer.from(str, 'utf8')) { h = Math.imul(h, 0x01000193) >>> 0; h ^= b; } return h >>> 0; }
function crc32(str) {
  const utf8 = Buffer.from(str, 'utf8');
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  let crc = -1;
  for (const b of utf8) crc = (crc >>> 8) ^ t[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}
function djb2(str) { let h = 5381; for (const b of Buffer.from(str, 'utf8')) h = (Math.imul(h, 33) + b) >>> 0; return h >>> 0; }

/* ---------- 锚点样本：从 guofu_stats_api 反推内部 id（GGG 英文习惯命名） ---------- */
// 已确认对应关系（poe2db 内部英文 id ↔ 官方 stat 数值部分）
const ANCHORS = [
  ['base_maximum_life', 'explicit.stat_3299347043'],
  ['base_maximum_mana', null],       // 待从 API 找
  ['base_resist_all_elements_%', null],
];

// 先从 API 采样一批 explicit stat，构建「官方数值 id 集合」用于碰撞测试
const DATA = path.join(__dirname, '..', 'data');
const gs = JSON.parse(fs.readFileSync(path.join(DATA, 'guofu_stats_api.json'), 'utf8'));
const allStats = [];
for (const g of gs.result) for (const e of g.entries) allStats.push({ id: e.id, text: e.text, group: g.id });
const exp = allStats.filter((s) => s.id.startsWith('explicit.'));
console.log('explicit stats in API:', exp.length);

// 人工锚定：poe2db「base maximum life」对应官方「+# 最大生命」= explicit.stat_3299347043
const target = 3299347043;
const cands = [
  'base_maximum_life', 'base maximum life', 'BaseMaximumLife', 'baseMaximumLife',
  'stat_base_maximum_life', 'maximum_life', 'MaximumLife', 'maximum life',
  'base_maximum_life_', 'life_maximum_base',
];
const fns = { murmur2gc, murmur3_32, fnv1a, fnv1, crc32, djb2 };
let hit = null;
for (const [n, f] of Object.entries(fns)) {
  for (const s of cands) {
    let v;
    try { v = f(s); } catch (_) { continue; }
    if (v === target) hit = [n, s];
  }
}
console.log(hit ? `HIT: ${hit[0]}(${hit[1]}) -> ${target}` : 'no direct hit');

/* ---------- 统计学验证：用 API 全量 explicit id 反查文本可否哈希出内部 id ---------- */
// 已知 GGG 内部 id 与文本的对应（英文），拿 6 组常见词尝试穷举形态
const pairsEn = [
  ['+# 最大生命', ['base_maximum_life']],
  ['+#% 总抗性', ['base_resist_all_elements_%']],
  ['+# 力量', ['additional_strength']],
  ['+#% 混沌抗性', ['base_chaos_damage_resistance_%']],
  ['+# 最大魔力', ['base_maximum_mana']],
  ['移动速度提高 #%', ['base_movement_velocity_+%']],
];
for (const [text, ids] of pairsEn) {
  const official = allStats.find((s) => s.text === text && s.id.startsWith('explicit.'));
  if (!official) { console.log('API 无此文本:', text); continue; }
  const num = Number(official.id.split('_').pop());
  for (const en of ids) {
    const results = Object.entries(fns).map(([n, f]) => `${n}=${f(en)}`).join(' ');
    console.log(`"${en}" ${results}  | 官方=${num} ${Object.values(fns).some((f) => f(en) === num) ? 'MATCH!' : ''}`);
  }
}
