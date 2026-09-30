/* 完整抓取 ninja builds 页面渲染后的结构化数据：
   1. 全部维度文本（ITEMS/SKILLS/...）
   2. 点击 ITEMS 里的具体类别（Helmet）后看变化
   3. 检查有无词条(mods)数据 */
const { chromium } = require('playwright-core');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'https://poe.ninja/poe2/builds/forbiddenrites?class=Gemling+Legionnaire';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    viewport: { width: 1440, height: 2400 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const full = await page.evaluate(() => document.body.innerText);
  // 找 ITEMS 段到页面尾
  const iItems = full.indexOf('ITEMS');
  console.log('=== from ITEMS to tail ===');
  console.log(full.slice(iItems, iItems + 6000));

  // 检查是否存在 keystone/mechanics 段
  for (const kw of ['KEYSTONES', 'MECHANICS', 'PASSIVE', 'ATLAS', 'MODS', 'AFFIX']) {
    console.log(kw, '@', full.indexOf(kw));
  }

  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
