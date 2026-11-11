// Mesure d'audience maison, sans cookie : une ligne par page vue.
// Le visiteur est compté par une empreinte qui change chaque jour (adresse IP et navigateur hachés, jamais stockés en clair).
const crypto = require('crypto');
const { readJson } = require('../util');
const { sql } = require('../db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST' && process.env.DATABASE_URL) {
      const b = await readJson(req), ua = String(req.headers['user-agent'] || '');
      if (!/bot|crawl|spider|preview|monitor|headless/i.test(ua)) {
        const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const vid = crypto.createHash('sha256').update(`${ip}|${ua}|${new Date().toISOString().slice(0, 10)}|${process.env.SESSION_SECRET || ''}`).digest('hex').slice(0, 16);
        let ref = '';
        try { const h = new URL(String(b.ref || '')).hostname; if (h && !/clipmotion\.ai$/.test(h)) ref = h.slice(0, 80); } catch { /* pas de provenance */ }
        await sql('INSERT INTO visits (path, vid, ref) VALUES ($1, $2, $3)', [String(b.path || '/').slice(0, 120), vid, ref || null]);
      }
    }
  } catch (e) { console.error('track', e.message); }
  res.writeHead(204); res.end();
};
