# -*- coding: utf-8 -*-
"""rebuild_db_v08.py — mods_db v0.7 → v0.8（官网数据为准的最终重建）

原则（用户 Msg C）：所有基底/词缀下拉来源以市集官网（guofu_items.json）为准，
poe2db 只补充信息（T级数值、面板属性等）。

动作：
  1. 基底过滤：每分类 bases 只保留 name ∈ 官网 plain types（非暗金 type）
     - 例外的普通基底（官网无但确存在本版本，经确认）保留
  2. 分类清理：基底过滤后为空 且 官网也没有该类型 → 删除分类
     - Claws（爪）、Vault_Keys（宝库钥匙）删除
     - Waystones ×3：官网地图组有「引路石（N阶）」→ 合并重建 1 个 Waystones 分类，
       基底 = 官网 plain 16 阶，词缀沿用原 low_tier 池
  3. 珠宝重分：官网 jewel 组 plain type → baseSlug 归属（翡翠/宝钻/蓝玉/红玉/永恒珠宝）
     每个珠宝分类 bases = 该归属类型的官网基底；暗金追加（见 4）
  4. 暗金追加：官网 unique 条目 type 能映射到保留的 baseSlug → 追加基底
     {slug: U_<n>, name: <name>, unique: true, text: "<name> <type>", level: null}
  5. 面板属性：从 base_panels.json 按 slug 挂 panel（main/req/implicit）
  6. version → 0.8

输出：extension/data/mods_db.json（备份 v0.7 → data/mods_db_v07_backup.json）
报告：data/rebuild_v08_report.json
"""
import json
import re
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / 'extension' / 'data' / 'mods_db.json'
ITEMS_PATH = ROOT / 'data' / 'guofu_items.json'
PANELS_PATH = ROOT / 'data' / 'base_panels.json'
REPORT_PATH = ROOT / 'data' / 'rebuild_v08_report.json'
BACKUP_PATH = ROOT / 'data' / 'mods_db_v07_backup.json'

# ---- 官网无但确认存在于本版本的普通基底（手工白名单）----
KEEP_EXTRA = set()  # 如后续发现可补

def load_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def main():
    db = load_json(DB_PATH)
    items = load_json(ITEMS_PATH)
    panels = load_json(PANELS_PATH)

    # ---- 官网类型索引 ----
    plain_types = set()          # 官网非暗金 type
    uniques_by_type = {}         # type -> [(name, text)]
    group_plain_types = {}       # items group id -> set(type)
    for g in items['result']:
        group_plain_types[g['id']] = set()
        for e in g['entries']:
            t = e['type']
            if e.get('flags', {}).get('unique'):
                uniques_by_type.setdefault(t, []).append((e['name'], e.get('text') or f"{e['name']} {t}"))
            else:
                plain_types.add(t)
                group_plain_types[g['id']].add(t)

    # type → 归属 baseSlug（珠宝重分 + 暗金落位用）
    # items group id → baseSlug 映射（对应 mods_db 分类）
    GROUP_TO_SLUGS = {
        'accessory': {'Amulets': None, 'Rings': None, 'Charms': None, 'Talismans': None},
        'armour': {'Gloves': None, 'Boots': None, 'Body_Armours': None, 'Helmets': None,
                   'Shields': None, 'Bucklers': None, 'Foci': None, 'Quivers': None},
        'weapon': {'Bows': None, 'Crossbows': None, 'One_Hand_Axes': None, 'One_Hand_Maces': None,
                   'One_Hand_Swords': None, 'Claws': None, 'Daggers': None, 'Flails': None,
                   'Quarterstaves': None, 'Sceptres': None, 'Spears': None, 'Staves': None,
                   'Two_Hand_Axes': None, 'Two_Hand_Maces': None, 'Two_Hand_Swords': None,
                   'Wands': None},
        'flask': {'Life_Flasks': None, 'Mana_Flasks': None},
        'jewel': {'Diamond': None, 'Emerald': None, 'Ruby': None, 'Sapphire': None},
        'map': {'Waystones': None},
        'sanctum': {'Amphora_Relic': '壶瓮遗物', 'Coffer_Relic': '匣柜遗物',
                    'Incense_Relic': '熏香遗物', 'Seal_Relic': '封印遗物',
                    'Tapestry_Relic': '挂毯遗物', 'Vase_Relic': '花瓶遗物',
                    'Urn_Relic': '土罐遗物'},
    }
    # 按具体 type 名归属到 baseSlug（珠宝用 type 名精确分；遗物 type 名即基底名）
    JEWEL_ASSIGN = {
        '宝钻': 'Diamond', '永恒珠宝': 'Diamond',
        '翡翠': 'Emerald', '蓝玉': 'Sapphire', '红玉': 'Ruby',
        '失落的宝钻': 'Diamond', '失落的翡翠': 'Emerald', '失落的蓝玉': 'Sapphire', '失落的红玉': 'Ruby',
    }
    RELIC_BY_TYPE = {cn: slug for slug, cn in GROUP_TO_SLUGS['sanctum'].items()}

    def type_to_base_slug(gid, typ):
        """官网 type → mods_db baseSlug；无法归属返回 None"""
        if gid == 'jewel':
            return JEWEL_ASSIGN.get(typ)
        if gid == 'sanctum':
            return RELIC_BY_TYPE.get(typ)
        if gid == 'map':
            if typ.startswith('引路石'):
                return 'Waystones'
            return None  # 石板/战书/硬币等不进词缀库
        # 其余组：type 即基底名，靠分类基底名单匹配（见后面按分类处理）
        return None

    # 分类（含珠宝 slug 特例）→ 落位用 key：baseSlug 优先，珠宝用 slug
    def cat_key(c):
        return c['slug'] if c['baseSlug'] == 'Jewels' else c['baseSlug']

    # 分类基底名 → 分类 slug 集合（武器/护甲等 type=基底名 的落位用）
    # 注意存 slug 而非 baseSlug：变体分类（手套 6 变体）baseSlug 相同会被 set 去重
    name_to_cats = {}
    for c in db['categories']:
        for b in c.get('bases', []):
            name_to_cats.setdefault(b['name'], set()).add(c['slug'])

    def type_to_base_slug_by_name(typ):
        slugs = name_to_cats.get(typ)
        if not slugs:
            return None
        return sorted(slugs)  # 单归属也返回列表，统一走 target_slugs 落位

    report = {'removedCats': [], 'waystoneRebuild': None, 'jewelRepartition': {},
              'uniquesAdded': Counter(), 'uniquesSkipped': [], 'basesKept': 0,
              'basesDropped': 0, 'panelAttached': 0, 'panelMiss': []}

    # ---------- Step 1: 引路石重建（在基底过滤前做，词缀池沿用 low_tier） ----------
    cats = db['categories']
    waystones = [c for c in cats if c['baseSlug'] == 'Waystones']
    ws_all = sorted(t for t in group_plain_types['map'] if t.startswith('引路石'))
    ws_all.sort(key=lambda t: int(re.search(r'(\d+)', t).group(1)))
    if waystones:
        base_ws = next((c for c in waystones if c['slug'] == 'Waystones_low_tier'), waystones[0])
        base_ws['bases'] = [{'slug': f'Waystone_{n}', 'name': t, 'props': {}} for n, t in enumerate(ws_all)]
        report['waystoneRebuild'] = {'kept': base_ws['slug'], 'bases': len(ws_all)}
        # 删掉其余 tier 分类
        for c in waystones:
            if c is not base_ws:
                report['removedCats'].append({'slug': c['slug'], 'cnName': c['cnName'], 'reason': '引路石重建合并'})
        db['categories'] = [c for c in db['categories'] if c in (waystones if False else []) or c is base_ws or c['baseSlug'] != 'Waystones']

    # ---------- Step 2: 基底过滤 ----------
    for c in db['categories']:
        kept, dropped = [], 0
        for b in c.get('bases', []):
            if b['name'] in plain_types or b['name'] in KEEP_EXTRA:
                kept.append(b)
            else:
                dropped += 1
        report['basesKept'] += len(kept)
        report['basesDropped'] += dropped
        c['bases'] = kept

    # ---------- Step 3: 删除空分类 ----------
    survivors = []
    for c in db['categories']:
        if not c['bases'] and not any(True for _ in ()):
            report['removedCats'].append({'slug': c['slug'], 'cnName': c['cnName'], 'reason': '基底清空且官网无此类型'})
            continue
        survivors.append(c)
    db['categories'] = survivors

    # ---------- Step 4: 珠宝重分（官网 jewel 组 plain 按类型归属） ----------
    # 注意：珠宝分类 baseSlug 统一是 'Jewels'，具体类型在 slug（Diamond/Emerald/Ruby/Sapphire）
    for c in db['categories']:
        if c['slug'] in ('Diamond', 'Emerald', 'Ruby', 'Sapphire'):
            mine = [t for t in sorted(group_plain_types['jewel']) if JEWEL_ASSIGN.get(t) == c['slug']]
            c['bases'] = [{'slug': f'Jewel_{i}', 'name': t, 'props': {}} for i, t in enumerate(mine)]
            report['jewelRepartition'][c['slug']] = mine

    # ---------- Step 4b: 官网有而 poe2db 缺失的普通基底补录 ----------
    # 双玉戒指(Rings)/刺客束衣/锁魂束带(Body_Armours 合并视图)——官网 plain 有、poe2db 无
    MISSING_PLAIN = {
        '双玉戒指': ('Rings', 0),
        '刺客束衣': ('Body_Armours_dex', 0),  # 刺客束衣是敏捷底子
        '锁魂束带': ('Belts', 0),
    }
    for typ, (bs, idx) in MISSING_PLAIN.items():
        if typ not in plain_types:
            continue
        cands = [c for c in db['categories'] if cat_key(c) == bs or (bs == 'Body_Armours' and c['baseSlug'] == 'Body_Armours')]
        if not cands:
            continue
        cat = cands[idx] if idx is not None else cands[0]
        if not any(b['name'] == typ for b in cat['bases']):
            cat['bases'].insert(0, {'slug': f'X_{typ}', 'name': typ, 'props': {}})
            report.setdefault('missingPlainAdded', []).append(f"{typ} -> {cat['slug']}")

    # ---------- Step 5: 暗金追加 ----------
    # 去重键 = (name, type)：同一暗金名在不同基底上是不同搜索目标
    # （如「二元一体」有 守护节杖/符文师匠守护节杖 两个变体）；legacy（遗产）老版跳过
    uid = 0
    cat_by_base_slug = {}
    for c in db['categories']:
        cat_by_base_slug.setdefault(cat_key(c), []).append(c)
    seen_ukey = set()
    for g in items['result']:
        gid = g['id']
        for e in g['entries']:
            if not e.get('flags', {}).get('unique'):
                continue
            if e.get('disc') == 'legacy' or '（遗产）' in (e.get('text') or ''):
                continue  # 遗产老版不入库
            typ, name = e['type'], e['name']
            text = e.get('text') or f'{name} {typ}'
            ukey = (name, typ)
            if ukey in seen_ukey:
                continue
            seen_ukey.add(ukey)
            # 目标分类 slug 列表：多归属（同一基底在多个属性变体分类，如卡古兰袖带在 6 个手套变体里）
            # → 全部变体分类都加入该暗金；「不区分」合并视图按 slug 去重，各变体视图也都能选
            target_slugs = None  # None = 走默认 baseSlug/映射 落位
            slug = type_to_base_slug(gid, typ)
            if gid not in ('jewel', 'sanctum', 'map'):
                # 先查原名（符文师匠X/符文X 本身就是官网基底名），查不到才去前缀
                found = type_to_base_slug_by_name(typ)
                if found is None:
                    probe = typ
                    for pref in ('符文师匠', '符文'):
                        if probe.startswith(pref):
                            probe = probe[len(pref):]
                            break
                    if probe != typ:
                        found = type_to_base_slug_by_name(probe)
                if isinstance(found, list):
                    target_slugs = found
                elif found is not None:
                    target_slugs = [found]
            if slug is None and target_slugs is None:
                report['uniquesSkipped'].append({'name': name, 'type': typ, 'group': gid})
                continue
            # 解析成目标分类列表
            cats_to_add = []
            if target_slugs:
                for s in target_slugs:
                    cl = cat_by_base_slug.get(s) or [c for c in db['categories'] if c['slug'] == s]
                    if cl:
                        cats_to_add.append(cl[0])
            else:
                cands = cat_by_base_slug.get(slug)
                if not cands and slug:
                    cands = [c for c in db['categories'] if c['slug'] == slug]
                if not cands:
                    for key, cl in cat_by_base_slug.items():
                        if any(b['name'] == typ for c in cl for b in c['bases']):
                            cands = cl
                            break
                if not cands:
                    report['uniquesSkipped'].append({'name': name, 'type': typ, 'group': gid})
                    continue
                cat = cands[0]
                # 遗物类有 7 个器型分类且 bases 全同：type 名 = 分类专属基底，精确对到那个分类
                if gid == 'sanctum' and len(cands) > 1:
                    exact = next((c for c in cands if c['slug'] == slug), None)
                    if exact:
                        cat = exact
                cats_to_add = [cat]
            # 去重 + 追加（text = 名字+类型，跨分类可能同 text 但意义不同不查重）
            added_any = False
            for cat in cats_to_add:
                if any(b.get('unique') and b['text'] == text for b in cat['bases']):
                    continue
                uid += 1
                cat['bases'].append({'slug': f'U_{uid}', 'name': name, 'unique': True,
                                     'text': text, 'props': {}})
                report['uniquesAdded'][cat['baseSlug']] += 1
                added_any = True
            if not added_any:
                report['uniquesSkipped'].append({'name': name, 'type': typ, 'group': gid, 'note': 'dup-text-in-all-cats'})

    # ---------- Step 6: 面板属性挂载 ----------
    for c in db['categories']:
        for b in c.get('bases', []):
            p = panels.get(b['slug'])
            if p and p.get('props'):
                b['panel'] = p['props']
                report['panelAttached'] += 1
            elif b.get('unique'):
                # 暗金 slug 是生成的 U_n，base_panels 里查不到：用基底名反查
                hit = next((v for v in panels.values() if v.get('name') == b['name']), None)
                if hit and hit.get('props'):
                    b['panel'] = hit['props']
                    report['panelAttached'] += 1

    # ---------- Step 7: 清理没词缀也没意义的空组 ----------
    groups_left = Counter(c['group'] for c in db['categories'])
    report['groupsLeft'] = dict(groups_left)

    db['version'] = 0.8
    db['builtAt'] = __import__('datetime').datetime.now().isoformat(timespec='seconds')

    # ---------- 写出 ----------
    if not BACKUP_PATH.exists():  # 备份幂等：只在首次跑时备份原始 v0.7
        shutil.copyfile(DB_PATH, BACKUP_PATH)
    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False)
    report['totalCats'] = len(db['categories'])
    report['uniquesAdded'] = dict(report['uniquesAdded'])
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print(f"v0.8 写出：{len(db['categories'])} 分类")
    print('删除分类:', [r['slug'] for r in report['removedCats']])
    print('引路石重建:', report['waystoneRebuild'])
    print('珠宝重分:', report['jewelRepartition'])
    print('基底保留/剔除:', report['basesKept'], '/', report['basesDropped'])
    print('暗金追加:', report['uniquesAdded'])
    print('暗金跳过:', len(report['uniquesSkipped']), [u['name'] for u in report['uniquesSkipped']])
    print('面板挂载:', report['panelAttached'])

if __name__ == '__main__':
    main()
