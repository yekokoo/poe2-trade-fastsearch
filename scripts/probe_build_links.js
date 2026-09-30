/* 探测2：builds 列表行的链接形态与行文本结构 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const OUT = path.join(__dirname, '..', 'data', 'tmp');
const LIST_URL = 'https://poe.ninja/poe2/builds/forbiddenrites?class=Gemling+Legionnaire';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  // 收集页面上全部链接形态
  const allLinks = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href;
      if (href.startsWith('https://poe.ninja')) out.push(href);
    });
    return [...new Set(out)];
  });
  fs.writeFileSync(path.join(OUT, 'all_links.json'), JSON.stringify(allLinks, null, 1));
  console.log('poe.ninja 链接数:', allLinks.length);
  console.log(allLinks.slice(0, 40).join('\n'));

  // 行文本
  const rows = await page.evaluate(() => {
    const t = document.body.innerText;
    return t;
  });
  fs.writeFileSync(path.join(OUT, 'build_list_text.txt'), rows);
  console.log('---- 列表页文本前 2500 字 ----');
  console.log(rows.slice(0, 2500));

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
