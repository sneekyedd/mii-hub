/*
 * paintball/pb-game.js
 * Paintball: a first-person shooter on Shipment (and a map for each hub place), against one of your Miis
 * or online against other people (pb-online.js + the server in /server).
 *
 *   Lobby   "VS a Mii": pick the Mii you play as and the Mii you play against.
 *           "Online": connect to a server, make or join a room.
 *   Modes   Respawn: you're back 2 s after being splattered, first to 20
 *           eliminations wins (or the most after 10 minutes).
 *           Rounds (VS a Mii only): first to 10 rounds, 3 s freeze + 1:30 each.
 *   HUD     HP, ammo, clock + score, kill feed, crosshair,
 *           scoreboard (hold Tab), damage report when you die.
 *
 * Rules and the Mii's brain are in pb-engine.js, the map in pb-map.js, the gun,
 * knife and hands in pb-models.js and the sounds in pb-audio.js. None of these
 * files load until you open Paintball (see openPaintball in app.js).
 *
 * Use: Paintball.open({ records, templateFor, lookFor, portraitFor, statsFor,
 *                       onSave, onFinish, onClose, opponent, player })
 */
(function (root) {
  "use strict";

  const E = root.PBEngine;
  const { CFG, AK, KNIFE, DEG, clamp, lerp } = E;
  const TICK = 1 / 128;
  const TO_WIN = 10;            // rounds mode
  const RESPAWN_TO_WIN = 20;    // respawn mode: eliminations
  const RESPAWN = 2;            // seconds before you're back in
  const TIME_LIMIT = 600;       // respawn mode: 10 minutes
  const FREEZE = 3;
  const ROUND_TIME = 90;
  const END_DELAY = 3.5;
  const MII_SCALE = 1.25;      // Miis are 1.8 tall in the hub; here they're CS-sized
  const MAP_SCALE = 1.25;      // Shipment is built 1:1, then made a bit bigger so it doesn't feel cramped
  const SETTINGS_KEY = "mii-hub-paintball";
  const FAV = ["#d21e14", "#ff6e19", "#ffd820", "#78d220", "#007830", "#0a48b4", "#3caade", "#f55a7d", "#7328ad", "#483818", "#e0e0e0", "#181814"];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ---------------------------------------------------------------------
  // Settings (kept between games)
  // ---------------------------------------------------------------------
  const DEFAULTS = { mode: "respawn", map: "shipment_park", tab: "mii", server: "", fov: 90, sens: 2.0, volume: 0.7, xhColor: "#3dff6e", xhStyle: "static", xhSize: 5, xhGap: 3, player: null, opponent: null };
  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* private window */ } }

  // Field of view works like CS's: the number is how wide you see on a 4:3
  // screen (90 = CS default). Wider screens see a bit more to the sides.
  function verticalFov(fov) {
    const h = clamp(fov || 90, 60, 150) * DEG;
    return 2 * Math.atan(Math.tan(h / 2) / (4 / 3)) / DEG;
  }

  // The maps (pb-layouts.js): names, and picking one
  const LY = () => root.PBLayouts;
  const mapName = (id) => { const m = LY() && LY().mapById(id); return m ? m.name : "Shipment"; };
  const validMap = (id) => (LY() && LY().mapById(id) ? id : (LY() ? LY().DEFAULT_MAP : "shipment_park"));

  // Make the whole map (looks + everything you bump into) bigger
  function scaleMap(map, k) {
    map.group.scale.setScalar(k);
    for (const b of map.boxes) { b.x *= k; b.z *= k; b.hw *= k; b.hd *= k; b.y0 *= k; b.y1 *= k; }
    for (const c of map.cyls) { c.x *= k; c.z *= k; c.r *= k; c.y0 *= k; c.y1 *= k; }
    const B = map.bounds; B.minX *= k; B.maxX *= k; B.minZ *= k; B.maxZ *= k;
    for (const list of [map.spawns.a, map.spawns.b]) for (const sp of list) { sp.x *= k; sp.z *= k; }
    // shadows have to cover the bigger area too
    map.group.traverse((n) => {
      if (n.isDirectionalLight && n.castShadow) {
        const c = n.shadow.camera;
        c.left *= k; c.right *= k; c.top *= k; c.bottom *= k; c.far *= k;
        c.updateProjectionMatrix();
      }
    });
    if (map.fog && map.fog.density) map.fog.density /= k;
    if (map.ceiling) map.ceiling *= k;
    return map;
  }

  // A soft glow around a player's outline (in their paint color) and a minimum
  // brightness, so nobody can hide in a dark corner. Done in the Mii's own materials.
  function outlineGlow(obj, color) {
    const rim = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
    obj.traverse((n) => {
      if (!n.isMesh) return;
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
        if (!(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial)) continue;
        m.onBeforeCompile = (sh) => {
          sh.uniforms.pbRim = { value: rim };
          sh.fragmentShader = "uniform vec3 pbRim;\n" + sh.fragmentShader.replace("#include <dithering_fragment>", [
            "{",
            "  float pbF = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));",
            "  gl_FragColor.rgb = max(gl_FragColor.rgb, diffuseColor.rgb * 0.32);",
            "  gl_FragColor.rgb += pbRim * pow(pbF, 2.4) * 0.65;",
            "}",
            "#include <dithering_fragment>",
          ].join("\n"));
        };
        m.customProgramCacheKey = () => "pb-rim";
        m.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------
  function hexOf(v, fallback) {
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return v;
    if (Array.isArray(v) && root.MiiModel) return root.MiiModel.rgbToHex(v);
    return fallback;
  }
  function colorDistance(a, b) {
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    return Math.abs(ca.r - cb.r) + Math.abs(ca.g - cb.g) + Math.abs(ca.b - cb.b);
  }
  // A paint color that pops on the gray map (black/brown/white paint is hard to see)
  function paintColor(tpl) {
    const i = tpl && tpl.info ? tpl.info.favoriteColor : 0;
    const swap = { 9: "#ff8a00", 10: "#ffe94d", 11: "#9b5cff" };
    return swap[i] || FAV[i] || "#ff3fa4";
  }

  // ---------------------------------------------------------------------
  // Styles (only added when Paintball opens)
  // ---------------------------------------------------------------------
  let cssDone = false;
  function addCSS() {
    if (cssDone) return;
    cssDone = true;
    const css = `
.pb-root{position:fixed;inset:0;z-index:2000;background:#0d1014;color:#eef2f6;font-family:Nunito,system-ui,sans-serif;overflow:hidden;user-select:none}
.pb-root canvas{display:block;width:100%;height:100%}
.pb-root button{font:inherit;cursor:pointer}
.pb-lobby{position:absolute;inset:0;overflow:auto;background:radial-gradient(ellipse at top,#2b3644,#0d1014 70%);padding:28px 32px}
.pb-lobby h1{margin:0;font-size:34px;letter-spacing:2px;font-weight:900}
.pb-lobby h1 small{font-size:15px;opacity:.6;letter-spacing:1px;margin-left:10px;font-weight:700}
.pb-lob-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.pb-x{background:#ffffff14;border:1px solid #ffffff26;color:#fff;border-radius:10px;padding:8px 14px}
.pb-cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.pb-col h2{font-size:15px;text-transform:uppercase;letter-spacing:2px;opacity:.75;margin:0 0 10px}
.pb-minis{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
.pb-mini{background:#ffffff0d;border:2px solid #ffffff1a;border-radius:14px;padding:10px 6px 8px;text-align:center;color:#fff;transition:transform .12s,border-color .12s}
.pb-mini:hover{transform:translateY(-2px);border-color:#ffffff55}
.pb-mini.sel{border-color:#ffb21e;background:#ffb21e22}
.pb-mini.off{opacity:.3;pointer-events:none}
.pb-mini img{width:72px;height:72px;border-radius:50%;background:#ffffff14;object-fit:cover}
.pb-mini b{display:block;margin-top:4px;font-size:15px}
.pb-mini span{display:block;font-size:11px;opacity:.7}
.pb-bottom{display:grid;grid-template-columns:1.2fr 1fr auto;gap:22px;margin-top:22px;align-items:start}
.pb-box{background:#ffffff0b;border:1px solid #ffffff1a;border-radius:14px;padding:14px 16px}
.pb-box h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:2px;opacity:.7}
.pb-set{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:14px}
.pb-set label{width:110px;opacity:.85}
.pb-set input[type=range]{flex:1}
.pb-set .val{width:44px;text-align:right;font-variant-numeric:tabular-nums}
.pb-swatches{display:flex;gap:6px}
.pb-sw{width:22px;height:22px;border-radius:6px;border:2px solid transparent}
.pb-sw.sel{border-color:#fff}
.pb-keys{font-size:13px;line-height:1.75;opacity:.85;columns:2}
.pb-keys kbd{background:#ffffff1f;border-radius:5px;padding:1px 6px;font-family:inherit;font-size:12px}
.pb-go{background:linear-gradient(#ffc23a,#ff8c1a);color:#2a1600;border:0;border-radius:16px;padding:22px 34px;font-size:24px;font-weight:900;letter-spacing:1px;box-shadow:0 6px 0 #b35a00}
.pb-go:active{transform:translateY(3px);box-shadow:0 3px 0 #b35a00}
.pb-vs{font-size:14px;opacity:.75;margin-top:8px;text-align:center}
.pb-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:#0d1014;font-size:22px;font-weight:800;letter-spacing:2px}
.pb-loading i{width:220px;height:6px;background:#ffffff22;border-radius:3px;overflow:hidden}
.pb-loading i::after{content:"";display:block;height:100%;width:40%;background:#ffb21e;animation:pbload 1s infinite ease-in-out}
@keyframes pbload{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.pb-hud{position:absolute;inset:0;pointer-events:none;text-shadow:0 1px 2px #000a}
.pb-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:4px}
.pb-team{display:flex;align-items:center;gap:8px;background:#0b0e12c0;padding:4px 10px;border-radius:8px;min-width:150px}
.pb-team.opp{flex-direction:row-reverse}
.pb-team img{width:34px;height:34px;border-radius:50%;background:#ffffff1a;border:2px solid var(--c)}
.pb-team .nm{font-weight:800;font-size:14px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pb-team .sc{font-size:28px;font-weight:900;margin-left:auto;color:var(--c);min-width:26px;text-align:center}
.pb-team.opp .sc{margin-left:0;margin-right:auto}
.pb-clock{background:#0b0e12d8;border-radius:8px;padding:2px 14px;text-align:center;min-width:84px}
.pb-clock .tm{font-size:26px;font-weight:900;font-variant-numeric:tabular-nums}
.pb-clock .tm.low{color:#ff5a4a}
.pb-clock .sub{font-size:10px;letter-spacing:1px;opacity:.65;text-transform:uppercase}
.pb-pips{display:flex;gap:3px;justify-content:center;margin-top:3px}
.pb-pips i{width:9px;height:4px;border-radius:2px;background:#ffffff26}
.pb-pips i.on{background:var(--c)}
.pb-feed{position:absolute;top:12px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.pb-kill{background:#0b0e12c8;border-radius:6px;padding:4px 10px;font-weight:800;font-size:14px;display:flex;align-items:center;gap:7px;animation:pbin .2s}
.pb-kill.mine{border:2px solid #ff3b30}
.pb-kill .wpn{opacity:.9;font-size:13px}
@keyframes pbin{from{transform:translateX(30px);opacity:0}}
.pb-xh{position:absolute;left:50%;top:50%;width:0;height:0}
.pb-xh i{position:absolute;background:var(--xc);box-shadow:0 0 0 1px #000c}
.pb-hp,.pb-ammo{position:absolute;bottom:16px;background:linear-gradient(90deg,#0b0e12d0,#0b0e1200);padding:8px 16px;border-radius:8px;display:flex;align-items:baseline;gap:10px;font-weight:900}
.pb-hp{left:16px}
.pb-hp .plus{font-size:26px;color:#e8eef5}
.pb-hp b{font-size:38px;min-width:64px;font-variant-numeric:tabular-nums}
.pb-hp b.low{color:#ff5a4a}
.pb-hp .bar{width:120px;height:6px;background:#ffffff22;border-radius:3px;align-self:center}
.pb-hp .bar i{display:block;height:100%;background:#e8eef5;border-radius:3px;transition:width .2s}
.pb-ammo{right:16px;background:linear-gradient(270deg,#0b0e12d0,#0b0e1200)}
.pb-ammo .mag{font-size:38px;font-variant-numeric:tabular-nums}
.pb-ammo .mag.low{color:#ff5a4a}
.pb-ammo .res{font-size:20px;opacity:.75}
.pb-ammo .wn{font-size:13px;opacity:.75;letter-spacing:1px;text-transform:uppercase}
.pb-ammo .rl{font-size:13px;color:#ffb21e}
.pb-slots{position:absolute;right:18px;bottom:78px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;font-weight:800}
.pb-slots span{opacity:.45;background:#0b0e1280;padding:2px 8px;border-radius:4px}
.pb-slots span.on{opacity:1;color:#ffb21e}
.pb-banner{position:absolute;left:50%;top:24%;transform:translateX(-50%);text-align:center;font-weight:900;opacity:0;transition:opacity .25s}
.pb-banner.show{opacity:1}
.pb-banner .big{font-size:52px;letter-spacing:3px}
.pb-banner .small{font-size:18px;opacity:.85;margin-top:4px}
.pb-banner.win .big{color:#6cff8a}.pb-banner.lose .big{color:#ff5a4a}
.pb-hurt{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 55%,#c0101088 100%);transition:opacity .4s}
.pb-dir{position:absolute;left:50%;top:50%;width:0;height:0}
.pb-dir i{position:absolute;left:-60px;top:-170px;width:120px;height:26px;border-radius:50%/100% 100% 0 0;border-top:6px solid #ff3b30;opacity:0;transition:opacity .6s;transform-origin:60px 170px}
.pb-splats{position:absolute;inset:0;overflow:hidden}
.pb-splats canvas{position:absolute;transition:opacity 1.6s;width:auto;height:auto}
.pb-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#0b0e12e8;border-radius:14px;padding:18px 22px;min-width:560px;display:none}
.pb-board.show{display:block}
.pb-board h3{margin:0 0 4px;font-size:20px;display:flex;justify-content:space-between}
.pb-board h3 small{opacity:.6;font-size:13px;font-weight:700}
.pb-board table{width:100%;border-collapse:collapse;margin-top:10px;font-weight:800}
.pb-board th{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:1px;text-align:right;padding:4px 8px}
.pb-board th:first-child,.pb-board td:first-child{text-align:left}
.pb-board td{padding:8px;text-align:right;border-top:1px solid #ffffff14;font-variant-numeric:tabular-nums}
.pb-board td img{width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;background:#ffffff1a}
.pb-board tr.me td{background:#ffffff0a}
.pb-death{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);background:#0b0e12d8;border-radius:12px;padding:12px 18px;text-align:center;display:none;font-weight:800}
.pb-death.show{display:block}
.pb-death .who{font-size:20px}
.pb-death .dmg{font-size:13px;opacity:.85;margin-top:6px;line-height:1.5}
.pb-overlay{position:absolute;inset:0;background:#05070acc;display:none;align-items:center;justify-content:center;pointer-events:auto}
.pb-overlay.show{display:flex}
.pb-panel{background:#151a21;border:1px solid #ffffff1f;border-radius:18px;padding:22px 26px;min-width:340px;max-width:min(92vw,620px);text-align:center}
.pb-panel h2{margin:0 0 6px;font-size:28px;letter-spacing:2px}
.pb-panel p{opacity:.8;margin:6px 0 14px}
.pb-panel .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.pb-btn{background:#ffffff14;border:1px solid #ffffff2a;color:#fff;border-radius:12px;padding:11px 18px;font-weight:800}
.pb-btn.primary{background:#ffb21e;border-color:#ffb21e;color:#2a1600}
.pb-panel .pb-set{justify-content:center}
.pb-result .big{font-size:56px;font-weight:900;letter-spacing:4px}
.pb-result .big.win{color:#6cff8a}.pb-result .big.lose{color:#ff5a4a}
.pb-result .score{font-size:30px;font-weight:900;margin:4px 0}
.pb-result table{margin:12px auto 0;border-collapse:collapse;font-weight:800}
.pb-result td,.pb-result th{padding:5px 12px;text-align:right}
.pb-result th{font-size:11px;opacity:.6;text-transform:uppercase}
.pb-result td:first-child,.pb-result th:first-child{text-align:left}
.pb-result .say{font-style:italic;opacity:.85;margin-top:12px}
.pb-result .grow{color:#6cff8a;font-size:14px;margin-top:6px}
.pb-hint{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);font-size:13px;opacity:.7;font-weight:700}
.pb-tabs{display:flex;gap:6px;background:#ffffff0d;padding:4px;border-radius:12px}
.pb-tab{background:none;border:0;color:#fff;opacity:.65;padding:8px 16px;border-radius:9px;font-weight:800}
.pb-tab.on{background:#ffb21e;color:#2a1600;opacity:1}
.pb-modes{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.pb-mode{background:#ffffff0d;border:2px solid #ffffff1a;color:#fff;border-radius:12px;padding:7px 12px;text-align:left}
.pb-mode b{display:block;font-size:15px}.pb-mode span{font-size:12px;opacity:.7}
.pb-mode.on{border-color:#ffb21e;background:#ffb21e22}
.pb-maps{margin-top:22px}
.pb-map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pb-map{background:#ffffff0d;border:2px solid #ffffff1a;color:#fff;border-radius:12px;padding:7px 10px;text-align:left;display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center}
.pb-map i{font-style:normal;font-size:22px;grid-row:span 2}
.pb-map b{font-size:14px}.pb-map span{font-size:11px;opacity:.65;line-height:1.25}
.pb-map.on{border-color:#ffb21e;background:#ffb21e22}
.pb-net{position:absolute;top:14px;left:14px;font-size:12px;opacity:.6;font-weight:700}
.pb-kill.note{opacity:.8;font-weight:700}
.pb-death .again{margin-top:8px;font-size:16px;color:#ffb21e}
.pb-online{display:grid;grid-template-columns:1fr 1.2fr;gap:22px}
.pb-online input[type=text],.pb-online input[type=password]{width:100%;box-sizing:border-box;background:#0b0e12;border:1px solid #ffffff2a;color:#fff;border-radius:10px;padding:10px 12px;font:inherit}
.pb-row{display:flex;gap:8px;align-items:center;margin:8px 0}
.pb-row input{flex:1}
.pb-status{font-size:13px;opacity:.8;margin:6px 0}
.pb-status.err{color:#ff6a5a;opacity:1}
.pb-status.ok{color:#6cff8a;opacity:1}
.pb-rooms{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.pb-room{display:flex;align-items:center;gap:10px;background:#ffffff0b;border:1px solid #ffffff1a;border-radius:12px;padding:10px 12px}
.pb-room b{flex:1}.pb-room span{font-size:12px;opacity:.7}
.pb-players{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.pb-player{display:flex;align-items:center;gap:10px;background:#ffffff0b;border-radius:10px;padding:6px 10px;font-weight:800}
.pb-player img{width:34px;height:34px;border-radius:50%;background:#ffffff14;border:2px solid var(--c)}
.pb-player .host{font-size:11px;color:#ffb21e;margin-left:auto}
.pb-help{font-size:13px;opacity:.75;line-height:1.5}
.pb-help.warn{color:#ffcf6a;opacity:1}
.pb-vote{margin-top:14px;text-align:left}
.pb-vote-head{display:flex;justify-content:space-between;font-weight:900;font-size:18px;margin-bottom:6px}
.pb-vote-head b{color:#ffb21e}
.pb-vote-title{font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.6;margin:8px 0 4px}
.pb-vote-row{display:flex;gap:8px}
.pb-vote-card{flex:1;background:#ffffff0d;border:2px solid #ffffff22;border-radius:12px;padding:10px;color:#fff;text-align:left;display:flex;flex-direction:column;gap:3px}
.pb-vote-card.sel{border-color:#ffb21e;background:#ffb21e22}
.pb-vote-card .desc{font-size:12px;opacity:.75}
.pb-vote-card .pb-votes{font-size:12px;color:#ffb21e;font-weight:800;min-height:15px}
.pb-vote-result{margin-top:8px;font-weight:900;color:#6cff8a}
.pb-srv{font-size:12px;font-weight:800;opacity:.8;margin-left:auto;margin-right:10px}
.pb-earned{margin:6px 0 2px;color:#ffd23f;font-weight:800;font-size:15px}
.pb-scope{position:absolute;inset:0;display:none;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 44vmin,#000 calc(44vmin + 2px))}
.pb-scope.show{display:block}
.pb-scope i{position:absolute;background:#000}
.pb-scope .h{left:0;right:0;top:50%;height:1px}
.pb-scope .v{top:0;bottom:0;left:50%;width:1px}
.pb-loadout{position:absolute;left:50%;top:58%;transform:translateX(-50%);background:#0b0e12e0;border-radius:14px;padding:12px 16px;display:none;text-align:center;font-weight:800}
.pb-loadout.show{display:block}
.pb-loadout .t{font-size:12px;letter-spacing:3px;opacity:.7;margin-bottom:8px}
.pb-loadout .cards{display:flex;gap:10px}
.pb-loadout .card{border:2px solid #ffffff2a;border-radius:10px;padding:8px 14px;min-width:170px}
.pb-loadout .card b{display:block;font-size:17px}
.pb-loadout .card span{font-size:12px;opacity:.75}
.pb-loadout .card.on{border-color:#ffb21e;background:#ffb21e22}
.pb-loadout .n{font-size:12px;opacity:.7;margin-top:8px}
.pb-boxhead{display:flex;align-items:center;justify-content:space-between}
.pb-btn.small{padding:3px 10px}
.pb-room .lock{font-size:18px}
.pb-room .info{flex:1;display:flex;flex-direction:column}
.pb-room .info span{font-size:12px;opacity:.7}
.pb-room .count{font-weight:800;font-variant-numeric:tabular-nums;opacity:.85}
.pb-room{flex-wrap:wrap}
.pb-room .pass{flex-basis:100%;margin:6px 0 0}
.pb-room .pb-status{flex-basis:100%;margin:2px 0 0}
.pb-lbl{width:78px;font-size:13px;opacity:.8;font-weight:700}
.pb-select{background:#0b0e12;border:1px solid #ffffff2a;color:#fff;border-radius:10px;padding:10px;font:inherit;flex:1}
.pb-online .pb-go{padding:12px 24px;font-size:18px}
.pb-server{margin-top:14px;font-size:13px}
.pb-server summary{cursor:pointer;opacity:.75;font-weight:800}
@media (max-width:820px){.pb-cols,.pb-bottom,.pb-online{grid-template-columns:1fr}.pb-board{min-width:0;width:94vw}}
`;
    const s = document.createElement("style");
    s.id = "pb-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // =====================================================================
  // Opening Paintball: the lobby
  // =====================================================================
  let current = null;

  // A Mii's picture (it may still be drawing: the app fills in img[data-portrait] when it's ready)
  function portraitImg(img, opts, rec) {
    if (!rec) return img;
    img.dataset.portrait = rec.id;
    const url = opts.portraitFor(rec);
    if (url) img.src = url;
    return img;
  }

  // A grid of Mii cards to pick from
  function miiPicker(opts, recs, selected, disabled, onPick, sub) {
    const grid = el("div", "pb-minis");
    for (const r of recs) {
      const b = el("button", "pb-mini");
      const img = el("img"); img.src = opts.portraitFor(r) || ""; img.alt = "";
      b.append(img, el("b", null, r.name || "Mii"), el("span", null, sub ? sub(r) : " "));
      if (r === selected) b.classList.add("sel");
      if (r === disabled) b.classList.add("off");
      b.addEventListener("click", () => onPick(r));
      grid.appendChild(b);
    }
    return grid;
  }

  function controlsBox() {
    const keys = el("div", "pb-box");
    keys.appendChild(el("h3", null, "Controls"));
    const k = el("div", "pb-keys");
    k.innerHTML = [
      "<kbd>W A S D</kbd> move", "<kbd>Mouse</kbd> aim", "<kbd>Left click</kbd> shoot / slash", "<kbd>Right click</kbd> AWP scope / stab",
      "<kbd>Space</kbd> jump", "<kbd>Shift</kbd> walk (quiet)", "<kbd>Ctrl</kbd> / <kbd>C</kbd> crouch", "<kbd>R</kbd> reload",
      "<kbd>1</kbd> gun · <kbd>2</kbd> Deagle · <kbd>3</kbd> knife", "<kbd>B</kbd> loadout", "<kbd>Q</kbd> / wheel switch", "<kbd>F</kbd> inspect", "<kbd>Tab</kbd> scoreboard", "<kbd>Esc</kbd> menu",
    ].map((s) => "<div>" + s + "</div>").join("");
    keys.appendChild(k);
    return keys;
  }

  function open(opts) {
    if (current) current.close();
    addCSS();
    const settings = loadSettings();
    const rootEl = el("div", "pb-root");
    document.body.appendChild(rootEl);
    let match = null;
    let closed = false;
    let online = null;
    let tab = opts.tab || (settings.tab === "online" ? "online" : "mii");

    const recs = opts.records.filter(Boolean);
    const byId = (id) => recs.find((r) => r.id === id);
    let you = (opts.player && byId(opts.player.id)) || byId(settings.player) || recs[0];
    let opp = (opts.opponent && byId(opts.opponent.id)) || byId(settings.opponent) || recs.find((r) => r !== you);
    if (opp === you) opp = recs.find((r) => r !== you);
    if (opts.opponent) tab = "mii";

    function close() {
      if (closed) return;
      closed = true;
      if (match) match.dispose();
      if (online) online.dispose();
      rootEl.remove();
      document.removeEventListener("keydown", lobbyKeys, true);
      if (current && current.close === close) current = null;
      if (opts.onClose) opts.onClose();
    }
    function lobbyKeys(e) { if (e.key === "Escape" && !match) { e.preventDefault(); close(); } }
    document.addEventListener("keydown", lobbyKeys, true);

    function showLobby() {
      if (match) { match.dispose(); match = null; root.__pb = null; }
      rootEl.innerHTML = "";
      const lob = el("div", "pb-lobby");
      const head = el("div", "pb-lob-head");
      const h1 = el("h1", null, "🎯 PAINTBALL");
      h1.appendChild(el("small", null, tab === "online" ? "Online" : mapName(settings.map === "random" ? null : settings.map)));
      const tabs = el("div", "pb-tabs");
      for (const [id, label] of [["mii", "🤖 VS a Mii"], ["online", "🌐 Online"]]) {
        const b = el("button", "pb-tab" + (tab === id ? " on" : ""), label);
        b.addEventListener("click", () => { tab = id; settings.tab = id; saveSettings(settings); showLobby(); });
        tabs.appendChild(b);
      }
      // crates & locker (pb-crates.js): a button next to the tabs and your credits
      const wallet = [];
      if (root.PBCrates && root.PBCrates.open) {
        const cb = el("button", "pb-tab pbc-tab", "🎁 Crates & Locker");
        cb.addEventListener("click", () => root.PBCrates.open(rootEl, {}));
        tabs.appendChild(cb);
        wallet.push(root.PBCrates.creditsBadge());
      }
      const x = el("button", "pb-x", "✕ Back to the hub");
      x.addEventListener("click", close);
      head.append(h1, tabs, ...wallet, x);
      lob.appendChild(head);
      rootEl.appendChild(lob);

      if (tab === "online") {
        if (!root.PBOnline) { lob.appendChild(el("p", null, "Online play didn't load.")); return; }
        if (!online) online = root.PBOnline.create(onlineCtx);
        online.render(lob);
        return;
      }

      const cols = el("div", "pb-cols");
      const colYou = el("div", "pb-col");
      colYou.appendChild(el("h2", null, "Play as"));
      colYou.appendChild(miiPicker(opts, recs, you, opp, (r) => { you = r; if (opp === you) opp = recs.find((o) => o !== you); showLobby(); }));
      const colOpp = el("div", "pb-col");
      colOpp.appendChild(el("h2", null, "Opponent"));
      colOpp.appendChild(miiPicker(opts, recs, opp, you, (r) => { opp = r; showLobby(); }, (r) => {
        const st = opts.statsFor(r);
        return root.MiniGames.skillLevel(st.skill) + " · " + Math.round(st.skill);
      }));
      cols.append(colYou, colOpp);

      const bottom = el("div", "pb-bottom");
      const setBox = el("div", "pb-box");
      setBox.appendChild(el("h3", null, "Settings"));
      settingsControls(setBox, settings, () => saveSettings(settings));
      const goWrap = el("div");
      const modes = el("div", "pb-modes");
      for (const [id, label, sub] of [["respawn", "Respawn", "first to " + RESPAWN_TO_WIN + " eliminations"], ["rounds", "Rounds", "first to " + TO_WIN + " rounds"]]) {
        const b = el("button", "pb-mode" + (settings.mode === id ? " on" : ""));
        b.append(el("b", null, label), el("span", null, sub));
        b.addEventListener("click", () => { settings.mode = id; saveSettings(settings); showLobby(); });
        modes.appendChild(b);
      }
      const go = el("button", "pb-go", "PLAY ▶");
      if (!you || !opp) { go.disabled = true; go.style.opacity = 0.4; }
      go.addEventListener("click", () => {
        settings.player = you.id; settings.opponent = opp.id;
        saveSettings(settings);
        startMatch();
      });
      goWrap.append(modes, go, el("div", "pb-vs", you && opp ? (you.name + " vs " + opp.name) : "You need at least 2 Miis"));
      bottom.append(setBox, controlsBox(), goWrap);
      lob.append(cols, mapPicker(), bottom);
    }

    // VS a Mii: play on any map (or a random one)
    function mapPicker() {
      const box = el("div", "pb-box pb-maps");
      box.appendChild(el("h3", null, "Map"));
      const grid = el("div", "pb-map-grid");
      const maps = LY() ? LY().MAPS : [];
      const icon = (m) => { const st = LY().SETTINGS.find((x) => x.id === m.setting); return st ? st.icon : "🎯"; };
      for (const m of maps.concat([{ id: "random", name: "Random", desc: "Any map, picked by chance." }])) {
        const b = el("button", "pb-map" + ((settings.map || "shipment_park") === m.id ? " on" : ""));
        b.append(el("i", null, m.id === "random" ? "🎲" : icon(m)), el("b", null, m.name), el("span", null, m.desc || ""));
        b.addEventListener("click", () => { settings.map = m.id; saveSettings(settings); showLobby(); });
        grid.appendChild(b);
      }
      box.appendChild(grid);
      return box;
    }

    function loading(text) {
      rootEl.innerHTML = "";
      const load = el("div", "pb-loading", text || "LOADING");
      load.appendChild(el("i"));
      rootEl.appendChild(load);
      return load;
    }

    async function startMatch() {
      let mapId = settings.map;
      if (mapId === "random" && LY()) mapId = LY().MAPS[Math.floor(Math.random() * LY().MAPS.length)].id;
      mapId = validMap(mapId);
      const load = loading("LOADING " + mapName(mapId).toUpperCase());
      await new Promise((r) => setTimeout(r, 30));
      try {
        const [tYou, tOpp] = await Promise.all([opts.templateFor(you), opts.templateFor(opp)]);
        match = new Match({
          root: rootEl, opts, settings, you, opp, tYou, tOpp, mode: settings.mode, map: mapId,
          onExit: (to) => { if (to === "lobby") showLobby(); else close(); },
          onRematch: () => startMatch(),
        });
        load.remove();
        current.match = match;
        root.__pb = match; // for tests
      } catch (err) {
        console.error(err);
        load.textContent = "Couldn't start Paintball: " + err.message;
        setTimeout(showLobby, 2500);
      }
    }

    // what the online lobby (pb-online.js) needs from here
    const onlineCtx = {
      opts, settings, recs, el, miiPicker, settingsControls, controlsBox, portraitImg,
      save: () => saveSettings(settings),
      get you() { return you; },
      setYou(r) { you = r; settings.player = r.id; saveSettings(settings); },
      paintFor: paintColor,
      refresh: () => { if (!match) showLobby(); },
      // the room's match is starting: build it
      async startOnline(cfg) {
        if (match) { match.dispose(); match = null; }
        const mapId = validMap(cfg.map);
        const load = loading("LOADING " + mapName(mapId).toUpperCase());
        try {
          const tYou = await opts.templateFor(you);
          match = new Match({
            root: rootEl, opts, settings, you, tYou, net: cfg.net, roster: cfg.roster, youColor: cfg.youColor, map: mapId,
            initial: cfg.initial, roomName: cfg.roomName,
            onExit: (to) => { match && match.dispose(); match = null; root.__pb = null; if (cfg.onLeave) cfg.onLeave(); if (to === "hub") close(); else showLobby(); },
          });
          load.remove();
          current.match = match;
          root.__pb = match;
          return match;
        } catch (err) {
          console.error(err);
          load.textContent = "Couldn't start Paintball: " + err.message;
          setTimeout(showLobby, 2500);
          return null;
        }
      },
      inMatch: () => !!match,
    };

    current = { close, match: null, get online() { return online; } };
    showLobby();
    return current;
  }

  // the sliders and buttons for sensitivity, volume and crosshair
  function settingsControls(box, settings, onChange) {
    const slider = (label, key, min, max, step, fmt) => {
      const row = el("div", "pb-set");
      const val = el("span", "val", fmt(settings[key]));
      const inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = settings[key];
      inp.addEventListener("input", () => { settings[key] = parseFloat(inp.value); val.textContent = fmt(settings[key]); onChange(key); });
      row.append(el("label", null, label), inp, val);
      box.appendChild(row);
    };
    slider("Sensitivity", "sens", 0.3, 6, 0.05, (v) => v.toFixed(2));
    slider("Field of view", "fov", 60, 150, 1, (v) => Math.round(v) + "°");
    slider("Volume", "volume", 0, 1, 0.05, (v) => Math.round(v * 100) + "%");
    slider("Crosshair size", "xhSize", 2, 12, 1, (v) => v);
    slider("Crosshair gap", "xhGap", 0, 10, 1, (v) => v);
    const row = el("div", "pb-set");
    row.appendChild(el("label", null, "Crosshair"));
    const sw = el("div", "pb-swatches");
    for (const c of ["#3dff6e", "#ffe94d", "#3de0ff", "#ffffff", "#ff4fd8", "#ff3b30"]) {
      const b = el("button", "pb-sw" + (settings.xhColor === c ? " sel" : ""));
      b.style.background = c;
      b.addEventListener("click", () => { settings.xhColor = c; sw.querySelectorAll(".pb-sw").forEach((n) => n.classList.remove("sel")); b.classList.add("sel"); onChange("xhColor"); });
      sw.appendChild(b);
    }
    const style = el("button", "pb-btn", settings.xhStyle === "dynamic" ? "Dynamic" : "Static");
    style.style.padding = "3px 10px";
    style.addEventListener("click", () => { settings.xhStyle = settings.xhStyle === "dynamic" ? "static" : "dynamic"; style.textContent = settings.xhStyle === "dynamic" ? "Dynamic" : "Static"; onChange("xhStyle"); });
    row.append(sw, style);
    box.appendChild(row);
  }

  // =====================================================================
  // A match
  //   offline: you vs one Mii (the bot), "respawn" or "rounds"
  //   online:  you vs everyone in the room, "respawn" (the server keeps score)
  // =====================================================================
  class Match {
    constructor(o) {
      this.o = o;
      this.opts = o.opts;
      this.settings = o.settings;
      this.rootEl = o.root;
      this.net = o.net || null;
      this.online = !!this.net;
      this.mode = this.online ? "respawn" : (o.mode === "rounds" ? "rounds" : "respawn");
      this.toWin = this.mode === "rounds" ? TO_WIN : (o.toWin || RESPAWN_TO_WIN);
      this.timeLimit = this.mode === "respawn" ? (o.timeLimit ? o.timeLimit / 1000 : TIME_LIMIT) : 0;
      this.now = 0;
      this.disposed = false;
      this.paused = false;
      this.phase = "freeze";
      this.phaseEnd = 0;
      this.round = 0;
      this.timers = [];
      this.keys = new Set();
      this.mouse = { left: false, right: false, swayX: 0, swayY: 0 };
      this.jumpQueued = false;
      this.botLearned = 0;
      this.fighters = [];
      this.byNet = new Map();
      this.loadout = E.LOADOUTS[this.settings.loadout] ? this.settings.loadout : "ak";
      this.sendT = 0;
      this.build();
      this.bindInput();
      if (this.online) this.bindNet();
      this.begin();
      this.loop();
    }

    // for older tests: the score as { you, bot }
    get score() { return { you: this.you.score, bot: this.bot ? this.bot.score : this.leader().score }; }
    set score(v) { this.you.score = v.you; if (this.bot) this.bot.score = v.bot; }

    // ------------------------------------------------------------------
    // Setting up the 3D world
    // ------------------------------------------------------------------
    build() {
      const o = this.o;
      const canvas = el("canvas");
      this.rootEl.appendChild(canvas);
      this.canvas = canvas;
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      // the hub's graphics quality (⚙️ Settings): a less sharp picture and plain shadow edges on slower computers
      const gq = this.opts && typeof this.opts.graphics === "function" ? this.opts.graphics() : "high";
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, gq === "low" ? 0.85 : gq === "medium" ? 1.25 : 1.5));
      r.shadowMap.enabled = true;
      r.shadowMap.type = gq === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      r.outputEncoding = THREE.sRGBEncoding;
      this.renderer = r;

      // the map
      this.scene = new THREE.Scene();
      this.loadMap(validMap(o.map));

      this.camera = new THREE.PerspectiveCamera(verticalFov(this.settings.fov), 16 / 9, 0.03, 400);
      this.camera.rotation.order = "YXZ";
      this.scene.add(this.camera);

      // first-person hands + gun, drawn on top with their own camera (like CS's viewmodel)
      this.vmScene = new THREE.Scene();
      this.vmCamera = new THREE.PerspectiveCamera(68, 16 / 9, 0.01, 10);
      // (the hands and gun bring their own lights)
      const lookYou = this.opts.lookFor(o.you, o.tYou) || {};
      const youPaint = o.youColor || paintColor(o.tYou);
      this.vm = root.PBModels.createViewmodel({
        accent: youPaint,
        sleeve: hexOf(lookYou.shirt, hexOf(o.tYou.source && o.tYou.source.shirt, "#2b7cff")),
        // (softened a little: under the bright first-person lights Mii skin looks too red)
        skin: "#" + new THREE.Color(hexOf(lookYou.skin, hexOf(o.tYou.source && o.tYou.source.skin, "#f2c7a5"))).lerp(new THREE.Color("#f1d3c0"), 0.35).getHexString(),
      });
      this.vmScene.add(this.vm.group);
      // your equipped skins (from the crates locker), kept up to date if you change them mid-match
      this.mySkins = root.PBCrates && PBCrates.equipped ? PBCrates.equipped() : { ak: null, awp: null, deagle: null, knife: null };
      if (this.vm.setSkins) this.vm.setSkins(this.mySkins);
      this.earned = 0;
      this.skinsOff = root.PBCrates && PBCrates.onChange ? PBCrates.onChange(() => {
        const s = PBCrates.equipped();
        if (JSON.stringify(s) === JSON.stringify(this.mySkins)) return;
        this.mySkins = s;
        if (this.vm.setSkins) this.vm.setSkins(s);
        if (this.you) { this.you.skins = s; this.reskinAvatar(this.you); }
        if (this.online && this.net) this.net.send({ t: "skins", s });
      }) : null;

      this.audio = root.PBAudio.create();
      this.audio.setVolume(this.settings.volume);

      // paint
      this.splatTex = root.PBModels.splatTextures();
      this.splats = [];
      this.splatMats = new Map();
      this.splatGeo = new THREE.PlaneGeometry(1, 1);
      this.balls = [];
      this.ballGeo = new THREE.SphereGeometry(0.022, 8, 6);
      this.ballGeo.scale(1, 1, 3.5); // a little motion streak

      // the fighters
      this.you = this.addFighter("you", o.you.name, youPaint, o.you);
      this.you.skins = this.mySkins;
      this.you.portrait = this.opts.portraitFor(o.you);
      if (this.online) {
        this.you.netId = this.net.id;
        this.byNet.set(this.net.id, this.you);
        for (const p of o.roster || []) this.addRemote(p);
      } else {
        let botPaint = paintColor(o.tOpp);
        if (colorDistance(youPaint, botPaint) < 0.6) botPaint = colorDistance(youPaint, "#ff8a00") > 0.8 ? "#ff8a00" : "#3de0ff";
        const b = this.bot = this.addFighter("bot", o.opp.name, botPaint, o.opp);
        b.portrait = this.opts.portraitFor(o.opp);
        this.makeAvatar(b, o.tOpp, this.opts.lookFor(o.opp, o.tOpp) || {}, o.opp);
        b.brain = new E.BotBrain({ world: this.world }, b, this.botSkill(), root.Dialogue ? root.Dialogue.traits(o.opp) : null);
        b.brain.nav = this.nav;
      }

      this.buildHUD();
      this.resize();
      this.onResize = () => this.resize();
      window.addEventListener("resize", this.onResize);
    }

    // (Re)builds the map: what you see, what you bump into, the spawns and the bot's routes
    loadMap(id) {
      if (this.map) {
        this.scene.remove(this.map.group);
        try { this.map.dispose(); } catch (e) { /* ignore */ }
        // paint splats belong to the old walls
        for (const m of this.splats || []) this.scene.remove(m);
        if (this.splats) this.splats.length = 0;
      }
      this.mapId = id;
      this.map = scaleMap(root.PBMap.build({ map: id }), MAP_SCALE);
      this.scene.add(this.map.group);
      this.scene.background = this.map.background || new THREE.Color(0x6d7884);
      this.scene.fog = this.map.fog || null;
      // (one World for the whole match: the movers and the bot keep pointing at it)
      const w = new E.World(this.map);
      if (this.world) Object.assign(this.world, { boxes: w.boxes, cyls: w.cyls, bounds: w.bounds }); else this.world = w;
      this.spawns = this.map.spawns.a.concat(this.map.spawns.b);
      // the bot finds its way around with the same route-finder Miis use in the hub
      const obstacles = [];
      for (const b of this.map.boxes) if (b.y1 > CFG.step && b.y0 < 1.6) obstacles.push({ x: b.x, z: b.z, w: b.hw * 2, d: b.hd * 2, rot: -(b.rot || 0) });
      for (const c of this.map.cyls) if (c.y1 > CFG.step && c.y0 < 1.6) obstacles.push({ x: c.x, z: c.z, r: c.r });
      this.nav = new root.MiiNav.Nav(this.map.bounds, obstacles, 0.35);
      if (this.bot && this.bot.brain) { this.bot.brain.nav = this.nav; this.bot.brain.resetRound(); }
    }
    // online: the lobby moved on to another map
    useMap(id) {
      id = validMap(id);
      if (id === this.mapId) return;
      this.loadMap(id);
      for (const f of this.fighters) if (f.mover && f !== this.you) f.mover.place(f.mover.pos.x, f.mover.pos.z);
      this.notice("Map: " + mapName(id));
    }

    addFighter(kind, name, color, rec) {
      const f = {
        id: kind, kind, rec, name: name || "Mii", color,
        mover: new E.Mover(this.world), arms: new E.Arms(),
        yaw: 0, pitch: 0, hp: 100, alive: kind === "you" || kind === "bot", score: 0,
        boxes: [], feet: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 }, chest: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 },
        stats: { kills: 0, deaths: 0, hs: 0, dmg: 0, shots: 0, hits: 0 },
        taken: { dmg: 0, hits: 0 }, given: { dmg: 0, hits: 0 },
        flinch: 0, slashAlt: 0, landed: false, respawnAt: 0, walkPhase: 0, dead: 0, paint: [],
      };
      this.fighters.push(f);
      return f;
    }

    // the 3D Mii for the bot or another player
    makeAvatar(f, tpl, look, rec) {
      const inst = root.MiiModel.createInstance(tpl, look);
      inst.holder.scale.setScalar(MII_SCALE);
      inst.holder.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; } });
      this.scene.add(inst.holder);
      f.inst = inst;
      outlineGlow(inst.object, f.color);
      f.style = null;
      try {
        const st = root.MiiHub3D.animStyle(root.Dialogue.traits(rec));
        if (st && isFinite(st.stride)) f.style = st;
      } catch (e) { /* use the default way of moving */ }
      const find = (prefix) => { let r = null; inst.object.traverse((n) => { if (!r && n.isBone && n.name.replace(/_\d+$/, "") === prefix) r = n; }); return r; };
      const B = inst.rig.bones;
      const bone = (k) => (B[k] ? B[k].bone : null);
      f.bones = {
        head: bone("Head"), s1: bone("Spine_1"), s2: bone("Spine_2"),
        a1l: bone("Arm_1_L"), a2l: bone("Arm_2_L"), wl: find("Wrist_L"), a1r: bone("Arm_1_R"), a2r: bone("Arm_2_R"), wr: find("Wrist_R"),
        l1l: bone("Leg_1_L"), l2l: bone("Leg_2_L"), al: find("Ankle_L"), l1r: bone("Leg_1_R"), l2r: bone("Leg_2_R"), ar: find("Ankle_R"),
      };
      f.useBones = ["head", "s1", "s2", "l1l", "l2l", "l1r", "l2r"].every((k) => f.bones[k]);
      this.buildWorldGuns(f);
      f.inst.holder.visible = f.gun.visible = f.alive;
    }
    // the guns other players see in your Mii's hands (wearing your skins)
    buildWorldGuns(f) {
      const sk = f.skins || {};
      f.gunAK = root.PBModels.createWorldGun(f.color, "ak", sk.ak || null);
      f.gunAWP = root.PBModels.createWorldGun(f.color, "awp", sk.awp || null);
      f.gunDG = root.PBModels.createWorldGun(f.color, "deagle", sk.deagle || null);
      for (const g of [f.gunAK, f.gunAWP, f.gunDG]) { g.traverse((n) => { if (n.isMesh) n.castShadow = true; }); this.scene.add(g); g.visible = false; }
      f.gun = this.worldGunFor(f);
    }
    worldGunFor(f) {
      const id = f.arms ? f.arms.gunId() : "ak";
      return id === "deagle" ? f.gunDG : id === "awp" ? f.gunAWP : f.gunAK;
    }
    reskinAvatar(f) {
      if (!f.inst || !f.gunAK) return;
      const vis = f.gun.visible;
      f.gunAK.removeFromParent(); f.gunAWP.removeFromParent(); f.gunDG.removeFromParent();
      this.buildWorldGuns(f);
      f.gun.visible = vis;
    }

    // another player (online). p = { id, name, color, rec, tpl, look }
    addRemote(p) {
      if (this.byNet.has(p.id)) return this.byNet.get(p.id);
      const f = this.addFighter("remote", p.name, p.color || "#ff8a00", p.rec);
      f.netId = p.id;
      f.skins = p.skins || null;
      f.alive = false;
      f.snaps = [];
      f.portrait = p.rec ? this.opts.portraitFor(p.rec) : "";
      this.byNet.set(p.id, f);
      if (p.spawn) { f.mover.place(p.spawn.x, p.spawn.z); f.yaw = p.spawn.yaw || 0; f.alive = true; } // already playing (you joined late)
      if (p.tpl) this.makeAvatar(f, p.tpl, p.look || {}, p.rec);
      if (this.hudBoard) this.updateScore();
      return f;
    }

    removeRemote(id) {
      const f = this.byNet.get(id);
      if (!f || f === this.you) return;
      this.byNet.delete(id);
      this.fighters = this.fighters.filter((x) => x !== f);
      if (f.inst) { f.inst.holder.removeFromParent(); if (root.MiiModel.disposeObject) root.MiiModel.disposeObject(f.inst.holder); }
      if (f.gun) { f.gunAK.removeFromParent(); f.gunAWP.removeFromParent(); f.gunDG.removeFromParent(); }
      this.notice(f.name + " left");
      this.updateScore();
    }

    botSkill() {
      const st = this.opts.statsFor(this.o.opp);
      return clamp(0.08 + (st.skill / 100) * 0.92, 0, 1);
    }

    others(f) { return this.fighters.filter((x) => x !== f); }
    enemiesOf(f) { return this.fighters.filter((x) => x !== f && x.alive); }
    // the best player who isn't you
    leader() {
      let best = null;
      for (const f of this.fighters) if (f !== this.you && (!best || f.score > best.score)) best = f;
      return best || this.you;
    }

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    }

    // ------------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------------
    buildHUD() {
      const hud = el("div", "pb-hud");
      const team = (cls) => {
        const t = el("div", "pb-team " + cls);
        const img = el("img"); img.alt = "";
        const nm = el("span", "nm", "");
        const sc = el("b", "sc", "0");
        t.append(img, nm, sc);
        return { t, img, nm, sc };
      };
      const top = el("div", "pb-top");
      this.hudLeft = team("you"); this.hudRight = team("opp");
      const clock = el("div", "pb-clock");
      const tm = el("div", "tm", "0:00");
      this.hudSub = el("div", "sub", "");
      clock.append(tm, this.hudSub);
      top.append(this.hudLeft.t, clock, this.hudRight.t);
      this.hudClock = tm;

      this.hudFeed = el("div", "pb-feed");
      this.hudXH = el("div", "pb-xh");
      this.hudBanner = el("div", "pb-banner");
      const hp = el("div", "pb-hp");
      this.hudHP = el("b", null, "100");
      const bar = el("div", "bar"); this.hudHPBar = el("i"); bar.appendChild(this.hudHPBar);
      hp.append(el("span", "plus", "✚"), this.hudHP, bar);
      const ammo = el("div", "pb-ammo");
      this.hudMag = el("b", "mag", "30"); this.hudRes = el("span", "res", "/ 90"); this.hudWpn = el("span", "wn", "Paint AK");
      this.hudReload = el("span", "rl", "");
      ammo.append(this.hudReload, this.hudWpn, this.hudMag, this.hudRes);
      this.hudSlots = el("div", "pb-slots");
      this.hudSlotAK = el("span", null, "1 · PAINT AK"); this.hudSlotDG = el("span", null, "2 · PAINT DEAGLE"); this.hudSlotKnife = el("span", null, "3 · BUTTERFLY KNIFE");
      this.hudSlots.append(this.hudSlotAK, this.hudSlotDG, this.hudSlotKnife);
      this.hudHurt = el("div", "pb-hurt");
      this.hudDir = el("div", "pb-dir"); this.hudDirArc = el("i"); this.hudDir.appendChild(this.hudDirArc);
      this.hudSplats = el("div", "pb-splats");
      this.hudBoard = el("div", "pb-board");
      this.hudDeath = el("div", "pb-death");
      this.hudHint = el("div", "pb-hint", "");
      this.hudNet = el("div", "pb-net", "");
      // the AWP's scope: black all round, with thin cross lines
      this.hudScope = el("div", "pb-scope");
      this.hudScope.append(el("i", "h"), el("i", "v"));
      this.hudLoadout = el("div", "pb-loadout");
      hud.append(this.hudScope, this.hudLoadout, this.hudSplats, this.hudHurt, this.hudDir, top, this.hudFeed, this.hudXH, this.hudBanner, hp, ammo, this.hudSlots, this.hudDeath, this.hudHint, this.hudNet, this.hudBoard);
      this.rootEl.appendChild(hud);
      this.hud = hud;

      // overlays: click to play, the menu (Esc), results
      this.ovClick = el("div", "pb-overlay");
      const p1 = el("div", "pb-panel");
      const title = this.online ? "🌐 " + (this.o.roomName || "Online match") : "🎯 " + this.you.name + " vs " + this.bot.name;
      p1.append(el("h2", null, title), el("p", null, "Click to play. Your mouse controls your aim (press Esc for the menu)."));
      p1.appendChild(el("button", "pb-btn primary", "Click to play"));
      this.ovClick.appendChild(p1);
      this.ovClick.addEventListener("click", () => this.lock());

      this.ovPause = el("div", "pb-overlay");
      const p2 = el("div", "pb-panel");
      p2.append(el("h2", null, this.online ? "Menu" : "Paused"));
      if (this.online) p2.appendChild(el("p", null, "The match keeps going while you're in here!"));
      const setBox = el("div");
      settingsControls(setBox, this.settings, (k) => {
        saveSettings(this.settings);
        if (k === "volume") this.audio.setVolume(this.settings.volume);
        if (k === "fov") { this.camera.fov = verticalFov(this.settings.fov); this.camera.updateProjectionMatrix(); }
        this.drawCrosshair();
      });
      const btns = el("div", "btns");
      const resume = el("button", "pb-btn primary", "Resume");
      resume.addEventListener("click", (e) => { e.stopPropagation(); this.lock(); });
      const quit = el("button", "pb-btn", this.online ? "Leave match" : "Quit match");
      quit.addEventListener("click", (e) => { e.stopPropagation(); this.quit(); });
      btns.append(resume, quit);
      p2.append(setBox, btns);
      this.ovPause.appendChild(p2);

      this.ovResult = el("div", "pb-overlay");
      this.rootEl.append(this.ovClick, this.ovPause, this.ovResult);
      this.ovClick.classList.add("show");
      this.paused = true;
      this.drawCrosshair();
      this.updateScore();
    }

    drawCrosshair(spread) {
      const s = this.settings;
      const xh = this.hudXH;
      xh.style.setProperty("--xc", s.xhColor);
      const len = s.xhSize * 2, th = 2;
      const gap = s.xhGap + (s.xhStyle === "dynamic" ? Math.min(40, (spread || 0) * 260) : 0);
      if (!xh.children.length) for (let i = 0; i < 4; i++) xh.appendChild(el("i"));
      const [t, b, l, r] = xh.children;
      t.style.cssText = `left:${-th / 2}px;top:${-gap - len}px;width:${th}px;height:${len}px`;
      b.style.cssText = `left:${-th / 2}px;top:${gap}px;width:${th}px;height:${len}px`;
      l.style.cssText = `top:${-th / 2}px;left:${-gap - len}px;width:${len}px;height:${th}px`;
      r.style.cssText = `top:${-th / 2}px;left:${gap}px;width:${len}px;height:${th}px`;
    }

    // the score at the top: you on the left, the best of the others on the right
    updateScore() {
      if (!this.hudLeft) return;
      const set = (side, f) => {
        if (!f.portrait && f.rec) f.portrait = this.opts.portraitFor(f.rec);
        side.t.style.setProperty("--c", f.color);
        if (side.img.getAttribute("src") !== (f.portrait || "")) side.img.src = f.portrait || "";
        side.nm.textContent = f.name;
        side.sc.textContent = f.score;
      };
      set(this.hudLeft, this.you);
      const other = this.bot || this.leader();
      if (other && other !== this.you) set(this.hudRight, other);
      this.hudRight.t.style.visibility = other && other !== this.you ? "" : "hidden";
      this.hudSub.textContent = this.phase === "warmup" ? "Waiting for players" : this.mode === "rounds" ? "First to " + this.toWin + " rounds" : "First to " + this.toWin;
    }

    banner(big, small, cls, secs) {
      const b = this.hudBanner;
      b.className = "pb-banner show " + (cls || "");
      b.innerHTML = "";
      b.append(el("div", "big", big));
      if (small) b.append(el("div", "small", small));
      clearTimeout(this.bannerT);
      if (secs) this.bannerT = setTimeout(() => b.classList.remove("show"), secs * 1000);
    }

    notice(text) {
      const k = el("div", "pb-kill note", text);
      this.hudFeed.appendChild(k);
      setTimeout(() => k.remove(), 5000);
    }

    killFeed(killer, victim, weapon, head) {
      const k = el("div", "pb-kill" + (killer === this.you || victim === this.you ? " mine" : ""));
      const a = el("span", null, killer.name); a.style.color = killer.color;
      const v = el("span", null, victim.name); v.style.color = victim.color;
      k.append(a, el("span", "wpn", (weapon === "knife" ? "🔪" : weapon === "awp" ? "🔭 AWP" : weapon === "deagle" ? "🦅 Deagle" : "🔫") + (head && weapon !== "knife" ? " 🎯" : "")), v);
      this.hudFeed.appendChild(k);
      setTimeout(() => k.remove(), 6000);
      while (this.hudFeed.children.length > 6) this.hudFeed.firstChild.remove();
    }

    renderBoard() {
      const b = this.hudBoard;
      b.innerHTML = "";
      const h = el("h3");
      const mn = mapName(this.mapId);
      const title = this.mode === "rounds" ? mn + " · Round " + this.round : this.online ? mn + " · " + (this.o.roomName || "Online") : mn + " · Respawn";
      h.append(el("span", null, title), el("small", null, this.mode === "rounds" ? "First to " + this.toWin + " rounds" : "First to " + this.toWin + " eliminations"));
      b.appendChild(h);
      const tbl = el("table");
      tbl.innerHTML = "<tr><th>Player</th><th>" + (this.mode === "rounds" ? "Rounds" : "Score") + "</th><th>K</th><th>D</th><th>HS %</th><th>DMG</th><th>Accuracy</th>" + (this.online ? "<th>Ping</th>" : "") + "</tr>";
      const list = this.fighters.slice().sort((x, y) => y.score - x.score || y.stats.kills - x.stats.kills);
      for (const f of list) {
        const tr = el("tr", f === this.you ? "me" : "");
        const s = f.stats;
        const name = el("td");
        const img = el("img"); img.alt = "";
        if (!f.portrait && f.rec) f.portrait = this.opts.portraitFor(f.rec);
        if (f.portrait) img.src = f.portrait;
        const extra = f === this.you ? " (you)" : f === this.bot ? " · " + root.MiniGames.skillLevel(this.opts.statsFor(this.o.opp).skill) : "";
        const nm = el("span", null, f.name + extra);
        nm.style.color = f.color;
        name.append(img, nm);
        tr.appendChild(name);
        const mine = f === this.you || f === this.bot; // we only know shots/accuracy for players on this computer
        const cells = [f.score, s.kills, s.deaths, s.kills ? Math.round((s.hs / s.kills) * 100) + "%" : "–", mine ? s.dmg : "–", mine && s.shots ? Math.round((s.hits / s.shots) * 100) + "%" : "–"];
        if (this.online) cells.push(f === this.you ? (this.net.ping != null ? this.net.ping + " ms" : "–") : "");
        for (const c of cells) tr.appendChild(el("td", null, String(c)));
        tbl.appendChild(tr);
      }
      b.appendChild(tbl);
    }

    // ------------------------------------------------------------------
    // Input
    // ------------------------------------------------------------------
    lock() {
      this.audio.resume();
      const c = this.canvas;
      try {
        const p = c.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (e) { /* ignore */ } });
      } catch (e) { try { c.requestPointerLock(); } catch (e2) { /* ignore */ } }
    }
    locked() { return document.pointerLockElement === this.canvas; }

    bindInput() {
      const onLock = () => {
        if (this.disposed) return;
        if (this.locked()) {
          this.paused = false;
          this.ovClick.classList.remove("show");
          this.ovPause.classList.remove("show");
        } else if (!this.over) {
          // offline the game pauses; online it can't (everyone else keeps playing)
          if (!this.online) this.paused = true;
          this.keys.clear(); this.mouse.left = this.mouse.right = false;
          this.ovPause.classList.add("show");
        }
      };
      const onMove = (e) => {
        if (!this.locked() || this.paused) return;
        const k = this.settings.sens * 0.022 * DEG * this.zoomSens();
        const f = this.you;
        if (!f.alive) return;
        f.yaw -= e.movementX * k;
        f.pitch = clamp(f.pitch - e.movementY * k, -89 * DEG, 89 * DEG);
        this.mouse.swayX += e.movementX; this.mouse.swayY += e.movementY;
      };
      const onDown = (e) => {
        if (!this.locked()) return;
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2) { this.mouse.right = true; this.zoomQueued = true; }
      };
      const onUp = (e) => {
        if (e.button === 0) this.mouse.left = false;
        if (e.button === 2) this.mouse.right = false;
      };
      const onKey = (e) => {
        if (this.disposed) return;
        const code = e.code;
        if (code === "Tab") { e.preventDefault(); this.renderBoard(); this.hudBoard.classList.add("show"); }
        // picking a class (the loadout screen is open, or you're waiting to respawn) works even before you click in
        if (this.loadoutOpen && !e.repeat && (code === "Digit1" || code === "Digit2")) { e.preventDefault(); this.pickLoadout(code === "Digit1" ? "ak" : "awp"); return; }
        if (!this.locked()) return;
        e.preventDefault(); e.stopPropagation();
        if (e.repeat) return;
        this.keys.add(code);
        if (code === "KeyB") { this.showLoadout(!this.loadoutOpen); return; }
        if (code === "Space") this.jumpQueued = true;
        if (code === "KeyR") this.wantReload = true;
        if (code === "Digit1") this.wantSwitch = "primary";
        if (code === "Digit2") this.wantSwitch = "secondary";
        if (code === "Digit3") this.wantSwitch = "knife";
        // Q: back to whatever you had out before (like CS)
        if (code === "KeyQ") this.wantSwitch = this.you.arms.last || "knife";
        if (code === "KeyF") this.wantInspect = true;
      };
      const onKeyUp = (e) => {
        this.keys.delete(e.code);
        if (e.code === "Tab") { e.preventDefault(); this.hudBoard.classList.remove("show"); }
      };
      const onWheel = (e) => {
        if (!this.locked()) return;
        e.preventDefault();
        // the wheel goes through gun -> Deagle -> knife
        const order = ["primary", "secondary", "knife"], a = this.you.arms;
        const cur = a.weapon === "knife" ? 2 : a.weapon === a.secondary ? 1 : 0;
        this.wantSwitch = order[(cur + (e.deltaY > 0 ? 1 : 2)) % 3];
      };
      const noMenu = (e) => e.preventDefault();
      document.addEventListener("pointerlockchange", onLock);
      document.addEventListener("mousemove", onMove);
      this.canvas.addEventListener("mousedown", onDown);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("keyup", onKeyUp, true);
      this.canvas.addEventListener("wheel", onWheel, { passive: false });
      this.rootEl.addEventListener("contextmenu", noMenu);
      this.unbind = () => {
        document.removeEventListener("pointerlockchange", onLock);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("keyup", onKeyUp, true);
      };
    }

    // ------------------------------------------------------------------
    // Online: messages from the server
    // ------------------------------------------------------------------
    bindNet() {
      const N = this.net;
      const fOf = (id) => this.byNet.get(id);
      this.netOff = N.handle({
        st: (m) => {
          const f = fOf(m.id);
          if (!f || f === this.you) return;
          f.snaps.push({ t: performance.now() / 1000, s: m.s });
          if (f.snaps.length > 30) f.snaps.shift();
        },
        shot: (m) => {
          const f = fOf(m.id);
          if (!f) return;
          const o = { x: m.o[0], y: m.o[1], z: m.o[2] }, e = { x: m.e[0], y: m.e[1], z: m.e[2] };
          const d = Math.hypot(o.x - this.camera.position.x, o.z - this.camera.position.z);
          const gw = m.w === "awp" || m.w === "deagle" ? m.w : "ak";
          this.playAt(gw + (d > 18 ? "Far" : ""), o, 0.9, 0.95 + Math.random() * 0.1);
          this.launchBall(new THREE.Vector3(o.x, o.y, o.z), e, f.color);
          if (m.n) {
            const dist = Math.hypot(e.x - o.x, e.y - o.y, e.z - o.z);
            this.later(dist / 140, () => {
              this.splat(e, { x: m.n[0], y: m.n[1], z: m.n[2] }, f.color, 0.22 + Math.random() * 0.14);
              this.playAt(m.m === "wood" ? "hitWood" : "hitWall", e, 0.5);
            });
          }
        },
        ev: (m) => {
          const f = fOf(m.id);
          if (!f || !f.alive) return;
          const sounds = { step: ["step", 0.9], land: ["land", 0.8], magOut: ["magOut", 0.6], magIn: ["magIn", 0.6], awpMagOut: ["awpMagOut", 0.6], awpMagIn: ["awpMagIn", 0.6], awpBolt: ["awpBolt", 0.6], deagleMagOut: ["deagleMagOut", 0.6], deagleMagIn: ["deagleMagIn", 0.6], deagleSlide: ["deagleSlide", 0.6], deploy: ["deploy", 0.5], knifeDeploy: ["knifeDeploy", 0.5], slash: ["slash", 0.7], stab: ["stab", 0.7] };
          const s = sounds[m.k];
          if (s) this.playAt(s[0], f.mover.pos, s[1], 0.92 + Math.random() * 0.16);
          if (m.k === "knife" || m.k === "ak") f.arms.weapon = m.k;
        },
        dmg: (m) => {
          const v = fOf(m.v), a = fOf(m.by);
          if (!v || !a) return;
          v.hp = m.hp;
          v.taken.dmg += m.d; v.taken.hits++;
          a.given.dmg += m.d; a.given.hits++;
          if (v === this.you) {
            const vel = this.you.mover.vel;
            if (this.you.mover.onGround) { vel.x *= 0.45; vel.z *= 0.45; }
            this.you.arms.recY += m.z === "head" ? 1.2 : 0.6;
            this.you.flinch = 1;
            this.screenSplat(a.color, m.z === "head" ? 1.4 : 1);
            this.audio.play(m.z === "head" ? "hitHead" : "hurt", { vol: 0.8 });
            this.hurtFrom(a);
          }
        },
        kill: (m) => {
          const v = fOf(m.v), a = fOf(m.by);
          if (!v || !a) return;
          if (m.scores) for (const [id, sc] of Object.entries(m.scores)) { const f = fOf(id); if (f) f.score = sc; }
          this.kill(a, v, m.w, !!m.h, !!m.b, true);
        },
        spawn: (m) => {
          const f = fOf(m.id);
          if (!f || f === this.you) return;
          f.mover.place(m.x, m.z);
          f.yaw = m.yaw; f.pitch = 0; f.hp = 100;
          f.snaps.length = 0;
          f.alive = true;
          this.resetAvatar(f);
        },
        bye: (m) => this.removeRemote(m.id),
        skins: (m) => { const f = fOf(m.id); if (f && f !== this.you) { f.skins = m.s; this.reskinAvatar(f); } },
        room: (m) => {
          for (const p of m.room.players) { const f = fOf(p.id); if (f) { f.score = p.score; f.stats.deaths = Math.max(f.stats.deaths, p.deaths); } }
          this.updateScore();
        },
        warmup: (m) => this.netWarmup(m),
        start: (m) => this.netStart(m, 0),
        round: (m) => this.netRound(m, 0),
        roundEnd: (m) => this.netRoundEnd(m),
        over: (m) => {
          if (m.scores) for (const [id, sc] of Object.entries(m.scores)) { const f = fOf(id); if (f) f.score = sc; }
          this.finish(fOf(m.winner) || null, m.late ? "You arrived just as a match ended" : null);
        },
        intermission: (m) => this.showVote(m, 0),
        votes: (m) => this.updateVotes(m),
        voted: (m) => this.voteResult(m),
        close: () => {
          if (this.over) return;
          this.banner("DISCONNECTED", "Lost the connection to the server", "lose");
          this.finish(null, "disconnected");
        },
      });
    }

    // a Mii that joined while the match was on
    addLateRemote(p) { const f = this.addRemote(p); this.notice(p.name + " joined"); return f; }

    // ------------------------------------------------------------------
    // Starting, rounds and respawning
    // ------------------------------------------------------------------
    begin() {
      if (this.online) {
        // what the lobby was doing when we came in (the messages arrived while this was loading)
        const I = this.o.initial || {};
        const age = (m) => (m && m.at ? (performance.now() - m.at) / 1000 : 0);
        if (I.phase && I.phase.t === "start") {
          this.netStart(I.phase, age(I.phase));
          if (I.round && I.round.at >= I.phase.at) this.netRound(I.round, age(I.round));
        } else this.netWarmup(I.phase);
        if (I.over && I.inter) { this.finish(null, "You arrived just as a match ended"); this.showVote(I.inter, age(I.inter)); if (I.votes) this.updateVotes(I.votes); }
        return;
      }
      if (this.mode === "rounds") { this.startRound(); return; }
      const freeze = this.online ? Math.max(0, (this.o.startIn || 0) / 1000) : FREEZE;
      this.phase = "freeze";
      this.phaseEnd = this.now + freeze;
      this.matchEnd = this.phaseEnd + this.timeLimit;
      // you and the bot start at opposite ends
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const flip = Math.random() < 0.5;
      // (online: as far as possible from the players we know about)
      this.respawn(this.you, this.online ? this.pickSpawn(this.you, true) : pick(flip ? this.map.spawns.a : this.map.spawns.b), true);
      if (this.bot) this.respawn(this.bot, pick(flip ? this.map.spawns.b : this.map.spawns.a), true);
      this.banner(this.online ? "GET READY" : "RESPAWN", "First to " + this.toWin + " eliminations", "", Math.max(1.5, freeze));
      this.showLoadout(true);
      if (this.online && freeze <= 0) this.goLive();
    }

    // ---- online lobbies: warmup, matches, rounds, voting ----
    resetStats() {
      for (const f of this.fighters) {
        f.score = 0;
        f.stats = { kills: 0, deaths: 0, hs: 0, dmg: 0, shots: 0, hits: 0 };
        f.taken = { dmg: 0, hits: 0 }; f.given = { dmg: 0, hits: 0 };
      }
    }
    // back from the results/vote screen into the game
    closeResults() {
      clearInterval(this.voteTimer);
      this.ovResult.classList.remove("show");
      this.over = false;
      if (!this.locked()) { this.ovClick.classList.add("show"); }
    }
    // nobody to play with: run around freely until someone joins
    netWarmup(m) {
      if (m && m.map) this.useMap(m.map);
      this.closeResults();
      this.phase = "warmup";
      this.mode = "respawn";
      this.resetStats();
      if (!this.you.alive || !this.warmed) { this.respawn(this.you, this.pickSpawn(this.you, true), true); this.sendSpawn(); }
      this.warmed = true;
      if (!this.warmShown) { this.warmShown = true; this.showLoadout(true); }
      this.banner("WARMUP", "Run around! The match starts when another player joins", "", 4);
      this.updateScore();
    }
    netStart(m, age) {
      if (m.map) this.useMap(m.map);
      this.closeResults();
      this.mode = m.mode === "rounds" ? "rounds" : "respawn";
      this.toWin = m.toWin || (this.mode === "rounds" ? 7 : RESPAWN_TO_WIN);
      this.timeLimit = (m.timeLimit || 0) / 1000;
      this.resetStats();
      const freeze = Math.max(0, (m.in || 0) / 1000 - (age || 0));
      this.phase = "freeze";
      this.phaseEnd = this.now + freeze;
      this.matchEnd = this.phaseEnd + this.timeLimit;
      if (!m.late) for (const f of this.fighters) if (f.kind === "remote") { f.alive = false; f.dead = 0; }
      const name = this.mode === "rounds" ? "ROUNDS" : "RESPAWN";
      const sub = this.mode === "rounds" ? "Last one standing wins the round · first to " + this.toWin : "First to " + this.toWin + " eliminations";
      if (this.mode === "respawn") {
        this.respawn(this.you, this.pickSpawn(this.you, true), true);
        this.banner(name, sub, "", Math.max(1.5, freeze));
        this.showLoadout(true);
        if (freeze <= 0) this.goLive();
      } else {
        // rounds: everyone comes in when the round starts (if you're late, you watch until the next one)
        this.you.alive = false;
        this.vm.group.visible = false;
        this.banner(name, m.late ? "You'll join at the start of the next round" : sub, "", 3);
        this.showLoadout(true);
      }
      this.updateScore();
    }
    netRound(m, age) {
      this.round = m.n;
      if (m.scores) for (const [id, sc] of Object.entries(m.scores)) { const f = this.byNet.get(id); if (f) f.score = sc; }
      const freeze = Math.max(0, (m.in || 0) / 1000 - (age || 0));
      this.phase = "freeze";
      this.phaseEnd = this.now + freeze;
      this.roundEnd = this.phaseEnd + ROUND_TIME;
      for (const f of this.fighters) if (f.kind === "remote") { f.alive = false; f.dead = 0; }
      this.respawn(this.you, this.pickSpawn(this.you, true), true);
      this.sendSpawn();
      this.banner("ROUND " + m.n, "First to " + this.toWin, "", Math.max(1.2, freeze));
      if (m.n === 1 || !this.loadoutOpen) this.showLoadout(true);
      this.updateScore();
    }
    netRoundEnd(m) {
      if (m.scores) for (const [id, sc] of Object.entries(m.scores)) { const f = this.byNet.get(id); if (f) f.score = sc; }
      this.phase = "end";
      const w = m.winner ? this.byNet.get(m.winner) : null;
      if (w === this.you) { this.banner("ROUND WON", "", "win", 3); this.audio.play("roundWin"); this.earn("round"); }
      else if (w) { this.banner(w.name.toUpperCase() + " WINS THE ROUND", "", "lose", 3); this.audio.play("roundLose"); }
      else this.banner("DRAW", "Nobody won the round", "", 3);
      this.updateScore();
    }

    // the 15 s vote for what to play next
    showVote(m, age) {
      if (!this.ovResult.classList.contains("show")) this.finish(null, null);
      const box = this.voteBox;
      if (!box) return;
      box.innerHTML = "";
      this.voteEnds = performance.now() + Math.max(0, (m.in || 0) - (age || 0) * 1000);
      const head = el("div", "pb-vote-head");
      const timer = el("b", null, "");
      head.append(el("span", null, "Vote for the next match"), timer);
      box.appendChild(head);
      const row = (title, list, key) => {
        box.appendChild(el("div", "pb-vote-title", title));
        const r = el("div", "pb-vote-row");
        for (const o of list) {
          const c = el("button", "pb-vote-card" + (list.length === 1 ? " sel" : ""));
          c.dataset.key = key; c.dataset.id = o.id;
          const known = key === "map" && LY() && LY().mapById(o.id);
          c.append(el("b", null, o.name), el("span", "desc", o.desc || (known ? known.desc : "")), el("span", "pb-votes", ""));
          c.addEventListener("click", () => {
            this.myVote = Object.assign(this.myVote || {}, { [key]: o.id });
            r.querySelectorAll(".pb-vote-card").forEach((n) => n.classList.toggle("sel", n === c));
            this.net.send(Object.assign({ t: "vote" }, this.myVote));
          });
          r.appendChild(c);
        }
        box.appendChild(r);
      };
      this.myVote = null;
      row("Mode", m.modes || [], "mode");
      row("Map", m.maps || [], "map");
      box.appendChild(el("div", "pb-help", "A tie is picked at random."));
      clearInterval(this.voteTimer);
      const tickVote = () => { timer.textContent = Math.max(0, Math.ceil((this.voteEnds - performance.now()) / 1000)) + "s"; };
      tickVote();
      this.voteTimer = setInterval(tickVote, 250);
    }
    updateVotes(m) {
      if (!this.voteBox) return;
      this.voteBox.querySelectorAll(".pb-vote-card").forEach((c) => {
        const n = ((c.dataset.key === "mode" ? m.modes : m.maps) || {})[c.dataset.id] || 0;
        c.querySelector(".pb-votes").textContent = n ? n + " vote" + (n === 1 ? "" : "s") : "";
      });
    }
    voteResult(m) {
      if (!this.voteBox) return;
      clearInterval(this.voteTimer);
      const names = { respawn: "Respawn", rounds: "Rounds" };
      const res = el("div", "pb-vote-result", "Next: " + (names[m.mode] || m.mode) + " on " + (m.name || mapName(m.map)) + (m.random ? " (random)" : ""));
      this.voteBox.appendChild(res);
    }

    goLive() {
      this.phase = "live";
      if (this.loadoutOpen && this.you.alive) this.showLoadout(false);
      this.banner("GO!", "", "", 0.8);
      this.audio.play("roundStart");
      if (this.online) this.sendSpawn();
    }

    startRound() {
      this.round++;
      this.phase = "freeze";
      this.phaseEnd = this.now + FREEZE;
      this.roundEnd = this.phaseEnd + ROUND_TIME;
      const swap = this.round % 2 === 0;
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const sa = pick(this.map.spawns.a), sb = pick(this.map.spawns.b);
      this.respawn(this.you, swap ? sb : sa, true);
      this.respawn(this.bot, swap ? sa : sb, true);
      this.banner("ROUND " + this.round, this.you.score + " – " + this.bot.score + (this.round > 1 ? "" : " · first to " + this.toWin), "", FREEZE);
      this.showLoadout(true);
      this.updateScore();
    }

    // Where to come back in: far from everyone, and out of their sight if possible
    pickSpawn(f, anyone) {
      // (at the start nobody's spawned yet, but we know where the others are standing)
      const foes = anyone ? this.others(f).filter((o) => o.snaps && o.snaps.length) : this.enemiesOf(f);
      let best = null, bestScore = -Infinity;
      for (const sp of this.spawns) {
        let near = Infinity, seen = false;
        const eye = { x: sp.x, y: CFG.eyeStand, z: sp.z };
        for (const o of foes) {
          const p = o.mover.pos;
          near = Math.min(near, Math.hypot(p.x - sp.x, p.z - sp.z));
          if (!seen && this.world.clear(eye, { x: p.x, y: p.y + CFG.eyeStand, z: p.z })) seen = true;
        }
        const sc = Math.min(near, 40) - (seen ? 25 : 0) + Math.random() * 4;
        if (sc > bestScore) { bestScore = sc; best = sp; }
      }
      return best || this.spawns[0];
    }

    respawn(f, sp, quiet) {
      sp = sp || this.pickSpawn(f);
      f.mover.place(sp.x, sp.z);
      f.yaw = sp.yaw; f.pitch = 0;
      f.hp = 100; f.alive = true; f.respawnAt = 0;
      f.arms.reset(f === this.you ? this.loadout : "ak");
      f.taken = { dmg: 0, hits: 0 }; f.given = { dmg: 0, hits: 0 };
      f.killer = null;
      if (f === this.you) {
        this.vm.setWeapon(f.arms.weapon);
        this.applyZoom();
        if (this.loadoutOpen && this.phase === "live") this.showLoadout(false);
        this.hudDeath.classList.remove("show");
        this.deathCam = null;
        if (this.online && (this.phase === "live" || this.phase === "warmup") && this.mode === "respawn") this.sendSpawn();
      }
      if (f.brain) { f.brain.setSkill(this.botSkill(), root.Dialogue ? root.Dialogue.traits(this.o.opp) : null); f.brain.resetRound(); }
      if (f.inst) this.resetAvatar(f);
      if (!quiet && f === this.you) this.audio.play("deploy", { vol: 0.5 });
    }

    sendSpawn() {
      const p = this.you.mover.pos;
      this.net.send({ t: "spawn", x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +this.you.yaw.toFixed(3) });
    }

    resetAvatar(f) {
      if (!f.inst) return;
      f.dead = 0;
      f.inst.holder.rotation.set(0, 0, 0);
      f.inst.holder.visible = true;
      f.gun.visible = true;
      for (const m of f.paint) m.removeFromParent();
      f.paint = [];
    }

    endRound(winner, why) {
      if (this.phase === "end") return;
      this.phase = "end";
      this.phaseEnd = this.now + END_DELAY;
      if (winner) winner.score++;
      this.updateScore();
      this.botLearns(winner);
      const matchOver = this.you.score >= this.toWin || this.bot.score >= this.toWin;
      if (winner === this.you) { this.banner(matchOver ? "VICTORY" : "ROUND WON", why || "", "win"); this.audio.play(matchOver ? "matchWin" : "roundWin"); this.earn("round"); }
      else if (winner === this.bot) { this.banner(matchOver ? "DEFEAT" : "ROUND LOST", why || "", "lose"); this.audio.play(matchOver ? "matchLose" : "roundLose"); }
      else this.banner("DRAW", why || "Time's up", "");
      if (matchOver) this.phaseEnd = this.now + 3;
    }

    // the Mii gets a little better every time it wins or loses a fight (a bit more when it loses)
    botLearns(winner) {
      if (!this.bot || !winner || !root.MiniGames || !root.MiniGames.learn) return;
      const st = this.opts.statsFor(this.o.opp);
      const before = st.skill;
      root.MiniGames.learn(st, "paintball", winner === this.you);
      this.botLearned += st.skill - before;
      this.opts.onSave(this.o.opp);
    }

    // ------------------------------------------------------------------
    // The game loop
    // ------------------------------------------------------------------
    loop() {
      let last = performance.now();
      let acc = 0;
      const frame = (t) => {
        if (this.disposed) return;
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        if (!this.paused || this.online) {
          acc += dt;
          let n = 0;
          while (acc >= TICK && n < 16) { this.tick(TICK); acc -= TICK; n++; }
          if (n >= 16) acc = 0;
        }
        this.draw(dt);
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }

    tick(dt) {
      if (this.over && !this.online) return;
      this.now += dt;
      const now = this.now;
      // timers (sounds during reloads etc.)
      if (this.timers.length) {
        for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= now) { const tm = this.timers[i]; this.timers.splice(i, 1); tm.fn(); }
      }

      if (this.phase === "freeze" && now >= this.phaseEnd) {
        if (this.mode === "rounds") { this.phase = "live"; this.banner("GO!", "", "", 0.8); this.audio.play("roundStart"); }
        else this.goLive();
      } else if (this.mode === "rounds" && !this.online) {
        if (this.phase === "live" && now >= this.roundEnd) this.endRound(null, "Time's up");
        else if (this.phase === "end" && now >= this.phaseEnd) {
          if (this.you.score >= this.toWin || this.bot.score >= this.toWin) { this.finish(this.you.score > this.bot.score ? this.you : this.bot); return; }
          this.startRound();
          return;
        }
      } else if (!this.online && this.phase === "live" && now >= this.matchEnd) {
        // time's up: whoever has more wins
        const y = this.you.score, b = this.bot.score;
        this.finish(y > b ? this.you : b > y ? this.bot : null, "Time's up");
        return;
      }
      // coming back after being splattered (respawn mode)
      if ((this.mode === "respawn" && this.phase === "live") || this.phase === "warmup") {
        for (const f of this.fighters) if (!f.alive && f.respawnAt && now >= f.respawnAt && f.kind !== "remote") this.respawn(f);
      }
      const frozen = this.phase !== "live" && this.phase !== "warmup";
      const playing = !this.over && (!this.online || this.locked() || !this.paused);

      // ---- you ----
      const y = this.you;
      if (y.alive) {
        const K = this.keys;
        const live = playing && !frozen;
        const inp = {
          fwd: (K.has("KeyW") ? 1 : 0) - (K.has("KeyS") ? 1 : 0),
          side: (K.has("KeyD") ? 1 : 0) - (K.has("KeyA") ? 1 : 0),
          yaw: y.yaw,
          walk: K.has("ShiftLeft") || K.has("ShiftRight"),
          duck: K.has("ControlLeft") || K.has("ControlRight") || K.has("KeyC"),
          jump: this.jumpQueued,
          maxSpeed: y.arms.maxSpeed(),
          frozen: frozen || this.over,
        };
        this.jumpQueued = false;
        y.mover.step(dt, inp);
        this.moverEvents(y);
        this.useWeapons(y, {
          fire: this.mouse.left && live, alt: this.mouse.right && live, zoom: this.zoomQueued && live,
          reload: this.wantReload, switchTo: this.wantSwitch, inspect: this.wantInspect,
        }, dt);
        this.wantReload = false; this.wantSwitch = null; this.wantInspect = false; this.zoomQueued = false;
      }
      this.updateTargetInfo(y);

      // ---- the Mii (offline) ----
      const b = this.bot;
      if (b) {
        if (b.alive) {
          const out = frozen || !y.alive ? { yaw: b.yaw } : b.brain.tick(dt, now, y);
          b.mover.step(dt, {
            fwd: out.fwd || 0, side: out.side || 0, yaw: b.yaw, walk: !!out.walk, duck: !!out.duck, jump: !!out.jump,
            maxSpeed: b.arms.maxSpeed(), frozen,
          });
          this.moverEvents(b);
          this.useWeapons(b, { fire: !!out.fire && !frozen && y.alive, reload: !!out.reload, switchTo: out.switchTo }, dt);
        }
        if (!b.useBones || !b.alive) this.updateTargetInfo(b);
      }

      // ---- other players (online) ----
      if (this.online) {
        const tNow = performance.now() / 1000;
        for (const f of this.fighters) if (f.kind === "remote") this.followRemote(f, tNow);
        // tell the server where you are (30 times a second)
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = 1 / 30;
          const m = y.mover, a = y.arms;
          const r3 = (v) => Math.round(v * 1000) / 1000;
          const flags = (m.onGround ? 1 : 0) | (a.weapon === "knife" ? 2 : 0) | (a.reloading(now) ? 4 : 0) | (y.alive ? 8 : 0) | (a.primary === "awp" ? 16 : 0) | (a.weapon === "deagle" ? 32 : 0);
          this.net.send({ t: "st", s: [r3(m.pos.x), r3(m.pos.y), r3(m.pos.z), r3(m.vel.x), r3(m.vel.z), r3(y.yaw), r3(y.pitch), r3(m.duck), flags] });
        }
      }
    }

    // Another player's position: shown 100 ms in the past, smoothly between the updates we got
    followRemote(f, tNow) {
      const S = f.snaps;
      if (!S.length) return;
      const rt = tNow - 0.1;
      let a = S[0], b = null;
      for (let i = S.length - 1; i >= 0; i--) if (S[i].t <= rt) { a = S[i]; b = S[i + 1] || null; break; }
      let s;
      if (b) {
        const k = clamp((rt - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
        const A = a.s, Bs = b.s;
        s = A.map((v, i) => (i === 5 ? v + E.wrapAngle(Bs[i] - v) * k : i === 8 ? Bs[i] : v + (Bs[i] - v) * k));
      } else {
        // no newer update yet: keep going a little in the same direction
        const ex = Math.min(0.1, rt - a.t);
        s = a.s.slice();
        s[0] += s[3] * ex; s[2] += s[4] * ex;
      }
      const m = f.mover;
      m.pos.x = s[0]; m.pos.y = s[1]; m.pos.z = s[2];
      m.vel.x = s[3]; m.vel.z = s[4];
      f.yaw = s[5]; f.pitch = s[6]; m.duck = s[7];
      m.onGround = !!(s[8] & 1);
      f.arms.primary = s[8] & 16 ? "awp" : "ak";
      f.arms.weapon = s[8] & 2 ? "knife" : s[8] & 32 ? "deagle" : f.arms.primary;
      if (!f.inst || !f.useBones) this.updateTargetInfo(f);
    }

    moverEvents(f) {
      const m = f.mover;
      f.landed = false;
      const me = f === this.you;
      for (const ev of m.events) {
        if (ev.type === "step") {
          if (me) {
            if (ev.loud) {
              this.audio.play("step", { vol: 0.35, rate: 0.9 + Math.random() * 0.2 });
              this.botHears(m.pos, 24);
              if (this.online) this.net.send({ t: "ev", k: "step" });
            }
          } else if (ev.loud) this.playAt("step", m.pos, 0.9, 0.9 + Math.random() * 0.2);
        } else if (ev.type === "land") {
          f.landed = true;
          f.arms.landPenalty = f.arms.gun().land * clamp(ev.speed / CFG.jump, 0.3, 1.5);
          if (me) {
            this.audio.play("land", { vol: 0.45 });
            this.botHears(m.pos, 20);
            if (this.online) this.net.send({ t: "ev", k: "land" });
          } else this.playAt("land", m.pos, 0.8);
        } else if (ev.type === "jump") {
          if (me) this.audio.play("jump", { vol: 0.3 });
        }
      }
    }

    botHears(pos, range, loud) {
      const b = this.bot;
      if (!b || !b.alive) return;
      const p = b.mover.pos;
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < range) b.brain.hear(pos, this.now, loud);
    }

    // where someone's head/chest are (Miis with bones get theirs from the bones, in poseAvatar)
    updateTargetInfo(f) {
      const m = f.mover;
      const e = m.eye();
      f.feet.x = m.pos.x; f.feet.y = m.pos.y; f.feet.z = m.pos.z;
      if (f.inst && f.useBones && f.alive) return;
      f.head.x = m.pos.x; f.head.y = m.pos.y + e + 0.07; f.head.z = m.pos.z;
      f.chest.x = m.pos.x; f.chest.y = m.pos.y + e - 0.55; f.chest.z = m.pos.z;
      f.center.x = m.pos.x; f.center.y = m.pos.y + e - 0.6; f.center.z = m.pos.z;
      E.bodyBoxes(m.pos, e, f.yaw, f.boxes);
    }

    // ------------------------------------------------------------------
    // Weapons
    // ------------------------------------------------------------------
    useWeapons(f, want, dt) {
      const a = f.arms, now = this.now, me = f === this.you;
      E.updateArms(a, f.mover, dt, now);
      // switching: "primary" (the AK or the AWP) or "knife"
      let to = want.switchTo;
      if (to === "primary" || to === "ak" || to === "awp") to = a.primary;
      if (to === "secondary") to = a.secondary;
      if (to && to !== a.weapon) {
        a.last = a.weapon;
        a.weapon = to;
        if (to !== "knife") a.lastGun = to;
        const W = a.gun();
        a.reloadEnd = 0;
        this.setZoom(f, 0); a.resumeZoom = 0;
        a.ready = now + (to === "knife" ? KNIFE.deploy : W.deploy);
        if (me) {
          this.vm.setWeapon(to);
          this.audio.play(to === "knife" ? "knifeDeploy" : "deploy", { vol: 0.6 });
          if (to === "deagle") this.later(0.55, () => { if (a.weapon === "deagle") this.audio.play("deagleSlide", { vol: 0.6 }); });
          if (this.online) this.net.send({ t: "ev", k: to === "knife" ? "knifeDeploy" : "deploy" });
        }
      }
      if (want.inspect && me && !a.reloading(now) && now >= a.ready && !a.zoom) this.vm.inspect();
      // the AWP's scope (right click): off -> zoom 1 -> zoom 2 -> off
      if (want.zoom && a.weapon === "awp" && !a.reloading(now)) { this.setZoom(f, (a.zoom + 1) % 3); a.resumeZoom = 0; }
      // after working the bolt, the scope comes back by itself (like CS)
      if (a.resumeZoom && now >= a.ready && a.weapon === "awp" && !a.reloading(now)) { this.setZoom(f, a.resumeZoom); a.resumeZoom = 0; }
      const W = a.gun();
      // reloading
      const startReload = () => {
        if (a.weapon === "knife" || a.reloading(now) || a.ammo >= W.mag || a.reserve <= 0) return;
        const empty = a.ammo === 0;
        this.setZoom(f, 0); a.resumeZoom = 0;
        a.reloadEnd = now + W.reload;
        a.ready = Math.max(a.ready, a.reloadEnd);
        const k = W.reload / AK.reload; // sounds spaced out to match the gun's reload
        const gid = a.gunId();
        const mo = gid === "awp" ? "awpMagOut" : gid === "deagle" ? "deagleMagOut" : "magOut", mi = gid === "awp" ? "awpMagIn" : gid === "deagle" ? "deagleMagIn" : "magIn";
        if (me) {
          this.vm.reload(empty);
          this.later(0.35 * k, () => { this.audio.play(mo, { vol: 0.7 }); if (this.online) this.net.send({ t: "ev", k: mo }); });
          this.later(1.45 * k, () => { this.audio.play(mi, { vol: 0.7 }); if (this.online) this.net.send({ t: "ev", k: mi }); });
          if (empty) this.later(2.05 * k, () => this.audio.play(gid === "awp" ? "awpBolt" : gid === "deagle" ? "deagleSlide" : "bolt", { vol: 0.7 }));
        } else {
          this.later(0.35 * k, () => this.playAt(mo, f.mover.pos, 0.6));
          this.later(1.45 * k, () => this.playAt(mi, f.mover.pos, 0.6));
        }
      };
      if (want.reload) startReload();
      if (a.weapon !== "knife") {
        // semi-automatic guns (the Deagle): one shot per click
        if (want.fire && now >= a.ready && !a.reloading(now) && !(W.semi && a.triggerHeld)) {
          if (a.ammo > 0) {
            a.ammo--;
            // keep an exact fire rate while the trigger is held (600 a minute for the AK)
            a.ready = (now - a.ready < TICK * 1.5 ? a.ready : now) + W.cycle;
            const dir = E.shotDirection(f, now);
            this.shoot(f, dir);
            if (f.brain) f.brain.onShot();
            if (a.weapon === "awp") {
              // the scope drops while you work the bolt, then comes back
              if (a.zoom) { a.resumeZoom = a.zoom; this.setZoom(f, 0); }
              if (me) this.later(0.45, () => this.audio.play("awpBolt", { vol: 0.6 }));
            }
          } else {
            a.ready = now + 0.2;
            if (me) { this.vm.dryFire(); this.audio.play("dry", { vol: 0.6 }); }
            startReload();
          }
        }
      } else if ((want.fire || want.alt) && now >= a.ready) {
        this.knife(f, !!want.alt && !want.fire);
      }
      a.triggerHeld = !!want.fire;
    }

    // ---- the AWP's scope ----
    setZoom(f, z) {
      const a = f.arms;
      if (a.zoom === z) return;
      a.zoom = z;
      if (f !== this.you) return;
      this.audio.play("zoom", { vol: 0.5 });
      if (this.vm.setScoped) this.vm.setScoped(z > 0);
      this.applyZoom();
    }
    applyZoom() {
      const a = this.you.arms;
      const z = this.you.alive ? a.zoom : 0;
      const fov = z ? a.gun().zoomFov[z] : this.settings.fov;
      this.camera.fov = verticalFov(fov);
      this.camera.updateProjectionMatrix();
      this.hudScope.classList.toggle("show", z > 0);
      this.vm.group.visible = this.you.alive && z === 0;
    }
    // mouse sensitivity while scoped (slower, so the same hand movement covers the same part of the view)
    zoomSens() {
      const a = this.you.arms;
      if (!a.zoom) return 1;
      const h = (deg) => Math.tan((deg * DEG) / 2);
      return h(a.gun().zoomFov[a.zoom]) / h(this.settings.fov || 90);
    }

    // ---- loadouts (pick your class before you spawn) ----
    showLoadout(show, note) {
      const p = this.hudLoadout;
      if (!show) { p.classList.remove("show"); this.loadoutOpen = false; return; }
      p.innerHTML = "";
      p.appendChild(el("div", "t", "LOADOUT"));
      const row = el("div", "cards");
      Object.values(E.LOADOUTS).forEach((L, i) => {
        const c = el("div", "card" + (this.loadout === L.id ? " on" : ""));
        c.append(el("b", null, (i + 1) + " · " + L.name), el("span", null, L.desc));
        row.appendChild(c);
      });
      p.appendChild(row);
      p.appendChild(el("div", "n", note || (!this.you.alive ? "Press 1 or 2 · you'll spawn with it" : this.phase === "freeze" || this.phase === "warmup" ? "Press 1 or 2 to pick · B to close" : "Press 1 or 2 · B to close · you'll spawn with it next time")));
      p.classList.add("show");
      this.loadoutOpen = true;
    }
    pickLoadout(id) {
      if (!E.LOADOUTS[id]) return;
      this.loadout = id;
      this.settings.loadout = id; saveSettings(this.settings);
      // before the action starts you switch straight away; otherwise it's for your next spawn
      const now = !this.you.alive ? false : this.phase === "freeze" || this.phase === "warmup";
      if (now && this.you.arms.primary !== id) {
        this.you.arms.reset(id);
        this.setZoom(this.you, 0);
        this.vm.setWeapon(this.you.arms.weapon);
        this.audio.play("deploy", { vol: 0.6 });
      }
      this.showLoadout(true, this.you.alive && !now ? "You'll spawn as " + E.LOADOUTS[id].name + " · B to close" : null);
      if (this.you.alive) setTimeout(() => { if (this.loadoutOpen) this.showLoadout(false); }, 1200);
    }

    later(secs, fn) { this.timers.push({ t: this.now + secs, fn }); }

    eyeOf(f) { const m = f.mover; return { x: m.pos.x, y: m.pos.y + m.eye(), z: m.pos.z }; }
    other(f) { return f === this.you ? (this.bot || this.leader()) : this.you; }

    // the nearest person a ray hits (before maxT)
    rayPeople(f, eye, dir, maxT) {
      let best = null;
      for (const t of this.enemiesOf(f)) {
        const hb = E.rayHitboxes(eye, dir, t.boxes, best ? best.t : maxT);
        if (hb && (!best || hb.t < best.t)) best = Object.assign(hb, { target: t });
      }
      return best;
    }

    shoot(f, dir) {
      const me = f === this.you;
      const eye = this.eyeOf(f);
      const wh = this.world.ray(eye, dir, 120);
      const maxT = wh ? wh.t : 120;
      const hb = this.rayPeople(f, eye, dir, maxT);
      f.stats.shots++;
      const endT = hb ? hb.t : maxT;
      const end = { x: eye.x + dir.x * endT, y: eye.y + dir.y * endT, z: eye.z + dir.z * endT };
      // the paintball flying (from the gun's muzzle)
      let from;
      if (me) {
        const v = this.vm.muzzle(new THREE.Vector3());
        // the viewmodel has its own camera; map its muzzle into the world roughly
        this.camera.updateMatrixWorld();
        from = v.applyMatrix4(this.camera.matrixWorld);
        this.vm.fire();
        this.audio.play(f.arms.gunId(), { vol: 0.8, rate: 0.96 + Math.random() * 0.08 });
      } else {
        from = this.muzzleOf(f);
        const d = Math.hypot(eye.x - this.camera.position.x, eye.z - this.camera.position.z);
        this.playAt(f.arms.gunId() + (d > 18 ? "Far" : ""), eye, 0.9, 0.95 + Math.random() * 0.1);
      }
      this.launchBall(from, end, f.color);
      if (me) this.botHears(eye, 999, true);
      if (me && this.online) {
        const r2 = (v) => Math.round(v * 100) / 100;
        this.net.send({ t: "shot", w: f.arms.gunId(), o: [r2(from.x), r2(from.y), r2(from.z)], e: [r2(end.x), r2(end.y), r2(end.z)], n: !hb && wh ? [r2(wh.nx), r2(wh.ny), r2(wh.nz)] : null, m: wh && !hb ? wh.mat : "" });
      }
      if (hb) {
        this.hit(f, hb.target, hb.zone, E.damageFor(hb.zone, hb.t, f.arms.gunId()), end, dir, f.arms.gunId(), hb.box);
      } else if (wh) {
        this.later(endT / 140, () => {
          this.splat(end, { x: wh.nx, y: wh.ny, z: wh.nz }, f.color, 0.22 + Math.random() * 0.14);
          this.playAt(wh.mat === "wood" ? "hitWood" : "hitWall", end, 0.5);
        });
      }
    }

    knife(f, heavy) {
      const a = f.arms, now = this.now, me = f === this.you;
      const eye = this.eyeOf(f);
      const dir = E.forward(f.yaw, f.pitch);
      const range = heavy ? KNIFE.stab.range : KNIFE.slash.range;
      const wall = this.world.ray(eye, dir, range + 0.5);
      let hb = this.rayPeople(f, eye, dir, wall ? wall.t : range + 0.5);
      if (hb && hb.t > range + 0.35) hb = null;
      if (!hb) {
        // a wide swing still catches someone right in front of you
        for (const t of this.enemiesOf(f)) {
          const tc = t.chest;
          const dx = tc.x - eye.x, dy = tc.y - eye.y, dz = tc.z - eye.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < range + 0.45 && (dx * dir.x + dy * dir.y + dz * dir.z) / d > 0.88 && this.world.clear(eye, tc) && (!hb || d < hb.t)) hb = { t: d, zone: "chest", box: null, target: t };
        }
      }
      if (me) {
        if (heavy) this.vm.stab(); else { this.vm.slash(f.slashAlt); f.slashAlt ^= 1; }
        this.audio.play(heavy ? "stab" : "slash", { vol: 0.7 });
        if (this.online) this.net.send({ t: "ev", k: heavy ? "stab" : "slash" });
      }
      if (hb) {
        const target = hb.target;
        // stabbing them in the back does a lot more
        const tf = E.forward(target.yaw, 0), af = E.forward(f.yaw, 0);
        const back = tf.x * af.x + tf.z * af.z > 0.475;
        let dmg;
        if (heavy) dmg = back ? KNIFE.stab.back : KNIFE.stab.damage;
        else dmg = back ? KNIFE.slash.back : now - a.lastSlash < 1.2 ? KNIFE.slash.next : KNIFE.slash.first;
        a.lastSlash = now;
        a.ready = now + (heavy ? KNIFE.stab.hit : KNIFE.slash.hit);
        const p = { x: eye.x + dir.x * hb.t, y: eye.y + dir.y * hb.t, z: eye.z + dir.z * hb.t };
        this.hit(f, target, hb.zone === "head" ? "chest" : hb.zone, dmg, p, dir, "knife", hb.box, back);
        this.audio.play("knifeHit", { vol: 0.8 });
      } else {
        a.ready = now + (heavy ? KNIFE.stab.miss : KNIFE.slash.miss);
        if (wall && wall.t < range) this.playAt("hitWall", eye, 0.4);
      }
    }

    hit(attacker, victim, zone, dmg, point, dir, weapon, box, back) {
      if (!victim.alive) return;
      attacker.stats.hits++;
      // paint on them + the hit sound right away (feels instant even online)
      if (victim.inst) {
        this.splatOnMii(victim, point, box, attacker.color);
        if (attacker === this.you) this.audio.play(zone === "head" ? "hitHead" : "hitBody", { vol: zone === "head" ? 1 : 0.7 });
      }
      if (this.online) {
        // the server is the referee: it takes the HP off and tells everyone
        if (attacker === this.you) {
          attacker.stats.dmg += Math.min(dmg, victim.hp);
          this.net.send({ t: "hit", v: victim.netId, z: zone, d: dmg, w: weapon, b: back ? 1 : 0 });
        }
        return;
      }
      const before = victim.hp;
      victim.hp = Math.max(0, victim.hp - dmg);
      const dealt = before - victim.hp;
      attacker.stats.dmg += dealt;
      attacker.given.dmg += dealt; attacker.given.hits++;
      victim.taken.dmg += dealt; victim.taken.hits++;
      // getting hit slows you down ("tagging") and knocks your aim
      const v = victim.mover.vel;
      if (victim.mover.onGround) { v.x *= 0.45; v.z *= 0.45; }
      victim.arms.recY += zone === "head" ? 1.2 : 0.6;
      victim.flinch = 1;
      if (victim.brain) victim.brain.hear(attacker.mover.pos, this.now, true);
      if (victim === this.you) {
        this.screenSplat(attacker.color, zone === "head" ? 1.4 : 1);
        this.audio.play(zone === "head" ? "hitHead" : "hurt", { vol: 0.8 });
        this.hurtFrom(attacker);
      }
      if (victim.hp <= 0) this.kill(attacker, victim, weapon, zone === "head", back);
    }

    kill(attacker, victim, weapon, head, back, fromNet) {
      if (!victim.alive && !fromNet) return;
      victim.alive = false;
      victim.killer = { f: attacker, weapon, head };
      victim.stats.deaths++;
      attacker.stats.kills++;
      if (head) attacker.stats.hs++;
      this.killFeed(attacker, victim, weapon, head);
      if (attacker === this.you) { this.audio.play("kill", { vol: 0.9 }); if (victim !== this.you) this.earn("kill", head); }
      if (victim.inst) {
        victim.dead = 0.0001;
        victim.gun.visible = false;
      }
      if (this.mode === "respawn") {
        if (!fromNet) attacker.score++;
        victim.respawnAt = this.now + RESPAWN;
        this.botLearns(this.bot && (attacker === this.bot || victim === this.bot) ? attacker : null);
        if (attacker === this.you) this.banner("+1", (head ? "🎯 " : "") + "Splattered " + victim.name, "win", 1.2);
        this.updateScore();
      }
      if (victim === this.you) {
        this.deathCam = { t: 0, from: this.eyeOf(victim), killer: attacker };
        this.vm.group.visible = false;
        const d = this.hudDeath;
        d.innerHTML = "";
        const who = el("div", "who");
        who.append("Splattered by ");
        const n = el("span", null, attacker.name); n.style.color = attacker.color;
        who.append(n, weapon === "knife" ? (back ? " (backstab 🔪)" : " 🔪") : head ? " 🎯 headshot" : "");
        const dm = el("div", "dmg");
        dm.innerHTML = "Damage taken: <b>" + victim.taken.dmg + "</b> in " + victim.taken.hits + " hit" + (victim.taken.hits === 1 ? "" : "s") +
          " · Damage given: <b>" + victim.given.dmg + "</b> in " + victim.given.hits + " hit" + (victim.given.hits === 1 ? "" : "s") +
          "<br>" + attacker.name + " has <b>" + attacker.hp + "</b> HP left";
        d.append(who, dm);
        if (this.mode === "respawn" || this.phase === "warmup") { this.hudRespawn = el("div", "again", "Respawning…"); d.appendChild(this.hudRespawn); }
        else if (this.online) d.appendChild(el("div", "again", "Watching until the next round…"));
        this.applyZoom();
        this.showLoadout(true);
        d.classList.add("show");
      }
      if (this.mode === "rounds" && !this.online) {
        const why = attacker === this.you
          ? (weapon === "knife" ? "You got " + victim.name + " with the knife!" : head ? "Headshot! 🎯" : victim.name + " got splattered")
          : (weapon === "knife" ? victim.name + " got knifed" : head ? attacker.name + " got you with a headshot" : attacker.name + " splattered you");
        this.endRound(attacker, why);
      } else if (!this.online && attacker.score >= this.toWin) {
        // first to 20: a moment to see it, then the results
        this.phase = "over";
        this.audio.play(attacker === this.you ? "matchWin" : "matchLose");
        this.banner(attacker === this.you ? "VICTORY" : "DEFEAT", attacker.name + " got " + this.toWin + " eliminations", attacker === this.you ? "win" : "lose");
        setTimeout(() => this.finish(attacker), 2500);
      }
    }

    hurtFrom(attacker) {
      const h = this.hudHurt;
      h.style.transition = "none"; h.style.opacity = "1";
      void h.offsetWidth;
      h.style.transition = "opacity .9s"; h.style.opacity = "0";
      // red arc pointing toward who shot you
      const me = this.you.mover.pos, a = attacker.mover.pos;
      const ang = Math.atan2(-(a.x - me.x), -(a.z - me.z)) - this.you.yaw;
      const arc = this.hudDirArc;
      arc.style.transition = "none"; arc.style.opacity = "1"; arc.style.transform = "rotate(" + (-ang) + "rad)";
      void arc.offsetWidth;
      arc.style.transition = "opacity 1.4s"; arc.style.opacity = "0";
    }

    // ------------------------------------------------------------------
    // Paint
    // ------------------------------------------------------------------
    splatMat(color, i) {
      const key = color + i;
      if (!this.splatMats.has(key)) {
        this.splatMats.set(key, new THREE.MeshLambertMaterial({
          map: this.splatTex[i], color: new THREE.Color(color), transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        }));
      }
      return this.splatMats.get(key);
    }

    splat(p, n, color, size) {
      const i = Math.floor(Math.random() * this.splatTex.length);
      let m;
      if (this.splats.length >= 180) { m = this.splats.shift(); m.material = this.splatMat(color, i); }
      else { m = new THREE.Mesh(this.splatGeo, this.splatMat(color, i)); m.renderOrder = 1; this.scene.add(m); }
      m.position.set(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
      m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
      m.rotateZ(Math.random() * Math.PI * 2);
      m.scale.setScalar(size);
      this.splats.push(m);
    }

    splatOnMii(f, p, box, color) {
      const i = Math.floor(Math.random() * this.splatTex.length);
      const m = new THREE.Mesh(this.splatGeo, this.splatMat(color, i));
      // which way the surface faces where it was hit
      let n = { x: 0, y: 1, z: 0 };
      if (box) {
        let c = box.a;
        if (box.b) {
          const ax = box.b.x - box.a.x, ay = box.b.y - box.a.y, az = box.b.z - box.a.z;
          const t = clamp(((p.x - box.a.x) * ax + (p.y - box.a.y) * ay + (p.z - box.a.z) * az) / (ax * ax + ay * ay + az * az || 1), 0, 1);
          c = { x: box.a.x + ax * t, y: box.a.y + ay * t, z: box.a.z + az * t };
        }
        n = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
        const l = Math.hypot(n.x, n.y, n.z) || 1;
        n.x /= l; n.y /= l; n.z /= l;
      }
      m.position.set(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02);
      m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
      m.rotateZ(Math.random() * Math.PI * 2);
      m.scale.setScalar(0.3 + Math.random() * 0.12);
      this.scene.add(m);
      m.updateMatrixWorld();
      // stick it to the body part so it moves with the Mii
      const parent = (box && box.bone) || f.inst.holder;
      parent.attach(m);
      f.paint.push(m);
      if (f.paint.length > 40) f.paint.shift().removeFromParent();
    }

    screenSplat(color, scale) {
      const tex = this.splatTex[Math.floor(Math.random() * this.splatTex.length)];
      const src = tex.image;
      const size = Math.round((180 + Math.random() * 160) * scale);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.drawImage(src, 0, 0, size, size);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      const W = window.innerWidth, H = window.innerHeight;
      // mostly around the edges so you can still see
      const edge = Math.random();
      const x = edge < 0.5 ? (Math.random() < 0.5 ? -size * 0.3 : W - size * 0.7) : Math.random() * (W - size);
      const y = edge < 0.5 ? Math.random() * (H - size) : (Math.random() < 0.5 ? -size * 0.3 : H - size * 0.7);
      c.style.left = x + "px"; c.style.top = y + "px"; c.style.opacity = "0.85";
      c.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      this.hudSplats.appendChild(c);
      setTimeout(() => { c.style.opacity = "0"; }, 700);
      setTimeout(() => c.remove(), 2600);
    }

    launchBall(from, to, color) {
      let b = this.balls.find((x) => !x.visible);
      if (!b) {
        if (this.balls.length > 40) b = this.balls[0];
        else { b = new THREE.Mesh(this.ballGeo, root.PBModels.paintBallMaterial(color)); b.userData.color = color; this.scene.add(b); this.balls.push(b); }
      }
      if (b.userData.color !== color) { b.material = root.PBModels.paintBallMaterial(color); b.userData.color = color; }
      const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      b.userData.from = from.clone ? from.clone() : new THREE.Vector3(from.x, from.y, from.z);
      b.userData.to = new THREE.Vector3(to.x, to.y, to.z);
      b.userData.t = 0; b.userData.dur = Math.max(0.02, d / 140);
      b.position.copy(b.userData.from);
      b.lookAt(b.userData.to);
      b.visible = true;
    }

    // ------------------------------------------------------------------
    // Sounds from somewhere in the world
    // ------------------------------------------------------------------
    playAt(name, pos, vol, rate) {
      const cam = this.camera.position;
      const dx = pos.x - cam.x, dz = pos.z - cam.z;
      const d = Math.hypot(dx, pos.y - cam.y, dz);
      const v = (vol || 1) * clamp(1.2 / (1 + d * 0.09), 0.08, 1);
      const yaw = this.you.yaw;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const pan = d > 0.3 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.85 : 0;
      this.audio.play(name, { vol: v, pan, rate: rate || 1 });
    }

    // ------------------------------------------------------------------
    // Drawing a frame
    // ------------------------------------------------------------------
    muzzleOf(f) {
      const g = f.gun;
      if (!g) return new THREE.Vector3(f.mover.pos.x, f.mover.pos.y + 1.3, f.mover.pos.z);
      g.updateMatrixWorld();
      const mz = g.userData.muzzle || new THREE.Vector3(0, 0.08, 0.8);
      return new THREE.Vector3(mz.x, mz.y, mz.z).applyMatrix4(g.matrixWorld);
    }
    botMuzzle() { return this.muzzleOf(this.bot); }

    draw(dt) {
      const y = this.you;
      const t = performance.now() / 1000;

      // ---- the camera is your eyes ----
      const cam = this.camera;
      if (this.deathCam) {
        // you got splattered: drop down and look at who did it
        const dc = this.deathCam;
        dc.t = Math.min(1, dc.t + dt * 1.6);
        const e = dc.from;
        cam.position.set(e.x, lerp(e.y, y.mover.pos.y + 0.45, dc.t * dc.t), e.z);
        const k = (dc.killer || this.other(y)).mover.pos;
        const ang = E.anglesTo(cam.position, { x: k.x, y: k.y + 1.2, z: k.z });
        y.yaw += E.wrapAngle(ang.yaw - y.yaw) * Math.min(1, dt * 4);
        y.pitch += (ang.pitch - y.pitch) * Math.min(1, dt * 4);
        cam.rotation.set(y.pitch, y.yaw, 0.35 * dc.t);
        if (this.hudRespawn && y.respawnAt) this.hudRespawn.textContent = "Respawning in " + Math.max(0, y.respawnAt - this.now).toFixed(1) + "…";
      } else {
        const m = y.mover;
        cam.position.set(m.pos.x, m.pos.y + m.eye(), m.pos.z);
        y.flinch = Math.max(0, y.flinch - dt * 6);
        const a = y.arms;
        // CS shows 45% of the recoil on your view (bullets go where the full recoil points)
        cam.rotation.set(y.pitch + a.recY * DEG * 0.45 + y.flinch * 0.012, y.yaw - a.recX * DEG * 0.45, 0);
      }

      for (const f of this.fighters) if (f.inst) this.poseAvatar(f, dt, t);

      // ---- flying paintballs ----
      for (const ball of this.balls) {
        if (!ball.visible) continue;
        const u = ball.userData;
        u.t += dt;
        const k = Math.min(1, u.t / u.dur);
        ball.position.lerpVectors(u.from, u.to, k);
        if (k >= 1) ball.visible = false;
      }

      // ---- your hands and gun ----
      const ym = y.mover;
      const yspd = ym.speed2d();
      y.walkPhase = (y.walkPhase || 0) + yspd * dt * 2.1;
      this.mouse.swayX *= 0.5; this.mouse.swayY *= 0.5;
      this.vm.update(dt, {
        speed: ym.onGround ? clamp(yspd / CFG.speedKnife, 0, 1) : 0, phase: y.walkPhase,
        swayX: this.mouse.swayX, swayY: this.mouse.swayY, crouch: ym.duck, airborne: !ym.onGround, landed: y.landed, t,
      });
      y.landed = false;

      if (this.map.update) this.map.update(t);

      const r = this.renderer;
      r.autoClear = true;
      r.render(this.scene, cam);
      if (this.vm.group.visible) {
        r.autoClear = false;
        r.clearDepth();
        r.render(this.vmScene, this.vmCamera);
        r.autoClear = true;
      }
      this.updateHUD();
    }

    // moves a Mii's body to match its movement and aim (and its hit boxes with it)
    poseAvatar(f, dt, t) {
      const inst = f.inst, m = f.mover;
      const h = inst.holder;
      const show = f.alive || f.dead > 0;
      h.visible = show;
      if (!show) { f.gun.visible = false; return; }
      const spd = m.speed2d();
      const walk = clamp(spd / (CFG.speedAK * 0.75), 0, 1);
      const stepLen = inst.rig.stepLength(f.style) * MII_SCALE;
      f.walkPhase += (spd * dt) / Math.max(0.3, stepLen) * Math.PI;
      const knife = f.arms.weapon === "knife";
      inst.rig.pose({
        t, dt, walk, phase: f.walkPhase, style: f.style, arms: f.dead ? "down" : knife ? "knife" : "aim",
        crouch: m.duck, aimPitch: f.pitch, lookUp: f.pitch * 0.5,
      });
      h.position.set(m.pos.x, m.pos.y - inst.rig.drop * MII_SCALE, m.pos.z);
      if (f.dead) {
        // falls over backwards, covered in paint
        f.dead = Math.min(1, f.dead + dt * 2.4);
        const e = 1 - Math.pow(1 - f.dead, 3);
        h.rotation.set(-e * 1.45, f.yaw + Math.PI, 0, "YXZ");
      } else {
        h.rotation.set(0, f.yaw + Math.PI, 0, "YXZ");
      }
      h.updateMatrixWorld(true);
      if (f.alive) this.boneHitboxes(f);
      // the gun sits in the right hand, pointing where the Mii aims
      const want = this.worldGunFor(f);
      if (f.gun !== want) { f.gun.visible = false; f.gun = want; }
      f.gun.visible = f.alive && !knife;
      if (f.gun.visible) {
        const wr = f.bones.wr || f.bones.a2r;
        const v = new THREE.Vector3();
        if (wr) wr.getWorldPosition(v); else v.set(m.pos.x, m.pos.y + 1.1, m.pos.z);
        f.gun.position.copy(v);
        f.gun.rotation.set(-f.pitch, f.yaw + Math.PI, 0, "YXZ");
        const fw = E.forward(f.yaw, f.pitch);
        f.gun.position.x += fw.x * 0.05; f.gun.position.z += fw.z * 0.05;
      }
    }
    poseBot(dt, t) { if (this.bot) this.poseAvatar(this.bot, dt, t); }

    // run the game faster than real time without drawing (for tests)
    advance(secs) {
      const n = Math.round(secs / TICK);
      for (let i = 0; i < n && !this.disposed && !(this.over && !this.online); i++) {
        this.tick(TICK);
        if (i % 4 === 0) for (const f of this.fighters) if (f.inst) this.poseAvatar(f, TICK * 4, this.now);
      }
    }

    // a Mii's hit boxes follow its bones (crouching, leaning...)
    boneHitboxes(f) {
      const B = f.bones, out = f.boxes;
      out.length = 0;
      const k = MII_SCALE;
      if (!f.useBones) { E.bodyBoxes(f.mover.pos, f.mover.eye(), f.yaw, out); return; }
      const P = (bone) => { const v = new THREE.Vector3(); bone.getWorldPosition(v); return v; };
      const head = P(B.head), s1 = P(B.s1), s2 = P(B.s2);
      const hc = head.clone(); hc.y += 0.36 * k;
      const fw = E.forward(f.yaw, 0);
      hc.x += fw.x * 0.02 * k; hc.z += fw.z * 0.02 * k;
      out.push({ zone: "head", a: hc, r: 0.33 * k, bone: B.head });
      out.push({ zone: "chest", a: s2, b: head, r: 0.17 * k, bone: B.s2 });
      const hip = s1.clone(); hip.y -= 0.08 * k;
      out.push({ zone: "stomach", a: hip, b: s2, r: 0.17 * k, bone: B.s1 });
      const limb = (a, bb, c, r, zone) => {
        if (!a || !bb) return;
        const pa = P(a), pb = P(bb);
        out.push({ zone, a: pa, b: pb, r: r * k, bone: a });
        if (c) out.push({ zone, a: pb, b: P(c), r: r * k * 0.9, bone: bb });
      };
      limb(B.a1l, B.a2l, B.wl, 0.075, "arm"); limb(B.a1r, B.a2r, B.wr, 0.075, "arm");
      limb(B.l1l, B.l2l, B.al, 0.095, "leg"); limb(B.l1r, B.l2r, B.ar, 0.095, "leg");
      f.head.x = hc.x; f.head.y = hc.y; f.head.z = hc.z;
      f.chest.x = (s2.x + head.x) / 2; f.chest.y = (s2.y + head.y) / 2; f.chest.z = (s2.z + head.z) / 2;
      f.center.x = s2.x; f.center.y = s2.y; f.center.z = s2.z;
      f.feet.x = f.mover.pos.x; f.feet.y = f.mover.pos.y; f.feet.z = f.mover.pos.z;
    }

    updateHUD() {
      const y = this.you, a = y.arms;
      const now = this.now;
      // scoped in: the crosshair blurs while you're inaccurate (moving, jumping), like CS; standing still it's sharp
      let blur = 0;
      if (a.zoom > 0 && y.alive) {
        const sc = a.gun().scoped;
        const extra = E.inaccuracy(y.mover, a) - (y.mover.duck > 0.5 ? sc.crouch : sc.stand);
        blur = Math.round(Math.min(1, Math.max(0, extra / 0.06)) * 8 * 2) / 2;
      }
      if (blur !== this.scopeBlur) {
        // like CS, only the scope's crosshair goes blurry (thick and soft); the view itself stays sharp
        this.scopeBlur = blur;
        for (const line of this.hudScope.querySelectorAll("i")) {
          line.style.filter = blur ? "blur(" + blur * 0.6 + "px)" : "";
          line.style[line.classList.contains("h") ? "height" : "width"] = 1 + blur * 1.2 + "px";
          line.style[line.classList.contains("h") ? "marginTop" : "marginLeft"] = -(blur * 0.6) + "px";
        }
      }
      // the clock: round time (rounds), or time left in the match (respawn)
      if (this.phase === "freeze") this.clockLeft = this.phaseEnd - now;
      else if (this.mode === "rounds") { if (this.phase !== "end") this.clockLeft = this.roundEnd - now; }
      else if (!this.over && this.phase === "live") this.clockLeft = this.matchEnd - now;
      let secs = Math.max(0, Math.ceil(this.clockLeft || 0));
      const txt = this.phase === "warmup" ? "WARMUP" : Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
      if (this.hudClock.textContent !== txt) {
        this.hudClock.textContent = txt;
        const low = this.phase === "live" && secs <= 10;
        this.hudClock.classList.toggle("low", low);
        if (low && secs <= 5 && secs > 0) this.audio.play("tick", { vol: 0.4 });
      }
      const hp = String(y.hp);
      if (this.hudHP.textContent !== hp) {
        this.hudHP.textContent = hp;
        this.hudHP.classList.toggle("low", y.hp <= 30);
        this.hudHPBar.style.width = y.hp + "%";
      }
      const ak = a.weapon !== "knife";
      const slot1 = "1 · " + E.WEAPONS[a.primary].name.toUpperCase();
      if (this.hudSlotAK.textContent !== slot1) this.hudSlotAK.textContent = slot1;
      const mag = ak ? String(a.ammo) : "–";
      if (this.hudMag.textContent !== mag) { this.hudMag.textContent = mag; this.hudMag.classList.toggle("low", ak && a.ammo <= Math.ceil(a.gun().mag / 6)); }
      const res = ak ? "/ " + a.reserve : "";
      if (this.hudRes.textContent !== res) this.hudRes.textContent = res;
      const wn = ak ? a.gun().name : "Butterfly Knife";
      if (this.hudWpn.textContent !== wn) this.hudWpn.textContent = wn;
      const rl = a.reloading(now) ? "RELOADING" : ak && a.ammo === 0 && a.reserve === 0 ? "NO PAINT" : "";
      if (this.hudReload.textContent !== rl) this.hudReload.textContent = rl;
      this.hudSlotAK.classList.toggle("on", a.weapon === a.primary);
      this.hudSlotDG.classList.toggle("on", a.weapon === a.secondary);
      this.hudSlotKnife.classList.toggle("on", !ak);
      if (this.settings.xhStyle === "dynamic") this.drawCrosshair(ak ? E.inaccuracy(y.mover, a) : 0);
      this.hudXH.style.display = y.alive && !a.zoom && !this.hudBoard.classList.contains("show") ? "" : "none";
      if (this.hudBoard.classList.contains("show") && (!this.boardT || Math.abs(now - this.boardT) > 0.5)) { this.boardT = now; this.renderBoard(); }
      if (this.online) {
        const pg = this.net.ping != null ? this.net.ping + " ms" : "";
        if (this.hudNet.textContent !== pg) this.hudNet.textContent = pg;
      }
    }

    // ------------------------------------------------------------------
    // The end
    // ------------------------------------------------------------------
    finish(winner, why) {
      if (this.over) return;
      this.over = true;
      if (!this.online) this.paused = true;
      if (document.exitPointerLock && this.locked()) document.exitPointerLock();
      const won = winner === this.you;
      if (why !== "disconnected") { this.earn("match"); if (won) this.earn("win"); }
      const ov = this.ovResult;
      ov.innerHTML = "";
      const p = el("div", "pb-panel pb-result");
      const big = why === "disconnected" ? "DISCONNECTED" : won ? "VICTORY" : winner ? "DEFEAT" : "DRAW";
      p.appendChild(el("div", "big " + (won ? "win" : winner ? "lose" : ""), big));
      if (this.earned > 0) p.appendChild(el("div", "pb-earned", "+" + this.earned + " 🎨 credits earned · open crates in the lobby"));
      this.earned = 0;

      if (!this.online) {
        const result = won ? "you" : winner ? "mii" : "draw";
        const st = this.opts.statsFor(this.o.opp);
        st.played = (st.played || 0) + 1;
        if (won) st.losses = (st.losses || 0) + 1; else if (winner) st.wins = (st.wins || 0) + 1;
        this.opts.onSave(this.o.opp);
        if (this.opts.onFinish) this.opts.onFinish({ result, you: this.o.you, opp: this.o.opp, score: { you: this.you.score, bot: this.bot.score } });
        p.appendChild(el("div", "score", this.you.score + " – " + this.bot.score));
      } else {
        p.appendChild(el("div", "score", winner ? winner.name + " wins with " + winner.score : why || ""));
      }
      if (why && why !== "disconnected") p.appendChild(el("p", null, why));
      const tbl = el("table");
      tbl.innerHTML = "<tr><th></th><th>" + (this.mode === "rounds" ? "Rounds" : "Score") + "</th><th>K</th><th>D</th><th>HS %</th></tr>";
      for (const f of this.fighters.slice().sort((x, z) => z.score - x.score)) {
        const s = f.stats;
        const tr = el("tr");
        const n = el("td", null, f.name + (f === this.you ? " (you)" : "")); n.style.color = f.color;
        tr.appendChild(n);
        for (const c of [f.score, s.kills, s.deaths, s.kills ? Math.round((s.hs / s.kills) * 100) + "%" : "–"]) tr.appendChild(el("td", null, String(c)));
        tbl.appendChild(tr);
      }
      p.appendChild(tbl);
      const G = root.MiniGames;
      if (!this.online && G && G.talk && root.Dialogue) {
        const st = this.opts.statsFor(this.o.opp);
        const line = G.talk(won ? "loseMatch" : winner ? "winMatch" : "draw", root.Dialogue.traits(this.o.opp));
        p.appendChild(el("div", "say", this.bot.name + ": “" + line + "”"));
        p.appendChild(el("div", "grow", this.botLearned >= 0.5
          ? this.bot.name + " got better at Paintball! +" + this.botLearned.toFixed(0) + " skill (" + G.skillLevel(st.skill) + ")"
          : this.bot.name + "'s Paintball skill: " + G.skillLevel(st.skill)));
      }
      const btns = el("div", "btns");
      if (this.online) {
        this.voteBox = null;
        if (why !== "disconnected") { this.voteBox = el("div", "pb-vote"); p.appendChild(this.voteBox); }
        const leave = el("button", "pb-btn", why === "disconnected" ? "OK" : "Leave lobby");
        leave.addEventListener("click", () => this.o.onExit("leave"));
        btns.append(leave);
      } else {
        const again = el("button", "pb-btn primary", "Rematch");
        again.addEventListener("click", () => this.o.onRematch());
        const lobby = el("button", "pb-btn", "Change Miis");
        lobby.addEventListener("click", () => this.o.onExit("lobby"));
        const hub = el("button", "pb-btn", "Back to the hub");
        hub.addEventListener("click", () => this.o.onExit("hub"));
        btns.append(again, lobby, hub);
      }
      p.appendChild(btns);
      ov.appendChild(p);
      ov.classList.add("show");
    }
    finishMatch() { this.finish(this.you.score > this.bot.score ? this.you : this.bot); }

    quit() {
      this.over = true;
      if (document.exitPointerLock && this.locked()) document.exitPointerLock();
      this.o.onExit(this.online ? "leave" : "lobby");
    }

    // crate credits for playing (see PBCrates.EARN)
    earn(kind, bonus) {
      if (!root.PBCrates || !PBCrates.addCredits || !PBCrates.EARN) return;
      const E2 = PBCrates.EARN;
      const n = kind === "kill" ? (E2.kill || 0) + (bonus ? E2.headshot || 0 : 0) : kind === "round" ? E2.roundWin || 0 : kind === "match" ? E2.matchPlayed || 0 : kind === "win" ? E2.matchWin || 0 : 0;
      if (n <= 0) return;
      PBCrates.addCredits(n, kind);
      this.earned += n;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this.skinsOff) this.skinsOff();
      clearInterval(this.voteTimer);
      cancelAnimationFrame(this.raf);
      if (this.unbind) this.unbind();
      if (this.netOff) this.netOff();
      window.removeEventListener("resize", this.onResize);
      if (document.exitPointerLock && this.locked()) document.exitPointerLock();
      try { this.vm.dispose(); } catch (e) { /* ignore */ }
      try { this.map.dispose(); } catch (e) { /* ignore */ }
      try { this.audio.dispose(); } catch (e) { /* ignore */ }
      for (const f of this.fighters) if (f.inst && root.MiiModel.disposeObject) root.MiiModel.disposeObject(f.inst.holder);
      for (const m of this.splatMats.values()) m.dispose();
      this.splatGeo.dispose(); this.ballGeo.dispose();
      for (const t of this.splatTex) t.dispose();
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      if (root.__pb === this) root.__pb = null;
    }
  }

  root.Paintball = { open, Match, TO_WIN, RESPAWN_TO_WIN, paintColor, el };
})(window);
