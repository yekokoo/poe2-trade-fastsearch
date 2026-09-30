#!/usr/bin/env node
/**
 * probe_index.js 探测 poe2db 物品大类索引页，找出全部分类 slug + 中文名
 */
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

(async () => {
  const candidates = ['Item_Classes', 'Maces', 'Two-Handed', 'Weapons', 'Armours', 'Jewellery', 'Accessories'];
  const outDir = path.join(__dirname, '..', 'data', 'probe');
  fs.mkdirSync(outDir, { recursive: true });
  for (const slug of candidates) {
    try {
      const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
      fs.writeFileSync(path.join(outDir, `${slug}.html`), html, 'utf-8');
      console.log(`OK  ${slug}  ${html.length} bytes`);
    } catch (e) {
      console.log(`ERR ${slug}  ${e.message}`);
    }
  }
})();
