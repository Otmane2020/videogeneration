// Deepgram Aura-2 voice-over. A voice is selected once per video and reused for every scene.
const { send, readJson, httpError, handler } = require('../lib/util');

const VOICES = {
  en: ['aura-2-thalia-en', 'aura-2-asteria-en', 'aura-2-atlas-en', 'aura-2-aurora-en', 'aura-2-aries-en', 'aura-2-ophelia-en', 'aura-2-phoebe-en'],
  es: ['aura-2-celeste-es', 'aura-2-carina-es', 'aura-2-aquila-es', 'aura-2-luciano-es', 'aura-2-antonia-es', 'aura-2-diana-es'],
  fr: ['aura-2-agathe-fr', 'aura-2-hector-fr'],
  de: ['aura-2-viktoria-de', 'aura-2-julius-de', 'aura-2-lara-de'],
  nl: ['aura-2-beatrix-nl', 'aura-2-sander-nl', 'aura-2-leda-nl'],
  it: ['aura-2-livia-it', 'aura-2-dionisio-it', 'aura-2-maia-it'],
  ja: ['aura-2-uzume-ja', 'aura-2-ebisu-ja', 'aura-2-izanami-ja'],
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
  if (!process.env.DEEPGRAM_API_KEY) throw httpError(500, 'Deepgram key missing');
  const { text, lang, voice } = await readJson(req);
  const t = String(text || '').trim().slice(0, 400);
  if (!t) throw httpError(400, 'Missing text');
  const language = String(lang || '').toLowerCase().split(/[-_]/)[0];
  const available = VOICES[language];
  if (!available) throw httpError(422, 'Deepgram Aura-2 voice-over is not available for this language');
  const model = voice && available.includes(voice) ? voice : available[Math.floor(Math.random() * available.length)];
  const r = await speak(model, t);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw httpError(502, `Deepgram ${r.status} ${j.err_msg || j.message || ''}`.trim().slice(0, 160));
  }
  send(res, 200, Buffer.from(await r.arrayBuffer()), { 'content-type': 'audio/mpeg' });
});
