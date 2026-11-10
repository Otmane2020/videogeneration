// Capture d'écran mobile du site (service mShots de WordPress.com), pour montrer le vrai produit dans la pub.
const { send, httpError, assertPublicUrl, handler } = require('../lib/util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Renvoie le JPEG de la capture, ou null. Le service répond par une redirection tant qu'elle n'est pas prête.
async function capture(href, tries = 12) {
  const shot = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(href)}?w=780&vpw=390&vph=1500`;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(shot, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (r.status === 200 && /^image\/jpeg/.test(r.headers.get('content-type') || '')) return Buffer.from(await r.arrayBuffer());
    await r.body?.cancel().catch(() => {});
    if (r.status >= 400) break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  return null;
}

module.exports = handler('GET', async (req, res) => {
  const target = new URL(req.url, 'http://x').searchParams.get('u') || '';
  const u = await assertPublicUrl(target);
  const buf = await capture(u.href);
  if (!buf) throw httpError(504, 'Site capture unavailable');
  send(res, 200, buf, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
});
module.exports.capture = capture;
