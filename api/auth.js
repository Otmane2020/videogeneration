// Comptes : GET = utilisateur courant ; POST { action: signup | login | logout }.
const { send, readJson, httpError } = require('../lib/util');
const { sql } = require('../lib/db');
const { hash, check, cookieFor, clear, user, resetToken, resetCheck } = require('../lib/auth');
const { sendMail } = require('../lib/mail');

const originOf = (req) => { const h = String(req.headers.host || ''); return /^[\w.-]+(:\d+)?$/.test(h) ? (/^(localhost|127\.)/.test(h) ? 'http://' : 'https://') + h : 'https://clipmotion.ai'; };

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const u = await user(req).catch(() => null);
      // profil : offre et historique des vidéos réussies
      const history = u ? await sql('SELECT created_at, brand, url, kind, intent, format, seconds, resolution FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [u.id]).catch(() => []) : [];
      return send(res, 200, { user: u && { email: u.email, plan: u.plan }, history, enabled: !!(process.env.DATABASE_URL && process.env.SESSION_SECRET) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readJson(req);
    const { action, email, password, token } = body;
    if (action === 'logout') return send(res, 200, { user: null }, { 'set-cookie': clear });
    if (action === 'log') {
      // une vidéo vient d'être montée : on l'ajoute à l'historique du compte
      const u = await user(req);
      if (!u) return send(res, 200, { saved: false });
      const g = body.gen || {}, t = (v, n) => String(v ?? '').slice(0, n);
      await sql('INSERT INTO generations (user_id, brand, url, kind, intent, format, seconds, resolution) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [u.id, t(g.brand, 80), t(g.url, 400), t(g.kind, 10), t(g.intent, 20), t(g.format, 8), Math.min(120, Math.max(0, +g.seconds || 0)), t(g.resolution, 12)]);
      return send(res, 200, { saved: true });
    }
    if (action === 'reset') {
      const pw2 = String(password || ''), id = String(token || '').split('.')[0];
      if (pw2.length < 8 || pw2.length > 200) throw httpError(400, 'Your password needs at least 8 characters');
      const rows = /^[0-9a-f-]{36}$/.test(id) ? await sql('SELECT id, email, plan, pass FROM users WHERE id = $1', [id]) : [];
      if (!rows[0] || !resetCheck(token, rows[0].pass)) throw httpError(400, 'This reset link is no longer valid. Ask for a new one.');
      await sql('UPDATE users SET pass = $1 WHERE id = $2', [hash(pw2), id]);
      return send(res, 200, { user: { email: rows[0].email, plan: rows[0].plan } }, { 'set-cookie': cookieFor(id) });
    }
    const mail = String(email || '').trim().toLowerCase(), pw = String(password || '');
    if (action === 'forgot') {
      // même réponse que le compte existe ou non
      if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
        const rows = await sql('SELECT id, pass FROM users WHERE email = $1', [mail]);
        if (rows[0]) await sendMail(mail, 'reset', { origin: originOf(req), token: resetToken(rows[0].id, rows[0].pass) });
      }
      return send(res, 200, { sent: true });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 200) throw httpError(400, 'Enter a valid email address');
    if (pw.length < 8 || pw.length > 200) throw httpError(400, 'Your password needs at least 8 characters');
    let u;
    if (action === 'signup') {
      // un seul compte gratuit par adresse IP (FREE_ACCOUNTS_PER_IP pour assouplir)
      const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 60);
      const max = parseInt(process.env.FREE_ACCOUNTS_PER_IP || '1', 10);
      if (ip && max > 0) {
        const n = await sql("SELECT count(*)::int AS n FROM users WHERE signup_ip = $1 AND plan = 'free'", [ip]);
        if (n[0].n >= max) throw httpError(403, 'A free account already exists on this network. Sign in to it, or upgrade it to Pro.');
      }
      const rows = await sql('INSERT INTO users (email, pass, signup_ip) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, plan', [mail, hash(pw), ip || null]);
      if (!rows[0]) throw httpError(409, 'An account already exists for this email. Sign in instead.');
      u = rows[0];
      await sendMail(mail, 'welcome', { origin: originOf(req) });
    } else if (action === 'login') {
      const rows = await sql('SELECT id, email, plan, pass FROM users WHERE email = $1', [mail]);
      // même message que l'adresse existe ou non
      if (!rows[0] || !check(pw, rows[0].pass)) throw httpError(401, 'Wrong email or password');
      u = rows[0];
    } else throw httpError(400, 'Unknown action');
    send(res, 200, { user: { email: u.email, plan: u.plan } }, { 'set-cookie': cookieFor(u.id) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('auth', e.message);
    send(res, e.status || 500, { error: e.status && e.status < 500 ? e.message : e.status === 503 ? e.message : 'Server error' });
  }
};
