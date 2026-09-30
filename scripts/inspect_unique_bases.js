/** 检查暗金基底对象结构：跨变体分类的同名暗金，slug/mods/props 是否一致 */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));

const cats = db.categories;
const target = '阿兹里的金履 束带长靴';
const found = [];
cats.forEach((c) => (c.bases || []).forEach((b) => {
  if (b.unique && b.text === target) found.push({ cat: c.slug, b });
}));

console.log(`"${target}" 出现 ${found.length} 次：`);
found.forEach(({ cat, b }) => {
  console.log(`\n--- ${cat} ---`);
  console.log(JSON.stringify({ slug: b.slug, name: b.name, type: b.type, level: b.level, modsN: (b.mods || []).length }, null, 0));
  console.log('mods 首条:', (b.mods || [])[0] ? JSON.stringify((b.mods || [])[0]).slice(0, 120) : '(无)');
});

// 对比同名暗金跨分类的 mods 是否完全一致
const modsSig = (b) => JSON.stringify((b.mods || []).map((m) => [m.text, (m.s || []).length]));
const base = found[0];
if (found.length > 1) {
  const sigs = new Set(found.map(({ b }) => modsSig(b)));
  console.log(`\n跨分类 mods 签名一致性：${sigs.size === 1 ? '完全一致 ✓' : '存在差异 ✗（' + sigs.size + ' 种）'}`);
}
