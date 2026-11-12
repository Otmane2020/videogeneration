// Contenu de la bibliothèque de plans (table `footage`), pour la page /footage.
const { send } = require('../util');
const { library, source } = require('../../api/videos.js').internals;

module.exports = async (req, res) => {
  const lib = await library();
  const sectors = {};
  lib.forEach((x) => (x.s || []).forEach((s) => { sectors[s] = (sectors[s] || 0) + 1; }));
  send(res, 200, {
    source: source(), total: lib.length, hd: lib.filter((x) => x.full).length, sectors,
    clips: lib.map((x) => ({ id: x.id, s: x.s, k: x.k, thumb: x.thumb, lite: x.lite, sd: x.std.url, hd: x.full?.url || '', w: (x.full || x.std).width, h: (x.full || x.std).height, d: x.duration, g: x.g, p: x.p || '', tags: x.raw })),
  });
};
