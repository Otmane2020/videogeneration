'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FORMATS = { '9:16': [720, 1280], '1:1': [720, 720], '16:9': [1280, 720] };
const state = { page: null, type: null, plan: null, fmt: '9:16', job: null };
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
  const box = $('#ads');
  box.textContent = '';
  plan.ads.forEach((ad) => {
    const n = $('#t-ad').content.cloneNode(true);
    $('.angle', n).textContent = ad.angle;
    ad.scenes.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s.headline;
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
      .then(({ results }) => {
        const used = new Set();
        return results.map((list) => {
          const c = list.find((x) => !used.has(x.id)) || list[0] || null;
          if (c) used.add(c.id);
          return c;
        });
      })
      .catch(() => ad.scenes.map(() => null));
    ad.clips.then((clips) => clips.slice(0, 4).forEach((c, i) => {
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

/* ---------- chargement des médias ---------- */
function loadVideo(src) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
    const done = (ok) => { clearTimeout(to); v.oncanplay = v.onerror = null; res(ok ? v : null); };
    const to = setTimeout(() => done(false), 25000);
    v.oncanplay = () => done(true);
    v.onerror = () => done(false);
    v.src = src;
    v.load();
  });
}
// Direct d'abord (CDN Pixabay), sinon via notre proxy si le CORS bloque le canvas.
const loadClip = async (c) => (c ? (await loadVideo(c.url)) || loadVideo(media(c.url)) : null);
const loadImage = (src) => new Promise((res) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => res(im.naturalWidth > 80 ? im : null);
  im.onerror = () => res(null);
  im.src = src;
});
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
const backOut = (x) => { x = clamp(x); return 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2); };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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
function cover(ctx, src, sw, sh, W, H, zoom) {
  const s = Math.max(W / sw, H / sh) * zoom;
  ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
}

function makeRenderer(cv, job) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const { scenes, plan, product, total } = job;
  const P = plan.palette.primary, A = plan.palette.accent;
  const pad = W > H ? 64 : 44;
  const textW = Math.min(W - pad * 2, 860);
  const headSize = W > H ? 58 : W === H ? 54 : 62;

  function background(sc, k, alpha) {
    ctx.globalAlpha = alpha;
    const v = sc.video;
    if (v && v.readyState >= 2 && v.videoWidth) cover(ctx, v, v.videoWidth, v.videoHeight, W, H, 1.04 + 0.08 * k);
    else {
      const g = ctx.createLinearGradient(0, 0, W * (0.4 + 0.6 * k), H);
      g.addColorStop(0, P); g.addColorStop(1, '#07140f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  function productCard(cx, cy, size, k) {
    if (!product) return;
    const s = size * backOut(k / 0.5);
    if (s <= 0) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#fff';
    rr(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.08); ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.08); ctx.clip();
    const iw = product.naturalWidth, ih = product.naturalHeight, f = Math.min(s / iw, s / ih) * (iw / ih > 1.3 || ih / iw > 1.3 ? 0.92 : 1);
    ctx.drawImage(product, cx - iw * f / 2, cy - ih * f / 2, iw * f, ih * f);
    ctx.restore();
  }

  function scene(sc, local) {
    // voile pour la lisibilité
    let g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(0.28, 'rgba(0,0,0,.05)'); g.addColorStop(0.55, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,.86)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    // sous-titre (voix off)
    ctx.font = `500 30px ${FONT}`;
    const cap = sc.voiceover && sc.voiceover !== sc.headline ? wrap(ctx, sc.voiceover, textW, 3) : [];
    const capH = cap.length * 40;
    const bottom = H - (W > H ? 56 : H * 0.11);
    const ca = easeOut((local - 0.45) / 0.4);
    ctx.fillStyle = `rgba(255,255,255,${0.92 * ca})`;
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8;
    cap.forEach((l, i) => ctx.fillText(l, pad, bottom - capH + 30 + i * 40));
    ctx.shadowBlur = 0;

    // titre en bandeaux de couleur
    ctx.font = `800 ${headSize}px ${FONT}`;
    const lines = wrap(ctx, sc.headline, textW - 36, 3);
    const lh = headSize * 1.32;
    const top = bottom - capH - 26 - lines.length * lh;
    lines.forEach((l, i) => {
      const k = easeOut((local - 0.12 - i * 0.13) / 0.4);
      if (k <= 0) return;
      const y = top + i * lh + (1 - k) * 34;
      ctx.globalAlpha = k;
      ctx.fillStyle = i === lines.length - 1 ? A : P;
      rr(ctx, pad - 6, y, ctx.measureText(l).width + 36, lh - 8, 12); ctx.fill();
      ctx.fillStyle = onColor(i === lines.length - 1 ? A : P);
      ctx.fillText(l, pad + 12, y + headSize * 0.98);
      ctx.globalAlpha = 1;
    });

    if (sc.showProduct && product) {
      const room = top - 120;
      const size = Math.min(W * 0.6, room * 0.86);
      if (size > 140) productCard(W > H ? W * 0.72 : W / 2, W > H ? H * 0.42 : 120 + room / 2 + Math.sin(local * 1.6) * 6, W > H ? Math.min(H * 0.6, 420) : size, local - 0.2);
    }
  }

  function cta(sc, local) {
    ctx.fillStyle = 'rgba(4,12,10,.62)'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, P + 'cc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let y = H * (product && plan.type === 'ecom' ? 0.56 : 0.44);
    if (product && plan.type === 'ecom') productCard(W / 2, y - Math.min(W, H) * 0.3, Math.min(W, H) * 0.36, local);

    const k1 = easeOut(local / 0.45);
    let size = W > H ? 92 : 84;
    ctx.font = `800 ${size}px ${FONT}`;
    const bw = ctx.measureText(plan.brand).width;
    if (bw > W - pad * 2) { size *= (W - pad * 2) / bw; ctx.font = `800 ${size}px ${FONT}`; }
    ctx.globalAlpha = k1; ctx.fillStyle = '#fff';
    ctx.fillText(plan.brand, W / 2, y + (1 - k1) * 30);
    ctx.font = `500 32px ${FONT}`;
    const k2 = easeOut((local - 0.2) / 0.45);
    ctx.globalAlpha = k2 * 0.9;
    y += 14;
    wrap(ctx, plan.tagline, W - pad * 2, 2).forEach((l) => { y += 46; ctx.fillText(l, W / 2, y); });

    const k3 = backOut((local - 0.45) / 0.45);
    if (k3 > 0) {
      ctx.font = `800 38px ${FONT}`;
      const bwid = Math.min(W - pad * 2, ctx.measureText(sc.headline).width + 96), bh = 88;
      const s = k3 * (1 + 0.035 * Math.sin(local * 5));
      ctx.save();
      ctx.translate(W / 2, y + 100); ctx.scale(s, s);
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
    // barres de progression façon stories + marque
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
    ctx.font = `700 28px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
    ctx.fillText(plan.brand, pad + 40, 78);
    ctx.shadowBlur = 0;
  }

  return function draw(t) {
    let idx = scenes.findIndex((s) => t < s.start + s.dur);
    if (idx < 0) idx = scenes.length - 1;
    const sc = scenes[idx], local = t - sc.start, FADE = 0.4;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (idx > 0 && local < FADE) background(scenes[idx - 1], 1, 1);
    background(sc, clamp(local / sc.dur), idx > 0 ? clamp(local / FADE) : 1);
    (sc.kind === 'cta' ? cta : scene)(sc, local);
    chrome(t, idx);
    return idx;
  };
}

/* ---------- montage + enregistrement ---------- */
const status = (msg, pct) => { $('#st-status').textContent = msg; if (pct != null) $('#st-bar').style.width = pct + '%'; };

async function produce(ad) {
  const plan = state.plan;
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC(); // créé dans le geste utilisateur (iOS)
  const job = (state.job = { cancelled: false, actx, plan, host: state.page.host, videos: [] });
  const cv = $('#cv'), result = $('#result');
  [cv.width, cv.height] = FORMATS[state.fmt];
  cv.hidden = false; result.hidden = true; result.removeAttribute('src');
  $('#st-actions').hidden = true;
  $('#studio').hidden = false;
  document.body.style.overflow = 'hidden';

  const scenes = [...ad.scenes.map((s) => ({ ...s })), { kind: 'cta', headline: ad.cta, voiceover: ad.ctaVoiceover }];
  job.scenes = scenes;
  let done = 0;
  const tasks = scenes.length * 2;
  const tick = (p) => p.then((v) => { status('Préparation des plans et de la voix off…', (++done / tasks) * 100); return v; });
  status('Préparation des plans et de la voix off…', 0);

  const clips = await ad.clips;
  const wantProduct = plan.type === 'ecom' && state.page.images[0];
  const [videos, voices, product] = await Promise.all([
    Promise.all(scenes.map((s, i) => tick(s.kind === 'cta' ? Promise.resolve(null) : loadClip(clips[i])))),
    Promise.all(scenes.map((s) => tick(loadVoice(actx, s.voiceover, plan.language)))),
    wantProduct ? loadImage(media(state.page.images[0])) : null,
  ]);
  if (job.cancelled) return;
  job.product = product;
  job.videos = videos.filter(Boolean);
  let t = 0;
  scenes.forEach((s, i) => {
    s.video = s.kind === 'cta' ? videos[0] : videos[i];
    s.voice = voices[i];
    const read = s.voiceover ? s.voiceover.split(/\s+/).length * 0.36 + 1 : 0;
    s.dur = Math.max(s.kind === 'cta' ? 3.4 : 2.6, s.voice ? s.voice.duration + 0.7 : read);
    s.start = t;
    t += s.dur;
  });
  job.total = t;
  const draw = makeRenderer(cv, job);

  // piste audio : voix off -> enregistrement + haut-parleur
  const dest = actx.createMediaStreamDestination();
  const bus = actx.createGain();
  bus.connect(dest); bus.connect(actx.destination);
  await actx.resume().catch(() => {});

  let rec = null;
  const chunks = [];
  if (window.MediaRecorder && cv.captureStream) {
    const stream = cv.captureStream(30);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6, audioBitsPerSecond: 128e3 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    } catch { rec = null; }
  }

  draw(0);
  if (scenes[0].video) await scenes[0].video.play().catch(() => {});
  if (job.cancelled) return;
  const a0 = actx.currentTime + 0.1;
  scenes.forEach((s) => {
    if (!s.voice) return;
    const src = actx.createBufferSource();
    src.buffer = s.voice; src.connect(bus); src.start(a0 + s.start + 0.3);
  });
  rec?.start(500);
  const t0 = performance.now() + 100;
  let cur = 0;
  const silent = voices.every((v) => !v);

  await new Promise((finish) => {
    (function frame() {
      if (job.cancelled) return finish();
      const now = Math.max(0, (performance.now() - t0) / 1000);
      if (now >= job.total) { draw(job.total - 0.001); return finish(); }
      const idx = draw(now);
      if (idx !== cur) {
        const prev = scenes[cur].video, next = scenes[idx].video;
        if (next && next !== prev) { try { next.currentTime = 0; } catch {} next.play().catch(() => {}); }
        if (prev && prev !== next) setTimeout(() => prev.pause(), 450);
        cur = idx;
      }
      status(`Enregistrement… ${Math.ceil(job.total - now)} s` + (silent ? ' (sans voix off)' : ''), (now / job.total) * 100);
      requestAnimationFrame(frame);
    })();
  });

  job.videos.forEach((v) => v.pause());
  if (job.cancelled) { if (rec && rec.state !== 'inactive') rec.stop(); return; }
  if (!rec) return status('Aperçu terminé. Ce navigateur ne permet pas d’enregistrer la vidéo.', 100);
  await new Promise((ok) => { rec.onstop = ok; setTimeout(() => rec.stop(), 250); });
  actx.close().catch(() => {});
  if (job.cancelled) return;

  const type = (rec.mimeType || 'video/webm').split(';')[0];
  const blob = new Blob(chunks, { type });
  const name = `${plan.brand}-${ad.angle}`.normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (type.includes('mp4') ? '.mp4' : '.webm');
  job.url = URL.createObjectURL(blob);
  result.src = job.url; result.hidden = false; cv.hidden = true;
  $('#b-dl').href = job.url; $('#b-dl').download = name;
  const file = new File([blob], name, { type });
  const canShare = !!navigator.canShare?.({ files: [file] });
  $('#b-share').hidden = !canShare;
  $('#b-share').onclick = () => navigator.share({ files: [file], title: plan.brand }).catch(() => {});
  $('#st-actions').hidden = false;
  status(`Vidéo prête · ${Math.round(job.total)} s · ${(blob.size / 1e6).toFixed(1)} Mo` + (silent ? ' · sans voix off' : ''), 100);
}

$('#b-close').addEventListener('click', () => {
  const job = state.job;
  if (job) {
    job.cancelled = true;
    job.videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
    if (job.actx.state !== 'closed') job.actx.close().catch(() => {});
    if (job.url) URL.revokeObjectURL(job.url);
  }
  $('#result').pause();
  $('#studio').hidden = true;
  document.body.style.overflow = '';
});
