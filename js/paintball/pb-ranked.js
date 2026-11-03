/*
 * paintball/pb-ranked.js
 * Ranked Paintball on this side: the ranks, their badges (drawn here as SVG),
 * and the Ranked parts of the menus (your rank card, the leaderboard, and the
 * MMR screen at the end of a match).
 *
 * The server (server/ranked.js) decides everything: MMR, placements, who's a
 * Predator. This file only draws what it's told, with the same rank table so
 * it can show progress bars (the tests check both tables match).
 *
 *   Iron 0–399 · Bronze 400–799 · Silver 800–1199 · Gold 1200–1599
 *   Platinum 1600–1999 · Emerald 2000–2399 · Diamond 2400–2799   (divisions IV -> I, 100 MMR each)
 *   Master 2800–3199 · Grandmaster 3200+ · Predator: the server's top 10 (at least Master)
 *
 * The rank math and badgeSVG need no DOM, so this also loads in Node (the tests).
 */
(function (root) {
  "use strict";

  const TIERS = [
    { id: "iron", name: "Iron", min: 0, divs: 4 },
    { id: "bronze", name: "Bronze", min: 400, divs: 4 },
    { id: "silver", name: "Silver", min: 800, divs: 4 },
    { id: "gold", name: "Gold", min: 1200, divs: 4 },
    { id: "platinum", name: "Platinum", min: 1600, divs: 4 },
    { id: "emerald", name: "Emerald", min: 2000, divs: 4 },
    { id: "diamond", name: "Diamond", min: 2400, divs: 4 },
    { id: "master", name: "Master", min: 2800, divs: 0 },
    { id: "grandmaster", name: "Grandmaster", min: 3200, divs: 0 },
    { id: "predator", name: "Predator", min: 2800, divs: 0 },
  ];
  const DIV_SIZE = 100;
  const PLACEMENTS = 5;
  const ROMAN = ["", "I", "II", "III", "IV"];

  // ---------------------------------------------------------------------
  // Ranks (the same rules as server/ranked.js)
  // ---------------------------------------------------------------------
  const tierIndex = (id) => TIERS.findIndex((t) => t.id === id);
  function tierOfMmr(mmr) {
    let i = 0;
    for (let j = 0; j < TIERS.length; j++) if (TIERS[j].id !== "predator" && mmr >= TIERS[j].min) i = j;
    return i;
  }
  function rankFor(mmr, o) {
    o = o || {};
    mmr = Math.max(0, Math.round(mmr || 0));
    if (o.placed === false) return { tier: "unranked", name: "Unranked", div: 0, label: "Unranked", step: -1, mmr: null };
    let ti = tierOfMmr(mmr);
    if (o.predator && ti >= tierIndex("master")) ti = tierIndex("predator");
    const T = TIERS[ti];
    let div = 0;
    if (T.divs) div = T.divs - Math.min(T.divs - 1, Math.floor((mmr - T.min) / DIV_SIZE));
    return { tier: T.id, name: T.name, div, label: T.name + (div ? " " + ROMAN[div] : ""), step: ti * 10 + (div ? 5 - div : 0), mmr };
  }
  function progress(mmr) {
    const ti = tierOfMmr(mmr), T = TIERS[ti];
    if (T.divs) {
      const floor = T.min + Math.min(T.divs - 1, Math.floor((mmr - T.min) / DIV_SIZE)) * DIV_SIZE;
      return { floor, ceil: floor + DIV_SIZE, pct: Math.max(0, Math.min(1, (mmr - floor) / DIV_SIZE)) };
    }
    const next = TIERS[ti + 1] && TIERS[ti + 1].id !== "predator" ? TIERS[ti + 1].min : T.min + 400;
    return { floor: T.min, ceil: next, pct: Math.max(0, Math.min(1, (mmr - T.min) / (next - T.min))) };
  }
  // the rank one step up from this MMR (what the progress bar is heading for)
  function nextRank(mmr) {
    const p = progress(mmr);
    const T = TIERS[tierOfMmr(mmr)];
    if (T.id === "grandmaster") return null;
    return rankFor(p.ceil);
  }

  // ---------------------------------------------------------------------
  // Badges: one SVG per rank, made from a shape for the tier, its colors,
  // a little emblem, and a ribbon with the division (IV..I)
  // ---------------------------------------------------------------------
  // [light, main, dark, accent]
  const COLORS = {
    unranked: ["#dfe3e7", "#7d858d", "#3c4248", "#aab2ba"],
    iron: ["#d9dee3", "#8a929a", "#3f454b", "#b9c0c6"],
    bronze: ["#ffd3a6", "#c27a3e", "#5f3112", "#f0a868"],
    silver: ["#ffffff", "#c3ccd6", "#66717d", "#e8eef4"],
    gold: ["#fff5ba", "#f4c430", "#8f6200", "#ffe066"],
    platinum: ["#cbfff7", "#36c8b8", "#0c6560", "#8ff0e3"],
    emerald: ["#c2ffd9", "#1fbf66", "#07532c", "#6ff0a4"],
    diamond: ["#e0f1ff", "#4a9dff", "#163a94", "#9fd0ff"],
    master: ["#f4d9ff", "#a855f7", "#45137c", "#d6a8ff"],
    grandmaster: ["#ffd4cf", "#e53935", "#6f0909", "#ff8a80"],
    predator: ["#ff6b78", "#d0001f", "#050102", "#ff2d3d"], // (its body is drawn black, see badgeSVG)
  };
  const SHIELD = "M50 10 L84 21 L80 56 Q75 79 50 92 Q25 79 20 56 L16 21 Z";
  const HEX = "M50 9 L85 29 L85 69 L50 89 L15 69 L15 29 Z";
  const OCT = "M35 11 H65 L86 32 V66 L65 87 H35 L14 66 V32 Z";
  const GEM = "M29 17 H71 L89 39 L50 90 L11 39 Z";
  const SHAPES = { unranked: SHIELD, iron: SHIELD, bronze: SHIELD, silver: SHIELD, gold: SHIELD, platinum: HEX, emerald: OCT, diamond: GEM, master: SHIELD, grandmaster: SHIELD, predator: SHIELD };
  const MIRROR = 'transform="matrix(-1 0 0 1 100 0)"';

  function star(cx, cy, R, r, n) {
    let d = "";
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n, rad = i % 2 ? r : R;
      d += (i ? "L" : "M") + (cx + Math.cos(a) * rad).toFixed(1) + " " + (cy + Math.sin(a) * rad).toFixed(1);
    }
    return d + "Z";
  }
  // a laurel branch around the left side (mirrored for the right)
  function laurel(fill, stroke) {
    let s = "";
    for (let i = 0; i < 6; i++) {
      const a = (125 + i * 21) * (Math.PI / 180);
      const x = 50 + Math.cos(a) * 44, y = 53 + Math.sin(a) * 41;
      const rot = (a * 180) / Math.PI + 90 + 25;
      s += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="8" ry="3.4" transform="rotate(' + rot.toFixed(0) + " " + x.toFixed(1) + " " + y.toFixed(1) + ')" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>';
    }
    return s;
  }

  // rank (or a tier id) -> SVG text
  function badgeSVG(rank, size) {
    if (typeof rank === "string") rank = { tier: rank, div: 0 };
    rank = rank || { tier: "unranked", div: 0 };
    const tier = COLORS[rank.tier] ? rank.tier : "unranked";
    const [hi, main, dark, acc] = COLORS[tier];
    const shape = SHAPES[tier];
    const ti = tierIndex(tier);
    const id = "pbr-" + tier;
    const sz = size || 64;
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz + '" viewBox="0 0 100 100">');
    out.push("<defs>" +
      (tier === "predator"
        ? '<linearGradient id="' + id + '-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a0c16"/><stop offset=".5" stop-color="#1c0307"/><stop offset="1" stop-color="#000"/></linearGradient>'
        : '<linearGradient id="' + id + '-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + hi + '"/><stop offset=".45" stop-color="' + main + '"/><stop offset="1" stop-color="' + dark + '"/></linearGradient>') +
      '<linearGradient id="' + id + '-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + acc + '"/><stop offset="1" stop-color="' + dark + '"/></linearGradient>' +
      '<radialGradient id="' + id + '-glow" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="' + acc + '" stop-opacity=".55"/><stop offset="1" stop-color="' + acc + '" stop-opacity="0"/></radialGradient>' +
      "</defs>");
    // behind: a glow for the top ranks, then wings / laurels / horns
    if (ti >= tierIndex("diamond")) out.push('<circle cx="50" cy="52" r="50" fill="url(#' + id + '-glow)"/>');
    if (tier === "silver" || tier === "gold" || tier === "diamond") {
      const wing = '<path d="M22 32 Q6 26 1 38 Q9 38 13 41 Q3 46 4 56 Q12 52 17 53 Q10 60 14 68 Q20 60 24 58 Z" fill="url(#' + id + '-w)" stroke="' + dark + '" stroke-width="1.5"/>';
      out.push(wing, "<g " + MIRROR + ">" + wing + "</g>");
    }
    if (tier === "master" || tier === "grandmaster") {
      const l = laurel(acc, dark);
      out.push(l, "<g " + MIRROR + ">" + l + "</g>");
    }
    if (tier === "predator") {
      const horn = '<path d="M24 24 Q8 18 3 1 Q14 12 31 17 Z" fill="' + acc + '" stroke="' + dark + '" stroke-width="2"/>';
      out.push(horn, "<g " + MIRROR + ">" + horn + "</g>");
      out.push('<path d="' + SHIELD + '" fill="none" stroke="' + acc + '" stroke-width="9" stroke-opacity=".35"/>');
    }
    // the body
    out.push('<path d="' + shape + '" fill="url(#' + id + '-g)" stroke="' + dark + '" stroke-width="3.5" stroke-linejoin="round"/>');
    out.push('<path d="' + shape + '" fill="none" stroke="' + (tier === "predator" ? acc : hi) + '" stroke-opacity=".7" stroke-width="2" transform="translate(50 50) scale(.76) translate(-50 -50)"/>');
    // the emblem
    const E = [];
    if (tier === "unranked") E.push('<text x="50" y="62" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="36" fill="' + hi + '">?</text>');
    if (tier === "iron") {
      E.push('<rect x="32" y="44" width="36" height="10" rx="3" fill="' + dark + '" fill-opacity=".55"/>');
      for (const [x, y] of [[30, 30], [70, 30], [33, 66], [67, 66]]) E.push('<circle cx="' + x + '" cy="' + y + '" r="3.2" fill="' + hi + '" stroke="' + dark + '" stroke-width="1.2"/>');
    }
    const chevron = (y) => '<path d="M31 ' + (y + 10) + " L50 " + (y - 2) + " L69 " + (y + 10) + " L69 " + (y + 19) + " L50 " + (y + 7) + " L31 " + (y + 19) + ' Z" fill="' + hi + '" stroke="' + dark + '" stroke-width="1.5" stroke-linejoin="round"/>';
    if (tier === "bronze") E.push(chevron(38));
    if (tier === "silver") E.push(chevron(30), chevron(48));
    if (tier === "gold") E.push('<path d="' + star(50, 50, 20, 8.5, 5) + '" fill="' + hi + '" stroke="' + dark + '" stroke-width="2" stroke-linejoin="round"/>');
    if (tier === "platinum") {
      E.push('<path d="M50 24 L72 37 L72 61 L50 74 L28 61 L28 37 Z" fill="' + hi + '" fill-opacity=".35" stroke="' + hi + '" stroke-width="1.5"/>');
      for (const [x, y] of [[50, 24], [72, 37], [72, 61], [50, 74], [28, 61], [28, 37]]) E.push('<line x1="50" y1="49" x2="' + x + '" y2="' + y + '" stroke="' + hi + '" stroke-width="1.3" stroke-opacity=".8"/>');
    }
    if (tier === "emerald") {
      E.push('<path d="M40 27 H60 L72 39 V59 L60 71 H40 L28 59 V39 Z" fill="' + hi + '" fill-opacity=".3" stroke="' + hi + '" stroke-width="1.5"/>');
      E.push('<path d="M40 27 L35 11 M60 27 L65 11 M72 39 L86 32 M72 59 L86 66 M60 71 L65 87 M40 71 L35 87 M28 59 L14 66 M28 39 L14 32" stroke="' + hi + '" stroke-width="1.2" stroke-opacity=".7"/>');
    }
    if (tier === "diamond") {
      E.push('<path d="M11 39 H89 M29 17 L38 39 L50 17 L62 39 L71 17 M38 39 L50 90 L62 39" fill="none" stroke="' + hi + '" stroke-width="1.6" stroke-opacity=".85" stroke-linejoin="round"/>');
      E.push('<path d="M29 17 L38 39 L11 39 Z" fill="' + hi + '" fill-opacity=".35"/>');
    }
    if (tier === "master" || tier === "grandmaster") {
      E.push('<circle cx="50" cy="50" r="19" fill="' + dark + '" fill-opacity=".45" stroke="' + hi + '" stroke-width="2"/>');
      E.push('<path d="' + star(50, 50, 15, 6.5, 5) + '" fill="' + hi + '"/>');
    }
    if (tier === "grandmaster") E.push('<path d="M33 22 L29 5 L40 13 L50 2 L60 13 L71 5 L67 22 Z" fill="#ffd54a" stroke="' + dark + '" stroke-width="2" stroke-linejoin="round"/>');
    if (tier === "predator") {
      for (const dx of [-11, 0, 11]) E.push('<path d="M' + (44 + dx) + " 28 Q" + (52 + dx) + " 48 " + (46 + dx) + ' 72 Q' + (57 + dx) + " 50 " + (49 + dx) + ' 28 Z" fill="' + main + '"/>');
      E.push('<path d="M36 74 L40 82 L44 74 M56 74 L60 82 L64 74" fill="none" stroke="' + hi + '" stroke-width="2.5" stroke-linejoin="round"/>');
    }
    out.push(E.join(""));
    // a bit of shine
    out.push('<path d="M24 24 L50 15 L50 34 Q36 36 26 44 Z" fill="#fff" fill-opacity=".18"/>');
    // the division
    if (rank.div) {
      out.push('<path d="M22 77 H78 L73 85.5 L78 94 H22 L27 85.5 Z" fill="' + dark + '" stroke="' + hi + '" stroke-width="1.5" stroke-linejoin="round"/>');
      out.push('<text x="50" y="90.5" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="12" letter-spacing="1" fill="' + hi + '">' + ROMAN[rank.div] + "</text>");
    }
    out.push("</svg>");
    return out.join("");
  }
  const badgeURL = (rank) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(badgeSVG(rank, 128));
  const urlCache = new Map();
  function badge(rank, size, cls) {
    const key = rank ? rank.tier + ":" + (rank.div || 0) : "unranked";
    if (!urlCache.has(key)) urlCache.set(key, badgeURL(rank));
    const img = document.createElement("img");
    img.className = "pbr-badge" + (cls ? " " + cls : "");
    img.src = urlCache.get(key);
    img.alt = rank ? rank.label : "Unranked";
    img.title = rank ? rank.label : "Unranked";
    img.width = img.height = size || 24;
    img.draggable = false;
    return img;
  }
  const color = (rank) => (COLORS[rank && rank.tier] || COLORS.unranked)[1];
  const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // ---------------------------------------------------------------------
  // The menus (only in the browser)
  // ---------------------------------------------------------------------
  let cssDone = false;
  function addCSS() {
    if (cssDone || typeof document === "undefined") return;
    cssDone = true;
    const css = `
.pbr-badge{display:inline-block;vertical-align:middle;flex:none;filter:drop-shadow(0 1px 2px #0008)}
.pbr-card{position:relative;overflow:hidden;margin-bottom:16px;border-color:var(--rc,#ffffff1a);background:linear-gradient(135deg,color-mix(in srgb,var(--rc,#888) 18%,#11151b) 0%,#ffffff08 60%)}
.pbr-top{display:flex;gap:14px;align-items:center}
.pbr-top .pbr-badge{width:84px;height:84px}
.pbr-who{flex:1;min-width:0}
.pbr-rank{font-size:24px;font-weight:900;letter-spacing:.5px;line-height:1.1}
.pbr-rank small{font-size:13px;font-weight:800;opacity:.7;margin-left:8px;letter-spacing:0}
.pbr-mmr{font-size:13px;font-weight:800;opacity:.85;margin-top:3px}
.pbr-bar{position:relative;height:9px;background:#ffffff1c;border-radius:5px;overflow:hidden;margin-top:6px}
.pbr-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--rc,#ffb21e),color-mix(in srgb,var(--rc,#ffb21e) 50%,#fff));border-radius:5px;width:0}
.pbr-sub{font-size:12px;opacity:.75;margin-top:5px}
.pbr-pips{display:inline-flex;gap:4px;vertical-align:middle;margin-right:6px}
.pbr-pips i{width:12px;height:12px;border-radius:50%;background:#ffffff22;border:1px solid #ffffff44}
.pbr-pips i.w{background:#6cff8a;border-color:#6cff8a}.pbr-pips i.l{background:#ff6a5a;border-color:#ff6a5a}.pbr-pips i.on{background:#ffb21e;border-color:#ffb21e}
.pbr-actions{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
.pbr-actions .pb-go{padding:12px 22px;font-size:17px}
.pbr-search{display:flex;align-items:center;gap:12px;flex:1;background:#0b0e12a0;border:1px solid #ffffff22;border-radius:12px;padding:8px 12px}
.pbr-search b{font-size:18px;font-variant-numeric:tabular-nums}
.pbr-search span{font-size:12px;opacity:.75;display:block}
.pbr-spin{width:22px;height:22px;border-radius:50%;border:3px solid #ffffff26;border-top-color:#ffb21e;animation:pbrspin .8s linear infinite;flex:none}
@keyframes pbrspin{to{transform:rotate(360deg)}}
.pbr-rules{font-size:12px;opacity:.65;margin-top:10px;line-height:1.45}
.pbr-lb{min-width:min(92vw,560px);text-align:left}
.pbr-lb h2{text-align:center}
.pbr-lb .list{max-height:56vh;overflow:auto;margin-top:10px}
.pbr-lb table{width:100%;border-collapse:collapse;font-weight:800}
.pbr-lb td{padding:6px 8px;border-top:1px solid #ffffff12;font-variant-numeric:tabular-nums}
.pbr-lb th{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:1px;text-align:left;padding:4px 8px}
.pbr-lb td.n{opacity:.7;width:36px}.pbr-lb td.m{text-align:right}
.pbr-lb tr.you td{background:#ffb21e26}
.pbr-lb tr.you td:first-child{box-shadow:inset 3px 0 #ffb21e}
.pbr-lb .rk{font-size:12px;opacity:.85}
.pbr-res{margin:12px auto 4px;padding:14px 16px;border-radius:14px;background:#0b0e12a8;border:1px solid #ffffff1f;position:relative;overflow:hidden;max-width:440px}
.pbr-res .head{font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.8;font-weight:900}
.pbr-res .delta{font-size:40px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.1;margin:2px 0}
.pbr-res .delta.up{color:#6cff8a}.pbr-res .delta.down{color:#ff6a5a}
.pbr-res .row{display:flex;align-items:center;gap:14px;justify-content:center;text-align:left}
.pbr-res .pbr-badge{width:88px;height:88px;transition:transform .35s cubic-bezier(.3,1.6,.5,1)}
.pbr-res .pbr-badge.pop{animation:pbrpop .7s cubic-bezier(.3,1.6,.5,1)}
@keyframes pbrpop{0%{transform:scale(.3) rotate(-20deg);opacity:0}100%{transform:scale(1);opacity:1}}
.pbr-res .name{font-size:22px;font-weight:900}
.pbr-res .mm{font-size:13px;opacity:.8;font-weight:800;font-variant-numeric:tabular-nums}
.pbr-res .pbr-bar{height:11px;margin-top:8px}
.pbr-res .note{font-size:13px;margin-top:8px;font-weight:800}
.pbr-res .note.good{color:#6cff8a}.pbr-res .note.bad{color:#ff8a7a}.pbr-res .note.info{color:#ffcf6a}
.pbr-res .big{font-size:30px!important;letter-spacing:3px;margin-top:6px;animation:pbrpop .6s cubic-bezier(.3,1.6,.5,1)}
.pbr-res.promo{box-shadow:0 0 0 2px var(--rc),0 0 40px color-mix(in srgb,var(--rc) 60%,transparent)}
.pbr-res.demo{animation:pbrshake .5s}
@keyframes pbrshake{20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
.pbr-confetti{position:absolute;top:-10px;width:8px;height:14px;border-radius:2px;animation:pbrfall 1.8s ease-in forwards;pointer-events:none}
@keyframes pbrfall{to{transform:translateY(320px) rotate(540deg);opacity:0}}
.pbr-found{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.pbr-found div{display:flex;align-items:center;gap:10px;font-weight:800;background:#ffffff0b;border-radius:10px;padding:5px 10px}
.pbr-found small{margin-left:auto;opacity:.75}
.pb-board td .pbr-badge,.pb-result td .pbr-badge{width:24px;height:24px;border-radius:0;background:none;margin-right:6px}
.pb-team .pbr-badge{width:30px;height:30px;border:0;background:none;border-radius:0}
`;
    const s = document.createElement("style");
    s.id = "pbr-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function bar(pct) {
    const b = el("div", "pbr-bar"), i = el("i");
    i.style.width = Math.round(pct * 1000) / 10 + "%";
    b.appendChild(i);
    return b;
  }
  function pips(done, of, cls) {
    const p = el("span", "pbr-pips");
    for (let i = 0; i < of; i++) p.appendChild(el("i", i < done ? cls || "on" : ""));
    return p;
  }

  // Your rank in the Online tab.
  //   s = { signedIn, info, queued: { since }, search: { range, n }, err, active, rules, user }
  //   on = { queue, cancel, top, rejoin, signIn }
  function card(s, on) {
    addCSS();
    const box = el("div", "pb-box pbr-card");
    const head = el("div", "pb-boxhead");
    head.appendChild(el("h3", null, "🏆 Ranked"));
    if (s.signedIn) {
      const lb = el("button", "pb-btn small", "Leaderboard");
      lb.addEventListener("click", on.top);
      head.appendChild(lb);
    }
    box.appendChild(head);
    const rules = s.rules || { size: 4, toWin: 15, timeLimit: 480e3, placements: PLACEMENTS };
    const rulesText = "Free-for-all · up to " + rules.size + " players · first to " + rules.toWin + " eliminations · random map. You're matched with players of a similar rank. Leaving a match counts as a loss.";

    if (!s.signedIn) {
      const top = el("div", "pbr-top");
      top.appendChild(badge(null, 84));
      const who = el("div", "pbr-who");
      who.appendChild(el("div", "pbr-rank", "Play Ranked"));
      who.appendChild(el("div", "pb-help", s.checking
        ? "Signing you in…"
        : "Ranked needs a Mii Hub account, so your rank follows you to any device. Sign in or make one (it's free) in ⚙️ Settings → Account, then come back here. Casual lobbies below work without one!"));
      if (s.err) who.appendChild(el("div", "pb-status err", s.err));
      top.appendChild(who);
      box.appendChild(top);
      box.appendChild(el("div", "pbr-rules", rulesText));
      return box;
    }

    const info = s.info || { rank: rankFor(0, { placed: false }), placements: { done: 0, of: PLACEMENTS }, games: 0, wins: 0 };
    const rank = info.rank;
    box.style.setProperty("--rc", color(rank));
    const top = el("div", "pbr-top");
    top.appendChild(badge(rank, 84));
    const who = el("div", "pbr-who");
    const rk = el("div", "pbr-rank", rank.label);
    if (info.pos) rk.appendChild(el("small", null, "#" + info.pos + " on the server"));
    who.appendChild(rk);
    if (info.mmr == null) {
      // placements: the rating is hidden until all 5 are played
      const sub = el("div", "pbr-mmr");
      sub.append(pips(info.placements.done, info.placements.of), document.createTextNode("Placement matches " + info.placements.done + "/" + info.placements.of));
      who.appendChild(sub);
      who.appendChild(el("div", "pbr-sub", "Play " + (info.placements.of - info.placements.done) + " more to reveal your rank. Placements move your rating more than normal matches."));
    } else {
      const nx = nextRank(info.mmr), pr = info.progress || progress(info.mmr);
      who.appendChild(el("div", "pbr-mmr", fmt(info.mmr) + " MMR" + (nx ? " · " + Math.round(pr.ceil - info.mmr) + " to " + nx.label : rank.tier === "predator" ? " · top 10 on the server" : "")));
      who.appendChild(bar(pr.pct));
      const bits = [info.wins + " win" + (info.wins === 1 ? "" : "s") + " in " + info.games + " match" + (info.games === 1 ? "" : "es")];
      if (info.peak) bits.push("best " + fmt(info.peak));
      if (info.shield) bits.push("🛡 rank protection on");
      who.appendChild(el("div", "pbr-sub", bits.join(" · ")));
    }
    top.appendChild(who);
    box.appendChild(top);

    const act = el("div", "pbr-actions");
    if (s.active) {
      const go = el("button", "pb-go", "REJOIN MATCH ▶");
      go.addEventListener("click", on.rejoin);
      act.append(go, el("div", "pb-help warn", "You dropped out of a ranked match. Get back in before the timer runs out, or it counts as a loss."));
    } else if (s.queued) {
      const sr = el("div", "pbr-search");
      const t = el("b", null, "Searching… " + clock(performance.now() - s.queued.since));
      const sub = el("span", null, "");
      const fillSub = () => {
        const q = s.search || {};
        sub.textContent = (q.range ? "Looking for players within ±" + q.range + " MMR" : q.range === null ? "Looking for anyone (you've waited a while)" : "Looking for players near your rank") + (q.n ? " · " + q.n + " searching" : "");
      };
      fillSub();
      const txt = el("div"); txt.append(t, sub);
      sr.append(el("div", "pbr-spin"), txt);
      const cancel = el("button", "pb-btn", "Cancel");
      cancel.addEventListener("click", on.cancel);
      act.append(sr, cancel);
      // the clock ticks while the card is on screen
      const tick = setInterval(() => {
        if (!box.isConnected) return clearInterval(tick);
        t.textContent = "Searching… " + clock(performance.now() - s.queued.since);
        fillSub();
      }, 250);
    } else {
      const go = el("button", "pb-go", "FIND RANKED MATCH ▶");
      go.addEventListener("click", on.queue);
      act.appendChild(go);
    }
    box.appendChild(act);
    if (s.err) box.appendChild(el("div", "pb-status err", s.err));
    box.appendChild(el("div", "pbr-rules", rulesText));
    return box;
  }

  // "Match found!": who you're playing (shown while the map loads)
  function found(m) {
    addCSS();
    const box = el("div", "pb-box pbr-card");
    box.appendChild(el("h3", null, "🏆 Match found · " + (m.name || "")));
    const list = el("div", "pbr-found");
    for (const p of m.players || []) {
      const row = el("div");
      row.append(badge(p.rank, 28), el("span", null, p.name), el("small", null, (p.user ? "@" + p.user + " · " : "") + (p.rank ? p.rank.label : "")));
      list.appendChild(row);
    }
    box.appendChild(list);
    box.appendChild(el("div", "pb-status", "Loading the map…"));
    return box;
  }

  // The leaderboard: m = { list: [{ pos, user, mmr, rank, games, wins, you }], you }
  function leaderboard(m, onClose) {
    addCSS();
    const ov = el("div", "pb-overlay show pbr-lbov");
    const p = el("div", "pb-panel pbr-lb");
    p.appendChild(el("h2", null, "🏆 Ranked leaderboard"));
    p.appendChild(el("p", null, "The best players on this server. The top 10 at Master or higher are Predators."));
    const wrap = el("div", "list");
    const t = el("table");
    const hr = el("tr");
    for (const h of ["#", "Player", "Rank", "MMR", "Wins"]) hr.appendChild(el("th", null, h));
    t.appendChild(hr);
    const row = (r) => {
      const tr = el("tr", r.you ? "you" : "");
      tr.appendChild(el("td", "n", String(r.pos || "–")));
      const nm = el("td");
      nm.append(badge(r.rank, 28), document.createTextNode(" " + r.user + (r.you ? " (you)" : "")));
      tr.appendChild(nm);
      const rk = el("td", "rk", r.rank ? r.rank.label : "");
      rk.style.color = color(r.rank);
      tr.appendChild(rk);
      tr.appendChild(el("td", "m", fmt(r.mmr)));
      tr.appendChild(el("td", "m", r.wins + "/" + r.games));
      return tr;
    };
    const list = (m && m.list) || [];
    for (const r of list) t.appendChild(row(r));
    if (!list.length) { const tr = el("tr"); const td = el("td", null, "Nobody has finished their placement matches yet. Be the first!"); td.colSpan = 5; tr.appendChild(td); t.appendChild(tr); }
    // you, if you're not in the list
    const you = m && m.you;
    if (you && !list.some((r) => r.you)) {
      if (you.mmr != null) t.appendChild(row({ pos: you.pos, user: you.user, rank: you.rank, mmr: you.mmr, wins: you.wins, games: you.games, you: true }));
      else { const tr = el("tr", "you"); const td = el("td", null, "You: placement matches " + you.placements.done + "/" + you.placements.of); td.colSpan = 5; tr.appendChild(td); t.appendChild(tr); }
    }
    wrap.appendChild(t);
    p.appendChild(wrap);
    const btns = el("div", "btns");
    const close = el("button", "pb-btn primary", "Close");
    const shut = () => { ov.remove(); document.removeEventListener("keydown", esc, true); if (onClose) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); shut(); } };
    document.addEventListener("keydown", esc, true);
    close.addEventListener("click", shut);
    ov.addEventListener("click", (e) => { if (e.target === ov) shut(); });
    btns.appendChild(close);
    p.appendChild(btns);
    ov.appendChild(p);
    // you, in view (when you're further down the list)
    setTimeout(() => { const me = t.querySelector("tr.you"); if (me && me.scrollIntoView) me.scrollIntoView({ block: "nearest" }); }, 0);
    return ov;
  }

  // The end of a ranked match: MMR +/-, an animated bar, promotions and demotions.
  // r = the server's rkResult
  function result(r) {
    addCSS();
    const box = el("div", "pbr-res");
    const head = el("div", "head", "");
    const delta = el("div", "delta", "");
    const row = el("div", "row");
    let img = badge(r.before.rank, 88);
    const txt = el("div");
    const name = el("div", "name", r.before.rank.label);
    const mm = el("div", "mm", "");
    txt.append(name, mm);
    row.append(img, txt);
    const b = bar(0);
    const fill = b.firstChild;
    const notes = el("div");
    box.append(head, delta, row, b, notes);
    const note = (text, cls) => notes.appendChild(el("div", "note " + (cls || ""), text));
    const place = "Place " + r.place + " of " + r.of;

    const setRank = (rank, pop) => {
      const n = badge(rank, 88, pop ? "pop" : "");
      row.replaceChild(n, img);
      img = n;
      name.textContent = rank.label;
      name.style.color = color(rank);
      box.style.setProperty("--rc", color(rank));
    };
    name.style.color = color(r.before.rank);
    box.style.setProperty("--rc", color(r.before.rank));
    if (r.leaver) note("You left the match, so it counts as a loss.", "bad");

    // still in placements (the rating is hidden)
    if (r.placement && !r.justPlaced) {
      head.textContent = "Placement match " + r.placement.done + " of " + r.placement.of;
      delta.textContent = r.place === 1 ? "WIN" : place;
      delta.className = "delta " + (r.place === 1 ? "up" : "");
      b.style.display = "none";
      mm.appendChild(pips(r.placement.done, r.placement.of));
      mm.appendChild(document.createTextNode(" " + (r.placement.of - r.placement.done) + " to go"));
      if (!r.leaver) note(place + ". Your rank is revealed after " + r.placement.of + " placement matches.", "info");
      return box;
    }
    // the last placement: the reveal
    if (r.justPlaced) {
      head.textContent = "Placements complete";
      delta.textContent = "";
      fill.style.width = "0%";
      mm.textContent = "Revealing your rank…";
      setTimeout(() => {
        setRank(r.after.rank, true);
        delta.textContent = "RANK REVEALED";
        delta.className = "delta up big";
        mm.textContent = fmt(r.after.mmr) + " MMR";
        animateBar(fill, 0, r.after.progress ? r.after.progress.pct : 0, 900);
        celebrate(box, r.after.rank);
      }, 900);
      note(place, "info");
      return box;
    }

    // a normal match: count the MMR and run the bar, through a promotion or demotion
    head.textContent = place;
    const d = r.delta || 0;
    delta.textContent = (d >= 0 ? "+" : "−") + Math.abs(d) + " MMR";
    delta.className = "delta " + (d > 0 ? "up" : d < 0 ? "down" : "");
    const p0 = r.before.progress ? r.before.progress.pct : 0, p1 = r.after.progress ? r.after.progress.pct : 0;
    fill.style.width = p0 * 100 + "%";
    mm.textContent = fmt(r.before.mmr) + " MMR";
    const countTo = (ms) => {
      const t0 = performance.now(), a = r.before.mmr, z = r.after.mmr;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        mm.textContent = fmt(a + (z - a) * (1 - Math.pow(1 - k, 3))) + " MMR";
        if (k < 1 && box.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    setTimeout(() => {
      countTo(1400);
      if (r.promoted) {
        animateBar(fill, p0, 1, 600, () => {
          setRank(r.after.rank, true);
          fill.style.width = "0%";
          animateBar(fill, 0, p1, 700);
          const big = el("div", "delta up big", r.tierUp ? "PROMOTED!" : "DIVISION UP!");
          box.insertBefore(big, row);
          box.classList.add("promo");
          celebrate(box, r.after.rank);
        });
      } else if (r.demoted) {
        animateBar(fill, p0, 0, 600, () => {
          setRank(r.after.rank, true);
          fill.style.width = "100%";
          animateBar(fill, 1, p1, 700);
          box.insertBefore(el("div", "delta down big", r.tierDown ? "DEMOTED" : "DIVISION DOWN"), row);
          box.classList.add("demo");
        });
      } else animateBar(fill, p0, p1, 1200);
    }, 500);
    if (r.protected) note("🛡 Rank protection kept you in " + r.after.rank.name + " this time.", "info");
    else if (r.shield && r.tierUp) note("🛡 Rank protection: your next loss can't drop you out of " + r.after.rank.name + ".", "good");
    if (r.after.rank.tier === "predator" && r.before.rank.tier !== "predator") note("You're one of the top 10 players on the server!", "good");
    return box;
  }
  function animateBar(fill, from, to, ms, done) {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      fill.style.width = (from + (to - from) * e) * 100 + "%";
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    };
    requestAnimationFrame(step);
  }
  function celebrate(box, rank) {
    const cols = (COLORS[rank.tier] || COLORS.gold).concat(["#ffffff", "#ffb21e"]);
    for (let i = 0; i < 40; i++) {
      const c = el("i", "pbr-confetti");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = cols[i % cols.length];
      c.style.animationDelay = Math.random() * 0.5 + "s";
      c.style.animationDuration = 1.2 + Math.random() * 1.2 + "s";
      box.appendChild(c);
      setTimeout(() => c.remove(), 3200);
    }
  }

  const api = { TIERS, DIV_SIZE, PLACEMENTS, ROMAN, COLORS, rankFor, progress, nextRank, tierOfMmr, badgeSVG, badgeURL, badge, color, card, found, leaderboard, result, addCSS };
  root.PBRanked = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
