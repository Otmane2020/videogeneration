const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2e6) throw httpError(413, 'Request too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw httpError(400, 'Invalid JSON'); }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('::ffff:');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'Invalid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'Only http(s) addresses are accepted');
  if (process.env.ALLOW_PRIVATE_HOSTS === '1') return u; // dev/test uniquement
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try {
      // résolution bornée dans le temps
      addrs = await Promise.race([dns.lookup(host, { all: true }), new Promise((_, ko) => setTimeout(() => ko(Object.assign(new Error('dns'), { name: 'TimeoutError' })), 5000))]);
    } catch (e) {
      if (e.name === 'TimeoutError') throw e;
      throw httpError(400, 'Domain not found');
    }
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw httpError(400, 'Address not allowed');
  return u;
}

// fetch qui refuse les adresses privées, y compris après redirection
async function safeFetch(raw, opts = {}, timeout = 15000) {
  let url = raw;
  for (let i = 0; i < 6; i++) {
    const u = await assertPublicUrl(url);
    const r = await fetch(u, {
      ...opts,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': UA, accept: '*/*', ...(opts.headers || {}) },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), u).href;
      continue;
    }
    return r;
  }
  throw httpError(502, 'Too many redirects');
}

async function readCapped(resp, max) {
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel().catch(() => {}); if (chunks.length === 0) chunks.push(value.subarray(0, max)); break; }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks), truncated: size > max };
}

// enveloppe un handler : méthode, erreurs -> JSON
function handler(method, fn) {
  return async (req, res) => {
    try {
      if (req.method !== method) return send(res, 405, { error: 'Method not allowed' });
      await fn(req, res);
    } catch (e) {
      const status = e.status || (e.name === 'TimeoutError' ? 504 : 500);
      if (status >= 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e.status ? e.message : e.name === 'TimeoutError' ? 'Timed out' : 'Server error' });
      else res.end();
    }
  };
}

module.exports = { send, readJson, httpError, safeFetch, readCapped, handler, assertPublicUrl };
