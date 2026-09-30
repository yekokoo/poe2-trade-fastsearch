#!/usr/bin/env node
/**
 * build_plugin_db.js
 * 把 data/parsed/*.json 合并精简为插件可直接使用的词缀库：
 *   extension/data/mods_db.json
 * 结构：
 *   {
 *     version, builtAt,
 *     sources: { base:{label:'基础',color:'#5F5E5A',icon:''}, desecrated:{...}, alloy, destruction, essence, corrupted },
 *     categories: [ { slug, cnName, group, affixGroups: [...] } ]
 *   }
 * 词缀组字段瘦身：id, preSuf, source, template, text, minIlvl, maxIlvl, tierCount, tiers[{tier,ilvl,values,text}]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const parsedDir = path.join(ROOT, 'data', 'parsed');
const catMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'categories_map.json'), 'utf-8'));

// slug → 用户分组名（主分类 + 变体页归属）
const slugToGroup = {};
catMap.forEach((c) => { slugToGroup[c.slug] = c.group; });
// 变体页 → 主分类slug
const VARIANT_MAP = {
  Gloves_str: 'Gloves', Gloves_dex: 'Gloves', Gloves_int: 'Gloves',
  Gloves_str_dex: 'Gloves', Gloves_str_int: 'Gloves', Gloves_dex_int: 'Gloves',
  Boots_str: 'Boots', Boots_dex: 'Boots', Boots_int: 'Boots',
  Boots_str_dex: 'Boots', Boots_str_int: 'Boots', Boots_dex_int: 'Boots',
  Body_Armours_str: 'Body_Armours', Body_Armours_dex: 'Body_Armours', Body_Armours_int: 'Body_Armours',
  Body_Armours_str_dex: 'Body_Armours', Body_Armours_str_int: 'Body_Armours',
  Body_Armours_dex_int: 'Body_Armours', Body_Armours_str_dex_int: 'Body_Armours',
  Helmets_str: 'Helmets', Helmets_dex: 'Helmets', Helmets_int: 'Helmets',
  Helmets_str_dex: 'Helmets', Helmets_str_int: 'Helmets', Helmets_dex_int: 'Helmets',
  Shields_str: 'Shields', Shields_str_dex: 'Shields', Shields_str_int: 'Shields',
  // 引路石/珠宝/遗物变体
  Waystones_low_tier: 'Waystones', Waystones_mid_tier: 'Waystones', Waystones_top_tier: 'Waystones',
  Ruby: 'Jewels', Emerald: 'Jewels', Sapphire: 'Jewels', Diamond: 'Jewels',
  Urn_Relic: 'Relics', Amphora_Relic: 'Relics', Vase_Relic: 'Relics',
  Seal_Relic: 'Relics', Coffer_Relic: 'Relics', Tapestry_Relic: 'Relics', Incense_Relic: 'Relics',
};
const VARIANT_LABEL = {
  Gloves_str: '力量', Gloves_dex: '敏捷', Gloves_int: '智慧', Gloves_str_dex: '力敏', Gloves_str_int: '力智', Gloves_dex_int: '敏智',
  Boots_str: '力量', Boots_dex: '敏捷', Boots_int: '智慧', Boots_str_dex: '力敏', Boots_str_int: '力智', Boots_dex_int: '敏智',
  'Body_Armours_str': '力量', Body_Armours_dex: '敏捷', Body_Armours_int: '智慧',
  Body_Armours_str_dex: '力敏', Body_Armours_str_int: '力智', Body_Armours_dex_int: '敏智', Body_Armours_str_dex_int: '全属性',
  Helmets_str: '力量', Helmets_dex: '敏捷', Helmets_int: '智慧', Helmets_str_dex: '力敏', Helmets_str_int: '力智', Helmets_dex_int: '敏智',
  Shields_str: '力量', Shields_str_dex: '力敏', Shields_str_int: '力智',
  Waystones_low_tier: '低阶', Waystones_mid_tier: '中阶', Waystones_top_tier: '高阶',
  Ruby: '红珠宝', Emerald: '绿珠宝', Sapphire: '蓝珠宝', Diamond: '钻石珠宝',
  Urn_Relic: '壶瓮', Amphora_Relic: '土罐', Vase_Relic: '花瓶', Seal_Relic: '封印',
  Coffer_Relic: '匣柜', Tapestry_Relic: '挂毯', Incense_Relic: '熏香',
};
function variantOf(slug) {
  if (VARIANT_MAP[slug]) return { base: VARIANT_MAP[slug], label: VARIANT_LABEL[slug] };
  return null;
}

function main() {
  const files = fs.readdirSync(parsedDir).filter((f) => f.endsWith('.json'));
  const categories = [];
  for (const f of files) {
    const slug = f.replace('.json', '');
    const p = JSON.parse(fs.readFileSync(path.join(parsedDir, f), 'utf-8'));
    const v = variantOf(slug);
    const baseSlug = v ? v.base : slug;
    const group = slugToGroup[baseSlug] || (baseSlug === 'Relics' ? '其他' : baseSlug === 'Waystones' ? '引路石' : baseSlug === 'Jewels' ? '珠宝' : '未分组');
    // 中文名：主分类名 + 变体标注
    let cnName;
    if (v) cnName = (slugToGroup[baseSlug] || baseSlug) + '·' + v.label;
    else if (p.cnName && p.cnName !== slug) cnName = p.cnName;
    else cnName = group;
    // Relics 主页抓到的是无词缀列表页，跳过（用7个类型页）
    if (slug === 'Relics' || slug === 'Waystones' || slug === 'Jewels') {
      console.log(`SKIP ${slug} (主页无词缀JSON，由变体页替代)`);
      continue;
    }
    // 基底列表：从 data/bases/<主分类>.json 读取；变体页回退到主分类文件
    let bases = [];
    const baseFileCandidates = v ? [v.base, slug] : [slug];
    for (const bf of baseFileCandidates) {
      try {
        bases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bases', `${bf}.json`), 'utf-8')).bases || [];
        if (bases.length) break;
      } catch (_) { /* 无基底数据 */ }
    }
    categories.push({
      slug,
      baseSlug,
      variant: v ? v.label : null,
      cnName,
      group,
      affixGroups: p.affixGroups.map((g) => ({
        id: g.id,
        preSuf: g.preSuf,
        source: g.source,
        template: g.template,
        text: g.text,
        minIlvl: g.minIlvl,
        maxIlvl: g.maxIlvl,
        tierCount: g.tierCount,
        tiers: g.tiers.map((t) => ({ tier: t.tier, ilvl: t.ilvl, values: t.values })),
      })),
      bases: bases.map((b) => ({ slug: b.slug, name: b.name, level: b.level, img: b.img, props: b.props || {} })),
      socketable: (p.socketable || []).map((s) => ({
        preSuf: s.ModGenerationTypeID === 1 ? 'prefix' : s.ModGenerationTypeID === 2 ? 'suffix' : 'special',
        ilvl: Number(s.Level) || 0,
        text: (s.str || '').replace(/<span class="ndash">[^<]*<\/span>/g, '—').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        name: (s.Name || '').replace(/<[^>]+>/g, ''),
      })),
    });
  }
  const db = {
    version: '0.5',
    builtAt: new Date().toISOString(),
    sources: {
      base: { label: '基础', chip: '基', bg: '#F1EFE8', fg: '#444441' },
      desecrated: { label: '渎灵', chip: '渎', bg: '#EAF3DE', fg: '#27500A' },
      alloy: { label: '合金', chip: '金', bg: '#FAEEDA', fg: '#633806' },
      destruction: { label: '斯鲁德的神力', chip: '斯', bg: '#EEEDFE', fg: '#3C3489' },
      essence: { label: '精华', chip: '精', bg: '#E6F1FB', fg: '#0C447C' },
      corrupted: { label: '瓦尔腐化', chip: '瓦', bg: '#FCEBEB', fg: '#791F1F' },
    },
    categories,
  };
  fs.mkdirSync(path.join(EXT_DIR, 'data'), { recursive: true });
  const out = path.join(EXT_DIR, 'data', 'mods_db.json');
  fs.writeFileSync(out, JSON.stringify(db));
  console.log(`written ${out}`);
  console.log(`categories: ${categories.length}`);
  let total = 0;
  categories.forEach((c) => (total += c.affixGroups.length));
  console.log(`total affix groups: ${total}`);
  console.log(`file size: ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
}

main();
