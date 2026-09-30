// verify_local_redirect.js — v0.6.2 反馈②：暗金本地词缀必须对齐官方本地形态（(区域)/武器专用下拉）
// 纯 Node 校验（不依赖浏览器）：读 raw + aligned + mods_db 逐条核对。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const raw = read('data/tmp/unique_mods_raw.json');
const aligned = read('data/tmp/unique_mods_aligned.json');
const db = read('extension/data/mods_db.json');
const osm = read('data/official_stat_map.json');
const flat = read('data/trade2_stats_flat.json');
const gs = read('data/guofu_stats_api.json');

const results = [];
const ok = (name, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

/* ---- 收集官方区域版 stat id 数字（三层全量） ----
 * v0.6.4 起重定向规则改为「officialText 必须是市集真实下拉文本」（osm entries 的 key），
 * 区域版 id 集仍保留用于兼容 (区域) 形态下拉（攻速/护甲/闪避/格挡等）。 */
const areaIdNums = new Set();
function addArea(text, ids) {
  if (!/区域/.test(String(text))) return;
  for (const id of ids || []) {
    const m = String(id).match(/stat_(\d+)/);
    if (m) areaIdNums.add(m[1]);
  }
}
for (const [t, ids] of Object.entries(osm.entries || {})) addArea(t, ids);
for (const s of flat) addArea(s.text, [s.id]);
for (const g of gs.result) for (const e of (g.entries || [])) addArea(e.text, [e.id]);

/* ---- A. 全库 local 重定向校验（v0.6.4）：officialText 必须是市集真实下拉文本 ----
 * 旧断言（id 必须是区域版/武器专用）在重定向 v2 下过时：市集对 local 附加伤害的
 * 下拉就是「附加 # - # X伤害」（无 区域 字样、id 也是全局 id），文本真实存在即正确。 */
const OPT_SET = new Set(Object.keys(osm.entries || {}));
let localOk = 0, localBad = 0;
const badSamples = [];
for (const c of db.categories) {
  for (const b of (c.bases || [])) {
    if (!b.unique) continue;
    for (const m of (b.mods || [])) {
      if (m.m !== 'local') continue;
      if (m.o && OPT_SET.has(m.o)) localOk++;
      else { localBad++; if (badSamples.length < 5) badSamples.push(b.text + ' :: ' + m.text + ' [' + (m.o || '') + ']'); }
    }
  }
}
ok('全库 local 重定向 officialText 均为市集真实下拉文本', localBad === 0, `ok=${localOk} bad=${localBad} ${badSamples.join(' / ')}`);

/* ---- B. 非 local 词条零污染：isLocal=false 的词条不得标成区域形态 ---- */
let pollute = 0;
const polluteSamples = [];
for (const [pairKey, info] of Object.entries(raw)) {
  const al = aligned[pairKey];
  if (!al) continue;
  info.mods.forEach((m, i) => {
    const isLocal = (m.stats || []).some((s) => String(s).startsWith('local'));
    if (isLocal) return;
    const rec = al.mods[i];
    if (rec && rec.match === 'local') {
      pollute++;
      if (polluteSamples.length < 5) polluteSamples.push(pairKey + ' :: ' + m.text);
    }
    if (rec && /区域/.test(rec.officialText || '') && !String(m.text || '').includes('区域')) {
      pollute++;
      if (polluteSamples.length < 5) polluteSamples.push(pairKey + ' :: ' + m.text + ' → ' + rec.officialText);
    }
  });
}
ok('非 local 词条未被污染成区域形态', pollute === 0, `pollute=${pollute} ${polluteSamples.join(' / ')}`);

/* ---- C. 二元一体：攻击速度 → 区域版；物理伤害/暴击伤害加成 → 保持全局 ---- */
let duality = null;
for (const c of db.categories) for (const b of (c.bases || [])) {
  if (b.unique && b.text === '二元一体 守护节杖') { duality = b; break; }
}
ok('mods_db 含二元一体 守护节杖', !!duality);
if (duality) {
  const as = (duality.mods || []).find((m) => (m.text || '').includes('攻击速度提高'));
  ok('攻击速度重定向为区域版文本', as && as.o === '攻击速度提高 #% (区域)', 'o=' + (as && as.o));
  ok('攻击速度 stat id = 区域版 210067635', !!(as && (as.s || []).includes('explicit.stat_210067635')),
    (as && (as.s || []).join(',')) || '');
  ok('攻击速度带 local 标记', !!(as && as.m === 'local'));
  const phys = (duality.mods || []).find((m) => (m.text || '').includes('物理伤害提高'));
  ok('物理伤害提高保持全局（官方无本地形态）', phys && phys.o === '物理伤害提高 #%', 'o=' + (phys && phys.o));
  const crit = (duality.mods || []).find((m) => (m.text || '').includes('暴击伤害加成'));
  ok('暴击伤害加成保持全局', crit && crit.o === '#% 暴击伤害加成', 'o=' + (crit && crit.o));
}

/* ---- D. 白银之舌：附加伤害 → 市集下拉「附加 # - # 物理伤害」；偷取 → 「物理攻击伤害的 #% 转化为」下拉 ---- */
let silver = null;
for (const c of db.categories) for (const b of (c.bases || [])) {
  if (b.unique && b.text === '白银之舌 狂热弓') { silver = b; break; }
}
ok('mods_db 含白银之舌 狂热弓', !!silver);
if (silver) {
  const add = (silver.mods || []).find((m) => (m.text || '').includes('附加') && (m.text || '').includes('物理伤害'));
  ok('附加物理伤害 officialText=市集下拉「附加 # - # 物理伤害」', add && add.o === '附加 # - # 物理伤害', 'o=' + (add && add.o));
  ok('附加物理伤害 stat id = 1940865751', !!(add && (add.s || []).some((x) => String(x).includes('1940865751'))),
    (add && (add.s || []).join(',')) || '');
  const leech = (silver.mods || []).find((m) => (m.text || '').includes('生命偷取'));
  ok('生命偷取用市集下拉文本+正确id 2557965901', leech && leech.o === '物理攻击伤害的 #% 转化为生命偷取' && (leech.s || []).some((x) => String(x).includes('2557965901')),
    'o=' + (leech && leech.o) + ' s=' + ((leech && (leech.s || []).join(',')) || ''));
  const critC = (silver.mods || []).find((m) => (m.text || '').includes('暴击几率'));
  ok('暴击几率保持全局（市集本地暴击下拉即此项）', critC && critC.o === '暴击几率 #%', 'o=' + (critC && critC.o));
}

/* ---- E. 重定向计数合理性（v0.6.4 重定向 v2：562→282，API 文本出局） ---- */
const nLocal = Object.values(aligned).reduce((n, al) => n + al.mods.filter((m) => m.match === 'local').length, 0);
ok('local 重定向数量在预期区间', nLocal > 250 && nLocal < 350, 'local=' + nLocal);

/* ---- E2. 寒冬噬咬回归断言（用户反馈案例）：附加冰霜 = 下拉「附加 # - # 冰霜伤害」 ---- */
let winter = null;
for (const c of db.categories) for (const b of (c.bases || [])) {
  if (b.unique && b.text === '寒冬噬咬 玻璃利片') { winter = b; break; }
}
ok('mods_db 含寒冬噬咬 玻璃利片', !!winter);
if (winter) {
  const cold = (winter.mods || []).find((m) => (m.text || '').includes('冰霜伤害'));
  ok('寒冬噬咬附加冰霜 officialText=「附加 # - # 冰霜伤害」', cold && cold.o === '附加 # - # 冰霜伤害', 'o=' + (cold && cold.o));
  ok('寒冬噬咬附加冰霜 stat id = 1037193709（非 1109700751 反击技能）',
    !!(cold && (cold.s || []).some((x) => String(x).includes('1037193709'))) && !(cold.s || []).some((x) => String(x).includes('1109700751')),
    (cold && (cold.s || []).join(',')) || '');
  // v0.6.4：重定向 v2 下源文本经 osm 精确命中 prio1 下拉（match=exact），无需再走重定向
  ok('寒冬噬咬附加冰霜为 dropdown 来源对齐', !!(cold && cold.s && cold.s.length));
}

/* ---- F. v0.6.3 反馈③：固有词条 → 基底组；local 重定向与基底改造互不干扰 ---- */
let impCnt = 0, impBadCnt = 0, impBadList = [];
for (const [pairKey, al] of Object.entries(aligned)) {
  for (const m of al.mods) {
    if (m.match === 'none') continue;
    if (m.statType === 'implicit') {
      impCnt++;
      if (!(m.statIds || []).length || !m.statIds.every((x) => String(x).startsWith('implicit.'))) {
        impBadCnt++;
        if (impBadList.length < 5) impBadList.push(pairKey + ' :: ' + m.text + ' [' + (m.statIds || []).join(',') + ']');
      }
    }
  }
}
ok('aligned 固有词条全部指向基底组', impBadCnt === 0, `ok=${impCnt} bad=${impBadCnt} ${impBadList.join(' / ')}`);
ok('aligned 基底词条数量合理（≈160+2 vocab）', impCnt >= 150 && impCnt <= 180, 'implicit=' + impCnt);
// implicit+local 词条（38 条，对齐成功 32 条）：poe2db 内部 id 带 local 但官方下拉
// 多为咒符基底词缀（仅 implicit 组一份，exact 直接命中，无需重定向）。
// 验收点：statIds 组必须统一——全 implicit（t=implicit）或全 explicit（官方无基底版），
// 不允许 explicit/implicit 混杂（混杂 = 过滤未生效）。
let bothOk = 0, bothBad = 0;
const raw2 = read('data/tmp/unique_mods_raw.json');
for (const [pairKey, info] of Object.entries(raw2)) {
  const al = aligned[pairKey];
  if (!al) continue;
  const seen = new Set();
  info.mods.forEach((m, i) => {
    const k = m.kind + '|' + m.text;
    if (seen.has(k)) return; seen.add(k);
    if (m.kind !== 'implicit' || !(m.stats || []).some((s) => String(s).startsWith('local'))) return;
    const rec = al.mods.find((r) => r.text === m.text);
    if (!rec || rec.match === 'none') return;
    bothOk++;
    const ids = rec.statIds || [];
    const allImp = ids.length && ids.every((x) => String(x).startsWith('implicit.'));
    const allExp = ids.length && ids.every((x) => String(x).startsWith('explicit.'));
    const tOk = allImp ? rec.statType === 'implicit' : allExp ? rec.statType === 'explicit' : false;
    if (!tOk && bothBad < 5) impBadList.push(pairKey + ' :: ' + m.text + ' [' + ids.slice(0, 2).join(',') + '] t=' + rec.statType);
    if (!tOk) bothBad++;
  });
}
ok('implicit+local 词条 statIds 组统一', bothBad === 0, `ok=${bothOk} bad=${bothBad} ${impBadList.join(' / ')}`);

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
process.exit(fails ? 1 : 0);
