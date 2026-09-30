/** 查看暗金基底对象完整字段 */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));
const t1 = '阿兹里的金履 束带长靴', t2 = '阿兹里的金履 符文师匠束带长靴';
db.categories.filter((c) => c.slug.startsWith('Boots_')).forEach((c) => {
  c.bases.filter((b) => b.unique && (b.text === t1 || b.text === t2) && c.slug === 'Boots_str').forEach((b) => {
    console.log('===', b.text, '===');
    console.log(JSON.stringify(b, null, 1).slice(0, 1500));
  });
});
