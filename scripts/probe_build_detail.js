/* 探测 poe.ninja builds：
 * 1. 列表页（class 过滤）→ 提取单个构建的详情链接 + 行文本
 * 2. 检测是否存在 skill 过滤（流派维度的可行性）
 * 3. 打开首个构建详情页 → dump 全部文本（装备+词条是否可见）
 */
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

  // ---- 1. 列表页 ----
  console.log('[1] goto list:', LIST_URL);
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  // 提取构建详情链接（/poe2/builds/<league>/<id> 形态）
  const links = await page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href || '';
      const m = href.match(/\/poe2\/builds\/([a-z-]+)\/([^/?#]+)$/i);
      if (!m) return;
      if (!seen.has(href)) {
        seen.set(href, {
          href,
          text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        });
      }
    });
    return [...seen.values()];
  });
  fs.writeFileSync(path.join(OUT, 'build_links.json'), JSON.stringify(links, null, 1));
  console.log('[1] build detail links:', links.length);
  console.log(links.slice(0, 5).map((l) => '  ' + l.href + ' | ' + l.text.slice(0, 60)).join('\n'));

  // skill 过滤探测：页面里搜 skill 名是否有对应链接/下拉
  const skillProbe = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const hasSkillParam = /skill[=_]/i.test(html.slice(0, 2000000));
    const selects = [...document.querySelectorAll('select')].map((s) =>
      (s.getAttribute('aria-label') || s.name || s.id || '?') + ':' + s.options.length);
    return { hasSkillParam, selects };
  });
  console.log('[1] skill filter probe:', JSON.stringify(skillProbe));

  // ---- 2. 构建详情页 ----
  if (links.length) {
    const detail = links[0].href;
    console.log('[2] goto build detail:', detail);
    await page.goto(detail, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(9000);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(OUT, 'build_detail.txt'), text);
    console.log('[2] detail text length:', text.length);
    console.log('---- 详情页前 3000 字 ----');
    console.log(text.slice(0, 3000));
  }

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
