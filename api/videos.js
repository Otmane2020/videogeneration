// Recherche de vidéos libres de droits sur Pixabay pour chaque scène.
const { send, readJson, httpError, handler } = require('../lib/util');

const cache = new Map(); // Pixabay demande de mettre les réponses en cache 24 h

async function search(q) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 864e5) return hit.v;
  const u = new URL('https://pixabay.com/api/videos/');
  u.search = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q, per_page: '8', safesearch: 'true', video_type: 'film' });
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  const j = await r.json();
  const v = (j.hits || []).filter((h) => h.duration >= 4).map((h) => {
    const f = h.videos || {};
    const pick = [f.small, f.medium, f.tiny].find((x) => x?.url) || {};
    return { id: h.id, url: pick.url, lite: f.tiny?.url || pick.url, w: pick.width, h: pick.height, thumb: pick.thumbnail || f.tiny?.thumbnail || '', duration: h.duration, author: h.user };
  }).filter((x) => x.url);
  if (cache.size > 500) cache.clear();
  cache.set(key, { t: Date.now(), v });
  return v;
}

module.exports = handler('POST', async (req, res) => {
  if (!process.env.PIXABAY_API_KEY) throw httpError(500, 'Pixabay key missing');
  const { queries, fallback } = await readJson(req);
  if (!Array.isArray(queries) || !queries.length || queries.length > 8) throw httpError(400, 'Invalid queries');
  const fb = String(fallback || 'technology').slice(0, 40);
  const results = await Promise.all(queries.map(async (raw) => {
    const q = String(raw || '').slice(0, 60).trim() || fb;
    try {
      let v = await search(q);
      if (!v.length && q.includes(' ')) v = await search(q.split(' ').slice(0, 1).join(' ')); // requête trop précise
      if (!v.length) v = await search(fb);
      return v;
    } catch (e) {
      console.error(e.message);
      return [];
    }
  }));
  send(res, 200, { results });
});
