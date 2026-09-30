/** content.js — 国服市集（poe.game.qq.com/trade2）自动填表。
 * 只做自动填表 + 结果 toast，无降级浮层。
 * 回填策略（基于保存的真实市集 DOM）：
 *  - 基底：.search-left .multiselect.search-select 的 multiselect__input 输入过滤 → mousedown 选项
 *          （暗金传「名字 类型」全文，普通基底传名字）
 *  - 词缀：.multiselect.filter-select-mutate 输入官方文本过滤 → 按类型(explicit/外延)选中选项
 *          → 轮询等待「状态过滤」组内新增 .filter 块 → 填 minmax 数值
 *          （选了 T 级但没手填数值 → 自动填 T 级数值范围）
 *  - 布尔开关（已鉴定/已腐化/已圣化）：filter-title 匹配的 .toggle-btn
 *  - 全部完成后点击 .search-btn
 */
(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'P2_FILL') {
      hidePanel();
      runFill(msg.payload).then(
        (r) => sendResponse(r),
        (e) => sendResponse({ ok: false, error: String(e && e.message || e) })
      );
      return true; // async response
    }
    if (msg?.type === 'P2_TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ ok: true });
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 词缀签名：仅保留中英文（去数字/符号/空白/换行/↵）。
   * 让面板文本「法术伤害提高 (45—49)% +(42—45) 魔力上限」与
   * 下拉选项「法术伤害提高 #% ↵ (42—45) 魔力上限」归一成同一签名。 */
  function affixSig(s) {
    return String(s).replace(/[^A-Za-z一-鿿]/g, '');
  }

  /** 搜索词：按非中英文字符切段，取最长连续段（截 12 字）。
   * 市集下拉是子串匹配：搜索词必须是官方文本的连续子串。
   * 例：「触发技能有 #% 的几率返还消耗能量的一半」切段 →
   *     「触发技能有」/「的几率返还消耗能量的一半」→ 取后者（整段去符号拼接「触发技能有的几率返还」
   *     在官方文本里不连续，必搜不到——v0.6.0 实测的暗金词条未命中根因）。
   * 混合词缀「法术伤害提高 (45—49)% +(42—45) 魔力上限」→ 同样命中「法术伤害提高」段。 */
  function affixKeyword(probe) {
    const parts = String(probe)
      .split(/[^A-Za-z一-鿿]+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return (parts[0] || '').slice(0, 12);
  }

  /** vue-multiselect 选项用 mousedown 选中（click 无效）。
   * opts.type: 'explicit'|'pseudo'|'implicit'(基底)|'skill'(技能) — 有类型标签的下拉按类型过滤
   * （词缀下拉用，防「综合」伪词缀抢占；暗金固有词条=基底组、获得技能=技能组）
   * opts.sig: 目标词缀签名 — 词缀下拉用：精确签名 → 选项签名含目标 → 原文包含
   * 返回选中项文本（去类型标签，规范化），未命中返回 null。 */
  const TYPE_CLASS = { pseudo: 'mutate-type-pseudo', explicit: 'mutate-type-explicit',
    implicit: 'mutate-type-implicit', skill: 'mutate-type-skill' };
  function pickOption(listEl, matchText, opts = {}) {
    const opts_ = [...listEl.querySelectorAll('.multiselect__option')]
      .filter((o) => !o.classList.contains('multiselect__option--disabled'))
      .filter((o) => !o.textContent.includes('未找到')); // 排除 noResult 占位
    if (!opts_.length) return null;
    const norm = (s) => String(s).replace(/\s+/g, '');
    const target = norm(matchText);
    const optText = (o) => {
      const clone = o.cloneNode(true);
      clone.querySelectorAll('.mutate-type').forEach((x) => x.remove());
      return norm(clone.textContent);
    };
    const optType = (o) => {
      const t = o.querySelector('.mutate-type');
      if (!t) return null;
      // 市集类型标签类：mutate-type-pseudo/explicit/implicit/skill 等（各只选其一，
      // 顺序注意 implicit 在 explicit 之后包含判定不受影响，逐个精确比对）
      for (const [type, cls] of Object.entries(TYPE_CLASS)) {
        if (t.classList.contains(cls)) return type;
      }
      return 'explicit';
    };
    // 类型过滤：仅当下拉里存在类型标签时生效
    const typed = opts_.some((o) => optType(o));
    let pool = opts_;
    if (typed && opts.type) {
      const byType = opts_.filter((o) => optType(o) === opts.type);
      if (byType.length) pool = byType;
    }
    let el = null;
    if (opts.sig) {
      el = pool.find((o) => affixSig(optText(o)) === opts.sig)
        || pool.find((o) => affixSig(optText(o)).includes(opts.sig))
        || pool.find((o) => optText(o).includes(target));
    } else {
      el = pool.find((o) => optText(o) === target)
        || pool.find((o) => optText(o).includes(target));
    }
    if (!el) return null;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return optText(el);
  }

  /** 打开 multiselect：点击 tags 区（input 聚焦），等下拉出现 */
  async function openMultiselect(ms) {
    const input = ms.querySelector('.multiselect__input');
    const tags = ms.querySelector('.multiselect__tags') || ms;
    tags.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input?.focus();
    for (let i = 0; i < 10; i++) {
      await sleep(60);
      if (ms.querySelector('.multiselect__content-wrapper')?.style.display !== 'none') return input;
    }
    return input;
  }

  /** 在 multiselect 里搜索并选中目标文本；返回 { picked, pickedText }
   * pickOpts 透传给 pickOption（type 过滤等） */
  async function searchPick(ms, text, pickOpts = {}) {
    const input = await openMultiselect(ms);
    if (!input) return { picked: false, pickedText: null };
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    const list = ms.querySelector('.multiselect__content');
    if (!list) return { picked: false, pickedText: null };
    const pickedText = pickOption(list, text, pickOpts);
    return { picked: !!pickedText, pickedText };
  }

  /** 最长公共子串长度（兜底探测的相关性打分用） */
  function lcsLen(a, b) {
    let best = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        if (a[i] !== b[j]) continue;
        let k = 1;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
        if (k > best) best = k;
      }
    }
    return best;
  }

  /** 兜底候选词生成：旧措辞 → 市集真名的差异多为
   *  ① POE1 前缀「该装备的/你的」（v0.8.2 实测：该装备的攻击暴击率提高 → 攻击暴击率提高）
   *  ② 动词尾替换「提高→加快」（攻击速度提高 → 攻击速度加快）
   * 候选序：全段 → 去头 → 去动词尾 → 去头+去动词尾 → 滑窗（头尾各去 d 字，由近及远）。
   * 最短 4 字：防止「提高」这类泛词误中无关词条。 */
  function fallbackCandidates(probe) {
    const seg = String(probe).split(/[^A-Za-z一-鿿]+/)
      .filter((p) => p.length >= 2)
      .sort((a, b) => b.length - a.length)[0] || '';
    if (seg.length < 4) return [];
    const noHead = seg.replace(/^(该装备的|装备的|该武器的|武器的|你的|角色的|的)/, '');
    const stem = seg.replace(/(提高|加快|降低|缩短|增加|减少|回复|提升|获得)+$/, '');
    const stemNoHead = stem.replace(/^(该装备的|装备的|该武器的|武器的|你的|角色的|的)/, '');
    const cands = [seg, noHead, stem, stemNoHead];
    for (let d = 1; d <= seg.length - 4 && cands.length < 40; d++) {
      for (let i = 0; i <= d && cands.length < 40; i++) {
        cands.push(seg.slice(i, seg.length - (d - i)));
      }
    }
    return [...new Set(cands)].filter((c) => c.length >= 4);
  }

  /** 兜底探测（v0.8.2）：官方文本未命中时的降级搜索。
   * 策略：生成候选词逐个重搜；对每次搜索的全部可见选项按「选项签名与 probe 签名的
   * 最长公共子串」打分，超过阈值的最佳项才选中（防「提高」等泛词误选无关词条）。
   * 阈值 max(4, 签名长-6)：限定变体（如「攻击速度加快 #% (区域)」）放行，无关词条拒绝。
   * 返回选中项文本或 null。 */
  async function searchPickFallback(ms, probe, type) {
    const sigP = affixSig(probe);
    const cands = fallbackCandidates(probe);
    if (!cands.length) return null;
    const minScore = Math.max(4, sigP.length - 6);
    let bestEl = null, bestText = null, bestScore = 0, afterHit = 0;
    const seen = new Set();
    for (const p of cands) {
      if (seen.has(p)) continue;
      seen.add(p);
      const input = await openMultiselect(ms);
      if (!input) return null;
      input.value = p;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
      const list = ms.querySelector('.multiselect__content');
      if (!list) continue;
      const opts = [...list.querySelectorAll('.multiselect__option')]
        .filter((o) => !o.classList.contains('multiselect__option--disabled'))
        .filter((o) => !o.textContent.includes('未找到'));
      let pool = opts;
      if (type) {
        const byType = opts.filter((o) => {
          const t = o.querySelector('.mutate-type');
          return !!(t && t.classList.contains(TYPE_CLASS[type]));
        });
        if (byType.length) pool = byType;
      }
      for (const o of pool) {
        const clone = o.cloneNode(true);
        clone.querySelectorAll('.mutate-type').forEach((x) => x.remove());
        const s = lcsLen(affixSig(clone.textContent), sigP);
        if (s > bestScore && s >= minScore) {
          bestScore = s; bestEl = o;
          bestText = String(clone.textContent).replace(/\s+/g, '');
        }
      }
      // 命中后再看几个候选（更短查询可能带来更优项），无更优即停
      if (bestEl) {
        if (++afterHit >= 6) break;
      }
    }
    if (!bestEl) return null;
    bestEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    bestEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return bestText;
  }

  /** 找 blue 面板（类型过滤）中 filter-title 为指定文字的 filter 块 */
  function findTypeFilter(title) {
    const props = [...document.querySelectorAll('#trade .filter.filter-property')];
    for (const p of props) {
      const t = p.querySelector('.filter-title');
      if (t && t.textContent.trim() === title) return p;
    }
    return null;
  }

  /** 找棕面板（状态过滤）中的词缀 multiselect。
   * groupIdx: 第几个状态组（0=首个「状态过滤」，1=追加的「与」组…） */
  function findMutateSelect(groupIdx = 0) {
    const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.includes('与'));
    });
    const g = groups[groupIdx] || null;
    return g ? g.querySelector('.multiselect.filter-select-mutate') : document.querySelector('.multiselect.filter-select-mutate');
  }

  /** 点「+ 增加状态组」下拉追加一个「与」状态组（放后缀词条用）。
   * 成功返回新组索引，失败返回 -1。 */
  async function addStatGroup() {
    const addSel = document.querySelector('.multiselect.filter-group-select');
    if (!addSel) return -1;
    const before = countStatGroups();
    const input = await openMultiselect(addSel);
    if (!input) return -1;
    input.value = '与';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    const list = addSel.querySelector('.multiselect__content');
    if (list) {
      // 选项标题是「与」（And 组）；选第一个可见选项即可（下拉按输入过滤）
      const picked = pickOption(list, '与', {});
      if (!picked) {
        // 兜底：不过滤直接选「与」
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        const list2 = addSel.querySelector('.multiselect__content');
        if (list2) {
          const opts = [...list2.querySelectorAll('.multiselect__option')].filter((o) => !o.classList.contains('multiselect__option--disabled'));
          const and = opts.find((o) => (o.textContent || '').trim().includes('与'));
          if (and) {
            and.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            and.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
      }
    }
    await closeMultiselect(addSel);
    await sleep(400);   // Vue 渲染新组
    const after = countStatGroups();
    return after > before ? after - 1 : -1;
  }

  /** 当前棕面板里的状态组数量（展开态的 状态过滤/与 组） */
  function countStatGroups() {
    return [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.includes('与'));
    }).length;
  }

  /** 新组出现后从组里找词缀块（groupId=组索引） */
  function findAddedAffixFilterIn(groupIdx, probe, q, extraCandidates) {
    const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.includes('与'));
    });
    const g = groups[groupIdx];
    if (!g) return null;
    const cands = [...new Set([affixSig(probe), ...(extraCandidates || []).map(affixSig), affixSig(q)].filter(Boolean))];
    const body = g.querySelector('.filter-group-body');
    if (!body) return null;
    const props = [...body.querySelectorAll(':scope > .filter')].filter((p) => !p.classList.contains('filter-padded'));
    return props.find((p) => {
      const t = p.querySelector('.filter-title');
      if (!t) return false;
      if (!p.querySelector('input.form-control.minmax')) return false;
      const tt = affixSig(t.textContent);
      if (!tt) return false;
      return cands.some((c) => tt.includes(c)) || cands.some((c) => c.includes(tt) && tt.length >= 4);
    }) || null;
  }

  /** 设置 number 输入并触发 Vue 更新 */
  function setNumber(el, val) {
    if (!el || val == null || val === '') return false;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** 布尔开关：filter-title 匹配时点击 toggle-btn（off→on） */
  function setToggle(title) {
    const p = findTypeFilter(title);
    if (!p) return false;
    const btn = p.querySelector('.toggle-btn');
    if (!btn) return false;
    if (!btn.classList.contains('off')) return true; // 已开
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  /** 搜索市集搜索按钮 */
  function clickSearch() {
    const btn = document.querySelector('#trade .search-btn');
    if (btn) { btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); btn.click(); }
    return !!btn;
  }

  /** 暗金固定词条填表：用官方下拉文本搜索选中（数值留空 = 只筛词条存在）。
   * 与普通词缀的差异：不用 poe2db 原文探测（措辞不同），不用 affixKeyword 拆段
   * （「护甲提高 #%」拆段后过短），直接用官方文本关键词。 */
  async function fillUniqueMod(ms, aff, log, errors, groupIdx = 0) {
    const probe = aff.officialText || aff.text;
    // 官方模板「# 生命上限」→ 去掉 #/符号取核心词；混合词缀取最长段
    const q = affixKeyword(probe);
    const sig = affixSig(probe);
    const beforeCount = countAffixPropsIn(groupIdx);
    // statType: explicit/pseudo/implicit(基底)/skill(技能)，由 popup 按词条 kind 传入
    const { picked, pickedText } = await searchPick(ms, q, { type: aff.statType || 'explicit', sig });
    if (!picked) {
      const retry = await searchPickFallback(ms, probe, aff.statType || 'explicit');
      if (retry) {
        let added = await waitForAffixFilterIn(groupIdx, probe, q, [retry]);
        if (!added) {
          await sleep(200);
          const last = lastAffixPropIn(groupIdx);
          if (last && countAffixPropsIn(groupIdx) > beforeCount) added = last;
        }
        if (added) {
          const mins = [...added.querySelectorAll('input.form-control.minmax')];
          if (aff.minValue != null) setNumber(mins[0], aff.minValue);
          if (aff.maxValue != null && mins[1]) setNumber(mins[1], aff.maxValue);
          log.push(`◆ ${probe}${aff.minValue != null ? ' ≥' + aff.minValue : ''}${aff.maxValue != null ? ' ≤' + aff.maxValue : ''} ✓`);
        } else {
          errors.push(`暗金词条「${aff.text}」已选中但数值填写失败（请手动填数值）`);
        }
        return;
      }
      errors.push(`暗金词条「${aff.text}」（市集：${probe}）下拉未命中`);
      return;
    }
    let added = await waitForAffixFilterIn(groupIdx, probe, q, [pickedText]);
    if (!added) {
      await sleep(200);
      const last = lastAffixPropIn(groupIdx);
      if (last && countAffixPropsIn(groupIdx) > beforeCount) added = last;
    }
    if (added) {
      const mins = [...added.querySelectorAll('input.form-control.minmax')];
      if (aff.minValue != null) setNumber(mins[0], aff.minValue);
      if (aff.maxValue != null && mins[1]) setNumber(mins[1], aff.maxValue);
      log.push(`◆ ${probe}${aff.minValue != null ? ' ≥' + aff.minValue : ''}${aff.maxValue != null ? ' ≤' + aff.maxValue : ''} ✓`);
    } else {
      errors.push(`暗金词条「${aff.text}」已选中但数值填写失败（请手动填数值）`);
    }
  }

  async function runFill(payload) {
    const log = [], errors = [];

    // ---------- 0. 幂等前置：三路全清（标签+词缀块+旧基底），必须先于一切填入 ----------
    const cleared = await clearMarketState();
    if (cleared.tags) log.push(`已清除已选状态 ${cleared.tags} 项`);
    if (cleared.blocks) log.push(`已清除旧词缀块 ${cleared.blocks} 条`);
    if (cleared.baseTags) log.push(`已清除旧基底 ${cleared.baseTags} 项`);

    // ---------- 1. 基底（可选） ----------
    if (payload.base) {
      try {
        const ms = document.querySelector('.search-left .multiselect.search-select');
        if (!ms) throw new Error('基底下拉未找到');
        // 暗金传「名字 类型」全文可能因下拉选项显示截断搜不到：先全文搜，失败再用名字搜
        let { picked } = await searchPick(ms, payload.base);
        if (!picked && payload.base.includes(' ')) {
          const nameOnly = payload.base.split(' ')[0];
          ({ picked } = await searchPick(ms, nameOnly));
        }
        if (picked) log.push(`基底「${payload.base}」✓`);
        else errors.push(`基底「${payload.base}」未在下拉中命中`);
      } catch (e) { errors.push('基底: ' + e.message); }
    }

    // ---------- 2. 词缀：前缀填「状态过滤」组，后缀填追加的「与」组（方便查看修改） ----------
    const all = payload.affixes || [];
    const preList = [], sufList = [];
    for (const aff of all) {
      // 只按 preSuf 分组：prefix/suffix 是确定的；undefined（暗金等）放前缀组
      if (aff.preSuf === 'suffix') sufList.push(aff);
      else preList.push(aff);
    }
    const fillInto = async (list, groupIdx, label) => {
      if (!list.length) return;
      const ms = findMutateSelect(groupIdx);
      if (!ms) { errors.push(`${label}下拉未找到`); return; }
      for (const aff of list) {
        try {
          // 暗金词条：文本 = poe2db 措辞，与市集下拉措辞可能不同 → 只用官方文本探测
          if (aff.uniqueMod) {
            await fillUniqueMod(ms, aff, log, errors, groupIdx);
            await closeMultiselect(ms);
            continue;
          }
          // 官方对齐文本（市集真实下拉措辞）优先，回退显示文本。
          // directText：进阶模式直填通道——无 mods_db 词缀组，仅按官方文本搜索（带类型过滤、不带签名）。
          const probe = aff.officialText || aff.text;
          const q = affixKeyword(probe);
          const sig = aff.directText ? null : affixSig(probe);
          const beforeCount = countAffixPropsIn(groupIdx);
          const first = await searchPick(ms, q, { type: aff.statType || 'explicit', sig });
          let pickedText = first.pickedText;
          if (!first.picked) {
            // 兜底探测：probe 未命中 → 候选词重搜 + LCS 相关性选优
            const retry = await searchPickFallback(ms, probe, aff.statType || 'explicit');
            if (retry) pickedText = retry;
            else { errors.push(`词缀「${probe}」下拉未命中`); await closeMultiselect(ms); continue; }
          }
          let added = await waitForAffixFilterIn(groupIdx, probe, q, [pickedText]);
          if (!added) {
            await sleep(200);
            const last = lastAffixPropIn(groupIdx);
            if (last && countAffixPropsIn(groupIdx) > beforeCount) added = last;
          }
          if (added) {
            const mins = [...added.querySelectorAll('input.form-control.minmax')];
            let mn = aff.minValue, mx = aff.maxValue;
            if (mn == null && mx == null && aff.tierRange) { mn = aff.tierRange[0]; mx = aff.tierRange[1]; }
            if (mn != null) setNumber(mins[0], mn);
            if (mx != null && mins[1]) setNumber(mins[1], mx);
            log.push(`${probe}${mn != null ? ' ≥' + mn : ''}${mx != null ? ' ≤' + mx : ''} ✓${label ? '（' + label + '）' : ''}`);
          } else {
            errors.push(`词缀「${probe}」已选中但数值填写失败（下拉已选，请手动填数值）`);
          }
          await closeMultiselect(ms);
        } catch (e) { errors.push(`词缀「${aff.text}」: ${e.message}`); }
      }
    };
    await fillInto(preList, 0, '前缀');
    if (sufList.length) {
      const idx = await addStatGroup();
      if (idx >= 0) await fillInto(sufList, idx, '后缀');
      else {
        // 追加组失败：后缀回退填进首个组（宁多不少）
        errors.push('追加状态组失败，后缀词条已并入第一组');
        await fillInto(sufList, 0, '后缀');
      }
    }

    // ---------- 3. 附加条件（布尔开关 + 插槽数量） ----------
    const ex = payload.extras || {};
    if (ex.identified) setToggle('已鉴定') ? log.push('已鉴定 ✓') : errors.push('「已鉴定」开关未找到');
    if (ex.corrupted) setToggle('已腐化') ? log.push('已腐化 ✓') : errors.push('「已腐化」开关未找到');
    if (ex.sanctified) setToggle('已圣化') ? log.push('已圣化 ✓') : errors.push('「已圣化」开关未找到');
    if (ex.socketsMin != null && ex.socketsMin > 0) {
      const p = findTypeFilter('增幅器插槽');
      if (p) {
        const mins = [...p.querySelectorAll('input.form-control.minmax')];
        setNumber(mins[0], ex.socketsMin);
        log.push(`插槽数量 ≥${ex.socketsMin} ✓`);
      } else errors.push('「增幅器插槽」输入未找到');
    }

    // ---------- 4. 搜索 ----------
    await sleep(300);
    const searched = clickSearch();
    if (searched) log.push('已点击搜索');
    else errors.push('搜索按钮未找到，请手动点击「搜索」');

    showToast(log, errors);
    return { ok: errors.length === 0, log, errors };
  }

  /** 词缀块：棕面板「状态过滤」filter-group-body 直接子级的 .filter（排除添加下拉 .filter-padded）。
   * 关键事实（源码 StatFilterGroup 模板）：棕面板词缀块不带 filter-property 类！
   * （只有蓝面板 property 过滤器有 :property="true" → filter-property）
   * 块 title = mutate-type 标签文字 + 词缀文本（混合词缀行间是 ↵ 或空格）。
   * 匹配用签名（仅中英文），彻底绕开数字/符号/分隔差异。 */
  function findAddedAffixFilter(probe, q, extraCandidates) {
    return findAddedAffixFilterIn(0, probe, q, extraCandidates);
  }

  /** 棕面板「状态过滤」filter-group（expanded 态）。
   * statGroupAt(idx): 第 idx 个状态组（0=状态过滤，1+=追加的「与」组）。 */
  function statFilterGroup() { return statGroupAt(0); }
  function statGroupAt(idx) {
    const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((g) => {
      const head = g.querySelector('.filter-group-header .filter-title');
      return head && (head.textContent.includes('状态过滤') || head.textContent.trim() === '与');
    });
    return groups[idx] || null;
  }

  /** 选中词缀后轮询等待新词缀块出现（Vue 渲染可能慢于固定等待）。
   * 最多 waitMs，每 100ms 查一次；找到即返回。 */
  async function waitForAffixFilter(probe, q, extraCandidates, waitMs = 2500) {
    return waitForAffixFilterIn(0, probe, q, extraCandidates, waitMs);
  }
  async function waitForAffixFilterIn(groupIdx, probe, q, extraCandidates, waitMs = 2500) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const f = findAddedAffixFilterIn(groupIdx, probe, q, extraCandidates);
      if (f) return f;
      await sleep(100);
    }
    return null;
  }
  function countAffixProps() { return countAffixPropsIn(0); }
  function countAffixPropsIn(groupIdx) {
    const g = statGroupAt(groupIdx);
    if (!g) return 0;
    const body = g.querySelector('.filter-group-body');
    if (!body) return 0;
    return [...body.querySelectorAll(':scope > .filter')].filter((p) => !p.classList.contains('filter-padded')).length;
  }

  /** 棕面板最后一个词缀块（新增块总在末尾） */
  function lastAffixProp() { return lastAffixPropIn(0); }
  function lastAffixPropIn(groupIdx) {
    const g = statGroupAt(groupIdx);
    if (!g) return null;
    const body = g.querySelector('.filter-group-body');
    if (!body) return null;
    const props = [...body.querySelectorAll(':scope > .filter')].filter((p) => !p.classList.contains('filter-padded'));
    return props.length ? props[props.length - 1] : null;
  }

  /** 幂等前置：填表前清空市集已选状态，保证「先清后填」不叠加（v0.6.9）。
   * 此前只清棕面板词缀块、且要求「状态过滤」组为展开态——multiselect 里已选的
   * 标签与折叠态的组都清不到，二次填入时新旧条件叠加。三路清理：
   *  ① 状态过滤 multiselect 已选标签（tag-icon mousedown 移除，Vue 状态源，
   *     不依赖组展开态；标签删掉后对应词缀块随之消失）
   *  ② 棕面板词缀块 remove-btn（组折叠时先点组头展开再清，兜底标签路失效）
   *  ③ 基底 multiselect 已选标签（旧基底残留会与新基底组成并集搜索）
   * 返回 { tags, blocks, baseTags } 各路实际清除数。 */
  async function clearMarketState() {
    const out = { tags: 0, blocks: 0, baseTags: 0 };

    /** 清一个 vue-multiselect 里全部已选标签；点击无效果自动换 click 兜底 */
    async function clearTags(ms, max = 60) {
      let n = 0;
      for (let guard = 0; guard < max; guard++) {
        const icon = ms.querySelector('.multiselect__tag .multiselect__tag-icon');
        if (!icon) break;
        const before = ms.querySelectorAll('.multiselect__tag').length;
        icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await sleep(100);
        const after = ms.querySelectorAll('.multiselect__tag').length;
        if (after >= before) { // mousedown 无效 → click 兜底
          icon.click();
          await sleep(100);
        }
        if (ms.querySelectorAll('.multiselect__tag').length < before) n++;
        else break; // 点不动（异常态）防死循环
      }
      return n;
    }

    // ① 各状态组 multiselect 标签（含追加的「与」组）
    let gi = 0;
    for (;;) {
      const ms = findMutateSelect(gi);
      if (!ms) break;
      out.tags += await clearTags(ms);
      gi++;
      if (gi > 6) break;   // 防御：组数异常
    }

    // ② 棕面板词缀块（组折叠时 statFilterGroup 找不到 → 先展开组头）
    let g = statFilterGroup();
    if (!g) {
      const head = [...document.querySelectorAll('.filter-group-header')]
        .find((h) => (h.querySelector('.filter-title') || {}).textContent?.includes('状态过滤'));
      if (head) {
        // 只 mousedown 展开（与市集组头交互一致）；click 会 toggle 再次折叠
        head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(250);
        g = statFilterGroup();
      }
    }
    // 逐组清词缀块（含「与」组）
    for (let idx = 0; idx < Math.max(1, countStatGroups()); idx++) {
      g = statGroupAt(idx);
      if (!g) continue;
      for (let guard = 0; guard < 30; guard++) {
        const body = g.querySelector('.filter-group-body');
        if (!body) break;
        const props = [...body.querySelectorAll(':scope > .filter')]
          .filter((p) => !p.classList.contains('filter-padded') && p.querySelector('.remove-btn'));
        if (!props.length) break;
        const before = countAffixPropsIn(idx);
        props[0].querySelector('.remove-btn').click();
        await sleep(120);
        // 实际减少才计数，防点不动时空转
        const after = countAffixPropsIn(idx);
        if (after < before) out.blocks++;
        else break;
      }
    }
    // 清空后移除多余的「与」组（每组的组头 remove-btn），只留首个「状态过滤」
    for (;;) {
      const groups = [...document.querySelectorAll('.filter-group.expanded')].filter((x) => {
        const head = x.querySelector('.filter-group-header .filter-title');
        return head && head.textContent.trim() === '与';
      });
      if (!groups.length) break;
      const btn = groups[0].querySelector('.filter-group-header .remove-btn');
      if (!btn) break;
      btn.click();
      await sleep(150);
    }

    // ③ 基底 multiselect 标签（旧基底残留 → 新旧并集搜索）
    const bms = document.querySelector('.search-left .multiselect.search-select');
    if (bms) out.baseTags = await clearTags(bms, 20);

    if (out.tags + out.blocks + out.baseTags > 0) await sleep(150); // Vue 收尾
    return out;
  }

  /** 收起 multiselect 下拉：点遮罩/失焦 */
  async function closeMultiselect(ms) {
    const wrapper = ms.querySelector('.multiselect__content-wrapper');
    if (!wrapper || wrapper.style.display === 'none') return;
    ms.querySelector('.multiselect__select')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(120);
    if (ms.querySelector('.multiselect__content-wrapper')?.style.display !== 'none') {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      ms.querySelector('.multiselect__input')?.blur();
    }
    await sleep(120);
  }

  /** 结果 toast：市集风格暗色浮层，右上角 6 秒 */
  function showToast(log, errors) {
    document.getElementById('p2ss-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'p2ss-toast';
    const okCount = log.length;
    const color = errors.length === 0 ? '#8e9e52' : '#d4b483';
    el.innerHTML = `
      <div style="position:fixed;top:14px;right:14px;z-index:2147483647;max-width:380px;
                  background:#1e2124;border:1px solid #634928;color:#e2e2e2;
                  font:13px/1.6 'Microsoft YaHei',sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.6)">
        <div style="padding:8px 12px;border-bottom:1px solid #465260;color:${color};font-weight:600">
          POE2 速搜 · 填表${errors.length === 0 ? '完成' : '部分完成'}（${okCount} 成功 / ${errors.length} 失败）
        </div>
        <div style="padding:8px 12px;max-height:300px;overflow:auto">
          ${log.map((l) => `<div style="color:#a3c98e">· ${l}</div>`).join('')}
          ${errors.map((e) => `<div style="color:#d9776f">× ${e}</div>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  /* ---------- 悬浮面板：市集页内 80% 居中遮罩 + iframe（popup.html） ---------- */
  let panelWrap = null, panelFrame = null;

  function ensurePanel() {
    if (panelWrap) return;
    panelWrap = document.createElement('div');
    panelWrap.id = 'p2ss-panel-wrap';
    panelWrap.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:none';
    panelFrame = document.createElement('iframe');
    panelFrame.src = chrome.runtime.getURL('popup.html');
    panelFrame.style.cssText =
      'position:absolute;left:10%;top:10%;width:80%;height:80%;' +
      'border:1px solid #634928;box-shadow:0 8px 40px rgba(0,0,0,.7);background:#2b2b2b';
    panelWrap.appendChild(panelFrame);
    document.body.appendChild(panelWrap);
    // 点遮罩空白处关闭（面板状态保留，重开还在）
    panelWrap.addEventListener('mousedown', (e) => { if (e.target === panelWrap) togglePanel(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelWrap.style.display !== 'none') togglePanel(false);
    });
    // 面板 iframe → 本页：填表 / 关闭
    window.addEventListener('message', (e) => {
      if (!panelFrame || e.source !== panelFrame.contentWindow) return;
      if (e.data?.type === 'P2_FILL') {
        togglePanel(false);
        runFill(e.data.payload);
      } else if (e.data?.type === 'P2_CLOSE_PANEL') {
        togglePanel(false);
      }
    });
  }

  function togglePanel(force) {
    ensurePanel();
    const show = force == null ? panelWrap.style.display === 'none' : !!force;
    panelWrap.style.display = show ? 'block' : 'none';
  }

  function hidePanel() {
    if (panelWrap) panelWrap.style.display = 'none';
  }
})();
