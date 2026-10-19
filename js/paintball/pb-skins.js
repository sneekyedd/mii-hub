/*
 * Paintball skins: the catalog of weapon finishes you can get from crates.
 *
 * Rarities go blue -> purple -> pink -> red -> gold, with CS's case odds.
 * Knives are always gold (and gold is always a knife), like in CS.
 *
 * Each skin has a pattern (how its texture is drawn) and colors. The drawing
 * (textures, applying a skin to a 3D gun, small preview pictures) is added to
 * this same PBSkins object by pb-models.js.
 */
(function (root) {
  "use strict";

  const TIERS = [
    { id: "blue", name: "Mil-Spec", color: "#4b69ff", odds: 0.7992 },
    { id: "purple", name: "Restricted", color: "#8847ff", odds: 0.1598 },
    { id: "pink", name: "Classified", color: "#d32ce6", odds: 0.032 },
    { id: "red", name: "Covert", color: "#eb4b4b", odds: 0.0064 },
    { id: "gold", name: "Rare Special", color: "#e4ae39", odds: 0.0026 },
  ];
  const TIER = {};
  TIERS.forEach((t, i) => { t.rank = i; TIER[t.id] = t; });

  const WEAPON_NAMES = { ak: "Paint AK", awp: "Paint AWP", deagle: "Paint Deagle", knife: "Butterfly Knife" };

  // pattern: the kind of artwork; c: its colors (base first); fx: extras for the rarer ones
  //   fx.glow   parts of the pattern glow a little (emissive)
  //   fx.metal  shiny metallic finish
  //   fx.shift  colors shimmer/shift with the viewing angle (knife fades and dopplers)
  const S = (id, weapon, tier, name, pattern, c, fx) => ({ id, weapon, tier, name, pattern, c, fx: fx || {} });

  const SKINS = [
    // ---------------- Paint AK ----------------
    S("ak_safari", "ak", "blue", "Safari Mesh", "mesh", ["#b9ac86", "#6f6a4c", "#3f3b2a"]),
    S("ak_jungle", "ak", "blue", "Jungle Spray", "spray", ["#4d5f34", "#7c8a4a", "#2a3220"]),
    S("ak_slate", "ak", "blue", "Slate", "solid", ["#3b4148", "#5e6670", "#1f2327"]),
    S("ak_bluelam", "ak", "blue", "Blue Laminate", "laminate", ["#2c5aa0", "#8fb3e0", "#1c2f52"]),
    S("ak_urban", "ak", "blue", "Urban DDPAT", "ddpat", ["#8a9099", "#4b5058", "#c9ccd1"]),
    S("ak_elite", "ak", "blue", "Elite Build", "blocks", ["#e8e3d6", "#2b2b2b", "#d94b2b"]),
    S("ak_redline", "ak", "purple", "Redline", "redline", ["#151515", "#2a2a2a", "#e01b24"]),
    S("ak_frontside", "ak", "purple", "Frontside Misty", "misty", ["#1f3c88", "#e9eef7", "#7aa6e8"]),
    S("ak_hydro", "ak", "purple", "Hydroponic", "leaves", ["#1e7b46", "#f2d23c", "#0d3a22"]),
    S("ak_wasteland", "ak", "purple", "Wasteland Rebel", "graffiti", ["#d8c39a", "#a8312b", "#2b2622"]),
    S("ak_phantom", "ak", "purple", "Phantom Disruptor", "circuit", ["#1d1f3a", "#ff3fb4", "#46e3ff"], { glow: true }),
    S("ak_jaguar", "ak", "pink", "Jaguar", "jaguar", ["#e7a43a", "#2a1a10", "#6b3a1a"]),
    S("ak_bloodsport", "ak", "pink", "Bloodsport", "bloodsport", ["#f2f2f2", "#d4142a", "#111111"], { metal: true }),
    S("ak_neonrev", "ak", "pink", "Neon Revolution", "neon", ["#14141e", "#2df5c4", "#ff3cac"], { glow: true }),
    S("ak_vulcan", "ak", "pink", "Vulcan", "vulcan", ["#0a3d91", "#f4f4f4", "#ff8c1a"]),
    S("ak_fireserpent", "ak", "red", "Fire Serpent", "serpent", ["#2e5d2a", "#e3b23c", "#c4221b"], { metal: true }),
    S("ak_asiimov", "ak", "red", "Asiimov", "asiimov", ["#f4f4f2", "#ff7a1a", "#151515"], { glow: true }),
    S("ak_wildlotus", "ak", "red", "Wild Lotus", "lotus", ["#0f3b2e", "#ffd34d", "#ff5fa8"], { metal: true, glow: true }),

    // ---------------- Paint AWP ----------------
    S("awp_safari", "awp", "blue", "Safari Mesh", "mesh", ["#bfb18a", "#706a4c", "#3c3828"]),
    S("awp_pinkddpat", "awp", "blue", "Pink DDPAT", "ddpat", ["#e9a3c4", "#8c3b63", "#f7d8e7"]),
    S("awp_sunset", "awp", "blue", "Sun in Leo", "sunburst", ["#f3c44c", "#d4572a", "#4a2a1a"]),
    S("awp_capillary", "awp", "blue", "Capillary", "veins", ["#262a33", "#c9324a", "#5a6274"]),
    S("awp_atheris", "awp", "blue", "Atheris", "scales", ["#3d6b4a", "#c9d96a", "#1d2a20"]),
    S("awp_worm", "awp", "blue", "Worm God", "worms", ["#e9e1d0", "#c94a74", "#6b3a54"]),
    S("awp_graphite", "awp", "purple", "Graphite", "solid", ["#2a2d31", "#4a4f55", "#121315"], { metal: true }),
    S("awp_electric", "awp", "purple", "Electric Hive", "hex", ["#123a7a", "#3fd0ff", "#0a1a33"], { glow: true }),
    S("awp_pitviper", "awp", "purple", "Pit Viper", "scales", ["#4a3a25", "#c9a85a", "#1d150c"]),
    S("awp_corticera", "awp", "purple", "Corticera", "coral", ["#1d4fa3", "#ff7a1a", "#0c2554"]),
    S("awp_fever", "awp", "purple", "Fever Dream", "fever", ["#ff5fa8", "#5ef0ff", "#2a1640"]),
    S("awp_boom", "awp", "pink", "BOOM", "comic", ["#ffe14d", "#e0262b", "#1a1a1a"]),
    S("awp_hyper", "awp", "pink", "Hyper Beast", "hyperbeast", ["#16c2b5", "#ff3f7a", "#ffd23f"], { glow: true }),
    S("awp_lightning", "awp", "pink", "Lightning Strike", "lightning", ["#1a0f2e", "#b06bff", "#e8d8ff"], { glow: true }),
    S("awp_neonoir", "awp", "pink", "Neo-Noir", "noir", ["#f2f2f2", "#141414", "#ff2b4f"]),
    S("awp_asiimov", "awp", "red", "Asiimov", "asiimov", ["#f4f4f2", "#ff7a1a", "#151515"], { glow: true }),
    S("awp_medusa", "awp", "red", "Medusa", "medusa", ["#1d7a6b", "#e8c55a", "#0d2a28"], { metal: true }),
    S("awp_dragonlore", "awp", "red", "Dragon Lore", "dragon", ["#c9a35a", "#2e7d3a", "#8a2a1a"], { metal: true, glow: true }),

    // ---------------- Paint Deagle (sidearm) ----------------
    S("dg_mudder", "deagle", "blue", "Mudder", "spray", ["#6b5a3e", "#a08a62", "#3a3022"]),
    S("dg_night", "deagle", "blue", "Night", "solid", ["#23262b", "#3a3f46", "#111316"]),
    S("dg_urban", "deagle", "blue", "Urban Rubble", "ddpat", ["#9a9590", "#5c5853", "#d0ccc6"]),
    S("dg_storm", "deagle", "blue", "Midnight Storm", "veins", ["#1d2238", "#5a6bd8", "#0e1020"]),
    S("dg_corinthian", "deagle", "blue", "Corinthian", "laminate", ["#7a1f2a", "#d8b46a", "#3d0f14"]),
    S("dg_lightrail", "deagle", "blue", "Light Rail", "blocks", ["#e6e3dc", "#3a6bc4", "#222222"]),
    S("dg_directive", "deagle", "purple", "Directive", "circuit", ["#1f2a3a", "#3fd0ff", "#ff9a2e"], { glow: true }),
    S("dg_cobalt", "deagle", "purple", "Cobalt Disruption", "hex", ["#0f2f8a", "#4fa3ff", "#08143d"], { metal: true }),
    S("dg_crimson", "deagle", "purple", "Crimson Web", "web", ["#9e1220", "#141414", "#ff4a4a"]),
    S("dg_oxide", "deagle", "purple", "Oxide Blaze", "graffiti", ["#4a4f55", "#d86a2a", "#1c1e21"]),
    S("dg_trigger", "deagle", "purple", "Trigger Discipline", "comic", ["#f2e9d8", "#2a2a2a", "#d83a3a"]),
    S("dg_conspiracy", "deagle", "pink", "Conspiracy", "noir", ["#2a2a2a", "#e8e0c8", "#c9a35a"], { metal: true }),
    S("dg_kumicho", "deagle", "pink", "Kumicho Dragon", "dragon", ["#1f2f6b", "#e8c55a", "#c4221b"], { metal: true }),
    S("dg_mecha", "deagle", "pink", "Mecha Industries", "asiimov", ["#f2f2f0", "#2a7bff", "#141414"], { glow: true }),
    S("dg_oceandrive", "deagle", "pink", "Ocean Drive", "oceandrive", ["#1fd6c4", "#ff5fa8", "#fff1a8"], { glow: true }),
    S("dg_blaze", "deagle", "red", "Blaze", "blaze", ["#1a1a1a", "#ff7a1a", "#ffd23f"], { glow: true }),
    S("dg_printstream", "deagle", "red", "Printstream", "printstream", ["#f6f6f8", "#141418", "#c8c8ff"], { metal: true, shift: true }),
    S("dg_koi", "deagle", "red", "Golden Koi", "koi", ["#d9a62a", "#fff0b8", "#7a4a0a"], { metal: true, glow: true }),

    // ---------------- Butterfly Knife (gold only) ----------------
    S("kn_fade", "knife", "gold", "Fade", "fade", ["#ffd23f", "#ff3fb4", "#7a3cff"], { metal: true, shift: true }),
    S("kn_doppler", "knife", "gold", "Doppler", "doppler", ["#1b0f3d", "#ff4fd8", "#2a7bff"], { metal: true, shift: true }),
    S("kn_ruby", "knife", "gold", "Doppler Ruby", "doppler", ["#3d0610", "#ff1f3d", "#ff7a8a"], { metal: true, shift: true, glow: true }),
    S("kn_sapphire", "knife", "gold", "Doppler Sapphire", "doppler", ["#06123d", "#1f6bff", "#7ad0ff"], { metal: true, shift: true, glow: true }),
    S("kn_emerald", "knife", "gold", "Gamma Doppler Emerald", "doppler", ["#03301a", "#1fff7a", "#b8ff5a"], { metal: true, shift: true, glow: true }),
    S("kn_marble", "knife", "gold", "Marble Fade", "marble", ["#ff2b2b", "#ffe14d", "#2a6bff"], { metal: true, shift: true }),
    S("kn_tiger", "knife", "gold", "Tiger Tooth", "tiger", ["#ffb21e", "#5a2c0a", "#ffe8a0"], { metal: true }),
    S("kn_crimson", "knife", "gold", "Crimson Web", "web", ["#b3121f", "#141414", "#ff4a4a"], { metal: true }),
    S("kn_case", "knife", "gold", "Case Hardened", "casehardened", ["#2a6bd8", "#c99a3a", "#7a8a99"], { metal: true }),
    S("kn_lore", "knife", "gold", "Lore", "dragon", ["#d9b35a", "#1f5a2a", "#7a1a10"], { metal: true, glow: true }),
    S("kn_slaughter", "knife", "gold", "Slaughter", "slaughter", ["#c41a2a", "#ff6b7a", "#5a0a14"], { metal: true }),
    S("kn_ultraviolet", "knife", "gold", "Ultraviolet", "solid", ["#3a1a5a", "#7a3ab8", "#14081f"], { metal: true }),
  ];
  const BY_ID = {};
  SKINS.forEach((s) => { BY_ID[s.id] = s; });

  const CRATE = { id: "splat_case", name: "Splat Case", price: 100 };

  // Roll a crate: a tier by CS's odds, then any skin of that tier (all equally likely)
  function roll(rand) {
    rand = rand || Math.random;
    let r = rand(), tier = TIERS[0];
    for (const t of TIERS) { if (r < t.odds) { tier = t; break; } r -= t.odds; }
    const pool = SKINS.filter((s) => s.tier === tier.id);
    return pool[Math.floor(rand() * pool.length) % pool.length];
  }

  // Trade-up: 10 of the same skin -> a random skin from the next tier
  const TRADE_UP_COUNT = 10;
  function tradeUp(skinId, rand) {
    rand = rand || Math.random;
    const s = BY_ID[skinId];
    if (!s || s.tier === "gold") return null;
    const next = TIERS[TIER[s.tier].rank + 1];
    const pool = SKINS.filter((x) => x.tier === next.id);
    return pool[Math.floor(rand() * pool.length) % pool.length];
  }

  const PBSkins = root.PBSkins || (root.PBSkins = {});
  Object.assign(PBSkins, { TIERS, TIER, SKINS, BY_ID, WEAPON_NAMES, CRATE, TRADE_UP_COUNT, roll, tradeUp });

  // =============================================================================================
  // Pattern art. PBSkins.drawPattern(skin, w, h) paints a skin's texture procedurally with canvas
  // 2D and returns { color: canvas, glow: canvas | null } (glow = what fx.glow lights up).
  // The canvas is laid out like the gun's side: x runs butt -> muzzle (knife: tang -> tip), y top ->
  // bottom, and pixels are square on the model. Everything is sized from h, and the art is seeded
  // by the skin id, so a half-size canvas gives the same picture. pb-models.js turns it into
  // textures / materials / previews.
  // =============================================================================================
  const TAU = Math.PI * 2;
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mkRng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function mkNoise(rand) { // smooth value noise + fbm (values ~0..1, mean 0.5)
    const P = new Uint16Array(512), V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rand(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)), t = P[i]; P[i] = P[j]; P[j] = t; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]], c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y, o) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < (o || 4); i++) { s += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
    return { n, fbm };
  }
  const hexRGB = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const css = (c, a) => (a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const lit = (c, t) => mixC(c, WHITE, t), drk = (c, t) => mixC(c, BLACK, t);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const frac = (x) => x - Math.floor(x);
  function set(o, c, k) { k = k === undefined ? 1 : k; o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; }
  function setMix(o, a, b, t, k) { k = k === undefined ? 1 : k; o[0] = (a[0] + (b[0] - a[0]) * t) * k; o[1] = (a[1] + (b[1] - a[1]) * t) * k; o[2] = (a[2] + (b[2] - a[2]) * t) * k; }
  function grad3(o, stops, t) { // stops: [[t, color], ...] sorted
    if (t <= stops[0][0]) return set(o, stops[0][1]);
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return setMix(o, stops[i - 1][1], stops[i][1], sstep(stops[i - 1][0], stops[i][0], t));
    return set(o, stops[stops.length - 1][1]);
  }
  // per-pixel painter: fn(x, y, out) writes an [r, g, b] (0..255) into out
  function field(g, W, H, fn) {
    const img = g.createImageData(W, H), d = img.data, o = [0, 0, 0];
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      fn(x, y, o); d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  function fill(g, W, H, c) { g.fillStyle = css(c); g.fillRect(0, 0, W, H); }
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function blobPath(g, x, y, r, R, k) { // a lumpy round shape
    const n = 22, ph = R() * TAU, l1 = 2 + Math.floor(R() * 3), a1 = (k || 0.25) * (0.5 + R());
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, rr = r * (1 + a1 * 0.5 * Math.sin(a * l1 + ph) + 0.12 * Math.sin(a * 5 + ph * 2));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }
  // a smooth wandering line: [[x, y], ...]
  function wander(R, N, x, y, a, steps, step, turn, seedOff) {
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      a += (N.n(i * 0.35 + seedOff, seedOff * 1.7) - 0.5) * turn;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    return pts;
  }
  function strokePts(g, pts, smooth) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    if (!smooth) { for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); }
    else {
      for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
    g.stroke();
  }
  // a tapered ribbon along pts (width w0 -> w1), filled
  function ribbon(g, pts, w0, w1) {
    const L = [], Rr = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
      L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); Rr.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    polyPath(g, L.concat(Rr.reverse()));
  }
  function starPath(g, x, y, r0, r1, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = rot + (i / (n * 2)) * TAU, r = i % 2 ? r1 : r0; g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath();
  }
  function scaleTexture(g, W, H, R, sw, cFill, cEdge, cHi) { // overlapping fish/snake scales, row by row
    const sh = sw * 0.6;
    for (let row = -1; row * sh < H + sh; row++) for (let col = -1; col * sw < W + sw; col++) {
      const x = col * sw + (row & 1 ? sw / 2 : 0), y = row * sh;
      const gr = g.createLinearGradient(x, y - sh * 0.2, x, y + sh * 1.1);
      gr.addColorStop(0, css(cHi)); gr.addColorStop(1, css(cFill));
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, sw * 0.56, sh * 1.12, 0, 0, Math.PI); g.closePath(); g.fill();
      g.strokeStyle = css(cEdge, 0.85); g.lineWidth = Math.max(1, sw * 0.07); g.stroke();
    }
  }

  // ---------------------------------------------------------------------------------- patterns
  // signature: (g, W, H, C = [base, 2nd, accent] as rgb arrays, R = seeded random, N = noise, skin)
  const PATTERNS = {
    // Safari Mesh: sandy blotch camo under a dark net
    mesh(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, n = N.fbm(u * 2.2, v * 2.2, 4), m = N.fbm(u * 3.6 + 17, v * 3.6 + 5, 3);
        set(o, m > 0.6 ? C[2] : n > 0.54 ? C[1] : C[0], 0.93 + N.n(u * 70, v * 70) * 0.12);
      });
      g.lineWidth = Math.max(1, H * 0.007); g.strokeStyle = css(drk(C[2], 0.3), 0.55);
      const st = H * 0.075; g.beginPath();
      for (let k = -H; k < W + H; k += st) { g.moveTo(k, 0); g.lineTo(k + H, H); g.moveTo(k, 0); g.lineTo(k - H, H); }
      g.stroke();
    },
    // Jungle Spray: soft sprayed-on blobs and overspray
    spray(g, W, H, C, R) {
      fill(g, W, H, C[0]);
      for (let i = 0; i < 110; i++) {
        const x = R() * W, y = R() * H, r = H * (0.05 + R() * 0.17), c = i % 3 === 0 ? C[2] : C[1];
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, css(c, 0.9)); gr.addColorStop(0.55, css(c, 0.6)); gr.addColorStop(1, css(c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      for (let i = 0; i < 2500; i++) { g.fillStyle = css(R() < 0.5 ? C[2] : C[1], 0.5); g.fillRect(R() * W, R() * H, H * 0.006 + 1, H * 0.006 + 1); }
    },
    // Slate / Graphite / Ultraviolet: one rich color, satin streaks
    solid(g, W, H, C, R, N, sk) {
      field(g, W, H, (x, y, o) => {
        const v = y / H, u = x / H, n = N.fbm(u * 1.2, v * 1.2, 3);
        grad3(o, [[0, C[1]], [0.42, C[0]], [1, C[2]]], v * 0.85 + (n - 0.5) * 0.5);
        const k = 0.94 + N.n(u * 3, v * 140) * 0.12; o[0] *= k; o[1] *= k; o[2] *= k;
      });
      for (let i = 0; i < 500; i++) {
        const y = R() * H, x = R() * W;
        g.strokeStyle = css(R() < 0.5 ? WHITE : BLACK, 0.025 + R() * 0.05); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + W * (0.05 + R() * 0.4), y); g.stroke();
      }
      if (sk.weapon !== "knife") { // a couple of machined panel lines
        g.strokeStyle = css(drk(C[2], 0.4), 0.6); g.lineWidth = Math.max(1, H * 0.006);
        for (let i = 0; i < 4; i++) { const x = W * (0.15 + i * 0.22 + R() * 0.05); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H * 0.2, H); g.stroke(); }
      }
    },
    // Blue Laminate: plywood layers in three tones
    laminate(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, t = v * 8 + N.fbm(u * 0.7, v * 0.7, 4) * 9 + u * 0.4;
        const i = Math.floor(t), f = t - i, c = C[((i % 3) + 3) % 3];
        set(o, c, (f < 0.07 ? 0.72 : 1) * (0.92 + N.n(u * 4, v * 160) * 0.14));
      });
    },
    // Urban / Pink DDPAT: square digital camo pixels
    ddpat(g, W, H, C, R, N) {
      const cs = Math.max(2, Math.round(H / 26));
      for (let y = 0; y < H; y += cs) for (let x = 0; x < W; x += cs) {
        const u = x / H, v = y / H, n = N.fbm(u * 2.4, v * 2.4, 3), m = N.fbm(u * 3.6 + 40, v * 3.6, 3);
        let c = C[0];
        if (n > 0.56) c = C[1]; else if (n < 0.43) c = C[2];
        if (m > 0.63) c = drk(C[1], 0.25);
        g.fillStyle = css(c); g.fillRect(x, y, cs, cs);
      }
    },
    // Elite Build: cream base, chunky black blocks, orange-red hazard accents
    blocks(g, W, H, C, R) {
      fill(g, W, H, C[0]);
      g.fillStyle = css(drk(C[0], 0.08));
      for (let i = 0; i < 30; i++) g.fillRect(R() * W, R() * H, H * (0.05 + R() * 0.2), H * (0.02 + R() * 0.06));
      for (let i = 0; i < 10; i++) {
        const x = (i / 10) * W + R() * W * 0.04, w = W * (0.035 + R() * 0.06), top = i % 2 === 0, s = H * (0.25 + R() * 0.3), d = top ? 1 : -1;
        const y0 = top ? -2 : H + 2, y1 = top ? H * (0.3 + R() * 0.25) : H * (0.55 + R() * 0.2);
        g.fillStyle = css(C[1]); polyPath(g, [[x, y0], [x + w, y0], [x + w + s * 0.3 * d, y1], [x + s * 0.3 * d, y1]]); g.fill();
        g.fillStyle = css(C[2]); polyPath(g, [[x + w + s * 0.3 * d, y1 - d * H * 0.02], [x + w + s * 0.3 * d + H * 0.05, y1 - d * H * 0.02], [x + s * 0.3 * d + H * 0.05, y1 + d * H * 0.04], [x + s * 0.3 * d, y1 + d * H * 0.04]]); g.fill();
      }
      g.fillStyle = css(C[2]);
      for (let i = 0; i < 7; i++) { const x = R() * W, y = H * (0.45 + R() * 0.1); for (let k = 0; k < 4; k++) { polyPath(g, [[x + k * H * 0.05, y], [x + k * H * 0.05 + H * 0.025, y], [x + k * H * 0.05 + H * 0.045, y + H * 0.05], [x + k * H * 0.05 + H * 0.02, y + H * 0.05]]); g.fill(); } }
      g.fillStyle = css(C[1]);
      for (let i = 0; i < 12; i++) g.fillRect(R() * W, H * (0.4 + R() * 0.2), H * (0.04 + R() * 0.12), Math.max(1, H * 0.012));
    },
    // Redline: carbon fibre with red pinstripes and a white keyline
    redline(g, W, H, C) {
      const cs = Math.max(2, H / 40);
      field(g, W, H, (x, y, o) => {
        const bx = Math.floor(x / (cs * 2)), by = Math.floor(y / (cs * 2)), fx = (x % (cs * 2)) / (cs * 2), fy = (y % (cs * 2)) / (cs * 2);
        const weave = (bx + by) & 1, sh = weave ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
        setMix(o, C[0], C[1], 0.15 + sh * 0.85);
      });
      const band = (y0, h, c) => { g.fillStyle = css(c); g.fillRect(0, y0, W, h); };
      band(H * 0.3, H * 0.035, C[2]); band(H * 0.345, Math.max(1, H * 0.008), WHITE); band(H * 0.365, H * 0.014, C[2]);
      band(H * 0.66, H * 0.02, C[2]); band(H * 0.69, Math.max(1, H * 0.006), WHITE);
      g.fillStyle = css(C[2]);
      for (const x of [W * 0.12, W * 0.62]) { polyPath(g, [[x, H * 0.3], [x + H * 0.18, H * 0.3], [x + H * 0.55, H * 0.69], [x + H * 0.37, H * 0.69]]); g.fill(); }
      g.fillStyle = css(WHITE);
      for (const x of [W * 0.12, W * 0.62]) { polyPath(g, [[x + H * 0.21, H * 0.3], [x + H * 0.24, H * 0.3], [x + H * 0.61, H * 0.69], [x + H * 0.58, H * 0.69]]); g.fill(); }
    },
    // Frontside Misty: icy blue ridges, white snow swooshes
    misty(g, W, H, C, R, N) {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, css(drk(C[0], 0.25))); gr.addColorStop(1, css(C[2]));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let l = 0; l < 4; l++) {
        g.fillStyle = css(mixC(C[0], C[1], 0.15 + l * 0.18), 0.85);
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += H * 0.03) g.lineTo(x, H * (0.25 + l * 0.17) + (N.fbm(x / H * 0.8 + l * 7, l, 4) - 0.5) * H * 0.9);
        g.lineTo(W, H); g.closePath(); g.fill();
      }
      g.lineCap = "round";
      for (let i = 0; i < 16; i++) {
        const x = R() * W, y = R() * H, l = H * (0.6 + R() * 1.4);
        g.strokeStyle = css(C[1], 0.55 + R() * 0.4); g.lineWidth = H * (0.008 + R() * 0.05);
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + l * 0.3, y - H * 0.3 * R(), x + l * 0.6, y + H * 0.3 * R(), x + l, y - H * 0.15); g.stroke();
      }
      for (let i = 0; i < 700; i++) { g.fillStyle = css(C[1], 0.3 + R() * 0.6); g.beginPath(); g.arc(R() * W, R() * H, H * 0.004 * (1 + R() * 2), 0, TAU); g.fill(); }
    },
    // Hydroponic: big tropical leaves
    leaves(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => set(o, C[2], 0.75 + N.fbm(x / H * 2, y / H * 2, 3) * 0.5));
      for (let i = 0; i < 40; i++) {
        const x = R() * W, y = R() * H, L = H * (0.35 + R() * 0.45), w = L * (0.22 + R() * 0.12), a = R() * TAU, c = i % 3 === 0 ? C[1] : C[0];
        g.save(); g.translate(x, y); g.rotate(a);
        const gr = g.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, css(lit(c, 0.15))); gr.addColorStop(1, css(drk(c, 0.3)));
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.45, -w * 1.3, L, 0); g.quadraticCurveTo(L * 0.45, w * 1.3, 0, 0); g.fill();
        g.strokeStyle = css(drk(c, 0.45), 0.8); g.lineWidth = Math.max(1, H * 0.006); g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.96, 0); g.stroke();
        g.lineWidth = Math.max(1, H * 0.003);
        for (let k = 1; k < 7; k++) { const px = (k / 7) * L * 0.9; g.beginPath(); g.moveTo(px, 0); g.lineTo(px + L * 0.08, -w * 0.75 * Math.sin((k / 7) * Math.PI)); g.moveTo(px, 0); g.lineTo(px + L * 0.08, w * 0.75 * Math.sin((k / 7) * Math.PI)); g.stroke(); }
        g.restore();
      }
    },
    // Wasteland Rebel: grimy paper, red spray tags with drips, black scrawls and stencil stars
    graffiti(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const n = N.fbm(x / H * 3, y / H * 3, 4); set(o, C[0], 0.75 + n * 0.4); });
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 9; i++) {
        const pts = wander(R, N, R() * W, R() * H, R() * TAU, 18, H * 0.06, 2.6, i * 3.3);
        g.strokeStyle = css(C[1], 0.9); g.lineWidth = H * (0.03 + R() * 0.03); strokePts(g, pts, true);
        for (let k = 0; k < 4; k++) {
          const p = pts[Math.floor(R() * pts.length)], l = H * (0.05 + R() * 0.2), w = H * 0.012;
          g.fillStyle = css(C[1], 0.9); g.fillRect(p[0] - w / 2, p[1], w, l); g.beginPath(); g.arc(p[0], p[1] + l, w * 0.9, 0, TAU); g.fill();
        }
      }
      for (let i = 0; i < 6; i++) { g.strokeStyle = css(C[2], 0.85); g.lineWidth = Math.max(1, H * 0.01); strokePts(g, wander(R, N, R() * W, R() * H, R() * TAU, 30, H * 0.03, 4, 50 + i), true); }
      for (let i = 0; i < 6; i++) { g.fillStyle = css(i % 2 ? C[2] : C[1]); starPath(g, R() * W, R() * H, H * 0.09, H * 0.036, 5, R()); g.fill(); }
      for (let i = 0; i < 300; i++) { g.fillStyle = css(R() < 0.6 ? C[1] : C[2], 0.7); g.beginPath(); g.arc(R() * W, R() * H, H * 0.004 * (1 + R() * 3), 0, TAU); g.fill(); }
    },
    // Phantom Disruptor: dark board with glowing pink / cyan traces
    circuit(g, W, H, C, R) {
      fill(g, W, H, C[0]);
      const cs = H / 14;
      g.strokeStyle = css(lit(C[0], 0.07)); g.lineWidth = 1; g.beginPath();
      for (let x = 0; x < W; x += cs) { g.moveTo(x, 0); g.lineTo(x, H); } for (let y = 0; y < H; y += cs) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke();
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 90; i++) {
        let x = Math.floor(R() * W / cs) * cs, y = Math.floor(R() * H / cs) * cs, d = Math.floor(R() * 4) * 2;
        const pts = [[x, y]], c = i % 2 ? C[1] : C[2];
        for (let s = 0, n = 3 + Math.floor(R() * 9); s < n; s++) { if (R() < 0.35) d = (d + (R() < 0.5 ? 1 : 7)) % 8; x += dirs[d][0] * cs; y += dirs[d][1] * cs; pts.push([x, y]); }
        g.strokeStyle = css(c); g.lineWidth = Math.max(1, cs * 0.16); strokePts(g, pts);
        for (const p of [pts[0], pts[pts.length - 1]]) { g.fillStyle = css(c); g.beginPath(); g.arc(p[0], p[1], cs * 0.26, 0, TAU); g.fill(); g.fillStyle = css(C[0]); g.beginPath(); g.arc(p[0], p[1], cs * 0.12, 0, TAU); g.fill(); }
      }
      for (let i = 0; i < 7; i++) {
        const x = R() * W, y = R() * H, w = cs * (2 + R() * 3), h = cs * (1 + R() * 1.5);
        g.fillStyle = css(drk(C[0], 0.5)); g.fillRect(x, y, w, h); g.strokeStyle = css(i % 2 ? C[1] : C[2]); g.lineWidth = Math.max(1, cs * 0.1); g.strokeRect(x, y, w, h);
      }
    },
    // Jaguar: warm fur with broken-ring rosettes
    jaguar(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const n = N.fbm(x / H * 2.5, y / H * 2.5, 4); setMix(o, lit(C[0], 0.25), drk(C[0], 0.2), n); });
      const sp = H * 0.24;
      for (let gy = -1; gy * sp * 0.8 < H + sp; gy++) for (let gx = -1; gx * sp < W + sp; gx++) {
        const cx = gx * sp + (gy & 1 ? sp / 2 : 0) + (R() - 0.5) * sp * 0.4, cy = gy * sp * 0.8 + (R() - 0.5) * sp * 0.3, r = sp * (0.24 + R() * 0.12);
        g.fillStyle = css(C[2], 0.75); blobPath(g, cx, cy, r * 0.75, R, 0.3); g.fill();
        const n = 4 + Math.floor(R() * 3), ph = R() * TAU;
        g.fillStyle = css(C[1]);
        for (let k = 0; k < n; k++) { const a = ph + (k / n) * TAU; blobPath(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9, r * (0.22 + R() * 0.14), R, 0.4); g.fill(); }
        if (R() < 0.6) { blobPath(g, cx + sp * 0.5, cy + sp * 0.35, sp * 0.06, R, 0.3); g.fill(); }
      }
    },
    // Bloodsport: white with red blade sweeps, black panels, blood flecks
    bloodsport(g, W, H, C, R) {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, css(C[0])); gr.addColorStop(1, css(drk(C[0], 0.12)));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = css(C[2]);
      polyPath(g, [[0, H * 0.78], [W * 0.3, H * 0.7], [W * 0.42, H * 0.86], [W * 0.75, H * 0.74], [W, H * 0.8], [W, H], [0, H]]); g.fill();
      polyPath(g, [[W * 0.18, 0], [W * 0.5, 0], [W * 0.44, H * 0.16], [W * 0.26, H * 0.1]]); g.fill();
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * W + R() * W * 0.05, y = H * (0.25 + R() * 0.45), l = W * (0.12 + R() * 0.16), t = H * (0.06 + R() * 0.12);
        const gg = g.createLinearGradient(x, y, x + l, y); gg.addColorStop(0, css(C[1])); gg.addColorStop(1, css(drk(C[1], 0.45)));
        g.fillStyle = gg; polyPath(g, [[x, y], [x + l, y - t * 0.6], [x + l * 0.75, y + t * 0.2], [x + l * 0.2, y + t]]); g.fill();
        g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.008); g.stroke();
      }
      g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.005);
      for (let i = 0; i < 14; i++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + H * (0.2 + R() * 0.5), y - H * 0.05); g.stroke(); }
      for (let i = 0; i < 400; i++) { g.fillStyle = css(C[1], 0.85); g.beginPath(); g.arc(R() * W, R() * H, H * 0.003 * (1 + R() * 3), 0, TAU); g.fill(); }
    },
    // Neon Revolution: black with neon shards, stripes and zigzags
    neon(g, W, H, C, R) {
      fill(g, W, H, C[0]);
      for (let i = 0; i < 26; i++) {
        const x = R() * W, y = R() * H, s = H * (0.12 + R() * 0.35), a = R() * TAU, c = i % 2 ? C[1] : C[2];
        const pts = [[x + Math.cos(a) * s, y + Math.sin(a) * s], [x + Math.cos(a + 2.2) * s * 0.7, y + Math.sin(a + 2.2) * s * 0.7], [x + Math.cos(a + 4.1) * s * 0.8, y + Math.sin(a + 4.1) * s * 0.8]];
        g.fillStyle = css(c, R() < 0.5 ? 0.9 : 0.25); polyPath(g, pts); g.fill();
        g.strokeStyle = css(lit(c, 0.4)); g.lineWidth = Math.max(1, H * 0.008); g.stroke();
      }
      g.lineWidth = Math.max(1, H * 0.012);
      for (let i = 0; i < 8; i++) {
        const x = R() * W, y = R() * H, c = i % 2 ? C[1] : C[2];
        g.strokeStyle = css(c);
        for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x + k * H * 0.04, y); g.lineTo(x + k * H * 0.04 + H * 0.2, y + H * 0.2); g.stroke(); }
      }
      g.lineWidth = Math.max(1, H * 0.014);
      for (let i = 0; i < 6; i++) { const x = R() * W, y = R() * H; g.strokeStyle = css(i % 2 ? C[2] : C[1]); g.beginPath(); g.moveTo(x, y); for (let k = 1; k < 9; k++) g.lineTo(x + k * H * 0.05, y + (k & 1 ? -1 : 1) * H * 0.04); g.stroke(); }
    },
    // Vulcan: white body, blue armor bands with black keylines and orange tabs
    vulcan(g, W, H, C, R) {
      fill(g, W, H, C[1]);
      const blue = (pts) => { g.fillStyle = css(C[0]); polyPath(g, pts); g.fill(); g.strokeStyle = css(BLACK); g.lineWidth = Math.max(1, H * 0.014); g.stroke(); };
      blue([[-5, -5], [W + 5, -5], [W + 5, H * 0.22], [W * 0.78, H * 0.22], [W * 0.74, H * 0.36], [W * 0.46, H * 0.36], [W * 0.42, H * 0.22], [W * 0.2, H * 0.22], [W * 0.16, H * 0.3], [-5, H * 0.3]]);
      blue([[-5, H + 5], [W + 5, H + 5], [W + 5, H * 0.72], [W * 0.86, H * 0.72], [W * 0.82, H * 0.62], [W * 0.56, H * 0.62], [W * 0.52, H * 0.76], [W * 0.26, H * 0.76], [W * 0.22, H * 0.66], [-5, H * 0.66]]);
      blue([[W * 0.03, H * 0.38], [W * 0.1, H * 0.38], [W * 0.12, H * 0.6], [W * 0.05, H * 0.6]]);
      blue([[W * 0.9, H * 0.36], [W * 0.97, H * 0.36], [W * 0.99, H * 0.58], [W * 0.92, H * 0.58]]);
      g.fillStyle = css(C[2]);
      for (const [x, y] of [[0.2, 0.24], [0.44, 0.38], [0.76, 0.38], [0.24, 0.6], [0.55, 0.56], [0.86, 0.6]]) { polyPath(g, [[W * x, H * y], [W * x + H * 0.12, H * y], [W * x + H * 0.1, H * y + H * 0.05], [W * x - H * 0.02, H * y + H * 0.05]]); g.fill(); }
      g.strokeStyle = css(drk(C[1], 0.3)); g.lineWidth = Math.max(1, H * 0.005);
      for (let i = 0; i < 9; i++) { const x = W * (0.05 + i * 0.11); g.beginPath(); g.moveTo(x, H * 0.4); g.lineTo(x + H * 0.06, H * 0.58); g.stroke(); }
    },
    // Fire Serpent: dark green scales, a golden serpent coiling along, red flames
    serpent(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const sx = x / (H * 0.07), sy = y / (H * 0.05), row = Math.floor(sy), fx = frac(sx + (row & 1) * 0.5) - 0.5, fy = frac(sy);
        const d = Math.sqrt(fx * fx * 1.4 + fy * fy), n = N.fbm(x / H * 2, y / H * 2, 3);
        setMix(o, drk(C[0], 0.55), lit(C[0], 0.1), clamp01(1.1 - d) * 0.8 + n * 0.3);
      });
      const ph = R() * TAU, body = [];
      for (let x = -H * 0.2; x <= W * 0.93; x += H * 0.04) body.push([x, H * (0.5 + 0.27 * Math.sin((x / W) * TAU * 1.4 + ph))]);
      g.lineCap = "round"; g.lineJoin = "round";
      // flames licking off the body
      for (let i = 0; i < body.length; i += 2) {
        const p = body[i], l = H * (0.1 + R() * 0.18), a = -Math.PI / 2 + (R() - 0.5) * 1.2;
        const gr = g.createLinearGradient(p[0], p[1], p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l);
        gr.addColorStop(0, css(C[2], 0.95)); gr.addColorStop(1, css(lit(C[1], 0.3), 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(p[0] - H * 0.04, p[1]); g.quadraticCurveTo(p[0] + Math.cos(a) * l * 0.5 - H * 0.04, p[1] + Math.sin(a) * l * 0.6, p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l); g.quadraticCurveTo(p[0] + Math.cos(a) * l * 0.4 + H * 0.05, p[1] + Math.sin(a) * l * 0.4, p[0] + H * 0.04, p[1]); g.fill();
      }
      g.save(); ribbon(g, body, H * 0.06, H * 0.2); g.clip();
      scaleTexture(g, W, H, R, H * 0.05, drk(C[1], 0.25), drk(C[1], 0.7), lit(C[1], 0.35));
      g.restore();
      ribbon(g, body, H * 0.06, H * 0.2); g.strokeStyle = css(drk(C[2], 0.5)); g.lineWidth = Math.max(1, H * 0.012); g.stroke();
      const hd = body[body.length - 1];
      g.fillStyle = css(C[1]); g.beginPath(); g.ellipse(hd[0] + H * 0.08, hd[1], H * 0.14, H * 0.09, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = css(C[2]); g.beginPath(); g.arc(hd[0] + H * 0.12, hd[1] - H * 0.03, H * 0.022, 0, TAU); g.fill();
    },
    // Asiimov: white sci-fi armor, orange panels, black under-plates and keylines
    asiimov(g, W, H, C, R) {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, css(C[0])); gr.addColorStop(1, css(drk(C[0], 0.1)));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const panel = (pts, c) => { g.fillStyle = css(c); polyPath(g, pts); g.fill(); g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.012); g.stroke(); };
      panel([[-5, H * 0.66], [W * 0.2, H * 0.66], [W * 0.25, H * 0.56], [W * 0.6, H * 0.56], [W * 0.64, H * 0.7], [W + 5, H * 0.7], [W + 5, H + 5], [-5, H + 5]], C[2]);
      panel([[W * 0.02, H * 0.08], [W * 0.2, H * 0.08], [W * 0.26, H * 0.36], [W * 0.06, H * 0.36]], C[1]);
      panel([[W * 0.3, H * 0.12], [W * 0.4, H * 0.12], [W * 0.36, H * 0.3], [W * 0.27, H * 0.3]], C[1]);
      panel([[W * 0.58, H * 0.1], [W * 0.86, H * 0.1], [W * 0.82, H * 0.46], [W * 0.66, H * 0.46], [W * 0.62, H * 0.32]], C[1]);
      panel([[W * 0.9, H * 0.18], [W + 5, H * 0.18], [W + 5, H * 0.5], [W * 0.93, H * 0.5]], C[1]);
      panel([[W * 0.42, H * 0.42], [W * 0.56, H * 0.42], [W * 0.54, H * 0.5], [W * 0.4, H * 0.5]], C[1]);
      g.strokeStyle = css(C[2], 0.8); g.lineWidth = Math.max(1, H * 0.006);
      for (const x of [0.28, 0.45, 0.52, 0.88]) { g.beginPath(); g.moveTo(W * x, 0); g.lineTo(W * x, H * 0.56); g.stroke(); }
      g.beginPath(); g.moveTo(0, H * 0.46); g.lineTo(W * 0.3, H * 0.46); g.moveTo(W * 0.1, H * 0.52); g.lineTo(W * 0.45, H * 0.52); g.stroke();
      g.fillStyle = css(C[2]);
      for (let i = 0; i < 8; i++) g.fillRect(W * 0.44 + i * H * 0.03, H * 0.18, H * 0.016, H * 0.08);
      g.fillStyle = css(drk(C[0], 0.35));
      for (let i = 0; i < 10; i++) g.fillRect(R() * W, H * (0.38 + R() * 0.12), H * (0.04 + R() * 0.1), Math.max(1, H * 0.01));
      g.fillStyle = css(C[1]);
      for (let i = 0; i < 6; i++) { const x = W * (0.08 + i * 0.16); polyPath(g, [[x, H * 0.62], [x + H * 0.08, H * 0.62], [x + H * 0.06, H * 0.66], [x - H * 0.02, H * 0.66]]); g.fill(); }
    },
    // Wild Lotus: deep green lacquer, gold filigree, pink lotus blooms
    lotus(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, t = Math.abs(Math.sin(u * 9 + Math.sin(v * 9) * 1.5)) * Math.abs(Math.sin(v * 9 + Math.sin(u * 9) * 1.5));
        setMix(o, drk(C[0], 0.2), lit(C[0], 0.12), t * 0.6 + N.fbm(u * 2, v * 2, 3) * 0.4);
      });
      g.strokeStyle = css(C[1], 0.9); g.lineWidth = Math.max(1, H * 0.008); g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        const x = R() * W, y = R() * H, r = H * (0.05 + R() * 0.1), dir = R() < 0.5 ? 1 : -1;
        g.beginPath(); for (let k = 0; k <= 40; k++) { const a = (k / 40) * TAU * 1.6 * dir, rr = r * (1 - k / 48); g[k ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.stroke();
        g.beginPath(); g.moveTo(x + r, y); g.quadraticCurveTo(x + r * 2.5, y - r * dir, x + r * 4, y + r * 0.3 * dir); g.stroke();
      }
      for (let i = 0; i < 11; i++) {
        const x = R() * W, y = R() * H, r = H * (0.1 + R() * 0.1), n = 8;
        for (let layer = 0; layer < 2; layer++) for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + layer * 0.4, rr = r * (layer ? 0.6 : 1);
          g.save(); g.translate(x, y); g.rotate(a);
          const pg = g.createLinearGradient(0, 0, rr, 0); pg.addColorStop(0, css(lit(C[2], 0.5))); pg.addColorStop(1, css(C[2]));
          g.fillStyle = pg; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(rr * 0.5, -rr * 0.32, rr, 0); g.quadraticCurveTo(rr * 0.5, rr * 0.32, 0, 0); g.fill();
          g.strokeStyle = css(C[1]); g.lineWidth = Math.max(1, H * 0.004); g.stroke(); g.restore();
        }
        g.fillStyle = css(C[1]); g.beginPath(); g.arc(x, y, r * 0.18, 0, TAU); g.fill();
      }
    },
    // Sun in Leo: a blazing sun with alternating rays
    sunburst(g, W, H, C, R) {
      const cx = W * 0.6, cy = H * 0.55, n = 36;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        g.fillStyle = css(i & 1 ? C[0] : C[1]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * W, cy + Math.sin(a0) * W); g.lineTo(cx + Math.cos(a1) * W, cy + Math.sin(a1) * W); g.closePath(); g.fill();
      }
      g.strokeStyle = css(C[2], 0.6); g.lineWidth = Math.max(1, H * 0.006);
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * H * 0.3, cy + Math.sin(a) * H * 0.3); g.lineTo(cx + Math.cos(a) * W, cy + Math.sin(a) * W); g.stroke(); }
      g.fillStyle = css(C[2]); starPath(g, cx, cy, H * 0.38, H * 0.27, 18, R()); g.fill();
      const sg = g.createRadialGradient(cx, cy, 0, cx, cy, H * 0.27); sg.addColorStop(0, css(lit(C[0], 0.5))); sg.addColorStop(1, css(C[1]));
      g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, H * 0.25, 0, TAU); g.fill();
      g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.02); g.stroke();
      g.fillStyle = css(C[2]); g.beginPath(); g.arc(cx - H * 0.08, cy - H * 0.04, H * 0.025, 0, TAU); g.arc(cx + H * 0.08, cy - H * 0.04, H * 0.025, 0, TAU); g.fill();
      g.lineWidth = Math.max(1, H * 0.012); g.beginPath(); g.arc(cx, cy + H * 0.02, H * 0.09, 0.2, Math.PI - 0.2); g.stroke();
    },
    // Capillary: branching red vessels over dark gunmetal
    veins(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => setMix(o, drk(C[0], 0.2), C[2], N.fbm(x / H * 2.5, y / H * 2.5, 4) * 0.55));
      g.lineCap = "round";
      const br = (x, y, a, w, d) => {
        const len = H * (0.06 + R() * 0.09), nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        g.strokeStyle = css(lit(C[1], d * 0.03)); g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a + 0.4) * len * 0.5, y + Math.sin(a + 0.4) * len * 0.5, nx, ny); g.stroke();
        if (d <= 0 || w < 0.6) return;
        br(nx, ny, a + (R() - 0.5) * 0.8, w * 0.78, d - 1);
        if (R() < 0.55) br(nx, ny, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), w * 0.6, d - 1);
      };
      for (let i = 0; i < 16; i++) br(R() * W, i % 2 ? -2 : H + 2, i % 2 ? Math.PI / 2 + (R() - 0.5) : -Math.PI / 2 + (R() - 0.5), H * 0.03, 7);
    },
    // Atheris / Pit Viper: overlapping snake scales with darker saddle blotches
    scales(g, W, H, C, R, N) {
      fill(g, W, H, C[0]);
      scaleTexture(g, W, H, R, H * 0.1, drk(C[0], 0.1), drk(C[2], 0.1), mixC(C[0], C[1], 0.75));
      const img = g.getImageData(0, 0, W, H), d = img.data;
      for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
        // viper saddles: dark diamonds down the middle, small dark spots along the sides
        const u = x / H, v = y / H, cu = Math.abs(frac(u * 0.9) - 0.5) * 2, dm = cu * 0.55 + Math.abs(v - 0.5) * 1.5 + (N.fbm(u * 4, v * 4, 2) - 0.5) * 0.25;
        const side = Math.hypot(frac(u * 0.9 + 0.5) - 0.5, (Math.abs(v - 0.5) - 0.36) * 1.4);
        let k = dm < 0.42 ? (dm > 0.36 ? 0.25 : 0.55) : 1;
        if (side < 0.09) k = 0.4;
        d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
      }
      g.putImageData(img, 0, 0);
    },
    // Worm God: cream base, chubby pink worms with dark outlines
    worms(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => set(o, C[0], 0.92 + N.fbm(x / H * 4, y / H * 4, 3) * 0.14));
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 30; i++) {
        const pts = wander(R, N, R() * W, R() * H, R() * TAU, 14 + Math.floor(R() * 10), H * 0.03, 3, i * 2.1 + 5);
        g.strokeStyle = css(C[2]); g.lineWidth = H * 0.07; strokePts(g, pts, true);
        g.strokeStyle = css(C[1]); g.lineWidth = H * 0.05; strokePts(g, pts, true);
        g.strokeStyle = css(lit(C[1], 0.4), 0.8); g.lineWidth = H * 0.015; strokePts(g, pts.map((p) => [p[0] - H * 0.008, p[1] - H * 0.01]), true);
        g.strokeStyle = css(C[2], 0.6); g.lineWidth = Math.max(1, H * 0.006);
        for (let k = 2; k < pts.length - 1; k += 2) { const a = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]) + Math.PI / 2, p = pts[k]; g.beginPath(); g.moveTo(p[0] + Math.cos(a) * H * 0.022, p[1] + Math.sin(a) * H * 0.022); g.lineTo(p[0] - Math.cos(a) * H * 0.022, p[1] - Math.sin(a) * H * 0.022); g.stroke(); }
      }
    },
    // Electric Hive: honeycomb with glowing cyan cells
    hex(g, W, H, C, R) {
      const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, css(C[0])); bg.addColorStop(1, css(C[2]));
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const r = H * 0.075, hw = r * Math.sqrt(3);
      for (let row = -1; row * r * 1.5 < H + r; row++) for (let col = -1; col * hw < W + hw; col++) {
        const cx = col * hw + (row & 1 ? hw / 2 : 0), cy = row * r * 1.5;
        g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k / 6) * TAU; g[k ? "lineTo" : "moveTo"](cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94); } g.closePath();
        const q = R();
        if (q < 0.16) { g.fillStyle = css(C[1], 0.75); g.fill(); } else if (q < 0.4) { g.fillStyle = css(drk(C[2], 0.3)); g.fill(); }
        g.strokeStyle = css(C[1], 0.9); g.lineWidth = Math.max(1, H * 0.008); g.stroke();
        if (q < 0.16) { g.fillStyle = css(lit(C[1], 0.7)); g.beginPath(); g.arc(cx, cy, r * 0.18, 0, TAU); g.fill(); }
      }
    },
    // Corticera: blue water with branching orange coral
    coral(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const u = x / H, v = y / H, c = Math.abs(Math.sin(N.fbm(u * 3, v * 3, 3) * 18)); setMix(o, C[0], C[2], v * 0.6 + c * 0.25); });
      g.lineCap = "round";
      const br = (x, y, a, w, d) => {
        const len = H * (0.05 + R() * 0.06), nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        g.strokeStyle = css(drk(C[1], 0.35)); g.lineWidth = w * 1.35; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        g.strokeStyle = css(C[1]); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (d <= 0) { g.fillStyle = css(lit(C[1], 0.45)); g.beginPath(); g.arc(nx, ny, w * 0.7, 0, TAU); g.fill(); return; }
        br(nx, ny, a - 0.25 - R() * 0.4, w * 0.8, d - 1);
        br(nx, ny, a + 0.25 + R() * 0.4, w * 0.8, d - 1);
      };
      for (let i = 0; i < 9; i++) br(W * (i + 0.5) / 9 + (R() - 0.5) * W * 0.05, H + 2, -Math.PI / 2 + (R() - 0.5) * 0.4, H * 0.035, 6);
    },
    // Fever Dream: psychedelic warped bands with ink outlines
    fever(g, W, H, C, R, N) {
      const cols = [C[0], C[1], lit(C[0], 0.45), mixC(C[1], C[2], 0.3), lit(C[1], 0.5)];
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, q = N.fbm(u * 1.3, v * 1.3, 3), t = N.fbm(u * 1.1 + q * 2.4, v * 1.1 - q * 1.8, 4) * 9;
        const i = Math.floor(t), f = t - i;
        if (f < 0.07) set(o, C[2]); else set(o, cols[((i % 5) + 5) % 5], 0.85 + f * 0.15);
      });
      for (let i = 0; i < 40; i++) { g.fillStyle = css(WHITE, 0.8); g.beginPath(); g.arc(R() * W, R() * H, H * (0.006 + R() * 0.012), 0, TAU); g.fill(); }
    },
    // BOOM: comic halftone, explosion bursts and the word itself (mirrored copy for the left side)
    comic(g, W, H, C, R) {
      fill(g, W, H, C[0]);
      const ds = H * 0.045;
      g.fillStyle = css(drk(C[0], 0.25), 0.5);
      for (let y = 0; y < H + ds; y += ds) for (let x = 0; x < W + ds; x += ds) { const r = ds * 0.35 * (0.4 + 0.6 * Math.abs(Math.sin(x / W * 6 + y / H * 2))); g.beginPath(); g.arc(x + ((y / ds) & 1) * ds / 2, y, r, 0, TAU); g.fill(); }
      const burst = (cx, cy, s, mirror) => {
        g.strokeStyle = css(C[2], 0.5); g.lineWidth = Math.max(1, H * 0.006);
        for (let k = 0; k < 30; k++) { const a = (k / 30) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.6); g.lineTo(cx + Math.cos(a) * s * 2, cy + Math.sin(a) * s * 1.4); g.stroke(); }
        g.save(); g.translate(cx, cy); g.scale(1.6, 1);
        g.fillStyle = css(C[1]); starPath(g, 0, 0, s * 0.62, s * 0.4, 14, R()); g.fill();
        g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.012); g.stroke();
        g.fillStyle = css(lit(C[0], 0.5)); starPath(g, 0, 0, s * 0.42, s * 0.3, 11, R()); g.fill();
        g.restore();
        g.save(); g.translate(cx, cy); g.rotate(-0.12); if (mirror) g.scale(-1, 1);
        g.font = `900 ${Math.round(s * 0.42)}px Impact, "Arial Black", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.lineJoin = "round"; g.lineWidth = Math.max(2, s * 0.08); g.strokeStyle = css(C[2]); g.strokeText("BOOM!", 0, 0);
        g.fillStyle = css(WHITE); g.fillText("BOOM!", 0, 0); g.restore();
      };
      burst(W * 0.28, H * 0.5, H * 0.45, false);
      burst(W * 0.72, H * 0.48, H * 0.42, true);
      g.fillStyle = css(C[2]);
      for (let i = 0; i < 8; i++) { starPath(g, R() * W, R() * H, H * 0.04, H * 0.016, 4, R()); g.fill(); }
    },
    // Hyper Beast: a teal riot of outlined cartoon shapes, eyes and fangs
    hyperbeast(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => set(o, C[0], 0.7 + N.fbm(x / H * 3, y / H * 3, 3) * 0.5));
      const purple = mixC(C[1], [90, 40, 200], 0.6), cols = [C[1], C[2], purple, lit(C[0], 0.4), C[1]];
      g.lineJoin = "round";
      for (let i = 0; i < 34; i++) {
        const x = R() * W, y = R() * H, r = H * (0.06 + R() * 0.14);
        g.fillStyle = css(cols[i % cols.length]); blobPath(g, x, y, r, R, 0.55); g.fill();
        g.strokeStyle = css(BLACK); g.lineWidth = Math.max(1, H * 0.014); g.stroke();
      }
      for (let m = 0; m < 3; m++) { // fanged jaws
        const x0 = W * (0.12 + m * 0.3 + R() * 0.08), y0 = H * (0.3 + R() * 0.4), n = 9, tw = H * 0.05;
        g.fillStyle = css(BLACK); g.fillRect(x0 - tw * 0.2, y0 - H * 0.03, n * tw + tw * 0.4, H * 0.06);
        for (let k = 0; k < n; k++) {
          for (const s of [-1, 1]) { g.fillStyle = css(WHITE); polyPath(g, [[x0 + k * tw, y0 - s * H * 0.035], [x0 + (k + 1) * tw, y0 - s * H * 0.035], [x0 + (k + 0.5) * tw, y0 + s * H * (0.02 + (k % 3 === 1 ? 0.05 : 0.01))]]); g.fill(); g.strokeStyle = css(BLACK); g.lineWidth = Math.max(1, H * 0.006); g.stroke(); }
        }
      }
      for (let i = 0; i < 7; i++) {
        const x = R() * W, y = R() * H, r = H * (0.035 + R() * 0.035);
        g.fillStyle = css(C[2]); g.beginPath(); g.ellipse(x, y, r * 1.3, r, 0, 0, TAU); g.fill(); g.strokeStyle = css(BLACK); g.lineWidth = Math.max(1, H * 0.01); g.stroke();
        g.fillStyle = css(BLACK); g.beginPath(); g.ellipse(x, y, r * 0.25, r * 0.85, 0, 0, TAU); g.fill();
      }
      g.strokeStyle = css(BLACK); g.lineWidth = Math.max(1, H * 0.008); g.lineCap = "round";
      for (let i = 0; i < 12; i++) strokePts(g, wander(R, N, R() * W, R() * H, R() * TAU, 12, H * 0.03, 3, 70 + i), true);
      for (let i = 0; i < 250; i++) { g.fillStyle = css(cols[i % 3]); g.beginPath(); g.arc(R() * W, R() * H, H * 0.004 * (1 + R() * 3), 0, TAU); g.fill(); }
    },
    // Lightning Strike: stormy violet clouds split by forked bolts
    lightning(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const n = N.fbm(x / H * 1.8, y / H * 1.8, 5); setMix(o, C[0], C[1], Math.pow(n, 2.6) * 1.1); });
      const bolt = (x0, y0, x1, y1, w, depth) => {
        let pts = [[x0, y0], [x1, y1]];
        for (let it = 0; it < 6; it++) {
          const np = [pts[0]];
          for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); np.push([(a[0] + b[0]) / 2 + (R() - 0.5) * l * 0.45, (a[1] + b[1]) / 2 + (R() - 0.5) * l * 0.2]); np.push(b); }
          pts = np;
        }
        g.lineCap = "round"; g.lineJoin = "round";
        g.strokeStyle = css(C[1], 0.25); g.lineWidth = w * 4; strokePts(g, pts);
        g.strokeStyle = css(C[1]); g.lineWidth = w * 1.6; strokePts(g, pts);
        g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, w * 0.6); strokePts(g, pts);
        if (depth > 0) for (let k = 0; k < 3; k++) { const p = pts[Math.floor(R() * pts.length)]; bolt(p[0], p[1], p[0] + (R() - 0.3) * H * 0.8, p[1] + H * (0.2 + R() * 0.4), w * 0.55, depth - 1); }
      };
      for (let i = 0; i < 5; i++) bolt(W * (0.08 + i * 0.21) + (R() - 0.5) * W * 0.05, -2, W * (0.12 + i * 0.21) + (R() - 0.5) * W * 0.1, H + 2, H * 0.012, 1);
    },
    // Neo-Noir: black ink, halftone and a splash of red
    noir(g, W, H, C, R, N) {
      const ds = Math.max(3, H * 0.022);
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, n = N.fbm(u * 2.2, v * 2.2, 4);
        if (n > 0.57) return set(o, C[1]);
        if (n > 0.47) { const fx = (x % ds) / ds - 0.5, fy = (y % ds) / ds - 0.5, r = (n - 0.47) / 0.1 * 0.5; return set(o, fx * fx + fy * fy < r * r ? C[1] : C[0]); }
        set(o, C[0]);
      });
      g.strokeStyle = css(C[1]); g.lineCap = "round";
      for (let i = 0; i < 20; i++) { g.lineWidth = Math.max(1, H * (0.005 + R() * 0.012)); strokePts(g, wander(R, N, R() * W, R() * H, R() * TAU, 18, H * 0.04, 1.8, 30 + i), true); }
      for (let i = 0; i < 4; i++) { // red lips
        const x = R() * W, y = H * (0.25 + R() * 0.5), s = H * (0.08 + R() * 0.05);
        g.fillStyle = css(C[2]); g.beginPath(); g.moveTo(x - s, y);
        g.bezierCurveTo(x - s * 0.6, y - s * 0.7, x - s * 0.1, y - s * 0.5, x, y - s * 0.25); g.bezierCurveTo(x + s * 0.1, y - s * 0.5, x + s * 0.6, y - s * 0.7, x + s, y);
        g.bezierCurveTo(x + s * 0.5, y + s * 0.6, x - s * 0.5, y + s * 0.6, x - s, y); g.fill();
        g.strokeStyle = css(C[1]); g.lineWidth = Math.max(1, H * 0.008); g.stroke(); g.beginPath(); g.moveTo(x - s, y); g.quadraticCurveTo(x, y + s * 0.12, x + s, y); g.stroke();
      }
      for (let i = 0; i < 6; i++) { g.fillStyle = css(C[2]); starPath(g, R() * W, R() * H, H * 0.03, H * 0.012, 4, R()); g.fill(); }
    },
    // Medusa: veined green stone with golden snakes
    medusa(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, n = N.fbm(u * 2, v * 2, 5), vein = Math.abs(Math.sin(u * 3 + n * 12));
        setMix(o, C[2], C[0], n * 1.2 - 0.1); if (vein < 0.06) { o[0] *= 0.55; o[1] *= 0.55; o[2] *= 0.55; }
      });
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 16; i++) {
        const pts = wander(R, N, R() * W, R() * H, R() * TAU, 26, H * 0.032, 3.2, 90 + i * 1.7);
        for (let pass = 0; pass < 2; pass++) for (let k = 1; k < pts.length; k++) {
          const w = H * 0.075 * (1 - k / pts.length * 0.85) * (pass ? 1 : 1.3);
          g.strokeStyle = css(pass ? (k & 1 ? C[1] : lit(C[1], 0.25)) : drk(C[2], 0.5)); g.lineWidth = w;
          g.beginPath(); g.moveTo(pts[k - 1][0], pts[k - 1][1]); g.lineTo(pts[k][0], pts[k][1]); g.stroke();
        }
        g.fillStyle = css(C[1]); g.beginPath(); g.ellipse(pts[0][0], pts[0][1], H * 0.055, H * 0.04, 0, 0, TAU); g.fill();
        g.fillStyle = css(BLACK); g.beginPath(); g.arc(pts[0][0] + H * 0.02, pts[0][1] - H * 0.01, H * 0.009, 0, TAU); g.fill();
      }
    },
    // Dragon Lore: parchment, a green scaled dragon with wings and fire, ornate gold borders
    dragon(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const u = x / H, v = y / H, n = N.fbm(u * 2.5, v * 2.5, 5); setMix(o, lit(C[0], 0.25), drk(C[0], 0.3), n * 1.1 - 0.15); });
      const border = (y0, dir) => {
        g.fillStyle = css(drk(C[0], 0.45)); g.fillRect(0, y0, W, H * 0.07 * dir);
        g.strokeStyle = css(lit(C[0], 0.4)); g.lineWidth = Math.max(1, H * 0.006); g.beginPath();
        for (let x = 0; x <= W; x += H * 0.07) { g.moveTo(x, y0); g.lineTo(x + H * 0.035, y0 + H * 0.07 * dir); g.lineTo(x + H * 0.07, y0); } g.stroke();
        g.fillStyle = css(C[2]); for (let x = H * 0.035; x < W; x += H * 0.07) { g.beginPath(); g.arc(x, y0 + H * 0.025 * dir, H * 0.01, 0, TAU); g.fill(); }
      };
      border(0, 1); border(H, -1);
      const ph = R() * TAU, body = [];
      for (let x = W * 0.04; x <= W * 0.78; x += H * 0.04) body.push([x, H * (0.56 + 0.16 * Math.sin((x / W) * TAU * 1.1 + ph))]);
      const wing = body[Math.floor(body.length * 0.45)];
      for (let k = 0; k < 5; k++) { // bat wing
        const a = -Math.PI * (0.22 + k * 0.13), l = H * (0.62 - k * 0.05), b = -Math.PI * (0.22 + (k + 1) * 0.13);
        g.fillStyle = css(drk(C[1], 0.25), 0.85); g.beginPath(); g.moveTo(wing[0], wing[1]);
        g.lineTo(wing[0] + Math.cos(a) * l * 1.6, wing[1] + Math.sin(a) * l); g.quadraticCurveTo(wing[0] + Math.cos((a + b) / 2) * l * 0.9, wing[1] + Math.sin((a + b) / 2) * l * 0.6, wing[0] + Math.cos(b) * l * 1.5, wing[1] + Math.sin(b) * l * 0.95); g.closePath(); g.fill();
        g.strokeStyle = css(drk(C[1], 0.6)); g.lineWidth = Math.max(1, H * 0.008); g.beginPath(); g.moveTo(wing[0], wing[1]); g.lineTo(wing[0] + Math.cos(a) * l * 1.6, wing[1] + Math.sin(a) * l); g.stroke();
      }
      g.fillStyle = css(C[2]);
      for (let i = 1; i < body.length - 1; i += 2) { const p = body[i], s = H * (0.03 + 0.05 * (i / body.length)); polyPath(g, [[p[0] - s, p[1] - s * 1.6], [p[0] + s, p[1] - s * 1.6], [p[0] + s * 0.2, p[1] - s * 3.6]]); g.fill(); }
      for (const f of [0.25, 0.6]) { // clawed legs
        const p = body[Math.floor(body.length * f)];
        g.strokeStyle = css(drk(C[1], 0.3)); g.lineWidth = H * 0.05; g.lineCap = "round";
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + H * 0.08, p[1] + H * 0.2); g.lineTo(p[0] + H * 0.16, p[1] + H * 0.24); g.stroke();
      }
      g.save(); ribbon(g, body, H * 0.07, H * 0.24); g.clip();
      scaleTexture(g, W, H, R, H * 0.055, drk(C[1], 0.2), drk(C[1], 0.65), lit(C[1], 0.35));
      g.restore();
      ribbon(g, body, H * 0.07, H * 0.24); g.strokeStyle = css(drk(C[1], 0.7)); g.lineWidth = Math.max(1, H * 0.012); g.stroke();
      const hd = body[body.length - 1];
      g.fillStyle = css(C[1]); g.beginPath(); g.ellipse(hd[0] + H * 0.13, hd[1], H * 0.2, H * 0.11, -0.2, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = css(drk(C[1], 0.3)); polyPath(g, [[hd[0] + H * 0.02, hd[1] - H * 0.08], [hd[0] - H * 0.12, hd[1] - H * 0.22], [hd[0] + H * 0.08, hd[1] - H * 0.1]]); g.fill();
      g.fillStyle = css(C[2]); g.beginPath(); g.arc(hd[0] + H * 0.18, hd[1] - H * 0.04, H * 0.028, 0, TAU); g.fill();
      for (let k = 0; k < 9; k++) { // fire breath
        const l = H * (0.45 + R() * 0.5), a = -0.2 + (R() - 0.5) * 0.6, x = hd[0] + H * 0.3, y = hd[1] + H * 0.02;
        const fg = g.createLinearGradient(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l); fg.addColorStop(0, css(lit(C[0], 0.6))); fg.addColorStop(0.35, css(C[2])); fg.addColorStop(1, css(C[2], 0));
        g.fillStyle = fg; g.beginPath(); g.moveTo(x, y - H * 0.02); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 - H * 0.08, x + Math.cos(a) * l, y + Math.sin(a) * l); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 + H * 0.08, x, y + H * 0.02); g.fill();
      }
    },
    // Fade: yellow -> pink -> purple airbrushed over chrome, tang to tip
    fade(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const t = clamp01((x / W) * 1.25 - 0.18 + (0.5 - y / H) * 0.3 + (N.fbm(x / H * 1.2, y / H * 1.2, 3) - 0.5) * 0.12);
        grad3(o, [[0.08, lit(C[0], 0.15)], [0.5, C[1]], [0.92, C[2]]], t);
      });
    },
    // Doppler (Ruby / Sapphire / Emerald): dark galaxy swirls with sparkles
    doppler(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, q = N.fbm(u * 1.2, v * 1.2, 4), r2 = N.fbm(u * 1.6 + q * 3, v * 1.6 + q * 2, 4), t = N.fbm(u * 2 + r2 * 2.5, v * 2 - r2 * 2, 4);
        const swirl = sstep(0.4, 0.68, t), spot = sstep(0.62, 0.7, N.fbm(u * 3 + 9, v * 3, 3));
        setMix(o, C[0], mixC(C[1], C[2], sstep(0.35, 0.7, r2)), swirl, 1 - spot * 0.85);
      });
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 160; i++) {
        const x = R() * W, y = R() * H, s = H * (0.006 + R() * R() * 0.03), a = 0.25 + R() * 0.6;
        const sg = g.createRadialGradient(x, y, 0, x, y, s * 2); sg.addColorStop(0, css(WHITE, a)); sg.addColorStop(1, css(C[2], 0));
        g.fillStyle = sg; g.beginPath(); g.arc(x, y, s * 2, 0, TAU); g.fill();
        if (s > H * 0.015) { g.strokeStyle = css(WHITE, a * 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(x - s * 3, y); g.lineTo(x + s * 3, y); g.moveTo(x, y - s * 3); g.lineTo(x, y + s * 3); g.stroke(); }
      }
      g.globalCompositeOperation = "source-over";
    },
    // Marble Fade: fire-and-ice swirls of red, yellow and blue
    marble(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, q = N.fbm(u * 1.1, v * 1.1, 4), t = Math.sin((u * 1.4 + v * 0.7 + q * 5.2) * Math.PI), s = t * 0.5 + 0.5;
        grad3(o, [[0.05, drk(C[2], 0.15)], [0.3, C[2]], [0.5, C[1]], [0.75, C[0]], [1, drk(C[0], 0.3)]], s);
        if (Math.abs(t) < 0.03) { o[0] *= 0.8; o[1] *= 0.8; o[2] *= 0.8; }
      });
    },
    // Tiger Tooth: gold-orange brushed metal with dark tapered stripes
    tiger(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const u = x / H, v = y / H; setMix(o, C[0], C[2], 0.15 + 0.3 * (1 - v) + (N.n(u * 2, v * 90) - 0.5) * 0.25); });
      for (let x = -H * 0.1; x < W + H * 0.1; x += H * (0.17 + R() * 0.08)) {
        const fromTop = R() < 0.6, len = H * (0.45 + R() * 0.55), w = H * (0.035 + R() * 0.03), lean = (R() - 0.5) * H * 0.3;
        const y0 = fromTop ? -2 : H + 2, dir = fromTop ? 1 : -1, steps = 8, L = [], Rr = [];
        for (let k = 0; k <= steps; k++) {
          const f = k / steps, cx = x + lean * f + Math.sin(f * 7 + x) * H * 0.02, cy = y0 + dir * len * f, ww = w * (1 - f) * (0.7 + 0.5 * Math.sin(f * 9 + x * 0.1));
          L.push([cx - ww, cy]); Rr.push([cx + ww, cy]);
        }
        g.fillStyle = css(C[1], 0.95); polyPath(g, L.concat(Rr.reverse())); g.fill();
      }
      g.strokeStyle = css(lit(C[2], 0.5), 0.25); g.lineWidth = 1;
      for (let i = 0; i < 300; i++) { const y = R() * H, x = R() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + H * (0.2 + R()), y); g.stroke(); }
    },
    // Crimson Web: black spider webs over deep red
    web(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const n = N.fbm(x / H * 2.5, y / H * 2.5, 4); setMix(o, drk(C[0], 0.35), C[0], n * 1.3 - 0.1); });
      g.strokeStyle = css(C[1], 0.95); g.lineCap = "round";
      const webAt = (cx, cy, R0) => {
        const n = 10 + Math.floor(R() * 5), angs = [];
        for (let i = 0; i < n; i++) angs.push((i / n) * TAU + (R() - 0.5) * 0.25);
        g.lineWidth = Math.max(1, H * 0.008);
        for (const a of angs) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0); g.stroke(); }
        g.lineWidth = Math.max(1, H * 0.005);
        for (let r = H * 0.06; r < R0; r += H * (0.055 + R() * 0.02)) {
          g.beginPath();
          for (let i = 0; i < n; i++) {
            const a = angs[i], b = angs[(i + 1) % n] + (i === n - 1 ? TAU : 0), m = (a + b) / 2;
            if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            g.quadraticCurveTo(cx + Math.cos(m) * r * 0.82, cy + Math.sin(m) * r * 0.82, cx + Math.cos(b) * r, cy + Math.sin(b) * r);
          }
          g.stroke();
        }
      };
      webAt(W * 0.22, H * 0.45, H * 1.3); webAt(W * 0.6, H * 0.6, H * 1.2); webAt(W * 0.92, H * 0.3, H * 0.9);
    },
    // Case Hardened: blue, gold and steel heat-treatment patches
    casehardened(g, W, H, C, R, N) {
      const purple = mixC(C[0], [140, 60, 160], 0.5);
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, a = N.fbm(u * 2.2, v * 2.2, 5), b = N.fbm(u * 3 + 11, v * 3 + 3, 4);
        setMix(o, C[2], C[0], sstep(0.48, 0.58, a));
        const gold = sstep(0.54, 0.62, b) * (1 - sstep(0.5, 0.6, a) * 0.6);
        o[0] += (C[1][0] - o[0]) * gold; o[1] += (C[1][1] - o[1]) * gold; o[2] += (C[1][2] - o[2]) * gold;
        const edge = Math.max(0, 1 - Math.abs(a - 0.53) * 25) * 0.5;
        o[0] += (purple[0] - o[0]) * edge; o[1] += (purple[1] - o[1]) * edge; o[2] += (purple[2] - o[2]) * edge;
        const k = 0.9 + N.n(u * 90, v * 90) * 0.2; o[0] *= k; o[1] *= k; o[2] *= k;
      });
    },
    // Slaughter: raw red with pale pink marbled streaks
    slaughter(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, q = N.fbm(u * 1.4, v * 1.4, 4), t = N.fbm(u * 2.2 + q * 3, v * 2.2 + q * 1.6, 5);
        const s = Math.abs(Math.sin(t * 22));
        setMix(o, C[0], C[1], sstep(0.82, 0.97, s) * 0.95);
        const dk = sstep(0.58, 0.68, t) * 0.7; o[0] += (C[2][0] - o[0]) * dk; o[1] += (C[2][1] - o[1]) * dk; o[2] += (C[2][2] - o[2]) * dk;
      });
    },
    // Blaze: gloss black with bright flames licking back from the muzzle end, red -> orange -> yellow
    blaze(g, W, H, C, R, N) {
      field(g, W, H, (x, y, o) => { const n = N.fbm(x / H * 1.5, y / H * 1.5, 3); set(o, C[0], 0.75 + n * 0.45 + (1 - y / H) * 0.15); });
      const red = mixC(C[1], [200, 20, 10], 0.55), tongues = [];
      // each tongue rises from the bottom (more of them toward the front), leans back toward the butt,
      // flickers side to side and narrows to a curled tip
      for (let i = 0; i < 34; i++) {
        const fx = Math.pow(R(), 0.55), x0 = W * (0.22 + 0.82 * fx), y0 = H * (1.05 + R() * 0.1);
        const len = H * (0.55 + R() * 0.75) * (0.55 + 0.6 * fx), steps = 24, pts = [[x0, y0]];
        const lean = 0.55 + R() * 0.5, curl = (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.9), ph = R() * TAU, wig = 0.35 + R() * 0.3;
        for (let k = 1; k <= steps; k++) {
          const f = k / steps, a = -Math.PI / 2 - lean * (0.4 + f * 0.8) + Math.sin(f * 7 + ph) * wig + curl * f * f * f;
          const p = pts[k - 1]; pts.push([p[0] + Math.cos(a) * len / steps, p[1] + Math.sin(a) * len / steps]);
        }
        tongues.push({ pts, w: H * (0.14 + R() * 0.16) * (0.6 + 0.6 * fx) });
      }
      const layers = [[drk(red, 0.2), 1.25, 0.85], [red, 1, 0.95], [C[1], 0.7, 1], [C[2], 0.4, 1], [lit(C[2], 0.65), 0.16, 0.9]];
      for (const [col, k, al] of layers) for (const t of tongues) { g.fillStyle = css(col, al); ribbon(g, t.pts, t.w * k, 0.5); g.fill(); }
      // heat along the bottom of the front half and a few embers
      const hg = g.createLinearGradient(0, H, 0, H * 0.6); hg.addColorStop(0, css(C[2], 0.55)); hg.addColorStop(1, css(C[1], 0));
      g.fillStyle = hg; g.fillRect(W * 0.35, H * 0.6, W * 0.65, H * 0.4);
      for (let i = 0; i < 80; i++) { const x = W * (0.25 + R() * 0.75), y = R() * H * 0.8; g.fillStyle = css(R() < 0.5 ? C[2] : C[1], 0.75); g.beginPath(); g.arc(x, y, H * 0.004 * (1 + R() * 2), 0, TAU); g.fill(); }
    },
    // Printstream: pearlescent white with flowing black printed linework (and the pearl color shift)
    printstream(g, W, H, C, R, N) {
      const pearlA = mixC(C[2], [190, 255, 235], 0.55), pearlB = mixC(C[2], [255, 205, 240], 0.45);
      field(g, W, H, (x, y, o) => {
        const u = x / H, v = y / H, q = N.fbm(u * 0.45, v * 0.6, 3), t = N.fbm(u * 0.3 + q * 1.2, v * 0.9 - q * 0.9, 3);
        // pearl base: white with a soft pastel sheen
        const sh = N.fbm(u * 0.8 + 31, v * 0.8, 3);
        setMix(o, C[0], sh > 0.5 ? pearlA : pearlB, Math.min(1, Math.abs(sh - 0.5) * 2.2) * 0.7);
        // printed stream lines: smooth contours of a stretched, warped field, only where the stream runs
        const z = t * 15, d = Math.abs(frac(z) - 0.5) * 2, mask = sstep(0.42, 0.52, N.fbm(u * 0.35 + 7, v * 0.7 + q, 2));
        const ln = (1 - sstep(0.05, 0.12, d)) * mask;
        // solid black pools in the middle of the densest part of the stream
        const pool = sstep(0.64, 0.66, N.fbm(u * 0.5 + 3, v * 0.9 + q * 0.8, 3)) * mask;
        const k = Math.max(ln, pool);
        if (k > 0) { o[0] += (C[1][0] - o[0]) * k; o[1] += (C[1][1] - o[1]) * k; o[2] += (C[1][2] - o[2]) * k; }
      });
      // a few bold calligraphic swooshes running along the gun
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 4; i++) {
        const pts = wander(R, N, -H * 0.2 + R() * W * 0.3, H * (0.2 + R() * 0.6), (R() - 0.5) * 0.3, 40, W / 34, 1.0, 11 + i * 2.3);
        g.fillStyle = css(C[1]); ribbon(g, pts, H * 0.004, H * (0.035 + R() * 0.03)); g.fill();
        g.strokeStyle = css(C[1]); g.lineWidth = Math.max(1, H * 0.005); strokePts(g, pts.map((p) => [p[0], p[1] + H * 0.05]), true);
      }
    },
    // Golden Koi: polished gold fish scales with koi swimming along the gun among ripples
    koi(g, W, H, C, R, N) {
      fill(g, W, H, C[0]);
      scaleTexture(g, W, H, R, H * 0.075, drk(C[0], 0.12), C[2], lit(C[0], 0.4));
      g.strokeStyle = css(C[1], 0.45); g.lineWidth = Math.max(1, H * 0.005);
      for (let i = 0; i < 10; i++) { // ripples
        const x = R() * W, y = R() * H, r = H * (0.08 + R() * 0.12);
        for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(x, y, r * (1 + k * 0.5), r * (0.45 + k * 0.22), 0, 0, TAU); g.stroke(); }
      }
      const orange = mixC(C[0], [235, 80, 20], 0.65);
      const fish = (cx, cy, L, dir, tilt) => {
        g.save(); g.translate(cx, cy); g.rotate(tilt); g.scale(dir, 1);
        const w = L * 0.22;
        // tail fin (two lobes) and side fins
        g.fillStyle = css(lit(C[1], 0.2), 0.9); g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.008);
        g.beginPath(); g.moveTo(-L * 0.42, 0); g.quadraticCurveTo(-L * 0.62, -w * 1.5, -L * 0.78, -w * 1.35); g.quadraticCurveTo(-L * 0.66, 0, -L * 0.78, w * 1.35); g.quadraticCurveTo(-L * 0.62, w * 1.5, -L * 0.42, 0); g.fill(); g.stroke();
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(L * 0.12, s * w * 0.7); g.quadraticCurveTo(L * 0.02, s * w * 1.9, -L * 0.12, s * w * 1.5); g.quadraticCurveTo(-L * 0.02, s * w * 0.9, L * 0.12, s * w * 0.7); g.fill(); g.stroke(); }
        // body
        g.beginPath(); g.moveTo(L * 0.5, 0); g.bezierCurveTo(L * 0.42, -w * 1.1, -L * 0.15, -w * 1.15, -L * 0.45, 0); g.bezierCurveTo(-L * 0.15, w * 1.15, L * 0.42, w * 1.1, L * 0.5, 0); g.closePath();
        g.fillStyle = css(C[1]); g.fill();
        g.save(); g.clip();
        g.fillStyle = css(orange); // kohaku patches
        for (let k = 0; k < 3; k++) { blobPath(g, L * (0.3 - k * 0.27 + (R() - 0.5) * 0.08), (R() - 0.6) * w * 0.8, w * (0.55 + R() * 0.35), R, 0.4); g.fill(); }
        g.strokeStyle = css(drk(C[0], 0.2), 0.5); g.lineWidth = Math.max(1, H * 0.003); // body scales
        for (let sx = -L * 0.4; sx < L * 0.4; sx += w * 0.32) for (let sy = -w; sy < w; sy += w * 0.32) { g.beginPath(); g.arc(sx, sy + ((sx / (w * 0.32)) & 1) * w * 0.16, w * 0.17, -Math.PI / 2, Math.PI / 2); g.stroke(); }
        g.restore();
        g.strokeStyle = css(C[2]); g.lineWidth = Math.max(1, H * 0.009); g.stroke();
        g.fillStyle = css(C[2]); g.beginPath(); g.arc(L * 0.34, -w * 0.3, w * 0.13, 0, TAU); g.fill(); // eye
        g.strokeStyle = css(C[2], 0.8); g.lineWidth = Math.max(1, H * 0.005); g.beginPath(); g.moveTo(L * 0.48, w * 0.12); g.quadraticCurveTo(L * 0.6, w * 0.4, L * 0.66, w * 0.25); g.stroke(); // barbel
        g.restore();
      };
      fish(W * 0.24, H * 0.42, H * 0.95, 1, -0.08);
      fish(W * 0.62, H * 0.58, H * 0.85, -1, 0.1);
      fish(W * 0.9, H * 0.36, H * 0.7, 1, 0.05);
      g.globalCompositeOperation = "lighter"; // polished gold glints
      for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * H, s = H * (0.01 + R() * 0.02), sg = g.createRadialGradient(x, y, 0, x, y, s * 2); sg.addColorStop(0, css(WHITE, 0.5)); sg.addColorStop(1, css(C[1], 0)); g.fillStyle = sg; g.beginPath(); g.arc(x, y, s * 2, 0, TAU); g.fill(); }
      g.globalCompositeOperation = "source-over";
    },
    // Ocean Drive: Miami-vice sunset: pink -> yellow sky, a striped retro sun, teal sea, palm silhouettes, neon stripes
    oceandrive(g, W, H, C, R, N) {
      const hz = H * 0.58, navy = [40, 22, 70];
      const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, css(mixC(C[1], navy, 0.35))); sky.addColorStop(0.55, css(C[1])); sky.addColorStop(1, css(C[2]));
      g.fillStyle = sky; g.fillRect(0, 0, W, hz);
      // the sun: a disc with horizontal cut-outs toward the horizon
      const sx = W * 0.58, sr = H * 0.42;
      g.save(); g.beginPath(); g.rect(0, 0, W, hz); g.clip();
      const sg = g.createLinearGradient(0, hz - sr, 0, hz); sg.addColorStop(0, css(C[2])); sg.addColorStop(1, css(lit(C[1], 0.15)));
      g.fillStyle = sg; g.beginPath(); g.arc(sx, hz, sr, 0, TAU); g.fill();
      g.fillStyle = css(C[1]);
      for (let k = 0; k < 5; k++) { const yy = hz - sr * (0.08 + k * 0.13), hh = sr * (0.035 + (4 - k) * 0.012); g.fillRect(sx - sr, yy, sr * 2, hh); }
      g.restore();
      // the sea: teal, darker toward the bottom, with light streaks and the sun's reflection
      const sea = g.createLinearGradient(0, hz, 0, H); sea.addColorStop(0, css(lit(C[0], 0.2))); sea.addColorStop(1, css(drk(C[0], 0.45)));
      g.fillStyle = sea; g.fillRect(0, hz, W, H - hz);
      for (let i = 0; i < 60; i++) {
        const y = hz + Math.pow(R(), 1.6) * (H - hz), w = H * (0.05 + R() * 0.3), x = R() * W, near = Math.abs(x - sx) < sr * 0.9;
        g.fillStyle = css(near ? C[2] : lit(C[0], 0.6), near ? 0.8 : 0.5); g.fillRect(x, y, w, Math.max(1, H * 0.008));
      }
      // neon diagonal stripes (80s), behind the palms
      for (let i = 0; i < 4; i++) { const x = W * (0.05 + i * 0.07); g.fillStyle = css(i % 2 ? C[0] : WHITE, 0.85); polyPath(g, [[x, H], [x + H * 0.06, H], [x + H * 0.66, 0], [x + H * 0.6, 0]]); g.fill(); }
      // palm trees: curved trunks with drooping fronds, in a deep violet silhouette
      const palm = (x, lean, h) => {
        const top = [x + lean * h, H - h], col = css(navy);
        g.strokeStyle = col; g.lineCap = "round"; g.lineWidth = H * 0.045;
        g.beginPath(); g.moveTo(x, H + 2); g.quadraticCurveTo(x + lean * h * 0.2, H - h * 0.5, top[0], top[1]); g.stroke();
        g.fillStyle = col;
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + (k - 3) * 0.5 + (R() - 0.5) * 0.2, L = h * (0.38 + R() * 0.18), dx = Math.cos(a) * L, dy = Math.sin(a) * L * 0.5;
          g.beginPath(); g.moveTo(top[0], top[1]);
          g.quadraticCurveTo(top[0] + dx * 0.6, top[1] + dy - L * 0.25, top[0] + dx, top[1] + dy + L * 0.35);
          g.quadraticCurveTo(top[0] + dx * 0.5, top[1] + dy * 0.4 - L * 0.08, top[0], top[1] + H * 0.02); g.fill();
        }
        g.beginPath(); g.arc(top[0], top[1] + H * 0.02, H * 0.03, 0, TAU); g.fill();
      };
      palm(W * 0.08, 0.35, H * 0.95); palm(W * 0.2, -0.2, H * 0.7); palm(W * 0.86, -0.3, H * 1.0); palm(W * 0.95, 0.15, H * 0.7);
      // a few teal tropical leaves in the corners
      for (let i = 0; i < 6; i++) {
        const x = i < 3 ? R() * W * 0.12 : W - R() * W * 0.12, y = R() < 0.5 ? H * R() * 0.3 : H * (0.7 + R() * 0.3), L = H * (0.35 + R() * 0.25), a = R() * TAU;
        g.save(); g.translate(x, y); g.rotate(a);
        g.fillStyle = css(C[0]); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.5, -L * 0.3, L, 0); g.quadraticCurveTo(L * 0.5, L * 0.3, 0, 0); g.fill();
        g.strokeStyle = css(drk(C[0], 0.4)); g.lineWidth = Math.max(1, H * 0.006); g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.95, 0); g.stroke();
        g.restore();
      }
    },
  };

  // Rarity finish: blue stays muted and a bit worn, higher tiers get punchier color and contrast,
  // gold gets polished light streaks (the material adds the metal + color shift on top)
  const FINISH = {
    blue: { sat: 0.72, con: 0.9 }, purple: { sat: 1.05, con: 1.0 }, pink: { sat: 1.18, con: 1.07 },
    red: { sat: 1.24, con: 1.1 }, gold: { sat: 1.15, con: 1.1 },
  };
  function finish(g, W, H, sk, R, N) {
    const f = FINISH[sk.tier] || FINISH.purple, img = g.getImageData(0, 0, W, H), d = img.data, wear = sk.tier === "blue";
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      let r = d[i], gg = d[i + 1], b = d[i + 2];
      const L = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = L + (r - L) * f.sat; gg = L + (gg - L) * f.sat; b = L + (b - L) * f.sat;
      r = (r - 128) * f.con + 128; gg = (gg - 128) * f.con + 128; b = (b - 128) * f.con + 128;
      let k = 1 + (R() - 0.5) * 0.05;
      if (wear) { const w = N.fbm(x / H * 7 + 50, y / H * 7, 3); if (w > 0.62) k *= 0.82 + (1 - w) * 0.4; }
      d[i] = r * k; d[i + 1] = gg * k; d[i + 2] = b * k;
    }
    g.putImageData(img, 0, 0);
    if (wear) { // scuffs
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
      for (let i = 0; i < 70; i++) { const x = R() * W, y = R() * H, a = R() * TAU, l = H * (0.02 + R() * 0.1); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    }
    if (sk.tier === "gold") {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const x = W * (0.1 + i * 0.26 + R() * 0.05), gr = g.createLinearGradient(x, 0, x + H * 0.6, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,0.13)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; polyPath(g, [[x, 0], [x + H * 0.6, 0], [x + H * 0.2, H], [x - H * 0.4, H]]); g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }
  }

  // Glow mask for fx.glow skins: the pixels close to the pattern's glowing colors, in their own color
  const GLOW_COLS = { asiimov: [1], dragon: [2], lotus: [1, 2], doppler: [1, 2, "w"], lightning: [1, 2, "w"], hex: [1], circuit: [1, 2], neon: [1, 2], hyperbeast: [1, 2],
    blaze: [1, 2], koi: [1], oceandrive: [1, 2] };
  function glowMask(src, sk, W, H) {
    const cols = (GLOW_COLS[sk.pattern] || [1, 2]).map((i) => (i === "w" ? WHITE : hexRGB(sk.c[i])));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), s = src.getContext("2d").getImageData(0, 0, W, H).data, img = g.createImageData(W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let m = 0;
      for (const q of cols) {
        const dr = (s[i] - q[0]) / 255, dg = (s[i + 1] - q[1]) / 255, db = (s[i + 2] - q[2]) / 255;
        m = Math.max(m, 1 - Math.sqrt(dr * dr + dg * dg + db * db) / 0.38);
      }
      m = m > 0 ? Math.pow(m, 1.4) : 0;
      d[i] = s[i] * m; d[i + 1] = s[i + 1] * m; d[i + 2] = s[i + 2] * m; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // PBSkins.drawPattern(skin | skinId, w, h) -> { color: HTMLCanvasElement, glow: HTMLCanvasElement | null }
  function drawPattern(skin, w, h) {
    if (typeof skin === "string") skin = BY_ID[skin];
    w = Math.max(8, Math.round(w || 1024)); h = Math.max(8, Math.round(h || 256));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!skin) return { color: c, glow: null };
    const R = mkRng(hashStr(skin.id)), N = mkNoise(R), C = skin.c.map(hexRGB);
    (PATTERNS[skin.pattern] || PATTERNS.solid)(g, w, h, C, R, N, skin);
    finish(g, w, h, skin, R, N);
    return { color: c, glow: skin.fx && skin.fx.glow ? glowMask(c, skin, w, h) : null };
  }
  Object.assign(PBSkins, { PATTERNS, drawPattern });
})(typeof window !== "undefined" ? window : globalThis);
