// Bibliothèque de plans : écriture dans la table `footage` à partir de data/footage.json (voir scripts/build-footage.js).
const { sql } = require('./db');

const arr = (a) => '{' + [].concat(a).map((x) => '"' + String(x).replace(/["\\]/g, '') + '"').join(',') + '}';

async function seed(all) {
  for (let i = 0; i < all.length; i += 40) {
    const part = all.slice(i, i + 40), params = [];
    const values = part.map((e, j) => {
      const { s, k, ...data } = e;
      params.push(e.id, arr(s), arr(k), e.t, JSON.stringify(data));
      const n = j * 5;
      return `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5}::jsonb)`;
    }).join(',');
    await sql(`INSERT INTO footage (id, sectors, keywords, tags, data) VALUES ${values} ON CONFLICT (id) DO UPDATE SET sectors = EXCLUDED.sectors, keywords = EXCLUDED.keywords, tags = EXCLUDED.tags, data = EXCLUDED.data`, params);
  }
}
module.exports = { seed };
