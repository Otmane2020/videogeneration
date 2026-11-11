// Notifications push (protocole Web Push, identification VAPID). Les messages partent sans contenu chiffré :
// le service worker lit le dernier message sur le serveur. Abonnement ouvert à tous, envoi réservé aux admins.
const crypto = require('crypto');
const { send, readJson, httpError } = require('../util');
const { sql } = require('../db');
const { user } = require('../auth');
const { admins } = require('../mail');

const b64 = (b) => Buffer.from(b).toString('base64url');
function vapid(endpoint) {
  const key = crypto.createPrivateKey(Buffer.from(process.env.VAPID_PRIVATE || '', 'base64').toString('utf8'));
  const head = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${admins()[0] || 'hello@clipmotion.ai'}` }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64(sig)}, k=${process.env.VAPID_PUBLIC}`;
}

module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    if (req.method === 'GET') {
      if (q.get('latest')) {
        const m = await sql('SELECT title, body, url FROM push_msgs ORDER BY id DESC LIMIT 1');
        return send(res, 200, m[0] || {});
      }
      return send(res, 200, { key: process.env.VAPID_PUBLIC || '' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const b = await readJson(req), me = await user(req).catch(() => null);
    if (b.action === 'subscribe') {
      const ep = String(b.subscription?.endpoint || '');
      if (!/^https:\/\/[^\s]{20,600}$/.test(ep)) throw httpError(400, 'Invalid subscription');
      await sql('INSERT INTO push_subs (endpoint, user_id) VALUES ($1, $2) ON CONFLICT (endpoint) DO UPDATE SET user_id = COALESCE($2, push_subs.user_id)', [ep, me ? me.id : null]);
      return send(res, 200, { ok: true });
    }
    if (b.action === 'send') {
      if (!me || !admins().includes(me.email)) throw httpError(403, 'Admins only');
      if (!process.env.VAPID_PRIVATE || !process.env.VAPID_PUBLIC) throw httpError(503, 'Push is not configured');
      const title = String(b.title || '').slice(0, 80), body = String(b.body || '').slice(0, 200), url = /^\/[^\s]{0,200}$/.test(b.url || '') ? b.url : '/';
      if (!title) throw httpError(400, 'A title is required');
      await sql('INSERT INTO push_msgs (title, body, url) VALUES ($1, $2, $3)', [title, body, url]);
      const subs = await sql('SELECT endpoint FROM push_subs LIMIT 2000');
      let sent = 0, gone = 0;
      await Promise.all(subs.map(async ({ endpoint }) => {
        try {
          const r = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { authorization: vapid(endpoint), ttl: '86400', urgency: 'normal', 'content-length': '0' } });
          if (r.ok) sent++;
          else if (r.status === 404 || r.status === 410) { gone++; await sql('DELETE FROM push_subs WHERE endpoint = $1', [endpoint]); }
        } catch { /* service de notification injoignable */ }
      }));
      return send(res, 200, { subscribers: subs.length, sent, removed: gone });
    }
    throw httpError(400, 'Unknown action');
  } catch (e) {
    if (!e.status) console.error('push', e.message);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
};
