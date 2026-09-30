/** 重建 stat_mapping.json：mods_db 词缀组 → 官方 stat_id
 * 层级：1) 原有映射保留  2) 严格归一化等值匹配 explicit  3) 词表替换（poe2db vs 官方措辞差）
 */
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/ai-work/poe2搜索插件';
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/data/mods_db.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/data/stats_db.json'), 'utf8')).stats;
const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/data/stat_mapping.json'), 'utf8'));

const map = { ...old };

const norm = (t) => String(t).replace(/[+#%\d（）()—\-~.、\s,]/g, '');

// poe2db 措辞 → 国服官方措辞
const VOCAB = [
  [/攻击速度提高/g, '攻击速度加快'],
  [/技能速度提高/g, '技能速度加快'],
  [/施法速度提高/g, '施法速度加快'],
  [/生命上限/g, '最大生命'],
  [/能量护盾上限/g, '最大能量护盾'],
  [/魔力上限/g, '最大魔力'],
  [/暴击几率提高/g, '暴击率提高'],
  [/冷却回复速度提高/g, '冷却时间恢复率'],
];

function tryMatch(fullId, template) {
  if (map[fullId]) return;
  // 1) 严格归一化等值
  const nt = norm(template);
  let cand = stats.find((x) => x.type === 'explicit' && norm(x.text) === nt);
  if (cand) { map[fullId] = [cand.id]; return; }
  // 2) 词表替换后再等值
  let t2 = template;
  VOCAB.forEach(([re, to]) => { t2 = t2.replace(re, to); });
  if (t2 !== template) {
    const nt2 = norm(t2);
    cand = stats.find((x) => x.type === 'explicit' && norm(x.text) === nt2);
    if (cand) { map[fullId] = [cand.id]; return; }
  }
}

const seen = new Set();
db.categories.forEach((c) => c.affixGroups.forEach((g) => {
  // g.id 形如 prefix|+#生命上限 —— 剥离 source 前缀拿纯模板
  const tpl = g.id.includes('|') ? g.id.slice(g.id.indexOf('|') + 1) : g.id;
  if (!seen.has(tpl)) { seen.add(tpl); tryMatch(g.id, tpl); }
}));

fs.writeFileSync(path.join(ROOT, 'extension/data/stat_mapping.json'), JSON.stringify(map, null, 1));
console.log('mapping entries:', Object.keys(map).length);
