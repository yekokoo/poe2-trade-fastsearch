#!/usr/bin/env node
/**
 * parse_one.js — 从 stdin 读取页面HTML，解析单个分类并写 data/parsed/<slug>.json
 * 由 fetch_all.js 调用；也可手动：node parse_one.js <slug> < htmlfile
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARSED_DIR = path.join(ROOT, 'data', 'parsed');
const RAW_DIR = path.join(ROOT, 'data', 'raw');

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

/** 从HTML中括号平衡地提取 new ModsView({...}) 的JSON文本（兼容换行/空白变体） */
function extractModsViewJson(html) {
  let start = html.search(/new\s+ModsView\s*\(/);
  if (start < 0) {
    // 兜底：部分页面JSON直接内联（以{"baseitem"开头）
    const bi = html.indexOf('{"baseitem"');
    if (bi >= 0) start = bi;
    else throw new Error('ModsView not found');
  }
  const braceAt = html.indexOf('{', start);
  let i = braceAt;
  let depth = 0, inStr = false, esc = false;
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
      if (depth === 0) return html.slice(braceAt, i + 1);
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

function parseEntries(arr, source, sourceLabel) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const e of arr) {
    const entryType = e.type || 'mod';
    const genType = Number(e.ModGenerationTypeID ?? -1);
    const preSuf = genType === 1 ? 'prefix' : genType === 2 ? 'suffix' : genType === 5 ? 'corrupted' : 'special';
    let src = source, label = sourceLabel;
    if (/^Alloy/i.test(e.Code || '')) { src = 'alloy'; label = '合金'; }
    out.push({
      source: src, sourceLabel: label, entryType, preSuf,
      ilvl: Number(e.Level ?? 0) || 0,
      weight: Number(e.DropChance ?? 0) || 0,
      name: (e.Name || '').replace(/<[^>]+>/g, ''),
      family: e.ModFamilyList || [],
      code: e.Code || '',
      text: e.str || '',
      template: normalizeStr(e.str || ''),
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
      tier: idx + 1,
      ilvl: e.ilvl,
      weight: e.weight,
      values: e.values,
      text: stripHtml(e.text),
    }));
    result.push({
      id: key,
      preSuf: list[0].preSuf,
      source: list[0].source,
      sourceLabel: list[0].sourceLabel,
      isAlloy: list.some((e) => e.isAlloy),
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

function parseBases(html) {
  const seen = new Map();
  const re = /<a\s+class="whiteitem[^"]*"[^>]*href="([A-Za-z_]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const tail = html.slice(re.lastIndex, re.lastIndex + 5000);
    const imgM = tail.match(/<img[^>]*src="([^"]+)"[^>]*class="w2"/);
    const nameM = tail.match(/href="[A-Za-z_]+">([^<]{1,32})<\/a>/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    const window_ = tail.slice(nameM[0].length, nameM[0].length + 3200);
    const prop = (labelRe) => {
      const mm = window_.match(labelRe);
      return mm ? mm[1].trim() : null;
    };
    const phys = window_.match(/伤害:\s*<span[^>]*>([\d,]+)\s*[-–]\s*([\d,]+)/);
    const elem = [...window_.matchAll(/(火|冰|闪|雷)电?伤害[^<]*<span[^>]*>([\d,]+)\s*[-–]\s*([\d,]+)/g)];
    const props = {
      phys: phys ? [Number(phys[1].replace(/,/g, '')), Number(phys[2].replace(/,/g, ''))] : null,
      aps: window_.match(/每秒攻击次数:\s*<span[^>]*>([\d.]+)/) ? Number(window_.match(/每秒攻击次数:\s*<span[^>]*>([\d.]+)/)[1]) : null,
      crit: window_.match(/暴击<\/a>率:\s*<span[^>]*>([\d.]+)%/) ? Number(window_.match(/暴击<\/a>率:\s*<span[^>]*>([\d.]+)%/)[1]) : null,
      range: prop(/武器范围:\s*<span[^>]*>([\d.]+)/),
      armour: window_.match(/护甲<\/a>: <span[^>]*'colourDefault'>([\d,]+)</) ? Number(window_.match(/护甲<\/a>: <span[^>]*'colourDefault'>([\d,]+)</)[1].replace(/,/g, '')) : null,
      evasion: window_.match(/闪避值<\/a>: <span[^>]*'colourDefault'>([\d,]+)</) ? Number(window_.match(/闪避值<\/a>: <span[^>]*'colourDefault'>([\d,]+)</)[1].replace(/,/g, '')) : null,
      es: window_.match(/能量护盾<\/a>: <span[^>]*'colourDefault'>([\d,]+)</) ? Number(window_.match(/能量护盾<\/a>: <span[^>]*'colourDefault'>([\d,]+)</)[1].replace(/,/g, '')) : null,
      block: prop(/格挡率:\s*<span[^>]*>([\d.]+)%/),
      spirit: prop(/精魂:\s*<span[^>]*>([\d,]+)/),
      elem: elem.map((e) => [e[1], Number(e[2].replace(/,/g, '')), Number(e[3].replace(/,/g, ''))]),
    };
    const lvl = window_.match(/requirements">[^<]*<span[^>]*>等级\s*(\d+)/) || window_.match(/等级\s*(\d+)/);
    const level = lvl ? Number(lvl[1]) : null;
    if (seen.has(slug)) {
      const prev = seen.get(slug);
      if (level != null && prev.level == null) prev.level = level;
      continue;
    }
    seen.set(slug, { slug, name, level, img: imgM ? imgM[1] : null, props });
  }
  return [...seen.values()];
}

// ---- main ----
const slug = process.argv[2];
if (!slug) { console.error('usage: node parse_one.js <slug>  (HTML from stdin)'); process.exit(1); }
const html = fs.readFileSync(0, 'utf-8');

const jsonText = extractModsViewJson(html);
fs.mkdirSync(RAW_DIR, { recursive: true });
fs.writeFileSync(path.join(RAW_DIR, `${slug}.json`), jsonText, 'utf-8');
const data = JSON.parse(jsonText);
const title = (html.match(/<title>([^<]+)/) || [])[1] || '';
const cnName = title.replace(/ - .*/, '').trim();

const allEntries = [];
for (const [groupKey, meta] of Object.entries(SOURCE_MAP)) {
  allEntries.push(...parseEntries(data[groupKey], meta.source, meta.label));
}
const affixGroups = buildAffixGroups(allEntries);
const bases = parseBases(html);

const parsed = {
  slug,
  cnName,
  fetchedAt: new Date().toISOString(),
  groupCounts: Object.fromEntries(Object.keys(SOURCE_MAP).map((k) => [k, (data[k] || []).length])),
  affixCount: affixGroups.length,
  prefixCount: affixGroups.filter((g) => g.preSuf === 'prefix').length,
  suffixCount: affixGroups.filter((g) => g.preSuf === 'suffix').length,
  alloyCount: affixGroups.filter((g) => g.source === 'alloy').length,
  socketableCount: (data.socketable || []).length,
  essenceEntryCount: (data.essence || []).length + (data.perfect_essence || []).length,
  bases,
  affixGroups,
  socketable: data.socketable || [],
  essence: data.essence || [],
  perfect_essence: data.perfect_essence || [],
};
fs.mkdirSync(PARSED_DIR, { recursive: true });
fs.writeFileSync(path.join(PARSED_DIR, `${slug}.json`), JSON.stringify(parsed), 'utf-8');
console.log(`  parsed: ${affixGroups.length} affix groups (${parsed.prefixCount}P/${parsed.suffixCount}S), ${bases.length} bases`);
