/** verify_clear_fill.js — E2E 验证「填表前清空市集已选状态」（v0.6.9）
 * 模拟市集页（data/tmp/market_mock.html）：折叠的状态过滤组 + mutate 已选标签×2 + 旧词缀块×2 + 旧基底标签×2。
 * 流程：stub chrome.runtime → 注入真实 content.js → postMessage 不通（content.js 走 runtime.onMessage），
 * 用 stub 的 onMessage 捕获监听器后手动派发 P2_FILL → 断言三路清理 + 新词缀填入 + 搜索点击。
 */
const path = require('path');
const { chromium } = require(path.join('C:\\Users\\yekok\\.workbuddy\\binaries\\node\\workspace\\node_modules', 'playwright-core'));

const EXE = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'http://127.0.0.1:8642/data/tmp/market_mock.html';
const CONTENT_JS = 'C:\\ai-work\\poe2搜索插件\\extension\\content.js';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const results = [];
  const ok = (name, cond, detail = '') =>
    results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  // 1) stub chrome.runtime（在 content.js 之前）
  await page.addInitScript(() => {
    window.__listeners = [];
    window.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn) => window.__listeners.push(fn),
        },
        getURL: (p) => p,
      },
    };
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.addScriptTag({ path: CONTENT_JS });
  await page.waitForTimeout(200);

  // 2) 初始状态盘点
  const before = await page.evaluate(() => ({
    mutateTags: document.querySelectorAll('#mutateSelect .multiselect__tag').length,
    baseTags: document.querySelectorAll('#baseSelect .multiselect__tag').length,
    blocks: [...document.querySelectorAll('#statGroup .filter-group-body > .filter')]
      .filter((p) => !p.classList.contains('filter-padded')).length,
    expanded: document.getElementById('statGroup').classList.contains('expanded'),
  }));
  ok('模拟页初始：mutate 标签=2', before.mutateTags === 2, String(before.mutateTags));
  ok('模拟页初始：基底标签=2', before.baseTags === 2, String(before.baseTags));
  ok('模拟页初始：旧词缀块=2', before.blocks === 2, String(before.blocks));
  ok('模拟页初始：状态过滤组折叠', before.expanded === false);

  // 3) 派发 P2_FILL（真实 content.js 监听器处理）
  const reply = await page.evaluate(() => new Promise((resolve) => {
    const payload = {
      category: '项链',
      base: '琥珀项链',
      affixes: [
        {
          groupId: 'implicit|+(10—15) 精魂', tier: null, minValue: 10, maxValue: 15,
          text: '+(10—15) 精魂', template: '+(10—15) 精魂', source: 'implicit',
          preSuf: 'implicit', statIds: ['implicit.stat_3981240776'],
          officialText: '# 精魂', statType: 'implicit',
        },
      ],
      extras: {},
      generatedAt: Date.now(),
    };
    let responded = false;
    for (const fn of window.__listeners) {
      const r = fn({ type: 'P2_FILL', payload }, {}, (resp) => {
        responded = true;
        resolve(resp);
      });
      if (r === true) continue; // async responder
    }
    setTimeout(() => { if (!responded) resolve(null); }, 25000);
  }));

  ok('P2_FILL 有响应', !!reply, reply ? `ok=${reply.ok}` : 'no response');
  if (reply) {
    const logText = (reply.log || []).join(' | ');
    ok('日志含已清状态标签', /已清除已选状态\s*2/.test(logText), logText);
    ok('日志含已清旧词缀块', /已清除旧词缀块\s*2/.test(logText), logText);
    ok('日志含已清旧基底', /已清除旧基底\s*2/.test(logText), logText);
    ok('清理日志先于填入日志（先清后填）',
      logText.indexOf('已清除') !== -1 && logText.indexOf('已清除') < logText.indexOf('✓'),
      logText.slice(0, 60));
    ok('日志含基底填入', /基底「琥珀项链」/.test(logText), logText);
    ok('日志含词缀填入成功', /精魂.*✓|✓.*精魂/.test(logText), logText);
    ok('日志含已点击搜索', /已点击搜索/.test(logText), logText);
    ok('无错误', (reply.errors || []).length === 0, (reply.errors || []).join('; '));
  }

  // 4) 清理后状态盘点
  const after = await page.evaluate(() => ({
    mutateTags: [...document.querySelectorAll('#mutateSelect .multiselect__tag')].map((t) => t.childNodes[0].textContent.trim()),
    baseTags: [...document.querySelectorAll('#baseSelect .multiselect__tag')].map((t) => t.childNodes[0].textContent.trim()),
    blocks: [...document.querySelectorAll('#statGroup .filter-group-body > .filter')]
      .filter((p) => !p.classList.contains('filter-padded')).length,
    expanded: document.getElementById('statGroup').classList.contains('expanded'),
    paddedKept: !!document.querySelector('#statGroup .filter-group-body > .filter.filter-padded'),
    searchClicked: window.__searchClicked || 0,
    blockMin: document.querySelector('#statGroup .filter:not(.filter-padded) input.minmax')?.value ?? null,
  }));
  ok('旧 mutate 标签已清空（新标签属本次填入）', !after.mutateTags.some((t) => t.includes('移动速度加快') || t.includes('命中率提高')), JSON.stringify(after.mutateTags));
  ok('基底标签仅剩新填的 1 个', after.baseTags.length === 1 && after.baseTags[0] === '琥珀项链', JSON.stringify(after.baseTags));
  ok('旧词缀块已清空 (2→0)', after.blocks === 1, `剩 ${after.blocks}（应为新填的 1 条）`);
  ok('折叠组被自动展开后清理', after.expanded === true);
  ok('添加下拉（filter-padded）保留', after.paddedKept === true);
  ok('搜索按钮被点击', after.searchClicked === 1, String(after.searchClicked));
  ok('新词缀块最小值=10', after.blockMin === '10', String(after.blockMin));

  await page.screenshot({ path: 'C:\\ai-work\\poe2搜索插件\\data\\tmp\\verify_clear_fill.png' });
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
