// Offres affichées sur la page d'accueil. Les prix et les liens de paiement se règlent sans toucher au code :
// PLANS_JSON (liste complète) ; paiement par STRIPE_SECRET_KEY + STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS (voir api/checkout.js),
// ou à défaut CHECKOUT_PRO / CHECKOUT_BUSINESS (liens de paiement directs).
const { send, handler } = require('../lib/util');
const { ready } = require('./checkout');

const DEFAULT = [
  { id: 'free', name: 'Starter', price: '$0', period: '', tag: 'Available', features: ['Video ads from any link', '9:16, 1:1 and 16:9 formats', 'Voice-over, captions and 30 music tracks', '720p export with a watermark'] },
  { id: 'pro', name: 'Pro', price: '$19', period: '/month', tag: 'Soon', featured: true, features: ['Everything in Starter', '1080p export, no watermark', 'Custom AI-generated scenes behind your product', 'History of your videos'] },
  { id: 'business', name: 'Business', price: '$49', period: '/month', tag: 'Soon', features: ['Everything in Pro', 'Multiple brands', 'Bulk generation from a catalogue', 'Priority support'] },
];
const link = (v) => (/^https:\/\/[^\s"'<>]+$/.test(v || '') ? v : '');

module.exports = handler('GET', async (req, res) => {
  let plans = DEFAULT;
  try { const custom = JSON.parse(process.env.PLANS_JSON || 'null'); if (Array.isArray(custom) && custom.length) plans = custom.slice(0, 4); } catch { /* PLANS_JSON invalide : offres par défaut */ }
  const checkout = { pro: link(process.env.CHECKOUT_PRO), business: link(process.env.CHECKOUT_BUSINESS) };
  // « api » : paiement par Stripe Checkout ; sinon un lien de paiement direct ; sinon rien (bouton « Coming soon »)
  send(res, 200, { plans: plans.map((p) => ({ ...p, tag: p.id !== 'free' && (ready(p.id) || checkout[p.id]) && p.tag === 'Soon' ? '' : p.tag, checkout: ready(p.id) ? 'api' : checkout[p.id] || link(p.checkout) })) }, { 'cache-control': 'public, max-age=300' });
});
