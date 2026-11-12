// Charge data/footage.json dans la table `footage` et retire les plans qui n'y sont plus.
// Usage : node --env-file=.env scripts/seed-footage.js   (la production se remplit aussi toute seule au premier appel si la table est vide)
const fs = require('fs');
const path = require('path');
const { sql } = require('../lib/db');
const { sync } = require('../lib/footage');
(async () => {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/footage.json'), 'utf8')).filter((e) => e.rl >= 7 && e.rb >= 7);
  await sync(all);
  console.log('plans en base :', (await sql('SELECT count(*)::int AS n FROM footage'))[0].n);
})().catch((e) => { console.error('échec', e.message); process.exit(1); });
