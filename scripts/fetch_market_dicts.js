#!/usr/bin/env node
/** fetch_market_dicts.js — 刷新国服市集匿名 API 字典（一键更新管线 步骤①）
 *
 * 刷新：
 *   data/guofu_stats_api.json   市集 stats API 全量（14 组，17720 条，0.5.5 已含新词条）
 *   data/guofu_items.json       市集 items API 装备组（accessory/armour/weapon/flask/jewel/map/card/currency/gem，
 *                               剔除 POE1 遗产组 heist/sentinel 等）——rebuild_db_v08.py 的官网基准
 *   extension/data/stats_db.json 合并 API 新增 stat_id → 中文（纯字典追加，不删旧条目）
 *
 * 不动 data/trade2_stats_flat.json（市集 UI 词表 = 登录态页面 state 抓取，见 update_db 报告提示）。
 * 运行：node scripts/fetch_market_dicts.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const EXT = path.join(ROOT, 'extension', 'data');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0', 'Accept-Language': 'zh-CN,zh;q=0.9' };

/** items API 只保留装备相关组（与旧 guofu_items.json 语义一致） */
const ITEM_GROUPS = ['accessory', 'armour', 'weapon', 'flask', 'jewel', 'map', 'card', 'currency', 'gem'];

async function jget(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

(async () => {
  // 1. stats API
  console.log('拉取市集 stats API …');
  const stats = await jget('https://poe.game.qq.com/api/trade/data/stats');
  fs.writeFileSync(path.join(DATA, 'guofu_stats_api.json'), JSON.stringify(stats), 'utf-8');
  let statCount = 0;
  for (const g of stats.result) statCount += (g.entries || []).length;
  console.log(`  guofu_stats_api.json: ${stats.result.length} 组 / ${statCount} 条`);

  // 2. items API（装备组过滤）
  console.log('拉取市集 items API …');
  const items = await jget('https://poe.game.qq.com/api/trade/data/items');
  const kept = items.result.filter((g) => ITEM_GROUPS.includes(g.id));
  let itemCount = 0, uniqCount = 0;
  for (const g of kept) {
    itemCount += (g.entries || []).length;
    for (const e of g.entries || []) if (e.flags && e.flags.unique) uniqCount++;
  }
  fs.writeFileSync(path.join(DATA, 'guofu_items.json'), JSON.stringify({ result: kept }), 'utf-8');
  console.log(`  guofu_items.json: ${kept.length} 组 / ${itemCount} 条（暗金 ${uniqCount}）`);

  // 3. stats_db.json 合并新增 id（不删旧：peer 组 rune/desecrated/skill 只在旧 stats_db 里）
  const sdbPath = path.join(EXT, 'stats_db.json');
  const sdb = JSON.parse(fs.readFileSync(sdbPath, 'utf8'));
  const byId = new Map(sdb.stats.map((s) => [s.id, s]));
  let added = 0, updated = 0;
  for (const g of stats.result) {
    for (const e of g.entries || []) {
      const old = byId.get(e.id);
      if (!old) { byId.set(e.id, e); added++; }
      else if (old.text !== e.text) { byId.set(e.id, e); updated++; }
    }
  }
  sdb.stats = [...byId.values()];
  sdb.version = 'guofu-merged-' + new Date().toISOString().slice(0, 10);
  sdb.source = 'UI dump + official API merged（update_db 自动维护）';
  fs.writeFileSync(sdbPath, JSON.stringify(sdb), 'utf-8');
  console.log(`  stats_db.json: ${sdb.stats.length} 条（新增 ${added} / 更新 ${updated}）`);
  console.log('完成。trade2_stats_flat.json 未动（登录态 UI 词表，需人工重抓时见 update_db 报告提示）');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
