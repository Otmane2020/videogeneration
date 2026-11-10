// Voix off : Deepgram Aura.
const { send, readJson, httpError, handler } = require('../lib/util');

const VOICES = {
  en: 'aura-2-thalia-en', es: 'aura-2-celeste-es', fr: 'aura-2-agathe-fr', de: 'aura-2-viktoria-de',
  it: 'aura-2-livia-it', nl: 'aura-2-rhea-nl', ja: 'aura-2-izanami-ja',
};

async function speak(model, text) {
  return fetch(`https://api.deepgram.com/v1/speak?model=${model}&encoding=mp3`, {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

module.exports = handler('POST', async (req, res) => {
  if (!process.env.DEEPGRAM_API_KEY) throw httpError(500, 'Clé Deepgram manquante');
  const { text, lang } = await readJson(req);
  const t = String(text || '').trim().slice(0, 400);
  if (!t) throw httpError(400, 'Texte manquant');
  // Pas de voix pour cette langue : on préfère une pub muette à un accent étranger.
  const model = process.env.DEEPGRAM_VOICE || VOICES[lang];
  if (!model) throw httpError(422, 'Langue non prise en charge par la voix off');
  const r = await speak(model, t);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw httpError(502, `Deepgram ${r.status} ${j.err_msg || j.message || ''}`.trim().slice(0, 160));
  }
  send(res, 200, Buffer.from(await r.arrayBuffer()), { 'content-type': 'audio/mpeg' });
});
