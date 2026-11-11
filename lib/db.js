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
)`, 'CREATE INDEX IF NOT EXISTS generations_user ON generations (user_id, created_at DESC)',
'ALTER TABLE users ADD COLUMN IF NOT EXISTS credits int NOT NULL DEFAULT 0',
'CREATE TABLE IF NOT EXISTS usage (key text NOT NULL, month text NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (key, month))',
'CREATE TABLE IF NOT EXISTS payments (session_id text PRIMARY KEY, user_id uuid NOT NULL, plan text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_sub text',
'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_checked_at timestamptz',
'CREATE TABLE IF NOT EXISTS visits (id bigserial PRIMARY KEY, day date NOT NULL DEFAULT current_date, path text NOT NULL, vid text NOT NULL, ref text, created_at timestamptz NOT NULL DEFAULT now())',
'CREATE INDEX IF NOT EXISTS visits_day ON visits (day)',
'CREATE TABLE IF NOT EXISTS push_subs (endpoint text PRIMARY KEY, user_id uuid, created_at timestamptz NOT NULL DEFAULT now())',
'CREATE TABLE IF NOT EXISTS push_msgs (id bigserial PRIMARY KEY, title text NOT NULL, body text, url text, created_at timestamptz NOT NULL DEFAULT now())',
'ALTER TABLE generations ADD COLUMN IF NOT EXISTS thumb text',
'ALTER TABLE generations ADD COLUMN IF NOT EXISTS caption_style text NOT NULL DEFAULT \'karaoke\'',
'ALTER TABLE generations ADD COLUMN IF NOT EXISTS template_style text NOT NULL DEFAULT \'cinematic\'',
'ALTER TABLE generations ADD COLUMN IF NOT EXISTS generation_model text NOT NULL DEFAULT \'stock-canvas-v1\'',
`CREATE TABLE IF NOT EXISTS inbound_msgs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL DEFAULT 'contact',
  from_email text,
  from_name text,
  subject text,
  body text,
  received_at timestamptz NOT NULL DEFAULT now()
)`];
const init = () => (ready ||= (async () => { for (const q of SCHEMA) await sql(q); })().catch((e) => { ready = null; throw e; }));

module.exports = { sql: async (q, p) => { await init(); return sql(q, p); } };
