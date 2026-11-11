// Une seule fonction pour les routes d'exploitation (l'offre d'hébergement limite le nombre de fonctions) :
// /api/track, /api/admin, /api/report, /api/inbound et /api/push y sont redirigées par vercel.json.
const routes = { track: require('../lib/ops/track'), admin: require('../lib/ops/admin'), report: require('../lib/ops/report'), inbound: require('../lib/ops/inbound'), push: require('../lib/ops/push'), contact: require('../lib/ops/contact') };

module.exports = (req, res) => {
  const fn = routes[new URL(req.url, 'http://x').searchParams.get('a')];
  if (!fn) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Not found"}'); }
  return fn(req, res);
};
