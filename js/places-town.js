/*
 * places-town.js
 * Two more places for Miis to hang out in around town:
 *
 *   "school"  the College: a lecture room on a little campus (a "dollhouse"
 *             like the office: the wall nearest the camera hides itself so
 *             you can see inside). Lecture desks, a chalkboard full of math,
 *             a projector screen, a lab bench, an art studio, a piano, a study
 *             lounge, a coffee bar and the biology lab's fish tank. Out of the
 *             windows you can see the campus quad, the sports field and the town.
 *             (The id stays "school" so saved games still work.)
 *   "stage"   an outdoor concert in the park at golden hour: a big stage with
 *             colored spotlights, a drum kit, a keyboard and a mic, a big
 *             screen, food stands, benches, string lights and confetti.
 *
 * Both are built with the same toolkit as the other places (World3D.kit), so
 * they share the soft, rounded, toon-shaded Tomodachi Life look.
 */
(function (root) {
  "use strict";

  if (!root.World3D || !root.World3D.kit) return; // (not in a browser, e.g. the tests)

  const {
    THREE, TAU, toon, glow, G, put, ball, cylinder, block, disc, group, dynamic, canvasTexture, seeded,
    skyDome, addLights, mergeStatic, scatter, roundTree, bush, parkBench, lampPost,
  } = root.World3D.kit;
  // (newer kit parts: plain stand-ins if the kit doesn't have them)
  const kit = root.World3D.kit;
  const detailMat = kit.detailMat || ((kind, color) => toon(color));
  const blobShadows = kit.blobShadows || (() => null);
  const litterBin = kit.litterBin || (() => null);
  const uvScaled = kit.uvScaled || ((geo) => geo);
  const extras = kit.extras || ((p, geo, mat, items, cast) => scatter(p, geo, mat, items, cast));
  const PI = Math.PI;

  // =====================================================================
  // Small helpers shared by both places
  // =====================================================================

  // A plain (sharp-cornered) box: lighter than a rounded block, good for small things.
  function bx(p, color, x, y, z, w, h, d, o) {
    return put(p, G.box(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));
  }
  // A material that ignores the lights (for screens and glowing things).
  function basic(map, o) {
    return new THREE.MeshBasicMaterial(Object.assign({ map, toneMapped: false }, o || {}));
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function star(ctx, x, y, r, points) {
    ctx.beginPath();
    for (let i = 0; i < (points || 5) * 2; i++) {
      const a = -PI / 2 + (i * PI) / (points || 5), rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.75, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }
  // A tiny smiling Mii-ish face (for drawings and posters).
  function smiley(ctx, x, y, r, skin, hair) {
    ctx.fillStyle = skin || "#ffd9b0"; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = hair || "#5a3a22"; ctx.beginPath(); ctx.arc(x, y - r * 0.25, r * 1.02, PI * 1.05, PI * 1.95); ctx.fill();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(x - r * 0.35, y + r * 0.05, r * 0.11, 0, TAU); ctx.arc(x + r * 0.35, y + r * 0.05, r * 0.11, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#c0392b"; ctx.lineWidth = Math.max(2, r * 0.1); ctx.beginPath(); ctx.arc(x, y + r * 0.25, r * 0.35, 0.2, PI - 0.2); ctx.stroke();
    ctx.fillStyle = "rgba(255,120,120,0.5)"; ctx.beginPath(); ctx.arc(x - r * 0.6, y + r * 0.35, r * 0.15, 0, TAU); ctx.arc(x + r * 0.6, y + r * 0.35, r * 0.15, 0, TAU); ctx.fill();
  }
  function text(ctx, str, x, y, size, color, align) {
    ctx.fillStyle = color; ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + size + "px 'Nunito', sans-serif";
    ctx.fillText(str, x, y);
  }

  // ---------- one big picture with lots of little pictures on it ----------
  // Posters, signs and paintings all share ONE picture (an "atlas"), so the
  // computer can draw every one of them in a single go.
  //   cells = { name: [width, height, draw(ctx, w, h)] } in pixels
  function makeAtlas(size, cells, height) {
    const H = height || size;
    const c = document.createElement("canvas");
    c.width = size; c.height = H;
    const ctx = c.getContext("2d");
    const rects = {};
    const GAP = 4;
    let x = 0, y = 0, rowH = 0;
    for (const name of Object.keys(cells)) {
      const [w, h, draw] = cells[name];
      if (x + w > size) { x = 0; y += rowH + GAP; rowH = 0; }
      rects[name] = { x, y, w, h };
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      draw(ctx, w, h);
      ctx.restore();
      x += w + GAP;
      rowH = Math.max(rowH, h);
    }
    if (y + rowH > H) console.warn("places-town: atlas is too small");
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    const mat = toon(0xffffff, { map: tex });
    // makes a geometry show one of the little pictures
    function fit(name, geo) {
      const r = rects[name];
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const u = (r.x + 1 + uv.getX(i) * (r.w - 2)) / size;
        const v = 1 - (r.y + 1 + (1 - uv.getY(i)) * (r.h - 2)) / H;
        uv.setXY(i, u, v);
      }
      return geo;
    }
    // a flat picture (faces +z unless turned)
    function pic(p, name, w, h, o, material) {
      return put(p, fit(name, new THREE.PlaneGeometry(w, h)), material || mat, Object.assign({ shadow: false }, o));
    }
    return { tex, mat, pic, fit };
  }

  // ---------- "painted" models: many colors, ONE shape, ONE draw call ----------
  const gradientMap = toon(0xffffff).gradientMap;
  const paintMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap, vertexColors: true });

  function bakeGeo(build) {
    const g = new THREE.Group();
    build(g);
    g.updateMatrixWorld(true);
    const geos = [];
    const col = new THREE.Color();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!src.attributes.normal) src.computeVertexNormals();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", src.attributes.position);
      geo.setAttribute("normal", src.attributes.normal);
      geo.applyMatrix4(o.matrixWorld);
      col.copy(o.material.color);
      if (o.material.emissive && o.material.emissiveIntensity && o.material.emissive.getHex()) col.lerp(new THREE.Color(1, 1, 1), 0.3);
      const n = geo.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b; }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      geos.push(geo);
    });
    return THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
  }
  // list = [[geometry, items, brightness], ...]; items like scatter's { x, y, z, s, sx, sy, sz, ry, color }
  function bakeCopies(list) {
    const c = new THREE.Color();
    return bakeGeo((g) => list.forEach(([geo, items, bright]) => items.forEach((it) => {
      c.set(it.color === undefined ? 0xffffff : it.color).multiplyScalar(bright === undefined ? 1 : bright);
      put(g, geo, toon(c.getHex()), {
        x: it.x, y: it.y || 0, z: it.z, rx: it.rx || 0, ry: it.ry || 0, rz: it.rz || 0,
        sx: it.sx || it.s || 1, sy: it.sy || it.s || 1, sz: it.sz || it.s || 1,
      });
    })));
  }
  function painted(parent, geo, o) {
    return put(parent, geo, paintMat, Object.assign({ shadow: false, receive: false }, o));
  }
  // Builds something that moves as one piece and merges its parts, so it's quick to draw.
  function movingThing(parent, x, y, z, build) {
    const g = new THREE.Group();
    build(g);
    mergeStatic(g);
    g.position.set(x, y, z);
    parent.add(g);
    return dynamic(g);
  }
  // Copies of one shape far away: always drawn, never in shadow.
  function farScatter(parent, geo, mat, items) {
    const m = scatter(parent, geo, mat, items, false);
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }
  // a two-sided triangle (for flags and bunting)
  function triangleGeo(pts) {
    const g = new THREE.BufferGeometry();
    const [a, b, c] = [pts.slice(0, 3), pts.slice(3, 6), pts.slice(6, 9)];
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
    g.computeVertexNormals();
    return g;
  }
  // one box with its bottom at 0, so "sy" is simply the height
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // a pyramid roof (square base of size 1, bottom at 0)
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(PI / 4).translate(0, 0.5, 0);
  const lowCyl = new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, 0.5, 0);

  // ---------- clouds ----------
  const cloudGeo = bakeGeo((g) => {
    const puff = (x, y, z, s, o) => put(g, G.lowSphere(), toon(0xffffff), Object.assign({ x, y, z, s }, o));
    puff(0, 0, 0, 2.2); puff(2.2, -0.4, 0.3, 1.6); puff(-2.1, -0.5, 0, 1.5); puff(0.6, 1.1, 0, 1.4); puff(-0.9, 0.7, 0.6, 1.2);
    puff(0, -0.9, 0, 3.2, { sy: 0.6, sz: 0.5 });
  });
  // a slowly turning ring of clouds all the way round the sky
  function cloudRing(parent, anim, mat, o) {
    const r = seeded(o.seed || 1);
    const items = [];
    for (let i = 0; i < o.count; i++) {
      const a = ((i + r() * 0.7) / o.count) * TAU;
      const d = o.rMin + r() * (o.rMax - o.rMin);
      const s = o.sMin + r() * (o.sMax - o.sMin);
      items.push({ x: Math.cos(a) * d, y: o.yMin + r() * (o.yMax - o.yMin), z: Math.sin(a) * d, s, sy: s * (0.75 + r() * 0.3), ry: -a + PI / 2 });
    }
    const ring = dynamic(farScatter(parent, cloudGeo, mat, items));
    anim.push((t) => { ring.rotation.y = (o.start || 0) + t * o.speed; });
    return ring;
  }

  // Rows of windows painted onto any box, using where the box is in the world
  // (so tall and short buildings get the same size windows). Some are lit up.
  function windowMaterial(o) {
    const mat = new THREE.MeshToonMaterial({ color: o.color || 0xffffff, gradientMap });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.winSize = { value: new THREE.Vector2(o.w || 2.4, o.h || 3.4) };
      sh.uniforms.winGlass = { value: new THREE.Color(o.glass || 0x8fd0ff) };
      sh.uniforms.winLit = { value: new THREE.Color(o.lit || 0xfff1a8) };
      sh.uniforms.winLitAmt = { value: o.litAmount || 0.13 };
      sh.vertexShader = "varying vec3 vWinPos;\nvarying vec3 vWinN;\n" + sh.vertexShader.replace("#include <project_vertex>", [
        "#include <project_vertex>",
        "vec4 winP = vec4(transformed, 1.0);",
        "vec3 winN = objectNormal;",
        "#ifdef USE_INSTANCING",
        "  winP = instanceMatrix * winP;",
        "  winN = mat3(instanceMatrix) * winN;",
        "#endif",
        "vWinPos = (modelMatrix * winP).xyz;",
        "vWinN = normalize(mat3(modelMatrix) * winN);",
      ].join("\n"));
      sh.fragmentShader = "uniform vec2 winSize;\nuniform vec3 winGlass;\nuniform vec3 winLit;\nuniform float winLitAmt;\nvarying vec3 vWinPos;\nvarying vec3 vWinN;\n" +
        sh.fragmentShader.replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float winAmt = 0.0;",
          "vec3 winCol = winGlass;",
          "if (abs(vWinN.y) < 0.5) {",
          "  float u = abs(vWinN.x) > abs(vWinN.z) ? vWinPos.z : vWinPos.x;",
          "  vec2 cell = vec2(u, vWinPos.y) / winSize;",
          "  vec2 f = fract(cell);",
          "  winAmt = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8);",
          "  float rnd = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);",
          "  winCol = rnd < winLitAmt ? winLit : mix(winGlass, vec3(1.0), f.y * 0.35);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, winCol, winAmt);",
          "}",
        ].join("\n")).replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += winCol * winAmt * 0.35;");
    };
    return mat;
  }

  // Grass picture (repeats over the ground).
  function grassTexture(repeat, base, seed) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = base || "#86d65e"; ctx.fillRect(0, 0, w, h);
      const r = seeded(seed || 12);
      for (let i = 0; i < 150; i++) {
        const x = r() * w, y = r() * h;
        ctx.strokeStyle = r() < 0.5 ? "rgba(60,140,40,0.45)" : "rgba(190,245,140,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x + 3, y); ctx.lineTo(x + 4, y - 7); ctx.stroke();
      }
    }, repeat);
  }
  // Wooden floorboards.
  function planksTexture(repeat, shades) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      const r = seeded(31);
      for (let row = 0; row < 8; row++) {
        let x = -r() * 140;
        while (x < w) {
          const len = 90 + r() * 90;
          ctx.fillStyle = shades[Math.floor(r() * shades.length)];
          ctx.fillRect(x, row * 32, len, 32);
          ctx.fillStyle = "rgba(110,60,25,0.35)"; ctx.fillRect(x, row * 32, 2, 32);
          ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x + 4, row * 32 + 4, len - 8, 3);
          x += len;
        }
        ctx.fillStyle = "rgba(110,60,25,0.32)"; ctx.fillRect(0, row * 32 + 30, w, 2);
      }
    }, repeat);
  }
  // Window glass: almost clear with soft streaks of shine.
  function glassMaterial() {
    const tex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "rgba(205,235,255,0.10)"; ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2); ctx.rotate(-0.7); ctx.translate(-w / 2, -h / 2);
      const streak = (x, sw, a) => {
        const g = ctx.createLinearGradient(x - sw, 0, x + sw, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255," + a + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(x - sw, -h, sw * 2, h * 3);
      };
      streak(w * 0.3, 13, 0.34); streak(w * 0.47, 5, 0.26); streak(w * 0.82, 9, 0.16);
      ctx.restore();
    });
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  }

  // A sagging line between two points (for string lights and bunting).
  function sagLine(a, b, sag, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - Math.sin(k * PI) * sag, a.z + (b.z - a.z) * k));
    }
    return pts;
  }
  // a thin cable through a list of points (one cylinder per segment)
  function cable(p, mat, pts, r) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = a.distanceTo(b);
      const m = put(p, G.cyl(5), mat, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, sx: r, sy: len, sz: r, shadow: false });
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
  }

  // ---------- the town far away (houses, trees, hills, all baked in one go) ----------
  // o = { seed, houses: [count, rMin, rMax], trees: [count, rMin, rMax], hills: [count, r], keepOut(x, z), dim }
  function farTown(root, o) {
    const rnd = seeded(o.seed || 9);
    const bodies = [], roofs = [], doors = [], wins = [], trunks = [], crowns = [], hills = [];
    const pastel = [0xfff1dc, 0xffe2b8, 0xffd0c0, 0xd8ecff, 0xdff3c8, 0xffe8f0, 0xf1e4ff, 0xfff6c0];
    const roofC = [0xe2574c, 0x4fa3d9, 0xff9a3a, 0x7a8cff, 0x5cb85c, 0xe86a9a, 0x9a6a3c];
    const keep = (x, z) => !o.keepOut || !o.keepOut(x, z);
    const [nH, hMin, hMax] = o.houses || [0, 0, 0];
    let tries = 0;
    for (let i = 0; i < nH && tries < nH * 20; tries++) {
      const a = rnd() * TAU, d = hMin + rnd() * (hMax - hMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!keep(x, z)) continue;
      // not too close to another house
      if (bodies.some((b) => Math.hypot(b.x - x, b.z - z) < 9)) continue;
      i++;
      const w = 4.5 + rnd() * 3, dd = 4 + rnd() * 2.5, h = 3.2 + rnd() * 2.6;
      const ry = Math.atan2(-x, -z); // facing the middle of the town
      const color = pastel[Math.floor(rnd() * pastel.length)];
      bodies.push({ x, z, sx: w, sy: h, sz: dd, ry, color });
      roofs.push({ x, y: h, z, sx: w * 1.12, sy: 1.6 + rnd() * 1.4, sz: dd * 1.12, ry, color: roofC[Math.floor(rnd() * roofC.length)] });
      const c = Math.cos(ry), s = Math.sin(ry);
      const at = (lx, lz) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
      const dp = at(0, dd / 2 + 0.02);
      doors.push({ x: dp.x, y: 0, z: dp.z, sx: 0.9, sy: 1.7, sz: 0.1, ry, color: 0x9a6a3c });
      for (const sx of [-1, 1]) {
        const wp = at(sx * w * 0.28, dd / 2 + 0.03);
        wins.push({ x: wp.x, y: h * 0.45, z: wp.z, sx: 0.9, sy: 0.9, sz: 0.1, ry, color: rnd() < 0.3 ? 0xffe9a0 : 0x9fd0f0 });
      }
    }
    const [nT, tMin, tMax] = o.trees || [0, 0, 0];
    tries = 0;
    for (let i = 0; i < nT && tries < nT * 20; tries++) {
      const a = rnd() * TAU, d = tMin + rnd() * (tMax - tMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!keep(x, z) || bodies.some((b) => Math.hypot(b.x - x, b.z - z) < 4.5)) continue;
      i++;
      const s = 0.8 + rnd() * 0.7;
      const color = (o.treeColors || [0x5cc84a, 0x4fb043, 0x6fcf55, 0xff9ec7])[Math.floor(rnd() * (o.treeColors || [0, 0, 0, 0]).length)];
      trunks.push({ x, z, sx: 0.3 * s, sy: 2.4 * s, sz: 0.3 * s, color: 0x9a6a3c });
      crowns.push({ x, y: 3.2 * s, z, sx: 1.7 * s, sy: 1.6 * s, sz: 1.7 * s, color });
      if (rnd() < 0.6) crowns.push({ x: x + 0.5 * s, y: 4.1 * s, z: z + 0.3 * s, s: 1.1 * s, color });
    }
    const [nHill, hr] = o.hills || [0, 0];
    for (let i = 0; i < nHill; i++) {
      const a = (i / nHill) * TAU + rnd() * 0.15;
      const d = hr + rnd() * 25;
      const s = 22 + rnd() * 20;
      hills.push({ x: Math.cos(a) * d, y: -3, z: Math.sin(a) * d, sx: s * 1.7, sy: 18 + rnd() * 26, sz: s, ry: -a + PI / 2, color: (o.hillColors || [0x7cc062, 0x8fcf72])[i % 2] });
    }
    const dim = o.dim || 1;
    painted(root, bakeCopies([
      [unitBox, bodies, dim], [roofGeo, roofs, dim], [G.box(), doors.map((q) => Object.assign(q, { y: 0.85 })), dim], [G.box(), wins, dim],
      [lowCyl, trunks, dim], [G.tinySphere(), crowns, dim], [G.lowSphere(), hills, dim],
    ]));
  }

  // A cute little car shape (baked, for driving around).
  const carGeo = bakeGeo((c) => {
    put(c, G.rbox(1.5, 0.6, 2.8, 0.2), toon(0xffffff), { y: 0.55 });
    put(c, G.rbox(1.3, 0.55, 1.5, 0.2), toon(0xffffff), { y: 1.05, z: -0.15 });
    put(c, G.box(), toon(0x8fc8e8), { y: 1.05, z: -0.15, sx: 1.34, sy: 0.32, sz: 1.3 });
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.85, 0.85]) put(c, G.cyl(10), toon(0x2a2f38), { x: sx, y: 0.3, z: sz, sx: 0.3, sy: 0.2, sz: 0.3, rz: PI / 2 });
  });

  // =====================================================================
  // A wall with real window openings (for the school "dollhouse")
  // =====================================================================
  //   along:   the wall runs along "x" (back and front) or "z" (the sides)
  //   core:    where the middle of the wall is (it's 0.5 thick)
  //   inward:  +1 or -1, which side the room is on
  //   from/to: where the wall starts and ends
  //   openings: [{ c: middle, w: width, y0: bottom, y1: top, door: true/false }]
  function buildWall(g, s, along, core, inward, from, to, openings) {
    const face = core + inward * 0.25;
    const piece = (color, u0, u1, y0, y1, d, thick, r) => {
      const len = u1 - u0, h = y1 - y0;
      if (len <= 0.001 || h <= 0.001) return;
      const u = (u0 + u1) / 2, y = (y0 + y1) / 2;
      if (along === "x") block(g, color, u, y, d, len, h, thick, r);
      else block(g, color, d, y, u, thick, h, len, r);
    };
    const ops = openings.slice().sort((a, b) => a.c - b.c);
    const pad = along === "x" ? 0.5 : 0.25;
    const panelD = face + inward * 0.05, trimD = face + inward * 0.11;
    const PH = s.panelH;
    let u = from;
    const solid = (u0, u1) => {
      piece(s.wallC, u0, u1, 0, s.H, core, 0.5, 0.02);
      const p0 = Math.max(u0, from + pad), p1 = Math.min(u1, to - pad);
      piece(s.panelC, p0, p1, 0, PH, panelD, 0.12, 0.02);
      piece(s.trimC, p0, p1, PH - 0.02, PH + 0.12, trimD, 0.1, 0.03);
      piece(s.trimC, p0, p1, 0, 0.2, trimD, 0.1, 0.03);
      // a wooden rail along the top of the wall
      piece(s.topC, u0, u1, s.H - 0.02, s.H + 0.2, core, 0.62, 0.05);
    };
    for (const op of ops) {
      const a = op.c - op.w / 2, b = op.c + op.w / 2;
      solid(u, a);
      piece(s.wallC, a, b, op.y1, s.H, core, 0.5, 0.02);
      piece(s.topC, a, b, s.H - 0.02, s.H + 0.2, core, 0.62, 0.05);
      if (op.door) {
        piece(s.frameC, a, a + 0.2, 0, op.y1, core, 0.62, 0.03);
        piece(s.frameC, b - 0.2, b, 0, op.y1, core, 0.62, 0.03);
        piece(s.frameC, a, b, op.y1 - 0.1, op.y1 + 0.15, core, 0.62, 0.03);
      } else {
        piece(s.wallC, a, b, 0, op.y0, core, 0.5, 0.02);
        if (op.y0 > PH) {
          piece(s.panelC, a, b, 0, PH, panelD, 0.12, 0.02);
          piece(s.trimC, a, b, PH - 0.02, PH + 0.12, trimD, 0.1, 0.03);
        } else piece(s.panelC, a, b, 0, op.y0, panelD, 0.12, 0.02);
        piece(s.trimC, a, b, 0, 0.2, trimD, 0.1, 0.03);
        // frame: a deep sill, the top, the sides and the bars across
        piece(s.frameC, a - 0.15, b + 0.15, op.y0 - 0.1, op.y0 + 0.06, face + inward * 0.14, 0.85, 0.04);
        piece(s.frameC, a - 0.15, b + 0.15, op.y1 - 0.06, op.y1 + 0.14, core + inward * 0.05, 0.62, 0.03);
        piece(s.frameC, a - 0.15, a + 0.06, op.y0, op.y1, core + inward * 0.05, 0.62, 0.03);
        piece(s.frameC, b - 0.06, b + 0.15, op.y0, op.y1, core + inward * 0.05, 0.62, 0.03);
        if (op.w > 3) piece(s.frameC, op.c - 0.06, op.c + 0.06, op.y0, op.y1, core, 0.16, 0.02);
        if (op.y1 - op.y0 > 3.5) piece(s.frameC, a, b, op.y1 - 1.3, op.y1 - 1.18, core, 0.16, 0.02);
        put(g, new THREE.PlaneGeometry(op.w, op.y1 - op.y0), s.glass, {
          x: along === "x" ? op.c : core, y: (op.y0 + op.y1) / 2, z: along === "x" ? core : op.c,
          ry: along === "x" ? 0 : PI / 2, shadow: false, receive: false,
        });
      }
      u = b;
    }
    solid(u, to);
  }

  // =====================================================================
  // COLLEGE — a lecture room on a little university campus
  // =====================================================================

  // the pictures for the college (the chalkboard, the slides, posters, banners...)
  function collegeAtlas() {
    return makeAtlas(1024, {
      blackboard: [1020, 330, (ctx, w, h) => {
        ctx.fillStyle = "#2c5a4a"; ctx.fillRect(0, 0, w, h);
        const r = seeded(5);
        for (let i = 0; i < 45; i++) {
          ctx.fillStyle = "rgba(255,255,255," + (0.025 + r() * 0.04) + ")";
          ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 30 + r() * 90, 8 + r() * 20, r() * 3, 0, TAU); ctx.fill();
        }
        const chalk = "#f3f3e6", yellow = "#ffd97a", blue = "#a8dcff", pink = "#ffb8cf";
        text(ctx, "Calculus II  —  Lecture 7", 40, 40, 38, chalk, "left");
        ctx.strokeStyle = yellow; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(40, 66); ctx.lineTo(470, 66); ctx.stroke();
        text(ctx, "∫₀^∞ e^(−x²) dx = √π / 2", 40, 112, 34, chalk, "left");
        text(ctx, "d/dx [ sin x ] = cos x", 40, 160, 32, chalk, "left");
        text(ctx, "lim (1 + 1/n)ⁿ = e", 40, 208, 32, blue, "left");
        text(ctx, "n→∞", 62, 236, 18, blue, "left");
        text(ctx, "e^(iπ) + 1 = 0", 40, 284, 34, yellow, "left");
        // a graph: a parabola and a sine wave
        const gx = 560, gy = 200;
        ctx.strokeStyle = chalk; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(gx - 120, gy); ctx.lineTo(gx + 130, gy); ctx.moveTo(gx, gy + 100); ctx.lineTo(gx, gy - 150); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx + 130, gy); ctx.lineTo(gx + 118, gy - 7); ctx.moveTo(gx + 130, gy); ctx.lineTo(gx + 118, gy + 7); ctx.stroke();
        text(ctx, "x", gx + 146, gy, 22, chalk); text(ctx, "y", gx, gy - 166, 22, chalk);
        ctx.strokeStyle = pink; ctx.lineWidth = 4; ctx.beginPath();
        for (let x = -100; x <= 100; x += 4) { const y = (x * x) / 80; x === -100 ? ctx.moveTo(gx + x, gy - y) : ctx.lineTo(gx + x, gy - y); }
        ctx.stroke();
        ctx.strokeStyle = blue; ctx.beginPath();
        for (let x = -110; x <= 120; x += 3) { const y = Math.sin(x / 22) * 40; x === -110 ? ctx.moveTo(gx + x, gy - y) : ctx.lineTo(gx + x, gy - y); }
        ctx.stroke();
        text(ctx, "y = x²", gx + 70, gy - 140, 22, pink, "left");
        text(ctx, "y = sin x", gx + 70, gy + 66, 22, blue, "left");
        // a matrix and its determinant
        const mx = 730;
        ctx.strokeStyle = chalk; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(mx + 10, 30); ctx.lineTo(mx, 30); ctx.lineTo(mx, 120); ctx.lineTo(mx + 10, 120);
        ctx.moveTo(mx + 90, 30); ctx.lineTo(mx + 100, 30); ctx.lineTo(mx + 100, 120); ctx.lineTo(mx + 90, 120); ctx.stroke();
        text(ctx, "a   b", mx + 50, 56, 28, chalk); text(ctx, "c   d", mx + 50, 96, 28, chalk);
        text(ctx, "det = ad − bc", mx + 114, 76, 24, chalk, "left");
        text(ctx, "E = mc²", 860, 170, 36, yellow);
        text(ctx, "Σ 1/n² = π²/6", 860, 226, 28, chalk);
        ctx.fillStyle = "rgba(255,217,122,0.9)"; roundRect(ctx, 760, 258, 220, 50, 10); ctx.fill();
        text(ctx, "Midterm: Oct 28!", 870, 284, 26, "#2c5a4a");
        // half rubbed-out sums, a doodle, the homework and chalk dust along the bottom
        for (const [x, y, rw, rh] of [[350, 290, 70, 22], [470, 96, 50, 16], [690, 300, 60, 18]]) {
          ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, -0.1, 0, TAU); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(x - rw * 0.8, y - 4); ctx.quadraticCurveTo(x, y + 8, x + rw * 0.8, y - 2); ctx.stroke();
        }
        ctx.globalAlpha = 0.35; text(ctx, "x = 4", 350, 290, 24, chalk); ctx.globalAlpha = 1;
        ctx.strokeStyle = chalk; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(392, 248, 16, 0, TAU); ctx.stroke();                 // a little smiley doodle
        ctx.beginPath(); ctx.arc(392, 252, 9, 0.3, PI - 0.3); ctx.stroke();
        ctx.fillStyle = chalk; ctx.fillRect(386, 242, 3, 3); ctx.fillRect(396, 242, 3, 3);
        text(ctx, "HW: p.42  #1–9", 40, 316, 20, pink, "left");
        const dust = ctx.createLinearGradient(0, h - 14, 0, h);
        dust.addColorStop(0, "rgba(255,255,255,0)"); dust.addColorStop(1, "rgba(255,255,255,0.16)");
        ctx.fillStyle = dust; ctx.fillRect(0, h - 14, w, 14);
      }],
      hallPlaque: [1020, 64, (ctx, w, h) => {
        ctx.fillStyle = "#6e4527"; roundRect(ctx, 0, 0, w, h, 10); ctx.fill();
        ctx.strokeStyle = "#d9b26a"; ctx.lineWidth = 3; roundRect(ctx, 6, 6, w - 12, h - 12, 8); ctx.stroke();
        text(ctx, "LECTURE HALL 101  ·  DEPARTMENT OF MATHEMATICS & SCIENCE", w / 2, h / 2 + 2, 28, "#f5e2b0");
      }],
      slide: [512, 320, (ctx, w, h) => {
        // what the projector is showing: an economics slide
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#2f4f8f"; ctx.fillRect(0, 0, w, 56);
        text(ctx, "Intro to Economics: Supply & Demand", w / 2, 29, 24, "#ffffff");
        const ox = 90, oy = 270, ax = 250, ay = 180;
        ctx.strokeStyle = "#333"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ox, oy - ay); ctx.lineTo(ox, oy); ctx.lineTo(ox + ax, oy); ctx.stroke();
        text(ctx, "Price", ox - 44, oy - ay / 2, 18, "#555");
        text(ctx, "Quantity", ox + ax / 2, oy + 22, 18, "#555");
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#e2574c"; ctx.beginPath(); ctx.moveTo(ox + 20, oy - 160); ctx.lineTo(ox + ax - 20, oy - 20); ctx.stroke();
        ctx.strokeStyle = "#3a8fd9"; ctx.beginPath(); ctx.moveTo(ox + 20, oy - 20); ctx.lineTo(ox + ax - 20, oy - 160); ctx.stroke();
        ctx.fillStyle = "#ffb000"; ctx.beginPath(); ctx.arc(ox + ax / 2, oy - 90, 8, 0, TAU); ctx.fill();
        text(ctx, "Demand", ox + ax - 4, oy - 30, 18, "#e2574c", "left");
        text(ctx, "Supply", ox + ax - 4, oy - 160, 18, "#3a8fd9", "left");
        ctx.fillStyle = "#333";
        ["• Price goes up:", "   people buy less", "• Where they meet:", "   the market price"].forEach((s, i) => text(ctx, s, 372, 110 + i * 34, 18, i % 2 ? "#555" : "#222", "left"));
        text(ctx, "Prof. Mii  ·  ECON 101", w - 16, h - 16, 14, "#888", "right");
      }],
      noticeBoard: [440, 220, (ctx, w, h) => {
        // a cork board with club flyers and notices
        ctx.fillStyle = "#c99a62"; ctx.fillRect(0, 0, w, h);
        const r = seeded(9);
        for (let i = 0; i < 200; i++) { ctx.fillStyle = "rgba(120,70,30," + (0.1 + r() * 0.15) + ")"; ctx.fillRect(r() * w, r() * h, 2, 2); }
        const flyer = (x, y, pw, ph, rot, bg, draw) => {
          ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
          ctx.fillStyle = bg; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
          draw(pw, ph);
          ctx.fillStyle = "#e23b3b"; ctx.beginPath(); ctx.arc(0, -ph / 2 + 6, 5, 0, TAU); ctx.fill();
          ctx.restore();
        };
        flyer(72, 58, 120, 92, -0.06, "#ffffff", () => { text(ctx, "CHESS CLUB", 0, -14, 17, "#222"); text(ctx, "Thu 7pm", 0, 10, 15, "#666"); text(ctx, "♞", 0, 34, 22, "#222"); });
        flyer(210, 60, 128, 96, 0.05, "#fff2a8", () => { text(ctx, "STUDY GROUP", 0, -18, 16, "#7a4a12"); text(ctx, "Organic Chem", 0, 4, 15, "#7a4a12"); text(ctx, "Library rm 3", 0, 26, 13, "#7a4a12"); });
        flyer(352, 58, 118, 92, -0.04, "#d6ecff", () => { text(ctx, "CAREER FAIR", 0, -14, 16, "#2f4f8f"); text(ctx, "Nov 3 · Gym", 0, 10, 14, "#2f4f8f"); });
        flyer(112, 160, 140, 92, 0.04, "#ffffff", () => {
          text(ctx, "ROOM FOR RENT", 0, -24, 15, "#222"); text(ctx, "near campus", 0, -4, 13, "#666");
          ctx.strokeStyle = "#bbb"; ctx.lineWidth = 1;
          for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-60 + i * 22, 18); ctx.lineTo(-60 + i * 22, 44); ctx.stroke(); }
        });
        flyer(262, 162, 120, 88, -0.07, "#ffd6e2", () => { text(ctx, "LOST:", 0, -14, 16, "#a0304f"); text(ctx, "my calculator!", 0, 10, 14, "#a0304f"); });
        flyer(380, 160, 92, 88, 0.08, "#e4ffd6", () => { text(ctx, "YOGA", 0, -12, 16, "#3f7a2a"); text(ctx, "on the quad", 0, 12, 12, "#3f7a2a"); });
      }],
      library: [200, 270, (ctx, w, h) => {
        ctx.fillStyle = "#7a2f3a"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f6efe2"; roundRect(ctx, 10, 10, w - 20, h - 20, 10); ctx.fill();
        text(ctx, "LIBRARY", w / 2, 44, 30, "#7a2f3a");
        text(ctx, "open 24/7", w / 2, 76, 20, "#555");
        text(ctx, "during finals", w / 2, 100, 20, "#555");
        const cols = ["#7a2f3a", "#2f4f8f", "#3f7a2a", "#c98b2a", "#555"];
        for (let i = 0; i < 9; i++) { ctx.fillStyle = cols[i % 5]; ctx.fillRect(30 + i * 16, 140 + (i % 3) * 8, 13, 90 - (i % 3) * 8); }
        ctx.fillStyle = "#6e4527"; ctx.fillRect(24, 230, 152, 8);
      }],
      studyAbroad: [200, 270, (ctx, w, h) => {
        ctx.fillStyle = "#2f8f9f"; ctx.fillRect(0, 0, w, h);
        text(ctx, "STUDY", w / 2, 40, 32, "#ffffff");
        text(ctx, "ABROAD", w / 2, 76, 32, "#ffe08a");
        ctx.fillStyle = "#bfe8ff"; ctx.beginPath(); ctx.arc(w / 2, 170, 56, 0, TAU); ctx.fill();
        ctx.fillStyle = "#6fc36a";
        ctx.beginPath(); ctx.ellipse(w / 2 - 18, 156, 22, 16, 0.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(w / 2 + 24, 186, 18, 12, -0.3, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.save(); ctx.translate(w / 2 + 40, 120); ctx.rotate(-0.5);
        ctx.fillRect(-22, -3, 44, 6); ctx.fillRect(-4, -16, 8, 32); ctx.fillRect(-20, -8, 5, 16); ctx.restore();
        text(ctx, "Apply by Dec 1", w / 2, 248, 18, "#ffffff");
      }],
      examSchedule: [260, 300, (ctx, w, h) => {
        ctx.fillStyle = "#2f4f8f"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fffef4"; roundRect(ctx, 10, 10, w - 20, h - 20, 10); ctx.fill();
        text(ctx, "FINAL EXAMS", w / 2, 42, 28, "#2f4f8f");
        [["Mon", "Calculus II"], ["Tue", "Economics"], ["Wed", "Chemistry"], ["Thu", "Art History"], ["Fri", "Philosophy"]].forEach(([d, s], i) => {
          text(ctx, d, 26, 92 + i * 40, 20, "#c0392b", "left");
          text(ctx, s, 80, 92 + i * 40, 20, "#333", "left");
        });
      }],
      periodic: [220, 270, (ctx, w, h) => {
        ctx.fillStyle = "#1f2a44"; ctx.fillRect(0, 0, w, h);
        text(ctx, "PERIODIC", w / 2, 30, 24, "#ffe08a");
        text(ctx, "TABLE", w / 2, 58, 24, "#ffe08a");
        const els = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Fe Cu Ag Au".split(" ");
        const cols = ["#ff8a7a", "#ffc46b", "#8fd38a", "#7fc6ff", "#c8a8ff"];
        els.forEach((e, i) => {
          const cx = 14 + (i % 6) * 32, cy = 82 + Math.floor(i / 6) * 44;
          ctx.fillStyle = cols[(i * 7) % 5]; ctx.fillRect(cx, cy, 30, 40);
          text(ctx, e, cx + 15, cy + 22, 16, "#1f2a44");
        });
      }],
      painting1: [220, 180, (ctx, w, h) => {
        ctx.fillStyle = "#bfe6ff"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#6fd36a"; ctx.fillRect(0, h * 0.68, w, h);
        ctx.fillStyle = "#ffe15a"; ctx.beginPath(); ctx.arc(170, 46, 26, 0, TAU); ctx.fill();
        const cols = ["#ff6b8a", "#ffb84d", "#a58cff", "#ffffff"];
        for (let i = 0; i < 7; i++) {
          const x = 20 + i * 28, y = 130 + (i % 2) * 14;
          ctx.strokeStyle = "#3f9a3a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, h); ctx.stroke();
          ctx.fillStyle = cols[i % 4]; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.26) * 7, y + Math.sin(k * 1.26) * 7, 6, 0, TAU); ctx.fill(); }
          ctx.fillStyle = "#ffe15a"; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
        }
      }],
      painting2: [220, 180, (ctx, w, h) => {
        // a still life: a bowl of fruit on a table
        ctx.fillStyle = "#e9dcc4"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#a8774a"; ctx.fillRect(0, 128, w, h);
        ctx.fillStyle = "#e2574c"; ctx.beginPath(); ctx.arc(84, 100, 22, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ffcf3a"; ctx.beginPath(); ctx.ellipse(124, 96, 30, 14, -0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = "#7a3f8f"; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(100 + (i % 3) * 12, 84 + Math.floor(i / 3) * 12, 7, 0, TAU); ctx.fill(); }
        ctx.fillStyle = "#3f6fa8"; ctx.beginPath(); ctx.ellipse(110, 118, 58, 22, 0, 0, PI); ctx.fill();
        ctx.strokeStyle = "#6e4527"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
      }],
      keys: [256, 40, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        const n = 22, kw = w / n;
        ctx.fillStyle = "#c9c9c9"; for (let i = 1; i < n; i++) ctx.fillRect(i * kw - 1, 0, 2, h);
        ctx.fillStyle = "#222";
        for (let i = 0; i < n - 1; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) ctx.fillRect((i + 1) * kw - kw * 0.3, 0, kw * 0.6, h * 0.6);
      }],
      fishSign: [200, 60, (ctx, w, h) => {
        ctx.fillStyle = "#2f4f8f"; roundRect(ctx, 2, 2, w - 4, h - 4, 10); ctx.fill();
        text(ctx, "BIOLOGY LAB", w / 2, 22, 20, "#ffffff");
        text(ctx, "please don't tap the glass", w / 2, 44, 13, "#bfe0ff");
      }],
      loungeSign: [300, 64, (ctx, w, h) => {
        ctx.fillStyle = "#6e4527"; roundRect(ctx, 2, 2, w - 4, h - 4, 12); ctx.fill();
        text(ctx, "Study Lounge", w / 2, h / 2 + 2, 34, "#f5e2b0");
      }],
      collegeSign: [400, 120, (ctx, w, h) => {
        ctx.fillStyle = "#7a2f3a"; roundRect(ctx, 2, 2, w - 4, h - 4, 16); ctx.fill();
        ctx.strokeStyle = "#e0b65a"; ctx.lineWidth = 5; roundRect(ctx, 10, 10, w - 20, h - 20, 12); ctx.stroke();
        text(ctx, "Mii College", w / 2, 50, 48, "#ffffff");
        text(ctx, "EST. 2026  ·  KNOWLEDGE & FRIENDSHIP", w / 2, 92, 18, "#e0b65a");
      }],
      flag: [160, 100, (ctx, w, h) => {
        ctx.fillStyle = "#7a2f3a"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e0b65a"; ctx.fillRect(0, h - 16, w, 6);
        ctx.fillStyle = "#e0b65a"; ctx.beginPath();
        ctx.moveTo(w / 2 - 22, 22); ctx.lineTo(w / 2 + 22, 22); ctx.lineTo(w / 2 + 22, 52); ctx.quadraticCurveTo(w / 2, 76, w / 2 - 22, 52); ctx.closePath(); ctx.fill();
        text(ctx, "M", w / 2, 42, 24, "#7a2f3a");
      }],
      bus: [300, 60, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        text(ctx, "CAMPUS SHUTTLE", w / 2, h / 2 + 2, 32, "#2f4f8f");
      }],
      bannerA: [120, 320, (ctx, w, h) => {
        // a hanging university banner (with a pointed bottom)
        ctx.fillStyle = "#7a2f3a";
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h - 40); ctx.lineTo(w / 2, h); ctx.lineTo(0, h - 40); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#e0b65a"; ctx.fillRect(0, 0, w, 12);
        ctx.beginPath(); ctx.moveTo(w / 2 - 30, 60); ctx.lineTo(w / 2 + 30, 60); ctx.lineTo(w / 2 + 30, 110); ctx.quadraticCurveTo(w / 2, 146, w / 2 - 30, 110); ctx.closePath(); ctx.fill();
        text(ctx, "M", w / 2, 92, 34, "#7a2f3a");
        text(ctx, "MII", w / 2, 190, 30, "#ffffff");
        text(ctx, "COLLEGE", w / 2, 226, 22, "#ffffff");
      }],
      bannerB: [120, 320, (ctx, w, h) => {
        ctx.fillStyle = "#2f4f8f";
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h - 40); ctx.lineTo(w / 2, h); ctx.lineTo(0, h - 40); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#e0b65a"; ctx.fillRect(0, 0, w, 12);
        star(ctx, w / 2, 96, 34); ctx.fill();
        text(ctx, "GO", w / 2, 190, 30, "#ffffff");
        text(ctx, "MIIS!", w / 2, 226, 26, "#e0b65a");
      }],
      rug: [384, 256, (ctx, w, h) => {
        // a patterned rug for the study area
        ctx.fillStyle = "#7a2f3a"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e9d6b0"; ctx.fillRect(16, 16, w - 32, h - 32);
        ctx.fillStyle = "#2f4f8f"; ctx.fillRect(30, 30, w - 60, h - 60);
        ctx.strokeStyle = "#e0b65a"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(w / 2, 46); ctx.lineTo(w - 70, h / 2); ctx.lineTo(w / 2, h - 46); ctx.lineTo(70, h / 2); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = "#e0b65a"; ctx.beginPath(); ctx.arc(w / 2, h / 2, 22, 0, TAU); ctx.fill();
      }],
      yard: [508, 170, (ctx, w, h) => {
        // the campus plaza: red brick paving with the college seal in the middle
        ctx.fillStyle = "#b8775f"; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,240,220,0.45)"; ctx.lineWidth = 1;
        for (let y = 0; y < h; y += 10) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          for (let x = (y / 10) % 2 ? 0 : 10; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 10); ctx.stroke(); }
        }
        const r = seeded(4);
        for (let i = 0; i < 300; i++) { ctx.fillStyle = "rgba(80,30,20," + r() * 0.12 + ")"; ctx.fillRect(r() * w, r() * h, 3, 3); }
        ctx.fillStyle = "#e9dcc4"; ctx.beginPath(); ctx.arc(w / 2, h / 2, 56, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#7a2f3a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(w / 2, h / 2, 48, 0, TAU); ctx.stroke();
        ctx.fillStyle = "#7a2f3a"; star(ctx, w / 2, h / 2, 26); ctx.fill();
        // basketball key
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
        ctx.strokeRect(20, 0, 60, 60); ctx.beginPath(); ctx.arc(50, 60, 30, 0, PI); ctx.stroke();
      }],
      field: [512, 256, (ctx, w, h) => {
        for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#6fcf55" : "#7fd962"; ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h); }
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.beginPath(); ctx.moveTo(w / 2, 10); ctx.lineTo(w / 2, h - 10); ctx.stroke();
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 34, 0, TAU); ctx.stroke();
        ctx.strokeRect(10, h / 2 - 50, 60, 100); ctx.strokeRect(w - 70, h / 2 - 50, 60, 100);
      }],
    }, 2048);
  }

  // A few more posters and the numbers on the lockers (one more little picture sheet)
  function moreCollegePictures() {
    const poster = (bg, draw) => [200, 270, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.9)"; roundRect(ctx, 10, 10, w - 20, h - 20, 12); ctx.fill();
      draw(ctx, w, h);
      ctx.fillStyle = "#e23b3b"; ctx.beginPath(); ctx.arc(w / 2, 8, 6, 0, TAU); ctx.fill(); // (a pin)
    }];
    const cells = {
      pScience: poster("#3f7a2a", (ctx, w) => {
        text(ctx, "SCIENCE", w / 2, 42, 30, "#3f7a2a"); text(ctx, "FAIR", w / 2, 76, 30, "#3f7a2a");
        ctx.fillStyle = "#7fd36a"; ctx.beginPath(); ctx.moveTo(80, 120); ctx.lineTo(120, 120); ctx.lineTo(140, 200); ctx.lineTo(60, 200); ctx.closePath(); ctx.fill(); // a flask...
        ctx.fillStyle = "#cfeeff"; ctx.fillRect(88, 100, 24, 24);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(85 + i * 10, 180 - i * 18, 5, 0, TAU); ctx.fill(); } // ...bubbling
        text(ctx, "Fri · Main Hall", w / 2, 232, 18, "#555");
      }),
      pChoir: poster("#a0304f", (ctx, w) => {
        text(ctx, "JOIN THE", w / 2, 42, 26, "#a0304f"); text(ctx, "CHOIR!", w / 2, 76, 34, "#a0304f");
        ctx.fillStyle = "#a0304f";
        for (const [x, y] of [[70, 170], [130, 150]]) { ctx.beginPath(); ctx.ellipse(x, y, 14, 10, -0.4, 0, TAU); ctx.fill(); ctx.fillRect(x + 10, y - 60, 5, 60); }
        ctx.fillRect(80, 92, 55, 8);
        text(ctx, "♪ Tuesdays ♪", w / 2, 232, 20, "#555");
      }),
      pKind: poster("#2f8f9f", (ctx, w) => {
        text(ctx, "BE KIND", w / 2, 44, 32, "#2f8f9f");
        smiley(ctx, w / 2, 140, 46, "#ffd9b0", "#5a3a22");
        ctx.fillStyle = "#ff6b8a"; heart(ctx, w / 2 + 50, 90, 26);
        text(ctx, "it's cool to care", w / 2, 230, 17, "#555");
      }),
    };
    for (let i = 0; i < 6; i++) cells["num" + i] = [64, 40, (ctx, w, h) => {
      ctx.fillStyle = "#e9eef4"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#8a96a8"; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4);
      text(ctx, String(101 + i), w / 2, h / 2 + 2, 22, "#2a2f38");
    }];
    return makeAtlas(1024, cells, 272);
  }

  // A row of lecture desks: one long desk with four chairs behind it (the
  // students sit on the +z side, facing -z, towards the chalkboard).
  function lectureRow(p, z, xs, rnd) {
    const x0 = xs[0] - 0.9, x1 = xs[xs.length - 1] + 0.9;
    const d = group(p, (x0 + x1) / 2, 0, z);
    const len = x1 - x0;
    const wood = 0xc28a55, dark = 0x7a4e2c, metal = 0x6b7280;
    block(d, wood, 0, 1.0, 0, len, 0.08, 0.85, 0.03);                         // the desk top
    block(d, dark, 0, 0.62, -0.38, len - 0.1, 0.72, 0.06, 0.02);               // modesty panel at the front
    for (const sx of [-len / 2 + 0.12, 0, len / 2 - 0.12]) block(d, dark, sx, 0.5, 0, 0.1, 1.0, 0.8, 0.02);
    for (const x of xs) {
      const lx = x - (x0 + x1) / 2;
      const kind = rnd();
      if (kind < 0.55) {
        // an open laptop (the screen faces the student)
        const lc = [0xc9ced6, 0x3a3f4a, 0xd8c3a8][Math.floor(rnd() * 3)];
        block(d, lc, lx - 0.1, 1.06, 0.08, 0.6, 0.03, 0.4, 0.01);
        block(d, lc, lx - 0.1, 1.27, -0.12, 0.6, 0.4, 0.03, 0.01, { rx: -0.25 });
        bx(d, [0x7fc6ff, 0xbfe3ff, 0x9fd8c8][Math.floor(rnd() * 3)], lx - 0.1, 1.27, -0.103, 0.52, 0.32, 0.005, { rx: -0.25, shadow: false });
      } else {
        // a notebook and a thick textbook
        bx(d, 0xffffff, lx - 0.15, 1.055, 0.1, 0.46, 0.012, 0.32, { ry: (rnd() - 0.5) * 0.4 });
        block(d, [0x7a2f3a, 0x2f4f8f, 0x3f7a2a][Math.floor(rnd() * 3)], lx - 0.2, 1.1, -0.2, 0.46, 0.14, 0.34, 0.02, { ry: (rnd() - 0.5) * 0.3 });
        cylinder(d, 0x2a2f38, lx + 0.12, 1.07, 0.1, 0.018, 0.3, { rz: PI / 2, ry: 0.5, seg: 6 });
      }
      // a coffee cup (or a water bottle)
      if (rnd() < 0.6) { cylinder(d, 0xffffff, lx + 0.42, 1.14, -0.05, 0.07, 0.2); cylinder(d, 0x8a5a3a, lx + 0.42, 1.25, -0.05, 0.072, 0.04); }
      else cylinder(d, 0x4fb7ff, lx + 0.42, 1.2, -0.05, 0.06, 0.34);
      // the chair: padded, on a single post
      const c = group(d, lx, 0, 0.85);
      const seatC = 0x2f3f5f;
      block(c, seatC, 0, 0.58, 0, 0.72, 0.12, 0.62, 0.05);
      block(c, seatC, 0, 1.08, 0.3, 0.72, 0.62, 0.1, 0.06);
      bx(c, metal, 0, 0.75, 0.33, 0.06, 0.4, 0.05);
      cylinder(c, metal, 0, 0.3, 0, 0.05, 0.5);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; bx(c, metal, Math.cos(a) * 0.18, 0.05, Math.sin(a) * 0.18, 0.38, 0.05, 0.06, { ry: -a }); }
    }
    return d;
  }

  // A quick sound made from notes (for the rare events): "meow" | "meowLong" | "whoosh"
  let sfxCtx = null;
  function sfx(kind) {
    try {
      sfxCtx = sfxCtx || new (root.AudioContext || root.webkitAudioContext)();
      const ac = sfxCtx, t0 = ac.currentTime, g = ac.createGain();
      g.connect(ac.destination);
      if (kind === "whoosh") {
        const n = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate), d = n.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const s = ac.createBufferSource(), f = ac.createBiquadFilter();
        s.buffer = n; f.type = "bandpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(600, t0); f.frequency.exponentialRampToValueAtTime(2400, t0 + 0.4);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.08, t0 + 0.15); g.gain.linearRampToValueAtTime(0, t0 + 0.45);
        s.connect(f).connect(g); s.start(t0); s.stop(t0 + 0.5);
        return;
      }
      // a cat: a buzzy note that rises and falls, shaped like "mi-AA-ow"
      const long = kind === "meowLong", len = long ? 1.3 : 0.55;
      const o = ac.createOscillator(), f = ac.createBiquadFilter();
      o.type = "sawtooth"; f.type = "bandpass"; f.Q.value = 4;
      o.frequency.setValueAtTime(480, t0);
      o.frequency.linearRampToValueAtTime(long ? 820 : 720, t0 + len * 0.35);
      if (long) { const v = ac.createOscillator(), vg = ac.createGain(); v.frequency.value = 6; vg.gain.value = 22; v.connect(vg).connect(o.frequency); v.start(t0 + 0.4); v.stop(t0 + len); }
      o.frequency.linearRampToValueAtTime(420, t0 + len);
      f.frequency.setValueAtTime(900, t0); f.frequency.linearRampToValueAtTime(1600, t0 + len * 0.35); f.frequency.linearRampToValueAtTime(700, t0 + len);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.06); g.gain.setValueAtTime(0.16, t0 + len * 0.7); g.gain.linearRampToValueAtTime(0, t0 + len);
      o.connect(f).connect(g); o.start(t0); o.stop(t0 + len + 0.02);
    } catch (e) { /* no sound */ }
  }
  const nearest = (list, x, z) => list.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));

  // RARE (college): a paper airplane glides round and round the lecture hall. Click it
  // and it swoops down to a Mii, who unfolds it and reads the note. (A sticker!)
  // Nobody catches it? It bonks into the wall after a while.
  function paperPlane(root) {
    const plane = dynamic(group(root, 0, -5, 0));
    const paper = toon(0xffffff, { side: THREE.DoubleSide });
    // a folded dart pointing along +x: two wings and a keel
    put(plane, triangleGeo([0.55, 0, 0, -0.45, 0, 0.32, -0.45, 0, 0]), paper, { shadow: false });
    put(plane, triangleGeo([0.55, 0, 0, -0.45, 0, -0.32, -0.45, 0, 0]), paper, { shadow: false });
    put(plane, triangleGeo([0.55, 0, 0, -0.45, -0.14, 0, -0.45, 0, 0]), toon(0xdfe8f2, { side: THREE.DoubleSide }), { shadow: false });
    put(plane, triangleGeo([0.2, 0.001, 0.02, -0.3, 0.001, 0.22, -0.3, 0.001, 0.04]), toon(0xff7aa8, { side: THREE.DoubleSide }), { shadow: false }); // a doodled heart-ish stripe
    plane.scale.setScalar(1.4);
    plane.visible = false;
    let ev = null, check = 5;
    const tmpV = new THREE.Vector3();
    const notes = [
      "It says... 'Will you be my study buddy?' Aww!",
      "A note! 'Pop quiz tomorrow!' ...Oh no.",
      "'You're my favorite classmate!' 💌",
      "It's a doodle of the professor! Hehe!",
      "'Meet me at the lockers after class!' Ooh!",
      "It's the answers to the homework! ...No, it's a grocery list.",
    ];
    const loop = (a) => ({ x: Math.cos(a) * 12, y: 3.3 + Math.sin(a * 3) * 0.45, z: Math.sin(a) * 6.2 - 1.2 });
    function end(ctx, done) {
      ev = null; check = 5;
      plane.visible = false;
      if (done) ctx.event("plane");
    }
    return {
      update(dt, t, ctx) {
        if (!ev) {
          check -= dt;
          if (check > 0) return;
          check = 5;
          if (Math.random() < 0.006) this.force(ctx);
          return;
        }
        ev.time += dt;
        if (ev.phase === "fly") {
          ev.a += dt * 0.42;
          const p = loop(ev.a), q = loop(ev.a + 0.02);
          plane.position.set(p.x, p.y, p.z);
          plane.rotation.set(0, -Math.atan2(q.z - p.z, q.x - p.x), 0);
          plane.rotateX(-0.45 + Math.sin(ev.a * 3) * 0.1); // banking into the turn
          plane.rotateZ((q.y - p.y) * 8);
          if (!ev.seen && ev.time > 3) {
            ev.seen = true;
            const w = ctx.all()[0];
            if (w) ctx.say(w, "Hey! Who threw that?", 2.4);
          }
          if (ev.time > 35) { // nobody caught it: bonk!
            ev.phase = "bonk"; ev.time = 0; ev.from = plane.position.clone();
          }
        } else if (ev.phase === "bonk") {
          plane.position.y = Math.max(0.05, ev.from.y - ev.time * ev.time * 4);
          plane.rotation.z += dt * 6;
          if (ev.time > 1.6) end(ctx, false);
        } else if (ev.phase === "swoop") {
          // down to the Mii's feet in a gentle curve
          const w = ev.w, k = Math.min(1, ev.time / 1.8);
          const tx = w.x + 0.7, tz = w.z + 0.6;
          const x = ev.from.x + (tx - ev.from.x) * k, z = ev.from.z + (tz - ev.from.z) * k;
          plane.position.set(x, ev.from.y + (0.08 - ev.from.y) * (1 - Math.cos(k * PI / 2)) + Math.sin(k * PI) * 0.6, z);
          plane.rotation.set(0, -Math.atan2(tz - ev.from.z, tx - ev.from.x), 0);
          plane.rotateZ(-0.3 * (1 - k));
          if (k >= 1) {
            ev.phase = "read"; ev.time = 0;
            ctx.perform(w, "reading", true);
            w.timer = 4.5;
            w.targetYaw = Math.atan2(plane.position.x - w.x, plane.position.z - w.z);
            ctx.say(w, "Ooh, a paper plane!", 1.6);
          }
        } else if (ev.phase === "read") {
          const w = ev.w;
          if (ev.time > 0.7) { plane.visible = false; w.arms = "type"; } // (picked up and unfolded)
          if (!ev.read && ev.time > 1.6) { ev.read = true; ctx.say(w, notes[Math.floor(Math.random() * notes.length)], 3.4); }
          if (ev.time > 5) { w.arms = "down"; end(ctx, true); }
        }
      },
      pick(ray) {
        if (!ev || ev.phase !== "fly") return false;
        tmpV.copy(plane.position);
        if (ray.distanceSqToPoint(tmpV) > 0.8 * 0.8) return false;
        this.catch(ev.ctx);
        return true;
      },
      catch(ctx) { // (also used for testing)
        if (!ev || ev.phase !== "fly") return;
        const ws = nearest(ctx.all(), plane.position.x, plane.position.z);
        if (!ws.length) { ev.phase = "bonk"; ev.time = 0; ev.from = plane.position.clone(); return; }
        sfx("whoosh");
        Object.assign(ev, { phase: "swoop", time: 0, w: ws[0], from: plane.position.clone() });
      },
      stop(ctx) { if (ev) end(ctx, false); },
      force(ctx) { // (also used for testing)
        if (ev) return;
        ev = { phase: "fly", time: 0, a: Math.random() * TAU, ctx };
        plane.visible = true;
      },
      _state: () => ev, _plane: plane, // (for testing)
    };
  }

  // RARE (concert stage): a little cat strolls out from backstage, right up to the
  // microphone, and sings ("Meow!") under a spotlight. The crowd goes wild, it takes a
  // bow and wanders off again. Watch the whole show for a sticker.
  function stageCat(root, ST) {
    const cat = dynamic(group(root, 0, -5, 0));
    const fur = 0xffa94d, dark = 0x3a2a1a;
    ball(cat, fur, 0, 0.3, 0, 0.26, { sx: 1.4, sy: 0.75 });
    ball(cat, 0xffe2c2, 0.12, 0.25, 0, 0.17, { sx: 1.1, sy: 0.7 }); // a pale tummy
    const head = group(cat, 0.36, 0.48, 0);
    ball(head, fur, 0, 0, 0, 0.19);
    for (const sz of [-0.09, 0.09]) {
      put(head, G.cone(), toon(fur), { y: 0.17, z: sz, s: 0.07, sy: 0.12 });
      ball(head, dark, 0.15, 0.04, sz * 0.7, 0.025);
    }
    ball(head, 0xff8fa8, 0.18, -0.02, 0, 0.022); // nose
    const mouth = ball(head, 0x7a2a2a, 0.16, -0.08, 0, 0.001); // (opens to sing)
    for (const s of [-1, 1]) for (const dy of [-0.02, 0.02]) cylinder(head, 0xffffff, 0.17, -0.03 + dy, s * 0.1, 0.004, 0.16, { rx: PI / 2 + s * 0.2 });
    const tail = group(cat, -0.35, 0.36, 0);
    put(tail, G.capsule(), toon(fur), { y: 0.22, sx: 0.07, sy: 0.22, sz: 0.07 });
    const legs = [];
    for (const [lx, lz] of [[0.2, 0.12], [0.2, -0.12], [-0.2, 0.12], [-0.2, -0.12]]) {
      const l = group(cat, lx, 0.18, lz);
      put(l, G.capsule(), toon(fur), { y: -0.08, sx: 0.07, sy: 0.09, sz: 0.07 });
      legs.push(l);
    }
    cat.scale.setScalar(1.9);
    cat.visible = false;
    // the spotlight on it
    const beam = dynamic(put(root, new THREE.CylinderGeometry(0.25, 1.1, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), { shadow: false }));
    const pool = dynamic(put(root, new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }), { rx: -PI / 2, shadow: false }));
    beam.visible = pool.visible = false;
    const BACK = { x: 1.2, z: ST.z0 + 0.3 }, MIC = { x: 0.85, z: -6.25 };
    let ev = null, check = 5;
    const tmpV = new THREE.Vector3();
    function end(ctx, done) {
      ev = null; check = 5;
      cat.visible = beam.visible = pool.visible = false;
      if (done) ctx.event("cat");
    }
    // walks from a to b (k = 0..1), legs going, facing the way it walks
    function walk(a, b, k, t) {
      cat.position.set(a.x + (b.x - a.x) * k, ST.h, a.z + (b.z - a.z) * k);
      cat.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
      legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 11 + (i % 3 ? PI : 0)) * 0.5; });
      cat.position.y += Math.abs(Math.sin(t * 11)) * 0.03;
    }
    const sing = (long) => { sfx(long ? "meowLong" : "meow"); ev.sing = long ? 1.3 : 0.55; };
    return {
      update(dt, t, ctx) {
        if (!ev) {
          check -= dt;
          if (check > 0) return;
          check = 5;
          if (Math.random() < 0.006) this.force(ctx);
          return;
        }
        ev.time += dt;
        tail.rotation.x = Math.sin(t * 3) * 0.4;
        legs.forEach((l) => { l.rotation.z *= 0.8; });
        ev.sing = Math.max(0, (ev.sing || 0) - dt);
        mouth.scale.setScalar(ev.sing > 0 ? 40 + Math.sin(t * 20) * 8 : 1);
        head.rotation.z = ev.sing > 0 ? 0.35 : 0; // (head up to sing)
        const all = ctx.all();
        if (ev.phase === "in") {
          const k = Math.min(1, ev.time / 3.5);
          cat.scale.setScalar(1.9 * Math.min(1, ev.time * 2));
          walk(BACK, MIC, k, t);
          if (k >= 1) { ev.phase = "show"; ev.time = 0; }
        } else if (ev.phase === "show") {
          // turn to the crowd, the spotlight comes on... and it sings!
          cat.rotation.y += (-PI / 2 - cat.rotation.y) * Math.min(1, dt * 5);
          beam.visible = pool.visible = true;
          const on = Math.min(1, ev.time * 2);
          beam.material.opacity = 0.22 * on; pool.material.opacity = 0.3 * on;
          if (!ev.m1 && ev.time > 1) { ev.m1 = true; sing(false); }
          if (!ev.r1 && ev.time > 1.6) { ev.r1 = true; nearest(all, MIC.x, MIC.z).slice(0, 2).forEach((w, i) => ctx.say(w, ["A cat?!", "Is it going to sing?"][i], 2.2)); }
          if (!ev.m2 && ev.time > 3) { ev.m2 = true; sing(true); }
          if (!ev.r2 && ev.time > 4.6) {
            ev.r2 = true;
            const cheers = ["Encore! Encore!", "Bravo, kitty!", "What a voice!", "Best concert ever!"];
            all.slice(0, 4).forEach((w, i) => { ctx.say(w, cheers[i], 2.4); if (w.state !== "perform") ctx.perform(w, "jump", true); });
          }
          if (ev.time > 6.2) { ev.phase = "bow"; ev.time = 0; }
        } else if (ev.phase === "bow") {
          cat.rotation.z = -Math.sin(Math.min(1, ev.time / 1.4) * PI) * 0.45; // a little bow
          if (ev.time > 1.6) { cat.rotation.z = 0; ev.phase = "out"; ev.time = 0; }
        } else if (ev.phase === "out") {
          const k = Math.min(1, ev.time / 3.5);
          walk(MIC, BACK, k, t);
          const fade = Math.max(0, 1 - ev.time * 1.5);
          beam.material.opacity = 0.22 * fade; pool.material.opacity = 0.3 * fade;
          if (k > 0.85) cat.scale.setScalar(1.9 * Math.max(0.01, (1 - k) / 0.15));
          if (k >= 1) { end(ctx, true); return; }
        }
        beam.scale.set(1, 7, 1);
        beam.position.set(cat.position.x, ST.h + 3.5, cat.position.z);
        pool.position.set(cat.position.x, ST.h + 0.025, cat.position.z);
      },
      pick(ray) {
        if (!ev || !cat.visible) return false;
        tmpV.copy(cat.position).setY(ST.h + 0.6);
        if (ray.distanceSqToPoint(tmpV) > 0.9 * 0.9) return false;
        if (!ev.sing) sing(false); // it meows at you
        return true;
      },
      stop(ctx) { if (ev) end(ctx, false); },
      force() { // (also used for testing)
        if (ev) return;
        ev = { phase: "in", time: 0, sing: 0 };
        cat.visible = true;
        cat.scale.setScalar(0.01);
      },
      _state: () => ev, _cat: cat, // (for testing)
    };
  }

  function buildSchool() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xffffff, ground: 0xd9cfa8, hemi: 0.55, sun: 0.75, ambient: 0.34, fill: 0.35 });
    skyDome(root, 0x4aa8f2, 0xd6efff, 0xa9d98a);
    const atlas = collegeAtlas();
    const A = atlas.pic;
    const books = []; // every book in the college, drawn in one go at the end

    schoolGrounds(root, anim, atlas);

    // ---------- floor ----------
    const floorTex = planksTexture([9, 5.6], ["#efc187", "#e8b678", "#f3c991", "#e3b072"]);
    put(root, new THREE.PlaneGeometry(36.5, 22.5), toon(0xffffff, { map: floorTex }), { y: 0.005, rx: -PI / 2, shadow: false });

    // ---------- walls (each hides when the camera is behind it) ----------
    const W = { back: -11, front: 11, side: 18 };
    const WALL_H = 8;
    // (the panelling and the rail along the top are wood: see the kit's detailMat)
    const style = { H: WALL_H, wallC: 0xf4ead6, panelC: detailMat("wood", 0x9a6a44), trimC: 0xf8f1e2, frameC: 0xffffff, topC: detailMat("wood", 0x8a5a3a), panelH: 1.9, glass: glassMaterial() };
    const more = moreCollegePictures(); // (posters and locker numbers: one more picture for all of them)
    const backWall = group(root), leftWall = group(root), rightWall = group(root), frontWall = group(root);
    const backWindows = [{ c: -15.0, w: 4.2, y0: 1.3, y1: 6.3 }, { c: 8.4, w: 4.2, y0: 3.2, y1: 6.3 }, { c: 14.7, w: 4.2, y0: 1.3, y1: 6.3 }];
    const leftWindows = [{ c: -6.2, w: 4.6, y0: 1.3, y1: 6.3 }];
    const rightWindows = [{ c: -1.0, w: 3.6, y0: 1.3, y1: 6.3 }, { c: 6.3, w: 4.6, y0: 3.4, y1: 6.3 }];
    buildWall(backWall, style, "x", W.back - 0.25, 1, -18.25, 18.25, backWindows);
    buildWall(frontWall, style, "x", W.front + 0.25, -1, -18.25, 18.25, [{ c: 0, w: 3.0, y0: 0, y1: 5.0, door: true }, { c: -10, w: 5, y0: 1.6, y1: 6.2 }, { c: 10, w: 5, y0: 1.6, y1: 6.2 }]);
    buildWall(leftWall, style, "z", -W.side, 1, -11.25, 11.25, leftWindows);
    buildWall(rightWall, style, "z", W.side, -1, -11.25, 11.25, rightWindows);
    // the front doors, each with a round window and a handle
    for (const sx of [-1, 1]) {
      block(frontWall, 0x7a4e2c, sx * 0.66, 2.4, W.front + 0.1, 1.28, 4.75, 0.14, 0.06);
      disc(frontWall, toon(0xcfeeff), sx * 0.66, 3.5, W.front + 0.02, 0.36, { rx: PI });
      put(frontWall, G.torus(0.36, 0.05), toon(0xffffff), { x: sx * 0.66, y: 3.5, z: W.front + 0.02 });
      block(frontWall, 0xffd23f, sx * 0.18, 2.3, W.front + 0.0, 0.1, 0.5, 0.1, 0.04);
    }
    // potted plants on the window sills
    const sillPlant = (wall, x, y, z, color) => {
      put(wall, G.taper(0.17, 0.13), toon(color), { x, y: y + 0.17, z, sy: 0.3 });
      ball(wall, 0x5cc84a, x, y + 0.45, z, 0.22);
      ball(wall, 0xff8ad8, x + 0.08, y + 0.6, z + 0.08, 0.07);
    };
    sillPlant(backWall, -16.2, 1.36, W.back + 0.32, 0xff8a5c);
    sillPlant(backWall, 13.3, 1.36, W.back + 0.32, 0x4fb7ff);
    sillPlant(leftWall, -W.side + 0.32, 1.36, -7.6, 0xffd23f);
    sillPlant(leftWall, -W.side + 0.32, 1.36, -4.8, 0xff6b6b);

    // ---------- the chalkboard (back wall) ----------
    const BB = { x: -5, y: 3.45, w: 9.4, h: 3.1 };
    const bbZ = W.back + 0.25;
    block(backWall, 0xb07a45, BB.x, BB.y, bbZ + 0.04, BB.w + 0.4, BB.h + 0.4, 0.1, 0.05);
    A(backWall, "blackboard", BB.w, BB.h, { x: BB.x, y: BB.y, z: bbZ + 0.1 });
    block(backWall, 0xb07a45, BB.x, BB.y - BB.h / 2 - 0.2, bbZ + 0.2, BB.w, 0.08, 0.3, 0.02); // chalk tray
    for (let i = 0; i < 3; i++) cylinder(backWall, [0xffffff, 0xffd36b, 0xffffff][i], BB.x - 3 + i * 0.25, BB.y - BB.h / 2 - 0.13, bbZ + 0.24, 0.03, 0.22, { rz: PI / 2, seg: 6 });
    block(backWall, 0x7a8ca8, BB.x + 2.5, BB.y - BB.h / 2 - 0.1, bbZ + 0.24, 0.4, 0.12, 0.16, 0.03); // board eraser
    A(backWall, "hallPlaque", BB.w, 0.6, { x: BB.x, y: BB.y + BB.h / 2 + 0.6, z: bbZ + 0.03 });
    // the projector screen (it shows today's slides) and the clock above it
    const SCR = { x: 3.7, y: 4.2, w: 4.4, h: 2.75 };
    cylinder(backWall, 0xe8e8ee, SCR.x, SCR.y + SCR.h / 2 + 0.12, bbZ + 0.18, 0.12, SCR.w + 0.5, { rz: PI / 2 }); // the roller
    block(backWall, 0x2a2f38, SCR.x, SCR.y, bbZ + 0.05, SCR.w + 0.16, SCR.h + 0.16, 0.04, 0.01);
    A(backWall, "slide", SCR.w, SCR.h, { x: SCR.x, y: SCR.y, z: bbZ + 0.08 });
    bx(backWall, 0x2a2f38, SCR.x, SCR.y - SCR.h / 2 - 0.12, bbZ + 0.1, 0.9, 0.05, 0.05);
    const clock = group(backWall, SCR.x, 6.75, bbZ + 0.05);
    cylinder(clock, 0xffffff, 0, 0, 0, 0.55, 0.1, { rx: PI / 2 });
    put(clock, G.torus(0.55, 0.07), toon(0x2a2f38), {});
    for (let i = 0; i < 12; i++) ball(clock, 0x555555, Math.sin((i / 12) * TAU) * 0.42, Math.cos((i / 12) * TAU) * 0.42, 0.06, 0.03);
    const hourHand = dynamic(group(clock, 0, 0, 0.08));
    const minHand = dynamic(group(clock, 0, 0, 0.1));
    block(hourHand, 0x333333, 0, 0.15, 0, 0.07, 0.32, 0.02, 0.02);
    block(minHand, 0x333333, 0, 0.22, 0, 0.05, 0.46, 0.02, 0.02);
    anim.push(() => {
      const now = new Date();
      hourHand.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU;
      minHand.rotation.z = -(now.getMinutes() + now.getSeconds() / 60) / 60 * TAU;
    });
    A(backWall, "periodic", 1.4, 1.72, { x: 11.55, y: 4.5, z: bbZ + 0.04 });
    A(leftWall, "studyAbroad", 1.5, 2.0, { x: -W.side + 0.28, y: 4.4, z: 2.2, ry: PI / 2 });
    A(leftWall, "library", 1.5, 2.0, { x: -W.side + 0.28, y: 4.4, z: -1.4, ry: PI / 2 });
    A(frontWall, "examSchedule", 2.0, 2.3, { x: -4.5, y: 4.0, z: W.front - 0.28, ry: PI });
    A(rightWall, "noticeBoard", 3.6, 1.8, { x: W.side - 0.28, y: 4.4, z: -6.4, ry: -PI / 2 });
    A(rightWall, "loungeSign", 2.6, 0.55, { x: W.side - 0.28, y: 2.95, z: 6.3, ry: -PI / 2 });
    // college banners hanging high up on the walls
    const banner = (wall, name, x, z, ry) => {
      A(wall, name, 1.0, 2.67, { x, y: 5.75, z, ry });
      cylinder(wall, 0xd9b26a, x - (ry === 0 ? 0 : 0), 7.12, z, 0.04, 1.2, { rz: ry === 0 ? PI / 2 : 0, rx: ry === 0 ? 0 : PI / 2 });
    };
    banner(backWall, "bannerA", -11.4, bbZ + 0.06, 0);
    banner(leftWall, "bannerB", -W.side + 0.3, 9.2, PI / 2);
    banner(leftWall, "bannerA", -W.side + 0.3, -10.0, PI / 2);
    banner(rightWall, "bannerB", W.side - 0.3, 2.4, -PI / 2);
    banner(rightWall, "bannerA", W.side - 0.3, -9.9, -PI / 2);

    // ---------- the lecture desks: 3 long rows of 4 seats, facing the chalkboard ----------
    const RZ = [-4.6, -1.3, 2.0];
    const CX = [-9.8, -6.6, -3.4, -0.2];
    const drnd = seeded(11);
    for (const z of RZ) lectureRow(root, z, CX, drnd);

    // ---------- the professor's desk, with the projector ----------
    const TD = { x: 1.0, z: -8.1 };
    const td = group(root, TD.x, 0, TD.z);
    block(td, 0xb8743a, 0, 0.55, 0, 3.0, 1.1, 1.15, 0.08);
    block(td, 0xd99a5a, 0, 1.13, 0, 3.15, 0.1, 1.3, 0.04);
    block(td, 0x9a5e2c, 0, 0.6, 0.58, 2.6, 0.7, 0.04, 0.02, { shadow: false });
    // the laptop running the slides
    block(td, 0x3a3f4a, -0.9, 1.21, 0.1, 0.62, 0.03, 0.42, 0.01);
    block(td, 0x3a3f4a, -0.9, 1.42, 0.31, 0.62, 0.42, 0.03, 0.01, { rx: 0.25 });
    bx(td, 0x7fc6ff, -0.9, 1.42, 0.292, 0.54, 0.34, 0.005, { rx: 0.25, shadow: false });
    for (let i = 0; i < 3; i++) block(td, [0x7a2f3a, 0x2f4f8f, 0x3f7a2a][i], -0.15, 1.24 + i * 0.12, 0.25, 0.62, 0.11, 0.44, 0.02, { ry: i * 0.12 }); // textbooks
    cylinder(td, 0xffffff, 0.3, 1.3, 0.35, 0.09, 0.22);                            // a coffee mug
    put(td, G.torus(0.06, 0.018), toon(0xffffff), { x: 0.4, y: 1.31, z: 0.35, ry: PI / 2 });
    bx(td, 0xffffff, 0.95, 1.2, 0.25, 0.6, 0.03, 0.45, { ry: -0.2 });             // essays to mark
    bx(td, 0xffffff, 0.97, 1.23, 0.28, 0.6, 0.03, 0.45, { ry: 0.1 });
    bx(td, 0xe2574c, 1.0, 1.25, 0.3, 0.02, 0.02, 0.32, { ry: 0.5 });               // red pen
    // the projector, shining onto the screen on the back wall
    const PJ = { x: TD.x + 1.05, y: 1.36, z: TD.z - 0.15 };
    block(td, 0xe8e8ee, 1.05, 1.27, -0.15, 0.6, 0.2, 0.45, 0.05);
    cylinder(td, 0x2a2f38, 1.05, 1.28, -0.39, 0.08, 0.06, { rx: PI / 2 });
    ball(td, glow(0x9fe0ff, 0.7), 1.05, 1.28, -0.42, 0.06, { sz: 0.3 });
    const beamLen = Math.hypot(SCR.x - PJ.x, SCR.y - PJ.y, (bbZ + 0.1) - PJ.z);
    const beam = put(root, new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true).rotateY(PI / 4), new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
      { x: (SCR.x + PJ.x) / 2, y: (SCR.y + PJ.y) / 2, z: (bbZ + 0.1 + PJ.z) / 2, shadow: false, receive: false });
    beam.scale.set(SCR.w * 0.98, beamLen, SCR.h * 0.98); // (the wide end covers the screen)
    beam.lookAt(PJ.x, PJ.y, PJ.z);
    beam.rotateX(PI / 2); // the cone's point at the projector
    // the professor's chair (behind the desk)
    const tch = group(root, TD.x, 0, TD.z - 1.15);
    block(tch, 0x2f6f9f, 0, 0.58, 0, 0.8, 0.12, 0.75, 0.06);
    block(tch, 0x2f6f9f, 0, 1.1, -0.36, 0.8, 0.9, 0.1, 0.06);
    cylinder(tch, 0x555a66, 0, 0.3, 0, 0.05, 0.5);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; bx(tch, 0x555a66, Math.cos(a) * 0.22, 0.06, Math.sin(a) * 0.22, 0.45, 0.05, 0.07, { ry: -a }); }

    // ---------- the globe ----------
    const GL = { x: -12.3, z: -8.6 };
    const globeTex = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = "#3fa9f5"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#7fd36a";
      const blob = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };
      blob([[20, 30], [60, 22], [74, 48], [56, 60], [48, 86], [34, 60], [16, 46]]);
      blob([[52, 84], [70, 90], [62, 120], [50, 110]]);
      blob([[110, 26], [170, 18], [220, 34], [210, 60], [170, 56], [150, 70], [118, 50]]);
      blob([[118, 64], [144, 70], [138, 104], [122, 96]]);
      blob([[196, 92], [226, 94], [222, 112], [198, 110]]);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, 8); ctx.fillRect(0, h - 8, w, 8);
    });
    const gst = group(root, GL.x, 0, GL.z);
    cylinder(gst, 0xb07a45, 0, 0.05, 0, 0.45, 0.1);
    cylinder(gst, 0xb07a45, 0, 0.6, 0, 0.05, 1.1);
    put(gst, G.torus(0.62, 0.03), toon(0xd9a441), { y: 1.75, ry: PI / 2, rz: 0.4 });
    const globeSpin = dynamic(group(gst, 0, 1.75, 0));
    globeSpin.rotation.z = 0.4;
    const globeBall = put(globeSpin, G.sphere(), toon(0xffffff, { map: globeTex }), { s: 0.56 });
    anim.push((t) => { globeBall.rotation.y = t * 0.6; });

    // ---------- the lab bench (back right) ----------
    const SC = { x: 8.4, z: -10.1 };
    const sci = group(root, SC.x, 0, SC.z);
    block(sci, 0x4f8fd0, 0, 0.5, 0, 5.4, 1.0, 1.0, 0.06);
    block(sci, 0xf4f6fa, 0, 1.05, 0.02, 5.6, 0.1, 1.15, 0.03);
    for (let i = 0; i < 4; i++) {
      bx(sci, 0x3a78b8, -2.0 + i * 1.33, 0.5, 0.505, 1.2, 0.85, 0.02, { shadow: false });
      ball(sci, 0xffffff, -2.0 + i * 1.33 + 0.4, 0.75, 0.53, 0.05);
    }
    // microscope
    const mic = group(sci, -1.7, 1.1, 0.0, 0.4);
    block(mic, 0x2f3542, 0, 0.04, 0, 0.42, 0.08, 0.5, 0.03);
    block(mic, 0x2f3542, 0, 0.35, -0.16, 0.09, 0.6, 0.12, 0.03, { rx: 0.15 });
    bx(mic, 0xdfe4ea, 0, 0.26, 0.04, 0.32, 0.03, 0.3);
    cylinder(mic, 0xffffff, 0, 0.55, 0.04, 0.07, 0.4, { rx: -0.35 });
    cylinder(mic, 0x2f3542, 0, 0.78, -0.03, 0.05, 0.16, { rx: -0.35 });
    // beakers and test tubes with bright liquids (one clear glass material for all of them)
    const glassy = toon(0xd8f0ff, { transparent: true, opacity: 0.45 });
    [[-0.8, 0x6fd36a], [-0.45, 0xff8ad8], [-0.1, 0x4fb7ff]].forEach(([x, c], i) => {
      cylinder(sci, c, x, 1.18 + i * 0.03, 0.15, 0.13, 0.16 + i * 0.06);
      cylinder(sci, glassy, x, 1.28, 0.15, 0.15, 0.36);
    });
    block(sci, 0x9a6a3c, 0.6, 1.16, 0.3, 0.7, 0.06, 0.18, 0.02);
    for (let i = 0; i < 4; i++) {
      cylinder(sci, [0xff6b6b, 0xffd23f, 0x6fd36a, 0xa58cff][i], 0.36 + i * 0.16, 1.28, 0.3, 0.035, 0.14);
      cylinder(sci, glassy, 0.36 + i * 0.16, 1.36, 0.3, 0.045, 0.32);
    }
    // a plant growth study: three pots, the one in the sun grew the most
    for (let i = 0; i < 3; i++) {
      const px = 1.25 + i * 0.42;
      put(sci, G.taper(0.15, 0.11), toon(0xe0784a), { x: px, y: 1.25, z: -0.1, sy: 0.26 });
      const hgt = 0.12 + i * 0.22;
      cylinder(sci, 0x4f9e35, px, 1.38 + hgt / 2, -0.1, 0.018, hgt, { seg: 5 });
      ball(sci, 0x6fd36a, px + 0.06, 1.38 + hgt, -0.1, 0.06 + i * 0.03, { sy: 0.5 });
      ball(sci, 0x6fd36a, px - 0.06, 1.33 + hgt, -0.1, 0.05 + i * 0.03, { sy: 0.5 });
      bx(sci, 0xffffff, px, 1.22, 0.06, 0.18, 0.1, 0.01, { shadow: false });
    }
    // a ball-and-stick molecule model (it slowly turns)
    const VO = { x: SC.x + 2.25, y: 1.1, z: SC.z + 0.1 };
    block(sci, 0x2a2f38, 2.25, 1.14, 0.1, 0.5, 0.06, 0.4, 0.02);
    cylinder(sci, 0x9aa3b0, 2.25, 1.4, 0.1, 0.02, 0.5);
    // (one painted shape, so the whole model is drawn in one go)
    const mol = dynamic(painted(root, bakeGeo((m) => {
      ball(m, 0x2a2f38, 0, 0, 0, 0.16);
      const arms = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      arms.forEach(([ax, ay, az], i) => {
        const v = new THREE.Vector3(ax, ay, az).normalize();
        ball(m, i === 0 ? 0xe2574c : 0xffffff, v.x * 0.42, v.y * 0.42, v.z * 0.42, 0.1);
        const stick = cylinder(m, 0xbfc4cc, v.x * 0.21, v.y * 0.21, v.z * 0.21, 0.025, 0.3);
        stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      });
    }), { x: VO.x, y: VO.y + 0.95, z: VO.z }));
    const tmp = new THREE.Object3D();
    anim.push((t) => { mol.rotation.set(0.3, t * 0.5, 0); });
    // a big leafy plant in the corner
    const bigPlant = group(root, 16.7, 0, -9.9, 0, 0.9);
    cylinder(bigPlant, 0xffffff, 0, 0.45, 0, 0.45, 0.9);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      put(bigPlant, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: Math.cos(a) * 0.4, y: 1.7 + (i % 3) * 0.3, z: Math.sin(a) * 0.4, sx: 0.22, sy: 0.85, sz: 0.22, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
    }

    // ---------- the piano (right wall) ----------
    const PN = { x: 17.15, z: -6.4 };
    const pn = group(root, PN.x, 0, PN.z, -PI / 2); // its keys face -x (into the room)
    block(pn, 0xd9473f, 0, 1.15, 0, 2.6, 2.3, 0.95, 0.1);
    block(pn, 0xb8352f, 0, 2.33, 0.05, 2.75, 0.1, 1.1, 0.04);
    block(pn, 0xd9473f, 0, 1.12, 0.62, 2.5, 0.12, 0.45, 0.04);              // the key shelf
    A(pn, "keys", 2.3, 0.36, { y: 1.185, z: 0.62, rx: -PI / 2 });
    block(pn, 0xb8352f, 0, 0.55, 0.62, 2.5, 0.06, 0.3, 0.02);
    for (const sx of [-1.15, 1.15]) block(pn, 0xb8352f, sx, 0.55, 0.62, 0.12, 1.1, 0.4, 0.03);
    bx(pn, 0xffffff, 0, 1.65, 0.49, 0.8, 0.5, 0.03, { rx: -0.2 });          // sheet music
    for (let i = 0; i < 4; i++) bx(pn, 0x333333, 0, 1.52 + i * 0.1, 0.505, 0.7, 0.012, 0.01, { rx: -0.2, shadow: false });
    put(pn, G.taper(0.05, 0.16, 4), toon(0x6e4527), { x: 0.9, y: 2.6, z: 0.0, sy: 0.4, ry: PI / 4 }); // a metronome
    block(pn, 0x8a5a3a, 0, 0.3, 1.35, 1.5, 0.08, 0.6, 0.04);                // bench
    block(pn, 0xff8ad8, 0, 0.6, 1.35, 1.4, 0.12, 0.55, 0.06);
    for (const sx of [-0.6, 0.6]) bx(pn, 0x8a5a3a, sx, 0.28, 1.35, 0.08, 0.56, 0.5);
    // music notes floating up from the piano
    const noteTex = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#ff6b8a";
      ctx.beginPath(); ctx.ellipse(22, 48, 12, 9, -0.4, 0, TAU); ctx.fill();
      ctx.fillRect(31, 10, 5, 38);
      ctx.beginPath(); ctx.moveTo(31, 10); ctx.quadraticCurveTo(50, 16, 52, 32); ctx.quadraticCurveTo(44, 22, 36, 22); ctx.fill();
    });
    const notes = dynamic(new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: noteTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, toneMapped: false }), 3));
    notes.frustumCulled = false;
    notes.castShadow = false;
    root.add(notes);
    anim.push((t) => {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.35 + i / 3) % 1;
        tmp.position.set(PN.x - 0.6 - k * 0.8, 2.6 + k * 2.2, PN.z - 0.6 + i * 0.6 + Math.sin(t * 2 + i) * 0.2);
        tmp.rotation.set(0, -PI / 2 + 0.6, Math.sin(t * 3 + i) * 0.3);
        tmp.scale.setScalar(Math.sin(k * PI) * 1.2);
        tmp.updateMatrix(); notes.setMatrixAt(i, tmp.matrix);
      }
      notes.instanceMatrix.needsUpdate = true;
    });

    // ---------- art studio: easels and a messy art table ----------
    const easel = (x, z, ry, picName) => {
      const e = group(root, x, 0, z, ry);
      const wood = 0xc98b4a;
      for (const sx of [-0.42, 0.42]) block(e, wood, sx, 1.15, 0.12, 0.07, 2.4, 0.07, 0.02, { rx: -0.1, rz: -sx * 0.25 });
      block(e, wood, 0, 1.05, -0.4, 0.07, 2.2, 0.07, 0.02, { rx: 0.35 });
      block(e, wood, 0, 0.95, 0.24, 1.1, 0.07, 0.18, 0.02);
      block(e, 0xffffff, 0, 1.58, 0.2, 1.05, 0.85, 0.05, 0.01, { rx: -0.1 });
      A(e, picName, 0.95, 0.75, { y: 1.58, z: 0.232, rx: -0.1 });
      for (let i = 0; i < 3; i++) cylinder(e, [0xff6b6b, 0x4fb7ff, 0xffd23f][i], -0.3 + i * 0.3, 1.03, 0.25, 0.06, 0.1);
      return e;
    };
    const E1 = { x: 8.4, z: -4.6, ry: -2.3 };
    const E2 = { x: 11.8, z: -3.6, ry: -0.35 };
    easel(E1.x, E1.z, E1.ry, "painting1");
    easel(E2.x, E2.z, E2.ry, "painting2");
    const AT = { x: 10.2, z: -0.4 };
    const art = group(root, AT.x, 0, AT.z, 0.1);
    block(art, 0xd9c09a, 0, 0.78, 0, 2.4, 0.08, 1.2, 0.04);
    for (const sx of [-1.05, 1.05]) for (const sz of [-0.5, 0.5]) bx(art, 0x6e4527, sx, 0.38, sz, 0.08, 0.76, 0.08);
    bx(art, 0xffffff, -0.5, 0.83, 0.1, 0.8, 0.02, 0.6, { ry: 0.2 });
    bx(art, 0xffffff, 0.3, 0.84, -0.1, 0.7, 0.02, 0.55, { ry: -0.3 });
    ball(art, 0xff6b8a, -0.6, 0.85, 0.15, 0.1, { sy: 0.1 });
    ball(art, 0x4fb7ff, 0.4, 0.86, -0.05, 0.12, { sy: 0.1 });
    for (let i = 0; i < 6; i++) cylinder(art, [0xff6b6b, 0xffb84d, 0xffe15a, 0x6fd36a, 0x4fb7ff, 0xa58cff][i], 0.6 + (i % 3) * 0.17, 0.9, -0.3 + Math.floor(i / 3) * 0.2, 0.07, 0.14);
    block(art, 0x2f3542, -0.95, 0.87, -0.35, 0.4, 0.1, 0.25, 0.03);             // a jar of brushes
    for (let i = 0; i < 5; i++) cylinder(art, 0x9a6a3c, -1.1 + i * 0.07, 1.0, -0.35, 0.015, 0.24, { seg: 5, rz: (i - 2) * 0.08 });
    // a little stool on each side
    for (const sx of [-0.7, 0.7]) {
      cylinder(root, 0x6e4527, AT.x + sx, 0.45, AT.z + 1.05, 0.25, 0.08);
      for (let i = 0; i < 3; i++) bx(root, 0x9aa3b0, AT.x + sx + Math.cos(i * 2.1) * 0.15, 0.22, AT.z + 1.05 + Math.sin(i * 2.1) * 0.15, 0.05, 0.44, 0.05);
    }

    // ---------- study lounge (front right) ----------
    const rugTex = canvasTexture(256, 256, (ctx, w, h) => {
      const cols = ["#7a2f3a", "#e9d6b0", "#2f4f8f", "#e9d6b0", "#7a2f3a", "#e0b65a", "#e9d6b0"];
      for (let i = 0; i < cols.length; i++) { ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - i * 17, 0, TAU); ctx.fill(); }
    });
    disc(root, toon(0xffffff, { map: rugTex }), 13.4, 0.02, 6.6, 2.9);
    // tall bookshelves against the right wall
    for (const sz of [4.6, 7.8]) {
      const sh = group(root, W.side - 0.6, 0, sz, -PI / 2);
      const wood = 0xc98b4a;
      bx(sh, wood, 0, 1.2, -0.35, 3.0, 2.4, 0.06);
      for (const sx of [-1.47, 1.47]) bx(sh, wood, sx, 1.2, 0, 0.08, 2.4, 0.75);
      for (let row = 0; row < 4; row++) {
        bx(sh, wood, 0, 0.05 + row * 0.62, 0, 3.0, 0.06, 0.75);
        let x = -1.35;
        const r = seeded(row * 7 + Math.round(sz * 3));
        while (x < 1.25) {
          const bw = 0.08 + r() * 0.08, bh = 0.34 + r() * 0.16;
          if (r() < 0.08) { x += 0.2; continue; }
          // the shelf is turned to face -x, so its local x runs along world z
          books.push({ x: W.side - 0.6 + 0.02, y: 0.08 + row * 0.62 + bh / 2, z: sz - x - bw / 2, sx: 0.5, sy: bh, sz: bw,
            rx: r() < 0.1 ? 0.25 : 0, color: [0x7a2f3a, 0x2f4f8f, 0x3f7a2a, 0xc98b2a, 0x5a3a6a, 0x2a2f38, 0xe9d6b0, 0x9a3b3b][Math.floor(r() * 8)] });
          x += bw + 0.01;
        }
      }
      bx(sh, wood, 0, 2.43, 0, 3.0, 0.06, 0.78);
    }
    // a library cart on wheels
    const bcart = group(root, 15.4, 0, 9.0);
    block(bcart, 0x6e4527, 0, 0.45, 0, 1.3, 0.7, 0.6, 0.06);
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.2, 0.2]) ball(bcart, 0x333333, sx, 0.08, sz, 0.08);
    for (let i = 0; i < 8; i++) books.push({ x: 15.4 - 0.5 + i * 0.13, y: 0.95, z: 9.0, sx: 0.09, sy: 0.4, sz: 0.4, rz: (i - 4) * 0.05, color: [0x7a2f3a, 0x2f4f8f, 0xc98b2a, 0x3f7a2a][i % 4] });
    // squishy beanbags
    const beanbag = (x, z, color) => {
      ball(root, color, x, 0.32, z, 0.7, { sy: 0.5 });
      ball(root, color, x, 0.5, z - 0.32, 0.55, { sy: 0.55, sz: 0.6 });
    };
    const BB1 = { x: 13.0, z: 7.4 };
    beanbag(BB1.x, BB1.z, 0xc98b2a);
    beanbag(14.9, 4.8, 0x2f4f8f);
    beanbag(11.2, 5.2, 0x9a3b3b);
    // an open book on the blue beanbag
    bx(root, 0xffffff, 14.9, 0.62, 5.0, 0.5, 0.04, 0.34, { ry: 0.3, rx: -0.1 });

    // ---------- a group study table in the middle ----------
    A(root, "rug", 6, 4, { x: 5.4, y: 0.02, z: 5.2, rx: -PI / 2 });
    const ST = { x: 5.4, z: 5.2 };
    const stab = group(root, ST.x, 0, ST.z);
    cylinder(stab, 0xc28a55, 0, 1.0, 0, 1.15, 0.1);
    cylinder(stab, 0x6b7280, 0, 0.5, 0, 0.09, 1.0);
    cylinder(stab, 0x6b7280, 0, 0.04, 0, 0.5, 0.08);
    // laptops, a pile of notes, coffee and a shared snack
    block(stab, 0xc9ced6, -0.45, 1.07, 0.3, 0.55, 0.03, 0.38, 0.01, { ry: 0.5 });
    block(stab, 0xc9ced6, -0.55, 1.26, 0.48, 0.55, 0.36, 0.03, 0.01, { ry: 0.5, rx: 0.25 });
    block(stab, 0x3a3f4a, 0.45, 1.07, -0.25, 0.55, 0.03, 0.38, 0.01, { ry: 2.6 });
    block(stab, 0x3a3f4a, 0.56, 1.26, -0.42, 0.55, 0.36, 0.03, 0.01, { ry: 2.6, rx: -0.25 });
    for (let i = 0; i < 3; i++) bx(stab, 0xffffff, 0.1 + i * 0.05, 1.07 + i * 0.012, 0.35, 0.42, 0.01, 0.3, { ry: i * 0.4 });
    for (const [cx, cz] of [[-0.2, -0.45], [0.55, 0.4]]) { cylinder(stab, 0xffffff, cx, 1.15, cz, 0.07, 0.2); cylinder(stab, 0x8a5a3a, cx, 1.26, cz, 0.072, 0.03); }
    cylinder(stab, 0xe2574c, -0.6, 1.08, -0.2, 0.18, 0.05);
    for (let i = 0; i < 5; i++) ball(stab, 0xf2c06a, -0.6 + Math.cos(i * 1.3) * 0.08, 1.13, -0.2 + Math.sin(i * 1.3) * 0.08, 0.05);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4;
      const sx = Math.cos(a) * 1.55, sz = Math.sin(a) * 1.55;
      cylinder(root, 0x2f3f5f, ST.x + sx, 0.62, ST.z + sz, 0.26, 0.1);
      cylinder(root, 0x6b7280, ST.x + sx, 0.3, ST.z + sz, 0.04, 0.6);
      cylinder(root, 0x6b7280, ST.x + sx, 0.03, ST.z + sz, 0.2, 0.05);
    }

    // ---------- lockers and cubbies (left wall) ----------
    const lockerC = [0x5a7fa8, 0x52769e, 0x5a7fa8, 0x52769e, 0x5a7fa8, 0x52769e];
    for (let i = 0; i < 6; i++) {
      const lz = -0.1 + i * 1.0;
      const l = group(root, -W.side + 0.65, 0, lz, PI / 2);
      block(l, lockerC[i], 0, 1.45, 0, 0.94, 2.9, 0.8, 0.05);
      for (let k = 0; k < 4; k++) bx(l, 0x333333, 0, 2.5 + k * 0.1, 0.405, 0.5, 0.03, 0.01, { shadow: false });
      bx(l, 0xdfe4ea, 0.3, 1.5, 0.41, 0.06, 0.3, 0.04);
      more.pic(l, "num" + i, 0.3, 0.18, { y: 2.05, z: 0.41 });
      bx(l, 0x2a2f38, 0, 0.13, 0.405, 0.86, 0.2, 0.01);                            // a kick plate
      bx(l, 0x52769e, 0, 2.93, 0, 0.98, 0.06, 0.84);                                 // the top
      if (i % 3 === 1) { // a padlock
        block(l, 0xd9b26a, 0.3, 1.22, 0.44, 0.1, 0.12, 0.05, 0.02);
        put(l, G.torus(0.035, 0.012), toon(0x9aa3b0), { x: 0.3, y: 1.3, z: 0.44 });
      }
      if (i === 2 || i === 5) bx(l, [0xffd23f, 0xff6b8a][i === 2 ? 0 : 1], -0.2, 1.75, 0.41, 0.14, 0.14, 0.01, { rz: 0.4 }); // a sticker
    }
    // stuff left on top of the lockers: a box, a basketball and a backpack
    block(root, 0xc9a46a, -W.side + 0.65, 3.17, 0.9, 0.6, 0.42, 0.7, 0.04, { ry: 0.15 });
    ball(root, 0xff8a3a, -W.side + 0.6, 3.18, 3.9, 0.22);
    block(root, 0x6fd36a, -W.side + 0.55, 3.15, 4.9, 0.4, 0.45, 0.55, 0.12, { ry: -0.3 });
    // a recycling bin by the lockers
    const RCB = { x: -W.side + 0.7, z: -1.35 };
    litterBin(root, RCB.x, RCB.z, 0x4a90e2, PI / 2);
    // the coffee bar: a counter with a coffee machine, cups and a menu board
    const cub = group(root, -W.side + 0.6, 0, 7.95, PI / 2);
    block(cub, 0x7a4e2c, 0, 0.55, 0, 3.3, 1.1, 0.75, 0.05);
    block(cub, 0x2a2f38, 0, 1.13, 0.02, 3.4, 0.07, 0.82, 0.02);
    for (let c = 0; c < 3; c++) bx(cub, 0x5a3a22, -1.07 + c * 1.07, 0.55, 0.38, 0.95, 0.85, 0.02, { shadow: false });
    block(cub, 0x3a3f4a, -0.8, 1.6, -0.1, 0.8, 0.9, 0.5, 0.06);               // the coffee machine
    block(cub, 0x9aa3b0, -0.8, 1.32, 0.12, 0.5, 0.06, 0.25, 0.02);
    ball(cub, glow(0xff5a3a, 0.8), -0.55, 1.85, 0.16, 0.04);
    cylinder(cub, 0x2a2f38, -0.8, 1.42, 0.12, 0.05, 0.12);
    cylinder(cub, 0xffffff, -0.8, 1.27, 0.14, 0.06, 0.13);
    for (let i = 0; i < 4; i++) cylinder(cub, 0xffffff, 0.2, 1.22 + i * 0.1, 0.0, 0.07, 0.1);   // a stack of cups
    for (let i = 0; i < 3; i++) { cylinder(cub, [0x7a2f3a, 0x2f4f8f, 0xc98b2a][i], 0.7 + i * 0.28, 1.24, 0.1, 0.07, 0.17); }
    cylinder(cub, 0xe9d6b0, 1.4, 1.26, -0.15, 0.12, 0.2);                       // sugar jar
    const menu = canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = "#2a2f38"; ctx.fillRect(0, 0, w, h);
      text(ctx, "COFFEE BAR", w / 2, 28, 26, "#e0b65a");
      [["Espresso", "1"], ["Latte", "2"], ["Tea", "1"], ["Cocoa", "2"]].forEach(([n, pr], i) => {
        text(ctx, n, 24, 64 + i * 24, 18, "#f3f3e6", "left"); text(ctx, pr + " \uD83E\uDE99", w - 24, 64 + i * 24, 16, "#f3f3e6", "right");
      });
    });
    put(cub, new THREE.PlaneGeometry(1.6, 1.0), toon(0xffffff, { map: menu }), { y: 2.75, z: -0.34, shadow: false });

    // ---------- the biology lab's fish tank ----------
    const PT = { x: -7.5, z: 10.1 };
    const pet = group(root, PT.x, 0, PT.z);
    block(pet, 0x7a4e2c, 0, 0.45, 0, 2.2, 0.9, 0.9, 0.06);
    block(pet, 0x8a5a3a, 0, 0.92, 0, 2.3, 0.06, 1.0, 0.03);
    A(pet, "fishSign", 0.9, 0.27, { y: 0.6, z: -0.46, ry: PI });
    // the tank: gravel, water, plants and a frame
    const TK = { w: 1.9, h: 0.95, d: 0.7, y: 0.95 };
    bx(pet, 0xd9c09a, 0, TK.y + 0.06, 0, TK.w - 0.04, 0.1, TK.d - 0.04);
    put(pet, G.box(), toon(0x6fc6e8, { transparent: true, opacity: 0.35, depthWrite: false }), { y: TK.y + TK.h / 2, sx: TK.w - 0.04, sy: TK.h - 0.08, sz: TK.d - 0.04, shadow: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(pet, 0x2a2f38, sx * TK.w / 2, TK.y + TK.h / 2, sz * TK.d / 2, 0.04, TK.h, 0.04);
    for (const y of [TK.y, TK.y + TK.h]) { bx(pet, 0x2a2f38, 0, y, -TK.d / 2, TK.w, 0.04, 0.04); bx(pet, 0x2a2f38, 0, y, TK.d / 2, TK.w, 0.04, 0.04); }
    for (let i = 0; i < 5; i++) put(pet, G.capsule(), toon(i % 2 ? 0x3f9a3a : 0x5cc84a), { x: -0.75 + i * 0.36, y: TK.y + 0.35, z: 0.15 - (i % 2) * 0.25, sx: 0.05, sy: 0.3 + (i % 3) * 0.08, sz: 0.05, rz: (i - 2) * 0.12 });
    ball(pet, 0x9aa3b0, 0.5, TK.y + 0.15, 0.1, 0.12, { sy: 0.7 });
    // the fish (they swim round and round)
    const fishC = [0xff8a2a, 0xffd23f, 0x4fb7ff, 0xff6b8a];
    // (each fish is one painted shape: drawn in one go)
    const fish = fishC.map((c) => dynamic(painted(pet, bakeGeo((f) => {
      ball(f, c, 0, 0, 0, 0.08, { sx: 1.5, sz: 0.6 });
      put(f, G.cone(4), toon(c), { x: -0.14, s: 0.07, sy: 0.08, rz: PI / 2 });
      ball(f, 0x222222, 0.08, 0.02, 0.035, 0.015);
    }), { y: TK.y + 0.5 })));
    anim.push((t) => {
      fish.forEach((f, i) => {
        const a = t * (0.5 + i * 0.12) + i * 1.7;
        f.position.set(Math.cos(a) * 0.7, TK.y + 0.3 + i * 0.13 + Math.sin(t * 1.3 + i) * 0.05, Math.sin(a) * 0.18);
        f.rotation.y = -a - PI / 2;
      });
    });
    // bubbles rising from the pump
    const bubbles = dynamic(new THREE.InstancedMesh(G.lowSphere(), toon(0xffffff, { transparent: true, opacity: 0.6 }), 5));
    bubbles.frustumCulled = false;
    root.add(bubbles);
    anim.push((t) => {
      for (let i = 0; i < 5; i++) {
        const k = (t * 0.5 + i / 5) % 1;
        tmp.position.set(PT.x + 0.5 + Math.sin(t * 3 + i) * 0.03, TK.y + 0.25 + k * (TK.h - 0.35), PT.z + 0.1);
        tmp.scale.setScalar(0.025 + k * 0.02);
        tmp.updateMatrix(); bubbles.setMatrixAt(i, tmp.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    });

    // plants by the door
    for (const px of [-3.4, 3.4]) {
      cylinder(root, 0xffffff, px, 0.4, 10.0, 0.4, 0.8);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        put(root, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: px + Math.cos(a) * 0.3, y: 1.4 + (i % 3) * 0.25, z: 10.0 + Math.sin(a) * 0.3, sx: 0.2, sy: 0.7, sz: 0.2, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
      }
    }
    // a waste paper basket by the professor's desk
    put(root, G.taper(0.3, 0.24), toon(0x6b7280), { x: TD.x + 2.0, y: 0.3, z: TD.z - 0.2, sy: 0.6 });
    ball(root, 0xffffff, TD.x + 2.05, 0.62, TD.z - 0.2, 0.1);

    // every book in one go
    // a few more books: a pile on the study table, one by a beanbag and some on the professor's desk
    for (let i = 0; i < 4; i++) books.push({ x: ST.x - 0.15 + (i % 2) * 0.04, y: 1.08 + i * 0.07, z: ST.z - 0.65, sx: 0.36, sy: 0.07, sz: 0.26, ry: i * 0.25, color: [0x2f4f8f, 0xc98b2a, 0x7a2f3a, 0x3f7a2a][i] });
    for (let i = 0; i < 3; i++) books.push({ x: 12.2 + i * 0.03, y: 0.04 + i * 0.07, z: 6.5, sx: 0.36, sy: 0.07, sz: 0.27, ry: 0.6 - i * 0.3, color: [0x9a3b3b, 0x2a2f38, 0xe9d6b0][i] });
    // every book in one go (with bands and a title on the spine)
    scatter(root, G.box(), detailMat("spine", 0xffffff), books, true);

    // ---------- merge everything that doesn't move ----------
    // more posters on the walls
    more.pic(leftWall, "pScience", 1.2, 1.62, { x: -W.side + 0.28, y: 4.4, z: -3.0, ry: PI / 2 });
    more.pic(leftWall, "pKind", 1.2, 1.62, { x: -W.side + 0.28, y: 4.6, z: 5.7, ry: PI / 2 });
    more.pic(rightWall, "pChoir", 1.05, 1.42, { x: W.side - 0.28, y: 3.3, z: 2.4, ry: -PI / 2 });
    // soft shadows on the floor under the furniture (see blobShadows)
    blobShadows(root, [
      ...RZ.map((z) => ({ x: -5, z: z + 0.4, r: 6.2, sz: 1.2 })),
      { x: TD.x, z: TD.z - 0.4, r: 2.0, sz: 1.3 }, { x: GL.x, z: GL.z, r: 0.6 }, { x: SC.x, z: SC.z + 0.1, r: 3.1, sz: 0.8 },
      { x: 16.7, z: -9.9, r: 0.6 }, { x: 16.6, z: PN.z, r: 1.3, sz: 1.8 }, { x: E1.x, z: E1.z, r: 0.7 }, { x: E2.x, z: E2.z, r: 0.7 },
      { x: AT.x, z: AT.z + 0.2, r: 1.6, sz: 1.1 }, { x: W.side - 0.6, z: 6.2, r: 0.7, sz: 3.4 }, { x: 15.4, z: 9.0, r: 0.9, sz: 0.5 },
      { x: BB1.x, z: BB1.z - 0.1, r: 0.9 }, { x: 14.9, z: 4.7, r: 0.9 }, { x: 11.2, z: 5.1, r: 0.9 },
      { x: -W.side + 0.65, z: 2.4, r: 0.7, sz: 3.3 }, { x: -W.side + 0.6, z: 7.95, r: 0.7, sz: 1.9 }, { x: PT.x, z: PT.z, r: 1.4, sz: 0.65 },
      { x: ST.x, z: ST.z, r: 1.4 }, { x: -3.4, z: 10.0, r: 0.55 }, { x: 3.4, z: 10.0, r: 0.55 }, { x: RCB.x, z: RCB.z, r: 0.45 },
    ], 0.22, 0x3a2410);

    const walls = [
      { group: backWall, axis: "z", at: W.back, outside: -1 },
      { group: frontWall, axis: "z", at: W.front, outside: 1 },
      { group: leftWall, axis: "x", at: -W.side, outside: -1 },
      { group: rightWall, axis: "x", at: W.side, outside: 1 },
    ];
    for (const w of walls) { mergeStatic(w.group); dynamic(w.group); }
    mergeStatic(root);

    // ---------- spots ----------
    const studyLines = [
      ["*types notes*", "Is this going to be on the exam?", "I think I get it now!", "Can I borrow your charger?"],
      ["Need... more... coffee...", "*highlights everything*", "My essay is due Friday!", "Wait, which chapter are we on?"],
      ["I finished the reading!", "*raises hand*", "A pop quiz?! Already?", "These notes are a mess..."],
    ];
    const studySpot = (col, row, i) => ({
      x: CX[col], z: RZ[row] + 2.0, yaw: PI, arms: "type", emoji: ["💻", "📓", "📝"][i], activity: "taking notes in a lecture",
      seat: { x: CX[col], z: RZ[row] + 0.85, y: 0.0 },
      lines: studyLines[i],
    });

    return {
      group: root,
      background: 0xd6efff,
      rare: paperPlane(root), // a paper airplane goes round the lecture hall
      fog: [0xd6efff, 90, 300],
      cameraTilt: 0.5,
      // zoomed right out, the camera stays inside the ring of trees round the campus
      cameraMaxDistance: 30,
      bounds: { minX: -17.3, maxX: 17.3, minZ: -10.3, maxZ: 10 },
      water: [],
      obstacles: RZ.map((z) => ({ x: -5, z: z + 0.35, w: 11.0, d: 1.75 }))           // the rows of desks and chairs
        .concat([
          { x: BB.x, z: W.back + 0.55, w: BB.w + 0.4, d: 0.5 },                         // the chalkboard's chalk tray
          { x: TD.x, z: TD.z - 0.5, w: 3.4, d: 2.4 },                                   // professor's desk + chair
          { x: TD.x + 2.0, z: TD.z - 0.2, r: 0.35 },                                    // waste paper basket
          { x: GL.x, z: GL.z, r: 0.6 },                                                 // globe
          { x: SC.x, z: SC.z, w: 5.7, d: 1.3 },                                         // lab bench
          { x: 16.7, z: -9.9, r: 0.65 },                                                // big plant
          { x: 16.45, z: PN.z, w: 2.6, d: 2.9 },                                        // piano + bench
          { x: E1.x, z: E1.z, r: 0.6 }, { x: E2.x, z: E2.z, r: 0.6 },                   // easels
          { x: AT.x, z: AT.z + 0.25, w: 2.7, d: 2.1, rot: -0.1 },                       // art table + stools
          { x: W.side - 0.6, z: 6.2, w: 1.0, d: 6.4 },                                  // bookshelves
          { x: 15.4, z: 9.0, w: 1.4, d: 0.7 },                                          // book box
          { x: BB1.x, z: BB1.z - 0.1, r: 0.65 }, { x: 14.9, z: 4.7, r: 0.65 }, { x: 11.2, z: 5.1, r: 0.65 }, // beanbags
          { x: -W.side + 0.65, z: 2.4, w: 1.0, d: 6.2 },                                // lockers
          { x: -W.side + 0.6, z: 7.95, w: 1.0, d: 3.4 },                                // coffee bar
          { x: PT.x, z: PT.z, w: 2.4, d: 1.1 },                                         // fish tank table
          { x: ST.x, z: ST.z, r: 1.95 },                                                // study table + stools
          { x: -3.4, z: 10.0, r: 0.5 }, { x: 3.4, z: 10.0, r: 0.5 },                    // plants by the door
          { x: RCB.x, z: RCB.z, r: 0.35 },                                              // recycling bin
        ]),
      spots: [
        studySpot(1, 0, 0), studySpot(2, 1, 1), studySpot(0, 2, 2),
        { x: BB.x, z: -9.45, yaw: 0, arms: "out", emoji: "🧑‍🏫", activity: "giving a lecture",
          lines: ["Good morning, everyone!", "Any questions so far?", "This WILL be on the exam.", "Let's derive this together.", "Office hours are at three!"] },
        { x: GL.x, z: -9.95, yaw: 0, emoji: "🌍", activity: "looking at the globe",
          lines: ["I'm studying abroad here next year!", "*spins the globe*", "So much ocean!", "I want to do fieldwork there someday."] },
        { x: -15.2, z: -9.85, yaw: PI, lookUp: 0.1, emoji: "🪟", activity: "gazing out the window",
          lines: ["The quad looks nice today...", "Is this lecture over yet?", "I can see the sports field!", "*daydreaming*"] },
        { x: SC.x - 0.3, z: -8.5, yaw: PI, arms: "type", emoji: "🔬", activity: "running a lab experiment",
          lines: ["Titrating... very... carefully...", "Look at these cells!", "The data supports my hypothesis!", "My lab report is due tomorrow..."] },
        { x: E1.x + Math.sin(E1.ry) * 1.3, z: E1.z + Math.cos(E1.ry) * 1.3, yaw: E1.ry + PI, arms: "wave", emoji: "🎨", activity: "painting at an easel",
          lines: ["A little more blue...", "It's a masterpiece!", "Oops, paint on my nose!", "Happy little trees~"] },
        { x: PN.x - 2.75, z: PN.z, yaw: PI / 2, arms: "type", emoji: "🎹", activity: "practicing for a recital",
          lines: ["Do re mi fa so~", "♪ La la la ♪", "My recital is next week!", "A little Chopin, anyone?"],
          seat: { x: PN.x - 1.4, z: PN.z, y: 0.06 } },
        { x: BB1.x, z: BB1.z + 1.5, yaw: 0, emoji: "📖", activity: "studying in the lounge",
          lines: ["Just one more chapter...", "Cramming for finals...", "Shh, I'm studying.", "This textbook weighs a ton!"],
          seat: { x: BB1.x, z: BB1.z - 0.05, y: -0.12 } },
        { x: PT.x, z: PT.z - 1.5, yaw: 0, arms: "out", emoji: "🐠", activity: "watching the lab's fish",
          lines: ["Hello, little fish!", "That one's called Professor Bubbles.", "Biology is fascinating.", "So relaxing..."] },
        { x: -W.side + 2.1, z: 2.4, yaw: -PI / 2, emoji: "🎒", activity: "checking the lockers",
          lines: ["Where did I put my textbook?", "Found my notes!", "Who left a sandwich in here?!", "My locker is so messy..."] },
        { x: -W.side + 2.1, z: 7.95, yaw: -PI / 2, arms: "out", emoji: "☕", activity: "getting a coffee",
          lines: ["One latte, please!", "Coffee is my fuel.", "*sips* Ahh, much better.", "Third cup today..."] },
        { x: ST.x + 1.68, z: ST.z + 1.68, yaw: -3 * PI / 4, arms: "type", emoji: "📚", activity: "at a study group",
          lines: ["Okay, who's got question 4?", "Let's quiz each other!", "We've got this, team!", "Snack break?"],
          seat: { x: ST.x + 1.1, z: ST.z + 1.1, y: 0.07 } },
      ],
      lines: [
        "Did you do the reading?", "I love college!", "Coffee before class!", "Want to form a study group?",
        "Shh, the professor's here!", "I aced the midterm!", "Can I borrow your notes?", "College life is great!",
        "Who wants to be my lab partner?", "Is this lecture recorded?",
      ],
      entrance: { x: 0, z: 9.4 },
      update(t, camera) {
        anim.forEach((a) => a(t));
        // hide any wall that's between the camera and the room
        if (camera) {
          for (const w of walls) {
            const c = w.axis === "z" ? camera.position.z : camera.position.x;
            w.group.visible = (c - w.at) * w.outside < 0;
          }
        }
      },
    };
  }

  // ---------------------------------------------------------------------
  // Outside the college: the plaza, the campus quad, sports field and town
  // ---------------------------------------------------------------------
  function schoolGrounds(root, anim, atlas) {
    const A = atlas.pic;
    disc(root, toon(0xffffff, { map: grassTexture([70, 70]) }), 0, -0.03, 0, 230);
    // the building's base and a pavement all round it
    // a brick plinth round the bottom of the building, and stone paving all round it
    put(root, uvScaled(G.rbox(37.4, 0.3, 23.4, 0.05), 21, 0.25), detailMat("brick", 0xc9806a), { y: -0.15, shadow: false });
    put(root, uvScaled(G.box(), 20, 13), detailMat("slabs", 0xeae3d6), { y: -0.025, sx: 41, sy: 0.01, sz: 27, shadow: false });

    // ----- behind the college: a brick plaza, the quad, the sports field -----
    A(root, "yard", 30, 10, { x: -9, y: -0.015, z: -18.5, rx: -PI / 2 });
    // basketball hoop
    const hoop = group(root, -21, 0, -23.2);
    cylinder(hoop, 0x4f5a6e, 0, 1.6, 0, 0.1, 3.2);
    block(hoop, 0xffffff, 0, 3.4, 0.3, 1.6, 1.0, 0.08, 0.03);
    bx(hoop, 0xff6b3a, 0, 3.25, 0.35, 0.6, 0.45, 0.02, { shadow: false });
    put(hoop, G.torus(0.28, 0.03), toon(0xff6b3a), { y: 3.0, z: 0.7, rx: PI / 2 });
    // the campus quad: a lawn crossed by paths, with a fountain, the founder's
    // statue, benches, picnic tables and lamp posts with banners
    const PG = { x: 14, z: -21 };
    disc(root, toon(0x86d36a), PG.x, -0.012, PG.z, 1, { sx: 9, sy: 7 });
    bx(root, 0xe9dcc4, PG.x, -0.006, PG.z, 18, 0.01, 1.6, { shadow: false });
    bx(root, 0xe9dcc4, PG.x, -0.006, PG.z, 1.6, 0.01, 14, { shadow: false });
    // the fountain
    const fnt = group(root, PG.x, 0, PG.z);
    cylinder(fnt, 0xdfe4ea, 0, 0.3, 0, 2.3, 0.6);
    cylinder(fnt, 0x5fb8e8, 0, 0.56, 0, 2.05, 0.06);
    cylinder(fnt, 0xdfe4ea, 0, 1.1, 0, 0.25, 1.2);
    cylinder(fnt, 0xdfe4ea, 0, 1.7, 0, 0.9, 0.18);
    cylinder(fnt, 0x5fb8e8, 0, 1.8, 0, 0.78, 0.04);
    const spray = dynamic(ball(root, toon(0xbfe8ff, { transparent: true, opacity: 0.7 }), PG.x, 2.1, PG.z, 0.25));
    anim.push((t) => { const k = 1 + Math.sin(t * 6) * 0.12; spray.scale.set(0.25 * k, 0.45 / k, 0.25 * k); });
    // the founder's statue (in a graduation cap, naturally)
    const stt = group(root, PG.x - 5.5, 0, PG.z + 0.2, PI / 2);
    block(stt, 0xcfc8bb, 0, 0.7, 0, 1.4, 1.4, 1.4, 0.05);
    const bronze = 0xb08a4a;
    ball(stt, bronze, 0, 2.05, 0, 0.42, { sy: 1.3, sx: 0.85 });
    ball(stt, bronze, 0, 2.85, 0, 0.42);
    block(stt, 0x2a2f38, 0, 3.24, 0, 0.8, 0.06, 0.8, 0.01, { ry: PI / 4 });
    cylinder(stt, 0x2a2f38, 0, 3.15, 0, 0.24, 0.14);
    cylinder(stt, 0xe0b65a, 0.3, 3.05, 0.0, 0.015, 0.35, { seg: 4 });
    block(stt, bronze, 0.35, 2.1, 0.25, 0.3, 0.4, 0.1, 0.03, { rx: -0.3 }); // holding a book
    // benches and picnic tables around the fountain
    parkBench(root, PG.x, PG.z + 4.4, PI);
    parkBench(root, PG.x + 4.5, PG.z - 3.2, -PI / 2);
    const picnic = (x, z, ry) => {
      const pt = group(root, x, 0, z, ry);
      block(pt, 0xa8774a, 0, 0.95, 0, 2.2, 0.1, 0.9, 0.03);
      for (const sz of [-0.8, 0.8]) block(pt, 0xa8774a, 0, 0.55, sz, 2.2, 0.08, 0.35, 0.03);
      for (const sx of [-0.8, 0.8]) bx(pt, 0x7a4e2c, sx, 0.45, 0, 0.1, 0.9, 1.9, { rx: 0 });
    };
    picnic(PG.x + 5.5, PG.z + 3.2, 0.2);
    picnic(PG.x - 3.5, PG.z - 4.6, -0.15);
    for (const [lx, lz, b] of [[PG.x - 2, PG.z + 3, "bannerA"], [PG.x + 2, PG.z - 3, "bannerB"]]) {
      lampPost(root, lx, lz);
      A(root, b, 0.5, 1.33, { x: lx + 0.32, y: 2.6, z: lz, ry: PI / 2 });
      A(root, b, 0.5, 1.33, { x: lx + 0.33, y: 2.6, z: lz, ry: -PI / 2 });
    }
    // the clock tower on the far side of the campus
    const tw = group(root, 27, 0, -40, -0.4);
    put(tw, uvScaled(G.rbox(3.4, 12, 3.4, 0.05), 1.5, 7.5), detailMat("brick", 0xb8664f), { y: 6 });
    block(tw, 0xe9dcc4, 0, 12.6, 0, 3.8, 1.4, 3.8, 0.05);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      disc(tw, toon(0xffffff), Math.sin(a) * 1.92, 12.6, Math.cos(a) * 1.92, 0.55, { rx: 0, ry: a });
      bx(tw, 0x2a2f38, Math.sin(a) * 1.95, 12.75, Math.cos(a) * 1.95, 0.06, 0.4, 0.02, { ry: a });
      bx(tw, 0x2a2f38, Math.sin(a) * 1.95 + Math.cos(a) * 0.12, 12.6, Math.cos(a) * 1.95 - Math.sin(a) * 0.12, 0.3, 0.05, 0.02, { ry: a });
    }
    put(tw, G.cone(4), toon(0x2f4f5f), { y: 15.0, sx: 3.0, sy: 3.4, sz: 3.0, ry: PI / 4 });
    for (let i = 0; i < 4; i++) bx(tw, 0xe9dcc4, 0, 2.5 + i * 2.6, 1.72, 0.7, 1.2, 0.04);

    // sports field with a running track
    const F = { x: -6, z: -37 };
    const rr = (w, h, r) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -PI / 2, 0);
      s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, PI / 2);
      s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, PI / 2, PI);
      s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, PI, PI * 1.5);
      return s;
    };
    const trackShape = rr(38, 24, 11.5);
    trackShape.holes.push(rr(31, 17, 8));
    put(root, new THREE.ShapeGeometry(trackShape, 24).rotateX(-PI / 2), toon(0xe0785a), { x: F.x, y: -0.01, z: F.z, shadow: false });
    for (const k of [0.33, 0.66]) {
      const lane = rr(31 + 7 * k, 17 + 7 * k, 8 + 3.5 * k);
      lane.holes.push(rr(31 + 7 * k - 0.15, 17 + 7 * k - 0.15, 8 + 3.5 * k - 0.075));
      put(root, new THREE.ShapeGeometry(lane, 24).rotateX(-PI / 2), toon(0xffffff), { x: F.x, y: -0.005, z: F.z, shadow: false });
    }
    A(root, "field", 26, 13, { x: F.x, y: -0.012, z: F.z, rx: -PI / 2 });
    for (const side of [-1, 1]) {
      const gl = group(root, F.x + side * 12.6, 0, F.z, side > 0 ? -PI / 2 : PI / 2);
      for (const sx of [-1.6, 1.6]) cylinder(gl, 0xffffff, sx, 0.9, 0, 0.07, 1.8);
      cylinder(gl, 0xffffff, 0, 1.8, 0, 0.07, 3.2, { rz: PI / 2 });
      bx(gl, 0xdfe4ea, 0, 0.9, -0.7, 3.2, 1.8, 0.03, { shadow: false });
    }
    ball(root, 0xffffff, F.x + 2, 0.25, F.z + 1, 0.25);

    // ----- in front of the college -----
    bx(root, 0xf0dcb4, 0, -0.012, 17.5, 3.4, 0.01, 13, { shadow: false });   // path to the gate
    // flower beds along the front of the building
    const flowers = [];
    const fr = seeded(6);
    for (const cx of [-10, 10]) {
      put(root, uvScaled(G.rbox(13, 0.36, 0.9, 0.05), 5, 1), detailMat("wood", 0xb07a45), { x: cx, y: 0.18, z: 12.4 });
      bx(root, 0x7a4e2c, cx, 0.37, 12.4, 12.6, 0.04, 0.7, { shadow: false });
      for (let i = 0; i < 26; i++) flowers.push({ x: cx - 6 + i * 0.48, y: 0.5, z: 12.4 + (fr() - 0.5) * 0.4, s: 0.12, color: [0xff6b8a, 0xffd23f, 0xffffff, 0xa58cff, 0xff8a5c][Math.floor(fr() * 5)] });
    }
    scatter(root, G.lowSphere(), toon(0xffffff), flowers);
    // flagpole with a waving flag
    const FP = { x: 7.5, z: 15.5 };
    cylinder(root, 0xdfe4ea, FP.x, 0.15, FP.z, 0.4, 0.3);
    cylinder(root, 0xdfe4ea, FP.x, 4.0, FP.z, 0.07, 8.0);
    ball(root, 0xffd23f, FP.x, 8.05, FP.z, 0.14);
    const flagGeo = atlas.fit("flag", new THREE.PlaneGeometry(2.2, 1.4, 10, 1));
    const flagBase = flagGeo.attributes.position.array.slice();
    const flag = dynamic(put(root, flagGeo, toon(0xffffff, { map: atlas.tex, side: THREE.DoubleSide }), { x: FP.x + 1.15, y: 7.1, z: FP.z, shadow: false }));
    anim.push((t) => {
      const pos = flagGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = flagBase[i * 3] + 1.1; // 0 at the pole
        pos.setZ(i, Math.sin(x * 2.4 - t * 4) * 0.14 * x);
        pos.setY(i, flagBase[i * 3 + 1] - x * 0.04);
      }
      pos.needsUpdate = true;
      flagGeo.computeVertexNormals();
    });
    void flag;
    // the college sign (on a brick base)
    const sign = group(root, -7, 0, 15.6, 0.15);
    put(sign, uvScaled(G.rbox(3.6, 0.8, 0.6, 0.08), 1.6, 0.5), detailMat("brick", 0xb8664f), { y: 0.4 });
    block(sign, 0xe9dcc4, 0, 1.55, 0, 3.4, 1.15, 0.14, 0.08);
    A(sign, "collegeSign", 3.2, 0.96, { y: 1.55, z: 0.08 });
    A(sign, "collegeSign", 3.2, 0.96, { y: 1.55, z: -0.08, ry: PI });
    // bike rack with bikes (one baked shape for all the bikes)
    const bikeGeo = bakeGeo((b) => {
      for (const sz of [-0.55, 0.55]) put(b, G.torus(0.32, 0.04), toon(0x333333), { y: 0.36, z: sz, ry: PI / 2 });
      put(b, G.box(), toon(0xffffff), { y: 0.6, sx: 0.06, sy: 0.06, sz: 1.0 });
      put(b, G.box(), toon(0xffffff), { y: 0.5, z: -0.2, sx: 0.06, sy: 0.4, sz: 0.06, rx: 0.4 });
      put(b, G.box(), toon(0x333333), { y: 0.82, z: -0.25, sx: 0.12, sy: 0.05, sz: 0.25 });
      put(b, G.box(), toon(0x333333), { y: 0.9, z: 0.5, sx: 0.5, sy: 0.04, sz: 0.04 });
    });
    bx(root, 0x9aa3b0, -13.5, 0.4, 15.8, 4.2, 0.06, 0.06);
    [[0xff6b6b, -15], [0x4fb7ff, -14], [0x6fd36a, -12.6]].forEach(([c, x]) => {
      const bk = put(root, bikeGeo, new THREE.MeshToonMaterial({ color: c, gradientMap, vertexColors: true }), { x, z: 15.8, shadow: true });
      void bk;
    });
    parkBench(root, 13, 16, PI);
    lampPost(root, -2.6, 23); lampPost(root, 2.6, 23);
    // a little picket fence along the front, with a gap for the gate
    const pickets = [];
    for (let x = -26; x <= 26; x += 0.45) if (Math.abs(x) > 2.3) pickets.push({ x, y: 0.5, z: 23.5, sx: 0.16, sy: 1.0, sz: 0.06 });
    scatter(root, G.box(), toon(0xffffff), pickets, true);
    for (const sx of [-1, 1]) bx(root, 0xffffff, sx * 14.2, 0.7, 23.5, 23.6, 0.1, 0.05);

    // ----- the left side: a vegetable garden and a shed -----
    const veg = [];
    for (let i = 0; i < 3; i++) {
      const gz = -5 + i * 4.2;
      block(root, 0xb07a45, -26, 0.25, gz, 5, 0.5, 1.6, 0.06);
      bx(root, 0x6b4426, -26, 0.51, gz, 4.7, 0.04, 1.35, { shadow: false });
      for (let k = 0; k < 7; k++) {
        const vx = -28.1 + k * 0.7;
        if (i === 0) veg.push({ x: vx, y: 0.75, z: gz, s: 0.3, sy: 0.25, color: 0x8fd36a });            // cabbages
        else if (i === 1) { veg.push({ x: vx, y: 0.8, z: gz, sx: 0.08, sy: 0.3, sz: 0.08, color: 0x5cc84a }); veg.push({ x: vx, y: 0.6, z: gz, s: 0.1, color: 0xff8a2a }); } // carrots
        else { veg.push({ x: vx, y: 1.0, z: gz, sx: 0.04, sy: 0.6, sz: 0.04, color: 0x8a6a3a }); veg.push({ x: vx + 0.1, y: 0.95, z: gz + 0.1, s: 0.1, color: 0xff3b3b }); veg.push({ x: vx - 0.1, y: 1.15, z: gz - 0.05, s: 0.09, color: 0xff3b3b }); } // tomatoes
      }
    }
    scatter(root, G.lowSphere(), toon(0xffffff), veg);
    const crow = group(root, -30, 0, -1);
    cylinder(crow, 0x9a6a3c, 0, 1.2, 0, 0.06, 2.4);
    cylinder(crow, 0x9a6a3c, 0, 1.8, 0, 0.05, 1.8, { rz: PI / 2 });
    block(crow, 0x4fb7ff, 0, 1.6, 0, 0.7, 0.8, 0.35, 0.1);
    ball(crow, 0xf2d38a, 0, 2.35, 0, 0.3);
    cylinder(crow, 0xe8c060, 0, 2.6, 0, 0.5, 0.05);
    put(crow, G.cone(), toon(0xe8c060), { y: 2.75, s: 0.3, sy: 0.3 });
    const shed = group(root, -27, 0, 9, 0.3);
    put(shed, uvScaled(G.rbox(3.2, 2.4, 2.6, 0.06), 0.6, 4), detailMat("wood", 0xa8d8a0), { y: 1.2, rz: 0 });
    put(shed, G.cone(4), toon(0xe2574c), { y: 3.0, sx: 2.6, sy: 1.2, sz: 2.2, ry: PI / 4 });
    bx(shed, 0x9a6a3c, 0, 0.85, 1.31, 1.0, 1.7, 0.06);

    // ----- the right side: parking with the campus shuttle -----
    bx(root, 0x9ea3b2, 27.5, -0.02, 2, 12, 0.01, 22, { shadow: false });
    const bus = group(root, 27.5, 0, 1.5);
    block(bus, 0x3f6fb8, 0, 1.75, 0, 2.6, 2.4, 9.0, 0.3);
    block(bus, 0x3f6fb8, 0, 1.2, 5.0, 2.5, 1.4, 1.4, 0.3);
    bx(bus, 0x9fd3f0, 0, 2.35, 0, 2.64, 0.8, 8.2);
    bx(bus, 0x9fd3f0, 0, 2.35, 4.51, 2.2, 0.8, 0.04);
    for (const y of [1.3, 1.6]) bx(bus, 0x333333, 0, y, 0, 2.64, 0.08, 8.6);
    for (const sz of [-3, 3.6]) for (const sx of [-1.25, 1.25]) cylinder(bus, 0x2a2f38, sx, 0.5, sz, 0.5, 0.35, { rz: PI / 2 });
    ball(bus, glow(0xfff1b0, 0.8), -0.8, 1.2, 5.72, 0.15);
    ball(bus, glow(0xfff1b0, 0.8), 0.8, 1.2, 5.72, 0.15);
    A(bus, "bus", 3.4, 0.6, { x: -1.32, y: 2.9, z: 0, ry: -PI / 2 });
    A(bus, "bus", 3.4, 0.6, { x: 1.32, y: 2.9, z: 0, ry: PI / 2 });
    // a couple of parked cars
    [[0xff6b6b, 24, -6], [0x6fd36a, 31, -6], [0xffffff, 31, 9]].forEach(([c, x, z]) => {
      put(root, carGeo, new THREE.MeshToonMaterial({ color: c, gradientMap, vertexColors: true }), { x, z, s: 1.1, shadow: true });
    });

    // ----- trees around the college (kept away from the walls so they don't block the view) -----
    // (all at least 34 away, beyond where the camera can zoom out to: see cameraMaxDistance)
    const trees = [[-30, -20, 1.1], [-31, -26, 1.2], [22, -31, 1.1], [31, -20, 1.0], [-27, 23, 1.0], [26, 24, 1.1],
      [-35, 12, 1.2], [35, -8, 1.0], [17, -33, 0.9], [-30, -42, 1.2], [18, -44, 1.1]];
    trees.forEach(([x, z, s], i) => roundTree(root, x, z, s, i % 4 === 2 ? [0xff9ec7, 0xffc3dc] : [0x5cc84a, 0x7fdc5c], i % 5 === 1 ? 0xff4b3a : null));
    const campusBushes = [[-20, 13], [19.5, 14], [-25, -12], [24, -24]];
    for (const [x, z] of campusBushes) bush(root, x, z, 1, 0x4fbf47, 0xff6fa5);
    // litter bins by the benches, and soft shadows on the grass under things (see blobShadows)
    litterBin(root, 14.6, 16.3, 0x7a2f3a);
    litterBin(root, PG.x + 1.5, PG.z + 4.7, 0x7a2f3a);
    blobShadows(root, [
      ...trees.map(([x, z, s]) => ({ x, z, r: 1.9 * s })),
      ...campusBushes.map(([x, z]) => ({ x, z, r: 1.15, sz: 0.85 })),
      { x: PG.x, z: PG.z + 4.4, r: 1.45, sz: 0.65 }, { x: PG.x + 4.5, z: PG.z - 3.2, r: 1.45, sz: 0.65, ry: -PI / 2 }, { x: 13, z: 16, r: 1.45, sz: 0.65 },
      { x: PG.x + 5.5, z: PG.z + 3.2, r: 1.6, sz: 1.2, ry: 0.2 }, { x: PG.x - 3.5, z: PG.z - 4.6, r: 1.6, sz: 1.2, ry: -0.15 },
      { x: PG.x, z: PG.z, r: 2.8 }, { x: PG.x - 5.5, z: PG.z + 0.2, r: 1.2 }, { x: -21, z: -23.2, r: 0.5 },
      { x: PG.x - 2, z: PG.z + 3, r: 0.45 }, { x: PG.x + 2, z: PG.z - 3, r: 0.45 }, { x: -2.6, z: 23, r: 0.45 }, { x: 2.6, z: 23, r: 0.45 },
      { x: 27.5, z: 1.8, r: 1.6, sz: 5.4 }, { x: 24, z: -6, r: 1.0, sz: 1.8 }, { x: 31, z: -6, r: 1.0, sz: 1.8 }, { x: 31, z: 9, r: 1.0, sz: 1.8 },
      { x: -7, z: 15.6, r: 1.9, sz: 0.5, ry: -0.15 }, { x: FP.x, z: FP.z, r: 0.5 }, { x: -27, z: 9, r: 2.0, sz: 1.7, ry: -0.3 },
      { x: -30, z: -1, r: 0.4 }, { x: -13.8, z: 15.8, r: 1.6, sz: 0.4 }, { x: 14.6, z: 16.3, r: 0.5 }, { x: PG.x + 1.5, z: PG.z + 4.7, r: 0.5 },
    ], 0.22);

    // ----- the town all around: a ring road with cars, houses, trees and hills -----
    const ROAD = 58;
    const roadTex = canvasTexture(64, 16, (ctx, w, h) => {
      ctx.fillStyle = "#8a90a2"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 7, w * 0.5, 2);
    }, [60, 1]);
    const ringGeo = new THREE.RingGeometry(ROAD - 2.5, ROAD + 2.5, 96, 1);
    // map the road picture along the ring
    const ruv = ringGeo.attributes.uv, rpos = ringGeo.attributes.position;
    for (let i = 0; i < ruv.count; i++) {
      const x = rpos.getX(i), y = rpos.getY(i);
      ruv.setXY(i, (Math.atan2(y, x) / TAU + 0.5), (Math.hypot(x, y) - (ROAD - 2.5)) / 5);
    }
    put(root, ringGeo, toon(0xffffff, { map: roadTex }), { y: -0.02, rx: -PI / 2, shadow: false, receive: false });
    const cars = farScatter(root, carGeo, paintMat, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: 0, z: 0, color: [0xff6b6b, 0x4fb7ff, 0xffd23f, 0x6fd36a, 0xffffff, 0xff8a5c, 0xa58cff, 0x3fc6c6][i] })));
    dynamic(cars);
    anim.push((t) => {
      for (let i = 0; i < 8; i++) {
        const dir = i % 2 ? 1 : -1;
        const a = (i / 8) * TAU + dir * t * 0.05;
        const r = ROAD + dir * 1.2;
        tmpO.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        tmpO.rotation.set(0, -a + (dir > 0 ? PI : 0), 0);
        tmpO.scale.setScalar(1.2);
        tmpO.updateMatrix();
        cars.setMatrixAt(i, tmpO.matrix);
      }
      cars.instanceMatrix.needsUpdate = true;
    });
    const keepOut = (x, z) => (Math.abs(Math.hypot(x, z) - ROAD) < 6) ||
      (x > -30 && x < 40 && z > -50 && z < 28) || (x > -28 && x < 16 && z > -52);
    farTown(root, { seed: 21, houses: [55, 66, 115], trees: [170, 36, 125], hills: [24, 175], keepOut });
    const blocks = [];
    const br = seeded(33);
    for (let i = 0; i < 26; i++) {
      const a = br() * TAU, d = 125 + br() * 30;
      blocks.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, sx: 10 + br() * 8, sy: 12 + br() * 22, sz: 10 + br() * 8, ry: a, color: [0xffe2b8, 0xbcdcff, 0xffc8dc, 0xd6c8ff, 0xf2f2f2][Math.floor(br() * 5)] });
    }
    farScatter(root, unitBox, windowMaterial({ color: 0xffffff, glass: 0x7fc0ee, lit: 0xfff1a8, w: 2.4, h: 3.4 }), blocks);
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
    cloudRing(root, anim, cloudMat, { count: 12, rMin: 60, rMax: 95, yMin: 20, yMax: 32, sMin: 1.0, sMax: 1.6, speed: 0.008, seed: 4 });
    cloudRing(root, anim, cloudMat, { count: 14, rMin: 140, rMax: 200, yMin: 30, yMax: 55, sMin: 2.2, sMax: 3.4, speed: 0.004, seed: 8, start: 1 });
  }
  const tmpO = new THREE.Object3D();

  // =====================================================================
  // CONCERT STAGE — a music festival in the park at sunset
  // =====================================================================
  function stageAtlas() {
    return makeAtlas(1024, {
      backdrop: [1020, 370, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#2a1b5e"); g.addColorStop(1, "#7a2f8f");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        const r = seeded(3);
        for (let i = 0; i < 70; i++) { ctx.fillStyle = "rgba(255,255,255," + (0.3 + r() * 0.7) + ")"; star(ctx, r() * w, r() * h, 2 + r() * 5); ctx.fill(); }
        // sun-burst rays behind the logo
        ctx.save(); ctx.translate(w / 2, h * 0.55);
        for (let i = 0; i < 24; i++) {
          ctx.fillStyle = i % 2 ? "rgba(255,180,90,0.22)" : "rgba(255,110,170,0.16)";
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 600, (i / 24) * TAU, ((i + 1) / 24) * TAU); ctx.fill();
        }
        ctx.restore();
        ctx.lineWidth = 14; ctx.strokeStyle = "#2a1b5e"; ctx.font = "900 150px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.strokeText("MII FEST", w / 2, h * 0.47);
        const tg = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.65);
        tg.addColorStop(0, "#ffe15a"); tg.addColorStop(1, "#ff6b8a");
        ctx.fillStyle = tg; ctx.fillText("MII FEST", w / 2, h * 0.47);
        text(ctx, "★ LIVE IN THE PARK ★", w / 2, h * 0.82, 44, "#9fe0ff");
      }],
      gate: [600, 110, (ctx, w, h) => {
        ctx.fillStyle = "#ff6b8a"; roundRect(ctx, 2, 2, w - 4, h - 4, 30); ctx.fill();
        ctx.strokeStyle = "#ffe15a"; ctx.lineWidth = 6; roundRect(ctx, 12, 12, w - 24, h - 24, 22); ctx.stroke();
        text(ctx, "★ MII FEST ★", w / 2, h / 2 + 4, 64, "#ffffff");
      }],
      burger: [300, 80, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff"; roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fill();
        text(ctx, "Yummy Burgers", w / 2, h / 2 + 2, 40, "#e2574c");
      }],
      menu: [160, 200, (ctx, w, h) => {
        ctx.fillStyle = "#2f3542"; ctx.fillRect(0, 0, w, h);
        text(ctx, "MENU", w / 2, 26, 28, "#ffe15a");
        ["Burger  3", "Fries  2", "Hot dog  2", "Ice cream 1"].forEach((s, i) => text(ctx, s, w / 2, 70 + i * 34, 20, "#ffffff"));
      }],
      lemonade: [300, 80, (ctx, w, h) => {
        ctx.fillStyle = "#ffe15a"; roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fill();
        text(ctx, "Lemonade", w / 2, h / 2 + 2, 46, "#3a9a3a");
      }],
      merch: [300, 80, (ctx, w, h) => {
        ctx.fillStyle = "#a58cff"; roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fill();
        text(ctx, "MERCH", w / 2, h / 2 + 2, 50, "#ffffff");
      }],
      shirt: [100, 100, (ctx, w, h) => {
        ctx.fillStyle = "#2f3542"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ffe15a"; star(ctx, w / 2, h / 2 - 6, 30); ctx.fill();
        text(ctx, "MII FEST", w / 2, h - 16, 16, "#ff8ad8");
      }],
      drumhead: [200, 200, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ff6b8a"; star(ctx, w / 2, h / 2 - 10, 50); ctx.fill();
        text(ctx, "THE MIIS", w / 2, h * 0.8, 26, "#2a1b5e");
      }],
      keys: [256, 40, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        const n = 22, kw = w / n;
        ctx.fillStyle = "#c9c9c9"; for (let i = 1; i < n; i++) ctx.fillRect(i * kw - 1, 0, 2, h);
        ctx.fillStyle = "#222";
        for (let i = 0; i < n - 1; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) ctx.fillRect((i + 1) * kw - kw * 0.3, 0, kw * 0.6, h * 0.6);
      }],
      grill: [128, 128, (ctx, w, h) => {
        ctx.fillStyle = "#2a2a30"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#3c3c44"; for (let y = 4; y < h; y += 8) for (let x = 4 + (y % 16 ? 4 : 0); x < w; x += 8) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill(); }
      }],
      awning: [128, 64, (ctx, w, h) => {
        for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#ffffff" : "#ff6b6b"; ctx.fillRect(i * 16, 0, 16, h); }
      }],
      awning2: [128, 64, (ctx, w, h) => {
        for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#ffffff" : "#4fb7ff"; ctx.fillRect(i * 16, 0, 16, h); }
      }],
      awning3: [128, 64, (ctx, w, h) => {
        for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#ffe15a" : "#a58cff"; ctx.fillRect(i * 16, 0, 16, h); }
      }],
    });
  }

  function buildStage() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xffc08a, ground: 0x8a7a5a, hemi: 0.58, sun: 0.95, sunColor: 0xffb06a, ambient: 0.2, fill: 0.26 });
    // make the sun low and warm: it's nearly sunset
    root.children.forEach((l) => { if (l.isDirectionalLight && l.castShadow) l.position.set(-16, 11, 12); });
    skyDome(root, 0x4b57b8, 0xffa774, 0xffd29a);
    const atlas = stageAtlas();
    const A = atlas.pic;
    const tmp = new THREE.Object3D();

    // the setting sun and its glow, low in the sky behind the city
    const sunGrp = group(root, -95, 26, -205);
    sunGrp.lookAt(0, 10, 0);
    put(sunGrp, G.circle(), new THREE.MeshBasicMaterial({ color: 0xffe7a8, fog: false, toneMapped: false }), { s: 14, shadow: false, receive: false });
    put(sunGrp, G.circle(), new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.35, fog: false, depthWrite: false, toneMapped: false }), { s: 26, z: -0.5, shadow: false, receive: false });
    sunGrp.children.forEach((m) => dynamic(m));

    // ---------- ground: warm grass, a wooden dance floor and gravel paths ----------
    disc(root, toon(0xffffff, { map: grassTexture([70, 70], "#a6c955", 5) }), 0, -0.02, 0, 230);
    put(root, new THREE.PlaneGeometry(18, 7.6), toon(0xffffff, { map: planksTexture([5, 2.2], ["#c98b52", "#d29a5e", "#bd8148", "#d8a467"]) }), { y: 0.035, z: -1.4, rx: -PI / 2, shadow: false });
    bx(root, 0x9a6a3c, 0, 0.01, -1.4, 18.4, 0.04, 8.0, { shadow: false });
    const gravel = toon(0xe8d3a8);
    bx(root, gravel, 0, -0.005, 6.2, 3.0, 0.01, 9.5, { shadow: false });
    bx(root, gravel, 0, -0.004, 4.0, 30, 0.01, 2.4, { shadow: false });

    // ---------- the stage ----------
    const ST = { z0: -9.6, z1: -5.4, h: 1.0, w: 18.4 };
    const stz = (ST.z0 + ST.z1) / 2;
    // the stage: a skirt of folded cloth all round, and a deck of dark wooden planks
    put(root, uvScaled(G.rbox(ST.w, ST.h, ST.z1 - ST.z0, 0.06), 40, 1), detailMat("folds", 0x3a3346), { y: ST.h / 2, z: stz });
    bx(root, toon(0xffffff, { map: planksTexture([7, 1.6], ["#7a5a48", "#86634e", "#6f5242", "#8a6a52"]) }), 0, ST.h + 0.01, stz, ST.w - 0.1, 0.02, ST.z1 - ST.z0 - 0.1, { shadow: false });
    // gaffer tape marks where the band stands, and the cables between their gear (one material: drawn together)
    const gaffer = toon(0xd9c08a);
    for (const [x, z, r] of [[0, -6.4, 0.3], [4.6, -7.0, 0], [-4.6, -6.1, 0.1], [-7.6, -6.6, -0.2]]) {
      bx(root, gaffer, x, ST.h + 0.025, z, 0.5, 0.01, 0.07, { ry: r, shadow: false });
      bx(root, gaffer, x, ST.h + 0.025, z, 0.07, 0.01, 0.5, { ry: r, shadow: false });
    }
    const stageCable = toon(0x1e1a26);
    const floorCable = (pts) => cable(root, stageCable, pts.map(([x, z]) => new THREE.Vector3(x, ST.h + 0.035, z)), 0.025);
    floorCable([[0, -6.1], [0.4, -7.2], [1.6, -8.6], [3.2, -9.2]]);                 // the mic
    floorCable([[-4.6, -6.5], [-3.6, -7.6], [-2.6, -8.7]]);                          // the keyboard to its amp
    floorCable([[7.4, -7.4], [7.5, -8.3]]);                                          // the guitar to its amp
    floorCable([[-2.2, -5.55], [-1.2, -6.6], [-0.2, -8.4], [1.0, -9.2], [3.2, -9.3]]);  // the monitors
    floorCable([[2.2, -5.55], [2.0, -6.8], [3.2, -9.2]]);
    bx(root, 0x2a2a30, 3.4, ST.h + 0.2, -9.25, 0.6, 0.4, 0.3);                       // the stage box they all plug into
    // glowing strip along the front of the stage (changes color)
    const ledMat = toon(0xff6b8a, { emissive: 0xff6b8a, emissiveIntensity: 0.9 });
    dynamic(bx(root, ledMat, 0, 0.82, ST.z1 + 0.01, ST.w - 0.2, 0.12, 0.04, { shadow: false }));
    anim.push((t) => { ledMat.emissive.setHSL((t * 0.08) % 1, 0.9, 0.55); ledMat.color.copy(ledMat.emissive); });
    // steps at the back corners
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const h = (3 - i) * 0.33;
      bx(root, 0x4a4058, sx * (ST.w / 2 + 0.18 + i * 0.35), h / 2, ST.z0 + 0.6, 0.35, h, 0.9);
    }
    // backdrop with the festival logo. It and the roof hide when the camera is
    // behind the stage (like the walls of the school), so you can see the band.
    const backdrop = group(root);
    A(backdrop, "backdrop", 17.6, 6.4, { x: 0, y: ST.h + 3.3, z: ST.z0 + 0.12 });
    block(backdrop, 0x2a2438, 0, ST.h + 3.3, ST.z0 + 0.02, 18.0, 6.8, 0.16, 0.04);
    // the roof: truss towers at the corners, beams across, and a curved canopy on top
    const TR = 8.4; // height of the top beams
    const trussMat = toon(0xc9ced8);
    const tower = (x, z, h) => {
      const g = group(root, x, 0, z);
      for (const dx of [-0.22, 0.22]) for (const dz of [-0.22, 0.22]) put(g, G.cyl(6), trussMat, { x: dx, y: h / 2, z: dz, sx: 0.04, sy: h, sz: 0.04 });
      for (let y = 0.3; y < h - 0.3; y += 0.6) {
        put(g, G.cyl(4), trussMat, { y: y + 0.3, z: 0.22, sx: 0.025, sy: 0.75, sz: 0.025, rz: 0.6 });
        put(g, G.cyl(4), trussMat, { y: y + 0.3, x: 0.22, sx: 0.025, sy: 0.75, sz: 0.025, rx: 0.6 });
        put(g, G.cyl(4), trussMat, { y: y + 0.3, z: -0.22, sx: 0.025, sy: 0.75, sz: 0.025, rz: -0.6 });
        put(g, G.cyl(4), trussMat, { y: y + 0.3, x: -0.22, sx: 0.025, sy: 0.75, sz: 0.025, rx: -0.6 });
      }
      bx(g, 0x2a2438, 0, 0.1, 0, 0.8, 0.2, 0.8);
      bx(g, 0x2a2438, 0, h + 0.02, 0, 0.6, 0.18, 0.6);                    // the corner block on top
      cylinder(g, 0x1e1a26, 0.3, h / 2, 0.3, 0.035, h, { seg: 5, shadow: false });          // a cable loom running down it
    };
    const beam = (x0, z0, x1, z1, y) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
      const g = group(root, (x0 + x1) / 2, y, (z0 + z1) / 2, -ang);
      for (const dy of [-0.22, 0.22]) for (const dz of [-0.22, 0.22]) put(g, G.cyl(6), trussMat, { y: dy, z: dz, sx: 0.04, sy: len, sz: 0.04, rz: PI / 2 });
      for (let k = -len / 2 + 0.3; k < len / 2 - 0.3; k += 0.6) {
        put(g, G.cyl(4), trussMat, { x: k + 0.3, z: 0.22, sx: 0.025, sy: 0.72, sz: 0.025, rz: 0.9 });
        put(g, G.cyl(4), trussMat, { x: k + 0.3, z: -0.22, sx: 0.025, sy: 0.72, sz: 0.025, rz: -0.9 });
        put(g, G.cyl(4), trussMat, { x: k + 0.3, y: -0.22, sx: 0.025, sy: 0.72, sz: 0.025, rz: PI / 2, ry: 0.9 });
      }
    };
    const PX = 9.65, PZ0 = ST.z1 + 0.15, PZ1 = ST.z0 - 0.1;
    for (const x of [-PX, PX]) for (const z of [PZ0, PZ1]) tower(x, z, TR + 0.25);
    beam(-PX, PZ0, PX, PZ0, TR);
    beam(-PX, PZ1, PX, PZ1, TR);
    for (const x of [-PX, PX]) beam(x, PZ0, x, PZ1, TR);
    // chain hoists holding up the front beam (motor, chain and hook)
    for (const x of [-5.2, 5.2]) {
      cylinder(root, 0x9aa3b0, x, TR + 0.9, PZ0, 0.025, 1.4, { seg: 4 });
      block(root, 0x2a2438, x, TR + 0.45, PZ0, 0.36, 0.32, 0.3, 0.05);
    }
    const canopyR = 4.0;
    const canopy = new THREE.CylinderGeometry(canopyR, canopyR, 2 * PX + 1.2, 24, 1, true, PI / 2 - 0.75, 1.5).rotateZ(PI / 2);
    put(backdrop, canopy, toon(0xf4f0ff, { side: THREE.DoubleSide }), { y: TR + 0.25 - canopyR * Math.cos(0.75), z: stz, shadow: true });
    // ---------- the light rig: lamps on the front beam that throw colored beams ----------
    const lamps = [];
    for (let i = 0; i < 8; i++) {
      const lx = -7.35 + i * 2.1;
      const g = group(root, lx, TR - 0.55, PZ0);
      cylinder(g, 0x2a2438, 0, 0.2, 0, 0.03, 0.4);
      put(g, G.cyl(10), toon(0x2a2438), { y: -0.15, sx: 0.22, sy: 0.45, sz: 0.22, rx: 0.5 });
      lamps.push({ x: lx, y: TR - 0.75, z: PZ0 + 0.12, i });
    }
    // the lamp lenses glow in the color of their beam
    const lens = dynamic(new THREE.InstancedMesh(G.lowSphere(), new THREE.MeshBasicMaterial({ toneMapped: false }), lamps.length));
    lens.frustumCulled = false;
    root.add(lens);
    lamps.forEach((l, i) => { tmp.position.set(l.x, l.y - 0.02, l.z + 0.02); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(0.17); tmp.updateMatrix(); lens.setMatrixAt(i, tmp.matrix); lens.setColorAt(i, new THREE.Color(0xffffff)); });
    // see-through beams (glowing cones) and the pools of light where they land
    const beamGeo = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0);
    const SEARCH = 2;
    const beams = dynamic(new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    }), lamps.length + SEARCH));
    beams.frustumCulled = false;
    beams.castShadow = false;
    root.add(beams);
    const poolTex = canvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    const pools = dynamic(new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2), new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), lamps.length));
    pools.frustumCulled = false;
    root.add(pools);
    const up = new THREE.Vector3(0, -1, 0), dir = new THREE.Vector3(), col = new THREE.Color();
    const aim = (idx, from, to, radius, color, mesh) => {
      dir.copy(to).sub(from);
      const len = dir.length();
      dir.normalize();
      tmp.position.copy(from);
      tmp.quaternion.setFromUnitVectors(up, dir);
      tmp.scale.set(radius, len, radius);
      tmp.updateMatrix();
      mesh.setMatrixAt(idx, tmp.matrix);
      mesh.setColorAt(idx, color);
    };
    const from = new THREE.Vector3(), to = new THREE.Vector3();
    // search lights behind the stage sweep across the sky
    const searchAt = [new THREE.Vector3(-12.5, 0.6, -11.8), new THREE.Vector3(12.5, 0.6, -11.8)];
    for (const s of searchAt) {
      const sl = group(root, s.x, 0, s.z);
      block(sl, 0x2a2438, 0, 0.3, 0, 0.9, 0.6, 0.9, 0.1);
      cylinder(sl, 0x55606e, 0, 0.75, 0, 0.35, 0.5);
    }
    anim.push((t) => {
      const scene = Math.floor(t / 8) % 3; // the light show changes every few seconds
      lamps.forEach((l, i) => {
        const hue = scene === 0 ? (t * 0.1 + i / lamps.length) % 1 : scene === 1 ? (i % 2 ? 0.92 : 0.55) : (t * 0.25) % 1;
        col.setHSL(hue, 0.95, 0.6);
        const sweep = Math.sin(t * (scene === 2 ? 2.2 : 1.1) + i * 0.8);
        // half the lamps point at the stage, the others sweep over the crowd
        const onStage = i % 2 === 0;
        const tx = onStage ? l.x * 0.7 + sweep * 2.2 : l.x * 0.9 + sweep * 4;
        const tz = onStage ? -7 + Math.cos(t * 0.9 + i) * 1.2 : -1.5 + Math.cos(t * 0.7 + i * 1.3) * 3.5;
        const ty = onStage ? ST.h + 0.02 : 0.04;
        from.set(l.x, l.y, l.z);
        to.set(tx, ty, tz);
        aim(i, from, to, 0.9, col, beams);
        tmp.position.set(tx, ty + 0.02, tz); tmp.quaternion.identity(); tmp.scale.setScalar(1.0); tmp.updateMatrix();
        pools.setMatrixAt(i, tmp.matrix); pools.setColorAt(i, col);
        lens.setColorAt(i, col);
      });
      searchAt.forEach((s, k) => {
        const a = Math.sin(t * 0.4 + k * 2) * 0.6 + (k ? -0.35 : 0.35);
        to.set(s.x + Math.sin(a) * 40, 60, s.z - 25 + Math.cos(t * 0.3 + k) * 10);
        col.setRGB(0.35, 0.33, 0.28);
        aim(lamps.length + k, s, to, 3.2, col, beams);
      });
      beams.instanceMatrix.needsUpdate = true; beams.instanceColor.needsUpdate = true;
      pools.instanceMatrix.needsUpdate = true; pools.instanceColor.needsUpdate = true;
      lens.instanceColor.needsUpdate = true;
    });

    // ---------- the band's gear ----------
    // drum kit (stage right)
    const DR = { x: 4.6, z: -7.6 };
    const dk = group(root, DR.x, ST.h, DR.z);
    put(dk, G.cyl(20), toon(0xe23b3b), { y: 0.5, z: 0.1, sx: 0.5, sy: 0.55, sz: 0.5, rx: PI / 2 });     // bass drum
    put(dk, atlas.fit("drumhead", new THREE.CircleGeometry(0.47, 24)), atlas.mat, { y: 0.5, z: 0.385, shadow: false });
    cylinder(dk, 0xffffff, -0.6, 0.75, -0.2, 0.26, 0.2);                                                  // snare
    for (const sx of [-0.28, 0.28]) cylinder(dk, 0xe23b3b, sx, 1.1, 0.05, 0.2, 0.22, { rx: 0.35 });      // toms
    cylinder(dk, 0xe23b3b, 0.75, 0.55, -0.25, 0.28, 0.5);                                                 // floor tom
    for (const [sx, sz, h] of [[-0.95, 0.0, 1.25], [0.95, 0.1, 1.45], [-0.6, 0.35, 1.6]]) cylinder(dk, 0x9aa3b0, sx, h / 2, sz, 0.02, h);
    cylinder(dk, 0x2a2438, 0, 0.3, -0.75, 0.05, 0.6);                                                     // stool
    cylinder(dk, 0x2a2438, 0, 0.62, -0.75, 0.24, 0.1);
    // cymbals wobble when they're hit
    // (the three cymbals are one shape drawn three times: they wobble one by one)
    const cymbalAt = [[-0.95, 1.27, 0.0], [0.95, 1.47, 0.1], [-0.6, 1.62, 0.35]];
    const cymbals = dynamic(new THREE.InstancedMesh(G.cyl(18), toon(0xf2c94c), cymbalAt.length));
    cymbals.castShadow = true;
    cymbals.frustumCulled = false;
    dk.add(cymbals);
    anim.push((t) => {
      cymbalAt.forEach(([x, y, z], i) => {
        const k = (t * 2 + i * 0.37) % 1;
        tmp.position.set(x, y, z); tmp.rotation.set(Math.sin(k * 30) * 0.15 * (1 - k), 0, 0.1 * i); tmp.scale.set(0.36, 0.02, 0.36);
        tmp.updateMatrix(); cymbals.setMatrixAt(i, tmp.matrix);
      });
      cymbals.instanceMatrix.needsUpdate = true;
    });
    // keyboard (stage left)
    const KB = { x: -4.6, z: -6.5 };
    const kb = group(root, KB.x, ST.h, KB.z);
    for (const sx of [-0.5, 0.5]) for (const r of [0.5, -0.5]) bx(kb, 0x2a2438, sx, 0.45, 0, 0.05, 1.05, 0.05, { rx: r });
    block(kb, 0x2a2438, 0, 0.95, 0, 1.6, 0.12, 0.45, 0.04);
    A(kb, "keys", 1.45, 0.26, { y: 1.015, z: 0.05, rx: -PI / 2 });
    ball(kb, glow(0x5cff8a, 1), 0.6, 1.02, -0.15, 0.025);
    ball(kb, glow(0xff5a8a, 1), 0.68, 1.02, -0.15, 0.025);
    // microphone stand (center front)
    const MC = { x: 0, z: -5.95 };
    const mc = group(root, MC.x, ST.h, MC.z);
    cylinder(mc, 0x2a2438, 0, 0.03, 0, 0.25, 0.05);
    cylinder(mc, 0x9aa3b0, 0, 0.85, 0, 0.025, 1.7);
    cylinder(mc, 0x9aa3b0, 0, 1.75, -0.15, 0.02, 0.4, { rx: 0.9 });
    ball(mc, 0x55606e, 0, 1.86, -0.3, 0.07, { sz: 1.3 });
    // guitar amps, a guitar on a stand and monitor speakers
    for (const [ax, az] of [[7.6, -8.7], [-2.4, -9.0]]) {
      const a = group(root, ax, ST.h, az);
      block(a, 0x2a2a30, 0, 0.55, 0, 1.3, 1.1, 0.7, 0.06);
      for (const sx of [-0.6, 0.6]) for (const sy of [0.06, 1.04]) block(a, 0x9aa3b0, sx, sy, 0.3, 0.12, 0.12, 0.12, 0.03); // metal corners
      A(a, "grill", 1.1, 0.7, { y: 0.5, z: 0.36 });
      bx(a, 0xd9c08a, 0, 1.0, 0.36, 1.1, 0.12, 0.02, { shadow: false });
      for (let k = 0; k < 5; k++) ball(a, 0xf2c94c, -0.4 + k * 0.2, 1.0, 0.38, 0.03);
    }
    const gt = group(root, 7.4, ST.h, -7.4, -0.3);
    bx(gt, 0x2a2438, 0, 0.3, 0, 0.05, 0.6, 0.3);
    ball(gt, 0x4fb7ff, 0, 0.45, 0.06, 0.28, { sy: 1.05, sz: 0.3 });
    ball(gt, 0x4fb7ff, 0, 0.78, 0.06, 0.21, { sz: 0.3 });
    ball(gt, 0x2a2438, 0, 0.62, 0.11, 0.07, { sz: 0.2 });
    bx(gt, 0x8a5a3a, 0, 1.3, 0.06, 0.07, 0.9, 0.04);
    bx(gt, 0x2a2438, 0, 1.8, 0.06, 0.12, 0.2, 0.05);
    // monitor wedges: their whole front is a speaker grille
    const grilleMat = detailMat("grille", 0x5a5f6e);
    for (const mx of [-2.2, 2.2]) {
      block(root, 0x2a2a30, mx, ST.h + 0.25, ST.z1 - 0.45, 1.0, 0.45, 0.6, 0.06, { rx: -0.45 });
      put(root, uvScaled(new THREE.PlaneGeometry(0.88, 0.36), 3, 1.2), grilleMat, { x: mx, y: ST.h + 0.383, z: ST.z1 - 0.172, rx: -0.45, shadow: false });
    }
    // bubble machine at the front corner
    block(root, 0x7fe0ff, -8.2, ST.h + 0.2, ST.z1 - 0.5, 0.6, 0.4, 0.5, 0.08);

    // ---------- speaker stacks on the ground (their woofers thump to the beat) ----------
    const woofers = [];
    for (const sx of [-1, 1]) {
      const sp = group(root, sx * 10.9, 0, -6.9);
      block(sp, 0x2a2a30, 0, 0.8, 0, 1.6, 1.6, 1.3, 0.08);
      block(sp, 0x2a2a30, 0, 2.3, 0, 1.4, 1.35, 1.2, 0.08);
      block(sp, 0x2a2a30, 0, 3.4, 0, 1.2, 0.85, 1.1, 0.08);
      for (const [y, r] of [[0.8, 0.55], [2.3, 0.42], [3.4, 0.25]]) {
        put(sp, G.torus(r, 0.05), toon(0x55606e), { y, z: 0.66 });
        woofers.push({ x: sx * 10.9, y, z: -6.9 + 0.66, r });
      }
      // the grilles on the cabinets' fronts (behind the woofers), metal corners and side handles
      for (const [y, w, h] of [[0.8, 1.45, 1.45], [2.3, 1.25, 1.2], [3.4, 1.05, 0.72]]) {
        put(sp, uvScaled(new THREE.PlaneGeometry(w, h), w * 2.5, h * 2.5), grilleMat, { y, z: 0.655, shadow: false });
        for (const cx of [-1, 1]) for (const cy of [-1, 1]) block(sp, 0x9aa3b0, cx * (w / 2 + 0.02), y + cy * (h / 2 + 0.02), 0.6, 0.14, 0.14, 0.14, 0.03);
      }
      for (const hx of [-0.81, 0.81]) block(sp, 0x9aa3b0, hx, 1.0, 0, 0.04, 0.12, 0.4, 0.02);
    }
    const woof = dynamic(new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, PI / 2).rotateX(PI / 2), toon(0x3c3c46), woofers.length));
    woof.frustumCulled = false;
    root.add(woof);
    anim.push((t) => {
      const beat = Math.pow(Math.max(0, Math.sin(t * PI * 2.2)), 8);
      woofers.forEach((w, i) => {
        tmp.position.set(w.x, w.y, w.z - 0.02); tmp.rotation.set(0, 0, 0);
        tmp.scale.set(w.r * 0.95, w.r * 0.95, 0.15 + beat * 0.25);
        tmp.updateMatrix(); woof.setMatrixAt(i, tmp.matrix);
      });
      woof.instanceMatrix.needsUpdate = true;
    });

    // ---------- the big screen (stage right) showing a looping animation ----------
    const SCR = { x: 14.3, z: -7.6, ry: -0.45 };
    const scr = group(root, SCR.x, 0, SCR.z, SCR.ry);
    for (const sx of [-3.3, 3.3]) {
      put(scr, G.cyl(6), trussMat, { x: sx, y: 3.9, sx: 0.12, sy: 7.8, sz: 0.12 });
      bx(scr, 0x2a2438, sx, 0.1, 0, 0.8, 0.2, 0.8);
    }
    block(scr, 0x1a1a22, 0, 5.05, -0.05, 6.5, 3.8, 0.25, 0.06);
    const sc = document.createElement("canvas");
    sc.width = 320; sc.height = 180;
    const scTex = new THREE.CanvasTexture(sc);
    scTex.encoding = THREE.sRGBEncoding;
    put(scr, new THREE.PlaneGeometry(6.2, 3.5), basic(scTex), { y: 5.05, z: 0.09, shadow: false });
    const drawScreen = (t) => {
      const ctx = sc.getContext("2d");
      const w = sc.width, h = sc.height;
      const mode = Math.floor(t / 6) % 3;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "hsl(" + ((t * 30) % 360) + ",80%,35%)"); g.addColorStop(1, "hsl(" + ((t * 30 + 120) % 360) + ",80%,30%)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (mode === 0) {
        // a bouncing equaliser with the festival name
        for (let i = 0; i < 16; i++) {
          const bh = 20 + Math.abs(Math.sin(t * 5 + i * 0.7) * Math.cos(t * 3.1 + i)) * 100;
          ctx.fillStyle = "hsl(" + ((i * 22 + t * 60) % 360) + ",90%,65%)";
          roundRect(ctx, 10 + i * 19.0, h - 10 - bh, 14, bh, 4); ctx.fill();
        }
        const s = 1 + Math.sin(t * 6) * 0.06;
        ctx.save(); ctx.translate(w / 2, 46); ctx.scale(s, s);
        text(ctx, "MII FEST", 0, 0, 48, "#ffffff");
        ctx.restore();
      } else if (mode === 1) {
        // hearts floating up
        for (let i = 0; i < 9; i++) {
          const k = (t * 0.3 + i / 9) % 1;
          ctx.fillStyle = "hsl(" + (330 + i * 8) + ",90%,70%)";
          heart(ctx, 20 + i * 34 + Math.sin(t * 2 + i) * 8, h - k * (h + 40), 26);
        }
        text(ctx, "YOU ROCK!", w / 2, h / 2, 46, "#ffffff");
      } else {
        // a big smiling face singing along
        smiley(ctx, w / 2, h / 2 + 4, 60 + Math.sin(t * 8) * 4, "#ffd9b0", "#4a2a1a");
        for (let i = 0; i < 6; i++) {
          const a = t * 1.5 + (i / 6) * TAU;
          ctx.fillStyle = "#ffe15a"; star(ctx, w / 2 + Math.cos(a) * 120, h / 2 + Math.sin(a) * 60, 12); ctx.fill();
        }
        text(ctx, "SING ALONG!", w / 2, 18, 22, "#ffffff");
      }
      scTex.needsUpdate = true;
    };
    drawScreen(0);
    let nextDraw = 0;
    anim.push((t) => { if (t >= nextDraw) { nextDraw = t + 0.12; drawScreen(t); } });

    // ---------- food truck (right) ----------
    const FT = { x: 14.9, z: 2.0 };
    const ft = group(root, FT.x, 0, FT.z, -PI / 2); // its serving window faces -x
    block(ft, 0xff8a5c, 0, 1.75, 0, 5.6, 2.6, 2.5, 0.25);
    block(ft, 0xff8a5c, 3.3, 1.25, 0, 1.4, 1.6, 2.4, 0.25);
    bx(ft, 0x9fd3f0, 3.65, 1.65, 0, 0.6, 0.6, 2.2, { rz: -0.4 });
    bx(ft, 0xffffff, 0, 0.7, 0, 5.62, 0.25, 2.52);
    for (const sx of [-1.8, 1.6, 3.2]) for (const sz of [-1.2, 1.2]) cylinder(ft, 0x2a2f38, sx, 0.42, sz, 0.42, 0.3, { rx: PI / 2 });
    bx(ft, 0x3a2a1a, -0.3, 2.0, 1.26, 3.4, 1.2, 0.04, { shadow: false });       // serving window
    block(ft, 0xffffff, -0.3, 1.38, 1.45, 3.6, 0.1, 0.45, 0.03);              // counter
    A(ft, "awning", 3.8, 1.0, { x: -0.3, y: 2.95, z: 1.75, rx: -1.0 });
    A(ft, "burger", 3.0, 0.8, { x: -0.3, y: 2.75, z: 1.27 });
    A(ft, "menu", 0.8, 1.0, { x: 2.0, y: 2.0, z: 1.27 });
    for (let i = 0; i < 3; i++) {
      const b = group(ft, -1.2 + i * 0.9, 1.45, 1.5);
      ball(b, 0xe8a64a, 0, 0.12, 0, 0.16, { sy: 0.5 });
      cylinder(b, 0x7a3a1a, 0, 0.06, 0, 0.17, 0.05);
      cylinder(b, 0x6fd36a, 0, 0.03, 0, 0.18, 0.02);
      ball(b, 0xe8a64a, 0, 0.0, 0, 0.16, { sy: 0.3 });
    }
    put(ft, G.cone(8), toon(0xffe15a), { x: 1.2, y: 1.55, z: 1.5, s: 0.12, sy: 0.25, rx: PI });
    ball(ft, 0xff9ec7, 1.2, 1.72, 1.5, 0.1);
    // a little cloud of steam from the kitchen
    const steam = dynamic(new THREE.InstancedMesh(G.lowSphere(), toon(0xffffff, { transparent: true, opacity: 0.5 }), 4));
    steam.frustumCulled = false;
    root.add(steam);
    anim.push((t) => {
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.3 + i / 4) % 1;
        tmp.position.set(FT.x + 0.2, 3.2 + k * 2, FT.z + 1 + Math.sin(t + i) * 0.2);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar(0.15 + k * 0.35);
        tmp.updateMatrix(); steam.setMatrixAt(i, tmp.matrix);
      }
      steam.instanceMatrix.needsUpdate = true;
    });
    cylinder(root, 0x9aa3b0, FT.x + 0.3, 3.2, FT.z + 1.0, 0.1, 0.5);

    // ---------- lemonade stand (left) ----------
    const DS = { x: -14.9, z: 2.0 };
    const ds = group(root, DS.x, 0, DS.z, PI / 2); // faces +x
    block(ds, 0xfff1d0, 0, 0.6, 0, 2.8, 1.2, 1.0, 0.08);
    block(ds, 0xffe15a, 0, 1.25, 0.05, 3.0, 0.1, 1.2, 0.04);
    for (const sx of [-1.35, 1.35]) cylinder(ds, 0xffffff, sx, 1.9, -0.3, 0.05, 2.6);
    A(ds, "awning2", 3.2, 1.4, { y: 3.1, z: 0.2, rx: -1.1 });
    A(ds, "lemonade", 2.4, 0.64, { y: 0.7, z: 0.51 });
    const lemonMat = toon(0xfff27a, { transparent: true, opacity: 0.85 }); // (both jugs share it: drawn in one go)
    for (const sx of [-0.7, 0.4]) {
      cylinder(ds, lemonMat, sx, 1.6, 0, 0.25, 0.6);
      cylinder(ds, 0xffffff, sx, 1.95, 0, 0.26, 0.08);
    }
    for (let i = 0; i < 6; i++) put(ds, G.taper(0.07, 0.055), toon([0xff6b8a, 0x4fb7ff, 0x6fd36a][i % 3]), { x: 0.95 + (i % 3) * 0.17, y: 1.38, z: 0.25 - Math.floor(i / 3) * 0.2, sy: 0.18 });
    ball(ds, 0xffe15a, -1.1, 1.38, 0.3, 0.1);
    ball(ds, 0xffe15a, -0.95, 1.38, 0.35, 0.1);

    // ---------- merch booth (left, by the stage) ----------
    const MB = { x: -15.0, z: -4.6 };
    const mb = group(root, MB.x, 0, MB.z, PI / 2);
    block(mb, 0xa58cff, 0, 0.5, 0.5, 3.0, 1.0, 0.8, 0.06);
    block(mb, 0xffffff, 0, 1.03, 0.5, 3.1, 0.06, 0.9, 0.03);
    for (const sx of [-1.45, 1.45]) for (const sz of [-0.5, 0.9]) cylinder(mb, 0xffffff, sx, 1.4, sz, 0.05, 2.8);
    A(mb, "awning3", 3.2, 1.6, { y: 2.9, z: 0.2, rx: -1.4 });
    A(mb, "merch", 2.2, 0.6, { y: 0.55, z: 0.91 });
    bx(mb, 0x9aa3b0, 0, 2.2, -0.4, 2.8, 0.05, 0.05);
    for (let i = 0; i < 4; i++) {
      const shirt = group(mb, -1.0 + i * 0.67, 1.75, -0.4);
      block(shirt, [0x2f3542, 0xff6b8a, 0x4fb7ff, 0xffe15a][i], 0, 0, 0, 0.5, 0.6, 0.04, 0.03);
      for (const sx of [-1, 1]) block(shirt, [0x2f3542, 0xff6b8a, 0x4fb7ff, 0xffe15a][i], sx * 0.3, 0.17, 0, 0.2, 0.2, 0.04, 0.02, { rz: sx * 0.6 });
      if (i === 0) A(shirt, "shirt", 0.32, 0.32, { z: 0.025 });
    }
    for (let i = 0; i < 3; i++) {
      ball(mb, [0xff6b6b, 0x4fb7ff, 0x6fd36a][i], -0.8 + i * 0.8, 1.1, 0.5, 0.17, { sy: 0.5 });
      bx(mb, [0xff6b6b, 0x4fb7ff, 0x6fd36a][i], -0.8 + i * 0.8, 1.08, 0.7, 0.3, 0.02, 0.15);
    }

    // ---------- benches and bleachers for the audience ----------
    const benches = [{ x: -6, z: 4.0 }, { x: 6, z: 4.0 }, { x: -6, z: 6.9 }, { x: 6, z: 6.9 }].map((b) => Object.assign(b, { ry: PI }));
    benches.forEach((b) => parkBench(root, b.x, b.z, b.ry));
    const BL = { x: 12.8, z: 8.4 };
    const tierH = [0.55, 1.05, 1.55], tierZ = [7.55, 8.4, 9.25];
    for (let i = 0; i < 3; i++) {
      block(root, [0x4fb7ff, 0xff6b8a, 0xffd23f][i], BL.x, tierH[i] - 0.06, tierZ[i], 5.6, 0.12, 0.75, 0.04);
      bx(root, 0x9aa3b0, BL.x, (tierH[i] - 0.12) / 2, tierZ[i] + 0.3, 5.4, tierH[i] - 0.12, 0.05);
      for (const sx of [-2.6, 0, 2.6]) bx(root, 0x9aa3b0, BL.x + sx, (tierH[i] - 0.12) / 2, tierZ[i], 0.08, tierH[i] - 0.12, 0.08);
    }
    bx(root, 0x9aa3b0, BL.x, 2.3, 9.7, 5.6, 0.06, 0.06);
    for (const sx of [-2.8, 2.8]) bx(root, 0x9aa3b0, BL.x + sx, 1.2, 9.7, 0.06, 2.3, 0.06);

    // ---------- the gate ----------
    const GZ = 12.6; // the gate stands just outside the venue, so it doesn't hide the crowd
    const gate = group(root, 0, 0, GZ);
    for (const sx of [-2.7, 2.7]) {
      cylinder(gate, 0xff6b8a, sx, 1.7, 0, 0.3, 3.4);
      ball(gate, 0xffe15a, sx, 3.55, 0, 0.35);
    }
    block(gate, 0xffffff, 0, 3.05, 0, 5.9, 1.0, 0.2, 0.1);
    A(gate, "gate", 5.6, 0.94, { y: 3.05, z: 0.11 });
    A(gate, "gate", 5.6, 0.94, { y: 3.05, z: -0.11, ry: PI });
    bx(root, 0xe8d3a8, 0, -0.006, GZ, 3.0, 0.01, 6, { shadow: false });
    // balloons tied to the gate posts (they bob about)
    const balloonSpots = [];
    for (const sx of [-2.7, 2.7]) for (let i = 0; i < 3; i++) balloonSpots.push({ x: sx + (i - 1) * 0.35, y: 4.3 + (i % 2) * 0.35, z: GZ, c: [0xff6b6b, 0x4fb7ff, 0xffd23f][i] });
    // a balloon seller's cart (front left)
    const BC = { x: -12.8, z: 8.2 };
    const bc = group(root, BC.x, 0, BC.z);
    block(bc, 0x4fb7ff, 0, 0.7, 0, 1.4, 0.6, 0.9, 0.08);
    for (const sx of [-0.55, 0.55]) put(bc, G.torus(0.3, 0.05), toon(0x333333), { x: sx, y: 0.3, z: 0.47 });
    cylinder(bc, 0xffffff, 0, 1.6, 0, 0.04, 1.8);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      balloonSpots.push({ x: BC.x + Math.cos(a) * 0.5, y: 3.4 + (i % 3) * 0.3, z: BC.z + Math.sin(a) * 0.5, c: [0xff6b6b, 0x4fb7ff, 0xffd23f, 0x6fd36a, 0xff8ad8, 0xa58cff, 0xff8a5c][i] });
    }
    for (const b of balloonSpots) {
      const base = b.x < -8 ? { x: BC.x, y: 2.5, z: BC.z } : { x: b.x < 0 ? -2.7 : 2.7, y: 3.6, z: GZ };
      cable(root, toon(0xffffff), [new THREE.Vector3(base.x, base.y, base.z), new THREE.Vector3(b.x, b.y - 0.3, b.z)], 0.008);
    }
    const balloons = dynamic(new THREE.InstancedMesh(G.midSphere(), toon(0xffffff), balloonSpots.length));
    balloons.castShadow = true;
    balloons.frustumCulled = false;
    balloonSpots.forEach((b, i) => balloons.setColorAt(i, new THREE.Color(b.c)));
    root.add(balloons);
    anim.push((t) => {
      balloonSpots.forEach((b, i) => {
        tmp.position.set(b.x + Math.sin(t * 1.3 + i) * 0.05, b.y + Math.sin(t * 1.7 + i * 2) * 0.06, b.z);
        tmp.rotation.set(0, 0, Math.sin(t + i) * 0.1);
        tmp.scale.set(0.27, 0.33, 0.27);
        tmp.updateMatrix(); balloons.setMatrixAt(i, tmp.matrix);
      });
      balloons.instanceMatrix.needsUpdate = true;
    });

    // ---------- string lights and bunting on poles ----------
    const poles = { L0: [-11.8, -2.8], L1: [-11.8, 3.8], L2: [-9.3, 9.6], R0: [11.8, -2.8], R1: [11.8, 3.8], R2: [9.3, 9.6] };
    const PH = 5.2;
    for (const [x, z] of Object.values(poles)) {
      cylinder(root, 0x8a5a3a, x, PH / 2, z, 0.1, PH);
      ball(root, 0xffe15a, x, PH + 0.08, z, 0.14);
    }
    const P = (k) => new THREE.Vector3(poles[k][0], PH - 0.1, poles[k][1]);
    const cableMat = toon(0x3a3346);
    const bulbs = [];
    const lightLine = (a, b, sag, n) => {
      const pts = sagLine(a, b, sag, 14);
      cable(root, cableMat, pts, 0.015);
      const curve = new THREE.CatmullRomCurve3(pts);
      for (let i = 1; i < n; i++) { const p = curve.getPoint(i / n); bulbs.push({ x: p.x, y: p.y - 0.12, z: p.z }); }
    };
    lightLine(P("L0"), P("L1"), 0.6, 10); lightLine(P("L1"), P("L2"), 0.6, 10);
    lightLine(P("R0"), P("R1"), 0.6, 10); lightLine(P("R1"), P("R2"), 0.6, 10);
    lightLine(P("L1"), P("R1"), 1.2, 28);
    lightLine(P("L0"), new THREE.Vector3(-PX, TR - 0.4, PZ0), 0.5, 6); lightLine(P("R0"), new THREE.Vector3(PX, TR - 0.4, PZ0), 0.5, 6);
    const bulbMesh = dynamic(new THREE.InstancedMesh(G.tinySphere(), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length));
    bulbMesh.frustumCulled = false;
    const bulbCols = [0xffe08a, 0xff8ad8, 0x8fe0ff, 0xa8ff8a, 0xffb070].map((c) => new THREE.Color(c));
    bulbs.forEach((b, i) => { tmp.position.set(b.x, b.y, b.z); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(0.1); tmp.updateMatrix(); bulbMesh.setMatrixAt(i, tmp.matrix); bulbMesh.setColorAt(i, bulbCols[i % 5]); });
    root.add(bulbMesh);
    let twinkle = 0;
    const dimCol = new THREE.Color();
    anim.push((t) => {
      if (t < twinkle) return;
      twinkle = t + 0.25;
      bulbs.forEach((b, i) => bulbMesh.setColorAt(i, dimCol.copy(bulbCols[i % 5]).multiplyScalar(Math.random() < 0.12 ? 0.45 : 1)));
      bulbMesh.instanceColor.needsUpdate = true;
    });
    // bunting (little flags) along the front, between the gate and the poles
    const flagGeo = bakeGeo((g) => {
      const line = sagLine(P("L2"), P("R2"), 1.0, 30);
      const curve = new THREE.CatmullRomCurve3(line);
      const fc = [0xff6b6b, 0xffd23f, 0x4fb7ff, 0x6fd36a, 0xff8ad8, 0xa58cff];
      for (let i = 1; i < 30; i++) {
        const p = curve.getPoint(i / 30);
        put(g, triangleGeo([-0.22, 0, 0, 0.22, 0, 0, 0, -0.5, 0]), toon(fc[i % fc.length]), { x: p.x, y: p.y, z: p.z });
      }
      cable(g, toon(0xffffff), line, 0.012);
    });
    painted(root, flagGeo);
    // flags on tall poles by the stage
    for (const [fx, fz, c] of [[-12.6, -9.8, 0xff6b8a], [12.6, -10.4, 0x4fb7ff], [-16.5, 6.4, 0xffd23f]]) {
      cylinder(root, 0xffffff, fx, 3.5, fz, 0.06, 7.0);
      const f = dynamic(put(root, triangleGeo([0, 0, 0, 0, -1.0, 0, 1.6, -0.5, 0]), toon(c, { side: THREE.DoubleSide }), { x: fx, y: 6.9, z: fz, shadow: false }));
      anim.push((t) => { f.rotation.y = Math.sin(t * 2 + fx) * 0.35 - 0.3; });
    }

    // ---------- confetti and bubbles ----------
    const confN = 140;
    const conf = dynamic(new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.2), toon(0xffffff, { side: THREE.DoubleSide }), confN));
    conf.frustumCulled = false;
    const cr = seeded(17);
    const confData = [];
    const confCols = [0xff6b6b, 0xffd23f, 0x4fb7ff, 0x6fd36a, 0xff8ad8, 0xa58cff, 0xffffff].map((c) => new THREE.Color(c));
    for (let i = 0; i < confN; i++) {
      confData.push({ x: (cr() - 0.5) * 18, z: -6 + cr() * 9, off: cr(), speed: 0.06 + cr() * 0.05, spin: 2 + cr() * 4 });
      conf.setColorAt(i, confCols[i % confCols.length]);
    }
    root.add(conf);
    anim.push((t) => {
      confData.forEach((c, i) => {
        const k = (t * c.speed + c.off) % 1;
        tmp.position.set(c.x + Math.sin(t * 1.3 + i) * 0.5, 9.5 - k * 9.6, c.z + Math.cos(t * 1.1 + i) * 0.4);
        tmp.rotation.set(t * c.spin + i, t * c.spin * 0.7, i);
        tmp.scale.setScalar(k > 0.985 ? 0.001 : 1);
        tmp.updateMatrix(); conf.setMatrixAt(i, tmp.matrix);
      });
      conf.instanceMatrix.needsUpdate = true;
    });
    const bubN = 18;
    const bubbles = dynamic(new THREE.InstancedMesh(G.lowSphere(), new THREE.MeshBasicMaterial({ color: 0xcff0ff, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }), bubN));
    bubbles.frustumCulled = false;
    root.add(bubbles);
    anim.push((t) => {
      for (let i = 0; i < bubN; i++) {
        const k = (t * 0.12 + i / bubN) % 1;
        tmp.position.set(-8.2 + k * 6 + Math.sin(t * 2 + i) * 0.6, ST.h + 0.5 + k * 7, ST.z1 - 0.5 + k * 3 + Math.cos(t * 1.7 + i * 2) * 0.5);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar(0.12 + (i % 3) * 0.05);
        tmp.updateMatrix(); bubbles.setMatrixAt(i, tmp.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    });

    // ---------- the sound desk out in the crowd, behind a crowd barrier ----------
    const FOH = { x: -9.6, z: 7.3 };
    const foh = group(root, FOH.x, 0, FOH.z, 0.25);
    block(foh, 0x2a2438, 0, 0.5, 0, 1.8, 1.0, 0.9, 0.05);
    block(foh, 0x2a2a30, 0, 1.08, 0.05, 1.6, 0.16, 0.7, 0.04, { rx: -0.2 }); // the mixing desk...
    for (let i = 0; i < 10; i++) block(foh, [0xff6b6b, 0xffd23f, 0x4fb7ff, 0x6fd36a, 0xffffff][i % 5], -0.66 + i * 0.146, 1.17, -0.05 + (i % 3) * 0.06, 0.05, 0.03, 0.08, 0.01, { rx: -0.2 }); // ...its faders
    block(foh, 0x2a2a30, 0.55, 1.45, -0.25, 0.55, 0.4, 0.05, 0.02, { rx: 0.25 }); // a laptop screen
    for (const [px, pz] of [[-1.0, -0.6], [1.0, -0.6], [-1.0, 0.6], [1.0, 0.6]]) cylinder(foh, 0xffffff, px, 1.25, pz, 0.04, 2.5, { seg: 6 });
    block(foh, 0xa58cff, 0, 2.55, 0, 2.3, 0.12, 1.5, 0.05);                       // a little canopy
    // crowd barriers: steel panels with feet, in front of the sound desk and the speaker stacks
    const barrier = (x, z, len, ry) => {
      const b = group(root, x, 0, z, ry);
      for (const y of [0.2, 1.05]) cylinder(b, 0x9aa3b0, 0, y, 0, 0.035, len, { rz: Math.PI / 2, seg: 6 });
      for (let k = -len / 2 + 0.1; k <= len / 2 - 0.05; k += 0.14) cylinder(b, 0x9aa3b0, k, 0.62, 0, 0.012, 0.85, { seg: 4 });
      for (const k of [-len / 2, len / 2]) block(b, 0x9aa3b0, k, 0.03, -0.25, 0.06, 0.06, 0.6, 0.02);
    };
    barrier(FOH.x + 0.35, FOH.z - 1.25, 2.6, 0.25);
    barrier(FOH.x + 1.65, FOH.z - 0.1, 1.6, 0.25 - Math.PI / 2);
    for (const sx of [-1, 1]) barrier(sx * 10.9, -5.75, 2.0, 0);
    // the cable snake from the stage to the desk, along the ground
    cable(root, stageCable, [[-6.2, -5.3], [-7.0, -2.0], [-8.4, 2.6], [-9.0, 6.6]].map(([x, z]) => new THREE.Vector3(x, 0.05, z)), 0.04);

    // a few lamp posts, bins and hay bales around the edge
    lampPost(root, -16.8, -1.2, 0xffd08a); lampPost(root, 16.8, -2.6, 0xffd08a);
    for (const [hx, hz, r] of [[-16.6, 9.2, 0.3], [16.9, -0.4, -0.2]]) block(root, 0xe8c060, hx, 0.4, hz, 1.4, 0.8, 0.8, 0.12, { ry: r });
    for (const [bx0, bz0, c] of [[-10.6, 5.6, 0x6fd36a], [10.1, -1.4, 0x4fb7ff]]) {
      put(root, G.taper(0.32, 0.28), toon(c), { x: bx0, y: 0.45, z: bz0, sy: 0.9 });
      cylinder(root, 0x2a2438, bx0, 0.93, bz0, 0.34, 0.06);
    }
    // the grass is worn bare where the crowd stands and queues (soft brown patches),
    // and soft shadows under things (see blobShadows)
    const wearBlobs = [
      ...[-6, -2, 2, 6].map((x) => ({ x, z: 3.0, r: 2.0, sz: 0.9 })), { x: 0, z: 10.6, r: 1.9, sz: 2.4 },
      { x: FT.x - 2.4, z: FT.z - 0.3, r: 1.5, sz: 2.2 }, { x: DS.x + 2.2, z: DS.z, r: 1.3, sz: 1.8 }, { x: MB.x + 2.0, z: MB.z, r: 1.2, sz: 1.8 },
      { x: BL.x, z: tierZ[0] - 1.1, r: 2.6, sz: 0.8 }, { x: FOH.x + 0.8, z: FOH.z - 1.9, r: 2.0, sz: 0.9, ry: 0.25 },
      { x: -10.9, z: -5.0, r: 1.3, sz: 0.6 }, { x: 10.9, z: -5.0, r: 1.3, sz: 0.6 },
    ].map((b) => Object.assign(b, { color: 0x6a4a20 })); // (brown: drawn below with the shadows)
    const stageBlobs = [ // (drawn below, with the trees)
      { x: -10.9, z: -6.9, r: 1.3, sz: 1.1 }, { x: 10.9, z: -6.9, r: 1.3, sz: 1.1 },
      ...[-PX, PX].map((x) => ({ x, z: PZ0, r: 0.6 })), { x: FT.x, z: FT.z, r: 1.8, sz: 3.6 }, { x: DS.x, z: DS.z, r: 1.0, sz: 1.8 },
      { x: MB.x, z: MB.z, r: 1.2, sz: 1.9 }, { x: BL.x, z: BL.z, r: 3.1, sz: 1.5 }, { x: BC.x, z: BC.z, r: 0.95, sz: 0.75 },
      ...benches.map((b) => ({ x: b.x, z: b.z, r: 1.45, sz: 0.65 })), { x: FOH.x, z: FOH.z, r: 1.4, sz: 1.0, ry: -0.25 },
      { x: -16.8, z: -1.2, r: 0.45 }, { x: 16.8, z: -2.6, r: 0.45 }, { x: -10.6, z: 5.6, r: 0.5 }, { x: 10.1, z: -1.4, r: 0.5 },
      { x: -16.6, z: 9.2, r: 0.95, sz: 0.6, ry: -0.3 }, { x: 16.9, z: -0.4, r: 0.95, sz: 0.6, ry: 0.2 },
      ...Object.values(poles).map(([x, z]) => ({ x, z, r: 0.35 })), { x: searchAt[0].x, z: searchAt[0].z, r: 0.7 }, { x: searchAt[1].x, z: searchAt[1].z, r: 0.7 },
      { x: SCR.x + Math.cos(SCR.ry) * 3.3, z: SCR.z - Math.sin(SCR.ry) * 3.3, r: 0.6 }, { x: SCR.x - Math.cos(SCR.ry) * 3.3, z: SCR.z + Math.sin(SCR.ry) * 3.3, r: 0.6 },
    ];

    // ---------- scenery all around: park trees, hills, the city and a ferris wheel ----------
    // (pushed out to at least 31 away, beyond where the camera can zoom out to: see cameraMaxDistance)
    const near = [[-20, -14, 1.2], [-24, -2, 1.0], [-21, 10, 1.1], [21, -15, 1.1], [24, -3, 1.0], [22, 11, 1.2], [-8, -17, 1.0], [7, -18, 1.1], [-30, -20, 1.3], [30, 18, 1.1], [-15, 20, 1.0], [14, 21, 1.0]]
      .map(([x, z, s]) => { const d = Math.hypot(x, z), k = Math.max(1, 31 / d); return [x * k, z * k, s]; });
    near.forEach(([x, z, s], i) => roundTree(root, x, z, s, i % 4 === 1 ? [0xff9ec7, 0xffc3dc] : [0x5fb84a, 0x86d65e]));
    blobShadows(root, wearBlobs.concat(stageBlobs, near.map(([x, z, s]) => ({ x, z, r: 1.9 * s }))), 0.26, 0x2a2010);
    for (const [x, z] of [[-18.5, -9], [18.6, 6], [-19, 4], [19.5, -9.5]]) bush(root, x, z, 1, 0x4fbf47, 0xff6fa5);
    farTown(root, {
      seed: 5, trees: [200, 33, 90], hills: [26, 160], dim: 0.95,
      treeColors: [0x5fb84a, 0x4fa843, 0x77c95a, 0xff9ec7, 0xffb84d],
      keepOut: (x, z) => Math.abs(x) < 26 && z > -24 && z < 26,
    });
    // city skyline far behind the stage, with windows lighting up for the evening
    const sky = [];
    const kr = seeded(41);
    for (let i = 0; i < 46; i++) {
      const a = -PI / 2 + (kr() - 0.5) * 2.2, d = 120 + kr() * 45;
      const tall = kr() < 0.25;
      sky.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, sx: 7 + kr() * 8, sy: tall ? 45 + kr() * 35 : 14 + kr() * 26, sz: 7 + kr() * 8, ry: a, color: [0xd8c0e8, 0xf0c8b0, 0xc8c8e8, 0xe8d0c0, 0xb8b0d8][Math.floor(kr() * 5)] });
    }
    farScatter(root, unitBox, windowMaterial({ color: 0xffffff, glass: 0x8a7ab8, lit: 0xffe08a, litAmount: 0.4, w: 2.4, h: 3.4 }), sky);
    // a ferris wheel in the distance, slowly turning
    const FW = { x: 62, y: 0, z: -95 };
    painted(root, bakeGeo((g) => {
      for (const sz of [-1, 1]) for (const r of [0.35, -0.35]) put(g, G.box(), toon(0xffffff), { x: FW.x, y: 9, z: FW.z + sz * 1.2, sx: 0.6, sy: 19, sz: 0.6, rz: r });
    }));
    const wheel = dynamic(painted(root, bakeGeo((g) => {
      for (const sz of [-1.2, 1.2]) put(g, G.torus(14, 0.3), toon(0xffffff), { z: sz });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        put(g, G.box(), toon(0xffffff), { x: Math.cos(a) * 7, y: Math.sin(a) * 7, sx: 14, sy: 0.25, sz: 0.25, rz: a });
        put(g, G.rbox(1.6, 1.6, 2.2, 0.4), toon([0xff6b6b, 0xffd23f, 0x4fb7ff, 0x6fd36a, 0xff8ad8, 0xa58cff][i % 6]), { x: Math.cos(a) * 14, y: Math.sin(a) * 14 - 1, z: 0 });
      }
    }), { x: FW.x, y: 19, z: FW.z }));
    wheel.lookAt(0, 19, 0);
    const wheelBase = wheel.quaternion.clone();
    const spinQ = new THREE.Quaternion();
    anim.push((t) => { spinQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), t * 0.08); wheel.quaternion.copy(wheelBase).multiply(spinQ); });
    // sunset clouds, tinted pink and orange
    cloudRing(root, anim, toon(0xffc0a0, { emissive: 0xff9a7a, emissiveIntensity: 0.35 }), { count: 12, rMin: 70, rMax: 110, yMin: 22, yMax: 34, sMin: 1.1, sMax: 1.8, speed: 0.006, seed: 6 });
    cloudRing(root, anim, toon(0xffb0c8, { emissive: 0xff8ab0, emissiveIntensity: 0.3 }), { count: 12, rMin: 150, rMax: 200, yMin: 32, yMax: 58, sMin: 2.4, sMax: 3.4, speed: 0.004, seed: 13, start: 2 });
    // birds flying home
    const birds = [];
    for (let i = 0; i < 5; i++) {
      const b = movingThing(root, 0, 0, 0, (g) => {
        put(g, triangleGeo([0, 0, 0, -0.9, 0.25, -0.3, -0.9, 0.25, 0.3]), toon(0x3a3346), {});
        put(g, triangleGeo([0, 0, 0, 0.9, 0.25, -0.3, 0.9, 0.25, 0.3]), toon(0x3a3346), {});
      });
      birds.push(b);
    }
    anim.push((t) => birds.forEach((b, i) => {
      const k = ((t * 0.02 + i * 0.03) % 1);
      b.position.set(-90 + k * 180 + (i % 2) * 3, 30 + Math.sin(t + i) * 0.8 + (i % 3), -70 - i * 2.5);
      b.rotation.set(0, PI / 2, Math.sin(t * 6 + i) * 0.3);
    }));

    mergeStatic(backdrop);
    dynamic(backdrop);
    mergeStatic(root);

    // ---------- spots ----------
    const SY = ST.h; // standing on the stage
    const benchSpot = (b, activity, emoji, lines) => ({
      x: b.x, z: b.z - 1.2, yaw: PI, emoji, activity, lines,
      seat: { x: b.x, z: b.z - 0.08, y: 0.0 },
    });

    return {
      group: root,
      background: 0xffb88a,
      rare: stageCat(root, ST), // a cat takes the stage
      fog: [0xffc8a0, 95, 320],
      cameraTilt: 0.44,
      cameraMaxDistance: 27, // (stays inside the ring of park trees)
      cameraTargetY: 1.6,
      bounds: { minX: -17, maxX: 17, minZ: -10.4, maxZ: 10 },
      water: [],
      obstacles: [
        { x: 0, z: stz, w: ST.w + 0.2, d: ST.z1 - ST.z0 + 0.1 },                 // the stage
        { x: -PX, z: PZ0, r: 0.4 }, { x: PX, z: PZ0, r: 0.4 },                    // roof towers
        { x: -ST.w / 2 - 0.5, z: ST.z0 + 0.6, w: 1.2, d: 1.0 }, { x: ST.w / 2 + 0.5, z: ST.z0 + 0.6, w: 1.2, d: 1.0 }, // steps
        { x: -10.9, z: -6.9, w: 1.8, d: 1.5 }, { x: 10.9, z: -6.9, w: 1.8, d: 1.5 }, // speaker stacks
        { x: SCR.x + Math.cos(SCR.ry) * 3.3, z: SCR.z - Math.sin(SCR.ry) * 3.3, r: 0.55 }, // big screen legs
        { x: SCR.x - Math.cos(SCR.ry) * 3.3, z: SCR.z + Math.sin(SCR.ry) * 3.3, r: 0.55 },
        { x: searchAt[0].x, z: searchAt[0].z, r: 0.6 }, { x: searchAt[1].x, z: searchAt[1].z, r: 0.6 },
        { x: FT.x, z: FT.z, w: 2.9, d: 6.4 },                                      // food truck
        { x: DS.x, z: DS.z, w: 1.6, d: 3.2 },                                      // lemonade stand
        { x: MB.x - 0.2, z: MB.z, w: 2.2, d: 3.4 },                                // merch booth
        { x: BL.x, z: BL.z, w: 5.8, d: 2.6 },                                      // bleachers
        { x: BC.x, z: BC.z, w: 1.6, d: 1.4 },                                      // balloon cart
        { x: -16.8, z: -1.2, r: 0.3 }, { x: 16.8, z: -2.6, r: 0.3 },               // lamps
        { x: -16.6, z: 9.2, w: 1.5, d: 1.0, rot: -0.3 }, { x: 16.9, z: -0.4, w: 1.5, d: 1.0, rot: 0.2 }, // hay bales
        { x: -10.6, z: 5.6, r: 0.4 }, { x: 10.1, z: -1.4, r: 0.4 },                // bins
        { x: -12.6, z: -9.8, r: 0.2 }, { x: 12.6, z: -10.4, r: 0.2 }, { x: -16.5, z: 6.4, r: 0.2 }, // flag poles
        { x: FOH.x, z: FOH.z, w: 2.4, d: 1.6, rot: -0.25 },                       // the sound desk
        { x: FOH.x + 0.35, z: FOH.z - 1.25, w: 2.7, d: 0.6, rot: -0.25 },         // its crowd barriers
        { x: FOH.x + 1.65, z: FOH.z - 0.1, w: 0.6, d: 1.7, rot: -0.25 },
        { x: -10.9, z: -5.75, w: 2.1, d: 0.6 }, { x: 10.9, z: -5.75, w: 2.1, d: 0.6 }, // barriers by the speakers
      ].concat(Object.values(poles).map(([x, z]) => ({ x, z, r: 0.22 })))
        .concat(benches.map((b) => ({ x: b.x, z: b.z + 0.05, w: 2.5, d: 1.0 }))),
      spots: [
        { x: MC.x, z: ST.z1 + 0.8, yaw: 0, arms: "cheer", emoji: "🎤", activity: "singing on stage",
          stand: { x: MC.x, z: MC.z - 0.5, y: SY },
          lines: ["♪ La la laaa~ ♪", "Hello, Mii Fest!", "Make some noise!", "This one's for you!", "Everybody sing along!"] },
        { x: DR.x, z: ST.z1 + 0.8, yaw: 0, arms: "drum", emoji: "🥁", activity: "playing the drums",
          seat: { x: DR.x, z: DR.z - 0.75, y: SY + 0.67 - 0.56 },
          lines: ["Ba-dum tss!", "One, two, three, four!", "Drum solo!", "*CRASH*"] },
        { x: KB.x, z: ST.z1 + 0.8, yaw: 0, arms: "type", emoji: "🎹", activity: "playing the keyboard",
          stand: { x: KB.x, z: KB.z - 0.6, y: SY },
          lines: ["♪ Plink plonk ♪", "Synth solo!", "Feel the groove!", "Which key was it again?"] },
        { x: -7.8, z: ST.z1 + 0.8, yaw: 0, arms: "out", emoji: "💃", activity: "dancing on stage",
          stand: { x: -7.6, z: -6.6, y: SY },
          lines: ["Look at my moves!", "Spin, spin, spin!", "Dance like nobody's watching!", "Woo-hoo!"] },
        { x: -2.8, z: -2.2, yaw: PI, arms: "cheer", emoji: "🙌", activity: "cheering in the crowd",
          lines: ["WOOO!", "Encore! Encore!", "Best concert ever!", "I love this song!"] },
        { x: 2.8, z: -1.2, yaw: PI, arms: "wave", emoji: "✨", activity: "waving a glow stick",
          lines: ["Wave your hands!", "So many lights!", "La la la~", "Feel the music!"] },
        { x: 10.0, z: -2.6, yaw: Math.atan2(SCR.x - 10.0, SCR.z + 2.6), lookUp: 0.35, emoji: "📺", activity: "watching the big screen",
          lines: ["I can see myself on the screen!", "Wave to the camera!", "So many hearts!", "That's huge!"] },
        benchSpot(benches[0], "enjoying the show", "🎶", ["What a great band!", "My feet needed a rest.", "Such a nice evening!"]),
        benchSpot(benches[3], "listening to the music", "🎵", ["This song is my favorite!", "*taps foot*", "What a sunset!"]),
        { x: BL.x, z: tierZ[0] - 1.2, yaw: PI, emoji: "👏", activity: "watching from the bleachers",
          seat: { x: BL.x, z: tierZ[1] - 0.05, y: tierH[1] - 0.56 },
          lines: ["Great view from up here!", "*clap clap clap*", "Bravo!", "Play another one!"] },
        { x: FT.x - 2.5, z: FT.z - 0.4, yaw: PI / 2, arms: "eat", emoji: "🍔", activity: "getting a burger",
          lines: ["One burger, please!", "Mmm, so juicy!", "Extra pickles!", "Concert food is the best!"] },
        { x: DS.x + 2.3, z: DS.z, yaw: -PI / 2, arms: "eat", emoji: "🍋", activity: "drinking lemonade",
          lines: ["So refreshing!", "Sour! But tasty!", "Ahh, perfect on a warm evening.", "Can I get a straw?"] },
        { x: MB.x + 2.1, z: MB.z, yaw: -PI / 2, emoji: "👕", activity: "browsing the merch",
          lines: ["I need that T-shirt!", "Ooh, a souvenir!", "Do you have this in my size?", "So cool!"] },
      ],
      lines: [
        "What a show!", "I love this band!", "The sunset is so pretty!", "Make some noise!",
        "Who's playing next?", "Let's dance!", "Look at the lights!", "Encore!",
        "Want some lemonade?", "Best night ever!",
      ],
      entrance: { x: 0, z: 9.3 },
      update(t, camera) {
        anim.forEach((a) => a(t));
        if (camera) backdrop.visible = camera.position.z > ST.z0 - 0.5;
      },
    };
  }

  root.World3D.addPlace({ id: "school", name: "College", icon: "🎓" }, buildSchool);
  root.World3D.addPlace({ id: "stage", name: "Concert Stage", icon: "🎤" }, buildStage);
})(typeof self !== "undefined" ? self : this);
