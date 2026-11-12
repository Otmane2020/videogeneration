'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FORMATS = { '9:16': [720, 1280], '1:1': [720, 720], '16:9': [1280, 720] };
const state = { page: null, type: null, plan: null, fmt: '9:16', job: null, music: '', captionStyle: '', templateStyle: '', uploads: [], photoUrls: [], photoSources: [], logo: null, variant: {}, picked: [], intent: 'launch', ad: null, clipLists: [], ctaList: [], icons: {}, visuals: [], used: [], cache: { blob: new Map(), voice: new Map(), shot: null } };
// adresses du site (médias de la bibliothèque) : directes ; les autres passent par le proxy (CORS pour le canvas)
// médias de la bibliothèque (site, ou fichiers du dépôt GitHub public, qui autorisent le CORS) : directs ; les autres passent par le proxy
const DIRECT = /^https:\/\/raw\.githubusercontent\.com\/Otmane2020\/videogeneration\//;
const media = (u) => (String(u).startsWith('/') || DIRECT.test(String(u)) ? u : '/api/media?u=' + encodeURIComponent(u));

// IndexedDB : stockage local des vidéos générées (jusqu'à 15, par ID de génération)
const vidIdb = (() => {
  let db = null;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('clipmotion-vids', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('v', mode); t.onerror = () => rej(t.error); fn(t.objectStore('v'), res); }); };
  return {
    set: (id, blob) => tx('readwrite', (s, res) => { const r = s.put({ blob, ts: Date.now() }, String(id)); r.onsuccess = () => res(); }),
    get: (id) => tx('readonly', (s, res) => { const r = s.get(String(id)); r.onsuccess = () => res(r.result?.blob || null); }),
    keys: () => tx('readonly', (s, res) => { const r = s.getAllKeys(); r.onsuccess = () => res(r.result); }),
    del: (id) => tx('readwrite', (s, res) => { const r = s.delete(String(id)); r.onsuccess = () => res(); }),
    prune: async (keep) => { const ks = await vidIdb.keys(); if (ks.length <= keep) return; const old = ks.sort().slice(0, ks.length - keep); await Promise.all(old.map((k) => vidIdb.del(k))); },
  };
})();

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
  return r;
}

function show(id, step) {
  $$('.view').forEach((v) => (v.hidden = v.id !== id));
  // accueil : navigation du site ; assistant : étapes
  $('.nav').hidden = step !== 1;
  $('.steps').hidden = step === 1 || step === 5;
  document.body.classList.toggle('in-video', step === 5);
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

/* ---------- 3. réglages automatiques ---------- */

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
$$('[data-fmt]').forEach((b) => b.addEventListener('click', () => {
  state.fmt = b.dataset.fmt;
  $$('[data-fmt]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
}));
// Seuls les réglages créatifs demandés à l'utilisateur restent visibles.
// Template, style des sous-titres et qualité d'export sont choisis automatiquement.
$$('.seg[data-for]').forEach((g) => {
  const sel = $('#' + g.dataset.for);
  if (!sel) return;
  const paint = () => $$('button', g).forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === sel.value)));
  $$('button', g).forEach((b) => b.addEventListener('click', () => {
    if (g.dataset.for === 'bgai' && b.dataset.v === '1' && !isPaid()) return openUpgrade('Custom AI scenes are part of the Pro plan.');
    sel.value = b.dataset.v; paint();
  }));
  paint();
});
$('#b-next').addEventListener('click', () => { fail($('#e-opts'), ''); show('s-opts', 4); });
$('#b-prev').addEventListener('click', () => show('s-type', 3));

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
  return [...state.uploads.map((u) => ({ show: u.url, send: u.data, source: u.url })), ...state.page.images.map((u) => ({ show: media(u), send: u, source: u }))];
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

  const all = [], box = $('#photos');
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
  // les photos sont choisies automatiquement ; l'ajout manuel n'est proposé que si la page n'en a donné aucune
  const found = state.page.images.length > 0;
  $('#up-hint').textContent = found ? '' : state.uploads.length ? `${state.uploads.length} photo${state.uploads.length > 1 ? 's' : ''} added.` : 'No product photo found: add yours.';
  $('#up-hint').hidden = found; $('#up-btn').hidden = found;
  // l'image principale suit la variante choisie
  const main = photoList()[0];
  const hero = $('#site-img');
  if (main) { hero.hidden = false; hero.src = main.show; }
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

/* ---------- logos de marques (Iconify) ---------- */
async function loadIcons(brands) {
  if (!brands.length) return {};
  try {
    const { icons } = await (await api('/api/icons', { brands })).json();
    const out = {};
    await Promise.all(Object.entries(icons || {}).map(([name, { src }]) => new Promise((ok) => {
      const im = new Image();
      im.onload = () => { out[name] = im; ok(); };
      im.onerror = () => ok();
      im.src = src;
    })));
    return out;
  } catch { return {}; } // sans logos, la pub se monte quand même
}

/* ---------- 4. génération directe, puis retouches ---------- */
const newAudio = () => new (window.AudioContext || window.webkitAudioContext)(); // à créer dans le geste utilisateur (iOS)
function cancelJob() { if (state.job) state.job.cancelled = true; stopPreview(); $('#result').pause(); }

$('#b-gen').addEventListener('click', async () => {
  const actx = newAudio(), ecom = state.type === 'ecom';
  cancelJob();
  const cv = $('#cv'), [W, H] = FORMATS[state.fmt];
  cv.width = W; cv.height = H; cv.getContext('2d').clearRect(0, 0, W, H);
  cv.hidden = false; $('#result').hidden = true;
  $('#st-actions').hidden = $('#b-edit').hidden = $('#b-again').hidden = true;
  show('s-video', 5);
  waiting(cv, (state.job = { cancelled: false })); // écran d'attente dès le premier instant
  status(ecom ? 'Reviewing your product photos and writing the script…' : 'Studying your brand and writing the script…', 4);
  try {
    const list = ecom ? photoList() : [];
    state.photoUrls = list.map((p) => p.show);
    state.photoSources = list.map((p) => p.source);
    // la variante choisie fixe le prix affiché et le texte de la pub
    const v = ecom ? variantOf() : null;
    const page = v?.price ? { ...state.page, product: { ...state.page.product, price: v.price } } : state.page;
    const plan = (state.plan = await (await api('/api/analyze', { page, type: state.type, intent: state.intent, format: state.fmt, photos: ecom ? list.map((p) => p.send) : undefined, variant: ecom && Object.keys(state.variant).length ? state.variant : undefined })).json());
    const brand = await state.logo;
    if (brand?.colors) Object.assign(plan.palette, brand.colors);
    plan.palette = safePalette(plan.palette);
    state.ad = plan.ads[0];
    // Déterminer la qualité avant la recherche de footage afin de demander des sources HD pour les exports Pro.
    $('#res').value = String(autoResolution());
    setMusic(ecom ? 'm6' : 'm1');
    // vrais logos des marques citées dans la pub (Iconify), pour les animations « logo → flèche → logo »
    state.icons = ecom ? {} : await loadIcons([...new Map(state.ad.scenes.flatMap((s) => s.logos || []).map((l) => [l.name.toLowerCase(), l])).values()].slice(0, 8));
    state.ui = {};
    await Promise.all([...new Set(state.ad.scenes.map((s) => s.icon).filter(Boolean))].map(async (n) => { const im = await loadImage(`/icons/ui/${n}.svg`, 8); if (im) state.ui[n] = im; }));
    status('Finding the right visuals…', 10);
    // Plans d'illustration : sans eux, la pub se monte quand même. Chaque scène SaaS reçoit les siens, quel que soit
    // son visuel (le réglage « Stock clips » peut en faire une scène vidéo au montage) ; une fiche produit n'en a
    // besoin que pour ses scènes vidéo. Derrière le téléphone : un fond sobre, pas une scène qui distrait.
    // SaaS : au moins 5 plans (une par scène + l'écran final), choisis automatiquement
    const closing = ['team collaborating office', 'small business owner working', 'professional team celebrating'];
    const wanted = state.ad.scenes.map((s) => (ecom && s.visual !== 'footage' ? null : s.queries || []));
    const lists = await api('/api/videos', { scenes: [...wanted, ecom ? null : closing], fallback: ecom ? 'lifestyle' : 'saas', hd: !ecom || $('#res').value === '1080' })
      .then((r) => r.json()).then(({ results }) => results).catch(() => []);
    state.clipLists = wanted.map((_, i) => lists[i] || []);
    state.ctaList = lists[wanted.length] || [];
    await produce(actx);
  } catch (err) {
    show('s-opts', 4);
    fail($('#e-opts'), err.message);
    if (/videos? (this month|of your plan)/.test(err.message)) { announce(err.message); openUpgrade(err.message); }
    actx.close().catch(() => {});
  }
});
// l'édition se fait sur sa propre page ; « Update » revient à la vidéo et la remonte
$('#b-edit').addEventListener('click', () => { $('#result').pause(); show('s-edit', 5); });
$('#b-back-video').addEventListener('click', () => { stopPreview(); show('s-video', 5); });
$('#b-update').addEventListener('click', () => { const actx = newAudio(); cancelJob(); show('s-video', 5); produce(actx); });
$('#b-again').addEventListener('click', () => { cancelJob(); show('s-opts', 4); });

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
    if (i >= used.length - 1) return; // `used` compte aussi l'écran final ; les scènes retirées d'un format court ne sont pas proposées
    const card = Object.assign(document.createElement('div'), { className: 'edscene' });
    const swap = s.visual === 'footage' || s.visual === 'site';
    const t = Object.assign(document.createElement('button'), { type: 'button', className: 'thumb', disabled: !swap });
    const src = s.pick?.thumb || (s.photo >= 0 && s.visual !== 'footage' ? state.photoUrls[s.photo] : used[i]?.thumb);
    if (src) t.append(Object.assign(new Image(), { src, alt: '' }));
    t.append(Object.assign(document.createElement('em'), { textContent: swap ? 'Change' : VISUAL[s.visual] }));
    if (swap) { t.setAttribute('aria-label', `Scene ${i + 1}: change visual`); t.addEventListener('click', () => openPicker(i)); }
    const col = document.createElement('div');
    field(col, `Scene ${i + 1} · on-screen text`, s.headline, false, (v) => { s.headline = v || s.headline; });
    field(col, 'Voice-over and captions', s.voiceover, true, (v) => { s.voiceover = v; s.spoken = ''; });
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
    const { results } = await (await api('/api/videos', { scenes: [[q]], loose: true, kind: picker.kind, hd: $('#res').value === '1080' })).json();
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
// Un plan à fond vert (maquette d'écran à incruster) n'est pas toujours signalé par ses mots-clés : sa vignette le trahit.
const greenSeen = new Map();
function greenScreen(clip) {
  if (!greenSeen.has(clip.id)) greenSeen.set(clip.id, (clip.thumb ? loadImage(media(clip.thumb), 16) : Promise.resolve(null)).then((im) => {
    if (!im) return false;
    const g = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }).getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i + 1] - Math.max(d[i], d[i + 2]) > 70) n++;
    return n > 60; // plus de 6 % de vert d'incrustation
  }).catch(() => false));
  return greenSeen.get(clip.id);
}
// Un plan par scène : le plus pertinent (`rel`), vertical de préférence pour un format vertical, jamais deux fois le même.
// Deux plans d'un même auteur se ressemblent souvent : on en change quand cela ne coûte rien en pertinence.
async function pickClips(lists, targetAspect) {
  const used = new Set(), authors = new Set(), picks = [];
  const aspectError = (clip) => {
    const ratio = clip.w > 0 && clip.h > 0 ? clip.w / clip.h : targetAspect;
    return Math.abs(Math.log(ratio / targetAspect));
  };
  const sorted = lists.map((list) => [...list].sort((a, b) =>
    ((b.rel || 0) - (a.rel || 0)) * 100
    + (aspectError(a) - aspectError(b)) * 9
    + (Number(!!b.hd) - Number(!!a.hd)) * 1.5
  ));
  sorted.forEach((list) => list.slice(0, 3).forEach(greenScreen)); // les vignettes des favoris se chargent ensemble
  for (const list of sorted) {
    const free = list.filter((x) => !used.has(x.id)), floor = Math.min(free[0]?.rel || 0, 2);
    let c = null;
    for (const x of [...free.filter((x) => !authors.has(x.g) && (x.rel || 0) >= floor), ...free, ...list]) if (!(await greenScreen(x))) { c = x; break; }
    if (c) { used.add(c.id); authors.add(c.g); }
    picks.push(c);
  }
  return picks;
}
const fetchBlob = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.blob();
};
function loadImage(src, min = 80) {
  return new Promise((res) => {
    const im = new Image();
    if (DIRECT.test(String(src))) im.crossOrigin = 'anonymous'; // sans cela le canvas serait « souillé » et l'export impossible
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
  out.box = [(x0 - 2) / w, (y0 - 2) / h, (x1 + 2) / w, (y1 + 2) / h]; // emplacement dans la photo, pour vérifier le détourage
  return out;
}

// Lecture d'une photo produit à petite échelle : couleur et uniformité du fond, emprise du produit,
// bords de l'image qu'il touche, et zones riches en détails (cadran, logo, couture…) pour viser les gros plans.
function photoInfo(img) {
  const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(16, Math.round(img.naturalWidth * s)), h = Math.max(16, Math.round(img.naturalHeight * s));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  let d;
  try { d = g.getImageData(0, 0, w, h).data; } catch { return null; }
  const n = w * h, border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const clear = border.filter((i) => d[i * 4 + 3] < 40).length > border.length * 0.6;
  const med = (ch) => { const v = border.map((i) => d[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const dist = (i) => Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]);
  const step = (i, j) => Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2]);
  const plain = clear || border.filter((i) => dist(i) < 36).length > border.length * 0.72;
  // fond : rempli depuis les bords, de proche en proche (suit aussi un fond en léger dégradé)
  const back = new Uint8Array(n);
  if (clear) for (let i = 0; i < n; i++) back[i] = d[i * 4 + 3] < 60 ? 1 : 0;
  else if (plain) {
    const stack = [];
    for (const i of border) if (dist(i) < 40) { back[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < n && !back[j] && step(i, j) < 14 && dist(j) < 96) { back[j] = 1; stack.push(j); }
      }
    }
  }
  // emprise du produit (on ignore les 0,5 % de pixels isolés de chaque côté)
  const cols = new Float64Array(w), rows = new Float64Array(h);
  let total = 0;
  for (let i = 0; i < n; i++) if (!back[i]) { cols[i % w]++; rows[(i / w) | 0]++; total++; }
  const span = (a) => { let lo = 0, hi = a.length - 1, acc = 0; for (; lo < a.length && (acc += a[lo]) < total * 0.005; lo++); acc = 0; for (; hi > 0 && (acc += a[hi]) < total * 0.005; hi--); return [lo, Math.max(lo, hi)]; };
  const [x0, x1] = total ? span(cols) : [0, w - 1], [y0, y1] = total ? span(rows) : [0, h - 1];
  // bords coupés par le cadrage de la photo (bracelet de montre, pied de meuble…)
  let touch = 0;
  if (plain) {
    const edge = (list) => list.filter((i) => !back[i]).length > list.length * 0.04;
    const line = (f, len) => Array.from({ length: len }, (_, k) => f(k));
    touch = [line((k) => k, w), line((k) => (h - 1) * w + k, w), line((k) => k * w, h), line((k) => k * w + w - 1, h)].filter(edge).length;
  }
  // détails : contraste local de luminance sur le produit, sommé par fenêtres de la taille d'un gros plan
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = !back[i] && x > 0 && y > 0 && x < w - 1 && y < h - 1 ? Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]) : 0;
      row += e; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const win = Math.max(6, Math.round(Math.min(x1 - x0 + 1, y1 - y0 + 1) * 0.42)), hw = win >> 1, cand = [];
  for (let y = Math.max(y0 + hw, hw); y <= Math.min(y1 - hw, h - 1 - hw); y += Math.max(2, hw >> 1)) {
    for (let x = Math.max(x0 + hw, hw); x <= Math.min(x1 - hw, w - 1 - hw); x += Math.max(2, hw >> 1)) {
      const a = (y - hw) * (w + 1) + (x - hw), b = (y - hw) * (w + 1) + (x + hw), c2 = (y + hw) * (w + 1) + (x - hw), d2 = (y + hw) * (w + 1) + (x + hw);
      cand.push({ x: (x + 0.5) / w, y: (y + 0.5) / h, e: sum[d2] - sum[b] - sum[c2] + sum[a] });
    }
  }
  cand.sort((a, b) => b.e - a.e);
  const focus = [];
  for (const p of cand) {
    if (p.e < (cand[0]?.e || 0) * 0.45) break;
    if (focus.every((f) => Math.hypot(f.x - p.x, f.y - p.y) > 0.24)) focus.push(p);
    if (focus.length === 3) break;
  }
  if (!focus.length) focus.push({ x: (x0 + x1 + 1) / 2 / w, y: (y0 + y1 + 1) / 2 / h });
  return { w, h, bg, plain, clear, back, d, touch, focus, box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h] };
}

// Un détourage n'est gardé que s'il ne retire rien du produit. Sur fond uni, chaque pixel nettement différent
// du fond (cadran, maillons, gravure…) doit rester opaque ; sinon la photo d'origine est utilisée, intacte.
function cutKeepsProduct(cut, info) {
  if (!cut) return false;
  if (!info || info.clear) return true;
  const { w, h, back, d, bg } = info;
  // produit coupé par les bords de la photo : une fois détouré il flotterait, tronqué net
  if (info.plain && info.touch >= 2) return false;
  const m = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = m.getContext('2d', { willReadFrequently: true });
  const [bx0, by0, bx1, by1] = cut.box || info.box;
  g.drawImage(cut, bx0 * w, by0 * h, (bx1 - bx0) * w, (by1 - by0) * h);
  const a = g.getImageData(0, 0, w, h).data;
  let core = 0, kept = 0, opaque = 0, onBack = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, on = a[i * 4 + 3] > 110;
    if (on) { opaque++; if (back[i]) onBack++; }
    if (!info.plain || back[i] || back[i - 1] || back[i + 1] || back[i - w] || back[i + w]) continue;
    if (Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) < 60) continue;
    core++; if (on) kept++;
  }
  if (!opaque) return false;
  if (info.plain) return (core < 40 || kept / core > 0.95) && onBack / opaque < 0.2;
  // photo d'ambiance : pas de référence, on refuse au moins un détourage en miettes
  return pieces(a, w, h) <= 3;
}
// nombre de morceaux opaques notables (plus de 4 % de la surface opaque)
function pieces(a, w, h) {
  const lab = new Int32Array(w * h), sizes = [];
  let total = 0;
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || a[s * 4 + 3] <= 110) continue;
    const id = sizes.length + 1, st = [s];
    let k = 0;
    lab[s] = id;
    while (st.length) {
      const i = st.pop(), x = i % w; k++;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) if (j >= 0 && j < w * h && !lab[j] && a[j * 4 + 3] > 110) { lab[j] = id; st.push(j); }
    }
    sizes.push(k); total += k;
  }
  return sizes.filter((k) => k > total * 0.04).length;
}

/* ---------- dessin ---------- */
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
const backOut = (x) => { x = clamp(x); return 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2); };
const FONT = 'Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
// couleurs : teinte décalée (aurores harmonisées avec la marque), mélange en hexadécimal, transparence
const hueOf = (hex, deg) => {
  let [r, g, b] = rgb(hex).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, sat = 0;
  if (d) { sat = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  h = (h + deg + 360) % 360; sat = Math.max(sat, 0.55);
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};
const mixHex = (hex, to, k) => '#' + rgb(hex).map((v, i) => Math.round(lerp(v, rgb(to)[i], k)).toString(16).padStart(2, '0')).join('');
const rgbaOf = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
const mix = (hex, to, k) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(',')})`; };
// Couleurs de la vidéo : l'accent sert à surligner des mots sur fond sombre, il doit rester clair et vif.
function safePalette(p) {
  const lum = (h) => { const [r, g, b] = rgb(h); return 0.299 * r + 0.587 * g + 0.114 * b; };
  const sat = (h) => { const [r, g, b] = rgb(h); return Math.max(r, g, b) - Math.min(r, g, b); };
  let primary = /^#[0-9a-f]{6}$/i.test(p.primary || '') ? p.primary : '#7c5cff', accent = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '#ffd166';
  if (lum(primary) < 40 && sat(accent) > 60 && lum(accent) > 70) [primary, accent] = [accent, '#ffd166']; // marque noire : la couleur vive devient principale
  else if (lum(primary) < 40) primary = '#7c5cff';
  if (lum(accent) < 110 || sat(accent) < 45) accent = '#ffd166'; // ni sombre ni gris : les mots surlignés doivent ressortir
  const d = rgb(primary).reduce((a, v, i) => a + Math.abs(v - rgb(accent)[i]), 0);
  if (d < 90) accent = lum(primary) > 150 ? '#ffffff' : '#ffd166';
  return { primary, accent };
}
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
  const captionStyle = job.captionStyle || 'karaoke';
  const templateStyle = job.templateStyle || 'cinematic';
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

  // Photo produit sans détourage : le cadrage garde le produit entier (jamais de gros plan sur du vide).
  // Si le produit est plus large que l'écran, la photo entière est posée sur un fond de sa propre couleur.
  function framed(sc, ph, k, detail) {
    const img = ph.img, iw = img.naturalWidth, ih = img.naturalHeight, inf = ph.info, e = easeInOut(k);
    if (!inf) return coverDraw(img, iw, ih, detail ? 1.3 + 0.12 * k : 1.04 + 0.1 * k, 0.5, lerp(0.42, 0.58, k));
    const [bx0, by0, bx1, by1] = inf.box;
    let cw = iw, ch = ih;
    if (iw / ih > W / H) cw = (ih * W) / H; else ch = (iw * H) / W;
    const pcx = ((bx0 + bx1) / 2) * iw, pcy = ((by0 + by1) / 2) * ih;
    const crop = (cx, cy, z) => {
      const sw = cw / z, sh = ch / z;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, Math.max(0, Math.min(iw - sw, cx - sw / 2)), Math.max(0, Math.min(ih - sh, cy - sh / 2)), sw, sh, 0, 0, W, H);
    };
    if (detail) {
      // gros plan sur la zone visée (cadran, fermoir…), sans agrandir au point de rendre l'image floue
      const f = sc.focusPt || inf.focus[0];
      const zMax = Math.max(1.15, Math.min(2, cw / (W * S * 0.45)));
      const dir = sc.variant % 2 ? -1 : 1;
      return crop(f.x * iw + dir * (1 - e) * cw * 0.06, f.y * ih + (1 - e) * ch * 0.04, zMax * (0.88 + 0.12 * e));
    }
    const fits = (bx1 - bx0) * iw <= cw * 0.95 && (by1 - by0) * ih <= ch * 0.95;
    if (fits || !inf.plain) {
      // plan d'ensemble : centré sur le produit, lent travelling vers sa zone la plus détaillée (zoom avant ou arrière selon la scène)
      const f = inf.focus[0], z = sc.variant % 2 ? 1.08 - 0.06 * e : 1 + 0.06 * e;
      return crop(lerp(pcx, f.x * iw, 0.3 * e), lerp(pcy, f.y * ih, 0.3 * e), fits ? Math.min(z, Math.min(cw / ((bx1 - bx0) * iw), ch / ((by1 - by0) * ih))) : z);
    }
    plate(ph, k);
  }
  function plate(ph, k) {
    const img = ph.img, iw = img.naturalWidth, ih = img.naturalHeight, [r, g, b] = ph.info.bg;
    ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, W, H);
    if (!ph.soft) {
      // bords de la photo fondus dans la couleur du fond : aucune arête visible
      const s2 = Math.min(1, 1600 / Math.max(iw, ih)), c = Object.assign(document.createElement('canvas'), { width: Math.round(iw * s2), height: Math.round(ih * s2) });
      const t = c.getContext('2d'), f = Math.round(Math.min(c.width, c.height) * 0.07);
      t.drawImage(img, 0, 0, c.width, c.height);
      t.globalCompositeOperation = 'destination-out';
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, f, 0, 0, 0, f, c.height], [c.width, 0, c.width - f, 0, c.width - f, 0, f, c.height], [0, 0, 0, f, 0, 0, c.width, f], [0, c.height, 0, c.height - f, 0, c.height - f, c.width, f]]) {
        const gr = t.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        t.fillStyle = gr; t.fillRect(rx, ry, rw, rh);
      }
      ph.soft = c;
    }
    const z = 1 + 0.05 * easeInOut(k), sc2 = Math.min(W / iw, (H * (wide ? 0.9 : 0.66)) / ih) * z;
    const dw = iw * sc2, dh = ih * sc2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ph.soft, wide ? W * 0.72 - dw / 2 : (W - dw) / 2, wide ? (H - dh) / 2 : Math.max(0, H * 0.4 - dh / 2), dw, dh);
  }

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
  // Décor dessiné par le code, aux couleurs de la marque : dégradés, halos, anneaux lumineux,
  // faisceaux, particules et podium. Tout est animé, rien ne vient d'une banque d'images.
  const darkSet = plan.decor === 'dark' || plan.decor === 'studio';
  const dots = Array.from({ length: 26 }, (_, i) => ({ x: (i * 0.618) % 1, y: (i * 0.371) % 1, r: 3 + (i % 5) * 2.2, s: 0.4 + (i % 7) * 0.12 }));
  function studio(k, t = 0) {
    const hz = H * (wide ? 0.68 : 0.63), cx = W / 2, z = 1 + 0.05 * k;
    ctx.save();
    ctx.translate(cx, hz); ctx.scale(z, z); ctx.translate(-cx, -hz);
    // fond : dégradé profond ou clair selon l'ambiance
    let g = ctx.createLinearGradient(0, 0, W, H);
    if (darkSet) { g.addColorStop(0, '#0d0b1c'); g.addColorStop(0.55, mix(P, '#07060f', 0.78)); g.addColorStop(1, '#050409'); }
    else { g.addColorStop(0, decor.wall[0]); g.addColorStop(0.6, decor.wall[1]); g.addColorStop(1, decor.floor[1]); }
    ctx.fillStyle = g; ctx.fillRect(-60, -60, W + 120, H + 120);
    // deux halos de couleur qui dérivent lentement
    const blob = (bx, by, r, col, a) => { const q = ctx.createRadialGradient(bx, by, 0, bx, by, r); q.addColorStop(0, col + a); q.addColorStop(1, col + '00'); ctx.fillStyle = q; ctx.fillRect(-60, -60, W + 120, H + 120); };
    blob(W * (0.22 + 0.05 * Math.sin(t * 0.5)), H * 0.2, Math.max(W, H) * 0.55, P, darkSet ? '66' : '3d');
    blob(W * (0.82 + 0.04 * Math.cos(t * 0.4)), H * 0.42, Math.max(W, H) * 0.5, A, darkSet ? '4d' : '33');
    // faisceaux de lumière en biais
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const bx = W * (0.1 + i * 0.36) + Math.sin(t * 0.3 + i) * 30;
      const q = ctx.createLinearGradient(bx, 0, bx + W * 0.3, hz);
      q.addColorStop(0, `rgba(255,255,255,${darkSet ? 0.1 : 0.22})`); q.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = q; ctx.beginPath(); ctx.moveTo(bx - 20, -40); ctx.lineTo(bx + 90, -40); ctx.lineTo(bx + W * 0.42, hz); ctx.lineTo(bx + W * 0.16, hz); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // anneaux lumineux derrière le produit
    const ry = hz - Math.min(W, H) * 0.42;
    // une couleur de marque très sombre (noir, bleu nuit) serait invisible : les anneaux prennent une version éclaircie
    const lift = (c) => { const v = rgb(c); return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) < 90 ? '#' + v.map((x) => Math.round(lerp(x, 255, 0.7)).toString(16).padStart(2, '0')).join('') : c; };
    const ringP = darkSet ? lift(P) : P, ringA = darkSet ? lift(A) : A;
    for (let i = 0; i < 3; i++) {
      const r = Math.min(W, H) * (0.3 + i * 0.1) + Math.sin(t * 0.9 + i * 1.7) * 6;
      ctx.strokeStyle = (i === 1 ? ringA : ringP) + (darkSet ? ['aa', '66', '33'][i] : ['77', '44', '22'][i]); ctx.lineWidth = 3 - i * 0.7;
      ctx.beginPath(); ctx.arc(cx, ry, r, Math.PI * (0.92 + 0.1 * i) + t * 0.12 * (i % 2 ? -1 : 1), Math.PI * (2.08 - 0.1 * i) + t * 0.12 * (i % 2 ? -1 : 1)); ctx.stroke();
    }
    // sol : reflet et lignes de fuite
    g = ctx.createLinearGradient(0, hz, 0, H);
    if (darkSet) { g.addColorStop(0, mix(P, '#0a0914', 0.7)); g.addColorStop(1, '#040308'); } else { g.addColorStop(0, decor.floor[0]); g.addColorStop(1, decor.floor[1]); }
    ctx.fillStyle = g; ctx.fillRect(-60, hz, W + 120, H - hz + 60);
    ctx.strokeStyle = darkSet ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)'; ctx.lineWidth = 1.5;
    for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(cx + i * W * 0.05, hz); ctx.lineTo(cx + i * W * 0.34, H + 40); ctx.stroke(); }
    for (let i = 1; i <= 4; i++) { const yy = hz + (H - hz) * Math.pow(i / 4.4, 1.7); ctx.beginPath(); ctx.moveTo(-60, yy); ctx.lineTo(W + 60, yy); ctx.stroke(); }
    // podium
    const pw = Math.min(W * 0.74, 560), py = hz + (wide ? 18 : 34);
    g = ctx.createRadialGradient(cx, py, 0, cx, py, pw / 2);
    g.addColorStop(0, darkSet ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.85)'); g.addColorStop(0.7, darkSet ? P + '33' : 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.translate(cx, py); ctx.scale(1, 0.2); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, pw / 2, 0, 7); ctx.fill();
    ctx.strokeStyle = A + 'aa'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, pw * 0.43, 0, 7); ctx.stroke(); ctx.restore();
    // particules qui montent
    for (const d of dots) {
      const yy = ((d.y - t * 0.035 * d.s) % 1 + 1) % 1 * hz, xx = d.x * W + Math.sin(t * d.s + d.x * 9) * 14;
      ctx.fillStyle = (d.r > 8 ? A : '#ffffff') + (darkSet ? '55' : '77');
      ctx.beginPath(); ctx.arc(xx, yy, d.r * (darkSet ? 0.7 : 0.6), 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  // Fond des démos : aurores aux couleurs de la marque qui dérivent, halo derrière le téléphone, rayons qui tournent,
  // scintillements à quatre branches. Tout est dessiné par le code, net à toutes les résolutions.
  const stars = Array.from({ length: 34 }, (_, i) => ({ x: (i * 0.618 + 0.13) % 1, y: (i * 0.377 + 0.07) % 1, r: 1.2 + (i % 5) * 0.9, ph: i * 1.7, sp: 0.8 + (i % 4) * 0.35 }));
  function aurora(sc, k, t) {
    const v = sc.variant || 0, cx = wide ? W * 0.72 : W / 2, cy = wide ? H * 0.5 : H * 0.42;
    // une marque noire ou très sombre donnerait un fond éteint : on prend alors des teintes vives par défaut
    const vivid = (c, d) => (rgb(c).reduce((a2, v, i) => a2 + v * [0.299, 0.587, 0.114][i], 0) < 70 ? d : c);
    const c1 = vivid(P, '#6a5cff'), c2 = vivid(A, '#c44dff'), c3 = hueOf(c1, 48), c4 = hueOf(c2, -36);
    // fond profond
    let g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, rgbaOf(mixHex(c1, '#050410', 0.78), 1)); g.addColorStop(1, '#030209');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // aurores : quatre nappes de couleur qui dérivent lentement
    const R = Math.max(W, H);
    [[c1, 0.18, 0.18, 0.5, 0.0], [c2, 0.85, 0.3, 0.45, 1.3], [c3, 0.25, 0.8, 0.5, 2.4], [c4, 0.8, 0.85, 0.42, 3.6]].forEach(([c, bx, by, rr0, ph]) => {
      const x = W * (bx + 0.08 * Math.sin(t * 0.45 + ph + v)), y = H * (by + 0.06 * Math.cos(t * 0.38 + ph)), q = ctx.createRadialGradient(x, y, 0, x, y, R * rr0);
      q.addColorStop(0, rgbaOf(c, 0.42)); q.addColorStop(1, rgbaOf(c, 0));
      ctx.fillStyle = q; ctx.fillRect(0, 0, W, H);
    });
    // rayons de lumière qui tournent derrière le téléphone
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.16 + v * 0.7);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      const ray = ctx.createLinearGradient(0, 0, R * 0.75, 0); ray.addColorStop(0, 'rgba(255,255,255,.10)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = ray; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 0.75, -R * 0.045); ctx.lineTo(R * 0.75, R * 0.045); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // halo qui respire derrière le téléphone
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2), halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.62 * pulse);
    halo.addColorStop(0, rgbaOf(c2, 0.55)); halo.addColorStop(0.45, rgbaOf(c1, 0.22)); halo.addColorStop(1, rgbaOf(c1, 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    // scintillements à quatre branches
    for (const st of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 2.6 * st.sp + st.ph), x = st.x * W, y = ((st.y - t * 0.012 * st.sp) % 1 + 1) % 1 * H, r = st.r * (0.6 + tw);
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * tw})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (st.r > 3) { ctx.fillRect(x - r * 5, y - 0.6, r * 10, 1.2); ctx.fillRect(x - 0.6, y - r * 5, 1.2, r * 10); }
    }
    ctx.restore();
    // reflet du halo au sol, comme un studio brillant
    const floor = ctx.createLinearGradient(0, H * 0.72, 0, H);
    floor.addColorStop(0, 'rgba(0,0,0,0)'); floor.addColorStop(1, rgbaOf(mixHex(c1, '#000000', 0.6), 0.65));
    ctx.fillStyle = floor; ctx.fillRect(0, H * 0.72, W, H * 0.28);
  }
  function background(sc, k) {
    const ph = sc.ph;
    // Pour une scène de démonstration SaaS, le vrai screenshot du site doit rester lisible.
    // On utilise un décor de marque derrière le téléphone, pas un second footage concurrent.
    if (plan.type === 'saas' && sc.visual === 'site' && shot) return aurora(sc, k, k * sc.dur);
    if (sc.visual === 'detail' && ph) return framed(sc, ph, k, true);
    if ((sc.visual === 'product' || (sc.kind === 'cta' && plan.type === 'ecom')) && ph && ph.cut && job.backdrop) return coverDraw(job.backdrop, job.backdrop.naturalWidth, job.backdrop.naturalHeight, 1.02 + 0.07 * k, 0.5 + 0.1 * (k - 0.5), 0.6);
    if ((sc.visual === 'product' || (sc.kind === 'cta' && plan.type === 'ecom')) && ph) return ph.cut ? studio(k, k * sc.dur) : framed(sc, ph, k, false);
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
      // premier plan : téléphone bien droit, léger zoom avant pendant que la page défile
      sc = (job.videoTemplate === 'corporate' ? 0.95 : 1) + 0.06 * easeInOut(p);
    } else {
      // second plan : téléphone incliné en relief, avec un travelling
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
    // liseré lumineux aux couleurs de la marque (effet néon des modèles TikTok/CapCut)
    const rim = ctx.createLinearGradient(x, y, x + w, y + h); rim.addColorStop(0, rgbaOf(P, 1)); rim.addColorStop(0.5, rgbaOf(hueOf(P, 40), 1)); rim.addColorStop(1, rgbaOf(A, 1));
    ctx.shadowColor = rgbaOf(A, 0.9); ctx.shadowBlur = 26 + 10 * Math.sin(local * 3); ctx.shadowOffsetY = 0;
    ctx.strokeStyle = rim; ctx.lineWidth = Math.max(2.5, w * 0.012); rr(x, y, w, h, r); ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.save();
    rr(x + b, y + b, w - b * 2, h - b * 2, r - b); ctx.clip();
    const sw = w - b * 2, sh = h - b * 2, full = shot.naturalHeight * (sw / shot.naturalWidth);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + b, y + b, sw, sh);
    const demo = variant === 0 && dur > 2.4, clickAt = 1.55, scrollFrom = demo ? clickAt + 0.45 : 0.7;
    ctx.drawImage(shot, x + b, y + b - Math.max(0, Math.min(full - sh, sh * 1.1)) * easeInOut((local - scrollFrom) / Math.max(dur - scrollFrom - 0.4, 1)), sw, full);
    if (demo) {
      // curseur : arrive du bas, clique sur la zone d'action, l'onde de clic se diffuse
      const tx = x + b + sw * 0.5, ty = y + b + sh * 0.36, m = easeInOut(clamp((local - 0.6) / (clickAt - 0.6)));
      const px = lerp(x + b + sw * 0.86, tx, m), py = lerp(y + b + sh * 0.9, ty, m), press = Math.exp(-((local - clickAt) ** 2) / 0.006);
      const ring = clamp((local - clickAt) / 0.5);
      if (local > clickAt && ring < 1) { ctx.strokeStyle = A; ctx.globalAlpha = enter * (1 - ring); ctx.lineWidth = 3 * S; ctx.beginPath(); ctx.arc(tx, ty, sw * (0.03 + 0.12 * easeOut(ring)), 0, 7); ctx.stroke(); ctx.globalAlpha = enter; }
      if (local > 0.6 && local < scrollFrom + 0.6) {
        const cs = sw * 0.1 * (1 - 0.18 * press);
        ctx.save(); ctx.globalAlpha = enter * clamp((scrollFrom + 0.6 - local) / 0.3); ctx.translate(px, py); ctx.scale(cs / 20, cs / 20);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(7.5, 20); ctx.lineTo(10.5, 18.7); ctx.lineTo(7.6, 12); ctx.lineTo(13, 12); ctx.closePath();
        ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 4; ctx.fillStyle = '#111'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
      }
    }
    // éclat qui traverse la vitre une fois, à l'arrivée du téléphone
    const sweep = clamp((local - (variant === 0 ? 0.35 : 0.25)) / 0.9);
    if (sweep > 0 && sweep < 1) {
      const sx = lerp(x - w, x + w * 1.6, easeInOut(sweep)), shine = ctx.createLinearGradient(sx, y, sx + w * 0.55, y + h * 0.3);
      shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(0.5, 'rgba(255,255,255,.38)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shine; ctx.fillRect(x, y, w, h);
    }
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

  // Scène de logos : de vraies marques en grand, au centre, reliées par des flèches qui se dessinent, avec leur nom dessous.
  function iconStage(sc, local, box, compact = false) {
    const items = sc.icons.slice(0, 3).map((i) => ({ img: i.img, label: i.name }));
    const flow = sc.logosLayout === 'flow';
    if (flow && items.length === 1 && logo) items.push({ img: logo, label: plan.brand, dark: job.logoLight });
    // instant d'apparition de chaque tuile : au mot prononcé, sans jamais coller aux autres
    sc.icons.slice(0, 3).forEach((ic, i) => { items[i].at = Math.max(0.2 + i * 0.3, (ic.t0 || 0) - 0.3); if (i) items[i].at = Math.max(items[i].at, items[i - 1].at + 0.3); });
    if (items.length > sc.icons.slice(0, 3).length) items[items.length - 1].at = items[items.length - 2].at + 0.45;
    const n = items.length, gk = 0.5, span = wide ? box.w : W - 56;
    const s = Math.min(span / (n + (n - 1) * gk), (wide ? H : W) * (compact ? 0.13 : 0.33)), gap = s * gk;
    const cx = wide ? box.x + box.w / 2 : W / 2, cy = compact ? box.y + box.h * 0.38 : box.y + box.h * 0.54;
    const x0 = cx - (n * s + (n - 1) * gap) / 2, y0 = cy - s / 2;
    // halo derrière le groupe : isole les logos d'un plan de stock chargé
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(box.w * 0.62, s * 2));
    halo.addColorStop(0, 'rgba(8,8,18,.62)'); halo.addColorStop(0.6, 'rgba(8,8,18,.34)'); halo.addColorStop(1, 'rgba(8,8,18,0)');
    if (!compact) ctx.save(), ctx.globalAlpha = clamp(local / 0.35), ctx.fillStyle = halo, ctx.fillRect(box.x - W, box.y - H * 0.2, W * 3, box.h + H * 0.4), ctx.restore();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.9);
    glow.addColorStop(0, A + '55'); glow.addColorStop(1, A + '00');
    ctx.save(); ctx.globalAlpha = clamp(local / 0.5); ctx.fillStyle = glow; ctx.fillRect(cx - s * 2.2, cy - s * 2.2, s * 4.4, s * 4.4); ctx.restore();

    // flèches : un trait qui se dessine, une pointe, puis des points qui circulent dans le sens du flux
    for (let i = 0; i < n - 1 && flow; i++) { // flèches seulement quand la phrase décrit un flux d'un outil vers un autre
      const t0 = items[i].at + 0.3, p = easeOut(clamp((local - t0) / 0.5));
      if (p <= 0) continue;
      const xa = x0 + (i + 1) * s + i * gap + s * 0.1, xb = x0 + (i + 1) * (s + gap) - s * 0.1, xe = lerp(xa, xb, p), lw = s * 0.07;
      ctx.save();
      const g = ctx.createLinearGradient(xa, 0, xb, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(1, A);
      ctx.strokeStyle = g; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = A + 'cc'; ctx.shadowBlur = s * 0.22;
      ctx.beginPath(); ctx.moveTo(xa, cy); ctx.lineTo(xe, cy); ctx.stroke();
      if (p > 0.92) { const h = s * 0.15; ctx.beginPath(); ctx.moveTo(xb - h, cy - h); ctx.lineTo(xb, cy); ctx.lineTo(xb - h, cy + h); ctx.stroke(); }
      if (p >= 1) {
        ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
        for (let d = 0; d < 3; d++) { const q = ((local - t0) * 0.7 + d / 3) % 1; ctx.globalAlpha = Math.sin(Math.PI * q) * 0.95; ctx.beginPath(); ctx.arc(lerp(xa, xb - s * 0.12, q), cy, lw * 0.75, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    }

    // tuiles : ressort à l'arrivée, léger flottement ensuite
    items.forEach((it, i) => {
      const t0 = it.at, e = clamp((local - t0) / 0.5);
      if (e <= 0) return;
      const k2 = backOut(e), x = x0 + i * (s + gap), bob = Math.sin(local * 2.1 + i * 1.4) * s * 0.025, y = y0 + bob + (1 - easeOut(e)) * s * 0.35;
      ctx.save();
      ctx.globalAlpha = clamp(e * 2.4);
      ctx.translate(x + s / 2, y + s / 2); ctx.rotate((1 - easeOut(e)) * -0.14); ctx.scale(k2, k2); ctx.translate(-(x + s / 2), -(y + s / 2));
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = s * 0.34; ctx.shadowOffsetY = s * 0.1;
      const fill = ctx.createLinearGradient(x, y, x, y + s);
      if (it.dark) { fill.addColorStop(0, '#26243a'); fill.addColorStop(1, '#14121f'); } else { fill.addColorStop(0, '#ffffff'); fill.addColorStop(1, '#eceef7'); }
      ctx.fillStyle = fill; rr(x, y, s, s, s * 0.26); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = A + '99'; ctx.lineWidth = Math.max(2, s * 0.018); rr(x, y, s, s, s * 0.26); ctx.stroke();
      const iw = it.img.naturalWidth || it.img.width || s, ih = it.img.naturalHeight || it.img.height || s, f = Math.min(s * 0.58 / iw, s * 0.58 / ih);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(it.img, x + (s - iw * f) / 2, y + (s - ih * f) / 2, iw * f, ih * f);
      ctx.restore();
      // nom de la marque sous la tuile
      ctx.save();
      ctx.globalAlpha = clamp((e - 0.4) / 0.5);
      ctx.font = `700 ${Math.round(s * 0.15)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = s * 0.12; ctx.fillStyle = '#fff';
      ctx.fillText(it.label, x + s / 2, y + s + s * 0.16 + bob);
      ctx.restore();
    });
  }

  // Icône d'appoint : pastille de verre, pictogramme au trait blanc, posée au-dessus du titre ; arrive en douceur puis flotte à peine.
  function proIcon(sc, local, top) {
    const e = clamp((local - 0.2) / 0.5);
    if (e <= 0) return;
    const sz = Math.min(W, H) * (wide ? 0.085 : 0.1), k2 = backOut(e);
    const cx = wide ? pad + textW / 2 : W / 2, cy = top - sz * 0.85 + Math.sin(local * 1.6) * sz * 0.03;
    ctx.save();
    ctx.globalAlpha = clamp(e * 1.8);
    ctx.translate(cx, cy); ctx.scale(k2, k2);
    ctx.shadowColor = A + '88'; ctx.shadowBlur = sz * 0.45;
    const g = ctx.createLinearGradient(0, -sz / 2, 0, sz / 2); g.addColorStop(0, 'rgba(255,255,255,.26)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g; rr(-sz / 2, -sz / 2, sz, sz, sz * 0.3); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = Math.max(1.5, sz * 0.02); rr(-sz / 2, -sz / 2, sz, sz, sz * 0.3); ctx.stroke();
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(sc.iconImg, -sz * 0.28, -sz * 0.28, sz * 0.56, sz * 0.56);
    ctx.restore();
  }

  /* ----- scènes ----- */
  function scene(sc, local) {
    const k = clamp(local / sc.dur), ph = sc.ph;
    const onDecor = sc.visual === 'product' && ph && ph.cut;
    const stage = !!sc.icons?.length && sc.kind !== 'cta' && !(sc.visual === 'site' && shot); // scène de logos sans démo : logos au centre
    const row = !!sc.icons?.length && sc.kind !== 'cta' && sc.visual === 'site' && shot; // démo : logos en rangée au-dessus du téléphone
    const hero = (sc.visual === 'site' && shot) || onDecor || stage;
    let g = ctx.createLinearGradient(0, 0, 0, H);
    if (onDecor) { g.addColorStop(0, 'rgba(0,0,0,.32)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); }
    else { g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.3, `rgba(0,0,0,${hero ? 0.45 : 0.05})`); g.addColorStop(0.55, `rgba(0,0,0,${hero ? 0.5 : 0.25})`); g.addColorStop(1, 'rgba(0,0,0,.9)'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.font = `800 ${headSize}px ${FONT}`;
    const lines = wrap(ctx, sc.headline, textW - 36, 3);
    const top = bottom - 78 - lines.length * lh;
    const box = heroBox(top);
    const rowH = row ? Math.min(W, H) * 0.24 : 0;
    if (sc.visual === 'site' && shot) phone(row ? { ...box, y: box.y + rowH, h: box.h - rowH } : box, local, sc.dur, sc.variant);
    if (stage) iconStage(sc, local, box);
    if (row) iconStage(sc, local, { ...box, h: rowH }, true);
    if (sc.iconImg) proIcon(sc, local, top);
    if (onDecor) { const r = product(ph, box, local, k); pill(sc.badge, r.x + r.w * 0.82, Math.max(box.y + 30, r.y + r.h * 0.12), local); }
    else if (sc.badge) pill(sc.badge, W / 2, wide ? H * 0.3 : H * 0.36, local, 30);

    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
    const tx = wide ? pad + textW / 2 : W / 2;
    // Sous-titres stylables : le rendu reste incrusté dans le MP4 exporté.
    const chunk = sc.words.find((c) => local < c[c.length - 1].t1 + 0.2) || null;
    if (chunk && local >= chunk[0].t0 - 0.1 && window.ClipMotionCaptions) {
      window.ClipMotionCaptions.draw(ctx, chunk, local, { x: tx, y: bottom, width: textW, wide, accent: A, font: FONT, style: captionStyle, backOut, easeOut });
    }
    // Template de composition : chaque variante change réellement le traitement du titre dans la vidéo.
    ctx.font = `800 ${headSize}px ${FONT}`;
    lines.forEach((l, i) => {
      const e = backOut((local - 0.1 - i * 0.12) / 0.38);
      if (e <= 0) return;
      const last = i === lines.length - 1, w = Math.min(textW - 12, ctx.measureText(l).width + 42);
      const y = top + i * lh + (lh - 8) / 2;
      ctx.save();
      ctx.globalAlpha = clamp(e * 1.4);
      ctx.translate(tx, y);
      if (templateStyle === 'editorial') {
        ctx.font = `700 ${Math.round(headSize * 0.96)}px Georgia, serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 18;
        ctx.fillText(l, 0, headSize * 0.34, textW - 20);
      } else if (templateStyle === 'minimal') {
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 16;
        ctx.fillText(l, 0, headSize * 0.34, textW - 20);
      } else if (templateStyle === 'neon') {
        ctx.textAlign = 'center'; ctx.shadowColor = A; ctx.shadowBlur = 24;
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(l, 0, headSize * 0.34, textW - 20);
        ctx.fillStyle = A; ctx.fillText(l, 0, headSize * 0.34, textW - 20);
      } else if (templateStyle === 'split') {
        ctx.textAlign = 'center'; ctx.fillStyle = last ? A : '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 14;
        ctx.fillText(l, 0, headSize * 0.34, textW - 20);
        ctx.fillStyle = last ? '#fff' : A;
        ctx.fillRect(-w / 2, headSize * 0.48, w, Math.max(4, headSize * 0.055));
      } else if (templateStyle === 'social') {
        ctx.textAlign = 'center'; ctx.fillStyle = '#101018';
        rr(-w / 2, -(lh - 4) / 2, w, lh - 4, 12); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(l, 0, headSize * 0.34, textW - 24);
      } else if (templateStyle === 'product') {
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(8,7,18,.78)';
        rr(-w / 2 - 12, -(lh - 4) / 2, w + 24, lh - 4, 18); ctx.fill();
        ctx.fillStyle = last ? A : '#fff'; ctx.fillText(l, 0, headSize * 0.34, textW - 24);
      } else if (templateStyle === 'bold') {
        ctx.textAlign = 'center'; ctx.fillStyle = last ? A : P;
        rr(-w / 2, -(lh - 4) / 2, w, lh - 4, 7); ctx.fill();
        ctx.fillStyle = onColor(last ? A : P); ctx.fillText(l, 0, headSize * 0.34, textW - 24);
      } else {
        ctx.rotate((1 - Math.min(1, e)) * (i % 2 ? 0.07 : -0.07) + (i % 2 ? 0.012 : -0.012));
        ctx.scale(0.55 + 0.45 * e, 0.55 + 0.45 * e);
        ctx.fillStyle = last ? A : P;
        rr(-w / 2, -(lh - 8) / 2, w, lh - 8, 14); ctx.fill();
        ctx.fillStyle = onColor(last ? A : P);
        ctx.textAlign = 'center'; ctx.fillText(l, 0, headSize * 0.36, textW - 24);
      }
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

  // grain de film et vignettage légers : rendu plus « cinéma », moins numérique
  const grain = document.createElement('canvas'); grain.width = grain.height = 160;
  { const g = grain.getContext('2d'), d = g.createImageData(160, 160); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); }
  const vig = (() => { const g = main.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.38)'); return g; })();
  function finish(t) {
    ctx.save();
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
    const ox = (t * 977) % 160, oy = (t * 613) % 160;
    for (let x = -ox; x < W; x += 160) for (let y = -oy; y < H; y += 160) ctx.drawImage(grain, x, y);
    ctx.restore();
  }
  return function draw(t) {
    const idx = sceneAt(scenes, t), sc = scenes[idx], local = t - sc.start;
    if (idx > 0 && local < TRANS) {
      // transition : la scène précédente reste dessous, la nouvelle arrive par-dessus
      const prev = scenes[idx - 1], e = easeInOut(local / TRANS);
      const roleTransition = { hook: 'flash', context: 'slideU', demo: 'zoom', outcome: 'whip' };
      const kind = sc.kind === 'cta' ? 'wipe' : roleTransition[sc.role] || TRANSITIONS[(idx - 1) % TRANSITIONS.length];
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
    if (plan.type === 'saas') finish(t);
    chrome(t, idx);
    if (job.credits?.length && idx === scenes.length - 1) {
      // mention d'auteur (CC BY) en bas de l'écran final
      ctx.save();
      ctx.font = `500 ${Math.round(Math.min(W, H) * 0.026)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 6;
      let line = 'Footage: ' + job.credits.join(', ');
      while (ctx.measureText(line).width > W - 56 && line.length > 12) line = line.slice(0, -2);
      ctx.fillText(line.length < ('Footage: ' + job.credits.join(', ')).length ? line + '…' : line, W / 2, H - Math.max(14, H * 0.018));
      ctx.restore();
    }
    if (job.watermark) {
      // offre gratuite : filigrane en oblique, répété sur toute l'image
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(-0.5);
      ctx.font = `800 34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 2;
      const R = Math.hypot(W, H) / 2;
      for (let y = -R; y <= R; y += 210) for (let x = -R - (Math.round(y / 210) % 2 ? 190 : 0); x <= R; x += 380) { ctx.strokeText('clipmotion.ai', x, y); ctx.fillText('clipmotion.ai', x, y); }
      ctx.restore();
    }
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
    // on laisse le navigateur afficher l'image en cours (sinon l'aperçu reste figé ou noir sur mobile)
    if (f % 6 === 0) { status(`Rendering… ${Math.round((f / frames) * 100)}%`, (f / frames) * 100); await new Promise((r) => { const id = setTimeout(r, 60); requestAnimationFrame(() => { clearTimeout(id); r(); }); }); }
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

// Écran d'attente dessiné dans le cadre vidéo tant que le montage n'a pas commencé (sinon le cadre reste noir).
function waiting(cv, job) {
  const ctx = cv.getContext('2d'), t0 = performance.now();
  (function frame() {
    if (job.cancelled || job.rendering || state.job !== job) return;
    const W = cv.width, H = cv.height, t = (performance.now() - t0) / 1000;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1a1340'); g.addColorStop(1, '#07060f');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = ['#6a5cff', '#c44dff', '#ff6b8b'][i]; ctx.lineWidth = W * 0.012; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(W / 2, H * 0.44, W * (0.1 + i * 0.045), t * (2.2 - i * 0.5) + i, t * (2.2 - i * 0.5) + i + 1.9); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `700 ${Math.round(W * 0.052)}px ${FONT}`;
    ctx.fillText('Creating your video', W / 2, H * 0.62);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `500 ${Math.round(W * 0.034)}px ${FONT}`;
    ctx.fillText($('#st-status').textContent.slice(0, 44), W / 2, H * 0.62 + W * 0.07);
    requestAnimationFrame(frame);
  })();
}

const cached = (map, key, make) => { if (!map.has(key)) map.set(key, make().catch((e) => { map.delete(key); throw e; })); return map.get(key); };

function autoResolution() {
  const paid = unlocked(), connection = navigator.connection || {};
  const constrained = !!connection.saveData || /^(slow-2g|2g|3g)$/.test(connection.effectiveType || '')
    || (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) < 4)
    || (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) < 4);
  return paid && !constrained ? 1080 : 720;
}

async function produce(actx) {
  const plan = state.plan, page = state.page, ad = state.ad, cache = state.cache;
  stopPreview();
  const [W, H] = FORMATS[state.fmt], target = +$('#dur').value;
  // Qualité automatique selon l'offre et les capacités réelles de l'appareil.
  const paid = unlocked(), resolution = autoResolution();
  $('#res').value = String(resolution);
  // Le brief IA choisit le template narratif, les sous-titres et leur traitement selon le contenu.
  const templateStyle = plan.templateStyle || 'cinematic';
  const captionStyle = plan.captionStyle || (plan.type === 'saas' ? 'karaoke' : 'boxed');
  state.templateStyle = templateStyle;
  state.captionStyle = captionStyle;
  const job = (state.job = { cancelled: false, actx, plan, host: page.host, size: [W, H], scale: resolution / 720, watermark: !paid, captionStyle, templateStyle, videoTemplate: plan.videoTemplate || 'corporate', quality: resolution });
  const cv = $('#cv'), result = $('#result');
  const scale = job.scale;
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  result.pause();
  cv.hidden = false; result.hidden = true; result.removeAttribute('src');
  waiting(cv, job);
  $('#st-actions').hidden = $('#b-edit').hidden = $('#b-again').hidden = $('#upsell').hidden = true;

  // formats courts : moins de scènes, pour que chacune reste lisible
  const keep = target && target <= 10 ? 2 : target && target <= 15 ? 3 : ad.scenes.length;
  const scenes = (job.scenes = [...ad.scenes.slice(0, keep).map((s) => ({ ...s, icons: (s.logos || []).map((l) => (state.icons?.[l.name.toLowerCase()] ? { img: state.icons[l.name.toLowerCase()], name: l.name } : null)).filter(Boolean), iconImg: state.ui?.[s.icon] || null })), { kind: 'cta', visual: 'cta', photo: -1, headline: ad.cta, voiceover: ad.ctaVoiceover }]);
  // le téléphone n'apparaît que deux fois : une démo bien droite, puis une vue inclinée
  let site = 0;
  scenes.forEach((s) => { if (s.visual === 'site') { if (site < 2) s.variant = site++; else s.visual = 'footage'; } });
  const needClip = (s) => plan.type !== 'ecom' && (s.visual === 'footage' || s.visual === 'site' || s.kind === 'cta') || (plan.type === 'ecom' && s.visual === 'footage' && !photoIds.length);
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
    state.visuals = scenes.map((s) => s.visual);
    const auto = await pickClips(scenes.map((s, i) => (s.kind ? (plan.type === 'saas' ? state.ctaList : []) : state.clipLists[i]) || []), W / H);
    if (job.cancelled) return;
    // licences à mention d'auteur (CC BY) : les plans utilisés sont crédités sur l'écran final
    const credit = (list) => { job.credits = [...new Set(list.filter((u) => u?.cr).map((u) => `${u.au || 'Unknown author'} (${u.lic})`))]; };
    const used = (state.used = scenes.map((s, i) => (s.kind ? (plan.type === 'saas' ? auto[i] || null : null) : s.pick || auto[i] || null)));
    credit(used);
    const voice = (text) => (text ? cached(cache.voice, plan.language + '|' + text, () => loadVoice(text, plan.language)) : Promise.resolve(null));
    const [blobs, stills, voices, shot, brand, photos] = await Promise.all([
      Promise.all(scenes.map((s, i) => tick(used[i]?.kind === 'video' && needClip(s) ? cached(cache.blob, used[i].url, () => fetchBlob(media(lite ? used[i].lite : used[i].url))) : Promise.resolve(null)))),
      Promise.all(scenes.map((s, i) => (used[i]?.kind === 'photo' && needClip(s) ? loadImage(media(used[i].url)) : null))),
      Promise.all(scenes.map((s) => tick(voice(s.spoken || s.voiceover)))),
      tick(site ? (cache.shot ||= loadImage('/api/shot?u=' + encodeURIComponent(page.url))) : Promise.resolve(null)),
      tick(state.logo),
      Promise.all(photoIds.map((i) => tick(loadImage(state.photoUrls[i])))),
      tick(Promise.all([document.fonts.load('800 60px Poppins'), document.fonts.load('600 30px Poppins')])),
    ]);
    if (job.cancelled) return;
    job.shot = shot; job.logo = brand?.img || null; job.logoLight = !!brand?.light; job.logoIcon = brand?.kind === 'icon' || (brand?.img.naturalWidth || 0) < 64;

    // photos produit : détourage quand le fond est uni, sinon la photo est utilisée telle quelle
    const byId = new Map();
    // détourage par modèle de segmentation (dans le navigateur) ; en cas d'échec, méthode par couleur
    const kinds = new Map(plan.photos.map((p) => [p.index, p.kind]));
    // seules les photos montrées « en vedette » sont détourées (le calcul prend quelques secondes par photo)
    const hero = new Set(scenes.filter((x) => x.visual === 'product').map((x) => x.photo));
    hero.add(photoIds.find((i) => kinds.get(i) === 'packshot') ?? photoIds[0]);
    for (let n = 0; n < photos.length; n++) {
      const img = photos[n], id = photoIds[n], key = 'cut' + state.photoUrls[id];
      if (!img) continue;
      const info = (cache['info' + state.photoUrls[id]] ||= photoInfo(img));
      if (!hero.has(id)) { byId.set(id, cache[key] || { img, cut: null, info }); continue; }
      // produit coupé par les bords de la photo (bracelet, pieds de meuble…) : pas de détourage, la photo est cadrée telle quelle
      if (!cache[key] && info?.plain && info.touch >= 2) cache[key] = { img, cut: null, info };
      if (!cache[key]) {
        status('Cutting out your product…');
        // 1. Essai côté serveur (ClearBackdrop / Clipdrop / remove.bg), sinon modèle du navigateur
        const srcUrl = state.photoSources?.[id];
        let cut = srcUrl
          ? await api('/api/backdrop?a=removebg', { url: srcUrl })
              .then(async (r) => {
                if (!r.ok) throw new Error(r.status);
                const blob = await r.blob();
                // Convertit le PNG transparent en canvas rogné (même format que Cutout.run)
                const bUrl = URL.createObjectURL(blob);
                const bImg = await loadImage(bUrl).finally(() => URL.revokeObjectURL(bUrl));
                const cv2 = Object.assign(document.createElement('canvas'), { width: bImg.naturalWidth, height: bImg.naturalHeight });
                cv2.getContext('2d').drawImage(bImg, 0, 0);
                const px2 = cv2.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv2.width, cv2.height);
                // Rogner aux contours opaques (même logique que Cutout.trim)
                const d2 = px2.data, w2 = cv2.width, h2 = cv2.height;
                let x0 = w2, y0 = h2, x1 = 0, y1 = 0;
                for (let y = 0; y < h2; y += 2) for (let x = 0; x < w2; x += 2) {
                  if (d2[(y * w2 + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
                }
                if (x1 - x0 < 20 || y1 - y0 < 20) return null;
                const out2 = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 1, height: y1 - y0 + 1 });
                out2.getContext('2d').drawImage(cv2, x0, y0, out2.width, out2.height, 0, 0, out2.width, out2.height);
                out2.box = [x0 / w2, y0 / h2, (x1 + 1) / w2, (y1 + 1) / h2];
                return out2;
              })
              .catch(() => null) // 503 (pas de clé) ou erreur → on passe au ONNX local
          : null;
        // chaque détourage est contrôlé : s'il retire une partie du produit (cadran blanc, maillons argentés…), on passe au suivant
        if (cut && !cutKeepsProduct(cut, info)) { console.warn('server cutout removed part of the product; trying the next method'); cut = null; }
        // 2. Modèle ONNX local (ormbg) : on le force pour chaque photo réellement utilisée comme produit vedette.
        // Le classement « packshot » de l'analyse ne doit pas empêcher le détourage d'une photo produit classique.
        if (!cut) {
          const localCut = window.Cutout?.run
            ? await window.Cutout.run(img, { force: true, onProgress: (f) => status(`Removing background… ${Math.round(f * 100)}%`) })
                .catch((e) => { console.warn('ONNX background removal failed', e); return null; })
            : null;
          cut = cutKeepsProduct(localCut, info) ? localCut : null;
          if (!cut) { const flat = cutout(img); cut = cutKeepsProduct(flat, info) ? flat : null; }
          if (!cut) status('This photo is kept intact (the cut-out would have damaged the product).');
        }
        if (job.cancelled) return;
        cache[key] = { img, cut, info };
      }
      byId.set(id, cache[key]);
    }
    const ready = [...byId.values()], best = ready.find((p) => p.cut) || ready[0] || null;
    // décor sur mesure généré par IA, seulement s'il y a un produit détouré à poser dessus
    if (best?.cut && $('#bgai').value === '1') {
      status('Creating your one-off product backdrop with Meta Muse Image…');
      // Une référence JPEG légère suffit pour communiquer la catégorie et les couleurs du produit.
      // L'image produit ne sera jamais remplacée : seul le fond est généré.
      let referenceImage = null;
      try {
        const maxSide = 768, scale = Math.min(1, maxSide / Math.max(best.img.naturalWidth, best.img.naturalHeight));
        const rw = Math.max(1, Math.round(best.img.naturalWidth * scale));
        const rh = Math.max(1, Math.round(best.img.naturalHeight * scale));
        const refCanvas = Object.assign(document.createElement('canvas'), { width: rw, height: rh });
        const refCtx = refCanvas.getContext('2d');
        refCtx.fillStyle = '#11121e'; refCtx.fillRect(0, 0, rw, rh);
        refCtx.drawImage(best.img, 0, 0, rw, rh);
        referenceImage = refCanvas.toDataURL('image/jpeg', 0.78);
      } catch (error) { console.warn('Could not prepare Muse reference image', error); }
      try {
        const product = page.product || {};
        const response = await api('/api/backdrop?a=muse', {
          type: 'ecom',
          format: state.fmt,
          scene: plan.backdrop,
          category: plan.category,
          productName: product.name || page.title || plan.tagline,
          productDescription: product.description || plan.summary || page.description,
          variant: Object.entries(state.variant || {}).map(([key, value]) => `${key}: ${value}`).join(', '),
          brandPalette: [plan.palette?.primary, plan.palette?.accent].filter(Boolean).join(', '),
          referenceImage,
        });
        const imageBlob = await response.blob();
        const objectUrl = URL.createObjectURL(imageBlob);
        job.backdrop = await loadImage(objectUrl);
        URL.revokeObjectURL(objectUrl);
        job.backdropModel = job.backdrop ? (response.headers.get('x-image-model') || 'meta/muse-image') : null;
      } catch (error) {
        job.backdrop = null;
        job.backdropModel = null;
        console.warn('Meta Muse backdrop unavailable; using the built-in studio background', error);
        status('Meta Muse is unavailable right now. Using the built-in studio background.');
      }
    }
    scenes.forEach((s, i) => {
      if (s.kind === 'cta') s.ph = best;
      else if (s.visual === 'product' || s.visual === 'detail') s.ph = byId.get(s.photo) || best;
      s.still = stills[i] || null;
    });
    // e-commerce : une scène prévue en vidéo de stock devient une scène produit dès qu'une photo existe
    if (plan.type === 'ecom' && best) scenes.forEach((s, i) => { if (!s.kind && s.visual === 'footage') { s.visual = i % 2 ? 'detail' : 'product'; s.ph = ready[i % ready.length] || best; if (s.visual === 'product' && !s.ph.cut) s.ph = best; } });
    // sans photo, la scène retombe sur la vidéo ou le dégradé
    scenes.forEach((s) => { if (!s.ph && (s.visual === 'product' || s.visual === 'detail')) s.visual = 'footage'; });
    // gros plans : chaque scène vise une zone différente du produit. Le point proposé par l'IA (« le cadran »)
    // est recalé sur la zone détaillée la plus proche ; sans proposition, on prend la suivante non encore montrée.
    const shown = new Map();
    scenes.forEach((s, i) => {
      s.variant ??= i;
      const inf = s.ph?.info;
      if (s.visual !== 'detail' || !inf) return;
      const pts = inf.focus, n = shown.get(s.ph) || 0, [bx0, by0, bx1, by1] = inf.box;
      shown.set(s.ph, n + 1);
      let pt = pts[n % pts.length];
      if (s.focus) {
        const [fx, fy] = s.focus, near = pts.map((p) => [Math.hypot(p.x - fx, p.y - fy), p]).sort((a, b) => a[0] - b[0])[0];
        if (near && near[0] < 0.22) pt = near[1];
        else if (fx > bx0 && fx < bx1 && fy > by0 && fy < by1) pt = { x: fx, y: fy };
      }
      s.focusPt = pt;
    });

    const offline = !!job.MB;
    const first = blobs.findIndex(Boolean), firstStill = stills.find(Boolean) || null;
    if (offline) {
      const opened = await Promise.all(blobs.map((b) => (b ? openClip(job.MB, b, cv.width, cv.height) : null)));
      scenes.forEach((s, i) => { s.clip = s.kind === 'cta' ? opened[i] || opened[first] || null : opened[i]; });
    }
    scenes[scenes.length - 1].still = first < 0 ? firstStill : null;
    scenes.forEach((s, i) => {
      s.voice = voices[i];
      s.speech = s.voice ? s.voice.duration : s.voiceover ? s.voiceover.split(/\s+/).length * 0.36 : 0;
    });
    const tl = timeline(scenes, target);
    job.total = tl.total; job.rate = tl.rate;
    scenes.forEach((s) => { s.words = s.voiceover && s.kind !== 'cta' ? karaoke(s.voiceover, s.speech / tl.rate, 0.3) : []; });
    // logos : chacun apparaît quand son nom est dit (à défaut, à intervalles réguliers)
    scenes.forEach((s) => {
      const flat = (s.words || []).flat(), norm = (w) => String(w).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
      const find = (token) => { const t = norm(token); if (t.length < 3) return null; const x = flat.find((f) => { const n = norm(f.w); return n.length >= 3 && (n.startsWith(t.slice(0, 5)) || t.startsWith(n.slice(0, 5))); }); return x ? x.t0 : null; };
      (s.icons || []).forEach((ic, i) => { ic.t0 = find(ic.name.split(/\s+/)[0]) ?? 0.25 + i * 0.3; });
    });
    const track = Music.byId(state.music);
    job.musicBuf = track ? await Music.render(track, job.total).catch(() => null) : null;
    job.rendering = true;
    const draw = makeRenderer(cv, job);
    const hasAudio = voices.some(Boolean) || !!job.musicBuf;

    let blob = offline ? await exportOffline(job, cv, draw, hasAudio) : null;
    if (job.cancelled) return;
    if (!blob) {
      const vids = await Promise.all(blobs.map((b) => (b ? loadVideoEl(b) : null)));
      scenes.forEach((s, i) => { s.frame = null; s.video = s.kind === 'cta' ? vids[i] || vids[first] || null : vids[i]; });
      blob = await exportRealtime(job, cv, draw);
    }
    if (job.cancelled) return;
    if (!blob) return status('This browser cannot create the video. Try an up-to-date Chrome or Safari.', 100);

    const name = `${plan.brand}-${state.intent}`.normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (blob.type.includes('mp4') ? '.mp4' : '.webm');
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(blob);
    result.src = state.videoUrl; result.hidden = false; cv.hidden = true;
    $('#b-dl').href = state.videoUrl; $('#b-dl').download = name;
    $('#dl-free').href = state.videoUrl; $('#dl-free').download = name;
    $('#b-dl').dataset.gate = paid ? '' : '1';
    const file = new File([blob], name, { type: blob.type });
    $('#b-share').hidden = !navigator.canShare?.({ files: [file] });
    $('#b-share').onclick = () => navigator.share({ files: [file], title: plan.brand }).catch(() => {});
    const notes = [`${+job.total.toFixed(1)} s`, `${cv.width}×${cv.height}`, `${(blob.size / 1e6).toFixed(1)} MB`];
    if (voices.every((v) => !v)) notes.push('no voice-over');
    status('Your video is ready · ' + notes.join(' · '), 100);
    buildEditor(used);
    $('#st-actions').hidden = $('#b-edit').hidden = $('#b-again').hidden = false;
    $('#upsell').hidden = paid;
    $('#upsell-note').textContent = account.proPrice ? `Pro: ${account.proPrice}, every video without watermark.` : '';
    // historique du compte (si connecté) — on joint une vignette 60×108 du canvas courant
    let thumb = null;
    try {
      const TW = 60, TH = Math.round(TW * cv.height / cv.width);
      const tc = Object.assign(document.createElement('canvas'), { width: TW, height: TH });
      tc.getContext('2d').drawImage(cv, 0, 0, TW, TH);
      thumb = tc.toDataURL('image/jpeg', 0.72);
    } catch {}
    api('/api/auth', { action: 'log', gen: { brand: plan.brand, url: page.url, kind: plan.type, intent: state.intent, format: state.fmt, seconds: job.total, resolution: `${cv.width}x${cv.height}`, captionStyle: job.captionStyle, templateStyle: job.templateStyle, videoTemplate: job.videoTemplate, backdropModel: job.backdropModel, thumb } })
      .then((r) => r.json()).then(async (j) => { if (j.id && blob) { try { await vidIdb.set(j.id, blob); await vidIdb.prune(15); } catch {} } refreshAccount(); }).catch(() => {});
  } catch (err) {
    console.error(err);
    if (!job.cancelled) { status('Something went wrong while editing. Please try again.', 100); $('#b-again').hidden = false; }
  } finally {
    if (actx.state !== 'closed') actx.close().catch(() => {});
    scenes.forEach((s) => { s.clip?.iter?.return?.(); try { s.clip?.input.dispose(); } catch {} if (s.video) { s.video.pause(); URL.revokeObjectURL(s.video.src); } });
  }
}

/* ---------- page d'accueil : offres ---------- */
// mobile : bouton d'action collé en bas, sauf quand un autre bouton d'action est déjà à l'écran (haut et bas de page)
const seen = new Set();
const io = new IntersectionObserver((es) => { es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))); $('#sticky-cta').hidden = seen.size > 0; });
[$('#f-url'), $('.cta-end'), $('#pricing')].forEach((el) => io.observe(el));
// mobile : un seul moteur affiché à la fois
$$('.engtabs button').forEach((b) => b.addEventListener('click', () => {
  $('.engines').dataset.show = b.dataset.eng;
  $$('.engtabs button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
}));
$('#sticky-cta').addEventListener('click', () => setTimeout(() => $('#url').focus({ preventScroll: true }), 400));
$('#cta-end').addEventListener('click', () => setTimeout(() => $('#url').focus({ preventScroll: true }), 400));
if (new URLSearchParams(location.search).get('checkout') === 'success') {
  // retour de paiement : on fait confirmer la session, puis le compte passe à l'offre payée
  const n = Object.assign(document.createElement('p'), { className: 'notice', textContent: 'Confirming your payment…' });
  $('.hero-copy').prepend(n);
  api('/api/checkout', { confirm: new URLSearchParams(location.search).get('session_id') }).then((r) => r.json())
    .then((j) => { n.textContent = j.granted ? (j.plan === 'single' ? 'Payment confirmed! Your video will export without watermark.' : `Thank you! Your ${j.plan === 'business' ? 'Business' : 'Pro'} plan is active.`) : 'We could not confirm this payment yet.'; refreshAccount(); })
    .catch((e) => { n.textContent = e.message; });
  history.replaceState(null, '', location.pathname);
}
fetch('/api/config').then((r) => r.json()).then(({ plans, reviews = [] }) => {
  // avis clients : affichés seulement s'il y en a de vrais
  $('#reviews').hidden = !reviews.length;
  reviews.forEach((r) => {
    const el = Object.assign(document.createElement('figure'), { className: 'review' });
    el.append(Object.assign(document.createElement('div'), { className: 'stars', textContent: '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), ariaLabel: `${r.stars} out of 5` }));
    el.append(Object.assign(document.createElement('blockquote'), { textContent: r.quote }));
    const who = document.createElement('figcaption');
    who.append(r.photo ? Object.assign(new Image(), { src: r.photo, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('span'), { className: 'avatar', textContent: r.name[0].toUpperCase() }));
    const t = document.createElement('div');
    t.append(Object.assign(document.createElement('b'), { textContent: r.name }), Object.assign(document.createElement('small'), { textContent: r.role }));
    who.append(t); el.append(who);
    $('#reviews-list').append(el);
  });
  const box = $('#plans');
  account.proPrice = (plans.find((x) => x.id === 'pro') || {}).price ? `${plans.find((x) => x.id === 'pro').price}${plans.find((x) => x.id === 'pro').period || ''}` : '';
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
    else if (p.checkout === 'api') {
      const b = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: `Choose ${p.name}` });
      b.addEventListener('click', async () => {
        b.disabled = true;
        if (!account.user) { b.disabled = false; return openAccount(true); }
        try { location.href = (await (await api('/api/checkout', { plan: p.id })).json()).url; }
        catch (err) { b.disabled = false; b.textContent = err.message; }
      });
      el.append(b);
    } else if (p.checkout) el.append(Object.assign(document.createElement('a'), { className: 'btn', href: p.checkout, rel: 'noopener', textContent: `Choose ${p.name}` }));
    else el.append(Object.assign(document.createElement('button'), { className: 'btn ghost', type: 'button', disabled: true, textContent: 'Coming soon' }));
    box.append(el);
  });
}).catch(() => { $('#pricing').hidden = true; });

/* ---------- bandeau d'annonce ---------- */
function announce(text) {
  $('#topbar-text').textContent = text;
  $('#topbar').hidden = false;
}
$('#topbar-go').addEventListener('click', () => openUpgrade($('#topbar-text').textContent));
$('#topbar-x').addEventListener('click', () => { $('#topbar').hidden = true; });

/* ---------- compte, profil, offre ---------- */
const account = { user: null, history: [], objectUrls: [], signup: false, reset: new URLSearchParams(location.search).get('reset'), proPrice: '' };
const isPaid = () => !!account.user && account.user.plan !== 'free';
// vidéo débloquée à l'unité : valable pour cette pub, retouches comprises
const unlocked = () => isPaid() || (!!state.ad && state.unlockedAd === state.ad);
const PLAN_NAME = { free: 'Starter (free)', pro: 'Pro', business: 'Business' };
function paintAccount() {
  account.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  account.objectUrls = [];
  const u = account.user;
  // Nav : connecté → avatar circulaire avec initiale + masquer "Try it free"
  //       déconnecté → bouton "Sign in" + afficher "Try it free"
  const navTry = document.getElementById('nav-try');
  if (u) {
    $('#b-account').dataset.avatar = u.email[0].toUpperCase();
    $('#b-account').title = u.email;
    $('#b-account').classList.add('nav-avatar');
    if (navTry) navTry.hidden = true;
  } else {
    delete $('#b-account').dataset.avatar;
    $('#b-account').title = '';
    $('#b-account').classList.remove('nav-avatar');
    if (navTry) navTry.hidden = false;
  }
  $('#b-account').textContent = u ? '' : 'Sign in';
  $('#ac-in').hidden = !u; $('#ac-form').hidden = !!u;
  $('#ac-title').textContent = u ? 'Your account' : account.reset ? 'Choose a new password' : account.signup ? 'Create your account' : 'Sign in';
  $('#ac-email').hidden = $('label[for="ac-email"]').hidden = $('#ac-switch').hidden = $('#ac-forgot').hidden = !!account.reset;
  $('#ac-forgot').hidden ||= account.signup;
  if (u) {
    $('#ac-avatar').textContent = u.email[0].toUpperCase();
    $('#ac-mail').textContent = u.email;
    $('#ac-plan').textContent = `${PLAN_NAME[u.plan] || u.plan} plan` + (u.plan === 'free' ? ' · 720p with watermark' : ' · 1080p, no watermark');
    $('#ac-up').hidden = u.plan !== 'free';
    $('#ac-admin').hidden = !u.admin;
    $('#ac-usage').textContent = account.usage ? ` · ${account.usage.used}/${account.usage.limit} videos this month` : '';
    const list = $('#ac-history');
    list.textContent = '';
    if (!account.history.length) list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Your finished videos will be listed here.' }));
    account.history.forEach((h) => {
      const li = document.createElement('li');
      li.className = 'history-card';

      const thumb = document.createElement('div');
      thumb.className = 'history-thumb';
      if (h.thumb) {
        const img = Object.assign(document.createElement('img'), { src: h.thumb, alt: '', width: 72, height: 128, loading: 'lazy' });
        thumb.append(img);
      } else {
        const ic = document.createElement('span');
        ic.className = 'hist-ic';
        ic.textContent = h.kind === 'ecom' ? '🛍' : '📱';
        thumb.append(ic);
      }

      const main = document.createElement('div');
      main.className = 'history-main';
      const top = document.createElement('div');
      top.className = 'history-top';
      const title = Object.assign(document.createElement('b'), { className: 'history-title', textContent: h.brand || (() => { try { return new URL(h.url).hostname; } catch { return 'Untitled video'; } })() });
      const date = Object.assign(document.createElement('small'), { className: 'history-date', textContent: new Date(h.created_at).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) });
      top.append(title, date);

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      [h.format, `${Math.round(h.seconds || 0)} sec`, h.resolution].filter(Boolean).forEach((value) => {
        meta.append(Object.assign(document.createElement('span'), { textContent: value }));
      });
      const captionNames = { karaoke:'Karaoke', 'bold-pop':'Bold Pop', typewriter:'Typewriter', neon:'Neon', minimal:'Minimal', highlight:'Highlight', editorial:'Editorial', boxed:'Boxed', word:'Word by Word', clean:'Clean' };
      const templateNames = { cinematic:'Cinematic', bold:'Bold', editorial:'Editorial', minimal:'Minimal', neon:'Neon', split:'Split', social:'Social', product:'Product' };
      const creativeNames = { 'product-demo':'Product demo', 'problem-solution':'Problem / solution', 'feature-showcase':'Feature showcase', 'startup-launch':'Startup launch', 'customer-story':'Customer story', corporate:'Corporate', 'editorial-product':'Editorial product', 'product-spotlight':'Product spotlight', 'lifestyle-product':'Lifestyle product' };
      if (h.caption_style) meta.append(Object.assign(document.createElement('span'), { textContent: captionNames[h.caption_style] || h.caption_style }));
      if (h.template_style) meta.append(Object.assign(document.createElement('span'), { textContent: templateNames[h.template_style] || h.template_style }));
      if (h.creative_template) meta.append(Object.assign(document.createElement('span'), { textContent: creativeNames[h.creative_template] || h.creative_template }));

      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const again = Object.assign(document.createElement('button'), { type: 'button', className: 'history-action', textContent: 'Create again' });
      again.addEventListener('click', () => { $('#account').close(); show('s-url', 1); $('#url').value = h.url || ''; $('#f-url').requestSubmit(); });
      actions.append(again);

      if (h.id) {
        vidIdb.get(h.id).then((blob) => {
          if (!blob || !li.isConnected) return;
          const ext = blob.type.includes('mp4') ? '.mp4' : '.webm';
          const fname = (h.brand || 'clipmotion-video').normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '-') + ext;
          const downloadUrl = URL.createObjectURL(blob);
          account.objectUrls.push(downloadUrl);
          const dl = Object.assign(document.createElement('a'), { href: downloadUrl, download: fname, className: 'history-action', textContent: '↓ Download' });
          const prev = Object.assign(document.createElement('button'), { type: 'button', className: 'history-action primary', textContent: '▶ Preview' });
          prev.addEventListener('click', () => {
            $('#account').close();
            const previewUrl = URL.createObjectURL(blob);
            const dialog = document.createElement('dialog');
            dialog.className = 'history-preview';
            const head = document.createElement('div');
            head.className = 'history-preview-head';
            head.append(Object.assign(document.createElement('b'), { textContent: h.brand || 'Video preview' }));
            const close = Object.assign(document.createElement('button'), { type: 'button', className: 'history-preview-close', textContent: 'Close' });
            const video = Object.assign(document.createElement('video'), { src: previewUrl, controls: true, autoplay: true, playsInline: true });
            video.setAttribute('aria-label', `Preview of ${h.brand || 'your video'}`);
            close.addEventListener('click', () => dialog.close());
            dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
            dialog.addEventListener('close', () => {
              video.pause();
              URL.revokeObjectURL(previewUrl);
              dialog.remove();
            }, { once: true });
            head.append(close);
            dialog.append(head, video);
            document.body.append(dialog);
            dialog.showModal();
            video.play().catch(() => {});
          });
          actions.append(dl, prev);
        }).catch((err) => console.warn('Could not load video from local history', err));
      }

      main.append(top, meta, actions);
      li.append(thumb, main);
      list.append(li);
    });
  }
  $('#ac-go').textContent = account.reset ? 'Save password' : account.signup ? 'Create account' : 'Sign in';
  $('#ac-switch').textContent = account.signup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('#ac-pass').autocomplete = account.signup ? 'new-password' : 'current-password';
}
const refreshAccount = () => fetch('/api/auth').then((r) => r.json()).then((j) => { account.user = j.user; account.usage = j.usage; account.history = j.history || [];
  if (j.usage && j.usage.used >= j.usage.limit && !(j.user && j.user.plan === 'business')) announce(`You have used your ${j.usage.limit} ${j.user && j.user.plan !== 'free' ? '' : 'free '}videos this month. Upgrade to keep creating.`); $('#b-account').hidden = !j.enabled; paintAccount(); }).catch(() => {});
// fenêtre d'offre : s'ouvre quand une option payante est demandée
function openUpgrade(why, single) {
  $('#up-one').hidden = !single;
  $('#up-why').textContent = why || 'Get the most out of every video.';
  $('#up-price').textContent = account.proPrice;
  fail($('#up-err'), '');
  $('#upgrade').showModal();
}
async function startCheckout(errEl) {
  if (!account.user) { $('#upgrade').close(); return openAccount(true); }
  try { location.href = (await (await api('/api/checkout', { plan: 'pro', promo: $('#up-promo').value.trim() || undefined })).json()).url; }
  catch (err) { fail(errEl, err.message); }
}
$('#up-go').addEventListener('click', () => startCheckout($('#up-err')));
$('#ac-up').addEventListener('click', () => { $('#account').close(); openUpgrade('You are on the free Starter plan.'); });
// à l'export : deux façons d'enlever le filigrane, à l'unité ou avec l'offre Pro
$('#b-nomark').addEventListener('click', () => $('#up-one').click());
$('#b-gopro').addEventListener('click', () => openUpgrade('Every video in 1080p, without watermark.', true));
// Export à l'unité : le paiement s'ouvre dans un nouvel onglet pour ne pas perdre la vidéo en cours ;
// dès que le paiement est confirmé, la vidéo est remontée en 1080p sans filigrane.
$('#up-one').addEventListener('click', async () => {
  if (!account.user) { $('#upgrade').close(); return openAccount(true); }
  const tab = window.open('', '_blank');
  try {
    const { url } = await (await api('/api/checkout', { plan: 'single', promo: $('#up-promo').value.trim() || undefined })).json();
    if (tab) tab.location = url; else location.href = url;
  } catch (err) { tab?.close(); return fail($('#up-err'), err.message); }
  $('#upgrade').close();
  status('Waiting for your payment…');
  const ad = state.ad;
  for (let i = 0; i < 120 && state.ad === ad; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    await refreshAccount();
    if (account.user?.credits > 0) {
      const { ok } = await (await api('/api/auth', { action: 'spend' })).json();
      if (ok) { state.unlockedAd = ad; cancelJob(); return produce(newAudio()); }
    }
  }
  status('Payment not confirmed yet. If you paid, tap “Remove watermark” again in a moment.');
});
function openAccount(signup) { account.signup = !!signup; fail($('#ac-err'), ''); paintAccount(); $('#account').showModal(); }
$('#b-account').addEventListener('click', () => openAccount(false));
$('#ac-switch').addEventListener('click', () => { account.signup = !account.signup; fail($('#ac-err'), ''); paintAccount(); });
$('#ac-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  fail($('#ac-err'), '');
  try {
    const body = account.reset ? { action: 'reset', token: account.reset, password: $('#ac-pass').value } : { action: account.signup ? 'signup' : 'login', email: $('#ac-email').value, password: $('#ac-pass').value };
    account.user = (await (await api('/api/auth', body)).json()).user;
    refreshAccount();
    if (account.reset) { account.reset = null; history.replaceState(null, '', location.pathname); }
    $('#ac-pass').value = '';
    paintAccount(); $('#account').close();
  } catch (err) { fail($('#ac-err'), err.message); }
});
$('#ac-out').addEventListener('click', async () => { await api('/api/auth', { action: 'logout' }).catch(() => {}); account.user = null; paintAccount(); $('#account').close(); });
refreshAccount();
$('#ac-forgot').addEventListener('click', async () => {
  fail($('#ac-err'), '');
  const email = $('#ac-email').value.trim();
  if (!email) return fail($('#ac-err'), 'Enter your email first');
  await api('/api/auth', { action: 'forgot', email }).catch(() => {});
  $('#ac-msg').textContent = 'If an account exists for this address, a reset link is on its way.';
});
if (account.reset) openAccount(false);

/* ---------- téléchargement : choix sans filigrane avant de télécharger la version gratuite ---------- */
$('#b-dl').addEventListener('click', (e) => {
  if (!$('#b-dl').dataset.gate) return;
  e.preventDefault();
  $('#dl-pro-price').textContent = account.proPrice || '';
  $('#dlgate').showModal();
});
$('#dl-one').addEventListener('click', () => { $('#dlgate').close(); $('#up-one').click(); });
$('#dl-pro').addEventListener('click', () => { $('#dlgate').close(); openUpgrade('Every video in 1080p, without watermark.', true); });
$('#dl-free').addEventListener('click', () => $('#dlgate').close());

/* ---------- application installable (PWA) et notifications ---------- */
let installEvent = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#b-install').hidden = false; });
addEventListener('appinstalled', () => { $('#b-install').hidden = true; });
$('#b-install').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $('#b-install').hidden = true; });
// notifications : proposées dans le compte quand le navigateur les permet et qu'elles ne sont pas déjà actives
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function paintNotify() {
  if (!canPush) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null), sub = reg && (await reg.pushManager.getSubscription().catch(() => null));
  $('#ac-notify').hidden = !reg || !!sub || Notification.permission === 'denied';
}
$('#ac-notify').addEventListener('click', async () => {
  try {
    const { key } = await (await fetch('/api/push')).json();
    if (!key || (await Notification.requestPermission()) !== 'granted') return paintNotify();
    const reg = await navigator.serviceWorker.ready;
    const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    await api('/api/push', { action: 'subscribe', subscription: sub.toJSON() });
    $('#ac-notify').textContent = 'Notifications are on';
    setTimeout(paintNotify, 1500);
  } catch (err) { console.warn('push', err); }
});
paintNotify();
