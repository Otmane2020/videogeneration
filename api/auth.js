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
      return send(res, 200, { user: u && { email: u.email, plan: u.plan }, enabled: !!(process.env.DATABASE_URL && process.env.SESSION_SECRET) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { action, email, password, token } = await readJson(req);
    if (action === 'logout') return send(res, 200, { user: null }, { 'set-cookie': clear });
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
      const rows = await sql('INSERT INTO users (email, pass) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email, plan', [mail, hash(pw)]);
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
