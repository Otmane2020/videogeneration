// Formulaire de contact public : enregistre le message en DB et notifie les admins par e-mail.
const { send, readJson, httpError } = require('../util');
const { notifyAdmins } = require('../mail');
const { sql } = require('../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { name, email, message } = await readJson(req);
    const nm = String(name || '').trim().slice(0, 80);
    const em = String(email || '').trim().toLowerCase().slice(0, 120);
    const msg = String(message || '').trim().slice(0, 2000);
    if (!nm || !msg) throw httpError(400, 'Name and message are required');
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) throw httpError(400, 'Invalid email address');
    await sql('INSERT INTO inbound_msgs (kind, from_email, from_name, subject, body) VALUES ($1,$2,$3,$4,$5)', ['contact', em || null, nm, 'Contact form', msg]);
    await notifyAdmins('📬 Contact form', [`From: ${nm}${em ? ` <${em}>` : ''}`, msg.slice(0, 1200)]);
    send(res, 200, { sent: true });
  } catch (e) {
    if (!e.status) console.error('contact', e.message);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
};
