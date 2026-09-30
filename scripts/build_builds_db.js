/** build_builds_db.js — raw_*.json 聚合 → extension/data/builds_db.json（进阶模式数据源）
 *
 * 输入：data/ninja/raw_{Asc}.json（fetch_ninja_builds.js 产物）
 * 依赖：data/tmp/unique_name_map.json（暗金英→中）、data/tmp/ggg_stats.json（英文词条→stat_id）、
 *       extension/data/stats_db.json（stat_id→中文）、extension/data/mods_db.json（词条 groupId 对齐）
 *       data/base_panels.json（普通基底英文名→中文，fetch_base_panels.js 产出——mods_db 经官网过滤
 *       只剩少数基底，天梯普通基底中文名主要靠此文件；缺失时增量补抓即可）
 *
 * 产物结构（见 docs/进阶模式设计_v0.7.md）：
 * {
 *   version, builtAt, league: {url, snapshotName, version, label},
 *   classes: [{cn, en, asc: [...]}],
 *   ascs: { AscName: { cn, class, popPct, sampled,
 *     slots: { Rings: { cn, baseSlugs, items: [...], modStats: [...] } } } }
 * }
 * 数据口径（v0.8）：天梯榜前 N 构建（默认 10）的装备归类——items/modStats pct 分母 = sampled。
 * items 元素：{ key, rarity, en, cn, pct, uSlug? }   // 暗金带 mods_db U_* slug
 * modStats 元素：{ tpl, en, cn, statIds[], pct }     // 中文从 GGG→stats_db 链对齐；statIds 全集（explicit 优先），全量输出不限条数
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NINJA = path.join(ROOT, 'data', 'ninja');
const EXT = path.join(ROOT, 'extension', 'data');

/* ---------- 中文映射（静态表：基础职业 / 升华职业 / 装备槽位） ---------- */
const CLASS_CN = {
  Warrior: '战士', Monk: '武僧', Sorceress: '女术士', Witch: '女巫',
  Ranger: '游侠', Huntress: '猎手', Mercenary: '佣兵', Druid: '德鲁伊',
};
/* 升华职业国服译名（缺省回退英文） */
const ASC_CN = {
  'Gemling Legionnaire': '宝石军团士兵', 'Tactician': '战术家', 'Witchhunter': '女巫猎人',
  'Disciple of Varashta': '瓦沙塔信徒', 'Martial Artist': '武道家', 'Invoker': '祈使者',
  'Chargemaster': '蓄能师', 'Acolyte of Chayula': '查尤拉侍僧',
  'Spirit Walker': '魂行者', 'Oracle': '神谕者',
  'Deadeye': '神射手', 'Pathfinder': '开拓者', 'Amazon': '亚马逊',
  'Ritualist': '祭仪者',
  'Stormweaver': '织风暴者', 'Chronomancer': '时空法师',
  'Infernalist': '炼狱巫师', 'Blood Mage': '血法师', 'Abyssal Lich': '深渊巫妖', 'Lich': '巫妖',
  'Titan': '泰坦', 'Warbringer': '战争使者', 'Smith of Kitava': '奇塔弗锻造师',
};
/* 升华职业 → 基础职业（POE2 0.5 版本，ninja class 名） */
const ASC_TO_CLASS = {
  'Titan': 'Warrior', 'Warbringer': 'Warrior', 'Smith of Kitava': 'Warrior',
  'Invoker': 'Monk', 'Chargemaster': 'Monk', 'Acolyte of Chayula': 'Monk', 'Disciple of Varashta': 'Monk',
  'Deadeye': 'Ranger', 'Pathfinder': 'Ranger', 'Witchhunter': 'Mercenary', 'Gemling Legionnaire': 'Mercenary',
  'Tactician': 'Mercenary', 'Amazon': 'Huntress', 'Ritualist': 'Huntress',
  'Stormweaver': 'Sorceress', 'Chronomancer': 'Sorceress', 'Stormweaver Chronomancer': 'Sorceress',
  'Infernalist': 'Witch', 'Blood Mage': 'Witch', 'Abyssal Lich': 'Witch', 'Lich': 'Witch', 'Oracle': 'Witch',
  'Spirit Walker': 'Druid', 'Martial Artist': 'Monk',
};
/* 槽位 → 显示名 + mods_db baseSlug（Weapon 汇总拆分在 SLOT_WEAPON_SLUGS） */
const SLOT_META = {
  Helmets:      { cn: '头盔', baseSlugs: ['Helmets'] },
  Body_Armours: { cn: '护甲', baseSlugs: ['Body_Armours'] },
  Gloves:       { cn: '手套', baseSlugs: ['Gloves'] },
  Boots:        { cn: '鞋', baseSlugs: ['Boots'] },
  Amulets:      { cn: '项链', baseSlugs: ['Amulets'] },
  Rings:        { cn: '戒指', baseSlugs: ['Rings'] },
  Belts:        { cn: '腰带', baseSlugs: ['Belts'] },
  Charms:       { cn: '咒符', baseSlugs: ['Charms'] },
  Flask:        { cn: '药水', baseSlugs: ['Life_Flasks', 'Mana_Flasks'] },
  Weapon:       { cn: '武器', baseSlugs: ['Bows', 'Crossbows', 'Daggers', 'Flails', 'One_Hand_Axes', 'One_Hand_Maces', 'One_Hand_Swords', 'Quarterstaves', 'Sceptres', 'Spears', 'Staves', 'Two_Hand_Axes', 'Two_Hand_Maces', 'Two_Hand_Swords', 'Wands'] },
};

/* ---------- 暗金英文 slug 匹配 ---------- */
function slugify(s) {
  return String(s).replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}
const uniqMap = (() => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'unique_name_map.json'), 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(m)) out[slugify(v)] = k;   // slug -> 「中文名|基底」
  return out;
})();
/* mods_db U_* 索引：text 前缀（中文名）→ { slug, categoryCn } */
const modsDb = JSON.parse(fs.readFileSync(path.join(EXT, 'mods_db.json'), 'utf8'));
const uIndex = {};
for (const c of modsDb.categories) {
  for (const b of c.bases || []) {
    if (b.unique && b.slug && b.slug.startsWith('U_')) {
      uIndex[b.slug] = { text: b.text, cnName: b.name, catCn: c.cnName };
    }
  }
}
/* 暗金英文名 → mods_db U_ slug：unique_name_map value 是 poe2db slug（= U_* name 的英文来源），
 * 但 U_* 内部 slug 是 X_中文 混合形态，直接 slug 对不上 → 用「中文名」匹配 map key 的前半段 */
const uniqEnToU = {};
{
  // map: 「中文名|基底」-> poe2dbSlug；U 索引: U_slug -> cnName
  // 同 中文名 可能多个基底（如 贝雷克的冰与雷之曲 双玉/金光），按 U_slug 全部记录，选 baseType 匹配的
  const byCn = {};
  for (const [cnKey, poeSlug] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'unique_name_map.json'), 'utf8')))) {
    const cn = cnKey.split('|')[0];
    (byCn[slugify(poeSlug)] = byCn[slugify(poeSlug)] || []).push(cn);
  }
  for (const [poeSlug, cns] of Object.entries(byCn)) {
    for (const [uSlug, info] of Object.entries(uIndex)) {
      if (cns.includes(info.cnName)) {
        (uniqEnToU[poeSlug] = uniqEnToU[poeSlug] || []).push(uSlug);
      }
    }
  }
}

/* ---------- 英文词条 → 中文 ---------- */
const gggStats = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tmp', 'ggg_stats.json'), 'utf8'));
const enTextToIds = {};
const enTextToIdsCI = {};
for (const g of gggStats.result) {
  for (const e of g.entries || []) {
    // 同文本多个 stat_id（explicit/implicit/pseudo 并存）全收集；排序 explicit > implicit > pseudo，
    // 伪 id 不能丢——affixGroups 的 statIds 里也常带 pseudo.*
    (enTextToIds[e.text] = enTextToIds[e.text] || []).push(e.id);
    // 大小写不敏感兜底索引（ninja "Cold damage" vs GGG "Cold Damage"）
    (enTextToIdsCI[e.text.toLowerCase()] = enTextToIdsCI[e.text.toLowerCase()] || []).push(e.id);
  }
}
for (const ids of Object.values(enTextToIds)) {
  ids.sort((a, b) => {
    const w = (s) => (s.startsWith('explicit') ? 0 : s.startsWith('implicit') ? 1 : s.startsWith('pseudo') ? 2 : 3);
    return w(a) - w(b);
  });
}
for (const ids of Object.values(enTextToIdsCI)) {
  ids.sort((a, b) => {
    const w = (s) => (s.startsWith('explicit') ? 0 : s.startsWith('implicit') ? 1 : s.startsWith('pseudo') ? 2 : 3);
    return w(a) - w(b);
  });
}
/* ninja 对 GGG 官方文本的改写别名（POE2 0.5 实测 miss 榜） */
const TPL_ALIASES = {
  '# Life Regeneration per second': 'Regenerate # Life per second',
  '# Mana Regeneration per second': 'Regenerate # Mana per second',
  '#% increased Critical Hit Chance': '#% increased Critical Strike Chance',
  '#% to Critical Hit Chance': '#% increased Critical Strike Chance',
  '+#% to Critical Hit Chance': '#% increased Critical Strike Chance',
  /* v0.8.1：武器/装备词条实测 miss 补全 */
  'Gain # Life per enemy killed': 'Gain # Life per Enemy Killed',
  'Gain # Mana per enemy killed': 'Gain # Mana per Enemy Killed',
  'Leech #% of Physical Attack Damage as Mana': '#% of Physical Attack Damage Leeched as Mana',
  'Leech #% of Physical Attack Damage as Life': '#% of Physical Attack Damage Leeched as Life',
  'Leeches #% of Physical Damage as Mana': '#% of Physical Attack Damage Leeched as Mana',
  'Leeches #% of Physical Damage as Life': '#% of Physical Attack Damage Leeched as Life',
  'Gain #% of Damage as Extra Fire Damage': 'Gain #% of Physical Damage as Extra Fire Damage',
  'Gain #% of Damage as Extra Cold Damage': 'Gain #% of Physical Damage as Extra Cold Damage',
  'Gain #% of Damage as Extra Lightning Damage': 'Gain #% of Physical Damage as Extra Lightning Damage',
  'Attacks Gain #% of Damage as Extra Fire Damage': 'Gain #% of Physical Damage as Extra Fire Damage',
  'Attacks Gain #% of Damage as Extra Cold Damage': 'Gain #% of Physical Damage as Extra Cold Damage',
  'Attacks Gain #% of Damage as Extra Lightning Damage': 'Gain #% of Physical Damage as Extra Lightning Damage',
  '# to Level of all Minion Skills': '+# to Level of all Minion Skill Gems',
  '# to Level of all Spell Skills': '+# to Level of all Spell Skill Gems',
  '# to Level of all Melee Skills': '+# to Level of all Melee Skill Gems',
  '#% increased Projectile Speed with this Weapon': '#% increased Projectile Speed',
  'Minions have #% increased Critical Hit Chance': 'Minions have #% increased Critical Strike Chance',
  '#% reduced Attribute Requirements': '#% increased Attribute Requirements',
  '#% increased Elemental Damage with Attacks': 'Gain #% of Weapon Physical Damage as Extra Damage of each Element',
  'Causes #% increased Stun Buildup': 'Causes #% increased Stun Buildup',
  'Attacks Chain # additional times': 'Socketed Gems Chain # additional times',
  '#% to Maximum Fire Resistance': '+#% to maximum Fire Resistance',
  '#% to Maximum Chaos Resistance': '+#% to maximum Chaos Resistance',
  '#% of Flask Recovery applied Instantly': '#% of Recovery applied Instantly',
};
const statsDb = JSON.parse(fs.readFileSync(path.join(EXT, 'stats_db.json'), 'utf8'));
const idToCn = {};
for (const s of statsDb.stats) idToCn[s.id] = s.text;
/* 国服市集官方 stats（trade2_stats_flat.json，id→中文 4754 条）优先级高于国际服 stats_db：
 * POE2 国服词条措辞（如「精魂」「威能」「所有召唤生物技能等级」）只在这里有。 */
const trade2Flat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'trade2_stats_flat.json'), 'utf8'));
for (const s of trade2Flat) if (s.id && s.text) idToCn[s.id] = s.text;   // 覆盖 stats_db 同 id 条目
/* 国服中文模板 → stat_id 反查索引（CN_DIRECT 兜底用） */
const trade2ByCn = {};
for (const s of trade2Flat) {
  if (s.id && s.text) (trade2ByCn[s.text] = trade2ByCn[s.text] || []).push(s.id);
}

/* 国服直译通道（v0.8.1）：GGG stats 缺失但国服市集真实存在的词条。
 * ninja 英文模板 → 国服中文模板（trade2_stats_flat 同文本的 id 全收集）。
 * 这些词条市集可筛（stat_id 体系一致），且中文模板就是市集显示文本。 */
const CN_DIRECT = {
  '# to Spirit': '# 精魂',
  '#% increased Spirit': '精魂提高 #%',
  'Has # Charm Slots': '咒符栏 #',
  'Has # Charm Slot': '咒符栏 #',
  '# to Level of all Projectile Skills': '所有投射物技能等级 #',
  '# to Level of all Minion Skills': '所有召唤生物技能等级 #',
  '# to Level of all Spell Skills': '所有法术技能等级 #',
  '# to Level of all Melee Skills': '所有近战技能等级 #',
  '# to Level of all Attack Skills': '所有攻击技能等级 #',
  '# to Level of all Cold Spell Skills': '所有冰霜法术技能等级 #',
  '# to Level of all Fire Spell Skills': '所有火焰法术技能等级 #',
  '# to Level of all Lightning Spell Skills': '所有闪电法术技能等级 #',
  '#% increased Charm Effect Duration': '咒符效果的持续时间延长 #%',
  '#% reduced Charm Charges used': '使用的咒符充能降低 #%',
  '#% Chance to gain a Charge when you kill an enemy': '击败敌人时有 #% 的几率获得一次充能',
  'Grants # additional Skill Slot': '获得 1 个额外技能栏位',
  /* v0.8.1 第二批：A 类直译（GGG 完全缺失的 POE2 国服词条） */
  '# to Stun Threshold': '晕眩临界值 #',
  'Gain Deflection Rating equal to #% of Evasion Rating': '获得相当于闪避值 #% 的偏转值',
  'Recover # Life when Used': '使用时回复 # 生命',
  'Recover # Mana when Used': '使用时回复 # 魔力',
  'Instant Recovery': '立即回复',
  '#% of Recovery applied Instantly': '#% 的药剂回复量立即生效',
  '#% of Flask Recovery applied Instantly': '#% 的药剂回复量立即生效',
  'Used when you become Ignited': '被点燃时自动使用',
  'Used when you become Frozen': '陷入冻结时自动使用',
  'Used when you become Stunned': '当你被晕眩时使用',
  'Used when you become Shocked': '陷入感电时自动使用',
  'Used when you become Poisoned': '陷入中毒时自动使用',
  'Used when you start Bleeding': '你开始流血时自动使用',
  'Used when you are affected by a Slow': '当你受到减速影响时使用',
  'Used when you kill a Rare or Unique enemy': '当你击败稀有或传奇敌人时使用',
  'Used when you take Cold damage from a Hit': '当你受到击中冰霜伤害时使用',
  '#% increased Charges gained': '获得的药剂充能提高 #%',
  '#% increased Charges': '获得的药剂充能提高 #%',
  'Gains # Charges per Second': '每秒获得 # 次充能',
  '#% reduced Charges per use': '每次使用消耗的充能次数提高 #%',
  '#% increased Duration': '药剂效果的持续时间延长 #%',
  '#% more Recovery if used while on Low Mana': '回复效果在低魔下使用时总增 #%',
  'Gain #% of Damage as Extra Fire Damage': '获得相当于伤害 #% 的额外火焰伤害',
  'Gain #% of Damage as Extra Cold Damage': '获得相当于伤害 #% 的额外冰霜伤害',
  'Gain #% of Damage as Extra Lightning Damage': '获得相当于伤害 #% 的额外闪电伤害',
  'Attacks Gain #% of Damage as Extra Fire Damage': '攻击获得相当于伤害 #% 的额外火焰伤害',
  'Attacks Gain #% of Damage as Extra Cold Damage': '攻击获得相当于伤害 #% 的额外冰霜伤害',
  'Attacks Gain #% of Damage as Extra Lightning Damage': '获得相当于伤害 #% 的额外闪电伤害',
  'Attacks Gain #% of Damage as Extra Physical Damage': '获得相当于伤害 #% 的额外物理伤害',
  '#% increased Critical Damage Bonus': '暴击伤害加成提高 #%',
  '#% to Critical Damage Bonus': '暴击伤害加成提高 #%',
  '#% increased Critical Spell Damage Bonus': '法术暴击伤害加成提高 #%',
  '#% increased Critical Hit Chance for Spells': '法术暴击率提高 #%',
  '#% increased Magnitude of Shock you inflict': '你造成的感电强度提高 #%',
  '#% increased Ignite Magnitude': '点燃强度提高 #%',
  '#% increased Flammability Magnitude': '易燃强度提高 #%',
  '#% increased Freeze Buildup': '冻结积蓄值提高 #%',
  '#% increased Stun Duration': '晕眩持续时间延长 #%',
  '#% reduced Poison Duration on you': '你受到的中毒持续时间提高 #%',
  '#% reduced Freeze Duration on you': '你被冰冻的持续时间缩短 #%',
  'Debuffs on you expire #% faster': '你身上的减益效果消失速度加快 #%',
  '#% reduced Slowing Potency of Debuffs on You': '你受到的异常状态的减速强度提高 #%',
  '#% increased Cooldown Recovery Rate': '冷却回复速度加快 #%',
  'Minions deal #% increased Damage': '召唤生物的伤害提高 #%',
  'Minions have #% increased maximum Life': '召唤生物的最大生命提高 #%',
  'Minions have #% increased Attack and Cast Speed': '召唤生物的攻击和施法速度加快 #%',
  'Minions have #% increased Critical Damage Bonus': '召唤生物的暴击伤害加成提高 #%',
  'Minions have #% increased Critical Hit Chance': '召唤生物的暴击率提高 #%',
  'Minions have #% to all Elemental Resistances': '召唤生物获得 #% 元素抗性',
  'Minions deal #% increased Damage with Command Skills': '召唤生物使用命令技能造成的伤害提高 #%',
  'Allies in your Presence deal #% increased Damage': '在场的友军造成的伤害提高 #%',
  'Allies in your Presence have #% increased Attack Speed': '在场的友军的攻击速度加快 #%',
  'Allies in your Presence have #% increased Cast Speed': '在场的友军的施法速度加快 #%',
  'Allies in your Presence have #% increased Critical Damage Bonus': '在场的友军的暴击伤害加成提高 #%',
  'Allies in your Presence have #% increased Critical Hit Chance': '在场的友军的暴击几率提高 #%',
  'Allies in your Presence have #% to all Elemental Resistances': '在场的友军的所有元素抗性 #%',
  'Allies in your Presence deal # to # added Attack Lightning Damage': '在场的友军附加 # - # 攻击闪电伤害',
  'Allies in your Presence deal # to # added Attack Fire Damage': '在场的友军附加 # - # 攻击火焰伤害',
  'Allies in your Presence deal # to # added Attack Cold Damage': '在场的友军附加 # - # 攻击冰霜伤害',
  'Allies in your Presence deal # to # added Attack Physical Damage': '在场的友军附加 # - # 攻击物理伤害',
  'Allies in your Presence Regenerate # Life per second': '在场的友军每秒再生 # 点生命',
  'Grenade Skills Fire an additional Projectile': '榴弹技能发射 1 个额外投射物',
  '#% increased Mana Cost Efficiency of Spells': '魔力消耗效能提高 #%',
  '#% chance to gain a Power Charge on Critical Hit': '暴击时有 #% 的几率获得暴击球',
  '# metres to Dodge Roll distance': '闪避翻滚距离 # 米',
  '#% to Quality of all Skills': '所有技能品质 #%',
  '#% increased Elemental Damage with Attacks': '获得相当于伤害 #% 的额外火焰伤害',
  '#% increased Projectile Damage': '投射物伤害提高 #%',
  '#% increased Projectile Speed': '投射物射程提高 #%',
  'Mark Skills have #% increased Use Speed': '你的印记技能效果提高 #%',
  '#% increased chance to Shock': '感电几率提高 #%',
  '#% chance to Daze on Hit': '击中有 #% 的几率威吓敌人 4 秒',
  '#% of Armour also applies to Elemental Damage': '#% 的护甲同样作用于元素伤害',
  '#% to Maximum Quality': '品质上限为 #%',
  'Causes #% increased Stun Buildup': '造成的晕眩积蓄值提高 #%',
  '# to # Physical Thorns damage': '# - # 物理荆棘伤害',
  'Attacks Chain # additional times': '攻击有额外一次连锁弹射',
  '#% chance to gain Onslaught for # seconds on Hit': '击败敌人时获得 # 秒【猛攻】状态',
  '#% more Global Evasion Rating and Energy Shield': '闪避值提高 #%',
  /* 强制覆盖：POE1 旧 id（stat_2375316951 等）对齐出「该装备的攻击暴击率提高 #%」
   * 这类市集不存在的旧中文 → 强制改国服真名（攻击暴击率提高 #% / 攻击速度加快 #%）。
   * 生效位置：alignMod 末段「cn 不在市集宇宙」检查（见下） */
  '该装备的攻击暴击率提高 #%': '攻击暴击率提高 #%',
  '该装备的物理伤害提高 #%': '物理伤害提高 #%',
  '该装备的攻击速度提高 #%': '攻击速度加快 #%',
  '该装备的施法速度提高 #%': '施法速度加快 #%',

  /* 语义不对应的不做映射（宁缺毋滥）：#% reduced Amount Recovered（减≠增）、
   * #% increased Projectile Damage per Power Charge（每球≠平铺）等 → 灰显参考 */
};

/* cn 强制修正表（alignMod 末段用）：中文对齐结果不在市集宇宙时改写 */
const CN_OVERRIDE = {
  '该装备的攻击暴击率提高 #%': '攻击暴击率提高 #%',
  '该装备的物理伤害提高 #%': '物理伤害提高 #%',
  '该装备的攻击速度提高 #%': '攻击速度加快 #%',
  '该装备的施法速度提高 #%': '施法速度加快 #%',
  '该装备的暴击率提高 #%': '攻击暴击率提高 #%',
};

/** ninja 模板 → { en, cn, statIds[] }（变体 ids 并集：原文/别名/(Local)/+前缀/大小写，explicit 优先）
 * 再兜底 CN_DIRECT 国服直译。找不到任何 id 返回 null。 */
function alignMod(tpl) {
  const candidates = new Set([tpl, TPL_ALIASES[tpl]].filter(Boolean));
  // ninja 简写省略 (Local)：护甲/武器本地词缀在 GGG 里带 (Local) 后缀
  for (const c of [...candidates]) { candidates.add(c + ' (Local)'); candidates.add('+' + c); candidates.add('+' + c + ' (Local)'); }
  // 大小写不敏感兜底（ninja "Cold damage" vs GGG "Cold Damage"）
  const ciIndex = alignMod._ci || (alignMod._ci = (() => {
    const m = {};
    for (const t of Object.keys(enTextToIds)) (m[t.toLowerCase()] = m[t.toLowerCase()] || []).push(t);
    return m;
  })());
  for (const hit of ciIndex[tpl.toLowerCase()] || []) { candidates.add(hit); candidates.add(hit + ' (Local)'); }

  let ids = [], en = tpl;
  for (const cand of candidates) {
    for (const i of enTextToIds[cand] || []) if (!ids.includes(i)) ids.push(i);
  }
  if (ids.length) {
    // 命中的官方文本取最短（通常是去掉变体后缀的主形态）
    const hits = [...candidates].filter((c) => enTextToIds[c]);
    en = hits.sort((a, b) => a.length - b.length)[0] || tpl;
  } else {
    // 国服直译兜底：CN_DIRECT 中文模板 → trade2_flat 全 id
    const cnTpl = CN_DIRECT[tpl];
    if (cnTpl) {
      ids = trade2ByCn[cnTpl] || [];
      if (ids.length) return { en: tpl, cn: cnTpl, statIds: ids };
    }
    return null;
  }
  // 中文：优先 pseudo 文本（玩家习惯），其次 trade2（国服官方），最后 stats_db
  // —— 市集真名优先（如「攻击速度加快 #%」），POE1 旧中文（「攻击速度提高 #%」）只作最后回退
  let cn = null;
  for (const sid of ids) { const t = idToCn[sid]; if (t && sid.startsWith('pseudo')) { cn = t; break; } cn = cn || t; }
  if (cn) {
    // idToCn 命中的文本若不在市集宇宙，尝试用任一 stat_id 的 trade2 文本替换；
    // 仍不行 → CN_OVERRIDE 强制改写（如「该装备的攻击暴击率提高 #%」→「攻击暴击率提高 #%」），
    // 改写后把真名对应的 trade2 id 并入 statIds（保证市集可筛）
    if (!trade2ByCn[cn]) {
      for (const sid of ids) {
        const t = idToCn[sid];
        if (t && trade2ByCn[t]) { cn = t; break; }
      }
    }
    if (!trade2ByCn[cn] && CN_OVERRIDE[cn]) {
      const alt = CN_OVERRIDE[cn];
      if (trade2ByCn[alt]) {
        cn = alt;
        for (const i of trade2ByCn[alt]) if (!ids.includes(i)) ids.push(i);
      }
    }
  }
  // 国服直译兜底②：GGG 命中但 idToCn 无中文（POE1 旧 id，国服换了 stat_id）→
  // CN_DIRECT 的中文模板反查 trade2 id 并入 ids，中文取直译文本（即市集下拉真实文本）
  if (!cn) {
    const cnTpl = CN_DIRECT[tpl];
    if (cnTpl) {
      const t2 = trade2ByCn[cnTpl] || [];
      for (const i of t2) if (!ids.includes(i)) ids.push(i);
      if (t2.length) cn = cnTpl;
    }
  }
  return { en, cn, statIds: ids };
}

/* ---------- 普通基底英文显示名 → 中文 ----------
 * ninja baseType 是英文显示名（Gold Ring），mods_db 基底 slug 是 poe2db slug（Gold_Ring），
 * 归一化（非字母数字→_，小写）后可直接对上。
 * 通道优先级：data/base_panels.json（全量基底中文名，1800+ 条）> mods_db b.name（官网过滤后仅少量）。
 * 跨属性变体同名基底中文名一致，任取一条。 */
const norm = (s) => String(s).replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
const baseNormToCn = {};
const PANELS = path.join(ROOT, 'data', 'base_panels.json');
if (fs.existsSync(PANELS)) {
  for (const [slug, p] of Object.entries(JSON.parse(fs.readFileSync(PANELS, 'utf8')))) {
    if (p && p.name) baseNormToCn[norm(slug)] = p.name;
  }
}
for (const c of modsDb.categories) {
  for (const b of c.bases || []) {
    if (!b.unique && b.slug && b.name && !baseNormToCn[norm(b.slug)]) baseNormToCn[norm(b.slug)] = b.name;
  }
}

/* ---------- 主流程 ---------- */
const raws = fs.readdirSync(NINJA).filter((f) => f.startsWith('raw_') && f.endsWith('.json'));
if (!raws.length) { console.error('data/ninja 无 raw_*.json'); process.exit(1); }

const ascs = {};
for (const f of raws) {
  const a = JSON.parse(fs.readFileSync(path.join(NINJA, f), 'utf8'));
  if (!a.sampled) continue;
  const n = a.sampled;
  const asc = {
    class: ASC_TO_CLASS[a.asc] || null,
    cn: ASC_CN[a.asc] || a.asc,
    popPct: Math.round(a.popPct * 10) / 10,
    sampled: n,
    slots: {},
  };
  for (const [slot, data] of Object.entries(a.slots)) {
    const meta = SLOT_META[slot];
    if (!meta) continue;
    // 装备榜：稀有度优先级 rare/magic 池整体 vs unique 逐个 —— 输出分两类
    const items = [];
    for (const [key, cnt] of Object.entries(data.items)) {
      const [kind, ...rest] = key.split(':');
      const en = rest.join(':');
      const it = { key: kind + ':' + en, rarity: kind, en, pct: Math.round(cnt / n * 1000) / 10 };
      if (kind === 'u') {
        const cns = uniqEnToU[slugify(en)];
        if (cns && cns.length) {
          // 取首个 U slug（同名暗金跨基底在填表时按文本搜索即可）
          it.uSlug = cns[0];
          const info = uIndex[it.uSlug];
          it.cn = info.cnName; it.cnBase = info.text.split(' ').slice(1).join(' ');
        } else {
          it.cn = null;   // mods_db 无此暗金，UI 回退英文名
        }
      } else {
        it.cn = baseNormToCn[norm(en)] || null;   // 普通基底：英文显示名归一 → mods_db 中文名
      }
      items.push(it);
    }
    items.sort((x, y) => y.pct - x.pct);
    // 词条榜（非暗金池）：v0.8.1 全量展示——对齐官方 stat 的可直接填表；对不齐的灰显参考。
    // mods_db 词缀池仍用于 popup「找词缀组」打分，但不再做可筛剔除。
    const poolIds = new Set();
    for (const baseSlug of meta.baseSlugs) {
      for (const c of modsDb.categories) {
        if (c.baseSlug !== baseSlug) continue;
        for (const g of (c.affixGroups || [])) (g.statIds || []).forEach((s) => poolIds.add(s));
      }
    }
    const mods = Object.entries(data.mods || {}).sort((x, y) => y[1] - x[1]);
    const modStats = [];
    for (const [tpl, cnt] of mods) {
      const al = alignMod(tpl);
      const ids = al ? al.statIds : [];
      // v0.8.1 可筛判定：statIds 在国服市集官方 stat 宇宙（trade2_stats_flat 4754 条）内即可。
      // content.js 填表走「官方文本搜索下拉」，不依赖 mods_db 词缀组；mods_db 池稀疏（841 组无
      // statIds）会误杀真实可筛词条 → 不再用池交集做剔除，仅当 UI 找不到组时走直填通道。
      const ok = al && ids.length && (al.cn || null);
      if (!ok) {
        // 对不齐（GGG/国服都无该模板）→ 保留展示但标记仅参考（灰显）
        modStats.push({ tpl, en: tpl, cn: null, statIds: [], pct: Math.round(cnt / n * 1000) / 10, filterable: false });
        continue;
      }
      modStats.push({
        tpl, en: al.en, cn: al.cn, statIds: ids,
        pct: Math.round(cnt / n * 1000) / 10,
        filterable: true,
      });
    }
    // 暗金词条（每个暗金自己的 Top 词条，供点亮后带出参考；实际填表用 mods_db 固定词条）
    const uMods = {};
    for (const [uname, m] of Object.entries(data.uniqueMods || {})) {
      const top = Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, 8);
      uMods[uname] = top.map(([t, c]) => ({ tpl: t, pct: Math.round(c / n * 1000) / 10 }));
    }
    asc.slots[slot] = {
      cn: meta.cn, baseSlugs: meta.baseSlugs,
      items: items,           // 全量展示（Top-N 构建归类后每槽 ≤20 件）
      modStats,               // 全量：可筛 + 不可筛（filterable 标记），按出现构建数排序
      uMods,
    };
  }
  ascs[a.asc] = asc;
  const slotNames = Object.keys(asc.slots).join(',');
  console.log(`${a.asc}: sampled=${n} slots=[${slotNames}]`);
}

/* ---------- 职业分组 ---------- */
const classesOut = {};
for (const [ascName, a] of Object.entries(ascs)) {
  const cls = a.class || '未知';
  (classesOut[cls] = classesOut[cls] || []).push(ascName);
}
const classes = Object.entries(classesOut).map(([en, list]) => ({
  en, cn: CLASS_CN[en] || en, asc: list.sort((x, y) => ascs[y].popPct - ascs[x].popPct),
})).sort((x, y) => Math.max(...y.asc.map((a) => ascs[a].popPct)) - Math.max(...x.asc.map((a) => ascs[a].popPct)));

/* ---------- 赛季信息 ---------- */
const first = JSON.parse(fs.readFileSync(path.join(NINJA, raws[0]), 'utf8'));
const db = {
  version: '0.1.0',
  builtAt: Date.now(),
  league: { url: first.league, snapshotName: first.snapshotName, version: first.version, label: first.league },
  classes,
  ascs,
};

const outFile = path.join(EXT, 'builds_db.json');
fs.writeFileSync(outFile, JSON.stringify(db));
console.log(`→ ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
