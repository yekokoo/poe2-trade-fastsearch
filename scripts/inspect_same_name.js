/** 查看同名不同 slug 的普通基底在市集的填串来源（name）与高等级名 */
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'mods_db.json'), 'utf8'));
const targets = ['Hermit_Garb', 'Anchorite_Garb', 'Runeforged_Hermit_Garb', 'Runeforged_Anchorite_Garb',
  'Runemastered_Hermit_Garb', 'Runemastered_Anchorite_Garb', 'Ancient_Gauntlets', 'Ancient_Mitts'];
db.categories.forEach((c) => {
  c.bases.forEach((b) => {
    if (!b.unique && targets.includes(b.slug) && ['Body_Armours_dex', 'Body_Armours_int', 'Gloves_int', 'Gloves_str'].includes(c.slug)) {
      console.log(`${c.slug}: ${b.slug} name="${b.name}" level=${b.level}`);
    }
  });
});
