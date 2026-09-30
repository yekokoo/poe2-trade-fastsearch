#!/usr/bin/env node
/** gen_unique_pairs.js — 从当前 mods_db 提取暗金 pair 清单（fetch_unique_mods.js 的输入）
 *
 * 背景：data/tmp/unique_pairs.json 曾是一次性会话产物（9/7 版 733 对快照），
 *       新版本暗金（0.5.5 新增）不在其中 → fetch_unique_mods 会漏抓。
 * 本脚本恢复该环节：mods_db 全部 unique 基底的 text.replace(' ','|') 去重输出。
 * 运行：node scripts/gen_unique_pairs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'data', 'mods_db.json'), 'utf8'));
const pairs = new Set();
for (const c of db.categories || []) {
  for (const b of c.bases || []) {
    if (b.unique && b.text) pairs.add(b.text.replace(' ', '|'));
  }
}
const out = path.join(ROOT, 'data', 'tmp', 'unique_pairs.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify([...pairs]), 'utf-8');
console.log(`unique_pairs.json: ${pairs.size} 对（来源: mods_db v${db.version}）`);
