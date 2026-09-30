// verify_wysiwyc.js — 所见即所填验证：暗金下拉文本（去◆前缀）与选中后 payload.base 严格一致
const path = require('path');
const { chromium } = require(path.join('C:\\Users\\yekok\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node_modules', 'playwright-core'));
const EXE = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const PAGE = 'http://127.0.0.1:8642/demo_%E6%96%B0%E7%95%8C%E9%9D%A2.html';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(PAGE, { waitUntil: 'load' });
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('#groupTabs .tab', { timeout: 15000 });

  // 拦截 P2_FILL 消息，抓 payload
  // P2_FILL 是 popup.js 发给 window.parent（外层 demo_新界面.html），监听要挂在外层 page
  await page.evaluate(() => {
    window.__p2fills = [];
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'P2_FILL') window.__p2fills.push(e.data.payload);
    });
  });

  const results = [];
  const ok = (name, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  // 护甲 → 手套 → 选第一个暗金
  await frame.evaluate(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '护甲').click());
  await frame.waitForTimeout(300);
  const pick = await frame.evaluate(() => {
    const sel = document.querySelector('#baseSel');
    const u = [...sel.querySelectorAll('option.unique-opt')][0];
    return { shown: u.textContent, value: u.value };
  });
  ok('暗金选项带◆前缀', pick.shown.startsWith('◆'), pick.shown);
  await frame.evaluate(() => {
    const sel = document.querySelector('#baseSel');
    const u = [...sel.querySelectorAll('option.unique-opt')][0];
    sel.value = u.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await frame.waitForTimeout(200);
  // v0.6.0：锁定提示已改为词条分块；v0.6.3：基底（固有）/词条 分块渲染
  // （有固有词缀的暗金会出现「基底（固有）」块；纯 explicit 词条的暗金只有「词条」块）
  const lock = await frame.evaluate(() => {
    const titles = [...document.querySelectorAll('#affixBlocks .filter-block .filter-title')].map((t) => t.textContent);
    const names = [...document.querySelectorAll('#affixBlocks .u-mod-name')].map((x) => x.textContent);
    return { titles, names };
  });
  ok('选中暗金出现词条分块（基底暗金含「基底（固有）」块）',
    lock.titles.some((t) => t.includes('◆ 词条')) && lock.names.length > 0, lock.titles.join(' | '));
  ok('阿兹里的捷思自动带出词条行', lock.names.length >= 5, 'rows=' + lock.names.length + ' · 首行=' + (lock.names[0] || ''));
  // 点填入 → payload.base 应与选项 value 一致
  await frame.evaluate(() => document.querySelector('#goBtn').click());
  await frame.waitForTimeout(200);
  const fills = await page.evaluate(() => window.__p2fills || []);
  ok('payload.base 与下拉文本严格一致', fills.length === 1 && fills[0].base === pick.shown.replace('◆ ', ''),
    `shown="${pick.shown.replace('◆ ', '')}" base="${fills[0]?.base}"`);
  // v0.6.0：暗金 payload 携带可筛固定词条（数值留空）
  const uAff = fills[0]?.affixes || [];
  ok('暗金 payload 带可筛词条（uniqueMod 标记）', uAff.length > 0 && uAff.every((a) => a.uniqueMod === true),
    'affixes=' + uAff.length);
  ok('词条数值默认留空', uAff.every((a) => a.minValue == null && a.maxValue == null));

  // 切换一个符文师匠变体（多字类型）再验一次：长杖分类
  await frame.evaluate(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '双手武器').click());
  await frame.waitForTimeout(200);
  const staff = await frame.evaluate(() => [...document.querySelectorAll('#catTabs .tab')].map((t) => t.textContent));
  ok('双手武器 tab 存在', staff.length > 0, staff.join('/'));
  // 选长杖（ Quarterstaves 在单手武器？检查——Quarterstaves 是双手武器组？直接找含暗金的分类）
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
