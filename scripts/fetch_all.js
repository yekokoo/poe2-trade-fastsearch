#!/usr/bin/env node
/**
 * fetch_all.js — 全量抓取所有词缀页 + 基底分类页
 * 1) 词缀页（武器直抓 + 护甲属性变体页）→ 解析词缀池
 * 2) 基底页（如 Gloves）→ 解析非传奇基底列表（名称+slug）
 * 输出：data/parsed/*.json（词缀）、data/bases/*.json（基底）
 * 用法：node fetch_all.js [--delay=400]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARSED_DIR = path.join(ROOT, 'data', 'parsed');
const BASES_DIR = path.join(ROOT, 'data', 'bases');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const args = process.argv.slice(2);
const delayMs = Number((args.find((a) => a.startsWith('--delay=')) || '--delay=400').split('=')[1]) || 400;
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const onlySet = only ? new Set(only.split(',')) : null;

// ── 词缀页清单：武器/饰品直抓 + 护甲类属性变体 ──
const MOD_PAGES = [
  // 单手武器
  'Claws', 'Daggers', 'Wands', 'One_Hand_Swords', 'One_Hand_Axes', 'One_Hand_Maces', 'Sceptres', 'Spears', 'Flails',
  // 双手武器
  'Bows', 'Staves', 'Two_Hand_Swords', 'Two_Hand_Axes', 'Two_Hand_Maces', 'Quarterstaves', 'Crossbows', 'Talismans',
  // 副手
  'Quivers', 'Bucklers', 'Foci',
  // 盾牌属性变体
  'Shields_str', 'Shields_str_dex', 'Shields_str_int',
  // 护甲属性变体
  'Gloves_str', 'Gloves_dex', 'Gloves_int', 'Gloves_str_dex', 'Gloves_str_int', 'Gloves_dex_int',
  'Boots_str', 'Boots_dex', 'Boots_int', 'Boots_str_dex', 'Boots_str_int', 'Boots_dex_int',
  'Body_Armours_str', 'Body_Armours_dex', 'Body_Armours_int', 'Body_Armours_str_dex', 'Body_Armours_str_int', 'Body_Armours_dex_int', 'Body_Armours_str_dex_int',
  'Helmets_str', 'Helmets_dex', 'Helmets_int', 'Helmets_str_dex', 'Helmets_str_int', 'Helmets_dex_int',
  // 饰品
  'Amulets', 'Rings', 'Belts',
  // 药剂
  'Life_Flasks', 'Mana_Flasks', 'Charms',
  // 引路石/珠宝/遗物变体页（主页面无 ModsView JSON，必须抓变体页）
  'Waystones_low_tier', 'Waystones_mid_tier', 'Waystones_top_tier',
  'Ruby', 'Emerald', 'Sapphire', 'Diamond',
  'Urn_Relic', 'Amphora_Relic', 'Vase_Relic', 'Seal_Relic', 'Coffer_Relic', 'Tapestry_Relic', 'Incense_Relic',
];

// ── 基底页清单（用于界面基底下拉）──
const BASE_PAGES = [
  'Claws', 'Daggers', 'Wands', 'One_Hand_Swords', 'One_Hand_Axes', 'One_Hand_Maces', 'Sceptres', 'Spears', 'Flails',
  'Bows', 'Staves', 'Two_Hand_Swords', 'Two_Hand_Axes', 'Two_Hand_Maces', 'Quarterstaves', 'Crossbows', 'Talismans',
  'Quivers', 'Bucklers', 'Foci', 'Gloves', 'Boots', 'Body_Armours', 'Helmets',
  'Amulets', 'Rings', 'Belts', 'Life_Flasks', 'Mana_Flasks', 'Charms', 'Jewels',
  'Waystones', 'Relics',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if (res.status === 429) {
        console.log(`  429 rate-limited, wait 5s...`);
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// ── 从 parse_mods.js 复用的解析逻辑 ──
function extractModsViewJson(html) {
  const start = html.indexOf('new ModsView(');
  if (start < 0) throw new Error('ModsView not found');
  let i = html.indexOf('{', start);
  let depth = 0, inStr = false, esc = false;
  const begin = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(begin, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

function normalizeStr(strHtml) {
  return strHtml
    .replace(/<span class="ndash">[\s\S]*?<\/span>/g, '—')
    .replace(/<span class='mod-value'>[\s\S]*?<\/span>/g, (m) => m.replace(/<[^>]+>/g, ''))
    .replace(/<span class="mod-value">[\s\S]*?<\/span>/g, (m) => m.replace(/<[^>]+>/g, ''))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .replace(/[(（]?\d+(?:\.\d+)?—\d+(?:\.\d+)?[)）]?/g, '#')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .trim();
}

function extractValues(strHtml) {
  const plain = strHtml.replace(/<span class="ndash">[^<]*<\/span>/g, '—').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const nums = [...plain.matchAll(/[\(（]?([0-9]+(?:\.[0-9]+)?)((—|‑|–|-)([0-9]+(?:\.[0-9]+)?))?[\)）]?%?/g)]
    .map((m) => (m[4] ? [Number(m[1]), Number(m[4])] : [Number(m[1])]))
    .filter((v) => !Number.isNaN(v[0]));
  return nums;
}

function stripHtml(html) {
  return html
    .replace(/<span class="ndash">[^<]*<\/span>/g, '—')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE_MAP = {
  normal: { source: 'base', label: '基础' },
  desecrated: { source: 'desecrated', label: '渎灵' },
  destruction: { source: 'destruction', label: '斯鲁德的神力' },
  corrupted: { source: 'corrupted', label: '瓦尔腐化' },
  essence: { source: 'essence', label: '精华' },
  perfect_essence: { source: 'essence', label: '完美精华' },
  corruption_upgrade: { source: 'corrupted', label: '腐化升级' },
  bonded: { source: 'bonded', label: '命定' },
};

function parseEntries(arr, source, sourceLabel) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const e of arr) {
    const entryType = e.type || 'mod';
    const genType = Number(e.ModGenerationTypeID ?? -1);
    const preSuf = genType === 1 ? 'prefix' : genType === 2 ? 'suffix' : genType === 5 ? 'corrupted' : 'special';
    let src = source, label = sourceLabel;
    if (/^Alloy/i.test(e.Code || '')) {
      src = 'alloy';
      label = '合金';
    }
    out.push({
      source: src, sourceLabel: label, entryType, preSuf,
      ilvl: Number(e.Level ?? 0) || 0,
      weight: Number(e.DropChance ?? 0) || 0,
      name: (e.Name || '').replace(/<[^>]+>/g, ''),
      family: e.ModFamilyList || [], code: e.Code || '',
      text: e.str || '', template: normalizeStr(e.str || ''),
      values: extractValues(e.str || ''),
      isAlloy: /^Alloy/i.test(e.Code || ''),
    });
  }
  return out;
}

function buildAffixGroups(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.entryType !== 'mod' && e.entryType !== 'misc' && e.entryType !== 'essence' && e.entryType !== 'Desecrated') continue;
    const key = `${e.preSuf}|${e.template}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const result = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => b.ilvl - a.ilvl || b.weight - a.weight);
    const tiers = list.map((e, idx) => ({
      tier: idx + 1, ilvl: e.ilvl, weight: e.weight, values: e.values, text: stripHtml(e.text),
    }));
    result.push({
      id: key, preSuf: list[0].preSuf, source: list[0].source,
      template: list[0].template, text: stripHtml(list[0].text),
      minIlvl: tiers[tiers.length - 1].ilvl, maxIlvl: tiers[0].ilvl,
      tierCount: tiers.length, tiers,
    });
  }
  result.sort((a, b) => (a.preSuf === b.preSuf ? a.template.localeCompare(b.template) : a.preSuf.localeCompare(b.preSuf)));
  return result;
}

/** 基底页解析：非传奇物品卡片（whiteitem <类名> 链接 + 名称） */
function parseBases(html) {
  const bases = [];
  const seen = new Set();
  // 卡片结构：区块 div（如 id="手套物品"）内，<a class="whiteitem Gloves" href="Tempered_Mitts">淬炼护手</a>
  // 同一物品出现两次（图+名），用 seen 去重；只取有文本的锚点
  const re = /<a class="whiteitem ([A-Za-z_ ]+)" data-hover="[^"]*" href="([A-Za-z_][A-Za-z0-9_]*)">([^<]{1,40})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    const name = m[3].trim();
    if (!name) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    bases.push({ slug, name });
  }
  return bases;
}

(async () => {
  fs.mkdirSync(PARSED_DIR, { recursive: true });
  fs.mkdirSync(BASES_DIR, { recursive: true });

  let okCount = 0, failCount = 0;
  const failures = [];

  // ── Part 1: 词缀页 ──
  console.log(`\n========== 词缀页 ${MOD_PAGES.length} 个 ==========`);
  for (const slug of MOD_PAGES) {
    if (onlySet && !onlySet.has(slug)) continue;
    process.stdout.write(`[${new Date().toTimeString().slice(0, 8)}] ${slug} ... `);
    try {
      const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
      const jsonText = extractModsViewJson(html);
      const data = JSON.parse(jsonText);
      const title = (html.match(/<title>([^<]+)/) || [])[1] || '';
      const allEntries = [];
      for (const [groupKey, meta] of Object.entries(SOURCE_MAP)) {
        const entries = parseEntries(data[groupKey], meta.source, meta.label);
        entries.forEach((e) => (e.group = groupKey));
        allEntries.push(...entries);
      }
      const affixGroups = buildAffixGroups(allEntries);
      const parsed = {
        slug,
        cnName: title.replace(/ - .*/, '').trim(),
        fetchedAt: new Date().toISOString(),
        groupCounts: Object.fromEntries(Object.keys(SOURCE_MAP).map((k) => [k, (data[k] || []).length])),
        affixGroups,
        socketable: data.socketable || [],
        essence: data.essence || [],
        perfect_essence: data.perfect_essence || [],
      };
      fs.writeFileSync(path.join(PARSED_DIR, `${slug}.json`), JSON.stringify(parsed, null, 1), 'utf-8');
      console.log(`OK ${affixGroups.length}组 (前${affixGroups.filter((g) => g.preSuf === 'prefix').length}/后${affixGroups.filter((g) => g.preSuf === 'suffix').length})`);
      okCount++;
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      failures.push({ slug, kind: 'mods', error: e.message });
      failCount++;
    }
    await sleep(delayMs);
  }

  // ── Part 2: 基底页 ──
  console.log(`\n========== 基底页 ${BASE_PAGES.length} 个 ==========`);
  for (const slug of BASE_PAGES) {
    if (onlySet && !onlySet.has(slug)) continue;
    process.stdout.write(`[${new Date().toTimeString().slice(0, 8)}] ${slug} ... `);
    try {
      const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
      const bases = parseBases(html);
      const title = (html.match(/<title>([^<]+)/) || [])[1] || '';
      fs.writeFileSync(path.join(BASES_DIR, `${slug}.json`), JSON.stringify({ slug, cnName: title.replace(/ - .*/, '').trim(), fetchedAt: new Date().toISOString(), bases }, null, 1), 'utf-8');
      console.log(`OK ${bases.length} 基底`);
      okCount++;
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      failures.push({ slug, kind: 'bases', error: e.message });
      failCount++;
    }
    await sleep(delayMs);
  }

  console.log(`\n========== 完成 ==========`);
  console.log(`成功 ${okCount}，失败 ${failCount}`);
  if (failures.length) {
    fs.writeFileSync(path.join(ROOT, 'data', 'failures.json'), JSON.stringify(failures, null, 2), 'utf-8');
    console.log('失败清单已写入 data/failures.json:');
    failures.forEach((f) => console.log(`  ${f.slug} [${f.kind}] ${f.error}`));
  }
})();
