/*
 * lifeModels.js
 * Little 3D things for life.js:
 *   - outfit extras a Mii wears (hats, glasses, a backpack...), stuck to its head or chest
 *   - instruments a Mii holds on the concert stage (guitar, bass, microphone)
 *   - the wardrobe in a Mii's room, which gets bigger as it owns more clothes
 *
 * Sizes are in a Mii's own space (1.8 tall before it's scaled): its head pivots at
 * about y = 0.92, the face is y 0.92..1.46 (front at z = 0.28) and the hair reaches y = 1.68.
 */
(function (root) {
  "use strict";
  const THREE = root.THREE;
  if (!THREE) return; // (not in a browser, e.g. the tests)
  const PI = Math.PI;

  // own materials (not the shared scenery ones: a Mii's materials are thrown away with it)
  const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o || {}));
  const geos = new Map();
  const geo = (key, make) => { if (!geos.has(key)) geos.set(key, make()); return geos.get(key); };
  const SPH = () => geo("sph", () => new THREE.SphereGeometry(1, 20, 14));
  const HEMI = () => geo("hemi", () => new THREE.SphereGeometry(1, 22, 12, 0, PI * 2, 0, PI / 2));
  const CYL = () => geo("cyl", () => new THREE.CylinderGeometry(1, 1, 1, 24));
  const CONE = () => geo("cone", () => new THREE.ConeGeometry(1, 1, 18));
  const BOX = () => geo("box", () => new THREE.BoxGeometry(1, 1, 1));
  const TOR = (r, t) => geo("tor" + r + t, () => new THREE.TorusGeometry(r, t, 10, 32));
  function mesh(p, g, m, o) {
    const x = new THREE.Mesh(g, m);
    o = o || {};
    x.position.set(o.x || 0, o.y || 0, o.z || 0);
    x.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    const s = o.s || 1;
    x.scale.set((o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s);
    x.castShadow = true;
    p.add(x);
    return x;
  }

  // ---------------------------------------------------------------------
  // outfit extras: each builds into g (head ones around the head, body ones around the chest)
  // ---------------------------------------------------------------------
  const HEAD_TOP = 1.6;
  const EXTRAS = {
    cap: { on: "head", build(g) {
      const c = mat(0xff4757);
      mesh(g, HEMI(), c, { y: HEAD_TOP - 0.1, z: -0.02, sx: 0.34, sy: 0.24, sz: 0.37 });
      mesh(g, CYL(), c, { y: HEAD_TOP - 0.09, z: 0.3, sx: 0.22, sy: 0.02, sz: 0.16 });
      mesh(g, SPH(), mat(0xffffff), { y: HEAD_TOP + 0.14, z: -0.02, s: 0.035 });
    } },
    visor: { on: "head", build(g) {
      const c = mat(0xffffff);
      mesh(g, TOR(0.31, 0.03), c, { y: HEAD_TOP - 0.12, rx: PI / 2, sy: 1.15 });
      mesh(g, CYL(), mat(0xffd23f), { y: HEAD_TOP - 0.11, z: 0.33, sx: 0.2, sy: 0.02, sz: 0.14 });
    } },
    beanie: { on: "head", build(g) {
      const c = mat(0x5a8ad9);
      mesh(g, HEMI(), c, { y: HEAD_TOP - 0.14, z: -0.02, sx: 0.35, sy: 0.32, sz: 0.38 });
      mesh(g, TOR(0.33, 0.05), mat(0x3d6bb8), { y: HEAD_TOP - 0.13, z: -0.02, rx: PI / 2, sy: 1.12 });
      mesh(g, SPH(), mat(0xffffff), { y: HEAD_TOP + 0.2, z: -0.02, s: 0.08 });
    } },
    tophat: { on: "head", build(g) {
      const c = mat(0x1d1d24);
      mesh(g, CYL(), c, { y: HEAD_TOP - 0.03, sx: 0.4, sy: 0.03, sz: 0.4 });
      mesh(g, CYL(), c, { y: HEAD_TOP + 0.2, sx: 0.23, sy: 0.44, sz: 0.23 });
      mesh(g, CYL(), mat(0xd93636), { y: HEAD_TOP + 0.04, sx: 0.235, sy: 0.07, sz: 0.235 });
    } },
    crown: { on: "head", build(g) {
      const gold = mat(0xf2c94c, { metalness: 0.6, roughness: 0.3 });
      mesh(g, new THREE.CylinderGeometry(0.2, 0.18, 0.13, 24, 1, true), gold, { y: HEAD_TOP + 0.03 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        mesh(g, CONE(), gold, { x: Math.sin(a) * 0.19, y: HEAD_TOP + 0.14, z: Math.cos(a) * 0.19, sx: 0.045, sy: 0.12, sz: 0.045 });
        mesh(g, SPH(), mat(i % 2 ? 0xff4f8a : 0x4fc3ff), { x: Math.sin(a) * 0.2, y: HEAD_TOP + 0.02, z: Math.cos(a) * 0.2, s: 0.025 });
      }
    } },
    bow: { on: "head", build(g) {
      const c = mat(0xff4f8a);
      for (const s of [-1, 1]) mesh(g, CONE(), c, { x: 0.16 + s * 0.09, y: HEAD_TOP - 0.02, z: 0.02, rz: s * PI / 2, sx: 0.07, sy: 0.16, sz: 0.04 });
      mesh(g, SPH(), c, { x: 0.16, y: HEAD_TOP - 0.02, z: 0.02, s: 0.045 });
    } },
    sunhat: { on: "head", build(g) {
      const straw = mat(0xf3d9a0);
      mesh(g, CYL(), straw, { y: HEAD_TOP - 0.08, sx: 0.58, sy: 0.02, sz: 0.58 });
      mesh(g, HEMI(), straw, { y: HEAD_TOP - 0.08, z: -0.02, sx: 0.32, sy: 0.24, sz: 0.34 });
      mesh(g, CYL(), mat(0xff6fa5), { y: HEAD_TOP - 0.03, z: -0.02, sx: 0.325, sy: 0.06, sz: 0.345 });
    } },
    cowboy: { on: "head", build(g) {
      const c = mat(0x8a5a2c);
      const brim = mesh(g, TOR(0.36, 0.07), c, { y: HEAD_TOP - 0.06, rx: PI / 2, sz: 0.5 });
      brim.scale.set(1.1, 1.0, 0.5);
      mesh(g, CYL(), c, { y: HEAD_TOP - 0.06, sx: 0.4, sy: 0.02, sz: 0.36 });
      mesh(g, new THREE.CylinderGeometry(0.2, 0.25, 0.3, 20), c, { y: HEAD_TOP + 0.1 });
      mesh(g, CYL(), mat(0x3a2a1a), { y: HEAD_TOP + 0.0, sx: 0.252, sy: 0.05, sz: 0.252 });
    } },
    headband: { on: "head", build(g) {
      mesh(g, TOR(0.305, 0.04), mat(0xffffff), { y: 1.42, z: 0.0, rx: PI / 2, sy: 1.12 });
    } },
    nightcap: { on: "head", build(g) {
      const c = mat(0x7fa8ff);
      mesh(g, CONE(), c, { x: -0.05, y: HEAD_TOP + 0.15, z: -0.06, rz: 0.5, sx: 0.32, sy: 0.6, sz: 0.34 });
      mesh(g, TOR(0.3, 0.05), mat(0xffffff), { y: HEAD_TOP - 0.1, z: -0.02, rx: PI / 2, sy: 1.12 });
      mesh(g, SPH(), mat(0xffffff), { x: -0.3, y: HEAD_TOP + 0.35, z: -0.06, s: 0.07 });
    } },
    mortarboard: { on: "head", build(g) {
      const c = mat(0x1d1d24);
      mesh(g, HEMI(), c, { y: HEAD_TOP - 0.12, z: -0.02, sx: 0.32, sy: 0.18, sz: 0.35 });
      mesh(g, BOX(), c, { y: HEAD_TOP + 0.05, ry: PI / 4, sx: 0.5, sy: 0.03, sz: 0.5 });
      mesh(g, CYL(), mat(0xffd23f), { x: 0.2, y: HEAD_TOP - 0.03, z: 0.12, sx: 0.012, sy: 0.18, sz: 0.012 });
    } },
    glasses: { on: "head", build(g) {
      const c = mat(0x1d1d24);
      for (const s of [-1, 1]) mesh(g, TOR(0.075, 0.014), c, { x: s * 0.11, y: 1.3, z: 0.3 });
      mesh(g, BOX(), c, { y: 1.31, z: 0.31, sx: 0.07, sy: 0.015, sz: 0.015 });
      for (const s of [-1, 1]) mesh(g, BOX(), c, { x: s * 0.2, y: 1.31, z: 0.18, sx: 0.015, sy: 0.015, sz: 0.24 });
    } },
    headset: { on: "head", build(g) {
      const c = mat(0x2f3542);
      mesh(g, new THREE.TorusGeometry(0.32, 0.025, 8, 24, PI), c, { y: 1.3 });
      for (const s of [-1, 1]) mesh(g, CYL(), c, { x: s * 0.31, y: 1.28, rz: PI / 2, sx: 0.08, sy: 0.06, sz: 0.08 });
      mesh(g, BOX(), c, { x: 0.22, y: 1.15, z: 0.17, ry: -0.6, sx: 0.015, sy: 0.015, sz: 0.26 });
      mesh(g, SPH(), mat(0x6fcf6f), { x: 0.13, y: 1.15, z: 0.28, s: 0.03 });
    } },
    // ---- on the chest ----
    backpack: { on: "body", build(g) {
      const c = mat(0xff9f43);
      mesh(g, SPH(), c, { y: 0.78, z: -0.22, sx: 0.17, sy: 0.21, sz: 0.1 });
      mesh(g, SPH(), mat(0xe67e22), { y: 0.7, z: -0.3, sx: 0.11, sy: 0.08, sz: 0.04 });
      for (const s of [-1, 1]) mesh(g, BOX(), mat(0xe67e22), { x: s * 0.1, y: 0.92, z: -0.03, rx: 0.15, sx: 0.03, sy: 0.04, sz: 0.3 });
    } },
    whistle: { on: "body", build(g) {
      mesh(g, TOR(0.13, 0.008), mat(0x2f3542), { y: 0.98, z: 0.0, rx: PI / 2 - 0.5 });
      mesh(g, CYL(), mat(0xffd23f, { metalness: 0.4 }), { y: 0.86, z: 0.15, rx: PI / 2, sx: 0.025, sy: 0.07, sz: 0.025 });
    } },
    scarf: { on: "body", build(g) {
      const c = mat(0xd93636);
      mesh(g, TOR(0.13, 0.05), c, { y: 1.05, rx: PI / 2 });
      mesh(g, BOX(), c, { x: 0.07, y: 0.92, z: 0.13, rz: 0.1, sx: 0.07, sy: 0.22, sz: 0.03 });
    } },
    badge: { on: "body", build(g) {
      mesh(g, BOX(), mat(0xffffff), { x: 0.07, y: 0.88, z: 0.135, sx: 0.08, sy: 0.1, sz: 0.01 });
      mesh(g, BOX(), mat(0x4f9fff), { x: 0.07, y: 0.91, z: 0.142, sx: 0.08, sy: 0.03, sz: 0.005 });
    } },
    cape: { on: "body", build(g) {
      const c = mat(0xd93636, { side: THREE.DoubleSide });
      mesh(g, new THREE.CylinderGeometry(0.17, 0.32, 0.62, 16, 1, true, PI / 2 + 0.3, PI - 0.6), c, { y: 0.74, z: -0.02 });
    } },
  };

  // Puts an outfit's extras on a Mii model (MiiModel.createInstance calls this).
  // inst = { holder, bones } (holder not turned or scaled yet).
  function dress(inst, extras) {
    if (!extras || !extras.length) return;
    inst.holder.updateMatrixWorld(true);
    for (const id of extras) {
      const e = EXTRAS[id];
      if (!e) continue;
      const g = new THREE.Group();
      g.name = "extra-" + id;
      e.build(g);
      inst.holder.add(g);
      g.updateMatrixWorld(true);
      // stick it to the head (or the chest), so it moves when the Mii nods or dances
      const bone = e.on === "head" ? inst.bones.Head : inst.bones.Spine_2 || inst.bones.Spine_1;
      if (bone) bone.attach(g);
    }
  }

  // ---------------------------------------------------------------------
  // instruments the band holds (in the holder's space: in front of the Mii)
  // ---------------------------------------------------------------------
  function guitar(color, bass) {
    const g = new THREE.Group();
    const body = mat(color, { roughness: 0.35 });
    const dark = mat(0x2a2438);
    mesh(g, SPH(), body, { y: -0.1, sx: 0.2, sy: 0.24, sz: 0.06 });
    mesh(g, SPH(), body, { y: 0.12, sx: 0.15, sy: 0.15, sz: 0.06 });
    mesh(g, CYL(), dark, { y: 0.0, z: 0.05, rx: PI / 2, sx: 0.05, sy: 0.02, sz: 0.05 });
    mesh(g, BOX(), mat(0x8a5a3a), { y: bass ? 0.55 : 0.48, z: 0.02, sx: 0.05, sy: bass ? 0.75 : 0.6, sz: 0.03 });
    mesh(g, BOX(), dark, { y: bass ? 0.97 : 0.83, z: 0.02, sx: 0.09, sy: 0.12, sz: 0.035 });
    // held across the body, neck pointing up to the left
    g.position.set(0.02, 0.72, 0.2);
    g.rotation.set(0.15, 0, 1.0);
    return g;
  }
  function mic() {
    const g = new THREE.Group();
    mesh(g, CYL(), mat(0x2f3542), { sx: 0.025, sy: 0.18, sz: 0.025 });
    mesh(g, SPH(), mat(0x9aa3b0, { metalness: 0.5, roughness: 0.3 }), { y: 0.11, s: 0.05 });
    g.position.set(-0.24, 1.0, 0.24);
    g.rotation.set(-0.5, 0, 0.2);
    return g;
  }
  const INSTRUMENTS = {
    guitar: () => guitar(0xff5a5a),
    bass: () => guitar(0x4f7fff, true),
    vocals: () => mic(),
  };
  // Gives a walker an instrument to hold (or takes it away: kind = null).
  function hold(w, kind) {
    const holder = w.inst && w.inst.holder;
    if (!holder) return;
    if (w.heldInstrument) { holder.remove(w.heldInstrument); w.heldInstrument = null; }
    if (!kind || !INSTRUMENTS[kind]) return;
    w.heldInstrument = INSTRUMENTS[kind]();
    holder.add(w.heldInstrument);
  }

  // ---------------------------------------------------------------------
  // the wardrobe (level 0 = small .. 4 = huge), built facing +z around (0, 0)
  // ---------------------------------------------------------------------
  const WARDROBE_SIZES = [
    { w: 0.9, h: 1.6, d: 0.6, doors: 1 },
    { w: 1.2, h: 1.8, d: 0.62, doors: 2 },
    { w: 1.5, h: 2.0, d: 0.66, doors: 2 },
    { w: 1.85, h: 2.15, d: 0.7, doors: 3 },
    { w: 2.2, h: 2.3, d: 0.75, doors: 4, crown: true },
  ];
  // kit = World3D.kit (toon look, like the rest of the room)
  function wardrobe(g, level, kit, colors) {
    const S = WARDROBE_SIZES[Math.max(0, Math.min(WARDROBE_SIZES.length - 1, level || 0))];
    const { block, ball, cylinder } = kit;
    const wood = level >= 3 ? 0xf3e3c8 : 0xc98b4a, trim = level >= 3 ? 0xd9a441 : 0xa86f3a;
    block(g, wood, 0, S.h / 2 + 0.06, 0, S.w, S.h, S.d, 0.05);
    for (const sx of [-1, 1]) block(g, trim, sx * (S.w / 2 - 0.08), 0.04, 0, 0.12, 0.1, S.d - 0.08, 0.02); // feet
    block(g, trim, 0, S.h + 0.1, 0, S.w + 0.1, 0.1, S.d + 0.08, 0.03); // top
    const dw = (S.w - 0.1) / S.doors;
    for (let i = 0; i < S.doors; i++) {
      const x = -S.w / 2 + 0.05 + dw * (i + 0.5);
      block(g, level >= 3 ? 0xfff8ee : 0xe0a868, x, S.h / 2 + 0.1, S.d / 2 + 0.01, dw - 0.06, S.h - 0.2, 0.04, 0.03);
      ball(g, 0xffcf5a, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.12), S.h / 2 + 0.1, S.d / 2 + 0.05, 0.035);
      if (level >= 2) block(g, 0xbfe6ff, x, S.h * 0.7, S.d / 2 + 0.035, dw * 0.55, S.h * 0.3, 0.01, 0.02); // mirrors
    }
    // the clothes it owns, folded in piles on top (one per outfit, in its color)
    const cols = colors && colors.length ? colors : [];
    const piles = Math.max(1, Math.floor(S.w / 0.4));
    cols.slice(0, 12).forEach((c, i) => {
      const x = -S.w / 2 + 0.25 + (i % piles) * ((S.w - 0.5) / Math.max(1, piles - 1));
      block(g, c, x, S.h + 0.2 + Math.floor(i / piles) * 0.1, -0.05, 0.3, 0.09, 0.3, 0.03);
    });
    if (S.crown) for (let i = 0; i < 7; i++) ball(g, 0xf2c94c, -0.9 + i * 0.3, S.h + 0.17, S.d / 2 + 0.02, 0.05);
    void cylinder;
    return S;
  }

  root.MiiLifeModels = { EXTRAS, dress, hold, INSTRUMENTS, wardrobe, WARDROBE_SIZES };
})(typeof self !== "undefined" ? self : this);
