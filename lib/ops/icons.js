// Logos de marques (ChatGPT, Slack, Stripe…) et pictogrammes en SVG, depuis l'API gratuite et sans clé d'Iconify.
// POST { brands: [{ name: "ChatGPT", domain: "openai.com" }] } -> { icons: { chatgpt: { svg, set }, … } } ; les marques introuvables sont absentes.
const { send, readJson, httpError } = require('../util');

const API = 'https://api.iconify.design';
const cache = new Map(); // nom -> { t, v }  (v = null quand rien n'a été trouvé)
const TTL = 6 * 864e5;

// noms d'usage -> terme de recherche Iconify
const ALIAS = { chatgpt: 'openai', gpt: 'openai', 'gpt-4': 'openai', claude: 'anthropic', gemini: 'google-gemini', copilot: 'github-copilot', 'google analytics': 'google-analytics', gsuite: 'google', 'google workspace': 'google', 'ms teams': 'microsoft-teams', 'microsoft teams': 'microsoft-teams', x: 'x', twitter: 'twitter', 'woo commerce': 'woocommerce', 'big commerce': 'bigcommerce' };

function score(q, icon) {
  const [prefix, name] = icon.split(':');
  if (/wordmark|text|horizontal|vertical|-dark|-light|-alt/.test(name)) return -1;
  let s = 0;
  if (name === q) s = 100; else if (name === q + '-icon' || name === q + '-logo') s = 95; else if (name.startsWith(q + '-')) s = 60; else if (name.startsWith(q)) s = 50; else if (name.includes(q)) s = 25;
  if (!s) return -1;
  return s + (prefix === 'logos' ? 10 : 0) - name.length * 0.1; // logos : version couleur de la marque
}

async function pick(raw) {
  const q = (ALIAS[raw] || raw).replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!q) return null;
  const r = await fetch(`${API}/search?query=${encodeURIComponent(q)}&limit=24&prefixes=logos,simple-icons`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const { icons = [] } = await r.json();
  const best = icons.map((i) => [i, score(q, i)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [prefix, name] = best[0].split(':');
  // simple-icons est monochrome : on le fournit en gris très foncé, lisible sur la pastille blanche
  const url = `${API}/${prefix}/${name}.svg?height=192${prefix === 'simple-icons' ? '&color=%23161616' : ''}`;
  const s = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!s.ok) return null;
  const svg = (await s.text()).trim();
  if (!/^<svg[\s>]/.test(svg) || svg.length > 60000 || /<script|onload=|javascript:/i.test(svg)) return null;
  return { svg, set: best[0] };
}

// Un logo à partir du nom de la marque et, quand l'IA le donne, de son domaine (« openai.com » -> « openai »).
async function icon({ name, domain }) {
  const key = [name, domain].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const label = String(domain || '').replace(/^www\./, '').split('.')[0];
  let v = null;
  for (const q of [...new Set([name, label].map((x) => String(x || '').toLowerCase().trim()).filter(Boolean))]) {
    try { v = await pick(q); } catch { /* service injoignable : le montage se fait sans */ }
    if (v) break;
  }
  if (cache.size > 400) cache.clear();
  cache.set(key, { t: Date.now() - (v ? 0 : TTL * 0.9), v }); // un échec est retenté vite
  return v;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { brands } = await readJson(req);
    if (!Array.isArray(brands) || !brands.length || brands.length > 8) throw httpError(400, 'Invalid brands');
    const list = brands.map((b) => ({ name: String(b?.name || '').slice(0, 40).trim(), domain: String(b?.domain || '').slice(0, 60).trim() })).filter((b) => b.name);
    const found = await Promise.all(list.map(async (b) => [b.name.toLowerCase(), await icon(b)]));
    send(res, 200, { icons: Object.fromEntries(found.filter(([, v]) => v)) }, { 'cache-control': 'public, max-age=3600' });
  } catch (e) {
    if (!e.status) console.error('icons', e.message);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
};
