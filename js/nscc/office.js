/*
 * js/nscc/office.js
 * THE OFFICE (a placeholder: it will be swapped for the real office later).
 *
 * Everything about the room lives in this one file. To use a different office,
 * write a new file with the same build() and load it in index.html instead.
 * Nothing else needs to change.
 *
 *   NSCCOffice.build(scene) -> {
 *     root,        THREE.Group with the whole room (already added to the scene)
 *     bounds,      { minX, maxX, minZ, maxZ }  the floor area Miis can walk on
 *     obstacles,   [shape]  things Miis walk around (shapes: see js/nav.js)
 *                  { x, z, r } circle, { x, z, w, d, rot } rectangle
 *     workSpots,   [{ id, kind, x, z, yaw, arms, seat?, lookUp? }]
 *                  kind:  "desk" (each Mii gets its own) or a break spot:
 *                         "coffee" | "water" | "stretch" | "window" | "board"
 *                  x, z:  where the Mii stands to use it; yaw: the way it faces
 *                  arms:  the arm pose while there ("type", "eat", "cheer", "down"...)
 *                  seat:  { x, z, y } for spots where the Mii sits down (desks)
 *     doorPoint,   { x, z }  just inside the door (on the walkable floor)
 *     outsidePoint { x, z }  just outside the door: Miis appear and disappear here
 *     insidePoint, { x, z }  a few steps into the room from the door
 *     cameraView,  { target: [x, y, z], tilt, width, azimuth: [min, max], polar: [min, max] }
 *     walls,       (optional) [{ group, point, normal }]: each wall group, a point on it and the
 *                  direction into the room; the view hides a wall while the camera is behind it
 *                  width = how much of the room must fit across the screen
 *     background,  the color behind everything
 *     update(t, info)  optional: animations. info.door = true while someone goes through the
 *                  door, info.now = the time (ms, for the wall clock)
 *   }
 *
 * The room is built from simple rounded shapes with toon shading (a few flat
 * bands of light), like the rest of the look.
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
  function officeChair(p, x, z, color) {
    const c = group(p, x, z, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      block(c, 0x3a3f4a, Math.cos(a) * 0.25, 0.07, Math.sin(a) * 0.25, 0.5, 0.05, 0.08, 0.02, { ry: -a });
    }
    cylinder(c, 0x3a3f4a, 0, 0.32, 0, 0.05, 0.5);
    block(c, color, 0, 0.6, 0, 0.75, 0.14, 0.72, 0.07);
    block(c, color, 0, 1.05, -0.36, 0.72, 0.75, 0.12, 0.06);
  }
  // Two desks side by side. The Miis sit behind them, facing the camera.
  function deskPod(p, x, z, colors, screens, n) {
    const d = group(p, x, z);
    block(d, 0xf0d3a8, 0, 1.0, 0, 3.0, 0.1, 1.3, 0.04);
    for (const [sx, sz] of [[-1.4, -0.55], [1.4, -0.55], [-1.4, 0.55], [1.4, 0.55]]) block(d, 0x8f96a3, sx, 0.5, sz, 0.08, 1.0, 0.08, 0.03);
    block(d, colors[0], 0, 1.35, 0.62, 3.0, 0.6, 0.06, 0.03); // divider at the front
    for (let i = 0; i < 3; i++) block(d, [0xfff176, 0xff9ec7, 0x9fe3ff][i], -1.0 + i * 1.0, 1.5 + (i % 2) * 0.1, 0.66, 0.16, 0.16, 0.01, 0.01, { rz: (i - 1) * 0.12 });
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -0.75 : 0.75;
      block(d, 0x2f3542, sx, 1.6, 0.25, 0.8, 0.5, 0.05, 0.03);
      put(d, geo("screen", () => new THREE.PlaneGeometry(0.72, 0.42)), screens[(n * 2 + i) % screens.length], { x: sx, y: 1.6, z: 0.222, ry: Math.PI, shadow: false });
      block(d, 0x2f3542, sx, 1.2, 0.27, 0.1, 0.3, 0.1, 0.03);
      block(d, 0xf4f4f4, sx, 1.07, -0.2, 0.62, 0.03, 0.2, 0.02); // keyboard
      ball(d, 0xf4f4f4, sx + 0.45, 1.08, -0.2, 0.06, { sy: 0.5, sz: 1.4 }); // mouse
      cylinder(d, colors[1], sx - 0.55, 1.15, -0.05, 0.07, 0.18); // mug
      officeChair(d, sx, -1.05, colors[1]);
    }
    // a little plant
    cylinder(d, 0xffffff, 0, 1.15, 0.36, 0.11, 0.2);
    for (let k = 0; k < 5; k++) put(d, G.sphere(), toon(k % 2 ? 0x46b04a : 0x5cc84a), { x: Math.cos(k * 1.26) * 0.08, y: 1.42 + (k % 2) * 0.08, z: 0.36 + Math.sin(k * 1.26) * 0.08, sx: 0.07, sy: 0.24, sz: 0.07, rx: Math.sin(k * 1.26) * 0.5, rz: -Math.cos(k * 1.26) * 0.5 });
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

  // =====================================================================
  function build(scene) {
    const top = new THREE.Group();
    top.name = "office";
    const anim = [];

    // ----- light -----
    top.add(new THREE.HemisphereLight(0xffffff, 0xd9c7a8, 0.55));
    top.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.7);
    sun.position.set(10, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 70 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    top.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(0, 8, 20);
    top.add(fill);

    const B = { minX: -15.3, maxX: 15.3, minZ: -9.3, maxZ: 9.2 }; // walkable floor
    const W = { back: -10, side: 16, front: 10 };
    const WALL_H = 6.5;

    // ----- floor: carpet tiles -----
    const carpet = canvasTexture(256, 256, (ctx) => {
      const shades = ["#8e9db3", "#97a6bb", "#8796ad", "#93a2b8"];
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
      ctx.strokeStyle = "rgba(40,50,70,0.25)"; ctx.lineWidth = 2;
      for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) ctx.strokeRect(x, y, 128, 128);
    }, [8, 5]);
    put(top, new THREE.PlaneGeometry(W.side * 2, W.front - W.back), toon(0xffffff, { map: carpet }), { rx: -Math.PI / 2, shadow: false });
    // a thick floor edge at the open front (like a dollhouse)
    block(top, 0x5f7da3, 0, -0.3, W.front + 0.15, W.side * 2 + 0.5, 0.6, 0.3, 0.04);

    // ----- walls: back (with the door) and both sides -----
    // Each wall (with everything hanging on it) is its own group, so the 3D view can hide the
    // wall between the camera and the room when you spin round (like a dollhouse).
    const backWall = new THREE.Group(), leftWall = new THREE.Group(), rightWall = new THREE.Group();
    const wallC = 0xdce8f2, panelC = 0x5f7da3;
    const DOOR = { x: 12, w: 2.6, h: 4.4 };
    const backZ = W.back - 0.25;
    const backPiece = (x0, x1, y0, y1) => block(backWall, wallC, (x0 + x1) / 2, (y0 + y1) / 2, backZ, x1 - x0, y1 - y0, 0.5, 0.02);
    backPiece(-W.side - 0.5, DOOR.x - DOOR.w / 2, 0, WALL_H);
    backPiece(DOOR.x + DOOR.w / 2, W.side + 0.5, 0, WALL_H);
    backPiece(DOOR.x - DOOR.w / 2, DOOR.x + DOOR.w / 2, DOOR.h, WALL_H);
    block(leftWall, wallC, -W.side - 0.25, WALL_H / 2, 0, 0.5, WALL_H, W.front - W.back + 0.5, 0.02);
    block(rightWall, wallC, W.side + 0.25, WALL_H / 2, 0, 0.5, WALL_H, W.front - W.back + 0.5, 0.02);
    // dark panelling and a white rail along the bottom of the walls
    const panel = (wall, x, z, w, d) => { block(wall, panelC, x, 1.1, z, w, 2.2, d, 0.02); block(wall, 0xffffff, x, 2.25, z, w + 0.04, 0.12, d + 0.06, 0.03); };
    panel(backWall, (-W.side + DOOR.x - DOOR.w / 2 - 0.3) / 2, W.back + 0.06, DOOR.x - DOOR.w / 2 - 0.3 + W.side, 0.12);
    panel(backWall, (DOOR.x + DOOR.w / 2 + 0.3 + W.side) / 2, W.back + 0.06, W.side - DOOR.x - DOOR.w / 2 - 0.3, 0.12);
    panel(leftWall, -W.side + 0.06, 0, 0.12, W.front - W.back);
    panel(rightWall, W.side - 0.06, 0, 0.12, W.front - W.back);
    // the doorway: a frame, a bright hallway behind it, and a door that swings open
    block(backWall, 0xffffff, DOOR.x - DOOR.w / 2 - 0.12, DOOR.h / 2, W.back + 0.02, 0.24, DOOR.h, 0.3, 0.04);
    block(backWall, 0xffffff, DOOR.x + DOOR.w / 2 + 0.12, DOOR.h / 2, W.back + 0.02, 0.24, DOOR.h, 0.3, 0.04);
    block(backWall, 0xffffff, DOOR.x, DOOR.h + 0.12, W.back + 0.02, DOOR.w + 0.48, 0.24, 0.3, 0.04);
    block(backWall, 0xfff6e0, DOOR.x, DOOR.h / 2, W.back - 2.2, DOOR.w + 1.5, DOOR.h + 0.6, 0.2, 0.02); // hallway wall
    put(backWall, new THREE.PlaneGeometry(DOOR.w + 1.5, 2.2), toon(0xcdb894), { x: DOOR.x, y: 0.01, z: W.back - 1.1, rx: -Math.PI / 2, shadow: false });
    block(backWall, 0xfff6e0, DOOR.x - DOOR.w / 2 - 0.75, DOOR.h / 2, W.back - 1.1, 0.2, DOOR.h + 0.6, 2.2, 0.02);
    block(backWall, 0xfff6e0, DOOR.x + DOOR.w / 2 + 0.75, DOOR.h / 2, W.back - 1.1, 0.2, DOOR.h + 0.6, 2.2, 0.02);
    const hinge = dynamic(new THREE.Group());
    hinge.position.set(DOOR.x - DOOR.w / 2, 0, W.back - 0.1);
    backWall.add(hinge);
    block(hinge, 0x4a90e2, DOOR.w / 2, DOOR.h / 2, 0, DOOR.w - 0.04, DOOR.h - 0.04, 0.14, 0.06);
    block(hinge, 0xbfe6ff, DOOR.w / 2, DOOR.h * 0.68, 0.08, DOOR.w * 0.55, DOOR.h * 0.26, 0.03, 0.02);
    ball(hinge, 0xffcf3a, DOOR.w - 0.3, DOOR.h * 0.45, 0.12, 0.09);
    // an "exit" sign over the door, and a welcome mat
    const sign = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.fillStyle = "#2f9e5b"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff"; ctx.font = "800 38px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("IN  /  OUT", w / 2, h / 2 + 2);
    });
    put(backWall, new THREE.PlaneGeometry(1.9, 0.48), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false }), { x: DOOR.x, y: DOOR.h + 0.65, z: W.back + 0.02, shadow: false });
    const matTex = canvasTexture(256, 112, (ctx, w, h) => {
      ctx.fillStyle = "#4a6aa0"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = "#fff"; ctx.font = "800 40px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("WELCOME", w / 2, h / 2 + 2);
    });
    put(top, new THREE.PlaneGeometry(2.8, 1.2), toon(0xffffff, { map: matTex }), { x: DOOR.x, y: 0.02, z: W.back + 0.9, rx: -Math.PI / 2, shadow: false });

    // windows on the back wall: a sunny sky with soft clouds
    const sky = canvasTexture(256, 160, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#4fb0f5"); g.addColorStop(1, "#d8efff");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const [x, y, r] of [[60, 50, 18], [80, 46, 22], [102, 52, 16], [180, 90, 14], [196, 86, 18], [212, 92, 12]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "#9fb8d0";
      for (let i = 0; i < 9; i++) ctx.fillRect(i * 30, h - 24 - ((i * 37) % 30), 24, 60);
    });
    const skyMat = new THREE.MeshBasicMaterial({ map: sky, toneMapped: false });
    const windows = [-10.5, -3.5, 3.5];
    for (const x of windows) {
      put(backWall, geo("win", () => new THREE.PlaneGeometry(4.2, 2.4)), skyMat, { x, y: 4.0, z: W.back + 0.02, shadow: false });
      block(backWall, 0xffffff, x, 2.75, W.back + 0.05, 4.5, 0.16, 0.3, 0.03);
      block(backWall, 0xffffff, x, 5.25, W.back + 0.05, 4.4, 0.14, 0.12, 0.03);
      block(backWall, 0xffffff, x - 2.15, 4.0, W.back + 0.05, 0.14, 2.5, 0.12, 0.03);
      block(backWall, 0xffffff, x + 2.15, 4.0, W.back + 0.05, 0.14, 2.5, 0.12, 0.03);
      block(backWall, 0xffffff, x, 4.0, W.back + 0.05, 0.1, 2.4, 0.1, 0.03);
    }
    // a wall clock that shows the real time
    const clock = group(backWall, 7.6, W.back + 0.1);
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

    // ----- desks: 6 pods of 2 = 12 desks -----
    const screens = screenMats();
    const podColors = [[0xff7a59, 0x3a78c8], [0x5cc84a, 0xff7a59], [0x4a90e2, 0xffc94a], [0xb58cff, 0x5cc84a], [0xffc94a, 0xb58cff], [0x3ec7c2, 0xff5a64]];
    const pods = [];
    [-11, -4.5, 2].forEach((x) => [-3.6, 3.4].forEach((z) => pods.push({ x, z })));
    pods.forEach((p, i) => deskPod(top, p.x, p.z, podColors[i], screens, i));

    // ----- break corner (right): coffee counter, water cooler, a little table -----
    const K = { x: 15.2, z: -4.2 };
    block(top, 0xffffff, K.x, 0.55, K.z, 1.0, 1.1, 3.4, 0.06);
    block(top, 0xf0d3a8, K.x, 1.15, K.z, 1.1, 0.1, 3.5, 0.03);
    block(top, 0x3a3f4a, K.x + 0.05, 1.6, K.z - 0.6, 0.5, 0.8, 0.6, 0.06); // coffee machine
    ball(top, toon(0x5cff8a, { emissive: 0x5cff8a, emissiveIntensity: 1 }), K.x - 0.22, 1.85, K.z - 0.4, 0.04);
    for (let i = 0; i < 3; i++) cylinder(top, [0xff7a59, 0x4a90e2, 0xffffff][i], K.x - 0.15, 1.28, K.z + 0.5 + i * 0.3, 0.08, 0.18);
    const steam = [];
    for (let i = 0; i < 4; i++) steam.push(dynamic(ball(top, toon(0xffffff, { transparent: true, opacity: 0.6 }), K.x - 0.2, 1.6, K.z - 0.6, 0.06, { shadow: false })));
    anim.push((t) => steam.forEach((s, i) => {
      const k = (t * 0.5 + i / 4) % 1;
      s.position.set(K.x - 0.25 + Math.sin(t * 2 + i) * 0.05, 2.0 + k * 0.6, K.z - 0.6);
      s.scale.setScalar(0.05 + k * 0.08);
      s.material.opacity = 0.6 * (1 - k);
    }));
    const WC = { x: 15.2, z: 0.6 };
    block(top, 0xf2f4f7, WC.x, 0.75, WC.z, 0.8, 1.5, 0.8, 0.12);
    cylinder(top, toon(0x8fd8ff, { transparent: true, opacity: 0.8 }), WC.x, 1.95, WC.z, 0.36, 0.9);
    block(top, 0x4a90e2, WC.x - 0.42, 1.15, WC.z, 0.08, 0.1, 0.18, 0.02);
    const T = { x: 10.2, z: 4.6 };
    cylinder(top, 0xffffff, T.x, 1.0, T.z, 0.65, 0.06);
    cylinder(top, 0x8f96a3, T.x, 0.5, T.z, 0.05, 1.0);
    cylinder(top, 0x8f96a3, T.x, 0.03, T.z, 0.35, 0.05);
    cylinder(top, 0xff7a59, T.x + 0.15, 1.1, T.z + 0.1, 0.07, 0.14);
    // a whiteboard on the left wall
    const WB = { x: -W.side + 0.12, z: 0 };
    block(leftWall, 0xc9d2dc, WB.x, 3.2, WB.z, 0.1, 2.2, 4.0, 0.04);
    const board = canvasTexture(256, 140, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.strokeStyle = "#4a90e2"; ctx.beginPath(); ctx.moveTo(20, 30); ctx.lineTo(110, 30); ctx.stroke();
      ctx.strokeStyle = "#ff7a59"; ctx.beginPath(); ctx.moveTo(20, 60); ctx.lineTo(90, 60); ctx.stroke();
      ctx.strokeStyle = "#5cc84a"; ctx.beginPath(); ctx.moveTo(20, 90); ctx.lineTo(120, 90); ctx.stroke();
      ctx.strokeStyle = "#b58cff"; ctx.beginPath(); ctx.arc(190, 70, 36, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#ffc94a"; ctx.fillRect(170, 105, 44, 20);
    });
    put(leftWall, new THREE.PlaneGeometry(3.8, 2.0), new THREE.MeshBasicMaterial({ map: board, toneMapped: false }), { x: WB.x + 0.06, y: 3.2, z: WB.z, ry: Math.PI / 2, shadow: false });
    // plants in the corners
    plant(top, -15.1, -9.1, 0.9); plant(top, -15.1, 8.9, 0.9); plant(top, 15.1, 8.9, 0.9); plant(top, 8.4, -9.2, 0.75);

    mergeStatic(top);
    scene.add(top);
    for (const wall of [backWall, leftWall, rightWall]) { mergeStatic(wall); scene.add(wall); }
    // where each wall is, and which way is into the room (for hiding it when the camera is behind it)
    const walls = [
      { group: backWall, point: new THREE.Vector3(0, 0, W.back), normal: new THREE.Vector3(0, 0, 1) },
      { group: leftWall, point: new THREE.Vector3(-W.side, 0, 0), normal: new THREE.Vector3(1, 0, 0) },
      { group: rightWall, point: new THREE.Vector3(W.side, 0, 0), normal: new THREE.Vector3(-1, 0, 0) },
    ];

    // ----- where Miis can be -----
    const workSpots = [];
    pods.forEach((p, pi) => {
      for (let i = 0; i < 2; i++) {
        const sx = p.x + (i === 0 ? -0.75 : 0.75);
        workSpots.push({ id: "desk-" + (pi * 2 + i), kind: "desk", x: sx, z: p.z - 2.25, yaw: 0, arms: "type", seat: { x: sx, z: p.z - 1.0, y: 0 } });
      }
    });
    // (desks nearest the front first, so the first Miis sit where they're easy to see)
    workSpots.sort((a, b) => b.seat.z - a.seat.z || Math.abs(a.x + 1) - Math.abs(b.x + 1));
    workSpots.push(
      { id: "coffee", kind: "coffee", x: K.x - 1.3, z: K.z - 0.4, yaw: Math.PI / 2, arms: "eat" },
      { id: "water", kind: "water", x: WC.x - 1.2, z: WC.z, yaw: Math.PI / 2, arms: "eat" },
      { id: "table", kind: "coffee", x: T.x - 1.1, z: T.z + 0.4, yaw: Math.PI / 2 + 0.3, arms: "eat" },
      { id: "stretch-1", kind: "stretch", x: -8, z: 7.6, yaw: 0, arms: "cheer" },
      { id: "stretch-2", kind: "stretch", x: 4.5, z: 7.4, yaw: 0, arms: "cheer" },
      { id: "window-1", kind: "window", x: -7.2, z: -8.9, yaw: Math.PI, arms: "down", lookUp: 0.15 },
      { id: "window-2", kind: "window", x: -0.2, z: -8.9, yaw: Math.PI, arms: "down", lookUp: 0.15 },
      { id: "board", kind: "board", x: -14.3, z: 0.4, yaw: -Math.PI / 2, arms: "down", lookUp: 0.2 }
    );

    const obstacles = pods.map((p) => ({ x: p.x, z: p.z - 0.45, w: 3.1, d: 2.3 })).concat([
      { x: K.x, z: K.z, w: 1.2, d: 3.6 },  // coffee counter
      { x: WC.x, z: WC.z, r: 0.6 },        // water cooler
      { x: T.x, z: T.z, r: 0.7 },          // little table
      { x: -15.1, z: -9.1, r: 0.8 }, { x: -15.1, z: 8.9, r: 0.8 }, { x: 15.1, z: 8.9, r: 0.8 }, { x: 8.4, z: -9.2, r: 0.7 },
    ]);

    let doorK = 0;
    return {
      root: top,
      bounds: B,
      obstacles,
      workSpots,
      doorPoint: { x: DOOR.x, z: B.minZ + 0.1 },
      outsidePoint: { x: DOOR.x, z: W.back - 1.4 },
      insidePoint: { x: DOOR.x - 0.5, z: B.minZ + 3 },
      cameraView: { target: [0, 1.2, 0.8], tilt: 0.62, width: 33, azimuth: [-Infinity, Infinity], polar: [0.35, 1.3] },
      walls, // [{ group, point, normal }]: hidden while the camera is behind them
      background: 0xd8efff,
      update(t, info) {
        anim.forEach((a) => a(t, info));
        // the door swings open (outwards) while someone is going through it
        const want = info && info.door ? 1 : 0;
        doorK += (want - doorK) * 0.12;
        hinge.rotation.y = doorK * 1.6;
      },
    };
  }

  root.NSCCOffice = { build };
})(typeof self !== "undefined" ? self : this);
