/**
 * inject_unique_mods.js — Task #19 收尾：把对齐好的暗金词条注入 mods_db.json。
 *
 * 输入：data/tmp/unique_mods_aligned.json（pairKey → { slug, mods }）
 * 目标：extension/data/mods_db.json 中每个暗金 base 对象（unique:true）挂上 mods 数组。
 *   mods: [{ kind, text, o?, s?, t?, m? }]
 *     kind: implicit|explicit   text: poe2db 展示文本
 *     o:    officialText（可筛词条才有）
 *     s:    statIds（≤4 条，explicit 组优先，可用于市集下拉筛选）
 *     t:    statType（explicit|pseudo|implicit=基底|skill=技能；暗金固有词缀 = implicit）
 *     m:    匹配方式（exact 省略；vocab/contains 记录）
 *
 * pairKey 关联规则：mods_db 暗金 text =「名字 底材」，pairKey =「名字|底材」。
 * 运行：node scripts/inject_unique_mods.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const aligned = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'unique_mods_aligned.json'), 'utf8'));
const dbPath = path.join(ROOT, 'extension', 'data', 'mods_db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

/** aligned mods → 精简存储形态 */
function slimMod(m) {
  const base = { kind: m.kind, text: m.text };
  if (m.match !== 'none' && m.statIds && m.statIds.length) {
    base.o = m.officialText;
    base.s = m.statIds.slice(0, 4);
    base.t = m.statType;
    if (m.match !== 'exact') base.m = m.match;
  }
  return base;
}

const report = { injected: 0, noMods: 0, notFound: [], totalMods: 0 };
for (const c of db.categories) {
  for (const b of (c.bases || [])) {
    if (!b.unique) continue;
    const pairKey = b.text.replace(' ', '|');
    const hit = aligned[pairKey];
    if (!hit || !hit.mods || !hit.mods.length) { report.notFound.push(b.text); continue; }
    b.mods = hit.mods.map(slimMod);
    report.injected++;
    report.totalMods += b.mods.length;
  }
}

db.version = '0.9';
db.builtAt = new Date().toISOString();
db.sources = Object.assign({}, db.sources, {
  uniqueMods: 'poe2db 暗金详情页（712 个暗金固定词条）+ 官方市集三层字典对齐（scripts/align_unique_mods.js）',
});

fs.writeFileSync(dbPath, JSON.stringify(db));
fs.writeFileSync(path.join(ROOT, 'data', 'tmp', 'inject_unique_report.json'), JSON.stringify(report, null, 1));
console.log(`注入完成：${report.injected} 个暗金挂载 mods（共 ${report.totalMods} 条词条），未找到 ${report.notFound.length}`);
if (report.notFound.length) console.log('未找到样本:', report.notFound.slice(0, 10).join(' | '));
console.log('mods_db.json →', (fs.statSync(dbPath).size / 1024 / 1024).toFixed(2), 'MB · version', db.version);
