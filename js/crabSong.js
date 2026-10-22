/*
 * crabSong.js
 * "Pinch Pinch Shuffle": the song the crabs dance to on the beach (a rare event, see
 * places-seaside.js). A sunny calypso tune, 30 bars at 120 beats a minute (60 seconds),
 * made right here from notes with Web Audio, so it needs no file at all.
 *
 * USING A REAL RECORDING INSTEAD: put the file next to index.html (for example in a
 * "music" folder) and set SONG_URL below to its path, like "music/crab-dance.ogg".
 * That's all: the crabs then dance for as long as the file plays. (If the file can't
 * be loaded, the made-up song plays instead.)
 *
 * Use: MiiCrabSong.prepare()   get it ready (a few seconds before it's needed)
 *      MiiCrabSong.play()      start from the beginning
 *      MiiCrabSong.stop()      fade out and stop
 *      MiiCrabSong.duration()  how long it is, in seconds
 * The hub music is faded out while it plays (see MiiMusic.duck in music.js).
 */
(function (root) {
  "use strict";

  // >>> Set this to a sound file (relative to index.html) to replace the made-up song. <<<
  const SONG_URL = "music/crab-dance.ogg"; // the real crab song (the made-up one plays if this can't load)
  const SONG_BPM = 125; // its tempo, so the crabs change moves on the beat (change it with the file)

  const VOLUME = 0.4;
  const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4, E = BEAT / 2; // E = one eighth note
  const SWING = 0.03; // the offbeats come a little late: a relaxed island groove
  const BARS = 30;
  const LENGTH = BARS * BAR; // 60 seconds
  const TAIL = 1.5;          // the last chord rings out

  // ---------- the song ----------
  // Chords, one per bar: [bass note, the steel drum chord]
  const CH = {
    C: [48, [60, 64, 67]], F: [41, [60, 65, 69]], G: [43, [59, 62, 67]],
    Am: [45, [60, 64, 69]], G7: [43, [59, 62, 65, 67]],
  };
  const A_CHORDS = ["C", "F", "G", "C", "C", "F", "G", "C"];
  const CHORDS = ["C", "C"]                                   // intro: castanets and bass
    .concat(A_CHORDS)                                         // the "pinch pinch" tune
    .concat(["Am", "F", "C", "G", "Am", "F", "G", "G7"])      // the middle bit
    .concat(A_CHORDS)                                         // the tune again, bigger
    .concat(["F", "G", "C", "C"]);                            // the big finish
  // Melodies: [note, length in eighths] per bar (null = a rest)
  const A_TUNE = [
    [[67, 1], [72, 1], [76, 1], [79, 2], [76, 1], [79, 2]],
    [[81, 2], [79, 1], [77, 1], [76, 2], [74, 2]],
    [[74, 1], [74, 1], [79, 1], [74, 1], [71, 2], [74, 2]],
    [[76, 3], [72, 1], [72, 4]],
    [[67, 1], [72, 1], [76, 1], [79, 2], [76, 1], [79, 2]],
    [[81, 1], [81, 1], [84, 2], [81, 1], [79, 1], [77, 2]],
    [[79, 2], [77, 1], [74, 1], [71, 1], [74, 1], [79, 2]],
    [[84, 2], [79, 1], [76, 1], [72, 4]],
  ];
  const B_TUNE = [
    [[76, 3], [72, 1], [69, 2], [72, 2]],
    [[77, 3], [76, 1], [74, 2], [72, 2]],
    [[76, 2], [79, 2], [84, 2], [79, 2]],
    [[79, 3], [77, 1], [74, 4]],
    [[81, 3], [79, 1], [76, 2], [72, 2]],
    [[77, 2], [81, 2], [84, 2], [81, 2]],
    [[79, 2], [83, 2], [86, 2], [83, 2]],
    [[86, 1], [null, 1], [86, 1], [null, 1], [84, 1], [83, 1], [79, 2]], // "pinch! pinch!"
  ];
  const END_TUNE = [
    [[77, 1], [81, 1], [84, 2], [81, 1], [77, 1], [81, 2]],
    [[79, 1], [83, 1], [86, 2], [83, 1], [79, 1], [74, 2]],
    [[84, 2], [79, 1], [76, 1], [72, 1], [76, 1], [79, 2]],
    [[84, 6], [null, 2]],
  ];
  const TUNE = [null, null].concat(A_TUNE, B_TUNE, A_TUNE, END_TUNE);

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // when eighth number e of bar b starts (offbeats swing a little)
  const at = (b, e) => b * BAR + e * E + (e % 2 ? SWING : 0);

  // Plays the whole song into an audio buffer (much faster than real time).
  function render() {
    const Off = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Off) return Promise.reject(new Error("no offline audio"));
    const rate = 44100;
    const ac = new Off(2, Math.ceil((LENGTH + TAIL) * rate), rate);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    const master = ac.createGain();
    master.gain.value = 0.62; // (headroom: no clipping)
    comp.connect(master).connect(ac.destination);
    const bus = (vol, pan) => {
      const g = ac.createGain(); g.gain.value = vol;
      if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan || 0; g.connect(p).connect(comp); }
      else g.connect(comp);
      return g;
    };
    const leadBus = bus(0.2, 0), bassBus = bus(0.42, 0), panBus = bus(0.16, -0.25);
    const drumBus = bus(0.5, 0), clickL = bus(0.22, -0.5), clickR = bus(0.22, 0.5), hatBus = bus(0.1, 0.3);

    // one second of noise, shared by all the drums
    const noise = ac.createBuffer(1, rate, rate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // a note: oscillators of the given types/pitches (mul = times the main pitch) with a quick envelope
    function note(out, t, freq, dur, parts, env) {
      const g = ac.createGain();
      const a = env.attack || 0.005, peak = env.peak || 1;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      if (env.sustain !== undefined) {
        g.gain.setTargetAtTime(peak * env.sustain, t + a, env.decay || 0.1);
        g.gain.setValueAtTime(peak * env.sustain, t + dur);
        g.gain.linearRampToValueAtTime(0, t + dur + (env.release || 0.06));
      } else {
        g.gain.setTargetAtTime(0, t + a, env.decay || 0.15); // plucked: just dies away
      }
      const end = t + dur + (env.release || 0.06) + (env.sustain === undefined ? (env.decay || 0.15) * 5 : 0);
      let target = g;
      if (env.lowpass) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = env.lowpass; g.connect(f); target = f; }
      target.connect(out);
      for (const [type, mul, vol] of parts) {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq * mul * (env.bend || 1), t);
        if (env.bend) o.frequency.exponentialRampToValueAtTime(freq * mul, t + 0.04);
        if (env.vibrato) { // a little wobble on long notes
          const l = ac.createOscillator(), lg = ac.createGain();
          l.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * mul * 0.012, t + Math.min(dur, 0.5));
          l.connect(lg).connect(o.frequency); l.start(t); l.stop(end);
        }
        const og = ac.createGain(); og.gain.value = vol;
        o.connect(og).connect(g);
        o.start(t); o.stop(end);
      }
    }
    const lead = (t, n, dur, vol) => note(leadBus, t, hz(n), dur, [["square", 1, 0.55], ["triangle", 2, 0.35]],
      { attack: 0.01, peak: vol || 1, sustain: 0.65, decay: 0.12, release: 0.07, lowpass: 3200, vibrato: dur > 0.4 });
    const bass = (t, n, dur) => note(bassBus, t, hz(n), dur, [["triangle", 1, 1], ["sine", 0.5, 0.6]], { attack: 0.004, decay: Math.max(0.08, dur * 0.45) });
    const steel = (t, n, vol) => note(panBus, t, hz(n), 0.05, [["sine", 1, 1], ["sine", 2, 0.45], ["sine", 3.01, 0.18]], { attack: 0.003, peak: vol || 1, decay: 0.16, bend: 1.02 });
    function hit(out, t, filter, freq, q, decay, vol) {
      const s = ac.createBufferSource(); s.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t + 0.002, decay);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.5, decay * 6 + 0.02);
    }
    function kick(t) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(1, t); g.gain.setTargetAtTime(0, t + 0.01, 0.07);
      o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.45);
    }
    const clap = (t) => { for (const d of [0, 0.011, 0.022]) hit(drumBus, t + d, "bandpass", 1400, 1.2, d === 0.022 ? 0.07 : 0.008, 0.6); };
    const hat = (t, open) => hit(hatBus, t, "highpass", 7500, 0.7, open ? 0.09 : 0.025, 0.8);
    // the crabs' claws: a dry castanet "click"
    const click = (t, right) => { hit(right ? clickR : clickL, t, "bandpass", 3200, 6, 0.018, 1.6); note(right ? clickR : clickL, t, 2400, 0.01, [["sine", 1, 0.5]], { attack: 0.001, decay: 0.01 }); };

    for (let b = 0; b < BARS; b++) {
      const name = CHORDS[b], [root_, chord] = CH[name];
      const last = b === BARS - 1;
      // ---- drums: a kick on every beat, claps on 2 and 4, shaky hats on the offbeats ----
      if (last) { kick(at(b, 0)); hit(drumBus, at(b, 0), "highpass", 4000, 0.5, 0.5, 0.45); } // the crash at the end
      else {
        for (let k = 0; k < 4; k++) kick(at(b, k * 2));
        if (b >= 2) { clap(at(b, 2)); clap(at(b, 6)); }
        for (let e = 0; e < 8; e++) hat(at(b, e), e % 2 === 1 && b >= 10);
      }
      // ---- castanet claws: "click-click... click" (busier in the middle bit) ----
      if (!last) {
        click(at(b, 1), false); click(at(b, 1) + E / 2, true); click(at(b, 3), false);
        if (b >= 10 && b < 18) { click(at(b, 5), true); click(at(b, 5) + E / 2, false); click(at(b, 7), true); }
        if (b % 4 === 3) for (let k = 0; k < 4; k++) click(at(b, 6) + k * E / 2, k % 2 === 1); // a little roll into the next phrase
      }
      // ---- bass: bouncy island bass (root, fifth, octave) ----
      if (last) bass(at(b, 0), root_, 1.2);
      else {
        bass(at(b, 0), root_, E * 1.4);
        bass(at(b, 3), root_ + 7, E * 0.9);
        bass(at(b, 4), root_, E * 1.4);
        bass(at(b, 6), root_ + 12, E * 0.8);
        bass(at(b, 7), root_ + 7, E * 0.8);
      }
      // ---- steel drums on the offbeats ----
      if (last) for (const n of chord.concat([72])) steel(at(b, 0), n, 1.1);
      else if (b >= 1) for (const e of [1, 3, 5, 7]) for (const n of chord) steel(at(b, e), n, e === 3 ? 1 : 0.75);
      // ---- the tune ----
      const bar = TUNE[b];
      if (!bar) continue;
      let e = 0;
      const big = b >= 18 && b < 26; // the tune again: with a quiet octave on top
      for (const [n, len] of bar) {
        if (n !== null) {
          const dur = len * E * (last ? 1.6 : 0.88);
          lead(at(b, e), n, dur, 1);
          if (big || last) lead(at(b, e), n + 12, dur, 0.35);
        }
        e += len;
      }
    }
    return ac.startRendering();
  }

  // ---------- playing it ----------
  let ctx = null, buffer = null, loading = null, src = null, gain = null;
  let el = null, fileFailed = false, wantPlay = false, fadeTimer = null;
  const useFile = () => !!SONG_URL && !fileFailed && typeof Audio !== "undefined";

  function prepare() {
    if (useFile()) {
      if (!el) {
        el = new Audio(SONG_URL);
        el.preload = "auto";
        el.addEventListener("error", () => { fileFailed = true; el = null; if (wantPlay) play(); });
      }
      return Promise.resolve();
    }
    if (!loading) loading = render().then((b) => { buffer = b; if (wantPlay) play(); return b; }).catch((e) => { loading = null; throw e; });
    return loading.catch(() => {});
  }

  function play() {
    stopNow();
    wantPlay = true;
    if (useFile()) {
      prepare();
      if (!el) return;
      el.currentTime = 0;
      el.volume = VOLUME;
      const p = el.play();
      if (p && p.catch) p.catch(() => {}); // (no sound until you've clicked somewhere)
      return;
    }
    if (!buffer) { prepare(); return; } // (starts as soon as it's ready)
    try {
      if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      gain = ctx.createGain();
      gain.gain.value = VOLUME;
      gain.connect(ctx.destination);
      const s = (src = ctx.createBufferSource());
      s.buffer = buffer;
      s.connect(gain);
      s.onended = () => { if (src === s) { src = null; wantPlay = false; } };
      s.start();
    } catch (e) { src = null; }
  }

  function stopNow() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (src) { try { src.stop(); } catch (e) { /* already stopped */ } src.disconnect(); src = null; }
    if (el) el.pause();
  }

  // fades out over a second, then stops
  function stop() {
    wantPlay = false;
    if (src && ctx && gain) {
      const s = src, t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 1);
      try { s.stop(t + 1.05); } catch (e) { /* already stopped */ }
      src = null;
    }
    if (el && !el.paused) {
      const a = el;
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = setInterval(() => {
        a.volume = Math.max(0, a.volume - VOLUME / 10);
        if (a.volume <= 0.001) { a.pause(); clearInterval(fadeTimer); fadeTimer = null; }
      }, 100);
    }
  }

  // seconds per beat of whichever song is playing
  const beat = () => 60 / (useFile() ? SONG_BPM : BPM);
  function duration() {
    if (useFile() && el && isFinite(el.duration) && el.duration > 0) return el.duration;
    return LENGTH;
  }

  root.MiiCrabSong = {
    SONG_URL, LENGTH, BPM,
    prepare, play, stop, duration, beat,
    playing: () => wantPlay || !!src || !!(el && !el.paused),
    _render: render, _score: { TUNE, CHORDS, BARS }, // (for testing)
  };
})(typeof window !== "undefined" ? window : globalThis);
