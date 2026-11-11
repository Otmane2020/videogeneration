// Offres affichées sur la page d'accueil. Les prix et les liens de paiement se règlent sans toucher au code :
// PLANS_JSON (liste complète) ; paiement par STRIPE_SECRET_KEY + STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS (voir api/checkout.js),
// ou à défaut CHECKOUT_PRO / CHECKOUT_BUSINESS (liens de paiement directs).
const { send, handler } = require('../lib/util');
const { ready } = require('./checkout');

const { LIMITS } = require('../lib/quota');
// Tarifs par défaut, placés sous les générateurs de pubs vidéo concurrents (entrée de gamme autour de 20 à 40 $ par mois).
const DEFAULT = () => { const q = LIMITS(); return [
  { id: 'free', name: 'Starter', price: '$0', period: '', tag: 'Free', features: [`${q.free} videos per month`, '720p export with a watermark', 'Voice-over, captions and 30 music tracks', 'Remove the watermark on one video for $0.99'] },
  { id: 'pro', name: 'Pro', price: '$19', period: '/month', tag: 'Popular', featured: true, features: [`${q.pro} videos per month`, '1080p export, no watermark', 'Custom AI scenes behind your product', 'History of your videos'] },
  { id: 'business', name: 'Business', price: '$49', period: '/month', tag: '', features: [`${q.business} videos per month`, 'Everything in Pro', 'Best value per video for teams and agencies'] },
]; };
const link = (v) => (/^https:\/\/[^\s"'<>]+$/.test(v || '') ? v : '');

module.exports = handler('GET', async (req, res) => {
  let plans = DEFAULT();
  try { const custom = JSON.parse(process.env.PLANS_JSON || 'null'); if (Array.isArray(custom) && custom.length) plans = custom.slice(0, 4); } catch { /* PLANS_JSON invalide : offres par défaut */ }
  const checkout = { pro: link(process.env.CHECKOUT_PRO), business: link(process.env.CHECKOUT_BUSINESS) };
  // « api » : paiement par Stripe Checkout ; sinon un lien de paiement direct ; sinon rien (bouton « Coming soon »)
  let reviews = [];
  try { const r = JSON.parse(process.env.TESTIMONIALS_JSON || '[]'); if (Array.isArray(r)) reviews = r.slice(0, 9).map((x) => ({ name: String(x.name || '').slice(0, 60), role: String(x.role || '').slice(0, 80), quote: String(x.quote || '').slice(0, 400), photo: link(x.photo), stars: Math.min(5, Math.max(1, +x.stars || 5)) })).filter((x) => x.name && x.quote); } catch { /* JSON invalide */ }
  send(res, 200, { reviews, plans: plans.map((p) => ({ ...p, checkout: ready(p.id) ? 'api' : checkout[p.id] || link(p.checkout) })) }, { 'cache-control': 'public, max-age=300' });
});
