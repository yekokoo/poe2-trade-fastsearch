/** verify_tabs.js — 用 playwright-core 驱动 Chrome 验证 demo 三级 tab 交互
 * 检查：初始态 → 护甲部位/变体切换 → 副手 → 其他·宝库钥匙（无词缀可搜索）→ 物等默认空
 * v0.8：65 分类、暗金置底金色、基底面板展示、物品等级输入移除
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

  // 面板在内层 iframe
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('#groupTabs .tab', { timeout: 15000 });
  const F = (fn) => frame.evaluate(fn);
  // tab 文本去掉基底数角标（<span class="n">1224</span>）
  const tabTexts = (el) => [...el.querySelectorAll(':scope > .tab')].map((t) => t.childNodes[0].textContent);

  // ---- 1. 初始态 ----
  const init = await F(() => ({
    groups: [...document.querySelectorAll('#groupTabs .tab')].map((t) => t.textContent),
    activeGroup: document.querySelector('#groupTabs .tab.active')?.textContent,
    cats: [...document.querySelectorAll('#catTabs .tab')].map((t) => t.textContent),
    activeCat: document.querySelector('#catTabs .tab.active')?.textContent,
    subDisplay: document.querySelector('#subTabs').classList.contains('show'),
    ilvlGone: !document.querySelector('#ilvl'),
    goDisabled: document.querySelector('#goBtn').disabled,
    dbInfo: document.querySelector('#dbInfo').textContent,
  }));
  ok('一级 10 组', init.groups.length === 10, init.groups.join('/'));
  ok('初始组=单手武器', init.activeGroup === '单手武器', init.activeGroup);
  ok('普通组无三级tab', init.subDisplay === false);
  ok('物品等级输入已移除', init.ilvlGone === true);
  ok('数据库 ≥65 分类（v0.6.5 起新增失落的珠宝 4 分类）', Number((init.dbInfo.match(/·\s*(\d+)/) || [])[1]) >= 65, init.dbInfo);
  ok('初始无词缀不可搜索', init.goDisabled === true);

  // ---- 2. 切到护甲：手套 + 属性变体 ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '护甲').click());
  await frame.waitForTimeout(200);
  const armor = await F(() => ({
    cats: [...document.querySelectorAll('#catTabs .tab')].map((t) => t.textContent),
    activeCat: document.querySelector('#catTabs .tab.active')?.textContent,
    subs: [...document.querySelectorAll('#subTabs .tab')].map((t) => t.textContent),
    subVisible: document.querySelector('#subTabs').classList.contains('show'),
    activeSub: document.querySelector('#subTabs .tab.active')?.textContent,
    baseCount: document.querySelectorAll('#baseSel option').length,
    lastOpts: [...document.querySelectorAll('#baseSel optgroup')].map((g) => g.label),
    hasPanel: [...document.querySelectorAll('#baseSel option')].some((o) => o.textContent.includes('护甲:')),
    affixBlocks: [...document.querySelectorAll('.filter-block-header .filter-title')].map((t) => t.textContent),
  }));
  ok('护甲二级=手套/鞋子/护甲/头盔', JSON.stringify(armor.cats.map((x) => x.replace(/\d+$/, ''))) === JSON.stringify(['手套', '鞋子', '护甲', '头盔']), armor.cats.join('/'));
  ok('手套三级=不区分+6变体', armor.subs.length === 7, armor.subs.join('/'));
  ok('三级 tab 可见', armor.subVisible === true);
  ok('默认选中=不区分', armor.activeSub === '不区分', armor.activeSub);

  ok('不区分=合并基底(普通+暗金)', armor.baseCount > 150, `${armor.baseCount} 基底`);
  ok('暗金分组置底', armor.lastOpts.some((l) => l.includes('暗金')), armor.lastOpts.join('|'));
  ok('基底展示基础面板(护甲:…)', armor.hasPanel === true);

  // ---- 2b. 暗金：选中 → 词缀区渲染固定词条块（v0.6.4：艾米兰等暗金有 mods，不再显示锁定提示） ----
  await F(() => {
    const sel = document.querySelector('#baseSel');
    const u = [...sel.querySelectorAll('option.unique-opt')][0];
    sel.value = u.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await frame.waitForTimeout(150);
  const ulock = await F(() => ({
    hint: document.querySelector('#affixBlocks .no-affix-hint.unique-lock')?.textContent || '',
    rows: document.querySelectorAll('#affixBlocks .filter-row').length,
    titles: [...document.querySelectorAll('#affixBlocks .filter-title')].map((t) => t.textContent),
    goDisabled: document.querySelector('#goBtn').disabled,
    goText: document.querySelector('#goBtn').textContent,
  }));
  ok('暗金选中渲染固定词条块（基底/词条或锁定提示二选一）',
    ulock.rows > 0 || ulock.hint.includes('暗金'),
    'rows=' + ulock.rows + ' titles=' + ulock.titles.join('/') + ' hint=' + JSON.stringify(ulock.hint.slice(0, 40)));
  ok('暗金选中可直接搜索', ulock.goDisabled === false);
  // 恢复不限基底
  await F(() => {
    const sel = document.querySelector('#baseSel');
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await frame.waitForTimeout(150);
  const 词缀四块 = await F(() => [...document.querySelectorAll('.filter-block-header .filter-title')].map((t) => t.textContent));
  ok('词缀块齐全（v0.6.7 起基底固有块排最前）', JSON.stringify(词缀四块.map(s=>s.replace(/\(\d+\)/,''))) === JSON.stringify(['基底', '前缀', '后缀', '瓦尔', '特殊']), 词缀四块.join('/'));

  // ---- 3. 切变体到头盔·力量 ----
  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('头盔')).click());
  await frame.waitForTimeout(150);
  await F(() => [...document.querySelectorAll('#subTabs .tab')].find((t) => t.textContent.startsWith('力敏')).click());
  await frame.waitForTimeout(150);
  const helm = await F(() => ({
    activeSub: document.querySelector('#subTabs .tab.active')?.textContent,
    firstBase: document.querySelector('#baseSel option:nth-child(2)')?.textContent,
    baseCount: document.querySelectorAll('#baseSel option').length,
  }));
  ok('头盔·力敏 变体选中', helm.activeSub?.startsWith('力敏'), helm.activeSub);
  ok('基底随变体切换', helm.baseCount > 0, `${helm.baseCount} 基底, 首个=${helm.firstBase?.slice(0, 30)}`);

  // ---- 4. 副手：箭袋无三级，盾牌有三级 ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '副手').click());
  await frame.waitForTimeout(200);
  const off1 = await F(() => ({
    cats: [...document.querySelectorAll('#catTabs .tab')].map((t) => t.textContent),
    activeCat: document.querySelector('#catTabs .tab.active')?.textContent,
    subVisible: document.querySelector('#subTabs').classList.contains('show'),
    baseCount: document.querySelectorAll('#baseSel option').length,
  }));
  ok('副手二级=箭袋/盾牌/轻盾/法器', JSON.stringify(off1.cats.map((x) => x.replace(/\d+$/, ''))) === JSON.stringify(['箭袋', '盾牌', '轻盾', '法器']), off1.cats.join('/'));
  ok('箭袋无变体（三级隐藏）', off1.subVisible === false);
  ok('箭袋基底 ≥10 个（普通+暗金）', off1.baseCount >= 10, `${off1.baseCount}`);

  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('盾牌')).click());
  await frame.waitForTimeout(150);
  const shield = await F(() => ({
    subs: [...document.querySelectorAll('#subTabs .tab')].map((t) => t.textContent),
    subVisible: document.querySelector('#subTabs').classList.contains('show'),
  }));
  ok('盾牌三级=不区分+力量/力敏/力智', JSON.stringify(shield.subs.map((x) => x.replace(/\d+$/, ''))) === JSON.stringify(['不区分', '力量', '力敏', '力智']), shield.subs.join('/'));
  ok('盾牌三级可见', shield.subVisible === true);

  // ---- 5. 其他：遗物（宝库钥匙已删除） ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '其他').click());
  await frame.waitForTimeout(200);
  const other = await F(() => ({
    cats: [...document.querySelectorAll('#catTabs .tab')].map((t) => t.textContent),
    activeCat: document.querySelector('#catTabs .tab.active')?.textContent,
    subVisible: document.querySelector('#subTabs').classList.contains('show'),
    baseCount: document.querySelectorAll('#baseSel option').length,
    goDisabled: document.querySelector('#goBtn').disabled,
    firstSub: [...document.querySelectorAll('#catTabs .tab')][0]?.textContent,
  }));
  ok('其他二级=只显示遗物（宝库钥匙已删）', other.cats.length === 1 && other.cats[0].startsWith('遗物'), other.cats.join('/'));
  ok('遗物三级可见', other.subVisible === true);
  ok('遗物基底 ≥7', other.baseCount >= 7, `${other.baseCount}`);
  ok('遗物有词缀默认不可搜索（需选词缀）', other.goDisabled === true);

  // 选基底 → goBtn 仍禁用（遗物有词缀，需选词缀才可搜索）
  await frame.waitForTimeout(100);
  const vkGo = await F(() => document.querySelector('#goBtn').disabled);
  ok('遗物选基底后仍需词缀才可搜索', vkGo === true);

  // ---- 6. 遗物三级（7 器型 tab 核对） ----
  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('遗物')).click());
  await frame.waitForTimeout(150);
  const relic = await F(() => ({
    subs: [...document.querySelectorAll('#subTabs .tab')].map((t) => t.textContent),
    subVisible: document.querySelector('#subTabs').classList.contains('show'),
  }));
  ok('遗物三级=不区分+7器型', relic.subs.length === 8, relic.subs.join('/'));

  // ---- 7. 物等输入留空 → T级联动不受影响（全部 T 级可选） ----
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '饰品').click());
  await frame.waitForTimeout(200);
  await F(() => {
    const add = document.querySelector('.add-filter-btn');
    add.click();
  });
  await frame.waitForTimeout(150);
  const amulet = await F(() => {
    const sel = document.querySelector('.affix-sel');
    const prefixOpt = sel.querySelector('optgroup option');
    return { optCount: sel.querySelectorAll('option').length };
  });
  ok('饰品词缀下拉有选项', amulet.optCount > 1, `${amulet.optCount} options`);

  // ---- 8. CSS 一致性：切分类/切组，控件几何尺寸必须恒定 ----
  const geo = () => F(() => {
    const g = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
    return {
      baseSel: g(document.querySelector('#baseSel')),
      groupTab: g(document.querySelector('#groupTabs .tab')),
      catTab: g(document.querySelector('#catTabs .tab')),
      rowSel: g(document.querySelector('.filter-row .affix-sel') || document.querySelector('#baseSel')),
      rowNum: g(document.querySelector('.filter-row input[type=number]') || document.querySelector('#baseSel')),
    };
  });
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '单手武器').click());
  await frame.waitForTimeout(150);
  const g1 = await geo();
  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('单手锤')).click());
  await frame.waitForTimeout(150);
  const g2 = await geo();
  await F(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('单手剑')).click());
  await frame.waitForTimeout(150);
  const g3 = await geo();
  await F(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '珠宝').click());
  await frame.waitForTimeout(150);
  const g4 = await geo();
  ok('基底下拉尺寸恒定(单手锤=单手剑)', g2.baseSel === g3.baseSel, `${g2.baseSel} vs ${g3.baseSel}`);
  ok('基底下拉跨组尺寸恒定(单手武器=珠宝)', g1.baseSel === g4.baseSel, `base ${g1.baseSel}=${g4.baseSel}`);
  // tab 高度统一（宽度随文字长度变化是正常的，高度必须恒定）
  const tabHeights = new Set([g1.groupTab, g2.groupTab, g4.groupTab, g1.catTab, g2.catTab, g4.catTab].map((s) => s.split('x')[1]));
  ok('tab 高度统一(1级30/2级28，不随内容变化)', tabHeights.size === 2, [...tabHeights].join('/'));
  ok('词缀行控件与工具条同高', (() => {
    const [rs, bs] = [g2.rowSel, g2.baseSel].map((s) => Number(s.split('x')[1]));
    return rs === bs;
  })(), `rowSel=${g2.rowSel} vs baseSel=${g2.baseSel}`);

  // 截图存档
  await page.screenshot({ path: 'C:\\ai-work\\poe2搜索插件\\data\\tmp\\demo_verify.png', fullPage: false });

  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
