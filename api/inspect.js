// Étape 1 : récupère la page et en extrait le contenu utile + une première estimation SaaS / E-com.
const { send, readJson, httpError, safeFetch, readCapped, handler } = require('../lib/util');

const NAMED = { eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', szlig: 'ß', ntilde: 'ñ', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', euro: '€', pound: '£', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', deg: '°', reg: '®', copy: '©', trade: '™', times: '×', middot: '·', bull: '•' };
const decode = (s = '') => s
  .replace(/&amp;(?=#?\w+;)/g, '&')
  .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m)
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

  // Images. Sur une fiche produit, on ne garde QUE les photos de ce produit :
  //  - sources sûres : données structurées, variantes, image de partage, galerie zoom ;
  //  - autres images de la page : seulement si leur nom de fichier porte la référence du produit.
  // Les produits recommandés, bannières et menus sont donc écartés.
  const JUNK = /sprite|pixel|tracking|1x1|spacer|placeholder|loader|spinner|logo|icon|favicon|payment|paypal|visa|mastercard|klarna|badge|flag|avatar|emoji|star|rating|trustpilot|gravatar|megamenu|banner|navmob|pushcontent/i;
  const SIZE = /([_-])(\d{2,4}x\d{0,4}|x\d{2,4}|pico|icon|thumb|thumbnail|small|compact|medium|large|grande)(?=(?:@\dx)?\.[a-z]{3,4}$)/i;
  const cands = [], seen = new Set();
  const stemOf = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').toLowerCase(); } catch { return ''; } };
  const add = (u, trusted = false) => {
    const h = abs(decode(String(u || '').trim()).replace(/\\u002F/gi, '/').replace(/\\\//g, '/'));
    if (!h || !/^https?:/.test(h) || (!trusted && !/\.(jpe?g|png|webp|avif)(\?|$)/i.test(h))) return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(h) || JUNK.test(h.split('?')[0].split('/').slice(-3).join('/'))) return;
    let url;
    try { url = new URL(h); } catch { return; }
    // version pleine taille : suffixe de taille retiré (Shopify, WooCommerce), largeur demandée relevée
    url.pathname = url.pathname.replace(SIZE, '');
    for (const k of ['width', 'w', 'wid', 'sw']) if (url.searchParams.has(k)) url.searchParams.set(k, '1200');
    for (const k of ['height', 'h', 'hei', 'sh', 'crop']) url.searchParams.delete(k);
    const key = (url.hostname + url.pathname).toLowerCase();
    if (seen.has(key)) { if (trusted) { const c = cands.find((x) => x.key === key); if (c) c.trusted = true; } return; }
    seen.add(key);
    cands.push({ url: url.href, key, trusted, stem: stemOf(url.href) });
  };
  const isProduct = !!(prod || woo || metas['product:price:amount'] || metas['og:price:amount'] || metas['og:type'] === 'product');
  ldImages.forEach((u) => add(u, true));
  if (metas['og:image']) add(metas['og:image'], true);
  if (metas['twitter:image']) add(metas['twitter:image'], isProduct);
  const largest = (srcset) => srcset.split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0))[0]?.[0];
  const tags = html.match(/<(img|a|source|div|li|button)\b[^>]*>/gi) || [];
  // galerie zoom et galerie WooCommerce : ce sont les grandes photos du produit
  for (const tag of tags) for (const k of ['data-zoom-image', 'data-large_image', 'data-zoom', 'data-src-zoom']) { const v = attr(tag, k); if (v && !/^\{|^\[/.test(v)) add(v, true); }
  for (const m of html.matchAll(/woocommerce-product-gallery__image[^>]*>\s*<a[^>]+href\s*=\s*["']([^"']+)["']/gi)) add(m[1], true);
  for (const tag of tags) {
    for (const k of ['data-full', 'data-original', 'data-image', 'data-large', 'data-big']) { const v = attr(tag, k); if (v && !/^\{|^\[/.test(v)) add(v); }
    if (/^<a\b/i.test(tag)) { const h = attr(tag, 'href'); if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(h)) add(h); continue; }
    if (!/^<(img|source)\b/i.test(tag)) continue;
    const w = parseInt(attr(tag, 'width'), 10);
    if (w && w < 120) continue;
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (srcset) add(largest(srcset));
    add(attr(tag, 'data-src') || attr(tag, 'src'));
  }
  // scripts (boutiques rendues en JavaScript). Parcours linéaire : on repère chaque extension d'image
  // puis on remonte jusqu'au début de l'adresse (une expression régulière unique pouvait se bloquer sur de gros scripts).
  const STOP = /["'\s<>()]/;
  for (const m of html.matchAll(/\.(?:jpe?g|png|webp|avif)(?=["'\s<>()?\\]|&quot;)/gi)) {
    if (cands.length >= 300) break;
    let a = m.index;
    while (a > 0 && m.index - a < 600 && !STOP.test(html[a - 1])) a--;
    let b = m.index + m[0].length;
    if (html[b] === '?') while (b < html.length && b - m.index < 300 && !STOP.test(html[b]) && html[b] !== '\\') b++;
    const raw = html.slice(a, b).replace(/^.*?((?:https?:)?(?:\\?\/){2})/, '$1');
    if (/^(?:https?:)?(?:\\?\/){2}/.test(raw)) add(raw);
  }

  let images;
  if (isProduct) {
    // références du produit : SKU et identifiants de l'adresse, plus le radical des noms de fichiers sûrs
    const keys = new Set();
    const addKey = (k) => { k = String(k || '').toLowerCase().trim(); if (k.length >= 5 && !/^(image|images|product|produit|photo|default|master|picture)s?$/.test(k)) keys.add(k); };
    for (const id of [prod?.sku, prod?.mpn, prod?.productID, prod?.gtin13, prod?.gtin, ...(new URL(base).pathname.match(/[a-z0-9]*\d{5,}[a-z0-9]*/gi) || [])]) {
      if (!id) continue;
      addKey(id);
      (String(id).match(/\d{7,}/g) || []).forEach(addKey);
    }
    for (const c of cands.filter((x) => x.trusted)) {
      const first = c.stem.split(/[-_ .]/)[0];
      if (/\d/.test(first)) addKey(first);
      addKey(c.stem.replace(/([-_ .](\d{1,2}|[a-z]|master|main|front|back|side|view\d*|model\d*|zoom|hd|ho|\d+x\d*))+$/g, ''));
    }
    const mine = (c) => c.trusted || [...keys].some((k) => c.stem.includes(k));
    // même photo servie par deux chemins : un seul exemplaire
    const names = new Set();
    images = cands.filter(mine).filter((c) => !names.has(c.stem) && names.add(c.stem)).map((c) => c.url).slice(0, 24);
  } else {
    images = cands.map((c) => c.url).slice(0, 8);
  }

  // Logo. Du plus fiable au moins fiable : données structurées, balises dédiées, image ou SVG du lien d'accueil
  // dans l'en-tête, image nommée « logo », puis seulement les icônes (favicon), marquées comme telles.
  const logos = [];
  const addLogo = (u, kind = 'logo') => {
    const h = /^data:image\/svg\+xml/.test(u) ? u : abs(decode(String(u || '').trim()));
    if (/alma|paypal|visa|mastercard|klarna|payment|paiement|trustpilot|partner|avis-verifies|google-play|app-store/i.test(h.startsWith('data:') ? '' : h.split('/').pop())) return;
    if (h && (/^https?:/.test(h) || h.startsWith('data:')) && !logos.some((l) => l.url === h)) logos.push({ url: h, kind });
  };
  if (org) urls(org.logo).forEach((u) => addLogo(u));
  for (const n of nodes) if (n.publisher?.logo) urls(n.publisher.logo).forEach((u) => addLogo(u));
  if (metas['og:logo']) addLogo(metas['og:logo']);
  for (const tag of html.match(/<(meta|link|img)\b[^>]*itemprop\s*=\s*["']?logo[^>]*>/gi) || []) addLogo(attr(tag, 'content') || attr(tag, 'href') || attr(tag, 'src'));
  const hostName = new URL(base).hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
  const head = (html.match(/<(header|nav)\b[\s\S]*?<\/\1>/i) || [html.slice(0, 60000)])[0].slice(0, 60000);
  // lien vers l'accueil dans l'en-tête : son image, ou son SVG en ligne, est le logo
  for (const m of head.matchAll(/<a\b([^>]*)>([\s\S]{0,8000}?)<\/a>/gi)) {
    const href = attr('<a ' + m[1] + '>', 'href');
    let home = false;
    try { const x = new URL(href || '#', base); home = x.hostname === new URL(base).hostname && /^\/([a-z]{2}([-_][a-zA-Z]{2})?\/?)?$/.test(x.pathname) && !!href && !href.startsWith('#'); } catch { /* lien invalide */ }
    if (!home && !/logo|brand/i.test(m[1])) continue;
    const img = m[2].match(/<img\b[^>]*>/i);
    if (img) { const srcset = attr(img[0], 'srcset'); addLogo(attr(img[0], 'src') || attr(img[0], 'data-src') || (srcset && srcset.split(',')[0].trim().split(/\s+/)[0])); }
    const svg = m[2].match(/<svg\b[\s\S]*?<\/svg>/i);
    if (!img && svg && svg[0].length < 24000 && !/<use\b|<image\b|<script|<foreignObject/i.test(svg[0])) {
      let code = svg[0].replace(/\s+/g, ' ');
      if (!/xmlns=/.test(code)) code = code.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      if (/currentColor/i.test(code)) code = code.replace('<svg', '<svg color="#111111"');
      addLogo('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(code));
    }
    if (logos.length >= 3) break;
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const sig = attr(tag, 'class') + ' ' + attr(tag, 'alt') + ' ' + attr(tag, 'id') + ' ' + attr(tag, 'src');
    if (/logo|brand/i.test(sig) || attr(tag, 'alt').toLowerCase().replace(/[^a-z0-9]/g, '') === hostName.replace(/[^a-z0-9]/g, '')) { addLogo(attr(tag, 'src') || attr(tag, 'data-src')); if (logos.length >= 4) break; }
  }
  // icônes : la plus grande d'abord
  const icons = links.filter((l) => /icon/.test(l.rel) && l.href).map((l) => ({ ...l, size: l.rel.includes('apple-touch-icon') ? 180 : 0 }));
  for (const tag of html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi) || []) { const sz = parseInt(attr(tag, 'sizes'), 10); const l = icons.find((x) => x.href === attr(tag, 'href')); if (l && sz) l.size = Math.max(l.size, sz); }
  icons.sort((a, b) => b.size - a.size).slice(0, 2).forEach((l) => addLogo(l.href, 'icon'));
  addLogo('/favicon.ico', 'icon');

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
    images, logos: logos.slice(0, 6), product, prices, text,
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
    page.images = (mine.length ? mine : page.images).filter((u) => { const k = key(u); return !seen.has(k) && seen.add(k); }).slice(0, 24);
    page.source = 'shopify';
  } catch { /* fiche JSON indisponible : on garde ce que la page a donné */ }
}

// Requête telle qu'un navigateur l'envoie : beaucoup de boutiques refusent (403) les requêtes sans ces en-têtes.
const CHROME = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache', pragma: 'no-cache', 'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1',
};
const SAFARI = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'fr-FR,fr;q=0.9',
};
const REFUSED = [401, 403, 406, 429, 451, 503];

async function fetchPage(url) {
  let last = null;
  for (const headers of [CHROME, SAFARI]) {
    const t = Date.now();
    last = await safeFetch(url, { headers }, 9000);
    console.log(`inspect ${new URL(url).hostname} -> ${last.status} in ${Date.now() - t} ms (${last.headers.get('content-length') || '?'} bytes, ${last.headers.get('content-type') || '?'})`);
    if (last.ok || !REFUSED.includes(last.status)) return last;
    last.body?.cancel().catch(() => {}); // sans attendre : un anti-robot peut retenir la réponse indéfiniment
    await new Promise((ok) => setTimeout(ok, 700));
  }
  return last;
}

// Le site refuse la lecture automatique : on ne force pas le passage. On repart de l'adresse elle-même
// (le nom du produit y figure souvent) ; l'étape suivante lit une capture d'écran de la page, et l'utilisateur ajoute ses photos.
function blockedPage(url, status) {
  const u = new URL(url), host = u.hostname.replace(/^www\./, '');
  const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').replace(/\b[\dA-Z]*\d{5,}[\dA-Z]*\b/g, '').replace(/\s+/g, ' ').trim();
  const title = slug.length > 3 ? slug.replace(/^./, (c) => c.toUpperCase()) : '';
  const productLike = /\.html?$|\/(products?|produits?|p|item|dp|article)\//i.test(u.pathname) || slug.split(' ').length >= 3;
  return {
    url: u.href, host, siteName: host.split('.')[0].replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    title, description: '', lang: (u.pathname.match(/^\/([a-z]{2})(?:[-_][a-zA-Z]{2})?\//) || [])[1] || (/\.fr$/.test(host) ? 'fr' : 'en'),
    themeColor: '', icon: u.origin + '/favicon.ico', h1: title ? [title] : [], h2: [],
    images: [], logos: [{ url: u.origin + '/apple-touch-icon.png', kind: 'icon' }, { url: u.origin + '/favicon.ico', kind: 'icon' }], product: null, prices: [], text: '',
    blocked: status, guess: { type: productLike ? 'ecom' : 'saas', ecom: productLike ? 1 : 0, saas: productLike ? 0 : 1, confidence: 50 },
  };
}

module.exports = handler('POST', async (req, res) => {
  let { url } = await readJson(req);
  url = String(url || '').trim();
  if (!url) throw httpError(400, 'Missing URL');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let r;
  try {
    // limite stricte : au-delà, on traite le site comme protégé plutôt que de laisser l'utilisateur attendre
    r = await Promise.race([fetchPage(url), new Promise((ok) => setTimeout(() => ok(null), 14000))]);
    if (!r) return send(res, 200, blockedPage(url, 'no answer'));
  } catch (e) {
    if (e.status) throw e;
    if (e.name === 'TimeoutError') return send(res, 200, blockedPage(url, 'no answer'));
    throw httpError(502, 'Could not reach this site');
  }
  if (REFUSED.includes(r.status)) return send(res, 200, blockedPage(r.url || url, r.status));
  if (!r.ok) throw httpError(502, `The site answered ${r.status}`);
  if (!/html|text\/plain/i.test(r.headers.get('content-type') || 'text/html')) throw httpError(415, 'This address is not a web page');
  // lecture du corps bornée dans le temps : certains anti-robots laissent la connexion ouverte sans rien envoyer
  const body = await Promise.race([readCapped(r, 4e6), new Promise((ok) => setTimeout(() => ok(null), 12000))]);
  if (!body) { r.body?.cancel().catch(() => {}); return send(res, 200, blockedPage(r.url || url, 'no answer')); }
  const { buf } = body;
  const html = buf.toString('utf8');
  const t1 = Date.now();
  const page = extract(html, r.url || url);
  console.log(`inspect parsed ${html.length} chars in ${Date.now() - t1} ms, ${page.images.length} images`);
  await shopify(page, html);
  if (!page.title && !page.description && page.text.length < 40) throw httpError(422, 'Empty or protected page: nothing to analyse. You can still add photos by hand.');
  send(res, 200, page);
});
module.exports.extract = extract;
