// Quotas mensuels de vidéos par offre. La consommation est comptée au moment où le script est écrit ;
// les retouches et nouveaux rendus d'une même vidéo ne comptent pas.
const { sql } = require('./db');
const { user } = require('./auth');

const LIMITS = () => ({ free: +(process.env.QUOTA_FREE || 3), pro: +(process.env.QUOTA_PRO || 30), business: +(process.env.QUOTA_BUSINESS || 150) });
const month = () => new Date().toISOString().slice(0, 7);
const ipOf = (req) => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 60);
const enabled = () => !!(process.env.DATABASE_URL && process.env.SESSION_SECRET);

async function usage(req, u) {
  u = u === undefined ? await user(req).catch(() => null) : u;
  const key = u ? u.id : 'ip:' + ipOf(req), plan = u ? u.plan : 'free';
  const rows = await sql('SELECT n FROM usage WHERE key = $1 AND month = $2', [key, month()]);
  return { key, plan, used: rows[0]?.n || 0, limit: LIMITS()[plan] ?? LIMITS().free, signedIn: !!u };
}

// Vérifie le quota puis compte une vidéo. Lève une erreur 402 lisible quand il est atteint.
async function consume(req) {
  if (!enabled()) return;
  let q;
  // base injoignable : on laisse passer plutôt que de bloquer la création
  try { q = await usage(req); } catch (e) { console.error('quota', e.message); return; }
  if (q.used >= q.limit) {
    const e = new Error(q.plan === 'free'
      ? `You have used your ${q.limit} free videos this month. Upgrade to keep creating.`
      : `You have reached the ${q.limit} videos of your plan this month.`);
    e.status = 402;
    throw e;
  }
  await sql('INSERT INTO usage (key, month, n) VALUES ($1, $2, 1) ON CONFLICT (key, month) DO UPDATE SET n = usage.n + 1', [q.key, month()]).catch((e) => console.error('quota', e.message));
}

module.exports = { usage, consume, LIMITS, enabled };
