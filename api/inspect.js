// Étape 1 : récupère la page et en extrait le contenu utile + une première estimation SaaS / E-com.
const { send, readJson, httpError, safeFetch, readCapped, handler } = require('../lib/util');

const decode = (s = '') => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = (s = '') => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
};

function extract(html, base) {
  const abs = (u) => { try { return new URL(u, base).href; } catch { return ''; } };
  const metas = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const k = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    const v = attr(tag, 'content');
    if (k && v && !metas[k]) metas[k] = v;
  }
  const links = (html.match(/<link\b[^>]*>/gi) || []).map((t) => ({ rel: attr(t, 'rel').toLowerCase(), href: attr(t, 'href') }));
  const icon = links.find((l) => l.rel.includes('apple-touch-icon')) || links.find((l) => l.rel.includes('icon'));
  const heads = (n) => [...html.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)</h${n}>`, 'gi'))].map((m) => clean(m[1])).filter((t) => t.length > 2 && t.length < 160);

  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = clean(body).slice(0, 5000);

  // données structurées : fiche produit et logo de la marque
  const nodes = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* JSON-LD invalide */ }
  }
  const isType = (n, t) => [].concat(n['@type'] || []).some((x) => String(x).toLowerCase() === t);
  const urls = (v) => [].concat(v || []).map((x) => (typeof x === 'string' ? x : x && (x.url || x.contentUrl))).filter(Boolean);
  const group = nodes.find((n) => isType(n, 'productgroup'));
  const prod = nodes.find((n) => isType(n, 'product')) || group;
  const org = nodes.find((n) => n.logo && (isType(n, 'organization') || isType(n, 'brand') || isType(n, 'website') || isType(n, 'onlinestore')));
  const num = (v) => (v != null && /^[\d.,\s]+$/.test(String(v)) ? String(v).trim() : '');
  const offerOf = (n) => [].concat(n.offers || [])[0] || {};
  const priceOf = (o) => num(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
  let product = null;
  const ldImages = [];
  if (prod) {
    const offer = offerOf(prod);
    product = {
      name: clean(String(prod.name || '')).slice(0, 160),
      description: clean(String(prod.description || '')).slice(0, 600),
      brand: clean(String((prod.brand && (prod.brand.name || prod.brand)) || '')).slice(0, 60),
      price: priceOf(offer) || priceOf(offerOf([].concat(group?.hasVariant || [])[0] || {})),
      currency: /^[A-Z]{3}$/.test(offer.priceCurrency || '') ? offer.priceCurrency : '',
      options: [], variants: [],
    };
    urls(prod.image).forEach((u) => ldImages.push(u));
    // variantes : ProductGroup.hasVariant, ou plusieurs Product / offres sur la même page
    const kids = [].concat(group?.hasVariant || []).filter((v) => v && typeof v === 'object');
    const many = kids.length ? kids : nodes.filter((n) => isType(n, 'product') && n !== prod && (n.color || n.size));
    for (const v of many.slice(0, 60)) {
      const opts = {};
      for (const k of ['color', 'size', 'material', 'pattern']) if (v[k]) opts[k[0].toUpperCase() + k.slice(1)] = clean(String(v[k].name || v[k])).slice(0, 40);
      const img = urls(v.image)[0];
      if (img) ldImages.push(img);
      const o = offerOf(v);
      if (Object.keys(opts).length) product.variants.push({ options: opts, price: priceOf(o), image: img ? abs(img) : '', available: !/OutOfStock/i.test(String(o.availability || '')) });
    }
  } else if (metas['product:price:amount'] || metas['og:price:amount']) {
    product = { name: '', description: '', brand: '', price: num(metas['product:price:amount'] || metas['og:price:amount']), currency: metas['product:price:currency'] || metas['og:price:currency'] || '', options: [], variants: [] };
  }

  // WooCommerce : toutes les variations sont dans un attribut du formulaire
  const woo = html.match(/data-product_variations\s*=\s*"([^"]{10,})"/i);
  if (woo) {
    try {
      const list = JSON.parse(decode(woo[1]));
      product ||= { name: '', description: '', brand: '', price: '', currency: '', options: [], variants: [] };
      for (const v of list.slice(0, 80)) {
        const opts = {};
        for (const [k, val] of Object.entries(v.attributes || {})) if (val) opts[k.replace(/^attribute_(pa_)?/, '').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())] = String(val).replace(/-/g, ' ').slice(0, 40);
        const img = v.image && (v.image.full_src || v.image.url || v.image.src);
        if (img) ldImages.push(img);
        if (Object.keys(opts).length) product.variants.push({ options: opts, price: num(v.display_price), image: img ? abs(img) : '', available: v.is_in_stock !== false });
      }
    } catch { /* variations illisibles */ }
  }

  // Options lisibles dans la page (listes déroulantes et pastilles) quand aucune variante structurée n'existe
  const OPT = /colou?r|couleur|coloris|farbe|size|taille|pointure|talla|gr(ö|oe)(ß|ss)e|mati[eè]re|material|mod[eè]le|style|finition|finish|capacit|dimension|longueur|length/i;
  const domOptions = {};
  const addOpt = (name, val) => {
    name = clean(name).replace(/^(attribute_)?(pa_)?/i, '').replace(/[\[\]_-]+/g, ' ').replace(/\b(product|option|select|id)\b/gi, '').trim().slice(0, 30).replace(/^./, (c) => c.toUpperCase());
    val = clean(val).slice(0, 40);
    if (!name || !val || /^(-+|choisi|select|s[ée]lectionn|choose|w[äa]hle|eleg)/i.test(val)) return;
    const list = (domOptions[name] ||= []);
    if (!list.includes(val) && list.length < 30) list.push(val);
  };
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attr('<x ' + m[1] + '>', 'aria-label') || attr('<x ' + m[1] + '>', 'data-option-name') || attr('<x ' + m[1] + '>', 'name') || attr('<x ' + m[1] + '>', 'id');
    if (!OPT.test(name)) continue;
    for (const o of m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) if (attr('<x ' + o[1] + '>', 'value') !== '') addOpt(name, o[2]);
  }
  for (const tag of html.match(/<input\b[^>]*type\s*=\s*["']?radio[^>]*>/gi) || []) {
    const name = attr(tag, 'data-option-name') || attr(tag, 'name');
    if (OPT.test(name)) addOpt(name, attr(tag, 'value') || attr(tag, 'aria-label'));
  }

  // Images : on réunit toutes les sources (données structurées, galerie zoom, liens, scripts),
  // on retire les doublons de tailles différentes et on garde la version la plus grande.
  const images = [], seen = new Map();
  const JUNK = /sprite|pixel|tracking|1x1|spacer|placeholder|loader|spinner|logo|icon|favicon|payment|paypal|visa|mastercard|klarna|badge|flag|avatar|emoji|star|rating|trustpilot|gravatar/i;
  const SIZE = /([_-])(\d{2,4}x\d{0,4}|x\d{2,4}|pico|icon|thumb|thumbnail|small|compact|medium|large|grande|master)(?=(?:@\dx)?\.[a-z]{3,4}$)/i;
  const add = (u, big = false) => {
    let h = abs(String(u || '').trim().replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&'));
    if (!h || !/^https?:/.test(h) || !/\.(jpe?g|png|webp|avif)(\?|$)/i.test(h) && !big) return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(h) || JUNK.test(h.split('?')[0].split('/').slice(-2).join('/'))) return;
    let url;
    try { url = new URL(h); } catch { return; }
    // version pleine taille : suffixe de taille retiré (Shopify, WooCommerce), largeur demandée relevée
    url.pathname = url.pathname.replace(SIZE, '');
    for (const k of ['width', 'w', 'wid']) if (url.searchParams.has(k)) url.searchParams.set(k, '1200');
    for (const k of ['height', 'h', 'hei', 'crop']) url.searchParams.delete(k);
    const key = (url.hostname + url.pathname).toLowerCase();
    if (seen.has(key)) return;
    seen.set(key, 1);
    images.push(url.href);
  };
  ldImages.forEach((u) => add(u, true));
  if (metas['og:image']) add(metas['og:image'], true);
  if (metas['twitter:image']) add(metas['twitter:image'], true);
  const largest = (srcset) => srcset.split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0))[0]?.[0];
  // galerie : attributs « zoom » d'abord (ce sont les grandes images), puis les sources ordinaires
  const tags = html.match(/<(img|a|source|div|li|button)\b[^>]*>/gi) || [];
  for (const tag of tags) for (const k of ['data-zoom-image', 'data-large_image', 'data-zoom', 'data-full', 'data-original', 'data-image', 'data-src-zoom', 'data-large', 'data-big']) { const v = attr(tag, k); if (v && !/^\{|^\[/.test(v)) add(v); }
  for (const tag of tags) {
    if (/^<a\b/i.test(tag)) { const h = attr(tag, 'href'); if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(h)) add(h); continue; }
    if (!/^<(img|source)\b/i.test(tag)) continue;
    const w = parseInt(attr(tag, 'width'), 10);
    if (w && w < 120) continue;
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (srcset) add(largest(srcset));
    add(attr(tag, 'data-src') || attr(tag, 'src'));
  }
  // scripts (boutiques rendues en JavaScript) : images du même dossier que celles déjà reconnues comme produit
  const known = new Set(images.slice(0, 6).map((u) => { const x = new URL(u); return x.hostname + x.pathname.split('/').slice(0, -1).join('/'); }));
  for (const m of html.matchAll(/(?:https?:)?(?:\\?\/){2}[^"'\s<>\\)]+?(?:\\?\/[^"'\s<>\\)]+?)*\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>\\)]*)?/gi)) {
    if (images.length >= 40) break;
    try {
      const x = new URL(abs(m[0].replace(/\\u002F/gi, '/').replace(/\\\//g, '/')));
      const dir = x.hostname + x.pathname.split('/').slice(0, -1).join('/');
      if (known.has(dir) || /\/(products?|catalog|media\/catalog)\//i.test(x.pathname)) add(x.href);
    } catch { /* URL invalide */ }
  }
  images.splice(24);

  // logo : données structurées, puis image « logo » de la page, puis icône
  const logos = [];
  const addLogo = (u) => { const h = abs(u); if (h && /^https?:/.test(h) && !logos.includes(h)) logos.push(h); };
  if (org) urls(org.logo).forEach(addLogo);
  for (const tag of body.match(/<img\b[^>]*>/gi) || []) {
    if (/logo/i.test(attr(tag, 'class') + ' ' + attr(tag, 'alt') + ' ' + attr(tag, 'id') + ' ' + attr(tag, 'src'))) { addLogo(attr(tag, 'src') || attr(tag, 'data-src')); break; }
  }
  if (icon?.href) addLogo(icon.href);
  addLogo('/favicon.ico');

  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ');
  const low = (html.slice(0, 600000) + ' ').toLowerCase();
  const count = (re) => (low.match(re) || []).length;
  const ecom =
    3 * count(/add[ -_]?to[ -_]?cart|ajouter au panier|add to bag|buy now|acheter maintenant|in den warenkorb|añadir al carrito/g) +
    4 * count(/cdn\.shopify\.com|woocommerce|prestashop|magento|bigcommerce|product:price|og:price/g) +
    count(/free shipping|livraison|checkout|panier|\bcart\b|in stock|en stock|size guide|collection/g) +
    (/"@type"\s*:\s*"(Product|Offer|Store)"/i.test(ld) ? 8 : 0) + (metas['og:type'] === 'product' ? 8 : 0);
  const saas =
    3 * count(/free trial|essai gratuit|book a demo|request a demo|demander une d[ée]mo|start for free|get started|commencer gratuitement|sign up free/g) +
    2 * count(/\bpricing\b|\btarifs\b|per month|\/mo\b|par mois|\bapi\b|dashboard|integrations?|workflow|\bsaas\b|platform|plateforme|software|logiciel/g) +
    count(/log ?in|sign ?in|se connecter|docs|changelog|automation|analytics/g) +
    (/"@type"\s*:\s*"(SoftwareApplication|WebApplication)"/i.test(ld) ? 8 : 0);
  const prices = [...new Set((text.match(/(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR|USD|\$|£|MAD|DH))/g) || []).slice(0, 6))];

  if (product) {
    // options : déduites des variantes, sinon des listes et pastilles de la page
    const opts = {};
    for (const v of product.variants) for (const [k, val] of Object.entries(v.options)) { const l = (opts[k] ||= []); if (!l.includes(val)) l.push(val); }
    const src = Object.keys(opts).length ? opts : domOptions;
    product.options = Object.entries(src).slice(0, 4).map(([name, values]) => ({ name, values: values.slice(0, 30) }));
    product.variants = product.variants.slice(0, 80);
    if (!product.price) product.price = product.variants.find((v) => v.price)?.price || '';
    if (!product.currency) product.currency = /^[A-Z]{3}$/.test(metas['product:price:currency'] || metas['og:price:currency'] || '') ? metas['product:price:currency'] || metas['og:price:currency'] : (ld.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/) || [])[1] || '';
  } else if (Object.keys(domOptions).length) {
    product = { name: '', description: '', brand: '', price: '', currency: '', variants: [], options: Object.entries(domOptions).slice(0, 4).map(([name, values]) => ({ name, values })) };
  }

  const title = clean(metas['og:title'] || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const host = new URL(base).hostname.replace(/^www\./, '');
  return {
    url: base, host,
    siteName: clean(metas['og:site_name'] || '') || host.split('.')[0].replace(/^./, (c) => c.toUpperCase()),
    title, description: clean(metas['og:description'] || metas.description || metas['twitter:description'] || ''),
    lang: ((html.match(/<html[^>]*\blang\s*=\s*["']?([a-z]{2})/i) || [])[1] || 'en').toLowerCase(),
    themeColor: /^#[0-9a-f]{3,8}$/i.test(metas['theme-color'] || '') ? metas['theme-color'] : '',
    icon: icon?.href ? abs(icon.href) : abs('/favicon.ico'),
    h1: heads(1).slice(0, 3), h2: heads(2).slice(0, 8),
    images, logos: logos.slice(0, 4), product, prices, text,
    guess: { type: ecom > saas ? 'ecom' : 'saas', ecom, saas, confidence: Math.round((Math.max(ecom, saas) + 1) / (ecom + saas + 2) * 100) },
  };
}

// Shopify publie toute la fiche (photos, options, variantes, prix) à l'adresse du produit + « .js ».
async function shopify(page, html) {
  const m = /^(https?:\/\/[^/]+(?:\/[^/?#]+)*?\/products\/[^/?#.]+)/i.exec(page.url);
  if (!m || !/cdn\.shopify\.com|Shopify\.(theme|shop|currency)|shopify-section/i.test(html)) return;
  try {
    const r = await safeFetch(m[1] + '.js', { headers: { accept: 'application/json' } }, 8000);
    if (!r.ok) return;
    const { buf } = await readCapped(r, 1.5e6);
    const p = JSON.parse(buf.toString('utf8'));
    if (!p || !Array.isArray(p.variants)) return;
    const money = (c) => (typeof c === 'number' ? (c / 100).toFixed(2) : '');
    const full = (u) => { try { return new URL(String(u).replace(/^\/\//, 'https://'), page.url).href; } catch { return ''; } };
    const names = (p.options || []).map((o) => (typeof o === 'string' ? o : o.name)).filter(Boolean);
    const currency = (html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/) || [])[1] || page.product?.currency || '';
    const variants = p.variants.slice(0, 80).map((v) => ({
      options: Object.fromEntries(names.map((n, i) => [n, String((v.options || [])[i] ?? v['option' + (i + 1)] ?? '')]).filter(([, val]) => val && val !== 'Default Title')),
      price: money(v.price), image: v.featured_image?.src ? full(v.featured_image.src) : '', available: v.available !== false,
    })).filter((v) => Object.keys(v.options).length);
    const opts = {};
    for (const v of variants) for (const [k, val] of Object.entries(v.options)) { const l = (opts[k] ||= []); if (!l.includes(val)) l.push(val); }
    page.product = {
      name: String(p.title || page.product?.name || '').slice(0, 160),
      description: String(p.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) || page.product?.description || '',
      brand: String(p.vendor || page.product?.brand || '').slice(0, 60),
      price: money(p.price) || page.product?.price || '', currency,
      options: Object.entries(opts).slice(0, 4).map(([name, values]) => ({ name, values: values.slice(0, 30) })), variants,
    };
    // les photos de la fiche passent devant, sans doublon
    const key = (u) => { try { const x = new URL(u); return (x.hostname + x.pathname).toLowerCase(); } catch { return u; } };
    const mine = [...(p.images || []), ...(p.media || []).filter((x) => x.media_type === 'image').map((x) => x.src)].map(full).filter(Boolean);
    const seen = new Set();
    page.images = [...mine, ...page.images].filter((u) => { const k = key(u); return !seen.has(k) && seen.add(k); }).slice(0, 24);
    page.source = 'shopify';
  } catch { /* fiche JSON indisponible : on garde ce que la page a donné */ }
}

module.exports = handler('POST', async (req, res) => {
  let { url } = await readJson(req);
  url = String(url || '').trim();
  if (!url) throw httpError(400, 'URL manquante');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let r;
  try {
    r = await safeFetch(url, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr,en;q=0.8' } });
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'Impossible de joindre ce site');
  }
  if (!r.ok) throw httpError(502, `Le site a répondu ${r.status}`);
  if (!/html|text\/plain/i.test(r.headers.get('content-type') || 'text/html')) throw httpError(415, "Cette URL n'est pas une page web");
  const { buf } = await readCapped(r, 4e6);
  const html = buf.toString('utf8');
  const page = extract(html, r.url || url);
  await shopify(page, html);
  if (!page.title && !page.description && page.text.length < 40) throw httpError(422, 'Page vide ou protégée : impossible de l’analyser');
  send(res, 200, page);
});
module.exports.extract = extract;
