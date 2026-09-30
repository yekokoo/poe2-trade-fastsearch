/* 探测7：监听列表页+详情页的全部 XHR/fetch 响应，找含 PoB 码/构建数据的 JSON API */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const OUT = path.join(__dirname, '..', 'data', 'tmp');
const LIST_URL = 'https://poe.ninja/poe2/builds/forbiddenrites?class=Gemling+Legionnaire';
const DETAIL_URL = 'https://poe.ninja/poe2/builds/forbiddenrites/character/heygyus-0416/ResurrectForbidden?i=0';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });

  const hits = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('poe.ninja')) return;
      const ct = (res.headers()['content-type'] || '');
      if (!ct.includes('json')) return;
      const body = await res.text();
      const hasPob = /eNrt[A-Za-z0-9_\-]{200,}/.test(body);
      hits.push({ url: url.slice(0, 160), ct, len: body.length, hasPob });
      if (hasPob) {
        fs.writeFileSync(path.join(OUT, 'xhr_with_pob.json'), body);
        console.log('*** PoB 命中:', url.slice(0, 140), 'len=', body.length);
      } else if (body.length > 2000) {
        console.log('  JSON:', url.slice(0, 140), 'len=', body.length);
      }
    } catch (_) {}
  });

  console.log('== 列表页 ==');
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  console.log('== 详情页 ==');
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);

  fs.writeFileSync(path.join(OUT, 'xhr_summary.json'), JSON.stringify(hits, null, 1));
  console.log('JSON 响应总数:', hits.length);

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
