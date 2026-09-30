/** verify_fallback_fill.js — E2E 验证 v0.8.2 兜底探测填表（playwright-core + market_mock）
 * 场景：payload officialText 是市集不存在的旧措辞 → 首搜未命中 → searchPickFallback
 *       生成候选词重搜 + LCS 相关性选优，命中市集真名。
 * 用例：
 *   1. 「该装备的攻击暴击率提高 #%」→ 应选中「攻击暴击率提高 #%」
 *   2. 「该装备的攻击速度提高 #%」→ 应选中「攻击速度加快 #% (区域)」（mock 只有区域变体，宁多不少）
 *   3. 正常文本「命中率提高 #%」不受兜底影响，仍精确命中
 */
const path = require('path');
const { chromium } = require(path.join('C:\\Users\\yekok\\.workbuddy\\binaries\\node\\workspace\\node_modules', 'playwright-core'));

const EXE = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'http://127.0.0.1:8642/data/tmp/market_mock.html';
const CONTENT_JS = 'C:\\ai-work\\poe2搜索插件\\extension\\content.js';

function mkAffix(text, preSuf) {
  return {
    groupId: preSuf + '|' + text, tier: null, minValue: null, maxValue: null,
    text, template: text, source: 'base', preSuf, slug: 'Rings',
    statIds: ['explicit.stat_1'], officialText: text, statType: 'explicit', tierRange: null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const results = [];
  const ok = (name, cond, detail = '') =>
    results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.addInitScript(() => {
    window.__listeners = [];
    window.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => window.__listeners.push(fn) },
        getURL: (p) => p,
      },
    };
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.addScriptTag({ path: CONTENT_JS });
  await page.waitForTimeout(400);

  // 捕获 toast 内容（content.js showToast → #p2ss-toast，6 秒后移除）
  const toastText = () => page.evaluate(() => {
    const t = document.querySelector('#p2ss-toast');
    return t ? t.innerText : '';
  });
  void toastText;

  // 用例 1+2：旧措辞词条（前缀组）。用例 3：正常文本（后缀组，触发追加「与」组）
  const payload = {
    category: '戒指', categorySlug: 'Rings', base: '琥珀项链',
    affixes: [
      mkAffix('该装备的攻击暴击率提高 #%', 'prefix'),
      mkAffix('该装备的攻击速度提高 #%', 'prefix'),
      mkAffix('命中率提高 #%', 'suffix'),
    ],
    extras: {},
    generatedAt: Date.now(),
  };
  await page.evaluate((p) => {
    window.__listeners.forEach((fn) => fn({ type: 'P2_FILL', payload: p }, {}, () => {}));
  }, payload);

  // 轮询等 toast 出现（填表链路约 6~10 秒：3 词条 × 搜索/等待/关下拉 + 幂等清理）
  let toast = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => {
      const el = document.querySelector('#p2ss-toast');
      return el ? el.innerText : '';
    });
    if (t) { toast = t; break; }
  }
  const clean = toast.replace(/\n/g, ' / ');
  ok('兜底：暴击率旧措辞命中真名', toast.includes('攻击暴击率提高 #% ✓（前缀）'), clean.slice(0, 260));
  ok('兜底：攻击速度旧措辞命中', toast.includes('攻击速度提高 #% ✓（前缀）'), '');
  ok('正常文本不受影响', toast.includes('命中率提高 #% ✓（后缀）'), '');
  ok('无未命中/无找不到错误', !toast.includes('下拉未命中') && !toast.includes('未找到'), '');

  // 词缀块标题断言：前缀组应有暴击率真名块 + 攻速（区域）块；「与」组应有命中率块
  const blocks = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.filter-group')];
    return groups.map((g) => [...g.querySelectorAll('.filter-group-body > .filter:not(.filter-padded)')]
      .map((b) => b.dataset.title || (b.querySelector('.filter-title') || {}).textContent || ''));
  });
  const flat = blocks.flat().join(' | ');
  ok('前缀组：暴击率真名块', flat.includes('攻击暴击率提高 #%'), flat.slice(0, 200));
  ok('前缀组：攻击速度块（区域变体可）', /攻击速度加快/.test(flat), '');
  ok('后缀组：命中率块在追加组', (blocks[1] || []).some((t) => t.includes('命中率提高 #%')), JSON.stringify(blocks));

  // 已选 tags 断言
  const tags = await page.evaluate(() => [...document.querySelectorAll('.multiselect__tag')]
    .map((x) => x.textContent.trim()).join(' | '));
  ok('tags 已选 3 项新词缀', (tags.match(/攻击暴击率提高|攻击速度加快|命中率提高 #%/g) || []).length >= 3, tags);

  await page.screenshot({ path: 'data/tmp/verify_fallback.png', fullPage: false });
  console.log(results.join('\n'));
  await browser.close();
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
