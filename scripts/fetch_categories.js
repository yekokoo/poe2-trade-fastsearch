#!/usr/bin/env node
/**
 * fetch_categories.js
 * 抓取 https://poe2db.tw/cn/Items 全部分类链接 slug，输出：
 *   data/categories_raw.json  { slug, name }[] （按页面出现顺序）
 * 用法：node fetch_categories.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const ITEMS_URL = 'https://poe2db.tw/cn/Items';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractCategoryLinks(html) {
  // 页面分类卡片形如 <a class="itemClassBox" href="Two_Hand_Maces" title="双手锤">...
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+class="[^"]*itemClassBox[^"]*"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].split('#')[0].trim();
    const name = m[2].trim();
    if (slug && name && !seen.has(slug)) {
      seen.add(slug);
      out.push({ slug, name });
    }
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Fetching', ITEMS_URL);
  const html = await fetchText(ITEMS_URL);
  console.log('bytes:', html.length);
  let cats = extractCategoryLinks(html);
  if (cats.length === 0) {
    // 降级：抓所有指向分类页的链接（排除带#锚点和非词缀页）
    console.log('itemClassBox 未匹配，降级为全链接扫描');
    const re = /<a[^>]+href="([A-Za-z_]{3,})"[^>]*title="([^"]{2,})"/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(html))) {
      const slug = m[1].trim();
      if (!seen.has(slug)) {
        seen.add(slug);
        cats.push({ slug, name: m[2].trim() });
      }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'categories_raw.json'), JSON.stringify(cats, null, 2), 'utf-8');
  console.log('categories:', cats.length);
  cats.forEach((c) => console.log(`  ${c.slug.padEnd(24)} ${c.name}`));
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
