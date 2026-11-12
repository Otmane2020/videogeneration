// Deux actions :
//   POST /api/backdrop           → génère un décor publicitaire (CF Workers AI gratuit ou OpenRouter payant)
//   POST /api/backdrop?a=removebg → détourage serveur (ClearBackdrop, Clipdrop ou remove.bg)
//
// Le vrai produit détouré est toujours posé côté client par-dessus le décor,
// donc sa forme, son logo et ses détails ne sont jamais altérés.

const { send, readJson, httpError, safeFetch, readCapped, handler } = require('../lib/util');
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
      // FLUX.2 Klein : multipart (largeur et hauteur libres) ; FLUX.1 Schnell : JSON, image carrée seulement
      const klein = model.includes('flux-2');
      let init;
      if (klein) {
        const fd = new FormData();
        fd.append('prompt', prompt); fd.append('width', String(dims.width)); fd.append('height', String(dims.height));
        init = { body: fd, headers: { authorization: `Bearer ${tok}` } };
      } else init = { body: JSON.stringify({ prompt, steps: 8 }), headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' } };
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${model}`, { method: 'POST', signal: AbortSignal.timeout(45000), ...init });
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
        return { type: buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png', buf };
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
// Chaîne : ClearBackdrop (80/jour gratuits) → Clipdrop (100/jour) → remove.bg (50/mois). Si tout échoue, le navigateur détoure lui-même.
// L'image est une adresse publique (récupérée sans jamais atteindre le réseau interne) ou une image envoyée en data URL.
async function loadSource(src) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (m) {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8e6) throw httpError(413, 'Image too large');
    return { buf, type: m[1] };
  }
  const r = await safeFetch(src, {}, 15000);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) { r.body?.cancel().catch(() => {}); throw httpError(502, 'Cannot use this image'); }
  const { buf, truncated } = await readCapped(r, 8e6);
  if (truncated) throw httpError(413, 'Image too large');
  return { buf, type };
}

const PROVIDERS = [
  ['ClearBackdrop', () => process.env.CLEARBACKDROP_API_KEY, ({ buf, type }, key) => {
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type }), 'product.jpg');
    return fetch('https://clearbackdrop.com/api/v1/remove-background', { method: 'POST', headers: { 'x-api-key': key }, body: fd, signal: AbortSignal.timeout(30000) });
  }],
  ['Clipdrop', () => process.env.CLIPDROP_API_KEY, ({ buf, type }, key) => {
    const fd = new FormData();
    fd.append('image_file', new Blob([buf], { type }), 'product.jpg');
    return fetch('https://clipdrop-api.co/remove-background/v1', { method: 'POST', headers: { 'x-api-key': key }, body: fd, signal: AbortSignal.timeout(30000) });
  }],
  ['remove.bg', () => process.env.REMOVEBG_API_KEY, ({ buf, type }, key) => {
    const fd = new FormData();
    fd.append('image_file', new Blob([buf], { type }), 'product.jpg');
    fd.append('size', 'auto'); fd.append('type', 'product'); fd.append('format', 'png');
    return fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'x-api-key': key }, body: fd, signal: AbortSignal.timeout(30000) });
  }],
];

async function removeBg(src) {
  const on = PROVIDERS.filter(([, key]) => key());
  if (!on.length) throw httpError(503, 'No background removal API key configured');
  const img = await loadSource(src);
  for (const [name, key, call] of on) {
    try {
      const r = await call(img, key());
      const out = Buffer.from(await r.arrayBuffer());
      // un vrai PNG uniquement (une page d'erreur ou un quota dépassé passe au fournisseur suivant)
      if (r.ok && out.subarray(1, 4).toString() === 'PNG') return out;
      console.warn(name, 'removebg', r.status, out.subarray(0, 120).toString('utf8').replace(/\s+/g, ' '));
    } catch (e) { console.warn(name, 'removebg', e.message); }
  }
  throw httpError(502, 'Background removal unavailable');
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
    if (!/^(https?:\/\/|data:image\/)/i.test(b.url)) throw httpError(400, 'invalid url');
    const png = await removeBg(b.url);
    return send(res, 200, png, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' });
  }

  // ── Action : Meta Muse Image, scène e-commerce complète avec product placement ──
  if (action === 'muse-scene') {
    const b = await readJson(req);
    if (b.type !== 'ecom') throw httpError(400, 'Muse product scenes are only enabled for e-commerce videos');
    const format = ['9:16', '1:1', '16:9'].includes(b.format) ? b.format : '9:16';
    if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
      const u = await user(req).catch(() => null);
      if (!u || u.plan === 'free') throw httpError(402, 'Muse product scenes require Pro');
    }
    const framing = format === '9:16'
      ? 'Vertical 9:16 portrait advertising composition for Reels, TikTok and Shorts. Keep the product fully inside the portrait-safe area.'
      : format === '16:9'
        ? 'Horizontal 16:9 commercial advertising composition. Keep the product fully inside the landscape-safe area.'
        : 'Square 1:1 premium e-commerce advertising composition.';
    const role = ['hook', 'context', 'demo', 'outcome', 'cta'].includes(b.role) ? b.role : 'product';
    const sceneBrief = clean(b.sceneBrief, 260);
    const headline = clean(b.headline, 90);
    const voiceover = clean(b.voiceover, 180);
    const category = clean(b.category, 60);
    const productName = clean(b.productName, 120);
    const description = clean(b.productDescription, 420);
    const variant = clean(b.variant, 120);
    const palette = clean(b.brandPalette, 100);
    // Deux familles de plans : le « key visual » qui arrête le pouce (produit seul en héros, lumière spectaculaire)
    // et le plan d'usage (produit porté ou utilisé). L'accroche, le deuxième plan et l'écran final sont des key visuals.
    const hero = role !== 'context' && role !== 'demo';
    const mood = /watch|montre|jewel|bijou|ring|bague|necklace|collier|bracelet|perfume|parfum|luxury|luxe|leather|cuir/i.test(`${category} ${productName} ${description}`)
      ? 'luxury'
      : /sneaker|shoe|chaussure|basket|headphone|casque|audio|earbud|speaker|phone|tech|gaming|console|laptop|camera/i.test(`${category} ${productName} ${description}`) ? 'tech' : 'premium';
    const look = {
      hook: {
        tech: 'Ultra-dramatic studio key visual: the product alone, low-angle three-quarter view, on a glossy black reflective floor with a mirror reflection; electric blue and violet neon rim lights; a glowing neon light ring or arc behind it; deep night background of blurred blue and purple city-light bokeh; light haze; razor-sharp product, crisp specular highlights, high contrast, saturated cinematic colour grade.',
        luxury: 'Ultra-dramatic luxury studio key visual: the product alone as a precious object, low three-quarter angle, standing on a black mirror-glass surface with a perfect reflection; a single warm golden spotlight from above, golden rim light, a thin glowing golden light arc behind it, floating gold dust in a dark background; deep shadows, rich contrast, razor-sharp details, high-end jewellery-campaign colour grade. No rocks, no outdoor scenery.',
        premium: 'Ultra-dramatic studio key visual: the product alone, low-angle three-quarter view, on a glossy reflective surface with a soft mirror reflection; vivid rim lights in the brand colours; a glowing light arc behind it; dark gradient background with soft coloured bokeh; razor-sharp product, crisp highlights, high contrast, saturated cinematic colour grade.',
      },
      outcome: {
        tech: 'Second eye-catching key visual, different from the first: the product alone floating slightly above a glossy surface at a dynamic angle, surrounded by sweeping light trails and a purple-to-blue gradient glow, subtle particles in the air, sharp reflections, energetic and futuristic.',
        luxury: 'Second eye-catching luxury key visual, different from the first: the product alone in a natural premium setting (dark rocks, polished marble or rich wood) at golden hour, warm sunlight rays and glowing bokeh, an amber crystal or glinting highlights nearby, dramatic shallow depth of field, opulent and cinematic.',
        premium: 'Second eye-catching key visual, different from the first: the product alone in a beautiful premium setting that suits it, dramatic directional light, glowing bokeh, shallow depth of field, rich saturated colours, editorial and aspirational.',
      },
      cta: {
        tech: 'Final hero key visual: the product alone, centred, glowing neon rim light in blue and violet, glossy reflective floor, clean dark space above for the call to action.',
        luxury: 'Final hero key visual: the product alone, centred, warm golden glow and bokeh, dark luxurious background, clean space above for the call to action.',
        premium: 'Final hero key visual: the product alone, centred, glowing rim light in the brand colours, glossy floor, clean dark space above for the call to action.',
      },
    }[role === 'hook' || role === 'cta' ? role : 'outcome'][mood];
    const direction = hero ? look : {
      context: 'Show the product naturally worn, held, installed or used in the real situation it was designed for, with cinematic light. Make the use instantly understandable.',
      demo: 'A close, tactile commercial shot that makes a real product detail, material, finish or useful feature desirable and visible, dramatic light.',
    }[role];
    const placement = hero
      ? `PRODUCT AS THE HERO — THIS IS ESSENTIAL
Show the product ALONE as the star of a high-end advertising key visual, like a flagship campaign poster: no person, no hands, no packaging, no other product. It fills a large part of the frame, perfectly lit, sharp and instantly recognisable. The scene must stop the scroll: bold light, depth, glow and colour.`
      : `REAL-WORLD PRODUCT PLACEMENT — THIS IS ESSENTIAL
Place the product the way a customer genuinely wears, holds, applies, installs or uses it (watch on a realistic adult wrist, shoes or clothing worn, bag carried, furniture installed, cosmetics applied, headphones or eyewear worn, equipment used for its purpose). If the product is not wearable, do not invent a person holding it.`;
    const prompt = `Create ONE finished, photorealistic, premium E-COMMERCE ADVERTISING IMAGE with the actual product — NOT an empty background, NOT a plain packshot, NOT a collage.

EXACT PRODUCT — USE THE ATTACHED PHOTO AS THE IDENTITY REFERENCE
Product: ${productName || 'Identify the exact product in the reference photo'}.
Category: ${category || 'Infer the category from the reference photo'}.
Description: ${description || 'Use only details visible in the reference photo'}.
Selected variant: ${variant || 'The exact visible variant in the reference photo'}.
Brand colours, as lighting accents: ${palette || 'Choose colours that make the real product pop'}.

The attached reference is the customer's real SKU. Reproduce THAT product faithfully: same silhouette, proportions, construction, colour, material, finish, dial or face details, distinctive parts and visible markings. Do not substitute a similar product, do not change its colour or design, do not add parts.

${placement}

SHOT DIRECTION
Scene role: ${role}.
Creative direction: ${direction}${sceneBrief && !hero ? ` ${sceneBrief}` : ''}.
Headline concept (do not print it): ${headline || 'Product-focused visual hook'}.
Voice-over context (do not print it): ${voiceover || 'Show why this product is desirable'}.

ART DIRECTION
${framing}
Top-tier commercial product photography and CGI-quality lighting: dramatic rim light, specular highlights, reflections, glow, depth of field, cinematic colour grade, 8k detail. Eye-catching and premium, like a Nike, Apple, Beats or Rolex campaign visual.

No text, no captions, no price, no labels, no added logo, no watermark, no borders, no UI, no split screen, no collage, no duplicated product, no extra fingers, no malformed hands. Keep the genuine logos and markings that are on the real product.
Return only the finished advertising photograph.`;
    const generated = await museBackdrop({ prompt, referenceImage: b.referenceImage || null });
    return send(res, 200, generated.image, {
      'content-type': generated.mediaType,
      'cache-control': 'no-store',
      'x-image-model': 'meta/muse-image',
      'x-scene-role': role,
      ...(generated.cost ? { 'x-image-cost-usd': String(generated.cost) } : {}),
    });
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
      ? 'Compose for a vertical 9:16 product video. Keep the hero placement area and the most important environmental details inside the central portrait-safe composition.'
      : format === '16:9'
        ? 'Compose for a horizontal 16:9 product video. Keep the hero placement area and the most important environmental details inside the central landscape-safe composition.'
        : 'Compose for a square 1:1 product video with a balanced, premium advertising composition.';
    const scene = clean(b.scene, 220);
    const category = clean(b.category, 60);
    const productName = clean(b.productName, 120);
    const description = clean(b.productDescription, 420);
    const variant = clean(b.variant, 120);
    const palette = clean(b.brandPalette, 100);
    const prompt = `Act as an award-winning creative director and commercial product photographer. Create ONE beautiful, photorealistic advertising BACKGROUND ENVIRONMENT for the exact product shown in the attached reference image.

PRODUCT TO UNDERSTAND
Product name: ${productName || 'Identify it from the reference photo'}.
Category: ${category || 'Infer the exact category from the reference photo'}.
Product details: ${description || 'Read the visible product design, materials, finish and intended use from the reference photo'}.
Selected variant: ${variant || 'Use the visible variant in the reference photo'}.
Brand accent colours, only if useful: ${palette || 'Choose colours that harmonise with the actual product'}.

PRODUCT-SPECIFIC ART DIRECTION
First inspect the reference photo. Identify what the product actually is, its dominant colours, materials, finish, silhouette, target audience and real-world use. Then invent a distinct premium setting that makes sense for THIS product and makes it look desirable.
Use the supplied campaign direction as a creative brief, not as a fixed template: ${scene || 'Invent the most fitting visual concept from the product itself'}.
Choose the environment, architecture, surfaces, textures, lighting, colour palette and atmosphere dynamically from the product. A beauty product, a sofa, a watch, a pair of shoes, a kitchen appliance and a pair of headphones must NOT all receive the same studio, colour scheme or decorative motif. Avoid a repeated purple/neon/ring background unless the actual product and campaign brief clearly call for it. Do not use a generic one-style-fits-all backdrop.
Create a polished, visually rich setting with believable depth and premium lighting. Subtle contextual details may appear at the edges when they reinforce the product's world, but they must never compete with or overlap the hero placement area.

COMPOSITION
${framing}
Leave a clear, attractive hero placement area in the centre/lower-middle, with a suitable surface, floor, plinth or natural setting chosen for this product. The area must have enough contrast and visual breathing room for ClipMotion to composite the customer's original transparent product cutout on top. This should look like a finished campaign photograph, not an empty flat colour or a blank studio wall.

STRICT PRODUCT FIDELITY
The reference is for product understanding and colour matching only. Do NOT draw, recreate, approximate, duplicate or insert the product itself. No replacement product, no silhouette, no placeholder object, no second competing hero item, no person or hand, no text, no letters, no logo, no brand mark, no watermark, no border and no mockup. The real product cutout will be composited by ClipMotion after this background is generated.
Output only the finished, product-specific photographic environment.`;
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
