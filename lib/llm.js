// Chaîne de fournisseurs IA, du gratuit au payant : OpenRouter gratuits (vision) -> Meta Muse Spark (vision) -> Groq (texte) -> Vertex AI / Gemini (même clé) -> OpenRouter payant.
const { httpError } = require('./util');

async function openAiCompat({ url, key, model, system, user, images, headers = {} }) {
  const content = [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))];
  const r = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(40000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      model, temperature: 0.8, max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || 'erreur'}`.slice(0, 200));
  return j.choices?.[0]?.message?.content || '';
}

// Même format de requête pour l'API Gemini et pour Vertex AI (clé API en mode express).
async function gemini({ key, model, system, user, images, vertex = false }) {
  const base = vertex ? 'https://aiplatform.googleapis.com/v1/publishers/google/models' : 'https://generativelanguage.googleapis.com/v1beta/models';
  const r = await fetch(`${base}/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.b64 } }))] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2500, responseMimeType: 'application/json' },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || 'erreur'}`.slice(0, 200));
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

function parseJson(text) {
  const t = String(text).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('non-JSON reply');
  return JSON.parse(t.slice(a, b + 1));
}

async function generateJson({ system, user, images = [], needVision = false }) {
  const env = process.env;
  const providers = [];
  // Modèles gratuits d'abord ; le modèle payant ne sert qu'en dernier recours.
  const or = (label, model) => [label, () => openAiCompat({
    url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model, system, user, images, headers: { 'x-title': 'ClipMotion' },
  }), true];
  if (env.OPENROUTER_API_KEY) {
    for (const m of (env.OPENROUTER_FREE_MODELS || 'google/gemma-4-31b-it:free').split(',').filter(Boolean)) {
      providers.push(or(`OpenRouter · ${m.split('/').pop().replace(':free', '')} (free)`, m.trim()));
    }
  }
  // Meta Muse Spark (OpenRouter, vision) : peu coûteux, passe avant les fournisseurs gratuits à texte seul. OPENROUTER_MUSE_MODEL=0 le coupe.
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MUSE_MODEL !== '0') providers.push(or('OpenRouter · Meta Muse Spark', env.OPENROUTER_MUSE_MODEL || 'meta/muse-spark-1.3'));
  // Groq : gratuit, texte seul par défaut (GROQ_VISION=1 si GROQ_MODEL accepte les images)
  if (env.GROQ_API_KEY) providers.push(['Groq (free)', () => openAiCompat({
    url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY,
    model: env.GROQ_MODEL || 'openai/gpt-oss-120b', system, user, images: env.GROQ_VISION === '1' ? images : [],
  }), env.GROQ_VISION === '1']);
  if (env.GEMINI_API_KEY) providers.push(['Vertex AI · Gemini', () => gemini({ key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', system, user, images, vertex: true }), true]);
  if (env.GEMINI_API_KEY) providers.push(['Gemini', () => gemini({ key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', system, user, images }), true]);
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_PAID !== '0') providers.push(or('OpenRouter · Gemini (paid)', env.OPENROUTER_MODEL || 'google/gemini-2.5-flash'));
  // Quand la vision est indispensable (vérifier les photos produit), les modèles qui voient passent avant.
  if (needVision && images.length) providers.sort((a, b) => !!b[2] - !!a[2]);
  if (!providers.length) throw httpError(500, 'No AI key configured');
  const errors = [];
  for (const [engine, run, vision] of providers) {
    try {
      return { data: parseJson(await run()), engine, errors, vision };
    } catch (e) {
      errors.push(`${engine}: ${e.message}`);
    }
  }
  const err = new Error('All AI providers failed');
  err.errors = errors;
  throw err;
}

module.exports = { generateJson };
