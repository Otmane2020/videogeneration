// Recherche de plans d'illustration (vidéos ou photos) pour chaque scène.
// La banque cherche « un mot OU l'autre » et classe par popularité : « cloud storage » renvoie des nuages,
// « bug tracking » des insectes. Chaque résultat est donc confronté à ses mots-clés : il n'est gardé que
// s'il porte vraiment la requête. Une scène sans résultat sûr reçoit un plan de secours du bon univers.
const { send, readJson, httpError, handler } = require('../lib/util');

/* ---------- mots ---------- */
const STOP = new Set('a an the of on in at with and for to by from up out over into is are his her their its your our'.split(' '));
const ALIAS = { women: 'woman', men: 'man', children: 'child', kids: 'child', kid: 'child', smartphone: 'phone', cellphone: 'phone', iphone: 'phone', mobile: 'phone', macbook: 'laptop', pc: 'computer', programmer: 'developer', coder: 'developer', programming: 'coding' };
// racine grossière, la même pour la requête et pour les tags : typing/type, phones/phone, shopping/shop
function stem(w) {
  w = ALIAS[w] || w;
  if (!/ss$/.test(w)) w = w.replace(/^(.{3,}?)(ies|es|s)$/, (m, a, s) => (s === 'ies' ? a + 'y' : a));
  return w.replace(/^(.{3,})(ing|ed)$/, '$1').replace(/ie$/, 'y').replace(/^(.{3,}?)e+$/, '$1').replace(/(.)\1$/, '$1');
}
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const words = (s) => [...new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem))];
// Mots trop répandus dans les tags pour prouver qu'un plan est dans le sujet : les qualificatifs ne comptent pas,
// les personnes et lieux quelconques ne suffisent pas à eux seuls (« woman » + « home » : une séance de gym à la maison).
const VAGUE = new Set(words('young old happy sad smile busy empty beautiful new modern small big large close closeup view looking holding using working checking professional creative technology tech digital online internet communication background concept day night morning time life lifestyle frustrated stressed tired excited focused confident successful local fresh cozy crowded quiet messy clean bright dark fast quick'));
const COMMON = new Set(words('person people man woman girl boy guy human adult child baby family couple friend group team colleague business work job office home house room city street building outdoor indoor nature'));
// Plans qui n'ont rien à faire dans une pub. Les fonds verts et maquettes à incruster, jamais ; les images dessinées ou générées, les animaux
// et les scènes tristes, seulement si la scène les demande : [ce qui les trahit dans les tags, ce qui les autorise dans les requêtes].
const NEVER = /green ?screen|chroma ?key|floating screen|mock ?up/;
const UNASKED = [
  [/\b(ai generated|cartoon|doodle|animation|animated)\b/, /abstract|background|animat|cartoon/],
  [/\b(cat|kitten|kitty|dog|puppy|pet|animal|bird|insect|wildlife|zoo)\b/, /\b(cat|kitten|dog|puppy|pet|animal|bird|insect|wildlife|zoo|vet|farm)/],
  [/\b(sad|sadness|crying|depressed|depression|lonely|loneliness|grief|funeral|death|war|violence|blood|accident|poverty|homeless)\b/, /\b(sad|cry|depress|lonel|grie|stress|frustrat|tired|angry|worr|problem)/],
];

// Pertinence d'un plan pour une requête : 3 = porte tous ses mots ; 2 = en porte au moins deux qui comptent, dont un
// précis (« doctor office computer » : pas « office » + « computer » sans médecin... ni « woman » + « home ») ;
// 1 = requête d'un seul mot ; 0 = hors sujet.
function judge(qw, tags) {
  const m = qw.filter((w) => tags.has(w));
  if (!m.length) return 0;
  if (m.length === qw.length) return qw.length === 1 ? 1 : 3;
  const solid = m.filter((w) => !VAGUE.has(w));
  return solid.length >= 2 && solid.some((w) => !COMMON.has(w)) ? 2 : 0;
}

/* ---------- banques ---------- */
const cache = new Map(); // la banque demande de mettre les réponses en cache 24 h ; un échec n'est pas gardé
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 864e5) return hit.p;
  if (cache.size > 300) cache.clear();
  const p = fn();
  cache.set(key, { t: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

const pixabayKeys = () => [process.env.PIXABAY_API_KEY, process.env.PIXABAY_API_KEY_2].filter(Boolean);
let turn = 0;
// les clés servent à tour de rôle ; si l'une est refusée ou a épuisé son quota, l'autre prend le relais
async function pixabay(path, params) {
  const keys = pixabayKeys();
  let last = new Error('pixabay: no key');
  for (let i = 0; i < keys.length; i++) {
    const u = new URL('https://pixabay.com/api/' + path);
    u.search = new URLSearchParams({ key: keys[turn++ % keys.length], safesearch: 'true', per_page: '50', ...params });
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(7000) });
      if (r.ok) return (await r.json()).hits || [];
      last = new Error(`pixabay ${r.status}`);
    } catch (e) { last = e; }
  }
  throw last;
}
// une clé Pexels n'est utilisée que si elle en a la forme (pas une valeur d'attente)
const pexelsKey = () => (/^[A-Za-z0-9]{40,}$/.test(process.env.PEXELS_API_KEY || '') ? process.env.PEXELS_API_KEY : '');
async function pexels(path, q) {
  const u = new URL('https://api.pexels.com/' + path);
  u.search = new URLSearchParams({ query: q, per_page: '40' });
  const r = await fetch(u, { signal: AbortSignal.timeout(7000), headers: { authorization: pexelsKey() } });
  if (!r.ok) throw new Error(`pexels ${r.status}`);
  return r.json();
}

// Coverr : vidéos libres de droits, bien fournies en scènes de bureau et de travail
const coverrKey = () => (/^[a-f0-9]{32}$/i.test(process.env.COVERR_API_KEY || '') ? process.env.COVERR_API_KEY : '');
async function coverr(q) {
  const u = new URL('https://api.coverr.co/videos');
  u.search = new URLSearchParams({ query: q, page_size: '40', urls: 'true' });
  const r = await fetch(u, { signal: AbortSignal.timeout(7000), headers: { authorization: `Bearer ${coverrKey()}` } });
  if (!r.ok) throw new Error(`coverr ${r.status}`);
  const j = await r.json();
  return j.hits || j.data || [];
}

// Un résultat de banque : `std` et `full` sont les deux définitions proposées, `tags` ses mots-clés.
const SOURCES = {
  video: [
    [pixabayKeys, async (q) => (await pixabay('videos/', { q, video_type: 'film' })).filter((h) => h.duration >= 5 && h.duration <= 90).map((h) => {
      const f = h.videos || {}, std = [f.small, f.medium, f.tiny].find((x) => x?.url);
      return std && { id: h.id, g: h.user_id, kind: 'video', std, full: f.medium?.url && f.medium.height >= 1080 ? f.medium : null, lite: f.tiny?.url || std.url, thumb: std.thumbnail || f.tiny?.thumbnail || '', duration: h.duration, tags: h.tags };
    })],
    [pexelsKey, async (q) => ((await pexels('videos/search', q)).videos || []).filter((h) => h.duration >= 5 && h.duration <= 90).map((h) => {
      const files = (h.video_files || []).filter((f) => f.link && f.width).sort((a, b) => a.width * a.height - b.width * b.height);
      const side = (f) => Math.min(f.width, f.height), std = files.find((f) => side(f) >= 540) || files[files.length - 1];
      const shape = (f) => ({ url: f.link, width: f.width, height: f.height });
      const full = files.find((f) => side(f) >= 1080);
      // pas de tags chez Pexels : le titre du plan, lu dans son adresse, en tient lieu
      return std && { id: 'p' + h.id, g: 'p' + h.user?.id, kind: 'video', std: shape(std), full: full ? shape(full) : null, lite: files[0].link, thumb: h.image || '', duration: h.duration, tags: String(h.url || '').split('/video/')[1] || '' };
    })],
    [coverrKey, async (q) => (await coverr(q)).filter((h) => !h.is_ai_generated && +h.duration >= 5 && +h.duration <= 90).map((h) => {
      const url = h.urls?.mp4 || h.urls?.mp4_download || h.urls?.mp4_preview;
      if (!url) return null;
      const w = h.max_width || (h.is_vertical ? 1080 : 1920), hh = h.max_height || (h.is_vertical ? 1920 : 1080);
      const tags = [].concat(h.tags || [], h.title || '').join(', ');
      return { id: 'c' + h.id, g: 'c' + (h.id || ''), kind: 'video', std: { url, width: w, height: hh }, full: Math.min(w, hh) >= 1080 ? { url, width: w, height: hh } : null, lite: h.urls?.mp4_preview || url, thumb: h.thumbnail || h.poster || '', duration: +h.duration, tags };
    }).filter(Boolean)],
  ],
  photo: [
    [pixabayKeys, async (q) => (await pixabay('', { q, image_type: 'photo', min_width: '1600' })).map((h) => h.largeImageURL && ({
      id: h.id, g: h.user_id, kind: 'photo', std: { url: h.largeImageURL, width: h.imageWidth, height: h.imageHeight }, full: h.imageWidth >= 1920, lite: h.webformatURL, thumb: h.webformatURL, tags: h.tags,
    }))],
    [pexelsKey, async (q) => ((await pexels('v1/search', q)).photos || []).map((h) => h.src?.original && ({
      id: 'p' + h.id, g: 'p' + h.photographer_id, kind: 'photo', std: { url: h.src.large2x || h.src.original, width: h.width, height: h.height }, full: h.width >= 1920, lite: h.src.large, thumb: h.src.medium, tags: h.alt || '',
    }))],
  ],
};
// Résultats d'une requête, toutes banques configurées confondues, dans l'ordre de la banque.
const bank = (kind, q) => cached(kind + '|' + q, async () => {
  const on = SOURCES[kind].filter(([key]) => key().length);
  const got = await Promise.allSettled(on.map(([, search]) => search(q)));
  got.forEach((g) => { if (g.status === 'rejected') console.error('stock', g.reason.message); });
  if (got.every((g) => g.status === 'rejected')) throw got[0]?.reason || new Error('no stock library');
  return got.flatMap((g) => (g.status === 'fulfilled' ? g.value : [])).filter(Boolean).map((x) => ({ ...x, t: new Set(words(x.tags)), raw: fold(x.tags) }));
});

// Plans de secours : requêtes sûres, vérifiées, quand rien de pertinent ne sort des requêtes de la scène.
const SAFE = {
  technology: ['typing laptop', 'business meeting', 'woman laptop', 'office team', 'man phone', 'office computer'],
  lifestyle: ['online shopping', 'woman shopping', 'gift box', 'happy friends', 'delivery package', 'home family'],
};

/* ---------- bibliothèque choisie ---------- */
// data/footage.json (scripts/build-footage.js) : plans HD choisis à la main par secteur et par mot-clé. Elle passe avant la recherche en direct.
let LIB = null;
function library() {
  if (LIB) return LIB;
  let raw = [];
  try { raw = require('../data/footage.json'); } catch { /* pas encore construite */ }
  LIB = raw.map((e) => {
    const tags = `${e.t}, ${e.k.join(', ')}`;
    return { id: e.id, g: e.g, kind: 'video', std: { url: e.u, width: e.w, height: e.h }, full: e.f ? { url: e.f, width: e.fw, height: e.fh } : null, lite: e.l, thumb: e.th, duration: e.d, tags, t: new Set(words(tags)), raw: fold(e.t), curated: true };
  });
  return LIB;
}

/* ---------- une scène ---------- */
// `list` : requêtes de la plus précise à la plus générale. Renvoie jusqu'à 12 plans, les plus pertinents d'abord.
// `loose` (recherche libre de l'utilisateur) : les résultats non confirmés par leurs tags complètent la liste.
async function findScene(list, { kind = 'video', safe = [], loose = false, until = Infinity } = {}) {
  const queries = [...new Set([].concat(list || []).map((q) => String(q || '').slice(0, 60).trim().toLowerCase()).filter(Boolean))].slice(0, 3);
  const asked = fold(queries.join(' ')), vocab = new Set(words(asked));
  const banned = (x) => NEVER.test(x.raw) && !NEVER.test(asked);
  const unasked = (x) => UNASKED.some(([shows, allows]) => shows.test(x.raw) && !allows.test(asked));
  const pool = new Map();
  const add = (x, rel, score, q) => { const old = pool.get(x.id); if (!old || score > old.score) pool.set(x.id, { ...x, rel, score, q }); };
  // classement : pertinence d'abord ; pas plus de deux plans du même auteur, dont les séries quasi identiques rempliraient la liste
  const ranked = () => {
    const by = new Map();
    return [...pool.values()].sort((a, b) => b.score - a.score).filter((x) => { const n = (by.get(x.g ?? x.id) || 0) + 1; by.set(x.g ?? x.id, n); return n <= 2; });
  };
  // retient les résultats d'une requête qui portent vraiment ses mots ; `max` plafonne la pertinence accordée
  const collect = async (q, order, max = 3) => {
    const qw = words(q);
    let hits;
    try { hits = await bank(kind, q); } catch (e) { console.error('stock', q, e.message); return []; }
    hits.forEach((x, pos) => {
      const fit = banned(x) || unasked(x) ? 0 : judge(qw, x.t);
      if (!fit) return;
      const rel = Math.min(max, fit);
      // à pertinence égale : le plan qui montre le sujet (premier mot de la requête), puis celui qui recoupe les autres requêtes de la scène
      const also = [...vocab].filter((w) => !qw.includes(w) && x.t.has(w)).length;
      add(x, rel, rel * 100 - order * 10 + qw.filter((w) => x.t.has(w)).length * 4 + (x.t.has(qw[0]) ? 6 : 0) + also * 2 - pos * 0.2 + (x.full ? 1 : 0), q);
    });
    return hits;
  };
  // bibliothèque choisie : mêmes critères que la recherche en direct, avec un bonus de qualité
  if (kind === 'video') {
    queries.forEach((q, i) => {
      const qw = words(q);
      library().forEach((x) => {
        if (banned(x) || unasked(x)) return;
        const fit = judge(qw, x.t);
        if (!fit) return;
        add(x, fit, fit * 100 - i * 10 + qw.filter((w) => x.t.has(w)).length * 4 + (x.t.has(qw[0]) ? 6 : 0) + 40, q);
      });
    });
  }
  // `until` : passé ce délai (banque lente ou en panne), on n'interroge plus et on rend ce qu'on a
  const open = () => Date.now() < until;
  let first = null;
  for (let i = 0; i < queries.length && open() && ranked().filter((x) => x.rel >= 2).length < 6; i++) { const hits = await collect(queries[i], i); first ||= hits; }
  // trop peu de plans : on complète avec des plans de secours, toujours classés après les vrais résultats
  for (let i = 0; i < safe.length && open() && ranked().length < 6; i++) await collect(safe[i], 10 + i, 0);
  if (loose) (first || []).forEach((x, pos) => { if (!pool.has(x.id) && !banned(x)) add(x, 0, -pos, queries[0]); });
  return ranked().slice(0, 12);
}

// ce que reçoit le navigateur : `rel` dit à quel point le plan répond à la scène (3 = exactement, 0 = plan de secours),
// `g` identifie son auteur (deux plans du même auteur se ressemblent souvent)
const out = (x, hd) => {
  const pick = hd && x.full && x.kind === 'video' ? x.full : x.std;
  return { id: x.id, g: x.g, kind: x.kind, url: pick.url, lite: x.lite, w: pick.width, h: pick.height, hd: !!x.full, thumb: x.thumb, ...(x.kind === 'video' ? { duration: x.duration } : {}), rel: x.rel };
};

module.exports = handler('POST', async (req, res) => {
  if (!pixabayKeys().length && !pexelsKey() && !coverrKey()) throw httpError(500, 'Stock library is not configured');
  const { scenes, fallback, hd, kind, loose } = await readJson(req);
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 8) throw httpError(400, 'Invalid queries');
  const safe = SAFE[fallback] || [], until = Date.now() + 25000;
  const results = await Promise.all(scenes.map(async (list, i) => {
    // chaque scène commence la liste de secours à un endroit différent : deux scènes n'héritent pas du même plan
    const mine = safe.map((_, k) => safe[(i + k) % safe.length]);
    // `null` : la scène n'a pas besoin de plan (elle montre une photo produit)
    return list === null ? [] : (await findScene(list, { kind: kind === 'photo' ? 'photo' : 'video', safe: mine, loose: !!loose, until })).map((x) => out(x, !!hd));
  }));
  send(res, 200, { results });
});
module.exports.findScene = findScene;
module.exports.internals = { pixabay, judge, words, fold, banned: (x) => NEVER.test(x.raw) };
