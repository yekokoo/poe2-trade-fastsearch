/* 探测3b：ITEMS 区选 Ring → 页面导航后抓装备排名文本 */
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

  // 选中 Ring（会触发导航），监听新页面加载
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    for (const s of sels) {
      const opts = [...s.options];
      if (opts.some((o) => o.textContent.trim() === 'Ring') && opts.some((o) => o.textContent.trim() === 'Amulet')) {
        const rv = opts.find((o) => o.textContent.trim() === 'Ring');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(s, rv.value);
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  // 等导航 + 渲染
  await page.waitForTimeout(10000);
  console.log('导航后 URL:', page.url());

  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, 'build_list_ring.txt'), text);
  const i = text.indexOf('ITEMS');
  console.log('---- Ring 过滤后 ITEMS 区文本 ----');
  console.log(text.slice(i === -1 ? 0 : i, (i === -1 ? 0 : i) + 2200));

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
