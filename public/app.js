'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FORMATS = { '9:16': [720, 1280], '1:1': [720, 720], '16:9': [1280, 720] };
const state = { page: null, type: null, plan: null, fmt: '9:16', job: null, music: '', uploads: [], photoUrls: [], logo: null, variant: {}, picked: [], intent: 'launch', ad: null, clipLists: [], used: [], cache: { blob: new Map(), voice: new Map(), shot: null } };
const media = (u) => '/api/media?u=' + encodeURIComponent(u);

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
  return r;
}

function show(id, step) {
  $$('.view').forEach((v) => (v.hidden = v.id !== id));
  // accueil : navigation du site ; assistant : étapes
  $('.nav').hidden = step !== 1;
  $('.steps').hidden = step === 1;
  $$('.steps li').forEach((li) => {
    li.classList.toggle('on', +li.dataset.s === step);
    li.classList.toggle('done', +li.dataset.s < step);
  });
  scrollTo(0, 0);
}
function fail(el, msg) { el.textContent = msg; el.hidden = !msg; }

/* ---------- 1. URL -> 2. inspection ---------- */
$('#f-url').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#url').value.trim();
  fail($('#e-url'), '');
  if (!/^(https?:\/\/)?[^\s/.]+\.[^\s]{2,}$/i.test(url)) return fail($('#e-url'), 'Enter a valid address, for example yourstore.com');
  $('#scan-title').textContent = 'Scanning your page…';
  $('#scan-sub').textContent = url.replace(/^https?:\/\//, '');
  show('s-inspect', 2);
  try {
    state.page = await (await api('/api/inspect', { url })).json();
    state.uploads.forEach((u) => URL.revokeObjectURL(u.url));
    state.uploads = [];
    state.cache = { blob: new Map(), voice: new Map(), shot: null };
    initVariant();
    // le vrai logo : affiché dans la vidéo, et ses couleurs servent de palette
    state.logo = loadLogo(state.page.logos).then((l) => (l ? { ...l, colors: logoColors(l.img), light: logoIsLight(l.img) } : null));
    renderSetup();
  } catch (err) {
    show('s-url', 1);
    fail($('#e-url'), err.message);
  }
});
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { cancelJob(); show('s-url', 1); }));

/* ---------- 3. réglages ---------- */
function renderSetup() {
  const p = state.page;
  $('#site-host').textContent = $('#brand-host').textContent = p.host;
  $('#site-title').textContent = p.product?.name || p.title || p.siteName;
  $('#brand-title').textContent = p.siteName;
  $('#site-desc').textContent = $('#brand-desc').textContent = p.description || p.h1[0] || '';
  const img = $('#site-img');
  img.hidden = !p.images[0];
  if (p.images[0]) { img.onerror = () => (img.hidden = true); img.src = media(p.images[0]); }
  // carte de marque : logo (ou initiale) et couleurs tirées du logo
  const box = $('#brand-logo'), sw = $('#brand-sw');
  box.className = 'brandlogo';
  box.replaceChildren(Object.assign(document.createElement('span'), { textContent: (p.siteName || '?')[0].toUpperCase() }));
  sw.textContent = '';
  $('#brand-glow').style.background = '';
  const page = p;
  state.logo.then((l) => {
    if (!l || state.page !== page) return;
    const el = new Image();
    el.alt = `${p.siteName} logo`; el.src = l.img.src;
    box.replaceChildren(el);
    box.classList.toggle('wide', l.img.naturalWidth > l.img.naturalHeight * 1.7);
    box.classList.toggle('dark', l.light);
    if (l.colors) {
      Object.values(l.colors).forEach((c) => sw.append(Object.assign(document.createElement('i'), { style: `background:${c}` })));
      $('#brand-glow').style.background = `linear-gradient(100deg, ${l.colors.primary}, ${l.colors.accent || l.colors.primary})`;
    }
  });
  $$('.type .badge').forEach((b) => (b.hidden = b.parentElement.dataset.type !== p.guess.type));
  setType(p.guess.type);
  fail($('#e-type'), '');
  fail($('#blocked'), p.blocked ? `This site is protected against automated reading (${p.blocked}), so its photos and price could not be imported. Add your product photos below: the ad will be built from them and from the product name.` : '');
  show('s-type', 3);
}
function setType(t) {
  state.type = t;
  $$('.type').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === t)));
  $('#uploads').hidden = t !== 'ecom';
  // SaaS : on montre la marque (logo), pas une image de produit
  $('#card-product').hidden = t !== 'ecom';
  $('#card-brand').hidden = t === 'ecom';
  $('#opt-stock').hidden = t !== 'saas';
  $('#opt-bg').hidden = t !== 'ecom';
  setIntent(t === 'ecom' ? 'launch' : 'problem');
  renderPhotos();
}
function setIntent(i) {
  state.intent = i;
  $$('.intents button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.intent === i)));
}
$$('.type').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
$$('.intents button').forEach((b) => b.addEventListener('click', () => setIntent(b.dataset.intent)));
$$('#s-type .seg button').forEach((b) => b.addEventListener('click', () => {
  state.fmt = b.dataset.fmt;
  $$('#s-type .seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
}));

/* ----- variantes (couleur, taille…) et choix des photos ----- */
const MAX_PHOTOS = 5;
const variantOf = () => (state.page.product?.variants || []).find((v) => Object.entries(state.variant).every(([k, val]) => v.options[k] === val)) || null;
function initVariant() {
  const pr = state.page.product, first = pr?.variants.find((v) => v.available) || pr?.variants[0];
  state.variant = first ? { ...first.options } : {};
  autoPick();
}
// toutes les photos disponibles : importées à la main d'abord, puis celles de la page
function allPhotos() {
  return [...state.uploads.map((u) => ({ show: u.url, send: u.data })), ...state.page.images.map((u) => ({ show: media(u), send: u }))];
}
// sélection par défaut : la photo de la variante choisie en tête, sans les photos des autres variantes
function autoPick() {
  const v = variantOf(), others = new Set((state.page.product?.variants || []).map((x) => x.image).filter((u) => u && u !== v?.image));
  const list = allPhotos().map((p) => p.send);
  state.picked = [...(v?.image && list.includes(v.image) ? [v.image] : []), ...list.filter((u) => u !== v?.image && !others.has(u))].slice(0, MAX_PHOTOS);
}
function photoList() {
  const by = new Map(allPhotos().map((p) => [p.send, p]));
  return state.picked.map((k) => by.get(k)).filter(Boolean);
}
function renderPhotos() {
  if (!state.page) return;
  const pr = state.page.product, vbox = $('#variants');
  vbox.textContent = '';
  (pr?.options || []).forEach((o) => {
    const h = document.createElement('h3');
    h.textContent = o.name;
    const row = Object.assign(document.createElement('div'), { className: 'chips' });
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', o.name);
    o.values.forEach((val) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: val });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.variant[o.name] === val));
      // combinaison indisponible avec les autres choix en cours
      const combo = { ...state.variant, [o.name]: val };
      if (pr.variants.length && !pr.variants.some((v) => v.available && Object.entries(combo).every(([k, x]) => v.options[k] === x))) b.classList.add('off');
      b.addEventListener('click', () => {
        state.variant = state.variant[o.name] === val && !pr.variants.length ? Object.fromEntries(Object.entries(state.variant).filter(([k]) => k !== o.name)) : combo;
        autoPick(); renderPhotos();
      });
      row.append(b);
    });
    vbox.append(h, row);
  });
  const v = variantOf(), price = v?.price || pr?.price;
  if (price) vbox.append(Object.assign(document.createElement('p'), { className: 'vprice', textContent: `${price} ${pr.currency || ''}`.trim() + (v && !v.available ? ' · out of stock' : '') }));

  const all = allPhotos(), box = $('#photos');
  box.textContent = '';
  all.slice(0, 16).forEach((p) => {
    const n = state.picked.indexOf(p.send);
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.setAttribute('aria-pressed', String(n >= 0));
    b.setAttribute('aria-label', n >= 0 ? `Photo ${n + 1}, remove` : 'Add this photo');
    const im = new Image(); im.alt = ''; im.loading = 'lazy'; im.src = p.show; im.onerror = () => b.remove();
    b.append(im);
    if (n >= 0) b.append(Object.assign(document.createElement('b'), { textContent: n + 1 }));
    b.addEventListener('click', () => {
      if (n >= 0) state.picked.splice(n, 1);
      else if (state.picked.length < MAX_PHOTOS) state.picked.push(p.send);
      renderPhotos();
    });
    box.append(b);
  });
  $('#up-hint').textContent = all.length
    ? `${all.length} photo${all.length > 1 ? 's' : ''} found. Tap to choose the ones for the ad (${state.picked.length}/${MAX_PHOTOS}); no. 1 is the main photo.`
    : 'No photo found on the page: add your product photos.';
}
$('#files').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 5);
  e.target.value = '';
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const im = await loadImage(url);
    if (!im) { URL.revokeObjectURL(url); continue; }
    // copie réduite pour l'analyse par l'IA
    const k = Math.min(1, 768 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(im.naturalWidth * k), height: Math.round(im.naturalHeight * k) });
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.82);
    state.uploads.unshift({ url, data });
    state.picked = [data, ...state.picked].slice(0, MAX_PHOTOS);
  }
  state.uploads.splice(8).forEach((u) => URL.revokeObjectURL(u.url));
  renderPhotos();
});

/* ---------- 4. génération directe, puis retouches ---------- */
const newAudio = () => new (window.AudioContext || window.webkitAudioContext)(); // à créer dans le geste utilisateur (iOS)
function cancelJob() { if (state.job) state.job.cancelled = true; stopPreview(); $('#result').pause(); }

$('#b-gen').addEventListener('click', async () => {
  const actx = newAudio(), ecom = state.type === 'ecom';
  cancelJob();
  const cv = $('#cv'), [W, H] = FORMATS[state.fmt];
  cv.width = W; cv.height = H; cv.getContext('2d').clearRect(0, 0, W, H);
  cv.hidden = false; $('#result').hidden = true;
  $('#st-actions').hidden = $('#editor').hidden = $('#b-again').hidden = true;
  show('s-video', 4);
  status(ecom ? 'Reviewing your product photos and writing the script…' : 'Studying your brand and writing the script…', 4);
  try {
    const list = ecom ? photoList() : [];
    state.photoUrls = list.map((p) => p.show);
    // la variante choisie fixe le prix affiché et le texte de la pub
    const v = ecom ? variantOf() : null;
    const page = v?.price ? { ...state.page, product: { ...state.page.product, price: v.price } } : state.page;
    const plan = (state.plan = await (await api('/api/analyze', { page, type: state.type, intent: state.intent, photos: ecom ? list.map((p) => p.send) : undefined, variant: ecom && Object.keys(state.variant).length ? state.variant : undefined })).json());
    const brand = await state.logo;
    if (brand?.colors) Object.assign(plan.palette, brand.colors);
    state.ad = plan.ads[0];
    setMusic(ecom ? 'm6' : 'm1');
    status('Finding the right visuals…', 10);
    // les plans d'illustration ne servent qu'aux scènes « vidéo » : sans eux, la pub se monte quand même
    // derrière le téléphone : un fond sobre, pas une scène qui distrait
    const NEUTRAL = ['dark abstract background', 'bokeh lights night', 'technology background'];
    state.clipLists = await api('/api/videos', { scenes: state.ad.scenes.map((s) => (s.visual === 'site' ? NEUTRAL : s.queries)), fallback: ecom ? 'lifestyle' : 'technology', hd: $('#res').value === '1080' })
      .then((r) => r.json()).then(({ results }) => results).catch(() => state.ad.scenes.map(() => []));
    await produce(actx);
  } catch (err) {
    show('s-type', 3);
    fail($('#e-type'), err.message);
    actx.close().catch(() => {});
  }
});
$('#b-update').addEventListener('click', () => { const actx = newAudio(); cancelJob(); scrollTo({ top: 0, behavior: 'smooth' }); produce(actx); });
$('#b-again').addEventListener('click', () => { cancelJob(); show('s-type', 3); });

// Retouches : texte de chaque scène, visuel, musique.
const VISUAL = { site: 'Site demo', product: 'Product', detail: 'Close-up', footage: 'Clip' };
function buildEditor(used) {
  const ad = state.ad, box = $('#ed-scenes');
  box.textContent = '';
  const field = (parent, label, value, multi, onInput) => {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    parent.append(Object.assign(document.createElement('label'), { htmlFor: id, textContent: label }));
    const el = Object.assign(document.createElement(multi ? 'textarea' : 'input'), { id, value });
    if (multi) el.rows = 2;
    el.addEventListener('input', () => onInput(el.value.trim()));
    parent.append(el);
  };
  ad.scenes.forEach((s, i) => {
    if (i >= used.length) return;
    const card = Object.assign(document.createElement('div'), { className: 'edscene' });
    const swap = s.visual === 'footage' || s.visual === 'site';
    const t = Object.assign(document.createElement('button'), { type: 'button', className: 'thumb', disabled: !swap });
    const src = s.pick?.thumb || (s.photo >= 0 && s.visual !== 'footage' ? state.photoUrls[s.photo] : used[i]?.thumb);
    if (src) t.append(Object.assign(new Image(), { src, alt: '' }));
    t.append(Object.assign(document.createElement('em'), { textContent: swap ? 'Change' : VISUAL[s.visual] }));
    if (swap) { t.setAttribute('aria-label', `Scene ${i + 1}: change visual`); t.addEventListener('click', () => openPicker(i)); }
    const col = document.createElement('div');
    field(col, `Scene ${i + 1} · on-screen text`, s.headline, false, (v) => { s.headline = v || s.headline; });
    field(col, 'Voice-over and captions', s.voiceover, true, (v) => { s.voiceover = v; });
    card.append(t, col);
    box.append(card);
  });
  const end = Object.assign(document.createElement('div'), { className: 'edscene' });
  const col = document.createElement('div');
  col.style.gridColumn = '1 / -1';
  field(col, 'Final screen · button', ad.cta, false, (v) => { ad.cta = v || ad.cta; });
  field(col, 'Closing voice-over', ad.ctaVoiceover, true, (v) => { ad.ctaVoiceover = v; });
  end.append(col);
  box.append(end);
}

// Choix d'un autre visuel pour une scène : recherche libre, vidéos ou photos.
const picker = { scene: 0, kind: 'video' };
function openPicker(i) {
  picker.scene = i;
  $('#pk-q').value = state.ad.scenes[i].queries?.[0] || '';
  showResults(picker.kind === 'video' ? state.clipLists[i] || [] : []);
  if (picker.kind !== 'video') searchPicker();
  $('#picker').showModal();
}
function showResults(items) {
  const grid = $('#pk-grid');
  grid.textContent = '';
  $('#pk-msg').textContent = items.length ? '' : 'No result. Try simpler words, in English.';
  items.forEach((it) => {
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.setAttribute('aria-label', `Use this ${it.kind}`);
    b.append(Object.assign(new Image(), { src: it.thumb, alt: '', loading: 'lazy' }));
    if (it.hd) b.append(Object.assign(document.createElement('b'), { textContent: 'HD' }));
    b.addEventListener('click', () => { state.ad.scenes[picker.scene].pick = it; $('#picker').close(); buildEditor(state.used); });
    grid.append(b);
  });
}
async function searchPicker() {
  const q = $('#pk-q').value.trim();
  if (!q) return;
  $('#pk-msg').textContent = 'Searching…';
  $('#pk-grid').textContent = '';
  try {
    const { results } = await (await api('/api/videos', { scenes: [[q]], fallback: q, kind: picker.kind, hd: $('#res').value === '1080' })).json();
    showResults(results[0] || []);
  } catch { $('#pk-msg').textContent = 'Search is unavailable right now.'; }
}
$('#pk-go').addEventListener('click', searchPicker);
$('#pk-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPicker(); } });
$$('#picker .seg button').forEach((b) => b.addEventListener('click', () => {
  picker.kind = b.dataset.kind;
  $$('#picker .seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  searchPicker();
}));

/* ---------- musique ---------- */
const preview = { ctx: null, src: null };
function stopPreview() {
  try { preview.src?.stop(); } catch {}
  preview.src = null;
  $('#b-listen').textContent = 'Listen';
}
function setMusic(id) {
  stopPreview();
  state.music = id;
  $('#music').value = id;
}
(function initMusic() {
  const sel = $('#music');
  sel.append(new Option('No music', ''));
  const groups = {};
  Music.PRESETS.forEach((p) => {
    const g = (groups[p.mood] ||= sel.appendChild(Object.assign(document.createElement('optgroup'), { label: p.mood })));
    g.append(new Option(`${p.name} · ${p.bpm} bpm`, p.id));
  });
  sel.addEventListener('change', () => setMusic(sel.value));
  $('#b-listen').addEventListener('click', async () => {
    if (preview.src) return stopPreview();
    const p = Music.byId(state.music);
    if (!p) return;
    preview.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    await preview.ctx.resume().catch(() => {});
    $('#b-listen').textContent = '…';
    const buf = await Music.render(p, 12, preview.ctx.sampleRate);
    if (state.music !== p.id) return stopPreview();
    const src = (preview.src = preview.ctx.createBufferSource());
    src.buffer = buf; src.connect(preview.ctx.destination);
    src.onended = () => { if (preview.src === src) stopPreview(); };
    src.start();
    $('#b-listen').textContent = 'Stop';
  });
})();
// musique + voix : la musique baisse automatiquement pendant que la voix parle
function mixAudio(ctx, out, job, t0 = 0) {
  const rate = job.rate || 1;
  job.scenes.forEach((s) => {
    if (!s.voice) return;
    const n = ctx.createBufferSource();
    n.buffer = s.voice; n.playbackRate.value = rate; n.connect(out); n.start(t0 + s.start + 0.3);
  });
  if (!job.musicBuf) return;
  const g = ctx.createGain(), n = ctx.createBufferSource();
  g.gain.setValueAtTime(0.6, t0);
  job.scenes.forEach((s) => {
    if (!s.voice) return;
    g.gain.setTargetAtTime(0.2, t0 + s.start + 0.15, 0.08);
    g.gain.setTargetAtTime(0.6, t0 + s.start + 0.3 + s.voice.duration / rate, 0.18);
  });
  n.buffer = job.musicBuf; n.connect(g); g.connect(out); n.start(t0);
}

/* ---------- chargement des médias ---------- */
// Un plan différent par scène ; en vertical on préfère les vidéos tournées en vertical.
function pickClips(lists, portrait) {
  const used = new Set();
  return lists.map((list) => {
    const sorted = portrait ? [...list].sort((a, b) => (b.h > b.w) - (a.h > a.w)) : list;
    const c = sorted.find((x) => !used.has(x.id)) || sorted[0] || null;
    if (c) used.add(c.id);
    return c;
  });
}
const fetchBlob = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.blob();
};
function loadImage(src, min = 80) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth >= min ? im : null);
    im.onerror = () => res(null);
    im.src = src;
  });
}
async function loadLogo(list) {
  for (const l of list || []) {
    const img = await loadImage(l.url.startsWith('data:') ? l.url : media(l.url), 16);
    if (img) return { img, kind: l.kind };
  }
  return null;
}
// Couleurs dominantes du logo (teintes vives uniquement) : principale + secondaire si le logo en a deux.
function logoColors(img) {
  try {
    const n = 64, c = Object.assign(document.createElement('canvas'), { width: n, height: n });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data, bins = Array.from({ length: 24 }, () => [0, 0, 0, 0]);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i] / 255, gr = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), l = (mx + mn) / 2, dl = mx - mn;
      const sat = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
      if (sat < 0.3 || l > 0.9 || l < 0.12) continue; // blanc, noir, gris : ignorés
      const h = (mx === r ? ((gr - b) / dl + 6) % 6 : mx === gr ? (b - r) / dl + 2 : (r - gr) / dl + 4) * 4;
      const bin = bins[Math.floor(h) % 24];
      bin[0] += sat; bin[1] += d[i] * sat; bin[2] += d[i + 1] * sat; bin[3] += d[i + 2] * sat;
    }
    const order = bins.map((b, i) => ({ i, w: b[0], hex: '#' + [1, 2, 3].map((k) => Math.round(b[k] / (b[0] || 1)).toString(16).padStart(2, '0')).join('') })).sort((a, b) => b.w - a.w);
    if (order[0].w < 12) return null; // logo monochrome : on garde la palette proposée par l'IA
    const second = order.find((o) => o.w > order[0].w * 0.15 && Math.min(Math.abs(o.i - order[0].i), 24 - Math.abs(o.i - order[0].i)) >= 3);
    return second ? { primary: order[0].hex, accent: second.hex } : { primary: order[0].hex };
  } catch { return null; }
}
// Logo clair (blanc) : il lui faut une pastille sombre pour rester visible.
function logoIsLight(img) {
  try {
    const n = 48, c = Object.assign(document.createElement('canvas'), { width: n, height: n });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    let sum = 0, count = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; count++; }
    return count > 0 && count < n * n * 0.98 && sum / count > 205;
  } catch { return false; }
}
function loadVideoEl(blob) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    const done = (ok) => { clearTimeout(to); v.oncanplay = v.onerror = null; res(ok ? v : null); };
    const to = setTimeout(() => done(false), 15000);
    v.oncanplay = () => done(true);
    v.onerror = () => done(false);
    v.src = URL.createObjectURL(blob);
    v.load();
  });
}
async function loadVoice(text, lang) {
  const buf = await (await api('/api/tts', { text, lang })).arrayBuffer();
  return new Promise((ok, ko) => new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf, ok, ko));
}

// Détourage fidèle : on retire uniquement le fond uni (blanc, gris…) relié aux bords de la photo.
// Le produit lui-même n'est jamais modifié ni régénéré. Renvoie null si le fond n'est pas uni.
function cutout(img) {
  // on travaille à la résolution d'origine (2000 px au plus) : aucun rééchantillonnage, donc aucune perte de netteté
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  let px;
  try { px = g.getImageData(0, 0, w, h); } catch { return null; }
  const d = px.data, border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  let r = 0, gr = 0, b = 0, clear = 0;
  for (const i of border) { r += d[i * 4]; gr += d[i * 4 + 1]; b += d[i * 4 + 2]; if (d[i * 4 + 3] < 40) clear++; }
  if (clear > border.length * 0.6) return trim(c, d, w, h); // PNG déjà détouré
  r /= border.length; gr /= border.length; b /= border.length;
  const far = (i, t) => Math.abs(d[i * 4] - r) + Math.abs(d[i * 4 + 1] - gr) + Math.abs(d[i * 4 + 2] - b) > t;
  if (border.filter((i) => far(i, 60)).length > border.length * 0.12) return null; // fond non uni : photo d'ambiance
  const bg = new Uint8Array(w * h), stack = [];
  for (const i of border) if (!far(i, 54) && !bg[i]) { bg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      if (j >= 0 && j < w * h && !bg[j] && !far(j, 54)) { bg[j] = 1; stack.push(j); }
    }
  }
  let kept = 0;
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) d[i * 4 + 3] = 0;
    else kept++;
  }
  // bord : transparence proportionnelle à l'écart avec le fond, et couleur débarrassée du liseré du fond
  const bgc = [r, gr, b];
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) continue;
    const x = i % w;
    if (!(bg[i - w] || bg[i + w] || (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]))) continue;
    const dist = Math.abs(d[i * 4] - r) + Math.abs(d[i * 4 + 1] - gr) + Math.abs(d[i * 4 + 2] - b);
    const a = Math.max(0.35, Math.min(1, (dist - 40) / 140));
    for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.max(0, Math.min(255, (d[i * 4 + ch] - (1 - a) * bgc[ch]) / a));
    d[i * 4 + 3] = Math.round(a * 255);
  }
  if (kept < w * h * 0.04 || kept > w * h * 0.93) return null;
  g.putImageData(px, 0, 0);
  return trim(c, d, w, h);
}
function trim(c, d, w, h) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 - x0 < 20 || y1 - y0 < 20) return null;
  const out = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 4, height: y1 - y0 + 4 });
  out.getContext('2d').drawImage(c, x0 - 2, y0 - 2, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------- dessin ---------- */
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
const backOut = (x) => { x = clamp(x); return 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2); };
const FONT = 'Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (hex, to, k) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(',')})`; };
function onColor(hex) {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#101010' : '#ffffff';
}
function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,;:.!?]*$/, '…'); }
  return lines;
}
// Sous-titres mot à mot : la voix ne fournit pas de minutage, on le répartit selon la longueur des mots.
function karaoke(text, speech, lead) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = words.map((w) => w.length + 2 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weight.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const timed = words.map((w, i) => { const t0 = lead + (acc / sum) * speech; acc += weight[i]; return { w, t0, t1: lead + (acc / sum) * speech }; });
  const chunks = [];
  let cur = [];
  for (const x of timed) {
    if (cur.length && (cur.length >= 4 || cur.map((y) => y.w).join(' ').length + x.w.length > 22)) { chunks.push(cur); cur = []; }
    cur.push(x);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const DECOR = {
  studio: { wall: ['#f6f6f4', '#e3e3df'], floor: ['#d9d9d4', '#bfbfb9'], light: 'rgba(255,255,255,.9)' },
  warm: { wall: ['#f1e4d2', '#e2cbae'], floor: ['#bd946a', '#8c6845'], light: 'rgba(255,244,226,.85)' },
  dark: { wall: ['#2a2c33', '#17181c'], floor: ['#121317', '#060709'], light: 'rgba(255,255,255,.16)' },
};
const TRANSITIONS = ['flash', 'whip', 'zoom', 'slideU', 'wipe'];
const TRANS = 0.38;

function makeRenderer(cv, job) {
  const S = job.scale, main = cv.getContext('2d');
  const [W, H] = job.size;
  const layer = Object.assign(document.createElement('canvas'), { width: cv.width, height: cv.height });
  const tmp = document.createElement('canvas'), refl = document.createElement('canvas');
  let ctx = main;
  const { scenes, plan, shot, logo } = job;
  const P = plan.palette.primary, A = plan.palette.accent;
  const wide = W > H, square = W === H;
  const pad = wide ? 64 : 44;
  const textW = wide ? W * 0.5 : W - pad * 2;
  const headSize = wide ? 56 : square ? 52 : 62;
  const lh = headSize * 1.3;
  const bottom = H - (wide ? 70 : square ? 64 : H * 0.115);
  const decor = plan.decor === 'pastel'
    ? { wall: [mix(P, '#ffffff', 0.86), mix(P, '#ffffff', 0.7)], floor: [mix(P, '#ffffff', 0.58), mix(P, '#ffffff', 0.4)], light: 'rgba(255,255,255,.8)' }
    : DECOR[plan.decor] || DECOR.studio;

  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  const coverDraw = (src, sw, sh, zoom, fx = 0.5, fy = 0.5) => {
    const s = Math.max(W / sw, H / sh) * zoom;
    ctx.drawImage(src, clamp(fx) * (W - sw * s), clamp(fy) * (H - sh * s), sw * s, sh * s);
  };

  /* ----- fonds ----- */
  function footage(sc, k) {
    // coup de zoom à l'entrée de la scène, puis lent travelling avant
    const punch = 0.09 * (1 - easeOut((k * sc.dur) / 0.45));
    if (sc.still) return coverDraw(sc.still, sc.still.naturalWidth, sc.still.naturalHeight, 1.05 + 0.1 * k + punch, 0.5, lerp(0.42, 0.58, k));
    const src = sc.frame || (sc.video && sc.video.readyState >= 2 && sc.video.videoWidth ? sc.video : null);
    if (src) return coverDraw(src, src.videoWidth || src.width, src.videoHeight || src.height, 1.03 + 0.07 * k + punch);
    const g = ctx.createLinearGradient(0, 0, W * (0.4 + 0.6 * k), H);
    g.addColorStop(0, P); g.addColorStop(1, '#0b0920');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // décor de studio : mur, sol, halo de lumière. Léger travelling avant pendant la scène.
  function studio(k) {
    const hz = H * (wide ? 0.66 : 0.6), z = 1 + 0.05 * k;
    ctx.save();
    ctx.translate(W / 2, hz); ctx.scale(z, z); ctx.translate(-W / 2, -hz);
    let g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, decor.wall[0]); g.addColorStop(1, decor.wall[1]);
    ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, hz + 40);
    g = ctx.createLinearGradient(0, hz, 0, H);
    g.addColorStop(0, decor.floor[0]); g.addColorStop(1, decor.floor[1]);
    ctx.fillStyle = g; ctx.fillRect(-40, hz, W + 80, H - hz + 40);
    const lx = W * (0.5 + 0.06 * (k - 0.5));
    g = ctx.createRadialGradient(lx, hz * 0.62, 10, lx, hz * 0.62, Math.max(W, H) * 0.62);
    g.addColorStop(0, decor.light); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80);
    if (plan.decor === 'dark') {
      g = ctx.createRadialGradient(W * 0.5, hz, 0, W * 0.5, hz, W * 0.7);
      g.addColorStop(0, A + '55'); g.addColorStop(1, A + '00');
      ctx.fillStyle = g; ctx.fillRect(0, hz - H * 0.3, W, H * 0.6);
    }
    ctx.restore();
  }
  function background(sc, k) {
    const ph = sc.ph;
    if (sc.visual === 'detail' && ph) return coverDraw(ph.img, ph.img.naturalWidth, ph.img.naturalHeight, 1.75 + 0.3 * k, lerp(0.3, 0.7, easeInOut(k)), lerp(0.38, 0.62, easeInOut(k)));
    if ((sc.visual === 'product' || (sc.kind === 'cta' && plan.type === 'ecom')) && ph && ph.cut && job.backdrop) return coverDraw(job.backdrop, job.backdrop.naturalWidth, job.backdrop.naturalHeight, 1.02 + 0.07 * k, 0.5 + 0.1 * (k - 0.5), 0.6);
    if ((sc.visual === 'product' || (sc.kind === 'cta' && plan.type === 'ecom')) && ph) return ph.cut ? studio(k) : coverDraw(ph.img, ph.img.naturalWidth, ph.img.naturalHeight, 1.04 + 0.1 * k, 0.5, lerp(0.42, 0.58, k));
    footage(sc, k);
  }

  /* ----- visuels ----- */
  // zone libre pour le visuel : au-dessus du texte, ou à droite en 16:9
  const heroBox = (textTop) => (wide
    ? { x: W * 0.56, y: 84, w: W * 0.44 - pad, h: H - 150 }
    : { x: pad, y: 122, w: W - pad * 2, h: textTop - 122 - 30 });

  function product(ph, box, local, k) {
    const c = ph.cut, f = Math.min(box.w / c.width, box.h / c.height) * 0.94;
    const e = backOut((local - 0.1) / 0.6), z = (1 + 0.08 * k) * (0.86 + 0.14 * e);
    const w = c.width * f * z, h = c.height * f * z;
    const x = box.x + (box.w - w) / 2 + (k - 0.5) * 16, y = box.y + box.h - h - box.h * 0.03 + (1 - e) * 40;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = clamp((local - 0.05) / 0.3);
    if (job.backdrop) {
      // halo de lumière derrière le produit et reflet sur le sol brillant
      const gl = ctx.createRadialGradient(x + w / 2, y + h * 0.5, 0, x + w / 2, y + h * 0.5, Math.max(w, h) * 0.75);
      gl.addColorStop(0, A + '40'); gl.addColorStop(1, A + '00');
      ctx.fillStyle = gl; ctx.fillRect(x - w, y - h * 0.5, w * 3, h * 2);
      const rh = Math.min(h * 0.4, H - (y + h));
      if (rh > 20) {
        refl.width = Math.ceil(w * S); refl.height = Math.ceil(rh * S);
        const t = refl.getContext('2d');
        t.save(); t.translate(0, h * S); t.scale(1, -1); t.drawImage(c, 0, 0, refl.width, h * S); t.restore();
        t.globalCompositeOperation = 'destination-in';
        const fade = t.createLinearGradient(0, 0, 0, refl.height);
        fade.addColorStop(0, 'rgba(0,0,0,.3)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
        t.fillStyle = fade; t.fillRect(0, 0, refl.width, refl.height);
        ctx.drawImage(refl, x, y + h - 3, w, rh);
      }
    }
    // ombre de contact au sol
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.55);
    sh.addColorStop(0, 'rgba(0,0,0,.34)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(x + w / 2, y + h - 2); ctx.scale(1, 0.13); ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, w * 0.55, 0, 7); ctx.fill(); ctx.restore();
    // reflet de lumière qui balaie le produit, limité à sa silhouette
    const sweep = (local - 0.9) / 0.9;
    if (sweep > 0 && sweep < 1) {
      tmp.width = Math.ceil(w * S); tmp.height = Math.ceil(h * S);
      const t = tmp.getContext('2d');
      t.drawImage(c, 0, 0, tmp.width, tmp.height);
      t.globalCompositeOperation = 'source-atop';
      const gx = lerp(-0.4, 1.2, sweep) * tmp.width, g = t.createLinearGradient(gx, 0, gx + tmp.width * 0.3, tmp.height * 0.3);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      t.fillStyle = g; t.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(tmp, x, y, w, h);
    } else ctx.drawImage(c, x, y, w, h);
    ctx.restore();
    return { x, y, w, h };
  }
  function pill(text, cx, cy, local, size = 26) {
    const k = backOut((local - 0.9) / 0.45);
    if (k <= 0 || !text) return;
    ctx.save();
    ctx.font = `600 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 2.1, h = size * 2;
    ctx.translate(clamp((cx - w / 2 - pad) / (W - w - pad * 2)) * (W - w - pad * 2) + pad + w / 2, cy); ctx.scale(k, k);
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff'; rr(-w / 2, -h / 2, w, h, h / 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = P; ctx.beginPath(); ctx.arc(-w / 2 + size * 0.8, 0, size * 0.22, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillText(text, size * 0.45, 1);
    ctx.restore();
  }

  // Le vrai site dans un téléphone, deux mises en scène : démo droite, puis vue inclinée.
  function phone(box, local, dur, variant) {
    let h = Math.min(box.h, 760), w = h * 0.5;
    if (w > box.w) { w = box.w; h = Math.min(box.h, w * 2); }
    if (h < 150) return;
    const p = clamp(local / dur), enter = easeOut((local - 0.05) / 0.6);
    let rot = 0, shx = 0, shy = 0, sc = 1, dy = 0;
    if (variant === 0) {
      // démo : téléphone bien droit, la page défile, léger zoom caméra
      sc = 1 + 0.07 * easeInOut(p);
    } else {
      // vue inclinée avec relief, qui pivote doucement
      const a = easeInOut(p);
      shx = lerp(0.46, 0.3, a); shy = lerp(-0.27, -0.17, a); rot = lerp(-0.1, -0.04, a);
      sc = lerp(0.8, 0.9, a);
    }
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const x = cx - w / 2, y = cy - h / 2, b = Math.max(8, w * 0.03), r = w * 0.11;
    ctx.save();
    ctx.globalAlpha = enter;
    ctx.translate(cx, cy + dy + (1 - enter) * 120);
    ctx.transform(1, shy, shx, 1, 0, 0); ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    // tranche du téléphone (donne le relief quand il est incliné)
    const depth = Math.round(Math.abs(shx) * 34);
    for (let i = depth; i > 0; i--) { ctx.fillStyle = '#2a2b30'; rr(x - i * 0.9, y + i * 0.55, w, h, r); ctx.fill(); }
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22;
    ctx.fillStyle = '#0b0b0d'; rr(x, y, w, h, r); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save();
    rr(x + b, y + b, w - b * 2, h - b * 2, r - b); ctx.clip();
    const sw = w - b * 2, sh = h - b * 2, full = shot.naturalHeight * (sw / shot.naturalWidth);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + b, y + b, sw, sh);
    ctx.drawImage(shot, x + b, y + b - Math.max(0, Math.min(full - sh, sh * 1.1)) * easeInOut((local - 0.7) / Math.max(dur - 1.2, 1)), sw, full);
    // reflet de l'écran
    const gl = ctx.createLinearGradient(x, y, x + w, y + h * 0.6);
    gl.addColorStop(0, 'rgba(255,255,255,.14)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = '#0b0b0d'; rr(cx - w * 0.14, y + b + 8, w * 0.28, Math.max(10, w * 0.055), 20); ctx.fill();
    ctx.restore();
  }

  const logoRatio = logo ? clamp(((logo.naturalWidth || 1) / (logo.naturalHeight || 1) - 1) / 2) * 2 + 1 : 1; // 1 (carré) à 3 (logo horizontal)
  const logoWide = logoRatio > 1.7;
  // dessine le logo dans une pastille de hauteur donnée ; renvoie sa largeur
  function logoTile(x, y, size, centered = false) {
    const w = size * (logoWide ? Math.min(logoRatio, 2.8) : 1);
    if (centered) x -= w / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.08;
    ctx.fillStyle = job.logoLight ? '#14121f' : '#fff'; rr(x, y, w, size, size * 0.24); ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(x, y, w, size, size * 0.24); ctx.clip();
    const iw = logo.naturalWidth || size, ih = logo.naturalHeight || size, square = Math.abs(iw - ih) < iw * 0.15;
    const f = Math.min(w / iw, size / ih) * (square && !job.logoIcon ? 1 : 0.74);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, x + (w - iw * f) / 2, y + (size - ih * f) / 2, iw * f, ih * f);
    ctx.restore();
    return w;
  }

  /* ----- scènes ----- */
  function scene(sc, local) {
    const k = clamp(local / sc.dur), ph = sc.ph;
    const onDecor = sc.visual === 'product' && ph && ph.cut;
    const hero = (sc.visual === 'site' && shot) || onDecor;
    let g = ctx.createLinearGradient(0, 0, 0, H);
    if (onDecor) { g.addColorStop(0, 'rgba(0,0,0,.32)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); }
    else { g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.3, `rgba(0,0,0,${hero ? 0.45 : 0.05})`); g.addColorStop(0.55, `rgba(0,0,0,${hero ? 0.5 : 0.25})`); g.addColorStop(1, 'rgba(0,0,0,.9)'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.font = `800 ${headSize}px ${FONT}`;
    const lines = wrap(ctx, sc.headline, textW - 36, 3);
    const top = bottom - 78 - lines.length * lh;
    const box = heroBox(top);
    if (sc.visual === 'site' && shot) phone(box, local, sc.dur, sc.variant);
    if (onDecor) { const r = product(ph, box, local, k); pill(sc.badge, r.x + r.w * 0.82, Math.max(box.y + 30, r.y + r.h * 0.12), local); }
    else if (sc.badge) pill(sc.badge, W / 2, wide ? H * 0.3 : H * 0.36, local, 30);

    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
    const tx = wide ? pad + textW / 2 : W / 2;
    // sous-titres : petit groupe de mots centré, le mot prononcé grossit et prend la couleur d'accent
    const chunk = sc.words.find((c) => local < c[c.length - 1].t1 + 0.2) || null;
    if (chunk && local >= chunk[0].t0 - 0.1) {
      const size = wide ? 38 : 44;
      ctx.font = `800 ${size}px ${FONT}`;
      const texts = chunk.map((wd) => wd.w.toUpperCase()), widths = texts.map((t) => ctx.measureText(t).width + size * 0.42);
      const total = widths.reduce((a, b2) => a + b2, 0), fit = Math.min(1, (textW + 20) / total);
      const inK = backOut((local - chunk[0].t0 + 0.1) / 0.18);
      let x = tx - (total * fit) / 2;
      ctx.lineJoin = 'round';
      chunk.forEach((wd, n) => {
        const on = local >= wd.t0 && local < wd.t1, pop = on ? 1 + 0.14 * (1 - easeOut((local - wd.t0) / 0.16)) + 0.06 : 1;
        const cxw = x + (widths[n] * fit) / 2;
        ctx.save();
        ctx.translate(cxw, bottom); ctx.scale(fit * pop * (0.7 + 0.3 * inK), fit * pop * (0.7 + 0.3 * inK));
        ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(texts[n], 0, 0);
        ctx.fillStyle = on ? A : local >= wd.t1 ? '#fff' : 'rgba(255,255,255,.7)';
        ctx.fillText(texts[n], 0, 0);
        ctx.restore();
        x += widths[n] * fit;
      });
    }
    // titre en bandeaux de couleur : chaque ligne arrive en rebond, légèrement penchée, puis se redresse
    ctx.font = `800 ${headSize}px ${FONT}`;
    lines.forEach((l, i) => {
      const e = backOut((local - 0.1 - i * 0.12) / 0.38);
      if (e <= 0) return;
      const last = i === lines.length - 1, w = ctx.measureText(l).width + 36;
      ctx.save();
      ctx.globalAlpha = clamp(e * 1.4);
      ctx.translate(tx, top + i * lh + (lh - 8) / 2);
      ctx.rotate((1 - Math.min(1, e)) * (i % 2 ? 0.07 : -0.07) + (i % 2 ? 0.012 : -0.012));
      ctx.scale(0.55 + 0.45 * e, 0.55 + 0.45 * e);
      ctx.fillStyle = last ? A : P;
      rr(-w / 2, -(lh - 8) / 2, w, lh - 8, 14); ctx.fill();
      ctx.fillStyle = onColor(last ? A : P);
      ctx.fillText(l, 0, headSize * 0.36);
      ctx.restore();
    });
  }

  function cta(sc, local) {
    const ph = sc.ph, ecom = plan.type === 'ecom' && ph;
    const cx = ecom && wide ? W * 0.7 : W / 2, maxW = ecom && wide ? W * 0.5 : W - pad * 2;
    let g;
    if (ecom && ph.cut) {
      g = ctx.createLinearGradient(0, H * (wide ? 0 : 0.36), 0, H);
      g.addColorStop(0, wide ? 'rgba(8,10,12,.5)' : 'rgba(8,10,12,0)'); g.addColorStop(wide ? 1 : 0.42, 'rgba(8,10,12,.9)'); g.addColorStop(1, 'rgba(8,10,12,.96)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const box = wide ? { x: pad, y: 90, w: W * 0.42, h: H - 190 } : { x: pad, y: 110, w: W - pad * 2, h: H * 0.5 - 130 };
      const r = product(ph, box, local, clamp(local / sc.dur));
      if (plan.price) pill(plan.price, r.x + r.w * 0.85, r.y + r.h * 0.1, local - 0.3, 34);
    } else {
      ctx.fillStyle = 'rgba(8,6,18,.66)'; ctx.fillRect(0, 0, W, H);
      g = ctx.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, P + 'cc');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (plan.price) pill(plan.price, W / 2, H * 0.2, local - 0.3, 34);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let y = H * (ecom && ph.cut && !wide ? 0.63 : 0.46);
    const k1 = easeOut(local / 0.45);
    if (logo) { const full = job.logoIcon ? 62 : 104, s = full * backOut(local / 0.5); if (s > 2) logoTile(cx, y - 96 - full - (s - full) / 2, s, true); }
    let size = wide ? 88 : 80;
    ctx.font = `800 ${size}px ${FONT}`;
    const bw = ctx.measureText(plan.brand).width;
    if (bw > maxW) { size *= maxW / bw; ctx.font = `800 ${size}px ${FONT}`; }
    ctx.globalAlpha = k1; ctx.fillStyle = '#fff';
    ctx.fillText(plan.brand, cx, y + (1 - k1) * 30);
    ctx.font = `600 30px ${FONT}`;
    ctx.globalAlpha = easeOut((local - 0.2) / 0.45) * 0.92;
    y += 14;
    wrap(ctx, plan.tagline, Math.min(maxW, 760), 2).forEach((l) => { y += 44; ctx.fillText(l, cx, y); });
    const k3 = backOut((local - 0.45) / 0.45);
    if (k3 > 0) {
      ctx.font = `800 36px ${FONT}`;
      const bwid = Math.min(maxW, ctx.measureText(sc.headline).width + 96), bh = 88;
      const s = k3 * (1 + 0.035 * Math.sin(local * 5));
      ctx.save();
      ctx.translate(cx, y + 100); ctx.scale(s, s);
      ctx.globalAlpha = clamp(k3);
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
      ctx.fillStyle = A; rr(-bwid / 2, -bh / 2, bwid, bh, bh / 2); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = onColor(A); ctx.fillText(sc.headline, 0, 13, bwid - 40);
      ctx.restore();
    }
    ctx.globalAlpha = easeOut((local - 0.8) / 0.4) * 0.85;
    ctx.font = `600 27px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.fillText(job.host, cx, y + 192);
    ctx.globalAlpha = 1;
  }

  function chrome(t, idx) {
    const gap = 6, bw = (W - pad * 2 - gap * (scenes.length - 1)) / scenes.length;
    scenes.forEach((s, i) => {
      const x = pad + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; rr(x, 30, bw, 5, 3); ctx.fill();
      const f = clamp((t - s.start) / s.dur);
      if (f > 0) { ctx.fillStyle = '#fff'; rr(x, 30, bw * f, 5, 3); ctx.fill(); }
    });
    if (scenes[idx].kind === 'cta') return;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let x = pad;
    if (logo) { x += logoTile(pad, 56, 44) + 12; if (logoWide) return; }
    else { ctx.fillStyle = P; ctx.beginPath(); ctx.arc(pad + 14, 78, 14, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); x += 40; }
    ctx.font = `600 27px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
    ctx.fillText(plan.brand, x, 80);
    ctx.shadowBlur = 0;
  }

  function full(sc, local) {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    background(sc, clamp(local / sc.dur));
    (sc.kind === 'cta' ? cta : scene)(sc, local);
  }

  return function draw(t) {
    const idx = sceneAt(scenes, t), sc = scenes[idx], local = t - sc.start;
    if (idx > 0 && local < TRANS) {
      // transition : la scène précédente reste dessous, la nouvelle arrive par-dessus
      const prev = scenes[idx - 1], e = easeInOut(local / TRANS), kind = sc.kind === 'cta' ? 'wipe' : TRANSITIONS[(idx - 1) % TRANSITIONS.length];
      ctx = layer.getContext('2d'); full(sc, local);
      ctx = main; full(prev, prev.dur);
      ctx.fillStyle = `rgba(0,0,0,${0.45 * e})`; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (kind === 'flash') { ctx.globalAlpha = clamp(e * 2); ctx.translate(W / 2, H / 2); ctx.scale(1.12 - 0.12 * e, 1.12 - 0.12 * e); ctx.translate(-W / 2, -H / 2); }
      else if (kind === 'whip') {
        // balayage rapide avec traînée : quelques copies décalées donnent le flou de mouvement
        for (let n = 3; n >= 1; n--) { ctx.globalAlpha = 0.22; ctx.drawImage(layer, W * (1 - e) + n * 46 * (1 - e), 0, W, H); }
        ctx.globalAlpha = 1; ctx.translate(W * (1 - e), 0);
      }
      else if (kind === 'slideU') ctx.translate(0, H * (1 - e));
      else if (kind === 'zoom') { ctx.globalAlpha = clamp(e * 1.6); ctx.translate(W / 2, H / 2); ctx.scale(1.35 - 0.35 * e, 1.35 - 0.35 * e); ctx.translate(-W / 2, -H / 2); }
      else { ctx.beginPath(); ctx.arc(W / 2, H * 0.55, e * Math.hypot(W, H) * 0.62, 0, 7); ctx.clip(); }
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();
      if (kind === 'flash') { ctx.fillStyle = `rgba(255,255,255,${0.55 * Math.sin(Math.PI * clamp(local / TRANS))})`; ctx.fillRect(0, 0, W, H); }
      if (kind === 'wipe' && e < 1) { ctx.strokeStyle = A; ctx.lineWidth = 10 * (1 - e) + 2; ctx.beginPath(); ctx.arc(W / 2, H * 0.55, e * Math.hypot(W, H) * 0.62, 0, 7); ctx.stroke(); }
    } else { ctx = main; full(sc, local); }
    chrome(t, idx);
    return idx;
  };
}
function sceneAt(scenes, t) {
  const i = scenes.findIndex((s) => t < s.start + s.dur);
  return i < 0 ? scenes.length - 1 : i;
}

/* ---------- montage ---------- */
const status = (msg, pct) => { $('#st-status').textContent = msg; if (pct != null) $('#st-bar').style.width = pct + '%'; };
const FPS = 30;

// Durées des scènes. Avec une durée imposée, le total tombe juste à l'image près :
// on étire les scènes s'il reste du temps, sinon on accélère un peu la voix (30 % au plus).
function timeline(scenes, target) {
  const min = (s) => (s.kind === 'cta' ? 2.6 : 2.2);
  let rate = 1, durs = scenes.map((s) => Math.max(s.kind === 'cta' ? 3.2 : 2.6, s.speech + 0.8));
  let sum = durs.reduce((a, b) => a + b, 0);
  if (target) {
    if (sum > target) {
      const speech = scenes.reduce((a, s) => a + s.speech, 0);
      rate = Math.min(1.3, Math.max(1, speech / Math.max(1, target - scenes.length * 0.55)));
      durs = scenes.map((s) => Math.max(min(s), s.speech / rate + 0.55));
      sum = durs.reduce((a, b) => a + b, 0);
    }
    durs = durs.map((d) => (d * target) / sum);
  }
  let f = 0, acc = 0;
  scenes.forEach((s, i) => {
    acc += durs[i];
    const end = Math.round(acc * FPS);
    s.start = f / FPS; s.dur = (end - f) / FPS; f = end;
  });
  return { total: f / FPS, rate };
}

// Export image par image avec Mediabunny (WebCodecs) : vrai MP4, fluide même sur un téléphone lent.
async function exportOffline(job, cv, draw, hasAudio) {
  const MB = job.MB;
  const format = new MB.Mp4OutputFormat({ fastStart: 'in-memory' });
  const vcodec = await MB.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'].filter((c) => format.getSupportedCodecs().includes(c)), { width: cv.width, height: cv.height });
  if (!vcodec) return null;
  const acodec = hasAudio ? await MB.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 }) : null;
  const output = new MB.Output({ format, target: new MB.BufferTarget() });
  const vsrc = new MB.CanvasSource(cv, { codec: vcodec, bitrate: job.scale > 1 ? 9e6 : 5e6, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  const asrc = acodec ? new MB.AudioBufferSource({ codec: acodec, bitrate: 128e3 }) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();
  if (asrc) {
    const off = new OfflineAudioContext(2, Math.ceil(job.total * 48000), 48000);
    mixAudio(off, off.destination, job);
    await asrc.add(await off.startRendering());
  }
  const frames = Math.round(job.total * FPS);
  for (let f = 0; f < frames; f++) {
    if (job.cancelled) { await output.cancel().catch(() => {}); return null; }
    const t = f / FPS, i = sceneAt(job.scenes, t), sc = job.scenes[i];
    if (sc.clip) sc.frame = await clipFrame(sc.clip, t - sc.start);
    draw(t);
    await vsrc.add(t, 1 / FPS);
    if (f % 10 === 0) { status(`Rendering… ${Math.round((f / frames) * 100)}%`, (f / frames) * 100); await new Promise((r) => setTimeout(r)); }
  }
  await output.finalize();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

// image du plan à l'instant t (en boucle si le plan est plus court que la scène)
async function clipFrame(c, t) {
  const tt = t % Math.max(c.duration - 0.2, 0.5);
  if (!c.iter || tt < c.at) {
    await c.iter?.return?.();
    c.iter = c.sink.canvases(tt);
    c.next = null;
  }
  c.at = tt;
  for (;;) {
    if (!c.next) {
      const r = await c.iter.next();
      if (r.done) break;
      c.next = r.value;
    }
    if (c.next.timestamp > tt && c.cur) break;
    c.cur = c.next; c.next = null;
  }
  return c.cur ? c.cur.canvas : null;
}
async function openClip(MB, blob, w, h) {
  try {
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    return { input, sink: new MB.CanvasSink(track, { width: w, height: h, fit: 'cover', poolSize: 3 }), duration: await track.computeDuration(), at: 0 };
  } catch { return null; }
}

// Secours pour les navigateurs sans WebCodecs : enregistrement en temps réel.
async function exportRealtime(job, cv, draw) {
  if (!(window.MediaRecorder && cv.captureStream)) return null;
  const { actx, scenes } = job;
  const dest = actx.createMediaStreamDestination();
  await actx.resume().catch(() => {});
  const stream = cv.captureStream(FPS);
  dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  draw(0);
  if (scenes[0].video) await scenes[0].video.play().catch(() => {});
  mixAudio(actx, dest, job, actx.currentTime + 0.1);
  rec.start(500);
  const t0 = performance.now() + 100;
  let cur = 0;
  await new Promise((finish) => {
    (function frame() {
      const now = Math.max(0, (performance.now() - t0) / 1000);
      if (job.cancelled || now >= job.total) return finish();
      const idx = draw(now);
      if (idx !== cur) {
        const prev = scenes[cur].video, next = scenes[idx].video;
        if (next && next !== prev) { try { next.currentTime = 0; } catch {} next.play().catch(() => {}); }
        if (prev && prev !== next) setTimeout(() => prev.pause(), 600);
        cur = idx;
      }
      status(`Recording… ${Math.ceil(job.total - now)} s`, (now / job.total) * 100);
      requestAnimationFrame(frame);
    })();
  });
  scenes.forEach((s) => s.video?.pause());
  await new Promise((ok) => { rec.onstop = ok; setTimeout(() => rec.stop(), 250); });
  return job.cancelled ? null : new Blob(chunks, { type: (rec.mimeType || 'video/webm').split(';')[0] });
}

const cached = (map, key, make) => { if (!map.has(key)) map.set(key, make().catch((e) => { map.delete(key); throw e; })); return map.get(key); };

async function produce(actx) {
  const plan = state.plan, page = state.page, ad = state.ad, cache = state.cache;
  stopPreview();
  const [W, H] = FORMATS[state.fmt], scale = +$('#res').value / 720, target = +$('#dur').value;
  const job = (state.job = { cancelled: false, actx, plan, host: page.host, size: [W, H], scale });
  const cv = $('#cv'), result = $('#result');
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  result.pause();
  cv.hidden = false; result.hidden = true; result.removeAttribute('src');
  $('#st-actions').hidden = $('#editor').hidden = $('#b-again').hidden = true;

  // formats courts : moins de scènes, pour que chacune reste lisible
  const keep = target && target <= 10 ? 2 : target && target <= 15 ? 3 : ad.scenes.length;
  const scenes = (job.scenes = [...ad.scenes.slice(0, keep).map((s) => ({ ...s })), { kind: 'cta', visual: 'cta', photo: -1, headline: ad.cta, voiceover: ad.ctaVoiceover }]);
  // SaaS : nombre de scènes en vidéo choisi par l'utilisateur ; les autres montrent le site
  const stock = plan.type === 'saas' ? +$('#stock').value : -1;
  if (stock >= 0) {
    const order = [0, 3, 2, 1, 4].filter((i) => i < keep).slice(0, stock);
    scenes.forEach((s, i) => { if (!s.kind) s.visual = order.includes(i) ? 'footage' : 'site'; });
  }
  // le téléphone n'apparaît que deux fois : une démo bien droite, puis une vue inclinée
  let site = 0;
  scenes.forEach((s) => { if (s.visual === 'site') { if (site < 2) s.variant = site++; else s.visual = 'footage'; } });
  const needClip = (s) => s.visual === 'footage' || s.visual === 'site';
  const photoIds = [...new Set(plan.type === 'ecom' ? [...scenes.map((s) => s.photo), ...plan.photos.filter((p) => p.usable).map((p) => p.index)].filter((i) => i >= 0) : [])].slice(0, 5);
  let done = 0;
  const tasks = scenes.length * 2 + photoIds.length + 3;
  const MSG = plan.type === 'ecom' ? 'Preparing product photos and voice-over…' : 'Preparing visuals and voice-over…';
  const tick = (p) => p.then((v) => { status(MSG, 12 + (++done / tasks) * 30); return v; }, () => { status(MSG, 12 + (++done / tasks) * 30); return null; });
  status(MSG, 12);

  try {
    job.MB = window.VideoEncoder ? await import('/vendor/mediabunny.min.mjs').catch(() => null) : null;
    const lite = navigator.connection && (navigator.connection.saveData || /2g|3g/.test(navigator.connection.effectiveType || ''));
    // visuel de chaque scène : celui choisi à la main, sinon le meilleur résultat de la recherche
    const auto = pickClips(state.clipLists || [], H > W);
    const used = (state.used = scenes.map((s, i) => (s.kind ? null : s.pick || auto[i] || null)));
    const voice = (text) => (text ? cached(cache.voice, plan.language + '|' + text, () => loadVoice(text, plan.language)) : Promise.resolve(null));
    const [blobs, stills, voices, shot, brand, photos] = await Promise.all([
      Promise.all(scenes.map((s, i) => tick(used[i]?.kind === 'video' && needClip(s) ? cached(cache.blob, used[i].url, () => fetchBlob(media(lite ? used[i].lite : used[i].url))) : Promise.resolve(null)))),
      Promise.all(scenes.map((s, i) => (used[i]?.kind === 'photo' && needClip(s) ? loadImage(media(used[i].url)) : null))),
      Promise.all(scenes.map((s) => tick(voice(s.voiceover)))),
      tick(site ? (cache.shot ||= loadImage('/api/shot?u=' + encodeURIComponent(page.url))) : Promise.resolve(null)),
      tick(state.logo),
      Promise.all(photoIds.map((i) => tick(loadImage(state.photoUrls[i])))),
      tick(Promise.all([document.fonts.load('800 60px Poppins'), document.fonts.load('600 30px Poppins')])),
    ]);
    if (job.cancelled) return;
    job.shot = shot; job.logo = brand?.img || null; job.logoLight = !!brand?.light; job.logoIcon = brand?.kind === 'icon' || (brand?.img.naturalWidth || 0) < 64;

    // photos produit : détourage quand le fond est uni, sinon la photo est utilisée telle quelle
    const byId = new Map();
    photos.forEach((img, n) => { if (img) byId.set(photoIds[n], (cache['cut' + state.photoUrls[photoIds[n]]] ||= { img, cut: cutout(img) })); });
    const ready = [...byId.values()], best = ready.find((p) => p.cut) || ready[0] || null;
    // décor sur mesure généré par IA, seulement s'il y a un produit détouré à poser dessus
    if (best?.cut && $('#bgai').value === '1') {
      status('Creating the custom backdrop…');
      plan.backdrops ||= {};
      plan.backdrops[state.fmt] ||= api('/api/backdrop', { decor: plan.decor, scene: plan.backdrop, category: plan.category, accent: plan.palette.accent, format: state.fmt })
        .then((r) => r.blob()).then((b) => loadImage(URL.createObjectURL(b))).catch(() => null);
      job.backdrop = await plan.backdrops[state.fmt];
      if (!job.backdrop) delete plan.backdrops[state.fmt];
    }
    scenes.forEach((s, i) => {
      if (s.kind === 'cta') s.ph = best;
      else if (s.visual === 'product' || s.visual === 'detail') s.ph = byId.get(s.photo) || best;
      s.still = stills[i] || null;
    });
    // sans photo, la scène retombe sur la vidéo ou le dégradé
    scenes.forEach((s) => { if (!s.ph && (s.visual === 'product' || s.visual === 'detail')) s.visual = 'footage'; });

    const offline = !!job.MB;
    const first = blobs.findIndex(Boolean), firstStill = stills.find(Boolean) || null;
    if (offline) {
      const opened = await Promise.all(blobs.map((b) => (b ? openClip(job.MB, b, cv.width, cv.height) : null)));
      scenes.forEach((s, i) => { s.clip = s.kind === 'cta' ? opened[first] || null : opened[i]; });
    }
    scenes[scenes.length - 1].still = first < 0 ? firstStill : null;
    scenes.forEach((s, i) => {
      s.voice = voices[i];
      s.speech = s.voice ? s.voice.duration : s.voiceover ? s.voiceover.split(/\s+/).length * 0.36 : 0;
    });
    const tl = timeline(scenes, target);
    job.total = tl.total; job.rate = tl.rate;
    scenes.forEach((s) => { s.words = s.voiceover && s.kind !== 'cta' ? karaoke(s.voiceover, s.speech / tl.rate, 0.3) : []; });
    const track = Music.byId(state.music);
    job.musicBuf = track ? await Music.render(track, job.total).catch(() => null) : null;
    const draw = makeRenderer(cv, job);
    const hasAudio = voices.some(Boolean) || !!job.musicBuf;

    let blob = offline ? await exportOffline(job, cv, draw, hasAudio) : null;
    if (job.cancelled) return;
    if (!blob) {
      const vids = await Promise.all(blobs.map((b) => (b ? loadVideoEl(b) : null)));
      scenes.forEach((s, i) => { s.frame = null; s.video = s.kind === 'cta' ? vids[first] || null : vids[i]; });
      blob = await exportRealtime(job, cv, draw);
    }
    if (job.cancelled) return;
    if (!blob) return status('This browser cannot create the video. Try an up-to-date Chrome or Safari.', 100);

    const name = `${plan.brand}-${state.intent}`.normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (blob.type.includes('mp4') ? '.mp4' : '.webm');
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(blob);
    result.src = state.videoUrl; result.hidden = false; cv.hidden = true;
    $('#b-dl').href = state.videoUrl; $('#b-dl').download = name;
    const file = new File([blob], name, { type: blob.type });
    $('#b-share').hidden = !navigator.canShare?.({ files: [file] });
    $('#b-share').onclick = () => navigator.share({ files: [file], title: plan.brand }).catch(() => {});
    const notes = [`${+job.total.toFixed(1)} s`, `${cv.width}×${cv.height}`, `${(blob.size / 1e6).toFixed(1)} MB`];
    if (voices.every((v) => !v)) notes.push('no voice-over');
    status('Your video is ready · ' + notes.join(' · '), 100);
    buildEditor(used);
    $('#st-actions').hidden = $('#editor').hidden = $('#b-again').hidden = false;
  } catch (err) {
    console.error(err);
    if (!job.cancelled) { status('Something went wrong while editing. Please try again.', 100); $('#b-again').hidden = false; }
  } finally {
    if (actx.state !== 'closed') actx.close().catch(() => {});
    scenes.forEach((s) => { s.clip?.iter?.return?.(); try { s.clip?.input.dispose(); } catch {} if (s.video) { s.video.pause(); URL.revokeObjectURL(s.video.src); } });
  }
}

/* ---------- page d'accueil : offres ---------- */
$('#cta-end').addEventListener('click', () => setTimeout(() => $('#url').focus({ preventScroll: true }), 400));
fetch('/api/config').then((r) => r.json()).then(({ plans }) => {
  const box = $('#plans');
  plans.forEach((p) => {
    const el = Object.assign(document.createElement('article'), { className: 'plan' + (p.featured ? ' featured' : '') });
    const add = (tag, cls, text) => { const n = Object.assign(document.createElement(tag), { className: cls, textContent: text }); el.append(n); return n; };
    if (p.tag) add('span', 'tag', p.tag);
    add('h3', '', p.name);
    const price = add('p', 'price', p.price || '');
    if (p.period) price.append(Object.assign(document.createElement('small'), { textContent: p.period }));
    const ul = document.createElement('ul');
    (p.features || []).forEach((f) => ul.append(Object.assign(document.createElement('li'), { textContent: f })));
    el.append(ul);
    // payer n'est proposé que si un lien de paiement est configuré
    if (p.id === 'free') el.append(Object.assign(document.createElement('a'), { className: 'btn', href: '#top', textContent: 'Try it free' }));
    else if (p.checkout) el.append(Object.assign(document.createElement('a'), { className: 'btn', href: p.checkout, rel: 'noopener', textContent: `Choose ${p.name}` }));
    else el.append(Object.assign(document.createElement('button'), { className: 'btn ghost', type: 'button', disabled: true, textContent: 'Coming soon' }));
    box.append(el);
  });
}).catch(() => { $('#pricing').hidden = true; });
