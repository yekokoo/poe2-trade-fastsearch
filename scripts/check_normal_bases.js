/** 深度校验：合并视图普通基底跨变体一致性（level / implicit / panel），及同名不同 slug 检查 */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));
const cats = db.categories;

const groups = new Map();
cats.forEach((c) => {
  if (!groups.has(c.baseSlug)) groups.set(c.baseSlug, []);
  groups.get(c.baseSlug).push(c);
});

console.log('== 普通基底跨变体差异检查（level / implicit 不一致即去重有风险） ==');
let risky = 0;
for (const [bs, list] of groups) {
  if (list.length <= 1) continue;
  const bySlug = new Map();
  list.forEach((c) => (c.bases || []).forEach((b) => {
    if (b.unique) return;
    if (!bySlug.has(b.slug)) bySlug.set(b.slug, []);
    bySlug.get(b.slug).push({ cat: c.slug, variant: c.variant, b });
  }));
  const diffs = [];
  for (const [slug, arr] of bySlug) {
    if (arr.length < 2) continue;
    const sig = (x) => JSON.stringify([x.b.level, x.b.props && x.b.props.implicit, x.b.panel]);
    const first = sig(arr[0]);
    const bad = arr.filter((x) => sig(x) !== first);
    if (bad.length) diffs.push({ slug, name: arr[0].b.name, variants: arr.map((x) => x.variant + (sig(x) !== first ? '*' : '')) });
  }
  if (diffs.length) {
    risky += diffs.length;
    console.log(`  ${bs}: ${diffs.length} 个基底跨变体不一致（* 号 = 与首个不同）`);
    diffs.slice(0, 5).forEach((d) => console.log(`    ${d.slug} "${d.name}": ${d.variants.join(', ')}`));
  } else {
    console.log(`  ${bs}: 全部一致 ✓（${bySlug.size} 个普通基底）`);
  }
}

console.log('\n== 同名普通基底不同 slug（合并视图会显示两条同名） ==');
for (const [bs, list] of groups) {
  if (list.length <= 1) continue;
  const byName = new Map();
  list.forEach((c) => (c.bases || []).forEach((b) => {
    if (b.unique) return;
    if (!byName.has(b.name)) byName.set(b.name, new Set());
    byName.get(b.name).add(b.slug);
  }));
  const multi = [...byName.entries()].filter(([, s]) => s.size > 1);
  if (multi.length) console.log(`  ${bs}: ${multi.map(([n, s]) => `"${n}"(${[...s].join('/')})`).join('、')}`);
  else console.log(`  ${bs}: 无 ✓`);
}

console.log('\n== 普通基底跨变体出现次数分布（Boots 为例） ==');
{
  const list = groups.get('Boots');
  const bySlug = new Map();
  list.forEach((c) => (c.bases || []).forEach((b) => {
    if (b.unique) return;
    if (!bySlug.has(b.slug)) bySlug.set(b.slug, new Set());
    bySlug.get(b.slug).add(c.variant);
  }));
  const dist = {};
  for (const [, vs] of bySlug) { const k = vs.size; dist[k] = (dist[k] || 0) + 1; }
  console.log('  出现于 N 个变体的基底数分布:', JSON.stringify(dist));
}
