// Paiement : ouvre une session Stripe Checkout pour l'offre choisie.
// À configurer : STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS (identifiants de prix Stripe, « price_... »).
const { send, readJson, httpError, handler } = require('../lib/util');

const PRICES = () => ({ pro: process.env.STRIPE_PRICE_PRO, business: process.env.STRIPE_PRICE_BUSINESS });

module.exports = handler('POST', async (req, res) => {
  const { plan } = await readJson(req);
  const key = process.env.STRIPE_SECRET_KEY, price = PRICES()[plan];
  if (!key || !/^price_\w+$/.test(price || '')) throw httpError(503, 'Payments are not available yet');
  const host = String(req.headers.host || '');
  if (!/^[\w.-]+(:\d+)?$/.test(host)) throw httpError(400, 'Invalid host');
  const origin = (/^(localhost|127\.)/.test(host) ? 'http://' : 'https://') + host;
  const body = new URLSearchParams({
    mode: process.env.STRIPE_MODE === 'payment' ? 'payment' : 'subscription',
    'line_items[0][price]': price, 'line_items[0][quantity]': '1',
    success_url: `${origin}/?checkout=success`, cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: 'true', 'metadata[plan]': plan,
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) { console.error('stripe', r.status, j.error?.message); throw httpError(502, 'Could not start the payment. Please try again.'); }
  send(res, 200, { url: j.url });
});
module.exports.ready = (plan) => !!process.env.STRIPE_SECRET_KEY && /^price_\w+$/.test(PRICES()[plan] || '');
