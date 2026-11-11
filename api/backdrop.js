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
// Priorité : ClearBackdrop → Clipdrop → remove.bg. Les services tiers restent côté serveur.
async function clearBackdrop(imageUrl) {
  const key = process.env.CLEARBACKDROP_API_KEY;
  if (!key) return null;
  try {
    const image = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!image.ok) throw new Error(`source image ${image.status}`);
    const type = (image.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|heic|avif|gif|bmp|tiff)$/.test(type)) throw new Error('unsupported source image type');
    const declared = Number(image.headers.get('content-length') || 0);
    if (declared > 15 * 1024 * 1024) throw new Error('source image exceeds ClearBackdrop 15 MB limit');
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('source image is empty or exceeds 15 MB');
    const form = new FormData();
    form.append('image', new Blob([bytes], { type }), 'clipmotion-product');
    const response = await fetch('https://clearbackdrop.com/api/v1/remove-background', {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      console.warn('ClearBackdrop removebg', response.status, detail);
      return null;
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('image/')) return Buffer.from(await response.arrayBuffer());
    const data = await response.json().catch(() => ({}));
    const resultUrl = data.result_url || data.url;
    if (data.success && /^https:\/\/clearbackdrop\.com\//i.test(resultUrl || '')) {
      const result = await fetch(resultUrl, { signal: AbortSignal.timeout(20000) });
      if (result.ok && (result.headers.get('content-type') || '').startsWith('image/')) return Buffer.from(await result.arrayBuffer());
    }
    console.warn('ClearBackdrop returned an unexpected response');
    return null;
  } catch (error) {
    console.warn('ClearBackdrop error', error.message);
    return null;
  }
}

// Priorité : ClearBackdrop (API key) → Clipdrop → remove.bg
async function removeBg(imageUrl) {
  const clear = await clearBackdrop(imageUrl);
  if (clear) return clear;

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

// ─── Meta Muse Image via OpenRouter ───────────────────────────────────────────
// Génère un seul décor par vidéo e-commerce. Le produit fourni en référence sert à
// accorder la palette, mais le modèle doit rendre un décor vide : le packshot exact
// sera ensuite composé par le canvas de ClipMotion.
async function museBackdrop({ prompt, referenceImage }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw httpError(503, 'OPENROUTER_API_KEY is not configured');

  const body = { model: 'meta/muse-image', prompt };
  if (referenceImage) {
    if (typeof referenceImage !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(referenceImage)) {
      throw httpError(400, 'Invalid product reference image');
    }
    if (referenceImage.length > 3 * 1024 * 1024) throw httpError(413, 'Product reference image is too large');
    body.input_references = [{ type: 'image_url', image_url: { url: referenceImage } }];
  }

  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    signal: AbortSignal.timeout(50000),
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'http-referer': process.env.PUBLIC_URL || 'https://www.clipmotion.ai',
      'x-title': 'ClipMotion',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.message || `OpenRouter image API ${response.status}`;
    console.warn('Meta Muse Image failed', response.status, String(message).slice(0, 240));
    throw httpError(502, `Meta Muse Image: ${String(message).slice(0, 180)}`);
  }
  const item = data.data?.find((x) => x?.b64_json);
  if (!item?.b64_json) throw httpError(502, 'Meta Muse Image returned no image');
  const mediaType = /^image\/(?:png|jpeg|webp)$/.test(item.media_type || '') ? item.media_type : 'image/png';
  const image = Buffer.from(item.b64_json, 'base64');
  if (!image.length) throw httpError(502, 'Meta Muse Image returned an empty image');
  return { image, mediaType, cost: Number(data.usage?.cost) || null };
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

  // ── Action : Meta Muse Image, décor e-commerce unique ───────────────────────
  if (action === 'muse') {
    const b = await readJson(req);
    if (b.type !== 'ecom') throw httpError(400, 'Meta Muse backdrop is only enabled for e-commerce videos');
    const format = ['9:16', '1:1', '16:9'].includes(b.format) ? b.format : '9:16';
    // Le choix IA est une option Pro dans l'interface ; on applique aussi le contrôle côté serveur.
    if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
      const u = await user(req).catch(() => null);
      if (!u || u.plan === 'free') throw httpError(402, 'Meta Muse AI backdrop requires Pro plan');
    }
    const framing = format === '9:16'
      ? 'Render as a tall 2:3 portrait composition intended to be center-cropped into a 9:16 mobile video. Keep the glowing arc, light source and empty product landing area inside the central safe crop; avoid important details near the left and right edges.'
      : format === '16:9'
        ? 'Render as a wide 3:2 landscape composition intended to be center-cropped into a 16:9 video. Keep the glowing arc, light source and empty product landing area inside the central safe crop; avoid important details near the top and bottom edges.'
        : 'Render as a balanced square 1:1 composition with the luminous arc and empty product landing area centered.';
    const scene = clean(b.scene, 220);
    const category = clean(b.category, 60);
    const prompt = `Create a premium photorealistic advertising BACKGROUND PLATE ONLY for a high-end ${category || 'consumer product'} product commercial.
Visual direction: deep midnight navy and indigo studio atmosphere, luminous violet and lavender light ribbons forming a large elegant arc behind the hero area, soft atmospheric purple bloom, subtle cool highlights, glossy dark reflective floor with a restrained realistic reflection, cinematic studio lighting, premium luxury electronics campaign, refined gradients, realistic material and light falloff.
${framing}
The lower-middle foreground must remain clean, open and empty so ClipMotion can composite the customer's original transparent product cutout there. Create depth with the environment and lighting, not with props.
${scene ? `Additional mood direction: ${scene}.` : ''}
The reference image, when supplied, is ONLY a guide for the product category, its palette and the campaign mood. Do not reproduce the referenced product. Do not draw any product, object, headphones, device, pedestal, furniture, person, hand, text, lettering, brand, logo, watermark, frame or mockup. No placeholder object. Output only the finished empty photographic environment.`;
    const generated = await museBackdrop({ prompt, referenceImage: b.referenceImage || null });
    return send(res, 200, generated.image, {
      'content-type': generated.mediaType,
      'cache-control': 'no-store',
      'x-image-model': 'meta/muse-image',
      ...(generated.cost ? { 'x-image-cost-usd': String(generated.cost) } : {}),
    });
  }

  // ── Action : génération de décor historique ───────────────────────────────
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
