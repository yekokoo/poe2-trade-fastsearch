#!/usr/bin/env node
/**
 * verify_slugs.js
 * 按用户《需要做搜索的分类.md》列出候选 slug，逐个 GET 验证存在性并提取 <title> 中文名
 * 输出 data/categories_map.json
 */
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 分组 → [候选slug]（按用户分类文件组织；别名用 | 分隔，取第一个命中的）
const GROUPS = [
  { group: '单手武器', slugs: ['Claws|爪类', 'Daggers|匕首', 'Wands|法杖', 'One_Hand_Swords|One_Hand_Sword|单手剑', 'One_Hand_Axes|One_Hand_Axe|单手斧', 'One_Hand_Maces|One_Hand_Mace|单手锤', 'Sceptres|Sceptre|权杖', 'Spears|Spear|战矛', 'Flails|Flail|连枷'] },
  { group: '双手武器', slugs: ['Bows|弓类', 'Staves|长杖', 'Two_Hand_Swords|Two_Hand_Sword|双手剑', 'Two_Hand_Axes|Two_Hand_Axe|双手斧', 'Two_Hand_Maces|双手锤', 'Quarterstaves|节杖', 'Crossbows|战弩', 'Talismans|魔符'] },
  { group: '副手', slugs: ['Quivers|箭袋', 'Shields|盾牌', 'Bucklers|轻盾', 'Foci|Focus|法器'] },
  { group: '护甲', slugs: ['Gloves|手套', 'Boots|鞋子', 'Body_Armours|Body_Armour|护甲', 'Helmets|Helmet|头盔'] },
  { group: '饰品', slugs: ['Amulets|Amulet|项链', 'Rings|Ring|戒指'] },
  { group: '腰带', slugs: ['Belts|Belt|腰带'] },
  { group: '药剂', slugs: ['Life_Flasks|生命药剂', 'Mana_Flasks|魔力药剂', 'Charms|咒符'] },
  { group: '引路石', slugs: ['Waystones|引路石'] },
  { group: '珠宝', slugs: ['Jewels|Jewel|珠宝'] },
  { group: '其他', slugs: ['Vault_Keys|宝库钥匙', 'Relics|遗物'] },
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

(async () => {
  const results = [];
  for (const g of GROUPS) {
    for (const entry of g.slugs) {
      const [cands, cnHint] = entry.split('|');
      const slugList = cands.split(',');
      let hit = null;
      for (const slug of slugList) {
        try {
          const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
          const t = html.match(/<title>([^<]+)<\/title>/);
          const title = t ? t[1].replace(/ - .*/, '').trim() : '';
          hit = { group: g.group, slug, title, bytes: html.length };
          console.log(`OK   ${g.group}  ${slug.padEnd(18)} → ${title}`);
          break;
        } catch (e) {
          console.log(`MISS ${g.group}  ${slug.padEnd(18)} ${e.message}`);
        }
      }
      results.push(hit || { group: g.group, slug: cands, title: null, missing: true, cnHint });
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const out = path.join(__dirname, '..', 'data', 'categories_map.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nsaved ${out}`);
  const missing = results.filter((r) => r.missing);
  console.log(`missing: ${missing.length}`);
  missing.forEach((m) => console.log(`  ! ${m.group} ${m.slug} (期望:${m.cnHint})`));
})();
