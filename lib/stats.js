// Chiffres partagés par l'espace admin et le compte rendu quotidien.
const { sql } = require('./db');

async function summary(dayOffset = 0) {
  const d = `current_date - ${dayOffset | 0}`;
  const one = async (q) => (await sql(q))[0];
  const [v, s, g, p, t, paid] = await Promise.all([
    one(`SELECT count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM visits WHERE day = ${d}`),
    one(`SELECT count(*)::int AS n FROM users WHERE created_at::date = ${d}`),
    one(`SELECT count(*)::int AS n FROM generations WHERE created_at::date = ${d}`),
    one(`SELECT count(*)::int AS n FROM payments WHERE created_at::date = ${d}`),
    one('SELECT count(*)::int AS n FROM users'),
    one("SELECT count(*)::int AS n FROM users WHERE plan <> 'free'"),
  ]);
  const top = await sql(`SELECT path, count(*)::int AS n FROM visits WHERE day = ${d} GROUP BY path ORDER BY n DESC LIMIT 8`);
  const refs = await sql(`SELECT ref, count(*)::int AS n FROM visits WHERE day = ${d} AND ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 6`);
  return { views: v.views, visitors: v.visitors, signups: s.n, videos: g.n, purchases: p.n, users: t.n, paid: paid.n, top, refs };
}
module.exports = { summary };
