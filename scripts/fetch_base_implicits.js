/** 抓 poe2db 主分类页 → 提取基底隐式词缀(implicitMod) → 回填 data/bases/*.json + mods_db props
 * 结构：<a class="whiteitem..." href="Crimson_Amulet">赤红项链</a> ... <div class="implicitMod">生命每秒再生 (2—4)</div>
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/ai-work/poe2搜索插件';

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** 提取：基底名 → { slug, implicit }（implicitMod 去 HTML 保留 mod-value 文本） */
function extractBases(html) {
  const out = {};
  const re = /<a class="whiteitem[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>([\s\S]{0,800}?)(?=<a class="whiteitem|<\/td>|<\/div><\/div><\/div><div class="col|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1], name = m[2].trim(), tail = m[3];
    const im = tail.match(/<div class="implicitMod">([\s\S]*?)<\/div>/);
    if (im) {
      let text = im[1]
        .replace(/<span class="ndash">[^<]*<\/span>/g, '—')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) out[name] = { slug, implicit: text };
    }
  }
  return out;
}

/** 主分类 slug 列表（变体页映射到主分类） */
const MAIN_SLUGS = [
  'Amulets', 'Rings', 'Belts',
  'Bows', 'Crossbows', 'Quarterstaves', 'Staves', 'Talismans', 'Two_Hand_Axes', 'Two_Hand_Maces', 'Two_Hand_Swords',
  'Bucklers', 'Foci', 'Quivers', 'Shields',
  'Body_Armours', 'Boots', 'Gloves', 'Helmets',
  'Claws', 'Daggers', 'Flails', 'One_Hand_Axes', 'One_Hand_Maces', 'One_Hand_Swords', 'Sceptres', 'Spears', 'Wands',
  'Charms', 'Life_Flasks', 'Mana_Flasks',
  'Waystones', 'Jewels', 'Relics',
];

async function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? only : MAIN_SLUGS;
  const results = {};
  let ok = 0, fail = 0;

  for (const slug of targets) {
    try {
      const { status, data } = await fetchPage(`https://poe2db.tw/cn/${slug}`);
      if (status !== 200) { console.log(`✗ ${slug} HTTP ${status}`); fail++; continue; }
      const bases = extractBases(data);
      results[slug] = bases;
      fs.writeFileSync(path.join(ROOT, 'data/tmp', `${slug}_page.html`), data);
      ok++;
      console.log(`✓ ${slug}: ${Object.keys(bases).length} 个基底含隐式`);
    } catch (e) {
      console.log(`✗ ${slug}: ${e.message}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  fs.writeFileSync(path.join(ROOT, 'data/tmp/base_implicits.json'), JSON.stringify(results, null, 1));
  console.log(`\n完成: ${ok} 成功 / ${fail} 失败 → data/tmp/base_implicits.json`);
}
main();
