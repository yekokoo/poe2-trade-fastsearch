#!/usr/bin/env node
/** fetch_base_panels.js — 批量抓 poe2db 基底详情页 → data/base_panels.json（增量）
 *
 * 背景：base_panels.json（{poe2dbSlug: {name, props:{req, implicit}}}）原为一次性会话产物。
 *       popup 基底下拉的等级/固有词缀展示依赖它；新增基底缺失面板只影响展示不影响对齐。
 * 本脚本做增量补抓：data/bases/*.json 里出现但 base_panels 缺失的 slug 才抓（限速 500ms）。
 * 解析（poe2db 详情页 .newItemPopup）：itemName / requirements 文本 / implicitMod。
 * 运行：node scripts/fetch_base_panels.js [--force]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'base_panels.json');
const BASES_DIR = path.join(ROOT, 'data', 'bases');
const FORCE = process.argv.includes('--force');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0', 'Accept-Language': 'zh-CN,zh;q=0.9' };

function fetchPage(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, { headers: UA, timeout: 25000 }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 429 && n < retries) return setTimeout(() => attempt(n + 1), 5000);
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          resolve(d);
        });
      });
      req.on('timeout', () => { req.destroy(); if (n < retries) setTimeout(() => attempt(n + 1), 2000); else reject(new Error('timeout')); });
      req.on('error', (e) => { if (n < retries) setTimeout(() => attempt(n + 1), 2000); else reject(e); });
    };
    attempt(0);
  });
}

const strip = (h) => String(h)
  .replace(/<span class="ndash">[^<]*<\/span>/g, '—')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function parsePanel(html) {
  const i = html.indexOf('newItemPopup');
  if (i < 0) return null;
  // 面板终点：implicitMod/explicitMod/enchantMod 任一之后，或截 8000 字符兜底
  const modI = ['implicitMod', 'explicitMod', 'enchantMod'].map((k) => html.indexOf(k, i)).filter((x) => x > 0);
  const endI = modI.length ? Math.min(...modI) : -1;
  const panel = html.slice(i, endI > 0 ? html.indexOf('</div>', endI) + 6 : i + 8000);
  // name 可能在 itemName 或其内层 span.lc
  let name = strip((panel.match(/itemName[^>]*>([\s\S]*?)</) || [])[1] || '');
  if (!name) name = strip((panel.match(/itemName[\s\S]*?class="lc">([^<]*)</) || [])[1] || '');
  const reqM = panel.match(/requirements"([\s\S]*?)(?:separator|<\/div)/);
  const req = reqM ? strip(reqM[1]) : '';
  const impM = panel.match(/implicitMod"([\s\S]*?)<\/div/);
  const implicit = impM ? strip(impM[1]) : '';
  return { name, props: { req, implicit } };
}

(async () => {
  const panels = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  // 收集全部 bases 文件里的 slug
  const slugs = new Set();
  for (const f of fs.readdirSync(BASES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(BASES_DIR, f), 'utf8'));
    for (const b of j.bases || []) if (b.slug) slugs.add(b.slug);
  }
  const missing = FORCE ? [...slugs] : [...slugs].filter((s) => !panels[s]);
  console.log(`基底总数 ${slugs.size}，待抓面板 ${missing.length}`);
  let ok = 0, fail = 0;
  const failures = [];
  for (let i = 0; i < missing.length; i++) {
    const slug = missing[i];
    process.stdout.write(`[${i + 1}/${missing.length}] ${slug} ... `);
    try {
      const html = await fetchPage(`https://poe2db.tw/cn/${slug}`);
      const p = parsePanel(html);
      if (p && p.name) { panels[slug] = p; ok++; console.log('OK ' + p.name); }
      else { fail++; failures.push(slug); console.log('NO PANEL'); }
    } catch (e) { fail++; failures.push(slug); console.log('FAIL ' + e.message); }
    if ((i + 1) % 20 === 0) fs.writeFileSync(OUT, JSON.stringify(panels), 'utf-8'); // 断点保存
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.writeFileSync(OUT, JSON.stringify(panels), 'utf-8');
  console.log(`完成：新增 ${ok} / 失败 ${fail}，总面板 ${Object.keys(panels).length}`);
  if (failures.length) console.log('失败清单:', failures.slice(0, 20).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
