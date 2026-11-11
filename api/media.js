// Proxy média : rend vidéos des banques d'images et images du site utilisables dans le <canvas> (CORS).
const { Readable } = require('stream');
const { send, httpError, safeFetch, handler } = require('../lib/util');

module.exports = handler('GET', async (req, res) => {
  const target = new URL(req.url, 'http://x').searchParams.get('u') || '';
  let u;
  try { u = new URL(target); } catch { throw httpError(400, 'Invalid URL'); }
  const isStock = /(^|\.)(pixabay|pexels|coverr)\.(com|co)$/.test(u.hostname);
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  const r = await safeFetch(u.href, { headers }, 20000);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  const len = Number(r.headers.get('content-length') || 0);
  // Vidéo : banques d'images uniquement. Images : tout site public, 8 Mo max.
  const ok = r.status < 400 && ((isStock && /^(video|image)\//.test(type)) || (/^image\/(jpeg|png|webp|gif|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type) && len <= 8e6));
  if (!ok) { r.body?.cancel().catch(() => {}); throw httpError(415, 'Media not allowed'); }
  const out = { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" };
  for (const h of ['content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) out[h] = r.headers.get(h);
  res.writeHead(r.status, out);
  Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
});
