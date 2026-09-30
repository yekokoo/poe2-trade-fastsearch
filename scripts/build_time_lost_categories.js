/**
 * build_time_lost_categories.js — Phase C：失落的珠宝独立分类构建。
 *
 * 背景（用户报告 + poe2db 实况）：
 *   失落的蓝玉/红玉/翡翠/宝钻 在 poe2db 是独立页面（Time-Lost_Sapphire 等），
 *   词缀池全是「范围内的小型/核心天赋…」天赋圈词缀，与普通珠宝 58 条独立词缀完全不同。
 *   老数据把它们塞进 Sapphire/Ruby/Emerald/Diamond 分类共享词缀池 → 全错。
 *
 * 动作（幂等，可重复运行）：
 *   1. 解析 data/raw/Time_Lost_*.json（已抓好）→ data/parsed/Time_Lost_*.json
 *      来源映射：normal→base基础 / desecrated→渎灵 / corrupted→瓦尔 /
 *                corruption_upgrade→腐化升级 / liquid→liquid 液化情感（新来源）
 *      注：normal 里的「将范围升级为中型/大型/极大型」是 local 半径词缀（无 ModGenerationTypeID）
 *   2. db 新增 4 分类：slug=Time_Lost_Sapphire 等，baseSlug='Jewels'，group='珠宝'
 *      bases：普通基底 = 失落的X（name）；暗金「抗衡黑暗 失落的宝钻」从 Diamond 迁入 Time_Lost_Diamond
 *   3. 从 Sapphire/Ruby/Emerald/Diamond 分类 bases 里移除 失落的X
 *   4. db.sources 加 liquid 说明；version 不在这里动（由 align/inject 流水线递增）
 *
 * 运行：node scripts/build_time_lost_categories.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const PARSED_DIR = path.join(ROOT, 'data', 'parsed');
const DB_PATH = path.join(ROOT, 'extension', 'data', 'mods_db.json');

const PAGES = [
  { slug: 'Time_Lost_Sapphire', cn: '失落的蓝玉', baseName: '失落的蓝玉', rawBase: 'Time-Lost Sapphire' },
  { slug: 'Time_Lost_Ruby', cn: '失落的红玉', baseName: '失落的红玉', rawBase: 'Time-Lost Ruby' },
  { slug: 'Time_Lost_Emerald', cn: '失落的翡翠', baseName: '失落的翡翠', rawBase: 'Time-Lost Emerald' },
  { slug: 'Time_Lost_Diamond', cn: '失落的宝钻', baseName: '失落的宝钻', rawBase: 'Time-Lost Diamond' },
];

/* 来源映射（对齐 parse_mods.js SOURCE_MAP + 新增 liquid） */
const SOURCE_MAP = {
  normal: { source: 'base', label: '基础' },
  desecrated: { source: 'desecrated', label: '渎灵' },
  corrupted: { source: 'corrupted', label: '瓦尔腐化' },
  corruption_upgrade: { source: 'corrupted', label: '腐化升级' },
  liquid: { source: 'liquid', label: '液化情感' },
};

/* ---------- 复用 parse_mods.js 的解析逻辑 ---------- */
function normalizeStr(strHtml) {
  return String(strHtml || '')
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
  const plain = String(strHtml || '').replace(/<span class="ndash">[^<]*<\/span>/g, '—').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const nums = [...plain.matchAll(/[\(（]?([0-9]+(?:\.[0-9]+)?)((—|‑|–|-)([0-9]+(?:\.[0-9]+)?))?[\)）]?%?/g)]
    .map((m) => (m[4] ? [Number(m[1]), Number(m[4])] : [Number(m[1])]))
    .filter((v) => !Number.isNaN(v[0]));
  return nums;
}
function stripHtml(html) {
  return String(html || '')
    .replace(/<span class="ndash">[^<]*<\/span>/g, '—')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseEntries(arr, source, sourceLabel) {
  if (!Array.isArray(arr)) return [];
  return arr.map((e) => {
    const genType = Number(e.ModGenerationTypeID ?? -1);
    const preSuf = genType === 1 ? 'prefix' : genType === 2 ? 'suffix' : genType === 5 ? 'corrupted' : 'special';
    return {
      source, sourceLabel,
      entryType: e.type || 'mod',
      preSuf,
      ilvl: Number(e.Level ?? 0) || 0,
      weight: Number(e.DropChance ?? 0) || 0,
      name: (e.Name || '').replace(/<[^>]+>/g, ''),
      family: e.ModFamilyList || [],
      code: e.Code || '',
      text: e.str || '',
      template: normalizeStr(e.str || ''),
      values: extractValues(e.str || ''),
    };
  });
}
function buildAffixGroups(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!['mod', 'misc', 'essence', 'Desecrated'].includes(e.entryType)) continue;
    const key = `${e.preSuf}|${e.template}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const result = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => b.ilvl - a.ilvl || b.weight - a.weight);
    const tiers = list.map((e, idx) => ({ tier: idx + 1, ilvl: e.ilvl, weight: e.weight, values: e.values, text: stripHtml(e.text) }));
    result.push({
      id: key,
      preSuf: list[0].preSuf,
      source: list[0].source,
      sourceLabel: list[0].sourceLabel,
      template: list[0].template,
      text: stripHtml(list[0].text),
      minIlvl: tiers[tiers.length - 1].ilvl,
      maxIlvl: tiers[0].ilvl,
      tierCount: tiers.length,
      tiers,
    });
  }
  result.sort((a, b) => (a.preSuf === b.preSuf ? a.template.localeCompare(b.template) : a.preSuf.localeCompare(b.preSuf)));
  return result;
}

function main() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const report = { built: [], movedUniques: [], removedBases: [] };

  for (const page of PAGES) {
    const rawPath = path.join(RAW_DIR, page.slug + '.json');
    if (!fs.existsSync(rawPath)) { console.error('缺少原始数据:', rawPath); process.exit(1); }
    const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

    /* 1. 解析 → parsed 留档 */
    const allEntries = [];
    const groupCounts = {};
    for (const [groupKey, meta] of Object.entries(SOURCE_MAP)) {
      const entries = parseEntries(data[groupKey], meta.source, meta.label);
      entries.forEach((e) => (e.group = groupKey));
      groupCounts[groupKey] = entries.length;
      allEntries.push(...entries);
    }
    const affixGroups = buildAffixGroups(allEntries);
    const parsed = {
      slug: page.slug, cnName: page.cn, fetchedAt: new Date().toISOString(),
      rawBase: data.baseitem && data.baseitem.Code,
      groupCounts,
      affixCount: affixGroups.length,
      prefixCount: affixGroups.filter((g) => g.preSuf === 'prefix').length,
      suffixCount: affixGroups.filter((g) => g.preSuf === 'suffix').length,
      affixGroups,
      socketable: [],
    };
    fs.writeFileSync(path.join(PARSED_DIR, page.slug + '.json'), JSON.stringify(parsed, null, 1));
    console.log(`${page.slug}: ${affixGroups.length} 组 (${Object.entries(groupCounts).map(([k, v]) => k + ':' + v).join(' ')})`);

    /* 2. 构建分类（幂等：先删旧的） */
    db.categories = db.categories.filter((c) => c.slug !== page.slug);
    const cat = {
      slug: page.slug,
      baseSlug: 'Jewels',
      variant: null,
      cnName: '珠宝·' + page.cn,
      group: '珠宝',
      affixGroups: affixGroups.map((g) => ({
        id: g.id, preSuf: g.preSuf, source: g.source, template: g.template, text: g.text,
        minIlvl: g.minIlvl, maxIlvl: g.maxIlvl, tierCount: g.tierCount,
        tiers: g.tiers.map((t) => ({ tier: t.tier, ilvl: t.ilvl, values: t.values })),
      })),
      bases: [{ slug: 'TL_' + page.slug, name: page.baseName, props: {} }],
      socketable: [],
    };
    db.categories.push(cat);
    report.built.push({ slug: page.slug, affixGroups: affixGroups.length });
  }

  /* 3. 从普通珠宝分类移除 失落的X 基底 */
  const tlNames = new Set(PAGES.map((p) => p.baseName));
  for (const c of db.categories) {
    if (!['Sapphire', 'Ruby', 'Emerald', 'Diamond'].includes(c.slug)) continue;
    const before = c.bases.length;
    c.bases = c.bases.filter((b) => !tlNames.has(b.name));
    if (c.bases.length !== before) report.removedBases.push({ cat: c.slug, removed: before - c.bases.length });
  }

  /* 3b. 暗金「抗衡黑暗 失落的宝钻」迁到 Time_Lost_Diamond */
  const uqName = '抗衡黑暗 失落的宝钻';
  for (const c of db.categories) {
    if (c.slug !== 'Diamond') continue;
    const hit = c.bases.find((b) => b.unique && b.text === uqName);
    if (hit) {
      c.bases = c.bases.filter((b) => b !== hit);
      const tl = db.categories.find((c2) => c2.slug === 'Time_Lost_Diamond');
      if (!tl.bases.some((b) => b.text === uqName)) tl.bases.push(hit);
      report.movedUniques.push(uqName);
    }
  }

  /* 4. sources 说明 */
  db.sources = Object.assign({}, db.sources, {
    timeLost: 'poe2db Time-Lost_* 独立页（范围内天赋圈词缀），scripts/build_time_lost_categories.js',
    liquid: '液化情感（Liquid Emotions）灌注词缀（失落的珠宝限定来源）',
  });

  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  fs.writeFileSync(path.join(ROOT, 'data', 'tmp', 'build_time_lost_report.json'), JSON.stringify(report, null, 1));
  console.log('构建完成:', JSON.stringify(report));
  console.log('分类总数:', db.categories.length);
}

main();
