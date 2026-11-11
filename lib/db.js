// Base Postgres (Neon) par son interface HTTP : aucune dépendance, adaptée aux fonctions serverless.
async function sql(query, params = []) {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw Object.assign(new Error('Accounts are not configured'), { status: 503 });
  const r = await fetch(`https://${new URL(cs).hostname}/sql`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'neon-connection-string': cs, 'content-type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || `database ${r.status}`), { code: j.code });
  return j.rows || [];
}

let ready = null;
// La table est créée au premier appel.
const SCHEMA = [`CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  pass text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  stripe_customer text,
  created_at timestamptz NOT NULL DEFAULT now()
)`, 'ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip text',
`CREATE TABLE IF NOT EXISTS generations (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  brand text, url text, kind text, intent text, format text, seconds real, resolution text
)`, 'CREATE INDEX IF NOT EXISTS generations_user ON generations (user_id, created_at DESC)'];
const init = () => (ready ||= (async () => { for (const q of SCHEMA) await sql(q); })().catch((e) => { ready = null; throw e; }));

module.exports = { sql: async (q, p) => { await init(); return sql(q, p); } };
