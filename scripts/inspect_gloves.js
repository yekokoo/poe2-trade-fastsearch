#!/usr/bin/env node
/** 检查手套页的词缀数据引用 */
const fs = require('fs');
const html = fs.readFileSync('C:/ai-work/poe2search-research/gloves.html', 'utf-8');
const re = /https:\/\/cdn\.poe2db\.tw\/[a-zA-Z0-9\/._-]+\.(?:json|js)/g;
const refs = [...html.matchAll(re)].map((m) => m[0]);
console.log('cdn refs:', [...new Set(refs)].join('\n') || 'none');
const vm = html.match(/(?:var|let|const)\s+\w+\s*=\s*\{/g);
console.log('var declarations:', vm ? vm.slice(0, 20).join(' | ') : 'none');
// 词缀 tab 的 tbody 总行数（词缀/411 那个表）
const i = html.indexOf('id="词缀"');
const seg = html.slice(i, i + 300000);
console.log('词缀tab rows:', (seg.match(/<tr>/g) || []).length);
// 前几行是否就是完整词缀池（带前缀/后缀badge）
const badges = [...seg.matchAll(/<span class="badge text-bg-secondary">([^<]+)<\/span>/g)].map((m) => m[1]);
const cnt = {};
badges.forEach((b) => (cnt[b] = (cnt[b] || 0) + 1));
console.log('badge统计:', JSON.stringify(cnt));
