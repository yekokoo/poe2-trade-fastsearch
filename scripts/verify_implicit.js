/** verify_implicit.js — E2E 验证「基底」块（任务 #34 / v0.6.7）
 * 检查：
 *  1. 饰品（有固有词缀）：「基底」块出现在「前缀」之前
 *  2. 基底块行结构完整：词缀下拉 + 最小/最大值输入可填
 *  3. 基底下拉选项分组标签=「基底（固有）」
 *  4. 无固有词缀分类（单手剑）：不显示「基底」空块
 *  5. 填表 payload：statType=implicit/skill、statIds 官方 id、min/max 正确
 *  6. 手套（合并视图）：基底块显示且词缀数 > 0
 */
const path = require('path');
const { chromium } = require(path.join('C:\\Users\\yekok\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node_modules', 'playwright-core'));

const EXE = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const URL = 'http://127.0.0.1:8642/demo_%E6%96%B0%E7%95%8C%E9%9D%A2.html';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const results = [];
  const ok = (name, cond, detail = '') =>
    results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto(URL, { waitUntil: 'load' });
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('#groupTabs .tab', { timeout: 15000 });
  const F = (fn) => frame.evaluate(fn);

  // ---- 1. 饰品：基底块在最前 ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '饰品').click());
  await frame.waitForTimeout(250);
  const titles = await F(() =>
    [...document.querySelectorAll('.filter-block-header .filter-title')].map((t) => t.textContent.replace(/\(\d+\)/, '')));
  ok('饰品块序=基底→前缀→后缀(→瓦尔/特殊如有)',
    titles[0] === '基底' && titles[1] === '前缀' && titles[2] === '后缀', titles.join('/'));

  // ---- 2. 基底块加行 → 词缀下拉 + 数值框 + T级灰显 ----
  await F(() => document.querySelector('.filter-block .add-filter-btn').click());
  await frame.waitForTimeout(150);
  const row = await F(() => {
    const blk = document.querySelector('.filter-block.implicit-block') ||
      document.querySelectorAll('.filter-block')[0];
    const sel = blk.querySelector('.affix-sel');
    const nums = blk.querySelectorAll('input[type=number]');
    const tsel = blk.querySelector('.tier-sel');
    return {
      hasSel: !!sel,
      hasMinMax: nums.length >= 2,
      groupLabel: sel.querySelector('optgroup')?.label || '',
      optCount: sel.querySelectorAll('option').length,
      firstOpt: sel.querySelector('optgroup option')?.textContent || '',
      tierDisabled: tsel ? tsel.disabled : null,
      tierOpacity: tsel ? getComputedStyle(tsel).opacity : '',
    };
  });
  ok('基底块行有词缀下拉', row.hasSel === true);
  ok('基底块行有最小/最大值输入', row.hasMinMax === true);
  ok('基底下拉分组=基底（固有）', row.groupLabel === '基底（固有）', row.groupLabel);
  ok('基底下拉有选项', row.optCount > 1, `${row.optCount} 项, 首项=${row.firstOpt}`);
  ok('基底行 T 级灰显（disabled）', row.tierDisabled === true, `opacity=${row.tierOpacity}`);

  // ---- 2b. 选中固有词缀 → 自动填入固定数值（减少手填） ----
  const autoFill = await F(() => new Promise((resolve) => {
    const blk = document.querySelector('.filter-block.implicit-block') ||
      document.querySelectorAll('.filter-block')[0];
    const sel = blk.querySelector('.affix-sel');
    // 「+(10—15) 精魂」是区间值首项
    const opt = [...sel.querySelectorAll('option')].find((o) => o.value && o.textContent.includes('精魂')) ||
      [...sel.querySelectorAll('option')].find((o) => o.value);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      const blk2 = document.querySelector('.filter-block.implicit-block') ||
        document.querySelectorAll('.filter-block')[0];
      const nums = [...blk2.querySelectorAll('input[type=number]')];
      resolve({ optText: opt.textContent, min: nums[0]?.value, max: nums[1]?.value });
    }, 150);
  }));
  ok('选中固有词缀自动填最小值', autoFill.min !== '' && autoFill.min != null, `${autoFill.optText} → min=${autoFill.min}`);
  ok('选中固有词缀自动填最大值', autoFill.max !== '' && autoFill.max != null, `max=${autoFill.max}`);

  // ---- 2c. 前缀行 T 级不灰显（有 T 级数据的词缀对照） ----
  await F(() => {
    const blocks = document.querySelectorAll('.filter-block');
    const prefixBlk = [...blocks].find((b) => b.querySelector('.filter-title')?.textContent.startsWith('前缀'));
    prefixBlk.querySelector('.add-filter-btn').click();
  });
  await frame.waitForTimeout(150);
  const prefixTier = await F(() => {
    const blocks = document.querySelectorAll('.filter-block');
    const prefixBlk = [...blocks].find((b) => b.querySelector('.filter-title')?.textContent.startsWith('前缀'));
    const tsel = prefixBlk.querySelector('.tier-sel');
    return tsel ? { disabled: tsel.disabled } : null;
  });
  ok('前缀行（未选词缀）T 级灰显', prefixTier && prefixTier.disabled === true);
  // 选中前缀词缀后 T 级应可用
  const prefixTier2 = await F(() => new Promise((resolve) => {
    const blocks = document.querySelectorAll('.filter-block');
    const prefixBlk = [...blocks].find((b) => b.querySelector('.filter-title')?.textContent.startsWith('前缀'));
    const sel = prefixBlk.querySelector('.affix-sel');
    const opt = [...sel.querySelectorAll('option')].find((o) => o.value);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      const b2 = [...document.querySelectorAll('.filter-block')].find((x) => x.querySelector('.filter-title')?.textContent.startsWith('前缀'));
      const tsel = b2.querySelector('.tier-sel');
      resolve({ disabled: tsel ? tsel.disabled : null, opts: tsel ? tsel.querySelectorAll('option').length : 0 });
    }, 150);
  }));
  ok('前缀选中词缀后 T 级可用', prefixTier2.disabled === false && prefixTier2.opts > 1, `opts=${prefixTier2.opts}`);

  // ---- 3. 选中基底 + 固有词缀 + 填数值 → 验证 payload ----
  const payload = await F(() => new Promise((resolve) => {
    // onGo 要求已选基底（hasBase 门禁）：先选第一个普通基底
    const bsel = document.querySelector('#baseSel');
    const b = [...bsel.options].find((o) => o.value);
    bsel.value = b.value;
    bsel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      const blk = document.querySelector('.filter-block.implicit-block') ||
        document.querySelectorAll('.filter-block')[0];
      const sel = blk.querySelector('.affix-sel');
      const opt = [...sel.querySelectorAll('option')].find((o) => o.value);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => {
        const blk2 = document.querySelector('.filter-block.implicit-block') ||
          document.querySelectorAll('.filter-block')[0];
        const min = blk2.querySelector('input[type=number]');
        min.value = '5';
        min.dispatchEvent(new Event('input', { bubbles: true }));
        // 拦截 postMessage 拿 payload
        const orig = window.parent.postMessage;
        window.parent.postMessage = (msg) => {
          window.parent.postMessage = orig;
          resolve(msg.type === 'P2_FILL' ? msg.payload : null);
        };
        document.querySelector('#goBtn').click();
        setTimeout(() => resolve(null), 800);
      }, 100);
    }, 100);
  }));
  ok('payload 生成', !!payload);
  if (payload) {
    const imp = (payload.affixes || []).find((a) => a.groupId && a.groupId.startsWith('implicit|'));
    ok('payload 含基底词缀', !!imp, imp ? JSON.stringify(imp).slice(0, 160) : 'none');
    ok('payload statType=implicit', imp && imp.statType === 'implicit', imp && imp.statType);
    ok('payload statIds 为官方 id', imp && /^implicit\.stat_\d+$/.test(imp.statIds[0] || ''), imp && imp.statIds);
    ok('payload officialText 非空', imp && !!imp.officialText, imp && imp.officialText);
    ok('payload minValue=5', imp && imp.minValue === 5, imp && String(imp.minValue));
  }

  // ---- 4. 单手剑（无固有词缀）：基底块隐藏 ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '单手武器').click());
  await frame.waitForTimeout(200);
  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('单手剑')).click());
  await frame.waitForTimeout(200);
  const sword = await F(() => ({
    titles: [...document.querySelectorAll('.filter-block-header .filter-title')].map((t) => t.textContent.replace(/\(\d+\)/, '')),
  }));
  ok('单手剑无基底块（隐藏空块）', !sword.titles.includes('基底'), sword.titles.join('/'));
  ok('单手剑仍有前缀块', sword.titles.includes('前缀'), sword.titles.join('/'));

  // ---- 5. 护甲·手套合并视图：基底块存在 ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '护甲').click());
  await frame.waitForTimeout(250);
  // 手套固有组=获得技能（skill 类型），先加行再验证下拉
  await F(() => {
    const impBlk = document.querySelector('.filter-block.implicit-block');
    impBlk.querySelector('.add-filter-btn').click();
  });
  await frame.waitForTimeout(150);
  const glove = await F(() => {
    const t = [...document.querySelectorAll('.filter-block-header .filter-title')].map((x) => x.textContent.replace(/\(\d+\)/, ''));
    const impBlk = document.querySelector('.filter-block.implicit-block');
    const sel = impBlk && impBlk.querySelector('.affix-sel');
    return {
      titles: t, hasImpBlk: !!impBlk,
      impOpts: sel ? sel.querySelectorAll('option').length : 0,
      firstOptText: sel ? (sel.querySelector('optgroup option') || {}).textContent || '' : '',
      groupLabel: sel ? (sel.querySelector('optgroup') || {}).label || '' : '',
    };
  });
  ok('手套合并视图基底块存在', glove.hasImpBlk === true, glove.titles.join('/'));
  ok('手套基底下拉有词缀', glove.impOpts > 1, `${glove.impOpts} 项, 首项=${glove.firstOptText}`);
  ok('手套块序=基底→前缀→后缀→瓦尔→特殊', JSON.stringify(glove.titles) === JSON.stringify(['基底', '前缀', '后缀', '瓦尔', '特殊']), glove.titles.join('/'));
  ok('手套固有行分组=基底（固有）', glove.groupLabel === '基底（固有）', glove.groupLabel);

  // ---- 6. 数据一致性：全部分类注入组无重复 id ----
  const dupCheck = await F(() => {
    const db = window.DB_DATA;
    if (!db) return { skip: true };
    let dup = 0;
    db.categories.forEach((c) => {
      const ids = new Set();
      c.affixGroups.forEach((g) => {
        if (ids.has(g.id)) dup++;
        ids.add(g.id);
      });
    });
    return { skip: false, dup };
  });
  if (!dupCheck.skip) ok('全分类 affixGroups 无重复 id', dupCheck.dup === 0, `dup=${dupCheck.dup}`);
  else results.push('SKIP | 数据一致性（demo 未注入 DB_DATA，跳过）');

  await page.screenshot({ path: 'C:\\ai-work\\poe2搜索插件\\data\\tmp\\verify_implicit.png', fullPage: false });
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
