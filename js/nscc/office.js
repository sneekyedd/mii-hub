/*
 * js/nscc/office.js
 * THE OFFICE: A223 Information Technology, built from the owner's floor plan and desk plan.
 *
 *          back (windows, the big A223 sign)
 *   +-----------------------------+W+-----------+
 *   | coffee                      |o|  E        |
 *   | corner      1 ->            |r|  SERVER   |
 *   |          2 (v)              |k|  ROOM  [d]|  (E's door: from D)
 *   |             3 (^)   4 ->    +-+------+-+--+
 *   |                     5 ->   [d] D STORAGE  |  (D's door: on the workbench wall)
 *   |                     6 ->    +---------+---+
 *   |                     7 ->  8 (v)      |door| hallway (outside the office:
 *   |          +--------+--------+--------+    |  Miis come in and go out this way)
 *   |          |   C    |   B    |   A    |    |
 *   |  9 (^)   | confer-|  office|  office|    |
 *   | 10 (^)   |  ence  |        |        |    |
 *   +----------+--------+--------+--------+----+
 *          front (open, like a dollhouse: the camera looks from here)
 *   (numbers = desks; arrows = the way the person sitting there looks; [d] = a door;
 *    C, B and A have their doors in the wall above them)
 *
 * Everything about the room lives in this one file. To use a different office,
 * write a new file with the same build() and load it in index.html instead.
 * Nothing else needs to change.
 *
 *   NSCCOffice.build(scene) -> {
 *     root,        THREE.Group with the whole room (already added to the scene)
 *     bounds,      { minX, maxX, minZ, maxZ }  the floor area Miis can walk on
 *     obstacles,   [shape]  things Miis walk around, walls too (shapes: see js/nav.js)
 *                  { x, z, r } circle, { x, z, w, d, rot } rectangle
 *     workSpots,   [{ id, kind, x, z, yaw, arms, seat?, lookUp?, label?, number?, room?, private?, assignable?, gather? }]
 *                  kind:  "desk" (to sit and work: each Mii gets its own) or a break spot:
 *                         "coffee" | "water" | "stretch" | "window" | "board" | "server" |
 *                         "storage" | "workbench" | "sofa" | "meeting"
 *                  x, z:  where the Mii stands to use it (or walks to before sitting down)
 *                  yaw:   the way it faces
 *                  arms:  the arm pose while there ("type", "eat", "cheer", "down"...)
 *                  seat:  { x, z, y } for spots where the Mii sits down (desks, chairs)
 *                  label: what people call it ("Desk 3", "Office A"); number: the desk number
 *                  room:  which room it's in (an id from rooms)
 *                  private:    only the Mii it's assigned to sits there (the private offices)
 *                  assignable: can be given to one Mii (see "Workspace" in the Mii's panel)
 *                  gather:     only used when a few Miis meet up (the conference room chairs)
 *     rooms,       [{ id, name, kind, private?, outside?, areas: [{ minX, maxX, minZ, maxZ }] }]
 *     doorPoint,   { x, z }  just inside the front door (on the walkable floor)
 *     outsidePath  (optional) [{ x, z }]: the way from the door out (down the hallway);
 *                  the last point is outsidePoint. Miis come back in the same way.
 *     outsidePoint { x, z }  outside: Miis appear and disappear here
 *     insidePoint, { x, z }  a few steps into the room from the door
 *     cameraView,  { target: [x, y, z], tilt, yaw?, width, azimuth: [min, max], polar: [min, max] }
 *                  width = how much of the room must fit across the screen; yaw = turn the
 *                  starting view a little to one side (radians)
 *     walls,       (optional) [{ group, point, normal }]: each wall group, a point on it and the
 *                  direction into the room; the view hides a wall while the camera is behind it
 *     background,  the color behind everything
 *     setOwner(spotId, name)  optional: show who a desk / office belongs to ("" or null = nobody)
 *     doors,       (optional) [{ room, from, axis, at, center, width, point, inside, outside, open }]:
 *                  the room doors (open = how far open, 0..1)
 *     update(t, info)  optional: animations (t = seconds). info.door = true while someone goes
 *                  through the front door, info.people = [{ x, z }] where the Miis are (room doors
 *                  open when someone is near), info.reduced = no animation (doors snap),
 *                  info.now = the time (ms, for the wall clock)
 *   }
 *
 * The rooms' walls are low with glass on top (like office partitions), so you can always
 * see into every room. The outer walls hide when the camera is behind them.
 * The room is built from simple rounded shapes with toon shading (a few flat
 * bands of light), like the rest of the look.
 * To move a desk, change its line in DESKS below (x, z, and yaw = the way it faces).
 */
(function (root) {
  "use strict";

  const THREE = root.THREE;
  const TAU = Math.PI * 2;

  // ---------- a tiny toolkit ----------
  const gradient = (() => {
    const t = new THREE.DataTexture(new Uint8Array([140, 205, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  })();
  const mats = new Map();
  function toon(color, opts) {
    if (opts) return new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradient }, opts));
    if (!mats.has(color)) mats.set(color, new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
    return mats.get(color);
  }
  const geos = new Map();
  const geo = (key, make) => (geos.has(key) ? geos.get(key) : (geos.set(key, make()), geos.get(key)));
  const G = {
    sphere: () => geo("sphere", () => new THREE.SphereGeometry(1, 20, 14)),
    cyl: (seg) => geo("cyl" + (seg || 20), () => new THREE.CylinderGeometry(1, 1, 1, seg || 20)),
    rbox: (w, h, d, r) => geo("rbox" + [w, h, d, r].join(","), () => new THREE.RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999)),
    box: () => geo("box", () => new THREE.BoxGeometry(1, 1, 1)),
    torus: (r, t) => geo("torus" + r + "," + t, () => new THREE.TorusGeometry(r, t, 10, 28)),
  };
  function put(parent, g, mat, o) {
    o = o || {};
    const m = new THREE.Mesh(g, mat);
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    const s = o.s || 1;
    m.scale.set((o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.castShadow = o.shadow !== false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const M = (c) => (typeof c === "object" ? c : toon(c));
  const block = (p, c, x, y, z, w, h, d, r, o) => put(p, G.rbox(w, h, d, r === undefined ? 0.06 : r), M(c), Object.assign({ x, y, z }, o));
  // a plain box (for thin, long things like glass, rails and cables: no rounding needed)
  const slab = (p, c, x, y, z, w, h, d, o) => put(p, G.box(), M(c), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));
  const ball = (p, c, x, y, z, r, o) => put(p, G.sphere(), M(c), Object.assign({ x, y, z, s: r }, o));
  const cylinder = (p, c, x, y, z, r, h, o) => put(p, G.cyl(o && o.seg), M(c), Object.assign({ x, y, z, sx: r, sy: h, sz: r }, o));
  function group(parent, x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x || 0, 0, z || 0);
    g.rotation.y = ry || 0;
    parent.add(g);
    return g;
  }
  function canvasTexture(w, h, draw, repeat) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  // A picture with words that can be drawn again later (a name on a door).
  function liveTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    const redraw = (arg) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, arg); t.needsUpdate = true; };
    redraw(null);
    return { tex: t, redraw };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function fitText(ctx, text, maxW, size, weight) {
    let s = size;
    do { ctx.font = (weight || 800) + " " + s + "px Nunito, sans-serif"; s -= 2; } while (s > 10 && ctx.measureText(text).width > maxW);
  }
  // A flat picture readable from both sides (signs hanging in a doorway).
  function twoSided(parent, mat, w, h, x, y, z, ry) {
    const g = geo("plane" + w + "," + h, () => new THREE.PlaneGeometry(w, h));
    put(parent, g, mat, { x, y, z, ry: ry || 0, shadow: false });
    put(parent, g, mat, { x, y, z, ry: (ry || 0) + Math.PI, shadow: false });
  }
  // Joins all the still shapes that share a material into one (much faster to draw).
  function mergeStatic(top) {
    top.updateMatrixWorld(true);
    const skip = new Set();
    top.traverse((o) => { if (o.userData.dynamic) o.traverse((c) => skip.add(c)); });
    const buckets = new Map(), remove = [];
    top.traverse((o) => {
      if (!o.isMesh || skip.has(o) || Array.isArray(o.material)) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(n)) g.deleteAttribute(n);
      g.applyMatrix4(o.matrixWorld);
      const key = o.material.uuid + "|" + o.castShadow;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
      buckets.get(key).geos.push(g);
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    for (const b of buckets.values()) {
      const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      top.add(m);
    }
  }
  const dynamic = (o) => { o.userData.dynamic = true; return o; };
  // the same "random" every time (so the boxes on the shelves don't move about on reload)
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- furniture ----------
  // monitor pictures: a chart, a document, a video call, code
  function screenMats() {
    return [0, 1, 2, 3].map((kind) => new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTexture(128, 80, (ctx, w, h) => {
      const dark = kind === 3;
      ctx.fillStyle = dark ? "#1e2433" : "#eaf6ff"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark ? "#2d3548" : "#4a90e2"; ctx.fillRect(0, 0, w, 10);
      if (kind === 0) [30, 50, 38, 62, 45].forEach((b, i) => { ctx.fillStyle = ["#ff7a59", "#ffc94a", "#5cc84a", "#4a90e2", "#b58cff"][i]; ctx.fillRect(12 + i * 22, h - 8 - b, 14, b); });
      if (kind === 1) for (let i = 0; i < 6; i++) { ctx.fillStyle = "#9aa8bd"; ctx.fillRect(12, 18 + i * 9, 60 + ((i * 37) % 40), 4); }
      if (kind === 2) { [["#ffc94a", 8], ["#9fe3ff", 66]].forEach(([c, x]) => { ctx.fillStyle = c; ctx.fillRect(x, 16, 54, 56); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 27, 38, 10, 0, TAU); ctx.fill(); ctx.fillRect(x + 12, 52, 30, 18); }); }
      if (kind === 3) for (let i = 0; i < 6; i++) { ctx.fillStyle = ["#ff7ab6", "#7ad7ff", "#c5f08a", "#ffd36b"][i % 4]; ctx.fillRect(10 + (i % 3) * 8, 18 + i * 9, 30 + ((i * 23) % 50), 4); }
    }) }));
  }
  // An office chair. The back is behind the Mii: ry = the way the Mii faces.
  function officeChair(p, x, z, color, ry) {
    const c = group(p, x, z, ry || 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      block(c, 0x3a3f4a, Math.cos(a) * 0.25, 0.07, Math.sin(a) * 0.25, 0.5, 0.05, 0.08, 0.02, { ry: -a });
    }
    cylinder(c, 0x3a3f4a, 0, 0.32, 0, 0.05, 0.5);
    block(c, color, 0, 0.6, 0, 0.75, 0.14, 0.72, 0.07);
    block(c, color, 0, 1.05, -0.36, 0.72, 0.75, 0.12, 0.06);
  }
  // A little desk number standing on a desk, readable from the front and the back
  // ("7", or "7 · Joe" when it's someone's).
  function deskBadge(p, number, x, y, z) {
    const live = liveTexture(256, 64, (ctx, w, h, owner) => {
      ctx.fillStyle = owner ? "rgba(255,247,214,0.97)" : "rgba(255,255,255,0.94)";
      roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fill();
      ctx.strokeStyle = owner ? "#e0a92e" : "#8fbf9c"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "#24603b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const text = owner ? number + " · " + owner : String(number);
      fitText(ctx, text, w - 24, 40);
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
    const mat = new THREE.MeshBasicMaterial({ map: live.tex, transparent: true, toneMapped: false });
    twoSided(p, mat, 0.72, 0.18, x, y, z, 0);
    block(p, 0xffffff, x, y - 0.1, z, 0.74, 0.03, 0.08, 0.01);
    return live;
  }
  // One desk. The Mii sits behind it, looking the way `yaw` says (0 = toward the front,
  // Math.PI / 2 = to the right...). Returns where the chair is.
  function singleDesk(p, x, z, yaw, w, colors, screens, n) {
    const d = group(p, x, z, yaw);
    block(d, 0xf0d3a8, 0, 1.0, 0, w, 0.1, 0.9, 0.04);
    for (const [sx, sz] of [[-w / 2 + 0.1, -0.35], [w / 2 - 0.1, -0.35], [-w / 2 + 0.1, 0.35], [w / 2 - 0.1, 0.35]]) block(d, 0x8f96a3, sx, 0.5, sz, 0.08, 1.0, 0.08, 0.03);
    block(d, colors[0], 0, 1.3, 0.44, w, 0.5, 0.05, 0.03); // a little divider at the far side
    block(d, [0xfff176, 0xff9ec7, 0x9fe3ff][n % 3], w / 2 - 0.25, 1.4, 0.475, 0.14, 0.14, 0.01, 0.01, { rz: 0.1 });
    block(d, 0x2f3542, 0, 1.6, 0.2, 0.8, 0.5, 0.05, 0.03);
    put(d, geo("screen", () => new THREE.PlaneGeometry(0.72, 0.42)), screens[n % screens.length], { y: 1.6, z: 0.172, ry: Math.PI, shadow: false });
    block(d, 0x2f3542, 0, 1.2, 0.22, 0.1, 0.3, 0.1, 0.03);
    block(d, 0xf4f4f4, 0, 1.07, -0.2, 0.62, 0.03, 0.2, 0.02); // keyboard
    ball(d, 0xf4f4f4, 0.45, 1.08, -0.2, 0.06, { sy: 0.5, sz: 1.4 }); // mouse
    cylinder(d, colors[1], -0.5, 1.15, -0.02, 0.07, 0.18); // mug
    officeChair(d, 0, -0.95, colors[1]);
  }
  // Where a point on a desk ends up in the room (local x across the desk, local z toward its far side).
  function onDesk(x, z, yaw, lx, lz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
  }
  // The space a desk and its chair take up (for walking round), as a plain rectangle.
  function deskArea(x, z, yaw, w) {
    const mid = onDesk(x, z, yaw, 0, -0.45);
    const side = Math.abs(Math.sin(yaw)) > 0.5;
    return { x: mid.x, z: mid.z, w: side ? 2.1 : w + 0.1, d: side ? w + 0.1 : 2.1 };
  }
  // One bigger desk (the private offices), with the chair behind it.
  function officeDesk(p, x, z, yaw, accent, screens, n) {
    const d = group(p, x, z, yaw);
    block(d, 0xc98f5a, 0, 1.0, 0, 2.3, 0.12, 1.2, 0.05);
    block(d, 0xb27a48, -0.95, 0.5, 0, 0.3, 1.0, 1.1, 0.04); // drawers
    for (let i = 0; i < 3; i++) block(d, 0xd9a874, -0.95, 0.2 + i * 0.3, 0.56, 0.24, 0.22, 0.02, 0.02);
    block(d, 0x8f96a3, 1.05, 0.5, -0.48, 0.08, 1.0, 0.08, 0.03); block(d, 0x8f96a3, 1.05, 0.5, 0.48, 0.08, 1.0, 0.08, 0.03);
    block(d, accent, 0, 0.62, 0.56, 2.0, 0.7, 0.05, 0.03); // modesty panel
    block(d, 0x2f3542, 0.1, 1.65, 0.3, 1.0, 0.6, 0.05, 0.03);
    put(d, geo("screenBig", () => new THREE.PlaneGeometry(0.92, 0.52)), screens[n % screens.length], { x: 0.1, y: 1.65, z: 0.272, ry: Math.PI, shadow: false });
    block(d, 0x2f3542, 0.1, 1.22, 0.32, 0.1, 0.3, 0.1, 0.03);
    block(d, 0xf4f4f4, 0.1, 1.08, -0.2, 0.62, 0.03, 0.2, 0.02);
    ball(d, 0xf4f4f4, 0.6, 1.09, -0.2, 0.06, { sy: 0.5, sz: 1.4 });
    // a desk lamp, a photo frame and a mug
    cylinder(d, 0x3a3f4a, -0.8, 1.08, 0.3, 0.12, 0.04);
    block(d, 0x3a3f4a, -0.8, 1.35, 0.3, 0.04, 0.55, 0.04, 0.02, { rz: 0.25 });
    cylinder(d, accent, -0.65, 1.62, 0.3, 0.13, 0.14);
    block(d, 0xffffff, 0.8, 1.22, 0.32, 0.36, 0.3, 0.04, 0.02, { rx: -0.2 });
    block(d, 0x8fd0ff, 0.8, 1.22, 0.30, 0.28, 0.22, 0.02, 0.01, { rx: -0.2 });
    cylinder(d, 0xffffff, -0.45, 1.15, -0.15, 0.07, 0.18);
    officeChair(d, 0, -1.0, accent);
  }
  function plant(p, x, z, s) {
    const g = group(p, x, z);
    g.scale.setScalar(s || 1);
    cylinder(g, 0xffffff, 0, 0.45, 0, 0.45, 0.9);
    put(g, G.torus(0.45, 0.04), toon(0x7fc4ec), { y: 0.78, rx: Math.PI / 2 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      put(g, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: Math.cos(a) * 0.4, y: 1.7 + (i % 3) * 0.3, z: Math.sin(a) * 0.4, sx: 0.22, sy: 0.85, sz: 0.22, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
    }
  }
  function rug(p, x, z, w, d, c1, c2) {
    block(p, c1, x, 0.03, z, w, 0.04, d, 0.02, { shadow: false });
    block(p, c2, x, 0.035, z, w - 0.3, 0.04, d - 0.3, 0.02, { shadow: false });
  }
  function bookshelf(p, x, z, ry, w) {
    const g = group(p, x, z, ry);
    block(g, 0xb27a48, 0, 0.9, 0, w, 1.8, 0.45, 0.04);
    block(g, 0xf3e3c8, 0, 0.9, 0.04, w - 0.12, 1.66, 0.4, 0.02);
    for (let s = 0; s < 3; s++) {
      block(g, 0xb27a48, 0, 0.12 + s * 0.56, 0.04, w - 0.1, 0.05, 0.42, 0.01);
      let bx = -w / 2 + 0.15;
      while (bx < w / 2 - 0.2) {
        const bw = 0.08 + rand() * 0.07, bh = 0.3 + rand() * 0.15;
        slab(g, [0xff7a59, 0x4a90e2, 0x5cc84a, 0xffc94a, 0xb58cff, 0x3ec7c2][Math.floor(rand() * 6)], bx, 0.15 + s * 0.56 + bh / 2, 0.06, bw, bh, 0.3);
        bx += bw + 0.02;
      }
    }
  }
  // A server rack: dark cabinet, server units with little lights on the front (facing +z).
  function serverRack(p, x, z, leds) {
    const g = group(p, x, z);
    block(g, 0x262b3a, 0, 1.25, 0, 0.9, 2.5, 1.0, 0.05);
    block(g, 0x3a4258, 0, 1.25, 0.49, 0.8, 2.36, 0.03, 0.02);
    for (let u = 0; u < 9; u++) {
      const y = 0.35 + u * 0.24;
      slab(g, u % 3 === 2 ? 0x5a6582 : 0x4b5570, 0, y, 0.51, 0.72, 0.17, 0.03, { shadow: false });
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) put(g, geo("led", () => new THREE.BoxGeometry(0.045, 0.045, 0.02)), leds[Math.floor(rand() * leds.length)], { x: -0.28 + k * 0.08, y, z: 0.53, shadow: false });
      slab(g, 0x2f3542, 0.18, y, 0.525, 0.3, 0.02, 0.01, { shadow: false });
    }
    block(g, 0x1c202b, 0, 2.53, 0, 0.92, 0.06, 1.02, 0.02); // top
  }
  // A metal shelf with boxes, spare screens and bits of computers.
  function storageShelf(p, x, z, w, stuff) {
    const g = group(p, x, z);
    const D = 0.7;
    for (const [sx, sz] of [[-w / 2, -D / 2], [w / 2, -D / 2], [-w / 2, D / 2], [w / 2, D / 2]]) block(g, 0x9aa3b2, sx, 1.2, sz, 0.07, 2.4, 0.07, 0.02);
    for (let s = 0; s < 4; s++) {
      const y = 0.12 + s * 0.68;
      block(g, 0xb9c1cc, 0, y, 0, w, 0.05, D, 0.01);
      let bx = -w / 2 + 0.12;
      while (bx < w / 2 - 0.35) {
        const kind = stuff === "screens" && s > 0 ? "screen" : stuff === "parts" && s % 2 ? "parts" : "box";
        if (kind === "screen") {
          block(g, 0x2f3542, bx + 0.3, y + 0.28, 0, 0.6, 0.42, 0.06, 0.02, { rx: 0.05 });
          block(g, 0x2f3542, bx + 0.3, y + 0.06, 0, 0.3, 0.06, 0.25, 0.02);
          bx += 0.68;
        } else if (kind === "parts") {
          block(g, [0x5cc84a, 0x4a90e2, 0xff7a59][Math.floor(rand() * 3)], bx + 0.22, y + 0.12, 0, 0.44, 0.2, 0.5, 0.03); // a parts bin
          block(g, 0x2f3542, bx + 0.22, y + 0.24, 0.05, 0.3, 0.05, 0.2, 0.01); // a keyboard in it
          bx += 0.52;
        } else {
          const bw = 0.35 + rand() * 0.3, bh = 0.25 + rand() * 0.3;
          slab(g, [0xd8a865, 0xc99654, 0xe6bd7f][Math.floor(rand() * 3)], bx + bw / 2, y + 0.03 + bh / 2, 0, bw, bh, 0.55);
          slab(g, 0xf2e2bd, bx + bw / 2, y + 0.04 + bh, 0, bw * 0.95, 0.01, 0.08, { shadow: false }); // tape
          bx += bw + 0.06;
        }
      }
    }
  }
  function cardboard(p, x, y, z, w, h, d, ry) {
    block(p, [0xd8a865, 0xc99654, 0xe6bd7f][Math.floor(rand() * 3)], x, y + h / 2, z, w, h, d, 0.03, { ry: ry || 0 });
    slab(p, 0xf2e2bd, x, y + h + 0.005, z, w * 0.95, 0.01, 0.1, { ry: ry || 0, shadow: false });
  }

  // ---------- walls ----------
  // Room walls are low with glass on top. A wall runs along x (axis "x", at z = `at`) or along
  // z (axis "z", at x = `at`), from `from` to `to`, with doorways: [[center, width], ...].
  const BASE_H = 1.15, GLASS_TOP = 3.1, PART_T = 0.3;
  function partition(p, obstacles, glassMat, axis, at, from, to, gaps) {
    gaps = (gaps || []).slice().sort((a, b) => a[0] - b[0]);
    const runs = [];
    let s = from;
    for (const [c, w] of gaps) { runs.push([s, c - w / 2]); s = c + w / 2; }
    runs.push([s, to]);
    const place = (a, b, y, h, t, color, o) => {
      const mid = (a + b) / 2, len = b - a;
      if (axis === "x") return (o && o.slab ? slab : block)(p, color, mid, y, at, len, h, t, o && o.slab ? o : 0.03, o && !o.slab ? o : undefined);
      return (o && o.slab ? slab : block)(p, color, at, y, mid, t, h, len, o && o.slab ? o : 0.03, o && !o.slab ? o : undefined);
    };
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue;
      place(a, b, BASE_H / 2, BASE_H, PART_T, 0xeef5ea);
      place(a - 0.02, b + 0.02, BASE_H + 0.04, 0.08, PART_T + 0.08, 0x4f9a6a);
      place(a, b, (BASE_H + GLASS_TOP) / 2, GLASS_TOP - BASE_H, 0.05, glassMat, { slab: true, shadow: false });
      // white posts every two steps or so
      const n = Math.max(1, Math.round((b - a) / 2.2));
      for (let i = 0; i <= n; i++) {
        const q = a + ((b - a) * i) / n;
        place(q - 0.05, q + 0.05, (BASE_H + GLASS_TOP) / 2, GLASS_TOP - BASE_H, 0.12, 0xffffff, { slab: true });
      }
      const mid = (a + b) / 2, len = b - a;
      obstacles.push(axis === "x" ? { x: mid, z: at, w: len, d: PART_T } : { x: at, z: mid, w: PART_T, d: len });
    }
    // the top rail goes all the way along (over the doorways too)
    place(from, to, GLASS_TOP, 0.1, 0.16, 0xffffff, { slab: true });
    // door frames
    for (const [c, w] of gaps) for (const e of [c - w / 2, c + w / 2]) place(e - 0.07, e + 0.07, GLASS_TOP / 2, GLASS_TOP, PART_T + 0.04, 0xffffff, { slab: true });
  }
  // A sign over a doorway, readable from both sides. Returns redraw(owner) for the name.
  function doorSign(p, axis, at, center, letter, name, color) {
    const live = liveTexture(512, 160, (ctx, w, h, owner) => {
      ctx.fillStyle = color; roundRect(ctx, 4, 4, w - 8, h - 8, 34); ctx.fill();
      ctx.fillStyle = "#ffffff"; roundRect(ctx, 18, 18, 124, h - 36, 24); ctx.fill();
      ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 96px Nunito, sans-serif"; ctx.fillText(letter, 80, h / 2 + 6);
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
      if (owner) {
        fitText(ctx, name, w - 190, 38, 700); ctx.fillText(name, 162, h / 2 - 26);
        fitText(ctx, owner, w - 190, 54); ctx.fillText(owner, 162, h / 2 + 24);
      } else {
        fitText(ctx, name, w - 190, 50); ctx.fillText(name, 162, h / 2 + 4);
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: live.tex, toneMapped: false });
    const y = GLASS_TOP - 0.32;
    if (axis === "x") twoSided(p, mat, 1.7, 0.53, center, y, at, 0);
    else twoSided(p, mat, 1.7, 0.53, at, y, center, Math.PI / 2);
    return live.redraw;
  }
  // A door in a doorway (wood, with a little window and a handle on both sides), hanging on one
  // side of the frame. It swings into the room (about 88 degrees) when someone comes near and
  // closes again after. Where it stands when open goes in `obstacles`, so nobody walks into it.
  const LEAF_H = 2.42, LEAF_T = 0.08, OPEN_ANGLE = 1.54;
  function roomDoor(p, obstacles, o) {
    const len = o.width - 0.16; // (inside the white frame posts)
    const hingeU = o.center + o.hinge * (o.width / 2 - 0.08);
    const at = (u, v) => (o.axis === "x" ? { x: u, z: v } : { x: v, z: u });
    // the way the door points from its hinge: closed (across the doorway) and open (into the room)
    const dirAt = (k) => {
      const a = k * OPEN_ANGLE;
      const du = -o.hinge * Math.cos(a), dv = o.inward * Math.sin(a);
      return o.axis === "x" ? { x: du, z: dv } : { x: dv, z: du };
    };
    const yawFor = (d) => Math.atan2(-d.z, d.x); // (turns the door's local +x onto d)
    const h = at(hingeU, o.at);
    const pivot = dynamic(new THREE.Group());
    pivot.position.set(h.x, 0, h.z);
    p.add(pivot);
    const y0 = yawFor(dirAt(0));
    let dy = yawFor(dirAt(1)) - y0;
    while (dy > Math.PI) dy -= TAU;
    while (dy < -Math.PI) dy += TAU;
    // the leaf: wood, a darker edge, a window near the top, and a handle on both faces
    block(pivot, 0xd9a874, len / 2, LEAF_H / 2 + 0.03, 0, len, LEAF_H, LEAF_T, 0.03);
    block(pivot, 0xb27a48, len / 2, 0.16, 0, len - 0.04, 0.22, LEAF_T + 0.02, 0.02); // kick plate
    for (const side of [-1, 1]) {
      block(pivot, 0xe8c294, len / 2, 0.95, side * (LEAF_T / 2 + 0.005), len - 0.36, 0.95, 0.02, 0.02); // a raised panel
      block(pivot, 0x4f9a6a, len / 2, 1.95, side * (LEAF_T / 2 + 0.006), len - 0.3, 0.72, 0.02, 0.02); // the window's green frame
      slab(pivot, 0xd4f5dc, len / 2, 1.95, side * (LEAF_T / 2 + 0.018), len - 0.48, 0.56, 0.01, { shadow: false }); // window
      ball(pivot, 0xffcf3a, len - 0.17, 1.08, side * (LEAF_T / 2 + 0.07), 0.065);
      block(pivot, 0xffcf3a, len - 0.17, 1.08, side * (LEAF_T / 2 + 0.03), 0.05, 0.05, 0.08, 0.02);
    }
    for (const e of [0.35, LEAF_H - 0.35]) cylinder(pivot, 0x9aa3b2, 0.0, e, 0, 0.035, 0.2, { seg: 8 }); // hinges
    // the head of the frame (over the door, under the sign)
    const mid = at(o.center, o.at);
    if (o.axis === "x") slab(p, 0xffffff, mid.x, LEAF_H + 0.1, mid.z, o.width + 0.14, 0.14, PART_T + 0.04);
    else slab(p, 0xffffff, mid.x, LEAF_H + 0.1, mid.z, PART_T + 0.04, 0.14, o.width + 0.14);
    // nobody walks into the open door
    const od = dirAt(1);
    obstacles.push({ x: h.x + od.x * len / 2, z: h.z + od.z * len / 2, w: len, d: LEAF_T + 0.04, rot: Math.atan2(od.z, od.x) });
    let k = 0;
    const set = (v) => { k = v; pivot.rotation.y = y0 + dy * smoothK(k); };
    set(0);
    return {
      room: o.room, from: o.from, axis: o.axis, at: o.at, center: o.center, width: o.width,
      point: mid, // the middle of the doorway
      inside: at(o.center, o.at + o.inward * 0.8), outside: at(o.center, o.at - o.inward * 0.8),
      get open() { return k; },
      step(want, dt, instant) {
        if (instant) set(want);
        else if (Math.abs(want - k) > 1e-4) set(k + (want - k) * (1 - Math.exp(-dt * (want > k ? 7 : 3.5))));
      },
    };
  }
  const smoothK = (k) => k * k * (3 - 2 * k);

  // A big letter and name on the floor of a room (like on the floor plan).
  function floorLabel(p, x, z, letter, name, w) {
    const tex = canvasTexture(512, 256, (ctx, cw, ch) => {
      ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fitText(ctx, letter, cw - 20, 170); ctx.fillText(letter, cw / 2, 100);
      fitText(ctx, name.toUpperCase(), cw - 30, 46); ctx.fillText(name.toUpperCase(), cw / 2, 214);
    });
    put(p, new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }), { x, y: 0.07, z, rx: -Math.PI / 2, shadow: false });
  }


  // =====================================================================
  function build(scene) {
    seed = 7;
    const top = new THREE.Group();
    top.name = "office";
    const anim = [];
    const obstacles = [];

    // ----- light -----
    top.add(new THREE.HemisphereLight(0xffffff, 0xd9d2a8, 0.55));
    top.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.7);
    sun.position.set(10, 26, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 20, bottom: -20, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    top.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(0, 8, 20);
    top.add(fill);

    // ----- the floor plan -----
    // x: left wall -16 ... right wall 16; z: back wall -12 ... open front 12 (see the picture at the top)
    const X = { left: -16, cLeft: -6, cb: -0.5, ba: 5, hall: 11, right: 16 };
    const Z = { back: -12, ed: -3, d: 0, rooms: 6, front: 12 };
    const WALL_H = 6.5;
    const B = { minX: X.left + 0.35, maxX: X.right - 0.35, minZ: Z.back + 0.35, maxZ: Z.front - 0.3 }; // walkable floor
    const glass = new THREE.MeshBasicMaterial({ color: 0xd4f5dc, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });

    // ----- floors: carpet in the open office, other floors in the rooms -----
    const carpet = canvasTexture(256, 256, (ctx) => {
      const shades = ["#93ab97", "#9cb4a0", "#8ca590", "#98b09c"];
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        ctx.fillStyle = shades[(x + y * 2) % 4];
        ctx.fillRect(x * 128, y * 128, 128, 128);
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        for (let k = 8; k < 128; k += 8) {
          ctx.beginPath();
          if ((x + y) % 2) { ctx.moveTo(x * 128 + k, y * 128); ctx.lineTo(x * 128 + k, y * 128 + 128); }
          else { ctx.moveTo(x * 128, y * 128 + k); ctx.lineTo(x * 128 + 128, y * 128 + k); }
          ctx.stroke();
        }
      }
      ctx.strokeStyle = "rgba(40,70,50,0.25)"; ctx.lineWidth = 2;
      for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) ctx.strokeRect(x, y, 128, 128);
    }, [8, 6]);
    put(top, new THREE.PlaneGeometry(X.right - X.left, Z.front - Z.back), toon(0xffffff, { map: carpet }), { rx: -Math.PI / 2, shadow: false });
    const floorPatch = (x0, x1, z0, z1, tex, per) => {
      const t = tex.clone(); t.needsUpdate = true;
      t.repeat.set((x1 - x0) / per, (z1 - z0) / per);
      put(top, new THREE.PlaneGeometry(x1 - x0, z1 - z0), toon(0xffffff, { map: t }), { x: (x0 + x1) / 2, y: 0.012, z: (z0 + z1) / 2, rx: -Math.PI / 2, shadow: false });
    };
    const tiles = (base, line, dots) => canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
      if (dots) { ctx.fillStyle = line; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { ctx.beginPath(); ctx.arc(20 + i * 18, 20 + j * 18, 3, 0, TAU); ctx.fill(); } }
    }, [1, 1]);
    const wood = canvasTexture(256, 256, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = ["#e2b886", "#d9ab76", "#e8c294", "#dcb07c"][i % 4]; ctx.fillRect(0, i * 32, w, 32);
        ctx.fillStyle = "rgba(120,70,30,0.25)"; ctx.fillRect(0, i * 32, w, 2); ctx.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
      }
    }, [1, 1]);
    const softCarpet = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "#86b9a4"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; for (let k = 6; k < w; k += 10) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, h); ctx.stroke(); }
    }, [1, 1]);
    floorPatch(X.ba, X.right, Z.back, Z.ed, tiles("#c9d3cf", "#9aaaa3", true), 1.2);   // E: raised floor tiles
    floorPatch(X.ba, X.right, Z.ed, Z.d, tiles("#cfc6b4", "#b3a890", false), 1.6);    // D: plain floor
    floorPatch(X.cLeft, X.cb, Z.rooms, Z.front, softCarpet, 2);                         // C
    floorPatch(X.cb, X.ba, Z.rooms, Z.front, wood, 3);                                  // B
    floorPatch(X.ba, X.hall, Z.rooms, Z.front, wood, 3);                                // A
    floorPatch(X.hall, X.right, Z.d, Z.front, tiles("#eef3ef", "#d3ddd6", false), 1.4); // the hallway
    // a thick floor edge at the open front (like a dollhouse)
    block(top, 0x4f9a6a, 0, -0.3, Z.front + 0.15, X.right - X.left + 0.5, 0.6, 0.3, 0.04);
    floorLabel(top, -5.5, -6.6, "A223", "Information Technology", 8.5);
    floorLabel(top, 14.1, -7.4, "E", "Server room", 3.0);
    floorLabel(top, 7.4, -1.25, "D", "Storage", 2.4);
    floorLabel(top, (X.cLeft + X.cb) / 2, 11.35, "C", "Conference room", 2.8);
    floorLabel(top, 3.6, 11.3, "B", "Office", 2.4);
    floorLabel(top, 7.2, 11.3, "A", "Office", 2.4);

    // ----- outer walls: back, left, right (each hides when the camera is behind it) -----
    const backWall = new THREE.Group(), leftWall = new THREE.Group(), rightWall = new THREE.Group(), doorWall = new THREE.Group();
    const wallC = 0xe3f1e0, panelC = 0x4f9a6a;
    block(backWall, wallC, 0, WALL_H / 2, Z.back - 0.25, X.right - X.left + 1, WALL_H, 0.5, 0.02);
    block(leftWall, wallC, X.left - 0.25, WALL_H / 2, 0, 0.5, WALL_H, Z.front - Z.back + 0.5, 0.02);
    block(rightWall, wallC, X.right + 0.25, WALL_H / 2, 0, 0.5, WALL_H, Z.front - Z.back + 0.5, 0.02);
    // dark panelling and a white rail along the bottom of the walls
    const panel = (wall, x, z, w, d) => { block(wall, panelC, x, 1.1, z, w, 2.2, d, 0.02); block(wall, 0xffffff, x, 2.25, z, w + 0.04, 0.12, d + 0.06, 0.03); };
    panel(backWall, 0, Z.back + 0.06, X.right - X.left, 0.12);
    panel(leftWall, X.left + 0.06, 0, 0.12, Z.front - Z.back);
    panel(rightWall, X.right - 0.06, 0, 0.12, Z.front - Z.back);

    // windows: a sunny sky with soft clouds
    const sky = canvasTexture(256, 160, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#4fb0f5"); g.addColorStop(1, "#d8efff");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const [x, y, r] of [[60, 50, 18], [80, 46, 22], [102, 52, 16], [180, 90, 14], [196, 86, 18], [212, 92, 12]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "#8fc49a";
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(i * 32 + 12, h - 6, 22 + ((i * 37) % 14), 0, TAU); ctx.fill(); }
    });
    const skyMat = new THREE.MeshBasicMaterial({ map: sky, toneMapped: false });
    const windowAt = (wall, x, z, ry) => {
      const g = group(wall, x, z, ry);
      put(g, geo("win", () => new THREE.PlaneGeometry(4.2, 2.4)), skyMat, { y: 4.0, z: 0.02, shadow: false });
      block(g, 0xffffff, 0, 2.75, 0.05, 4.5, 0.16, 0.3, 0.03);
      block(g, 0xffffff, 0, 5.25, 0.05, 4.4, 0.14, 0.12, 0.03);
      block(g, 0xffffff, -2.15, 4.0, 0.05, 0.14, 2.5, 0.12, 0.03);
      block(g, 0xffffff, 2.15, 4.0, 0.05, 0.14, 2.5, 0.12, 0.03);
      block(g, 0xffffff, 0, 4.0, 0.05, 0.1, 2.4, 0.1, 0.03);
    };
    for (const x of [-13.0, -0.9]) windowAt(backWall, x, Z.back, 0);
    for (const z of [-3.2, 2.4]) windowAt(leftWall, X.left, z, Math.PI / 2);
    // the big "A223 Information Technology" sign on the back wall
    const bigSign = canvasTexture(640, 220, (ctx, w, h) => {
      ctx.fillStyle = "#24603b"; roundRect(ctx, 6, 6, w - 12, h - 12, 40); ctx.fill();
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 8; roundRect(ctx, 20, 20, w - 40, h - 40, 30); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 104px Nunito, sans-serif"; ctx.fillText("A223", w / 2, 82);
      ctx.font = "800 50px Nunito, sans-serif"; ctx.fillText("Information Technology", w / 2, 160);
    });
    put(backWall, new THREE.PlaneGeometry(5.6, 1.92), new THREE.MeshBasicMaterial({ map: bigSign, toneMapped: false }), { x: -6.9, y: 4.1, z: Z.back + 0.03, shadow: false });
    // a whiteboard on the left wall
    const WB = { x: X.left + 0.12, z: 7.4 };
    block(leftWall, 0xc9d6cf, WB.x, 3.4, WB.z, 0.1, 2.2, 3.4, 0.04);
    const board = canvasTexture(256, 140, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.strokeStyle = "#2f9e5b"; ctx.beginPath(); ctx.moveTo(20, 30); ctx.lineTo(110, 30); ctx.stroke();
      ctx.strokeStyle = "#ff7a59"; ctx.beginPath(); ctx.moveTo(20, 60); ctx.lineTo(90, 60); ctx.stroke();
      ctx.strokeStyle = "#4a90e2"; ctx.beginPath(); ctx.moveTo(20, 90); ctx.lineTo(120, 90); ctx.stroke();
      ctx.strokeStyle = "#b58cff"; ctx.beginPath(); ctx.arc(190, 70, 36, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#ffc94a"; ctx.fillRect(170, 105, 44, 20);
    });
    put(leftWall, new THREE.PlaneGeometry(3.2, 2.0), new THREE.MeshBasicMaterial({ map: board, toneMapped: false }), { x: WB.x + 0.06, y: 3.4, z: WB.z, ry: Math.PI / 2, shadow: false });
    // a wall clock that shows the real time (over the coffee corner)
    const clock = group(leftWall, X.left + 0.1, -9.6, Math.PI / 2);
    cylinder(clock, 0xffffff, 0, 4.4, 0, 0.6, 0.1, { rx: Math.PI / 2 });
    put(clock, G.torus(0.6, 0.06), toon(0x3a3f4a), { y: 4.4, z: 0.03 });
    const hands = dynamic(new THREE.Group());
    hands.position.set(0, 4.4, 0.08);
    clock.add(hands);
    const hourHand = block(hands, 0x24283b, 0, 0, 0, 0.07, 0.34, 0.03, 0.01);
    const minHand = block(hands, 0x24283b, 0, 0, 0.02, 0.05, 0.5, 0.03, 0.01);
    hourHand.geometry = hourHand.geometry.clone().translate(0, 0.14, 0);
    minHand.geometry = minHand.geometry.clone().translate(0, 0.22, 0);
    anim.push((t, info) => {
      const d = new Date((info && info.now) || Date.now());
      const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
      minHand.rotation.z = -(m / 60) * TAU;
      hourHand.rotation.z = -(h / 12) * TAU;
    });
    // a notice board in the hallway
    block(rightWall, 0xb27a48, X.right - 0.1, 2.9, 8.6, 0.1, 1.6, 2.6, 0.04);
    block(rightWall, 0xe9c99a, X.right - 0.14, 2.9, 8.6, 0.08, 1.4, 2.4, 0.03);
    for (let i = 0; i < 5; i++) block(rightWall, [0xfff176, 0xff9ec7, 0x9fe3ff, 0xffffff, 0xc5f08a][i], X.right - 0.19, 2.6 + (i % 2) * 0.55, 7.7 + i * 0.45, 0.02, 0.4, 0.34, 0.01, { rx: (i - 2) * 0.08 });

    // ----- the room walls (low, with glass on top) -----
    // Doorways: [center, width] along the wall. D's door is on the wall the workbench runs along
    // (main room | E and D), just past the end of the workbench; E is reached through D.
    const DOOR_E = [14.3, 1.8], DOOR_D = [-1.25, 1.8], DOOR_C = [-1.6, 1.8], DOOR_B = [3.0, 1.8], DOOR_A = [8.0, 1.8];
    partition(top, obstacles, glass, "z", X.ba, Z.back, Z.ed, []);                     // main | E (the workbench wall)
    partition(top, obstacles, glass, "x", Z.ed, X.ba, X.right, [DOOR_E]);              // E | D
    partition(top, obstacles, glass, "z", X.ba, Z.ed, Z.d, [DOOR_D]);                  // main | D (same wall, D's door)
    partition(top, obstacles, glass, "x", Z.d, X.ba, X.right, []);                     // D | main and hallway
    partition(top, obstacles, glass, "x", Z.rooms, X.cLeft, X.hall, [DOOR_C, DOOR_B, DOOR_A]); // main | C, B, A
    partition(top, obstacles, glass, "z", X.cLeft, Z.rooms, Z.front, []);             // main | C
    partition(top, obstacles, glass, "z", X.cb, Z.rooms, Z.front, []);                // C | B
    partition(top, obstacles, glass, "z", X.ba, Z.rooms, Z.front, []);                // B | A
    partition(top, obstacles, glass, "z", X.hall, Z.rooms, Z.front, []);              // A | hallway
    const signs = {
      E: doorSign(top, "x", Z.ed, DOOR_E[0], "E", "Server room", "#3b6f8a"),
      D: doorSign(top, "z", X.ba, DOOR_D[0], "D", "Storage", "#8a6a3c"),
      C: doorSign(top, "x", Z.rooms, DOOR_C[0], "C", "Conference", "#2e8f86"),
      B: doorSign(top, "x", Z.rooms, DOOR_B[0], "B", "Office", "#c0603e"),
      A: doorSign(top, "x", Z.rooms, DOOR_A[0], "A", "Office", "#7b55c4"),
    };
    // a real door in every doorway: it swings into the room when someone comes near, and closes after.
    // inward: which way into the room (+1 = toward bigger z / x); hinge: which end it hangs on (+1 = the bigger end)
    const doors = [
      roomDoor(top, obstacles, { room: "E", from: "D", axis: "x", at: Z.ed, center: DOOR_E[0], width: DOOR_E[1], inward: -1, hinge: 1 }),
      roomDoor(top, obstacles, { room: "D", from: "main", axis: "z", at: X.ba, center: DOOR_D[0], width: DOOR_D[1], inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, { room: "C", from: "main", axis: "x", at: Z.rooms, center: DOOR_C[0], width: DOOR_C[1], inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, { room: "B", from: "main", axis: "x", at: Z.rooms, center: DOOR_B[0], width: DOOR_B[1], inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, { room: "A", from: "main", axis: "x", at: Z.rooms, center: DOOR_A[0], width: DOOR_A[1], inward: 1, hinge: -1 }),
    ];

    // ----- THE FRONT DOOR: from the hallway into the open office -----
    // (a solid, bright wall with a big door; a sign sticks out so it's easy to see from the front)
    const DOOR = { z: 3.0, w: 2.4, h: 3.6 }, DOOR_WALL_H = 4.4, DW = 0.4;
    const doorPiece = (z0, z1, y0, y1) => block(doorWall, 0xffe1a8, X.hall, (y0 + y1) / 2, (z0 + z1) / 2, DW, y1 - y0, z1 - z0, 0.03);
    doorPiece(Z.d - 0.15, DOOR.z - DOOR.w / 2, 0, DOOR_WALL_H);
    doorPiece(DOOR.z + DOOR.w / 2, Z.rooms + 0.15, 0, DOOR_WALL_H);
    doorPiece(DOOR.z - DOOR.w / 2, DOOR.z + DOOR.w / 2, DOOR.h, DOOR_WALL_H);
    block(doorWall, 0xffffff, X.hall, DOOR_WALL_H + 0.05, (Z.d + Z.rooms) / 2, DW + 0.08, 0.1, Z.rooms - Z.d + 0.4, 0.03);
    for (const e of [-1, 1]) block(doorWall, 0xffffff, X.hall, DOOR.h / 2, DOOR.z + e * (DOOR.w / 2 + 0.1), DW + 0.12, DOOR.h, 0.2, 0.04);
    block(doorWall, 0xffffff, X.hall, DOOR.h + 0.1, DOOR.z, DW + 0.12, 0.2, DOOR.w + 0.4, 0.04);
    obstacles.push({ x: X.hall, z: (Z.d + DOOR.z - DOOR.w / 2) / 2 - 0.1, w: DW, d: DOOR.z - DOOR.w / 2 - Z.d + 0.2 });
    obstacles.push({ x: X.hall, z: (DOOR.z + DOOR.w / 2 + Z.rooms) / 2 + 0.1, w: DW, d: Z.rooms - DOOR.z - DOOR.w / 2 + 0.2 });
    const hinge = dynamic(new THREE.Group());
    hinge.position.set(X.hall, 0, DOOR.z + DOOR.w / 2);
    doorWall.add(hinge);
    block(hinge, 0x2f9e5b, 0, DOOR.h / 2, -DOOR.w / 2, 0.14, DOOR.h - 0.04, DOOR.w - 0.04, 0.06);
    block(hinge, 0xc8f5d6, -0.08, DOOR.h * 0.68, -DOOR.w / 2, 0.03, DOOR.h * 0.26, DOOR.w * 0.55, 0.02);
    block(hinge, 0xc8f5d6, 0.08, DOOR.h * 0.68, -DOOR.w / 2, 0.03, DOOR.h * 0.26, DOOR.w * 0.55, 0.02);
    for (const e of [-1, 1]) ball(hinge, 0xffcf3a, e * 0.12, DOOR.h * 0.45, -DOOR.w + 0.3, 0.09);
    const exitTex = canvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = "#1f7a45"; roundRect(ctx, 4, 4, w - 8, h - 8, 30); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 62px Nunito, sans-serif"; ctx.fillText("FRONT DOOR", w / 2, 58);
      ctx.font = "800 40px Nunito, sans-serif"; ctx.fillText("IN  ·  OUT", w / 2, 118);
    });
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false });
    // over the door (both sides), and a sign sticking out of the wall that faces the front
    twoSided(doorWall, exitMat, 2.3, 0.72, X.hall, DOOR.h + 0.42, DOOR.z, Math.PI / 2);
    const BLADE = { x: X.hall - 1.35, z: DOOR.z + DOOR.w / 2 + 0.45 };
    block(doorWall, 0xffffff, BLADE.x, 4.1, BLADE.z, 2.7, 0.95, 0.06, 0.03);
    put(doorWall, new THREE.PlaneGeometry(2.6, 0.82), exitMat, { x: BLADE.x, y: 4.1, z: BLADE.z + 0.035, shadow: false });
    put(doorWall, new THREE.PlaneGeometry(2.6, 0.82), exitMat, { x: BLADE.x, y: 4.1, z: BLADE.z - 0.035, ry: Math.PI, shadow: false });
    slab(doorWall, 0x9aa3b2, BLADE.x + 0.1, 4.62, BLADE.z, 2.9, 0.05, 0.05);
    const matTex = canvasTexture(256, 112, (ctx, w, h) => {
      ctx.fillStyle = "#2f7a4e"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = "#fff"; ctx.font = "800 40px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("WELCOME", w / 2, h / 2 + 2);
    });
    put(top, new THREE.PlaneGeometry(2.6, 1.2), toon(0xffffff, { map: matTex }), { x: X.hall - 0.95, y: 0.03, z: DOOR.z, rx: -Math.PI / 2, rz: Math.PI / 2, shadow: false });
    // the hallway: plants, a bench, and an arrow to the office
    plant(top, 15.2, 11.2, 0.8); plant(top, 15.2, 0.9, 0.7);
    block(top, 0x7a8597, 15.4, 0.45, 5.8, 0.6, 0.12, 2.0, 0.04); block(top, 0x5f6a7c, 15.4, 0.2, 5.0, 0.5, 0.4, 0.1, 0.02); block(top, 0x5f6a7c, 15.4, 0.2, 6.6, 0.5, 0.4, 0.1, 0.02);
    const arrowTex = canvasTexture(256, 128, (ctx) => {
      ctx.fillStyle = "rgba(47,158,91,0.85)";
      ctx.beginPath(); ctx.moveTo(30, 44); ctx.lineTo(150, 44); ctx.lineTo(150, 14); ctx.lineTo(226, 64); ctx.lineTo(150, 114); ctx.lineTo(150, 84); ctx.lineTo(30, 84); ctx.closePath(); ctx.fill();
    });
    put(top, new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, toneMapped: false }), { x: 13.5, y: 0.03, z: 7.5, rx: -Math.PI / 2, rz: Math.PI / 2, shadow: false });

    // ----- the open office desks (from the owner's desk plan) -----
    // yaw = the way the person sitting there looks: 0 = toward the front (down on the plan),
    // Math.PI = toward the back (up on the plan), Math.PI / 2 = to the right.
    const R = Math.PI / 2, UP = Math.PI, DOWN = 0;
    const DESKS = [
      { x: -6.2, z: -3.9, yaw: R },      // 1: by the "A223" sign, facing right
      { x: -5.7, z: -0.2, yaw: DOWN },   // 2: just below it, facing down
      { x: -3.8, z: 1.75, yaw: UP },     // 3: next to that one, facing up
      { x: 1.35, z: 0.95, yaw: R, w: 1.3 }, // 4-7: the row of four, all facing right
      { x: 1.35, z: 2.25, yaw: R, w: 1.3 },
      { x: 1.35, z: 3.55, yaw: R, w: 1.3 },
      { x: 1.35, z: 4.85, yaw: R, w: 1.3 },
      { x: 7.5, z: 1.9, yaw: DOWN },     // 8: below the storage room, facing down
      { x: -13.6, z: 9.7, yaw: UP },     // 9, 10: along the bottom left, facing up
      { x: -8.4, z: 9.7, yaw: UP },
    ];
    const screens = screenMats();
    const deskColors = [[0xff7a59, 0x2f9e5b], [0x5cc84a, 0xff7a59], [0x3ec7c2, 0xffc94a], [0xb58cff, 0x5cc84a], [0xffc94a, 0xb58cff], [0x3ec7c2, 0xff5a64], [0xff9ec7, 0x2f9e5b], [0x8bd17c, 0xff7a59], [0xffc94a, 0x3ec7c2], [0xff7a59, 0xb58cff]];
    const badges = {};
    const deskDefs = []; // (their approach points are worked out at the end, once all the furniture is in)
    DESKS.forEach((d, i) => {
      const n = i + 1, w = d.w || 1.5;
      singleDesk(top, d.x, d.z, d.yaw, w, deskColors[i], screens, i);
      // the number stands on the desk's far corner
      const at = onDesk(d.x, d.z, d.yaw, w / 2 - 0.35, 0.05);
      badges["desk-" + n] = deskBadge(top, n, at.x, 1.3, at.z);
      obstacles.push(deskArea(d.x, d.z, d.yaw, w));
      const seat = onDesk(d.x, d.z, d.yaw, 0, -0.95);
      deskDefs.push({ id: "desk-" + n, kind: "desk", label: "Desk " + n, number: n, room: "main", assignable: true, yaw: d.yaw, width: w, arms: "type", seat: { x: seat.x, z: seat.z, y: 0 } });
    });
    // the workbench along the server room's wall (for fixing computers)
    const WBN = { x: X.ba - 0.85, z0: -11.4, z1: -3.4 };
    block(top, 0xc98f5a, WBN.x, 1.0, (WBN.z0 + WBN.z1) / 2, 1.2, 0.12, WBN.z1 - WBN.z0, 0.04);
    for (const z of [WBN.z0 + 0.2, (WBN.z0 + WBN.z1) / 2, WBN.z1 - 0.2]) for (const dx of [-0.5, 0.5]) block(top, 0x8f96a3, WBN.x + dx, 0.5, z, 0.08, 1.0, 0.08, 0.03);
    block(top, 0x9aa3b2, WBN.x + 0.45, 1.9, (WBN.z0 + WBN.z1) / 2, 0.08, 1.6, WBN.z1 - WBN.z0, 0.02); // pegboard
    for (let i = 0; i < 10; i++) slab(top, [0xff7a59, 0xffc94a, 0x2f3542, 0x5cc84a][i % 4], WBN.x + 0.38, 1.6 + (i % 3) * 0.35, WBN.z0 + 0.6 + i * 0.75, 0.04, 0.3, 0.08, { rx: (i % 2) * 0.4 });
    block(top, 0x2f3542, WBN.x - 0.05, 1.3, -9.2, 0.7, 0.5, 0.9, 0.06); // an open computer being fixed
    block(top, 0x5cc84a, WBN.x - 0.05, 1.3, -9.2, 0.6, 0.4, 0.92, 0.02);
    block(top, 0x2f3542, WBN.x + 0.1, 1.5, -6.2, 0.06, 0.45, 0.75, 0.02); // a test screen
    put(top, geo("screen", () => new THREE.PlaneGeometry(0.72, 0.42)), screens[3], { x: WBN.x + 0.065, y: 1.5, z: -6.2, ry: -R, shadow: false });
    block(top, 0xffc94a, WBN.x - 0.2, 1.12, -4.6, 0.4, 0.12, 0.5, 0.03); // a toolbox
    obstacles.push({ x: WBN.x, z: (WBN.z0 + WBN.z1) / 2, w: 1.3, d: WBN.z1 - WBN.z0 + 0.1 });
    // a printer by the back wall
    block(top, 0xf2f4f7, 1.9, 0.55, -11.2, 1.4, 1.1, 0.9, 0.08);
    block(top, 0x3a3f4a, 1.9, 1.12, -11.2, 1.2, 0.06, 0.7, 0.02);
    block(top, 0xffffff, 1.9, 1.17, -10.95, 0.5, 0.02, 0.4, 0.01);
    obstacles.push({ x: 1.9, z: -11.2, w: 1.5, d: 1.0 });

    // ----- the coffee corner (top left) -----
    const K = { x: X.left + 0.75, z: -9.6 };
    block(top, 0xffffff, K.x, 0.55, K.z, 1.0, 1.1, 3.4, 0.06);
    block(top, 0xf0d3a8, K.x, 1.15, K.z, 1.1, 0.1, 3.5, 0.03);
    block(top, 0x3a3f4a, K.x - 0.05, 1.6, K.z - 0.6, 0.5, 0.8, 0.6, 0.06); // coffee machine
    ball(top, toon(0x5cff8a, { emissive: 0x5cff8a, emissiveIntensity: 1 }), K.x + 0.22, 1.85, K.z - 0.4, 0.04);
    for (let i = 0; i < 3; i++) cylinder(top, [0xff7a59, 0x2f9e5b, 0xffffff][i], K.x + 0.15, 1.28, K.z + 0.5 + i * 0.3, 0.08, 0.18);
    block(top, 0xf2f4f7, K.x, 1.05, K.z + 2.4, 0.95, 2.1, 1.0, 0.1); // fridge
    block(top, 0xc9d2dc, K.x + 0.49, 1.4, K.z + 2.1, 0.04, 0.5, 0.06, 0.02);
    const steam = [];
    for (let i = 0; i < 4; i++) steam.push(dynamic(ball(top, toon(0xffffff, { transparent: true, opacity: 0.6 }), K.x + 0.2, 1.6, K.z - 0.6, 0.06, { shadow: false })));
    anim.push((t) => steam.forEach((s, i) => {
      const k = (t * 0.5 + i / 4) % 1;
      s.position.set(K.x + 0.1 + Math.sin(t * 2 + i) * 0.05, 2.0 + k * 0.6, K.z - 0.6);
      s.scale.setScalar(0.05 + k * 0.08);
      s.material.opacity = 0.6 * (1 - k);
    }));
    const WC = { x: X.left + 0.75, z: -5.6 };
    block(top, 0xf2f4f7, WC.x, 0.75, WC.z, 0.8, 1.5, 0.8, 0.12);
    cylinder(top, toon(0x8fd8ff, { transparent: true, opacity: 0.8 }), WC.x, 1.95, WC.z, 0.36, 0.9);
    block(top, 0x2f9e5b, WC.x + 0.42, 1.15, WC.z, 0.08, 0.1, 0.18, 0.02);
    const T = { x: -11.8, z: -8.3 };
    rug(top, T.x + 0.4, T.z - 0.6, 4.4, 4.0, 0xffc94a, 0xffe08a);
    cylinder(top, 0xffffff, T.x, 1.0, T.z, 0.7, 0.06);
    cylinder(top, 0x8f96a3, T.x, 0.5, T.z, 0.05, 1.0);
    cylinder(top, 0x8f96a3, T.x, 0.03, T.z, 0.35, 0.05);
    cylinder(top, 0xff7a59, T.x + 0.15, 1.1, T.z + 0.1, 0.07, 0.14);
    for (const [sx, sz] of [[1.2, 0.5], [-0.4, -1.2]]) { cylinder(top, 0xff7a59, T.x + sx, 0.62, T.z + sz, 0.3, 0.1); cylinder(top, 0x8f96a3, T.x + sx, 0.3, T.z + sz, 0.04, 0.6); }
    // a comfy sofa by the back wall
    const SO = { x: -9.0, z: Z.back + 0.85 };
    block(top, 0x2f9e5b, SO.x, 0.35, SO.z, 2.8, 0.5, 1.0, 0.15);
    block(top, 0x24804a, SO.x, 0.95, SO.z - 0.4, 2.8, 0.9, 0.3, 0.12);
    block(top, 0x24804a, SO.x - 1.35, 0.65, SO.z, 0.25, 0.6, 1.0, 0.1);
    block(top, 0x24804a, SO.x + 1.35, 0.65, SO.z, 0.25, 0.6, 1.0, 0.1);
    block(top, 0xffc94a, SO.x - 0.8, 0.8, SO.z - 0.1, 0.45, 0.45, 0.2, 0.1, { rx: -0.2 });

    // ----- E: the server room -----
    const ledOn = [0x5cff8a, 0x5cff8a, 0x7ad7ff, 0xffc94a, 0x5cff8a], ledOff = [0x1d5a33, 0x1d5a33, 0x234b66, 0x5a4a1d, 0x1d5a33];
    const ledMats = ledOn.map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const ROWS = [-10.3, -6.9], RACK_X = [6.9, 7.85, 8.8, 9.75, 10.7, 11.65];
    for (const rz of ROWS) {
      for (const rx of RACK_X) serverRack(top, rx, rz, ledMats);
      obstacles.push({ x: (RACK_X[0] + RACK_X[RACK_X.length - 1]) / 2, z: rz, w: RACK_X[RACK_X.length - 1] - RACK_X[0] + 1.0, d: 1.1 });
    }
    anim.push((t) => ledMats.forEach((m, i) => {
      const on = Math.sin(t * (3 + i * 1.7) + i * 2.1) + Math.sin(t * (7.3 + i)) * 0.5 > -0.3;
      m.color.setHex(on ? ledOn[i] : ledOff[i]);
    }));
    // cable trays over the racks, with cables in them
    for (const rz of ROWS) {
      const x0 = RACK_X[0] - 0.6, x1 = 15.0;
      for (const e of [-0.3, 0.3]) slab(top, 0xffc531, (x0 + x1) / 2, 2.95, rz + e, x1 - x0, 0.1, 0.05);
      for (let x = x0; x <= x1; x += 0.5) slab(top, 0xffc531, x, 2.91, rz, 0.05, 0.03, 0.6, { shadow: false });
      [0x4a90e2, 0xff5a64, 0x5cc84a, 0xffffff].forEach((c, i) => slab(top, c, (x0 + x1) / 2, 2.96, rz - 0.18 + i * 0.12, x1 - x0, 0.06, 0.06, { shadow: false }));
      for (const rx of RACK_X) slab(top, 0x4a90e2, rx + 0.3, 2.72, rz, 0.05, 0.42, 0.05, { shadow: false });
    }
    slab(top, 0xffc531, 15.0, 2.95, (ROWS[0] + ROWS[1]) / 2, 0.6, 0.1, ROWS[1] - ROWS[0] + 0.6);
    // the cooling unit (a big air conditioner), with a turning fan
    const CU = { x: 14.8, z: -10.9 };
    block(top, 0xf2f4f7, CU.x, 1.4, CU.z, 1.7, 2.8, 1.0, 0.08);
    for (let i = 0; i < 7; i++) slab(top, 0xb9c1cc, CU.x, 0.35 + i * 0.13, CU.z + 0.51, 1.4, 0.05, 0.02, { shadow: false });
    put(top, new THREE.PlaneGeometry(0.5, 0.28), new THREE.MeshBasicMaterial({ color: 0x7ad7ff, toneMapped: false }), { x: CU.x - 0.4, y: 2.45, z: CU.z + 0.51, shadow: false });
    put(top, G.torus(0.42, 0.05), toon(0x9aa3b2), { x: CU.x + 0.15, y: 1.85, z: CU.z + 0.52 });
    const fan = dynamic(new THREE.Group());
    fan.position.set(CU.x + 0.15, 1.85, CU.z + 0.53);
    top.add(fan);
    for (let i = 0; i < 4; i++) block(fan, 0x7a8597, 0, 0, 0, 0.14, 0.72, 0.02, 0.02, { rz: (i / 4) * Math.PI });
    anim.push((t) => { fan.rotation.z = -t * 6; });
    obstacles.push({ x: CU.x, z: CU.z, w: 1.9, d: 1.2 });
    block(top, 0x3a3f4a, 15.2, 0.5, -7.0, 0.8, 1.0, 0.9, 0.06); // a small UPS box
    for (let i = 0; i < 3; i++) put(top, geo("led", () => new THREE.BoxGeometry(0.045, 0.045, 0.02)), ledMats[i], { x: 15.0 + i * 0.12, y: 0.85, z: -6.54, shadow: false });
    obstacles.push({ x: 15.2, z: -7.0, w: 0.9, d: 1.0 });

    // ----- D: the storage room -----
    const SH_Z = Z.ed + 0.55;
    [[6.4, 2.2, "boxes"], [9.2, 2.4, "screens"], [11.9, 2.2, "parts"]].forEach(([x, w, stuff]) => {
      storageShelf(top, x, SH_Z, w, stuff);
      obstacles.push({ x, z: SH_Z, w: w + 0.1, d: 0.8 });
    });
    cardboard(top, 15.3, 0, -0.8, 0.8, 0.6, 0.7, 0.1); cardboard(top, 15.3, 0.6, -0.8, 0.6, 0.45, 0.55, -0.15);
    cardboard(top, 15.3, 0, -1.75, 0.7, 0.5, 0.6, 0.2);
    obstacles.push({ x: 15.3, z: -0.8, w: 0.9, d: 0.8 }, { x: 15.3, z: -1.75, r: 0.5 });

    // ----- C: the conference room -----
    const MT = { x: (X.cLeft + X.cb) / 2, z: 9.3 };
    block(top, 0xffffff, MT.x, 0.98, MT.z, 1.4, 0.1, 3.2, 0.05);
    block(top, 0x8f96a3, MT.x, 0.5, MT.z, 0.3, 0.95, 2.2, 0.05);
    block(top, 0x8f96a3, MT.x, 0.04, MT.z, 1.0, 0.08, 2.6, 0.03);
    for (let i = 0; i < 3; i++) block(top, 0xffffff, MT.x + (i % 2 ? 0.3 : -0.3), 1.05, MT.z - 1.0 + i * 1.0, 0.3, 0.02, 0.4, 0.01);
    block(top, 0x3a3f4a, MT.x, 1.06, MT.z, 0.24, 0.04, 0.24, 0.02); // speakerphone
    const meetChairs = [];
    for (const side of [-1, 1]) for (const dz of [-0.75, 0.75]) {
      const cx = MT.x + side * 1.0, cz = MT.z + dz, yaw = side < 0 ? R : -R;
      officeChair(top, cx, cz, 0x2e8f86, yaw);
      meetChairs.push({ cx, cz, yaw, side });
    }
    // the screen at the back of the room (facing the table and the camera)
    const TV = { x: MT.x - 0.85, z: Z.rooms + 0.55 };
    block(top, 0x3a3f4a, TV.x, 0.05, TV.z, 0.9, 0.1, 0.6, 0.03);
    block(top, 0x3a3f4a, TV.x, 0.9, TV.z, 0.1, 1.7, 0.1, 0.03);
    block(top, 0x24283b, TV.x, 1.95, TV.z + 0.05, 2.4, 1.4, 0.1, 0.04);
    const slide = canvasTexture(256, 144, (ctx, w, h) => {
      ctx.fillStyle = "#eefaf1"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#2e8f86"; ctx.fillRect(0, 0, w, 26);
      ctx.fillStyle = "#fff"; ctx.font = "800 18px Nunito, sans-serif"; ctx.fillText("Weekly plan", 10, 19);
      [40, 70, 55, 90].forEach((b, i) => { ctx.fillStyle = ["#ff7a59", "#ffc94a", "#5cc84a", "#4a90e2"][i]; ctx.fillRect(130 + i * 28, h - 12 - b, 20, b); });
      ctx.fillStyle = "#9aa8bd"; for (let i = 0; i < 4; i++) ctx.fillRect(12, 42 + i * 20, 90, 6);
    });
    put(top, new THREE.PlaneGeometry(2.2, 1.24), new THREE.MeshBasicMaterial({ map: slide, toneMapped: false }), { x: TV.x, y: 1.95, z: TV.z + 0.11, shadow: false });
    // a whiteboard on the left glass wall
    const cboard = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.strokeStyle = "#2e8f86"; ctx.strokeRect(20, 20, 60, 36); ctx.strokeRect(150, 20, 60, 36); ctx.strokeRect(85, 80, 60, 36);
      ctx.strokeStyle = "#ff7a59"; ctx.beginPath(); ctx.moveTo(80, 38); ctx.lineTo(150, 38); ctx.moveTo(115, 56); ctx.lineTo(115, 80); ctx.stroke();
    });
    block(top, 0xc9d6cf, X.cLeft + 0.22, 2.0, MT.z, 0.06, 1.2, 2.2, 0.03);
    put(top, new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: cboard, toneMapped: false }), { x: X.cLeft + 0.26, y: 2.0, z: MT.z, ry: R, shadow: false });
    obstacles.push({ x: MT.x, z: MT.z, w: 1.5, d: 3.3 }, { x: TV.x, z: TV.z, w: 2.5, d: 0.7 }); // (the chairs push in under the table)

    // ----- B and A: the private offices -----
    // (the desk by B's left wall and by A's right wall; the person sits with their back to the wall)
    const OFF = {
      B: { x: X.cb + 1.75, z: 9.0, yaw: R, accent: 0xc0603e, n: 1, rug: 0xf6cfbf },
      A: { x: X.hall - 1.75, z: 9.0, yaw: -R, accent: 0x7b55c4, n: 2, rug: 0xd9c8f5 },
    };
    for (const id of ["B", "A"]) {
      const o = OFF[id];
      rug(top, (id === "B" ? X.cb + 2.6 : X.hall - 2.6), o.z, 3.6, 3.6, o.accent, o.rug);
      officeDesk(top, o.x, o.z, o.yaw, o.accent, screens, o.n);
      obstacles.push(deskArea(o.x, o.z, o.yaw, 2.4));
      const seat = onDesk(o.x, o.z, o.yaw, 0, -1.0);
      deskDefs.push({ id: "office-" + id, kind: "desk", label: "Office " + id, room: id, private: true, assignable: true, yaw: o.yaw, width: 2.4, arms: "type", seat: { x: seat.x, z: seat.z, y: 0 } });
      // a guest chair on the other side of the desk
      const guest = onDesk(o.x, o.z, o.yaw, 0.3, 1.15);
      officeChair(top, guest.x, guest.z, o.rug, o.yaw + Math.PI);
      obstacles.push({ x: guest.x, z: guest.z, r: 0.45 });
    }
    // personal touches: B has a bookshelf and a plant; A a cabinet with a plant, a floor lamp and a picture
    bookshelf(top, X.ba - 0.4, 10.2, -R, 1.9);
    obstacles.push({ x: X.ba - 0.4, z: 10.2, w: 0.6, d: 2.0 });
    plant(top, X.cb + 0.7, Z.front - 0.7, 0.6);
    obstacles.push({ x: X.cb + 0.7, z: Z.front - 0.7, r: 0.5 });
    // (the cabinet stands left of A's door: the door hangs on that side and opens against the wall by it)
    block(top, 0xb27a48, 5.95, 0.55, Z.rooms + 0.45, 1.5, 1.1, 0.6, 0.05);
    for (let i = 0; i < 2; i++) block(top, 0xd9a874, 5.95 + (i - 0.5) * 0.72, 0.55, Z.rooms + 0.76, 0.64, 0.9, 0.02, 0.02);
    plant(top, 5.55, Z.rooms + 0.45, 0.45);
    for (let i = 0; i < 2; i++) block(top, [0x4a90e2, 0xffc94a][i], 6.2 + i * 0.3, 1.25, Z.rooms + 0.45, 0.2, 0.3 - i * 0.1, 0.3, 0.02);
    obstacles.push({ x: 5.95, z: Z.rooms + 0.45, w: 1.7, d: 0.8 });
    cylinder(top, 0x3a3f4a, X.hall - 0.6, 0.03, Z.front - 0.7, 0.28, 0.06);
    cylinder(top, 0x3a3f4a, X.hall - 0.6, 1.2, Z.front - 0.7, 0.04, 2.4);
    cylinder(top, toon(0xfff1c2, { emissive: 0xffe9a8, emissiveIntensity: 0.5 }), X.hall - 0.6, 2.45, Z.front - 0.7, 0.3, 0.35);
    obstacles.push({ x: X.hall - 0.6, z: Z.front - 0.7, r: 0.35 });
    const pic = canvasTexture(128, 96, (ctx, w, h) => {
      ctx.fillStyle = "#9fe3ff"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffd36b"; ctx.beginPath(); ctx.arc(96, 26, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = "#5cc84a"; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(44, 34); ctx.lineTo(80, h); ctx.fill();
      ctx.fillStyle = "#46b04a"; ctx.beginPath(); ctx.moveTo(50, h); ctx.lineTo(90, 48); ctx.lineTo(128, h); ctx.fill();
    });
    block(top, 0xffffff, X.ba + 0.6, 1.6, Z.front - 1.2, 0.08, 0.95, 1.2, 0.03, { ry: 0.5 });
    put(top, new THREE.PlaneGeometry(1.0, 0.75), new THREE.MeshBasicMaterial({ map: pic, toneMapped: false }), { x: X.ba + 0.65, y: 1.6, z: Z.front - 1.2 + 0.0, ry: R + 0.5, shadow: false });
    block(top, 0x3a3f4a, X.ba + 0.55, 0.6, Z.front - 1.2, 0.06, 1.2, 0.06, 0.02);
    block(top, 0x3a3f4a, X.ba + 0.55, 0.03, Z.front - 1.2, 0.4, 0.06, 0.6, 0.02);
    obstacles.push({ x: X.ba + 0.6, z: Z.front - 1.2, r: 0.55 });

    // ----- plants in the open office -----
    for (const [x, z, s] of [[-15.1, -0.4, 0.8], [-15.1, 4.9, 0.8], [-6.7, 5.3, 0.7], [-15.2, 11.3, 0.6], [6.1, 5.3, 0.6], [10.2, 5.3, 0.6], [-2.3, -11.2, 0.8]]) {
      plant(top, x, z, s);
      obstacles.push({ x, z, r: 0.85 * s });
    }

    // (the hallway is outside the office: Miis only walk there on the way in and out)
    obstacles.push({ x: (X.hall + X.right) / 2 + 0.25, z: (Z.d + Z.front) / 2 + 0.25, w: X.right - X.hall + 0.5, d: Z.front - Z.d + 0.5 });
    // coffee corner, water cooler, table and stools, sofa
    obstacles.push({ x: K.x, z: K.z + 0.9, w: 1.2, d: 5.2 }, { x: WC.x, z: WC.z, r: 0.6 }, { x: T.x, z: T.z, r: 0.8 },
      { x: T.x + 1.2, z: T.z + 0.5, r: 0.35 }, { x: T.x - 0.4, z: T.z - 1.2, r: 0.35 }, { x: SO.x, z: SO.z, w: 3.0, d: 1.2 });

    // ----- where Miis can be -----
    // A desk's approach point: behind the chair if there's room, else beside it.
    const blocked = (x, z) => x < B.minX + 0.2 || x > B.maxX - 0.2 || z < B.minZ + 0.2 || z > B.maxZ - 0.2 || obstacles.some((o) => root.MiiNav.insideShape(o, x, z, 0.47));
    const workSpots = deskDefs.map((d) => {
      const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
      const k = d.width / 2 + 0.62; // (beside it: past the end of the desk)
      const tries = [[-fx * 1.25, -fz * 1.25], [fz * k, -fx * k], [-fz * k, fx * k], [-fx * 0.6 + fz * k, -fz * 0.6 - fx * k], [-fx * 0.6 - fz * k, -fz * 0.6 + fx * k]];
      const t = tries.find(([ox, oz]) => !blocked(d.seat.x + ox, d.seat.z + oz)) || tries[0];
      const spot = Object.assign({ x: d.seat.x + t[0], z: d.seat.z + t[1] }, d);
      delete spot.width;
      return spot;
    });
    // (the first Miis of the day sit nearest the front, where they're easy to see)
    const shared = workSpots.filter((s) => !s.private).sort((a, b) => b.seat.z - a.seat.z || a.number - b.number);
    workSpots.splice(0, workSpots.length, ...shared, ...workSpots.filter((s) => s.private));
    workSpots.push(
      { id: "coffee", kind: "coffee", x: K.x + 1.3, z: K.z - 0.4, yaw: -R, arms: "eat" },
      { id: "water", kind: "water", x: WC.x + 1.2, z: WC.z, yaw: -R, arms: "eat" },
      { id: "table", kind: "coffee", x: T.x + 1.45, z: T.z - 1.0, yaw: -R - 0.6, arms: "eat" },
      { id: "sofa", kind: "sofa", x: SO.x, z: SO.z + 1.4, yaw: 0, arms: "down", seat: { x: SO.x + 0.3, z: SO.z + 0.05, y: 0 } },
      { id: "stretch-1", kind: "stretch", x: -10.6, z: 3.6, yaw: 0, arms: "cheer" },
      { id: "stretch-2", kind: "stretch", x: -1.8, z: -6.0, yaw: 0, arms: "cheer" },
      { id: "window-1", kind: "window", x: -13.0, z: B.minZ + 0.75, yaw: UP, arms: "down", lookUp: 0.15 },
      { id: "window-2", kind: "window", x: X.left + 0.95, z: 2.4, yaw: -R, arms: "down", lookUp: 0.15 },
      { id: "board", kind: "board", x: X.left + 1.0, z: WB.z, yaw: -R, arms: "down", lookUp: 0.2 },
      { id: "workbench-1", kind: "workbench", x: WBN.x - 1.25, z: -9.2, yaw: R, arms: "type" },
      { id: "workbench-2", kind: "workbench", x: WBN.x - 1.25, z: -6.2, yaw: R, arms: "type" },
      { id: "server-1", kind: "server", room: "E", x: 9.3, z: -5.3, yaw: UP, arms: "type" },
      { id: "server-2", kind: "server", room: "E", x: 10.9, z: -8.6, yaw: UP, arms: "type" },
      { id: "storage-1", kind: "storage", room: "D", x: 9.2, z: -1.3, yaw: UP, arms: "down", lookUp: 0.2 },
      { id: "storage-2", kind: "storage", room: "D", x: 11.9, z: -1.3, yaw: UP, arms: "down", lookUp: 0.1 }
    );
    // (the conference room's chairs: only for a little meeting now and then, see officeHub.js)
    meetChairs.forEach((c, i) => workSpots.push({ id: "meeting-" + (i + 1), kind: "meeting", room: "C", gather: true, x: c.cx + c.side * 0.7, z: c.cz, yaw: c.yaw, arms: "down", seat: { x: c.cx, z: c.cz, y: 0 } }));

    // ----- the rooms -----
    const rooms = [
      { id: "main", name: "A223 Information Technology", kind: "open", areas: [{ minX: X.left, maxX: X.ba, minZ: Z.back, maxZ: Z.d }, { minX: X.left, maxX: X.hall, minZ: Z.d, maxZ: Z.rooms }, { minX: X.left, maxX: X.cLeft, minZ: Z.rooms, maxZ: Z.front }] },
      { id: "A", name: "Office A", kind: "office", private: true, areas: [{ minX: X.ba, maxX: X.hall, minZ: Z.rooms, maxZ: Z.front }] },
      { id: "B", name: "Office B", kind: "office", private: true, areas: [{ minX: X.cb, maxX: X.ba, minZ: Z.rooms, maxZ: Z.front }] },
      { id: "C", name: "Conference room", kind: "conference", areas: [{ minX: X.cLeft, maxX: X.cb, minZ: Z.rooms, maxZ: Z.front }] },
      { id: "D", name: "Storage room", kind: "storage", areas: [{ minX: X.ba, maxX: X.right, minZ: Z.ed, maxZ: Z.d }] },
      { id: "E", name: "Server room", kind: "server", areas: [{ minX: X.ba, maxX: X.right, minZ: Z.back, maxZ: Z.ed }] },
      { id: "hall", name: "Hallway", kind: "hallway", outside: true, areas: [{ minX: X.hall, maxX: X.right, minZ: Z.d, maxZ: Z.front }] },
    ];

    mergeStatic(top);
    scene.add(top);
    for (const wall of [backWall, leftWall, rightWall, doorWall]) { mergeStatic(wall); scene.add(wall); }
    // where each wall is, and which way is into the room (for hiding it when the camera is behind it)
    const walls = [
      { group: backWall, point: new THREE.Vector3(0, 0, Z.back), normal: new THREE.Vector3(0, 0, 1) },
      { group: leftWall, point: new THREE.Vector3(X.left, 0, 0), normal: new THREE.Vector3(1, 0, 0) },
      { group: rightWall, point: new THREE.Vector3(X.right, 0, 0), normal: new THREE.Vector3(-1, 0, 0) },
      // (the front door's wall is tall: it hides too when you look from the hallway side)
      { group: doorWall, point: new THREE.Vector3(X.hall, 0, 0), normal: new THREE.Vector3(-1, 0, 0) },
    ];

    const doorPoint = { x: X.hall - 1.0, z: DOOR.z };
    const outsidePath = [{ x: X.hall + 0.9, z: DOOR.z }, { x: 13.5, z: DOOR.z + 1.0 }, { x: 13.5, z: Z.front - 1.6 }];
    let doorK = 0, lastT = null;
    return {
      root: top,
      bounds: B,
      obstacles,
      workSpots,
      rooms,
      doorPoint,
      outsidePath,
      outsidePoint: outsidePath[outsidePath.length - 1],
      insidePoint: { x: 7.0, z: 3.6 },
      cameraView: { target: [-0.3, 0.6, 0.4], tilt: 0.95, yaw: -0.12, width: 35, azimuth: [-Infinity, Infinity], polar: [0.3, 1.3] },
      walls, // [{ group, point, normal }]: hidden while the camera is behind them
      background: 0xdff3e4,
      setOwner(spotId, name) {
        if (badges[spotId]) badges[spotId].redraw(name || null);
        const room = /^office-(\w+)$/.exec(spotId);
        if (room && signs[room[1]]) signs[room[1]](name || null);
      },
      doors, // [{ room, from, axis, at, center, width, point, inside, outside, open }]: the room doors
      update(t, info) {
        const dt = lastT === null ? 0 : Math.max(0, Math.min(0.25, t - lastT));
        lastT = t;
        anim.forEach((a) => a(t, info));
        const instant = !!(info && info.reduced);
        // the front door swings open (into the hallway) while someone is going through it
        const want = info && info.door ? 1 : 0;
        doorK = instant ? want : doorK + (want - doorK) * (1 - Math.exp(-dt * 7));
        hinge.rotation.y = -doorK * 1.5;
        // a room door opens when someone is near it (walking through), and closes after
        const people = (info && info.people) || [];
        for (const d of doors) {
          let near = false;
          for (const q of people) if (Math.abs(q.x - d.point.x) < 2.3 && Math.abs(q.z - d.point.z) < 2.3) { near = true; break; }
          d.step(near ? 1 : 0, dt, instant);
        }
      },
    };
  }

  root.NSCCOffice = { build };
})(typeof self !== "undefined" ? self : this);
