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
  const prod = nodes.find((n) => isType(n, 'product'));
  const org = nodes.find((n) => n.logo && (isType(n, 'organization') || isType(n, 'brand') || isType(n, 'website') || isType(n, 'onlinestore')));
  let product = null;
  if (prod) {
    const offer = [].concat(prod.offers || [])[0] || {};
    const price = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
    product = {
      name: clean(String(prod.name || '')).slice(0, 160),
      description: clean(String(prod.description || '')).slice(0, 600),
      brand: clean(String((prod.brand && (prod.brand.name || prod.brand)) || '')).slice(0, 60),
      price: price != null && /^[\d.,\s]+$/.test(String(price)) ? String(price).trim() : '',
      currency: /^[A-Z]{3}$/.test(offer.priceCurrency || '') ? offer.priceCurrency : '',
    };
  } else if (metas['product:price:amount'] || metas['og:price:amount']) {
    product = { name: '', description: '', brand: '', price: metas['product:price:amount'] || metas['og:price:amount'], currency: metas['product:price:currency'] || metas['og:price:currency'] || '' };
  }

  const images = [];
  const add = (u) => {
    const h = abs(u);
    if (h && /^https?:/.test(h) && !/\.(svg|gif|ico)(\?|$)/i.test(h) && !/sprite|pixel|tracking|1x1|spacer/i.test(h) && !images.includes(h)) images.push(h);
  };
  if (prod) urls(prod.image).slice(0, 6).forEach(add);
  if (metas['og:image']) add(metas['og:image']);
  if (metas['twitter:image']) add(metas['twitter:image']);
  for (const tag of body.match(/<img\b[^>]*>/gi) || []) {
    const w = parseInt(attr(tag, 'width'), 10);
    if (w && w < 120) continue;
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    add(attr(tag, 'src') || attr(tag, 'data-src') || (srcset && srcset.split(',').pop().trim().split(/\s+/)[0]));
    if (images.length >= 8) break;
  }

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
  const { buf } = await readCapped(r, 2e6);
  const page = extract(buf.toString('utf8'), r.url || url);
  if (!page.title && !page.description && page.text.length < 40) throw httpError(422, 'Page vide ou protégée : impossible de l’analyser');
  send(res, 200, page);
});
module.exports.extract = extract;
