/** gen_demo.js — 从 extension/popup.html + popup.js 重新生成 demo_新界面.html + demo_panel_inner.html
 * 用法：node scripts/gen_demo.js
 * demo_panel_inner.html = popup.html 内联 popup.js + chrome 存根（getURL 返回原路径，
 *   dataURL() 里 chrome.runtime 存在 → 返回 'data/…' 相对 demo 根目录，配合本地 http 服务可访问）
 * demo_新界面.html = 80vw/80vh 外框 + iframe 包内页
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'extension/popup.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'extension/popup.js'), 'utf8');

// 1. 内页：popup.js 内联 + chrome 存根（getURL('data/…') → 'extension/data/…'，从根目录服务可达）
const stub = `<script>
  window.chrome = { runtime: { getURL: (p) => p.replace(/^data\\//, 'extension/data/') } };
</script><script>`;
let inner = html.replace(/<script src="popup\.js"><\/script>/, () => stub + js + '</script>');

// 2. 一致性自检：popup.js 里不应再有 dataURL() 之外的 chrome.runtime.getURL( 调用
const badLines = js.split('\n')
  .map((l, i) => [l.includes('chrome.runtime.getURL(') && !l.includes('typeof chrome'), i + 1])
  .filter(([hit]) => hit);
if (badLines.length) console.warn('WARN: popup.js 存在 dataURL() 之外的 getURL 调用，行号:', badLines.map(([, n]) => n).join(','));
fs.writeFileSync(path.join(root, 'demo_panel_inner.html'), inner);

// 2. 外框
const outer = `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
  body { margin:0; background:#1a1a1a url('') ; display:flex; align-items:center; justify-content:center; height:100vh; font-family:'Microsoft YaHei',sans-serif; }
  .frame { width:80vw; height:80vh; border:1px solid #634928; box-shadow:0 8px 40px rgba(0,0,0,.7); background:#2b2b2b; overflow:hidden; }
  iframe { width:100%; height:100%; border:0; }
  .tip { position:fixed; top:12px; left:50%; transform:translateX(-50%); color:#a38d6d; font-size:12px; }
</style></head><body>
<div class='tip'>demo：面板按浏览器窗口 80% 居中呈现（实际装到扩展后在市集页内弹出）</div>
<div class='frame'><iframe src='demo_panel_inner.html'></iframe></div>
</body></html>`;
fs.writeFileSync(path.join(root, 'demo_新界面.html'), outer);

console.log('demo 已重新生成: demo_新界面.html + demo_panel_inner.html');
