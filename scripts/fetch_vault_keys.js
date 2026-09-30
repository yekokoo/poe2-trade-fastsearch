#!/usr/bin/env node
/** 抓宝库钥匙基底（该页无词缀JSON，仅基底卡片） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

(async () => {
  const res = await fetch('https://poe2db.tw/cn/Vault_Keys', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  const html = await res.text();
  const bases = [];
  const seen = new Set();
  const re = /<a class="whiteitem ([A-Za-z_ ]+)" data-hover="[^"]*" href="([A-Za-z_][A-Za-z0-9_]*)">([^<]{1,40})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    bases.push({ slug: m[2], name: m[3].trim() });
  }
  fs.mkdirSync(path.join(ROOT, 'data', 'bases'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'data', 'bases', 'Vault_Keys.json'),
    JSON.stringify({ slug: 'Vault_Keys', cnName: '宝库钥匙', fetchedAt: new Date().toISOString(), bases }, null, 1),
    'utf-8'
  );
  console.log('Vault_Keys bases:', bases.length, bases.map((b) => b.name).join(', '));
})();
