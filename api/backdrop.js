// Deux actions :
//   POST /api/backdrop           → génère un décor publicitaire (CF Workers AI gratuit ou OpenRouter payant)
//   POST /api/backdrop?a=removebg → détourage serveur via remove.bg (clé REMOVEBG_API_KEY)
//
// Le vrai produit détouré est toujours posé côté client par-dessus le décor,
// donc sa forme, son logo et ses détails ne sont jamais altérés.

const { send, readJson, httpError, handler } = require('../lib/util');
const { user } = require('../lib/auth');

// ─── Décors ──────────────────────────────────────────────────────────────────
const MOODS = {
  warm: 'warm golden-hour light, amber rim light, cosy upscale interior',
  dark: 'dark premium studio, dramatic low-key lighting, neon rim lights and soft bokeh',
  pastel: 'bright airy pastel studio, soft diffused daylight, gentle shadows',
  studio: 'clean high-end photo studio, soft gradient wall, large softbox lighting',
};
const SURFACES = {
  warm: 'glossy wooden floor',
  dark: 'glossy black reflective floor',
  pastel: 'smooth matte pastel surface',
  studio: 'smooth light seamless floor',
};
const RATIOS = { '9:16': '9:16', '1:1': '1:1', '16:9': '16:9' };
const backdropCache = new Map();
const clean = (v, max) => String(v || '').replace(/[^\p{L}\p{N}\s,.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Cloudflare Workers AI — gratuit, quota quotidien
async function cfFlux(prompt, ratio) {
  const id = process.env.CF_ACCOUNT_ID;
  const tok = process.env.CF_AI_TOKEN;
  if (!id || !tok) return null;
  // FLUX.2 Klein 4B sur CF Workers AI (Apache 2.0, usage commercial autorisé)
  // Si le modèle n'existe pas encore, on essaie flux-1-schnell comme fallback
  const models = [
    '@cf/black-forest-labs/flux-2-klein-4b',
    '@cf/black-forest-labs/flux-1-schnell',
  ];
  // Ratio → dimensions approximatives (CF accepte width/height)
  const dims = ratio === '9:16' ? { width: 576, height: 1024 }
             : ratio === '1:1'  ? { width: 1024, height: 1024 }
             : /* 16:9 */         { width: 1024, height: 576 };
  for (const model of models) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${model}`, {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, ...dims, num_inference_steps: 8 }),
      });
      if (!r.ok) { const t = await r.text().catch(() => ''); console.warn('CF AI', model, r.status, t.slice(0, 200)); continue; }
      const ct = r.headers.get('content-type') || '';
      if (ct.startsWith('image/')) {
        const buf = Buffer.from(await r.arrayBuffer());
        return { type: ct.split(';')[0].trim(), buf };
      }
      // Peut aussi être JSON avec result.image (base64)
      const j = await r.json().catch(() => ({}));
      const b64 = j.result?.image || j.result?.images?.[0] || '';
      if (b64) {
        const buf = Buffer.from(b64, 'base64');
        return { type: 'image/png', buf };
      }
    } catch (e) { console.warn('CF AI error', model, e.message); }
  }
  return null;
}

// OpenRouter image model — payant, réservé aux plans Pro+
async function orBackdrop(prompt, ratio) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(50000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'ClipMotion' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image',
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: ratio },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || '';
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(url);
  if (!r.ok || !m) return null;
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}

// ─── Détourage serveur ────────────────────────────────────────────────────────
// Priorité : Clipdrop (100/jour gratuits) → remove.bg (50/mois) → erreur
async function removeBg(imageUrl) {
  // 1. Clipdrop par Stability AI — 100 appels/jour gratuits
  //    Clé : https://platform.stability.ai/account/keys
  const clipKey = process.env.CLIPDROP_API_KEY;
  if (clipKey) {
    // Clipdrop accepte un fichier binaire en multipart ; on doit d'abord télécharger l'image
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgResp.ok) throw httpError(502, `Cannot fetch image: ${imgResp.status}`);
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());
    const ct = imgResp.headers.get('content-type') || 'image/jpeg';
    // Multipart form-data manuel (Node n'a pas FormData natif dans toutes les versions)
    const boundary = '----ClipDropBoundary' + Date.now().toString(16);
    const disposition = `Content-Disposition: form-data; name="image_file"; filename="product.jpg"\r\nContent-Type: ${ct}\r\n`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n${disposition}\r\n`),
      imgBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await fetch('https://clipdrop-api.co/remove-background/v1', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'x-api-key': clipKey, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer()); // PNG transparent
    console.warn('Clipdrop removebg', r.status, await r.text().catch(() => ''));
    // Si quota dépassé (402/429) on tombe sur remove.bg
  }

  // 2. remove.bg — 50 crédits/mois gratuits
  //    Clé : https://www.remove.bg/api
  const rmbgKey = process.env.REMOVEBG_API_KEY;
  if (rmbgKey) {
    const form = new URLSearchParams({ image_url: imageUrl, size: 'auto', type: 'product', format: 'png' });
    const r = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'x-api-key': rmbgKey, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    const msg = await r.json().catch(() => ({}));
    throw httpError(502, `remove.bg ${r.status}: ${msg?.errors?.[0]?.title || 'failed'}`);
  }

  throw httpError(503, 'No background removal API key configured (CLIPDROP_API_KEY or REMOVEBG_API_KEY)');
}

// ─── Handler principal ────────────────────────────────────────────────────────
module.exports = handler('POST', async (req, res) => {
  const action = new URL(req.url || '/', 'http://x').searchParams.get('a') || '';

  // ── Action : détourage ────────────────────────────────────────────────────
  if (action === 'removebg') {
    const b = await readJson(req);
    if (!b.url || typeof b.url !== 'string') throw httpError(400, 'url required');
    // Sécurité : on n'accepte que des URL http/https
    if (!/^https?:\/\//i.test(b.url)) throw httpError(400, 'invalid url');
    const png = await removeBg(b.url);
    return send(res, 200, png, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' });
  }

  // ── Action : génération de décor ──────────────────────────────────────────
  const b = await readJson(req);
  const decor = MOODS[b.decor] ? b.decor : 'studio';
  const ratio = RATIOS[b.format] || '9:16';
  const scene = clean(b.scene, 220), category = clean(b.category, 40);
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : '';
  const key = [decor, ratio, scene, category, accent].join('|');

  if (!backdropCache.has(key)) {
    const prompt = `Photorealistic cinematic advertising BACKDROP for a ${category || 'product'} commercial, aspect ratio ${ratio}.
Setting: ${scene || MOODS[decor]}. Lighting: ${MOODS[decor]}${accent ? `, subtle accent colour ${accent}` : ''}. Shallow depth of field, softly blurred background with bokeh.
The lower 40 % of the image is an empty ${SURFACES[decor]} from a low camera angle, sharp, clean, lit by a soft spotlight in the centre, ready for compositing.
Absolutely no product, no object, no furniture, no person, no text, no logo, no watermark anywhere.`;

    // 1. Cloudflare gratuit (tous les plans)
    let img = await cfFlux(prompt, ratio).catch((e) => { console.warn('cfFlux', e.message); return null; });

    // 2. OpenRouter payant (Pro/Business seulement) si CF échoue
    if (!img) {
      if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
        const u = await user(req).catch(() => null);
        if (!u || u.plan === 'free') throw httpError(402, 'AI backdrop requires Pro plan');
      }
      img = await orBackdrop(prompt, ratio).catch(() => null);
    }

    if (!img) throw httpError(502, 'AI backdrop unavailable');
    if (backdropCache.size > 40) backdropCache.clear();
    backdropCache.set(key, img);
  }

  const img = backdropCache.get(key);
  send(res, 200, img.buf, { 'content-type': img.type, 'cache-control': 'private, max-age=3600' });
});
