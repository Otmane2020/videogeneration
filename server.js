// Serveur local sans dépendance : fichiers statiques + mêmes handlers /api que sur Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* pas de .env */ }

const api = Object.fromEntries(['inspect', 'analyze', 'videos', 'tts', 'media', 'shot', 'backdrop', 'config', 'checkout', 'auth', 'stripe-webhook', 'track', 'admin', 'report', 'inbound'].map((n) => [`/api/${n}`, require(`./api/${n}.js`)]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC = path.join(__dirname, 'public');

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (api[pathname]) return api[pathname](req, res);
  // comme sur Vercel (cleanUrls) : /blog/ -> index.html, /blog/guide -> guide.html
  const clean = pathname.endsWith('/') ? pathname + 'index.html' : path.extname(pathname) ? pathname : pathname + '.html';
  const file = path.join(PUBLIC, path.normalize(clean));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log(`ClipMotion → http://localhost:${process.env.PORT || 3000}`));
