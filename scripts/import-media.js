// Importe des lots « clipmotion-videos-NN-sur-12 » et « clipmotion-images-NN-sur-02 » (catalogue.json + médias) dans la bibliothèque.
// Les fichiers vont dans media/ (hors public/, donc hors du déploiement Vercel) et sont servis par raw.githubusercontent.com depuis le dépôt GitHub public, à une version précise (MEDIA_REF) ;
// (jsDelivr refuse les dépôts de plus de 50 Mo) ;
// data/footage.json reçoit une entrée par média avec ses mots-clés EN/FR, secteurs, licence et crédit.
// Usage : node scripts/import-media.js <dossier de lot> [<dossier de lot> ...]
const fs = require('fs');
const path = require('path');
const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: node scripts/import-media.js <dossier> [...]'); process.exit(1); }
const FILE = path.join(__dirname, '../data/footage.json');
const MEDIA = path.join(__dirname, '../media');
const CDN = process.env.MEDIA_BASE || 'https://raw.githubusercontent.com/Otmane2020/videogeneration/591e227ed8b1d5aef1f1df9092e6ecfa6ecc770a/media/';

// secteurs des lots -> secteurs de la bibliothèque (le secteur d'origine est gardé aussi)
const SECTORS = {
  'education-training': ['education'], 'energy-environment': ['energy'], 'fitness-wellness': ['fitness'], 'food-hospitality': ['restaurant'],
  'health-medtech': ['health'], 'logistics-mobility': ['logistics', 'automotive'], 'manufacturing-industry': ['industry', 'logistics'],
  'marketing-creative': ['marketing', 'creative'], 'real-estate-construction': ['realestate'], 'software-ai-it': ['saas', 'it'], reactions: ['saas', 'reactions'],
  'agriculture-agritech': ['agriculture'], 'arts-entertainment': ['events', 'creative'], 'finance-insurance': ['finance'], 'professional-services': ['legal', 'hr'],
  'retail-ecommerce': ['retail', 'ecommerce'], 'travel-tourism': ['travel'],
};

const all = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter((e) => e.src !== 'zip'); // les lots précédents sont réimportés
const seen = new Set();
let nv = 0, ni = 0, bytes = 0;
const credits = [];
for (const dir of dirs) {
  const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalogue.json'), 'utf8'));
  for (const c of cat) {
    const video = c.kind === 'video', id = (video ? 'z' : 'zi') + c.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const copy = (rel) => { const dst = path.join(MEDIA, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(dir, rel), dst); bytes += fs.statSync(dst).size; } };
    copy(c.path); if (video) copy(c.thumbnail);
    const u = CDN + c.path, th = video ? CDN + c.thumbnail : u;
    const en = c.keywords_en || [], fr = c.keywords_fr || [];
    const tags = [...new Set([...en, ...(c.tags || []), c.search_topic, c.emotion, c.scene_role, c.title && c.kind === 'image' ? c.title.replace(/\.(jpe?g|png|webp)$/i, '') : ''].filter(Boolean))].join(', ');
    all.push({
      id, g: id, kind: video ? 'video' : 'image', s: [...new Set([...(SECTORS[c.sector] || []), c.sector])], k: [...new Set([...en, ...fr])].slice(0, 14),
      u, w: c.width, h: c.height, f: '', fw: 0, fh: 0, l: u, th, d: Math.round(+c.duration_s || 0), t: tags.slice(0, 500),
      p: c.source, au: c.author || '', lic: c.license || '', cr: !!c.credit_required || /^CC BY/i.test(c.license || ''), emo: c.emotion || '', role: c.scene_role || '',
      src: 'zip', top: true, rl: 8, rb: 8, // choisis à la main : notes maximales, bonus de classement
    });
    credits.push(`${c.path}\n${c.title} — ${c.author || 'unknown'}\n${c.source}\n${c.license} ${c.license_url || ''}\n${c.changes || ''}\n`);
    video ? nv++ : ni++;
  }
}
fs.writeFileSync(FILE, JSON.stringify(all));
fs.mkdirSync(path.join(__dirname, '../public/footage-media'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../public/footage-media/CREDITS.txt'), 'ClipMotion footage library — sources and licences (attribution required for CC BY items)\n\n' + credits.join('\n'));
console.log(`${nv} vidéos et ${ni} images importées (${(bytes / 1048576).toFixed(0)} Mo copiés dans media/) ; bibliothèque : ${all.length} entrées`);
