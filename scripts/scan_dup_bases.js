/** 动态扫描：所有共享 baseSlug 的分类组（>1 即有合并视图）中的暗金重复情况 */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));
const cats = db.categories;

// 按 baseSlug 分组
const groups = new Map();
cats.forEach((c) => {
  if (!groups.has(c.baseSlug)) groups.set(c.baseSlug, []);
  groups.get(c.baseSlug).push(c);
});

console.log('== 有变体分类的部位（baseSlug → 分类数） ==');
for (const [bs, list] of groups) {
  if (list.length > 1) console.log(`  ${bs}: ${list.length} 个变体分类 [${list.map((c) => c.slug).join(', ')}]`);
}

console.log('\n== 各部位合并视图暗金重复统计 ==');
let grandDup = 0, grandUnique = 0;
for (const [bs, list] of groups) {
  if (list.length <= 1) continue;
  const seen = new Map();
  list.forEach((c) => (c.bases || []).forEach((b) => {
    if (!b.unique) return;
    if (!seen.has(b.text)) seen.set(b.text, []);
    seen.get(b.text).push(c.slug);
  }));
  const dupNames = [...seen.entries()].filter(([, s]) => s.length > 1);
  const partial = dupNames.filter(([, s]) => s.length < list.length);
  grandDup += dupNames.reduce((n, [, s]) => n + s.length, 0);
  grandUnique += seen.size;
  console.log(`  ${bs}: ${dupNames.length}/${seen.size} 暗金名跨变体重复` +
    (partial.length ? `（其中 ${partial.length} 个只在部分变体出现: ${partial.slice(0, 3).map(([t, s]) => `"${t}"×${s.length}`).join('、')}）` : ''));
}

// 胸甲 2 个未重复的暗金
console.log('\n== Body_Armours 中未跨全部变体重复的暗金 ==');
const body = groups.get('Body_Armours');
const seenB = new Map();
body.forEach((c) => (c.bases || []).forEach((b) => {
  if (!b.unique) return;
  if (!seenB.has(b.text)) seenB.set(b.text, []);
  seenB.get(b.text).push(c.slug);
}));
for (const [t, s] of seenB) {
  if (s.length < body.length) console.log(`  "${t}" ×${s.length}: ${s.join(', ')}`);
}

console.log(`\n总计：合并视图当前展示 ${grandDup} 条暗金，去重后应为 ${grandUnique} 条（消除 ${grandDup - grandUnique} 条重复）`);
