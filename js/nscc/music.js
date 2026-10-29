/*
 * music.js
 * MiiNSCC's background music: the same song as Mii Hub, looping seamlessly (Web Audio loops
 * between two exact sample points, see js/nscc/hubMusic.js). Turned on and off in ⚙️ Settings.
 *
 * Use: NSCCMusic.start()          (call once; it begins after your first click, as browsers require)
 *      NSCCMusic.set(true|false)  on/off (remembered on this computer)
 *      NSCCMusic.isOn()
 */
(function (root) {
  "use strict";
  const KEY = "miinscc-music";
  let ctx = null, gain = null, src = null, buffer = null, loading = null;
  let enabled = true, paused = false, started = false, ducked = false;
  try { enabled = localStorage.getItem(KEY) !== "off"; } catch (e) { /* private window */ }
  const VOLUME = 0.35;

  function decode() {
    if (loading) return loading;
    const M = root.HUB_MUSIC;
    if (!M) return Promise.reject(new Error("no music"));
    const bin = atob(M.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    loading = new Promise((res, rej) => ctx.decodeAudioData(bytes.buffer, res, rej)).then((b) => (buffer = b));
    return loading;
  }
  function play() {
    if (src || !buffer || !enabled || paused) return;
    const M = root.HUB_MUSIC;
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // the exact loop points (the decoder may shift both by the same few samples: the loop length stays exact)
    src.loopStart = M.loopStart / M.sampleRate;
    src.loopEnd = M.loopEnd / M.sampleRate;
    src.connect(gain);
    src.start(0, src.loopStart);
  }
  function stop() { if (src) { try { src.stop(); } catch (e) { /* already stopped */ } src.disconnect(); src = null; } }
  function update(fade) {
    if (!ctx) return;
    const on = enabled && !paused;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(on && !ducked ? VOLUME : 0, t + (fade || 0.6));
    if (on) { if (ctx.state === "suspended") ctx.resume(); decode().then(play).catch(() => {}); }
    if (root.NSCCMusic.onChange) root.NSCCMusic.onChange(enabled);
  }
  function start() {
    if (started) return;
    started = true;
    const begin = () => {
      if (ctx) return;
      try { ctx = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { return; }
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      update();
    };
    // browsers only allow sound after the user has clicked or pressed a key
    const once = () => { document.removeEventListener("pointerdown", once, true); document.removeEventListener("keydown", once, true); begin(); };
    document.addEventListener("pointerdown", once, true);
    document.addEventListener("keydown", once, true);
  }
  function pause(p) {
    paused = !!p;
    update();
  }
  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (e) { /* private window */ }
    update();
    return enabled;
  }
  function set(on) { if (enabled !== !!on) toggle(); return enabled; }
  root.NSCCMusic = { start, set, toggle, pause, isOn: () => enabled, onChange: null, _state: () => ({ ctx: ctx && ctx.state, playing: !!src, buffer: buffer && buffer.duration, gain: gain && gain.gain.value, paused, ducked }) };
})(typeof window !== "undefined" ? window : globalThis);
