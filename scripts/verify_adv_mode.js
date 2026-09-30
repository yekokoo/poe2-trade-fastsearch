/** verify_adv_mode.js — E2E 验证进阶模式 UI（playwright-core）
 * 打开 demo_新界面.html → 切进阶 → 选职业/升华/部位 → 点亮 chips → 截图 + payload 拦截
 * v0.8：去掉流派步骤；装备/词条来自天梯前 10 构建归类
 * v0.8.1：词条全量展示 + 灰显参考词条（filterable=false 带「参」标）；断言灰显 chip 渲染
 */
const { chromium } = require('C:/Users/yekok/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'file:///C:/ai-work/poe2%E6%90%9C%E7%B4%A2%E6%8F%92%E4%BB%B6/demo_%E6%96%B0%E7%95%8C%E9%9D%A2.html';

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const results = [];
  const ok = (name, cond, extra = '') => {
    results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  };

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  const frame = page.frameLocator('iframe');
  await frame.locator('#groupTabs .tab').first().waitFor({ timeout: 10000 });
  ok('经典模式加载', (await frame.locator('#groupTabs .tab').count()) > 0);

  // 切进阶
  await frame.locator('#modeSwitch span[data-mode="adv"]').click();
  await page.waitForTimeout(600);
  ok('进阶面板显示', await frame.locator('#advRoot.show').count() === 1);
  ok('① 职业 tabs', (await frame.locator('#advClassStep .tab').count()) === 7,
    (await frame.locator('#advClassStep .tab').allTextContents()).join(','));

  // 选佣兵（tab 文本就是「佣兵」，click 按精确文本匹配）
  await frame.locator('#advClassStep .tab', { hasText: '佣兵' }).click();
  await page.waitForTimeout(400);
  ok('② 升华 tabs（佣兵 2 个）', (await frame.locator('#advAscStep .tab').count()) === 2,
    (await frame.locator('#advAscStep .tab').allTextContents()).join(' | '));

  // 选宝石军团士兵 → 部位选戒指（v0.8 无流派步骤，升华后直接是装备类型）
  await frame.locator('#advAscStep .tab', { hasText: '宝石军团士兵' }).click();
  await page.waitForTimeout(400);
  ok('无流派步骤', (await frame.locator('#advSkillStep').count()) === 0);

  await frame.locator('#advSlotStep .tab', { hasText: '戒指' }).click();
  await page.waitForTimeout(400);
  const itemChips = await frame.locator('#advPickStep .chip').allTextContents();
  ok('④ 装备 chips 渲染', itemChips.length > 5, itemChips.slice(0, 5).join(' | '));

  // 切到武器部位：词条最多 + 必有灰显参考词条（filterable=false 带「参」标）
  await frame.locator('#advSlotStep .tab', { hasText: '武器' }).click();
  await page.waitForTimeout(400);
  const refChips = await frame.locator('#advPickStep .chip.ref').count();
  ok('灰显参考词条渲染（武器）', refChips > 0, refChips + ' 条 chip.ref');

  // 点亮第一个装备 chip
  await frame.locator('#advPickStep .chip').first().click();
  await page.waitForTimeout(200);
  // 点亮一个可筛词条 chip——词条 chips 是独立的 .chips 容器（渲染在装备 chips 之后）
  const modLabelLoc = frame.locator('#advPickStep .adv-label', { hasText: '词条热度' });
  if (await modLabelLoc.count()) {
    // .chips 容器顺序：[装备, 词条]；词条容器 = 跟在词条 label 后的那个
    const containers = frame.locator('#advPickStep .chips');
    const nContainers = await containers.count();
    // 依次试每个容器：点击后若出现 .mod-vals 则是词条容器（点装备不会出现数值行）
    let clicked = false;
    for (let ci = nContainers - 1; ci >= 1 && !clicked; ci--) {
      // 跳过灰显参考词条（不可筛，点亮也不填表）
      const chips = containers.nth(ci).locator('.chip:not(.ref)');
      if (!(await chips.count())) continue;
      await chips.first().click();
      await page.waitForTimeout(250);
      if (await frame.locator('.mod-vals').count() === 1) clicked = true;
      else await chips.first().click(); // 撤销
    }
    ok('词条点亮出现数值行', clicked);
    if (clicked) await frame.locator('.mod-vals input').first().fill('50');
  }
  ok('goBtn 解锁', await frame.locator('#goBtn:not([disabled])').count() === 1);

  // 拦截 postMessage payload：popup 的 parent 是 demo 外框，消息发到 window.parent（外框）。
  // 先挂监听再点击（点击后 message 立即发出，事后挂监听会错过）
  await page.evaluate(() => new Promise((resolve) => {
    window.__p2msgs = [];
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'P2_FILL') window.__p2msgs.push(e.data.payload);
    });
    resolve(true);
  }));
  await frame.locator('#goBtn').click();
  await page.waitForTimeout(500);
  const payload = await page.evaluate(() => (window.__p2msgs || [null])[0]);
  ok('P2_FILL payload 发出', !!payload, payload ? JSON.stringify(payload).slice(0, 220) : '');
  if (payload) {
    ok('payload.category 正确', !!payload.category, payload.category);
    ok('payload.affixes 非空', payload.affixes.length > 0, payload.affixes.length + ' 条');
    ok('payload.base 带出', !!payload.base, String(payload.base));
  }

  // 截图存档
  await page.screenshot({ path: 'data/tmp/verify_adv_mode.png', fullPage: false });
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
