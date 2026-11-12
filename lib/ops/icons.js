// Logos de marques (ChatGPT, Slack, Stripe…) et pictogrammes en SVG, depuis l'API gratuite et sans clé d'Iconify.
// POST { brands: [{ name: "ChatGPT", domain: "openai.com" }] } -> { icons: { chatgpt: { src, set }, … } } ; les marques introuvables sont absentes.
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
  return { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), set: best[0] };
}

// Pack de logos fourni avec l'application (public/icons, index data/logo-index.json) : vrais logos de marques en couleur (collection « logos »)
// et monochromes (simple-icons), cherchés par nom ou alias. Première source : instantanée, sans service externe, même origine (pas de CORS).
let INDEX = null;
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function logoIndex() {
  if (INDEX) return INDEX;
  let list = [];
  try { list = require('../../data/logo-index.json'); } catch { /* pack absent */ }
  INDEX = { list, byKey: new Map() };
  list.forEach((e) => e.k.forEach((k) => { if (!INDEX.byKey.has(k)) INDEX.byKey.set(k, []); INDEX.byKey.get(k).push(e); }));
  return INDEX;
}
// la variante la plus utile pour une tuile : couleur d'origine, proche du carré, nom court
const fit = (e, base) => base + (e.m ? 0 : 12) - (e.w && e.h ? Math.abs(Math.log(e.w / e.h)) * 7 : 3) - e.l.length * 0.15 - (/wordmark|text|horizontal|vertical/.test(e.l) ? 8 : 0);
function local(name, domain) {
  const { list, byKey } = logoIndex();
  if (!list.length) return null;
  const label = String(domain || '').replace(/^www\./, '').split('.')[0];
  const wanted = [...new Set([norm(name), norm(ALIAS[String(name).toLowerCase()]), norm(label)].filter((k) => k.length >= 2))];
  let best = null;
  for (const [rank, k] of wanted.entries()) {
    const scored = [];
    for (const suffix of ['', 'icon', 'logo', 'symbol']) for (const e of byKey.get(k + suffix) || []) scored.push([e, fit(e, suffix ? 94 : 100)]);
    if (!scored.length && k.length >= 4) for (const e of list) if (e.k.some((x) => x.startsWith(k))) scored.push([e, fit(e, 40)]);
    for (const [e, sc] of scored) if (!best || sc - rank * 3 > best[1]) best = [e, sc - rank * 3];
    if (best && best[1] >= 80) break;
  }
  return best ? { src: best[0].p, set: best[0].i } : null;
}

// Brandfetch (Logo API, identifiant client public) : logo officiel par domaine. Le CDN refuse parfois les requêtes de serveur :
// dans ce cas (ou sans identifiant, ou sans domaine) on passe à Iconify. Le logo est renvoyé en data URL, donc sans souci CORS pour le canvas.
async function brandfetch(domain) {
  const id = process.env.BRANDFETCH_CLIENT_ID;
  if (!id || !/^[a-z0-9][a-z0-9.-]{2,60}\.[a-z]{2,}$/i.test(domain || '')) return null;
  const origin = process.env.PUBLIC_URL || 'https://www.clipmotion.ai';
  const r = await fetch(`https://cdn.brandfetch.io/domain/${domain}/w/400/h/400/icon/fallback/404?c=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000), headers: { referer: origin + '/', origin, accept: 'image/png,image/webp,image/svg+xml,image/*' } });
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !/^image\/(png|webp|jpeg|svg\+xml)$/.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 400000) return null;
  if (type === 'image/svg+xml' && /<script|onload=|javascript:/i.test(buf.toString('utf8'))) return null;
  return { src: `data:${type};base64,${buf.toString('base64')}`, set: 'brandfetch:' + domain };
}

// Un logo à partir du nom de la marque et, quand l'IA le donne, de son domaine (« openai.com » -> « openai »).
async function icon({ name, domain }) {
  const key = [name, domain].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const label = String(domain || '').replace(/^www\./, '').split('.')[0];
  let v = null;
  v = local(name, domain);
  if (!v) try { v = await brandfetch(domain); } catch { /* repli ci-dessous */ }
  if (!v) for (const q of [...new Set([name, label].map((x) => String(x || '').toLowerCase().trim()).filter(Boolean))]) {
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
