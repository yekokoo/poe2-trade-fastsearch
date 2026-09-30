/* 探测5：构建详情页 Equipment 区 DOM 原文 —— 词条文本藏在哪 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const OUT = path.join(__dirname, '..', 'data', 'tmp');
const DETAIL_URL = 'https://poe.ninja/poe2/builds/forbiddenrites/character/heygyus-0416/ResurrectForbidden?i=0&search=class%3DGemling%2BLegionnaire';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  // 找 Equipment 区块的 HTML
  const html = await page.evaluate(() => {
    // 找包含 "Equipment" 标题的元素，取其父级区块
    const els = [...document.querySelectorAll('*')];
    let node = null;
    for (const el of els) {
      if (el.children.length === 0 && el.textContent.trim() === 'Equipment') { node = el; break; }
    }
    if (!node) return { found: false };
    // 向上找 3 层作为区块
    let box = node;
    for (let i = 0; i < 3 && box.parentElement; i++) box = box.parentElement;
    return { found: true, html: box.outerHTML.slice(0, 60000) };
  });
  fs.writeFileSync(path.join(OUT, 'equipment_html.txt'), html.html || String(html));
  console.log('found:', html.found, 'len:', (html.html || '').length);
  if (html.found) console.log(html.html.slice(0, 5000));

  // 悬停第一个装备卡片，看 tooltip 是否出现
  const hoverProbe = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')];
    for (const el of els) {
      if (el.children.length === 0 && el.textContent.trim() === 'Trade') {
        return el.closest('div') ? el.closest('div').parentElement.outerHTML.slice(0, 3000) : null;
      }
    }
    return null;
  });
  console.log('---- Trade 按钮附近 HTML ----');
  console.log(hoverProbe || '(null)');

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
