/*
 * paintball/pb-crates.js
 * Crates, credits and your skin locker, CS style.
 *
 *   Credits (🎨) are earned by playing (see EARN) and spent on Splat Cases.
 *   A case rolls a skin with CS's odds (PBSkins.roll). 10 of the same skin
 *   trade up into a random skin of the next tier (PBSkins.tradeUp).
 *   Everything is kept in localStorage under "mii-hub-paintball-locker".
 *
 * Use:
 *   PBCrates.open(parentEl, { onClose, audio, tab })   the full-screen crate/locker screen
 *   PBCrates.credits() / addCredits(n, reason, opts) / spend(n)
 *   PBCrates.items() / count(id) / equipped() / equip(weapon, skinId|null) / equippedSkin(weapon)
 *   PBCrates.buyCrate() / tradeUp(skinId) / onChange(fn) / creditsBadge()
 *
 * Classic script, exposes window.PBCrates. Needs PBSkins (pb-skins.js); uses
 * PBSkins.preview(id, w, h) for pictures when it exists, else draws its own.
 */
(function (root) {
  "use strict";

  const KEY = "mii-hub-paintball-locker";
  const START_CREDITS = 200;
  // what playing earns you (a case is 100: about one case every match or two)
  const EARN = { kill: 5, headshot: 2, roundWin: 5, matchPlayed: 20, matchWin: 40 };
  const WEAPONS = ["ak", "awp", "deagle", "knife"];
  const ICON = { ak: "🔫", awp: "🎯", knife: "🔪" };
  const CREDIT = "🎨";
  const SOUNDS = ["crateTick", "crateOpen", "reveal_blue", "reveal_purple", "reveal_pink", "reveal_red", "reveal_gold", "tradeUp", "uiClick"];

  const S = () => root.PBSkins;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------
  function fresh() {
    return { v: 1, credits: START_CREDITS, items: {}, equipped: { ak: null, awp: null, deagle: null, knife: null },
      stats: { opened: 0, tradeUps: 0, earned: 0, spent: 0, best: null, history: [] } };
  }
  function normalize(d) {
    const f = fresh();
    if (!d || typeof d !== "object") return f;
    f.credits = Number.isFinite(d.credits) ? Math.max(0, Math.round(d.credits)) : START_CREDITS;
    if (d.items && typeof d.items === "object") {
      for (const id in d.items) { const n = Math.floor(d.items[id]); if (n > 0) f.items[id] = n; }
    }
    if (d.equipped) for (const w of WEAPONS) f.equipped[w] = typeof d.equipped[w] === "string" ? d.equipped[w] : null;
    if (d.stats && typeof d.stats === "object") Object.assign(f.stats, d.stats);
    if (!Array.isArray(f.stats.history)) f.stats.history = [];
    return f;
  }
  let mem = null;
  function load() {
    try {
      const raw = root.localStorage.getItem(KEY);
      if (raw) mem = normalize(JSON.parse(raw));
    } catch (e) { /* private window or bad JSON: keep what we have */ }
    if (!mem) mem = fresh();
    return mem;
  }
  function save(d, change) {
    mem = d;
    try { root.localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* keep it in memory */ }
    emit(change || {});
  }

  const subs = new Set();
  function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  function emit(change) {
    for (const fn of Array.from(subs)) { try { fn(change, api); } catch (e) { if (root.console) console.error(e); } }
  }

  function credits() { return load().credits; }
  function addCredits(n, reason, opts) {
    n = Math.round(Number(n) || 0);
    const d = load();
    if (!n) return d.credits;
    d.credits = Math.max(0, d.credits + n);
    if (n > 0) d.stats.earned = (d.stats.earned || 0) + n;
    save(d, { type: "credits", delta: n, reason: reason || "" });
    if (opts && opts.toast) toast(opts.toast, (n > 0 ? "+" : "") + n + " " + CREDIT + (reason ? "  " + reason : ""));
    return d.credits;
  }
  function spend(n) {
    const d = load();
    if (d.credits < n) return false;
    d.credits -= n;
    d.stats.spent = (d.stats.spent || 0) + n;
    save(d, { type: "credits", delta: -n, reason: "spent" });
    return true;
  }
  function items() { return Object.assign({}, load().items); }
  function count(id) { return load().items[id] || 0; }
  function equipped() { return Object.assign({}, load().equipped); }
  function equippedSkin(weapon) {
    const id = load().equipped[weapon];
    return (id && S() && S().BY_ID[id]) || null;
  }
  function equip(weapon, skinId) {
    if (WEAPONS.indexOf(weapon) < 0) return false;
    const d = load();
    if (skinId) {
      const s = S() && S().BY_ID[skinId];
      if (!s || s.weapon !== weapon || !(d.items[skinId] > 0)) return false;
    }
    d.equipped[weapon] = skinId || null;
    save(d, { type: "equip", weapon, skinId: skinId || null });
    return true;
  }
  function give(d, skin, src) {
    d.items[skin.id] = (d.items[skin.id] || 0) + 1;
    const best = d.stats.best && S().TIER[d.stats.best];
    if (!best || S().TIER[skin.tier].rank > best.rank) d.stats.best = skin.tier;
    d.stats.history.unshift({ id: skin.id, src, t: Date.now() });
    d.stats.history.length = Math.min(d.stats.history.length, 30);
  }
  // Buy and open a case: the item is yours straight away (the reel is just the show)
  function buyCrate(rand) {
    const P = S();
    if (!P) return null;
    const d = load();
    if (d.credits < P.CRATE.price) return null;
    const skin = P.roll(rand);
    d.credits -= P.CRATE.price;
    d.stats.spent = (d.stats.spent || 0) + P.CRATE.price;
    d.stats.opened = (d.stats.opened || 0) + 1;
    give(d, skin, "crate");
    save(d, { type: "crate", skin, delta: -P.CRATE.price });
    return skin;
  }
  function tradeUp(skinId, rand) {
    const P = S();
    const d = load();
    const s = P && P.BY_ID[skinId];
    if (!s || s.tier === "gold" || (d.items[skinId] || 0) < P.TRADE_UP_COUNT) return null;
    const got = P.tradeUp(skinId, rand);
    if (!got) return null;
    d.items[skinId] -= P.TRADE_UP_COUNT;
    if (d.items[skinId] <= 0) {
      delete d.items[skinId];
      if (d.equipped[s.weapon] === skinId) d.equipped[s.weapon] = null;
    }
    d.stats.tradeUps = (d.stats.tradeUps || 0) + 1;
    give(d, got, "tradeup");
    save(d, { type: "tradeup", from: s, skin: got });
    return got;
  }

  // ---------------------------------------------------------------------
  // Pictures: PBSkins.preview when it's there, else a drawn silhouette
  // ---------------------------------------------------------------------
  const SIL = {
    ak: [
      [[2, 15], [24, 12], [26, 20], [7, 29], [2, 27]],
      [[24, 10], [66, 10], [66, 19.5], [24, 20.5]],
      [[66, 11], [83, 11], [83, 17.5], [66, 18.5]],
      [[83, 13], [98, 13], [98, 15.6], [83, 15.6]],
      [[92.5, 9.5], [94.5, 9.5], [94.5, 13], [92.5, 13]],
      [[44, 19], [52, 19], [57, 34], [49, 36.5]],
      [[30, 19.5], [36.5, 19.5], [34, 31], [27.5, 30.5]],
    ],
    awp: [
      [[2, 15], [22, 13.5], [24, 22], [11, 29], [2, 28]],
      [[22, 13], [61, 13], [61, 20], [22, 21]],
      [[61, 14.6], [99, 14.6], [99, 17.2], [61, 18]],
      [[31, 6.5], [56, 6.5], [56, 11], [31, 11]],
      [[26, 4.8], [32, 5.8], [32, 11.6], [26, 12.4]],
      [[55, 5.8], [62, 4.2], [62, 13], [55, 11.6]],
      [[40, 20], [47.5, 20], [47.5, 27.5], [40, 27.5]],
      [[26, 20.5], [32.5, 20.5], [30, 31], [23.5, 30.5]],
    ],
    knife: [
      [[44, 15.5], [86, 13.5], [98, 18.2], [88, 22.5], [44, 22.5]],
      [[5, 14.5], [44, 15], [44, 18.6], [5, 18.6]],
      [[5, 19.4], [44, 19.4], [44, 23], [5, 23.5]],
      [[41, 13.8], [45, 13.8], [45, 24.2], [41, 24.2]],
    ],
  };
  function hashOf(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seeded(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function drawFallback(skin, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    if (!g) return cv;
    const k = Math.min(w / 104, h / 42), ox = (w - 100 * k) / 2, oy = (h - 40 * k) / 2 + (skin.weapon === "knife" ? 0 : 1 * k);
    const shape = () => {
      g.beginPath();
      for (const poly of SIL[skin.weapon] || SIL.ak) {
        poly.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, ox + x * k, oy + y * k));
        g.closePath();
      }
    };
    const c = skin.c || ["#888", "#555", "#222"];
    // shadow / glow
    g.save();
    shape();
    g.shadowColor = skin.fx && skin.fx.glow ? c[1] : "rgba(0,0,0,.6)";
    g.shadowBlur = (skin.fx && skin.fx.glow ? 10 : 6) * k / 3;
    g.shadowOffsetY = skin.fx && skin.fx.glow ? 0 : k * 0.8;
    g.fillStyle = c[0];
    g.fill("nonzero");
    g.restore();
    // the finish
    g.save();
    shape();
    g.clip("nonzero");
    const lg = g.createLinearGradient(ox, oy, ox + 100 * k, oy + 40 * k);
    lg.addColorStop(0, c[0]); lg.addColorStop(0.55, c[1] || c[0]); lg.addColorStop(1, c[2] || c[0]);
    g.fillStyle = skin.fx && skin.fx.shift ? lg : c[0];
    g.fillRect(0, 0, w, h);
    const r = seeded(hashOf(skin.id));
    const pat = skin.pattern;
    g.globalAlpha = 0.85;
    if (pat === "solid") {
      // nothing: the base color, with a sheen below
    } else if (/redline|lightning|asiimov|circuit|neon|vulcan|noir|bloodsport/.test(pat)) {
      for (let i = 0; i < 7; i++) {
        g.fillStyle = c[1 + (i % 2)];
        const y = oy + (8 + r() * 26) * k;
        g.fillRect(ox + r() * 50 * k, y, (20 + r() * 50) * k, (0.8 + r() * 2.2) * k);
      }
      if (pat === "asiimov" || pat === "vulcan" || pat === "bloodsport") {
        g.fillStyle = c[1]; g.beginPath();
        g.moveTo(ox + 45 * k, oy + 8 * k); g.lineTo(ox + 75 * k, oy + 8 * k); g.lineTo(ox + 62 * k, oy + 22 * k); g.lineTo(ox + 40 * k, oy + 22 * k); g.fill();
      }
    } else if (/fade|doppler|marble|fever|misty/.test(pat)) {
      for (let i = 0; i < 18; i++) {
        const rg = g.createRadialGradient(ox + r() * 100 * k, oy + r() * 40 * k, 0, ox + r() * 100 * k, oy + r() * 40 * k, (6 + r() * 16) * k);
        rg.addColorStop(0, c[1 + (i % 2)]); rg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
      }
    } else if (/tiger|jaguar|web|scales|hex|dragon|serpent|medusa|lotus|coral|veins|worms/.test(pat)) {
      g.strokeStyle = c[1]; g.lineWidth = Math.max(1, k * 1.2); g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = c[1 + (i % 2)];
        g.beginPath();
        const x = ox + r() * 100 * k, y = oy + r() * 40 * k;
        g.moveTo(x, y);
        g.quadraticCurveTo(x + (r() - 0.5) * 18 * k, y + (r() - 0.5) * 18 * k, x + (r() - 0.5) * 22 * k, y + (r() - 0.5) * 14 * k);
        g.stroke();
      }
    } else {
      // camo-ish blobs / blocks
      for (let i = 0; i < 40; i++) {
        g.fillStyle = c[1 + (i % 2)] || c[0];
        const x = ox + r() * 100 * k, y = oy + r() * 40 * k, s = (1.5 + r() * 5) * k;
        if (/blocks|ddpat|laminate|graffiti|comic/.test(pat)) g.fillRect(x, y, s * 1.6, s);
        else { g.beginPath(); g.ellipse(x, y, s * 1.4, s, r() * 3, 0, 7); g.fill(); }
      }
    }
    g.globalAlpha = 1;
    // sheen + shade
    const sh = g.createLinearGradient(0, oy, 0, oy + 40 * k);
    sh.addColorStop(0, skin.fx && skin.fx.metal ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.22)");
    sh.addColorStop(0.35, "rgba(255,255,255,0)");
    sh.addColorStop(1, "rgba(0,0,0,.35)");
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
    g.restore();
    shape();
    g.lineWidth = Math.max(1, k * 0.45);
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.stroke();
    return cv;
  }

  const picCache = {};
  function pic(skin, w, h) {
    const key = skin.id + "|" + w + "|" + h;
    let e = picCache[key];
    const P = S();
    if (!e || (e.fallback && P && typeof P.preview === "function" && !e.tried)) {
      let src = null, fallback = false, tried = false;
      if (P && typeof P.preview === "function") {
        tried = true;
        try { src = P.preview(skin.id, w, h); } catch (err) { src = null; }
        if (!src || !(src.width > 0) || typeof src.getContext !== "function" && !(src instanceof root.HTMLImageElement)) src = null;
      }
      if (!src) { src = drawFallback(skin, w, h); fallback = true; }
      e = picCache[key] = { src, fallback, tried };
    }
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    try { cv.getContext("2d").drawImage(e.src, 0, 0, w, h); } catch (err) { /* empty picture is fine */ }
    return cv;
  }

  // ---------------------------------------------------------------------
  // Sounds: the game's own audio object if it's handed to us, else our own
  // ---------------------------------------------------------------------
  let ownAudio = null;
  function getAudio(given) {
    if (given && typeof given.play === "function") return given;
    if (!ownAudio && root.PBAudio && root.PBAudio.create) {
      try {
        ownAudio = root.PBAudio.create({ only: SOUNDS });
        let vol = 0.7;
        try { const st = JSON.parse(root.localStorage.getItem("mii-hub-paintball") || "{}"); if (Number.isFinite(st.volume)) vol = st.volume; } catch (e) { /* default */ }
        ownAudio.setVolume(vol);
      } catch (e) { ownAudio = null; }
    }
    return ownAudio || { play() {}, resume() {} };
  }

  // ---------------------------------------------------------------------
  // Look
  // ---------------------------------------------------------------------
  function addCSS() {
    if (document.getElementById("pbc-style")) return;
    const css = `
.pbc-wallet{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(#2a2f38,#1b1f26);border:1px solid #ffffff22;border-radius:999px;padding:6px 14px 6px 10px;font-weight:900;font-variant-numeric:tabular-nums;color:#ffd96b;white-space:nowrap}
.pbc-wallet i{font-style:normal}
.pbc-wallet small{color:#fff;opacity:.55;font-weight:700;font-size:11px;letter-spacing:.5px;text-transform:uppercase}
.pbc-wallet.bump{animation:pbcBump .45s ease}
@keyframes pbcBump{40%{transform:scale(1.15);color:#fff}}
.pb-tab.pbc-tab{background:linear-gradient(#ffb21e33,#ff8c1a22);opacity:.95}
.pb-tab.pbc-tab:hover{background:#ffb21e;color:#2a1600}
.pbc{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;color:#e9edf2;background:
  radial-gradient(ellipse 80% 60% at 50% 0%,#24303f 0%,#11151b 60%,#0a0c10 100%);animation:pbcIn .22s ease-out}
.pbc::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.35;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:40px 40px}
@keyframes pbcIn{from{opacity:0;transform:scale(1.015)}}
.pbc-head{position:relative;display:flex;align-items:center;gap:18px;padding:16px 26px;background:linear-gradient(#0a0d12ee,#0a0d1288);border-bottom:1px solid #ffffff14}
.pbc-head h1{margin:0;font-size:22px;font-weight:900;letter-spacing:2px;white-space:nowrap}
.pbc-head h1 span{color:#ffb21e}
.pbc-tabs{display:flex;gap:4px;background:#ffffff0d;padding:4px;border-radius:10px}
.pbc-tabs button{background:none;border:0;color:#fff;opacity:.6;padding:8px 18px;border-radius:7px;font-weight:800;letter-spacing:.5px}
.pbc-tabs button.on{background:#ffffff1c;opacity:1;box-shadow:inset 0 -2px 0 #ffb21e}
.pbc-tabs.locked{opacity:.4;pointer-events:none}
.pbc-sp{flex:1}
.pbc-close{background:#ffffff12;border:1px solid #ffffff22;color:#fff;border-radius:9px;width:38px;height:38px;font-size:18px;font-weight:900}
.pbc-close:hover{background:#eb4b4b}
.pbc-body{position:relative;flex:1;min-height:0}
.pbc-scroll{position:absolute;inset:0;overflow:auto;padding:22px 26px 40px}
.pbc-wrap{max-width:1180px;margin:0 auto}
.pbc h2{font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.6;margin:26px 0 10px;font-weight:900}
.pbc-btn{background:#ffffff14;border:1px solid #ffffff2a;color:#fff;border-radius:9px;padding:10px 18px;font-weight:800}
.pbc-btn:hover:not(:disabled){background:#ffffff26}
.pbc-btn:disabled{opacity:.4;cursor:default}
.pbc-btn.gold{background:linear-gradient(#ffc23a,#ff8c1a);color:#2a1600;border:0;box-shadow:0 4px 0 #b35a00;font-weight:900;letter-spacing:.5px}
.pbc-btn.gold:hover:not(:disabled){filter:brightness(1.08)}
.pbc-btn.gold:active:not(:disabled){transform:translateY(2px);box-shadow:0 2px 0 #b35a00}
.pbc-btn.green{background:linear-gradient(#5fd35f,#2f9e44);border:0;color:#062a0e;box-shadow:0 4px 0 #1c6b2b;font-weight:900}
/* the case */
.pbc-stage{position:relative;display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:26px;align-items:center;background:linear-gradient(#ffffff0a,#ffffff04);border:1px solid #ffffff12;border-radius:16px;padding:22px;min-height:250px;overflow:hidden}
.pbc-case{position:relative;height:200px;display:flex;align-items:center;justify-content:center;perspective:600px}
.pbc-box{position:relative;width:250px;height:150px;border-radius:14px;transform:rotateX(8deg) rotateY(-14deg);background:
  linear-gradient(135deg,transparent 0 18%,#ff3fb4 18% 26%,transparent 26% 52%,#2df5c4 52% 58%,transparent 58% 80%,#ffd23f 80% 86%,transparent 86%),
  linear-gradient(#3a4250,#1c2028);box-shadow:0 18px 40px #000a,inset 0 2px 0 #ffffff30,inset 0 -6px 0 #0006;border:2px solid #0008;animation:pbcFloat 3.2s ease-in-out infinite}
.pbc-box::before{content:"";position:absolute;left:0;right:0;top:44%;height:7px;background:linear-gradient(#11141a,#2b313b);box-shadow:0 1px 0 #ffffff1c}
.pbc-box::after{content:"SPLAT CASE";position:absolute;left:50%;top:22%;transform:translateX(-50%);font-weight:900;letter-spacing:3px;font-size:15px;color:#fff;text-shadow:0 2px 0 #000a;white-space:nowrap}
.pbc-box b{position:absolute;top:calc(44% - 9px);width:26px;height:24px;border-radius:5px;background:linear-gradient(#ffd56b,#c98a14);box-shadow:0 2px 0 #0008}
.pbc-box b:nth-child(1){left:38px}.pbc-box b:nth-child(2){right:38px}
.pbc-box i{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);font-style:normal;font-size:30px;filter:drop-shadow(0 3px 0 #0008)}
@keyframes pbcFloat{50%{transform:rotateX(8deg) rotateY(-14deg) translateY(-8px)}}
.pbc-case.opening .pbc-box{animation:pbcUnlock .55s ease-in forwards}
@keyframes pbcUnlock{30%{transform:rotateX(8deg) rotateY(-14deg) scale(1.06) rotate(-2deg)}60%{transform:rotateX(8deg) rotateY(-14deg) scale(1.08) rotate(2deg)}100%{transform:rotateX(70deg) scale(.6);opacity:0}}
.pbc-info h3{margin:0;font-size:30px;font-weight:900;letter-spacing:1px}
.pbc-info p{margin:6px 0 16px;opacity:.7}
.pbc-price{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.pbc-price .pbc-btn.gold{font-size:19px;padding:14px 28px}
.pbc-need{font-size:13px;color:#ff9b8a;font-weight:700}
.pbc-earn{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;font-size:12px}
.pbc-earn span{background:#ffffff0d;border:1px solid #ffffff12;border-radius:6px;padding:4px 8px;opacity:.85}
.pbc-earn span b{color:#ffd96b}
.pbc-odds{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.pbc-odds span{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;background:#ffffff0a;border-radius:6px;padding:4px 10px 4px 6px}
.pbc-odds span i{width:10px;height:10px;border-radius:2px;background:var(--tc);box-shadow:0 0 8px var(--tc)}
.pbc-odds span em{font-style:normal;opacity:.6;font-weight:700}
/* item cards */
.pbc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.pbc-card{position:relative;display:flex;flex-direction:column;border-radius:6px;overflow:hidden;background:
  radial-gradient(ellipse 90% 60% at 50% 100%,var(--tg),transparent 70%),linear-gradient(#2c323c,#1b1f26);
  border:1px solid #ffffff12;border-bottom:4px solid var(--tc);text-align:left;color:#fff;padding:0}
.pbc-card .pic{display:flex;align-items:center;justify-content:center;height:84px;padding:6px 8px 0}
.pbc-card .pic canvas{width:100%;height:100%;object-fit:contain}
.pbc-card .meta{padding:6px 9px 8px;line-height:1.15;min-width:0}
.pbc-card .meta span{display:block;font-size:11px;opacity:.6;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbc-card .meta b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbc-card.mystery{background:radial-gradient(ellipse at 50% 40%,#ffe08a55,transparent 65%),linear-gradient(#5a4310,#2a1e06);border-color:#e4ae3966}
.pbc-card.mystery .pic{font-size:52px;color:#ffd24a;text-shadow:0 0 18px #ffb21eaa,0 3px 0 #6b4a00;font-weight:900}
.pbc-card.mystery .meta b{color:#ffd96b}
/* reel */
.pbc-reel{position:relative;grid-column:1/-1;height:200px;overflow:hidden;border-radius:10px;background:#07090c;border:1px solid #ffffff14;box-shadow:inset 0 0 40px #000}
.pbc-strip{position:absolute;left:0;top:18px;display:flex;gap:6px;will-change:transform}
.pbc-strip .pbc-card{flex:0 0 150px;height:162px}
.pbc-strip .pbc-card .pic{height:100px}
.pbc-reel::before,.pbc-reel::after{content:"";position:absolute;top:0;bottom:0;width:18%;z-index:2;pointer-events:none}
.pbc-reel::before{left:0;background:linear-gradient(90deg,#07090c,transparent)}
.pbc-reel::after{right:0;background:linear-gradient(-90deg,#07090c,transparent)}
.pbc-marker{position:absolute;left:50%;top:0;bottom:0;width:3px;margin-left:-1.5px;background:#ffcc33;z-index:3;box-shadow:0 0 12px #ffcc33,0 0 2px #fff}
.pbc-marker::before,.pbc-marker::after{content:"";position:absolute;left:-7px;border:8px solid transparent}
.pbc-marker::before{top:0;border-top-color:#ffcc33}
.pbc-marker::after{bottom:0;border-bottom-color:#ffcc33}
.pbc-strip .pbc-card.win{animation:pbcWin .8s ease-out forwards}
@keyframes pbcWin{to{box-shadow:0 0 0 2px var(--tc),0 0 30px var(--tc);transform:scale(1.04)}}
.pbc-spinlbl{grid-column:1/-1;text-align:center;font-weight:900;letter-spacing:3px;opacity:.55;font-size:12px;margin-top:-10px}
/* reveal */
.pbc-reveal{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#05070acc;backdrop-filter:blur(4px);animation:pbcIn .25s ease-out}
.pbc-rv{position:relative;width:min(640px,92vw);text-align:center;padding:26px 26px 22px;border-radius:16px;background:linear-gradient(#1d222b,#11141a);border:1px solid #ffffff1a;box-shadow:0 30px 80px #000c,0 0 0 1px var(--tc) inset;overflow:hidden}
.pbc-rv .rays{position:absolute;left:50%;top:150px;width:900px;height:900px;margin:-450px 0 0 -450px;border-radius:50%;background:repeating-conic-gradient(from 0deg,var(--tg) 0 8deg,transparent 8deg 20deg);-webkit-mask:radial-gradient(circle,#000 0,transparent 60%);mask:radial-gradient(circle,#000 0,transparent 60%);animation:pbcSpin 14s linear infinite;opacity:.9}
.pbc-rv .burst{position:absolute;left:50%;top:150px;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;background:radial-gradient(circle,var(--tc) 0,transparent 62%);opacity:.55;animation:pbcBurst .9s ease-out}
@keyframes pbcSpin{to{transform:rotate(360deg)}}
@keyframes pbcBurst{0%{transform:scale(.2);opacity:1}100%{transform:scale(1);opacity:.55}}
.pbc-rv .big{position:relative;height:260px;display:flex;align-items:center;justify-content:center;animation:pbcPop .6s cubic-bezier(.2,1.6,.4,1)}
.pbc-rv .big canvas{width:min(520px,82vw);height:260px;object-fit:contain;filter:drop-shadow(0 12px 18px #000a)}
@keyframes pbcPop{from{transform:scale(.4);opacity:0}}
.pbc-rv .tier{position:relative;display:inline-block;margin-top:6px;padding:3px 12px;border-radius:999px;background:var(--tc);color:#fff;font-size:12px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;text-shadow:0 1px 0 #0006}
.pbc-rv h3{position:relative;margin:10px 0 2px;font-size:28px;font-weight:900}
.pbc-rv h3 span{opacity:.6;font-weight:700}
.pbc-rv .sub{position:relative;opacity:.65;font-size:13px}
.pbc-rv .btns{position:relative;display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}
.pbc-rv.gold h3{color:#ffd96b;text-shadow:0 0 18px #ffb21e88}
.pbc-rv.gold .glitter{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(2px 2px at 20% 30%,#fff,transparent),radial-gradient(2px 2px at 70% 20%,#fff,transparent),radial-gradient(1.5px 1.5px at 85% 60%,#fff,transparent),radial-gradient(2px 2px at 35% 70%,#fff,transparent),radial-gradient(1.5px 1.5px at 55% 45%,#fff,transparent),radial-gradient(2px 2px at 12% 80%,#fff,transparent);animation:pbcTw 1.4s ease-in-out infinite alternate}
@keyframes pbcTw{to{opacity:.2;transform:translateY(-6px)}}
/* locker */
.pbc-loadout{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pbc-slot{position:relative;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:linear-gradient(#262b34,#191d23);border:1px solid #ffffff14;border-left:4px solid var(--tc,#5a6270)}
.pbc-slot canvas{width:120px;height:60px;flex:0 0 auto}
.pbc-slot .meta{flex:1;min-width:0}
.pbc-slot .meta span{display:block;font-size:11px;opacity:.6;font-weight:800;letter-spacing:1px;text-transform:uppercase}
.pbc-slot .meta b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbc-filter{display:flex;gap:6px;flex-wrap:wrap;margin:22px 0 4px}
.pbc-filter button{background:#ffffff0d;border:1px solid #ffffff14;color:#fff;border-radius:999px;padding:6px 14px;font-weight:800;opacity:.7}
.pbc-filter button.on{background:#ffb21e;color:#2a1600;border-color:#ffb21e;opacity:1}
.pbc-group h2 small{opacity:.7;margin-left:8px;letter-spacing:1px}
.pbc-grid.locker .pbc-card{cursor:pointer;transition:transform .12s,box-shadow .12s}
.pbc-grid.locker .pbc-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px #0008,0 0 0 1px var(--tc)}
.pbc-card .cnt{position:absolute;top:6px;right:6px;background:#000a;border-radius:5px;padding:1px 7px;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums}
.pbc-card .eq{position:absolute;top:6px;left:6px;background:#ffb21e;color:#2a1600;border-radius:5px;padding:1px 7px;font-size:10px;font-weight:900;letter-spacing:1px}
.pbc-card.equipped{box-shadow:0 0 0 2px #ffb21e;border-color:#ffb21e}
.pbc-card .prog{height:3px;margin:0 9px 6px;background:#ffffff14;border-radius:2px;overflow:hidden}
.pbc-card .prog i{display:block;height:100%;background:var(--tc)}
.pbc-card .tu{margin:0 8px 8px;padding:6px 6px;font-size:11px;border-radius:6px;border:0;font-weight:900;color:#fff;background:linear-gradient(90deg,var(--tc),var(--nc));box-shadow:0 0 12px var(--nc);animation:pbcPulse 1.6s ease-in-out infinite}
@keyframes pbcPulse{50%{filter:brightness(1.25)}}
.pbc-card.default{background:linear-gradient(#2c323c,#1b1f26);border-bottom-color:#5a6270}
.pbc-card.default .pic{font-size:34px;opacity:.75}
.pbc-empty{padding:40px;text-align:center;opacity:.7;border:1px dashed #ffffff26;border-radius:12px}
.pbc-trade{display:flex;flex-direction:column;align-items:center;gap:18px}
.pbc-trade .stack{position:relative;width:420px;max-width:90vw;height:320px}
.pbc-trade .stack canvas{position:absolute;left:50%;top:50%;width:150px;height:75px;margin:-37px 0 0 -75px;animation:pbcSuck 1.1s cubic-bezier(.6,0,.9,.5) forwards}
@keyframes pbcSuck{0%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:1}90%{opacity:1}100%{transform:translate(0,0) scale(.1) rotate(0);opacity:0}}
.pbc-trade .flash{position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px;border-radius:50%;background:radial-gradient(circle,#fff 0,var(--nc) 35%,transparent 70%);opacity:0;animation:pbcFlash .45s 1s ease-out forwards}
.pbc-trade .arrow{font-weight:900;font-size:13px;letter-spacing:2px;color:var(--nc);text-shadow:0 0 12px var(--nc)}
@keyframes pbcFlash{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(8)}}
.pbc-toast{position:absolute;right:20px;top:70px;z-index:80;background:#14181ee6;border:1px solid #ffd96b55;color:#ffd96b;font-weight:900;padding:8px 14px;border-radius:9px;animation:pbcToast 2.4s ease forwards;pointer-events:none}
@keyframes pbcToast{0%{opacity:0;transform:translateY(-8px)}10%,80%{opacity:1;transform:none}100%{opacity:0}}
@media (max-width:820px){.pbc-stage{grid-template-columns:1fr}.pbc-loadout{grid-template-columns:1fr}.pbc-head{flex-wrap:wrap;padding:12px}.pbc-scroll{padding:14px}.pbc-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}}
`;
    const s = document.createElement("style");
    s.id = "pbc-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const tierOf = (s) => S().TIER[s.tier];
  const tint = (e, tier) => { e.style.setProperty("--tc", tier.color); e.style.setProperty("--tg", tier.color + "55"); return e; };

  function toast(parent, text) {
    if (!parent || !parent.appendChild) return;
    addCSS();
    const t = el("div", "pbc-toast", text);
    parent.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // A credits pill that keeps itself up to date (for the lobby header)
  function creditsBadge() {
    addCSS();
    const b = el("span", "pbc-wallet");
    b.title = "Credits: earn them by playing, spend them on cases";
    const v = el("b");
    b.append(el("i", null, CREDIT), v, el("small", null, "credits"));
    let last = null, seen = false;
    const draw = () => {
      if (b.isConnected) seen = true;
      const n = credits();
      v.textContent = fmt(n);
      if (last !== null && n !== last) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
      last = n;
    };
    draw();
    // stops listening once it has been on the page and then removed (e.g. the lobby was rebuilt)
    const off = onChange(() => { if (seen && !b.isConnected) { off(); return; } draw(); });
    return b;
  }

  function skinCard(skin, size) {
    const t = tierOf(skin);
    const c = tint(el("div", "pbc-card t-" + skin.tier), t);
    const p = el("div", "pic");
    p.appendChild(pic(skin, size ? size[0] : 256, size ? size[1] : 128));
    const m = el("div", "meta");
    m.append(el("span", null, S().WEAPON_NAMES[skin.weapon]), el("b", null, skin.name));
    c.append(p, m);
    c.title = S().WEAPON_NAMES[skin.weapon] + " | " + skin.name + " (" + t.name + ")";
    return c;
  }
  function mysteryCard() {
    const c = tint(el("div", "pbc-card mystery t-gold"), S().TIER.gold);
    const m = el("div", "meta");
    m.append(el("span", null, S().WEAPON_NAMES.knife), el("b", null, "★ Rare Special Item"));
    c.append(el("div", "pic", "★"), m);
    return c;
  }
  const cardFor = (skin) => (skin.tier === "gold" ? mysteryCard() : skinCard(skin));

  // ---------------------------------------------------------------------
  // The screen
  // ---------------------------------------------------------------------
  let openUI = null;

  function open(parentEl, opts) {
    opts = opts || {};
    const P = S();
    if (!P) { if (root.console) console.warn("PBCrates: PBSkins isn't loaded"); return null; }
    if (openUI) openUI.close();
    addCSS();
    parentEl = parentEl || document.body;
    const audio = getAudio(opts.audio);
    try { audio.resume(); } catch (e) { /* fine */ }
    const play = (name, o) => { try { audio.play(name, o); } catch (e) { /* no sound is fine */ } };

    let tab = opts.tab === "locker" ? "locker" : "crates";
    let filter = "all";
    let spinning = false, raf = 0, closed = false;
    const timers = [];
    const later = (ms, fn) => { const id = setTimeout(() => { if (!closed) fn(); }, ms); timers.push(id); return id; };

    const ov = el("div", "pbc");
    const head = el("div", "pbc-head");
    const h1 = el("h1"); h1.innerHTML = "🎁 CRATES <span>&amp;</span> LOCKER";
    const tabs = el("div", "pbc-tabs");
    const tabBtns = {};
    for (const [id, label] of [["crates", "CRATES"], ["locker", "LOCKER"]]) {
      const b = el("button", null, label);
      b.addEventListener("click", () => { if (spinning) return; tab = id; play("uiClick", { vol: 0.6 }); render(); scroller.scrollTop = 0; });
      tabBtns[id] = b; tabs.appendChild(b);
    }
    const wallet = creditsBadge();
    const x = el("button", "pbc-close", "✕");
    x.title = "Close (Esc)";
    x.addEventListener("click", close);
    head.append(h1, tabs, el("div", "pbc-sp"), wallet, x);
    const body = el("div", "pbc-body");
    const scroller = el("div", "pbc-scroll");
    const wrap = el("div", "pbc-wrap");
    scroller.appendChild(wrap);
    body.appendChild(scroller);
    ov.append(head, body);
    parentEl.appendChild(ov);

    let reveal = null;
    function closeReveal() { if (reveal) { reveal.remove(); reveal = null; } }

    function onKey(e) {
      if (!ov.isConnected) { cleanup(); return; }
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      if (reveal) { closeReveal(); render(); } else close();
    }
    root.addEventListener("keydown", onKey, true);
    const offChange = onChange((ch) => { if (!spinning && !reveal && tab === "crates" && ch.type === "credits") updateBuy(); });

    function cleanup() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      root.removeEventListener("keydown", onKey, true);
      offChange();
      if (openUI && openUI.close === close) openUI = null;
    }
    function close() {
      if (closed) return;
      cleanup();
      ov.remove();
      if (opts.onClose) { try { opts.onClose(); } catch (e) { if (root.console) console.error(e); } }
    }

    function render() {
      closeReveal();
      for (const id in tabBtns) tabBtns[id].classList.toggle("on", id === tab);
      wrap.innerHTML = "";
      if (tab === "crates") renderCrates(); else renderLocker();
    }

    // ----- Crates tab -----
    let buyBtn = null, needEl = null;
    function updateBuy() {
      if (!buyBtn) return;
      const ok = credits() >= P.CRATE.price;
      buyBtn.disabled = !ok;
      if (needEl) needEl.textContent = ok ? "" : "You need " + fmt(P.CRATE.price - credits()) + " more " + CREDIT + ". Play a match to earn some!";
    }
    function renderCrates() {
      const stage = el("div", "pbc-stage");
      const cs = el("div", "pbc-case");
      const box = el("div", "pbc-box");
      box.append(el("b"), el("b"), el("i", null, "🎨"));
      cs.appendChild(box);
      const info = el("div", "pbc-info");
      info.appendChild(el("h3", null, P.CRATE.name.toUpperCase()));
      info.appendChild(el("p", null, "Paint AK, Paint AWP and a ★ Butterfly Knife if you're lucky. No key needed."));
      const price = el("div", "pbc-price");
      buyBtn = el("button", "pbc-btn gold pbc-open", "OPEN CASE  ·  " + P.CRATE.price + " " + CREDIT);
      buyBtn.addEventListener("click", () => startSpin(stage, cs, info));
      needEl = el("div", "pbc-need");
      price.append(buyBtn, needEl);
      info.appendChild(price);
      const earn = el("div", "pbc-earn");
      for (const [k, label] of [["kill", "Elimination"], ["headshot", "Headshot bonus"], ["roundWin", "Round won"], ["matchPlayed", "Match played"], ["matchWin", "Match won"]]) {
        const s = el("span"); s.append(label + " "); s.appendChild(el("b", null, "+" + EARN[k] + " " + CREDIT)); earn.appendChild(s);
      }
      info.appendChild(earn);
      stage.append(cs, info);
      wrap.appendChild(stage);
      updateBuy();

      wrap.appendChild(el("h2", null, "Contains one of the following"));
      const odds = el("div", "pbc-odds");
      for (const t of P.TIERS) {
        const s = tint(el("span"), t);
        s.append(el("i"), t.name + " ");
        s.appendChild(el("em", null, (t.odds * 100).toFixed(2).replace(/\.?0+$/, "") + "%"));
        odds.appendChild(s);
      }
      wrap.appendChild(odds);
      const grid = el("div", "pbc-grid contains");
      for (const t of P.TIERS) {
        if (t.id === "gold") continue;
        for (const s of P.SKINS) if (s.tier === t.id) grid.appendChild(skinCard(s));
      }
      const gold = mysteryCard();
      gold.title = "Exceedingly rare: one of " + P.SKINS.filter((s) => s.tier === "gold").length + " Butterfly Knife finishes";
      grid.appendChild(gold);
      wrap.appendChild(grid);
    }

    function startSpin(stage, cs, info) {
      if (spinning) return;
      const win = buyCrate();
      if (!win) { updateBuy(); return; }
      spinning = true;
      tabs.classList.add("locked");
      play("crateOpen", { vol: 0.9 });
      cs.classList.add("opening");
      buyBtn.disabled = true;
      later(520, () => {
        stage.innerHTML = "";
        const reel = el("div", "pbc-reel");
        const strip = el("div", "pbc-strip");
        // like CS: a gold (★) card only ever shows up in the reel when it's the one you're getting
        const filler = () => { let s; do s = P.roll(); while (s.tier === "gold"); return s; };
        const N = 50, WIN = 42 + Math.floor(Math.random() * 3) - 1;
        const cards = [];
        for (let i = 0; i < N; i++) {
          const c = cardFor(i === WIN ? win : filler());
          cards.push(c); strip.appendChild(c);
        }
        reel.append(strip, el("div", "pbc-marker"));
        const lbl = el("div", "pbc-spinlbl", "UNLOCKING " + P.CRATE.name.toUpperCase() + "…");
        stage.append(reel, lbl);
        const CW = 150, GAP = 6, STRIDE = CW + GAP;
        const vw = reel.clientWidth || 900;
        const center = vw / 2;
        // stop somewhere inside the winning card (not dead center), like CS
        const inCard = CW * (0.08 + Math.random() * 0.84);
        const startX = center - STRIDE * 2.5;
        const endX = center - (WIN * STRIDE + inCard);
        const T = (api.TIMING.spin + (Math.random() - 0.5) * 0.5) * 1000;
        const t0 = performance.now();
        let lastIdx = -1;
        const ease = (t) => 1 - Math.pow(1 - t, 4);
        strip.style.transform = "translate3d(" + startX + "px,0,0)";
        const step = (now) => {
          if (closed) return;
          const t = Math.min(1, (now - t0) / T);
          const xNow = startX + (endX - startX) * ease(t);
          strip.style.transform = "translate3d(" + xNow.toFixed(2) + "px,0,0)";
          const idx = Math.floor((center - xNow + GAP / 2) / STRIDE);
          if (idx !== lastIdx) { if (lastIdx >= 0) play("crateTick", { vol: 0.55 }); lastIdx = idx; }
          if (t < 1) { raf = requestAnimationFrame(step); return; }
          // landed
          cards[WIN].classList.add("win");
          lbl.textContent = "";
          play("reveal_" + win.tier, { vol: 0.95 });
          later(win.tier === "gold" || win.tier === "red" ? 900 : 650, () => {
            spinning = false;
            tabs.classList.remove("locked");
            showReveal(win, "crate");
          });
        };
        raf = requestAnimationFrame(step);
      });
    }

    function showReveal(skin, src) {
      closeReveal();
      const t = tierOf(skin);
      reveal = el("div", "pbc-reveal");
      const rv = tint(el("div", "pbc-rv " + skin.tier), t);
      const big = el("div", "big");
      big.appendChild(pic(skin, 640, 320));
      rv.append(el("div", "rays"), el("div", "burst"));
      if (skin.tier === "gold" || skin.tier === "red") rv.appendChild(el("div", "glitter"));
      rv.appendChild(big);
      rv.appendChild(el("div", "tier", (skin.tier === "gold" ? "★ " : "") + t.name));
      const h = el("h3");
      h.append((skin.tier === "gold" ? "★ " : "") + P.WEAPON_NAMES[skin.weapon] + " ");
      h.appendChild(el("span", null, "| "));
      h.append(skin.name);
      rv.appendChild(h);
      const have = count(skin.id);
      rv.appendChild(el("div", "sub", (src === "tradeup" ? "Trade-up contract complete. " : "") + "You now have " + have + (have >= P.TRADE_UP_COUNT && skin.tier !== "gold" ? " — ready to trade up!" : "")));
      const btns = el("div", "btns");
      const eq = el("button", "pbc-btn green pbc-equip", "EQUIP");
      const syncEq = () => { const on = equipped()[skin.weapon] === skin.id; eq.textContent = on ? "EQUIPPED ✓" : "EQUIP"; eq.disabled = on; };
      eq.addEventListener("click", () => { equip(skin.weapon, skin.id); play("uiClick"); syncEq(); });
      syncEq();
      const again = el("button", "pbc-btn gold pbc-again", "OPEN ANOTHER  ·  " + P.CRATE.price + " " + CREDIT);
      again.disabled = credits() < P.CRATE.price;
      again.addEventListener("click", () => {
        tab = "crates"; render(); scroller.scrollTop = 0;
        const st = wrap.querySelector(".pbc-stage");
        startSpin(st, st.querySelector(".pbc-case"), st.querySelector(".pbc-info"));
      });
      const back = el("button", "pbc-btn pbc-done", src === "tradeup" ? "BACK TO LOCKER" : "DONE");
      back.addEventListener("click", () => { if (src === "tradeup") tab = "locker"; render(); });
      btns.append(eq, again, back);
      rv.appendChild(btns);
      reveal.appendChild(rv);
      reveal.addEventListener("click", (e) => { if (e.target === reveal) { closeReveal(); render(); } });
      body.appendChild(reveal);
    }

    // ----- Locker tab -----
    function renderLocker() {
      const inv = items(), eqd = equipped();
      wrap.appendChild(el("h2", null, "Loadout"));
      const lo = el("div", "pbc-loadout");
      for (const w of WEAPONS) {
        const s = eqd[w] && P.BY_ID[eqd[w]];
        const slot = el("div", "pbc-slot");
        if (s) tint(slot, tierOf(s));
        if (s) slot.appendChild(pic(s, 256, 128));
        else { const ph = el("div", null, ICON[w]); ph.style.cssText = "width:120px;text-align:center;font-size:34px;opacity:.6"; slot.appendChild(ph); }
        const m = el("div", "meta");
        m.append(el("span", null, P.WEAPON_NAMES[w]), el("b", null, s ? s.name : "Default"));
        slot.appendChild(m);
        if (s) {
          const d = el("button", "pbc-btn", "Default");
          d.addEventListener("click", () => { equip(w, null); play("uiClick"); render(); });
          slot.appendChild(d);
        }
        lo.appendChild(slot);
      }
      wrap.appendChild(lo);

      const fl = el("div", "pbc-filter");
      for (const [id, label] of [["all", "All"], ["ak", P.WEAPON_NAMES.ak], ["awp", P.WEAPON_NAMES.awp], ["deagle", P.WEAPON_NAMES.deagle], ["knife", "★ " + P.WEAPON_NAMES.knife]]) {
        const b = el("button", filter === id ? "on" : null, label);
        b.addEventListener("click", () => { filter = id; render(); });
        fl.appendChild(b);
      }
      wrap.appendChild(fl);

      const owned = P.SKINS.filter((s) => inv[s.id] > 0);
      if (!owned.length) {
        const e = el("div", "pbc-empty");
        e.append("Your locker is empty. ");
        const go = el("button", "pbc-btn gold", "Open a " + P.CRATE.name);
        go.addEventListener("click", () => { tab = "crates"; render(); });
        e.appendChild(go);
        wrap.appendChild(e);
      }
      for (const w of WEAPONS) {
        if (filter !== "all" && filter !== w) continue;
        const mine = owned.filter((s) => s.weapon === w).sort((a, b) => tierOf(b).rank - tierOf(a).rank);
        if (!owned.length) break;
        const grp = el("div", "pbc-group");
        const h = el("h2", null, P.WEAPON_NAMES[w]);
        h.appendChild(el("small", null, mine.length + " / " + P.SKINS.filter((s) => s.weapon === w).length));
        grp.appendChild(h);
        const grid = el("div", "pbc-grid locker");
        const def = el("div", "pbc-card default" + (!eqd[w] ? " equipped" : ""));
        def.style.setProperty("--tc", "#5a6270"); def.style.setProperty("--tg", "transparent");
        const dm = el("div", "meta"); dm.append(el("span", null, P.WEAPON_NAMES[w]), el("b", null, "Default"));
        def.append(el("div", "pic", ICON[w]), dm);
        if (!eqd[w]) def.appendChild(el("div", "eq", "EQUIPPED"));
        def.addEventListener("click", () => { equip(w, null); play("uiClick"); render(); });
        grid.appendChild(def);
        for (const s of mine) {
          const c = skinCard(s);
          c.dataset.skin = s.id;
          const n = inv[s.id], on = eqd[w] === s.id;
          if (on) { c.classList.add("equipped"); c.appendChild(el("div", "eq", "EQUIPPED")); }
          c.appendChild(el("div", "cnt", "×" + n));
          if (s.tier !== "gold") {
            const next = P.TIERS[tierOf(s).rank + 1];
            c.style.setProperty("--nc", next.color);
            if (n >= P.TRADE_UP_COUNT) {
              const tu = el("button", "tu", "⇪ TRADE UP " + P.TRADE_UP_COUNT + " → " + next.name);
              tu.addEventListener("click", (e) => { e.stopPropagation(); doTradeUp(s); });
              c.appendChild(tu);
            } else {
              const pr = el("div", "prog"); const i = el("i"); i.style.width = (n / P.TRADE_UP_COUNT * 100) + "%"; pr.appendChild(i);
              pr.title = n + " / " + P.TRADE_UP_COUNT + " to trade up";
              c.appendChild(pr);
            }
          }
          c.title += on ? "\nClick to unequip" : "\nClick to equip";
          c.addEventListener("click", () => { equip(w, on ? null : s.id); play("uiClick"); render(); });
          grid.appendChild(c);
        }
        grp.appendChild(grid);
        wrap.appendChild(grp);
      }
    }

    function doTradeUp(s) {
      if (spinning) return;
      const got = tradeUp(s.id);
      if (!got) return;
      spinning = true;
      tabs.classList.add("locked");
      play("tradeUp", { vol: 0.9 });
      closeReveal();
      reveal = el("div", "pbc-reveal");
      const box = el("div", "pbc-trade");
      box.style.setProperty("--nc", tierOf(got).color);
      const stack = el("div", "stack");
      for (let i = 0; i < P.TRADE_UP_COUNT; i++) {
        const cv = pic(s, 256, 128);
        const a = (i / P.TRADE_UP_COUNT) * Math.PI * 2;
        cv.style.setProperty("--dx", Math.cos(a) * 190 + "px");
        cv.style.setProperty("--dy", Math.sin(a) * 120 + "px");
        cv.style.setProperty("--r", (Math.random() * 40 - 20) + "deg");
        cv.style.animationDelay = (i * 0.03) + "s";
        stack.appendChild(cv);
      }
      stack.appendChild(el("div", "flash"));
      box.append(stack, el("div", "pbc-spinlbl", "TRADE-UP CONTRACT: " + P.TRADE_UP_COUNT + " × " + s.name.toUpperCase()),
        el("div", "arrow", tierOf(s).name.toUpperCase() + "  →  " + tierOf(got).name.toUpperCase()));
      reveal.appendChild(box);
      body.appendChild(reveal);
      later(1250, () => {
        spinning = false;
        tabs.classList.remove("locked");
        play("reveal_" + got.tier, { vol: 0.95 });
        showReveal(got, "tradeup");
      });
    }

    render();
    openUI = { close, el: ov, get spinning() { return spinning; } };
    return openUI;
  }

  const api = {
    KEY, EARN, START_CREDITS, WEAPONS, SOUNDS,
    TIMING: { spin: 5.6 },
    credits, addCredits, spend, items, count, equipped, equippedSkin, equip, buyCrate, tradeUp,
    onChange, open, creditsBadge, toast,
    close() { if (openUI) openUI.close(); },
    isOpen: () => !!(openUI && openUI.el && openUI.el.isConnected),
    picture: (skinId, w, h) => { const s = S() && S().BY_ID[skinId]; return s ? pic(s, w || 256, h || 128) : null; },
  };
  root.PBCrates = Object.assign(root.PBCrates || {}, api);
})(typeof window !== "undefined" ? window : globalThis);
