/*
 * bandMusic.js
 * The songs Miis learn (progress.js SONGS), played live with Web Audio: no sound
 * files, every note is made on the spot. Each song has its own tempo, key, chords
 * and a melody (made from the song's name, so it's always the same tune), and
 * lasts 30 seconds to a minute. A band plays all the parts; a Mii on its own
 * plays just its instrument.
 *
 * Use: MiiBand.play("moon", { parts: ["vocals", "drums", "keys", "guitar", "bass"], bars, onEnd })
 *        -> { stop(), duration }      (or null when sound can't play)
 *      MiiBand.duration("moon")       seconds (also works without sound, e.g. in tests)
 */
(function (root) {
  "use strict";

  // degrees of the scale (0 = the key's root); minor songs use the minor scale
  const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
  const SONGS = {
    sunny: { bpm: 124, key: 60, scale: MAJOR, prog: [0, 5, 3, 4], bars: 20, swing: 0.12 },
    pizza: { bpm: 132, key: 62, scale: MAJOR, prog: [0, 3, 4, 0], bars: 24, swing: 0 },
    moon: { bpm: 100, key: 57, scale: MINOR, prog: [0, 5, 2, 6], bars: 16, swing: 0 },
    friends: { bpm: 96, key: 65, scale: MAJOR, prog: [0, 4, 5, 3], bars: 16, swing: 0.08 },
    rain: { bpm: 84, key: 55, scale: MINOR, prog: [0, 3, 0, 4], bars: 14, swing: 0.2 },
    office: { bpm: 140, key: 64, scale: MAJOR, prog: [0, 4, 3, 4], bars: 28, swing: 0 },
    lullaby: { bpm: 72, key: 60, scale: MAJOR, prog: [0, 3, 0, 4], bars: 12, swing: 0, soft: true },
    rock: { bpm: 150, key: 52, scale: MINOR, prog: [0, 5, 6, 0], bars: 32, swing: 0, rock: true },
  };
  const spec = (id) => SONGS[id] || SONGS.sunny;
  // how long the whole song (or the first `bars` bars) lasts, in seconds
  const duration = (id, bars) => ((bars || spec(id).bars) * 4 * 60) / spec(id).bpm;

  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), (s >>> 0) / 4294967296);
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // The tune: two 4-bar phrases (a verse "A" and a chorus "B"), 8 eighth notes a bar.
  // Each note: a scale step (null = rest). Played A A B A, A A B B...
  function melody(id) {
    const r = seeded(hash(id + "|tune"));
    const S = spec(id);
    const phrase = (lift) => {
      const out = [];
      let step = 2 + lift;
      for (let bar = 0; bar < 4; bar++) {
        const chord = S.prog[bar % S.prog.length];
        for (let e = 0; e < 8; e++) {
          if (r() < (e % 2 ? 0.38 : 0.12)) { out.push(null); continue; }
          // mostly chord notes on the beat, little steps in between
          if (e % 2 === 0 && r() < 0.6) step = chord + [0, 2, 4][Math.floor(r() * 3)] + lift;
          else step += r() < 0.5 ? 1 : -1;
          step = Math.max(-2, Math.min(9, step));
          out.push(step);
        }
      }
      out[out.length - 1] = null;
      out[out.length - 2] = S.prog[0] + lift; // land on the root
      return out;
    };
    return { A: phrase(0), B: phrase(2) };
  }
  const tuneBar = (tune, bar) => { const p = [0, 0, 1, 0][Math.floor(bar / 4) % 4] ? tune.B : tune.A; return p.slice((bar % 4) * 8, (bar % 4) * 8 + 8); };
  const note = (S, step, octave) => S.key + 12 * (octave || 0) + S.scale[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7);

  // ---------- sound ----------
  let ctx = null, noise = null;
  function audio() {
    if (ctx) return ctx;
    try { ctx = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { return null; }
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // one note: an oscillator with a quick attack and a decay
  function tone(out, type, f, t, len, vol, o) {
    o = o || {};
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(f * o.slide, t + len);
    if (o.vibrato) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = f * 0.012;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t); lfo.stop(t + len + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * (o.sustain || 0.3)), t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    let node = osc;
    if (o.filter) { const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = o.filter; f2.Q.value = o.q || 1; osc.connect(f2); node = f2; }
    if (o.drive) { const ws = ctx.createWaveShaper(); ws.curve = driveCurve(); node.connect(ws); node = ws; }
    node.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + len + 0.05);
  }
  let curve = null;
  function driveCurve() {
    if (curve) return curve;
    curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    return curve;
  }
  function hit(out, t, kind, vol) {
    if (kind === "kick") { tone(out, "sine", 120, t, 0.25, vol, { slide: 0.35, sustain: 0.2 }); return; }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === "hat" ? "highpass" : "bandpass";
    f.frequency.value = kind === "hat" ? 7000 : 1800;
    const g = ctx.createGain();
    const len = kind === "hat" ? 0.05 : 0.18;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + len + 0.02);
    if (kind === "snare") tone(out, "triangle", 190, t, 0.1, vol * 0.5, { slide: 0.6 });
  }

  // Schedules one bar of every part that's playing.
  function playBar(S, tune, bar, t0, parts, out) {
    const beat = 60 / S.bpm, eighth = beat / 2;
    const chord = S.prog[bar % S.prog.length];
    const at = (e) => t0 + e * eighth + (e % 2 ? S.swing * eighth : 0);
    const soft = S.soft ? 0.5 : 1;
    if (parts.drums) {
      for (let e = 0; e < 8; e++) {
        if (e % 4 === 0 || (S.rock && e === 6)) hit(out, at(e), "kick", 0.55 * soft);
        if (e % 4 === 2) hit(out, at(e), "snare", 0.32 * soft);
        hit(out, at(e), "hat", (e % 2 ? 0.06 : 0.1) * soft);
      }
      if (bar % 4 === 3) for (let e = 6; e < 8; e++) hit(out, at(e) + eighth / 2, "snare", 0.2 * soft); // a little fill
    }
    if (parts.bass) {
      const root = note(S, chord, -2);
      for (let e = 0; e < 8; e += S.rock ? 1 : 2) tone(out, "sawtooth", freq(e === 6 && !S.rock ? root + 7 : root), at(e), eighth * (S.rock ? 0.9 : 1.8), 0.16 * soft, { filter: 500, sustain: 0.5 });
    }
    if (parts.keys) {
      const notes = [0, 2, 4].map((k) => note(S, chord + k, 0));
      if (S.soft) notes.forEach((n, i) => tone(out, "sine", freq(n), at(i * 2), beat * 3, 0.07, { attack: 0.05, sustain: 0.6 }));
      else for (const e of [0, 3, 4, 6]) notes.forEach((n) => tone(out, "triangle", freq(n), at(e), eighth * 1.4, 0.06, { sustain: 0.4 }));
    }
    if (parts.guitar) {
      const r = note(S, chord, -1);
      const shape = S.rock ? [r, r + 7, r + 12] : [0, 2, 4].map((k) => note(S, chord + k, -1));
      for (const e of S.rock ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 3, 5, 6]) shape.forEach((n, i) => tone(out, "sawtooth", freq(n), at(e) + i * 0.008, eighth * (S.rock ? 0.9 : 1.2), S.rock ? 0.045 : 0.035, { filter: S.rock ? 2600 : 1800, drive: S.rock, sustain: 0.5 }));
    }
    if (parts.vocals) {
      const line = tuneBar(tune, bar);
      for (let e = 0; e < 8; e++) {
        if (line[e] === null || line[e] === undefined) continue;
        let len = 1;
        while (e + len < 8 && line[e + len] === null && len < 3) len++;
        tone(out, "square", freq(note(S, line[e], 1)), at(e), eighth * len * 0.95, 0.05 * soft, { filter: 1500, q: 4, vibrato: true, attack: 0.03, sustain: 0.7 });
      }
    }
  }

  // Plays a song. opts.parts: which instruments (array of "vocals", "drums", "keys",
  // "guitar", "bass"); opts.bars: play only the first few bars; opts.onBar(bar).
  function play(id, opts) {
    opts = opts || {};
    if (!audio()) return null;
    if (ctx.state === "suspended") ctx.resume();
    const S = spec(id);
    const tune = melody(id);
    const parts = {};
    (opts.parts || ["vocals", "drums", "keys", "guitar", "bass"]).forEach((p) => { parts[p] = true; });
    const bars = Math.min(S.bars, opts.bars || S.bars);
    const out = ctx.createGain();
    out.gain.value = opts.volume === undefined ? 0.8 : opts.volume;
    out.connect(ctx.destination);
    const barLen = (4 * 60) / S.bpm;
    const start = ctx.currentTime + 0.15;
    let next = 0, stopped = false;
    // schedule a little ahead, bar by bar (so a stop() is quick)
    const timer = setInterval(() => {
      if (stopped) return;
      while (next < bars && start + next * barLen < ctx.currentTime + 0.6) {
        playBar(S, tune, next, start + next * barLen, parts, out);
        if (opts.onBar) opts.onBar(next);
        next++;
      }
      if (next >= bars && ctx.currentTime > start + bars * barLen + 0.3) finish();
    }, 50);
    function finish() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      setTimeout(() => out.disconnect(), 400);
      if (opts.onEnd) opts.onEnd();
    }
    return {
      duration: bars * barLen,
      stop() {
        if (stopped) return;
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        stopped = true;
        clearInterval(timer);
        setTimeout(() => out.disconnect(), 500);
      },
    };
  }

  // A crowd clapping (lots of short noise bursts) for `secs` seconds.
  function applause(secs, volume) {
    if (!audio()) return;
    if (ctx.state === "suspended") ctx.resume();
    const out = ctx.createGain();
    out.gain.value = volume === undefined ? 0.6 : volume;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    const n = Math.round(secs * 28);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.random() * secs;
      const fade = 1 - Math.max(0, (t - t0) / secs - 0.6) / 0.4; // dies down at the end
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 1200 + Math.random() * 1800; f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25 * fade, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t, Math.random() * 0.8); src.stop(t + 0.08);
    }
    setTimeout(() => out.disconnect(), (secs + 1) * 1000);
  }

  root.MiiBand = { SONGS, duration, melody, play, spec, applause };
})(typeof self !== "undefined" ? self : this);
