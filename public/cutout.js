'use strict';
// Détourage du produit dans le navigateur, gratuit et sans envoi de la photo à un service tiers.
// Modèle de segmentation ormbg (licence Apache-2.0) exécuté par onnxruntime-web (licence MIT).
// Astuce pour les produits clairs sur fond clair : on repeint d'abord le fond exact en gris,
// le modèle distingue alors nettement le produit, parties blanches comprises.
(() => {
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
  const MODEL = 'https://huggingface.co/onnx-community/ormbg-ONNX/resolve/main/onnx/model_quantized.onnx';
  const SIZE = 1024;
  let session = null;

  async function load(onProgress) {
    return (session ||= (async () => {
      const ort = await import(ORT + 'ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      // le modèle (44 Mo) est gardé en cache par le navigateur après le premier téléchargement
      let bytes;
      const cache = await caches.open('clipmotion-models').catch(() => null);
      let resp = cache && (await cache.match(MODEL));
      if (!resp) {
        resp = await fetch(MODEL);
        if (!resp.ok) throw new Error('model ' + resp.status);
        const total = +resp.headers.get('content-length') || 44e6, reader = resp.body.getReader(), chunks = [];
        let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(Math.min(1, got / total)); }
        bytes = new Uint8Array(got);
        let o = 0;
        for (const c of chunks) { bytes.set(c, o); o += c.length; }
        cache?.put(MODEL, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
      } else bytes = new Uint8Array(await resp.arrayBuffer());
      const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, s };
    })().catch((e) => { session = null; throw e; }));
  }

  // Fond uni relié aux bords, avec une tolérance serrée : seul le fond « exact » est marqué.
  function exactBackground(d, w, h, tol) {
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    const med = (ch) => { const v = border.map((i) => d[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const bg = [med(0), med(1), med(2)];
    const dist = (i) => Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]);
    if (border.filter((i) => dist(i) < 40).length < border.length * 0.85) return null; // fond non uni
    const seen = new Uint8Array(w * h), stack = [];
    for (const i of border) if (!seen[i] && dist(i) < tol) { seen[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) if (j >= 0 && j < w * h && !seen[j] && dist(j) < tol) { seen[j] = 1; stack.push(j); }
    }
    return { seen, light: (bg[0] + bg[1] + bg[2]) / 3 > 128 };
  }

  // Renvoie un canvas détouré (rogné au produit), ou null si rien d'exploitable.
  // `force` : détourer même si le fond n'est pas uni (photo jugée « packshot » par l'analyse).
  async function run(img, { force = false, onProgress } = {}) {
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const full = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const fg = full.getContext('2d', { willReadFrequently: true });
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(img, 0, 0, w, h);
    const px = fg.getImageData(0, 0, w, h), d = px.data;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 40) transparent++;
    if (transparent > d.length / (4 * 97) * 0.2) return trim(full, d, w, h); // PNG déjà détouré

    const exact = exactBackground(d, w, h, 14);
    if (!exact && !force) return null; // photo d'ambiance : utilisée telle quelle
    const { ort, s } = await load(onProgress);

    // entrée du modèle : image 1024×1024, fond exact repeint en gris
    const small = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const sg = small.getContext('2d', { willReadFrequently: true });
    if (exact) {
      const tmp = new ImageData(new Uint8ClampedArray(d), w, h), t = tmp.data, c = exact.light ? [70, 70, 78] : [200, 200, 205];
      for (let i = 0; i < w * h; i++) if (exact.seen[i]) { t[i * 4] = c[0]; t[i * 4 + 1] = c[1]; t[i * 4 + 2] = c[2]; }
      const grey = Object.assign(document.createElement('canvas'), { width: w, height: h });
      grey.getContext('2d').putImageData(tmp, 0, 0);
      sg.drawImage(grey, 0, 0, SIZE, SIZE);
    } else sg.drawImage(full, 0, 0, SIZE, SIZE);
    const sd = sg.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { input[i] = sd[i * 4] / 255; input[n + i] = sd[i * 4 + 1] / 255; input[2 * n + i] = sd[i * 4 + 2] / 255; }
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    const alpha = out[s.outputNames[0]].data;

    // masque remis à la taille de la photo (lissé par le redimensionnement), bords resserrés
    const mc = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const mi = new ImageData(SIZE, SIZE);
    for (let i = 0; i < n; i++) { const a = Math.max(0, Math.min(1, (alpha[i] - 0.12) / 0.76)); mi.data[i * 4 + 3] = Math.round(a * a * (3 - 2 * a) * 255); }
    mc.getContext('2d').putImageData(mi, 0, 0);
    const up = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ug = up.getContext('2d', { willReadFrequently: true });
    ug.imageSmoothingQuality = 'high';
    ug.drawImage(mc, 0, 0, w, h);
    const m = ug.getImageData(0, 0, w, h).data;
    let kept = 0;
    for (let i = 0; i < w * h; i++) {
      const a = exact && exact.seen[i] ? 0 : m[i * 4 + 3]; // le fond exact reste retiré quoi qu'il arrive
      d[i * 4 + 3] = a;
      if (a > 128) kept++;
    }
    if (kept < w * h * 0.03 || kept > w * h * 0.95) return null;
    fg.putImageData(px, 0, 0);
    return trim(full, d, w, h);
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

  window.Cutout = { run };
})();
