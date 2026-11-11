// Paiement : ouvre une session Stripe Checkout pour l'offre choisie.
// À configurer : STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS (identifiants de prix Stripe, « price_... »).
const { send, readJson, httpError, handler } = require('../lib/util');
const { user } = require('../lib/auth');
const { sql } = require('../lib/db');
const { sendMail, notifyAdmins } = require('../lib/mail');

const stripe = async (path, body) => {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body,
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
};

// Retour de paiement : on demande à Stripe l'état de la session et on active l'offre.
// (Ne dépend pas d'un webhook ; chaque session n'est comptée qu'une fois.)
async function confirm(sessionId, u) {
  if (!/^cs_[\w]+$/.test(sessionId || '')) throw httpError(400, 'Unknown payment');
  const { ok, json: o } = await stripe('checkout/sessions/' + sessionId);
  if (!ok || o.client_reference_id !== u.id) throw httpError(400, 'Unknown payment');
  const paid = o.status === 'complete' && ['paid', 'no_payment_required'].includes(o.payment_status);
  const plan = o.metadata?.plan;
  if (!paid || !['pro', 'business', 'single'].includes(plan)) return { granted: false };
  const first = await sql('INSERT INTO payments (session_id, user_id, plan) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING RETURNING session_id', [sessionId, u.id, plan]);
  if (first[0]) {
    if (plan === 'single') await sql('UPDATE users SET credits = credits + 1 WHERE id = $1', [u.id]);
    else {
      await sql('UPDATE users SET plan = $1, stripe_customer = $2, stripe_sub = $3, plan_checked_at = now() WHERE id = $4', [plan, String(o.customer || ''), String(o.subscription || ''), u.id]);
      await sendMail(u.email, 'planActive', { plan: plan[0].toUpperCase() + plan.slice(1) });
    }
  }
  if (first[0]) await notifyAdmins('New purchase', [`${u.email} · ${plan} · ${((o.amount_total || 0) / 100).toFixed(2)} ${String(o.currency || '').toUpperCase()}`]);
  return { granted: true, plan };
}


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
  const { plan, promo, confirm: sessionId } = await readJson(req);
  if (sessionId) {
    const me = await user(req);
    if (!me) throw httpError(401, 'Sign in to finish your purchase');
    return send(res, 200, await confirm(sessionId, me));
  }
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
    success_url: plan === 'single' ? `${origin}/paid?session_id={CHECKOUT_SESSION_ID}` : `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: plan === 'single' ? `${origin}/paid?cancelled=1` : `${origin}/#pricing`, 'metadata[plan]': plan, client_reference_id: u.id, customer_email: u.email,
  });
  // sans carte quand il n'y a rien à payer (code promo à 100 %)
  if (!once) body.set('payment_method_collection', 'if_required');
  const code = String(promo || '').trim();
  if (code) {
    // code promo saisi dans l'app : vérifié auprès de Stripe puis appliqué d'office
    const found = /^[\w-]{2,40}$/.test(code) ? await stripe('promotion_codes?active=true&limit=1&code=' + encodeURIComponent(code)) : null;
    const id = found?.json?.data?.[0]?.id;
    if (!id) throw httpError(400, 'This promo code is not valid');
    body.set('discounts[0][promotion_code]', id);
  } else body.set('allow_promotion_codes', 'true');
  if (p.price) body.set('line_items[0][price]', p.price);
  else {
    body.set('line_items[0][price_data][currency]', (process.env.STRIPE_CURRENCY || 'usd').toLowerCase());
    body.set('line_items[0][price_data][unit_amount]', String(p.amount));
    body.set('line_items[0][price_data][product_data][name]', plan === 'single' ? 'ClipMotion video export without watermark' : `ClipMotion ${plan[0].toUpperCase() + plan.slice(1)}`);
    if (!once) body.set('line_items[0][price_data][recurring][interval]', 'month');
  }
  const r = await stripe('checkout/sessions', body), j = r.json;
  if (!r.ok || !j.url) { console.error('stripe', r.status, j.error?.message); throw httpError(502, 'Could not start the payment. Please try again.'); }
  send(res, 200, { url: j.url });
});
module.exports.ready = ready;
module.exports.stripe = stripe;
