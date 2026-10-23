/*
 * rooms3d.js
 * The extra rooms you can buy for a Mii (homes.js: ROOMS): a kitchen, a bathroom
 * and a game room. Each is its own little place ("room", hidden from the place
 * list): hub3d.js shows it when you pick it with the room buttons while visiting.
 *
 * It also puts the wardrobe in the Mii's main room (homes3d.js calls decorateMain):
 * the more outfits the Mii owns, the bigger the wardrobe (see life.js).
 */
(function (root) {
  "use strict";
  if (!root.World3D || !root.World3D.kit) return; // (not in a browser, e.g. the tests)

  const K = root.World3D.kit;
  const { THREE, toon, glow, G, put, ball, cylinder, block, group, dynamic, canvasTexture, skyDome, addLights, mergeStatic } = K;
  const PI = Math.PI;
  const R = { x: 5, z: 4, h: 4.6 }; // half width, half depth, height

  // the finer touches from homes3d.js (surface pictures, little painted bits, soft shadows)
  const D = () => (root.MiiHomes3D && root.MiiHomes3D.detail) || null;
  const fine = (kind, c) => (D() ? D().fine(kind, c) : toon(c));
  const woody = (c) => fine("wood", c), shiny = (c) => fine("metal", c), padded = (c) => fine("cushion", c), cloth = (c) => fine("fabric", c);
  const bits = (g, build) => (D() ? D().bits(g, build) : null);

  const bx = (p, color, x, y, z, w, h, d, o) => put(p, G.box(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));

  // ---------- each room's look (walls and floor) ----------
  function tiles(base, line, size, accent) {
    return (ctx, w, h) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line; ctx.lineWidth = 3;
      for (let i = 0; i <= w; i += size) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
      if (accent) { ctx.fillStyle = accent; for (let y = 0; y < h; y += size * 2) for (let x = (y / size) % 4 ? size : 0; x < w; x += size * 2) ctx.fillRect(x + 3, y + 3, size - 6, size - 6); }
    };
  }
  const LOOKS = {
    kitchen: {
      wall: tiles("#fff8ec", "#e9dcc4", 64, null), wallLow: "#7fc8f0",
      floor: tiles("#ffffff", "#d0d0d8", 128, "#ff8a7a"), trim: 0xffffff,
    },
    bathroom: {
      wall: tiles("#dff4ff", "#b8dff2", 48, null), wallLow: "#4fb7e0",
      floor: tiles("#f4f8fb", "#c9d6e0", 64, "#cfe9f7"), trim: 0xffffff,
    },
    gameroom: {
      wall: (ctx, w, h) => { ctx.fillStyle = "#2d2a4a"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#ff4fd8"; ctx.fillRect(0, h * 0.62, w, 10); ctx.fillStyle = "#4fe3ff"; ctx.fillRect(0, h * 0.62 + 18, w, 6); for (let i = 0; i < 6; i++) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc((i * 97) % w, (i * 53) % (h * 0.5), 3, 0, 7); ctx.fill(); } },
      wallLow: "#3a3560",
      floor: (ctx, w, h) => { ctx.fillStyle = "#4a3f7a"; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { ctx.fillStyle = ["#ff4fd8", "#4fe3ff", "#ffe25a"][i % 3]; ctx.beginPath(); ctx.arc((i * 71) % w, (i * 113) % h, 5, 0, 7); ctx.fill(); } },
      trim: 0x4fe3ff,
    },
  };

  // ---------- furniture for the extra rooms ----------
  // Same rules as homes3d.js: built around (0, 0) facing +z.
  //   obs   obstacles (rect: cx, cz, w, d)   spot  where the Mii stands to use it
  //   seat  where it sits (h = seat height)
  const F = {
    // ===== kitchen =====
    "stove-basic": { obs: [{ cx: 0, cz: 0, w: 1.2, d: 0.9 }], spot: { lx: 0, lz: 1.0, yaw: PI }, build(g) {
      block(g, shiny(0xf4f4f4), 0, 0.5, 0, 1.1, 1.0, 0.8, 0.06);
      block(g, 0x30343f, 0, 1.02, 0, 1.05, 0.04, 0.75, 0.02);
      bits(g, (p) => {
        // knobs, an oven handle and window, and a tea towel
        for (let k = 0; k < 4; k++) D().bead(p, 0x30343f, -0.36 + k * 0.24, 0.88, 0.41, 0.04);
        D().slab(p, 0x9aa3b0, 0, 0.75, 0.44, 0.6, 0.04, 0.04);
        D().slab(p, 0x5a6070, 0, 0.45, 0.425, 0.5, 0.25, 0.01);
        D().slab(p, 0xff8a7a, 0.2, 0.62, 0.465, 0.22, 0.26, 0.01);
        for (let k = 0; k < 3; k++) D().slab(p, 0xffffff, 0.2, 0.52 + k * 0.08, 0.471, 0.22, 0.02, 0.005);
      });
      for (const [x, z] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]]) cylinder(g, 0x555a66, x, 1.05, z, 0.14, 0.02);
      block(g, 0x30343f, 0, 0.45, 0.41, 0.8, 0.5, 0.03, 0.03);
      cylinder(g, 0x9aa3b0, -0.25, 1.15, 0.18, 0.16, 0.18); // a pot
    } },
    "stove-range": { obs: [{ cx: 0, cz: 0, w: 1.9, d: 0.95 }], spot: { lx: 0, lz: 1.05, yaw: PI }, build(g) {
      block(g, shiny(0xb03a3a), 0, 0.52, 0, 1.8, 1.04, 0.85, 0.06);
      block(g, 0x2a2a30, 0, 1.06, 0, 1.75, 0.04, 0.8, 0.02);
      for (let i = 0; i < 6; i++) cylinder(g, 0x55606e, -0.6 + (i % 3) * 0.6, 1.09, i < 3 ? -0.2 : 0.2, 0.15, 0.02);
      for (const x of [-0.45, 0.45]) block(g, 0x2a2a30, x, 0.48, 0.44, 0.75, 0.55, 0.03, 0.03);
      for (let i = 0; i < 6; i++) ball(g, 0xd9a441, -0.75 + i * 0.3, 0.9, 0.45, 0.04);
      block(g, shiny(0x9aa3b0), 0, 2.6, -0.1, 1.6, 0.6, 0.7, 0.08); // hood
      bits(g, (p) => {
        // utensils hanging on a rail under the hood
        D().slab(p, 0x9aa3b0, 0, 2.15, -0.38, 1.2, 0.03, 0.03);
        for (let k = 0; k < 5; k++) { D().slab(p, 0x5a6070, -0.4 + k * 0.2, 1.95, -0.38, 0.03, 0.35, 0.02); D().bead(p, k % 2 ? 0xd9a441 : 0x5a6070, -0.4 + k * 0.2, 1.75, -0.38, 0.06, { sz: 0.3 }); }
      });
      cylinder(g, 0xd9a441, 0.6, 1.2, -0.2, 0.2, 0.25); // a copper pot
    } },
    "stove-grill": { obs: [{ cx: 0, cz: 0, w: 1.3, d: 0.9 }], spot: { lx: 0, lz: 1.0, yaw: PI }, build(g, ctx) {
      for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]]) cylinder(g, 0x2a2a30, x, 0.4, z, 0.04, 0.8);
      block(g, 0x2a2a30, 0, 0.9, 0, 1.2, 0.3, 0.75, 0.1);
      for (let i = 0; i < 7; i++) bx(g, 0x9aa3b0, -0.45 + i * 0.15, 1.06, 0, 0.03, 0.02, 0.65);
      ball(g, 0x8a4a2a, -0.2, 1.11, 0, 0.12, { sy: 0.4 });
      ball(g, 0xd96a4a, 0.25, 1.1, 0.1, 0.09, { sx: 1.6, sy: 0.4 });
      const fire = glow(0xff7a2a, 1);
      const flames = [-0.3, 0, 0.3].map((x) => dynamic(ball(g, fire, x, 0.96, 0, 0.06)));
      ctx.anim.push((t) => flames.forEach((f, i) => f.scale.setScalar(0.06 + Math.abs(Math.sin(t * 6 + i)) * 0.04)));
    } },
    "counter-basic": { obs: [{ cx: 0, cz: 0, w: 2.0, d: 0.8 }], spot: { lx: 0, lz: 0.95, yaw: PI }, build(g) {
      block(g, woody(0xe0a868), 0, 0.5, 0, 2.0, 1.0, 0.75, 0.05);
      block(g, 0xf4f4f4, 0, 1.03, 0, 2.05, 0.06, 0.8, 0.02);
      bits(g, (p) => {
        // door knobs, a dish rack with plates, a soap bottle and tiles behind
        for (const x of [-0.6, 0.0, 0.6]) D().bead(p, 0xffcf5a, x + 0.18, 0.7, 0.41, 0.035);
        for (let k = 0; k < 4; k++) D().slab(p, 0xffffff, -0.25 + k * 0.05, 1.17, 0.05, 0.015, 0.2, 0.2);
        D().slab(p, 0x9aa3b0, -0.18, 1.07, 0.05, 0.3, 0.02, 0.26);
        D().slab(p, 0x8fd3ff, 0.75, 1.14, -0.2, 0.08, 0.16, 0.08);
        for (let k = 0; k < 10; k++) for (let j = 0; j < 3; j++) D().slab(p, (k + j) % 2 ? 0xd8f0ff : 0xffffff, -0.9 + k * 0.2, 1.2 + j * 0.2, -0.375, 0.19, 0.19, 0.01);
      });
      block(g, 0xbfd8e8, 0.35, 1.0, 0, 0.6, 0.06, 0.45, 0.04); // sink
      cylinder(g, 0x9aa3b0, 0.35, 1.25, -0.28, 0.03, 0.45);
      bx(g, 0x9aa3b0, 0.35, 1.45, -0.15, 0.04, 0.04, 0.28);
      for (const x of [-0.6, 0.0, 0.6]) bx(g, woody(0xb57d4a), x, 0.5, 0.38, 0.5, 0.7, 0.02);
      block(g, woody(0xe0a868), 0, 2.6, -0.15, 2.0, 0.8, 0.45, 0.05); // cupboards
      ball(g, 0x6fcf6f, -0.6, 1.15, 0.0, 0.1); // an apple
    } },
    "counter-espresso": { obs: [{ cx: 0, cz: 0, w: 2.0, d: 0.8 }], spot: { lx: 0, lz: 0.95, yaw: PI }, build(g, ctx) {
      block(g, woody(0x3a2a24), 0, 0.5, 0, 2.0, 1.0, 0.75, 0.05);
      block(g, 0xe8e0d0, 0, 1.03, 0, 2.05, 0.06, 0.8, 0.02);
      block(g, shiny(0xb03a3a), -0.3, 1.4, -0.1, 0.7, 0.65, 0.5, 0.06); // the machine
      block(g, 0x9aa3b0, -0.3, 1.75, -0.1, 0.72, 0.06, 0.52, 0.02);
      for (const x of [-0.45, -0.15]) { cylinder(g, 0x2a2a30, x, 1.15, 0.12, 0.05, 0.12); cylinder(g, 0xffffff, x, 1.1, 0.2, 0.06, 0.08); }
      for (let i = 0; i < 3; i++) cylinder(g, [0x6f4a2a, 0xd9a441, 0x2a2a30][i], 0.5 + i * 0.22, 1.2, -0.15, 0.08, 0.3);
      const steam = dynamic(ball(g, toon(0xffffff, { transparent: true, opacity: 0.5 }), -0.3, 1.3, 0.25, 0.05));
      ctx.anim.push((t) => { const k = (t * 0.6) % 1; steam.position.y = 1.25 + k * 0.4; steam.material.opacity = 0.5 * (1 - k); });
    } },
    "counter-bakery": { obs: [{ cx: 0, cz: 0, w: 2.0, d: 0.8 }], spot: { lx: 0, lz: 0.95, yaw: PI }, build(g) {
      block(g, 0xffc8dc, 0, 0.5, 0, 2.0, 1.0, 0.75, 0.05);
      block(g, 0xffffff, 0, 1.03, 0, 2.05, 0.06, 0.8, 0.02);
      cylinder(g, 0xd9e2ea, -0.5, 1.18, 0, 0.25, 0.25); // mixing bowl
      ball(g, 0xfff3d0, -0.5, 1.3, 0, 0.2, { sy: 0.4 });
      for (let i = 0; i < 4; i++) { cylinder(g, 0xd9a441, 0.25 + (i % 2) * 0.25, 1.11, -0.1 + Math.floor(i / 2) * 0.25, 0.08, 0.1); ball(g, [0xff6fa5, 0x8fd3ff, 0xffe25a, 0xffffff][i], 0.25 + (i % 2) * 0.25, 1.2, -0.1 + Math.floor(i / 2) * 0.25, 0.08); }
      block(g, 0xf4f4f4, 0.7, 2.4, -0.2, 0.9, 0.9, 0.4, 0.06); // oven up on the wall
      block(g, 0x30343f, 0.7, 2.35, 0.01, 0.65, 0.5, 0.02, 0.03);
    } },
    "dining-basic": { obs: [{ cx: 0, cz: 0, w: 1.5, d: 1.0 }], spot: { lx: 0, lz: 1.05, yaw: PI }, seat: { lx: 0, lz: 0.75, h: 0.55 }, build(g) {
      block(g, woody(0xc98b4a), 0, 0.82, 0, 1.4, 0.08, 0.95, 0.04);
      for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) cylinder(g, woody(0xa86f3a), x, 0.4, z, 0.05, 0.8);
      for (const z of [-0.75, 0.75]) { block(g, padded(0xff8a7a), 0, 0.5, z, 0.5, 0.08, 0.45, 0.04); for (const x of [-0.2, 0.2]) cylinder(g, woody(0xa86f3a), x, 0.25, z, 0.03, 0.5); }
      bits(g, (p) => {
        // place mats with forks and spoons
        for (const z of [-0.28, 0.28]) {
          D().slab(p, 0xfff1dc, 0, 0.865, z, 0.4, 0.008, 0.28);
          for (const x of [-0.24, 0.24]) D().slab(p, 0xdfe4ea, x, 0.87, z, 0.03, 0.006, 0.2);
        }
      });
      cylinder(g, 0xffffff, 0, 0.88, 0, 0.18, 0.03); ball(g, 0xffcf5a, 0, 0.93, 0, 0.08, { sy: 0.5 });
    } },
    "dining-booth": { obs: [{ cx: 0, cz: -0.1, w: 1.8, d: 1.6 }], spot: { lx: 0.7, lz: 1.1, yaw: PI }, seat: { lx: 0.35, lz: 0.55, h: 0.55 }, build(g) {
      block(g, padded(0xd93636), 0, 0.45, 0.65, 1.7, 0.3, 0.55, 0.08); // seat
      block(g, padded(0xd93636), 0, 0.9, 0.95, 1.7, 0.9, 0.2, 0.08);
      block(g, padded(0xd93636), 0, 0.45, -0.85, 1.7, 0.3, 0.55, 0.08);
      block(g, padded(0xd93636), 0, 0.9, -1.15, 1.7, 0.9, 0.2, 0.08);
      block(g, 0xf4f4f4, 0, 0.85, -0.1, 1.5, 0.08, 0.8, 0.04);
      cylinder(g, 0x9aa3b0, 0, 0.42, -0.1, 0.06, 0.8);
      cylinder(g, 0xfff3f3, -0.4, 1.05, -0.1, 0.07, 0.3); ball(g, 0xff6fa5, -0.4, 1.22, -0.1, 0.07); // milkshake
      block(g, 0xffd23f, 0.3, 0.92, -0.1, 0.25, 0.06, 0.2, 0.02); // fries
    } },
    "dining-sushi": { obs: [{ cx: 0, cz: 0, w: 2.0, d: 0.9 }], spot: { lx: 0, lz: 1.0, yaw: PI }, seat: { lx: 0, lz: 0.75, h: 0.75 }, build(g) {
      block(g, 0xe8d3a8, 0, 0.95, 0, 2.0, 0.08, 0.7, 0.03);
      block(g, 0x8a5a3a, 0, 0.47, -0.05, 1.9, 0.94, 0.55, 0.04);
      bx(g, 0x5a3a2a, 0, 1.0, 0.0, 1.9, 0.03, 0.12); // the conveyor
      for (let i = 0; i < 6; i++) { cylinder(g, i % 2 ? 0x4f7fff : 0xffffff, -0.8 + i * 0.32, 1.04, 0.0, 0.09, 0.02); ball(g, i % 2 ? 0xff8a5a : 0xffffff, -0.8 + i * 0.32, 1.09, 0.0, 0.05, { sx: 1.4, sy: 0.6 }); }
      for (const x of [-0.6, 0, 0.6]) { cylinder(g, 0x8a5a3a, x, 0.37, 0.75, 0.04, 0.74); cylinder(g, 0xd93636, x, 0.75, 0.75, 0.2, 0.06); }
      for (let i = 0; i < 3; i++) put(g, G.circle(), toon(0xd93636, { side: THREE.DoubleSide }), { x: -0.7 + i * 0.7, y: 2.7, z: -0.3, s: 0.25, shadow: false }); // lanterns
    } },
    // ===== bathroom =====
    "bath-basic": { obs: [{ cx: 0, cz: 0, w: 1.0, d: 2.0 }], spot: { lx: 0.9, lz: 0.2, yaw: -PI / 2 }, seat: { lx: 0, lz: 0.2, h: 0.3, legs: "out" }, build(g) {
      block(g, 0xffffff, 0, 0.35, 0, 0.95, 0.7, 1.95, 0.2);
      block(g, 0x8fd3ff, 0, 0.6, 0, 0.75, 0.05, 1.75, 0.15);
      for (let i = 0; i < 6; i++) ball(g, 0xffffff, -0.2 + (i % 3) * 0.2, 0.66, -0.4 + Math.floor(i / 3) * 0.7, 0.1);
      cylinder(g, shiny(0x9aa3b0), 0, 0.95, -0.95, 0.03, 0.4);
      bits(g, (p) => {
        // claw feet, a tap, a rubber duck and a bath mat
        for (const [x, z] of [[-0.4, -0.85], [0.4, -0.85], [-0.4, 0.85], [0.4, 0.85]]) D().bead(p, 0xd9a441, x, 0.04, z, 0.07, { sy: 0.6 });
        D().slab(p, 0x9aa3b0, 0, 1.13, -0.85, 0.04, 0.04, 0.22);
        D().bead(p, 0xffd23f, 0.2, 0.72, 0.5, 0.08); D().bead(p, 0xffd23f, 0.2, 0.82, 0.55, 0.055); D().bead(p, 0xff9f43, 0.2, 0.81, 0.61, 0.025);
        D().slab(p, 0xff9ec7, 0.85, 0.01, 0.2, 0.6, 0.02, 0.9);
      });
    } },
    "bath-hottub": { obs: [{ cx: 0, cz: 0, w: 1.9, d: 1.9 }], spot: { lx: 1.15, lz: 0.0, yaw: -PI / 2 }, seat: { lx: 0.2, lz: 0.0, h: 0.3, legs: "out" }, build(g, ctx) {
      cylinder(g, 0x8a5a3a, 0, 0.35, 0, 0.95, 0.7, { seg: 32 });
      cylinder(g, 0x5fd0f0, 0, 0.62, 0, 0.82, 0.06, { seg: 32 });
      const bub = [];
      for (let i = 0; i < 8; i++) bub.push(dynamic(ball(g, toon(0xffffff, { transparent: true, opacity: 0.7 }), Math.cos(i) * 0.5, 0.66, Math.sin(i * 1.7) * 0.5, 0.06)));
      ctx.anim.push((t) => bub.forEach((b, i) => { const k = (t * 0.8 + i * 0.13) % 1; b.position.y = 0.64 + k * 0.15; b.material.opacity = 0.7 * (1 - k); }));
      for (let i = 0; i < 3; i++) ball(g, glow(0xffe08a, 0.6), Math.cos(i * 2.1) * 1.0, 0.75, Math.sin(i * 2.1) * 1.0, 0.07); // candles
    } },
    "bath-duck": { obs: [{ cx: 0, cz: 0, w: 1.0, d: 2.0 }], spot: { lx: 0.9, lz: 0.2, yaw: -PI / 2 }, seat: { lx: 0, lz: 0.2, h: 0.3, legs: "out" }, build(g) {
      block(g, 0xffe25a, 0, 0.35, 0, 0.95, 0.7, 1.95, 0.2);
      block(g, 0x8fd3ff, 0, 0.6, 0, 0.75, 0.05, 1.75, 0.15);
      for (let i = 0; i < 4; i++) { const x = -0.2 + (i % 2) * 0.4, z = -0.6 + i * 0.35; ball(g, 0xffd23f, x, 0.7, z, 0.1, { sy: 0.8 }); ball(g, 0xffd23f, x, 0.82, z + 0.06, 0.07); ball(g, 0xff9f43, x, 0.81, z + 0.13, 0.03); }
      ball(g, 0xffd23f, 0, 0.6, -1.0, 0.35, { sy: 0.9 }); // a giant duck at the end
      ball(g, 0xffd23f, 0, 1.05, -0.95, 0.22);
      ball(g, 0xff9f43, 0, 1.03, -0.72, 0.08, { sz: 1.4 });
    } },
    "vanity-basic": { obs: [{ cx: 0, cz: 0, w: 1.2, d: 0.7 }], spot: { lx: 0, lz: 0.85, yaw: PI }, build(g) {
      block(g, woody(0xffffff), 0, 0.45, 0, 1.1, 0.9, 0.6, 0.06);
      block(g, 0xdff4ff, 0, 0.93, 0.02, 0.6, 0.06, 0.4, 0.06);
      bits(g, (p) => {
        // cupboard doors with knobs, a soap and a toothbrush
        for (const x of [-0.27, 0.27]) { D().slab(p, 0xeef4f8, x, 0.45, 0.305, 0.48, 0.7, 0.01); D().bead(p, 0x9aa3b0, x - Math.sign(x) * 0.18, 0.55, 0.32, 0.03); }
        D().slab(p, 0xff9ec7, -0.4, 0.94, 0.1, 0.12, 0.05, 0.08);
        D().slab(p, 0x4a90e2, 0.4, 1.12, 0.1, 0.02, 0.22, 0.02);
      });
      cylinder(g, 0x9aa3b0, 0, 1.1, -0.2, 0.03, 0.3);
      block(g, shiny(0xbfe6ff), 0, 1.9, -0.27, 0.9, 1.0, 0.04, 0.06);
      block(g, 0xffffff, 0, 1.9, -0.29, 1.0, 1.1, 0.03, 0.06);
      cylinder(g, 0x6fcf6f, 0.4, 1.02, 0.1, 0.05, 0.14); // toothbrush cup
    } },
    "vanity-star": { obs: [{ cx: 0, cz: 0, w: 1.4, d: 0.7 }], spot: { lx: 0, lz: 0.85, yaw: PI }, build(g, ctx) {
      block(g, 0x2a2438, 0, 0.45, 0, 1.3, 0.9, 0.6, 0.06);
      block(g, 0xf2c94c, 0, 0.93, 0.02, 0.7, 0.06, 0.4, 0.06);
      block(g, 0xbfe6ff, 0, 1.95, -0.27, 1.1, 1.2, 0.04, 0.06);
      const bulbs = [];
      for (let i = 0; i < 12; i++) {
        const a = i / 12;
        const x = i < 4 ? -0.65 : i < 8 ? 0.65 : -0.45 + (i - 8) * 0.3;
        const y = i < 8 ? 1.45 + (i % 4) * 0.33 : 2.65;
        bulbs.push(dynamic(ball(g, glow(0xfff1b0, 0.9), x, y, -0.22, 0.06)));
        void a;
      }
      ctx.anim.push((t) => bulbs.forEach((b, i) => { b.material.emissiveIntensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i)); }));
    } },
    "vanity-shell": { obs: [{ cx: 0, cz: 0, w: 1.2, d: 0.7 }], spot: { lx: 0, lz: 0.85, yaw: PI }, build(g) {
      block(g, 0xbfe6dd, 0, 0.45, 0, 1.1, 0.9, 0.6, 0.1);
      ball(g, 0xffd8e0, 0, 0.98, 0.02, 0.38, { sy: 0.25, sz: 0.7 });
      for (let i = 0; i < 5; i++) bx(g, 0xffb8c8, -0.24 + i * 0.12, 1.0, 0.02, 0.03, 0.06, 0.45);
      ball(g, 0xbfe6ff, 0, 1.95, -0.27, 0.55, { sz: 0.05 });
      for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; ball(g, 0xffd8e0, Math.cos(a) * 0.58, 1.95 + Math.sin(a) * 0.58, -0.25, 0.07); }
    } },
    "bathdecor-plants": { obs: [{ cx: 0, cz: 0, w: 1.0, d: 0.5 }], spot: { lx: 0, lz: 0.8, yaw: PI }, build(g) {
      for (const y of [0.6, 1.3, 2.0]) bx(g, 0xe0a868, 0, y, 0, 0.95, 0.05, 0.4);
      for (const x of [-0.45, 0.45]) bx(g, 0xb57d4a, x, 1.05, -0.15, 0.04, 2.1, 0.04);
      for (const [x, y] of [[-0.25, 0.6], [0.25, 1.3], [-0.2, 2.0], [0.3, 0.6]]) { cylinder(g, 0xe0784a, x, y + 0.1, 0, 0.1, 0.18); ball(g, 0x4caf50, x, y + 0.32, 0, 0.18, { sy: 0.8 }); }
    } },
    "bathdecor-towels": { obs: [{ cx: 0, cz: 0, w: 1.0, d: 0.5 }], spot: { lx: 0, lz: 0.8, yaw: PI }, build(g) {
      block(g, 0xffffff, 0, 0.5, 0, 0.9, 1.0, 0.45, 0.05);
      for (let i = 0; i < 4; i++) block(g, cloth([0xff9ec7, 0x8fd3ff, 0xffe25a, 0xb8f0c0][i]), (i % 2 ? 0.2 : -0.2), 1.1 + Math.floor(i / 2) * 0.16, 0, 0.36, 0.14, 0.32, 0.05);
      cylinder(g, 0x9aa3b0, 0, 1.9, 0.05, 0.03, 0.9, { rz: PI / 2 });
      block(g, 0xff9ec7, 0, 1.6, 0.08, 0.6, 0.6, 0.04, 0.02);
    } },
    // ===== game room =====
    "gametable-basic": { obs: [{ cx: 0, cz: 0, w: 1.3, d: 1.3 }], spot: { lx: 0, lz: 0.95, yaw: PI }, seat: { lx: 0, lz: 0.85, h: 0.5 }, build(g) {
      cylinder(g, cloth(0x2e7d4f), 0, 0.8, 0, 0.6, 0.06, { seg: 32 });
      cylinder(g, woody(0x8a5a3a), 0, 0.4, 0, 0.08, 0.8);
      bits(g, (p) => {
        // a wooden rim, a foot, and stacks of poker chips
        cylinder(p, 0x8a5a3a, 0, 0.8, 0, 0.64, 0.05);
        cylinder(p, 0x8a5a3a, 0, 0.03, 0, 0.35, 0.06);
        for (const [x, z, col] of [[0.3, -0.25, 0xd93636], [0.38, -0.12, 0x2f6fe0], [-0.32, 0.2, 0x1d1d24]]) for (let k = 0; k < 4; k++) cylinder(p, k % 2 ? 0xffffff : col, x, 0.84 + k * 0.018, z, 0.045, 0.016);
      });
      for (let i = 0; i < 5; i++) bx(g, 0xffffff, -0.2 + i * 0.1, 0.84, 0.05 * (i % 2), 0.08, 0.005, 0.12, { ry: i * 0.3 });
      for (const [x, z] of [[0, 0.85], [0, -0.85]]) { cylinder(g, 0xd93636, x, 0.48, z, 0.22, 0.06); cylinder(g, 0x2a2438, x, 0.24, z, 0.04, 0.48); }
    } },
    "gametable-pool": { obs: [{ cx: 0, cz: 0, w: 1.4, d: 2.5 }], spot: { lx: 0.95, lz: 0.6, yaw: -PI / 2 }, build(g) {
      block(g, woody(0x6b3a1a), 0, 0.78, 0, 1.3, 0.16, 2.4, 0.06);
      bx(g, cloth(0x2e8b57), 0, 0.87, 0, 1.1, 0.02, 2.2);
      for (const [x, z] of [[-0.55, -1.1], [0.55, -1.1], [-0.55, 1.1], [0.55, 1.1]]) cylinder(g, 0x4a2a10, x, 0.38, z, 0.08, 0.76);
      const cols = [0xffd23f, 0x2f6fe0, 0xd93636, 0x8a3ab9, 0xff9f43, 0x2e8b57, 0x6b1a1a, 0x1d1d24];
      for (let i = 0; i < 8; i++) ball(g, cols[i], -0.16 + (i % 3) * 0.12 + Math.floor(i / 3) * 0.06, 0.92, -0.6 - Math.floor(i / 3) * 0.1, 0.045);
      ball(g, 0xffffff, 0, 0.92, 0.6, 0.045);
      cylinder(g, 0xd9b48a, 0.4, 0.95, 0.9, 0.02, 1.4, { rx: PI / 2 - 0.08, ry: 0.4 });
    } },
    "gametable-hockey": { obs: [{ cx: 0, cz: 0, w: 1.2, d: 2.1 }], spot: { lx: 0, lz: 1.35, yaw: PI }, build(g, ctx) {
      block(g, 0x2f6fe0, 0, 0.45, 0, 1.15, 0.9, 2.0, 0.06);
      bx(g, 0xf4f8ff, 0, 0.91, 0, 1.0, 0.02, 1.85);
      bx(g, 0xd93636, 0, 0.92, 0, 1.0, 0.005, 0.03);
      const puck = dynamic(cylinder(g, 0x1d1d24, 0, 0.94, 0, 0.06, 0.02));
      for (const z of [-0.75, 0.75]) cylinder(g, 0xd93636, 0, 0.96, z, 0.09, 0.06);
      ctx.anim.push((t) => { puck.position.x = Math.sin(t * 2.3) * 0.4; puck.position.z = Math.sin(t * 1.7) * 0.75; });
    } },
    "arcade-pinball": { obs: [{ cx: 0, cz: 0, w: 0.9, d: 1.6 }], spot: { lx: 0, lz: 1.1, yaw: PI }, build(g, ctx) {
      block(g, 0x8a3ab9, 0, 0.9, 0, 0.8, 0.25, 1.5, 0.05, { rx: -0.12 });
      for (const [x, z] of [[-0.35, -0.65], [0.35, -0.65], [-0.35, 0.65], [0.35, 0.65]]) cylinder(g, 0x2a2438, x, 0.4, z, 0.04, 0.8);
      block(g, 0x2a2438, 0, 1.55, -0.7, 0.8, 0.9, 0.12, 0.04);
      const lights = [];
      for (let i = 0; i < 4; i++) lights.push(dynamic(ball(g, glow([0xff4fd8, 0x4fe3ff, 0xffe25a, 0x6fcf6f][i], 1), -0.25 + i * 0.17, 1.6, -0.63, 0.06)));
      ctx.anim.push((t) => lights.forEach((l, i) => { l.material.emissiveIntensity = (Math.floor(t * 4) + i) % 4 === 0 ? 1.2 : 0.2; }));
      ball(g, 0xdddddd, 0.1, 1.08, 0.1, 0.04);
    } },
    "arcade-dance": { obs: [{ cx: 0, cz: -0.4, w: 1.5, d: 1.0 }], spot: { lx: 0, lz: 0.5, yaw: PI }, build(g, ctx) {
      block(g, 0x1d1d24, 0, 1.2, -0.6, 1.4, 2.4, 0.5, 0.06);
      const scr = dynamic(put(g, G.box(), glow(0x4fe3ff, 0.8), { y: 1.7, z: -0.34, sx: 1.0, sy: 0.7, sz: 0.02, shadow: false }));
      ctx.anim.push((t) => scr.material.emissive.setHSL((t * 0.2) % 1, 0.8, 0.5));
      block(g, 0x9aa3b0, 0, 0.06, 0.5, 1.4, 0.12, 1.2, 0.04); // the dance pad
      const arrows = [];
      for (const [x, z] of [[-0.35, 0.5], [0.35, 0.5], [0, 0.15], [0, 0.85]]) arrows.push(dynamic(put(g, G.box(), glow(0xff4fd8, 0.4), { x, y: 0.13, z, sx: 0.3, sy: 0.02, sz: 0.3, shadow: false })));
      ctx.anim.push((t) => arrows.forEach((a, i) => { a.material.emissiveIntensity = Math.floor(t * 3) % 4 === i ? 1.3 : 0.2; }));
    } },
    "arcade-claw": { obs: [{ cx: 0, cz: 0, w: 1.1, d: 1.1 }], spot: { lx: 0, lz: 0.95, yaw: PI }, build(g, ctx) {
      block(g, 0xff6fa5, 0, 0.45, 0, 1.0, 0.9, 1.0, 0.06);
      put(g, G.box(), toon(0xbfe6ff, { transparent: true, opacity: 0.35 }), { y: 1.45, sx: 0.95, sy: 1.1, sz: 0.95, shadow: false });
      block(g, 0xff6fa5, 0, 2.05, 0, 1.0, 0.15, 1.0, 0.04);
      for (let i = 0; i < 7; i++) ball(g, [0xffd23f, 0x8fd3ff, 0xb8f0c0, 0xffffff, 0xc89fff][i % 5], -0.3 + (i % 4) * 0.2, 1.0, -0.25 + Math.floor(i / 4) * 0.3, 0.12);
      const claw = dynamic(group(g, 0, 1.75, 0));
      cylinder(claw, 0x9aa3b0, 0, 0.12, 0, 0.015, 0.25);
      for (let i = 0; i < 3; i++) put(claw, G.box(), toon(0x9aa3b0), { x: Math.cos(i * 2.1) * 0.06, y: -0.05, z: Math.sin(i * 2.1) * 0.06, sx: 0.02, sy: 0.15, sz: 0.02, rz: 0.3 });
      ctx.anim.push((t) => { claw.position.x = Math.sin(t * 0.7) * 0.3; claw.position.z = Math.cos(t * 0.5) * 0.25; });
    } },
    "music-jukebox": { obs: [{ cx: 0, cz: 0, w: 1.0, d: 0.7 }], spot: { lx: 0, lz: 0.85, yaw: PI }, build(g, ctx) {
      block(g, woody(0x8a3a2a), 0, 0.8, 0, 0.95, 1.6, 0.6, 0.12);
      ball(g, woody(0x8a3a2a), 0, 1.6, 0, 0.47, { sz: 0.63 });
      const arch = dynamic(put(g, new THREE.TorusGeometry(0.38, 0.05, 8, 24, PI), glow(0xff9f43, 0.9), { y: 1.55, z: 0.3, shadow: false }));
      ctx.anim.push((t) => arch.material.emissive.setHSL((t * 0.15) % 1, 0.9, 0.55));
      block(g, 0xfff1b0, 0, 1.15, 0.3, 0.6, 0.3, 0.02, 0.03);
      for (let i = 0; i < 5; i++) bx(g, 0xd9a441, -0.24 + i * 0.12, 0.6, 0.31, 0.06, 0.4, 0.01);
    } },
    "music-dj": { obs: [{ cx: 0, cz: 0, w: 1.6, d: 0.8 }], spot: { lx: 0, lz: 0.9, yaw: PI }, build(g, ctx) {
      block(g, 0x1d1d24, 0, 0.5, 0, 1.6, 1.0, 0.7, 0.05);
      const decks = [-0.45, 0.45].map((x) => { cylinder(g, 0x9aa3b0, x, 1.02, 0, 0.27, 0.04); return dynamic(cylinder(g, 0x1d1d24, x, 1.05, 0, 0.24, 0.02)); });
      for (const d of decks) ball(d, 0xff4fd8, 0.15, 0.6, 0, 0.12); // (the dot spins with the record)
      ctx.anim.push((t) => decks.forEach((d, i) => { d.rotation.y = t * (3 + i); }));
      block(g, 0x2a2438, 0, 1.04, 0.15, 0.3, 0.05, 0.3, 0.02);
      for (const x of [-0.75, 0.75]) block(g, 0x2a2a30, x * 1.25, 0.6, -0.2, 0.5, 1.2, 0.5, 0.05);
      const leds = [];
      for (let i = 0; i < 6; i++) leds.push(dynamic(ball(g, glow(0x4fe3ff, 0.8), -0.5 + i * 0.2, 0.75, 0.36, 0.04)));
      ctx.anim.push((t) => leds.forEach((l, i) => { l.visible = Math.sin(t * 8 + i) > -0.2; }));
    } },
  };

  // Where each slot goes (and which way it faces).
  const PLACES = {
    stove: { x: -2.8, z: -3.4, ry: 0 }, counter: { x: 1.4, z: -3.45, ry: 0 }, dining: { x: 0.4, z: 0.9, ry: 0 },
    bath: { x: -3.85, z: -1.8, ry: 0 }, vanity: { x: 1.0, z: -3.6, ry: 0 }, bathdecor: { x: 4.6, z: -1.8, ry: -PI / 2 },
    gametable: { x: -0.6, z: 0.6, ry: 0 }, arcade: { x: 3.0, z: -3.3, ry: 0 }, music: { x: -3.2, z: -3.4, ry: 0 },
  };
  const toWorld = (p, lx, lz) => { const c = Math.cos(p.ry), s = Math.sin(p.ry); return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c }; };

  function buildRoom(opts) {
    return D() ? D().build(() => buildRoomInside(opts)) : buildRoomInside(opts);
  }
  function buildRoomInside(opts) {
    const H = root.MiiHomes;
    const record = (opts && opts.record) || { name: "Mii", home: { items: {}, rooms: [] } };
    const roomId = opts && opts.room && H.room(opts.room) ? opts.room : "kitchen";
    const look = LOOKS[roomId];
    const ctx = { anim: [], record };
    const rootG = new THREE.Group();
    addLights(rootG, { sky: 0xfff6e8, ground: 0xd9c7a8, hemi: 0.55, sun: 0.6, ambient: 0.28, fill: 0.32 });
    skyDome(rootG, 0x4fb0f2, 0xd6f0ff, 0x9fd47f);

    // floor and walls (a dollhouse: the walls between you and the room hide)
    const floorTex = canvasTexture(256, 256, look.floor, [R.x / 1.5, R.z / 1.5]);
    put(rootG, new THREE.PlaneGeometry(R.x * 2, R.z * 2), toon(0xffffff, { map: floorTex }), { y: 0.005, rx: -PI / 2, shadow: false });
    bx(rootG, 0xe8dcc8, 0, -0.15, 0, R.x * 2 + 0.6, 0.3, R.z * 2 + 0.6);
    const walls = [];
    function wall(px, pz, ry, len, axis, at, outside, door) {
      const outer = group(rootG);
      const g = group(outer, px, 0, pz, ry);
      const tex = canvasTexture(256, 256, look.wall, [len / 2, R.h / 2]);
      put(g, new THREE.PlaneGeometry(len, R.h), toon(0xffffff, { map: tex }), { y: R.h / 2, z: 0.005, shadow: false });
      bx(g, look.wallLow, 0, 0.6, 0.02, len, 1.2, 0.02, { shadow: false });
      put(g, G.box(), toon(0xf6efe4), { y: R.h / 2, z: -0.16, sx: len + 0.6, sy: R.h, sz: 0.3, shadow: false });
      bx(g, look.trim, 0, R.h - 0.08, 0.04, len, 0.14, 0.06, { shadow: false });
      bx(g, look.trim, 0, 0.12, 0.04, len, 0.24, 0.06, { shadow: false });
      if (door) {
        block(g, 0x9a6a3c, door, 1.25, 0.06, 1.25, 2.5, 0.1, 0.04);
        ball(g, 0xffcf5a, door - 0.45, 1.2, 0.14, 0.07);
        block(g, look.trim, door, 2.56, 0.06, 1.5, 0.12, 0.12, 0.02);
      }
      if (D()) D().paintRoom(outer);
      mergeStatic(outer);
      dynamic(outer);
      walls.push({ group: outer, axis, at, outside });
      return g;
    }
    wall(0, -R.z, 0, R.x * 2, "z", -R.z, -1);
    wall(0, R.z, PI, R.x * 2, "z", R.z, 1);
    wall(-R.x, 0, PI / 2, R.z * 2, "x", -R.x, -1);
    wall(R.x, 0, -PI / 2, R.z * 2, "x", R.x, 1, 2.4); // the door back to the main room
    // a little window on the back wall
    {
      const g = group(rootG, roomId === "bathroom" ? -1.6 : roomId === "gameroom" ? 0.2 : -0.6, 2.9, -R.z + 0.02);
      put(g, G.box(), toon(0x9fd8ff), { sx: 1.3, sy: 0.9, sz: 0.02, shadow: false });
      for (const [w, h, x, y] of [[1.45, 0.1, 0, 0.5], [1.45, 0.1, 0, -0.5], [0.1, 1.0, 0.68, 0], [0.1, 1.0, -0.68, 0], [0.06, 0.9, 0, 0]]) bx(g, look.trim, x, y, 0.03, w, h, 0.05, { shadow: false });
    }
    // a rug or mat in the middle
    if (roomId === "bathroom") block(rootG, 0x8fd3ff, 0.4, 0.02, 0.6, 1.6, 0.04, 1.0, 0.02, { shadow: false });
    if (roomId === "gameroom") cylinder(rootG, 0xff4fd8, -0.6, 0.015, 0.6, 2.2, 0.02, { shadow: false });
    if (roomId === "kitchen") { block(rootG, 0xe0a868, -4.6, 0.5, 1.2, 0.7, 1.0, 1.6, 0.05); cylinder(rootG, 0x6fcf6f, -4.6, 1.15, 1.6, 0.18, 0.3); ball(rootG, 0x4caf50, -4.6, 1.45, 1.6, 0.28); }

    // ---------- the furniture ----------
    const obstacles = [];
    const spots = [];
    const slots = H.slotsOfRoom(roomId);
    for (const s of slots) {
      const id = (record.home && record.home.items && record.home.items[s.id]) || (H.itemsFor(s.id).find((it) => it.starter) || {}).id;
      const it = H.item(id);
      const def = it && F[it.id];
      if (!def) continue;
      const place = PLACES[s.id];
      const g = group(rootG, place.x, 0, place.z, place.ry);
      def.build(g, ctx);
      for (const o of def.obs || []) { const p = toWorld(place, o.cx, o.cz); obstacles.push({ x: p.x, z: p.z, w: o.w, d: o.d, rot: -place.ry, item: it.id }); }
      if (!it.use || !def.spot) continue;
      const at = toWorld(place, def.spot.lx, def.spot.lz);
      const u = it.use;
      const spot = { x: at.x, z: at.z, yaw: place.ry + def.spot.yaw, emoji: u.emoji, activity: u.activity, lines: u.lines.slice(), itemId: it.id, slot: s.id };
      if (u.arms) spot.arms = u.arms;
      if (def.seat) {
        const st = toWorld(place, def.seat.lx, def.seat.lz);
        spot.seat = { x: st.x, z: st.z, y: def.seat.h - 0.56, legs: def.seat.legs };
        spot.yaw = place.ry + (def.seat.lz < 0 ? PI : 0);
        delete spot.arms;
        if (u.arms === "eat") spot.arms = "eat";
      }
      spots.push(spot);
    }
    for (const w of [[0, -R.z - 0.25, R.x * 2 + 1, 0.5], [0, R.z + 0.25, R.x * 2 + 1, 0.5], [-R.x - 0.25, 0, 0.5, R.z * 2 + 1], [R.x + 0.25, 0, 0.5, R.z * 2 + 1]]) obstacles.push({ x: w[0], z: w[1], w: w[2], d: w[3] });
    if (roomId === "kitchen") obstacles.push({ x: -4.6, z: 1.2, w: 0.8, d: 1.7 });
    const d = D();
    if (d) {
      // soft shadows under everything standing on the floor, daylight under the window
      for (const o of obstacles) {
        if (Math.abs(o.x) > R.x || Math.abs(o.z) > R.z) continue; // (not the walls)
        d.shadeRect(rootG, o.w + 0.05, o.d + 0.05, { x: o.x, y: 0.02, z: o.z, ry: -(o.rot || 0) }, 0.4, 0.35);
      }
      const wx = roomId === "bathroom" ? -1.6 : roomId === "gameroom" ? 0.2 : -0.6;
      d.lightRect(rootG, 1.4, 1.4, { x: wx, y: 0.022, z: -R.z + 1.0 }, 0.12, [1, 0.96, 0.82], 0.5);
      d.paintMovers(rootG);
      d.paintRoom(rootG);
    }
    mergeStatic(rootG);

    const r = H.room(roomId);
    return {
      group: rootG,
      background: 0xd6f0ff,
      fog: [0xd8f0ff, 45, 160],
      cameraTilt: 0.85,
      cameraTargetY: 1.7,
      isHome: true,
      roomId,
      bounds: { minX: -R.x, maxX: R.x, minZ: -R.z, maxZ: R.z },
      water: [],
      obstacles,
      spots,
      playerSpot: { x: 1.5, z: 2.6 },
      lines: [r.icon + " I love my new " + r.name.toLowerCase() + "!", "So roomy!", "Welcome to my " + r.name.toLowerCase() + "!", "La la la~"],
      update(t, camera) {
        ctx.anim.forEach((a) => a(t));
        if (camera) for (const w of walls) {
          const c = w.axis === "z" ? camera.position.z : camera.position.x;
          w.group.visible = (c - w.at) * w.outside < 0;
        }
      },
    };
  }

  // ---------- the wardrobe in the main room ----------
  // (homes3d.js calls this while it builds a Mii's main room)
  // against the back wall, between the window and the back-right corner (it grows wider and taller)
  const WARDROBE_AT = { x: 2.15, z: -4.5 };
  function decorateMain(o) {
    const Lf = root.MiiLife, LM = root.MiiLifeModels;
    if (!Lf || !LM || !o.record || !o.record.id) return;
    const level = Lf.wardrobeLevel(o.record);
    const owned = (o.record.wardrobe && o.record.wardrobe.owned) || [];
    const colors = owned.map((id) => Lf.outfit(id)).filter(Boolean).map((f) => parseInt(f.shirt.slice(1), 16));
    const S = LM.WARDROBE_SIZES[level];
    const p = { x: WARDROBE_AT.x, z: WARDROBE_AT.z + S.d / 2 + 0.05 };
    const g = group(o.group, p.x, 0, p.z, 0);
    g.name = "wardrobe";
    LM.wardrobe(g, level, K, colors);
    o.obstacles.push({ x: p.x, z: p.z, w: S.w + 0.1, d: S.d + 0.1 });
    o.spots.push({
      x: p.x - 0.3, z: p.z + S.d / 2 + 0.7, yaw: PI, emoji: "👕", activity: "picking an outfit", slot: "wardrobe", arms: "type",
      lines: owned.length ? ["What should I wear today?", "So many clothes!", "This one, or that one?", "My closet is my happy place."] : ["My wardrobe is a bit empty...", "I need some new clothes!", "Hmm, nothing to wear..."],
    });
  }

  root.World3D.addPlace({ id: "room", name: "Room", icon: "🚪" }, buildRoom, true);
  root.MiiRooms3D = { FURNITURE: F, PLACES, decorateMain, WARDROBE_AT, R };
})(typeof self !== "undefined" ? self : this);
