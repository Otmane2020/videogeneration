// Compte rendu quotidien envoyé aux administrateurs (appelé chaque matin par la tâche planifiée Vercel).
const { send } = require('../lib/util');
const { sendMail, admins } = require('../lib/mail');
const { summary } = require('../lib/stats');

module.exports = async (req, res) => {
  try {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Unauthorized' });
    const s = await summary(1); // la journée d'hier, complète
    const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const rows = [['Page views', s.views], ['Visitors', s.visitors], ['New sign-ups', s.signups], ['Videos created', s.videos], ['Purchases', s.purchases], ['Total accounts', s.users], ['Paying accounts', s.paid]];
    const sent = await Promise.all(admins().map((to) => sendMail(to, 'daily', { day, rows, top: s.top })));
    send(res, 200, { day, sent: sent.filter(Boolean).length });
  } catch (e) { console.error('report', e.message); send(res, 500, { error: 'Server error' }); }
};
