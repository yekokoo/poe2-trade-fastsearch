/**
 * build_base_name_map.js — Phase C 第②层：物品统一名称 ↔ poe2db 页面 1:1 映射表。
 *
 * 数据源：
 *   data/guofu_items.json  国服市集 items 全量（type=中文基底名, flags.unique, text）
 *   data/categories_map.json  分类 slug 清单
 *   poe2db 页面 slug 规则：中文基底名 → 英文 slug（Time-Lost_Sapphire / Sapphire / …）
 *
 * 产出 data/maps/base_name_map.json：
 * {
 *   builtAt, byType: { '失落的蓝玉': { slug:'Time_Lost_Sapphire', page:'https://poe2db.tw/cn/Time-Lost_Sapphire', unique:false, category:'Time_Lost_Sapphire' }, ... },
 *   uniques: { '抗衡黑暗 失落的宝钻': { base:'失落的宝钻', slug:'Time_Lost_Diamond' }, ... },
 *   stats: { types, uniques, mapped }
 * }
 * 运行：node scripts/build_base_name_map.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'maps', 'base_name_map.json');

/* 中文基底名 → poe2db 词缀页面 slug（1:1 权威映射，人工确认）。
 * 覆盖珠宝特例；通用规则：基底名 = 分类页抓取时 baseitem.cn / 卡片链接 slug。 */
const TYPE_TO_PAGE = {
  /* 珠宝（本次修复的核心） */
  '蓝玉': 'Sapphire', '红玉': 'Ruby', '翡翠': 'Emerald', '宝钻': 'Diamond',
  '失落的蓝玉': 'Time_Lost_Sapphire', '失落的红玉': 'Time_Lost_Ruby',
  '失落的翡翠': 'Time_Lost_Emerald', '失落的宝钻': 'Time_Lost_Diamond',
  '永恒珠宝': null, /* 军团机制珠宝，无随机词缀页 */
};

function main() {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'guofu_items.json'), 'utf8'));
  const byType = {};
  const uniques = {};
  let mapped = 0, pageMissing = 0;

  for (const g of items.result) {
    for (const e of g.entries) {
      const t = e.type;
      if (e.flags && e.flags.unique) {
        // 暗金：text =「名字 类型」→ 基底名 = type
        uniques[e.text || `${e.name} ${t}`] = { name: e.name, base: t, slug: TYPE_TO_PAGE[t] || null };
        continue;
      }
      if (!byType[t]) {
        const pageSlug = TYPE_TO_PAGE.hasOwnProperty(t) ? TYPE_TO_PAGE[t] : undefined;
        if (pageSlug === undefined) { pageMissing++; continue; } // 无词缀页/未知 → 不入映射（记录统计）
        byType[t] = {
          slug: pageSlug,
          page: pageSlug ? `https://poe2db.tw/cn/${pageSlug.replace(/_/g, '-')}` : null,
          raw: pageSlug ? `data/raw/${pageSlug}.json` : null,
          parsed: pageSlug ? `data/parsed/${pageSlug}.json` : null,
        };
        if (pageSlug) mapped++;
      }
    }
  }

  const out = {
    builtAt: new Date().toISOString(),
    rule: '市集中文基底名(type) ↔ poe2db 词缀页 slug 1:1；特殊映射见 TYPE_TO_PAGE（build_base_name_map.js）',
    byType, uniques,
    stats: { plainTypes: Object.keys(byType).length, mappedPages: mapped, noPage: pageMissing, uniques: Object.keys(uniques).length },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('已写', OUT);
  console.log('统计:', JSON.stringify(out.stats));
  console.log('珠宝映射检查:');
  for (const k of ['蓝玉', '失落的蓝玉', '红玉', '失落的红玉', '翡翠', '失落的翡翠', '宝钻', '失落的宝钻', '永恒珠宝']) {
    console.log('  ', k, '→', byType[k] ? byType[k].slug : '(不在 plain types)');
  }
}

main();
