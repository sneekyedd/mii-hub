/*
 * pb-map.js - the Paintball maps: "Shipment" (the container yard) dressed up as
 * each hub place, and each place's own floor plan (pb-layouts.js, drawn by pb-scenery.js).
 *
 * Real scale: 1 unit = 1 m. Ground is y = 0. Playable area x -15.9..15.9, z -17..17.
 * Classic script, uses global THREE (r147). Everything is procedural (CanvasTexture),
 * static geometry is merged per material, drums are instanced.
 *
 * Tuned for renderer.outputEncoding = THREE.sRGBEncoding, no tone mapping,
 * shadowMap enabled (PCFSoft). Camera far should be >= 140 (sky dome radius 95).
 *
 *   window.PBMap.build({ map }) -> { group, boxes, cyls, bounds, spawns, background, fog, update, dispose, mapId, name }
 *   (map = an id from PBLayouts.MAPS; the default is Shipment in the park)
 */
(function () {
  'use strict';

  var PI = Math.PI;
  // 20ft ISO container: 6.06 x 2.44 x 2.59 (high cube 2.896)
  var CL = 6.06, CW = 2.44, CH = 2.59, CHC = 2.896, HW = CW / 2, HL = CL / 2;
  var BOUNDS = { minX: -15.9, maxX: 15.9, minZ: -17.0, maxZ: 17.0 };

  // ---------------------------------------------------------------- utils
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function rgb(a, k) { k = k == null ? 1 : k; return 'rgb(' + cl(a[0] * k) + ',' + cl(a[1] * k) + ',' + cl(a[2] * k) + ')'; }
  function rgba(a, al, k) { k = k == null ? 1 : k; return 'rgba(' + cl(a[0] * k) + ',' + cl(a[1] * k) + ',' + cl(a[2] * k) + ',' + al + ')'; }
  var CTX_OPTS = { willReadFrequently: true }; // CPU-backed canvases: much faster for procedural drawing + readback
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function linCol(a, k) { // sRGB 0..255 triple -> linear THREE.Color (for vertex colors)
    k = k == null ? 1 : k;
    return new THREE.Color(Math.min(1, a[0] * k / 255), Math.min(1, a[1] * k / 255), Math.min(1, a[2] * k / 255)).convertSRGBToLinear();
  }
  function hexLin(h) { return new THREE.Color(h).convertSRGBToLinear(); }

  function grain(ctx, x, y, w, h, amp, rnd, chroma) {
    var img = ctx.getImageData(x, y, w, h), d = img.data, i, n;
    for (i = 0; i < d.length; i += 4) {
      n = (rnd() - 0.5) * amp;
      if (chroma) { d[i] += n + (rnd() - 0.5) * chroma; d[i + 1] += n; d[i + 2] += n + (rnd() - 0.5) * chroma; }
      else { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    }
    ctx.putImageData(img, x, y);
  }
  // soft value-noise blotches (overlay/multiply) - small random canvas scaled up with smoothing
  function blotch(ctx, x, y, w, h, gw, gh, rnd, alpha, mode, range) {
    var s = mkCanvas(gw, gh), sc = s.getContext('2d', CTX_OPTS), img = sc.createImageData(gw, gh), d = img.data, i, g;
    range = range == null ? 120 : range;
    for (i = 0; i < d.length; i += 4) { g = 128 + (rnd() - 0.5) * 2 * range; d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255; }
    sc.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = mode || 'overlay';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s, x, y, w, h);
    ctx.restore();
  }
  function clipRect(ctx, x, y, w, h) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }

  var RUST = [[92, 44, 20], [118, 60, 28], [140, 78, 36], [70, 36, 20]];
  var WEAR = 1; // how weathered the containers look (set per place)
  function rustStreaks(ctx, x, y, w, h, n, rnd, y0) {
    n = Math.round(n * WEAR);
    for (var i = 0; i < n; i++) {
      var sx = x + rnd() * w, sy = y + (y0 || 0) + rnd() * h * 0.15, len = 8 + rnd() * h * 0.7, ww = 0.8 + rnd() * 2.6;
      var c = RUST[(rnd() * RUST.length) | 0], g = ctx.createLinearGradient(0, sy, 0, sy + len);
      g.addColorStop(0, rgba(c, 0.2 + rnd() * 0.45)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(sx, sy, ww, len);
    }
  }
  function rustPatches(ctx, x, y, w, h, n, rnd, bottomBias, size) {
    n = Math.round(n * WEAR);
    size = size || 5;
    for (var i = 0; i < n; i++) {
      var cx = x + rnd() * w, cy = bottomBias ? y + h * (1 - Math.pow(rnd(), 2.2) * bottomBias) : y + rnd() * h;
      var k = 2 + (rnd() * 6) | 0, c = RUST[(rnd() * RUST.length) | 0];
      for (var j = 0; j < k; j++) {
        ctx.fillStyle = rgba(c, 0.35 + rnd() * 0.5, 0.8 + rnd() * 0.4);
        ctx.beginPath();
        ctx.ellipse(cx + (rnd() - 0.5) * size * 2, cy + (rnd() - 0.5) * size * 1.4, 0.6 + rnd() * size, 0.5 + rnd() * size * 0.7, rnd() * 3, 0, 7);
        ctx.fill();
      }
    }
  }
  function scratches(ctx, x, y, w, h, n, rnd) {
    n = Math.round(n * WEAR);
    for (var i = 0; i < n; i++) {
      var sx = x + rnd() * w, sy = y + rnd() * h, a = (rnd() - 0.5) * 1.2, l = 3 + rnd() * 22;
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(175,170,158,0.30)' : 'rgba(60,40,28,0.35)';
      ctx.lineWidth = 0.6 + rnd() * 0.8;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); ctx.stroke();
    }
  }
  function dusty(ctx, x, y, w, h, amt) { // desaturate + kicked-up dust from the ground
    amt *= WEAR;
    ctx.save();
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,' + (0.22 * amt) + ')'; ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h);
    g.addColorStop(0, 'rgba(150,134,110,0)'); g.addColorStop(1, 'rgba(150,134,110,' + (0.3 * amt) + ')');
    ctx.fillStyle = g; ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
    ctx.restore();
  }
  function grime(ctx, x, y, w, h, frac, alpha) {
    alpha *= WEAR;
    var g = ctx.createLinearGradient(0, y + h * (1 - frac), 0, y + h);
    g.addColorStop(0, 'rgba(48,38,28,0)'); g.addColorStop(1, 'rgba(48,38,28,' + alpha + ')');
    ctx.fillStyle = g; ctx.fillRect(x, y + h * (1 - frac), w, h * frac);
  }
  // stencil text, with weathering specks punched out in base color
  function stencil(ctx, text, cx, cy, size, fill, base, rnd, maxW, chip) {
    ctx.save();
    ctx.font = 'bold ' + size + 'px "Arial Black", Impact, "DejaVu Sans", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width, sx = 1;
    if (maxW && w > maxW) sx = maxW / w;
    ctx.translate(cx, cy); ctx.scale(sx, 1);
    ctx.fillStyle = fill; ctx.fillText(text, 0, 0);
    ctx.restore();
    if (chip && base) {
      var bw = Math.min(w * sx, maxW || 1e9);
      for (var i = 0; i < chip; i++) {
        ctx.fillStyle = rgba(base, 0.5 + rnd() * 0.5, 0.85 + rnd() * 0.3);
        ctx.fillRect(cx - bw / 2 + rnd() * bw, cy - size / 2 + rnd() * size, 1 + rnd() * 3, 1 + rnd() * 2);
      }
    }
  }
  function heightToNormal(hc, strength) {
    var w = hc.width, h = hc.height, src = hc.getContext('2d', CTX_OPTS).getImageData(0, 0, w, h).data;
    var out = mkCanvas(w, h), oc = out.getContext('2d', CTX_OPTS), img = oc.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      var y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y;
      for (var x = 0; x < w; x++) {
        var x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x;
        var dx = (src[(y * w + x1) * 4] - src[(y * w + x0) * 4]) / 255 * strength;
        var dy = (src[(y1 * w + x) * 4] - src[(y0 * w + x) * 4]) / 255 * strength;
        var nx = -dx, ny = dy, nz = 1, l = Math.sqrt(nx * nx + ny * ny + nz * nz), i = (y * w + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
    oc.putImageData(img, 0, 0);
    return out;
  }
  // corrugation profile (0..1 height) for phase t in [0,1)
  function prof(t) {
    if (t < 0.14) return t / 0.14;
    if (t < 0.5) return 1;
    if (t < 0.64) return 1 - (t - 0.5) / 0.14;
    return 0;
  }

  // ---------------------------------------------------------------- places
  // How Shipment (and each place's own map) looks in each hub place: container
  // paint and names, what's written on crates and barrels, the light and the air.
  // logo: 0 diamond, 1 waves, 2 star, 3 leaf, 4 cup, 5 heart, 6 sun, 7 planet, 8 shell, 9 chart
  function V(p, brand, code, logo) { return { p: p, brand: brand, code: code, logo: logo }; }
  var THEMES = {
    park: {
      paints: [{ base: [96, 176, 84] }, { base: [72, 156, 214] }, { base: [238, 192, 60] }, { base: [230, 108, 92] }, { base: [156, 118, 204] }, { base: [238, 230, 204], dark: true }],
      variants: [V(0, 'MII PARK', 'MPKU', 3), V(1, 'DUCK POND', 'DPDU', 1), V(2, 'SUNNY DAYS', 'SUNU', 6), V(3, 'PICNIC CO', 'PICU', 5),
        V(4, 'BLOSSOM', 'BLSU', 3), V(5, 'ACORN', 'ACNU', 3), V(0, 'MEADOW', 'MDWU', 6), V(1, 'LEAFY', 'LFYU', 3)],
      wear: 0.22, crate: ['APPLES', 'PICNIC', 'FRESH FRUIT', 'MII PARK ORCHARD'],
      drums: [[[64, 150, 84], 'COMPOST'], [[226, 120, 50], 'BIRD SEED']], wood: 'logs',
      ground: '#7fd65a', fog: ['#cdeeff', 0.0035], env: ['#8fd0ff', '#cdeeff', '#6cc84a'],
      light: { sky: '#d6f0ff', gnd: '#8fd16f', hemi: 1.05, amb: 0.4, key: '#fff4e0', keyI: 1.55, fill: 0.45 }, dust: '#fff6c8'
    },
    cafe: {
      paints: [{ base: [130, 86, 58] }, { base: [214, 90, 120] }, { base: [96, 178, 150] }, { base: [242, 200, 90] }, { base: [62, 86, 140] }, { base: [240, 228, 206], dark: true }],
      variants: [V(0, 'BEANS & CO', 'BNSU', 4), V(1, 'BOUTIQUE', 'BTQU', 5), V(2, 'MII CAFÉ', 'CAFU', 4), V(3, 'BAKERY', 'BKRU', 2),
        V(4, 'TOY BOX', 'TOYU', 2), V(5, 'CROISSANT', 'CRSU', 5), V(1, 'SWEETS', 'SWTU', 5), V(2, 'TEA TIME', 'TEAU', 4)],
      wear: 0.25, crate: ['COFFEE', 'BEANS', 'FLOUR 25 KG', 'CAFE STREET BAKERY'],
      drums: [[[150, 96, 60], 'COCOA'], [[214, 90, 120], 'JAM']], wood: 'planter',
      ground: '#d8d0c4', fog: ['#d9e8f0', 0.0035], env: ['#8fd0ff', '#d9e8f0', '#b8b0a4'],
      light: { sky: '#d6f0ff', gnd: '#d9c8a8', hemi: 1.0, amb: 0.4, key: '#fff4e0', keyI: 1.5, fill: 0.45 }, dust: null
    },
    beach: {
      paints: [{ base: [40, 180, 190] }, { base: [240, 110, 90] }, { base: [250, 204, 70] }, { base: [56, 120, 204] }, { base: [240, 132, 172] }, { base: [242, 238, 226], dark: true }],
      variants: [V(0, 'MII BEACH', 'MBCU', 8), V(1, 'CORAL REEF', 'CRLU', 8), V(2, 'SUN & SAND', 'SUNU', 6), V(3, 'SURF SHOP', 'SRFU', 1),
        V(4, 'ICE CREAM', 'ICEU', 5), V(5, 'SEASHELL', 'SHLU', 8), V(0, 'LIFEGUARD', 'LGDU', 1), V(3, 'TIKI BAR', 'TIKU', 6)],
      wear: 0.35, crate: ['ICE CREAM', 'SURF WAX', 'BEACH BALLS', 'MII BEACH SNACK BAR'],
      drums: [[[40, 160, 200], 'SUN CREAM'], [[250, 180, 60], 'LEMONADE']], wood: 'driftwood',
      ground: '#f5dfa4', fog: ['#cdeeff', 0.0035], env: ['#8fd0ff', '#cdeeff', '#f0d79a'],
      light: { sky: '#d6f0ff', gnd: '#f5dfa4', hemi: 1.05, amb: 0.42, key: '#fff4e0', keyI: 1.55, fill: 0.45 }, dust: '#fff2d0'
    },
    moon: {
      paints: [{ base: [236, 236, 242], dark: true }, { base: [150, 156, 172] }, { base: [240, 138, 52] }, { base: [150, 120, 210] }, { base: [70, 186, 220] }, { base: [214, 72, 80] }],
      variants: [V(0, 'MII SPACE', 'MSPU', 7), V(1, 'LUNAR', 'LNRU', 2), V(2, 'ROCKET', 'RKTU', 2), V(3, 'MOON BASE', 'MBSU', 7),
        V(4, 'ORBIT', 'ORBU', 7), V(5, 'STARDUST', 'STDU', 2), V(0, 'ASTRO', 'ASTU', 7), V(2, 'COSMO', 'CSMU', 2)],
      wear: 0.12, crate: ['SPACE FOOD', 'OXYGEN', 'MOON ROCKS', 'MII SPACE AGENCY'],
      drums: [[[236, 236, 242], 'FUEL'], [[240, 138, 52], 'OXYGEN']], wood: 'girder',
      ground: '#b9b0d6', fog: ['#3a2470', 0.0025], env: ['#3a2470', '#6a5aa8', '#b9b0d6'],
      light: { sky: '#c9c2ff', gnd: '#5a4f8a', hemi: 1.0, amb: 0.42, key: '#fff6e8', keyI: 1.5, fill: 0.5 }, dust: null
    },
    office: {
      paints: [{ base: [52, 104, 176] }, { base: [124, 132, 146] }, { base: [42, 152, 152] }, { base: [240, 140, 62] }, { base: [238, 238, 238], dark: true }, { base: [108, 180, 90] }],
      variants: [V(0, 'MII CORP', 'MCRU', 9), V(1, 'PAPER CO', 'PPRU', 0), V(2, 'IT SUPPORT', 'ITSU', 9), V(3, 'COFFEE', 'COFU', 4),
        V(4, 'MEMO', 'MEMU', 0), V(5, 'SYNERGY', 'SYNU', 9), V(0, 'SERVER', 'SRVU', 0), V(2, 'DATA', 'DATU', 9)],
      wear: 0.1, crate: ['PAPER', 'PRINTER INK', 'A4 500 SHEETS', 'MII CORP SUPPLIES'],
      drums: [[[52, 104, 176], 'WATER'], [[240, 140, 62], 'TONER']], wood: 'tray',
      ground: '#a3b1c8', fog: ['#d8efff', 0.003], env: ['#e9edf5', '#d8efff', '#9aa8c0'],
      light: { sky: '#ffffff', gnd: '#d9c7a8', hemi: 1.05, amb: 0.5, key: '#fff6e8', keyI: 1.1, fill: 0.5 }, dust: '#ffffff'
    }
  };
  var THEME = THEMES.park, PAINTS = THEME.paints, VARIANTS = THEME.variants;

  // The floor of the arena in each place. G = canvas size, GS = meters it covers,
  // gp(x, z) -> canvas point, gk = pixels per meter.
  function paintGround(gx, G, GS, gp, gk, rnd) {
    var set = THEME === THEMES.park ? 'park' : THEME === THEMES.cafe ? 'cafe' : THEME === THEMES.beach ? 'beach' : THEME === THEMES.moon ? 'moon' : 'office';
    var i, x, y, p;
    gx.fillStyle = THEME.ground; gx.fillRect(0, 0, G, G);
    if (set === 'park') {
      // mowed stripes, grass blades, flowers, and worn dirt where everyone runs
      for (i = -GS / 2; i < GS / 2; i += 2.5) { var a = gp(i, -GS / 2); gx.fillStyle = 'rgba(255,255,255,' + ((i / 2.5) % 2 ? 0.0 : 0.07) + ')'; gx.fillRect(a[0], 0, 2.5 * gk, G); }
      blotch(gx, 0, 0, G, G, 10, 10, rnd, 0.18, 'overlay', 90);
      for (i = 0; i < 9000; i++) { gx.strokeStyle = rnd() < 0.5 ? 'rgba(70,150,45,0.5)' : 'rgba(170,235,120,0.55)'; gx.lineWidth = 1.2; x = rnd() * G; y = rnd() * G; gx.beginPath(); gx.moveTo(x, y); gx.lineTo(x - 1, y - 4); gx.stroke(); }
      [[0, 14, 3.5], [0, -14, 3.5], [0, 0, 4.5], [-9, 6, 2.5], [9, -6, 2.5], [9, 9, 2], [-9, -9, 2]].forEach(function (d) {
        p = gp(d[0], d[1]); var g = gx.createRadialGradient(p[0], p[1], 0, p[0], p[1], d[2] * gk);
        g.addColorStop(0, 'rgba(201,160,110,0.55)'); g.addColorStop(0.6, 'rgba(201,160,110,0.3)'); g.addColorStop(1, 'rgba(201,160,110,0)');
        gx.fillStyle = g; gx.fillRect(p[0] - d[2] * gk, p[1] - d[2] * gk, d[2] * 2 * gk, d[2] * 2 * gk);
      });
      var fl = ['#ff9ec7', '#ffe25a', '#ffffff', '#b48cff'];
      for (i = 0; i < 700; i++) { gx.fillStyle = fl[i % 4]; x = rnd() * G; y = rnd() * G; gx.beginPath(); gx.arc(x, y, 1.6 + rnd() * 1.2, 0, 7); gx.fill(); }
    } else if (set === 'cafe') {
      // cobblestones, with a ring pattern around the middle
      var cs = 0.42 * gk;
      for (y = 0; y < G; y += cs) for (x = ((y / cs) % 2) * cs / 2 - cs; x < G; x += cs) {
        var v = 200 + rnd() * 30;
        gx.fillStyle = 'rgb(' + (v | 0) + ',' + ((v - 8) | 0) + ',' + ((v - 20) | 0) + ')';
        gx.beginPath(); gx.roundRect ? gx.roundRect(x + 1.5, y + 1.5, cs - 3, cs - 3, 3) : gx.rect(x + 1.5, y + 1.5, cs - 3, cs - 3); gx.fill();
      }
      p = gp(0, 0);
      for (i = 0; i < 3; i++) { gx.strokeStyle = 'rgba(170,140,110,0.6)'; gx.lineWidth = 0.35 * gk; gx.beginPath(); gx.arc(p[0], p[1], (3.2 + i * 1.6) * gk, 0, 7); gx.stroke(); }
      for (i = -1; i <= 1; i += 2) { var b0 = gp(-GS / 2, i * 15.8); gx.fillStyle = 'rgba(160,150,140,0.5)'; gx.fillRect(0, b0[1] - 0.3 * gk, G, 0.6 * gk); }
      blotch(gx, 0, 0, G, G, 12, 12, rnd, 0.12, 'overlay', 80);
    } else if (set === 'beach') {
      blotch(gx, 0, 0, G, G, 8, 8, rnd, 0.25, 'overlay', 70);
      for (i = 0; i < 160; i++) { // ripples in the sand
        x = rnd() * G; y = rnd() * G; gx.strokeStyle = 'rgba(200,170,110,0.35)'; gx.lineWidth = 1.5;
        gx.beginPath(); gx.moveTo(x, y); gx.quadraticCurveTo(x + 20, y - 6, x + 40, y); gx.stroke();
      }
      for (i = 0; i < 6000; i++) { gx.fillStyle = rnd() < 0.5 ? 'rgba(220,190,130,0.5)' : 'rgba(255,248,225,0.6)'; gx.fillRect(rnd() * G, rnd() * G, 1.5, 1.5); }
      var sh = ['#ffffff', '#ffc4d8', '#ffe0b0'];
      for (i = 0; i < 70; i++) { gx.fillStyle = sh[i % 3]; x = rnd() * G; y = rnd() * G; gx.beginPath(); gx.arc(x, y, 3, PI, 0); gx.fill(); }
      for (i = 0; i < 60; i++) { // footprints
        x = rnd() * G; y = rnd() * G; var ang = rnd() * 7;
        for (var st = 0; st < 6; st++) { gx.fillStyle = 'rgba(190,160,100,0.35)'; gx.beginPath(); gx.ellipse(x + Math.cos(ang) * st * 14 + (st % 2) * 5, y + Math.sin(ang) * st * 14, 3, 5, ang + PI / 2, 0, 7); gx.fill(); }
      }
      var tw = [['#ff9ec7', '#ffffff'], ['#7fd0ff', '#ffffff'], ['#ffe25a', '#ff8a3a']];
      [[-7, 13.5], [7, -13.5], [12.5, 6], [-12.5, -6]].forEach(function (t, k) { // beach towels
        p = gp(t[0], t[1]); gx.save(); gx.translate(p[0], p[1]); gx.rotate(k * 0.7);
        for (var s2 = 0; s2 < 6; s2++) { gx.fillStyle = tw[k % 3][s2 % 2]; gx.fillRect(-0.9 * gk + s2 * 0.3 * gk, -0.5 * gk, 0.3 * gk, 1.0 * gk); }
        gx.restore();
      });
    } else if (set === 'moon') {
      for (i = 0; i < 1800; i++) { gx.fillStyle = rnd() < 0.5 ? 'rgba(150,138,190,0.28)' : 'rgba(225,220,245,0.3)'; gx.beginPath(); gx.arc(rnd() * G, rnd() * G, 1 + rnd() * 5, 0, 7); gx.fill(); }
      for (i = 0; i < 26; i++) { // little craters
        x = rnd() * G; y = rnd() * G; var r = (0.5 + rnd() * 1.6) * gk;
        gx.fillStyle = 'rgba(140,128,180,0.5)'; gx.beginPath(); gx.arc(x, y, r, 0, 7); gx.fill();
        gx.strokeStyle = 'rgba(230,226,248,0.6)'; gx.lineWidth = r * 0.2; gx.beginPath(); gx.arc(x, y, r * 1.05, PI * 0.9, PI * 1.9); gx.stroke();
      }
      for (i = 0; i < 40; i++) { x = rnd() * G; y = rnd() * G; gx.fillStyle = 'rgba(120,110,160,0.25)'; for (var s3 = 0; s3 < 7; s3++) gx.fillRect(x + s3 * 9, y + (s3 % 2) * 4, 6, 3); } // boot prints
    } else {
      // carpet tiles (two blue-grays) with a light walkway down the middle
      var ts = 0.6 * gk;
      for (y = 0; y < G; y += ts) for (x = 0; x < G; x += ts) {
        gx.fillStyle = ((x / ts + y / ts) | 0) % 2 ? '#9aa8c0' : '#a6b4cb'; gx.fillRect(x, y, ts, ts);
        gx.strokeStyle = 'rgba(80,90,110,0.18)'; gx.lineWidth = 1; gx.strokeRect(x, y, ts, ts);
      }
      blotch(gx, 0, 0, G, G, 16, 16, rnd, 0.1, 'overlay', 60);
      var w0 = gp(-1.0, 0); gx.fillStyle = 'rgba(220,226,236,0.5)'; gx.fillRect(w0[0], 0, 2.0 * gk, G);
    }
  }

  // ---------------------------------------------------------------- textures
  // Atlas A (1024): 8 container side cells 512x256 (col = i%2, row = i>>1)
  function drawLogo(ctx, kind, cx, cy, r, col) {
    ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = r * 0.16;
    if (kind === 0) { // diamond with bar
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.stroke();
      ctx.fillRect(cx - r * 0.45, cy - r * 0.12, r * 0.9, r * 0.24);
    } else if (kind === 1) { // ring with waves
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      for (var i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(cx - r * 0.6, cy + i * r * 0.35);
        ctx.quadraticCurveTo(cx - r * 0.3, cy + i * r * 0.35 - r * 0.2, cx, cy + i * r * 0.35);
        ctx.quadraticCurveTo(cx + r * 0.3, cy + i * r * 0.35 + r * 0.2, cx + r * 0.6, cy + i * r * 0.35);
        ctx.lineWidth = r * 0.1; ctx.stroke();
      }
    } else if (kind === 3) { // leaf
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.55, r, 0.6, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy + r * 0.7); ctx.lineTo(cx + r * 0.45, cy - r * 0.65); ctx.stroke();
    } else if (kind === 4) { // cup
      ctx.fillRect(cx - r * 0.6, cy - r * 0.4, r * 1.0, r * 1.0);
      ctx.lineWidth = r * 0.16; ctx.beginPath(); ctx.arc(cx + r * 0.45, cy + r * 0.1, r * 0.3, -1.4, 1.4); ctx.stroke();
      for (var w = -1; w <= 1; w++) { ctx.lineWidth = r * 0.09; ctx.beginPath(); ctx.moveTo(cx - r * 0.1 + w * r * 0.25, cy - r * 0.55); ctx.quadraticCurveTo(cx + w * r * 0.25 + r * 0.1, cy - r * 0.8, cx - r * 0.1 + w * r * 0.25, cy - r * 1.0); ctx.stroke(); }
    } else if (kind === 5) { // heart
      ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.8);
      ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.1, cx - r * 0.6, cy - r * 1.1, cx, cy - r * 0.35);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.1, cx + r * 1.3, cy - r * 0.1, cx, cy + r * 0.8); ctx.fill();
    } else if (kind === 6) { // sun
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, 7); ctx.fill();
      for (var k6 = 0; k6 < 8; k6++) { var a6 = k6 * PI / 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a6) * r * 0.65, cy + Math.sin(a6) * r * 0.65); ctx.lineTo(cx + Math.cos(a6) * r, cy + Math.sin(a6) * r); ctx.stroke(); }
    } else if (kind === 7) { // ringed planet
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, 7); ctx.fill();
      ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.0, r * 0.32, -0.35, 0, 7); ctx.stroke();
    } else if (kind === 8) { // shell
      ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.8); ctx.arc(cx, cy + r * 0.1, r * 0.9, PI * 1.05, PI * 1.95); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = r * 0.07;
      for (var k8 = -2; k8 <= 2; k8++) { ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.8); ctx.lineTo(cx + k8 * r * 0.35, cy - r * 0.6); ctx.stroke(); }
    } else if (kind === 9) { // bar chart
      [0.4, 0.75, 0.55, 1.0].forEach(function (hh, k9) { ctx.fillRect(cx - r + k9 * r * 0.52, cy + r - hh * r * 1.8, r * 0.38, hh * r * 1.8); });
    } else { // star
      ctx.beginPath();
      for (var k = 0; k < 10; k++) {
        var a = k * PI / 5 - PI / 2, rr = k % 2 ? r * 0.42 : r;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function codeNum(rnd, pre) { var s = pre + ' '; for (var i = 0; i < 6; i++) s += (rnd() * 10) | 0; return s + ' ' + ((rnd() * 10) | 0); }

  function buildAtlasA(rnd) {
    var S = 1024, c = mkCanvas(S, S), ctx = c.getContext('2d', CTX_OPTS), hc = mkCanvas(S, S), hx = hc.getContext('2d', CTX_OPTS);
    var W = 512, H = 256, P = W / 26;
    for (var i = 0; i < 8; i++) {
      var V = VARIANTS[i], base = PAINTS[V.p].base, ox = (i % 2) * W, oy = (i >> 1) * H;
      clipRect(ctx, ox, oy, W, H);
      ctx.fillStyle = rgb(base); ctx.fillRect(ox, oy, W, H);
      blotch(ctx, ox, oy, W, H, 6, 3, rnd, 0.35, 'overlay', 90);
      blotch(ctx, ox, oy, W, H, 40, 12, rnd, 0.22, 'overlay', 110);
      // corrugation shading
      for (var x = 0; x < W; x++) {
        var t = (x % P) / P, a;
        if (t < 0.14) a = 'rgba(0,0,0,0.16)'; else if (t < 0.5) a = 'rgba(255,255,255,0.03)';
        else if (t < 0.64) a = 'rgba(255,240,220,0.07)'; else a = 'rgba(0,0,0,0.06)';
        ctx.fillStyle = a; ctx.fillRect(ox + x, oy, 1, H);
      }
      // rails & posts
      ctx.fillStyle = rgba(base, 1, 0.8); ctx.fillRect(ox, oy, W, 12); ctx.fillRect(ox, oy + H - 14, W, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(ox, oy + 11, W, 2); ctx.fillRect(ox, oy + H - 14, W, 2);
      ctx.fillStyle = rgba(base, 1, 0.72); ctx.fillRect(ox, oy, 9, H); ctx.fillRect(ox + W - 9, oy, 9, H);
      ctx.fillStyle = 'rgba(30,25,20,0.5)';
      ctx.fillRect(ox, oy, 12, 12); ctx.fillRect(ox + W - 12, oy, 12, 12); ctx.fillRect(ox, oy + H - 14, 12, 14); ctx.fillRect(ox + W - 12, oy + H - 14, 12, 14);
      // markings
      var tc = PAINTS[V.p].dark ? 'rgba(40,38,36,0.85)' : 'rgba(228,224,212,0.86)';
      var big = V.brand.length > 9 ? 50 : 62;
      drawLogo(ctx, V.logo, ox + 70, oy + 124, 34, tc);
      stencil(ctx, V.brand, ox + 285, oy + 126, big, tc, base, rnd, 360, 260);
      ctx.font = 'bold 15px "DejaVu Sans Mono", "Courier New", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = tc; ctx.fillText(codeNum(rnd, V.code), ox + W - 160, oy + 34); ctx.fillText('22G1', ox + W - 160, oy + 52);
      ctx.font = '8px monospace';
      ctx.fillText('MAX GR 30480 KG', ox + 24, oy + 30); ctx.fillText('TARE   2230 KG', ox + 24, oy + 40); ctx.fillText('NET   28250 KG', ox + 24, oy + 50);
      if (rnd() < 0.6) { // hazard / port label sticker
        ctx.fillStyle = 'rgba(210,205,190,0.75)'; ctx.fillRect(ox + W - 70, oy + 170, 26, 34);
        ctx.fillStyle = 'rgba(90,60,40,0.6)'; ctx.fillRect(ox + W - 66, oy + 176, 18, 3); ctx.fillRect(ox + W - 66, oy + 184, 14, 2);
      }
      // weathering
      rustStreaks(ctx, ox, oy, W, H, 60, rnd, 8);
      rustPatches(ctx, ox, oy + 8, W, H - 8, 70, rnd, 0.35, 5);
      rustPatches(ctx, ox, oy, W, 18, 30, rnd, 0, 3);
      rustPatches(ctx, ox, oy, 14, H, 14, rnd, 0, 3); rustPatches(ctx, ox + W - 14, oy, 14, H, 14, rnd, 0, 3);
      scratches(ctx, ox, oy, W, H, 120, rnd);
      for (var dn = 0; dn < 5; dn++) { // dents
        var dx = ox + 30 + rnd() * (W - 60), dy = oy + 40 + rnd() * (H - 80), dr = 10 + rnd() * 25;
        var g = ctx.createRadialGradient(dx, dy, 1, dx, dy, dr); g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
      }
      grime(ctx, ox, oy, W, H, 0.45, 0.5);
      dusty(ctx, ox, oy, W, H, 1);
      ctx.fillStyle = 'rgba(20,18,16,0.15)'; ctx.fillRect(ox, oy, W, 4);
      ctx.restore();
      grain(ctx, ox, oy, W, H, 16, rnd, 6);
      // height
      for (x = 0; x < W; x++) { var hv = cl(60 + prof((x % P) / P) * 110); hx.fillStyle = 'rgb(' + hv + ',' + hv + ',' + hv + ')'; hx.fillRect(ox + x, oy, 1, H); }
      hx.fillStyle = 'rgb(200,200,200)'; hx.fillRect(ox, oy, W, 12); hx.fillRect(ox, oy + H - 14, W, 14);
      hx.fillStyle = 'rgb(220,220,220)'; hx.fillRect(ox, oy, 9, H); hx.fillRect(ox + W - 9, oy, 9, H);
    }
    return { map: c, normal: heightToNormal(hc, 2.2) };
  }

  // Atlas B (1024): 4x4 cells of 256. door 0..7 (rows 0,1), front 0..5 (row 2, row 3 col 0-1), interior (2,3), interior2 (3,3)
  function cellB(col, row) { return [col * 256, row * 256]; }
  function buildAtlasB(rnd) {
    var S = 1024, c = mkCanvas(S, S), ctx = c.getContext('2d', CTX_OPTS), hc = mkCanvas(S, S), hx = hc.getContext('2d', CTX_OPTS);
    var i, x, ox, oy, base, P;
    function hfill(v, x0, y0, w, h) { hx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; hx.fillRect(x0, y0, w, h); }
    // doors
    for (i = 0; i < 8; i++) {
      var V = VARIANTS[i]; base = PAINTS[V.p].base; ox = (i % 4) * 256; oy = (i >> 2) * 256;
      clipRect(ctx, ox, oy, 256, 256);
      ctx.fillStyle = rgb(base); ctx.fillRect(ox, oy, 256, 256);
      blotch(ctx, ox, oy, 256, 256, 5, 5, rnd, 0.35, 'overlay', 90);
      blotch(ctx, ox, oy, 256, 256, 24, 24, rnd, 0.2, 'overlay', 100);
      P = 112 / 5;
      for (x = 16; x < 240; x++) {
        var lx = x < 128 ? x - 16 : x - 128, t = (lx % P) / P;
        ctx.fillStyle = t < 0.14 ? 'rgba(0,0,0,0.18)' : t < 0.5 ? 'rgba(255,255,255,0.03)' : t < 0.64 ? 'rgba(255,240,220,0.08)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(ox + x, oy + 22, 1, 216);
      }
      // frame
      ctx.fillStyle = rgba(base, 1, 0.7); ctx.fillRect(ox, oy, 16, 256); ctx.fillRect(ox + 240, oy, 16, 256);
      ctx.fillRect(ox, oy, 256, 22); ctx.fillRect(ox, oy + 238, 256, 18);
      ctx.fillStyle = 'rgba(25,20,16,0.55)'; ctx.fillRect(ox + 127, oy + 22, 2, 216); // leaf gap
      ctx.fillStyle = 'rgba(25,20,16,0.4)';
      ctx.fillRect(ox, oy, 18, 18); ctx.fillRect(ox + 238, oy, 18, 18); ctx.fillRect(ox, oy + 238, 18, 18); ctx.fillRect(ox + 238, oy + 238, 18, 18);
      // hinges
      [40, 95, 160, 215].forEach(function (hy) {
        ctx.fillStyle = rgba(base, 1, 0.55); ctx.fillRect(ox + 14, oy + hy, 9, 12); ctx.fillRect(ox + 233, oy + hy, 9, 12);
      });
      // rods + cams + handles
      [47, 97, 159, 209].forEach(function (rx, k) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(ox + rx - 1, oy + 22, 7, 216);
        ctx.fillStyle = rgba(base, 1, 1.05); ctx.fillRect(ox + rx - 2, oy + 22, 5, 216);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(ox + rx - 2, oy + 22, 1, 216);
        ctx.fillStyle = rgba(base, 1, 0.6); ctx.fillRect(ox + rx - 5, oy + 24, 11, 12); ctx.fillRect(ox + rx - 5, oy + 222, 11, 12);
        var dir = (k % 2 === 0) ? 1 : -1; if (k >= 2) dir = -dir;
        ctx.fillStyle = rgba(base, 1, 0.9); ctx.fillRect(ox + rx + (dir > 0 ? 2 : -20), oy + 146, 18, 5);
        ctx.fillStyle = 'rgba(20,20,20,0.5)'; ctx.fillRect(ox + rx + (dir > 0 ? 12 : -14), oy + 140, 4, 16);
      });
      var tc = PAINTS[V.p].dark ? 'rgba(40,38,36,0.85)' : 'rgba(228,224,212,0.86)';
      ctx.font = 'bold 11px "DejaVu Sans Mono", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = tc;
      ctx.fillText(codeNum(rnd, V.code), ox + 140, oy + 40); ctx.fillText('22G1', ox + 140, oy + 54);
      ctx.font = 'bold 13px "Arial Black", sans-serif'; ctx.fillText(V.brand.split(' ')[0], ox + 136, oy + 74);
      ctx.fillStyle = 'rgba(205,200,186,0.8)'; ctx.fillRect(ox + 60, oy + 175, 26, 18); // CSC plate
      ctx.fillStyle = 'rgba(80,70,60,0.6)'; ctx.fillRect(ox + 63, oy + 179, 20, 2); ctx.fillRect(ox + 63, oy + 185, 14, 2);
      rustStreaks(ctx, ox, oy, 256, 256, 30, rnd, 20);
      rustPatches(ctx, ox, oy, 256, 256, 40, rnd, 0.35, 4);
      rustPatches(ctx, ox, oy, 256, 24, 14, rnd, 0, 3);
      scratches(ctx, ox, oy, 256, 256, 60, rnd);
      grime(ctx, ox, oy, 256, 256, 0.4, 0.5);
      dusty(ctx, ox, oy, 256, 256, 1);
      ctx.restore();
      grain(ctx, ox, oy, 256, 256, 16, rnd, 6);
      hfill(150, ox, oy, 256, 256);
      for (x = 16; x < 240; x++) { var lx2 = x < 128 ? x - 16 : x - 128; hfill(cl(70 + prof((lx2 % P) / P) * 70), ox + x, oy + 22, 1, 216); }
      hfill(200, ox, oy, 16, 256); hfill(200, ox + 240, oy, 16, 256); hfill(200, ox, oy, 256, 22); hfill(200, ox, oy + 238, 256, 18);
      hfill(20, ox + 127, oy + 22, 2, 216);
      [47, 97, 159, 209].forEach(function (rx) { hfill(200, ox + rx - 2, oy + 22, 5, 216); hfill(250, ox + rx - 1, oy + 22, 3, 216); hfill(240, ox + rx - 5, oy + 24, 11, 12); hfill(240, ox + rx - 5, oy + 222, 11, 12); });
    }
    // fronts (corrugated end wall) per paint
    for (i = 0; i < 6; i++) {
      base = PAINTS[i].base; var cc = i < 4 ? cellB(i, 2) : cellB(i - 4, 3); ox = cc[0]; oy = cc[1];
      clipRect(ctx, ox, oy, 256, 256);
      ctx.fillStyle = rgb(base); ctx.fillRect(ox, oy, 256, 256);
      blotch(ctx, ox, oy, 256, 256, 5, 5, rnd, 0.35, 'overlay', 90);
      P = 224 / 5;
      for (x = 16; x < 240; x++) {
        var t2 = ((x - 16) % P) / P;
        ctx.fillStyle = t2 < 0.14 ? 'rgba(0,0,0,0.2)' : t2 < 0.5 ? 'rgba(255,255,255,0.03)' : t2 < 0.64 ? 'rgba(255,240,220,0.09)' : 'rgba(0,0,0,0.08)';
        ctx.fillRect(ox + x, oy, 1, 256);
      }
      ctx.fillStyle = rgba(base, 1, 0.7); ctx.fillRect(ox, oy, 16, 256); ctx.fillRect(ox + 240, oy, 16, 256); ctx.fillRect(ox, oy, 256, 14); ctx.fillRect(ox, oy + 242, 256, 14);
      rustStreaks(ctx, ox, oy, 256, 256, 30, rnd, 10);
      rustPatches(ctx, ox, oy, 256, 256, 40, rnd, 0.4, 4);
      scratches(ctx, ox, oy, 256, 256, 50, rnd);
      grime(ctx, ox, oy, 256, 256, 0.4, 0.45);
      dusty(ctx, ox, oy, 256, 256, 1);
      ctx.restore();
      grain(ctx, ox, oy, 256, 256, 16, rnd, 6);
      for (x = 0; x < 256; x++) hfill(x < 16 || x >= 240 ? 210 : cl(60 + prof(((x - 16) % P) / P) * 120), ox + x, oy, 1, 256);
      hfill(210, ox, oy, 256, 14); hfill(210, ox, oy + 242, 256, 14);
    }
    // interiors
    for (i = 0; i < 2; i++) {
      ox = (2 + i) * 256; oy = 768;
      clipRect(ctx, ox, oy, 256, 256);
      ctx.fillStyle = i ? '#7d776c' : '#8b877d'; ctx.fillRect(ox, oy, 256, 256);
      blotch(ctx, ox, oy, 256, 256, 6, 6, rnd, 0.4, 'overlay', 100);
      P = 256 / 26;
      for (x = 0; x < 256; x++) { var t3 = (x % P) / P; ctx.fillStyle = t3 < 0.14 ? 'rgba(0,0,0,0.18)' : t3 < 0.64 && t3 > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'; ctx.fillRect(ox + x, oy, 1, 256); }
      rustStreaks(ctx, ox, oy, 256, 256, 40, rnd, 0);
      rustPatches(ctx, ox, oy, 256, 256, 60 + i * 60, rnd, 0.5, 4);
      scratches(ctx, ox, oy, 256, 256, 120, rnd);
      grime(ctx, ox, oy, 256, 256, 0.35, 0.6);
      ctx.restore();
      grain(ctx, ox, oy, 256, 256, 18, rnd, 4);
      for (x = 0; x < 256; x++) hfill(cl(80 + prof((x % P) / P) * 90), ox + x, oy, 1, 256);
    }
    return { map: c, normal: heightToNormal(hc, 2.0) };
  }

  // wood / cargo atlas (512)
  function buildWood(rnd) {
    var c = mkCanvas(512, 512), ctx = c.getContext('2d', CTX_OPTS);
    function planks(ox, oy, w, h, n, horiz, col, varr) {
      var sz = (horiz ? h : w) / n;
      for (var k = 0; k < n; k++) {
        var cc = [col[0] + (rnd() - 0.5) * varr, col[1] + (rnd() - 0.5) * varr * 0.8, col[2] + (rnd() - 0.5) * varr * 0.6];
        ctx.fillStyle = rgb(cc);
        if (horiz) ctx.fillRect(ox, oy + k * sz, w, sz); else ctx.fillRect(ox + k * sz, oy, sz, h);
        // grain lines
        for (var g = 0; g < 14; g++) {
          ctx.strokeStyle = 'rgba(40,25,10,' + (0.06 + rnd() * 0.12) + ')'; ctx.lineWidth = 0.6 + rnd();
          ctx.beginPath();
          if (horiz) { var yy = oy + k * sz + rnd() * sz; ctx.moveTo(ox, yy); ctx.bezierCurveTo(ox + w * 0.3, yy + (rnd() - 0.5) * 4, ox + w * 0.7, yy + (rnd() - 0.5) * 4, ox + w, yy); }
          else { var xx = ox + k * sz + rnd() * sz; ctx.moveTo(xx, oy); ctx.bezierCurveTo(xx + (rnd() - 0.5) * 4, oy + h * 0.3, xx + (rnd() - 0.5) * 4, oy + h * 0.7, xx, oy + h); }
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(25,15,8,0.55)';
        if (horiz) ctx.fillRect(ox, oy + k * sz, w, 1.5); else ctx.fillRect(ox + k * sz, oy, 1.5, h);
      }
    }
    function nails(ox, oy, w, h, n) { for (var k = 0; k < n; k++) { ctx.fillStyle = 'rgba(40,40,40,0.8)'; ctx.fillRect(ox + rnd() * w, oy + rnd() * h, 2, 2); } }
    function frame(ox, oy, w, h, col, bw) {
      ctx.fillStyle = rgb(col, 0.9);
      ctx.fillRect(ox, oy, w, bw); ctx.fillRect(ox, oy + h - bw, w, bw); ctx.fillRect(ox, oy, bw, h); ctx.fillRect(ox + w - bw, oy, bw, h);
      ctx.strokeStyle = 'rgba(25,15,8,0.6)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + bw, oy + bw, w - bw * 2, h - bw * 2); ctx.strokeRect(ox + 1, oy + 1, w - 2, h - 2);
    }
    // crate A: weathered pine planks, diagonal brace
    var cA = [128, 98, 64];
    planks(0, 0, 256, 256, 6, true, cA, 26);
    ctx.save(); ctx.translate(128, 128); ctx.rotate(-0.78); ctx.fillStyle = rgb(cA, 0.85); ctx.fillRect(-170, -12, 340, 24);
    ctx.strokeStyle = 'rgba(25,15,8,0.6)'; ctx.strokeRect(-170, -12, 340, 24); ctx.restore();
    frame(0, 0, 256, 256, cA, 22); nails(0, 0, 256, 256, 40);
    stencil(ctx, THEME.crate[0], 128, 70, 26, 'rgba(30,24,20,0.6)', cA, rnd, 160, 60);
    ctx.fillStyle = 'rgba(30,24,20,0.55)';
    [96, 140].forEach(function (ax) { ctx.beginPath(); ctx.moveTo(ax, 170); ctx.lineTo(ax + 12, 186); ctx.lineTo(ax + 5, 186); ctx.lineTo(ax + 5, 205); ctx.lineTo(ax - 5, 205); ctx.lineTo(ax - 5, 186); ctx.lineTo(ax - 12, 186); ctx.closePath(); ctx.fill(); });
    // crate B: plywood, darker stencils
    var cB = [150, 124, 86];
    ctx.fillStyle = rgb(cB); ctx.fillRect(256, 0, 256, 256);
    blotch(ctx, 256, 0, 256, 256, 8, 8, rnd, 0.35, 'overlay', 100);
    for (var g = 0; g < 50; g++) { ctx.strokeStyle = 'rgba(70,45,20,' + (0.05 + rnd() * 0.1) + ')'; ctx.lineWidth = 1 + rnd() * 2; ctx.beginPath(); var yy = rnd() * 256; ctx.moveTo(256, yy); ctx.bezierCurveTo(330, yy + (rnd() - 0.5) * 20, 430, yy + (rnd() - 0.5) * 20, 512, yy); ctx.stroke(); }
    frame(256, 0, 256, 256, [118, 90, 56], 24); nails(256, 0, 256, 256, 30);
    stencil(ctx, THEME.crate[1], 384, 92, 30, 'rgba(25,22,20,0.7)', cB, rnd, 180, 50);
    stencil(ctx, THEME.crate[2], 384, 130, 16, 'rgba(25,22,20,0.6)', cB, rnd, 180, 20);
    stencil(ctx, THEME.crate[3], 384, 160, 14, 'rgba(25,22,20,0.55)', cB, rnd, 180, 20);
    ctx.fillStyle = 'rgba(150,40,30,0.55)'; ctx.fillRect(330, 190, 108, 18);
    // pallet planks
    planks(0, 256, 256, 128, 4, true, [140, 116, 80], 30);
    // container floor (oily hardwood)
    planks(0, 384, 256, 128, 8, false, [78, 58, 42], 10);
    blotch(ctx, 0, 384, 256, 128, 6, 3, rnd, 0.5, 'multiply', 120);
    // cardboard
    ctx.fillStyle = '#9a7a52'; ctx.fillRect(256, 256, 128, 128);
    blotch(ctx, 256, 256, 128, 128, 6, 6, rnd, 0.3, 'overlay', 80);
    ctx.fillStyle = 'rgba(190,170,130,0.7)'; ctx.fillRect(256, 312, 128, 14); // tape
    ctx.fillStyle = 'rgba(40,30,20,0.6)'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('THIS SIDE UP', 270, 290); ctx.fillText('NO 42-117', 280, 352);
    ctx.strokeStyle = 'rgba(60,45,30,0.5)'; ctx.strokeRect(257, 257, 126, 126);
    // crate top
    planks(384, 256, 128, 128, 4, true, [122, 94, 62], 24); frame(384, 256, 128, 128, [110, 84, 54], 12);
    // tarp (dark green) & steel plate
    ctx.fillStyle = '#3a4634'; ctx.fillRect(256, 384, 128, 128); blotch(ctx, 256, 384, 128, 128, 5, 5, rnd, 0.5, 'overlay', 100);
    for (g = 0; g < 10; g++) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(256 + rnd() * 128, 384); ctx.lineTo(256 + rnd() * 128, 512); ctx.stroke(); }
    ctx.fillStyle = '#5a5650'; ctx.fillRect(384, 384, 128, 128); blotch(ctx, 384, 384, 128, 128, 6, 6, rnd, 0.5, 'overlay', 100);
    rustPatches(ctx, 384, 384, 128, 128, 30, rnd, 0, 5);
    grain(ctx, 0, 0, 512, 512, 18, rnd, 4);
    return c;
  }

  // generic grime texture for misc steel (tiles, used with vertex colors)
  function buildGrime(rnd) {
    var c = mkCanvas(256, 256), ctx = c.getContext('2d', CTX_OPTS);
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, 256, 256);
    blotch(ctx, 0, 0, 256, 256, 4, 4, rnd, 0.5, 'overlay', 90);
    blotch(ctx, 0, 0, 256, 256, 16, 16, rnd, 0.4, 'overlay', 110);
    rustPatches(ctx, 0, 0, 256, 256, 70, rnd, 0, 5);
    rustStreaks(ctx, 0, 0, 256, 256, 30, rnd, 0);
    scratches(ctx, 0, 0, 256, 256, 80, rnd);
    grain(ctx, 0, 0, 256, 256, 22, rnd, 4);
    return c;
  }

  function buildDrumTex(rnd, base, label) {
    var c = mkCanvas(256, 256), ctx = c.getContext('2d', CTX_OPTS);
    // side: canvas y 0..192 (v 0.25..1, top of drum at canvas top)
    ctx.fillStyle = rgb(base); ctx.fillRect(0, 0, 256, 192);
    blotch(ctx, 0, 0, 256, 192, 8, 4, rnd, 0.4, 'overlay', 100);
    [0.333, 0.667].forEach(function (f) { var y = 192 - f * 192 / 0.9 * 0.9; ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, y - 3, 256, 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y + 1, 256, 2); });
    ctx.fillStyle = 'rgba(225,220,205,0.85)'; ctx.fillRect(40, 70, 46, 40); // label
    ctx.fillStyle = 'rgba(40,40,40,0.6)'; ctx.fillRect(44, 76, 38, 3); ctx.fillRect(44, 84, 30, 2); ctx.fillRect(44, 90, 34, 2);
    stencil(ctx, label, 190, 92, 15, 'rgba(230,226,215,0.8)', base, rnd, 110, 30);
    rustStreaks(ctx, 0, 0, 256, 192, 30, rnd, 0);
    rustPatches(ctx, 0, 0, 256, 192, 40, rnd, 0.5, 4);
    rustPatches(ctx, 0, 0, 256, 12, 20, rnd, 0, 3);
    scratches(ctx, 0, 0, 256, 192, 50, rnd);
    grime(ctx, 0, 0, 256, 192, 0.4, 0.55);
    // cap region canvas (0,192)-(64,256)
    ctx.fillStyle = rgb(base, 0.85); ctx.fillRect(0, 192, 64, 64);
    ctx.strokeStyle = rgba(base, 1, 0.6); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(32, 224, 28, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(32, 224, 22, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(40,40,40,0.8)'; ctx.beginPath(); ctx.arc(20, 214, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(44, 236, 3, 0, 7); ctx.fill();
    rustPatches(ctx, 0, 192, 64, 64, 12, rnd, 0, 3);
    ctx.fillStyle = 'rgba(30,26,22,0.25)'; ctx.fillRect(0, 192, 64, 64);
    grain(ctx, 0, 0, 256, 256, 16, rnd, 4);
    return c;
  }

  function buildEnvCube() {
    var faces = [];
    for (var f = 0; f < 6; f++) {
      var c = mkCanvas(32, 32), ctx = c.getContext('2d', CTX_OPTS);
      var E = THEME.env; // [sky, horizon, ground]
      if (f === 2) { ctx.fillStyle = E[0]; ctx.fillRect(0, 0, 32, 32); }
      else if (f === 3) { ctx.fillStyle = E[2]; ctx.fillRect(0, 0, 32, 32); }
      else {
        var g = ctx.createLinearGradient(0, 0, 0, 32);
        g.addColorStop(0, E[0]); g.addColorStop(0.5, E[1]); g.addColorStop(0.55, E[2]); g.addColorStop(1, E[2]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
      }
      faces.push(c);
    }
    var t = new THREE.CubeTexture(faces);
    t.encoding = THREE.sRGBEncoding; t.needsUpdate = true;
    return t;
  }

  // ---------------------------------------------------------------- geometry builder
  var _v = new THREE.Vector3(), _n = new THREE.Vector3();
  function Geo() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  Geo.prototype.quad = function (M, o, u, v, uv, col) {
    var nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    _n.set(nx, ny, nz).normalize().transformDirection(M);
    var r;
    if (uv === 'auto' || uv == null) r = [0, 0, Math.hypot(u[0], u[1], u[2]) / 2, Math.hypot(v[0], v[1], v[2]) / 2];
    else r = uv;
    var uvs = r.rot ? [r[0], r[1], r[0], r[3], r[2], r[3], r[2], r[1]] : [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];
    var pts = [o[0], o[1], o[2], o[0] + u[0], o[1] + u[1], o[2] + u[2], o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2], o[0] + v[0], o[1] + v[1], o[2] + v[2]];
    var cr = col ? col.r : 1, cg = col ? col.g : 1, cb = col ? col.b : 1;
    for (var k = 0; k < 4; k++) {
      _v.set(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]).applyMatrix4(M);
      this.pos.push(_v.x, _v.y, _v.z); this.nor.push(_n.x, _n.y, _n.z);
      this.uv.push(uvs[k * 2], uvs[k * 2 + 1]); this.col.push(cr, cg, cb);
    }
    var b = this.n; this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); this.n += 4;
  };
  // axis-aligned box in M's local frame, center (cx,cy,cz), sizes; f = {px,nx,py,ny,pz,nz} uv rects or 'auto'
  Geo.prototype.box = function (M, cx, cy, cz, sx, sy, sz, f, col) {
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    if (f.px) this.quad(M, [cx + hx, cy - hy, cz + hz], [0, 0, -sz], [0, sy, 0], f.px, col);
    if (f.nx) this.quad(M, [cx - hx, cy - hy, cz - hz], [0, 0, sz], [0, sy, 0], f.nx, col);
    if (f.pz) this.quad(M, [cx - hx, cy - hy, cz + hz], [sx, 0, 0], [0, sy, 0], f.pz, col);
    if (f.nz) this.quad(M, [cx + hx, cy - hy, cz - hz], [-sx, 0, 0], [0, sy, 0], f.nz, col);
    if (f.py) this.quad(M, [cx - hx, cy + hy, cz + hz], [sx, 0, 0], [0, 0, -sz], f.py, col);
    if (f.ny) this.quad(M, [cx - hx, cy - hy, cz - hz], [sx, 0, 0], [0, 0, sz], f.ny, col);
  };
  Geo.prototype.add = function (g, M, col, uvScale) { // append a BufferGeometry
    var p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv, b = this.n, i;
    for (i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(M); this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nn, i).transformDirection(M); this.nor.push(_n.x, _n.y, _n.z);
      if (uv) this.uv.push(uv.getX(i) * (uvScale ? uvScale[0] : 1), uv.getY(i) * (uvScale ? uvScale[1] : 1)); else this.uv.push(0, 0);
      this.col.push(col ? col.r : 1, col ? col.g : 1, col ? col.b : 1);
    }
    if (g.index) for (i = 0; i < g.index.count; i++) this.idx.push(b + g.index.getX(i));
    else for (i = 0; i < p.count; i++) this.idx.push(b + i);
    this.n += p.count;
  };
  Geo.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  var ALL = { px: 'auto', nx: 'auto', pz: 'auto', nz: 'auto', py: 'auto', ny: 'auto' };
  var NOBOT = { px: 'auto', nx: 'auto', pz: 'auto', nz: 'auto', py: 'auto' };

  function mat(x, y, z, rot) { return new THREE.Matrix4().makeRotationY(rot || 0).setPosition(x, y, z); }
  function mulRotY(M, x, y, z, a) { return M.clone().multiply(mat(x, y, z, a)); }
  function rectPx(x, y, w, h, S) { return [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S]; }
  function rotUV(r) { var o = r.slice(); o.rot = true; return o; }
  function subUV(r, fx0, fy0, fx1, fy1) { var w = r[2] - r[0], h = r[3] - r[1]; var o = [r[0] + w * fx0, r[1] + h * fy0, r[0] + w * fx1, r[1] + h * fy1]; if (r.rot) o.rot = true; return o; }

  // ---------------------------------------------------------------- build
  function build(opts) {
    opts = opts || {};
    var LY = window.PBLayouts;
    var MAP = (LY && (LY.mapById(opts.map) || LY.mapById(LY.DEFAULT_MAP))) || { id: 'shipment_park', name: 'Shipment Park', setting: 'park', layout: 'shipment' };
    THEME = THEMES[MAP.setting] || THEMES.park; PAINTS = THEME.paints; VARIANTS = THEME.variants; WEAR = THEME.wear;
    var ship = MAP.layout === 'shipment', SC = window.PBScenery && window.PBScenery.available() ? window.PBScenery : null;
    var rnd = makeRng(opts.seed || 1337);
    var _t0 = performance.now(), PROF = opts.profile ? function (l) { console.log('[pbmap] ' + l + ' ' + (performance.now() - _t0).toFixed(0) + 'ms'); } : function () {};
    var disposables = [];
    var group = new THREE.Group(); group.name = 'PBMap-' + MAP.id;
    var scen = new THREE.Group(); scen.name = 'scenery'; group.add(scen); // hub-style (toon) parts
    var boxes = [], cyls = [];
    var gid = 0; // collision group id (for self-test of overlaps)

    // textures ------------------------------------------------------
    function tex(canvas, srgb, repeat) {
      var t = new THREE.CanvasTexture(canvas);
      if (srgb) t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      disposables.push(t); return t;
    }
    var envCube = buildEnvCube(); disposables.push(envCube);
    var tA, tAn, tB, tBn, tW, tG;
    if (ship) {
      var atlasA = buildAtlasA(rnd); PROF('atlasA'); var atlasB = buildAtlasB(rnd); PROF('atlasB');
      tA = tex(atlasA.map, true); tAn = tex(atlasA.normal, false); tB = tex(atlasB.map, true); tBn = tex(atlasB.normal, false);
      tW = tex(buildWood(rnd), true); tG = tex(buildGrime(rnd), true, true);
      PROF('wood+grime');
    }

    var UV_SIDE = [], UV_DOOR = [], UV_FRONT = [], i;
    for (i = 0; i < 8; i++) { UV_SIDE.push(rectPx((i % 2) * 512 + 1, (i >> 1) * 256 + 1, 510, 254, 1024)); UV_DOOR.push(rectPx((i % 4) * 256 + 1, (i >> 2) * 256 + 1, 254, 254, 1024)); }
    for (i = 0; i < 6; i++) { var cb = i < 4 ? cellB(i, 2) : cellB(i - 4, 3); UV_FRONT.push(rectPx(cb[0] + 1, cb[1] + 1, 254, 254, 1024)); }
    var UV_INT = rectPx(513, 769, 254, 254, 1024), UV_INT2 = rectPx(769, 769, 254, 254, 1024);
    var W_CRATE_A = rectPx(1, 1, 254, 254, 512), W_CRATE_B = rectPx(257, 1, 254, 254, 512), W_PLANK = rectPx(1, 257, 254, 126, 512),
      W_FLOOR = rectPx(1, 385, 254, 126, 512), W_CARD = rectPx(257, 257, 126, 126, 512), W_TOP = rectPx(385, 257, 126, 126, 512),
      W_TARP = rectPx(257, 385, 126, 126, 512), W_PLATE = rectPx(385, 385, 126, 126, 512);

    var gA = new Geo(), gB = new Geo(), gW = new Geo(), gM = new Geo(), gL = new Geo();
    var footprints = []; // for ground AO {x,z,hw,hd,rot,s}
    var glowPts = []; // {x,y,z,size,col}
    var drumPos = [], hanging = [], flickIdx = -1, WALKTHROUGH = [], spawns, ceiling = 0;
    var rect; // how far the arena and its walls reach (the place's scenery starts beyond)

    function coll(x, z, hw, hd, rot, y0, y1, m, g) {
      boxes.push({ x: x, z: z, hw: hw, hd: hd, rot: rot, y0: y0, y1: y1, mat: m, _g: g == null ? gid : g });
    }
    function toWorld(f, lx, lz) { var c = Math.cos(f.rot), s = Math.sin(f.rot); return [f.x + lx * c + lz * s, f.z - lx * s + lz * c]; }

    if (ship) {
    // ---- containers ------------------------------------------------
    // c: {x,z,y,rot,v,h,open,lane,rods,trim,cargo,noColl,bg}
    function container(c) {
      var H = c.h || CH, y = c.y || 0, M = mat(c.x, y, c.z, c.rot), V = VARIANTS[c.v], P = PAINTS[V.p];
      var side = UV_SIDE[c.v], side2 = side;
      var roof = rotUV(UV_FRONT[V.p]);
      var paint = linCol(P.base, 0.8), dark = linCol(P.base, 0.55);
      gid++;
      if (!c.open) {
        gA.box(M, 0, H / 2, 0, CW, H, CL, { px: side, nx: side2 }, null);
        gB.box(M, 0, H / 2, 0, CW, H, CL, { pz: UV_DOOR[c.v], nz: UV_FRONT[V.p], py: roof }, null);
        if (!c.noColl) coll(c.x, c.z, HW, HL, c.rot, y, y + H, 'metal');
        if (c.trim !== false) trim(M, H, paint, dark, true, true);
        if (c.rods) rods(M, H, paint, P.base);
        if (!y) footprints.push({ x: c.x, z: c.z, hw: HW, hd: HL, rot: c.rot, s: 1 });
        return;
      }
      // ---- walk-through container: individual walls, both ends open
      var t = 0.08, f = { x: c.x, z: c.z, rot: c.rot }, p;
      // side walls (outer face in atlas A, inner face in atlas B)
      gA.box(M, HW - t / 2, H / 2, 0, t, H, CL, { px: side }, null);
      gB.box(M, HW - t / 2, H / 2, 0, t, H, CL, { nx: UV_INT }, null);
      gA.box(M, -HW + t / 2, H / 2, 0, t, H, CL, { nx: side2 }, null);
      gB.box(M, -HW + t / 2, H / 2, 0, t, H, CL, { px: UV_INT2 }, null);
      gB.box(M, 0, H - 0.045, 0, CW, 0.09, CL, { py: roof, ny: rotUV(UV_INT) }, null);
      gW.box(M, 0, 0.04, 0, CW - 0.1, 0.08, CL - 0.1, { py: rotUV(W_FLOOR), pz: W_PLANK, nz: W_PLANK }, null);
      p = toWorld(f, HW - t / 2, 0); coll(p[0], p[1], t / 2, HL, c.rot, y, y + H, 'metal');
      p = toWorld(f, -HW + t / 2, 0); coll(p[0], p[1], t / 2, HL, c.rot, y, y + H, 'metal');
      coll(c.x, c.z, HW, HL, c.rot, y + H - 0.09, y + H, 'metal');
      coll(c.x, c.z, HW - 0.05, HL - 0.05, c.rot, y, y + 0.08, 'wood');
      trim(M, H, paint, dark, false, false);
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sz) { p = toWorld(f, sx * (HW - 0.085), sz * (HL - 0.085)); coll(p[0], p[1], 0.075, 0.075, c.rot, y, y + H, 'metal'); });
      });
      [-1, 1].forEach(function (sz) {
        p = toWorld(f, 0, sz * (HL - 0.08));
        coll(p[0], p[1], HW, 0.08, c.rot, y + H - 0.3, y + H, 'metal');
        coll(p[0], p[1], HW, 0.08, c.rot, y, y + 0.1, 'metal');
        // doors at this end
        var endRot = sz > 0 ? 0 : PI, Me = mulRotY(M, 0, 0, 0, endRot), lane = sz > 0 ? c.lane : -c.lane;
        [-1, 1].forEach(function (hs) { // hinge side in end frame
          var sgn = -hs, a, hz;
          if (hs === lane) { a = hs < 0 ? PI / 2 : -PI / 2; hz = HL + 0.05; }
          else { a = hs < 0 ? -PI : PI; hz = HL + 0.1; }
          var hx = hs * (HW + 0.012), lw = 1.17, lh = H - 0.32;
          var Ml = Me.clone().multiply(mat(hx, 0, hz, a));
          var doorUV = sgn > 0 ? subUV(UV_DOOR[c.v], 0, 0.06, 0.5, 0.93) : subUV(UV_DOOR[c.v], 0.5, 0.06, 1, 0.93);
          gB.box(Ml, sgn * lw / 2, 0.14 + lh / 2, -0.0225, lw, lh, 0.045, { pz: doorUV, nz: subUV(UV_INT, 0, 0, 0.5, 1), px: 'auto', nx: 'auto', py: 'auto' }, null);
          [0.33, 0.85].forEach(function (d) { rodAt(Ml, sgn * d, 0.2, 0.14 + lh - 0.06, 0.03, paint, sgn); });
          // collision (world)
          var cxl = sgn * lw / 2, czl = -0.0225;
          var ce = new THREE.Vector3(cxl, 0, czl).applyMatrix4(Ml);
          coll(ce.x, ce.z, lw / 2, 0.035, c.rot + endRot + a, y + 0.14, y + 0.14 + lh, 'metal');
        });
      });
      // cargo along the wall opposite the lane
      var cx = -c.lane * (HW - t - 0.36), zs = -2.2 + rnd() * 0.3;
      var items = [
        { w: 0.66, d: 1.1, h: 1.1, k: 'card' }, { w: 0.62, d: 0.9, h: 0.85, k: 'A' }, { w: 0.6, d: 0.7, h: 0.6, k: 'card', top: 0.45 }
      ];
      if (rnd() < 0.5) items.reverse();
      items.forEach(function (it) {
        var lz = zs + it.d / 2, q = toWorld(f, cx, lz);
        if (it.k === 'card') {
          pallet(q[0], q[1], it.d, it.w, c.rot + PI / 2, 0);
          cargoBox(q[0], q[1], it.w - 0.04, it.d - 0.06, it.h - 0.14, c.rot, 0.14, W_CARD);
          if (it.top) cargoBox(q[0], q[1], 0.45, 0.5, it.top, c.rot + 0.15, it.h, W_CARD);
          coll(q[0], q[1], it.w / 2, it.d / 2, c.rot, 0.08, it.h + (it.top || 0), 'wood');
        } else {
          cargoBox(q[0], q[1], it.w, it.d, it.h, c.rot, 0.08, W_CRATE_B);
          coll(q[0], q[1], it.w / 2, it.d / 2, c.rot, 0.08, it.h + 0.08, 'wood');
        }
        zs += it.d + 0.35 + rnd() * 0.3;
      });
      footprints.push({ x: c.x, z: c.z, hw: HW, hd: HL, rot: c.rot, s: 0.7 });
    }
    function trim(M, H, paint, dark, ends, closedEnds) {
      // corner posts + top/bottom side rails + end headers/sills
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sz) { gM.box(M, sx * (HW - 0.075), H / 2, sz * (HL - 0.075), 0.17, H, 0.17, NOBOT, dark); });
        gM.box(M, sx * (HW - 0.015), H - 0.07, 0, 0.05, 0.14, CL - 0.3, NOBOT, paint);
        gM.box(M, sx * (HW - 0.015), 0.09, 0, 0.05, 0.16, CL - 0.3, NOBOT, dark);
      });
      [-1, 1].forEach(function (sz) {
        var d = closedEnds ? 0.05 : 0.16, zz = closedEnds ? sz * (HL - 0.015) : sz * (HL - 0.08);
        gM.box(M, 0, H - (closedEnds ? 0.1 : 0.15), zz, CW - 0.3, closedEnds ? 0.2 : 0.3, d, NOBOT, paint);
        gM.box(M, 0, closedEnds ? 0.09 : 0.05, zz, CW - 0.3, closedEnds ? 0.18 : 0.1, d, NOBOT, dark);
      });
    }
    var rodGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true);
    function rodAt(M, lx, y0, y1, z, paint, dir) {
      gM.add(rodGeo, M.clone().multiply(new THREE.Matrix4().makeTranslation(lx, (y0 + y1) / 2, z).scale(new THREE.Vector3(1, y1 - y0, 1))), paint);
      gM.box(M, lx, y0 + 0.05, z - 0.01, 0.1, 0.12, 0.05, NOBOT, paint);
      gM.box(M, lx, y1 - 0.05, z - 0.01, 0.1, 0.12, 0.05, NOBOT, paint);
      gM.box(M, lx + (dir || 1) * 0.12, 1.15, z + 0.02, 0.24, 0.045, 0.035, NOBOT, paint);
    }
    function rods(M, H, paint) {
      [47, 97, 159, 209].forEach(function (px, k) {
        var lx = (px / 256 - 0.5) * CW, dir = (k === 0 || k === 2) ? 1 : -1;
        if (k >= 2) dir = -dir;
        rodAt(M, lx, 0.22, H - 0.22, HL + 0.035, paint, dir);
      });
    }
    function cargoBox(x, z, w, d, h, rot, y0, face, topUV) {
      var M = mat(x, y0, z, rot);
      gW.box(M, 0, h / 2, 0, w, h, d, { px: face, nx: face, pz: face, nz: face, py: topUV || face }, null);
    }
    function pallet(x, z, w, d, rot, y0) { // w along local x
      var M = mat(x, y0, z, rot);
      for (var k = 0; k < 5; k++) gW.box(M, 0, 0.13, -d / 2 + 0.06 + k * (d - 0.12) / 4, w, 0.022, 0.1, { py: W_PLANK, px: W_PLANK, nx: W_PLANK, pz: W_PLANK, nz: W_PLANK }, null);
      [-1, 0, 1].forEach(function (s) { gW.box(M, s * (w / 2 - 0.05), 0.06, 0, 0.09, 0.1, d, { px: W_PLANK, nx: W_PLANK, pz: W_PLANK, nz: W_PLANK, py: W_PLANK }, null); });
    }
    function crate(x, z, w, d, h, rot, y0, kind, noColl) {
      var face = kind === 'B' ? W_CRATE_B : W_CRATE_A, M = mat(x, y0, z, rot);
      gW.box(M, 0, h / 2, 0, w, h, d, { px: face, nx: face, pz: face, nz: face, py: W_TOP }, null);
      if (!noColl) coll(x, z, w / 2, d / 2, rot, y0, y0 + h, 'wood');
      if (!y0) footprints.push({ x: x, z: z, hw: w / 2, hd: d / 2, rot: rot, s: 0.8 });
    }

    // ---- layout: center blocks -----------------------------------
    var centerVar = [[0, 1], [3, 2], [4, 6], [7, 5]];
    [[-3.8, -4.35], [3.8, -4.35], [-3.8, 4.35], [3.8, 4.35]].forEach(function (b, bi) {
      var sx = b[0] < 0 ? -1 : 1, sz = b[1] < 0 ? -1 : 1;
      var inX = b[0] - sx * HW, outX = b[0] + sx * HW;
      // two of them (diagonal from each other) are closed up, to cut the long sightlines through the middle
      if (bi === 0 || bi === 3) container({ x: inX, z: b[1], rot: sz < 0 ? PI : 0, v: centerVar[bi][0], rods: true });
      else {
        container({ x: inX, z: b[1], rot: 0, v: centerVar[bi][0], open: true, lane: -sx });
        WALKTHROUGH.push({ x: inX, z: b[1] });
      }
      container({ x: outX, z: b[1], rot: sz < 0 ? PI : 0, v: centerVar[bi][1], rods: true });
    });
    // north / south blocks (long axis X, side by side in Z)
    container({ x: -0.65, z: -15.64, rot: PI / 2, v: 4, rods: true });
    container({ x: -0.65, z: -13.20, rot: -PI / 2, v: 3, rods: true });
    container({ x: -0.26, z: 13.34, rot: PI / 2, v: 1, rods: true });
    container({ x: -0.26, z: 15.78, rot: -PI / 2, v: 0, rods: true });
    // west / east
    container({ x: -10.26, z: -0.17, rot: 0, v: 2, rods: true });
    container({ x: -13.69, z: -0.78, rot: -0.33, v: 5, rods: true });
    container({ x: 10.74, z: 0.04, rot: PI, v: 6, rods: true });
    container({ x: 13.88, z: 0.0, rot: 0.24, v: 7, rods: true });

    // ---- perimeter walls: stacked high-cube containers -------------
    var wallTop = [];
    function stack(x, z, rot, n, varSeed, colHW, colHD, opt) {
      var top = 0;
      for (var k = 0; k < n; k++) {
        var v = ((varSeed * 7 + k * 3 + ((rnd() * 8) | 0)) % 8);
        var off = k === 2 ? (0.15 + rnd() * 0.3) : 0, Mrot = rot + (k === 2 ? (rnd() - 0.5) * 0.05 : 0);
        var o = (opt && opt.outward) || [0, 0], jit = (opt && opt.jx && k === 2) ? (rnd() - 0.5) * 0.6 : 0;
        container({ x: x + o[0] * off + jit, z: z + o[1] * off, y: k * CHC, h: CHC, rot: Mrot, v: v, noColl: true, trim: true, rods: !!(opt && opt.rods) });
        top = (k + 1) * CHC;
      }
      gid++;
      coll(x, z, colHW, colHD, rot, 0, top, 'metal');
      return top;
    }
    var heightsEW = [1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 2], k;
    for (k = 0; k < 14; k++) {
      var zc = -17 + 1.214 + 2.428 * k;
      // east wall: doors facing inward (-x)
      stack(15.9 + HL, zc, -PI / 2, heightsEW[k], k, 1.214, HL, { rods: true, outward: [1, 0] });
      stack(-15.9 - HL, zc, PI / 2, heightsEW[13 - k], k + 5, 1.214, HL, { rods: true, outward: [-1, 0] });
    }
    var heightsNS = [2, 1, 1, 2, 1, 1, 2];
    for (k = 0; k < 7; k++) {
      var xc = -21.21 + HL + CL * k;
      stack(xc, -17 - HW, PI / 2, heightsNS[k], k + 2, HW, HL, { jx: true });
      stack(xc, 17 + HW, -PI / 2, heightsNS[6 - k], k + 9, HW, HL, { jx: true });
    }

    rect = { x: 15.9 + CL + 0.4, z: 17 + CW + 0.4 };
    if (THEME === THEMES.office && SC) { SC.officeWalls(scen, { minX: -rect.x, maxX: rect.x, minZ: -rect.z, maxZ: rect.z }, 1, function (x, z, hw, hd, y0, y1, m) { gid++; coll(x, z, hw, hd, 0, y0, y1, m); }, 6.2); rect = { x: rect.x + 1, z: rect.z + 1 }; ceiling = 6.2; }

    // ---- crates ----------------------------------------------------
    function D(d) { return -d * PI / 180; } // plan degrees (clockwise on the plan) -> yaw
    function off(x, z, rot, lx, lz) { return toWorld({ x: x, z: z, rot: rot }, lx, lz); }
    var q;
    crate(-12.6, -13.68, 2.08, 1.39, 1.0, D(-13), 0, 'B'); q = off(-12.6, -13.68, D(-13), -0.42, 0.05); crate(q[0], q[1], 0.95, 0.9, 0.8, D(-13) + 0.12, 1.0, 'A');
    crate(-8.79, -13.55, 1.39, 1.47, 1.25, 0, 0, 'A');
    crate(-13.9, -9.53, 1.39, 2.42, 1.1, D(-15), 0, 'B'); q = off(-13.9, -9.53, D(-15), 0.05, -0.55); crate(q[0], q[1], 1.1, 1.0, 0.9, D(-15) - 0.1, 1.1, 'A');
    crate(3.2, -16.05, 1.04, 0.78, 0.9, D(30), 0, 'A');
    q = off(12.25, -12.56, D(28), -0.83, 0); crate(q[0], q[1], 1.6, 1.56, 1.2, D(28), 0, 'A');
    q = off(12.25, -12.56, D(28), 0.86, 0); crate(q[0], q[1], 1.55, 1.5, 1.0, D(28), 0, 'B'); crate(q[0], q[1], 1.1, 1.1, 0.9, D(28) + 0.2, 1.0, 'A');
    crate(12.56, -8.62, 1.47, 1.47, 1.3, 0, 0, 'B');
    crate(-12.08, 12.82, 2.17, 1.56, 1.05, D(25), 0, 'A'); q = off(-12.08, 12.82, D(25), 0.5, 0); crate(q[0], q[1], 1.0, 1.0, 0.85, D(25) - 0.15, 1.05, 'B');
    q = off(8.53, 12.21, D(30), 0, -0.83); crate(q[0], q[1], 1.3, 1.6, 1.2, D(30), 0, 'B');
    q = off(8.53, 12.21, D(30), 0, 0.86); crate(q[0], q[1], 1.25, 1.55, 0.95, D(30), 0, 'A');
    // a few pallet stacks against walls (low, decoration + cover)
    [[-15.2, 6.2, 0.1], [15.15, -3.6, -0.05], [6.2, 16.3, 1.5], [-6.5, -16.35, 1.62]].forEach(function (p, pi) {
      var n = 2 + (pi % 3);
      for (var j = 0; j < n; j++) pallet(p[0], p[1], 1.2, 1.0, p[2] + (rnd() - 0.5) * 0.1, j * 0.145);
      gid++; coll(p[0], p[1], 0.6, 0.5, p[2], 0, n * 0.145, 'wood');
      footprints.push({ x: p[0], z: p[1], hw: 0.6, hd: 0.5, rot: p[2], s: 0.6 });
    });

    // ---- the long low things lying on the ground (0.7 x 0.34) ----------
    function girder(x0, z0, x1, z1) {
      var dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), rot = Math.atan2(dx, dz), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (SC) SC.lowBar(scen, MAP.setting, x0, z0, x1, z1);
      gid++; coll(cx, cz, 0.35, L / 2, rot, 0, 0.34, THEME.wood === 'girder' || THEME.wood === 'tray' ? 'metal' : 'wood');
      footprints.push({ x: cx, z: cz, hw: 0.35, hd: L / 2, rot: rot, s: 0.5 });
    }
    girder(-15.0, 4.0, -12.0, 8.0);
    girder(10.7, 8.5, 9.9, 16.5);
    // loose pipe
    (function () {
      var x0 = -15.3, z0 = -15.5, x1 = -13.0, z1 = -16.42, L = Math.hypot(x1 - x0, z1 - z0), rot = Math.atan2(x1 - x0, z1 - z0), r = 0.16;
      var g = new THREE.CylinderGeometry(r, r, L, 12, 1, false); g.rotateX(PI / 2);
      var M = mat((x0 + x1) / 2, r, (z0 + z1) / 2, rot);
      gM.add(g, M, linCol({ logs: [140, 98, 60], planter: [140, 98, 60], driftwood: [200, 176, 142] }[THEME.wood] || [150, 156, 168]), [1, L / 2]); g.dispose();
      gid++; coll((x0 + x1) / 2, (z0 + z1) / 2, r, L / 2, rot, 0, 2 * r, 'metal');
    })();

    var poleGeo = null;
    // ---- lamps in the corners (what you bump into is the pole) ----------
    [[-15.68, -16.78], [15.68, -16.78], [-15.68, 16.78], [15.68, 16.78]].forEach(function (c) {
      if (SC) SC.cornerLamp(scen, MAP.setting, c[0], c[1], 7);
      gid++; cyls.push({ x: c[0], z: c[1], r: 0.14, y0: 0, y1: 7, mat: 'metal', _g: gid });
    });

    PROF('layout');
    // ---- drums (instanced) -----------------------------------------
    var DRUMS = [[-15.54, -16.37], [-5.85, -8.57], [-5.85, -7.88], [5.93, -7.88], [6.45, -3.29], [6.54, -13.51], [6.97, -12.9], [7.49, -12.64],
      [8.27, -12.56], [15.2, -16.45], [-5.59, 7.45], [-5.59, 7.88], [-12.86, 10.65], [-12.6, 11.34], [-8.7, 12.73], [-7.92, 12.73], [-8.36, 13.42],
      [-6.19, 16.54], [5.76, 7.27], [5.76, 7.88], [12.77, 7.27], [13.29, 6.84], [13.29, 7.88], [1.17, 12.73], [1.86, 12.73], [12.86, 16.54]];
    var DR = 0.3, DH = 0.9;
    function circleBoxPen(x, z, r, b) { // returns push vector to move circle out of box (or null)
      var c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
      var lx = dx * c - dz * s, lz = dx * s + dz * c; // inverse of toWorld
      var qx = Math.max(-b.hw, Math.min(b.hw, lx)), qz = Math.max(-b.hd, Math.min(b.hd, lz));
      var ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
      if (d >= r) return null;
      var px, pz;
      if (d > 1e-6) { px = ex / d * (r - d); pz = ez / d * (r - d); }
      else { var ox = b.hw - Math.abs(lx), oz = b.hd - Math.abs(lz); if (ox < oz) { px = (lx < 0 ? -1 : 1) * (ox + r); pz = 0; } else { px = 0; pz = (lz < 0 ? -1 : 1) * (oz + r); } }
      return [px * c + pz * s, -px * s + pz * c];
    }
    drumPos = DRUMS.map(function (d) { return [d[0], d[1]]; });
    function nudgeDrums() {
      drumPos.forEach(function (d) {
        for (var it = 0; it < 8; it++) {
          var moved = false;
          boxes.forEach(function (b) { var p = circleBoxPen(d[0], d[1], DR + 0.03, b); if (p) { d[0] += p[0]; d[1] += p[1]; moved = true; } });
          d[0] = Math.max(BOUNDS.minX + DR + 0.03, Math.min(BOUNDS.maxX - DR - 0.03, d[0])); d[1] = Math.max(BOUNDS.minZ + DR + 0.03, Math.min(BOUNDS.maxZ - DR - 0.03, d[1]));
          if (!moved) break;
        }
      });
    }
    for (var round = 0; round < 6; round++) {
      nudgeDrums();
      for (var a = 0; a < drumPos.length; a++) for (var b2 = a + 1; b2 < drumPos.length; b2++) { // drum-drum separation
        var dx = drumPos[b2][0] - drumPos[a][0], dz = drumPos[b2][1] - drumPos[a][1], dd = Math.hypot(dx, dz), mn = DR * 2 + 0.04;
        if (dd < mn && dd > 1e-6) { var pu = (mn - dd) / 2 / dd; drumPos[a][0] -= dx * pu; drumPos[a][1] -= dz * pu; drumPos[b2][0] += dx * pu; drumPos[b2][1] += dz * pu; }
      }
    }
    nudgeDrums();
    var drumGeo = (function () {
      var pts = [[0.282, 0], [0.3, 0.008], [0.3, 0.02], [0.295, 0.03], [0.295, 0.285], [0.307, 0.295], [0.307, 0.305], [0.295, 0.315], [0.295, 0.585], [0.307, 0.595], [0.307, 0.605], [0.295, 0.615],
        [0.295, 0.87], [0.3, 0.88], [0.3, 0.9], [0.285, 0.9], [0.283, 0.885]].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      var lathe = new THREE.LatheGeometry(pts, 20);
      lathe.computeVertexNormals();
      var uv = lathe.attributes.uv; for (var k2 = 0; k2 < uv.count; k2++) uv.setY(k2, 0.25 + uv.getY(k2) * 0.75);
      var cap = new THREE.CircleGeometry(0.284, 20); cap.rotateX(-PI / 2); cap.translate(0, 0.885, 0);
      var cuv = cap.attributes.uv; for (k2 = 0; k2 < cuv.count; k2++) cuv.setXY(k2, cuv.getX(k2) * 0.25, cuv.getY(k2) * 0.25);
      var merged = THREE.BufferGeometryUtils.mergeBufferGeometries([lathe.toNonIndexed(), cap.toNonIndexed()]);
      lathe.dispose(); cap.dispose();
      disposables.push(merged); return merged;
    })();
    var drumBlue = [], drumRed = [];
    drumPos.forEach(function (p, idx) { (((idx * 7) % 5) < 2 ? drumRed : drumBlue).push(p); });
    var dmBlue = new THREE.MeshStandardMaterial({ map: tex(buildDrumTex(rnd, THEME.drums[0][0], THEME.drums[0][1]), true), roughness: 0.55, metalness: 0.25, envMap: envCube, envMapIntensity: 0.4 });
    var dmRed = new THREE.MeshStandardMaterial({ map: tex(buildDrumTex(rnd, THEME.drums[1][0], THEME.drums[1][1]), true), roughness: 0.55, metalness: 0.25, envMap: envCube, envMapIntensity: 0.4 });
    disposables.push(dmBlue, dmRed);
    [[drumBlue, dmBlue], [drumRed, dmRed]].forEach(function (pair) {
      var im = new THREE.InstancedMesh(drumGeo, pair[1], pair[0].length), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
      pair[0].forEach(function (p, j) {
        e.set((rnd() - 0.5) * 0.03, rnd() * PI * 2, (rnd() - 0.5) * 0.03); qq.setFromEuler(e);
        m4.compose(new THREE.Vector3(p[0], 0, p[1]), qq, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(j, m4);
        gid++; cyls.push({ x: p[0], z: p[1], r: DR, y0: 0, y1: DH, mat: 'metal', _g: gid });
        footprints.push({ x: p[0], z: p[1], r: DR, s: 0.7 });
      });
      im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere && im.computeBoundingSphere();
      group.add(im);
    });

    PROF('drums');
    function sp(x, z) { return { x: x, z: z, yaw: Math.atan2(x, z) }; }
    spawns = {
      a: [sp(-9.4, 15.9), sp(4.4, 15.9), sp(13.7, 13.9), sp(-0.3, 10.1)],
      b: [sp(-9.4, -15.9), sp(5.8, -15.3), sp(13.7, -15.0), sp(-0.3, -10.1)]
    };
    } else {
      // ---- the place's own map: pieces from pb-layouts.js, drawn by pb-scenery.js
      var L = LY.build(MAP.layout);
      L.boxes.forEach(function (b) { gid++; boxes.push(Object.assign({ _g: gid }, b)); });
      L.cyls.forEach(function (c) { gid++; cyls.push(Object.assign({ _g: gid }, c)); });
      L.pieces.forEach(function (q) {
        if (q.y) return;
        if (q.t === 'box') footprints.push({ x: q.x, z: q.z, hw: q.w / 2, hd: q.d / 2, rot: q.rot || 0, s: 0.6 });
        else footprints.push({ x: q.x, z: q.z, r: q.r, s: 0.6 });
      });
      if (SC) {
        SC.pieces(scen, L.pieces, MAP.setting);
        SC.perimeter(scen, MAP.setting, function (x, z, hw, hd, y0, y1, m) { gid++; coll(x, z, hw, hd, 0, y0, y1, m); }, BOUNDS);
      }
      spawns = { a: L.spawns.a.map(function (q) { return Object.assign({}, q); }), b: L.spawns.b.map(function (q) { return Object.assign({}, q); }) };
      ceiling = L.ceiling;
      rect = { x: 17.2, z: 18.2 };
    }
    PROF('pieces');
    // ---- ground ----------------------------------------------------
    var G = 1024, GS = 40, gk = G / GS;
    function gp(x, z) { return [(x + GS / 2) * gk, (z + GS / 2) * gk]; }
    var gc = mkCanvas(G, G), gx = gc.getContext('2d', CTX_OPTS), rc = mkCanvas(512, 512), rx = rc.getContext('2d', CTX_OPTS);
    paintGround(gx, G, GS, gp, gk, rnd);
    // contact AO under everything that sits on the ground (drawn sharp into a layer, blurred once)
    var ao = mkCanvas(G, G), aox = ao.getContext('2d', CTX_OPTS);
    footprints.forEach(function (f) {
      if (Math.abs(f.x) > GS / 2 + 4 || Math.abs(f.z) > GS / 2 + 4) return;
      var p = gp(f.x, f.z); aox.fillStyle = 'rgba(12,10,8,' + (0.4 * f.s) + ')';
      aox.save(); aox.translate(p[0], p[1]);
      if (f.r) { aox.beginPath(); aox.arc(0, 0, (f.r + 0.12) * gk, 0, 7); aox.fill(); }
      else { aox.rotate(-f.rot); aox.fillRect(-(f.hw + 0.12) * gk, -(f.hd + 0.12) * gk, (f.hw + 0.12) * 2 * gk, (f.hd + 0.12) * 2 * gk); }
      aox.restore();
    });
    gx.save(); gx.filter = 'blur(' + (0.35 * gk) + 'px)'; gx.drawImage(ao, 0, 0); gx.restore();
    grain(gx, 0, 0, G, G, 8, rnd, 3);
    // roughness: base mostly rough
    rx.save(); rx.globalCompositeOperation = 'destination-over'; rx.fillStyle = 'rgb(240,240,240)'; rx.fillRect(0, 0, 512, 512); rx.restore();
    PROF('ground'); var tGround = tex(gc, true), tRough = tex(rc, false);
    var groundMat = new THREE.MeshStandardMaterial({ color: 0xe2e2e2, map: tGround, roughnessMap: tRough, roughness: 1, metalness: 0, envMap: envCube, envMapIntensity: 0.6 });
    var groundGeo = new THREE.PlaneGeometry(GS, GS); groundGeo.rotateX(-PI / 2);
    var ground = new THREE.Mesh(groundGeo, groundMat); ground.receiveShadow = true; ground.name = 'ground';
    group.add(ground); disposables.push(groundMat, groundGeo);
    if (THEME === THEMES.office) { // the office floor outside the arena (the city is far below)
      var oc = mkCanvas(256, 256), ocx = oc.getContext('2d', CTX_OPTS);
      paintGround(ocx, 256, 8, function (x, z) { return [(x + 4) * 32, (z + 4) * 32]; }, 32, rnd);
      var tOut = tex(oc, true, true); tOut.repeat.set(rect.x / 4 + 1, rect.z / 4 + 1);
      var outMat = new THREE.MeshLambertMaterial({ map: tOut }), outGeo = new THREE.PlaneGeometry(rect.x * 2 + 2, rect.z * 2 + 2); outGeo.rotateX(-PI / 2);
      var outer = new THREE.Mesh(outGeo, outMat); outer.position.y = -0.02; outer.receiveShadow = true; group.add(outer); disposables.push(outMat, outGeo);
    }

    // ---- static meshes ------------------------------------------------
    if (ship) {
    function addMesh(geo, material, cast, name) {
      var g = geo.build(), m = new THREE.Mesh(g, material); m.castShadow = cast; m.receiveShadow = true; m.name = name;
      group.add(m); disposables.push(g, material); return m;
    }
    var matA = new THREE.MeshStandardMaterial({ map: tA, normalMap: tAn, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.72, metalness: 0.25, envMap: envCube, envMapIntensity: 0.45 });
    var matB = new THREE.MeshStandardMaterial({ map: tB, normalMap: tBn, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.72, metalness: 0.25, envMap: envCube, envMapIntensity: 0.45 });
    var matW = new THREE.MeshStandardMaterial({ map: tW, roughness: 0.9, metalness: 0, envMap: envCube, envMapIntensity: 0.35 });
    var matM = new THREE.MeshStandardMaterial({ map: tG, vertexColors: true, roughness: 0.65, metalness: 0.35, envMap: envCube, envMapIntensity: 0.45 });
    var matL = new THREE.MeshBasicMaterial({ color: hexLin('#fff1d6') });
    addMesh(gA, matA, true, 'containers-sides');
    addMesh(gB, matB, true, 'containers-ends');
    addMesh(gW, matW, true, 'wood');
    addMesh(gM, matM, true, 'steel');
    addMesh(gL, matL, false, 'lamps');
    rodGeo.dispose();
    }

    PROF('meshes');
    // ---- the place all around (and its sky) ---------------------------
    var back = SC ? SC.backdrop(scen, MAP.setting, rect) : null;
    if (SC && window.World3D.kit.mergeStatic) { // one draw per material
      var before = new Set(scen.children);
      window.World3D.kit.mergeStatic(scen);
      scen.children.forEach(function (o) { if (!before.has(o) && o.geometry) disposables.push(o.geometry); });
    }
    PROF('scenery');

    // ---- glows (one Points draw) ---------------------------------------
    var glc = mkCanvas(64, 64), glx = glc.getContext('2d', CTX_OPTS), gr = glx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.18, 'rgba(255,214,150,0.55)'); gr.addColorStop(0.5, 'rgba(255,190,120,0.12)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
    glx.fillStyle = gr; glx.fillRect(0, 0, 64, 64);
    var tGlow = tex(glc, true);
    var gpos = [], gcol = [], gsz = [];
    glowPts.forEach(function (g5) { gpos.push(g5.x, g5.y, g5.z); gcol.push(1, 0.92, 0.8); gsz.push(g5.s); });
    var glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3));
    var glowMat = new THREE.PointsMaterial({ size: 2.2, map: tGlow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    var glows = new THREE.Points(glowGeo, glowMat); glows.renderOrder = 5; glows.name = 'glows'; group.add(glows); disposables.push(glowGeo, glowMat);

    // ---- dust motes ----------------------------------------------------
    var NDUST = THEME.dust ? 220 : 0, dpos = new Float32Array(NDUST * 3), dseed = [];
    for (i = 0; i < NDUST; i++) { dpos[i * 3] = (rnd() - 0.5) * 31; dpos[i * 3 + 1] = rnd() * 6; dpos[i * 3 + 2] = (rnd() - 0.5) * 33; dseed.push(rnd() * 100); }
    var dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    var dc2 = mkCanvas(16, 16), dcx = dc2.getContext('2d', CTX_OPTS), dg = dcx.createRadialGradient(8, 8, 0, 8, 8, 8); dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(1, 'rgba(255,255,255,0)'); dcx.fillStyle = dg; dcx.fillRect(0, 0, 16, 16);
    var dustMat = new THREE.PointsMaterial({ size: 0.035, map: tex(dc2, true), color: hexLin(THEME.dust || '#ffffff'), transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true });
    var dust = new THREE.Points(dustGeo, dustMat); dust.name = 'dust'; dust.frustumCulled = false; group.add(dust); disposables.push(dustGeo, dustMat);

    // ---- lights ----------------------------------------------------------
    var LT = THEME.light;
    var hemi = new THREE.HemisphereLight(hexLin(LT.sky), hexLin(LT.gnd), LT.hemi * 0.52); group.add(hemi);
    var amb = new THREE.AmbientLight(hexLin('#ffffff'), LT.amb * 0.45); group.add(amb);
    var key = new THREE.DirectionalLight(hexLin(LT.key), LT.keyI * 0.66);
    key.position.set(17, 26, -11); key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    var sc = key.shadow.camera; sc.left = -27; sc.right = 27; sc.top = 27; sc.bottom = -27; sc.near = 2; sc.far = 80;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
    group.add(key); group.add(key.target);
    var fill = new THREE.DirectionalLight(hexLin('#ffffff'), LT.fill * 0.65); fill.position.set(-14, 18, 16); fill.target.position.set(0, 0, 0);
    group.add(fill); group.add(fill.target);

    PROF('sky+glow+lights');
    // ---- spawns ----------------------------------------------------------

    // ---- fog / background ------------------------------------------------
    var fog = new THREE.FogExp2(hexLin(THEME.fog[0]), THEME.fog[1]);
    var background = new THREE.Color(THEME.fog[0]);

    // strip private keys
    boxes.forEach(function (b) { Object.defineProperty(b, '_g', { value: b._g, enumerable: false }); });
    cyls.forEach(function (c) { Object.defineProperty(c, '_g', { value: c._g, enumerable: false }); });

    // ---- update ------------------------------------------------------------
    var flick = glowGeo.attributes.color;
    function update(t) {
      var p = dustGeo.attributes.position.array;
      for (var j = 0; j < NDUST; j++) {
        var s = dseed[j];
        p[j * 3] += Math.sin(t * 0.21 + s) * 0.0025 + 0.002;
        p[j * 3 + 1] += Math.sin(t * 0.37 + s * 1.7) * 0.0015;
        p[j * 3 + 2] += Math.cos(t * 0.17 + s) * 0.0025;
        if (p[j * 3] > 15.5) p[j * 3] = -15.5;
        if (p[j * 3 + 1] < 0.05) p[j * 3 + 1] = 5.5; if (p[j * 3 + 1] > 6) p[j * 3 + 1] = 0.2;
      }
      if (NDUST) dustGeo.attributes.position.needsUpdate = true;
      if (back) back.update(t);
      if (flickIdx >= 0) {
        var f = (Math.sin(t * 23) > 0.6 && Math.sin(t * 3.1) > 0.2) ? 0.25 : 1;
        flick.setXYZ(flickIdx, f, 0.92 * f, 0.8 * f); flick.needsUpdate = true;
      }
    }
    function dispose() {
      disposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
      if (SC) SC.disposeOwned();
      if (key.shadow && key.shadow.map) key.shadow.map.dispose();
      disposables.length = 0;
    }

    return {
      group: group, boxes: boxes, cyls: cyls,
      bounds: { minX: BOUNDS.minX, maxX: BOUNDS.maxX, minZ: BOUNDS.minZ, maxZ: BOUNDS.maxZ },
      spawns: spawns, background: background, fog: fog,
      update: update, dispose: dispose,
      walkthroughs: WALKTHROUGH, mapId: MAP.id, name: MAP.name, setting: MAP.setting, ceiling: ceiling
    };
  }

  window.PBMap = { build: build };
})();
