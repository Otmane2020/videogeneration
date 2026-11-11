// E-mails reçus (webhook « email.received » de Resend) : chaque message est signalé aux administrateurs.
// À déclarer dans Resend avec l'adresse /api/inbound?key=<INBOUND_KEY>.
const { send, readJson } = require('../util');
const { notifyAdmins } = require('../mail');

module.exports = async (req, res) => {
  try {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!process.env.INBOUND_KEY || key !== process.env.INBOUND_KEY) return send(res, 401, { error: 'Unauthorized' });
    const e = await readJson(req), d = e.data || {};
    if (e.type === 'email.received') {
      const from = String(d.from?.email || d.from || '').slice(0, 120), to = [].concat(d.to || []).join(', ').slice(0, 160);
      await notifyAdmins('Email received', [`From: ${from}`, `To: ${to}`, `Subject: ${String(d.subject || '').slice(0, 200)}`, String(d.text || '').slice(0, 1200)].filter((l) => l.trim().length > 6));
    }
    send(res, 200, { received: true });
  } catch (err) { console.error('inbound', err.message); send(res, 500, { error: 'Server error' }); }
};
