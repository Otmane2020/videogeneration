'use strict';
// Bibliothèque de 30 mélodies, synthétisées dans le navigateur (Web Audio) : aucun fichier audio,
// aucune licence à gérer, et chaque morceau est généré exactement à la durée de la vidéo.
(() => {
  const SCALES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
  const STYLES = {
    corporate: { label: 'Entreprise', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'x.......x.....x.', arp: 8, pad: 1, lead: 0.5, stab: '', swing: 0, cut: 6000, wave: 'triangle' },
    pop: { label: 'Pop', kick: 'x.....x.x.....x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x.x.x.x.x.x.x.x.', arp: 0, pad: 0.6, lead: 1, stab: 'x..x..x...x..x..', swing: 0, cut: 9000, wave: 'triangle' },
    lofi: { label: 'Lo-fi', kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x.......x..x....', arp: 0, pad: 0.8, lead: 0.7, stab: 'x.....x.....x...', swing: 0.28, cut: 2600, wave: 'sine', seventh: true },
    house: { label: 'House', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: '..x...x...x...x.', arp: 16, pad: 0.5, lead: 0, stab: 'x..x....x..x....', swing: 0, cut: 8000, wave: 'sawtooth' },
    ambient: { label: 'Ambiance', kick: '', snare: '', hat: '', bass: 'x...............', arp: 4, pad: 1.4, lead: 0.4, stab: '', swing: 0, cut: 3200, wave: 'sine', seventh: true },
    trap: { label: 'Urbain', kick: 'x......x..x.....', snare: '........x.......', hat: 'x.x.x.xxx.x.x.xx', bass: 'x......x..x.....', arp: 0, pad: 0.7, lead: 0.8, stab: '', swing: 0, cut: 7000, wave: 'square', sub: true },
  };
  // [nom, style, tempo, tonique (MIDI), gamme, progression (degrés), graine]
  const P = (name, style, bpm, root, scale, prog, seed) => ({ name, style, bpm, root, scale, prog, seed });
  const PRESETS = [
    P('Lancement', 'corporate', 112, 60, 'maj', [0, 4, 5, 3], 1), P('Confiance', 'corporate', 104, 62, 'maj', [0, 3, 5, 4], 2),
    P('Vision claire', 'corporate', 118, 65, 'maj', [0, 5, 3, 4], 3), P('Horizon', 'corporate', 100, 57, 'min', [0, 5, 2, 6], 4),
    P('Start-up', 'corporate', 122, 64, 'maj', [3, 0, 4, 5], 5),
    P('Plein soleil', 'pop', 120, 60, 'maj', [0, 4, 5, 3], 6), P('Bonne humeur', 'pop', 126, 67, 'maj', [0, 3, 4, 3], 7),
    P('Coup de cœur', 'pop', 116, 62, 'maj', [5, 3, 0, 4], 8), P('Week-end', 'pop', 110, 65, 'maj', [0, 5, 3, 4], 9),
    P('Nouveauté', 'pop', 128, 57, 'min', [0, 5, 2, 6], 10),
    P('Café du matin', 'lofi', 78, 60, 'maj', [0, 5, 1, 4], 11), P('Pluie douce', 'lofi', 72, 57, 'min', [0, 3, 5, 4], 12),
    P('Dimanche', 'lofi', 84, 65, 'maj', [1, 4, 0, 5], 13), P('Carnet de notes', 'lofi', 80, 62, 'min', [0, 5, 3, 6], 14),
    P('Fin de journée', 'lofi', 88, 58, 'maj', [3, 4, 2, 5], 15),
    P('Nuit blanche', 'house', 124, 57, 'min', [0, 5, 2, 6], 16), P('Rooftop', 'house', 122, 60, 'min', [0, 3, 6, 5], 17),
    P('Défilé', 'house', 126, 62, 'min', [0, 6, 5, 3], 18), P('Plage', 'house', 120, 65, 'maj', [0, 4, 5, 3], 19),
    P('Vitrine', 'house', 125, 59, 'min', [5, 6, 0, 0], 20),
    P('Aurore', 'ambient', 70, 60, 'maj', [0, 3, 5, 4], 21), P('Grand large', 'ambient', 64, 57, 'min', [0, 5, 2, 6], 22),
    P('Sérénité', 'ambient', 76, 65, 'maj', [0, 5, 3, 0], 23), P('Premium', 'ambient', 68, 62, 'min', [0, 3, 6, 5], 24),
    P('Histoire', 'ambient', 80, 55, 'maj', [5, 3, 0, 4], 25),
    P('Asphalte', 'trap', 140, 57, 'min', [0, 5, 3, 4], 26), P('Néons', 'trap', 134, 60, 'min', [0, 6, 5, 3], 27),
    P('Streetwear', 'trap', 146, 55, 'min', [0, 0, 5, 6], 28), P('Minuit', 'trap', 130, 62, 'min', [0, 3, 5, 6], 29),
    P('Édition limitée', 'trap', 150, 58, 'min', [5, 6, 0, 4], 30),
  ].map((p, i) => ({ ...p, id: 'm' + (i + 1), mood: STYLES[p.style].label }));

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // Programme tout le morceau dans `ctx`, branché sur `out`.
  function build(ctx, out, p, dur) {
    const st = STYLES[p.style], sc = SCALES[p.scale], rand = rng(p.seed * 7919);
    const beat = 60 / p.bpm, step = beat / 4, bar = beat * 4;
    const note = (deg, oct = 0) => p.root + 12 * (Math.floor(deg / 7) + oct) + sc[((deg % 7) + 7) % 7];
    const level = { ambient: 1.5, lofi: 0.8, trap: 0.58 }[p.style] || 0.68;
    const master = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = st.cut;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.002;
    master.connect(tone); tone.connect(comp); comp.connect(out);
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(level, 0.4);
    master.gain.setValueAtTime(level, Math.max(0.5, dur - 1.4));
    master.gain.linearRampToValueAtTime(0, dur);
    // écho léger pour les mélodies
    const echo = ctx.createDelay(1); echo.delayTime.value = beat * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    echo.connect(fb); fb.connect(echo); echo.connect(master);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    function voice(t, freq, len, type, level, opts = {}) {
      if (t >= dur) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (opts.detune) o.detune.value = opts.detune;
      if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + len);
      const a = opts.attack || 0.006;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + a);
      if (opts.sustain) { g.gain.setValueAtTime(level, t + len - Math.min(0.3, len / 3)); g.gain.linearRampToValueAtTime(0, t + len); }
      else g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      let node = o;
      if (opts.cut) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.cut; o.connect(f); node = f; }
      node.connect(g); g.connect(master);
      if (opts.echo) { const s = ctx.createGain(); s.gain.value = opts.echo; g.connect(s); s.connect(echo); }
      o.start(t); o.stop(t + len + 0.05);
    }
    function hit(t, len, level, type, freq) {
      if (t >= dur) return;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, rand() * 0.5, len + 0.02);
    }
    const kick = (t) => { voice(t, 150, 0.32, 'sine', 0.85, { slideTo: 42 }); };
    const on = (pat, i) => pat && pat[i % pat.length] === 'x';

    const bars = Math.ceil(dur / bar);
    const penta = p.scale === 'maj' ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
    // motif mélodique de 2 mesures, répété avec variation
    const motif = [];
    let pos = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < 16; i++) {
      const play = i % 8 === 0 || rand() < (i % 2 === 0 ? 0.62 : 0.22);
      pos = Math.max(0, Math.min(8, pos + Math.round((rand() - 0.5) * 3.2)));
      motif.push(play ? { deg: penta[pos % 5] + 7 * Math.floor(pos / 5), len: rand() < 0.3 ? 2 : 1 } : null);
    }

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar, deg = p.prog[b % p.prog.length];
      const chord = [deg, deg + 2, deg + 4].concat(st.seventh ? [deg + 6] : []);
      const full = b >= 1, drop = b >= 2; // entrée progressive : nappes, puis rythme, puis mélodie
      // nappe
      if (st.pad) chord.forEach((d) => [-7, 7].forEach((det) => voice(t0, hz(note(d)), bar * 1.02, 'sawtooth', 0.028 * st.pad, { attack: 0.35, sustain: true, cut: 1100, detune: det })));
      for (let i = 0; i < 16; i++) {
        const sw = i % 2 ? st.swing * step : 0, t = t0 + i * step + sw;
        if (full) {
          if (on(st.kick, i)) kick(t);
          if (on(st.snare, i)) { hit(t, 0.16, 0.34, 'bandpass', 1900); if (p.style !== 'lofi') voice(t, 190, 0.09, 'triangle', 0.18); }
          if (on(st.hat, i)) hit(t, i % 4 === 2 ? 0.07 : 0.035, p.style === 'lofi' ? 0.07 : 0.11, 'highpass', 7500);
        }
        if (on(st.bass, i)) {
          const f = hz(note(deg, -2));
          if (st.sub) voice(t, f, beat * 1.6, 'sine', 0.5, { slideTo: f * 0.97 });
          else voice(t, f, p.style === 'pop' || p.style === 'house' ? step * 1.7 : beat * 1.8, p.style === 'house' ? 'sawtooth' : 'triangle', 0.3, { cut: 500 });
        }
        if (full && on(st.stab, i)) chord.forEach((d) => voice(t, hz(note(d)), 0.26, st.wave, 0.06, { cut: 2400 }));
        if (st.arp && i % (16 / st.arp) === 0) {
          const k = (i / (16 / st.arp)) | 0, seq = [0, 1, 2, 1, 0, 2, 1, 2];
          voice(t, hz(note(chord[seq[(k + b) % 8] % chord.length], 1)), st.arp <= 4 ? beat * 1.6 : 0.28, st.arp === 16 ? 'square' : 'triangle', st.arp === 16 ? 0.035 : 0.075, { cut: 3000, echo: 0.35 });
        }
        if (drop && st.lead && i % 2 === 0) {
          const m = motif[((b % 2) * 8 + i / 2) % 16];
          if (m && !(b % 4 === 3 && i > 10)) voice(t, hz(note(m.deg + (b % 4 === 2 ? 1 : 0), 1)), step * 2 * m.len * 1.1, p.style === 'trap' ? 'square' : 'triangle', 0.085 * st.lead, { attack: 0.012, cut: 3600, echo: 0.4 });
        }
      }
    }
  }

  async function render(preset, seconds, rate = 48000) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    build(ctx, ctx.destination, preset, seconds);
    return ctx.startRendering();
  }

  window.Music = { PRESETS, render, byId: (id) => PRESETS.find((p) => p.id === id) || null };
})();
