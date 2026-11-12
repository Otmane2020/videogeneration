// Ajoute à data/footage.json des plans Coverr (1080p+, curatés) par secteur, via le relais /api/ops?a=diag (Coverr n'est joignable que depuis Vercel).
// Usage : node --env-file=.env scripts/build-coverr.js   puis   node --env-file=.env scripts/curate-footage.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../data/footage.json');
const { words, judge } = require('../api/videos.js').internals;

// secteur -> requêtes (anglais, courtes) : Coverr indexe par titre et mots-clés
const SECTORS = {
  saas: ['team meeting', 'laptop work', 'startup office', 'video call', 'woman laptop', 'man typing', 'business meeting', 'coworking', 'remote work', 'developer', 'whiteboard', 'smartphone app', 'customer support', 'office teamwork'],
  marketing: ['social media', 'content creator', 'photographer', 'video editing', 'influencer', 'presentation'],
  ecommerce: ['online shopping', 'packages delivery', 'shopping bags', 'fashion store', 'unboxing'],
  restaurant: ['chef cooking', 'restaurant', 'waiter', 'coffee shop', 'cocktail bar', 'kitchen'],
  health: ['doctor', 'hospital', 'nurse', 'medical', 'dentist'],
  finance: ['money', 'accountant', 'bank', 'stock market', 'calculator'],
  realestate: ['house exterior', 'apartment interior', 'architecture', 'real estate', 'construction'],
  education: ['student', 'classroom', 'online learning', 'university', 'books'],
  fitness: ['gym workout', 'yoga', 'running', 'personal trainer'],
  travel: ['airplane', 'hotel', 'beach vacation', 'airport', 'road trip'],
  beauty: ['makeup', 'hair salon', 'skincare', 'spa'],
  automotive: ['car driving', 'mechanic', 'electric car', 'car interior'],
  logistics: ['warehouse', 'truck', 'container port', 'delivery van'],
  hr: ['job interview', 'team celebrating', 'office colleagues', 'recruitment'],
  legal: ['lawyer', 'contract signing', 'courthouse', 'handshake'],
  it: ['server room', 'programmer', 'cybersecurity', 'coding', 'data center'],
  creative: ['graphic designer', 'video production', 'artist', 'music studio', 'podcast'],
  retail: ['store', 'supermarket', 'boutique', 'cashier'],
  events: ['wedding', 'concert', 'conference', 'party', 'festival'],
  energy: ['solar panels', 'wind turbines', 'electric charging', 'engineer'],
  agriculture: ['farm', 'greenhouse', 'vineyard', 'harvest'],
  pets: ['dog', 'cat', 'veterinarian'],
  kids: ['family', 'children playing', 'baby', 'mother child'],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const have = new Map(all.map((e) => [String(e.id), e]));
  let added = 0, n = 0;
  for (const [sector, queries] of Object.entries(SECTORS)) {
    for (const q of queries) {
      n++;
      let hits;
      for (let t = 0; t < 3 && !hits; t++) {
        try {
          const r = await fetch(`https://www.clipmotion.ai/api/ops?a=diag&k=${process.env.CRON_SECRET}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(40000) });
          const j = await r.json();
          if (j.error) throw new Error(j.error);
          hits = j.hits;
        } catch (e) { await sleep(3000); }
      }
      if (!hits) { console.log('\néchec', q); continue; }
      const qw = words(q);
      const pick = hits.filter((h) => !h.ai && !h.premium && h.duration >= 5 && h.duration <= 45 && h.mp4 && h.w >= 1920 && h.thumb && !/green ?screen/i.test(`${h.title} ${[].concat(h.tags).join(' ')}`))
        .map((h) => { const tags = [h.title, h.description, ...[].concat(h.tags)].join(', '); return { h, tags, rel: judge(qw, new Set(words(tags))) }; })
        .filter((x) => x.rel >= 2).sort((a, b) => b.rel - a.rel || (b.h.downloads || 0) - (a.h.downloads || 0)).slice(0, 8);
      for (const { h, tags } of pick) {
        const old = have.get('c' + h.id);
        if (old) { old.s = [...new Set([...old.s, sector])]; old.k = [...new Set([...old.k, q])]; continue; }
        const e = { id: 'c' + h.id, g: 'c' + h.id, s: [sector], k: [q], u: h.mp4, w: h.w, h: h.h, f: h.mp4, fw: h.w, fh: h.h, l: h.preview || h.mp4, th: h.thumb, d: Math.round(h.duration), t: tags.slice(0, 400), p: `https://coverr.co/videos/${h.slug}`, src: 'coverr' };
        all.push(e); have.set(e.id, e); added++;
      }
      process.stdout.write(`\r${n} requêtes · +${added} plans Coverr   `);
      await sleep(300);
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(all));
  console.log(`\n${added} plans Coverr ajoutés, ${all.length} au total`);
})();
