/** 验证 mergedCat 去重修复后的效果（无需浏览器，直接模拟 popup.js 逻辑） */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));

/* 与 popup.js 修复后逻辑一致的模拟 */
const VIRTUAL = {};
const SUB_LABEL = { Gloves: '手套', Boots: '鞋子', Body_Armours: '护甲', Helmets: '头盔', Shields: '盾牌', Relics: '遗物', Jewels: '珠宝' };
function mergedCat(baseSlug) {
  const parts = db.categories.filter((c) => c.baseSlug === baseSlug);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const slug = baseSlug + '_any';
  if (!VIRTUAL[slug]) {
    const bmap = new Map();
    const umap = new Map();
    parts.forEach((c) => (c.bases || []).forEach((b) => {
      if (b.unique) {
        const prev = umap.get(b.text);
        if (!prev) umap.set(b.text, { ...b });
        else if ((b.mods || []).length > (prev.mods || []).length) umap.set(b.text, { ...b });
      } else {
        const prev = bmap.get(b.name);
        if (!prev) bmap.set(b.name, { ...b, _variants: [c.variant], _slugs: [b.slug] });
        else {
          if (!prev._variants.includes(c.variant)) prev._variants.push(c.variant);
          if (!prev._slugs.includes(b.slug)) prev._slugs.push(b.slug);
        }
      }
    }));
    bmap.forEach((b) => {
      b._variant = b._slugs.length > 1 ? b._variants.join('/') : null;
      delete b._variants;
      delete b._slugs;
    });
    VIRTUAL[slug] = { slug, bases: [...bmap.values(), ...umap.values()] };
  }
  return VIRTUAL[slug];
}

console.log('== 修复后各合并视图基底数量（修复前 = 原始去重前总和） ==');
let beforeTotal = 0, afterTotal = 0;
for (const bs of ['Boots', 'Gloves', 'Body_Armours', 'Helmets', 'Shields', 'Relics', 'Jewels']) {
  const parts = db.categories.filter((c) => c.baseSlug === bs);
  if (parts.length <= 1) continue;
  const before = parts.reduce((n, c) => n + (c.bases || []).length, 0);
  const after = mergedCat(bs).bases.length;
  beforeTotal += before; afterTotal += after;
  const aziri = mergedCat(bs).bases.filter((b) => b.unique && /阿兹里的金履/.test(b.text));
  console.log(`  ${bs}: ${before} → ${after}（消除 ${before - after} 条重复）` +
    (aziri.length ? ` | "阿兹里的金履"相关暗金现为 ${aziri.length} 条: ${aziri.map((b) => b.text).join(' / ')}` : ''));
}
console.log(`  合计: ${beforeTotal} → ${afterTotal}\n`);

console.log('== 暗金变体名可辨识性抽查（同一 name 不同 text） ==');
{
  const boots = mergedCat('Boots');
  const byName = new Map();
  boots.bases.filter((b) => b.unique).forEach((b) => {
    if (!byName.has(b.name)) byName.set(b.name, []);
    byName.get(b.name).push(b.text);
  });
  const multi = [...byName.entries()].filter(([, ts]) => ts.length > 1);
  console.log(`  ${multi.length} 个暗金名带多个类型变体（下拉文本含类型，本身可辨识），例：`);
  multi.slice(0, 4).forEach(([n, ts]) => console.log(`    ${n}: ${ts.join(' / ')}`));
}

console.log('\n== 普通基底变体标注抽查 ==');
{
  const boots = mergedCat('Boots');
  const sample = boots.bases.filter((b) => !b.unique).slice(0, 3);
  sample.forEach((b) => console.log(`  ${b.name} → 标注:（${b._variant}）`));
  const body = mergedCat('Body_Armours');
  const hermit = body.bases.find((b) => !b.unique && b.name === '隐士束衣');
  console.log(`  隐士束衣（跨 slug 同名）→ 标注:（${hermit ? hermit._variant : '未找到'}）`);
}
