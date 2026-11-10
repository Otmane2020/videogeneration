// Offres affichées sur la page d'accueil. Les prix et les liens de paiement se règlent sans toucher au code :
// PLANS_JSON (liste complète) ou CHECKOUT_PRO / CHECKOUT_BUSINESS (liens de paiement, par ex. Stripe Payment Links).
const { send, handler } = require('../lib/util');

const DEFAULT = [
  { id: 'free', name: 'Starter', price: '$0', period: '', tag: 'Available', features: ['3 ads per link', '9:16, 1:1 and 16:9 formats', 'Voice-over, captions and 30 music tracks', 'MP4 export up to 1080p'] },
  { id: 'pro', name: 'Pro', price: '$19', period: '/month', tag: 'Soon', featured: true, features: ['Everything in Starter', 'Custom AI-generated backdrops', 'History of your ads', 'Saved brand kit'] },
  { id: 'business', name: 'Business', price: '$49', period: '/month', tag: 'Soon', features: ['Everything in Pro', 'Multiple brands', 'Bulk generation from a catalogue', 'Priority support'] },
];
const link = (v) => (/^https:\/\/[^\s"'<>]+$/.test(v || '') ? v : '');

module.exports = handler('GET', async (req, res) => {
  let plans = DEFAULT;
  try { const custom = JSON.parse(process.env.PLANS_JSON || 'null'); if (Array.isArray(custom) && custom.length) plans = custom.slice(0, 4); } catch { /* PLANS_JSON invalide : offres par défaut */ }
  const checkout = { pro: link(process.env.CHECKOUT_PRO), business: link(process.env.CHECKOUT_BUSINESS) };
  send(res, 200, { plans: plans.map((p) => ({ ...p, checkout: checkout[p.id] || link(p.checkout) })) }, { 'cache-control': 'public, max-age=300' });
});
