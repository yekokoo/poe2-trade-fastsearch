# POE2 市集速搜 — Edge 插件 v0.1.0

流放之路2国服市集（poe.game.qq.com/trade）快速筛选插件：选基底 → 锁词缀池 → 选T级 → 一键填入/参考清单。

## 当前状态（0.1 骨架）

| 模块 | 状态 | 说明 |
|------|------|------|
| 词缀库 | ✅ 可用 | `data/mods_db.json`，已验证双手锤 + 力量手套 |
| popup 三步交互 | ✅ 可用 | 选基底/物等 → 前缀/后缀分组 → T级+数值下限 |
| 来源色标 | ✅ | 基础=灰 渎灵=绿 合金=琥珀 斯鲁德=紫 精华=蓝 瓦尔=红 |
| 市集自动填表 | ⚠️ 骨架 | 需要登录态的市集页DOM来校准选择器 |
| 降级条件清单 | ✅ 可用 | 填表失败时在市集页展示浮层清单 |

## 安装（开发者模式）

1. Edge 打开 `edge://extensions`
2. 左下角开启「开发人员模式」
3. 点「加载解压缩的扩展」，选择本 `extension` 目录
4. 登录 https://poe.game.qq.com/trade 后点工具栏图标使用

## 数据更新（赛季更新时）

```bash
# 1. 解析新分类（可传多个slug；护甲类用属性变体页如 Gloves_str）
node scripts/parse_mods.js Two_Hand_Maces Gloves_str

# 2. 重建插件词缀库
node scripts/build_plugin_db.js
```

分类 slug 全集见 `data/categories_map.json`（34类全部验证通过）。
护甲/副手类词缀页需用属性变体：`Gloves_str`、`Boots_dex`、`Body_Armours_str_dex_int`、`Helmets_int`、`Shields_str` 等（见 poe2db /cn/Modifiers）。

## 词缀来源分组（poe2db ModsView JSON）

| poe2db 分组 | 插件来源 | 说明 |
|-------------|---------|------|
| `normal` | 基础 | 常规掉落词缀池 |
| `desecrated` | 渎灵 | 深渊灵魂之井显现词缀（65+） |
| `destruction` | 斯鲁德的神力 | 增幅器毁灭词缀（武器） |
| `essence`/`perfect_essence` 内 `Code=Alloy*` | 合金 | 0.5 新造装通货注入词缀 |
| `essence`/`perfect_essence` 其余 | 精华 | 精华塑词 |
| `corrupted` | 瓦尔腐化 | 瓦尔宝珠腐化附魔 |

## 待办

- [ ] 抓取全部 59 个词缀页生成全量词缀库（任务 #5）
- [ ] 用登录态市集页校准自动填表选择器（任务 #4）
- [ ] 基底下拉与词缀联动过滤（按基底可出现的词缀）
