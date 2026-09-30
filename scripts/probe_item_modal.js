/* 探测4：
 * A. 点击 ITEMS 列表里的具体装备（The Taming）→ 是否弹词条分布面板
 * B. 构建详情页（character/...）→ 装备与词条文本是否可见
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const OUT = path.join(__dirname, '..', 'data', 'tmp');
const LIST_URL = 'https://poe.ninja/poe2/builds/forbiddenrites?class=Gemling+Legionnaire';
const DETAIL_URL = 'https://poe.ninja/poe2/builds/forbiddenrites/character/heygyus-0416/ResurrectForbidden?i=0&search=class%3DGemling%2BLegionnaire';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // ---- A. 点击 The Taming ----
  console.log('[A] goto list');
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  // 先切 Ring 过滤
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    for (const s of sels) {
      const opts = [...s.options];
      if (opts.some((o) => o.textContent.trim() === 'Ring') && opts.some((o) => o.textContent.trim() === 'Amulet')) {
        const rv = opts.find((o) => o.textContent.trim() === 'Ring');
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, rv.value);
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  await page.waitForTimeout(5000);

  // 找 The Taming 元素并点击
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')];
    for (const el of els) {
      if (el.children.length === 0 && el.textContent.trim() === 'The Taming') {
        el.click();
        return true;
      }
    }
    return false;
  });
  console.log('[A] clicked The Taming:', clicked);
  await page.waitForTimeout(4000);

  // 检查是否出现弹层/新内容（对比 body 文本变化 + 查找 modal）
  const modalText = await page.evaluate(() => {
    const modals = document.querySelectorAll('[class*="modal" i], [class*="popup" i], [class*="dialog" i], [class*="overlay" i], [class*="tooltip" i]');
    const vis = [...modals].filter((m) => {
      const st = getComputedStyle(m);
      return st.display !== 'none' && st.visibility !== 'hidden' && m.innerText && m.innerText.trim().length > 20;
    });
    return vis.map((m) => m.innerText.slice(0, 1200));
  });
  fs.writeFileSync(path.join(OUT, 'item_click_modal.txt'), JSON.stringify(modalText, null, 1));
  console.log('[A] 可见弹层数:', modalText.length);
  modalText.forEach((t, i) => console.log(`---- 弹层${i} ----\n${t.slice(0, 800)}`));

  // ---- B. 构建详情页 ----
  console.log('[B] goto detail');
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const dt = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, 'build_detail.txt'), dt);
  console.log('[B] 详情页文本长度:', dt.length);
  // 打印关键段：装备相关
  const iRing = dt.search(/Ring|rings/i);
  console.log('---- 详情页前 2200 字 ----');
  console.log(dt.slice(0, 2200));

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
