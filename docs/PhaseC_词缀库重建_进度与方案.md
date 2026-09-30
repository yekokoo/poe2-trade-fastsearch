# Phase C：物品词缀数据库三层重建 — 进度与方案（断点续作文档）

> 目的：按用户要求的三层 1:1 逻辑重建词缀库，解决「失落的蓝玉显示全部蓝玉词缀」「效果区域提高#%搜不到结果」等问题。
> 本文档记录：已完成 / 待完成 / 怎么做 / 数据保留位置。**中断后从「待完成」第一项继续即可。**
> 最后更新：2026-09-09（构建进行中）

## 一、三层架构（用户定义）

| 层 | 内容 | 来源 | 原始保留位置 | 加工产物 |
|---|---|---|---|---|
| ① 物品类别→词缀池 | 每个具体物品类别详情页完整词缀 | poe2db 详情页 ModsView JSON | `data/raw/<页面slug>.json` | `data/parsed/<slug>.json` |
| ② 物品统一名称↔类别 | 国服市集中文名 ↔ poe2db 页面 1:1 | 市集 items + poe2db 页 | `data/maps/base_name_map.json` | mods_db 分类 bases |
| ③ 词缀标准名映射 | 市集下拉文本 → stat id | 市集页状态(peer) + API + 下拉快照 | `data/peer_trade2state_cn.json` 等 | `data/official_stat_map.json`(osm) |

## 二、根因结论（已实锤，勿重复排查）

1. **基底挂错分类**：`rebuild_db_v08.py` 的 `JEWEL_ASSIGN` 把 失落的蓝玉/失落的红玉/失落的翡翠/失落的宝钻 硬塞进 Sapphire/Ruby/Emerald/Diamond 分类，共享蓝玉等普通珠宝的词缀池。
   poe2db 实况：失落的X是**独立页面**（Time-Lost_Sapphire 等），词缀全是「范围内的小型/核心天赋…」天赋圈词缀，与普通珠宝 58 条独立词缀**完全不同**（已抓取4页对比确认）。
2. **affixGroups statIds 陈旧错误**：老 `realign_official.js` contains 兜底产物未刷新（如 效果区域提高#% → enchant.stat_1646093658）。v0.6.4 重建的 osm 是对的（→ explicit.stat_280731498）。
3. 永恒珠宝（Timeless_Jewel）无 ModsView（军团机制珠宝无随机词缀），不需要词缀页。

## 三、已完成（✅）

| 步骤 | 产物 |
|---|---|
| ✅ 抓取失落的蓝玉/红玉/翡翠/宝钻 4 页原始 JSON | `data/raw/Time_Lost_{Sapphire,Ruby,Emerald,Diamond}.json` + `data/tmp/Time_Lost_*_page.html` |
| ✅ 确认 TLS 页 liquid 组 = 液化情感(Liquid Emotions)灌注词缀，归独立来源 | 分析记录在本文件 |
| ✅ 写 `scripts/align_affix_groups.js`（osm 层重对齐全库 affixGroups，无 contains）| 已跑：exact 3208 / vocab 28 / none 1358；db → v0.95；报告 `data/tmp/align_affix_report.json` |
| ✅ 失配分析：市集下拉快照(496) 缺珠宝专用词缀；flat/peer 有部分（措辞差异：流血持续时间**延长** vs poe2db 提高 等） | `data/tmp/align_affix_report.json` |

## 四、待完成（✅ 全部完成 @2026-09-09）

1. ✅ **align_affix_groups.js 加 fallback 层**：osm(prio1) → peer 页状态(prio2) → trade2_stats_flat(prio3)；仅 exact+受控vocab，禁 contains；probe 双探测 [officialText, text]。结果：osm 3321 / peer-exact 918 / peer-vocab 4 / none 841。
2. ✅ **build_time_lost_categories.js**：4 分类构建（95/88/113/194 组），liquid 液化情感新来源，失落的X 从普通珠宝分类移除，抗衡黑暗 迁入 Time_Lost_Diamond，parsed 留档，幂等可重跑。
3. ✅ 重跑对齐：珠宝 base 失配 55→22（剩余全部是官方市集确无文本的新词缀：变形时伤害/植物技能/在场范围提高/几率创口/几率恍惚/元素异常阈值/ES充能提前/魔力击败恢复带前缀版 —— 已宽搜 peer+flat 确认）。
4. ✅ E2E 四件套全绿：verify_tabs 34/34（断言更新为 ≥65 分类）· verify_unique_mods 25/25 · verify_local_redirect 21/21 · verify_wysiwyc 7/7。
5. ✅ manifest 0.6.5；`docs/版本更新_v0.6.5.md` 已写；memory 日志已写。
6. ⬜ **人工验收（需要用户在浏览器操作）**：
   - edge://extensions 重载扩展
   - 珠宝组出现独立 tab「失落的蓝玉/红玉/翡翠/宝钻」，词缀全是「范围内…」
   - 蓝玉 tab 基底只剩 蓝玉/聚光之石/天神之音，词缀池还是原 58 条独立词缀
   - 蓝玉 + 效果区域提高#% → 能搜到结果
   - 失落的蓝玉 + 范围内的小型天赋同时提供 冰霜伤害提高 #% → 能搜到结果
   - 暗金「抗衡黑暗 失落的宝钻」在失落的宝钻 tab 下可选，2 条固定词条正常

## 五、作业方式（本项目固定管线，以后照此办理）

```
抓取: node/python fetch poe2db /cn/<Slug> → 提取 new ModsView({...}) → data/raw/<slug>.json (+页面html留 data/tmp/)
解析: normalizeStr(模板#化) / extractValues / buildAffixGroups(preSuf|template 分组,T级=ilvl降序)
      来源映射见 parse_mods.js SOURCE_MAP（liquid 为本次新增）
对齐: align 链 = osm(prio1,市集下拉496) → peer(prio2,市集页状态) → flat(prio3,trade2静态)
      norm=仅中英文; 受控VOCAB同义词精确; 碰撞歧义跳过; 全程禁 contains; 失配如实记录
注入: 直接改 extension/data/mods_db.json（幂等脚本），版本号递增
验证: scripts/verify_*.js 四件套 E2E + 抽查用户案例
留档: raw/parsed/maps/reports 分目录保留，报告在 data/tmp/*_report.json
```

## 六、关键数据事实（防重复调查）

- 496 下拉快照抓自非珠宝语境，**不含**「范围内…」珠宝筛选项；peer 外延组含 191 条天赋圈词缀（珠宝下拉真实文本以 peer 为准）
- osm 缺口样本：`在场范围提高 #%` 在 496 里存在但 peer/api 均无 id → 保持失配
- peer/flat 措辞差异（vocab 已覆盖/需新增）：流血持续(延长↔提高)、被招架减益持续(延长↔提高)、护甲破损持续(延长↔提高)、击中稀有怪和传奇怪(官方) vs 击中稀有和传奇敌人(poe2db)、荆棘伤害提高✓、致盲效果提高✓、获得的X药剂充能提高✓、死亡凋零强度提高✓
- 官方真无对应：变形时伤害提高、植物技能的伤害提高、在场范围提高、能量护盾充能时间提前、怒火上限、几率使目标恍惚(flat 只有「击中时使目标恍惚」二元版，两个 stat id，不强行归一)
- TLS 页词缀量：Sapphire 60 normal / Ruby 53 / Emerald 77 / Diamond 160，另 desecrated 12 + corrupted 11 + corruption_upgrade 7 + liquid 14（Diamond liquid=4）
