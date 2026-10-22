/*
 * paintball/pb-scenery.js
 * The cartoony, hub-style parts of the Paintball maps, made with the same
 * building blocks as the hub's places (World3D.kit: toon shading, rounded shapes):
 *
 *   pieces(parent, pieces, setting)      the things on a map's own floor plan (pb-layouts.js)
 *   perimeter(parent, setting, coll)     the edge of a map's own floor plan (hedges, shops...)
 *   backdrop(parent, setting, rect)      everything outside the arena (the park, the town,
 *                                        the sea, the moon...) -> { update(t) }
 *   cornerLamp(parent, setting, x, z, h) a lamp in a corner of Shipment
 *   lowBar(parent, setting, x0, z0, x1, z1)  the long low thing on Shipment's floor
 *
 * Units are the map's (1 = 1 m before the game scales everything 1.25x).
 * Every piece is drawn inside the box/cylinder you bump into, so what you see
 * is what stops you (and your paintballs).
 */
(function (root) {
  "use strict";

  const PI = Math.PI, TAU = PI * 2;
  let K = null; // World3D.kit (the hub's building blocks)
  const kit = () => (K = K || (root.World3D && root.World3D.kit) || null);

  // ---------------------------------------------------------------------
  // small helpers on top of the kit
  // ---------------------------------------------------------------------
  const owned = []; // textures/geometries made here (freed by the map's dispose)
  function own(x) { owned.push(x); return x; }
  function tex(w, h, draw, repeat) { return own(kit().canvasTexture(w, h, draw, repeat)); }
  function texMat(t, o) { return own(kit().toon(0xffffff, Object.assign({ map: t }, o || {}))); }
  // a rounded block standing on y0 (kit.block is centred)
  function blk(p, color, x, y0, z, w, h, d, r, o) { return kit().block(p, color, x, y0 + h / 2, z, w, h, d, r === undefined ? 0.06 : Math.min(r, w / 2, h / 2, d / 2) * 0.98, o); }
  function cyl(p, color, x, y0, z, r, h, o) { return kit().cylinder(p, color, x, y0 + h / 2, z, r, h, o); }
  function stripes(colors, n, vertical) {
    return tex(128, 128, (ctx, w, h) => {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = colors[i % colors.length];
        if (vertical) ctx.fillRect((i * w) / n, 0, w / n + 1, h); else ctx.fillRect(0, (i * h) / n, w, h / n + 1);
      }
    });
  }
  function rnd(seed) { return kit().seeded(seed); }

  // windows on a wall: rows of glass (some lit), for the town and the city
  function windowsTex(wall, glass, frame, floors, bays, shop) {
    return tex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
      const r = rnd(floors * 7 + bays);
      const fh = h / floors, bw = w / bays;
      for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
        if (shop && f === floors - 1) continue;
        const x = b * bw + bw * 0.22, y = f * fh + fh * 0.22, ww = bw * 0.56, hh = fh * 0.55;
        ctx.fillStyle = frame; ctx.fillRect(x - 3, y - 3, ww + 6, hh + 6);
        ctx.fillStyle = r() < 0.15 ? "#fff1a8" : glass; ctx.fillRect(x, y, ww, hh);
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(x, y, ww, hh * 0.25);
      }
      if (shop) { // the shop window along the bottom
        ctx.fillStyle = frame; ctx.fillRect(0, h - fh, w, fh);
        ctx.fillStyle = glass; ctx.fillRect(w * 0.08, h - fh * 0.85, w * 0.84, fh * 0.75);
      }
    });
  }
  function signTex(text, bg, fg) {
    return tex(256, 64, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.font = "bold 34px Nunito, 'Arial Rounded MT Bold', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      let s = 34; while (ctx.measureText(text).width > w * 0.9 && s > 12) { s -= 2; ctx.font = "bold " + s + "px Nunito, Arial, sans-serif"; }
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
  }
  // a flat picture facing +z (local), centred at (x, y, z)
  function picture(p, t, x, y, z, w, h, ry) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texMat(t));
    own(m.geometry);
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    m.receiveShadow = true;
    p.add(m);
    return m;
  }

  // ---------------------------------------------------------------------
  // Colors of each place
  // ---------------------------------------------------------------------
  const COL = {
    park: { rock: 0xaaa497, rock2: 0x9a9488, leaf: 0x5cc84a, leaf2: 0x7fdc5c, hedge: 0x4fb347, hedge2: 0x6cc84a, wood: 0xd9894a, flowers: [0xff9ec7, 0xffe25a, 0xffffff, 0xb48cff] },
    cafe: { rock: 0xb8b0a4, wood: 0xc98a52, leaf: 0x5cc84a, leaf2: 0x7fdc5c, hedge: 0x4fb347, hedge2: 0x6cc84a, flowers: [0xff6f91, 0xffd84a, 0xffffff] },
    beach: { rock: 0xbdb3a3, rock2: 0xa89f90, wood: 0xd9a066, leaf: 0x46b04a, flowers: [0xffffff] },
    moon: { rock: 0xa79dc8, rock2: 0x968cbb },
    office: { wood: 0xc9925a },
  };

  // ---------------------------------------------------------------------
  // The pieces of each map's own floor plan. b(g, p, C): g is a group at the
  // bottom middle of the piece (turned like it), p the piece, C its place's colors.
  // ---------------------------------------------------------------------
  const B = {};
  // -- park
  B.planter = (g, p, C) => {
    if (p.t === "box") { blk(g, 0xd9805a, 0, 0, 0, p.w, 0.7, p.d, 0.08); bushTop(g, p, 0.7, C); return; }
    cyl(g, 0xd9c7a8, 0, 0, 0, p.r, p.h, { seg: 40 });
    cyl(g, 0xc4b08e, 0, p.h - 0.08, 0, p.r + 0.04, 0.1, { seg: 40 });
    kit().disc(g, 0x6b4a2e, 0, p.h + 0.005, 0, p.r - 0.15);
    const r = rnd(5), fl = (C.flowers || [0xffffff]);
    for (let i = 0; i < 26; i++) {
      const a = r() * TAU, d = 0.6 + r() * (p.r - 0.85);
      kit().ball(g, fl[i % fl.length], Math.cos(a) * d, p.h + 0.08, Math.sin(a) * d, 0.11, { shadow: false });
      kit().ball(g, C.leaf || 0x5cc84a, Math.cos(a + 0.2) * d, p.h + 0.04, Math.sin(a + 0.2) * d, 0.13, { sy: 0.5, shadow: false });
    }
  };
  B.trunk = (g, p) => { kit().put(g, kit().G.taper(p.r * 0.75, p.r), kit().toon(0x9a6a3c), { y: p.h / 2, sy: p.h }); };
  B.canopy = (g, p, C) => {
    const t = kit().toon(C.leaf || 0x5cc84a), t2 = kit().toon(C.leaf2 || 0x7fdc5c);
    kit().put(g, kit().G.sphere(), t, { y: p.h / 2, sx: p.r * 0.97, sy: p.h / 2, sz: p.r * 0.97 });
    kit().put(g, kit().G.sphere(), t2, { x: -p.r * 0.3, y: p.h * 0.62, z: p.r * 0.3, sx: p.r * 0.55, sy: p.h * 0.36, sz: p.r * 0.55 });
    kit().put(g, kit().G.sphere(), t2, { x: p.r * 0.35, y: p.h * 0.55, z: -p.r * 0.2, sx: p.r * 0.5, sy: p.h * 0.34, sz: p.r * 0.5 });
  };
  B.tower = (g, p) => { // a wooden play tower, panels in bright colors
    blk(g, 0xe0a463, 0, 0, 0, p.w, p.h, p.d, 0.08);
    const cols = [0xff6b6b, 0x4fb0f5, 0xffd84a, 0x7fd65a];
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2, s = Math.sin(a), c = Math.cos(a), ext = (i % 2 ? p.w : p.d) / 2 + 0.01;
      const pl = kit().block(g, cols[i], s * ext, p.h * 0.55, c * ext, (i % 2 ? p.d : p.w) * 0.7, p.h * 0.55, 0.04, 0.02);
      pl.rotation.y = a;
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0xb87a40, sx * (p.w / 2 - 0.1), p.h, sz * (p.d / 2 - 0.1), 0.07, 0.75);
    for (const [x, z, w, d] of [[0, p.d / 2 - 0.1, p.w - 0.2, 0.06], [0, -p.d / 2 + 0.1, p.w - 0.2, 0.06], [p.w / 2 - 0.1, 0, 0.06, p.d - 0.2]]) blk(g, 0xff6b6b, x, p.h + 0.62, z, w, 0.08, d, 0.03);
    kit().ball(g, 0xffd84a, 0, p.h + 0.02, 0, 0.18, { sy: 0.3 });
  };
  B.rock = (g, p, C) => {
    blk(g, C.rock || 0xc9c4b8, 0, 0, 0, p.w, p.h, p.d, Math.min(p.w, p.d, p.h) * 0.32);
    kit().ball(g, C.rock2 || C.rock || 0xb3ada0, p.w * 0.18, p.h * 0.82, -p.d * 0.1, Math.min(p.w, p.d) * 0.28, { sy: 0.45 });
  };
  function bushTop(g, p, y0, C) {
    const t = kit().toon(C.hedge || 0x4fb347), h = p.h - y0;
    blk(g, t, 0, y0, 0, p.w - 0.06, h * 0.9, p.d - 0.06, 0.22);
    const n = Math.max(2, Math.round(p.w / 0.7)), r = rnd(Math.round(p.x * 10 + p.z * 3) & 255 || 3);
    for (let i = 0; i < n; i++) {
      kit().ball(g, C.hedge2 || 0x6cc84a, -p.w / 2 + (i + 0.5) * (p.w / n), y0 + h * 0.86, (r() - 0.5) * (p.d - 0.5), Math.min(0.32, p.d * 0.3), { sy: 0.45 });
      if (C.flowers && r() < 0.6) kit().ball(g, C.flowers[i % C.flowers.length], -p.w / 2 + (i + 0.5) * (p.w / n) + 0.15, y0 + h * 0.75, p.d / 2 - 0.08, 0.07, { shadow: false });
    }
  }
  B.hedge = (g, p, C) => { bushTop(g, p, 0, C); };
  B.hedgebox = (g, p, C) => { blk(g, 0xc98a52, 0, 0, 0, p.w, 0.6, p.d, 0.05); blk(g, 0xa86c3a, 0, 0.56, 0, p.w + 0.0, 0.06, p.d, 0.02); bushTop(g, Object.assign({}, p, { w: p.w - 0.1, d: p.d - 0.1 }), 0.6, C); };
  B.bush = (g, p, C) => {
    const c = C.hedge || 0x4fb347, hw = p.w / 2, hd = p.d / 2;
    kit().ball(g, c, 0, p.h * 0.5, 0, 1, { sx: hw * 0.95, sy: p.h * 0.5, sz: hd * 0.95 });
    kit().ball(g, C.hedge2 || 0x6cc84a, hw * 0.3, p.h * 0.62, hd * 0.25, 1, { sx: hw * 0.55, sy: p.h * 0.36, sz: hd * 0.55 });
    if (C.flowers) for (let i = 0; i < 6; i++) kit().ball(g, C.flowers[i % C.flowers.length], Math.cos(i * 1.1) * hw * 0.8, p.h * (0.5 + (i % 3) * 0.12), Math.sin(i * 1.1) * hd * 0.8, 0.07, { shadow: false });
  };
  B.shed = (g, p) => {
    blk(g, 0xb9824e, 0, 0, 0, p.w, p.h - 0.3, p.d, 0.04);
    blk(g, 0xd65a4a, 0, p.h - 0.32, 0, p.w, 0.32, p.d, 0.05);
    for (let i = 0; i < 6; i++) blk(g, 0xa87244, -p.w / 2 + 0.25 + i * ((p.w - 0.5) / 5), 0.05, p.d / 2 - 0.005, 0.05, p.h - 0.45, 0.02, 0.01);
    blk(g, 0x8a5a32, -p.w * 0.18, 0, p.d / 2 + 0.001, 0.8, 1.7, 0.03, 0.02);
    kit().block(g, 0x9fd8ff, p.w * 0.25, 1.4, p.d / 2 + 0.005, 0.6, 0.5, 0.03, 0.02);
    kit().block(g, 0xffffff, p.w * 0.25, 1.4, p.d / 2 + 0.012, 0.64, 0.05, 0.02, 0.01);
  };
  B.logs = (g, p) => {
    const r = p.h / 4, n = Math.max(1, Math.round(p.w / (r * 2)));
    for (let row = 0; row < 2; row++) {
      const m = row ? n - 1 || 1 : n;
      for (let i = 0; i < m; i++) {
        const x = (i - (m - 1) / 2) * r * 2, y = r + row * r * 1.9;
        cyl(g, 0x9a6a3c, x, y - p.d / 2 + r, 0, r * 0.97, p.d, { rx: PI / 2, seg: 14 });
        kit().disc(g, 0xe6c08e, x, y, p.d / 2 + 0.002, r * 0.8, { rx: 0 });
      }
    }
  };
  B.picnic = (g, p) => {
    const top = kit().toon(0xd9894a), red = kit().toon(0xff6b6b);
    blk(g, top, 0, p.h - 0.07, 0, p.w, 0.07, p.d * 0.55, 0.02);
    blk(g, red, 0, p.h - 0.01, 0, p.w * 0.9, 0.012, p.d * 0.45, 0.004, { shadow: false });
    for (const s of [-1, 1]) {
      blk(g, top, 0, 0.42, s * (p.d / 2 - 0.13), p.w, 0.06, 0.26, 0.02);
      for (const sx of [-1, 1]) blk(g, 0xb87a40, sx * (p.w / 2 - 0.25), 0, s * p.d * 0.22, 0.08, p.h - 0.07, 0.08, 0.02);
    }
    kit().ball(g, 0xb87a40, 0.3, p.h + 0.1, 0, 0.14, { sy: 0.7 });
  };
  B.bench = (g, p, C) => {
    const wood = kit().toon(C.wood || 0xd9894a), iron = kit().toon(0x3d4a5c);
    for (const dz of [-0.18, 0, 0.18]) blk(g, wood, 0, p.h - 0.06, dz * (p.d / 0.6), p.w, 0.06, p.d * 0.27, 0.02);
    for (const sx of [-1, 1]) blk(g, iron, sx * (p.w / 2 - 0.15), 0, 0, 0.07, p.h - 0.06, p.d * 0.9, 0.02);
  };
  // -- café street
  B.fountain = (g, p) => {
    cyl(g, 0xe6ddd0, 0, 0, 0, p.r, p.h, { seg: 40 });
    cyl(g, 0xd4c9b8, 0, p.h - 0.1, 0, p.r + 0.05, 0.12, { seg: 40 });
    kit().disc(g, kit().toon(0x6fd0f5), 0, p.h - 0.08, 0, p.r - 0.2);
    for (let i = 0; i < 3; i++) kit().put(g, kit().G.torus(1, 0.03), kit().toon(0xffffff), { y: p.h - 0.06, s: 0.9 + i * 0.4, rx: -PI / 2, shadow: false });
  };
  B.column = (g, p) => {
    cyl(g, 0xe6ddd0, 0, 0, 0, p.r, p.h * 0.75, { seg: 20 });
    cyl(g, 0xd4c9b8, 0, p.h * 0.72, 0, p.r * 1.0, 0.12, { seg: 20 });
    kit().put(g, kit().G.sphere(), kit().toon(0xe6ddd0), { y: p.h * 0.84, sx: p.r, sy: p.h * 0.1, sz: p.r });
    kit().ball(g, 0x9fe3ff, 0, p.h * 0.92, 0, p.r * 0.45);
    kit().ball(g, 0xffd84a, 0, p.h - p.r * 0.3, 0, p.r * 0.3);
  };
  B.stall = (g, p) => {
    blk(g, 0xc98a52, 0, 0, 0, p.w, p.h - 0.1, p.d, 0.04);
    blk(g, 0xe6b07a, 0, p.h - 0.1, 0, p.w + 0.0, 0.1, p.d, 0.03);
    blk(g, 0xff8fa8, 0, 0.15, p.d / 2 + 0.005, p.w - 0.3, p.h - 0.45, 0.02, 0.01);
    const fruit = [0xff5a4a, 0xffb02e, 0x8ad94a, 0xffe25a];
    for (let i = 0; i < 12; i++) kit().ball(g, fruit[i % 4], -p.w / 2 + 0.3 + (i % 6) * ((p.w - 0.6) / 5), p.h + 0.08, (i < 6 ? -0.2 : 0.2), 0.09, { shadow: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0xffffff, sx * (p.w / 2 - 0.08), p.h, sz * (p.d / 2 - 0.08), 0.04, 2.35 - p.h, { seg: 8 });
  };
  let awningTex = null;
  B.awning = (g, p) => {
    awningTex = awningTex || stripes(["#ff6f91", "#ffffff"], 8, true);
    kit().block(g, texMat(awningTex), 0, p.h / 2, 0, p.w, p.h, p.d, 0.04);
  };
  let crateTex = null;
  B.crates = (g, p) => {
    crateTex = crateTex || tex(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "#d9a066"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#c48a50"; for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 32 + 30, w, 2);
      ctx.fillStyle = "#b07840"; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10); ctx.fillRect(0, 0, 10, h); ctx.fillRect(w - 10, 0, 10, h);
    });
    kit().put(g, kit().G.box(), texMat(crateTex), { y: p.h / 2, sx: p.w, sy: p.h, sz: p.d });
    if (!p.y && p.h > 1) { const fruit = [0xff5a4a, 0xffb02e, 0x8ad94a]; for (let i = 0; i < 5; i++) kit().ball(g, fruit[i % 3], (i - 2) * 0.17, p.h + 0.07, (i % 2) * 0.15 - 0.07, 0.08, { shadow: false }); }
  };
  B.kiosk = (g, p) => {
    blk(g, 0x2f9e6e, 0, 0, 0, p.w, p.h - 0.35, p.d, 0.05);
    blk(g, 0xff6f61, 0, p.h - 0.35, 0, p.w, 0.35, p.d, 0.06);
    const mags = [0xff9ec7, 0x7fd0ff, 0xffe25a, 0xffffff, 0xb48cff];
    for (let i = 0; i < 10; i++) kit().block(g, mags[i % 5], -p.w / 2 + 0.3 + (i % 5) * ((p.w - 0.6) / 4), 0.7 + Math.floor(i / 5) * 0.4, p.d / 2 + 0.02, 0.3, 0.36, 0.03, 0.01, { shadow: false });
    picture(g, signTex("NEWS", "#ffffff", "#ff6f61"), 0, p.h - 0.18, p.d / 2 + 0.01, p.w * 0.8, 0.28);
  };
  B.van = (g, p) => {
    const body = kit().toon(0xffb3c7);
    blk(g, body, 0, 0.3, 0, p.w, p.h - 0.3, p.d, 0.18);
    blk(g, 0xffffff, 0, p.h * 0.55, 0, p.w + 0.0, 0.18, p.d * 0.98, 0.05);
    kit().block(g, 0x9fd8ff, 0, p.h * 0.72, p.d / 2 - 0.02, p.w * 0.8, p.h * 0.28, 0.06, 0.04); // windscreen
    kit().block(g, 0x8a5a32, p.w / 2 - 0.02, p.h * 0.5, -0.3, 0.05, p.h * 0.32, p.d * 0.45, 0.02); // serving hatch
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) cyl(g, 0x333844, sx * (p.w / 2 - 0.16), 0.0, sz * (p.d / 2 - 0.75), 0.32, 0.3, { rz: PI / 2, seg: 16 }).position.y = 0.32;
    picture(g, signTex("MII CRÊPES", "#ffffff", "#e8507a"), p.w / 2 + 0.01, p.h * 0.84, -0.3, p.d * 0.6, 0.4, PI / 2);
    picture(g, signTex("MII CRÊPES", "#ffffff", "#e8507a"), -p.w / 2 - 0.01, p.h * 0.84, 0.3, p.d * 0.6, 0.4, -PI / 2);
  };
  B.shelter = (g, p) => {
    blk(g, 0x3d4a5c, 0, 0, 0, p.w, p.h, p.d, 0.03);
    const poster = tex(128, 256, (ctx, w, h) => { ctx.fillStyle = "#7fd0ff"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#ffe25a"; ctx.beginPath(); ctx.arc(w / 2, h * 0.35, 30, 0, TAU); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.fillText("VISIT", w / 2, h * 0.7); ctx.fillText("MII BEACH", w / 2, h * 0.8); });
    for (const s of [-1, 1]) picture(g, poster, s * (p.w / 2 + 0.01), p.h * 0.5, 0, p.d * 0.5, p.h * 0.7, s * PI / 2);
  };
  B.shelterroof = (g, p) => blk(g, 0x3d4a5c, 0, 0, 0, p.w, p.h, p.d, 0.03);
  B.table = (g, p) => {
    kit().disc(g, 0xffffff, 0, p.h, 0, p.r);
    cyl(g, 0xffffff, 0, p.h - 0.05, 0, p.r, 0.05, { seg: 24 });
    cyl(g, 0x3d4a5c, 0, 0, 0, 0.05, p.h - 0.05, { seg: 8 });
    cyl(g, 0x3d4a5c, 0, 0, 0, p.r * 0.5, 0.04, { seg: 16 });
    kit().ball(g, 0xff9ec7, 0.15, p.h + 0.06, 0.1, 0.06, { shadow: false });
  };
  B.pole = (g, p) => cyl(g, 0xffffff, 0, 0, 0, Math.max(0.04, p.r), p.h, { seg: 8 });
  const parasolTex = {};
  B.parasol = (g, p, C, setting) => {
    const key = setting === "beach" ? "b" + Math.round(p.x * 7 + p.z * 3) % 3 : "c";
    const sets = { c: ["#2fa86f", "#ffffff"], b0: ["#ff5a7a", "#ffffff"], b1: ["#3fa9f5", "#ffffff"], b2: ["#ffcf3a", "#ff7a3a"] };
    parasolTex[key] = parasolTex[key] || stripes(sets[key] || sets.b0, 12, true);
    kit().put(g, kit().G.cone(24), texMat(parasolTex[key]), { y: p.h / 2, sx: p.r, sy: p.h, sz: p.r });
    kit().ball(g, 0xffffff, 0, p.h, 0, 0.06);
  };
  B.lamp = (g, p) => {
    cyl(g, 0x2f4f46, 0, 0, 0, p.r * 1.8, 0.2, { seg: 12 });
    cyl(g, 0x2f4f46, 0, 0, 0, p.r * 0.6, p.h - 0.4, { seg: 10 });
    kit().ball(g, kit().glow(0xfff1b8, 0.7), 0, p.h - 0.25, 0, 0.22);
    kit().put(g, kit().G.cone(), kit().toon(0x2f4f46), { y: p.h - 0.04, s: 0.26, sy: 0.12 });
  };
  B.clock = (g, p) => {
    cyl(g, 0x2f4f46, 0, 0, 0, p.r * 0.7, p.h - 0.5, { seg: 10 });
    const face = tex(128, 128, (ctx, w, h) => { ctx.fillStyle = "#2f4f46"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(64, 64, 56, 0, TAU); ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64, 24); ctx.moveTo(64, 64); ctx.lineTo(92, 74); ctx.stroke(); });
    kit().put(g, kit().G.cyl(24), texMat(face), { y: p.h - 0.25, sx: 0.25, sy: 0.08, sz: 0.25, rx: PI / 2 });
    kit().put(g, kit().G.cyl(24), texMat(face), { y: p.h - 0.25, sx: 0.25, sy: 0.08, sz: 0.25, rx: -PI / 2 });
  };
  // -- beach
  B.lifeguard = (g, p) => {
    blk(g, 0xd9a066, 0, 0, 0, p.w, p.h, p.d, 0.05);
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
      kit().block(g, 0xc48a50, -p.w / 2 + 0.2 + i * ((p.w - 0.4) / 6), p.h * 0.45, s * (p.d / 2 + 0.005), 0.05, p.h * 0.85, 0.02, 0.01);
      kit().block(g, 0xc48a50, s * (p.w / 2 + 0.005), p.h * 0.45, -p.d / 2 + 0.2 + i * ((p.d - 0.4) / 6), 0.02, p.h * 0.85, 0.05, 0.01);
    }
    blk(g, 0xff5a4a, 0, p.h - 0.12, 0, p.w + 0.0, 0.12, p.d, 0.03);
    for (const s of [-1, 1]) picture(g, signTex("LIFEGUARD", "#ff5a4a", "#ffffff"), 0, p.h * 0.7, s * (p.d / 2 + 0.03), p.w * 0.8, 0.32, s > 0 ? 0 : PI);
    cyl(g, 0xffffff, p.w / 2 - 0.15, p.h, p.d / 2 - 0.15, 0.04, 1.8, { seg: 6 });
    kit().block(g, 0xff5a4a, p.w / 2 - 0.15 - 0.25, p.h + 1.6, p.d / 2 - 0.15, 0.5, 0.3, 0.02, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0xffffff, sx * (p.w / 2 - 0.06), p.h, sz * (p.d / 2 - 0.06), 0.04, 0.7, { seg: 6 });
    for (const [x, z, w, d] of [[0, p.d / 2 - 0.06, p.w, 0.05], [0, -p.d / 2 + 0.06, p.w, 0.05], [p.w / 2 - 0.06, 0, 0.05, p.d], [-p.w / 2 + 0.06, 0, 0.05, p.d]]) blk(g, 0xffffff, x, p.h + 0.62, z, w, 0.06, d, 0.02);
  };
  B.buoys = (g, p) => {
    B.crates(g, Object.assign({}, p, { h: p.h - 0.25, y: 1 }));
    for (let i = 0; i < 2; i++) kit().put(g, kit().G.torus(0.3, 0.09), kit().toon(i ? 0xffffff : 0xff4b3a), { x: (i - 0.5) * 0.4, y: p.h - 0.2 + i * 0.1, rx: -PI / 2 });
  };
  const hutCols = [["#ff9ec7", "#ffffff"], ["#7fd0ff", "#ffffff"], ["#ffe25a", "#ffffff"], ["#8ce08a", "#ffffff"]];
  B.hut = (g, p) => {
    const i = Math.abs(Math.round(p.x + p.z)) % hutCols.length;
    kit().put(g, kit().G.box(), texMat(stripes(hutCols[i], 8, true)), { y: (p.h - 0.3) / 2, sx: p.w, sy: p.h - 0.3, sz: p.d });
    blk(g, 0xffffff, 0, p.h - 0.3, 0, p.w, 0.3, p.d, 0.08);
    for (const s of [-1, 1]) blk(g, 0x8a5a32, 0, 0, s * (p.d / 2 + 0.005), 0.8, 1.8, 0.03, 0.02);
  };
  B.cabins = (g, p) => {
    const n = 3, cw = p.w / n, cols = [0xff9ec7, 0x7fd0ff, 0xffe25a];
    for (let i = 0; i < n; i++) {
      blk(g, cols[i], -p.w / 2 + cw * (i + 0.5), 0, 0, cw - 0.04, p.h - 0.2, p.d, 0.04);
      for (const s of [-1, 1]) blk(g, 0xffffff, -p.w / 2 + cw * (i + 0.5), 0.15, s * (p.d / 2 + 0.005), cw * 0.6, 1.7, 0.03, 0.02);
    }
    blk(g, 0xffffff, 0, p.h - 0.2, 0, p.w, 0.2, p.d, 0.05);
  };
  B.bar = (g, p) => {
    blk(g, 0xb9824e, 0, 0, 0, p.w, p.h - 0.45, p.d, 0.04);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) kit().cylinder(g, 0xd9b26a, s * (p.w / 2 + 0.01), (p.h - 0.45) / 2, -p.d / 2 + 0.3 + i * ((p.d - 0.6) / 8), 0.06, p.h - 0.45, { seg: 6 });
    blk(g, 0xe8c66a, 0, p.h - 0.45, 0, p.w, 0.45, p.d, 0.15); // straw roof
    for (const s of [-1, 1]) picture(g, signTex("TIKI BAR", "#ffcf3a", "#8a5a32"), s * (p.w / 2 + 0.03), p.h * 0.62, 0, p.d * 0.5, 0.4, s * PI / 2);
  };
  B.boat = (g, p) => {
    const i = Math.abs(Math.round(p.x * 3)) % 3, cols = [0xff5a4a, 0x3fa9f5, 0xffcf3a];
    kit().put(g, kit().G.sphere(), kit().toon(cols[i]), { sx: p.w / 2, sy: p.h, sz: p.d / 2 });
    kit().put(g, kit().G.sphere(), kit().toon(0xffffff), { y: 0.0, sx: p.w / 2 + 0.01, sy: p.h * 0.45, sz: p.d / 2 + 0.01 });
    cyl(g, 0xb9824e, 0, p.h - 0.02, 0, 0.05, 0.02, { seg: 6 });
  };
  B.lounger = (g, p) => {
    const t = stripes(["#3fa9f5", "#ffffff"], 8, false);
    kit().put(g, kit().G.box(), texMat(t), { y: p.h - 0.05, sx: p.w, sy: 0.1, sz: p.d });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0xffffff, sx * (p.w / 2 - 0.06), 0, sz * (p.d / 2 - 0.1), 0.03, p.h - 0.1, { seg: 6 });
  };
  B.castle = (g, p) => {
    const sand = kit().toon(0xf0d79a), sand2 = kit().toon(0xe6c47e);
    cyl(g, sand, 0, 0, 0, p.r, p.h * 0.35, { seg: 24 });
    cyl(g, sand2, 0, p.h * 0.35, 0, p.r * 0.62, p.h * 0.3, { seg: 20 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4, x = Math.cos(a) * p.r * 0.75, z = Math.sin(a) * p.r * 0.75;
      cyl(g, sand2, x, p.h * 0.35, z, 0.2, p.h * 0.3, { seg: 10 });
      kit().put(g, kit().G.cone(10), sand, { x, y: p.h * 0.65 + 0.1, z, sx: 0.22, sy: 0.2, sz: 0.22 });
    }
    kit().put(g, kit().G.cone(12), sand, { y: p.h * 0.8, sx: p.r * 0.45, sy: p.h * 0.3, sz: p.r * 0.45 });
    cyl(g, 0x8a5a32, 0, p.h * 0.8, 0, 0.02, p.h * 0.2, { seg: 4 });
    kit().block(g, 0xff4b3a, 0.12, p.h * 0.96, 0, 0.22, 0.12, 0.01, 0.005);
  };
  B.icecream = (g, p) => {
    blk(g, 0xfff2f6, 0, 0.2, 0, p.w, 0.85, p.d, 0.1);
    blk(g, 0xff9ec7, 0, 0.75, 0, p.w + 0.0, 0.12, p.d, 0.04);
    for (const sx of [-1, 1]) cyl(g, 0x555a66, sx * (p.w / 2 - 0.3), 0.0, 0, 0.2, 0.08, { rx: PI / 2, seg: 14 }).position.set(sx * (p.w / 2 - 0.3), 0.2, p.d / 2 - 0.05);
    const flav = [0xff9ec7, 0xfff1b8, 0x8a5a32, 0x8ce08a];
    for (let i = 0; i < 4; i++) kit().ball(g, flav[i], -p.w / 2 + 0.35 + i * ((p.w - 0.7) / 3), 1.12, 0, 0.17);
    kit().put(g, kit().G.cone(12), kit().toon(0xe6b07a), { x: p.w / 2 - 0.25, y: 1.25, z: 0, sx: 0.15, sy: 0.35, sz: 0.15, rx: PI });
    kit().ball(g, 0xff9ec7, p.w / 2 - 0.25, 1.43, 0, 0.16);
    picture(g, signTex("ICE CREAM", "#ffffff", "#e8507a"), 0, 0.55, p.d / 2 + 0.01, p.w * 0.8, 0.3);
  };
  B.surf = (g, p) => {
    blk(g, 0xb9824e, 0, 0, 0, p.w * 0.5, 0.25, p.d, 0.03);
    const cols = [0xff5a7a, 0x3fa9f5, 0xffcf3a, 0x8ce08a];
    for (let i = 0; i < 4; i++) {
      const z = -p.d / 2 + 0.35 + i * ((p.d - 0.7) / 3);
      kit().put(g, kit().G.capsule(), kit().toon(cols[i]), { x: 0, y: p.h / 2 + 0.05, z, sx: p.w * 0.85, sy: (p.h - 0.2) / 2, sz: 0.1, rz: 0.12 });
    }
  };
  B.palm = (g, p) => { kit().palmTree(g, 0, 0, p.h / 4.15, 0.4); };
  // -- moon
  B.pad = (g, p) => {
    cyl(g, 0x6c6880, 0, 0, 0, p.r, p.h, { seg: 40 });
    kit().put(g, kit().G.torus(1, 0.04), kit().toon(0xffcf3a), { y: p.h + 0.005, s: p.r - 0.3, rx: -PI / 2, sz: 0.2, shadow: false });
    for (let i = 0; i < 8; i++) kit().ball(g, kit().glow(i % 2 ? 0xff5a64 : 0x7fe0ff, 0.9), Math.cos((i / 8) * TAU) * (p.r - 0.12), p.h, Math.sin((i / 8) * TAU) * (p.r - 0.12), 0.07, { shadow: false });
  };
  B.lander = (g, p) => {
    blk(g, 0xffcf3a, 0, 0.35, 0, p.w - 0.3, p.h - 0.75, p.d - 0.3, 0.12);
    blk(g, 0xe8e6f2, 0, p.h - 0.42, 0, p.w - 0.5, 0.42, p.d - 0.5, 0.15);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(g, 0xc9cce0, sx * (p.w / 2 - 0.25), 0.1, sz * (p.d / 2 - 0.25), 0.07, 0.75, { seg: 8 });
      leg.rotation.set(sz * 0.25, 0, -sx * 0.25);
      kit().disc(g, 0xc9cce0, sx * (p.w / 2 - 0.12), 0.02, sz * (p.d / 2 - 0.12), 0.14);
    }
    for (const s of [-1, 1]) { kit().disc(g, 0x7fe0ff, 0, p.h - 0.2, s * (p.d / 2 - 0.24), 0.14, { rx: s > 0 ? 0 : PI }); }
    kit().put(g, kit().G.cone(), kit().toon(0xc9cce0), { y: 0.12, s: 0.35, sy: 0.3, rx: PI });
  };
  B.crate = (g, p) => {
    blk(g, 0xf2f0fa, 0, 0, 0, p.w, p.h, p.d, 0.08);
    for (const s of [-1, 1]) {
      kit().block(g, 0xff8a3a, 0, p.h * 0.5, s * (p.d / 2 + 0.005), p.w * 0.9, 0.16, 0.02, 0.01);
      kit().block(g, 0xff8a3a, s * (p.w / 2 + 0.005), p.h * 0.5, 0, 0.02, 0.16, p.d * 0.9, 0.01);
    }
  };
  B.hab = (g, p) => {
    blk(g, 0xf5f3fb, 0, 0, 0, p.w, p.h, p.d, 0.45);
    const long = p.d > p.w, L = long ? p.d : p.w;
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const a = -L / 2 + L * (i + 1) / 4;
      if (long) kit().disc(g, 0x7fd0ff, s * (p.w / 2 + 0.005), p.h * 0.55, a, 0.28, { rx: 0, ry: s * PI / 2 });
      else kit().disc(g, 0x7fd0ff, a, p.h * 0.55, s * (p.d / 2 + 0.005), 0.28, { rx: 0, ry: s > 0 ? 0 : PI });
    }
    if (long) blk(g, 0xff8a3a, 0, p.h * 0.18, 0, p.w + 0.01, 0.16, p.d * 0.7, 0.04); else blk(g, 0xff8a3a, 0, p.h * 0.18, 0, p.w * 0.7, 0.16, p.d + 0.01, 0.04);
    kit().ball(g, kit().glow(0xff3b3b, 0.9), 0, p.h, 0, 0.12);
  };
  B.rover = (g, p) => {
    blk(g, 0xffcf3a, 0, 0.45, 0, p.w - 0.3, p.h - 0.75, p.d, 0.14);
    blk(g, 0xf2f3f8, 0, p.h - 0.35, -p.d * 0.15, p.w - 0.5, 0.3, p.d * 0.5, 0.08);
    kit().block(g, 0x2e5fd6, 0, p.h - 0.03, p.d * 0.2, p.w - 0.4, 0.04, p.d * 0.4, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
      const w = kit().cylinder(g, 0x333844, sx * (p.w / 2 - 0.15), 0.32, sz * (p.d / 2 - 0.45), 0.32, 0.26, { seg: 16 });
      w.rotation.z = PI / 2;
    }
  };
  let solarTex = null;
  B.solar = (g, p) => {
    solarTex = solarTex || tex(128, 128, (ctx, w, h) => { ctx.fillStyle = "#2e5fd6"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "#9fc3ff"; ctx.lineWidth = 2; for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, h); ctx.moveTo(0, i * 32); ctx.lineTo(w, i * 32); ctx.stroke(); } });
    const long = p.d > p.w;
    for (const s of [-0.3, 0.3]) cyl(g, 0xc9cce0, long ? 0 : s * p.w, 0, long ? s * p.d : 0, 0.06, p.h - 0.25, { seg: 8 });
    const panel = kit().put(g, kit().G.box(), texMat(solarTex), { y: p.h - 0.2, sx: long ? p.w * 0.95 : p.w, sy: 0.05, sz: long ? p.d : p.d * 0.95 });
    if (long) panel.rotation.z = 0.35; else panel.rotation.x = 0.35;
    blk(g, 0xc9cce0, 0, 0, 0, long ? p.w * 0.6 : p.w * 0.95, 0.25, long ? p.d * 0.95 : p.d * 0.6, 0.05);
  };
  B.cargo = (g, p) => {
    blk(g, 0xd5d8e3, 0, 0, 0, p.w, p.h, p.d, 0.18);
    for (const s of [-1, 1]) {
      kit().block(g, 0xff8a3a, 0, p.h * 0.3, s * (p.d / 2 + 0.005), p.w * 0.9, 0.18, 0.02, 0.01);
      picture(g, signTex("SPACE CARGO", "#d5d8e3", "#5a4f8a"), 0, p.h * 0.65, s * (p.d / 2 + 0.012), p.w * 0.7, 0.4, s > 0 ? 0 : PI);
    }
  };
  B.tank = (g, p) => {
    cyl(g, 0xf2f0fa, 0, 0, 0, p.r, p.h - p.r * 0.5, { seg: 24 });
    kit().put(g, kit().G.sphere(), kit().toon(0xf2f0fa), { y: p.h - p.r * 0.5, sx: p.r, sy: p.r * 0.5, sz: p.r });
    cyl(g, 0xff8a3a, 0, p.h * 0.35, 0, p.r + 0.01, 0.2, { seg: 24 });
  };
  B.crystal = (g, p) => {
    const m = kit().toon(0x9ff3ff, { emissive: 0x4fd8ff, emissiveIntensity: 0.35 });
    own(m);
    const parts = [[0, 0, 1, 0], [0.35, 0.2, 0.7, 0.3], [-0.3, 0.25, 0.65, -0.35], [0.1, -0.35, 0.6, 0.2]];
    for (const [x, z, s, tilt] of parts) kit().put(g, kit().G.cone(6), m, { x: x * p.r, y: p.h * s / 2, z: z * p.r, sx: p.r * 0.35, sy: p.h * s, sz: p.r * 0.35, rz: tilt * 0.4 });
  };
  B.antenna = (g, p) => {
    cyl(g, 0xc9cce0, 0, 0, 0, p.r, p.h, { seg: 8 });
    const dish = kit().put(g, kit().G.sphere(), kit().toon(0xf2f3f8), { y: p.h - 0.4, sx: 0.8, sy: 0.25, sz: 0.8 });
    dish.rotation.z = 0.6;
    kit().ball(g, kit().glow(0xff3b3b, 1), 0, p.h + 0.05, 0, 0.1);
  };
  // -- office
  let rackTex = null;
  B.rack = (g, p) => {
    rackTex = rackTex || tex(64, 256, (ctx, w, h) => { ctx.fillStyle = "#2a2f3a"; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { ctx.fillStyle = "#3a404d"; ctx.fillRect(4, i * 16 + 2, w - 8, 12); ctx.fillStyle = i % 3 ? "#5cff8a" : "#7fd0ff"; ctx.fillRect(8, i * 16 + 6, 4, 3); ctx.fillRect(16, i * 16 + 6, 4, 3); } });
    kit().put(g, kit().G.box(), texMat(rackTex), { y: p.h / 2, sx: p.w, sy: p.h, sz: p.d });
    blk(g, 0x1f232b, 0, p.h - 0.06, 0, p.w + 0.02, 0.06, p.d + 0.02, 0.02);
  };
  B.meeting = (g, p) => {
    blk(g, 0xe9edf5, 0, 0, 0, p.w, p.h, p.d, 0.05);
    for (const s of [-1, 1]) {
      kit().block(g, 0xbfd9ee, 0, p.h * 0.62, s * (p.d / 2 + 0.005), p.w * 0.86, p.h * 0.32, 0.02, 0.01);
      kit().block(g, 0x2e7dd1, 0, 0.1, s * (p.d / 2 + 0.005), p.w + 0.0, 0.2, 0.02, 0.01);
      picture(g, signTex("MEETING ROOM", "#2e7dd1", "#ffffff"), 0, p.h * 0.32, s * (p.d / 2 + 0.012), 1.4, 0.32, s > 0 ? 0 : PI);
    }
  };
  B.desk = (g, p) => {
    blk(g, 0xf2f2f2, 0, p.h - 0.05, 0, p.w, 0.05, p.d, 0.02);
    for (const s of [-1, 1]) blk(g, 0xcfd6e0, s * (p.w / 2 - 0.03), 0, 0, 0.05, p.h - 0.05, p.d, 0.01);
    blk(g, 0xcfd6e0, 0, 0.1, 0, p.w - 0.1, p.h - 0.2, 0.05, 0.01);
    const mugs = [0xff6b6b, 0x4fb0f5, 0xffd84a];
    for (let i = 0; i < 3; i++) cyl(g, mugs[i], -p.w / 2 + 0.5 + i * 1.1, p.h, 0.45, 0.05, 0.1, { seg: 8 });
  };
  let screenTex = null;
  B.screens = (g, p) => {
    screenTex = screenTex || tex(128, 64, (ctx, w, h) => { ctx.fillStyle = "#1f232b"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#7fd0ff"; ctx.fillRect(6, 6, w - 12, h - 18); ctx.fillStyle = "#ffffff"; for (let i = 0; i < 4; i++) ctx.fillRect(12, 12 + i * 9, 40 + (i * 23) % 50, 4); });
    const n = Math.max(1, Math.round(p.w / 0.8));
    for (let i = 0; i < n; i++) {
      const x = -p.w / 2 + (i + 0.5) * (p.w / n);
      kit().put(g, kit().G.box(), texMat(screenTex), { x, y: p.h * 0.6, sx: p.w / n - 0.08, sy: p.h * 0.75, sz: p.d * 0.6 });
      cyl(g, 0x3d4a5c, x, 0, 0, 0.03, p.h * 0.3, { seg: 6 });
    }
  };
  B.partition = (g, p) => {
    const long = p.w > p.d;
    blk(g, 0x8fa6c4, 0, 0, 0, p.w, p.h - 0.05, p.d, 0.03);
    blk(g, 0xd0d6de, 0, p.h - 0.06, 0, long ? p.w : p.w + 0.02, 0.06, long ? p.d + 0.02 : p.d, 0.02);
  };
  let bookTex = null;
  B.shelf = (g, p) => {
    bookTex = bookTex || tex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#c9925a"; ctx.fillRect(0, 0, w, h);
      const r = rnd(11), cols = ["#ff6b6b", "#4fb0f5", "#ffd84a", "#7fd65a", "#b48cff", "#ffffff", "#ff9e4a"];
      for (let s = 0; s < 4; s++) {
        ctx.fillStyle = "#8a5a32"; ctx.fillRect(0, s * 64 + 56, w, 8);
        let x = 6; while (x < w - 10) { const bw = 8 + r() * 12, bh = 30 + r() * 20; ctx.fillStyle = cols[(r() * cols.length) | 0]; ctx.fillRect(x, s * 64 + 56 - bh, bw, bh); x += bw + 1; }
      }
    });
    kit().put(g, kit().G.box(), texMat(bookTex), { y: p.h / 2, sx: p.w, sy: p.h, sz: p.d });
    blk(g, 0x8a5a32, 0, p.h - 0.05, 0, p.w + 0.04, 0.05, p.d + 0.04, 0.02);
  };
  B.boxes = (g, p) => {
    blk(g, 0xd9b07a, 0, 0, 0, p.w, p.h, p.d, 0.03);
    kit().block(g, 0xf0dcb4, 0, p.h, 0, 0.16, 0.01, p.d + 0.01, 0.003);
    for (const s of [-1, 1]) kit().block(g, 0xf0dcb4, 0, p.h * 0.75, s * (p.d / 2 + 0.003), 0.16, p.h * 0.5, 0.01, 0.003);
  };
  B.cabinet = (g, p) => {
    blk(g, 0xb8c0cc, 0, 0, 0, p.w, p.h, p.d, 0.03);
    const long = p.w > p.d, n = Math.max(1, Math.round((long ? p.w : p.d) / 0.6));
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (const s of [-1, 1]) {
      const a = -(long ? p.w : p.d) / 2 + (i + 0.5) * ((long ? p.w : p.d) / n), y = 0.2 + r * (p.h / 3);
      if (long) kit().block(g, 0x3d4a5c, a, y + 0.15, s * (p.d / 2 + 0.005), 0.18, 0.04, 0.02, 0.01);
      else kit().block(g, 0x3d4a5c, s * (p.w / 2 + 0.005), y + 0.15, a, 0.02, 0.04, 0.18, 0.01);
    }
  };
  B.plant = (g, p) => {
    cyl(g, 0xffffff, 0, 0, 0, p.r * 0.75, 0.55, { seg: 16 });
    const leaf = kit().toon(0x4fbf47);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const l = kit().put(g, kit().G.sphere(), leaf, { x: Math.cos(a) * p.r * 0.45, y: 0.55 + (p.h - 0.55) * 0.5, z: Math.sin(a) * p.r * 0.45, sx: 0.12, sy: (p.h - 0.55) * 0.5, sz: p.r * 0.35 });
      l.rotation.set(0, -a, 0.35);
    }
  };
  B.sofa = (g, p) => {
    const c = 0x2fb3a8;
    blk(g, c, 0, 0, 0, p.w, 0.42, p.d, 0.1);
    blk(g, c, 0, 0.4, -p.d / 2 + 0.15, p.w, p.h - 0.4, 0.3, 0.1);
    for (const s of [-1, 1]) blk(g, c, s * (p.w / 2 - 0.12), 0.4, 0, 0.24, 0.25, p.d, 0.08);
    for (const s of [-0.25, 0.25]) blk(g, 0x5cd6cc, s * p.w, 0.42, 0.05, p.w * 0.45, 0.1, p.d - 0.4, 0.05);
  };
  B.printer = (g, p) => {
    blk(g, 0xf2f2f2, 0, 0, 0, p.w, p.h * 0.75, p.d, 0.05);
    blk(g, 0xd0d6de, 0, p.h * 0.75, 0, p.w, p.h * 0.25, p.d, 0.05);
    kit().block(g, 0x3d4a5c, p.w * 0.25, p.h * 0.5, p.d / 2 + 0.01, p.w * 0.3, 0.12, 0.02, 0.01);
    kit().block(g, 0xffffff, 0, p.h * 0.62, p.d / 2 + 0.01, p.w * 0.6, 0.02, 0.06, 0.005);
  };
  B.cooler = (g, p) => {
    cyl(g, 0xf2f2f2, 0, 0, 0, p.r, p.h * 0.62, { seg: 16 });
    kit().put(g, kit().G.sphere(), kit().toon(0x9fd8ff), { y: p.h * 0.62 + (p.h * 0.38) / 2, sx: p.r * 0.85, sy: (p.h * 0.38) / 2, sz: p.r * 0.85 });
  };

  // draws a map's own pieces
  function pieces(parent, list, setting) {
    const C = COL[setting] || {};
    for (const p of list) {
      const b = B[p.k];
      const g = kit().group(parent, p.x, p.y || 0, p.z, p.t === "box" ? p.rot || 0 : 0);
      if (b) b(g, p, C, setting);
      else if (p.t === "box") blk(g, 0xcccccc, 0, 0, 0, p.w, p.h, p.d, 0.05);
      else cyl(g, 0xcccccc, 0, 0, 0, p.r, p.h);
    }
  }

  // ---------------------------------------------------------------------
  // The edge of a map's own floor plan. coll(x, z, hw, hd, y0, y1, mat) adds a
  // wall you bump into / paint splats on (outside the playable area).
  // ---------------------------------------------------------------------
  function perimeter(parent, setting, coll, R) {
    const T = 1.0; // walls start right at the edge, 1 m thick
    // each side: from, to along it; the wall's inner face is at the edge of the area
    const sides = [
      { ax: "x", at: R.maxZ, dir: 1, a0: R.minX - T, a1: R.maxX + T }, // +z (behind team A)
      { ax: "x", at: R.minZ, dir: -1, a0: R.minX - T, a1: R.maxX + T },
      { ax: "z", at: R.maxX, dir: 1, a0: R.minZ, a1: R.maxZ },
      { ax: "z", at: R.minX, dir: -1, a0: R.minZ, a1: R.maxZ },
    ];
    const seg = (s, a0, a1, h, build) => { // one stretch of wall (in world coords)
      const mid = (a0 + a1) / 2, len = a1 - a0, c = s.at + s.dir * T / 2;
      const x = s.ax === "x" ? mid : c, z = s.ax === "x" ? c : mid, w = s.ax === "x" ? len : T, d = s.ax === "x" ? T : len;
      coll(x, z, w / 2, d / 2, 0, h, setting === "park" ? "wood" : "metal");
      const g = kit().group(parent, x, 0, z, s.ax === "x" ? (s.dir > 0 ? PI : 0) : (s.dir > 0 ? -PI / 2 : PI / 2));
      // in g: the wall runs along local x (length len), its inside faces +z
      build(g, len, h, T);
    };
    const C = COL[setting] || {};
    if (setting === "park") {
      for (const s of sides) seg(s, s.a0, s.a1, 2.2, (g, len, h, t) => bushTop(g, { w: len, d: t, h, x: s.at, z: len }, 0, C));
    } else if (setting === "cafe") {
      // shop fronts all round (with awnings over the pavement in front)
      const shops = [["BAKERY", "#ffe8c2", "#d9805a"], ["MII CAFÉ", "#c9f0e0", "#2f9e6e"], ["BOUTIQUE", "#f2d2ff", "#9b5cff"], ["TOY BOX", "#ffd6d6", "#e8507a"], ["FLOWERS", "#fff6c2", "#e8a400"], ["BOOKS", "#d6ecff", "#2e7dd1"]];
      let k = 0;
      for (const s of sides) {
        const n = Math.max(1, Math.round((s.a1 - s.a0) / 6.5)), step = (s.a1 - s.a0) / n;
        for (let i = 0; i < n; i++) {
          const sh = shops[k++ % shops.length], h = 6 + ((k * 7) % 3) * 1.2;
          seg(s, s.a0 + i * step, s.a0 + (i + 1) * step, h, (g, len, hh) => {
            const wt = windowsTex(sh[1], "#9fd8ff", "#ffffff", 3, 3, true); wt.repeat.set(1, 1);
            kit().put(g, kit().G.box(), texMat(wt), { y: hh / 2, z: 0, sx: len - 0.02, sy: hh, sz: 1.0 });
            blk(g, sh[2], 0, hh - 0.3, 0.02, len, 0.3, 1.04, 0.05);
            picture(g, signTex(sh[0], "#ffffff", sh[2]), 0, 2.75, 0.52, Math.min(3.2, len * 0.6), 0.55);
            const aw = stripes([sh[2], "#ffffff"], 10, true);
            picture(g, aw, 0, 2.25, 0.515, len - 0.6, 0.35);
          });
        }
      }
    } else if (setting === "beach") {
      for (const s of sides) {
        if (s.ax === "z" && s.dir > 0) { // the sea side: a low boardwalk railing
          seg(s, s.a0, s.a1, 1.0, (g, len, h) => {
            blk(g, 0xd9a066, 0, 0, 0, len, 0.12, 1.0, 0.02);
            for (let i = 0; i <= Math.floor(len / 1.5); i++) blk(g, 0xb9824e, -len / 2 + i * (len / Math.floor(len / 1.5)), 0, 0.4, 0.12, h, 0.12, 0.02);
            blk(g, 0xffffff, 0, h - 0.08, 0.4, len, 0.08, 0.14, 0.03);
            blk(g, 0xffffff, 0, h * 0.5, 0.4, len, 0.06, 0.08, 0.02);
          });
        } else if (s.ax === "z") { // beach huts in a row
          const n = Math.round((s.a1 - s.a0) / 3.4), step = (s.a1 - s.a0) / n;
          for (let i = 0; i < n; i++) seg(s, s.a0 + i * step, s.a0 + (i + 1) * step, 2.8, (g, len, h) => {
            kit().put(g, kit().G.box(), texMat(stripes(hutCols[i % hutCols.length], 8, true)), { y: (h - 0.3) / 2, sx: len - 0.15, sy: h - 0.3, sz: 1.0 });
            blk(g, 0xffffff, 0, h - 0.3, 0, len - 0.05, 0.3, 1.1, 0.08);
            blk(g, 0x8a5a32, 0, 0, 0.505, 0.8, 1.8, 0.03, 0.02);
          });
        } else { // dune fences
          seg(s, s.a0, s.a1, 1.2, (g, len, h) => {
            kit().put(g, kit().G.sphere(), kit().toon(0xf0d79a), { y: 0, sx: len / 2 + 0.6, sy: 0.9, sz: 1.1 });
            for (let i = 0; i < Math.floor(len / 0.35); i++) blk(g, i % 2 ? 0xd9a066 : 0xc48a50, -len / 2 + 0.2 + i * 0.35, 0, 0.45, 0.08, h - (i % 3) * 0.06, 0.04, 0.01);
            for (let i = 0; i < len / 2; i++) cyl(g, 0x9ccf5a, -len / 2 + i * 2 + 0.7, 0.4, -0.2, 0.04, 0.6, { seg: 4, rz: 0.3 });
          });
        }
      }
    } else if (setting === "moon") {
      for (const s of sides) {
        const n = Math.max(1, Math.round((s.a1 - s.a0) / 4)), step = (s.a1 - s.a0) / n;
        for (let i = 0; i < n; i++) {
          const h = 1.7 + ((i * 5 + (s.dir > 0 ? 1 : 3)) % 4) * 0.35;
          seg(s, s.a0 + i * step, s.a0 + (i + 1) * step, h, (g, len, hh) => {
            blk(g, i % 2 ? C.rock : C.rock2, 0, 0, 0, len + 0.2, hh, 1.0, 0.35);
            kit().ball(g, C.rock2, len * 0.2, hh * 0.85, 0, 0.6, { sy: 0.5 });
          });
        }
      }
    } else if (setting === "office") {
      officeWalls(parent, R, T, coll, 6.0);
    }
  }

  // office walls with big windows (and the ceiling), around rectangle R
  let officeWallTex = null;
  function officeWalls(parent, R, T, coll, H) {
    officeWallTex = officeWallTex || tex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#e9edf5"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#2e7dd1"; ctx.fillRect(0, h - 14, w, 14);
    });
    const glass = own(new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.25, gradientMap: null, depthWrite: false }));
    const sides = [
      [0, R.maxZ + T / 2, (R.maxX - R.minX) + 2 * T, T, PI], [0, R.minZ - T / 2, (R.maxX - R.minX) + 2 * T, T, 0],
      [R.maxX + T / 2, 0, T, R.maxZ - R.minZ, -PI / 2], [R.minX - T / 2, 0, T, R.maxZ - R.minZ, PI / 2],
    ];
    const wb = 1.0, wt = H - 0.8; // windows from 1 m up to 0.8 m under the ceiling
    for (const [x, z, w, d, ry] of sides) {
      coll(x, z, w / 2, d / 2, 0, H, "metal");
      const len = Math.max(w, d), g = kit().group(parent, x, 0, z, ry);
      kit().put(g, kit().G.box(), texMat(officeWallTex), { y: wb / 2, sx: len, sy: wb, sz: T });
      blk(g, 0xe9edf5, 0, wt, 0, len, H - wt, T, 0.02);
      const n = Math.round(len / 3);
      for (let i = 0; i <= n; i++) blk(g, 0xd0d6de, -len / 2 + i * (len / n), wb, 0, 0.18, wt - wb, T, 0.02);
      blk(g, 0xd0d6de, 0, wb - 0.04, T / 2 - 0.15, len, 0.08, 0.3, 0.02);
      const pane = new THREE.Mesh(own(new THREE.PlaneGeometry(len, wt - wb)), glass);
      pane.position.set(0, (wb + wt) / 2, 0); g.add(pane);
    }
    // the ceiling, with rows of lights
    const cw = R.maxX - R.minX + 2 * T, cd = R.maxZ - R.minZ + 2 * T;
    coll(0, 0, cw / 2, cd / 2, H, H + 0.3, "metal");
    const ceil = kit().put(parent, kit().G.box(), kit().toon(0xf4f6fa), { y: H + 0.15, sx: cw, sy: 0.3, sz: cd, shadow: false });
    ceil.castShadow = false;
    const lights = [];
    for (let x = -cw / 2 + 3; x < cw / 2 - 2; x += 4.5) for (let z = -cd / 2 + 3; z < cd / 2 - 2; z += 4.5) lights.push({ x, y: H - 0.01, z, sx: 2.2, sy: 0.04, sz: 0.5 });
    const lm = own(kit().toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.9 }));
    kit().scatter(parent, kit().G.box(), lm, lights, false);
  }

  // ---------------------------------------------------------------------
  // Shipment's floor in each place
  // ---------------------------------------------------------------------
  // a lamp in a corner (instead of the shipyard's floodlights). The pole is
  // what you bump into: { r } in the map's colliders.
  function cornerLamp(parent, setting, x, z, h) {
    const g = kit().group(parent, x, 0, z, Math.atan2(-x, -z));
    if (setting === "moon" || setting === "office") {
      const col = setting === "moon" ? 0xc9cce0 : 0xd0d6de;
      cyl(g, col, 0, 0, 0, 0.14, h, { seg: 10 });
      blk(g, col, 0, h, 0, 1.4, 0.1, 0.1, 0.03);
      for (const lx of [-0.5, 0, 0.5]) kit().block(g, kit().glow(0xfff6e0, 0.9), lx, h - 0.1, 0.12, 0.36, 0.26, 0.16, 0.04);
    } else if (setting === "beach") {
      cyl(g, 0xb9824e, 0, 0, 0, 0.14, h * 0.55, { seg: 8 });
      kit().put(g, kit().G.taper(0.25, 0.12), kit().toon(0xd9a066), { y: h * 0.55 + 0.25, sy: 0.5 });
      kit().ball(g, kit().glow(0xffb02e, 1), 0, h * 0.55 + 0.6, 0, 0.18, { sy: 1.4 });
    } else {
      cyl(g, 0x2f4f46, 0, 0, 0, 0.3, 0.25, { seg: 12 });
      cyl(g, 0x2f4f46, 0, 0, 0, 0.12, h * 0.5, { seg: 10 });
      kit().ball(g, kit().glow(setting === "cafe" ? 0xffe6a8 : 0xfff1b8, 0.9), 0, h * 0.5 + 0.3, 0, 0.36);
      kit().put(g, kit().G.cone(), kit().toon(0x2f4f46), { y: h * 0.5 + 0.7, s: 0.45, sy: 0.32 });
    }
  }
  // The long low obstacle lying on Shipment's floor (a girder in the shipyard):
  // a flower planter in the park and the town, driftwood on the beach, a pipe
  // rack on the moon, a cable tray in the office. 0.7 wide, 0.34 high.
  function lowBar(parent, setting, x0, z0, x1, z1) {
    const L = Math.hypot(x1 - x0, z1 - z0), g = kit().group(parent, (x0 + x1) / 2, 0, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0));
    const C = COL[setting] || {};
    if (setting === "park" || setting === "cafe") {
      blk(g, setting === "park" ? 0xd9894a : 0xd9805a, 0, 0, 0, 0.7, 0.3, L, 0.04);
      kit().disc(g, 0x6b4a2e, 0, 0.301, 0, 1, { sx: 0.3, sy: L / 2 - 0.1 });
      const fl = C.flowers || [0xffffff];
      for (let i = 0; i < L / 0.3; i++) { kit().ball(g, C.leaf || 0x5cc84a, (i % 2 ? -0.15 : 0.15), 0.34, -L / 2 + 0.2 + i * 0.3, 0.12, { sy: 0.5, shadow: false }); if (i % 2) kit().ball(g, fl[i % fl.length], (i % 4 ? 0.1 : -0.1), 0.42, -L / 2 + 0.2 + i * 0.3, 0.07, { shadow: false }); }
    } else if (setting === "beach") {
      for (const s of [-1, 1]) cyl(g, s > 0 ? 0xc9b08e : 0xb59a78, s * 0.17, 0, 0, 0.16, L - 0.2 * (s + 1), { rx: PI / 2, seg: 10 }).position.y = 0.17;
    } else {
      const col = setting === "moon" ? 0xc9cce0 : 0x8a93a3;
      blk(g, col, 0, 0, 0, 0.7, 0.06, L, 0.02);
      for (const s of [-1, 1]) blk(g, col, s * 0.32, 0, 0, 0.06, 0.34, L, 0.02);
      const pc = setting === "moon" ? [0xff8a3a, 0x7fe0ff, 0xf2f0fa] : [0x3d4a5c, 0xffd84a, 0x4fb0f5];
      for (let i = 0; i < 3; i++) cyl(g, pc[i], -0.18 + i * 0.18, 0.06, 0, 0.07, L - 0.1, { rx: PI / 2, seg: 8 }).position.y = 0.14;
    }
  }

  // ---------------------------------------------------------------------
  // Everything outside the arena. rect = { x, z }: how far the arena (and its
  // walls) reach from the middle; scenery starts beyond that.
  // ---------------------------------------------------------------------
  let cloudGeo = null;
  function clouds(parent, count, rMin, rMax, yMin, yMax, seed) {
    cloudGeo = cloudGeo || (() => {
      const parts = [[0, 0, 0, 2.2], [2.2, -0.4, 0.3, 1.6], [-2.1, -0.5, 0, 1.5], [0.6, 1.1, 0, 1.4], [-0.9, 0.7, 0.6, 1.2]];
      const gs = parts.map(([x, y, z, s]) => { const s2 = new THREE.SphereGeometry(s, 12, 8); s2.translate(x, y, z); return s2.toNonIndexed(); });
      const m = THREE.BufferGeometryUtils.mergeBufferGeometries(gs); gs.forEach((q) => q.dispose()); return m;
    })();
    const r = rnd(seed), items = [];
    for (let i = 0; i < count; i++) {
      const a = ((i + r() * 0.7) / count) * TAU, d = rMin + r() * (rMax - rMin), s = 1.6 + r() * 2.4;
      items.push({ x: Math.cos(a) * d, y: yMin + r() * (yMax - yMin), z: Math.sin(a) * d, s, sy: s * 0.8, ry: -a });
    }
    const m = kit().scatter(parent, cloudGeo, kit().toon(0xffffff), items, false);
    m.receiveShadow = false; m.frustumCulled = false; m.userData.dynamic = true;
    return m;
  }
  // a spot in the ring around the arena (outside rect + margin, inside rad)
  function ringSpot(r, rect, margin, rad) {
    for (let i = 0; i < 40; i++) {
      const x = (r() - 0.5) * 2 * rad, z = (r() - 0.5) * 2 * rad;
      if (Math.abs(x) < rect.x + margin && Math.abs(z) < rect.z + margin) continue;
      if (Math.hypot(x, z) > rad) continue;
      return { x, z };
    }
    return { x: rect.x + margin + 5, z: 0 };
  }
  function waves(color, repeat) {
    return tex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      const r = rnd(4);
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 14; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.arc(x, y, 9, PI * 1.15, PI * 1.85); ctx.stroke(); }
    }, [repeat, repeat]);
  }
  function grassTex(base, repeat) {
    return tex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0, 0, w / 2, h);
      const r = rnd(8);
      for (let i = 0; i < 140; i++) {
        const x = r() * w, y = r() * h;
        ctx.strokeStyle = r() < 0.5 ? "rgba(70,150,45,0.55)" : "rgba(170,235,120,0.6)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x + 3, y); ctx.lineTo(x + 4, y - 7); ctx.stroke();
      }
    }, [repeat, repeat]);
  }
  function sailboat(parent, x, z, ry, s, sail) {
    const b = kit().group(parent, x, -0.3, z, ry, s);
    kit().put(b, kit().G.sphere(), kit().toon(0xffffff), { sx: 0.8, sy: 0.5, sz: 2.2 });
    cyl(b, 0x8a5a32, 0, 0, 0, 0.06, 4.2, { seg: 6 });
    const t = new THREE.BufferGeometry();
    t.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.6, 0.1, 0, 4.2, 0.1, 0, 0.6, 1.9, 0, 0.6, 0.1, 0, 0.6, 1.9, 0, 4.2, 0.1], 3));
    t.computeVertexNormals(); own(t);
    kit().put(b, t, own(kit().toon(sail, { side: THREE.DoubleSide })), {});
    return b;
  }
  function island(parent, x, z, s, palms) {
    const g = kit().group(parent, x, -0.9, z, 0, s);
    cyl(g, 0xf5dfa4, 0, -0.5, 0, 6, 1.2, { seg: 24 });
    kit().put(g, kit().G.sphere(), kit().toon(0x7fd65a), { y: 0.6, sx: 4.6, sy: 1.4, sz: 4.6 });
    for (let i = 0; i < palms; i++) kit().palmTree(g, Math.cos(i * 2.1) * 2.2, Math.sin(i * 2.1) * 2.2, 0.9 + (i % 2) * 0.2, i * 0.7);
  }
  function building(parent, x, z, w, d, h, wall, ry, shop) {
    const floors = Math.max(1, Math.round(h / 3)), bays = Math.max(1, Math.round(w / 3));
    const t = windowsTex(wall, "#8fd0ff", "#ffffff", 4, 4, false);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(bays / 4, floors / 4);
    const td = t.clone(); own(td); td.needsUpdate = true; td.repeat.set(Math.max(1, Math.round(d / 3)) / 4, floors / 4);
    const g = kit().group(parent, x, 0, z, ry || 0);
    const mats = [texMat(td), texMat(td), kit().toon(new THREE.Color(wall).multiplyScalar(0.9).getHex()), kit().toon(0x888888), texMat(t), texMat(t)];
    const m = new THREE.Mesh(kit().G.box(), mats);
    m.scale.set(w, h, d); m.position.y = h / 2; m.castShadow = false; m.receiveShadow = false;
    g.add(m);
    blk(g, new THREE.Color(wall).multiplyScalar(0.8).getHex(), 0, h, 0, w + 0.3, 0.4, d + 0.3, 0.05);
    if (shop) { // a striped awning over the street
      const aw = kit().put(g, kit().G.box(), texMat(stripes([shop, "#ffffff"], 10, true)), { y: 3.0, z: d / 2 + 0.6, sx: w * 0.9, sy: 0.08, sz: 1.2, shadow: false });
      aw.rotation.x = 0.35;
    }
    return g;
  }

  const SKIES = {
    park: [0x3fa9f5, 0xcdeeff, 0x3fb6e8],
    cafe: [0x3fa9f5, 0xcdeeff, 0xd9e8f0],
    beach: [0x3fa9f5, 0xcdeeff, 0x3fb6e8],
    office: [0x4fb0f5, 0xd8efff, 0xc4e2f2],
  };

  function backdrop(parent, setting, rect) {
    const anim = [];
    const bg = new THREE.Group(); bg.name = "backdrop"; parent.add(bg);
    const r = rnd(setting.length * 13 + 7);
    if (SKIES[setting]) { const d = kit().skyDome(bg, ...SKIES[setting]); own(d.geometry); own(d.material); }
    if (setting === "park") {
      // the island: grass all around, then a sandy beach and the sea
      const grass = grassTex("#7fd65a", 30);
      const isl = kit().put(bg, new THREE.CylinderGeometry(70, 72, 1, 64), [kit().toon(0xb27a45), texMat(grass), kit().toon(0xb27a45)], { y: -0.52, shadow: false });
      own(isl.geometry);
      kit().put(bg, own(new THREE.CylinderGeometry(76, 76, 0.8, 64)), kit().toon(0xf5dfa4), { y: -0.75, shadow: false });
      const sea = kit().disc(bg, texMat(waves("#3db3e6", 40)), 0, -0.95, 0, 240, { receive: false });
      anim.push((t) => { sea.material.map.offset.set(t * 0.004, t * 0.007); });
      for (let i = 0; i < 46; i++) {
        const p = ringSpot(r, rect, 2.5, 62), s = 0.9 + r() * 0.7;
        kit().roundTree(bg, p.x, p.z, s, r() < 0.2 ? [0xff9ec7, 0xffc4dc] : [0x5cc84a, 0x7fdc5c], r() < 0.3 ? 0xff4b3a : null);
      }
      for (let i = 0; i < 40; i++) { const p = ringSpot(r, rect, 1.8, 55); kit().bush(bg, p.x, p.z, 0.8 + r() * 0.6, r() < 0.5 ? 0x4fbf47 : 0x5cc84a, [0xff6fa5, 0xffe25a, 0xffffff][i % 3]); }
      for (let i = 0; i < 10; i++) { const p = ringSpot(r, rect, 3, 30); kit().lampPost(bg, p.x, p.z); }
      for (let i = 0; i < 6; i++) { const p = ringSpot(r, rect, 3, 30); kit().parkBench(bg, p.x, p.z, Math.atan2(-p.x, -p.z)); }
      // a pond with ducks off to one side
      kit().disc(bg, 0x5aa646, rect.x + 14, 0.01, -6, 1, { sx: 6.5, sy: 4.5 });
      kit().disc(bg, 0x5cc6f2, rect.x + 14, 0.03, -6, 1, { sx: 6, sy: 4 });
      for (let i = 0; i < 3; i++) { const d = kit().group(bg, rect.x + 12 + i * 1.6, 0, -6 + (i % 2), i, i ? 0.6 : 1); kit().ball(d, i ? 0xffe46b : 0xffffff, 0, 0.2, 0, 0.32, { sx: 1.25 }); kit().ball(d, i ? 0xffe46b : 0xffffff, 0.3, 0.48, 0, 0.2); kit().put(d, kit().G.sphere(), kit().toon(0xffa22b), { x: 0.52, y: 0.45, s: 0.1, sx: 1.6, sy: 0.5 }); }
      for (let i = 0; i < 4; i++) island(bg, Math.cos(i * 1.7 + 0.5) * 140, Math.sin(i * 1.7 + 0.5) * 140, 1.4 + (i % 2) * 0.6, 3);
      for (let i = 0; i < 3; i++) sailboat(bg, Math.cos(i * 2.3 + 1) * 105, Math.sin(i * 2.3 + 1) * 105, i * 2, 1.4, [0xff6b6b, 0xffd84a, 0x4fb0f5][i]);
      clouds(bg, 22, 120, 200, 30, 55, 3);
    } else if (setting === "cafe") {
      // a street all the way round, then rows of colorful buildings
      kit().put(bg, own(new THREE.PlaneGeometry(400, 400)), kit().toon(0x8b8f99), { rx: -PI / 2, y: -0.03, shadow: false });
      const pave = tex(128, 128, (ctx, w, h) => { ctx.fillStyle = "#d8d0c4"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "#c4baa9"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, w, h); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); }, [40, 40]);
      const inner = rect, ring = 9;
      kit().put(bg, own(new THREE.PlaneGeometry((inner.x + 2) * 2, (inner.z + 2) * 2)), texMat(pave), { rx: -PI / 2, y: -0.02, shadow: false });
      // dashed lines on the road
      const dash = [];
      for (const sz of [-1, 1]) for (let x = -inner.x - ring; x < inner.x + ring; x += 3) dash.push({ x, y: -0.01, z: sz * (inner.z + 2 + ring / 2 - 1), sx: 1.4, sy: 0.02, sz: 0.18 });
      for (const sx of [-1, 1]) for (let z = -inner.z - ring; z < inner.z + ring; z += 3) dash.push({ x: sx * (inner.x + 2 + ring / 2 - 1), y: -0.01, z, sx: 0.18, sy: 0.02, sz: 1.4 });
      kit().scatter(bg, kit().G.box(), kit().toon(0xffffff), dash, false);
      const walls = ["#ffe8c2", "#c9f0e0", "#f2d2ff", "#ffd6d6", "#fff6c2", "#d6ecff", "#ffd9b8"], shopCols = ["#e8507a", "#2f9e6e", "#9b5cff", "#e8a400", "#2e7dd1"];
      let k = 0;
      const row = (along, at, from, to, ry) => {
        for (let a = from; a < to;) {
          const w = 5 + r() * 4, h = 7 + r() * 9, d = 7;
          const x = along === "x" ? a + w / 2 : at, z = along === "x" ? at : a + w / 2;
          building(bg, x, z, w, d, h, walls[k % walls.length], ry, shopCols[k % shopCols.length]);
          k++; a += w + 0.4;
        }
      };
      const off = ring + 2 + 3.5;
      row("x", inner.z + off, -inner.x - 20, inner.x + 20, PI);
      row("x", -inner.z - off, -inner.x - 20, inner.x + 20, 0);
      row("z", inner.x + off, -inner.z - 10, inner.z + 10, -PI / 2);
      row("z", -inner.x - off, -inner.z - 10, inner.z + 10, PI / 2);
      // taller ones further back
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU, d = 62 + r() * 30;
        building(bg, Math.cos(a) * d, Math.sin(a) * d, 8 + r() * 6, 8 + r() * 6, 14 + r() * 22, walls[i % walls.length], -a + PI / 2);
      }
      // street lamps and trees along the pavement
      for (const sz of [-1, 1]) for (let x = -inner.x; x <= inner.x; x += 8) { kit().lampPost(bg, x, sz * (inner.z + 2.2)); }
      for (const sx of [-1, 1]) for (let z = -inner.z + 4; z <= inner.z; z += 9) kit().roundTree(bg, sx * (inner.x + 2.4), z, 0.8, [0x5cc84a, 0x7fdc5c]);
      clouds(bg, 18, 120, 200, 40, 60, 5);
    } else if (setting === "beach") {
      // sand everywhere, the sea along +x
      const sand = tex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#f5dfa4"; ctx.fillRect(0, 0, w, h); const q = rnd(9); for (let i = 0; i < 400; i++) { ctx.fillStyle = q() < 0.5 ? "rgba(220,190,130,0.5)" : "rgba(255,245,220,0.6)"; ctx.fillRect(q() * w, q() * h, 2, 2); } }, [60, 60]);
      kit().put(bg, own(new THREE.PlaneGeometry(500, 500)), texMat(sand), { rx: -PI / 2, y: -0.03, shadow: false });
      const shore = rect.x + 9;
      const sea = kit().put(bg, own(new THREE.PlaneGeometry(260, 500)), texMat(waves("#3db3e6", 30)), { rx: -PI / 2, x: shore + 130, y: 0.02, shadow: false });
      anim.push((t) => { sea.material.map.offset.set(t * 0.004, t * 0.007); });
      const foam = kit().put(bg, own(new THREE.PlaneGeometry(1.6, 500)), kit().toon(0xffffff), { rx: -PI / 2, x: shore + 0.4, y: 0.03, shadow: false });
      foam.userData.dynamic = true;
      anim.push((t) => { foam.position.x = shore + 0.4 + Math.sin(t * 1.2) * 0.5; });
      kit().put(bg, own(new THREE.PlaneGeometry(5, 500)), kit().toon(0xe6c88a), { rx: -PI / 2, x: shore - 2, y: -0.01, shadow: false });
      // a pier out into the sea
      const pier = kit().group(bg, shore + 14, 0, -10);
      blk(pier, 0xc9a06a, 0, 0.6, 0, 26, 0.2, 2.6, 0.03);
      for (let i = 0; i < 9; i++) for (const s of [-1, 1]) cyl(pier, 0x8a5a32, -13 + i * 3.2, -0.5, s * 1.2, 0.14, 1.4, { seg: 8 });
      for (const x of [-5, 5]) kit().lampPost(pier, x, 1.1);
      for (let i = 0; i < 28; i++) {
        const p = ringSpot(r, rect, 2.5, 60);
        if (p.x > shore - 3) continue;
        if (i % 3) kit().palmTree(bg, p.x, p.z, 0.9 + r() * 0.5, r() * TAU);
        else { // umbrella + towel
          const u = kit().group(bg, p.x, 0, p.z, r() * TAU);
          cyl(u, 0xffffff, 0, 0, 0, 0.05, 2.2, { seg: 6 });
          kit().put(u, kit().G.cone(16), texMat(stripes([["#ff5a7a", "#3fa9f5", "#ffcf3a"][i % 3], "#ffffff"], 12, true)), { y: 2.2, sx: 1.4, sy: 0.4, sz: 1.4 });
          blk(u, [0x7fd0ff, 0xff9ec7, 0xffe25a][i % 3], 0.9, 0, 0, 0.9, 0.02, 1.8, 0.01);
        }
      }
      for (let i = 0; i < 4; i++) island(bg, shore + 60 + i * 30, -90 + i * 55, 1.4 + (i % 2) * 0.6, 3);
      for (let i = 0; i < 4; i++) sailboat(bg, shore + 35 + i * 18, -50 + i * 35, i * 1.3, 1.5, [0xff6b6b, 0xffd84a, 0x4fb0f5, 0xffffff][i]);
      clouds(bg, 22, 120, 200, 30, 55, 9);
    } else if (setting === "moon") {
      // the purple night sky with stars, Earth and a ringed planet
      const skyTex = tex(1024, 512, (ctx, w, h) => {
        const gr = ctx.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "#0b0830"); gr.addColorStop(0.5, "#271a5e"); gr.addColorStop(1, "#3a2470");
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
        const q = rnd(31);
        for (let i = 0; i < 14; i++) {
          const x = q() * w, y = h * 0.15 + q() * h * 0.45, rad = 60 + q() * 140, c = ["255,120,200", "120,160,255", "190,120,255", "120,230,255"][i % 4];
          for (const dx of [-w, 0, w]) { const ng = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad); ng.addColorStop(0, "rgba(" + c + ",0.35)"); ng.addColorStop(1, "rgba(" + c + ",0)"); ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h); }
        }
      });
      const sky = new THREE.Mesh(own(new THREE.SphereGeometry(240, 48, 24)), own(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })));
      sky.renderOrder = -10; bg.add(sky);
      const sp = [], q = rnd(3);
      for (let i = 0; i < 1400; i++) { const v = new THREE.Vector3(q() - 0.5, q() * 0.7 + 0.03, q() - 0.5).normalize().multiplyScalar(200); sp.push(v.x, v.y, v.z); }
      const starGeo = own(new THREE.BufferGeometry()); starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
      const dot = tex(32, 32, (ctx) => { const gg = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); gg.addColorStop(0, "rgba(255,255,255,1)"); gg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = gg; ctx.fillRect(0, 0, 32, 32); });
      const stars = new THREE.Points(starGeo, own(new THREE.PointsMaterial({ color: 0xffffff, size: 3.5, map: dot, transparent: true, depthWrite: false, fog: false })));
      bg.add(stars);
      anim.push((t) => { stars.material.opacity = 0.65 + Math.sin(t * 2.5) * 0.3; });
      const earthTex = tex(512, 256, (ctx, w, h) => { ctx.fillStyle = "#2f8ae0"; ctx.fillRect(0, 0, w, h); const e = rnd(9); ctx.fillStyle = "#5cc84a"; for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.ellipse(e() * w, h * 0.2 + e() * h * 0.6, 20 + e() * 45, 14 + e() * 26, e() * 3, 0, TAU); ctx.fill(); } ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, 16); ctx.fillRect(0, h - 16, w, 16); });
      const earth = kit().put(bg, own(new THREE.SphereGeometry(20, 48, 32)), texMat(earthTex, { fog: false }), { x: 40, y: 42, z: -170, shadow: false, receive: false });
      earth.userData.dynamic = true;
      anim.push((t) => { earth.rotation.y = t * 0.02; });
      const planet = kit().group(bg, -80, 55, 120, 0.4);
      kit().put(planet, kit().G.sphere(), own(kit().toon(0xffb46b, { fog: false })), { s: 10, shadow: false });
      kit().put(planet, kit().G.torus(16, 1.8), own(kit().toon(0xffe0b0, { fog: false })), { rx: 1.25, ry: 0.3, sz: 0.1, shadow: false });
      // the ground: lilac dust with craters, hills all round
      const moonTex = tex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#b9b0d6"; ctx.fillRect(0, 0, w, h); const m = rnd(5); for (let i = 0; i < 260; i++) { ctx.fillStyle = m() < 0.5 ? "rgba(150,138,190,0.28)" : "rgba(225,220,245,0.3)"; ctx.beginPath(); ctx.arc(m() * w, m() * h, 2 + m() * 6, 0, TAU); ctx.fill(); } }, [40, 40]);
      kit().put(bg, own(new THREE.PlaneGeometry(480, 480)), texMat(moonTex), { rx: -PI / 2, y: -0.03, shadow: false });
      for (let i = 0; i < 30; i++) {
        const p = ringSpot(r, rect, 3, 70), rad = 1 + r() * 4;
        kit().put(bg, kit().G.torus(rad, rad * 0.22), kit().toon(0xa79dc8), { x: p.x, y: 0.02, z: p.z, rx: -PI / 2, sz: 0.45, shadow: false });
        kit().disc(bg, 0x9a90bd, p.x, 0.03, p.z, rad);
      }
      for (let i = 0; i < 26; i++) { const p = ringSpot(r, rect, 2, 50); kit().rock(bg, p.x, p.z, 0.5 + r() * 1.4, r() < 0.5 ? 0xa79dc8 : 0x968cbb); }
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * TAU + r() * 0.1, d = 150 + r() * 50, s = 10 + r() * 14;
        kit().put(bg, kit().G.midSphere(), kit().toon([0x9d93c6, 0x8a80b5, 0xb2a8d8][i % 3]), { x: Math.cos(a) * d, y: -3, z: Math.sin(a) * d, sx: s * 1.6, sy: 7 + r() * 13, sz: s, ry: -a, shadow: false });
      }
      // the base: a rocket on its pad, a glass dome with a garden, a flag
      const rk = kit().group(bg, -(rect.x + 14), 0, rect.z * 0.4);
      cyl(rk, 0x3d4a5c, 0, 0, 0, 3, 0.4, { seg: 6 });
      kit().put(rk, kit().G.capsule(), kit().toon(0xf5f3fb), { y: 6.5, sx: 2.6, sy: 4.2, sz: 2.6 });
      kit().put(rk, kit().G.cone(), kit().toon(0xff5a64), { y: 11.4, sx: 1.25, sy: 2.4, sz: 1.25 });
      for (let i = 0; i < 4; i++) { const f = kit().block(rk, 0xff5a64, Math.cos(i * PI / 2) * 1.4, 2.2, Math.sin(i * PI / 2) * 1.4, 0.15, 2.2, 1.2, 0.05); f.rotation.y = -i * PI / 2; }
      kit().disc(rk, 0x7fe0ff, 0, 8, 1.31, 0.45, { rx: 0 });
      const dome = kit().group(bg, rect.x + 13, 0, -rect.z * 0.5);
      cyl(dome, 0xe8e6f2, 0, 0, 0, 4.4, 0.4, { seg: 40 });
      kit().disc(dome, 0x7fd65a, 0, 0.41, 0, 4.1);
      kit().roundTree(dome, 0, 0, 0.7, [0x5cc84a, 0x8ae065], 0xff4b3a);
      const glassM = own(new THREE.MeshToonMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, depthWrite: false }));
      kit().put(dome, own(new THREE.SphereGeometry(4.3, 40, 20, 0, TAU, 0, PI / 2)), glassM, { y: 0.4, shadow: false });
      const flag = kit().group(bg, rect.x + 6, 0, rect.z + 6);
      cyl(flag, 0xd5d8e3, 0, 0, 0, 0.06, 3.4, { seg: 6 });
      picture(flag, signTex("Mii", "#ff6f91", "#ffffff"), 0.75, 3.0, 0, 1.4, 0.8);
    } else if (setting === "office") {
      // high up in a tower: the city all round, the street far below
      kit().put(bg, own(new THREE.PlaneGeometry(600, 600)), kit().toon(0x8b8f99), { rx: -PI / 2, y: -40, shadow: false });
      const walls = ["#dfe8f2", "#cfd9e6", "#e8e1d6", "#d6e6f0", "#f2e6da"];
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * TAU + r() * 0.06, d = rect.x + 24 + r() * 70;
        const h = 30 + r() * 80;
        const g = building(bg, Math.cos(a) * d, Math.sin(a) * d, 10 + r() * 10, 10 + r() * 10, h, walls[i % walls.length], -a + PI / 2);
        g.position.y = -40;
      }
      clouds(bg, 18, 130, 210, 30, 60, 13);
    }
    bg.traverse((o) => { if (o.isMesh) { o.castShadow = false; if (!o.material.isMeshBasicMaterial) o.receiveShadow = o.receiveShadow && false; } });
    return { update: (t) => { for (const f of anim) f(t); } };
  }

  // frees what was made here (shared kit materials/shapes stay: the hub uses them)
  function disposeOwned() {
    for (const o of owned.splice(0)) if (o && o.dispose) o.dispose();
    awningTex = crateTex = solarTex = rackTex = screenTex = bookTex = officeWallTex = null;
    for (const k of Object.keys(parasolTex)) delete parasolTex[k];
  }

  root.PBScenery = { pieces, perimeter, backdrop, cornerLamp, lowBar, officeWalls, disposeOwned, available: () => !!kit(), COL };
})(window);
