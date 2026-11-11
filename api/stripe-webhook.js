// Webhook Stripe : active l'offre après paiement, la retire à la fin de l'abonnement.
// La signature est vérifiée sur le corps brut de la requête.
const crypto = require('crypto');
const { sql } = require('../lib/db');
const { sendMail } = require('../lib/mail');

module.exports = async (req, res) => {
  const end = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method !== 'POST') return end(405, { error: 'Method not allowed' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const header = Object.fromEntries(String(req.headers['stripe-signature'] || '').split(',').map((p) => p.split('=')));
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !header.t || !header.v1 || !raw) return end(400, { error: 'Missing signature' });
    const good = crypto.createHmac('sha256', secret).update(`${header.t}.${raw}`).digest('hex');
    if (good.length !== header.v1.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(header.v1)) || Math.abs(Date.now() / 1000 - +header.t) > 300) return end(400, { error: 'Bad signature' });
    const event = JSON.parse(raw), o = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && /^[0-9a-f-]{36}$/.test(o.client_reference_id || '') && o.metadata?.plan === 'single') {
      await sql('UPDATE users SET credits = credits + 1 WHERE id = $1', [o.client_reference_id]);
    } else if (event.type === 'checkout.session.completed' && /^[0-9a-f-]{36}$/.test(o.client_reference_id || '') && ['pro', 'business'].includes(o.metadata?.plan)) {
      const rows = await sql('UPDATE users SET plan = $1, stripe_customer = $2 WHERE id = $3 RETURNING email', [o.metadata.plan, String(o.customer || ''), o.client_reference_id]);
      if (rows[0]) await sendMail(rows[0].email, 'planActive', { plan: o.metadata.plan[0].toUpperCase() + o.metadata.plan.slice(1) });
    } else if (event.type === 'customer.subscription.deleted' && o.customer) {
      const rows = await sql("UPDATE users SET plan = 'free' WHERE stripe_customer = $1 RETURNING email", [String(o.customer)]);
      if (rows[0]) await sendMail(rows[0].email, 'planEnded');
    }
    end(200, { received: true });
  } catch (e) {
    console.error('webhook', e.message);
    end(500, { error: 'Server error' });
  }
};
// Vercel : ne pas analyser le corps, la signature porte sur le texte brut
module.exports.config = { api: { bodyParser: false } };
