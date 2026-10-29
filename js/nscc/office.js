/*
 * js/nscc/office.js
 * THE OFFICE: A223 Information Technology, built from the owner's 3D model of the real office
 * (models/office-a223.stl), with the desks where the owner's desk plan puts them.
 *
 *            back wall (windows)                                   x: left -> right
 *   +-------------------------------+--+------------------------+  z: back -> front
 *   | coffee                        |w |                        |
 *   | corner                        |o |  E  SERVER ROOM        |
 *   |            1 ->               |r |                        |
 *   |                               |k |                 [d]    |  (E's door: from D)
 *   |          2 (v) [#]            |  +-------------------+----+
 *   |               3 (^)  4 ->    [d]   D  STORAGE           |  (D's door: on the workbench wall)
 *   |  [#] = the column     5 ->   [#]-----------------------[#]
 *   |                       6 ->        8 (v)  [FRONT DOOR] |   hallway (outside: Miis come
 *   |                       7 ->                 (glass)    |   in and go out this way)
 *   |            +--------+--------+--------+  (side door)  |
 *   |  9 (^)     |   C    |   B    |   A    |               |
 *   | 10 (^)     | confer-| office | office |               |
 *   +------------+--------+--------+--------+               |
 *            front wall
 *   (numbers = desks; arrows = the way the person sitting there looks; [d] = a door)
 *
 * HOW THE MODEL IS USED. The model is not loaded by the page. It was measured with
 * tools/measure-office.js (wall faces, doors, windows, columns, the floor), and those
 * measurements (in inches, the model's own units) are in PLAN below. The office is built
 * again from them with clean, simple shapes: straight walls, a solid floor, the columns.
 * What the model had that's left out: slanted shards sticking out of the walls and floor,
 * and holes in the floor. What's added that the model doesn't have: the front wall (the
 * model is open at the front), and the hallway's floor and outer wall. 1 unit here = 24
 * inches (2 feet), so the Miis and desks keep the size they always had.
 * To update it from a new model: see "The office's 3D model" in README.md.
 *
 * Everything about the room lives in this one file. To use a different office,
 * write a new file with the same build() and load it in index.html instead.
 * Nothing else needs to change.
 *
 *   NSCCOffice.build(scene) -> {
 *     root,        THREE.Group with the whole room (already added to the scene)
 *     bounds,      { minX, maxX, minZ, maxZ }  the floor area Miis can walk on
 *     obstacles,   [shape]  things Miis walk around, walls and columns too (shapes: see js/nav.js)
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
 *     cameraView,  { target: [x, y, z], yaw, tilt, fit: { minX, maxX, minZ, maxZ }, pan: { minX, maxX, minZ, maxZ } }
 *                  the starting ("Center") view: looking at target from direction yaw (radians,
 *                  0 = from the front, PI / 2 = from the right), tilt = how high (up / across);
 *                  fit = the floor area that must be on screen; pan = where the view's middle may go
 *     walls,       (optional) [{ id, group, point, normal, setCut(k) }]: the OUTER walls. A wall
 *                  between the camera and the room is lowered (setCut(1): cut down to a low strip,
 *                  like a dollhouse) and comes back up (setCut(0)) when the camera moves round
 *     roomWalls,   (optional) [{ id, between: [roomId, roomId], opaque }]: the walls inside the
 *                  office. They always stay up and solid (you look into a room from above)
 *     floor,       the floor (one solid piece under everything)
 *     background,  the color behind everything
 *     setOwner(spotId, name)  optional: show who a desk / office belongs to ("" or null = nobody)
 *     doors,       (optional) [{ room, from, axis, at, center, width, point, inside, outside, open }]:
 *                  the room doors (open = how far open, 0..1)
 *     plan,        (optional) the measurements the office was built from (see PLAN)
 *     update(t, info)  optional: animations (t = seconds). info.door = true while someone goes
 *                  through the front door, info.people = [{ x, z }] where the Miis are (room doors
 *                  open when someone is near), info.reduced = no animation (doors snap),
 *                  info.now = the time (ms, for the wall clock)
 *   }
 *
 * The walls are as tall as the model's (9 feet) and solid. There's no ceiling, so you look
 * in from above. The room is built from simple shapes with toon shading (a few flat bands
 * of light), like the rest of the look.
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
    const toLocal = new THREE.Matrix4().copy(top.matrixWorld).invert(); // (merged pieces stay where they were inside `top`)
    const skip = new Set();
    top.traverse((o) => { if (o !== top && (o.userData.dynamic || o.userData.merged)) o.traverse((c) => skip.add(c)); });
    const buckets = new Map(), remove = [];
    top.traverse((o) => {
      if (!o.isMesh || skip.has(o) || Array.isArray(o.material)) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(n)) g.deleteAttribute(n);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld));
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


  // =====================================================================
  // THE MEASUREMENTS, from models/office-a223.stl (inches, the model's units).
  // In the model x goes left -> right, y goes front -> back and z is up.
  // (tools/measure-office.js prints these; tests/office.test.js checks them against the model)
  // =====================================================================
  const PLAN = {
    model: "models/office-a223.stl",
    inchesPerUnit: 24,           // 1 unit in the 3D office = 24 inches (2 feet)
    center: { x: -1, y: 185 },   // the model point that becomes the middle (0, 0) of the office
    floorZ: 12, topZ: 120,       // the top of the model's floor, and of its walls (a 9 foot room)
    doorHead: 85.6,              // how high the doorways are (above the floor)
    windowSill: 37.5,            // how high the window sills are (above the floor)
    // A wall: axis = the way it runs ("x": left to right, "y": front to back), t = where it is
    // across (its two faces), from..to = where it starts and ends along, room = which side the
    // room is on (+1 = the bigger x or y), open = doorways and windows along it (a..b).
    // added = not in the model (built because the office needs it); model = only that part is.
    outer: [
      { id: "west", axis: "y", t: [-369, -357], from: -179, to: 549, room: 1,
        open: [{ a: 311, b: 335, kind: "window" }, { a: 383, b: 407, kind: "window" }] },
      { id: "back", axis: "x", t: [537, 549], from: -357, to: 362, room: -1,
        open: [{ a: -223, b: -199, kind: "window" }, { a: -151, b: -127, kind: "window" }, { a: 129, b: 153, kind: "window" }, { a: 201, b: 225, kind: "window" }] },
      { id: "east", axis: "y", t: [362, 367], from: -179, to: 549, room: -1, model: [169, 549] }, // (the hallway's part is added)
      { id: "front", axis: "x", t: [-179, -173], from: -357, to: 251.5, room: 1, added: true },    // (the model is open at the front)
      // the wall between the office and the hallway: A's side wall, then glass and the two doors
      { id: "hallway", axis: "y", t: [251.5, 256.8], from: -179, to: 177, room: -1,
        open: [{ a: -9.4, b: 22.5, kind: "closed-door" }, { a: 24.6, b: 100.6, kind: "glass" }, { a: 101, b: 137, kind: "front-door" }, { a: 138.6, b: 176.6, kind: "glass" }] },
    ],
    inner: [
      // (the workbench wall: the main room | E and D; D's door is in it, past the end of the workbench)
      { id: "workbench", axis: "y", t: [112, 122], from: 182, to: 537, between: ["main", "E"], open: [{ a: 194, b: 234, kind: "door", room: "D" }] },
      { id: "E-D", axis: "x", t: [274, 279], from: 122, to: 362, between: ["E", "D"], open: [{ a: 250, b: 288, kind: "door", room: "E" }] },
      { id: "D-main", axis: "x", t: [177, 182], from: 131.6, to: 348.6, between: ["D", "main"] },
      // C, B and A's wall to the main room: each door has a narrow frosted panel beside it
      { id: "rooms", axis: "x", t: [-17, -12], from: -126.2, to: 251.5, between: ["main", "C"],
        open: [{ a: -60, b: -40, kind: "sidelight" }, { a: -40, b: -0.2, kind: "door", room: "C" }, { a: 65, b: 85, kind: "sidelight" }, { a: 85, b: 125.8, kind: "door", room: "B" },
          { a: 130.6, b: 170, kind: "door", room: "A" }, { a: 170, b: 190, kind: "sidelight" }] },
      { id: "C-west", axis: "y", t: [-126.2, -121.4], from: -173, to: -17, between: ["main", "C"] },
      { id: "C-B", axis: "y", t: [-0.2, 4.6], from: -173, to: -17, between: ["C", "B"] },
      { id: "B-A", axis: "y", t: [125.8, 130.6], from: -173, to: -17, between: ["B", "A"] },
    ],
    // the building's columns (kept from the model): the one standing in the main room, the
    // ones at D's corners, and the ones built into the outer walls
    columns: [
      { id: "column", x: [-127, -111], y: [171, 187], free: true },
      { id: "D-corner", x: [110.4, 131.6], y: [167.4, 189.6] },
      { id: "D-corner-east", x: [348.6, 362], y: [169, 187.9] },
      { id: "west-pilaster", x: [-357, -349], y: [171, 187], wall: "west" },
      { id: "back-pilaster", x: [-127, -111], y: [529, 537], wall: "back" },
      { id: "back-pilaster-E", x: [113, 125.4], y: [529, 537], wall: "back" },
      { id: "back-corner-E", x: [353, 362], y: [529, 537], wall: "back" },
      { id: "back-corner-W", x: [-357, -349], y: [529, 537], wall: "back" },
    ],
    hallway: { x: [256.8, 362], y: [-179, 177] }, // (outside the office; the model has no floor here: added)
    footprint: { x: [-369, 367], y: [-179, 549] },
  };
  const IN = PLAN.inchesPerUnit;
  const wx = (x) => (x - PLAN.center.x) / IN, wz = (y) => (PLAN.center.y - y) / IN, ins = (v) => v / IN;
  const WALL_H = ins(PLAN.topZ - PLAN.floorZ), DOOR_H = ins(PLAN.doorHead), CUT_H = 0.3;
  const WALL_C = 0xeef5ea, OUTER_C = 0xe3f1e0, PANEL_C = 0x4f9a6a, CAP_C = 0x2f6f4a, COLUMN_C = 0xf3f1e6, PANEL_H = 1.0;

  // A wall from PLAN, in the office's units: c = its middle line, t = how thick, u0..u1 = along it.
  function worldRun(def) {
    const alongX = def.axis === "x";
    const ca = alongX ? wz(def.t[0]) : wx(def.t[0]), cb = alongX ? wz(def.t[1]) : wx(def.t[1]);
    const conv = alongX ? wx : wz;
    const ua = conv(def.from), ub = conv(def.to);
    const open = (def.open || []).map((o) => {
      const a = conv(o.a), b = conv(o.b);
      return Object.assign({}, o, { u0: Math.min(a, b), u1: Math.max(a, b) });
    }).sort((p, q) => p.u0 - q.u0);
    // which side the room is on, in the office (the model's y runs the other way to z)
    const side = def.room === undefined ? 0 : alongX ? -def.room : def.room;
    return { def, alongX, axis: alongX ? "x" : "z", c: (ca + cb) / 2, t: Math.abs(cb - ca), u0: Math.min(ua, ub), u1: Math.max(ua, ub), open, side };
  }
  // A box along a wall: u0..u1 along it, y0..y1 up, `off` out from its middle line, `thick` across.
  function wallBox(g, w, color, u0, u1, y0, y1, off, thick, o) {
    const mid = (u0 + u1) / 2, l = u1 - u0, h = y1 - y0, t = thick === undefined ? w.t : thick;
    if (l <= 0.001 || h <= 0.001) return null;
    return w.alongX ? slab(g, color, mid, (y0 + y1) / 2, w.c + (off || 0), l, h, t, o) : slab(g, color, w.c + (off || 0), (y0 + y1) / 2, mid, t, h, l, o);
  }
  // A flat picture on a wall (or in it), facing `side` (+1 / -1 across the wall).
  function wallPicture(g, w, mat, u0, u1, y0, y1, off, side) {
    const pg = new THREE.PlaneGeometry(u1 - u0, y1 - y0);
    const mid = (u0 + u1) / 2, y = (y0 + y1) / 2;
    if (w.alongX) return put(g, pg, mat, { x: mid, y, z: w.c + off, ry: side > 0 ? 0 : Math.PI, shadow: false });
    return put(g, pg, mat, { x: w.c + off, y, z: mid, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2, shadow: false });
  }
  const point = (w, u, off) => (w.alongX ? { x: u, z: w.c + (off || 0) } : { x: w.c + (off || 0), z: u });

  // Builds one wall: solid where the model is solid, with its doorways and windows. Returns the
  // stretches that reach the floor (for walking round and for the top of a lowered wall).
  // sides = the faces that get the green panelling (the room sides).
  function buildWall(g, w, color, sides, obstacles, mats) {
    const solids = [];
    let s = w.u0;
    for (const op of w.open) {
      solids.push([s, op.u0, 0, WALL_H]);
      const head = op.kind === "window" ? WALL_H - 0.22 : op.kind === "glass" ? ins(88) : DOOR_H;
      const sill = op.kind === "window" ? ins(PLAN.windowSill) : op.kind === "glass" ? 0.12 : 0;
      if (sill > 0) solids.push([op.u0, op.u1, 0, sill]);
      solids.push([op.u0, op.u1, head, WALL_H]);
      const frame = (y0, y1) => { // white posts at both ends of the opening
        for (const e of [op.u0, op.u1]) wallBox(g, w, 0xffffff, e - 0.05, e + 0.05, y0, y1, 0, w.t + 0.06);
      };
      if (op.kind === "window") {
        for (const sd of [-1, 1]) wallPicture(g, w, mats.sky, op.u0, op.u1, sill, head, sd * 0.01, sd);
        wallBox(g, w, 0xffffff, op.u0 - 0.06, op.u1 + 0.06, sill - 0.04, sill + 0.06, 0, w.t + 0.16); // the sill
        wallBox(g, w, 0xffffff, op.u0 - 0.06, op.u1 + 0.06, head - 0.05, head + 0.05, 0, w.t + 0.08);
        wallBox(g, w, 0xffffff, op.u0, op.u1, (sill + head) / 2 - 0.03, (sill + head) / 2 + 0.03, 0, 0.06);
        frame(sill, head);
      } else if (op.kind === "glass") {
        wallPicture(g, w, mats.glass, op.u0, op.u1, sill, head, 0, 1);
        wallBox(g, w, 0xffffff, op.u0, op.u1, head - 0.06, head + 0.04, 0, w.t + 0.06);
        wallBox(g, w, 0xffffff, op.u0, op.u1, sill - 0.02, sill + 0.06, 0, w.t + 0.06);
        frame(0, head);
      } else if (op.kind === "sidelight") {
        // a narrow frosted panel beside a door (it lets light through, but you can't see through it)
        wallBox(g, w, 0xcfe9d8, op.u0, op.u1, 0.12, DOOR_H - 0.05, 0, 0.06);
        wallBox(g, w, 0xffffff, op.u0, op.u1, 0, 0.12, 0, w.t);
        frame(0, DOOR_H);
      } else if (op.kind === "closed-door") {
        // a second door to the hallway, not used (it stays shut)
        const lu0 = op.u0 + 0.1, lu1 = op.u1 - 0.1;
        wallBox(g, w, 0x2f9e5b, lu0, lu1, 0.02, DOOR_H - 0.05, 0, 0.12);
        for (const sd of [-1, 1]) {
          wallBox(g, w, 0xc8f5d6, lu0 + 0.3, lu1 - 0.3, DOOR_H * 0.55, DOOR_H * 0.85, sd * 0.065, 0.02);
          const p = point(w, lu1 - 0.2, sd * 0.1);
          ball(g, 0xffcf3a, p.x, DOOR_H * 0.42, p.z, 0.08);
        }
        frame(0, DOOR_H);
        wallBox(g, w, 0xffffff, op.u0 - 0.05, op.u1 + 0.05, DOOR_H - 0.02, DOOR_H + 0.1, 0, w.t + 0.06);
      }
      s = op.u1;
    }
    solids.push([s, w.u1, 0, WALL_H]);
    for (const [a, b, y0, y1] of solids) wallBox(g, w, color, a, b, y0, y1);
    // green panelling and a white rail along the bottom, on the room sides
    for (const sd of sides) for (const [a, b, y0, y1] of solids) {
      if (y0 > 0 || b - a < 0.05) continue;
      wallBox(g, w, PANEL_C, a, b, 0, Math.min(y1, PANEL_H), sd * (w.t / 2 + 0.015), 0.03);
      if (y1 > PANEL_H + 0.1) wallBox(g, w, 0xffffff, a, b, PANEL_H - 0.02, PANEL_H + 0.06, sd * (w.t / 2 + 0.03), 0.06);
    }
    // where nobody can walk: all of it but the doorways
    const runs = [];
    s = w.u0;
    for (const op of w.open) if (op.kind === "door" || op.kind === "front-door") { runs.push([s, op.u0]); s = op.u1; }
    runs.push([s, w.u1]);
    for (const [a, b] of runs) {
      if (b - a < 0.02) continue;
      const m = point(w, (a + b) / 2);
      obstacles.push(w.alongX ? { x: m.x, z: m.z, w: b - a, d: w.t } : { x: m.x, z: m.z, w: w.t, d: b - a });
    }
    return runs;
  }
  // the dark top of a wall (seen from above, it draws the floor plan)
  function wallTop(g, w, runs, y) {
    for (const [a, b] of runs) wallBox(g, w, CAP_C, a - 0.01, b + 0.01, y - 0.04, y + 0.04, 0, w.t + 0.04);
  }
  // A column (from the model's footprint, in inches): light with a green foot and a dark top.
  // (plain square boxes, like the walls)
  function column(g, c, obstacles) {
    const x0 = wx(c.x[0]), x1 = wx(c.x[1]), z0 = wz(c.y[1]), z1 = wz(c.y[0]);
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    slab(g, COLUMN_C, x, WALL_H / 2, z, w, WALL_H, d);
    slab(g, PANEL_C, x, 0.25, z, w + 0.06, 0.5, d + 0.06);
    slab(g, 0xffffff, x, 0.52, z, w + 0.1, 0.06, d + 0.1);
    slab(g, CAP_C, x, WALL_H, z, w + 0.04, 0.08, d + 0.04);
    obstacles.push({ x, z, w, d });
    return { id: c.id, x, z, w, d, free: !!c.free };
  }

  // A sign over a doorway, on both faces of the wall. Returns redraw(owner) for the name.
  function doorSign(p, w, center, letter, name, color) {
    const live = liveTexture(512, 160, (ctx, cw, ch, owner) => {
      ctx.fillStyle = color; roundRect(ctx, 4, 4, cw - 8, ch - 8, 34); ctx.fill();
      ctx.fillStyle = "#ffffff"; roundRect(ctx, 18, 18, 124, ch - 36, 24); ctx.fill();
      ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 96px Nunito, sans-serif"; ctx.fillText(letter, 80, ch / 2 + 6);
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
      if (owner) {
        fitText(ctx, name, cw - 190, 38, 700); ctx.fillText(name, 162, ch / 2 - 26);
        fitText(ctx, owner, cw - 190, 54); ctx.fillText(owner, 162, ch / 2 + 24);
      } else {
        fitText(ctx, name, cw - 190, 50); ctx.fillText(name, 162, ch / 2 + 4);
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: live.tex, toneMapped: false });
    const y = (DOOR_H + WALL_H) / 2 + 0.02;
    for (const sd of [-1, 1]) wallPicture(p, w, mat, center - 0.75, center + 0.75, y - 0.24, y + 0.24, sd * (w.t / 2 + 0.02), sd);
    return live.redraw;
  }
  // A door in a doorway (wood, with a little window and a handle on both sides), hanging on one
  // side of the frame. It swings into the room (about 88 degrees) when someone comes near and
  // closes again after. Where it stands when open goes in `obstacles`, so nobody walks into it.
  const LEAF_H = DOOR_H - 0.1, LEAF_T = 0.08, OPEN_ANGLE = 1.54;
  function roomDoor(p, obstacles, w, op, o) {
    const center = (op.u0 + op.u1) / 2, width = op.u1 - op.u0;
    const len = width - 0.2; // (inside the white frame posts)
    const hingeU = center + o.hinge * (width / 2 - 0.1);
    const at = (u, v) => (w.alongX ? { x: u, z: v } : { x: v, z: u });
    // the way the door points from its hinge: closed (across the doorway) and open (into the room)
    const dirAt = (k) => {
      const a = k * OPEN_ANGLE;
      const du = -o.hinge * Math.cos(a), dv = o.inward * Math.sin(a);
      return w.alongX ? { x: du, z: dv } : { x: dv, z: du };
    };
    const yawFor = (d) => Math.atan2(-d.z, d.x); // (turns the door's local +x onto d)
    const h = at(hingeU, w.c);
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
      block(pivot, 0xe8c294, len / 2, 1.1, side * (LEAF_T / 2 + 0.005), len - 0.36, 1.3, 0.02, 0.02); // a raised panel
      block(pivot, 0x4f9a6a, len / 2, LEAF_H - 0.75, side * (LEAF_T / 2 + 0.006), len - 0.3, 0.9, 0.02, 0.02); // the window's green frame
      slab(pivot, 0xd4f5dc, len / 2, LEAF_H - 0.75, side * (LEAF_T / 2 + 0.018), len - 0.48, 0.72, 0.01, { shadow: false }); // window
      ball(pivot, 0xffcf3a, len - 0.17, 1.5, side * (LEAF_T / 2 + 0.07), 0.065);
      block(pivot, 0xffcf3a, len - 0.17, 1.5, side * (LEAF_T / 2 + 0.03), 0.05, 0.05, 0.08, 0.02);
    }
    for (const e of [0.4, LEAF_H - 0.4]) cylinder(pivot, 0x9aa3b2, 0.0, e, 0, 0.035, 0.2, { seg: 8 }); // hinges
    // the white frame round the doorway
    for (const e of [op.u0, op.u1]) wallBox(p, w, 0xffffff, e - 0.05, e + 0.05, 0, DOOR_H, 0, w.t + 0.06);
    wallBox(p, w, 0xffffff, op.u0 - 0.05, op.u1 + 0.05, DOOR_H - 0.02, DOOR_H + 0.1, 0, w.t + 0.06);
    // nobody walks into the open door
    const od = dirAt(1);
    obstacles.push({ x: h.x + od.x * len / 2, z: h.z + od.z * len / 2, w: len, d: LEAF_T + 0.04, rot: Math.atan2(od.z, od.x) });
    let k = 0;
    const set = (v) => { k = v; pivot.rotation.y = y0 + dy * smoothK(k); };
    set(0);
    mergeStatic(pivot); // (the door is drawn as a few pieces that turn together)
    const mid = at(center, w.c);
    return {
      room: o.room, from: o.from, axis: w.axis, at: w.c, center, width, wall: w.def.id,
      point: mid, // the middle of the doorway
      inside: at(center, w.c + o.inward * 0.8), outside: at(center, w.c - o.inward * 0.8),
      get open() { return k; },
      step(want, dt, instant) {
        if (instant) set(want);
        else if (Math.abs(want - k) > 1e-4) set(k + (want - k) * (1 - Math.exp(-dt * (want > k ? 7 : 3.5))));
      },
    };
  }
  const smoothK = (k) => k * k * (3 - 2 * k);

  // A big letter and name on the floor of a room (like on the floor plan), readable from the
  // starting view (from the front door's side).
  function floorLabel(p, x, z, letter, name, w) {
    const tex = canvasTexture(512, 256, (ctx, cw, ch) => {
      ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fitText(ctx, letter, cw - 20, 170); ctx.fillText(letter, cw / 2, 100);
      fitText(ctx, name.toUpperCase(), cw - 30, 46); ctx.fillText(name.toUpperCase(), cw / 2, 214);
    });
    put(p, new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }), { x, y: 0.07, z, rx: -Math.PI / 2, rz: Math.PI / 2, shadow: false });
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
    sun.position.set(12, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    top.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(20, 10, 4);
    top.add(fill);

    // ----- the outline (in office units: x left -> right, z back -> front) -----
    const FP = { minX: wx(PLAN.footprint.x[0]), maxX: wx(PLAN.footprint.x[1]), minZ: wz(PLAN.footprint.y[1]), maxZ: wz(PLAN.footprint.y[0]) };
    const L = wx(-357), Rt = wx(362), BK = wz(537), FR = wz(-173); // the inside faces of the outer walls
    const WBW = wx(112);                       // the workbench wall's face (main room side)
    const ED = { x0: wx(122), z1: wz(279), z2: wz(274), z3: wz(182) }; // E: back..z1; D: z2..z3
    const STRIP = { x1: wx(251.5), z0: wz(177) }; // the part of the main room under D, up to the hallway wall
    const RM = { z0: wz(-12), z1: wz(-17), c: wx(-121.4), cb: wx(-0.2), b: wx(4.6), ba: wx(125.8), a: wx(130.6), cl: wx(-126.2) };
    const HALL = { x0: wx(PLAN.hallway.x[0]), x1: wx(PLAN.hallway.x[1]), z0: wz(PLAN.hallway.y[1]), z1: wz(PLAN.hallway.y[0]) };
    const B = { minX: L + 0.3, maxX: Rt - 0.3, minZ: BK + 0.3, maxZ: FR - 0.3 }; // walkable floor
    const glass = new THREE.MeshBasicMaterial({ color: 0xd4f5dc, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const sky = canvasTexture(128, 256, (ctx, w, h) => {
      const gr = ctx.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#4fb0f5"); gr.addColorStop(1, "#d8efff");
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const [x, y, r] of [[40, 60, 14], [58, 56, 18], [76, 62, 12], [90, 130, 12], [104, 126, 15]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "#8fc49a";
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(i * 32 + 8, h - 6, 22 + ((i * 37) % 14), 0, TAU); ctx.fill(); }
    });
    const mats = { sky: new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }), glass };

    // ----- the floor: one solid piece under everything, with other floors in the rooms -----
    const floor = new THREE.Group();
    floor.name = "floor";
    floor.userData.merged = true;
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
    }, [(FP.maxX - FP.minX) / 4, (FP.maxZ - FP.minZ) / 4]);
    put(floor, new THREE.PlaneGeometry(FP.maxX - FP.minX, FP.maxZ - FP.minZ), toon(0xffffff, { map: carpet }), { x: (FP.minX + FP.maxX) / 2, z: (FP.minZ + FP.maxZ) / 2, rx: -Math.PI / 2, shadow: false });
    const floorPatch = (x0, x1, z0, z1, tex, per) => {
      const t = tex.clone(); t.needsUpdate = true;
      t.repeat.set((x1 - x0) / per, (z1 - z0) / per);
      put(floor, new THREE.PlaneGeometry(x1 - x0, z1 - z0), toon(0xffffff, { map: t }), { x: (x0 + x1) / 2, y: 0.012, z: (z0 + z1) / 2, rx: -Math.PI / 2, shadow: false });
    };
    const tiles = (base, line, dots) => canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
      if (dots) { ctx.fillStyle = line; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { ctx.beginPath(); ctx.arc(20 + i * 18, 20 + j * 18, 3, 0, TAU); ctx.fill(); } }
    }, [1, 1]);
    const wood = canvasTexture(256, 256, (ctx, w) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = ["#e2b886", "#d9ab76", "#e8c294", "#dcb07c"][i % 4]; ctx.fillRect(0, i * 32, w, 32);
        ctx.fillStyle = "rgba(120,70,30,0.25)"; ctx.fillRect(0, i * 32, w, 2); ctx.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
      }
    }, [1, 1]);
    const softCarpet = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "#86b9a4"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; for (let k = 6; k < w; k += 10) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, h); ctx.stroke(); }
    }, [1, 1]);
    floorPatch(ED.x0, Rt, BK, ED.z1, tiles("#c9d3cf", "#9aaaa3", true), 1.2);   // E: raised floor tiles
    floorPatch(ED.x0, Rt, ED.z2, ED.z3, tiles("#cfc6b4", "#b3a890", false), 1.6); // D: plain floor
    floorPatch(RM.c, RM.cb, RM.z1, FR, softCarpet, 2);                           // C
    floorPatch(RM.b, RM.ba, RM.z1, FR, wood, 3);                                 // B
    floorPatch(RM.a, STRIP.x1, RM.z1, FR, wood, 3);                              // A
    floorPatch(HALL.x0, HALL.x1, HALL.z0, HALL.z1, tiles("#eef3ef", "#d3ddd6", false), 1.4); // the hallway
    // the floor's thick edge all round (like a dollhouse)
    block(floor, PANEL_C, (FP.minX + FP.maxX) / 2, -0.21, (FP.minZ + FP.maxZ) / 2, FP.maxX - FP.minX + 0.3, 0.4, FP.maxZ - FP.minZ + 0.3, 0.05);
    mergeStatic(floor);
    top.add(floor);
    floorLabel(top, -10.4, 1.0, "A223", "Information Technology", 8.5);
    floorLabel(top, 6.4, -5.5, "E", "Server room", 3.2);
    floorLabel(top, 7.0, -1.5, "D", "Storage", 2.4);
    floorLabel(top, -4.3, 10.4, "C", "Conference room", 1.8);
    floorLabel(top, 3.8, 14.0, "B", "Office", 1.6);
    floorLabel(top, 8.6, 13.7, "A", "Office", 1.6);

    // ----- the walls inside the office (solid, always up) -----
    const inner = new THREE.Group();
    inner.name = "room-walls";
    inner.userData.merged = true;
    const innerRuns = {};
    for (const def of PLAN.inner) {
      const w = worldRun(def);
      const runs = buildWall(inner, w, WALL_C, [-1, 1], obstacles, mats);
      wallTop(inner, w, [[w.u0, w.u1]], WALL_H);
      innerRuns[def.id] = w;
    }
    const roomWalls = PLAN.inner.map((d) => ({ id: d.id, between: d.between, opaque: true }));
    // room doors: inward = which way into the room (+1 = bigger z / x); hinge = which end it hangs on
    const opening = (wallId, room) => innerRuns[wallId].open.find((o) => o.room === room);
    const doors = [
      roomDoor(top, obstacles, innerRuns["E-D"], opening("E-D", "E"), { room: "E", from: "D", inward: -1, hinge: 1 }),
      roomDoor(top, obstacles, innerRuns.workbench, opening("workbench", "D"), { room: "D", from: "main", inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, innerRuns.rooms, opening("rooms", "C"), { room: "C", from: "main", inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, innerRuns.rooms, opening("rooms", "B"), { room: "B", from: "main", inward: 1, hinge: 1 }),
      roomDoor(top, obstacles, innerRuns.rooms, opening("rooms", "A"), { room: "A", from: "main", inward: 1, hinge: -1 }),
    ];
    const signs = {};
    for (const [id, name, color] of [["E", "Server room", "#3b6f8a"], ["D", "Storage", "#8a6a3c"], ["C", "Conference", "#2e8f86"], ["B", "Office", "#c0603e"], ["A", "Office", "#7b55c4"]]) {
      const d = doors.find((x) => x.room === id);
      signs[id] = doorSign(top, innerRuns[d.wall], d.center, id, name, color);
    }

    // ----- the columns -----
    const columns = [];
    const colIn = { inner: inner };

    // ----- the outer walls (each one is lowered while the camera is outside it) -----
    const outer = {};
    for (const def of PLAN.outer) {
      const w = worldRun(def);
      const g = new THREE.Group();
      g.name = "wall-" + def.id;
      g.userData.merged = true;
      const runs = buildWall(g, w, OUTER_C, [w.side], obstacles, mats);
      outer[def.id] = { def, w, g, runs };
      colIn[def.id] = g;
    }
    for (const c of PLAN.columns) columns.push(column(colIn[c.wall || "inner"], c, obstacles));
    mergeStatic(inner);
    top.add(inner);

    // things on the outer walls
    const backW = outer.back.g, westW = outer.west.g, eastW = outer.east.g;
    // the big "A223 Information Technology" sign on the back wall
    const bigSign = canvasTexture(640, 220, (ctx, w, h) => {
      ctx.fillStyle = "#24603b"; roundRect(ctx, 6, 6, w - 12, h - 12, 40); ctx.fill();
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 8; roundRect(ctx, 20, 20, w - 40, h - 40, 30); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 104px Nunito, sans-serif"; ctx.fillText("A223", w / 2, 82);
      ctx.font = "800 50px Nunito, sans-serif"; ctx.fillText("Information Technology", w / 2, 160);
    });
    put(backW, new THREE.PlaneGeometry(4.6, 1.58), new THREE.MeshBasicMaterial({ map: bigSign, toneMapped: false }), { x: -1.1, y: 3.0, z: BK + 0.04, shadow: false });
    // a whiteboard on the left wall
    const WB = { x: L + 0.06, z: 5.0 };
    block(westW, 0xc9d6cf, WB.x, 2.45, WB.z, 0.1, 1.7, 3.0, 0.04);
    const board = canvasTexture(256, 140, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.strokeStyle = "#2f9e5b"; ctx.beginPath(); ctx.moveTo(20, 30); ctx.lineTo(110, 30); ctx.stroke();
      ctx.strokeStyle = "#ff7a59"; ctx.beginPath(); ctx.moveTo(20, 60); ctx.lineTo(90, 60); ctx.stroke();
      ctx.strokeStyle = "#4a90e2"; ctx.beginPath(); ctx.moveTo(20, 90); ctx.lineTo(120, 90); ctx.stroke();
      ctx.strokeStyle = "#b58cff"; ctx.beginPath(); ctx.arc(190, 70, 36, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#ffc94a"; ctx.fillRect(170, 105, 44, 20);
    });
    put(westW, new THREE.PlaneGeometry(2.8, 1.5), new THREE.MeshBasicMaterial({ map: board, toneMapped: false }), { x: WB.x + 0.06, y: 2.45, z: WB.z, ry: Math.PI / 2, shadow: false });
    // a wall clock that shows the real time (over the coffee corner)
    const clock = group(westW, L + 0.04, -12.4, Math.PI / 2);
    cylinder(clock, 0xffffff, 0, 3.5, 0, 0.5, 0.1, { rx: Math.PI / 2 });
    put(clock, G.torus(0.5, 0.05), toon(0x3a3f4a), { y: 3.5, z: 0.03 });
    const hands = dynamic(new THREE.Group());
    hands.position.set(0, 3.5, 0.08);
    clock.add(hands);
    const hourHand = block(hands, 0x24283b, 0, 0, 0, 0.06, 0.28, 0.03, 0.01);
    const minHand = block(hands, 0x24283b, 0, 0, 0.02, 0.045, 0.42, 0.03, 0.01);
    hourHand.geometry = hourHand.geometry.clone().translate(0, 0.12, 0);
    minHand.geometry = minHand.geometry.clone().translate(0, 0.18, 0);
    anim.push((t, info) => {
      const d = new Date((info && info.now) || Date.now());
      const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
      minHand.rotation.z = -(m / 60) * TAU;
      hourHand.rotation.z = -(h / 12) * TAU;
    });
    // a notice board in the hallway
    block(eastW, 0xb27a48, Rt - 0.05, 2.3, 6.0, 0.1, 1.5, 2.6, 0.04);
    block(eastW, 0xe9c99a, Rt - 0.09, 2.3, 6.0, 0.08, 1.3, 2.4, 0.03);
    for (let i = 0; i < 5; i++) block(eastW, [0xfff176, 0xff9ec7, 0x9fe3ff, 0xffffff, 0xc5f08a][i], Rt - 0.14, 2.0 + (i % 2) * 0.5, 5.1 + i * 0.45, 0.02, 0.4, 0.34, 0.01, { rx: (i - 2) * 0.08 });

    // ----- THE FRONT DOOR: from the hallway into the open office -----
    // (it stays up even while its wall is lowered, so you can always see where Miis come in)
    const HW = outer.hallway.w;
    const fdo = HW.open.find((o) => o.kind === "front-door");
    const DOOR = { x: HW.c, z: (fdo.u0 + fdo.u1) / 2, w: fdo.u1 - fdo.u0, h: DOOR_H };
    const frontDoor = new THREE.Group();
    frontDoor.name = "front-door";
    top.add(frontDoor);
    for (const e of [fdo.u0, fdo.u1]) slab(frontDoor, 0xffffff, DOOR.x, DOOR.h / 2, e, HW.t + 0.1, DOOR.h, 0.14);
    slab(frontDoor, 0xffffff, DOOR.x, DOOR.h + 0.06, DOOR.z, HW.t + 0.1, 0.14, DOOR.w + 0.28);
    const hinge = dynamic(new THREE.Group());
    hinge.position.set(DOOR.x, 0, fdo.u1 - 0.07);
    frontDoor.add(hinge);
    const LW = DOOR.w - 0.14;
    block(hinge, 0x2f9e5b, 0, DOOR.h / 2, -LW / 2, 0.14, DOOR.h - 0.06, LW, 0.06);
    block(hinge, 0xc8f5d6, -0.08, DOOR.h * 0.68, -LW / 2, 0.03, DOOR.h * 0.26, LW * 0.55, 0.02);
    block(hinge, 0xc8f5d6, 0.08, DOOR.h * 0.68, -LW / 2, 0.03, DOOR.h * 0.26, LW * 0.55, 0.02);
    for (const e of [-1, 1]) ball(hinge, 0xffcf3a, e * 0.12, DOOR.h * 0.42, -LW + 0.25, 0.09);
    mergeStatic(hinge);
    const exitTex = canvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = "#1f7a45"; roundRect(ctx, 4, 4, w - 8, h - 8, 30); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "800 62px Nunito, sans-serif"; ctx.fillText("FRONT DOOR", w / 2, 58);
      ctx.font = "800 40px Nunito, sans-serif"; ctx.fillText("IN  ·  OUT", w / 2, 118);
    });
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false });
    // the sign sits on top of the door frame, readable from the hallway and from the room
    const SY = DOOR.h + 0.5;
    block(frontDoor, 0xffffff, DOOR.x, SY, DOOR.z, 0.12, 0.72, 2.05, 0.03);
    put(frontDoor, new THREE.PlaneGeometry(1.95, 0.62), exitMat, { x: DOOR.x + 0.065, y: SY, z: DOOR.z, ry: Math.PI / 2, shadow: false });
    put(frontDoor, new THREE.PlaneGeometry(1.95, 0.62), exitMat, { x: DOOR.x - 0.065, y: SY, z: DOOR.z, ry: -Math.PI / 2, shadow: false });
    const matTex = canvasTexture(256, 112, (ctx, w, h) => {
      ctx.fillStyle = "#2f7a4e"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = "#fff"; ctx.font = "800 40px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("WELCOME", w / 2, h / 2 + 2);
    });
    put(top, new THREE.PlaneGeometry(2.2, 1.1), toon(0xffffff, { map: matTex }), { x: DOOR.x - 0.85, y: 0.03, z: DOOR.z, rx: -Math.PI / 2, rz: Math.PI / 2, shadow: false });
    // the hallway: plants, a bench, and an arrow to the office
    plant(top, 14.5, 14.6, 0.75); plant(top, 14.5, 1.3, 0.7);
    block(top, 0x7a8597, 14.6, 0.45, 9.0, 0.6, 0.12, 2.0, 0.04); block(top, 0x5f6a7c, 14.6, 0.2, 8.2, 0.5, 0.4, 0.1, 0.02); block(top, 0x5f6a7c, 14.6, 0.2, 9.8, 0.5, 0.4, 0.1, 0.02);
    const arrowTex = canvasTexture(256, 128, (ctx) => {
      ctx.fillStyle = "rgba(47,158,91,0.85)";
      ctx.beginPath(); ctx.moveTo(30, 44); ctx.lineTo(150, 44); ctx.lineTo(150, 14); ctx.lineTo(226, 64); ctx.lineTo(150, 114); ctx.lineTo(150, 84); ctx.lineTo(30, 84); ctx.closePath(); ctx.fill();
    });
    put(top, new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, toneMapped: false }), { x: 12.9, y: 0.03, z: 6.5, rx: -Math.PI / 2, rz: Math.PI / 2, shadow: false });

    // ----- the open office desks (from the owner's desk plan) -----
    // yaw = the way the person sitting there looks: 0 = toward the front (down on the plan),
    // Math.PI = toward the back (up on the plan), Math.PI / 2 = to the right.
    const R = Math.PI / 2, UP = Math.PI, DOWN = 0;
    const DESKS = [
      { x: -5.6, z: -3.9, yaw: R },        // 1: by the "A223" on the plan, facing right
      { x: -6.25, z: -0.2, yaw: DOWN },    // 2: just below it (next to the column), facing down
      { x: -3.45, z: 2.1, yaw: UP },       // 3: next to that one, facing up
      { x: 1.55, z: 1.6, yaw: R, w: 1.3 }, // 4-7: the row, all facing right
      { x: 1.55, z: 2.95, yaw: R, w: 1.3 },
      { x: 1.55, z: 4.3, yaw: R, w: 1.3 },
      { x: 1.55, z: 5.65, yaw: R, w: 1.3 },
      { x: 7.55, z: 2.1, yaw: DOWN },      // 8: below the storage room, facing down
      { x: -13.3, z: 12.6, yaw: UP },      // 9, 10: along the bottom left, facing up
      { x: -7.35, z: 12.6, yaw: UP },
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
    // the workbench along the server room's wall (for fixing computers), up to just before D's door
    const WBN = { x: WBW - 0.65, z0: BK + 0.4, z1: wz(257) };
    block(top, 0xc98f5a, WBN.x, 1.0, (WBN.z0 + WBN.z1) / 2, 1.2, 0.12, WBN.z1 - WBN.z0, 0.04);
    for (const z of [WBN.z0 + 0.2, (WBN.z0 * 2 + WBN.z1) / 3, (WBN.z0 + WBN.z1 * 2) / 3, WBN.z1 - 0.2]) for (const dx of [-0.5, 0.5]) block(top, 0x8f96a3, WBN.x + dx, 0.5, z, 0.08, 1.0, 0.08, 0.03);
    block(top, 0x9aa3b2, WBW - 0.06, 1.9, (WBN.z0 + WBN.z1) / 2, 0.08, 1.6, WBN.z1 - WBN.z0, 0.02); // pegboard
    for (let i = 0; i < 13; i++) slab(top, [0xff7a59, 0xffc94a, 0x2f3542, 0x5cc84a][i % 4], WBW - 0.13, 1.6 + (i % 3) * 0.35, WBN.z0 + 0.6 + i * 0.78, 0.04, 0.3, 0.08, { rx: (i % 2) * 0.4 });
    block(top, 0x2f3542, WBN.x - 0.05, 1.3, -11.5, 0.7, 0.5, 0.9, 0.06); // an open computer being fixed
    block(top, 0x5cc84a, WBN.x - 0.05, 1.3, -11.5, 0.6, 0.4, 0.92, 0.02);
    block(top, 0x2f3542, WBN.x + 0.1, 1.5, -6.5, 0.06, 0.45, 0.75, 0.02); // a test screen
    put(top, geo("screen", () => new THREE.PlaneGeometry(0.72, 0.42)), screens[3], { x: WBN.x + 0.065, y: 1.5, z: -6.5, ry: -R, shadow: false });
    block(top, 0xffc94a, WBN.x - 0.2, 1.12, -4.2, 0.4, 0.12, 0.5, 0.03); // a toolbox
    obstacles.push({ x: WBN.x, z: (WBN.z0 + WBN.z1) / 2, w: 1.3, d: WBN.z1 - WBN.z0 + 0.1 });
    // a printer by the back wall
    const PR = { x: 1.6, z: BK + 0.6 };
    block(top, 0xf2f4f7, PR.x, 0.55, PR.z, 1.4, 1.1, 0.9, 0.08);
    block(top, 0x3a3f4a, PR.x, 1.12, PR.z, 1.2, 0.06, 0.7, 0.02);
    block(top, 0xffffff, PR.x, 1.17, PR.z + 0.25, 0.5, 0.02, 0.4, 0.01);
    obstacles.push({ x: PR.x, z: PR.z, w: 1.5, d: 1.0 });

    // ----- the coffee corner (top left) -----
    const K = { x: L + 0.6, z: -12.4 };
    block(top, 0xffffff, K.x, 0.55, K.z, 1.0, 1.1, 3.4, 0.06);
    block(top, 0xf0d3a8, K.x, 1.15, K.z, 1.1, 0.1, 3.5, 0.03);
    block(top, 0x3a3f4a, K.x - 0.05, 1.6, K.z - 0.6, 0.5, 0.8, 0.6, 0.06); // coffee machine
    ball(top, toon(0x5cff8a, { emissive: 0x5cff8a, emissiveIntensity: 1 }), K.x + 0.22, 1.85, K.z - 0.4, 0.04);
    for (let i = 0; i < 3; i++) cylinder(top, [0xff7a59, 0x2f9e5b, 0xffffff][i], K.x + 0.15, 1.28, K.z + 0.5 + i * 0.3, 0.08, 0.18);
    block(top, 0xf2f4f7, K.x, 1.05, K.z + 2.35, 0.95, 2.1, 1.0, 0.1); // fridge
    block(top, 0xc9d2dc, K.x + 0.49, 1.4, K.z + 2.05, 0.04, 0.5, 0.06, 0.02);
    const steam = [];
    for (let i = 0; i < 4; i++) steam.push(dynamic(ball(top, toon(0xffffff, { transparent: true, opacity: 0.6 }), K.x + 0.2, 1.6, K.z - 0.6, 0.06, { shadow: false })));
    anim.push((t) => steam.forEach((s, i) => {
      const k = (t * 0.5 + i / 4) % 1;
      s.position.set(K.x + 0.1 + Math.sin(t * 2 + i) * 0.05, 2.0 + k * 0.6, K.z - 0.6);
      s.scale.setScalar(0.05 + k * 0.08);
      s.material.opacity = 0.6 * (1 - k);
    }));
    const WC = { x: L + 0.6, z: -7.4 };
    block(top, 0xf2f4f7, WC.x, 0.75, WC.z, 0.8, 1.5, 0.8, 0.12);
    cylinder(top, toon(0x8fd8ff, { transparent: true, opacity: 0.8 }), WC.x, 1.95, WC.z, 0.36, 0.9);
    block(top, 0x2f9e5b, WC.x + 0.42, 1.15, WC.z, 0.08, 0.1, 0.18, 0.02);
    const T = { x: -11.0, z: -10.0 };
    rug(top, T.x + 0.3, T.z - 0.4, 4.2, 3.8, 0xffc94a, 0xffe08a);
    cylinder(top, 0xffffff, T.x, 1.0, T.z, 0.7, 0.06);
    cylinder(top, 0x8f96a3, T.x, 0.5, T.z, 0.05, 1.0);
    cylinder(top, 0x8f96a3, T.x, 0.03, T.z, 0.35, 0.05);
    cylinder(top, 0xff7a59, T.x + 0.15, 1.1, T.z + 0.1, 0.07, 0.14);
    for (const [sx, sz] of [[1.2, 0.5], [-0.4, -1.2]]) { cylinder(top, 0xff7a59, T.x + sx, 0.62, T.z + sz, 0.3, 0.1); cylinder(top, 0x8f96a3, T.x + sx, 0.3, T.z + sz, 0.04, 0.6); }
    // a comfy sofa by the back wall (under a window)
    const SO = { x: -8.75, z: BK + 0.75 };
    block(top, 0x2f9e5b, SO.x, 0.35, SO.z, 2.8, 0.5, 1.0, 0.15);
    block(top, 0x24804a, SO.x, 0.95, SO.z - 0.4, 2.8, 0.9, 0.3, 0.12);
    block(top, 0x24804a, SO.x - 1.35, 0.65, SO.z, 0.25, 0.6, 1.0, 0.1);
    block(top, 0x24804a, SO.x + 1.35, 0.65, SO.z, 0.25, 0.6, 1.0, 0.1);
    block(top, 0xffc94a, SO.x - 0.8, 0.8, SO.z - 0.1, 0.45, 0.45, 0.2, 0.1, { rx: -0.2 });

    // ----- E: the server room -----
    const ledOn = [0x5cff8a, 0x5cff8a, 0x7ad7ff, 0xffc94a, 0x5cff8a], ledOff = [0x1d5a33, 0x1d5a33, 0x234b66, 0x5a4a1d, 0x1d5a33];
    const ledMats = ledOn.map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const ROWS = [-11.3, -7.6], RACK_X = [7.3, 8.25, 9.2, 10.15, 11.1, 12.05];
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
      const x0 = RACK_X[0] - 0.6, x1 = 14.4;
      for (const e of [-0.3, 0.3]) slab(top, 0xffc531, (x0 + x1) / 2, 2.95, rz + e, x1 - x0, 0.1, 0.05);
      for (let x = x0; x <= x1; x += 0.5) slab(top, 0xffc531, x, 2.91, rz, 0.05, 0.03, 0.6, { shadow: false });
      [0x4a90e2, 0xff5a64, 0x5cc84a, 0xffffff].forEach((c, i) => slab(top, c, (x0 + x1) / 2, 2.96, rz - 0.18 + i * 0.12, x1 - x0, 0.06, 0.06, { shadow: false }));
      for (const rx of RACK_X) slab(top, 0x4a90e2, rx + 0.3, 2.72, rz, 0.05, 0.42, 0.05, { shadow: false });
    }
    slab(top, 0xffc531, 14.4, 2.95, (ROWS[0] + ROWS[1]) / 2, 0.6, 0.1, ROWS[1] - ROWS[0] + 0.6);
    // the cooling unit (a big air conditioner), with a turning fan
    const CU = { x: 14.15, z: BK + 0.65 };
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
    const UPS = { x: 14.5, z: -9.45 };
    block(top, 0x3a3f4a, UPS.x, 0.5, UPS.z, 0.8, 1.0, 0.9, 0.06); // a small UPS box
    for (let i = 0; i < 3; i++) put(top, geo("led", () => new THREE.BoxGeometry(0.045, 0.045, 0.02)), ledMats[i], { x: UPS.x - 0.2 + i * 0.12, y: 0.85, z: UPS.z + 0.46, shadow: false });
    obstacles.push({ x: UPS.x, z: UPS.z, w: 0.9, d: 1.0 });

    // ----- D: the storage room -----
    const SH_Z = ED.z2 + 0.5;
    [[6.6, 2.2, "boxes"], [8.95, 2.0, "screens"], [13.6, 2.2, "parts"]].forEach(([x, w, stuff]) => {
      storageShelf(top, x, SH_Z, w, stuff);
      obstacles.push({ x, z: SH_Z, w: w + 0.1, d: 0.8 });
    });
    cardboard(top, 14.6, 0, -0.45, 0.8, 0.6, 0.6, 0.1); cardboard(top, 14.6, 0.6, -0.45, 0.6, 0.45, 0.5, -0.15);
    cardboard(top, 12.3, 0, -0.4, 0.7, 0.5, 0.55, 0.2);
    obstacles.push({ x: 14.6, z: -0.45, w: 0.9, d: 0.7 }, { x: 12.3, z: -0.4, r: 0.45 });

    // ----- C: the conference room -----
    const MT = { x: (RM.c + RM.cb) / 2, z: 11.9 };
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
    // the screen at the back of the room (facing the table)
    const TV = { x: RM.c + 1.25, z: RM.z1 + 0.4 };
    block(top, 0x3a3f4a, TV.x, 0.05, TV.z, 0.9, 0.1, 0.6, 0.03);
    block(top, 0x3a3f4a, TV.x, 0.9, TV.z, 0.1, 1.7, 0.1, 0.03);
    block(top, 0x24283b, TV.x, 1.95, TV.z + 0.05, 2.0, 1.2, 0.1, 0.04);
    const slide = canvasTexture(256, 144, (ctx, w, h) => {
      ctx.fillStyle = "#eefaf1"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#2e8f86"; ctx.fillRect(0, 0, w, 26);
      ctx.fillStyle = "#fff"; ctx.font = "800 18px Nunito, sans-serif"; ctx.fillText("Weekly plan", 10, 19);
      [40, 70, 55, 90].forEach((b, i) => { ctx.fillStyle = ["#ff7a59", "#ffc94a", "#5cc84a", "#4a90e2"][i]; ctx.fillRect(130 + i * 28, h - 12 - b, 20, b); });
      ctx.fillStyle = "#9aa8bd"; for (let i = 0; i < 4; i++) ctx.fillRect(12, 42 + i * 20, 90, 6);
    });
    put(top, new THREE.PlaneGeometry(1.84, 1.04), new THREE.MeshBasicMaterial({ map: slide, toneMapped: false }), { x: TV.x, y: 1.95, z: TV.z + 0.11, shadow: false });
    // a whiteboard on the left wall
    const cboard = canvasTexture(256, 128, (ctx) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 256, 128);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.strokeStyle = "#2e8f86"; ctx.strokeRect(20, 20, 60, 36); ctx.strokeRect(150, 20, 60, 36); ctx.strokeRect(85, 80, 60, 36);
      ctx.strokeStyle = "#ff7a59"; ctx.beginPath(); ctx.moveTo(80, 38); ctx.lineTo(150, 38); ctx.moveTo(115, 56); ctx.lineTo(115, 80); ctx.stroke();
    });
    block(top, 0xc9d6cf, RM.c + 0.05, 2.0, MT.z, 0.06, 1.2, 2.2, 0.03);
    put(top, new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: cboard, toneMapped: false }), { x: RM.c + 0.09, y: 2.0, z: MT.z, ry: R, shadow: false });
    obstacles.push({ x: MT.x, z: MT.z, w: 1.5, d: 3.3 }, { x: TV.x, z: TV.z, w: 2.1, d: 0.7 }); // (the chairs push in under the table)

    // ----- B and A: the private offices -----
    // (the desk by B's left wall and by A's right wall; the person sits with their back to the wall)
    const OFF = {
      B: { x: RM.b + 1.75, z: 11.1, yaw: R, accent: 0xc0603e, n: 1, rug: 0xf6cfbf, rugX: RM.b + 2.5 },
      A: { x: STRIP.x1 - 1.75, z: 11.0, yaw: -R, accent: 0x7b55c4, n: 2, rug: 0xd9c8f5, rugX: STRIP.x1 - 2.5 },
    };
    for (const id of ["B", "A"]) {
      const o = OFF[id];
      rug(top, o.rugX, o.z, 3.4, 3.6, o.accent, o.rug);
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
    bookshelf(top, RM.ba - 0.3, 12.8, -R, 1.9);
    obstacles.push({ x: RM.ba - 0.3, z: 12.8, w: 0.6, d: 2.0 });
    plant(top, RM.b + 0.7, FR - 0.7, 0.6);
    obstacles.push({ x: RM.b + 0.7, z: FR - 0.7, r: 0.5 });
    const CAB = { x: RM.a + 1.45, z: FR - 0.4 };
    block(top, 0xb27a48, CAB.x, 0.55, CAB.z, 1.5, 1.1, 0.6, 0.05);
    for (let i = 0; i < 2; i++) block(top, 0xd9a874, CAB.x + (i - 0.5) * 0.72, 0.55, CAB.z - 0.31, 0.64, 0.9, 0.02, 0.02);
    plant(top, CAB.x - 0.4, CAB.z, 0.45);
    for (let i = 0; i < 2; i++) block(top, [0x4a90e2, 0xffc94a][i], CAB.x + 0.25 + i * 0.3, 1.25, CAB.z, 0.2, 0.3 - i * 0.1, 0.3, 0.02);
    obstacles.push({ x: CAB.x, z: CAB.z, w: 1.7, d: 0.8 });
    const LAMP = { x: STRIP.x1 - 0.55, z: FR - 0.6 };
    cylinder(top, 0x3a3f4a, LAMP.x, 0.03, LAMP.z, 0.28, 0.06);
    cylinder(top, 0x3a3f4a, LAMP.x, 1.2, LAMP.z, 0.04, 2.4);
    cylinder(top, toon(0xfff1c2, { emissive: 0xffe9a8, emissiveIntensity: 0.5 }), LAMP.x, 2.45, LAMP.z, 0.3, 0.35);
    obstacles.push({ x: LAMP.x, z: LAMP.z, r: 0.35 });
    const pic = canvasTexture(128, 96, (ctx, w, h) => {
      ctx.fillStyle = "#9fe3ff"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffd36b"; ctx.beginPath(); ctx.arc(96, 26, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = "#5cc84a"; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(44, 34); ctx.lineTo(80, h); ctx.fill();
      ctx.fillStyle = "#46b04a"; ctx.beginPath(); ctx.moveTo(50, h); ctx.lineTo(90, 48); ctx.lineTo(128, h); ctx.fill();
    });
    const EAS = { x: RM.a + 0.5, z: FR - 1.2 };
    block(top, 0xffffff, EAS.x, 1.6, EAS.z, 0.08, 0.95, 1.2, 0.03, { ry: 0.5 });
    put(top, new THREE.PlaneGeometry(1.0, 0.75), new THREE.MeshBasicMaterial({ map: pic, toneMapped: false }), { x: EAS.x + 0.05, y: 1.6, z: EAS.z, ry: R + 0.5, shadow: false });
    block(top, 0x3a3f4a, EAS.x - 0.05, 0.6, EAS.z, 0.06, 1.2, 0.06, 0.02);
    block(top, 0x3a3f4a, EAS.x - 0.05, 0.03, EAS.z, 0.4, 0.06, 0.6, 0.02);
    obstacles.push({ x: EAS.x, z: EAS.z, r: 0.55 });

    // ----- plants in the open office -----
    for (const [x, z, s] of [[L + 0.8, -3.6, 0.8], [L + 0.8, 2.4, 0.8], [L + 0.7, FR - 0.7, 0.6], [-2.8, BK + 0.8, 0.8], [RM.cl - 0.7, 7.5, 0.7], [STRIP.x1 - 0.7, 7.5, 0.6]]) {
      plant(top, x, z, s);
      obstacles.push({ x, z, r: 0.85 * s });
    }

    // (the hallway is outside the office: Miis only walk there on the way in and out)
    obstacles.push({ x: (HALL.x0 + HALL.x1) / 2, z: (HALL.z0 + HALL.z1) / 2, w: HALL.x1 - HALL.x0, d: HALL.z1 - HALL.z0 });
    // coffee corner, water cooler, table and stools, sofa
    obstacles.push({ x: K.x, z: K.z + 0.85, w: 1.2, d: 5.1 }, { x: WC.x, z: WC.z, r: 0.6 }, { x: T.x, z: T.z, r: 0.8 },
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
    // (the first Miis of the day sit nearest the front door, where they're easy to see)
    const shared = workSpots.filter((s) => !s.private).sort((a, b) => b.seat.x - a.seat.x || a.number - b.number);
    workSpots.splice(0, workSpots.length, ...shared, ...workSpots.filter((s) => s.private));
    workSpots.push(
      { id: "coffee", kind: "coffee", x: K.x + 1.3, z: K.z - 0.4, yaw: -R, arms: "eat" },
      { id: "water", kind: "water", x: WC.x + 1.2, z: WC.z, yaw: -R, arms: "eat" },
      { id: "table", kind: "coffee", x: T.x + 1.45, z: T.z - 1.0, yaw: -R - 0.6, arms: "eat" },
      { id: "sofa", kind: "sofa", x: SO.x, z: SO.z + 1.4, yaw: 0, arms: "down", seat: { x: SO.x + 0.3, z: SO.z + 0.05, y: 0 } },
      { id: "stretch-1", kind: "stretch", x: -10.6, z: 6.4, yaw: 0, arms: "cheer" },
      { id: "stretch-2", kind: "stretch", x: -1.8, z: -8.0, yaw: 0, arms: "cheer" },
      { id: "window-1", kind: "window", x: -5.75, z: B.minZ + 0.75, yaw: UP, arms: "down", lookUp: 0.15 },
      { id: "window-2", kind: "window", x: L + 0.95, z: -5.75, yaw: -R, arms: "down", lookUp: 0.15 },
      { id: "board", kind: "board", x: L + 1.0, z: WB.z, yaw: -R, arms: "down", lookUp: 0.2 },
      { id: "workbench-1", kind: "workbench", x: WBN.x - 1.25, z: -11.5, yaw: R, arms: "type" },
      { id: "workbench-2", kind: "workbench", x: WBN.x - 1.25, z: -6.5, yaw: R, arms: "type" },
      { id: "server-1", kind: "server", room: "E", x: 9.3, z: -6.4, yaw: UP, arms: "type" },
      { id: "server-2", kind: "server", room: "E", x: 10.6, z: -10.1, yaw: UP, arms: "type" },
      { id: "storage-1", kind: "storage", room: "D", x: 8.95, z: -1.7, yaw: UP, arms: "down", lookUp: 0.2 },
      { id: "storage-2", kind: "storage", room: "D", x: 13.6, z: -1.7, yaw: UP, arms: "down", lookUp: 0.1 }
    );
    // (the conference room's chairs: only for a little meeting now and then, see officeHub.js)
    meetChairs.forEach((c, i) => workSpots.push({ id: "meeting-" + (i + 1), kind: "meeting", room: "C", gather: true, x: c.cx + c.side * 0.7, z: c.cz, yaw: c.yaw, arms: "down", seat: { x: c.cx, z: c.cz, y: 0 } }));

    // ----- the rooms -----
    const rooms = [
      { id: "main", name: "A223 Information Technology", kind: "open", areas: [{ minX: L, maxX: WBW, minZ: BK, maxZ: RM.z0 }, { minX: WBW, maxX: STRIP.x1, minZ: STRIP.z0, maxZ: RM.z0 }, { minX: L, maxX: RM.cl, minZ: RM.z0, maxZ: FR }] },
      { id: "A", name: "Office A", kind: "office", private: true, areas: [{ minX: RM.a, maxX: STRIP.x1, minZ: RM.z1, maxZ: FR }] },
      { id: "B", name: "Office B", kind: "office", private: true, areas: [{ minX: RM.b, maxX: RM.ba, minZ: RM.z1, maxZ: FR }] },
      { id: "C", name: "Conference room", kind: "conference", areas: [{ minX: RM.c, maxX: RM.cb, minZ: RM.z1, maxZ: FR }] },
      { id: "D", name: "Storage room", kind: "storage", areas: [{ minX: ED.x0, maxX: Rt, minZ: ED.z2, maxZ: ED.z3 }] },
      { id: "E", name: "Server room", kind: "server", areas: [{ minX: ED.x0, maxX: Rt, minZ: BK, maxZ: ED.z1 }] },
      { id: "hall", name: "Hallway", kind: "hallway", outside: true, areas: [{ minX: HALL.x0, maxX: HALL.x1, minZ: HALL.z0, maxZ: HALL.z1 }] },
    ];

    mergeStatic(top);
    scene.add(top);
    // The outer walls: merged, each with its own materials, so it can be lowered on its own.
    // Lowering = everything above a height is cut away (a clipping plane), with the dark top
    // of the wall following the cut, so it looks like a neat low wall.
    const walls = PLAN.outer.map((def) => {
      const o = outer[def.id], w = o.w;
      mergeStatic(o.g);
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), WALL_H + 1);
      o.g.traverse((m) => {
        if (!m.isMesh) return;
        m.material = m.material.clone();
        m.material.clippingPlanes = [plane];
        m.material.clipShadows = true;
      });
      const cap = new THREE.Group();
      wallTop(cap, w, o.runs, 0);
      mergeStatic(cap);
      cap.position.y = WALL_H;
      o.g.add(cap);
      scene.add(o.g);
      let cut = 0;
      return {
        id: def.id, group: o.g, cap,
        point: w.alongX ? new THREE.Vector3(0, 0, w.c) : new THREE.Vector3(w.c, 0, 0),
        normal: w.alongX ? new THREE.Vector3(0, 0, w.side) : new THREE.Vector3(w.side, 0, 0),
        height: WALL_H, low: CUT_H,
        get cut() { return cut; },
        // 0 = all the way up, 1 = lowered to a low strip
        setCut(k) {
          cut = Math.max(0, Math.min(1, k));
          const h = WALL_H - (WALL_H - CUT_H) * cut;
          plane.constant = cut <= 0 ? WALL_H + 1 : h;
          cap.position.y = h;
        },
      };
    });

    const doorPoint = { x: DOOR.x - 1.05, z: DOOR.z };
    const outsidePath = [{ x: DOOR.x + 0.95, z: DOOR.z }, { x: 12.9, z: DOOR.z + 1.2 }, { x: 12.9, z: HALL.z1 - 1.6 }];
    // the starting view: from the front door's side (the right), high up, looking into the room
    const fit = { minX: FP.minX, maxX: FP.maxX, minZ: FP.minZ, maxZ: FP.maxZ };
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
      insidePoint: { x: 8.7, z: 4.7 },
      cameraView: { target: [-0.4, 0.4, 0.3], yaw: Math.PI / 2 - 0.1, tilt: 1.6, fit, pan: { minX: FP.minX, maxX: FP.maxX, minZ: FP.minZ, maxZ: FP.maxZ } },
      walls,     // [{ id, group, point, normal, setCut(k) }]: the outer walls (lowered while the camera is outside them)
      roomWalls, // [{ id, between, opaque }]: the walls inside the office (always up, solid)
      roomWallGroup: inner,
      columns,   // [{ id, x, z, w, d, free }]: the building's columns (from the model)
      floor,
      frontDoor,
      plan: PLAN,
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

  root.NSCCOffice = { build, PLAN };
})(typeof self !== "undefined" ? self : this);
