/** fetch_ninja_builds.js — 抓取 poe.ninja builds 聚合数据（进阶模式数据源）
 *
 * 两段式：
 *  1) 浏览器渲染 builds 列表页（每升华职业）→ 提取前 N 个构建的 character 链接（默认前 10）
 *     （列表页是 Astro SPA，SSR 壳无数据；渲染后 a[href*="/character/"] 即 Top 构建有序列表）
 *  2) 纯 HTTP 调 character API（/poe2/api/builds/{version}/character）→ 聚合：
 *     - 装备按部位（inventoryId 映射）聚合：普通基底按 baseType、暗金按 name 计数（n/构建总数）
 *     - 词条模板计数（explicit+implicit，去 [] wiki 链接、数值→#，同件装备去重）
 *     - 药剂（flasks[]）、咒符（腰带 socketedItems 里的 * Charm）
 *
 * 产物：data/ninja/raw_{Asc}.json（聚合）+ data/ninja/chars/（逐构建缓存，断点续抓）
 * 用法：node fetch_ninja_builds.js [--league=forbiddenrites] [--asc="Gemling Legionnaire"]
 *       [--limit=10] [--refresh-links] [--no-links]
 */
const { chromium } = require('C:/Users/yekok/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\yekok\\.agent-browser\\browsers\\chrome-152.0.7977.75\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ninja');
const CHARS = path.join(OUT, 'chars');
fs.mkdirSync(CHARS, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const LINK_WAIT = 8000;        // 列表页渲染等待 ms

/* ---------- 参数 ---------- */
const args = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const API_DELAY = Number(args.delay || 900);   // character API 基础间隔 ms（429 后自适应放大）
const LEAGUE = args.league || 'forbiddenrites';
const LIMIT = Math.min(Number(args.limit || 10), 50);   // 默认取天梯榜前 10（v0.8 需求：Top10 构建归类装备）
const ONLY_ASC = args.asc || null;
const REFRESH_LINKS = !!args['refresh-links'];
const SKIP_LINKS = !!args['no-links'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- HTTP（带 429 自适应退避） ---------- */
let curDelay = API_DELAY;                       // 当前请求间隔，429 后翻倍，成功后缓慢回落
let cooldownUntil = 0;                          // 触发限流后的冷却截止时间
async function jget(url, tries = 8, signal = null) {
  for (let i = 0; i < tries; i++) {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal });
      if (res.status === 404) return null;
      if (res.status === 429) {
        // 优先尊重 Retry-After，否则指数冷却（最长 120s）
        const ra = Number(res.headers.get('retry-after'));
        const cool = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120000) : Math.min(15000 * Math.pow(2, i), 120000);
        cooldownUntil = Date.now() + cool;
        curDelay = Math.min(curDelay * 2, 5000);
        log(`  jget 429 → 冷却 ${Math.round(cool / 1000)}s，间隔提到 ${curDelay}ms (try ${i + 1}/${tries})`);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cooldownUntil = 0;
      curDelay = Math.max(API_DELAY, Math.round(curDelay * 0.7));   // 成功后缓慢回落
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') { log('  jget TIMEOUT', url.slice(0, 110)); return null; }
      if (i === tries - 1) { log('  jget FAIL', url.slice(0, 110), e.message); return null; }
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

/* ---------- 词条模板归一 ----------
 * ninja 词条带 wiki 链接："+28% to [Resistances|Lightning Resistance]" → "+#% to Lightning Resistance"
 * 数值 → #（保留 +/-/% 前后缀）。同件装备内去重后计数。 */
function modTemplate(raw) {
  let s = raw.replace(/\r?\n/g, ' ');
  s = s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
  s = s.replace(/(\+?-?\d+(?:\.\d+)?)(%?)/g, '#$2');
  return s.trim();
}

/* ---------- 部位映射（inventoryId → 本库槽位名） ---------- */
const SLOT_OF_INV = {
  Helm: 'Helmets', BodyArmour: 'Body_Armours', Gloves: 'Gloves', Boots: 'Boots',
  Amulet: 'Amulets', Ring: 'Rings', Ring2: 'Rings', Belt: 'Belts',
};

/* ---------- 主流程 ---------- */
(async () => {
  // 1. 赛季与版本
  const idx = await jget('https://poe.ninja/poe2/api/data/index-state');
  if (!idx) { console.error('index-state 拉取失败'); process.exit(1); }
  const snap = idx.snapshotVersions.find((s) => s.url === LEAGUE);
  if (!snap) { console.error('未找到赛季:', LEAGUE); process.exit(1); }
  log(`赛季 ${snap.name} snapshot=${snap.snapshotName} version=${snap.version}`);

  // 2. 升华职业人气
  const bidx = await jget('https://poe.ninja/poe2/api/data/build-index-state');
  const lb = bidx.leagueBuilds.find((l) => l.leagueName === snap.name || l.leagueUrl === LEAGUE);
  if (!lb) { console.error('build-index-state 无该赛季'); process.exit(1); }
  const ascs = lb.statistics
    .filter((s) => s.percentage > 0.05)
    .sort((a, b) => b.percentage - a.percentage);
  log(`升华职业 ${ascs.length} 个（>0.05%），Top5:`, ascs.slice(0, 5).map((s) => `${s.class} ${s.percentage}%`).join(', '));
  const target = ONLY_ASC ? ascs.filter((s) => s.class === ONLY_ASC) : ascs;
  if (!target.length) { console.error('未匹配升华职业:', ONLY_ASC); process.exit(1); }

  // 3. 浏览器抓各升华职业 Top 构建链接
  const linksByAsc = {};
  if (!SKIP_LINKS) {
    const browser = await chromium.launch({
      headless: true, executablePath: CHROME,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    for (const a of target) {
      const linkFile = path.join(OUT, `links_${a.class.replace(/ /g, '_')}.json`);
      if (!REFRESH_LINKS && fs.existsSync(linkFile)) {
        linksByAsc[a.class] = JSON.parse(fs.readFileSync(linkFile, 'utf8'));
        log(`[links] ${a.class}: 缓存 ${linksByAsc[a.class].length}`);
        continue;
      }
      const url = `https://poe.ninja/poe2/builds/${LEAGUE}?class=${encodeURIComponent(a.class)}`;
      log(`[links] ${a.class} (${a.percentage}%) → ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (e) { log('  goto 失败:', e.message.slice(0, 80)); }
      await page.waitForTimeout(LINK_WAIT);
      const links = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('a[href*="/character/"]').forEach((el) => {
          const href = el.href.split('?')[0];
          if (!out.includes(href)) out.push(href);
        });
        return out;
      });
      linksByAsc[a.class] = links.slice(0, LIMIT);
      fs.writeFileSync(linkFile, JSON.stringify(linksByAsc[a.class], null, 1));
      log(`  链接 ${linksByAsc[a.class].length}`);
    }
    await browser.close();
  } else {
    for (const a of target) {
      const linkFile = path.join(OUT, `links_${a.class.replace(/ /g, '_')}.json`);
      if (fs.existsSync(linkFile)) linksByAsc[a.class] = JSON.parse(fs.readFileSync(linkFile, 'utf8'));
    }
  }

  // 4. 逐构建拉 character API + 聚合
  for (const a of target) {
    const rawFile = path.join(OUT, `raw_${a.class.replace(/ /g, '_')}.json`);
    const links = linksByAsc[a.class] || [];
    if (!links.length) { log(`[${a.class}] 无链接，跳过`); continue; }

    const agg = {
      asc: a.class, class: null, popPct: a.percentage,
      league: LEAGUE, snapshotName: snap.snapshotName, version: snap.version,
      sampled: 0, failed: 0,
      slots: {},                       // 槽位 → { items: {key: n}, mods: {tpl: n} }
    };
    const slotOf = (name) => (agg.slots[name] = agg.slots[name] || { count: 0, items: {}, mods: {} });

    // 断点续抓：先扫一遍缓存，缓存里已有的构建直接聚合，不再发请求
    const cachedDatas = [];
    let fromCache = 0;
    for (const link of links) {
      const m0 = link.match(/\/character\/([^/]+)\/([^/?#]+)$/);
      if (!m0) { cachedDatas.push(null); continue; }
      const acc0 = decodeURIComponent(m0[1]);
      const nm0 = decodeURIComponent(m0[2]);
      const cf = path.join(CHARS, `${LEAGUE}__${acc0}__${nm0}.json`.replace(/[<>:"|*?]/g, '_'));
      const cfLegacy = path.join(CHARS, `${snap.version}__${acc0}__${nm0}.json`.replace(/[<>:"|*?]/g, '_'));
      let d = null;
      for (const f of [cf, cfLegacy]) {
        if (d) break;
        if (fs.existsSync(f)) {
          try {
            d = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (d && d.items) break;
            d = null;
          } catch (_) { d = null; }
        }
      }
      if (d) fromCache++;
      cachedDatas.push(d);
    }

    for (let i = 0; i < links.length; i++) {
      const m = links[i].match(/\/character\/([^/]+)\/([^/?#]+)$/);
      if (!m) continue;
      const account = decodeURIComponent(m[1]);
      const name = decodeURIComponent(m[2]);
      // 缓存键不带 version（ninja snapshot version 每日变化，同赛季同构建数据等价，可跨日复用）
      const cache = path.join(CHARS, `${LEAGUE}__${account}__${name}.json`.replace(/[<>:"|*?]/g, '_'));
      let data = cachedDatas[i] || (fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null);
      if (!data) {
        // 兼容旧版 version 前缀缓存
        const legacy = path.join(CHARS, `${snap.version}__${account}__${name}.json`.replace(/[<>:"|*?]/g, '_'));
        if (fs.existsSync(legacy)) { data = JSON.parse(fs.readFileSync(legacy, 'utf8')); }
      }
      if (!data) {
        const url = `https://poe.ninja/poe2/api/builds/${snap.version}/character?account=${encodeURIComponent(account)}&name=${encodeURIComponent(name)}&overview=${snap.snapshotName}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);   // 单请求 20s 超时，防慢速拖挂
        data = await jget(url, 8, ctrl.signal);
        clearTimeout(timer);
        if (data) fs.writeFileSync(cache, JSON.stringify(data));
        await sleep(curDelay);          // 用当前自适应间隔
      }
      if (!data || !data.items) { agg.failed++; continue; }

      agg.sampled++;
      if (!agg.class && data.class) agg.class = data.class;

      // 装备 + 药剂 + 咒符
      const allItems = [...(data.items || []), ...(data.flasks || []).map((f) => ({ itemSlot: f.itemSlot, itemData: f.itemData }))];
      const pushItem = (invId, d) => {
        let slot = SLOT_OF_INV[invId];
        // 武器/副手：按 baseType 归到具体武器分类（build 阶段再映射 baseSlug，这里统一进 Weapon）
        if (!slot && (invId === 'Weapon' || invId === 'Weapon2' || invId === 'Offhand2')) slot = 'Weapon';
        if (!slot && invId === 'Flask') slot = 'Flask';
        if (!slot) return;
        const s = slotOf(slot);
        // 稀有度分级：ninja 榜单粒度 = Rare Ring / Magic Flask / Unique 名字
        // frameTypeId: Rare / Magic / Normal / Unique / RunicRare（符文基底按稀有算）
        const ft = String(d.frameTypeId || d.rarity || 'Rare');
        let rar, key;
        if (ft === 'Unique' || d.frameType === 3 || d.rarity === 'Unique') {
          rar = 'unique'; key = 'u:' + (d.name || d.baseType);
        } else if (ft === 'Magic') {
          rar = 'magic'; key = 'm:' + (d.baseType || d.typeLine);
        } else if (ft === 'Normal') {
          rar = 'normal'; key = 'n:' + (d.baseType || d.typeLine);
        } else {
          rar = 'rare'; key = 'r:' + (d.baseType || d.typeLine);
        }
        s.items[key] = (s.items[key] || 0) + 1;
        // 词条池：暗金固定词条单独记（不混入普通词条热度）；普通件 explicit+implicit 合并
        const tpls = new Set();
        for (const arr of [d.explicitMods, d.implicitMods]) {
          for (const mod of arr || []) { const t = modTemplate(mod); if (t) tpls.add(t); }
        }
        if (rar === 'unique') {
          s.uniqueMods = s.uniqueMods || {};
          s.uniqueMods[d.name || d.baseType] = s.uniqueMods[d.name || d.baseType] || {};
          const um = s.uniqueMods[d.name || d.baseType];
          for (const t of tpls) um[t] = (um[t] || 0) + 1;
        } else {
          for (const t of tpls) s.mods[t] = (s.mods[t] || 0) + 1;
        }
      };
      for (const it of data.items || []) pushItem(it.itemData?.inventoryId, it.itemData || {});
      for (const f of data.flasks || []) pushItem('Flask', f.itemData || {});
      // 咒符：腰带 socketedItems（baseType 以 Charm 结尾）
      for (const it of data.items || []) {
        const d = it.itemData || {};
        for (const sock of d.socketedItems || []) {
          const bt = sock.baseType || sock.typeLine || '';
          if (/charm$/i.test(bt)) {
            const s = slotOf('Charms');
            s.items['r:' + bt] = (s.items['r:' + bt] || 0) + 1;
            for (const mod of sock.explicitMods || []) {
              const t = modTemplate(mod);
              if (t) s.mods[t] = (s.mods[t] || 0) + 1;
            }
          }
        }
      }
    }
    for (const s of Object.values(agg.slots)) s.count = agg.sampled;
    fs.writeFileSync(rawFile, JSON.stringify(agg, null, 1));
    log(`[${a.class}] 采样 ${agg.sampled}（失败 ${agg.failed}，缓存命中 ${fromCache}）→ ${path.basename(rawFile)}`);
  }

  log('DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
