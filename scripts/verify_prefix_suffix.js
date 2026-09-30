/** verify_prefix_suffix.js — E2E 验证前缀/后缀分两组填表（v0.7.1）
 * 模拟市集页（data/tmp/market_mock.html）：
 *   payload = 1 前缀词条 + 2 后缀词条 + 1 无分组（暗金 implicit）
 * 断言：前缀+无分组进「状态过滤」组；后缀触发追加「与」组并填入新组；
 *       二次填入时「与」组被清空移除（幂等）。
 */
const path = require('path');
const { chromium } = require(path.join('C:\\Users\\yekok\\.workbuddy\\binaries\\node\\workspace\\node_modules', 'playwright-core'));

const EXE = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'http://127.0.0.1:8642/data/tmp/market_mock.html';
const CONTENT_JS = 'C:\\ai-work\\poe2搜索插件\\extension\\content.js';

function mkAffix(text, preSuf, min, max) {
  return {
    groupId: 'suffix|' + text, tier: null, minValue: min == null ? null : min, maxValue: max == null ? null : max,
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
  await page.waitForTimeout(200);

  // payload：1 前缀（护甲提高）+ 2 后缀（命中率/生命回复，mock 选项池里有）+ 无 preSuf（暗金式）
  const payload = {
    category: '戒指',
    base: null,
    affixes: [
      mkAffix('# 精魂', 'implicit', 10, 15),
      mkAffix('命中率提高 #%', 'suffix', 100, null),
      mkAffix('生命回复提高 #%', 'suffix', null, 50),
    ],
    extras: {},
    generatedAt: Date.now(),
  };

  const reply = await page.evaluate((pl) => new Promise((resolve) => {
    let responded = false;
    for (const fn of window.__listeners) {
      const r = fn({ type: 'P2_FILL', payload: pl }, {}, (resp) => { responded = true; resolve(resp); });
      if (r === true) continue;
    }
    setTimeout(() => { if (!responded) resolve(null); }, 30000);
  }), payload);

  ok('P2_FILL 有响应', !!reply, reply ? `ok=${reply.ok}` : 'no response');
  if (reply) {
    const logText = (reply.log || []).join(' | ');
    const errText = (reply.errors || []).join(' | ');
    ok('前缀词条填入组1', /精魂.*（前缀）/.test(logText), logText);
    ok('后缀词条1填入', /命中率提高.*✓/.test(logText), logText);
    ok('后缀词条2填入', /生命回复提高.*✓/.test(logText), logText);
    ok('无错误', (reply.errors || []).length === 0, errText);
  }

  // DOM 断言：两个组，后缀在新「与」组
  const dom = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.trim() === '与');
    });
    const groupInfo = groups.map((g) => ({
      title: g.querySelector('.filter-group-header .filter-title')?.textContent.trim(),
      blocks: [...g.querySelectorAll('.filter-group-body > .filter')]
        .filter((p) => !p.classList.contains('filter-padded'))
        .map((p) => p.querySelector('.filter-title')?.textContent.trim()),
    }));
    return { nGroups: groups.length, groupInfo };
  });
  ok('共 2 个状态组', dom.nGroups === 2, JSON.stringify(dom.groupInfo));
  ok('组1=状态过滤 含 精魂', dom.groupInfo[0] && dom.groupInfo[0].title === '状态过滤' &&
    dom.groupInfo[0].blocks.some((b) => b.includes('精魂')), JSON.stringify(dom.groupInfo[0]));
  ok('组2=与 含 2 条后缀', dom.groupInfo[1] && dom.groupInfo[1].title === '与' &&
    dom.groupInfo[1].blocks.length === 2, JSON.stringify(dom.groupInfo[1]));

  // 幂等：再次填入（只 1 条前缀）→ 旧「与」组应被移除
  const payload2 = {
    category: '戒指', base: null,
    affixes: [mkAffix('# 精魂', 'implicit', 12, null)],
    extras: {}, generatedAt: Date.now(),
  };
  const reply2 = await page.evaluate((pl) => new Promise((resolve) => {
    let responded = false;
    for (const fn of window.__listeners) {
      const r = fn({ type: 'P2_FILL', payload: pl }, {}, (resp) => { responded = true; resolve(resp); });
      if (r === true) continue;
    }
    setTimeout(() => { if (!responded) resolve(null); }, 30000);
  }), payload2);
  ok('二次填入有响应', !!reply2, reply2 ? `ok=${reply2.ok}` : '');
  const dom2 = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.trim() === '与');
    });
    return groups.map((g) => g.querySelector('.filter-group-header .filter-title')?.textContent.trim());
  });
  ok('二次填入后只剩 1 组（旧「与」组已移除）', dom2.length === 1 && dom2[0] === '状态过滤', JSON.stringify(dom2));

  await page.screenshot({ path: 'C:\\ai-work\\poe2搜索插件\\data\\tmp\\verify_prefix_suffix.png' });
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
