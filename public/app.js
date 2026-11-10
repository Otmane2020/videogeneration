'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FORMATS = { '9:16': [720, 1280], '1:1': [720, 720], '16:9': [1280, 720] };
const state = { page: null, type: null, plan: null, fmt: '9:16', job: null, music: '' };
const media = (u) => '/api/media?u=' + encodeURIComponent(u);

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
  return r;
}

function show(id, step) {
  $$('.view').forEach((v) => (v.hidden = v.id !== id));
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
  if (!/^(https?:\/\/)?[^\s/.]+\.[^\s]{2,}$/i.test(url)) return fail($('#e-url'), 'Entrez une adresse valide, par exemple monsite.com');
  $('#scan-title').textContent = 'Inspection en cours…';
  $('#scan-sub').textContent = url.replace(/^https?:\/\//, '');
  show('s-inspect', 2);
  try {
    state.page = await (await api('/api/inspect', { url })).json();
    renderType();
  } catch (err) {
    show('s-url', 1);
    fail($('#e-url'), err.message);
  }
});
$$('[data-back]').forEach((b) => b.addEventListener('click', () => show('s-url', 1)));

/* ---------- 3. SaaS ou E-com ---------- */
function renderType() {
  const p = state.page;
  $('#site-host').textContent = p.host;
  $('#site-title').textContent = p.title || p.siteName;
  $('#site-desc').textContent = p.description || p.h1[0] || '';
  const img = $('#site-img');
  img.hidden = !p.images[0];
  if (p.images[0]) { img.onerror = () => (img.hidden = true); img.src = media(p.images[0]); }
  $$('.type .badge').forEach((b) => (b.hidden = b.parentElement.dataset.type !== p.guess.type));
  setType(p.guess.type);
  fail($('#e-type'), '');
  show('s-type', 3);
}
function setType(t) {
  state.type = t;
  $$('.type').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === t)));
}
$$('.type').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));

$('#b-gen').addEventListener('click', async () => {
  $('#scan-title').textContent = 'L’IA regarde votre site…';
  $('#scan-sub').textContent = 'Analyse des visuels et écriture de 3 pubs';
  show('s-inspect', 3);
  try {
    state.plan = await (await api('/api/analyze', { page: state.page, type: state.type })).json();
    renderAds();
  } catch (err) {
    show('s-type', 3);
    fail($('#e-type'), err.message);
  }
});

/* ---------- 4. pubs ---------- */
function renderAds() {
  const plan = state.plan;
  $('#brand-name').textContent = plan.brand;
  $('#brand-sum').textContent = plan.summary || plan.tagline;
  $('#sw1').style.background = plan.palette.primary;
  $('#sw2').style.background = plan.palette.accent;
  $('#engine').textContent = `${plan.type === 'ecom' ? 'E-commerce' : 'SaaS'} · Script : ${plan.engine}` + (plan.vision ? ` · ${plan.vision} visuel(s) analysé(s)` : '');
  setMusic(plan.type === 'ecom' ? 'm6' : 'm1');
  const box = $('#ads');
  box.textContent = '';
  plan.ads.forEach((ad) => {
    const n = $('#t-ad').content.cloneNode(true);
    $('.angle', n).textContent = ad.angle;
    ad.scenes.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s.headline + (s.visual === 'site' ? ' · site' : s.visual === 'product' ? ' · produit' : '');
      const sm = document.createElement('small');
      sm.textContent = s.voiceover;
      if (s.voiceover !== s.headline) li.append(sm);
      $('.scenes', n).append(li);
    });
    $('.cta', n).textContent = ad.cta;
    const thumbs = $('.thumbs', n);
    ad.scenes.slice(0, 4).forEach(() => thumbs.append(document.createElement('i')));
    $('.btn', n).addEventListener('click', () => produce(ad));
    box.append(n);
    // Pixabay : on cherche les plans tout de suite pour afficher un aperçu
    ad.clips = api('/api/videos', { queries: ad.scenes.map((s) => s.query), fallback: plan.type === 'ecom' ? 'shopping' : 'technology' })
      .then((r) => r.json())
      .then(({ results }) => results)
      .catch(() => ad.scenes.map(() => []));
    ad.clips.then((lists) => pickClips(lists, false).slice(0, 4).forEach((c, i) => {
      if (!c?.thumb) return;
      const im = new Image();
      im.alt = '';
      im.loading = 'lazy';
      im.onload = () => thumbs.children[i]?.replaceWith(im);
      im.src = c.thumb;
    }));
  });
  show('s-ads', 4);
}
$$('.seg button').forEach((b) => b.addEventListener('click', () => {
  state.fmt = b.dataset.fmt;
  $$('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
}));

/* ---------- musique ---------- */
const preview = { ctx: null, src: null };
function stopPreview() {
  try { preview.src?.stop(); } catch {}
  preview.src = null;
  $('#b-listen').textContent = 'Écouter';
}
function setMusic(id) {
  stopPreview();
  state.music = id;
  $('#music').value = id;
}
(function initMusic() {
  const sel = $('#music');
  sel.append(new Option('Sans musique', ''));
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
  job.scenes.forEach((s) => {
    if (!s.voice) return;
    const n = ctx.createBufferSource();
    n.buffer = s.voice; n.connect(out); n.start(t0 + s.start + 0.3);
  });
  if (!job.musicBuf) return;
  const g = ctx.createGain(), n = ctx.createBufferSource();
  g.gain.setValueAtTime(0.6, t0);
  job.scenes.forEach((s) => {
    if (!s.voice) return;
    g.gain.setTargetAtTime(0.2, t0 + s.start + 0.15, 0.08);
    g.gain.setTargetAtTime(0.6, t0 + s.start + 0.3 + s.voice.duration, 0.18);
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
const loadImage = (src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im.naturalWidth > 80 ? im : null);
  im.onerror = () => res(null);
  im.src = src;
});
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
async function loadVoice(actx, text, lang) {
  if (!text) return null;
  try {
    const buf = await (await api('/api/tts', { text, lang })).arrayBuffer();
    return await new Promise((ok, ko) => actx.decodeAudioData(buf, ok, ko));
  } catch { return null; }
}

/* ---------- dessin ---------- */
const clamp = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
const backOut = (x) => { x = clamp(x); return 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2); };
const FONT = 'Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? '#101010' : '#ffffff';
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
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
function karaoke(text, speech) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = words.map((w) => w.length + 2 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weight.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const timed = words.map((w, i) => { const t0 = 0.3 + (acc / sum) * speech; acc += weight[i]; return { w, t0, t1: 0.3 + (acc / sum) * speech }; });
  const chunks = [];
  let cur = [];
  for (const x of timed) {
    if (cur.length && (cur.length >= 4 || cur.map((y) => y.w).join(' ').length + x.w.length > 22)) { chunks.push(cur); cur = []; }
    cur.push(x);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function makeRenderer(cv, job) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const { scenes, plan, product, shot } = job;
  const P = plan.palette.primary, A = plan.palette.accent;
  const wide = W > H, square = W === H;
  const pad = wide ? 64 : 44;
  const textW = wide ? W * 0.5 : W - pad * 2;
  const headSize = wide ? 56 : square ? 52 : 62;
  const lh = headSize * 1.3;
  const bottom = H - (wide ? 70 : square ? 64 : H * 0.115);

  function background(sc, k, alpha) {
    ctx.globalAlpha = alpha;
    const src = sc.frame || (sc.video && sc.video.readyState >= 2 && sc.video.videoWidth ? sc.video : null);
    if (src) {
      const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
      const s = Math.max(W / sw, H / sh) * (1.03 + 0.07 * k);
      ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
    } else {
      const g = ctx.createLinearGradient(0, 0, W * (0.4 + 0.6 * k), H);
      g.addColorStop(0, P); g.addColorStop(1, '#07140f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  // zone libre pour le visuel (téléphone ou produit) : au-dessus du texte, ou à droite en 16:9
  const heroBox = (textTop) => (wide
    ? { x: W * 0.58, y: 70, w: W * 0.42 - pad, h: H - 140 }
    : { x: pad, y: 118, w: W - pad * 2, h: textTop - 118 - 28 });

  function productCard(box, local) {
    const size = Math.min(box.w, box.h, 460) * backOut((local - 0.15) / 0.5);
    if (size <= 4) return;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2 + Math.sin(local * 1.6) * 6;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#fff';
    rr(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.08); ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.08); ctx.clip();
    const iw = product.naturalWidth, ih = product.naturalHeight, f = Math.max(size / iw, size / ih);
    ctx.drawImage(product, cx - iw * f / 2, cy - ih * f / 2, iw * f, ih * f);
    ctx.restore();
  }

  // le vrai site, dans un téléphone, qui défile doucement
  function phone(box, local, dur) {
    let h = Math.min(box.h, 760), w = h * 0.5;
    if (w > box.w) { w = box.w; h = Math.min(box.h, w * 2); }
    if (square) { w = Math.min(box.w, 400); h = box.h; }
    if (h < 150) return;
    const k = easeOut((local - 0.1) / 0.55);
    const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2 + (1 - k) * 80;
    const b = Math.max(8, w * 0.03), r = w * 0.1;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
    ctx.fillStyle = '#0b0b0d';
    rr(ctx, x, y, w, h, r); ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(ctx, x + b, y + b, w - b * 2, h - b * 2, r - b); ctx.clip();
    const sw = w - b * 2, sh = h - b * 2, f = sw / shot.naturalWidth, full = shot.naturalHeight * f;
    const travel = Math.max(0, Math.min(full - sh, sh * 0.9));
    ctx.fillStyle = '#fff'; ctx.fillRect(x + b, y + b, sw, sh);
    ctx.drawImage(shot, x + b, y + b - travel * easeInOut((local - 0.9) / Math.max(dur - 1.6, 1)), sw, full);
    ctx.restore();
    if (!square) { ctx.globalAlpha = k; ctx.fillStyle = '#0b0b0d'; rr(ctx, x + w / 2 - w * 0.14, y + b + 8, w * 0.28, Math.max(10, w * 0.055), 20); ctx.fill(); ctx.globalAlpha = 1; }
  }

  function scene(sc, local) {
    const hero = (sc.visual === 'site' && shot) || (sc.visual === 'product' && product);
    let g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.3, `rgba(0,0,0,${hero ? 0.45 : 0.05})`); g.addColorStop(0.55, `rgba(0,0,0,${hero ? 0.5 : 0.25})`); g.addColorStop(1, 'rgba(0,0,0,.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

    // sous-titre mot à mot
    const chunk = sc.words.find((c) => local < c[c.length - 1].t1 + 0.25) || null;
    if (chunk && local >= chunk[0].t0 - 0.15) {
      ctx.font = `600 34px ${FONT}`;
      let x = pad;
      ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      for (const wd of chunk) {
        const on = local >= wd.t0 && local < wd.t1;
        ctx.strokeText(wd.w, x, bottom);
        ctx.fillStyle = on ? A : local >= wd.t1 ? '#fff' : 'rgba(255,255,255,.6)';
        ctx.fillText(wd.w, x, bottom);
        x += ctx.measureText(wd.w + ' ').width;
      }
    }

    // titre en bandeaux de couleur
    ctx.font = `800 ${headSize}px ${FONT}`;
    const lines = wrap(ctx, sc.headline, textW - 36, 3);
    const top = bottom - 64 - lines.length * lh;
    lines.forEach((l, i) => {
      const k = easeOut((local - 0.12 - i * 0.13) / 0.4);
      if (k <= 0) return;
      const y = top + i * lh + (1 - k) * 34, last = i === lines.length - 1;
      ctx.globalAlpha = k;
      ctx.fillStyle = last ? A : P;
      rr(ctx, pad - 6, y, ctx.measureText(l).width + 36, lh - 8, 12); ctx.fill();
      ctx.fillStyle = onColor(last ? A : P);
      ctx.fillText(l, pad + 12, y + headSize * 0.99);
      ctx.globalAlpha = 1;
    });

    if (hero) (sc.visual === 'site' ? phone : productCard)(heroBox(top), local, sc.dur);
  }

  function cta(sc, local) {
    ctx.fillStyle = 'rgba(4,12,10,.66)'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, P + 'cc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const withProduct = product && plan.type === 'ecom' && !wide;
    let y = H * (withProduct ? 0.58 : 0.45);
    if (withProduct) { const s = Math.min(W, H) * 0.36; productCard({ x: W / 2 - s / 2, y: y - s - 110, w: s, h: s }, local + 0.15); }

    const k1 = easeOut(local / 0.45);
    let size = wide ? 92 : 84;
    ctx.font = `800 ${size}px ${FONT}`;
    const bw = ctx.measureText(plan.brand).width;
    if (bw > W - pad * 2) { size *= (W - pad * 2) / bw; ctx.font = `800 ${size}px ${FONT}`; }
    ctx.globalAlpha = k1; ctx.fillStyle = '#fff';
    ctx.fillText(plan.brand, W / 2, y + (1 - k1) * 30);
    ctx.font = `600 30px ${FONT}`;
    ctx.globalAlpha = easeOut((local - 0.2) / 0.45) * 0.92;
    y += 16;
    wrap(ctx, plan.tagline, Math.min(W - pad * 2, 760), 2).forEach((l) => { y += 44; ctx.fillText(l, W / 2, y); });

    const k3 = backOut((local - 0.45) / 0.45);
    if (k3 > 0) {
      ctx.font = `800 36px ${FONT}`;
      const bwid = Math.min(W - pad * 2, ctx.measureText(sc.headline).width + 96), bh = 88;
      const s = k3 * (1 + 0.035 * Math.sin(local * 5));
      ctx.save();
      ctx.translate(W / 2, y + 104); ctx.scale(s, s);
      ctx.globalAlpha = clamp(k3);
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
      ctx.fillStyle = A; rr(ctx, -bwid / 2, -bh / 2, bwid, bh, bh / 2); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = onColor(A); ctx.fillText(sc.headline, 0, 13, bwid - 40);
      ctx.restore();
    }
    ctx.globalAlpha = easeOut((local - 0.8) / 0.4) * 0.85;
    ctx.font = `600 28px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.fillText(job.host, W / 2, y + 200);
    ctx.globalAlpha = 1;
  }

  function chrome(t, idx) {
    const gap = 6, bw = (W - pad * 2 - gap * (scenes.length - 1)) / scenes.length;
    scenes.forEach((s, i) => {
      const x = pad + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; rr(ctx, x, 30, bw, 5, 3); ctx.fill();
      const f = clamp((t - s.start) / s.dur);
      if (f > 0) { ctx.fillStyle = '#fff'; rr(ctx, x, 30, bw * f, 5, 3); ctx.fill(); }
    });
    if (scenes[idx].kind === 'cta') return;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = P; ctx.beginPath(); ctx.arc(pad + 14, 76, 14, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = `600 27px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
    ctx.fillText(plan.brand, pad + 40, 78);
    ctx.shadowBlur = 0;
  }

  const FADE = 0.4;
  const draw = (t) => {
    const idx = sceneAt(scenes, t), sc = scenes[idx], local = t - sc.start;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (idx > 0 && local < FADE) background(scenes[idx - 1], 1, 1);
    background(sc, clamp(local / sc.dur), idx > 0 ? clamp(local / FADE) : 1);
    (sc.kind === 'cta' ? cta : scene)(sc, local);
    chrome(t, idx);
    return idx;
  };
  return draw;
}
function sceneAt(scenes, t) {
  const i = scenes.findIndex((s) => t < s.start + s.dur);
  return i < 0 ? scenes.length - 1 : i;
}

/* ---------- montage ---------- */
const status = (msg, pct) => { $('#st-status').textContent = msg; if (pct != null) $('#st-bar').style.width = pct + '%'; };
const FPS = 30;

// Export image par image avec Mediabunny (WebCodecs) : vrai MP4, fluide même sur un téléphone lent.
async function exportOffline(job, cv, draw, voices) {
  const MB = job.MB;
  const format = new MB.Mp4OutputFormat({ fastStart: 'in-memory' });
  const vcodec = await MB.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'].filter((c) => format.getSupportedCodecs().includes(c)), { width: cv.width, height: cv.height });
  if (!vcodec) return null;
  const acodec = voices.some(Boolean) || job.musicBuf ? await MB.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 }) : null;
  const output = new MB.Output({ format, target: new MB.BufferTarget() });
  job.output = output;
  const vsrc = new MB.CanvasSource(cv, { codec: vcodec, bitrate: 5e6, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  const asrc = acodec ? new MB.AudioBufferSource({ codec: acodec, bitrate: 128e3 }) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  if (asrc) {
    const off = new OfflineAudioContext(2, Math.ceil(job.total * 48000), 48000);
    mixAudio(off, off.destination, job);
    await asrc.add(await off.startRendering());
  }

  const frames = Math.ceil(job.total * FPS);
  for (let f = 0; f < frames; f++) {
    if (job.cancelled) { await output.cancel().catch(() => {}); return null; }
    const t = f / FPS, sc = job.scenes[sceneAt(job.scenes, t)];
    if (sc.clip) sc.frame = await clipFrame(sc.clip, t - sc.start);
    draw(t);
    await vsrc.add(t, 1 / FPS);
    if (f % 10 === 0) { status(`Rendu de la vidéo… ${Math.round((f / frames) * 100)} %`, (f / frames) * 100); await new Promise((r) => setTimeout(r)); }
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

async function openClip(MB, blob, W, H) {
  try {
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    return { input, sink: new MB.CanvasSink(track, { width: W, height: H, fit: 'cover', poolSize: 3 }), duration: await track.computeDuration(), at: 0 };
  } catch { return null; }
}

// Secours pour les navigateurs sans WebCodecs : enregistrement en temps réel.
async function exportRealtime(job, cv, draw, voices) {
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
        if (prev && prev !== next) setTimeout(() => prev.pause(), 450);
        cur = idx;
      }
      status(`Enregistrement… ${Math.ceil(job.total - now)} s`, (now / job.total) * 100);
      requestAnimationFrame(frame);
    })();
  });
  scenes.forEach((s) => s.video?.pause());
  await new Promise((ok) => { rec.onstop = ok; setTimeout(() => rec.stop(), 250); });
  return job.cancelled ? null : new Blob(chunks, { type: (rec.mimeType || 'video/webm').split(';')[0] });
}

async function produce(ad) {
  const plan = state.plan, page = state.page;
  stopPreview();
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC(); // créé dans le geste utilisateur (iOS)
  const job = (state.job = { cancelled: false, actx, plan, host: page.host });
  const cv = $('#cv'), result = $('#result');
  [cv.width, cv.height] = FORMATS[state.fmt];
  const W = cv.width, H = cv.height;
  cv.getContext('2d').clearRect(0, 0, W, H);
  cv.hidden = false; result.hidden = true; result.removeAttribute('src');
  $('#st-actions').hidden = true;
  $('#studio').hidden = false;
  document.body.style.overflow = 'hidden';

  const scenes = (job.scenes = [...ad.scenes.map((s) => ({ ...s })), { kind: 'cta', headline: ad.cta, voiceover: ad.ctaVoiceover }]);
  const n = ad.scenes.length;
  let done = 0;
  const tasks = n * 2 + 4;
  const tick = (p) => p.then((v) => { status('Préparation des plans, du site et de la voix off…', (++done / tasks) * 100); return v; }, () => { done++; return null; });
  status('Préparation des plans, du site et de la voix off…', 0);

  try {
    job.MB = window.VideoEncoder ? await import('/vendor/mediabunny.min.mjs').catch(() => null) : null;
    const lite = navigator.connection && (navigator.connection.saveData || /2g|3g/.test(navigator.connection.effectiveType || ''));
    const clips = pickClips(await ad.clips, H > W);
    const needShot = scenes.some((s) => s.visual === 'site');
    const needProduct = plan.type === 'ecom' && page.images[0];
    const [blobs, voices, shot, product] = await Promise.all([
      Promise.all(clips.map((c) => tick(c ? fetchBlob(media(lite ? c.lite : c.url)) : Promise.resolve(null)))),
      Promise.all(scenes.map((s) => tick(loadVoice(actx, s.voiceover, plan.language)))),
      tick(needShot ? loadImage('/api/shot?u=' + encodeURIComponent(page.url)) : Promise.resolve(null)),
      tick(needProduct ? loadImage(media(page.images[0])) : Promise.resolve(null)),
      tick(Promise.all([document.fonts.load(`800 60px Poppins`), document.fonts.load(`600 30px Poppins`)])),
    ]);
    if (job.cancelled) return;
    job.shot = shot; job.product = product;

    let offline = !!job.MB;
    if (offline) {
      const opened = await Promise.all(blobs.map((b) => (b ? openClip(job.MB, b, W, H) : null)));
      scenes.forEach((s, i) => { s.clip = s.kind === 'cta' ? opened[0] : opened[i]; });
    }
    let t = 0;
    scenes.forEach((s, i) => {
      s.voice = voices[i];
      const read = s.voiceover ? s.voiceover.split(/\s+/).length * 0.36 : 0;
      const speech = s.voice ? s.voice.duration : read;
      s.words = s.voiceover && s.kind !== 'cta' ? karaoke(s.voiceover, speech) : [];
      s.dur = Math.max(s.kind === 'cta' ? 3.4 : 2.6, speech + 0.8);
      s.start = t;
      t += s.dur;
    });
    job.total = t;
    const track = Music.byId(state.music);
    job.musicBuf = track ? await Music.render(track, t).catch(() => null) : null;
    const draw = makeRenderer(cv, job);

    let blob = offline ? await exportOffline(job, cv, draw, voices) : null;
    if (job.cancelled) return;
    if (!blob) {
      const vids = await Promise.all(blobs.map((b) => (b ? loadVideoEl(b) : null)));
      scenes.forEach((s, i) => { s.frame = null; s.video = s.kind === 'cta' ? vids[0] : vids[i]; });
      blob = await exportRealtime(job, cv, draw, voices);
    }
    if (job.cancelled) return;
    if (!blob) return status('Ce navigateur ne permet pas de créer la vidéo. Essayez avec Chrome ou Safari à jour.', 100);

    const silent = voices.every((v) => !v);
    const name = `${plan.brand}-${ad.angle}`.normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (blob.type.includes('mp4') ? '.mp4' : '.webm');
    job.url = URL.createObjectURL(blob);
    result.src = job.url; result.hidden = false; cv.hidden = true;
    $('#b-dl').href = job.url; $('#b-dl').download = name;
    const file = new File([blob], name, { type: blob.type });
    $('#b-share').hidden = !navigator.canShare?.({ files: [file] });
    $('#b-share').onclick = () => navigator.share({ files: [file], title: plan.brand }).catch(() => {});
    $('#st-actions').hidden = false;
    status(`Vidéo prête · ${Math.round(job.total)} s · ${(blob.size / 1e6).toFixed(1)} Mo` + (silent ? ' · sans voix off' : '') + (track && job.musicBuf ? ` · ♪ ${track.name}` : ''), 100);
  } catch (err) {
    console.error(err);
    if (!job.cancelled) status('Le montage a échoué. Réessayez.', 100);
  } finally {
    if (actx.state !== 'closed') actx.close().catch(() => {});
    scenes.forEach((s) => { s.clip?.iter?.return?.(); s.clip?.input.dispose(); if (s.video) { s.video.pause(); URL.revokeObjectURL(s.video.src); } });
  }
}

$('#b-close').addEventListener('click', () => {
  const job = state.job;
  if (job) {
    job.cancelled = true;
    if (job.url) URL.revokeObjectURL(job.url);
  }
  $('#result').pause();
  $('#studio').hidden = true;
  document.body.style.overflow = '';
});
