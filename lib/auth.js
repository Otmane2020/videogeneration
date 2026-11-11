// Comptes : mot de passe haché (scrypt) et session dans un cookie signé, HttpOnly.
const crypto = require('crypto');
const { sql } = require('./db');

const COOKIE = 'cm_session', DAYS = 30;
const secret = () => {
  if (!process.env.SESSION_SECRET) throw Object.assign(new Error('Accounts are not configured'), { status: 503 });
  return process.env.SESSION_SECRET;
};
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function check(password, stored) {
  const [salt, h] = String(stored).split(':');
  const a = Buffer.from(h || '', 'hex'), b = crypto.scryptSync(password, salt || '', 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Le site répond sur clipmotion.ai et www.clipmotion.ai : le cookie vaut pour les deux.
const scope = (host) => (/(^|\.)clipmotion\.ai(:\d+)?$/i.test(String(host || '')) ? '; Domain=clipmotion.ai' : '');
function cookieFor(id, host) {
  const v = `${id}.${Date.now() + DAYS * 864e5}`;
  return `${COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}${scope(host)}`;
}
const clear = (host) => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${scope(host)}`;

// Utilisateur de la requête, ou null.
async function user(req) {
  const m = new RegExp(`(?:^|; )${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  if (!m || !process.env.SESSION_SECRET) return null;
  const [id, exp, sig] = m[1].split('.');
  const good = sign(`${id}.${exp}`);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) || +exp < Date.now() || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await sql('SELECT id, email, plan, credits, stripe_sub, plan_checked_at FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// Jeton de réinitialisation : valable une heure, et lié au mot de passe actuel (inutilisable après changement).
const resetToken = (id, pass) => { const v = `${id}.${Date.now() + 36e5}`; return `${v}.${sign(v + '.' + pass)}`; };
function resetCheck(token, pass) {
  const [id, exp, sig] = String(token).split('.');
  const good = sign(`${id}.${exp}.${pass}`);
  return !!sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) && +exp > Date.now();
}

module.exports = { hash, check, cookieFor, clear, user, resetToken, resetCheck };
