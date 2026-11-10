// Recherche de plans d'illustration (vidéos ou photos) pour chaque scène.
const { send, readJson, httpError, handler } = require('../lib/util');

const cache = new Map(); // la banque demande de mettre les réponses en cache 24 h

async function call(path, params) {
  const key = path + JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 864e5) return hit.v;
  const u = new URL('https://pixabay.com/api/' + path);
  u.search = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, safesearch: 'true', per_page: '24', ...params });
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`stock ${r.status}`);
  const v = (await r.json()).hits || [];
  if (cache.size > 600) cache.clear();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// Classement : pertinence d'abord (ordre de la banque), bonus pour la HD et pour les contenus récents.
function rank(items) {
  const ids = items.map((x) => x.id).sort((a, b) => a - b);
  return items.map((x, i) => ({ x, s: -i + (x.hd ? 5 : 0) + 4 * (ids.indexOf(x.id) / Math.max(1, ids.length - 1)) }))
    .sort((a, b) => b.s - a.s).map((o) => o.x).slice(0, 12);
}

async function videos(q, hd) {
  // « film » : vraies prises de vue uniquement, pas d'animations
  const hits = await call('videos/', { q, video_type: 'film' });
  return rank(hits.filter((h) => h.duration >= 5 && h.duration <= 90).map((h) => {
    const f = h.videos || {};
    const full = f.medium?.url && f.medium.height >= 1080 ? f.medium : null;
    const std = [f.small, f.medium, f.tiny].find((x) => x?.url) || {};
    const pick = hd && full ? full : std;
    return { id: h.id, kind: 'video', url: pick.url, lite: f.tiny?.url || std.url, w: pick.width, h: pick.height, hd: !!full, thumb: std.thumbnail || f.tiny?.thumbnail || '', duration: h.duration };
  }).filter((x) => x.url));
}
async function photos(q) {
  const hits = await call('', { q, image_type: 'photo', min_width: '1600' });
  return rank(hits.map((h) => ({ id: h.id, kind: 'photo', url: h.largeImageURL, lite: h.webformatURL, w: h.imageWidth, h: h.imageHeight, hd: h.imageWidth >= 1920, thumb: h.webformatURL })).filter((x) => x.url));
}

module.exports = handler('POST', async (req, res) => {
  if (!process.env.PIXABAY_API_KEY) throw httpError(500, 'Stock library is not configured');
  const { scenes, fallback, hd, kind } = await readJson(req);
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 8) throw httpError(400, 'Invalid queries');
  const find = kind === 'photo' ? photos : (q) => videos(q, !!hd);
  const fb = String(fallback || 'technology').slice(0, 40);
  const results = await Promise.all(scenes.map(async (list) => {
    // de la requête la plus précise à la plus générale ; on s'arrête dès qu'il y a assez de choix
    const tries = [...[].concat(list || []).map((q) => String(q || '').slice(0, 60).trim()).filter(Boolean).slice(0, 3), fb];
    for (const q of tries) {
      try {
        const v = await find(q);
        if (v.length >= 3 || (v.length && q === fb)) return v;
      } catch (e) { console.error(e.message); }
    }
    return [];
  }));
  send(res, 200, { results });
});
