// Capture d'écran mobile du site (service mShots de WordPress.com), pour montrer le vrai produit dans la pub.
const { send, httpError, assertPublicUrl, handler } = require('../lib/util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

module.exports = handler('GET', async (req, res) => {
  const target = new URL(req.url, 'http://x').searchParams.get('u') || '';
  const u = await assertPublicUrl(target);
  const shot = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(u.href)}?w=780&vpw=390&vph=1500`;
  // Le service répond par une redirection tant que la capture n'est pas prête.
  for (let i = 0; i < 12; i++) {
    const r = await fetch(shot, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (r.status === 200 && /^image\/jpeg/.test(r.headers.get('content-type') || '')) {
      return send(res, 200, Buffer.from(await r.arrayBuffer()), { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
    }
    await r.body?.cancel().catch(() => {});
    if (r.status >= 400) break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw httpError(504, 'Capture du site indisponible');
});
