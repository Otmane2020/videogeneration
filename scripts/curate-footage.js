// Juge chaque plan de data/footage.json avec une IA à vision (pertinence + beauté de la vignette) et ne garde que les meilleurs.
// Usage : node --env-file=.env scripts/curate-footage.js [seuil=7]
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../data/footage.json');
const MODEL = process.env.CURATE_MODEL || 'google/gemini-2.5-flash';
const MIN = +process.argv[2] || 7;

async function thumb(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('thumb ' + r.status);
  return 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
}

async function judge(batch) {
  const content = [{ type: 'text', text: `You are the art director of a premium video-ad platform choosing stock footage. Each image is the thumbnail of a clip. For each image I give the subject it must show.
Score 0-10:
- relevance: how clearly the frame shows that subject in that sector (0 = unrelated, 10 = exactly it).
- beauty: premium commercial quality (sharp, well lit, nice composition, natural colours, modern look). Penalise blurry, dark, flat, cluttered, amateur, dated, stock-cliché, visible text, logos, watermarks, cartoon or AI-generated look, green screens.
Return ONLY JSON: {"scores":[{"i":1,"relevance":8,"beauty":7}]}` }];
  for (const [i, c] of batch.entries()) {
    content.push({ type: 'text', text: `Image ${i + 1} — subject: "${c.k[0]}" (sector: ${c.s[0]})` }, { type: 'image_url', image_url: { url: c.img } });
  }
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ''}`.slice(0, 160));
  const txt = j.choices?.[0]?.message?.content || '';
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).scores || [];
}

(async () => {
  const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const todo = all.filter((c) => c.rb === undefined);
  console.log(`${all.length} plans, ${todo.length} à juger avec ${MODEL}`);
  const batches = [];
  for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
  let done = 0, next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await Promise.all(batch.map(async (c) => { c.img = await thumb(c.th).catch(() => null); }));
          const ok = batch.filter((c) => c.img);
          const scores = await judge(ok);
          scores.forEach((s) => { const c = ok[s.i - 1]; if (c) { c.rl = +s.relevance; c.rb = +s.beauty; } });
          break;
        } catch (e) { if (attempt === 2) console.log('\nlot abandonné:', e.message); else await new Promise((r) => setTimeout(r, 4000)); }
      }
      batch.forEach((c) => delete c.img);
      process.stdout.write(`\r${++done}/${batches.length} lots`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(FILE, JSON.stringify(all)); // les notes sont gardées : une relance ne rejuge que les plans sans note
  const judged = all.filter((c) => c.rb !== undefined);
  const keep = judged.filter((c) => c.rl >= MIN && c.rb >= MIN);
  console.log(`\njugés: ${judged.length} | gardés (pertinence ≥ ${MIN} et beauté ≥ ${MIN}): ${keep.length}`);
  const by = {};
  keep.forEach((c) => c.s.forEach((s) => { by[s] = (by[s] || 0) + 1; }));
  console.log(JSON.stringify(by));
})();
