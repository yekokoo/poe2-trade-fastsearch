/**
 * build_implicit_groups.js — 把「基底固有词缀」注入 mods_db.json 的 affixGroups
 *
 * 背景（任务 #34）：市集「状态过滤」下拉里，「基底」组（mutate-type-implicit）与
 * 「技能」组（mutate-type-skill）都是可筛选项，但 mods_db 的 affixGroups 只收录了
 * 前缀/后缀/瓦尔/特殊。插件面板要把「基底」卡片排到「前缀」之前、词缀/范围像
 * 前后缀一样填写，就要求每个分类的 affixGroups 里有 preSuf:'implicit' 的词缀组。
 *
 * 数据源：各分类普通基底的 panel.implicit（poe2db 面板固有行，1132 条/6028 基底，
 * 比 props.implicit 153 条全得多）。按分类去重后逐条对齐官方 statId：
 *   ① 原文直查：peer 基底组(implicit.*) → peer 技能组(skill.*) → flat 全量
 *   ② VOCAB 词汇替换 + tplOf 模板归一（数值→#）后再查
 *   ③ OVERRIDE 精确改写（面板措辞 → 市集措辞）
 *   ④ 技能名回退（获得技能: X → 获得技能: 等级 # X'）
 * 未对齐的文本不注入（官方市集筛不了，注入反而污染下拉）。
 *
 * 幂等：先清掉上次注入的（source==='implicit'）再重建；只重写 mods_db.json。
 * 运行：node scripts/build_implicit_groups.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'extension/data/mods_db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

const peer = require(path.join(ROOT, 'data/peer_trade2state_cn.json'));
const flat = require(path.join(ROOT, 'data/trade2_stats_flat.json'));

/* ---------- 对齐索引 ---------- */
const norm = (s) => String(s).replace(/\s+/g, '');
const peerBase = new Map();   // 规范化文本 → implicit.stat_*（市集「基底」组，111 条）
const peerSkill = new Map();  // 规范化文本 → skill.*（市集「技能」组，55 条）
peer.forEach((g) => {
  (g.entries || []).forEach((e) => {
    const t = norm(e.text);
    if (g.id === 'implicit') peerBase.set(t, e.id);
    else if (g.id === 'skill') peerSkill.set(t, e.id);
  });
});
// flat 兜底（trade2 全量 4754 条）：implicit.* 与基底组同源；explicit.* 提供措辞同源的外延项
const flatMap = new Map();
flat.forEach((e) => { if (!flatMap.has(norm(e.text))) flatMap.set(norm(e.text), e.id); });

function statTypeOf(id) {
  if (id.startsWith('implicit.')) return 'implicit';
  if (id.startsWith('skill.')) return 'skill';
  if (id.startsWith('pseudo.')) return 'pseudo';
  return 'explicit';
}

/** 模板归一：面板具体值文本 ↔ 官方 # 模板 可比。
 * 「+(10—15) 力量」→「#力量」；「移动速度提高 10%」→「移动速度提高#%」；
 * 「攻击附加 1 - 3 物理伤害」→「攻击附加#-#物理伤害」（ASCII 间隔号区间保留两个 #）。 */
function tplOf(text) {
  return String(text)
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/(?<![\d.])[+（(]*[\d.]+\s*[—~到]\s*[\d.]+%?\)*(?!\d)/g, '#')   // (x—y) / x—y / x~y → #
    .replace(/(?<![\d.])[+（(]*[\d.]+\s*-\s*[\d.]+%?\)*(?!\d)/g, '# - #')    // x - y → # - #
    .replace(/(?<![\d.])[+（(]*[\d.]+(?=%\))*(?!\d)/g, '#')                  // 单数值（% 留在外面 → 10% → #%）
    .replace(/(?<![\d.])[+（(]*[\d.]+\)*(?!\d)/g, '#')                       // 单数值（无%）→ #
    .replace(/#+/g, '#')
    .replace(/\+/g, '')
    .replace(/\s+/g, '');
}

/* ---------- 词表（面板措辞 → 市集措辞） ---------- */
const VOCAB = [
  [/生命上限/g, '最大生命'],
  [/魔力上限/g, '最大魔力'],
  [/能量护盾上限/g, '最大能量护盾'],
  [/咒符位/g, '咒符栏'],
  [/移动速度提高/g, '移动速度加快'],
  [/攻击速度提高/g, '攻击速度加快'],
  [/施法速度提高/g, '施法速度加快'],
  [/箭矢速度提高/g, '箭矢速度加快'],
  [/弩箭速度提高/g, '弩箭速度加快'],
  [/投射物速度提高/g, '投射物速度加快'],
  [/效果区域提高/g, '效果区域扩大'],
  [/近战打击范围提高/g, '近战打击范围扩大'],
  [/几率导致流血/g, '几率造成流血'],
  [/持续时间提高/g, '持续时间延长'],
  [/异常状态时间降低/g, '异常状态时间缩短'],
  [/品质上限\s*\+/g, '品质上限为'],
];

/** 精确改写（模板/词表都无法弥合的措辞差异）：面板文本 → 官方文本 */
const OVERRIDE = {
  '生命上限提高 (4—6)%': '生命上限提高 #%',        // 面板固定范围写法
  '魔力上限提高 (4—6)%': '魔力上限提高 #%',
  '+1% 全部抗性上限': '#% 元素抗性上限',            // 官方三合一
  '攻击有 (20—30)% 的几率导致流血': '击中时有 #% 的几率造成流血',
  // 皮革带子「允许的前缀/后缀」组合变体：面板一行含两条信息，官方按前/后缀拆两条
  '允许的前缀 +1允许的后缀 -1': '允许的前缀 #',
  '允许的前缀 -1允许的后缀 +1': '允许的后缀 #',
  '允许的前缀 +2允许的后缀 -2': '允许的前缀 #',
  '允许的前缀 -2允许的后缀 +2': '允许的后缀 #',
  '允许的前缀 -1': '允许的前缀 #',
  '允许的后缀 -1': '允许的后缀 #',
  // 几率类：面板带具体值，官方为无数值词条
  '击中时有 40% 的几率使目标恍惚': '击中时使目标恍惚',
  '击中时有 (20—50)% 的几率使目标恍惚': '击中时使目标恍惚',
  // 武器命中怒火 / 溅射：官方措辞不同
  '击中时赋予 1 点怒火': '近战击中时获得 # 怒火',
  '打击造成溅射伤害': '打击对 1.5 米内的目标造成溅射伤害',
  // 武器暴击伤害加成：官方挂在「攻击伤害的」下
  '+(5—10)% 暴击伤害加成': '攻击伤害的暴击伤害加成 #%',
  '+(20—30)% 暴击伤害加成': '攻击伤害的暴击伤害加成 #%',
  // 组合变体（双降）：官方按「前缀-1 后缀-1」两条筛项各对一半，此处按后缀项兜底
  '允许的前缀 -1允许的后缀 -1': '允许的后缀 #',
  // 武器固有 vs 官方筛项措辞差异
  '物理伤害的 4% 转化为魔力偷取': '物理伤害的 #% 转化为魔力偷取',
  '你造成的流血强度提高 50%': '你造成的流血强度提高 #%',
  '暴击击败敌人时触发爆炸，造成相当于其生命 10% 的物理伤害': '暴击击败敌人时触发爆炸，造成相当于其生命 #% 的物理伤害',
  '此武器的近战打击范围提高 16%': '此武器的近战打击范围扩大 #%',
  '此武器的近战打击范围提高 25%': '此武器的近战打击范围扩大 #%',
  '100% 的几率穿透一个敌人': '#% 的几率穿透一个敌人',
};

/** 面板技能名 → 官方技能名（官方模板为「获得技能: 等级 # <名>」） */
const SKILL_FIX = {
  '魔侍武士': '魔侍武士召唤生物',
  '镇魂曲': '谱写镇魂曲',
  '寒冰掌': '霹雳掌',
};

/** preprocess 后仍 MISS 的精确改写（含变体前缀原文，剥前缀逻辑对全角空格变体不生效） */
const POST_OVERRIDE = {};

/** 已知官方无对应筛项 → 静默跳过（不算未对齐） */
const SKIP_PATTERNS = [
  /^local weapon implicit hidden/,        // 武器隐藏固有（引擎内部，不可筛）
  /符文结界/,                              // 官方无符文结界筛项
  /^20% 的药剂回复量立即生效$/,
  /^必定命中$/,
  /^有 3 个插槽$/,                          // 插槽数量走附加条件
  /^战吼额外被强化/,
  /^所有被腐化技能宝石等级提高/,
  /^该物品可以使用催化剂$/,
  /^你受到的异常状态的减速强度降低/,        // 官方只有「提高」方向，语义相反不能借用
  /^投射物射程降低/,                        // 同上
  /^药剂的 .*生命回复效果也作用于符文结界$/,
  /^护甲完全破损效果提高/,
  /^\+50% 的溢出几率发射一支额外箭矢$/,
  /怒火上限$/,                              // 官方无「# 怒火上限」筛项
  /^元素异常状态阈值提高/,                  // 官方仅天赋树措辞（被抑制的小型天赋…），裸筛项不存在
  /^你造成的流血伤害生效速度加快/,          // 官方无流血专属生效速度筛项
  /^你造成的点燃的伤害生效速度加快/,        // 同上
  /^获得技能: (战矛飞掷|闪电|折射之镜|鸦群密谋|盘绕魔弹)$/, // 不在官方技能组 55 条内
];

/** 对齐单条面板固有文本 → { id, officialText, statType } 或 null */
function align(text) {
  // 0) 已知不可筛
  if (SKIP_PATTERNS.some((re) => re.test(text))) return { skip: true };
  // 0.5) 二次精确改写（变体前缀原文等）
  if (POST_OVERRIDE[text]) text = POST_OVERRIDE[text];
  const k = norm(text);
  // 1) 原文直查：基底组 → 技能组 → flat 全量
  if (peerBase.has(k)) return { id: peerBase.get(k), officialText: null };
  if (peerSkill.has(k)) return { id: peerSkill.get(k), officialText: null };
  if (flatMap.has(k)) return { id: flatMap.get(k), officialText: null };
  // 2) 精确改写后重查
  const ov = OVERRIDE[text];
  if (ov) {
    const ok = norm(ov);
    if (peerBase.has(ok)) return { id: peerBase.get(ok), officialText: ov };
    if (peerSkill.has(ok)) return { id: peerSkill.get(ok), officialText: ov };
    if (flatMap.has(ok)) return { id: flatMap.get(ok), officialText: ov };
  }
  // 3) 词表替换 + 模板归一比对
  let t = text;
  for (const [re, to] of VOCAB) t = t.replace(re, to);
  const tk = tplOf(t);
  for (const [mk, mv] of peerBase) if (tplOf(mk) === tk) return { id: mv, officialText: null };
  for (const [mk, mv] of peerSkill) if (tplOf(mk) === tk) return { id: mv, officialText: null };
  for (const [mk, mv] of flatMap) if (tplOf(mk) === tk) return { id: mv, officialText: null };
  // 4) 技能名回退：「获得技能: X」/「获得技能: 等级 N X」→ 官方「获得技能: 等级 # X'」
  // 兼容全角冒号「：」与无空格写法
  const sm = text.replace(/：/g, ': ').match(/^获得技能:\s*(?:等级\s*(\d+)\s*)?(.+)$/);
  if (sm) {
    const raw = sm[2].trim();
    const name = SKILL_FIX[raw] || raw;
    for (const [mk, mv] of peerSkill) {
      const officialName = mk.replace(/^获得技能:等级#/, '').replace(/^获得技能:/, '');
      if (officialName === name) return { id: mv, officialText: null };
    }
  }
  return null;
}

/** 面板文本预处理：剥掉 poe2db 变体表列头前缀（「护甲·敏捷 · 」「副手·力量 · 」），
 * 切掉拼接的 local weapon 隐藏段 */
function preprocess(text) {
  let t = String(text).replace(/^\S{1,10}·\S{1,10} · /, '');
  const li = t.indexOf('local weapon implicit hidden');
  if (li === 0) return null;                       // 纯隐藏段
  if (li > 0) t = t.slice(0, li).trim();           // 混合段取前半
  return t || null;
}

/* ---------- 注入 ---------- */
let injected = 0, skipped = 0;
const missed = [];
const byType = {};

db.categories.forEach((cat) => {
  // 幂等：清掉上次注入的
  cat.affixGroups = cat.affixGroups.filter((g) => g.source !== 'implicit');

  // 收集本分类普通基底固有词缀（按文本去重）
  const texts = new Map();
  (cat.bases || []).forEach((b) => {
    if (b.unique) return;
    const t = b.panel && b.panel.implicit;
    if (!t) return;
    if (!texts.has(t)) texts.set(t, { count: 0, sample: b.name });
    texts.get(t).count++;
  });

  const groups = [];
  for (const [raw] of texts) {
    const text = preprocess(raw);
    if (!text) { skipped++; continue; }
    const a = align(text);
    if (!a) { missed.push(`${cat.cnName} · ${text}`); continue; }
    if (a.skip) { skipped++; continue; }
    const officialText = a.officialText ||
      (flat.find((x) => x.id === a.id) || {}).text || text;
    const st = statTypeOf(a.id);
    groups.push({
      id: `implicit|${text}`,
      preSuf: 'implicit',
      source: 'implicit',
      text,
      template: text,
      officialText,
      statIds: [a.id],
      statType: st,
      tiers: [],        // 固有词缀无 T 级（面板数值随基底等级浮动），结构对齐渲染层
    });
    byType[st] = (byType[st] || 0) + 1;
  }
  if (groups.length) cat.affixGroups.push(...groups);
  injected += groups.length;
});

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 1), 'utf8');

/* ---------- 报告 ---------- */
console.log(`注入完成：${injected} 条基底词缀组；静默跳过 ${skipped} 条（官方无筛项/隐藏段）`);
console.log('statType 分布:', JSON.stringify(byType));
console.log(`未对齐: ${missed.length} 条（不注入，需人工确认）`);
const uniqMiss = [...new Set(missed.map((s) => s.replace(/^[^·]+· /, '')))];
uniqMiss.forEach((s) => console.log('  MISS', s));
