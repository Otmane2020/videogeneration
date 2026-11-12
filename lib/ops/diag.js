// TEMPORAIRE : relais de recherche Coverr pour construire la bibliothèque (scripts/build-coverr.js)
module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const done = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!process.env.CRON_SECRET || q.get('k') !== process.env.CRON_SECRET) return done({ error: 'no' }, 401);
  try {
    const r = await fetch('https://api.coverr.co/videos?urls=true&page_size=50&query=' + encodeURIComponent(q.get('q') || ''), { headers: { authorization: 'Bearer ' + process.env.COVERR_API_KEY }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return done({ error: 'coverr ' + r.status });
    const j = await r.json();
    done({ hits: (j.hits || []).map((h) => ({ id: h.id, title: h.title, description: h.description, tags: h.tags, duration: +h.duration, vertical: h.is_vertical, ai: h.is_ai_generated, downloads: h.downloads, views: h.views, w: h.max_width, h: h.max_height, slug: h.slug, thumb: h.thumbnail, poster: h.poster, mp4: h.urls?.mp4, preview: h.urls?.mp4_preview, premium: h.is_premium })) });
  } catch (e) { done({ error: e.message }); }
};
