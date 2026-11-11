// Paiement : ouvre une session Stripe Checkout pour l'offre choisie.
// À configurer : STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS (identifiants de prix Stripe, « price_... »).
const { send, readJson, httpError, handler } = require('../lib/util');
const { user } = require('../lib/auth');

// Deux façons de fixer le prix : un identifiant de prix Stripe (STRIPE_PRICE_PRO), ou à défaut un montant
// (STRIPE_AMOUNT_PRO, en centimes) facturé chaque mois, sans rien créer au préalable dans Stripe.
const PLAN = (plan) => {
  const up = String(plan).toUpperCase();
  const price = process.env['STRIPE_PRICE_' + up], amount = parseInt(process.env['STRIPE_AMOUNT_' + up] || { PRO: '1900', BUSINESS: '4900', SINGLE: '99' }[up] || '', 10);
  // « single » : export d'une vidéo sans filigrane, payé à l'unité
  return ['pro', 'business', 'single'].includes(plan) ? { price: /^price_\w+$/.test(price || '') ? price : '', amount: amount > 0 ? amount : 0 } : null;
};
const ready = (plan) => { const p = PLAN(plan); return !!process.env.STRIPE_SECRET_KEY && !!p && !!(p.price || p.amount); };

module.exports = handler('POST', async (req, res) => {
  const { plan } = await readJson(req);
  if (!ready(plan)) throw httpError(503, 'Payments are not available yet');
  const key = process.env.STRIPE_SECRET_KEY, p = PLAN(plan);
  // le paiement est rattaché à un compte : c'est lui que le webhook passera en offre payante
  const u = await user(req);
  if (!u) throw httpError(401, 'Sign in to choose a plan');
  const host = String(req.headers.host || '');
  if (!/^[\w.-]+(:\d+)?$/.test(host)) throw httpError(400, 'Invalid host');
  const origin = (/^(localhost|127\.)/.test(host) ? 'http://' : 'https://') + host;
  const once = plan === 'single' || process.env.STRIPE_MODE === 'payment';
  const body = new URLSearchParams({
    mode: once ? 'payment' : 'subscription', 'line_items[0][quantity]': '1',
    success_url: plan === 'single' ? `${origin}/paid` : `${origin}/?checkout=success`, cancel_url: plan === 'single' ? `${origin}/paid?cancelled=1` : `${origin}/#pricing`, 'metadata[plan]': plan, client_reference_id: u.id, customer_email: u.email,
  });
  if (p.price) body.set('line_items[0][price]', p.price);
  else {
    body.set('line_items[0][price_data][currency]', (process.env.STRIPE_CURRENCY || 'usd').toLowerCase());
    body.set('line_items[0][price_data][unit_amount]', String(p.amount));
    body.set('line_items[0][price_data][product_data][name]', plan === 'single' ? 'ClipMotion video export without watermark' : `ClipMotion ${plan[0].toUpperCase() + plan.slice(1)}`);
    if (!once) body.set('line_items[0][price_data][recurring][interval]', 'month');
  }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) { console.error('stripe', r.status, j.error?.message); throw httpError(502, 'Could not start the payment. Please try again.'); }
  send(res, 200, { url: j.url });
});
module.exports.ready = ready;
