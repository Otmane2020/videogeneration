// Offres affichées sur la page d'accueil. Les prix et les liens de paiement se règlent sans toucher au code :
// PLANS_JSON (liste complète) ou CHECKOUT_PRO / CHECKOUT_BUSINESS (liens de paiement, par ex. Stripe Payment Links).
const { send, handler } = require('../lib/util');

const DEFAULT = [
  { id: 'free', name: 'Découverte', price: '0 €', period: '', tag: 'Disponible', features: ['3 pubs par lien analysé', 'Formats 9:16, 1:1 et 16:9', 'Voix off, sous-titres et 30 musiques', 'Export MP4 jusqu’en 1080p'] },
  { id: 'pro', name: 'Pro', price: '19 €', period: '/mois', tag: 'Bientôt', featured: true, features: ['Tout Découverte', 'Décors sur mesure générés par IA', 'Historique de vos pubs', 'Kit de marque enregistré'] },
  { id: 'business', name: 'Business', price: '49 €', period: '/mois', tag: 'Bientôt', features: ['Tout Pro', 'Plusieurs marques', 'Génération en lot depuis un catalogue', 'Support prioritaire'] },
];
const link = (v) => (/^https:\/\/[^\s"'<>]+$/.test(v || '') ? v : '');

module.exports = handler('GET', async (req, res) => {
  let plans = DEFAULT;
  try { const custom = JSON.parse(process.env.PLANS_JSON || 'null'); if (Array.isArray(custom) && custom.length) plans = custom.slice(0, 4); } catch { /* PLANS_JSON invalide : offres par défaut */ }
  const checkout = { pro: link(process.env.CHECKOUT_PRO), business: link(process.env.CHECKOUT_BUSINESS) };
  send(res, 200, { plans: plans.map((p) => ({ ...p, checkout: checkout[p.id] || link(p.checkout) })) }, { 'cache-control': 'public, max-age=300' });
});
