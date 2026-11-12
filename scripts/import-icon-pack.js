// Importe le pack « logos, flèches, visuels » : copie les SVG retenus dans public/icons/ et écrit l'index de recherche data/logo-index.json.
// Retenu : logos de marques en couleur (collection « logos ») et monochromes (simple-icons), flèches, schémas. Les pictogrammes génériques ne servent pas.
// Usage : node scripts/import-icon-pack.js <dossier du zip décompressé>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/import-icon-pack.js <dossier>'); process.exit(1); }
const OUT = path.join(__dirname, '../public/icons');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalogue.json'), 'utf8'));
const keep = cat.filter((e) => (e.category === 'logos-marques' && /^(logos|simple-icons):/.test(e.id)) || e.category === 'fleches-direction' && e.id.startsWith('lucide:') || e.category === 'schemas-explicatifs');
fs.rmSync(OUT, { recursive: true, force: true });
const index = [];
let bytes = 0;
for (const e of keep) {
  const src = path.join(dir, e.path), dst = path.join(OUT, e.path);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst); bytes += fs.statSync(src).size;
  if (e.category !== 'logos-marques') continue; // seuls les logos sont cherchés par nom
  const label = String(e.label || e.brand || '').toLowerCase();
  index.push({
    i: e.id, k: [...new Set([e.brand, e.label, ...(e.aliases || [])].map(norm).filter(Boolean))], l: label,
    p: '/icons/' + e.path, m: e.color_mode === 'original' ? 0 : 1, w: e.width || 0, h: e.height || 0,
  });
}
fs.writeFileSync(path.join(__dirname, '../data/logo-index.json'), JSON.stringify(index));
fs.mkdirSync(path.join(OUT, 'licences'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'licences'))) fs.copyFileSync(path.join(dir, 'licences', f), path.join(OUT, 'licences', f));
fs.copyFileSync(path.join(dir, 'README.md'), path.join(OUT, 'README.md'));
console.log(`${keep.length} SVG copiés (${(bytes / 1048576).toFixed(1)} Mo), ${index.length} logos indexés`);
