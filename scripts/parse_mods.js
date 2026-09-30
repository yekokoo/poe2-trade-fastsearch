#!/usr/bin/env node
/**
 * parse_mods.js
 * 抓取指定 poe2db 分类页并解析内嵌 ModsView JSON，输出结构化词缀数据。
 * 用法：node parse_mods.js Two_Hand_Maces [Gloves ...]
 * 输出：
 *   data/raw/<slug>.json        页面原始 ModsView JSON（备份）
 *   data/parsed/<slug>.json     解析后的结构化数据
 */
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const PARSED_DIR = path.join(ROOT, 'data', 'parsed');

// 来源分组 → 插件内的来源类别
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

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** 从HTML中括号平衡地提取 new ModsView({...}) 的JSON文本 */
function extractModsViewJson(html) {
  const start = html.indexOf('new ModsView(');
  if (start < 0) throw new Error('ModsView not found');
  let i = html.indexOf('{', start);
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
      if (depth === 0) return html.slice(html.indexOf('{', start), i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

/** 清洗词缀显示文本 → 规范化模板（用于T级分族） */
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

/** 从HTML提取纯文本数值区间（供界面展示） */
function extractValues(strHtml) {
  const plain = strHtml.replace(/<span class="ndash">[^<]*<\/span>/g, '—').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const nums = [...plain.matchAll(/[\(（]?([0-9]+(?:\.[0-9]+)?)((—|‑|–|-)([0-9]+(?:\.[0-9]+)?))?[\)）]?%?/g)]
    .map((m) => (m[4] ? [Number(m[1]), Number(m[4])] : [Number(m[1])]))
    .filter((v) => !Number.isNaN(v[0]));
  return nums;
}
/** 提取合金来源图标信息（条目内 config 命中） */
function detectAlloy(entry) {
  const code = entry.Code || '';
  if (/^Alloy/i.test(code)) return true;
  if (JSON.stringify(entry).includes('_Alloy')) return true;
  return false;
}

function parseEntries(arr, source, sourceLabel) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const e of arr) {
    const entryType = e.type || 'mod'; // mod | socketable | essence | misc
    const genType = Number(e.ModGenerationTypeID ?? -1);
    const preSuf = genType === 1 ? 'prefix' : genType === 2 ? 'suffix' : genType === 5 ? 'corrupted' : 'special';
    let src = source, label = sourceLabel;
    // 合金词条藏在 essence 组里（Code=Alloy*），拆为独立来源
    if (/^Alloy/i.test(e.Code || '')) {
      src = 'alloy';
      label = '合金';
    }
    out.push({
      source: src,
      sourceLabel: label,
      entryType,
      preSuf,
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

/** 将同模板词条聚合成词缀组并推导T级（Level越高T越小） */
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
      tier: idx + 1, // 1 = 最高
      ilvl: e.ilvl,
      weight: e.weight,
      values: e.values,
      text: stripHtml(e.text),
    }));
    // 同族多模板（如复合词缀跨 family）时取第一条的描述
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

function stripHtml(html) {
  return html
    .replace(/<span class="ndash">[^<]*<\/span>/g, '—')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析基底列表（非传奇物品区块的卡片：a.whiteitem href=slug>名称 + requirements 等级） */
function parseBases(html) {
  const bases = [];
  const seen = new Map();
  // 卡片模式：白色基底链接 + 显示名，随后跟 requirements 等级
  const re = /<a\s+class="whiteitem[^"]*"\s+[^>]*?href="([A-Za-z_]+)"[^>]*>([^<]{1,24})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const name = m[2].trim();
    // 找该链接后面的 requirements（同卡片内，卡片最长约3000字符）
    const tail = html.slice(re.lastIndex, re.lastIndex + 3200);
    const lvl = tail.match(/requirements">[^<]*<span[^>]*>等级\s*(\d+)/);
    const level = lvl ? Number(lvl[1]) : null;
    if (seen.has(slug)) {
      // 同页可能重复出现（顶部列表+卡片），保留等级更完整的
      if (level != null && seen.get(slug).level == null) seen.get(slug).level = level;
      continue;
    }
    seen.set(slug, { slug, name, level });
  }
  bases.push(...seen.values());
  return bases;
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PARSED_DIR, { recursive: true });
  const slugs = process.argv.slice(2);
  if (!slugs.length) {
    console.error('usage: node parse_mods.js <slug> [...]');
    process.exit(1);
  }
  for (const slug of slugs) {
    console.log(`\n===== ${slug} =====`);
    const html = await fetchText(`https://poe2db.tw/cn/${slug}`);
    const jsonText = extractModsViewJson(html);
    fs.writeFileSync(path.join(RAW_DIR, `${slug}.json`), jsonText, 'utf-8');
    const data = JSON.parse(jsonText);
    const title = (html.match(/<title>([^<]+)/) || [])[1] || '';
    const cnName = title.replace(/ - .*/, '').trim();

    const allEntries = [];
    for (const [groupKey, meta] of Object.entries(SOURCE_MAP)) {
      const entries = parseEntries(data[groupKey], meta.source, meta.label);
      entries.forEach((e) => (e.group = groupKey));
      allEntries.push(...entries);
      console.log(`  ${groupKey.padEnd(18)} ${entries.length} 条`);
    }
    // 合金词条在 normal/bonded 内以 Code=Alloy* 标记，拆出来
    const affixGroups = buildAffixGroups(allEntries);
    const alloyGroups = affixGroups.filter((g) => g.isAlloy);
    const summary = {
      slug,
      cnName,
      fetchedAt: new Date().toISOString(),
      baseCount: (data.baseitem ? 1 : 0),
      groupCounts: Object.fromEntries(Object.keys(SOURCE_MAP).map((k) => [k, (data[k] || []).length])),
      affixCount: affixGroups.length,
      prefixCount: affixGroups.filter((g) => g.preSuf === 'prefix').length,
      suffixCount: affixGroups.filter((g) => g.preSuf === 'suffix').length,
      alloyCount: alloyGroups.length,
      socketableCount: (data.socketable || []).length,
      essenceEntryCount: (data.essence || []).length + (data.perfect_essence || []).length,
    };
    console.log('  汇总:', JSON.stringify(summary));
    const bases = parseBases(html);
    console.log('  基底:', bases.length, '个, 样例:', bases.slice(0, 3).map((b) => `${b.name}(L${b.level ?? '?'})`).join(' '));
    const parsed = {
      ...summary,
      bases,
      affixGroups,
      socketable: data.socketable || [],
      essence: data.essence || [],
      perfect_essence: data.perfect_essence || [],
    };
    fs.writeFileSync(path.join(PARSED_DIR, `${slug}.json`), JSON.stringify(parsed, null, 1), 'utf-8');
    // 预览：前8个前缀组
    console.log('  前缀样例:');
    affixGroups.filter((g) => g.preSuf === 'prefix').slice(0, 5).forEach((g) => {
      console.log(`    [${g.sourceLabel}] ${g.text.slice(0, 40)}  T1-T${g.tierCount} (物等${g.minIlvl}+)`);
    });
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
