// Décor publicitaire sur mesure, généré par IA (modèle image via OpenRouter).
// On ne génère QUE le décor, vide : le vrai produit détouré est posé dessus ensuite, donc jamais déformé.
const { send, readJson, httpError, handler } = require('../lib/util');

const MOODS = {
  warm: 'warm golden-hour light, amber rim light, cosy upscale interior',
  dark: 'dark premium studio, dramatic low-key lighting, neon rim lights and soft bokeh',
  pastel: 'bright airy pastel studio, soft diffused daylight, gentle shadows',
  studio: 'clean high-end photo studio, soft gradient wall, large softbox lighting',
};
const SURFACES = { warm: 'glossy wooden floor', dark: 'glossy black reflective floor', pastel: 'smooth matte pastel surface', studio: 'smooth light seamless floor' };
const RATIOS = { '9:16': '9:16', '1:1': '1:1', '16:9': '16:9' };
const cache = new Map();
const clean = (v, max) => String(v || '').replace(/[^\p{L}\p{N}\s,.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

module.exports = handler('POST', async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) throw httpError(503, 'Décor IA non configuré');
  const b = await readJson(req);
  const decor = MOODS[b.decor] ? b.decor : 'studio';
  const ratio = RATIOS[b.format] || '9:16';
  const scene = clean(b.scene, 220), category = clean(b.category, 40), accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : '';
  const key = [decor, ratio, scene, category, accent].join('|');
  if (!cache.has(key)) {
    const prompt = `Generate a photorealistic cinematic advertising BACKDROP for a ${category || 'product'} commercial, aspect ratio ${ratio}.
Setting: ${scene || MOODS[decor]}. Lighting and mood: ${MOODS[decor]}${accent ? `, with subtle accent light of colour ${accent}` : ''}. Shallow depth of field: the background is softly blurred with bokeh.
The lower 40% of the image is an EMPTY ${SURFACES[decor]} seen from a low camera angle, sharp and clean, lit by a soft spotlight in the centre, ready for a product to be composited on it later.
Absolutely no product, no object, no furniture, no person, no text, no logo and no watermark in the centre or in the foreground.`;
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(50000),
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json', 'x-title': 'AdReel' },
      body: JSON.stringify({ model: process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image', modalities: ['image', 'text'], image_config: { aspect_ratio: ratio }, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || '';
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(url);
    if (!r.ok || !m) throw httpError(502, 'Décor IA indisponible');
    if (cache.size > 40) cache.clear();
    cache.set(key, { type: m[1], buf: Buffer.from(m[2], 'base64') });
  }
  const img = cache.get(key);
  send(res, 200, img.buf, { 'content-type': img.type, 'cache-control': 'private, max-age=3600' });
});
