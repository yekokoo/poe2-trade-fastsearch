/** fix_official_text.js — mods_db.json officialText 市集对齐修正（v0.8.2）
 *
 * 问题：mods_db 词缀组/暗金词条的 officialText 部分来自 POE1 旧措辞或 poe2db 直译，
 *       在国服市集官方 stat 文本（trade2_stats_flat.json）里不存在 → content.js
 *       按 officialText 搜索下拉必然未命中（实测：「该装备的攻击暴击率提高 #%」）。
 *
 * 修正策略（对每条 officialText）：
 *   1. 已在市集宇宙 → 跳过
 *   2. statIds 反查：组内任一 stat_id 在 trade2 有文本 → 用它（explicit 优先）
 *   3. CN_FIX 静态纠错表：手工核对的旧措辞 → 市集真名
 *   4. 都救不回 → 保留原文（填表失败时 content.js 有兜底探测）
 *
 * 幂等：可重复运行。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'extension', 'data', 'mods_db.json');
const FLAT_FILE = path.join(ROOT, 'data', 'trade2_stats_flat.json');

const flat = JSON.parse(fs.readFileSync(FLAT_FILE, 'utf8'));
const byCn = new Set(flat.filter((s) => s.text).map((s) => s.text));
/* stat_id → 市集中文（explicit > implicit > 其他；同 id 多 type 文本一致，取首个即可） */
const idToText = {};
const typeW = (t) => (t === 'explicit' ? 0 : t === 'implicit' ? 1 : t === 'pseudo' ? 2 : 3);
for (const s of flat) {
  if (!s.id || !s.text) continue;
  if (!idToText[s.id] || typeW(s.type) < typeW(idToText['_w_' + s.id] ?? 9)) {
    idToText[s.id] = s.text;
    idToText['_w_' + s.id] = typeW(s.type);
  }
}

/* 静态纠错表：旧措辞 → 市集真名（2026-09-16 探针核对）。
 * 只收语义完全对应、市集确实存在的；语义对不上的宁可不动（宁缺毋滥）。 */
const CN_FIX = {
  '镶嵌的增幅器物品效果提高 #%': '镶嵌的物品效果提高 #%',
  '在场范围提高 #%': '同场效果范围扩大 #%',
  '你被冻结的持续时间降低 #%': '你被冰冻的持续时间缩短 #%',
  '该装备精魂提高 #%': '精魂提高 #%',
  '元素异常状态阈值提高 #%': '异常状态阈值提高 #%',
  '该装备的攻击暴击率提高 #%': '攻击暴击率提高 #%',
  '该装备的物理伤害提高 #%': '物理伤害提高 #%',
  '该装备的攻击速度提高 #%': '攻击速度加快 #%',
  '该装备的施法速度提高 #%': '施法速度加快 #%',
  '攻击速度提高 #%': '攻击速度加快 #%',
  '施法速度提高 #%': '施法速度加快 #%',
  '技能速度提高 #%': '技能速度加快 #%',
  '冷却回复速度提高 #%': '冷却回复速度加快 #%',
  '暴击率提高 #%': '攻击暴击率提高 #%',
  '品质上限 #%': '品质上限为 #%',
  '闪避与能量护盾提高 #%': '该装备的闪避与能量护盾提高 #%',
  '# 生命上限': '# 最大生命',
  '# 魔力上限': '# 最大魔力',
  /* 二次探针补充（2026-09-16） */
  '在你格挡时获得#魔力': '魔力在你格挡时 #',
  '在你格挡时获得#生命': '生命在你格挡时 #',
  '击败敌人时有 #% 的几率获得一个能量球': '击败敌人时有 #% 的几率获得一次充能',
  '印记技能的施法速度提高 #%': '你的印记技能效果提高 #%',
  '#% 的溢出几率发射一支额外箭矢': '弓类攻击发射 # 支额外箭矢',
  '投射物分叉时，有 #% 的几率发射一个额外投射物': '投射物分裂时，有 #% 的几率发射一个额外投射物',
};

const mods = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

let gTotal = 0, gFixedStat = 0, gFixedMap = 0, gLeft = 0;
const leftSamples = [];
for (const c of mods.categories) {
  for (const gr of c.affixGroups || []) {
    gTotal++;
    const ot = gr.officialText || '';
    if (!ot || byCn.has(ot)) continue;
    // ① statIds 反查
    let fixed = null;
    for (const sid of gr.statIds || []) {
      const t = idToText[sid];
      if (t && byCn.has(t)) { fixed = t; break; }
    }
    if (fixed) { gr.officialText = fixed; gFixedStat++; continue; }
    // ② 静态纠错表
    const mapped = CN_FIX[ot];
    if (mapped && byCn.has(mapped)) { gr.officialText = mapped; gFixedMap++; continue; }
    // ③ 救不回：市集已无此词条（外延系/植物/变形等 POE2 0.5 移除）→ 打标，popup 下拉禁用
    gLeft++;
    gr._noTrade = true;
    if (leftSamples.length < 20) leftSamples.push(c.baseSlug + ' | ' + ot);
  }
}

/* 暗金词条 m.o 同样修正（statIds = m.s） */
let uTotal = 0, uFixed = 0, uLeft = 0;
for (const c of mods.categories) {
  for (const b of c.bases || []) {
    for (const m of b.mods || []) {
      uTotal++;
      const o = m.o || '';
      if (!o || byCn.has(o)) continue;
      let fixed = null;
      for (const sid of m.s || []) {
        const t = idToText[sid];
        if (t && byCn.has(t)) { fixed = t; break; }
      }
      if (fixed) { m.o = fixed; uFixed++; }
      else { m._noTrade = true; uLeft++; }
    }
  }
}

fs.writeFileSync(DB_FILE, JSON.stringify(mods));
console.log(`affixGroups: total=${gTotal} statIds反查=${gFixedStat} 静态纠错=${gFixedMap} 保留=${gLeft}`);
console.log(`unique mods: total=${uTotal} 修正=${uFixed} 保留=${uLeft}`);
if (leftSamples.length) console.log('--- 组级保留样本 ---\n' + leftSamples.join('\n'));
