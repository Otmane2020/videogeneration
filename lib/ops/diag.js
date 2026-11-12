// TEMPORAIRE : lit la doc ClearBackdrop et teste un détourage depuis Vercel
module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const done = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!process.env.CRON_SECRET || q.get('k') !== process.env.CRON_SECRET) { res.writeHead(401); return res.end('no'); }
  try {
    if (q.get('m') === 'doc') {
      const r = await fetch('https://clearbackdrop.com/' + (q.get('p') || 'api'));
      const t = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return done({ status: r.status, text: t.slice(0, 7000) });
    }
    if (q.get('m') === 'cut') {
      const img = await fetch(q.get('u'));
      const buf = Buffer.from(await img.arrayBuffer());
      const fd = new FormData();
      fd.append(q.get('field') || 'image_file', new Blob([buf], { type: 'image/jpeg' }), 'p.jpg');
      if (q.get('model')) fd.append('model', q.get('model'));
      const r = await fetch('https://clearbackdrop.com/api/v1/remove-background', { method: 'POST', headers: { 'x-api-key': process.env.CLEARBACKDROP_API_KEY }, body: fd });
      const out = Buffer.from(await r.arrayBuffer());
      return done({ status: r.status, type: r.headers.get('content-type'), bytes: out.length, head: out.subarray(0, 120).toString('latin1').replace(/[^\x20-\x7e]/g, '.'), png: out.subarray(1, 4).toString() === 'PNG', time: r.headers.get('x-processing-time'), hdrs: [...r.headers].filter(([k]) => /limit|remaining|credit|x-/.test(k)).slice(0, 8) });
    }
    done({ ok: 1 });
  } catch (e) { done({ error: e.message }); }
};
