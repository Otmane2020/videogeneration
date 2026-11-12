// Espace administrateur : statistiques et gestion des utilisateurs. Réservé aux adresses de ADMIN_EMAILS.
const { send, readJson, httpError } = require('../util');
const { sql } = require('../db');
const { user } = require('../auth');
const { admins } = require('../mail');
const { summary } = require('../stats');

module.exports = async (req, res) => {
  try {
    const me = await user(req);
    if (!me || !admins().includes(me.email)) throw httpError(403, 'Admins only');
    if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('v') === 'analytics') {
      // statistiques d'audience : période et origine au choix
      const q = new URL(req.url, 'http://x').searchParams;
      const days = [1, 7, 30, 90].includes(+q.get('range')) ? +q.get('range') : 30;
      const ch = ['seo', 'social', 'referral', 'direct', 'paid'].includes(q.get('channel')) ? q.get('channel') : 'all';
      const W = 'day > current_date - $1::int AND ($2 = \'all\' OR channel = $2)', P = [days, ch];
      const [chan, series, tot, sources, pages, countries, devices, live] = await Promise.all([
        sql('SELECT channel, count(*)::int AS n FROM visits WHERE day > current_date - $1::int GROUP BY channel', [days]),
        sql(`SELECT day::text AS day, count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM visits WHERE ${W} GROUP BY day ORDER BY day`, P),
        sql(`SELECT count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM visits WHERE ${W}`, P),
        sql(`SELECT COALESCE(src, ref, 'Direct') AS label, count(*)::int AS n FROM visits WHERE ${W} GROUP BY label ORDER BY n DESC LIMIT 8`, P),
        sql(`SELECT path AS label, count(*)::int AS n FROM visits WHERE ${W} GROUP BY path ORDER BY n DESC LIMIT 8`, P),
        sql(`SELECT COALESCE(country, '??') AS label, count(*)::int AS n FROM visits WHERE ${W} GROUP BY label ORDER BY n DESC LIMIT 8`, P),
        sql(`SELECT COALESCE(device, 'desktop') AS label, count(*)::int AS n FROM visits WHERE ${W} GROUP BY label ORDER BY n DESC`, P),
        sql("SELECT count(DISTINCT vid)::int AS n FROM visits WHERE created_at > now() - interval '5 minutes'"),
      ]);
      // jours sans visite : points à zéro, pour une courbe continue
      const byDay = new Map(series.map((r) => [r.day, r]));
      const filled = [];
      for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); filled.push(byDay.get(d) || { day: d, views: 0, visitors: 0 }); }
      const channels = { seo: 0, social: 0, referral: 0, direct: 0, paid: 0 };
      chan.forEach((r) => { if (r.channel in channels) channels[r.channel] = r.n; });
      channels.all = Object.values(channels).reduce((a, b) => a + b, 0);
      return send(res, 200, { range: days, channel: ch, channels, series: filled, views: tot[0].views, visitors: tot[0].visitors, live: live[0].n, sources, pages, countries, devices });
    }
    if (req.method === 'GET') {
      const month = new Date().toISOString().slice(0, 7);
      const [today, yesterday, days, users] = await Promise.all([
        summary(0), summary(1),
        sql("SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM visits WHERE day > current_date - 14 GROUP BY day ORDER BY day"),
        sql(`SELECT u.id, u.email, u.plan, u.credits, to_char(u.created_at, 'YYYY-MM-DD') AS created, u.signup_ip,
              (SELECT count(*)::int FROM generations g WHERE g.user_id = u.id) AS videos,
              COALESCE((SELECT n FROM usage x WHERE x.key = u.id::text AND x.month = $1), 0) AS used
             FROM users u ORDER BY u.created_at DESC LIMIT 300`, [month]),
      ]);
      return send(res, 200, { me: me.email, today, yesterday, days, users });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readJson(req);
    const { action, id, plan, credits } = body;
    if (action !== 'send-outbound' && !/^[0-9a-f-]{36}$/.test(id || '')) throw httpError(400, 'Unknown user');
    if (action === 'plan' && ['free', 'pro', 'business'].includes(plan)) await sql('UPDATE users SET plan = $1, plan_checked_at = now() WHERE id = $2', [plan, id]);
    else if (action === 'credits') await sql('UPDATE users SET credits = $1 WHERE id = $2', [Math.max(0, Math.min(999, credits | 0)), id]);
    else if (action === 'reset') await sql('DELETE FROM usage WHERE key = $1', [id]);
    else if (action === 'delete') { if (id === me.id) throw httpError(400, 'You cannot delete your own account'); await sql('DELETE FROM users WHERE id = $1', [id]); }
    else if (action === 'send-outbound') {
      // envoi d'un e-mail ad hoc depuis l'admin (réservé aux admins)
      const { to, subject, text: txt, html: htm, replyTo } = body;
      if (!to || !subject || (!txt && !htm)) throw httpError(400, 'Missing to/subject/text');
      const key = process.env.RESEND_API_KEY;
      if (!key) throw httpError(503, 'Email not configured');
      const body = { from: process.env.EMAIL_FROM || 'ClipMotion <hello@clipmotion.ai>', to: [to], subject, ...(htm ? { html: htm } : {}), ...(txt ? { text: txt } : {}), ...(replyTo ? { reply_to: replyTo } : {}) };
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw httpError(502, j.message || 'Resend error');
      return send(res, 200, { sent: true, id: j.id });
    }
    else throw httpError(400, 'Unknown action');
    send(res, 200, { ok: true });
  } catch (e) {
    if (!e.status) console.error('admin', e.message);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
};
