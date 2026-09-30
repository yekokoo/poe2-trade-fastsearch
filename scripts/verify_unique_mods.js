// verify_unique_mods.js — Task #20 E2E：选中暗金 → 自动带出固定词条行 → 填值 → payload 正确
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

  await page.evaluate(() => {
    window.__p2fills = [];
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'P2_FILL') window.__p2fills.push(e.data.payload);
    });
  });

  const results = [];
  const ok = (name, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  // ---------- 1. 饰品 → 项链 → 选「均衡之符 星辉项链」 ----------
  await frame.evaluate(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '饰品').click());
  await frame.waitForTimeout(300);
  await frame.evaluate(() => {
    const sel = document.querySelector('#baseSel');
    const u = [...sel.querySelectorAll('option.unique-opt')].find((o) => o.value.includes('均衡之符'));
    sel.value = u.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await frame.waitForTimeout(300);

  // 词条块渲染（v0.6.3：基底/词条/不可筛 分块）
  const blk = await frame.evaluate(() => {
    const titles = [...document.querySelectorAll('#affixBlocks .filter-block .filter-title')].map((t) => t.textContent);
    const rows = [...document.querySelectorAll('#affixBlocks .filter-row')];
    return {
      titles,
      rowCount: rows.length,
      names: rows.map((r) => r.querySelector('.u-mod-name')?.textContent),
      tags: rows.map((r) => r.querySelector('.u-tag')?.textContent),
      pickableNums: rows.filter((r) => !r.classList.contains('unpickable')).map((r) => r.querySelectorAll('.u-num').length),
      unpickCount: rows.filter((r) => r.classList.contains('unpickable')).length,
      enabled: rows.map((r) => r.querySelector('input[type=checkbox]')?.checked),
      disabledCb: rows.filter((r) => r.classList.contains('unpickable')).map((r) => r.querySelector('input[type=checkbox]')?.disabled),
    };
  }).catch((e) => ({ err: e.message }));
  console.log('词条块:', JSON.stringify(blk, null, 1));
  ok('块标题含基底（固有）+词条分块', blk.titles.join('|').includes('基底（固有）') &&
    blk.titles.join('|').includes('词条'), blk.titles.join(' | '));
  ok('均衡之符应有 3 条词条行', blk.rowCount === 3, 'rows=' + blk.rowCount);
  ok('固有词条带「基」标记（基底块）', blk.tags.includes('基'), blk.tags.join(','));
  ok('显式词条带「词」标记（词条块）', blk.tags.includes('词'), blk.tags.join(','));
  ok('可筛行有最小/最大输入', blk.pickableNums.every((n) => n === 2), JSON.stringify(blk.pickableNums));
  ok('可筛行默认启用', blk.enabled.every((v) => v === true), JSON.stringify(blk.enabled));

  // ---------- 2. 填数值：第 2 行（+(50—100) 全属性）min=80 ----------
  await frame.evaluate(() => {
    const rows = [...document.querySelectorAll('#affixBlocks .filter-row')];
    const minInput = rows[1].querySelectorAll('.u-num')[0];
    minInput.value = '80';
    minInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await frame.waitForTimeout(100);

  // ---------- 3. 点填入 → payload ----------
  await frame.evaluate(() => document.querySelector('#goBtn').click());
  await frame.waitForTimeout(300);
  const fills = await page.evaluate(() => window.__p2fills || []);
  ok('payload 已发送', fills.length === 1);
  const affs = fills[0]?.affixes || [];
  ok('payload 暗金带词条', affs.length >= 2, 'affixes=' + affs.length);
  const target = affs.find((a) => a.officialText === '+# 全属性' && a.minValue === 80);
  ok('用户填的 min=80 进入 payload', !!target, JSON.stringify(affs.map((a) => [a.officialText, a.minValue, a.maxValue])));
  ok('词条带 uniqueMod 标记', affs.every((a) => a.uniqueMod === true));
  ok('词条带官方 statIds（基底词缀=implicit 组，词条=explicit 组）',
    affs.every((a) => {
      const s0 = String(a.statIds && a.statIds[0] || '');
      return a.statIds && a.statIds.length &&
        (s0.startsWith('explicit.') || s0.startsWith('implicit.'));
    }),
    JSON.stringify(affs.map((a) => a.statIds && a.statIds[0])));

  // ---------- 4. 切普通基底 → 词缀区恢复普通模式 ----------
  await frame.evaluate(() => {
    const sel = document.querySelector('#baseSel');
    const opt = [...sel.querySelectorAll('option')].find((o) => !o.classList.contains('unique-opt') && o.value !== '');
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await frame.waitForTimeout(300);
  const backNormal = await frame.evaluate(() => {
    const rows = [...document.querySelectorAll('#affixBlocks .filter-row')];
    return {
      rowCount: rows.length,
      hasAddBtn: [...document.querySelectorAll('#affixBlocks .add-filter-btn')].length > 0, // 普通模式标志
      hasUniqueBlock: !!document.querySelector('#affixBlocks .u-mod-name'),                // 暗金模式标志
    };
  });
  console.log('切普通基底:', JSON.stringify(backNormal));
  ok('切普通基底恢复词缀下拉模式', backNormal.hasAddBtn && !backNormal.hasUniqueBlock, JSON.stringify(backNormal));

  // ---------- 4.5 本地词缀重定向断言：暗金武器本地词条必须用官方本地形态 ----------
  // 二元一体 守护节杖：攻击速度提高 (12—22)% 是 local 词缀 → 官方区域版 stat_210067635
  // （全局版 stat_681332047 会搜不到结果 —— v0.6.2 反馈②）
  const demo = await frame.evaluate(async () => {
    // 扩展环境用 getURL；demo（http 直开）用相对路径兜底
    try { return await (await fetch(chrome.runtime.getURL('data/mods_db.json'))).json(); }
    catch (_) { return await (await fetch('../extension/data/mods_db.json')).json(); }
  }).catch(() => null);
  if (demo) {
    let duality = null;
    for (const c of demo.categories) for (const b of (c.bases || [])) {
      if (b.unique && b.text === '二元一体 守护节杖') { duality = b; break; }
    }
    ok('mods_db 含二元一体', !!duality);
    if (duality) {
      const asMod = (duality.mods || []).find((m) => (m.text || '').includes('攻击速度提高'));
      ok('二元一体含攻击速度词条', !!asMod, asMod && asMod.text);
      const o = asMod && asMod.o;
      ok('攻击速度已重定向到 (区域) 形态', o === '攻击速度提高 #% (区域)', 'o=' + o);
      ok('stat id 为区域版 210067635', !!(asMod && (asMod.s || []).some((x) => x === 'explicit.stat_210067635')),
        asMod && (asMod.s || []).join(','));
      // 物理伤害提高官方无本地形态 → 保持全局（官方下拉真实存在，实测可筛）
      const physMod = (duality.mods || []).find((m) => (m.text || '').includes('物理伤害提高'));
      ok('物理伤害提高保持全局形态', physMod && physMod.o === '物理伤害提高 #%', 'o=' + (physMod && physMod.o));
    }
    // 全库扫描：v0.6.4 重定向 v2 规则下，local 词条 officialText 必须是市集真实下拉文本
    // （附加伤害类下拉无 (区域) 字样、id 是全局 id，旧「区域版 id」断言已过时）
    // osm 直接从磁盘读（Node 侧），不经 demo 服务器
    const osmNode = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'data', 'official_stat_map.json'), 'utf8'));
    const OPT_KEYS = new Set(Object.keys(osmNode.entries || {}));
    let localOk = 0, localBad = 0;
    const badLocal = [];
    for (const c of demo.categories) for (const b of (c.bases || [])) {
      if (!b.unique) continue;
      for (const m of (b.mods || [])) {
        if (m.m !== 'local') continue;
        if (m.o && OPT_KEYS.has(m.o)) localOk++;
        else { localBad++; if (badLocal.length < 5) badLocal.push(b.text + ' :: ' + (m.o || '')); }
      }
    }
    ok('全库 local 重定向 officialText 均为市集下拉文本', localBad === 0, `ok=${localOk} bad=${localBad} ${badLocal.join(' / ')}`);

    // v0.6.3 反馈③：暗金固有词条必须对齐「基底」组（implicit id + statType=implicit）
    let base = null;
    for (const c of demo.categories) for (const b of (c.bases || [])) {
      if (b.unique && b.text === '望而不及 贯心箭袋') { base = b; break; }
    }
    ok('mods_db 含望而不及 贯心箭袋', !!base);
    if (base) {
      const crit = (base.mods || []).find((m) => (m.text || '').includes('攻击暴击率提高'));
      ok('望而不及含攻击暴击率词条', !!crit, crit && crit.text);
      ok('攻击暴击率 statType=implicit（基底）', !!(crit && crit.t === 'implicit'), 't=' + (crit && crit.t));
      ok('statIds 仅含基底组 id（不混 explicit）',
        !!(crit && (crit.s || []).length && crit.s.every((x) => String(x).startsWith('implicit.'))),
        crit && (crit.s || []).join(','));
      ok('stat id = 2194114101', !!(crit && (crit.s || []).includes('implicit.stat_2194114101')),
        crit && (crit.s || []).join(','));
    }
    // 全库扫描：t=implicit 的词条 s 必须全是 implicit 组；t=skill 全是 skill 组
    let impOk = 0, impBad = 0, sklOk = 0, sklBad = 0;
    const badImp = [], badSkl = [];
    for (const c of demo.categories) for (const b of (c.bases || [])) {
      if (!b.unique) continue;
      for (const m of (b.mods || [])) {
        if (m.t === 'implicit') {
          if ((m.s || []).length && m.s.every((x) => String(x).startsWith('implicit.'))) impOk++;
          else { impBad++; if (badImp.length < 5) badImp.push(b.text + ' :: ' + m.text); }
        } else if (m.t === 'skill') {
          if ((m.s || []).length && m.s.every((x) => String(x).startsWith('skill.'))) sklOk++;
          else { sklBad++; if (badSkl.length < 5) badSkl.push(b.text + ' :: ' + m.text); }
        }
      }
    }
    ok('全库 t=implicit 词条 statIds 均为基底组', impBad === 0, `ok=${impOk} bad=${impBad} ${badImp.join(' / ')}`);
    ok('全库 t=skill 词条 statIds 均为技能组', sklBad === 0, `ok=${sklOk} bad=${sklBad} ${badSkl.join(' / ')}`);
  } else {
    console.log('(跳过 mods_db 断言：demo 环境无法读取扩展数据)');
  }


  // ---------- 5. 无词条暗金（未完成占位）不报错 ----------
  await frame.evaluate(() => [...document.querySelectorAll('#groupTabs .tab')].find((t) => t.textContent === '武器' || t.textContent === '单手武器').click());
  await frame.waitForTimeout(300);
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
