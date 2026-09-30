#!/usr/bin/env node
/** 诊断 Claws 页 JSON 初始化入口 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0';
(async () => {
  const r = await fetch('https://poe2db.tw/cn/Claws', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' } });
  const html = await r.text();
  const kws = ['{"normal":', '{"baseitem"', 'ModsData(', 'modsView(', 'InitView(', 'initModsView(', 'View({'];
  for (const kw of kws) {
    console.log(JSON.stringify(kw), html.indexOf(kw));
  }
  const d = html.indexOf('"desecrated":[');
  const before = html.slice(Math.max(0, d - 40000), d);
  const m = [...before.matchAll(/([A-Za-z_$][\w$]*)\s*\(\s*\{/g)];
  console.log('fn({ patterns near json:', m.slice(-3).map((x) => x[1] + '@' + (x.index + before.length - 40000)));
  const m2 = [...before.matchAll(/new\s+([A-Za-z]+)\s*\(/g)];
  console.log('new X( near json:', m2.slice(-3).map((x) => x[1]));
})();
