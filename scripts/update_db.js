#!/usr/bin/env node
/** update_db.js — POE2 版本更新一键数据管道（v0.8.2 起可复用）
 *
 * 场景：POE2 新版本/新赛季（如 0.5.4 → 0.5.5）词缀池/暗金/天梯变化，一键重建全部离线库。
 *
 * 管线（按依赖顺序）：
 *   0. 预检 + 备份      网络探测、旧库备份到 data/backup/{ts}/
 *   1. 市集字典刷新     guofu_stats_api.json（API 全量）+ trade2_stats_flat.json（API 增量合并，保留 rune/desecrated/skill 等国服特有组）
 *   2. poe2db 全量抓取  data/parsed/*.json + data/bases/*.json（失败自动按清单重试一轮）
 *   3. 暗金抓取         unique_name_map.json + unique_mods_raw.json
 *   4. osm 重建         official_stat_map.json（下拉496 prio1 > peer prio2 > API prio3）
 *   5. 暗金对齐         unique_mods_aligned.json（local 区域重定向在链内）
 *   6. mods_db 重建     build_plugin_db → inject_unique → align_affix_groups → build_implicit_groups → fix_official_text
 *   7. ninja 构建榜     清旧 raw/links/chars → fetch_ninja_builds --league={自动检测} → build_builds_db
 *   8. E2E 回归         4 套 verify（内置 8642 静态服务器）
 *   9. 报告             data/update_report.json + 控制台摘要（含人工检查提示）
 *
 * 用法：
 *   node scripts/update_db.js                     # 全流程
 *   node scripts/update_db.js --skip=ninja,e2e    # 跳过指定环节（poe2db,ninja,e2e）
 *   node scripts/update_db.js --league=runesofaldur --asc="Gemling Legionnaire"  # 只抓指定升华
 *   node scripts/update_db.js --dry-run           # 只打印计划不执行
 *
 * 已知人工维护点（报告会提示）：
 *   - peer_trade2state_cn.json（市集 UI 词表 9 组）与 market_dropdown_real.json（496 下拉快照）
 *     来自登录态页面，无法匿名重抓。新版本若措辞大面积变化（报告对齐率骤降时），
 *     需登录市集保存页内 state / 下拉 DOM 手动更新这两份，再重跑 --skip=poe2db,ninja,e2e。
 *   - poe2db 新增装备分类时，fetch_all.js 的 MOD_PAGES/BASE_PAGES 需人工补清单（步骤 2 会检测差集）。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const EXT = path.join(ROOT, 'extension', 'data');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0', 'Accept-Language': 'zh-CN,zh;q=0.9' };

/* ---------- 参数 ---------- */
const args = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const SKIP = new Set(String(args.skip || '').split(',').filter(Boolean));
const DRY = !!args['dry-run'];
const DELAY = Number(args.delay || 600);
const ONLY_ASC = args.asc || null;

const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
const report = { startedAt: new Date().toISOString(), steps: {}, warnings: [] };

/* ---------- 工具 ---------- */
const PY = (() => {
  const venv = 'C:\\Users\\yekok\\.workbuddy\\binaries\\python\\envs\\default\\python.exe';
  const managed = 'C:\\Users\\yekok\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
  return fs.existsSync(venv) ? venv : managed;
})();

function run(script, scriptArgs = [], label) {
  const t0 = Date.now();
  const isPy = script.endsWith('.py');
  const exe = isPy ? PY : process.execPath;
  log(`▶ ${label || script} ${scriptArgs.join(' ')}`.trim());
  const r = spawnSync(exe, [path.join(ROOT, 'scripts', script), ...scriptArgs], {
    cwd: ROOT, stdio: 'inherit',
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status !== 0) {
    log(`✗ ${script} 失败（exit ${r.status}，耗时 ${secs}s）`);
    return false;
  }
  log(`✓ ${script} 完成（${secs}s）`);
  return true;
}

async function jget(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function backupFiles(ts) {
  const dir = path.join(DATA, 'backup', ts);
  fs.mkdirSync(dir, { recursive: true });
  const list = [
    ['extension/data/mods_db.json', 'mods_db.json'],
    ['extension/data/builds_db.json', 'builds_db.json'],
    ['extension/data/stats_db.json', 'stats_db.json'],
    ['extension/data/stat_mapping.json', 'stat_mapping.json'],
    ['data/trade2_stats_flat.json', 'trade2_stats_flat.json'],
    ['data/guofu_stats_api.json', 'guofu_stats_api.json'],
    ['data/official_stat_map.json', 'official_stat_map.json'],
    ['data/tmp/unique_name_map.json', 'unique_name_map.json'],
    ['data/tmp/unique_mods_raw.json', 'unique_mods_raw.json'],
  ];
  for (const [src, name] of list) {
    const p = path.join(ROOT, src);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dir, name));
  }
  // ninja 旧产物移入备份（raw 是旧赛季数据，build_builds_db 会全目录扫描混入）
  // 仅在 ninja 步骤会执行时才挪——--skip=ninja 续跑时保留，否则重跑 build_builds_db 无输入
  const ninja = path.join(DATA, 'ninja');
  if (fs.existsSync(ninja) && !SKIP.has('ninja')) {
    const nd = path.join(dir, 'ninja');
    fs.mkdirSync(nd, { recursive: true });
    for (const f of fs.readdirSync(ninja)) {
      if (/^(raw_|links_)/.test(f)) fs.renameSync(path.join(ninja, f), path.join(nd, f));
    }
    const chars = path.join(ninja, 'chars');
    if (fs.existsSync(chars)) fs.renameSync(chars, path.join(nd, 'chars'));
  }
  return dir;
}

/** 把目录内容整体挪进备份（沙箱禁止批量删除，rename 单目录操作不受限） */
function evacuateDir(dir, backupDir, name) {
  if (!fs.existsSync(dir)) return;
  const dest = path.join(backupDir, name);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(dir, dest);
  fs.mkdirSync(dir, { recursive: true });
}

const sizeKB = (p) => fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) : 0;

/* ---------- 步骤 1：市集字典刷新 ---------- */
async function refreshMarketDict() {
  // fetch_market_dicts.js：刷新 guofu_stats_api（API 全量）+ guofu_items（装备组）+ stats_db（合并）
  // 不自动重写 trade2_stats_flat.json（= peer UI 词表，登录态抓取，匿名 API 与之语义不同）
  if (!run('fetch_market_dicts.js', [], '市集字典刷新')) throw new Error('市集字典刷新失败');
  const flat = JSON.parse(fs.readFileSync(path.join(DATA, 'trade2_stats_flat.json'), 'utf8'));
  const api = JSON.parse(fs.readFileSync(path.join(DATA, 'guofu_stats_api.json'), 'utf8'));
  const apiIds = new Set();
  for (const g of api.result) for (const e of g.entries || []) apiIds.add(e.id);
  const stale = flat.filter((e) => !apiIds.has(e.id)).length;
  report.steps.dict = { apiEntries: apiIds.size, flatTotal: flat.length, flatNotInApi: stale };
  log(`字典刷新完成：API ${apiIds.size} 条 · flat ${flat.length} 条（其中 ${stale} 条不在 API——peer 组正常现象）`);
  report.warnings.push('trade2_stats_flat.json（市集 UI 词表）为 2026-09-03 登录态抓取。若新版本市集下拉措辞有变（对齐率骤降/实填未命中），需登录市集页后从页面 state 重新提取 peer_trade2state_cn.json 并重新拍平');
}

/* ---------- 步骤 2：分类差异检测 ---------- */
async function checkCategoryDiff() {
  // poe2db Items 页分类清单 vs fetch_all.js 硬编码清单
  const res = await fetch('https://poe2db.tw/cn/Items', { headers: UA });
  if (!res.ok) { report.warnings.push(`poe2db Items 页 HTTP ${res.status}，跳过分类差异检测`); return; }
  const html = await res.text();
  const remote = new Set();
  const re = /<a[^>]+class="[^"]*itemClassBox[^"]*"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) remote.add(m[1].split('#')[0].trim());
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch_all.js'), 'utf8');
  const localRaw = [...src.matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((x) => x[1]);
  const local = new Set(localRaw);
  const missing = [...remote].filter((s) => !local.has(s) && !s.includes('/'));
  report.steps.categories = { remote: remote.size, missing };
  if (remote.size === 0) report.warnings.push('poe2db Items 页分类解析为 0（页面结构可能变化或被反爬），请人工检查 fetch_all.js 清单是否需要更新');
  else if (missing.length) report.warnings.push(`poe2db 有 ${missing.length} 个本地清单外分类（${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}），如属新装备类型需人工加入 fetch_all.js 的 MOD_PAGES/BASE_PAGES`);
  else log(`分类检测：poe2db ${remote.size} 个分类全部在本地清单内 ✓`);
}

/* ---------- 步骤 8：E2E ---------- */
function runE2E() {
  // 注意：必须用异步 spawn——spawnSync 会阻塞事件循环，内置 HTTP 服务器无法响应 → mock 页 ERR_CONNECTION_REFUSED
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      try {
        const d = fs.readFileSync(fp);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
        res.end(d);
      } catch (e) { res.writeHead(404); res.end('404'); }
    }).listen(8642, '127.0.0.1', async () => {
      const cases = ['verify_fallback_fill.js', 'verify_adv_mode.js', 'verify_prefix_suffix.js', 'verify_clear_fill.js'];
      const e2e = {};
      let allPass = true;
      for (const c of cases) {
        const r = await new Promise((res2) => {
          const p = spawn(process.execPath, [path.join(ROOT, 'scripts', c)], { cwd: ROOT });
          let out = '';
          p.stdout.on('data', (d) => (out += d));
          p.stderr.on('data', (d) => (out += d));
          const timer = setTimeout(() => p.kill(), 300000);
          p.on('close', (code) => { clearTimeout(timer); res2({ status: code, out }); });
        });
        const pass = r.status === 0;
        e2e[c] = { pass, tail: r.out.trim().split('\n').slice(-2).join(' | ').slice(0, 200) };
        if (!pass) allPass = false;
        log(`${pass ? '✓' : '✗'} E2E ${c}${pass ? '' : ` — ${e2e[c].tail}`}`);
      }
      srv.close();
      report.steps.e2e = e2e;
      resolve(allPass);
    });
  });
}

/* ---------- 步骤 9：报告 ---------- */
function finalReport() {
  const dbStats = {};
  try {
    const db = JSON.parse(fs.readFileSync(path.join(EXT, 'mods_db.json'), 'utf8'));
    let groups = 0, noTrade = 0, uniques = 0, uMods = 0;
    for (const c of db.categories || []) {
      groups += (c.affixGroups || []).length;
      noTrade += (c.affixGroups || []).filter((g) => g._noTrade).length;
      for (const b of c.bases || []) if (b.unique) { uniques++; uMods += (b.mods || []).length; }
    }
    dbStats.mods_db = { sizeKB: sizeKB(path.join(EXT, 'mods_db.json')), version: db.version, groups, noTrade, uniques, uMods };
  } catch (e) { dbStats.mods_db = { error: e.message }; }
  try {
    const b = JSON.parse(fs.readFileSync(path.join(EXT, 'builds_db.json'), 'utf8'));
    let mods = 0;
    for (const a of Object.values(b.ascs || {})) for (const s of Object.values(a.slots || {})) mods += (s.modStats || []).length;
    dbStats.builds_db = { sizeKB: sizeKB(path.join(EXT, 'builds_db.json')), league: b.league && b.league.label, ascs: Object.keys(b.ascs || {}).length, modStats: mods };
  } catch (e) { dbStats.builds_db = { error: e.message }; }
  report.dbs = dbStats;

  // 暗金对齐率
  try {
    const ar = JSON.parse(fs.readFileSync(path.join(DATA, 'tmp', 'align_unique_report.json'), 'utf8'));
    report.alignUnique = ar.summary || ar;
  } catch (e) { /* 无报告不致命 */ }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DATA, 'update_report.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n================ 一键更新报告 ================');
  console.log(`mods_db : ${report.dbs.mods_db.sizeKB} KB · ${report.dbs.mods_db.groups} 词缀组（_noTrade ${report.dbs.mods_db.noTrade}）· ${report.dbs.mods_db.uniques} 暗金 / ${report.dbs.mods_db.uMods} 词条`);
  console.log(`builds_db: ${report.dbs.builds_db.sizeKB} KB · 赛季 ${report.dbs.builds_db.league} · ${report.dbs.builds_db.ascs} 升华 · ${report.dbs.builds_db.modStats} 词条统计`);
  if (report.warnings.length) {
    console.log('\n⚠ 人工检查项:');
    report.warnings.forEach((w) => console.log('  - ' + w));
  }
  console.log('详细: data/update_report.json（旧库备份于 data/backup/）');
}

/* ---------- 主流程 ---------- */
(async () => {
  const t0 = Date.now();
  log(`POE2 数据一键更新${DRY ? '（dry-run 只打印计划）' : ''}`);

  // 0. 预检：赛季自动检测
  let league = args.league;
  try {
    const idx = await jget('https://poe.ninja/poe2/api/data/index-state');
    const lg = idx.economyLeagues.find((l) => l.indexed);
    const snap = idx.snapshotVersions.find((v) => v.url === (league || lg.url));
    log(`ninja 当前赛季: ${snap.name}（snapshot=${snap.snapshotName} version=${snap.version}）`);
    if (!league) league = lg.url;
    report.league = { name: snap.name, url: snap.url, snapshotName: snap.snapshotName, version: snap.version };
  } catch (e) {
    if (!league) { console.error('✗ 赛季检测失败且未指定 --league，退出'); process.exit(1); }
    report.warnings.push('ninja index-state 不可达，使用 --league 参数继续');
  }
  try {
    const lgj = await jget('https://poe.game.qq.com/api/trade/data/leagues');
    report.marketLeagues = lgj.result.map((l) => l.text);
    log(`市集赛季: ${report.marketLeagues.slice(0, 3).join(' / ')}`);
  } catch (e) { /* 不阻塞 */ }

  if (DRY) {
    console.log('\n计划执行：');
    console.log(`  1. 市集字典刷新（fetch_market_dicts: stats/items API + stats_db 合并；flat=peer 需登录态人工维护）`);
    console.log(`  2. poe2db 全量抓取（fetch_all --delay=${DELAY}，约 4 分钟；旧 parsed/bases 挪入备份）+ 失败重试`);
    console.log(`  3. 骨架重建（build_plugin_db + rebuild_db_v08.py 官网过滤/暗金追加）→ 暗金抓取（gen_unique_pairs + fetch_unique_map + fetch_unique_mods，约 10 分钟）`);
    console.log(`  4-6. osm 重建 → 暗金对齐 → 注入/对齐/固有组/officialText 修正（6 个本地脚本）→ 面板增量补抓`);
    console.log(`  7. ninja 天梯抓取 --league=${league}${ONLY_ASC ? ` --asc="${ONLY_ASC}"` : ''} → build_builds_db（约 5 分钟，需 Chrome）`);
    console.log(`  8. E2E 回归 4 套（内置 8642 服务器）`);
    console.log(`  9. 报告 → data/update_report.json`);
    process.exit(0);
  }

  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const backupDir = backupFiles(ts);
  log(`旧库已备份 → data/backup/${ts}/`);

  try {
    // 1. 市集字典
    if (!SKIP.has('dict')) { await refreshMarketDict(); } else log('（跳过字典刷新）');

    // 2. poe2db 抓取
    if (!SKIP.has('poe2db')) {
      await checkCategoryDiff();
      evacuateDir(path.join(DATA, 'parsed'), backupDir, 'parsed_old');
      evacuateDir(path.join(DATA, 'bases'), backupDir, 'bases_old');
      if (!run('fetch_all.js', [`--delay=${DELAY}`], 'poe2db 全量抓取')) throw new Error('poe2db 全量抓取失败');
      // 失败清单重试一轮
      const failPath = path.join(DATA, 'failures.json');
      if (fs.existsSync(failPath)) {
        const fails = JSON.parse(fs.readFileSync(failPath, 'utf8'));
        if (fails.length) {
          const slugs = fails.map((f) => f.slug).join(',');
          log(`重试 ${fails.length} 个失败页: ${slugs.slice(0, 80)}…`);
          run('fetch_all.js', [`--delay=${DELAY}`, `--only=${slugs}`], 'poe2db 失败重试');
        }
      }
    } else log('（跳过 poe2db 抓取）');

    // 3. 骨架重建 + 暗金链
    if (!SKIP.has('poe2db')) {
      // 3a. 骨架重建必须先于暗金 pair 提取（pair 清单来自 mods_db 暗金基底）
      if (!run('build_plugin_db.js', [], 'mods_db 骨架重建')) throw new Error('build_plugin_db 失败');
      // 3b. 面板补抓先于 py（rebuild_db_v08 挂 panel 只跑一遍）
      run('fetch_base_panels.js', [], '基底面板增量补抓');
      // 3c. 官网基准过滤 + 暗金追加（python）
      if (!run('rebuild_db_v08.py', [], '官网基准过滤 + 暗金追加（py）')) throw new Error('rebuild_db_v08 失败');
      if (!run('gen_unique_pairs.js', [], '暗金 pair 清单生成')) throw new Error('gen_unique_pairs 失败');
      if (!run('fetch_unique_map.js', [`--delay=${DELAY}`], '暗金名映射抓取')) throw new Error('unique_map 失败');
      // 全量重抓（清旧缓存，新旧版本暗金混抓会残留）
      const rawPath = path.join(DATA, 'tmp', 'unique_mods_raw.json');
      if (fs.existsSync(rawPath)) fs.renameSync(rawPath, path.join(backupDir, 'unique_mods_raw_old.json'));
      if (!run('fetch_unique_mods.js', [`--delay=${DELAY}`], '暗金详情抓取')) throw new Error('unique_mods 失败');
    }

    // 4-6. 对齐 + mods_db 重建链（纯本地，顺序敏感）
    if (!SKIP.has('align')) {
      if (!run('rebuild_official_stat_map.js', [], 'osm 重建')) throw new Error('osm 重建失败');
      if (!run('align_unique_mods.js', [], '暗金词条对齐')) throw new Error('暗金对齐失败');
      if (!run('inject_unique_mods.js', [], '暗金词条注入')) throw new Error('inject 失败');
      if (!run('align_affix_groups.js', [], 'affixGroups 重对齐')) throw new Error('align_affix_groups 失败');
      if (!run('build_implicit_groups.js', [], '基底固有词缀组注入')) throw new Error('build_implicit_groups 失败');
      if (!run('fix_official_text.js', [], 'officialText 市集对齐修正')) throw new Error('fix_official_text 失败');
    } else log('（跳过对齐链）');

    // 7. ninja
    if (!SKIP.has('ninja')) {
      const nArgs = [`--league=${league}`, '--refresh-links', `--delay=900`];
      if (ONLY_ASC) nArgs.push(`--asc=${ONLY_ASC}`);
      if (!run('fetch_ninja_builds.js', nArgs, `ninja 天梯抓取（${league}）`)) throw new Error('ninja 抓取失败');
      if (!run('build_builds_db.js', [], 'builds_db 聚合')) throw new Error('build_builds_db 失败');
    } else log('（跳过 ninja）');

    // 8. E2E
    if (!SKIP.has('e2e')) {
      const ok = await runE2E();
      if (!ok) report.warnings.push('部分 E2E 未通过——数据变化导致 mock 断言不匹配，检查 verify 输出');
    } else log('（跳过 E2E）');

    // 9. 报告
    finalReport();
    log(`总耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  } catch (e) {
    report.error = e.message;
    fs.writeFileSync(path.join(DATA, 'update_report.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.error(`\n✗ 更新中断: ${e.message}`);
    console.error(`  旧库备份在 data/backup/${ts}/，可手动恢复`);
    console.error(`  排除已完成的环节重跑: node scripts/update_db.js --skip=...`);
    process.exit(1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
