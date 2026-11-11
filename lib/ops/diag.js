// TEMPORAIRE : diagnostic des banques vidéo depuis Vercel
module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  if (!process.env.CRON_SECRET || q.get('k') !== process.env.CRON_SECRET) { res.writeHead(401); return res.end('no'); }
  const out = {};
  try {
    const r = await fetch('https://api.coverr.co/videos?query=' + encodeURIComponent(q.get('q') || 'team meeting') + '&page_size=3&urls=true', { headers: { authorization: 'Bearer ' + process.env.COVERR_API_KEY } });
    out.status = r.status; out.body = (await r.text()).slice(0, 1800);
  } catch (e) { out.error = e.message; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
};
