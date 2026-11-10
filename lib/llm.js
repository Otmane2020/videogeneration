// Chaîne de fournisseurs IA : OpenRouter (Gemini, vision) -> Gemini direct (vision) -> Groq (texte).
const { httpError } = require('./util');

async function openAiCompat({ url, key, model, system, user, images, headers = {} }) {
  const content = [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))];
  const r = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
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

async function gemini({ key, model, system, user, images }) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
  if (a < 0 || b <= a) throw new Error('réponse non JSON');
  return JSON.parse(t.slice(a, b + 1));
}

async function generateJson({ system, user, images = [] }) {
  const env = process.env;
  const providers = [];
  if (env.OPENROUTER_API_KEY) providers.push(['OpenRouter · Gemini', () => openAiCompat({
    url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL || 'google/gemini-2.5-flash', system, user, images, headers: { 'x-title': 'AdReel' },
  })]);
  if (env.GEMINI_API_KEY) providers.push(['Gemini', () => gemini({ key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', system, user, images })]);
  // Groq : secours texte seul par défaut (GROQ_VISION=1 si GROQ_MODEL accepte les images)
  if (env.GROQ_API_KEY) providers.push(['Groq', () => openAiCompat({
    url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY,
    model: env.GROQ_MODEL || 'openai/gpt-oss-120b', system, user, images: env.GROQ_VISION === '1' ? images : [],
  })]);
  if (!providers.length) throw httpError(500, 'Aucune clé IA configurée');
  const errors = [];
  for (const [engine, run] of providers) {
    try {
      return { data: parseJson(await run()), engine, errors, vision: engine !== 'Groq' || env.GROQ_VISION === '1' };
    } catch (e) {
      errors.push(`${engine}: ${e.message}`);
    }
  }
  const err = new Error('Tous les fournisseurs IA ont échoué');
  err.errors = errors;
  throw err;
}

module.exports = { generateJson };
