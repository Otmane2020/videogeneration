// Mesure d'audience maison, sans cookie : une ligne par page vue.
// Le visiteur est compté par une empreinte qui change chaque jour (adresse IP et navigateur hachés, jamais stockés en clair).
// Chaque visite est classée par origine : seo (moteurs de recherche et assistants IA), social, referral, direct, paid.
const crypto = require('crypto');
const { readJson } = require('../util');
const { sql } = require('../db');

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|brave|baidu|yandex|startpage|ask|naver|seznam)\.[a-z.]+$|(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|claude\.ai|copilot\.microsoft\.com|you\.com|phind\.com|poe\.com|meta\.ai|grok\.com)$/i;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|tiktok\.com|youtube\.com|youtu\.be|reddit\.com|pinterest\.[a-z.]+|whatsapp\.com|wa\.me|telegram\.org|t\.me|snapchat\.com|threads\.net|bsky\.app|mastodon\.[a-z.]+|discord\.com)$/i;
const SOCIAL_NAMES = /^(facebook|fb|instagram|ig|twitter|x|linkedin|tiktok|youtube|reddit|pinterest|whatsapp|telegram|snapchat|threads|bluesky|discord)$/i;
const clean = (v) => String(v || '').replace(/[^\w .+@/-]/g, '').trim().slice(0, 60);

function channelOf(host, u) {
  if (/^(cpc|ppc|paid|paidsocial|paid_social|paid-social|display|banner|retargeting|ads?|sponsored)$/i.test(u.medium) || u.click) return 'paid';
  if (host) return SEARCH.test(host) ? 'seo' : SOCIAL.test(host) ? 'social' : 'referral';
  if (SOCIAL_NAMES.test(u.source)) return 'social';
  if (/^(google|bing|duckduckgo|chatgpt|perplexity|claude|gemini|copilot)$/i.test(u.source)) return 'seo';
  return u.source || u.medium ? 'referral' : 'direct';
}
const deviceOf = (ua) => (/ipad|tablet|kindle|silk|playbook/i.test(ua) ? 'tablet' : /mobi|android|iphone|ipod/i.test(ua) ? 'mobile' : 'desktop');

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST' && process.env.DATABASE_URL) {
      const b = await readJson(req), ua = String(req.headers['user-agent'] || '');
      if (!/bot|crawl|spider|preview|monitor|headless/i.test(ua)) {
        const ip = String(req.headers['x-vercel-ip-address'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const vid = crypto.createHash('sha256').update(`${ip}|${ua}|${new Date().toISOString().slice(0, 10)}|${process.env.SESSION_SECRET || ''}`).digest('hex').slice(0, 16);
        let ref = '';
        try { const h = new URL(String(b.ref || '')).hostname; if (h && !/(^|\.)clipmotion\.ai$/.test(h)) ref = h.replace(/^www\./, '').slice(0, 80); } catch { /* pas de provenance */ }
        const u = { source: clean(b.utm?.source), medium: clean(b.utm?.medium), campaign: clean(b.utm?.campaign), click: !!clean(b.utm?.click) };
        const country = /^[A-Za-z]{2}$/.test(String(req.headers['x-vercel-ip-country'] || '')) ? String(req.headers['x-vercel-ip-country']).toUpperCase() : null;
        await sql('INSERT INTO visits (path, vid, ref, channel, src, medium, campaign, country, device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [String(b.path || '/').slice(0, 120), vid, ref || null, channelOf(ref, u), u.source || ref || null, u.medium || null, u.campaign || null, country, deviceOf(ua)]);
      }
    }
  } catch (e) { console.error('track', e.message); }
  res.writeHead(204); res.end();
};
