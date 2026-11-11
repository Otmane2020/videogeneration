// E-mails reçus (webhook « email.received » de Resend) : stockés en DB et signalés aux admins.
// À déclarer dans Resend avec l'URL /api/inbound?key=<INBOUND_KEY>.
const { send, readJson } = require('../util');
const { notifyAdmins } = require('../mail');
const { sql } = require('../db');

module.exports = async (req, res) => {
  try {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!process.env.INBOUND_KEY || key !== process.env.INBOUND_KEY) return send(res, 401, { error: 'Unauthorized' });
    const e = await readJson(req), d = e.data || {};
    if (e.type === 'email.received') {
      const from = String(d.from?.email || d.from || '').slice(0, 120);
      const subject = String(d.subject || '').slice(0, 200);
      const body = String(d.text || d.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
      await sql('INSERT INTO inbound_msgs (kind, from_email, subject, body) VALUES ($1,$2,$3,$4)', ['email', from, subject, body]).catch(() => {});
      await notifyAdmins('📩 Email received', [`From: ${from}`, `Subject: ${subject}`, body.slice(0, 1200)].filter((l) => l.trim().length > 2));
    }
    send(res, 200, { received: true });
  } catch (err) { console.error('inbound', err.message); send(res, 500, { error: 'Server error' }); }
};
