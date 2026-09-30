#!/usr/bin/env node
/**
 * fetch_unique_map.js — 从 poe2db 分类页提取暗金「中文名|底材 → 英文slug」映射
 * 用法：node fetch_unique_map.js [--delay=500]
 * 输出：data/tmp/unique_name_map.json  { "军团的进击|粗制胫甲": "Legionstride", ... }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const args = process.argv.slice(2);
const delayMs = Number((args.find((a) => a.startsWith('--delay=')) || '--delay=500').split('=')[1]) || 500;

// 35 个分类页（含 Waystones/Jewels/Relics，跳过 Vault_Keys 无暗金）
const SLUGS = [
  'Claws', 'Daggers', 'Wands', 'One_Hand_Swords', 'One_Hand_Axes', 'One_Hand_Maces', 'Sceptres', 'Spears', 'Flails',
  'Bows', 'Staves', 'Two_Hand_Swords', 'Two_Hand_Axes', 'Two_Hand_Maces', 'Quarterstaves', 'Crossbows', 'Talismans',
  'Quivers', 'Shields', 'Bucklers', 'Foci',
  'Gloves', 'Boots', 'Body_Armours', 'Helmets',
  'Amulets', 'Rings', 'Belts',
  'Life_Flasks', 'Mana_Flasks', 'Charms',
  'Waystones', 'Jewels', 'Relics',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if (res.status === 429) {
        console.log('  429 rate-limited, wait 6s...');
        await sleep(6000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

/** 从分类页 HTML 提取 UniqueItem 卡片：英文slug → { name, type } */
function extractUniques(html) {
  const out = [];
  // 卡片主链接：<a class="UniqueItem" ... href="/cn/Slug"><span class="uniqueName">名</span> <span class="uniqueTypeLine">底材</span></a>
  const re = /class="UniqueItem"[^>]*href="\/cn\/([A-Za-z0-9_]+)"[^>]*><span class="uniqueName">([^<]+)<\/span> <span class="uniqueTypeLine">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ slug: m[1], name: m[2].trim(), type: m[3].trim() });
  }
  return out;
}

(async () => {
  const mapPath = path.join(ROOT, 'data', 'tmp', 'unique_name_map.json');
  const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
  let added = 0;
  for (const slug of SLUGS) {
    const url = `https://poe2db.tw/cn/${slug}`;
    process.stdout.write(`fetch ${slug} ... `);
    try {
      const html = await fetchText(url);
      const items = extractUniques(html);
      let n = 0;
      for (const it of items) {
        const key = `${it.name}|${it.type}`;
        if (!map[key]) { map[key] = it.slug; added++; }
        n++;
      }
      console.log(`${n} uniques (map total ${Object.keys(map).length})`);
    } catch (e) {
      console.log(`FAIL ${e.message}`);
    }
    await sleep(delayMs);
  }
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  console.log(`\nDone. unique pairs mapped: ${Object.keys(map).length} (+${added} new)`);
})();
