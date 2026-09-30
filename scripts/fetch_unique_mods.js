#!/usr/bin/env node
/**
 * fetch_unique_mods.js — 抓取每个暗金详情页，解析固定词条
 * 输入：data/tmp/unique_name_map.json（中文名|底材 → poe2db slug）
 * 输出：data/tmp/unique_mods_raw.json  { pairKey: { slug, name, type, mods:[{kind, text, statsKey[]}...] } }
 * 词条来源：详情页 UniquePopup box 的 implicitMod/explicitMod 文本 + Attr 区每词条卡的内部英文 stat id
 * 用法：node fetch_unique_mods.js [--delay=500] [--only pairKey1,pairKey2]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'tmp', 'unique_mods_raw.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const args = process.argv.slice(2);
const delayMs = Number((args.find((a) => a.startsWith('--delay=')) || '--delay=500').split('=')[1]) || 500;
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const onlySet = onlyArg ? new Set(onlyArg.split(',')) : null;

/* 名字/底材翻译差异手工映射（官方国服名 → poe2db 汉化名），键 = mods_db pair，值 = poe2db slug */
const MANUAL_SLUG = {
  '豪侠骑士|锁链战靴': 'The_Knight-errant',
  '豪侠骑士|符文师匠锁链战靴': 'The_Knight-errant',
  '轰天雷|万用裹手': 'Thunderfist',
  '轰天雷|符文师匠万用裹手': 'Thunderfist',
  '寒冬噬咬|玻璃利片': 'Winters_Bite',
  '赤红短刃|短剑': 'Redbeak',
};
/* 官方有但 poe2db 0.3 无页面的 PoE1 遗产暗金（无词条数据，跳过） */
const NO_DATA = new Set(['主宰之握|锁魂束带', '征途之士|劫掠之铠', '幽蓝毒舌|短剑']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if (res.status === 429) { console.log('  429, wait 6s'); await sleep(6000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

/** 剥标签 → 纯文本（保留 mod-value 数字，去 ndash 等） */
function plain(html) {
  return html
    .replace(/<span class=["']ndash["']>[\s\S]*?<\/span>/g, '—')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析详情页 → { mods:[{kind,text,stats[]}], grantSkills:[...], implicit 数值块等按 kind 区分 */
function parseUniquePage(html) {
  // 1) 词条区：第一个 UniquePopup box
  const boxStart = html.indexOf('UniquePopup');
  if (boxStart < 0) return null;
  const boxEnd = html.indexOf('FlavourText', boxStart);
  const box = html.slice(boxStart, boxEnd > 0 ? boxEnd : boxStart + 40000);

  const mods = [];
  const re = /class="(implicitMod|explicitMod)">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(box))) {
    const text = plain(m[2]);
    if (!text) continue;
    mods.push({ kind: m[1] === 'implicitMod' ? 'implicit' : 'explicit', text });
  }

  // 2) Attr 区：每词条卡的内部英文 stat id（Stats<li>第一段，如 base maximum life）
  const attrStart = html.indexOf('Attr /');
  const statsByHead = new Map(); // 归一化词条文本(数字→#) → [英文 stat…]
  if (attrStart >= 0) {
    const seg = html.slice(attrStart, attrStart + 60000);
    const cards = [...seg.matchAll(/<span class='item_magic'>([\s\S]*?)<\/span>\s*<\/h5>\s*<table[\s\S]*?<\/table>/g)];
    for (const c of cards) {
      const head = plain(c[1]);
      if (!head) continue;
      const sig = head.replace(/\([^)]*\)/g, (s) => s.replace(/\d+—?\d*/g, '#')).replace(/\d+—\d+/g, '#').replace(/(?<![—\d])\d+(?![\d—%])/g, '#').replace(/#+/g, '#');
      const stats = [...c[0].matchAll(/<li>([a-z0-9_% +\[\]|]+)/gi)].map((x) => x[1].trim());
      if (stats.length) {
        const arr = statsByHead.get(sig) || [];
        for (const s of stats) if (!arr.includes(s)) arr.push(s);
        statsByHead.set(sig, arr);
      }
    }
  }
  // 词条文本 → 内部 stat 关联：用同样归一方式匹配
  for (const mod of mods) {
    const sig = mod.text.replace(/\([^)]*\)/g, (s) => s.replace(/\d+—?\d*/g, '#')).replace(/\d+—\d+/g, '#').replace(/(?<![—\d])\d+(?![\d—%])/g, '#').replace(/#+/g, '#');
    if (statsByHead.has(sig)) mod.stats = statsByHead.get(sig);
  }
  return { mods, statsByHead: [...statsByHead.entries()] };
}

(async () => {
  const nameMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'unique_name_map.json'), 'utf8'));
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

  // 用匹配链覆盖 mods_db 的全部 pair
  const pairs = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'unique_pairs.json'), 'utf8')));
  const nameOnly = {};
  Object.entries(nameMap).forEach(([k, v]) => { const n = k.split('|')[0]; (nameOnly[n] = nameOnly[n] || new Set()).add(v); });
  const pairSlug = {};
  let unmapped = [];
  for (const p of pairs) {
    if (p.startsWith('未完成|')) continue;              // 官方占位，无词条
    if (NO_DATA.has(p)) continue;                       // poe2db 无页面
    const [name, type] = p.split('|');
    let slug = nameMap[p]
      || nameMap[name + '|' + type.replace(/^符文师匠|^符文/, '')]
      || MANUAL_SLUG[p];
    if (!slug && nameOnly[name] && nameOnly[name].size === 1) slug = [...nameOnly[name]][0];
    if (!slug) { unmapped.push(p); continue; }
    pairSlug[p] = Array.isArray(slug) ? slug[0] : slug;
  }
  console.log('pairs to fetch:', Object.keys(pairSlug).length, '· unmapped:', unmapped.length);
  if (unmapped.length) console.log('unmapped:', unmapped.join(' ; '));

  let done = 0, fail = 0, noMods = 0;
  for (const [pair, slug] of Object.entries(pairSlug)) {
    if (onlySet && !onlySet.has(pair)) continue;
    if (out[pair] && out[pair].mods && out[pair].mods.length) { done++; continue; } // 已有则跳过（断点续跑）
    process.stdout.write(`[${++done}/${Object.keys(pairSlug).length}] ${pair} -> ${slug} ... `);
    try {
      const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
      const parsed = parseUniquePage(html);
      if (!parsed || !parsed.mods.length) { noMods++; console.log('NO MODS'); out[pair] = { slug, mods: [] }; continue; }
      out[pair] = { slug, mods: parsed.mods };
      console.log(`${parsed.mods.length} mods`);
    } catch (e) {
      fail++; console.log('FAIL ' + e.message);
      out[pair] = { slug, error: e.message };
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    await sleep(delayMs);
  }
  console.log(`\nDone. ok:${Object.keys(out).filter((k) => out[k].mods && out[k].mods.length).length} noMods:${noMods} fail:${fail}`);
})();
