// Recherche de plans d'illustration (vidéos ou photos) pour chaque scène.
// Fournisseurs : Pixabay (primaire, 100/min gratuit) + Pexels (secours, 200/h gratuit)
const { send, readJson, httpError, handler } = require('../lib/util');

const cache = new Map(); // la banque demande de mettre les réponses en cache 24 h

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 864e5) return Promise.resolve(hit.v);
  return fn().then((v) => {
    if (cache.size > 600) cache.clear();
    cache.set(key, { t: Date.now(), v });
    return v;
  });
}

// --- Pixabay (rotation entre PIXABAY_API_KEY et PIXABAY_API_KEY_2) ---
let _pkIdx = 0;
function pixabayKey() {
  const keys = [process.env.PIXABAY_API_KEY, process.env.PIXABAY_API_KEY_2].filter(Boolean);
  if (!keys.length) return null;
  return keys[(_pkIdx++) % keys.length];
}
async function pixabayCall(path, params) {
  const pk = pixabayKey();
  if (!pk) throw new Error('pixabay: no key');
  const u = new URL('https://pixabay.com/api/' + path);
  u.search = new URLSearchParams({ key: pk, safesearch: 'true', per_page: '24', ...params });
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`pixabay ${r.status}`);
  return (await r.json()).hits || [];
}
async function pixabayVideos(q, hd) {
  const hits = await pixabayCall('videos/', { q, video_type: 'film' });
  return hits.filter((h) => h.duration >= 5 && h.duration <= 90).map((h) => {
    const f = h.videos || {};
    const full = f.medium?.url && f.medium.height >= 1080 ? f.medium : null;
    const std = [f.small, f.medium, f.tiny].find((x) => x?.url) || {};
    const pick = hd && full ? full : std;
    return { id: h.id, kind: 'video', url: pick.url, lite: f.tiny?.url || std.url, w: pick.width, h: pick.height, hd: !!full, thumb: std.thumbnail || f.tiny?.thumbnail || '', duration: h.duration };
  }).filter((x) => x.url);
}
async function pixabayPhotos(q) {
  const hits = await pixabayCall('', { q, image_type: 'photo', min_width: '1600' });
  return hits.map((h) => ({ id: h.id, kind: 'photo', url: h.largeImageURL, lite: h.webformatURL, w: h.imageWidth, h: h.imageHeight, hd: h.imageWidth >= 1920, thumb: h.webformatURL })).filter((x) => x.url);
}

// --- Pexels ---
async function pexelsCall(path, params) {
  const u = new URL('https://api.pexels.com/' + path);
  u.search = new URLSearchParams({ per_page: '20', ...params });
  const r = await fetch(u, { signal: AbortSignal.timeout(12000), headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!r.ok) throw new Error(`pexels ${r.status}`);
  return await r.json();
}
async function pexelsVideos(q) {
  const data = await pexelsCall('videos/search', { query: q, orientation: 'landscape', min_duration: 5, max_duration: 90 });
  return (data.videos || []).map((h) => {
    const files = (h.video_files || []).sort((a, b) => (b.width || 0) - (a.width || 0));
    const hd = files.find((f) => f.width >= 1920) || null;
    const std = files.find((f) => f.link) || {};
    const pick = hd || std;
    return { id: h.id, kind: 'video', url: pick.link, lite: std.link, w: pick.width || 1280, h: pick.height || 720, hd: !!hd, thumb: h.image || '', duration: h.duration };
  }).filter((x) => x.url);
}
async function pexelsPhotos(q) {
  const data = await pexelsCall('v1/search', { query: q, orientation: 'landscape' });
  return (data.photos || []).map((h) => ({ id: h.id, kind: 'photo', url: h.src.original, lite: h.src.large, w: h.width, h: h.height, hd: h.width >= 1920, thumb: h.src.medium })).filter((x) => x.url);
}

// Classement : pertinence d'abord (ordre de la banque), bonus pour la HD et pour les contenus récents.
function rank(items) {
  const ids = items.map((x) => x.id).sort((a, b) => a - b);
  return items.map((x, i) => ({ x, s: -i + (x.hd ? 5 : 0) + 4 * (ids.indexOf(x.id) / Math.max(1, ids.length - 1)) }))
    .sort((a, b) => b.s - a.s).map((o) => o.x).slice(0, 12);
}

async function videos(q, hd) {
  const key = 'v:' + q + hd;
  return cached(key, async () => {
    if (process.env.PIXABAY_API_KEY) {
      try { const r = await pixabayVideos(q, hd); if (r.length) return rank(r); } catch (e) { console.error('pixabay:', e.message); }
    }
    if (process.env.PEXELS_API_KEY) {
      try { return rank(await pexelsVideos(q)); } catch (e) { console.error('pexels:', e.message); }
    }
    return [];
  });
}
async function photos(q) {
  const key = 'p:' + q;
  return cached(key, async () => {
    if (process.env.PIXABAY_API_KEY) {
      try { const r = await pixabayPhotos(q); if (r.length) return rank(r); } catch (e) { console.error('pixabay:', e.message); }
    }
    if (process.env.PEXELS_API_KEY) {
      try { return rank(await pexelsPhotos(q)); } catch (e) { console.error('pexels:', e.message); }
    }
    return [];
  });
}

module.exports = handler('POST', async (req, res) => {
  if (!process.env.PIXABAY_API_KEY && !process.env.PEXELS_API_KEY) throw httpError(500, 'Stock library is not configured');
  const { scenes, fallback, hd, kind } = await readJson(req);
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 8) throw httpError(400, 'Invalid queries');
  const find = kind === 'photo' ? photos : (q) => videos(q, !!hd);
  const fb = String(fallback || 'technology').slice(0, 40);
  const results = await Promise.all(scenes.map(async (list) => {
    // De la requête la plus précise à la plus générale. Une requête sans résultat est raccourcie mot par mot
    // (« google search laptop » -> « google search » -> « google ») avant de passer à la suivante.
    const given = [].concat(list || []).map((q) => String(q || '').slice(0, 60).trim()).filter(Boolean).slice(0, 3);
    const tries = [];
    for (const q of given) { const w = q.split(/\s+/); for (let n = w.length; n >= 1; n--) tries.push(w.slice(0, n).join(' ')); }
    tries.push(fb);
    let best = [];
    for (const q of [...new Set(tries)]) {
      try {
        const v = await find(q);
        if (v.length > best.length) best = v;
        if (v.length >= 3) return v;
      } catch (e) { console.error(e.message); }
    }
    if (best.length) return best;
    return [];
  }));
  send(res, 200, { results });
});
