// verify_dedup.js — 数据归集去重验证（task #33）：合并视图暗金/普通基底无重复 value，变体可辨识
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

  const results = [];
  const ok = (name, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  const grabBaseSel = () => frame.evaluate(() => {
    const sel = document.querySelector('#baseSel');
    return [...sel.querySelectorAll('option')].map((o) => ({ text: o.textContent, value: o.value, cls: o.className }));
  });

  // 护甲 → 鞋子（默认不区分 = 合并视图）
  await frame.evaluate(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '护甲').click());
  await frame.waitForTimeout(300);
  // catTabs 是部位 tab，文本带计数角标（如 "鞋子201"），用 startsWith 匹配
  const bootTab = await frame.evaluateHandle(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('鞋子')));
  await bootTab.asElement().click();
  await frame.waitForTimeout(300);

  let opts = await grabBaseSel();
  const uniq = opts.filter((o) => o.cls.includes('unique-opt'));
  const norm = opts.filter((o) => !o.cls.includes('unique-opt') && o.value);

  // 1. 全下拉 value 唯一（同 value 重复选项=纯噪音）
  const vset = new Set(opts.filter((o) => o.value).map((o) => o.value));
  const dupVals = [...new Set(opts.filter((o) => o.value).map((o) => o.value))].filter((v) => opts.filter((o) => o.value === v).length > 1);
  ok('鞋子合并视图 value 全部唯一', dupVals.length === 0, `共${vset.size}值 重复${dupVals.length}`);

  // 2. 阿兹里的金履：去重后应只剩 2 条（普通款 + 符文师匠款），而非 6 份 ×2
  const aziri = uniq.filter((o) => o.value.includes('阿兹里的金履'));
  ok('阿兹里的金履仅 2 条（束带长靴/符文师匠束带长靴）',
    aziri.length === 2 && aziri.some((o) => o.value.includes('符文师匠')), aziri.map((o) => o.value).join(' / '));

  // 3. 暗金总数合理（48 个唯一名，符文师匠为独立暗金名）
  ok('鞋子暗金数量与唯一名一致', uniq.length === new Set(uniq.map((o) => o.value)).size, `暗金=${uniq.length}`);

  // 4. 普通基底无重复（153 个唯一名）
  const normNames = norm.map((o) => o.value);
  ok('普通基底无重复名', new Set(normNames).size === normNames.length, `普通=${normNames.length} 唯一=${new Set(normNames).size}`);

  // 5. 切到单个变体（力量）再查一遍
  const strTab = await frame.evaluateHandle(() => [...document.querySelectorAll('#subTabs .tab')].find((t) => t.textContent.startsWith('力量')));
  await strTab.asElement().click();
  await frame.waitForTimeout(300);
  opts = await grabBaseSel();
  const dupVals2 = [...new Set(opts.filter((o) => o.value).map((o) => o.value))].filter((v) => opts.filter((o) => o.value === v).length > 1);
  ok('力量单变体视图 value 唯一', dupVals2.length === 0, `选项=${opts.filter((o) => o.value).length}`);

  // 6. 护甲（胸甲）合并视图：隐士束衣这类跨 slug 同名也应只剩 1 条
  const bodyTab = await frame.evaluateHandle(() => [...document.querySelectorAll('#catTabs .tab')].find((t) => t.textContent.startsWith('护甲')));
  await bodyTab.asElement().click();
  await frame.waitForTimeout(300);
  opts = await grabBaseSel();
  const hermits = opts.filter((o) => o.value === '隐士束衣');
  ok('隐士束衣（跨slug同名）合并后仅 1 条', hermits.length === 1, hermits.map((o) => o.text).join(' | '));
  const normBody = opts.filter((o) => o.cls !== 'unique-opt' && o.value);
  ok('胸甲普通基底无重复名', new Set(normBody.map((o) => o.value)).size === normBody.length, `普通=${normBody.length}`);
  // 标注示例：跨 slug 同名且未覆盖全部变体时才带（变体）标注；
  // 隐士束衣覆盖全部 7 变体 → 按规则不标注（标注无信息量），仅验证唯一性
  ok('跨slug同名基底标注规则正确（全覆盖不标）',
    hermits.length === 1 && !/（.+）/.test(hermits[0].text.split(' · ')[0]), hermits[0]?.text.split(' · ')[0]);

  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
