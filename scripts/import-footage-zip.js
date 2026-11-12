// Importe un lot de médias curatés (catalogue.json + clips-emotions.csv du ZIP « clipmotion-footages ») dans data/footage.json.
// Les fichiers sont copiés dans public/footage-media/ ; la base les reçoit au prochain chargement de la bibliothèque.
// Usage : node scripts/import-footage-zip.js <dossier du zip décompressé>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/import-footage-zip.js <dossier>'); process.exit(1); }
const FILE = path.join(__dirname, '../data/footage.json');

// secteurs du zip -> secteurs de la bibliothèque (le secteur d'origine est gardé aussi)
const SECTORS = {
  'education-training': ['education'], 'energy-environment': ['energy'], 'fitness-wellness': ['fitness'], 'food-hospitality': ['restaurant'],
  'health-medtech': ['health'], 'logistics-mobility': ['logistics', 'automotive'], 'manufacturing-industry': ['industry', 'logistics'],
  'marketing-creative': ['marketing', 'creative'], 'real-estate-construction': ['realestate'], 'software-ai-it': ['saas', 'it'], reactions: ['saas', 'reactions'],
};

// CSV minimal (guillemets, virgules, BOM)
function csv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ''));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const list = (s) => String(s || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalogue.json'), 'utf8'));
const emo = Object.fromEntries(csv(fs.readFileSync(path.join(dir, 'clips-emotions.csv'), 'utf8')).map((r) => [String(r.id), r]));

const all = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter((e) => !String(e.id).startsWith('z'));
let n = 0;
for (const c of cat) {
  const id = 'z' + c.id, video = c.kind === 'video', r = emo[String(c.id)] || {};
  const en = [...(c.keywords_en || []), ...list(r.tags_en)], fr = [...(c.keywords_fr || []), ...list(r.tags_fr)];
  const u = '/footage-media/' + c.path, th = video ? '/footage-media/' + c.thumbnail : u;
  const tags = [...new Set([...en, ...(c.tags || []), c.search_topic, c.emotion, c.scene_role, r.description].filter(Boolean))].join(', ');
  all.push({
    id, g: id, kind: video ? 'video' : 'image', s: [...new Set([...(SECTORS[c.sector] || []), c.sector])], k: [...new Set([...en, ...fr])].slice(0, 14),
    u, w: c.width, h: c.height, f: '', fw: 0, fh: 0, l: u, th, d: Math.round(+c.duration_s || 0), t: tags.slice(0, 500),
    p: c.source, au: c.author || '', lic: c.license || '', cr: !!c.credit_required || /^CC BY/.test(c.license || ''), emo: c.emotion || r.emotion || '', role: c.scene_role || r.role_scene || '',
    src: 'zip', top: true, rl: 8, rb: 8, // choisis à la main : notes maximales, bonus de classement
  });
  n++;
}
fs.writeFileSync(FILE, JSON.stringify(all));
console.log(`${n} médias importés (${cat.filter((c) => c.kind === 'video').length} vidéos, ${cat.filter((c) => c.kind !== 'video').length} images) ; bibliothèque : ${all.length} entrées`);
