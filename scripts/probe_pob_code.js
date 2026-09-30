/* 探测6：提取构建详情页 PoB 导入码 → 解码验证 XML 内容（装备+词条） */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

  const code = await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label*="Import code"]');
    return inp ? inp.value : null;
  });
  console.log('PoB code 长度:', code ? code.length : 0);
  if (!code) { console.log('未找到导入码'); await browser.close(); return; }

  // PoB 码：URL-safe base64 → zlib inflate
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const xml = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
  fs.writeFileSync(path.join(OUT, 'pob_sample.xml'), xml);
  console.log('XML 解压长度:', xml.length);

  // 提取 Items 段样本
  const m = xml.match(/<Items[\s\S]{0,400}/);
  console.log('---- XML 头 600 字 ----');
  console.log(xml.slice(0, 600));
  if (m) {
    console.log('---- <Items> 开头 ----');
    console.log(m[0]);
  }
  // 统计 Item 节点
  const items = xml.match(/<Item /g);
  console.log('Item 节点数:', items ? items.length : 0);

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
