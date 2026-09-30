/* 用 playwright-core + 已装 Chrome 抓取 poe.ninja builds 页面渲染后的 DOM 数据 */
const { chromium } = require('playwright-core');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'https://poe.ninja/poe2/builds/forbiddenrites?class=Gemling+Legionnaire';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  // 记录 search API 响应（网络层截获，绕过 protobuf 解析的不确定性——看看真实请求）
  const apiCalls = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/')) apiCalls.push(u);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log('=== API calls ===');
  [...new Set(apiCalls)].slice(0, 20).forEach((u) => console.log(u));

  // 页面标题与主要文本
  const title = await page.title();
  console.log('\ntitle:', title);

  // 抓取 filter 面板中 items 维度（如果渲染了）
  const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('\n=== body text head ===');
  console.log(text);

  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
