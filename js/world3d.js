/*
 * world3d.js
 * The three 3D places Miis hang out in, built in a soft, colorful,
 * Tomodachi Life-style: an island park, a cozy office, and a moon base.
 *
 * Everything is made from simple rounded shapes with "toon" shading
 * (a few flat bands of light instead of smooth gradients), which gives
 * the cartoony Nintendo look. No extra model files are needed.
 *
 * Each place returns:
 *   group      all the 3D objects
 *   bounds     the rectangle Miis can walk in
 *   obstacles  shapes Miis walk around (see nav.js for the shape types)
 *   water      shapes that are water (so we know when a Mii gets dropped in)
 *   spots      places to do an activity
 *   lines      things Miis might say here
 *   update(t)  moves animated things (clouds, ducks, stars...)
 */
(function (root) {
  "use strict";

  const THREE = root.THREE;
  const TAU = Math.PI * 2;

  // =====================================================================
  // Toolkit: materials, shapes and helpers shared by all the places
  // =====================================================================

  // Toon shading: three bands of light (shadow, mid, lit).
  const gradient = (() => {
    const t = new THREE.DataTexture(new Uint8Array([140, 205, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  })();

  // Plain colors are shared (so they can be merged together). Materials with a
  // picture, see-through or glowing parts get their own copy, because those are
  // often animated one by one (blinking lights, fading smoke...).
  const matCache = new Map();
  function toon(color, opts) {
    const make = () => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradient }, opts || {}));
    const special = opts && (opts.map || opts.transparent || opts.emissive !== undefined || opts.side !== undefined || opts.fog !== undefined);
    if (special) return make();
    const key = String(color);
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  }
  function glow(color, intensity) {
    return toon(color, { emissive: color, emissiveIntensity: intensity === undefined ? 0.8 : intensity });
  }

  const geoCache = new Map();
  function cachedGeo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }
  const G = {
    sphere: () => cachedGeo("sphere", () => new THREE.SphereGeometry(1, 28, 18)),
    lowSphere: () => cachedGeo("lowSphere", () => new THREE.SphereGeometry(1, 14, 10)),
    midSphere: () => cachedGeo("midSphere", () => new THREE.SphereGeometry(1, 16, 11)),
    tinySphere: () => cachedGeo("tinySphere", () => new THREE.SphereGeometry(1, 8, 6)),
    cyl: (seg) => cachedGeo("cyl" + (seg || 24), () => new THREE.CylinderGeometry(1, 1, 1, seg || 24)),
    cone: (seg) => cachedGeo("cone" + (seg || 20), () => new THREE.ConeGeometry(1, 1, seg || 20)),
    box: () => cachedGeo("box", () => new THREE.BoxGeometry(1, 1, 1)),
    rbox: (w, h, d, r) => cachedGeo("rbox" + [w, h, d, r].join(","), () => new THREE.RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999)),
    torus: (r, tube) => cachedGeo("torus" + r + "," + tube, () => new THREE.TorusGeometry(r, tube, 12, 36)),
    taper: (rt, rb, seg) => cachedGeo("taper" + rt + "," + rb + "," + (seg || 18), () => new THREE.CylinderGeometry(rt, rb, 1, seg || 18)),
    circle: () => cachedGeo("circle", () => new THREE.CircleGeometry(1, 40)),
    capsule: () => cachedGeo("capsule", () => new THREE.CapsuleGeometry(0.5, 1, 6, 14)),
  };

  // Adds a mesh. o = { x, y, z, sx, sy, sz, s, rx, ry, rz, shadow, receive }
  function put(parent, geo, mat, o) {
    o = o || {};
    const m = new THREE.Mesh(geo, mat);
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    const s = o.s || 1;
    m.scale.set((o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.castShadow = o.shadow !== false;
    m.receiveShadow = o.receive !== false;
    parent.add(m);
    return m;
  }
  const ball = (p, color, x, y, z, r, o) => put(p, G.sphere(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, s: r }, o));
  const cylinder = (p, color, x, y, z, r, h, o) => put(p, G.cyl(o && o.seg), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: r, sy: h, sz: r }, o));
  const block = (p, color, x, y, z, w, h, d, r, o) => put(p, G.rbox(w, h, d, r === undefined ? 0.06 : r), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z }, o));
  const disc = (p, color, x, y, z, r, o) => put(p, G.circle(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, s: r, rx: -Math.PI / 2, shadow: false }, o));

  function group(parent, x, y, z, ry, s) {
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    g.rotation.y = ry || 0;
    if (s) g.scale.setScalar(s);
    parent.add(g);
    return g;
  }
  // Things that move every frame must not be merged with the static scenery.
  function dynamic(obj) { obj.userData.dynamic = true; return obj; }

  function canvasTexture(w, h, draw, repeat) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  }

  function seeded(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  // A big sphere around everything, colored from top to bottom.
  function skyDome(parent, top, middle, bottom) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, middle: { value: new THREE.Color(middle) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: "varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 middle; uniform vec3 bottom; varying vec3 vPos;" +
        "void main(){ float h = vPos.y; vec3 c = h > 0.0 ? mix(middle, top, pow(h, 0.6)) : mix(middle, bottom, min(1.0, -h * 4.0));" +
        "gl_FragColor = vec4(c, 1.0);\n#include <encodings_fragment>\n}",
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), mat);
    dome.userData.dynamic = true; // keep separate (special material)
    parent.add(dome);
    return dome;
  }

  function addLights(parent, o) {
    parent.add(new THREE.HemisphereLight(o.sky, o.ground, o.hemi));
    parent.add(new THREE.AmbientLight(0xffffff, o.ambient === undefined ? 0.25 : o.ambient));
    const sun = new THREE.DirectionalLight(o.sunColor || 0xfff4e0, o.sun);
    sun.position.set(10, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    parent.add(sun);
    // a soft light from the camera side so faces are never too dark
    const fill = new THREE.DirectionalLight(0xffffff, o.fill === undefined ? 0.3 : o.fill);
    fill.position.set(0, 8, 20);
    parent.add(fill);
  }

  // Joins all the non-moving shapes that share a material into one mesh.
  // This makes the scene MUCH faster to draw (hundreds of objects -> a few dozen).
  const debug = { noMerge: false }; // tests turn merging off to inspect single objects

  // ---------- near and far (for the little planet, see planet3d.js) ----------
  // Every place sits on a little planet. Seen from up in the sky, only the place
  // itself shows (on its own round patch of ground); the far-away scenery around it
  // (sky, sea, city, hills, the ring of trees...) is only drawn while you're there.
  // Far things go on their own layer, which the camera only sees at a place.
  const FAR_LAYER = 1;
  // Little things (a cup, a book, a flower pot) go on this layer: seen from far away
  // while flying, they're left out (see hub3d.js stepFlight). Layer 3 = left out.
  const SMALL_LAYER = 2;
  const FAR = { center: 30, radius: 36 }; // (in place units: the walking area is about 34 x 22)
  let splitFar = false; // true while a place is being built (mergeStatic keeps near and far apart)
  const tmpSphere = new THREE.Sphere();
  function isFarSphere(s) {
    return Math.hypot(s.center.x, s.center.z) > FAR.center || s.radius > FAR.radius;
  }
  // The bounding sphere of an object (from its geometry), where it really is.
  function worldSphere(o, out) {
    const geo = o.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingSphere || !isFinite(geo.boundingSphere.radius)) return null;
    out.copy(geo.boundingSphere);
    if (o.isInstancedMesh) {
      // all its copies: from the middle of them to the furthest one
      const m = new THREE.Matrix4(), c = new THREE.Vector3(), pts = [];
      let scale = 0;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        pts.push(geo.boundingSphere.center.clone().applyMatrix4(m));
        scale = Math.max(scale, m.getMaxScaleOnAxis());
      }
      if (!pts.length) return null;
      pts.forEach((q) => c.add(q));
      c.divideScalar(pts.length);
      let r = 0;
      pts.forEach((q) => { r = Math.max(r, q.distanceTo(c)); });
      out.center.copy(c);
      out.radius = r + geo.boundingSphere.radius * scale;
    }
    return out.applyMatrix4(o.matrixWorld);
  }

  function mergeStatic(rootGroup) {
    if (debug.noMerge) return;
    rootGroup.updateMatrixWorld(true);
    const skip = new Set();
    rootGroup.traverse((o) => { if (o.userData.dynamic) o.traverse((c) => skip.add(c)); });
    const buckets = new Map();
    const remove = [];
    rootGroup.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || skip.has(o) || Array.isArray(o.material)) return;
      if (o.material.isShaderMaterial) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      // (painted models keep their colors, see bakeGeo below)
      const keep = o.material.vertexColors ? ["position", "normal", "uv", "color"] : ["position", "normal", "uv"];
      for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      // (while a place is being built, near and far things go into separate meshes)
      const far = splitFar ? !!worldSphere(o, tmpSphere) && isFarSphere(tmpSphere) : null;
      const key = o.material.uuid + "|" + o.castShadow + "|" + o.receiveShadow + "|" + far;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, far, geos: [] });
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
      m.receiveShadow = b.receive;
      m.matrixAutoUpdate = false;
      if (b.far !== null) m.userData[b.far ? "far" : "near"] = true;
      rootGroup.add(m);
    }
  }

  // Puts a place's far-away scenery and its lights on the far layer (see FAR_LAYER),
  // and works out how big the round patch of ground under it should be (world.padRadius).
  function markFar(world) {
    const top = world.group;
    top.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(top.matrixWorld).invert();
    const s = new THREE.Sphere(), box = new THREE.Box3(), b = new THREE.Box3();
    const far = new Set(), check = [], merged = [], spheres = new Map();
    top.traverse((o) => {
      if (o.isLight) {
        far.add(o);
        if (o.shadow && o.shadow.camera) { o.shadow.camera.layers.enable(FAR_LAYER); o.shadow.camera.layers.enable(SMALL_LAYER); } // (they still cast shadows)
        return;
      }
      if (!o.geometry) return;
      if (o.userData.near) { merged.push(o); return; }
      if (o.userData.far || (o.isInstancedMesh && !o.frustumCulled) || o.isPoints) far.add(o);
      else check.push(o);
    });
    // Things that move (a comet, satellites, a tram...) are checked at a few moments
    // of their animation: anything that ever goes far away counts as far.
    [0, 13.7, 61.3, 147.9].forEach((t, i) => {
      if (i > 0) {
        if (!world.update) return;
        try { world.update(t); } catch (e) { return; }
        top.updateMatrixWorld(true);
      }
      for (const o of check) {
        if (far.has(o) || (i > 0 && o.isInstancedMesh)) continue;
        // (the copies in an InstancedMesh don't move: measured once)
        const sp = o.isInstancedMesh ? spheres.get(o) || worldSphere(o, new THREE.Sphere()) : worldSphere(o, s);
        if (!sp) continue;
        if (o.isInstancedMesh) spheres.set(o, sp);
        if (isFarSphere(s.copy(sp).applyMatrix4(inv))) far.add(o);
      }
    });
    if (world.update) try { world.update(0); } catch (e) { /* (it moves on by itself) */ }
    top.updateMatrixWorld(true);
    for (const o of far) o.traverse((c) => c.layers.set(FAR_LAYER));
    // how far the near things reach (for the patch of ground), and which ones are little
    world.smallParts = [];
    for (const o of check.concat(merged)) {
      if (far.has(o) || !o.isMesh || o.isInstancedMesh || o.layers.mask !== 1 || !o.geometry.attributes.position) continue;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
      const sp = !o.userData.near && worldSphere(o, s);
      if (sp && sp.radius < 1.6) { o.layers.set(SMALL_LAYER); world.smallParts.push(o); }
    }
    const ext = box.isEmpty() ? 24 : Math.hypot(Math.max(-box.min.x, box.max.x, 17), Math.max(-box.min.z, box.max.z, 11));
    world.padRadius = Math.max(22, Math.min(31, ext * 0.92));
    return world;
  }

  // Lots of copies of one small shape (flowers, grass, books) drawn in one go.
  function scatter(parent, geo, mat, items, castShadow) {
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      tmp.position.set(it.x, it.y || 0, it.z);
      tmp.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      tmp.scale.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      // every copy gets a color (white = the material's own color): if a material is
      // shared by copies with and without colors, three.js draws the plain ones black
      m.setColorAt(i, col.set(it.color !== undefined ? it.color : 0xffffff));
    });
    m.castShadow = !!castShadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Far-away scenery (city blocks, clouds...) spread all around the place.
  // Copies of one shape are drawn in one go; they don't catch shadows, and they
  // are always drawn (three.js would otherwise only check the first copy to
  // decide whether the whole lot is on screen).
  function farScatter(parent, geo, mat, items) {
    const m = scatter(parent, geo, mat, items, false);
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }

  // "Painted" models: every part keeps its own color, but the whole model is
  // ONE shape with ONE material, so the computer draws it in a single go.
  // Great for things that move (boats, cars, satellites) and for far scenery.
  const paintedMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, vertexColors: true });

  // build(g) adds parts to g with the usual helpers (ball, block...);
  // we get back one geometry with all the parts and their colors baked in.
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
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      col.copy(m.color);
      // glowing parts get a little brighter so they still look lit up
      if (m.emissive && m.emissiveIntensity && m.emissive.getHex()) col.lerp(new THREE.Color(1, 1, 1), 0.25);
      const n = geo.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b; }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      geos.push(geo);
    });
    return THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
  }
  // Bakes lists of copies (items like scatter's: { x, y, z, s, sx, sy, sz, rx, ry, rz, color })
  // into one painted shape. list = [[geometry, items, brightness], ...]
  // Use it for far-away scenery that never moves: everything in one draw call.
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
    return put(parent, geo, paintedMat, Object.assign({ shadow: false, receive: false }, o));
  }

  // A two-sided triangle (for sails and flags), as a geometry.
  function triangleGeo(pts) {
    const [a, b, c] = [pts.slice(0, 3), pts.slice(3, 6), pts.slice(6, 9)];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
    g.computeVertexNormals();
    return g;
  }

  // One puffy cloud shape (copied many times with farScatter).
  const cloudGeo = () => cachedGeo("cloud", () => bakeGeo((g) => {
    const puff = (x, y, z, s, o) => put(g, G.midSphere(), toon(0xffffff), Object.assign({ x, y, z, s }, o));
    puff(0, 0, 0, 2.2); puff(2.2, -0.4, 0.3, 1.6); puff(-2.1, -0.5, 0, 1.5); puff(0.6, 1.1, 0, 1.4); puff(-0.9, 0.7, 0.6, 1.2);
    puff(0, -0.9, 0, 3.2, { sy: 0.6, sz: 0.5 }); // flat bottom
  }));

  // A ring of clouds all the way around the place. The whole ring slowly turns,
  // so the clouds drift past whichever way you look.
  // o = { count, rMin, rMax, yMin, yMax, sMin, sMax, speed, seed }
  function cloudRing(parent, anim, mat, o) {
    const r = seeded(o.seed || 1);
    const items = [];
    for (let i = 0; i < o.count; i++) {
      const a = ((i + r() * 0.7) / o.count) * TAU;
      const d = o.rMin + r() * (o.rMax - o.rMin);
      const s = o.sMin + r() * (o.sMax - o.sMin);
      items.push({ x: Math.cos(a) * d, y: o.yMin + r() * (o.yMax - o.yMin), z: Math.sin(a) * d, s, sy: s * (0.75 + r() * 0.3), ry: -a + Math.PI / 2 });
    }
    const ring = dynamic(farScatter(parent, cloudGeo(), mat, items));
    anim.push((t) => { ring.rotation.y = (o.start || 0) + t * o.speed; });
    return ring;
  }

  // A material that paints rows of windows onto any box, using where each bit
  // of the box is in the world (so tall and short buildings get the same size
  // windows). Some windows are lit up yellow, the rest reflect the blue sky.
  // o = { w, h } the size of one window "cell", glass and lit colors.
  function windowMaterial(o) {
    o = o || {};
    const mat = new THREE.MeshToonMaterial({ color: o.color || 0xffffff, gradientMap: gradient });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.winSize = { value: new THREE.Vector2(o.w || 2.4, o.h || 3.4) };
      sh.uniforms.winGlass = { value: new THREE.Color(o.glass || 0x8fd0ff) };
      sh.uniforms.winLit = { value: new THREE.Color(o.lit || 0xfff1a8) };
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
      sh.fragmentShader = "uniform vec2 winSize;\nuniform vec3 winGlass;\nuniform vec3 winLit;\nvarying vec3 vWinPos;\nvarying vec3 vWinN;\n" +
        sh.fragmentShader.replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float winAmt = 0.0;",
          "vec3 winCol = winGlass;",
          "if (abs(vWinN.y) < 0.5) {", // only on the walls, not the roof
          "  float u = abs(vWinN.x) > abs(vWinN.z) ? vWinPos.z : vWinPos.x;",
          "  vec2 cell = vec2(u, vWinPos.y) / winSize;",
          "  vec2 f = fract(cell);",
          "  winAmt = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8);",
          "  float rnd = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);",
          "  winCol = rnd > 0.87 ? winLit : mix(winGlass, vec3(1.0), f.y * 0.35);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, winCol, winAmt);",
          "}",
        ].join("\n")).replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += winCol * winAmt * 0.3;");
    };
    return mat;
  }

  // ---------- reusable props ----------
  function roundTree(p, x, z, s, colors, fruit) {
    const t = group(p, x, 0, z, 0, s);
    // the trunk is tall enough for Miis to walk under the leaves without their heads poking in
    put(t, G.taper(0.24, 0.36), toon(0x9a6a3c), { y: 1.6, sy: 3.2 });
    const [c1, c2] = colors || [0x5cc84a, 0x7fdc5c];
    ball(t, c1, 0, 4.1, 0, 1.45);
    ball(t, c1, -0.95, 3.7, 0.25, 1.0);
    ball(t, c1, 0.95, 3.75, -0.1, 1.05);
    ball(t, c2, -0.35, 4.55, 0.55, 0.85);
    ball(t, c2, 0.55, 4.1, 0.75, 0.7);
    if (fruit) {
      const rr = seeded(Math.floor(x * 100 + z * 7) & 0xffff || 1);
      for (let i = 0; i < 7; i++) {
        const a = rr() * TAU, h = 3.5 + rr() * 1.4;
        ball(t, fruit, Math.cos(a) * 1.25, h, Math.sin(a) * 1.25 + 0.2, 0.13);
      }
    }
    return t;
  }

  function palmTree(p, x, z, s, lean) {
    const t = group(p, x, 0, z, lean || 0, s);
    let px = 0, py = 0;
    for (let i = 0; i < 7; i++) {
      const seg = put(t, G.taper(0.2 - i * 0.012, 0.24 - i * 0.012), toon(i % 2 ? 0xb88a55 : 0xa47a48), { x: px, y: py + 0.3, sy: 0.62 });
      seg.rotation.z = -0.05 * i;
      px += 0.06 * i; py += 0.58;
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const leaf = put(t, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: px + Math.cos(a) * 0.9, y: py + 0.15, z: Math.sin(a) * 0.9, sx: 1.1, sy: 0.12, sz: 0.38 });
      leaf.rotation.set(0, -a, -0.35);
    }
    for (let i = 0; i < 3; i++) ball(t, 0x7a5232, px + Math.cos(i * 2) * 0.25, py - 0.2, Math.sin(i * 2) * 0.25, 0.17);
    return t;
  }

  function bush(p, x, z, s, color, flowers) {
    const b = group(p, x, 0, z, 0, s);
    ball(b, color, 0, 0.45, 0, 0.6, { sy: 0.8 });
    ball(b, color, 0.5, 0.35, 0.1, 0.45, { sy: 0.8 });
    ball(b, color, -0.5, 0.35, -0.05, 0.48, { sy: 0.8 });
    if (flowers) for (let i = 0; i < 6; i++) ball(b, flowers, Math.cos(i) * 0.55, 0.55 + (i % 2) * 0.2, Math.sin(i * 1.7) * 0.4 + 0.25, 0.08);
    return b;
  }

  function parkBench(p, x, z, ry) {
    const b = group(p, x, 0, z, ry);
    const wood = toon(0xd9894a), iron = toon(0x3d4a5c);
    for (const dz of [-0.12, 0.08, 0.28]) block(b, wood, 0, 0.56, dz, 2.3, 0.07, 0.17, 0.03);
    for (const dy of [0.82, 1.02]) block(b, wood, 0, dy, -0.3, 2.3, 0.16, 0.06, 0.03);
    for (const sx of [-1.0, 1.0]) {
      block(b, iron, sx, 0.28, 0.1, 0.08, 0.56, 0.08, 0.03);
      block(b, iron, sx, 0.28, -0.25, 0.08, 0.56, 0.08, 0.03);
      block(b, iron, sx, 0.8, -0.32, 0.08, 0.55, 0.08, 0.03);
      block(b, iron, sx, 0.72, 0.0, 0.08, 0.06, 0.6, 0.03);
    }
    return b;
  }

  function lampPost(p, x, z, color) {
    const l = group(p, x, 0, z);
    cylinder(l, 0x2f4f46, 0, 0.12, 0, 0.22, 0.24);
    cylinder(l, 0x2f4f46, 0, 1.7, 0, 0.07, 3.2);
    ball(l, glow(color || 0xfff1b8, 0.9), 0, 3.45, 0, 0.32);
    put(l, G.cone(), toon(0x2f4f46), { y: 3.78, s: 0.4, sy: 0.3 });
    return l;
  }

  function rock(p, x, z, s, color) {
    return ball(p, color || 0xb8b3a8, x, s * 0.35, z, s, { sy: 0.65, ry: x * 3 });
  }

  // =====================================================================
  // PARK — a sunny little island
  // =====================================================================
  // A quick sound made from notes (for the rare events): kind = "quack" | "brrr" | "ding"
  let sfxCtx = null;
  function sfx(kind) {
    try {
      sfxCtx = sfxCtx || new (root.AudioContext || root.webkitAudioContext)();
      const ac = sfxCtx, t0 = ac.currentTime, g = ac.createGain();
      g.connect(ac.destination);
      const o = ac.createOscillator();
      if (kind === "quack") {
        // a nasal "quack": a buzzy note that drops, through a narrow filter
        const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1100; f.Q.value = 3;
        o.type = "sawtooth"; o.frequency.setValueAtTime(520, t0); o.frequency.exponentialRampToValueAtTime(330, t0 + 0.16);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.02); g.gain.linearRampToValueAtTime(0, t0 + 0.18);
        o.connect(f).connect(g); o.start(t0); o.stop(t0 + 0.2);
      } else if (kind === "brrr") {
        // the printer churning away
        o.type = "square"; o.frequency.value = 70;
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 23; lg.gain.value = 25; lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 0.05); g.gain.setValueAtTime(0.05, t0 + 0.6); g.gain.linearRampToValueAtTime(0, t0 + 0.7);
        o.connect(g); o.start(t0); o.stop(t0 + 0.72); lfo.start(t0); lfo.stop(t0 + 0.72);
      } else {
        o.type = "sine"; o.frequency.value = 1320;
        g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
        o.connect(g); o.start(t0); o.stop(t0 + 0.95);
      }
    } catch (e) { /* no sound */ }
  }

  // RARE (park): a mother duck leads her ducklings on a parade right across the island,
  // from the sea on one side to the sea on the other. Click them and they quack. Watch
  // them all the way across for a sticker.
  //   height(x, z) = the ground there (grass, sand or sea)
  function duckParade(root, height) {
    const path = new THREE.CatmullRomCurve3([
      [-27, -1.2], [-21.5, -1.6], [-16, -1.2], [-10, -0.9], [-4, 0.1], [1.5, 1.0], [6, 1.3], [11, 0.9], [16, 0.2], [21.5, -0.4], [27.5, -0.6],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "catmullrom", 0.5);
    const LEN = path.getLength(), SPEED = 1.5, GAP = 0.75;
    const ducks = [];
    for (let i = 0; i < 7; i++) {
      const mum = i === 0, s = mum ? 1.1 : 0.55;
      const d = dynamic(group(root, 0, -5, 0, 0, s));
      ball(d, mum ? 0xffffff : 0xffe46b, 0, 0.2, 0, 0.32, { sx: 1.25 });
      ball(d, mum ? 0xffffff : 0xffe46b, 0.3, 0.48, 0, 0.2);
      put(d, G.sphere(), toon(0xffa22b), { x: 0.52, y: 0.45, s: 0.1, sx: 1.6, sy: 0.5 });
      ball(d, 0x222222, 0.42, 0.55, 0.12, 0.035);
      ball(d, 0x222222, 0.42, 0.55, -0.12, 0.035);
      if (mum) put(d, G.cone(), toon(0xff7aa8), { x: 0.2, y: 0.72, s: 0.09, sy: 0.12, rz: -0.4 }); // a little bow on her head
      for (const sz of [-0.12, 0.12]) put(d, G.cone(), toon(0xffa22b), { x: 0, y: 0.03, z: sz, s: 0.08, sy: 0.04 }); // feet
      d.visible = false;
      ducks.push({ d, s, behind: mum ? 0 : 1.1 + (i - 1) * GAP, hop: 0, hopV: 0 });
    }
    let ev = null, check = 5;
    const p = new THREE.Vector3(), tan = new THREE.Vector3();
    const aww = ["Aww, ducklings!", "A duck parade!", "So cute! Look at them go!", "Hello, little ducks!", "One, two, three... six babies!", "Quack quack!"];
    function end(ctx, done) {
      ev = null; check = 5;
      ducks.forEach((q) => { q.d.visible = false; });
      if (done) ctx.event("ducks");
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
        ev.s += SPEED * dt;
        let all = true;
        ducks.forEach((q, i) => {
          const s = ev.s - q.behind;
          const u = Math.max(0, Math.min(1, s / LEN));
          if (s < LEN) all = false;
          path.getPointAt(u, p); path.getTangentAt(u, tan);
          const ground = height(p.x, p.z), swim = ground < -0.5;
          q.hopV -= 20 * dt; q.hop = Math.max(0, q.hop + q.hopV * dt);
          if (q.hop === 0) q.hopV = 0;
          q.d.visible = s > -1;
          q.d.position.set(p.x, ground + (swim ? 0.05 : Math.abs(Math.sin(t * 9 + i)) * 0.05) + q.hop, p.z);
          q.d.rotation.set(0, -Math.atan2(tan.z, tan.x), swim ? 0 : Math.sin(t * 9 + i) * 0.14); // waddle
        });
        // the Miis it passes go "aww"
        const mum = ducks[0].d.position;
        for (const w of ctx.all()) {
          if (ev.seen.has(w.id) || Math.hypot(w.x - mum.x, w.z - mum.z) > 4) continue;
          ev.seen.add(w.id);
          if (!w.anchored && w.state !== "perform") w.targetYaw = Math.atan2(mum.x - w.x, mum.z - w.z);
          ctx.say(w, aww[Math.floor(Math.random() * aww.length)], 2.4);
        }
        if (all) end(ctx, true);
      },
      pick(ray) {
        if (!ev) return false;
        const hit = ducks.some((q) => q.d.visible && ray.distanceSqToPoint(p.copy(q.d.position).setY(q.d.position.y + 0.35 * q.s)) < Math.pow(0.6 * q.s + 0.15, 2));
        if (!hit) return false;
        // everyone quacks and jumps
        ducks.forEach((q, i) => setTimeout(() => { q.hopV = 3.2; sfx("quack"); }, i * 90));
        return true;
      },
      stop(ctx) { if (ev) end(ctx, false); },
      force() { if (!ev) ev = { s: 0, seen: new Set() }; }, // (also used for testing)
      _state: () => ev, _ducks: ducks, // (for testing)
    };
  }

  // RARE (office): the printer that's always out of order suddenly springs to life and
  // spits paper everywhere. Click it to pull the plug (have you tried turning it off and
  // on again?) for a sticker. Leave it and it runs out of paper by itself.
  function printerFrenzy(root, printer) {
    const home = printer.position.clone();
    const MAX = 48;
    const paperGeo = new THREE.PlaneGeometry(0.42, 0.56);
    paperGeo.rotateX(-Math.PI / 2);
    const sheets = dynamic(new THREE.InstancedMesh(paperGeo, toon(0xffffff, { side: THREE.DoubleSide }), MAX));
    sheets.frustumCulled = false; sheets.castShadow = false; sheets.visible = false;
    root.add(sheets);
    const tmp = new THREE.Object3D();
    const list = [];
    let ev = null, check = 5;
    const box = new THREE.Box3();
    const oops = ["The printer's gone crazy!", "Who's printing all that?!", "Is it... alive?!", "Paper everywhere!", "Somebody stop it!"];
    function draw(fade) {
      list.forEach((q, i) => {
        tmp.position.set(q.x, q.y, q.z);
        tmp.rotation.set(q.rx, q.ry, q.rz);
        tmp.scale.setScalar(Math.max(0.001, fade));
        tmp.updateMatrix();
        sheets.setMatrixAt(i, tmp.matrix);
      });
      sheets.count = list.length;
      sheets.instanceMatrix.needsUpdate = true;
    }
    function end(ctx, done) {
      ev = null; check = 5;
      list.length = 0;
      sheets.visible = false;
      printer.position.copy(home); printer.rotation.set(0, 0, 0);
      if (done) ctx.event("printer");
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
        if (ev.phase === "go") {
          // shaking and churning, shooting out sheets of paper
          printer.position.set(home.x + Math.sin(t * 61) * 0.03, Math.abs(Math.sin(t * 37)) * 0.04, home.z + Math.cos(t * 53) * 0.02);
          printer.rotation.set(0, Math.sin(t * 29) * 0.04, Math.sin(t * 47) * 0.02);
          ev.next -= dt;
          if (ev.next <= 0 && list.length < MAX) {
            ev.next = 0.22;
            const a = Math.random() * Math.PI - Math.PI; // (out to the front and sides)
            const sp = 2 + Math.random() * 2.5;
            list.push({ x: home.x, y: 1.4, z: home.z + 0.1, vx: Math.cos(a) * sp * 0.6, vy: 3.5 + Math.random() * 2, vz: -Math.sin(a) * sp, rx: 0, ry: Math.random() * TAU, rz: 0, spin: (Math.random() - 0.5) * 9, down: false });
          }
          ev.brrr -= dt;
          if (ev.brrr <= 0) { ev.brrr = 0.75; sfx("brrr"); }
          if (ev.time > 2 && !ev.panic) {
            ev.panic = true;
            ctx.all().slice(0, 3).forEach((w, i) => setTimeout(() => { if (ev) ctx.say(w, oops[(i + Math.floor(Math.random() * 2)) % oops.length], 2.4); }, i * 900));
          }
          if (ev.time > 25) { // out of paper (no sticker: nobody turned it off)
            ev.phase = "settle"; ev.time = 0; ev.done = false;
            printer.position.copy(home); printer.rotation.set(0, 0, 0);
            const w = ctx.all()[0];
            if (w) ctx.say(w, "Phew... it ran out of paper.", 2.6);
          }
        } else if (ev.phase === "settle" && ev.time > 4.5) {
          end(ctx, ev.done);
          return;
        }
        // the sheets flutter down and lie flat on the floor
        for (const q of list) {
          if (q.down) continue;
          q.vy -= 9 * dt;
          q.vy = Math.max(q.vy, -1.6); // (paper floats down slowly)
          q.vx *= 1 - dt * 0.8; q.vz *= 1 - dt * 0.8;
          q.x += (q.vx + Math.sin(t * 4 + q.ry) * 0.6) * dt;
          q.z += q.vz * dt;
          q.y += q.vy * dt;
          q.x = Math.max(-16.5, Math.min(16.5, q.x)); q.z = Math.max(-10.7, Math.min(10.5, q.z));
          q.ry += q.spin * dt;
          q.rx = Math.sin(t * 6 + q.ry) * 0.6; q.rz = Math.cos(t * 5 + q.ry) * 0.5;
          if (q.y <= 0.02) { q.y = 0.02 + Math.random() * 0.01; q.rx = q.rz = 0; q.down = true; }
        }
        draw(ev.phase === "settle" ? Math.min(1, (4.5 - ev.time) / 1.5) : 1);
      },
      pick(ray) {
        if (!ev || ev.phase !== "go") return false;
        box.setFromObject(printer).expandByScalar(0.15);
        if (!ray.intersectsBox(box)) return false;
        // you pulled the plug: one last "ding", and peace at last
        ev.phase = "settle"; ev.time = 0; ev.done = true;
        printer.position.copy(home); printer.rotation.set(0, 0, 0);
        sfx("ding");
        const ctx = ev.ctx;
        const w = ctx.all().sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
        if (w) ctx.say(w, "Have you tried turning it off and on again?", 3);
        return true;
      },
      stop(ctx) { if (ev) end(ctx, false); },
      force(ctx) { // (also used for testing)
        if (ev) return;
        ev = { phase: "go", time: 0, next: 0.3, brrr: 0, ctx };
        list.length = 0;
        sheets.visible = true;
      },
      _state: () => ev, _printer: printer, // (for testing)
    };
  }

  function buildPark() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xd6f0ff, ground: 0x8fd16f, hemi: 0.55, sun: 0.95, ambient: 0.28 });
    skyDome(root, 0x3fa9f5, 0xcdeeff, 0x3fb6e8);

    // ocean with drifting wave marks
    const waveTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#3db3e6"; ctx.fillRect(0, 0, w, h);
      const r = seeded(4);
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 14; i++) {
        const x = r() * w, y = r() * h;
        ctx.beginPath(); ctx.arc(x, y, 9, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }, [27, 27]);
    const ocean = disc(root, toon(0xffffff, { map: waveTex }), 0, -0.9, 0, 245, { receive: true });
    dynamic(ocean);
    anim.push((t) => { waveTex.offset.set(t * 0.004, t * 0.007); });

    // island: sandy beach, then a grassy plateau on top
    const RX = 21, RZ = 14.5;
    put(root, G.cyl(64), toon(0xf5dfa4), { y: -0.55, sx: RX + 3, sy: 0.8, sz: RZ + 3, shadow: false });
    const foam = put(root, G.torus(1, 0.05), toon(0xffffff, { transparent: true, opacity: 0.75 }), { y: -0.86, sx: RX + 3.3, sy: RZ + 3.3, rx: -Math.PI / 2, shadow: false });
    dynamic(foam);
    anim.push((t) => { const k = 1 + Math.sin(t * 1.4) * 0.012; foam.scale.set((RX + 3.3) * k, (RZ + 3.3) * k, 1); });

    const grassTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#7fd65a"; ctx.fillRect(0, 0, w, h);
      // mowed-lawn stripes and little grass marks
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, 0, w / 2, h);
      const r = seeded(8);
      for (let i = 0; i < 140; i++) {
        const x = r() * w, y = r() * h;
        ctx.strokeStyle = r() < 0.5 ? "rgba(70,150,45,0.55)" : "rgba(170,235,120,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x + 3, y); ctx.lineTo(x + 4, y - 7); ctx.stroke();
      }
    }, [10, 10]);
    const plateau = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 1, 72), [toon(0xb27a45), toon(0xffffff, { map: grassTex }), toon(0xb27a45)]);
    plateau.scale.set(RX, 1, RZ);
    plateau.position.y = -0.5;
    plateau.receiveShadow = true;
    root.add(plateau);
    // grassy lip around the edge
    put(root, G.torus(1, 0.04), toon(0x6cc84a), { y: -0.02, sx: RX, sy: RZ, rx: -Math.PI / 2, shadow: false });

    // winding stone path
    const path = new THREE.CatmullRomCurve3([
      // (the ends stop just inside the grassy lip, so the lip doesn't cut through the path)
      new THREE.Vector3(-2.8, 0, -12.3), new THREE.Vector3(0, 0, -6), new THREE.Vector3(-1.5, 0, 0),
      new THREE.Vector3(1.5, 0, 6), new THREE.Vector3(0, 0, 12.4),
    ]);
    const pathOuter = toon(0xd9b98a), pathInner = toon(0xf3dfb5);
    for (let i = 0; i <= 140; i++) {
      const pt = path.getPoint(i / 140);
      disc(root, pathOuter, pt.x, 0.012, pt.z, 1.45, { receive: true });
      disc(root, pathInner, pt.x, 0.02, pt.z, 1.22, { receive: true });
    }
    const stones = [];
    for (let i = 0; i < 46; i++) {
      const pt = path.getPoint(i / 46);
      const tan = path.getTangent(i / 46);
      const side = i % 2 ? 1 : -1;
      stones.push({ x: pt.x - tan.z * 0.55 * side, y: 0.03, z: pt.z + tan.x * 0.55 * side, sx: 0.32, sy: 0.05, sz: 0.25, ry: i, color: i % 3 ? 0xe6cfa1 : 0xd4b98a });
    }
    scatter(root, G.lowSphere(), toon(0xffffff), stones);

    // pond with a rocky rim, lily pads and reeds
    const POND = { x: -9, z: 4.5, rx: 4.4, rz: 2.9 };
    disc(root, toon(0x5aa646), POND.x, 0.01, POND.z, 1, { sx: POND.rx + 0.5, sy: POND.rz + 0.5 });
    const pondWater = disc(root, toon(0x5cc6f2), POND.x, 0.04, POND.z, 1, { sx: POND.rx, sy: POND.rz });
    pondWater.receiveShadow = true;
    const ripples = [];
    for (let i = 0; i < 3; i++) {
      const r = put(root, G.torus(1, 0.02), toon(0xffffff, { transparent: true, opacity: 0.6 }), { x: POND.x + 1, y: 0.06, z: POND.z - 0.5, rx: -Math.PI / 2, shadow: false });
      dynamic(r);
      ripples.push(r);
    }
    anim.push((t) => ripples.forEach((r, i) => {
      const k = (t * 0.35 + i / 3) % 1;
      r.scale.set(0.3 + k * 1.6, 0.3 + k * 1.1, 1);
      r.material.opacity = 0.6 * (1 - k);
    }));
    const rim = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU;
      rim.push({ x: POND.x + Math.cos(a) * (POND.rx + 0.25), y: 0.08, z: POND.z + Math.sin(a) * (POND.rz + 0.25), s: 0.28 + ((i * 7) % 5) * 0.04, sy: 0.18, ry: i, color: i % 2 ? 0xc9c4b8 : 0xb3ada0 });
    }
    scatter(root, G.lowSphere(), toon(0xffffff), rim, true);
    for (const [lx, lz, flower] of [[-10.6, 4.2, true], [-7.8, 5.6, false], [-9.4, 6.0, true], [-6.8, 3.8, false]]) {
      disc(root, toon(0x4fae3f), lx, 0.07, lz, 0.38);
      if (flower) {
        for (let i = 0; i < 6; i++) ball(root, 0xff9ec7, lx + Math.cos(i) * 0.1, 0.14, lz + Math.sin(i) * 0.1, 0.09, { sy: 0.6 });
        ball(root, 0xffe25a, lx, 0.17, lz, 0.06);
      }
    }
    for (let i = 0; i < 9; i++) {
      const a = 2.3 + i * 0.12;
      const x = POND.x + Math.cos(a) * (POND.rx + 0.2), z = POND.z + Math.sin(a) * (POND.rz + 0.2);
      cylinder(root, 0x5a9a3a, x, 0.6, z, 0.03, 1.2 + (i % 3) * 0.2);
      put(root, G.capsule(), toon(0x8b5a2b), { x, y: 1.25 + (i % 3) * 0.2, z, sx: 0.09, sy: 0.22, sz: 0.09 });
    }

    // ducks (a mum and two ducklings) swimming around
    const ducks = [];
    for (let i = 0; i < 3; i++) {
      const s = i === 0 ? 1 : 0.6;
      const d = dynamic(group(root, 0, 0, 0, 0, s));
      ball(d, i === 0 ? 0xffffff : 0xffe46b, 0, 0.2, 0, 0.32, { sx: 1.25 });
      ball(d, i === 0 ? 0xffffff : 0xffe46b, 0.3, 0.48, 0, 0.2);
      put(d, G.sphere(), toon(0xffa22b), { x: 0.52, y: 0.45, s: 0.1, sx: 1.6, sy: 0.5 });
      ball(d, 0x222222, 0.42, 0.55, 0.12, 0.035);
      ball(d, 0x222222, 0.42, 0.55, -0.12, 0.035);
      ducks.push(d);
    }
    // Each duck swims where it likes: it picks a new direction now and then, turns
    // smoothly, steers away from the edge of the pond and from the other ducks, and
    // always faces the way it's swimming. The ducklings loosely follow their mum.
    const duckState = ducks.map((d, i) => ({
      d, x: POND.x - 1 + i * 0.9, z: POND.z + (i - 1) * 0.6, heading: i * 2.1,
      turn: 0, nextTurn: 0, speed: i === 0 ? 0.42 : 0.5, radius: i === 0 ? 0.45 : 0.28, mum: i === 0,
    }));
    const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    let lastT = null;
    anim.push((t) => {
      const dt = lastT === null ? 0 : Math.min(0.05, t - lastT);
      lastT = t;
      const mum = duckState[0];
      for (const q of duckState) {
        // pick a new wandering turn every few seconds
        q.nextTurn -= dt;
        if (q.nextTurn <= 0) {
          q.turn = (Math.random() - 0.5) * (q.mum ? 1.2 : 0.8);
          q.nextTurn = 1.5 + Math.random() * 3;
        }
        let desired = q.heading + q.turn * dt * 4;
        let pull = 0.6;
        // ducklings keep near mum (aim for a spot just behind her)
        if (!q.mum) {
          const bx = mum.x - Math.cos(mum.heading) * 0.9, bz = mum.z - Math.sin(mum.heading) * 0.9;
          if (Math.hypot(bx - q.x, bz - q.z) > 1.2) { desired = Math.atan2(bz - q.z, bx - q.x); pull = 1.6; }
        }
        // turn back before reaching the edge of the pond
        const u = (q.x - POND.x) / (POND.rx - 0.55), v = (q.z - POND.z) / (POND.rz - 0.55);
        const edge = Math.hypot(u, v);
        if (edge > 0.7) { desired = Math.atan2(POND.z - q.z, POND.x - q.x); pull = 1 + (edge - 0.7) * 10; }
        // steer away from any duck that's close
        for (const o of duckState) {
          if (o === q) continue;
          const dx = q.x - o.x, dz = q.z - o.z, dist = Math.hypot(dx, dz);
          if (dist < q.radius + o.radius + 0.5) { desired = Math.atan2(dz, dx); pull = 2.5; }
        }
        q.heading += wrapAngle(desired - q.heading) * Math.min(1, pull * dt);
        const speed = q.speed * (q.mum ? 1 : (Math.hypot(mum.x - q.x, mum.z - q.z) > 1.6 ? 1.3 : 0.9));
        q.x += Math.cos(q.heading) * speed * dt;
        q.z += Math.sin(q.heading) * speed * dt;
      }
      // never let two ducks overlap: push them apart
      for (let i = 0; i < duckState.length; i++) {
        for (let j = i + 1; j < duckState.length; j++) {
          const a = duckState[i], b = duckState[j];
          const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz) || 0.001, min = a.radius + b.radius + 0.05;
          if (dist < min) {
            const push = (min - dist) / 2;
            a.x -= (dx / dist) * push; a.z -= (dz / dist) * push;
            b.x += (dx / dist) * push; b.z += (dz / dist) * push;
          }
        }
      }
      duckState.forEach((q, i) => {
        // and never leave the water
        const u = (q.x - POND.x) / (POND.rx - 0.5), v = (q.z - POND.z) / (POND.rz - 0.5), e = Math.hypot(u, v);
        if (e > 0.95) { q.x = POND.x + (u / e) * 0.95 * (POND.rx - 0.5); q.z = POND.z + (v / e) * 0.95 * (POND.rz - 0.5); }
        q.d.position.set(q.x, 0.05 + Math.sin(t * 3 + i) * 0.02, q.z);
        q.d.rotation.y = -q.heading; // the duck's beak points along its local +x
      });
    });

    // fountain with three tiers and splashing water
    const F = { x: 6, z: -2.5 };
    const f = group(root, F.x, 0, F.z);
    cylinder(f, 0xe8e2d6, 0, 0.3, 0, 2.1, 0.6, { seg: 40 });
    put(f, G.torus(2.05, 0.18), toon(0xf4efe4), { y: 0.6, rx: Math.PI / 2 });
    disc(f, toon(0x6fd0f7), 0, 0.56, 0, 1.92);
    cylinder(f, 0xe8e2d6, 0, 1.2, 0, 0.32, 1.4);
    put(f, G.taper(1.0, 0.35), toon(0xf4efe4), { y: 1.95, sy: 0.3 });
    disc(f, toon(0x6fd0f7), 0, 2.11, 0, 0.92);
    cylinder(f, 0xe8e2d6, 0, 2.5, 0, 0.16, 0.8);
    put(f, G.taper(0.55, 0.18), toon(0xf4efe4), { y: 2.95, sy: 0.22 });
    ball(f, 0x9fe3ff, 0, 3.15, 0, 0.18);
    const drops = [];
    const dropMat = toon(0xbdeeff, { transparent: true, opacity: 0.9 });
    for (let i = 0; i < 36; i++) drops.push(put(f, G.lowSphere(), dropMat, { s: 0.07, shadow: false }));
    const splash = dynamic(group(f, 0, 0, 0));
    drops.forEach((d) => splash.add(d));
    anim.push((t) => drops.forEach((d, i) => {
      const k = (t * 0.6 + i / drops.length) % 1;
      const a = (i / drops.length) * TAU * 4;
      const tier = i % 2;
      const r = (tier ? 0.15 : 0.9) + k * (tier ? 0.75 : 1.0);
      const y0 = tier ? 3.2 : 2.15;
      d.position.set(Math.cos(a) * r, y0 + Math.sin(k * Math.PI) * 0.45 - k * (tier ? 1.05 : 1.55), Math.sin(a) * r);
    }));

    // trees: round ones, an apple tree, a cherry blossom, and palms by the shore
    const trees = [
      [-14, -7, 1.15, [0x5cc84a, 0x7fdc5c], null], [-6, -10, 1.0, [0x4fbf47, 0x79d65a], 0xff4b3a],
      [12.5, -8, 1.25, [0xff9ec7, 0xffc3dc], null], [15.5, 1, 1.0, [0x5cc84a, 0x7fdc5c], null],
      [-16.5, 3, 0.95, [0x4fbf47, 0x79d65a], null], [13, 8.5, 0.95, [0x5cc84a, 0x8ae065], 0xffa21c],
      [3, -11, 1.0, [0x5cc84a, 0x7fdc5c], null],
    ];
    trees.forEach(([x, z, s, c, fruit]) => roundTree(root, x, z, s, c, fruit));
    const palms = [[-18.5, -3, 1, 0.3], [18.2, -5, 1.1, -0.4], [-12, 11.5, 0.95, 2.2], [17, 6.5, 0.9, 3.5]];
    palms.forEach(([x, z, s, l]) => palmTree(root, x, z, s, l));

    // bushes with little flowers
    const bushes = [[-3.5, -9, 0x4fbf47, 0xff6fa5], [9, -10.5, 0x5cc84a, 0xffffff], [-15, -1, 0x4fbf47, 0xffe25a],
      [10, 4.5, 0x5cc84a, 0xff6fa5], [-4, 10.5, 0x4fbf47, 0xc39bff], [16.5, -8.5, 0x5cc84a, null]];
    bushes.forEach(([x, z, c, fl]) => bush(root, x, z, 1, c, fl));

    // flower beds: stems + colored heads, drawn as instances
    const rnd = seeded(5);
    const heads = [], stems = [], tufts = [];
    const flowerColors = [0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff, 0xff8a4c, 0x6fc3ff];
    const onPath = (x, z) => {
      for (let i = 0; i <= 40; i++) { const p = path.getPoint(i / 40); if (Math.hypot(p.x - x, p.z - z) < 1.8) return true; }
      return false;
    };
    for (let i = 0; i < 260; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd());
      const x = Math.cos(a) * d * (RX - 1.2), z = Math.sin(a) * d * (RZ - 1.2);
      if (onPath(x, z) || ((x - POND.x) / (POND.rx + 1)) ** 2 + ((z - POND.z) / (POND.rz + 1)) ** 2 < 1 || Math.hypot(x - F.x, z - F.z) < 2.6) continue;
      if (rnd() < 0.45) {
        const h = 0.25 + rnd() * 0.2;
        stems.push({ x, y: h / 2, z, sx: 0.025, sy: h, sz: 0.025 });
        heads.push({ x, y: h + 0.05, z, s: 0.1 + rnd() * 0.04, sy: 0.08, color: flowerColors[Math.floor(rnd() * flowerColors.length)] });
      } else {
        tufts.push({ x, y: 0.1, z, s: 0.12 + rnd() * 0.06, sy: 0.25, ry: rnd() * 3, color: rnd() < 0.5 ? 0x5cb83e : 0x6cc84a });
      }
    }
    scatter(root, G.cyl(6), toon(0x4f9e35), stems);
    scatter(root, G.sphere(), toon(0xffffff), heads);
    scatter(root, G.cone(5), toon(0xffffff), tufts);

    // benches, lamps, sign, picnic, swings, fence
    const benches = [{ x: -4.5, z: -3.6, ry: 0.35 }, { x: 10.5, z: 1.5, ry: -1.2 }];
    benches.forEach((b) => parkBench(root, b.x, b.z, b.ry));
    lampPost(root, -2.2, -6.5); lampPost(root, 3.6, 3.5); lampPost(root, -2.8, 9.5);

    const sign = group(root, 2.6, 0, 11.5, -0.3);
    cylinder(sign, 0x9a6a3c, -0.9, 0.7, 0, 0.08, 1.4);
    cylinder(sign, 0x9a6a3c, 0.9, 0.7, 0, 0.08, 1.4);
    const signTex = canvasTexture(256, 96, (ctx, w, h) => {
      ctx.fillStyle = "#e2a35e"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#b97a3a"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = "#5a3412"; ctx.font = "bold 46px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("Mii Park", w / 2, h / 2 + 2);
    });
    block(sign, toon(0xffffff, { map: signTex }), 0, 1.35, 0, 2.2, 0.8, 0.1, 0.04);

    // picnic blanket with a basket and snacks
    const P = { x: 9, z: 7.5 };
    const checker = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#ff5a64";
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
    }, [2, 2]);
    block(root, toon(0xffffff, { map: checker }), P.x, 0.03, P.z, 2.6, 0.04, 2.0, 0.02, { shadow: false, ry: 0.2 });
    const basket = group(root, P.x - 0.6, 0, P.z - 0.3, 0.2);
    block(basket, 0xc98b4a, 0, 0.25, 0, 0.7, 0.45, 0.5, 0.08);
    put(basket, G.torus(0.3, 0.035), toon(0xa86b32), { y: 0.5 });
    ball(root, 0xff3b3b, P.x + 0.5, 0.12, P.z + 0.2, 0.12);
    ball(root, 0x8ad43a, P.x + 0.7, 0.12, P.z - 0.1, 0.12);
    block(root, 0xf5d48e, P.x + 0.2, 0.1, P.z + 0.55, 0.4, 0.12, 0.3, 0.04);

    // swing set
    const S = { x: -12, z: -6.5, ry: 0.3 };
    const sw = group(root, S.x, 0, S.z, S.ry);
    for (const sx of [-1.4, 1.4]) {
      for (const dz of [-0.6, 0.6]) {
        const leg = cylinder(sw, 0xff7a59, sx, 1.25, dz * 0.5, 0.07, 2.6);
        leg.rotation.x = dz * 0.35;
      }
    }
    cylinder(sw, 0xff7a59, 0, 2.5, 0, 0.07, 2.9, { rz: Math.PI / 2 });
    const seats = [];
    for (const sx of [-0.6, 0.6]) {
      const seat = dynamic(group(sw, sx, 2.5, 0));
      cylinder(seat, 0x666666, -0.25, -0.9, 0, 0.015, 1.8);
      cylinder(seat, 0x666666, 0.25, -0.9, 0, 0.015, 1.8);
      block(seat, 0x4a90e2, 0, -1.8, 0, 0.6, 0.06, 0.3, 0.03);
      seats.push(seat);
    }
    anim.push((t) => seats.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.6 + i * 1.3) * 0.18; }));

    // white picket fence along the back
    const fence = [];
    for (let i = 0; i < 44; i++) {
      const a = Math.PI * 1.08 + (i / 43) * Math.PI * 0.84;
      const x = Math.cos(a) * (RX - 0.6), z = Math.sin(a) * (RZ - 0.6);
      if (Math.abs(x - path.getPoint(0).x) < 1.6) continue; // gap where the path goes
      fence.push({ x, y: 0.45, z, sx: 0.12, sy: 0.9, sz: 0.06, ry: -a });
    }
    scatter(root, G.rbox(1, 1, 1, 0.2), toon(0xffffff), fence, true);
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 40; k++) {
        const a = Math.PI * 1.08 + (k / 40) * Math.PI * 0.84;
        const a2 = Math.PI * 1.08 + ((k + 1) / 40) * Math.PI * 0.84;
        const x1 = Math.cos(a) * (RX - 0.65), z1 = Math.sin(a) * (RZ - 0.65);
        const x2 = Math.cos(a2) * (RX - 0.65), z2 = Math.sin(a2) * (RZ - 0.65);
        if (Math.abs((x1 + x2) / 2 - path.getPoint(0).x) < 1.6) continue;
        const len = Math.hypot(x2 - x1, z2 - z1);
        block(root, 0xf3f3f3, (x1 + x2) / 2, 0.35 + i * 0.35, (z1 + z2) / 2, len + 0.02, 0.07, 0.04, 0.02, { ry: -Math.atan2(z2 - z1, x2 - x1) });
      }
    }

    // ===== little islands out at sea, all the way around =====
    // Each island is a sandy beach with a grassy hump on top. Things standing
    // on the island go in its "top" group, which sits on top of the hump.
    // (Far-away things use the low-detail sphere: you can't tell from here, and
    // it's much less work for the computer.)
    const island = (x, z, s, o) => {
      o = o || {};
      const g = group(sea, x, 0, z, o.ry || 0);
      put(g, G.lowSphere(), toon(0xf5dfa4), { y: -1.4, sx: s * 1.4, sy: 1.6, sz: s, shadow: false });
      const hill = o.hill || 1;
      if (o.grass !== false) put(g, G.lowSphere(), toon(o.grassColor || 0x6cc84a), { y: -0.6, sx: s * 1.1, sy: 1.5 * hill, sz: s * 0.8, shadow: false });
      g.userData.top = group(g, 0, o.grass === false ? 0.15 : -0.6 + 1.5 * hill - 0.15, 0);
      return g;
    };
    const farTree = (p, x, z, s, colors) => {
      const t = group(p, x, 0, z, 0, s);
      cylinder(t, 0x9a6a3c, 0, 0.5, 0, 0.22, 2.6, { seg: 8, shadow: false }); // (pokes into the ground a bit, for slopes)
      put(t, G.lowSphere(), toon(colors ? colors[0] : 0x4fbf47), { y: 2.4, s: 1.2, shadow: false });
      put(t, G.lowSphere(), toon(colors ? colors[1] : 0x7fdc5c), { x: 0.4, y: 2.9, z: 0.3, s: 0.75, shadow: false });
      return t;
    };
    const farPalm = (p, x, z, s, lean) => {
      const t = group(p, x, 0, z, lean, s);
      for (let i = 0; i < 5; i++) put(t, G.taper(0.2 - i * 0.015, 0.24 - i * 0.015, 8), toon(i % 2 ? 0xb88a55 : 0xa47a48), { x: i * i * 0.04, y: 0.4 + i * 0.75, sy: 0.8, rz: -0.08 * i, shadow: false });
      const top = 4.0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        put(t, G.lowSphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: 0.65 + Math.cos(a) * 0.9, y: top, z: Math.sin(a) * 0.9, sx: 1.1, sy: 0.12, sz: 0.38, ry: -a, rz: -0.35, shadow: false });
      }
      ball(t, 0x7a5232, 0.65, top - 0.25, 0, 0.2, { shadow: false });
      return t;
    };
    const cottage = (p, x, z, ry, wallColor, roofColor, s) => {
      const h = group(p, x, 0, z, ry, s || 1);
      block(h, wallColor, 0, 0.75, 0, 1.8, 1.5, 1.5, 0.12, { shadow: false });
      put(h, G.cone(4), toon(roofColor), { y: 2.05, sx: 1.45, sy: 1.1, sz: 1.2, ry: Math.PI / 4, shadow: false });
      block(h, 0x9a6a3c, 0, 0.45, 0.76, 0.45, 0.8, 0.05, 0.03, { shadow: false });
      block(h, 0xbfe6ff, 0.55, 0.95, 0.76, 0.35, 0.35, 0.05, 0.03, { shadow: false });
      return h;
    };
    const seaRock = (p, x, z, s, sy, color) => put(p, G.lowSphere(), toon(color || 0xb8b3a8), { x, y: -0.6, z, s, sy: s * (sy || 1), ry: x, shadow: false });
    // All the islands are "painted" into ONE shape, so the whole lot is drawn in one go.
    let sea = root;
    painted(root, bakeGeo((g) => {
      sea = g;
      // (positions are [x, z]; the camera starts on the +z side looking towards -z)
      // 1. palm island (back left)
      const isl1 = island(-45, -40, 5);
      palmTree(isl1.userData.top, 0, 0, 1.6, 0.5);
      farPalm(isl1.userData.top, 2.4, 1, 1.1, 2.4);
      // 2. the lighthouse island (back right)
      const isl2 = island(52, -30, 4);
      const lh = group(isl2.userData.top, 0, -0.3, 0);
      for (let i = 0; i < 4; i++) cylinder(lh, i % 2 ? 0xff5a5a : 0xffffff, 0, 0.9 + i * 1.2, 0, 0.9 - i * 0.1, 1.2);
      ball(lh, glow(0xfff2a8, 1), 0, 6.0, 0, 0.6);
      put(lh, G.cone(), toon(0xff5a5a), { y: 6.9, s: 0.85, sy: 0.9 });
      cottage(isl2.userData.top, 2.2, 1.2, -0.4, 0xffffff, 0x4a90e2, 0.8);
      // 3. a tree-covered island
      const isl3 = island(30, -60, 6, { hill: 1.4 });
      [[-2, 0, 1.2], [1.5, 0.8, 1.0], [0.3, -1.6, 0.9], [3.2, -0.6, 0.8], [-3.6, 1.0, 0.8]].forEach(([x, z, s], i) =>
        farTree(isl3.userData.top, x, z, s, i % 2 ? [0x4fbf47, 0x8ae065] : [0x5cc84a, 0x7fdc5c]));
      // 4. a big green mountain island far behind
      const isl4 = island(-30, -118, 14, { hill: 1.2 });
      put(isl4.userData.top, G.cone(14), toon(0x5cb84a), { y: 6, sx: 10, sy: 13, sz: 8, shadow: false });
      ball(isl4.userData.top, 0x6cc84a, 0, 12.6, 0, 2.6, { sy: 0.7, shadow: false });
      put(isl4.userData.top, G.cone(12), toon(0x4fae3f), { x: 7, y: 3.6, z: 1, sx: 6, sy: 8, sz: 5, shadow: false });
      for (let i = 0; i < 9; i++) farTree(isl4.userData.top, -12 + i * 3, 4 + (i % 3) * 1.4, 1.4, i % 2 ? [0x4fbf47, 0x8ae065] : [0x3fa63a, 0x6cc84a]);
      // 5. a little village (right)
      const isl5 = island(72, 12, 8, { ry: 0.3 });
      [[-3, 0.5, 0, 0xffe4b5, 0xff6b5a], [-0.6, -1.4, 0.3, 0xffffff, 0x4a90e2], [1.6, 0.8, -0.2, 0xffd0e0, 0xff9a3a], [3.8, -0.8, 0.5, 0xd6f0ff, 0xff6b5a]]
        .forEach(([x, z, ry, wc, rc]) => cottage(isl5.userData.top, x, z, ry, wc, rc, 1.1));
      const bell = group(isl5.userData.top, -5.6, 0, -1.5); // a little bell tower
      block(bell, 0xfff6e0, 0, 2.0, 0, 1.2, 4.0, 1.2, 0.1, { shadow: false });
      put(bell, G.cone(4), toon(0x5cb85c), { y: 5.0, sx: 1.0, sy: 2.0, sz: 1.0, ry: Math.PI / 4, shadow: false });
      ball(bell, 0xffcf3a, 0, 3.3, 0.62, 0.28, { sz: 0.3, shadow: false });
      farTree(isl5.userData.top, 5.6, 1.2, 1.0); farTree(isl5.userData.top, -2, 2.4, 0.8);
      // 6. a rock arch (front right)
      const isl6 = island(48, 58, 5, { grass: false, ry: -0.6 });
      put(isl6, new THREE.TorusGeometry(3.4, 1.1, 7, 14, Math.PI), toon(0xc9b99a), { y: -0.4, shadow: false });
      seaRock(isl6, -3.4, 0.5, 1.7, 1.4, 0xc9b99a); seaRock(isl6, 3.6, -0.3, 1.5, 1.2, 0xc9b99a); seaRock(isl6, 5.6, 1.4, 0.9);
      put(isl6, G.lowSphere(), toon(0x6cc84a), { y: 3.35, sx: 1.4, sy: 0.35, sz: 1.1, shadow: false });
      // 7. a desert island with a hut (behind the camera)
      const isl7 = island(-8, 76, 5, { hill: 0.6 });
      farPalm(isl7.userData.top, -1.5, 0, 1.3, 0.2); farPalm(isl7.userData.top, 1.6, 0.6, 1.0, 3.6);
      const hut = group(isl7.userData.top, 2.4, 0, -1.6, 0.4);
      cylinder(hut, 0xd9a86a, 0, 0.6, 0, 0.9, 1.2, { seg: 10, shadow: false });
      put(hut, G.cone(10), toon(0xe6c36a), { y: 1.7, sx: 1.4, sy: 1.1, sz: 1.4, shadow: false });
      // 8. a big hilly island (front left)
      const isl8 = island(-74, 106, 12, { hill: 1.6, ry: 0.5 });
      ball(isl8.userData.top, 0x5cc84a, -4, 1.5, 0, 6, { sy: 0.55, shadow: false });
      ball(isl8.userData.top, 0x6cc84a, 4, 1.0, 1, 5, { sy: 0.5, shadow: false });
      for (let i = 0; i < 8; i++) farTree(isl8.userData.top, -9 + i * 2.5, -2 + (i % 2) * 3, 1.3, i % 2 ? [0xff9ec7, 0xffc3dc] : [0x4fbf47, 0x8ae065]);
      // 9. sea stacks with an arch (left)
      const isl9 = island(-72, 18, 6, { grass: false, ry: 1.2 });
      put(isl9, new THREE.TorusGeometry(2.6, 0.9, 7, 14, Math.PI), toon(0xb8b3a8), { y: -0.4, shadow: false });
      seaRock(isl9, -4, 1, 1.8, 2.6); seaRock(isl9, 4.5, -0.5, 1.4, 2.0); seaRock(isl9, 1.5, 3, 1.0, 1.6);
      ball(isl9, 0x6cc84a, -4, 4.1, 1, 1.5, { sy: 0.35, shadow: false });
      // 10. far-away islands, just shapes on the horizon
      for (const [x, z, s, h] of [[-128, -54, 13, 1.8], [118, -92, 15, 2.2], [140, 62, 12, 1.6], [26, 140, 16, 1.4], [-138, 74, 10, 2.0], [-92, -132, 11, 1.5]]) {
        const far = island(x, z, s, { hill: h, grassColor: 0x5cb84a });
        const fr = seeded(Math.round(Math.abs(x * 13 + z)) + 1);
        for (let i = 0; i < 5; i++) {
          farTree(far.userData.top, (fr() - 0.5) * s * 1.2, (fr() - 0.5) * s * 0.6, 1.2 + fr() * 0.8, fr() < 0.3 ? [0xff9ec7, 0xffc3dc] : [0x4fbf47, 0x7fdc5c]);
        }
      }
      // a tiny sandbar with one palm
      const sandbar = island(-82, -14, 2.6, { grass: false });
      farPalm(sandbar.userData.top, 0, 0, 0.9, 1);
    }));

    // more sailboats, further out (each one is a single "painted" shape)
    const sailboatGeo = (sail, stripe) => bakeGeo((b) => {
      block(b, 0xffffff, 0, 0.15, -0.2, 1.2, 0.6, 2.6, 0.25);
      ball(b, 0xffffff, 0, 0.15, 1.05, 0.6, { sx: 1, sy: 0.5, sz: 1.3 });
      block(b, stripe, 0, 0.32, -0.2, 1.24, 0.1, 2.62, 0.04);
      block(b, 0xd9a06a, 0, 0.47, -0.3, 1.0, 0.06, 2.2, 0.03);
      cylinder(b, 0x9a6a3c, 0, 2.2, 0.1, 0.06, 3.4, { seg: 8 });
      put(b, triangleGeo([0, 0.75, 0.05, 0, 3.75, 0.05, 0, 0.8, -1.35]), toon(sail));
      put(b, triangleGeo([0, 3.5, 0.2, 0, 0.75, 0.25, 0, 0.75, 1.35]), toon(0xffffff));
    });
    const farBoats = [
      { r: 93, speed: 0.012, start: 0.5, geo: sailboatGeo(0x6fc3ff, 0x4a90e2), s: 1.3 },
      { r: 99, speed: -0.009, start: 2.6, geo: sailboatGeo(0xff9ec7, 0xff5a64), s: 1.4 },
      { r: 99, speed: -0.009, start: 5.0, geo: sailboatGeo(0xffd166, 0x5cc84a), s: 1.2 },
    ].map((b) => Object.assign(b, { mesh: dynamic(painted(root, b.geo, { s: b.s })) }));
    anim.push((t) => farBoats.forEach((b, i) => {
      const a = b.start + t * b.speed;
      b.mesh.position.set(Math.cos(a) * b.r, -0.95 + Math.sin(t * 1.4 + i) * 0.08, Math.sin(a) * b.r);
      // face along the circle (forwards is +z of the boat)
      b.mesh.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)) + (b.speed < 0 ? Math.PI : 0), Math.sin(t * 1.2 + i) * 0.05);
    }));
    // a little sailboat circling the island (its front points along +z)
    const boat = dynamic(group(root, 0, -0.9, 0));
    block(boat, 0xffffff, 0, 0.15, -0.2, 1.2, 0.6, 2.6, 0.25);
    ball(boat, 0xffffff, 0, 0.15, 1.05, 0.6, { sx: 1, sy: 0.5, sz: 1.3 });
    block(boat, 0xff5a64, 0, 0.32, -0.2, 1.24, 0.1, 2.62, 0.04);
    block(boat, 0xd9a06a, 0, 0.47, -0.3, 1.0, 0.06, 2.2, 0.03);
    cylinder(boat, 0x9a6a3c, 0, 2.2, 0.1, 0.06, 3.4);
    const sailGeo = (pts) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      return g;
    };
    const sailMat = toon(0xffffff, { side: THREE.DoubleSide });
    put(boat, sailGeo([0, 0.75, 0.05, 0, 3.75, 0.05, 0, 0.8, -1.35]), sailMat, { x: 0.02 }); // main sail
    put(boat, sailGeo([0, 3.5, 0.2, 0, 0.75, 0.25, 0, 0.75, 1.35]), toon(0xffd166, { side: THREE.DoubleSide }), { x: 0.02 }); // front sail
    const pennant = put(boat, sailGeo([0, 3.95, 0.1, 0, 3.7, 0.1, 0, 3.82, -0.5]), toon(0xff5a64, { side: THREE.DoubleSide }), {});
    const wake = put(boat, G.circle(), toon(0xffffff, { transparent: true, opacity: 0.6 }), { y: -0.04, z: -2.2, sx: 0.7, sy: 1.6, rx: -Math.PI / 2, shadow: false });
    anim.push((t) => {
      const a = t * 0.02;
      const x = Math.cos(a) * 42, z = Math.sin(a) * 30 - 4;
      // face the way it's sailing
      const vx = -Math.sin(a) * 42, vz = Math.cos(a) * 30;
      boat.position.set(x, -0.95 + Math.sin(t * 1.5) * 0.06, z);
      boat.rotation.set(Math.sin(t * 1.1) * 0.03, Math.atan2(vx, vz), Math.sin(t * 1.3) * 0.05);
      pennant.rotation.y = Math.sin(t * 6) * 0.25;
      wake.material.opacity = 0.45 + Math.sin(t * 3) * 0.15;
    });

    // fluffy clouds in three rings (near, middle, far), drifting all the way
    // around the sky. Each ring is drawn in one go.
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
    cloudRing(root, anim, cloudMat, { count: 11, rMin: 48, rMax: 70, yMin: 17, yMax: 26, sMin: 0.8, sMax: 1.3, speed: 0.008, seed: 3 });
    cloudRing(root, anim, cloudMat, { count: 14, rMin: 90, rMax: 130, yMin: 22, yMax: 40, sMin: 1.4, sMax: 2.2, speed: 0.005, seed: 7, start: 1 });
    cloudRing(root, anim, cloudMat, { count: 12, rMin: 150, rMax: 190, yMin: 26, yMax: 52, sMin: 2.4, sMax: 3.4, speed: 0.003, seed: 11, start: 2 });

    // butterflies
    const flies = [];
    for (let i = 0; i < 5; i++) {
      const b = dynamic(group(root, 0, 0, 0));
      const color = [0xffd23f, 0xff7ab8, 0x8fd3ff, 0xffffff, 0xc39bff][i];
      const wingL = put(b, G.sphere(), toon(color, { side: THREE.DoubleSide }), { x: -0.1, s: 0.12, sy: 0.02, sz: 0.09, shadow: false });
      const wingR = put(b, G.sphere(), toon(color, { side: THREE.DoubleSide }), { x: 0.1, s: 0.12, sy: 0.02, sz: 0.09, shadow: false });
      flies.push({ b, wingL, wingR, seed: i * 1.7 });
    }
    anim.push((t) => flies.forEach((f) => {
      const a = t * 0.3 + f.seed;
      f.b.position.set(Math.sin(a * 1.3) * 12 + Math.sin(a * 3.1) * 1.5, 1.2 + Math.sin(a * 2.3) * 0.5, Math.cos(a) * 8);
      f.b.rotation.y = -a * 1.3;
      const flap = Math.sin(t * 22 + f.seed) * 0.9;
      f.wingL.rotation.z = flap; f.wingR.rotation.z = -flap;
    }));

    // seagulls
    const gulls = [];
    for (let i = 0; i < 3; i++) {
      const g = dynamic(group(root, 0, 0, 0));
      const wl = put(g, G.sphere(), toon(0xffffff), { x: -0.4, s: 0.45, sy: 0.04, sz: 0.12, shadow: false });
      const wr = put(g, G.sphere(), toon(0xffffff), { x: 0.4, s: 0.45, sy: 0.04, sz: 0.12, shadow: false });
      ball(g, 0xffffff, 0, 0, 0, 0.14, { sz: 2, shadow: false });
      gulls.push({ g, wl, wr, i });
    }
    anim.push((t) => gulls.forEach(({ g, wl, wr, i }) => {
      const a = t * 0.15 + i * 2.1;
      g.position.set(Math.cos(a) * 30, 14 + i * 2 + Math.sin(t + i) * 0.6, Math.sin(a) * 18 - 20);
      g.rotation.y = -a;
      const flap = Math.sin(t * 6 + i) * 0.5;
      wl.rotation.z = flap; wr.rotation.z = -flap;
    }));

    mergeStatic(root);

    // (very rarely, a duck family parades right across the island)
    const ducksRare = duckParade(root, (x, z) => (Math.hypot(x / RX, z / RZ) <= 1 ? 0 : Math.hypot(x / (RX + 3), z / (RZ + 3)) <= 1 ? -0.15 : -0.9));

    return {
      group: root,
      background: 0xcdeeff,
      fog: [0xd8f2ff, 80, 260],
      cameraTilt: 0.44,
      rare: ducksRare,
      bounds: { minX: -RX, maxX: RX, minZ: -RZ, maxZ: RZ },
      water: [{ x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz }, { x: 0, z: 0, rx: RX - 0.4, rz: RZ - 0.4, outside: true }],
      obstacles: [
        { x: 0, z: 0, rx: RX - 0.9, rz: RZ - 0.9, outside: true }, // the edge of the island
        { x: POND.x, z: POND.z, rx: POND.rx + 0.3, rz: POND.rz + 0.3 }, // the pond
        { x: F.x, z: F.z, r: 2.25 },
        { x: S.x, z: S.z, w: 3.3, d: 1.5, rot: -S.ry },
        { x: P.x - 0.6, z: P.z - 0.3, r: 0.5 },
        { x: 2.6, z: 11.5, w: 2.3, d: 0.4, rot: 0.3 },
        { x: -2.2, z: -6.5, r: 0.25 }, { x: 3.6, z: 3.5, r: 0.25 }, { x: -2.8, z: 9.5, r: 0.25 },
        { x: P.x, z: P.z, w: 2.7, d: 2.1, rot: -0.2 }, // picnic blanket (don't step on the food!)
      ].concat(trees.map(([x, z, s]) => ({ x, z, r: 0.55 * s })))
        .concat(palms.map(([x, z]) => ({ x, z, r: 0.5 })))
        .concat(bushes.map(([x, z]) => ({ x, z, r: 1.05 })))
        .concat(benches.map((b) => ({ x: b.x, z: b.z - 0.05, w: 2.5, d: 1.0, rot: -b.ry }))),
      spots: [
        benchSpot(benches[0], "sitting on the bench", ["Ahh, nice to sit down.", "What a lovely bench.", "I could stay here all day."]),
        benchSpot(benches[1], "resting on the bench", ["My feet needed a break.", "Nice view from here!", "*sigh* So peaceful."]),
        { x: POND.x, z: POND.z + POND.rz + 1.1, yaw: Math.PI, emoji: "🦆", activity: "watching the ducks",
          lines: ["Quack quack!", "Look at the little ducklings!", "I wish I could swim like that."] },
        { x: F.x, z: F.z + 3.0, yaw: Math.PI, emoji: "⛲", activity: "making a wish",
          lines: ["*makes a wish*", "So sparkly!", "I threw a coin in!"] },
        { x: P.x + 0.4, z: P.z + 1.75, yaw: Math.PI, emoji: "🧺", activity: "having a picnic",
          lines: ["Mmm, sandwiches!", "Picnic time!", "Who wants an apple?"] },
        { x: 12.2, z: -6.2, yaw: Math.PI * 0.8, emoji: "🌸", activity: "admiring the cherry blossoms",
          lines: ["So pretty and pink!", "Spring is the best.", "Achoo! Petals!"] },
        { x: 0, z: 12.8, yaw: Math.PI, emoji: "🌊", activity: "looking at the sea",
          lines: ["I can hear the waves.", "Is that a boat?", "Ahh, sea breeze!"] },
      ],
      lines: [
        "What a beautiful day!", "I love this island!", "Smell those flowers!",
        "Anyone want to have a picnic?", "The sun feels nice.", "Is that a butterfly?",
        "I should go jogging more.", "Let's play tag!", "La la la~", "The ocean is so blue!",
      ],
      update(t) { anim.forEach((a) => a(t)); },
    };
  }

  // A spot in front of a bench, with the seat the Mii slides onto.
  function benchSpot(b, activity, lines) {
    const fx = Math.sin(b.ry), fz = Math.cos(b.ry); // the way the bench faces
    return {
      x: b.x + fx * 1.2, z: b.z + fz * 1.2, yaw: b.ry, emoji: "🪑", activity, lines,
      seat: { x: b.x + fx * 0.08, z: b.z + fz * 0.08, y: 0.0 },
    };
  }

  // =====================================================================
  // OFFICE — a cozy, colorful workplace
  // =====================================================================
  function screenTexture(kind) {
    return canvasTexture(128, 80, (ctx, w, h) => {
      ctx.fillStyle = "#eaf6ff"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4a90e2"; ctx.fillRect(0, 0, w, 10);
      if (kind === 0) { // bar chart
        const bars = [30, 50, 38, 62, 45];
        bars.forEach((b, i) => { ctx.fillStyle = ["#ff7a59", "#ffc94a", "#5cc84a", "#4a90e2", "#b58cff"][i]; ctx.fillRect(12 + i * 22, h - 8 - b, 14, b); });
      } else if (kind === 1) { // spreadsheet
        ctx.strokeStyle = "#b9d3ea";
        for (let y = 14; y < h; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        for (let x = 0; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, h); ctx.stroke(); }
        ctx.fillStyle = "#5cc84a"; ctx.fillRect(27, 32, 25, 8);
      } else if (kind === 2) { // video call
        ctx.fillStyle = "#ffd3ad"; ctx.beginPath(); ctx.arc(40, 45, 16, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ffb669"; ctx.beginPath(); ctx.arc(90, 45, 16, 0, TAU); ctx.fill();
        ctx.fillStyle = "#333"; ctx.fillRect(34, 40, 3, 3); ctx.fillRect(43, 40, 3, 3); ctx.fillRect(84, 40, 3, 3); ctx.fillRect(93, 40, 3, 3);
      } else { // email
        for (let y = 16; y < h - 4; y += 12) {
          ctx.fillStyle = "#ffcf5a"; ctx.fillRect(6, y, 8, 8);
          ctx.fillStyle = "#9db4c9"; ctx.fillRect(18, y + 2, 60 + (y % 20), 4);
        }
      }
    });
  }

  function officeChair(p, x, z, ry, color) {
    const c = group(p, x, 0, z, ry);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      block(c, 0x3a3f4a, Math.cos(a) * 0.25, 0.07, Math.sin(a) * 0.25, 0.5, 0.05, 0.08, 0.02, { ry: -a });
      ball(c, 0x222222, Math.cos(a) * 0.48, 0.05, Math.sin(a) * 0.48, 0.05);
    }
    cylinder(c, 0x3a3f4a, 0, 0.32, 0, 0.05, 0.5);
    block(c, color, 0, 0.6, 0, 0.75, 0.14, 0.72, 0.07);
    block(c, color, 0, 1.05, -0.36, 0.72, 0.75, 0.12, 0.06);
    return c;
  }

  function deskPod(p, x, z, colors, kinds) {
    // Two tech desks side by side with a low divider. The techs sit behind the
    // desks facing the camera, so we can see their faces.
    const d = group(p, x, 0, z);
    const wood = toon(0xf0d3a8), legs = toon(0x8f96a3);
    block(d, wood, 0, 1.0, 0, 3.0, 0.1, 1.3, 0.04);
    for (const [sx, sz] of [[-1.4, -0.55], [1.4, -0.55], [-1.4, 0.55], [1.4, 0.55]]) block(d, legs, sx, 0.5, sz, 0.08, 1.0, 0.08, 0.03);
    block(d, colors[0], 0, 1.35, 0.62, 3.0, 0.6, 0.06, 0.03); // divider at the front
    // sticky notes on the divider
    for (let i = 0; i < 4; i++) block(d, [0xfff176, 0xff9ec7, 0x9fe3ff, 0xc5f08a][i], -1.2 + i * 0.75, 1.5 + (i % 2) * 0.12, 0.66, 0.16, 0.16, 0.01, 0.01, { rz: (i - 1.5) * 0.12 });
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -0.75 : 0.75;
      // two monitors each, facing the tech (towards -z)
      for (const mx of [-0.33, 0.33]) {
        block(d, 0x2f3542, sx + mx, 1.6, 0.25, 0.62, 0.42, 0.05, 0.03, { ry: mx > 0 ? -0.18 : 0.18 });
        put(d, new THREE.PlaneGeometry(0.56, 0.36), new THREE.MeshBasicMaterial({ map: screenTexture(kinds[i] + (mx > 0 ? 1 : 0)), toneMapped: false }), { x: sx + mx, y: 1.6, z: 0.222, ry: Math.PI + (mx > 0 ? -0.18 : 0.18), shadow: false });
      }
      block(d, 0x2f3542, sx, 1.2, 0.27, 0.1, 0.3, 0.1, 0.03);
      block(d, 0x2f3542, sx, 1.06, 0.27, 0.45, 0.03, 0.22, 0.02);
      block(d, 0xf4f4f4, sx, 1.07, -0.2, 0.62, 0.03, 0.2, 0.02); // keyboard
      ball(d, 0xf4f4f4, sx + 0.45, 1.08, -0.2, 0.06, { sy: 0.5, sz: 1.4 }); // mouse
      cylinder(d, colors[1], sx - 0.55, 1.15, -0.05, 0.07, 0.18); // mug
      block(d, 0x3a3f4a, sx + 0.5, 0.45, 0.3, 0.32, 0.8, 0.7, 0.04); // PC tower under the desk
      ball(d, glow(0x5cc8ff, 1), sx + 0.5, 0.75, -0.06, 0.03);
      // headset
      put(d, G.torus(0.12, 0.02), toon(0x222222), { x: sx - 0.25, y: 1.17, z: 0.05, rx: Math.PI / 2 });
      officeChair(d, sx, -1.05, 0, colors[1]);
    }
    // the classic debugging rubber duck
    ball(d, 0xffd23f, 1.25, 1.13, 0.0, 0.09, { sx: 1.2 });
    ball(d, 0xffd23f, 1.31, 1.25, 0.0, 0.06);
    ball(d, 0xff9a3a, 1.37, 1.24, 0.0, 0.025, { sx: 1.6 });
    return d;
  }

  // ---------------------------------------------------------------------
  // The sunny cartoon city around the office. The office is the top floor of
  // a tall tower; the streets are far below, and the city goes all the way
  // round, so there's something to see whichever way you spin the camera.
  // Lots of buildings, trees and cars are drawn as "copies" (InstancedMesh),
  // so the whole city only takes a handful of draw calls.
  // ---------------------------------------------------------------------
  function buildCity(root, anim) {
    const GY = -50;   // street level (the office floor is at 0)
    const R = 232;    // how far out the city goes
    const rnd = seeded(77);
    // The office lights are bright, and they light the city too, so the city's
    // colors are toned down a bit (DIM) to stop them looking washed out.
    const DIM = 0x9a9a9a;

    // ----- the office tower, going all the way down to the street -----
    const towerMat = windowMaterial({ color: 0xa9b3c4, glass: 0x3f8fd0, lit: 0xd8c070, w: 2.6, h: 4 });
    const towerH = -GY - 1.2;
    const facade = (w, x, z, ry) => put(root, new THREE.PlaneGeometry(w, towerH), towerMat, { x, y: GY + towerH / 2, z, ry, shadow: false, receive: false });
    facade(37.5, 0, 11.75, 0); facade(37.5, 0, -11.75, Math.PI);
    facade(23.5, 18.75, 0, Math.PI / 2); facade(23.5, -18.75, 0, -Math.PI / 2);
    // the edge of our floor, with a colored stripe under it
    block(root, 0xffffff, 0, -0.38, 0, 37.7, 0.72, 23.7, 0.06, { shadow: false, receive: false });
    block(root, 0x7fc4ec, 0, -0.95, 0, 37.6, 0.45, 23.6, 0.04, { shadow: false, receive: false });
    // a little roof over the tower's entrance, down at street level
    block(root, 0xff7a59, 0, GY + 4.2, 13.2, 10, 0.4, 3.2, 0.1, { shadow: false, receive: false });

    // ----- ground and streets -----
    disc(root, toon(0xa39d8c), 0, GY, 0, R + 10, { receive: false });
    const roadTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = "#d3ccbb"; ctx.fillRect(0, 0, w, h);        // pavement
      ctx.fillStyle = "#6f7890"; ctx.fillRect(0, 10, w, h - 20);  // road
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 30, w * 0.55, 4); // dashed line in the middle
    }, [1, 1]);
    const roadMat = toon(DIM, { map: roadTex });
    const ROAD_W = 9;
    // a strip lying flat on the ground from (x1, z1) to (x2, z2)
    const strip = (mat, x1, z1, x2, z2, width, y, uvLen) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const geo = new THREE.PlaneGeometry(len, width);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / uvLen);
      return put(root, geo, mat, { x: (x1 + x2) / 2, y, z: (z1 + z2) / 2, rx: -Math.PI / 2, rz: Math.atan2(z1 - z2, x2 - x1), shadow: false, receive: false });
    };
    // roads run north-south at these x's, and east-west at these z's
    const xs = [-226, -186, -146, -106, -66, -26, 26, 66, 106, 146, 186, 226];
    const zs = [-218, -178, -138, -98, -58, -18, 18, 58, 98, 138, 178, 218];
    const lines = [];
    for (const x of xs) { const h = Math.sqrt(R * R - x * x); lines.push({ along: "z", at: x, half: h }); strip(roadMat, x, -h, x, h, ROAD_W, GY + 0.12, 12); }
    for (const z of zs) { const h = Math.sqrt(R * R - z * z); lines.push({ along: "x", at: z, half: h }); strip(roadMat, -h, z, h, z, ROAD_W, GY + 0.2, 12); }

    // ----- a river with grassy banks, crossing the city behind the office -----
    const RIVER = { z: -78, w: 18 };
    const riverTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "#4cc0ee"; ctx.fillRect(0, 0, w, h);
      const r = seeded(12);
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.arc(x, y, 7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
    }, [1, 1]);
    const riverHalf = Math.sqrt(R * R - RIVER.z * RIVER.z);
    strip(toon(0x5f9c48), -riverHalf, RIVER.z, riverHalf, RIVER.z, 31, GY + 0.05, 10); // grassy banks
    strip(toon(0xb0b0b0, { map: riverTex }), -riverHalf, RIVER.z, riverHalf, RIVER.z, RIVER.w, GY + 0.09, 14);
    anim.push((t) => { riverTex.offset.x = -t * 0.02; });
    // bridges: the north-south roads cross the river, so give them railings
    for (const x of xs) {
      for (const side of [-1, 1]) block(root, 0xffffff, x + side * (ROAD_W / 2 + 0.2), GY + 0.6, RIVER.z, 0.4, 0.9, RIVER.w + 3, 0.1, { shadow: false, receive: false });
    }

    // ----- city blocks: buildings, parks and plazas -----
    const buildings = [], roofBoxes = [], pyramids = [], tanks = [], spires = [], trees = [], greens = [];
    const pastel = [0xffe2b8, 0xffc4a8, 0xbcdcff, 0xc8eab6, 0xffc8dc, 0xd6c8ff, 0xf6e7c4, 0xa9d8f0, 0xffe08a, 0xf2f2f2];
    const roofColors = [0xff6b5a, 0x4fb7c9, 0xff9a3a, 0x7a8cff, 0x5cb85c, 0xe86a9a];
    const addTree = (x, z, s) => trees.push({ x, y: GY + 1.6 * s, z, s: 1.6 * s, sy: 1.5 * s, color: rnd() < 0.2 ? 0xff9ec7 : (rnd() < 0.5 ? 0x5cc84a : 0x4fb043) });
    const parkPatch = (x0, x1, z0, z1) => {
      greens.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
      const n = Math.floor(((x1 - x0) * (z1 - z0)) / 30);
      for (let i = 0; i < n; i++) addTree(x0 + 1.5 + rnd() * (x1 - x0 - 3), z0 + 1.5 + rnd() * (z1 - z0 - 3), 0.8 + rnd() * 0.6);
    };
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const x0 = xs[i] + ROAD_W / 2 + 1, x1 = xs[i + 1] - ROAD_W / 2 - 1;
        const z0 = zs[j] + ROAD_W / 2 + 1, z1 = zs[j + 1] - ROAD_W / 2 - 1;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const dist = Math.hypot(cx, cz);
        if (dist > R - 14) continue;
        if (Math.abs(cx) < 30 && Math.abs(cz) < 30) continue;    // our own tower's block
        if (zs[j] === -98) { parkPatch(x0, x1, z0, z1); continue; } // the riverside park
        if (rnd() < 0.1) { parkPatch(x0, x1, z0, z1); continue; }   // a city park
        // split the block into 2 x 2 lots
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            const lx0 = x0 + a * (x1 - x0) / 2, lx1 = x0 + (a + 1) * (x1 - x0) / 2;
            const lz0 = z0 + b * (z1 - z0) / 2, lz1 = z0 + (b + 1) * (z1 - z0) / 2;
            const lx = (lx0 + lx1) / 2, lz = (lz0 + lz1) / 2;
            if (rnd() < 0.08) { addTree(lx - 2, lz, 1); addTree(lx + 2.5, lz + 2, 0.9); continue; } // a little square with trees
            const w = (lx1 - lx0) * (0.62 + rnd() * 0.3), d = (lz1 - lz0) * (0.62 + rnd() * 0.3);
            let h;
            if (dist < 75) h = 12 + rnd() * 24;                      // near us: lower, so we can see down to the streets
            else if (rnd() < 0.2) h = 52 + rnd() * 36;               // a skyscraper (taller than our tower!)
            else h = 14 + rnd() * 34;
            buildings.push({ x: lx, y: GY, z: lz, sx: w, sy: h, sz: d, color: pastel[Math.floor(rnd() * pastel.length)] });
            const top = GY + h;
            const roll = rnd();
            if (h > 55) {
              spires.push({ x: lx, y: top, z: lz, sx: 0.25, sy: 6 + rnd() * 6, sz: 0.25 });
              roofBoxes.push({ x: lx, y: top, z: lz, sx: w * 0.6, sy: 2.2, sz: d * 0.6, color: 0xeef2f6 });
            } else if (roll < 0.3) {
              pyramids.push({ x: lx, y: top + 2.5, z: lz, sx: w * 0.72, sy: 5, sz: d * 0.72, ry: Math.PI / 4, color: roofColors[Math.floor(rnd() * roofColors.length)] });
            } else if (roll < 0.65) {
              roofBoxes.push({ x: lx + (rnd() - 0.5) * w * 0.3, y: top, z: lz + (rnd() - 0.5) * d * 0.3, sx: w * 0.35, sy: 1.6, sz: d * 0.35, color: rnd() < 0.5 ? 0xdfe5ec : 0xc9d2dc });
              if (rnd() < 0.5) tanks.push({ x: lx - w * 0.25, y: top + 1.6, z: lz + d * 0.25, s: 1.1, sy: 3.2, color: 0xb98a5e });
            } else if (roll < 0.8) {
              greens.push({ x: lx, z: lz, w: w * 0.8, d: d * 0.8, y: top }); // a roof garden
              addTree(lx - w * 0.2, lz, 0.5); trees[trees.length - 1].y = top + 0.8;
            }
          }
        }
      }
    }
    // one box shape with its bottom at 0, so "sy" is simply the height
    const unitBox = cachedGeo("unitBox", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    farScatter(root, unitBox, windowMaterial({ color: DIM, glass: 0x5aaee6, lit: 0xe6cf72, w: 2.4, h: 3.6 }), buildings);
    // everything else that stays still (roofs, trees, parks, hills...) is baked
    // into ONE painted shape (the hills are added to it further down)
    const cityBits = [
      [unitBox, roofBoxes, 0.6], [G.cone(4), pyramids, 0.6], [G.cyl(10), tanks, 0.6], [unitBox, spires.map((q) => Object.assign(q, { color: 0x8a8e96 }))],
      [G.tinySphere(), trees, 0.6], [unitBox, greens.map((q) => ({ x: q.x, y: (q.y || GY) + 0.02, z: q.z, sx: q.w, sy: 0.12, sz: q.d, color: 0x5f9c48 }))],
    ];

    // ----- little cars driving along the streets -----
    const carGeo = bakeGeo((c) => {
      // (simple boxes: from up here you can't see any more detail)
      put(c, G.box(), toon(0xb0b0b0), { y: 0.55, sx: 1.5, sy: 0.6, sz: 2.8 });       // body (tinted per car)
      put(c, G.box(), toon(0xb0b0b0), { y: 1.05, z: -0.15, sx: 1.3, sy: 0.5, sz: 1.5 }); // roof
      put(c, G.box(), toon(0x6a90b0), { y: 1.0, z: -0.15, sx: 1.34, sy: 0.32, sz: 1.3 }); // windows
      put(c, G.box(), toon(0x222831), { y: 0.25, sx: 1.4, sy: 0.3, sz: 2.2 });       // wheels
    });
    const carColors = [0xff5a64, 0x4a90e2, 0xffcf3a, 0x5cc84a, 0xffffff, 0xff9a3a, 0xb58cff, 0x3fc6c6];
    const cars = [];
    for (let i = 0; i < 80; i++) {
      const line = lines[Math.floor(rnd() * lines.length)];
      const dir = rnd() < 0.5 ? 1 : -1;
      cars.push({ line, dir, lane: dir * 2.1, s0: rnd() * 2 * line.half, speed: 6 + rnd() * 5, color: carColors[i % carColors.length] });
    }
    const carMesh = dynamic(farScatter(root, carGeo, paintedMat, cars.map((c) => ({ x: 0, z: 0, color: c.color }))));
    const tmp = new THREE.Object3D();
    anim.push((t) => {
      cars.forEach((c, i) => {
        const L = c.line.half * 2;
        const s = ((c.s0 + c.dir * c.speed * t) % L + L) % L - c.line.half;
        const y = GY + (c.line.along === "x" ? 0.2 : 0.12);
        if (c.line.along === "z") { tmp.position.set(c.line.at + c.lane, y, s); tmp.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0); }
        else { tmp.position.set(s, y, c.line.at - c.lane); tmp.rotation.set(0, c.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0); }
        tmp.scale.setScalar(1.15);
        tmp.updateMatrix();
        carMesh.setMatrixAt(i, tmp.matrix);
      });
      carMesh.instanceMatrix.needsUpdate = true;
    });

    // ----- soft green hills all around the edge of the city -----
    const hills = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + rnd() * 0.15;
      const d = 252 + rnd() * 18;
      const s = 26 + rnd() * 22;
      hills.push({ x: Math.cos(a) * d, y: GY - 4, z: Math.sin(a) * d, sx: s * 1.6, sy: 34 + rnd() * 34, sz: s, ry: -a + Math.PI / 2, color: rnd() < 0.5 ? 0x6fae62 : 0x82bd70 });
    }
    cityBits.push([G.midSphere(), hills, 0.6]);
    painted(root, bakeCopies(cityBits));

    // ----- clouds and hot-air balloons -----
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
    cloudRing(root, anim, cloudMat, { count: 14, rMin: 85, rMax: 140, yMin: 14, yMax: 40, sMin: 1.3, sMax: 2.2, speed: 0.006, seed: 5 });
    cloudRing(root, anim, cloudMat, { count: 14, rMin: 170, rMax: 225, yMin: 25, yMax: 65, sMin: 2.4, sMax: 3.6, speed: 0.0035, seed: 9, start: 2 });
    const balloonGeo = (c1, c2) => bakeGeo((b) => {
      ball(b, c1, 0, 4.2, 0, 2.6, { sy: 1.15 });
      for (let i = 0; i < 6; i++) ball(b, i % 2 ? c1 : c2, Math.cos(i / 6 * TAU) * 1.1, 4.2, Math.sin(i / 6 * TAU) * 1.1, 1.7, { sx: 0.6, sy: 1.7, sz: 0.6 });
      put(b, G.taper(1.4, 0.5, 12), toon(c2), { y: 1.6, sy: 1.4 });
      block(b, 0xb98a5e, 0, 0.3, 0, 0.9, 0.6, 0.9, 0.12);
    });
    const balloons = [
      { mesh: dynamic(painted(root, balloonGeo(0xff6b5a, 0xffe25a), { s: 1.3 })), r: 70, y: 8, speed: 0.02, start: 2.2 },
      { mesh: dynamic(painted(root, balloonGeo(0x6fc3ff, 0xffffff), { s: 1.6 })), r: 120, y: 14, speed: -0.012, start: 4.4 },
    ];
    anim.push((t) => balloons.forEach((b, i) => {
      const a = b.start + t * b.speed;
      b.mesh.position.set(Math.cos(a) * b.r, b.y + Math.sin(t * 0.5 + i) * 1.5, Math.sin(a) * b.r);
    }));

    return { GY };
  }

  function buildOffice() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xffffff, ground: 0xd9c7a8, hemi: 0.55, sun: 0.7, ambient: 0.35, fill: 0.35 });
    // a bright blue sky and the city all around (see buildCity above)
    skyDome(root, 0x4fb0f5, 0xd8efff, 0xc4e2f2);
    buildCity(root, anim);

    // carpet tiles, like a real office
    const carpet = canvasTexture(256, 256, (ctx, w, h) => {
      const shades = ["#8e9db3", "#97a6bb", "#8796ad", "#93a2b8"];
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        ctx.fillStyle = shades[(x + y * 2) % 4];
        ctx.fillRect(x * 128, y * 128, 128, 128);
        // little carpet texture lines, turned the other way on every other tile
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        for (let k = 8; k < 128; k += 8) {
          ctx.beginPath();
          if ((x + y) % 2) { ctx.moveTo(x * 128 + k, y * 128); ctx.lineTo(x * 128 + k, y * 128 + 128); }
          else { ctx.moveTo(x * 128, y * 128 + k); ctx.lineTo(x * 128 + 128, y * 128 + k); }
          ctx.stroke();
        }
      }
      ctx.strokeStyle = "rgba(40,50,70,0.25)"; ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 128, 128); ctx.strokeRect(128, 0, 128, 128); ctx.strokeRect(0, 128, 128, 128); ctx.strokeRect(128, 128, 128, 128);
    }, [7.3, 4.5]);
    // the carpet covers the room exactly (outside is a long way down!)
    put(root, new THREE.PlaneGeometry(36.5, 22.5), toon(0xffffff, { map: carpet }), { rx: -Math.PI / 2, shadow: false });
    // welcome mat by the door
    const matTex = canvasTexture(256, 112, (ctx, w, h) => {
      ctx.fillStyle = "#4a6aa0"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 40px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("WELCOME", w / 2, h / 2 + 2);
    });
    put(root, new THREE.PlaneGeometry(3.2, 1.4), toon(0xffffff, { map: matTex }), { y: 0.02, z: 9.6, rx: -Math.PI / 2, shadow: false });

    // walls: soft blue-gray upper wall, darker panelling below, white trim.
    // Each wall is its own group so it can hide when the camera is behind it
    // (like a dollhouse), letting you spin the camera all the way around.
    // The walls have REAL windows: each wall is built in pieces around its
    // openings, with white frames and a see-through glass pane, so you can
    // look out at the city (and the Miis can too!).
    const W = { back: -11, side: 18, front: 11 };
    const WALL_H = 10;
    const backWall = group(root), leftWall = group(root), rightWall = group(root), frontWall = group(root);
    const wallC = 0xdce8f2, panelC = 0x5f7da3;
    // the glass is nearly clear, with a couple of shiny streaks
    const glassTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "rgba(200,235,255,0.08)"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath(); ctx.moveTo(w * 0.1, h); ctx.lineTo(w * 0.3, h); ctx.lineTo(w * 0.75, 0); ctx.lineTo(w * 0.55, 0); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.beginPath(); ctx.moveTo(w * 0.38, h); ctx.lineTo(w * 0.45, h); ctx.lineTo(w * 0.9, 0); ctx.lineTo(w * 0.83, 0); ctx.fill();
    });
    const glassMat = new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

    // Builds one wall.
    //   along:   the wall runs along "x" (back and front) or "z" (the sides)
    //   core:    where the middle of the wall is (it's 0.5 thick)
    //   inward:  +1 or -1, which side the room is on
    //   from/to: where the wall starts and ends
    //   openings: [{ c: middle, w: width, y0: bottom, y1: top, door: true/false }]
    function buildWall(g, along, core, inward, from, to, openings) {
      const face = core + inward * 0.25; // the inside surface of the wall
      // a box along the wall, from u0 to u1 (along it) and y0 to y1 (up),
      // centerd "d" across, "thick" thick
      const piece = (color, u0, u1, y0, y1, d, thick, r) => {
        const len = u1 - u0, h = y1 - y0;
        if (len <= 0.001 || h <= 0.001) return;
        const u = (u0 + u1) / 2, y = (y0 + y1) / 2;
        if (along === "x") block(g, color, u, y, d, len, h, thick, r);
        else block(g, color, d, y, u, thick, h, len, r);
      };
      const ops = openings.slice().sort((a, b) => a.c - b.c);
      const pad = along === "x" ? 0.5 : 0.25; // panelling stops at the corners
      const panelD = face + inward * 0.05, trimD = face + inward * 0.11;
      let u = from;
      const solid = (u0, u1) => {
        piece(wallC, u0, u1, 0, WALL_H, core, 0.5, 0.02);
        const p0 = Math.max(u0, from + pad), p1 = Math.min(u1, to - pad);
        piece(panelC, p0, p1, 0, 2.2, panelD, 0.12, 0.02);
        piece(0xffffff, p0, p1, 2.18, 2.32, trimD, 0.1, 0.03);
        piece(0xffffff, p0, p1, 0, 0.2, trimD, 0.1, 0.03);
      };
      for (const op of ops) {
        const a = op.c - op.w / 2, b = op.c + op.w / 2;
        solid(u, a);
        piece(wallC, a, b, op.y1, WALL_H, core, 0.5, 0.02); // above the opening
        if (op.door) {
          // white door frame
          piece(0xffffff, a, a + 0.2, 0, op.y1, core, 0.62, 0.03);
          piece(0xffffff, b - 0.2, b, 0, op.y1, core, 0.62, 0.03);
        } else {
          piece(wallC, a, b, 0, op.y0, core, 0.5, 0.02); // below the window
          if (op.y0 > 2.2) {
            piece(panelC, a, b, 0, 2.2, panelD, 0.12, 0.02);
            piece(0xffffff, a, b, 2.18, 2.32, trimD, 0.1, 0.03);
          } else piece(panelC, a, b, 0, op.y0, panelD, 0.12, 0.02);
          piece(0xffffff, a, b, 0, 0.2, trimD, 0.1, 0.03);
          // white frame: a deep sill to lean on, the top, the sides, and the bars across
          piece(0xffffff, a - 0.15, b + 0.15, op.y0 - 0.1, op.y0 + 0.06, face + inward * 0.12, 0.8, 0.04);
          piece(0xffffff, a - 0.15, b + 0.15, op.y1 - 0.06, op.y1 + 0.14, core + inward * 0.05, 0.62, 0.03);
          piece(0xffffff, a - 0.15, a + 0.06, op.y0, op.y1, core + inward * 0.05, 0.62, 0.03);
          piece(0xffffff, b - 0.06, b + 0.15, op.y0, op.y1, core + inward * 0.05, 0.62, 0.03);
          if (op.w > 3.5) piece(0xffffff, op.c - 0.06, op.c + 0.06, op.y0, op.y1, core, 0.16, 0.02);
          if (op.y1 - op.y0 > 4) piece(0xffffff, a, b, op.y1 - 1.46, op.y1 - 1.34, core, 0.16, 0.02);
          // the see-through glass
          put(g, new THREE.PlaneGeometry(op.w, op.y1 - op.y0), glassMat, {
            x: along === "x" ? op.c : core, y: (op.y0 + op.y1) / 2, z: along === "x" ? core : op.c,
            ry: along === "x" ? 0 : Math.PI / 2, shadow: false, receive: false,
          });
        }
        u = b;
      }
      solid(u, to);
    }
    // big windows at the back (and a high one over the server room),
    // windows each side of the front door, and windows on both side walls
    const backWindows = [{ c: -10, w: 6, y0: 1.0, y1: 8.0 }, { c: 0, w: 6, y0: 1.0, y1: 8.0 }, { c: 9.6, w: 4, y0: 4.6, y1: 8.0 }];
    const leftWindows = [{ c: 5.5, w: 6, y0: 1.0, y1: 8.0 }, { c: -7.2, w: 4.2, y0: 4.6, y1: 8.0 }];
    const rightWindows = [{ c: -5.4, w: 3.6, y0: 1.0, y1: 8.0 }];
    buildWall(backWall, "x", W.back - 0.25, 1, -18.25, 18.25, backWindows);
    buildWall(frontWall, "x", W.front + 0.25, -1, -18.25, 18.25, [{ c: 0, w: 3.0, y0: 0, y1: 5.6, door: true }, { c: -10.5, w: 6, y0: 2.6, y1: 8.0 }, { c: 10.5, w: 6, y0: 2.6, y1: 8.0 }]);
    buildWall(leftWall, "z", -W.side, 1, -11.25, 11.25, leftWindows);
    buildWall(rightWall, "z", W.side, -1, -11.25, 11.25, rightWindows);
    // the front door
    block(frontWall, 0x4a90e2, 0, 2.8, W.front + 0.2, 2.6, 5.6, 0.2, 0.08); // door
    block(frontWall, 0xbfe6ff, 0, 3.8, W.front + 0.08, 1.6, 1.4, 0.04, 0.02); // door window
    ball(frontWall, 0xffcf5a, 0.9, 2.7, W.front + 0.05, 0.12);
    block(frontWall, 0xffffff, 0, 5.75, W.front, 3.0, 0.25, 0.3, 0.05);
    // little potted plants on the low window sills
    for (const op of backWindows.slice(0, 2)) {
      cylinder(backWall, 0xffffff, op.c + 2, 1.15, W.back + 0.3, 0.16, 0.3);
      ball(backWall, 0x5cc84a, op.c + 2, 1.45, W.back + 0.3, 0.25);
    }
    cylinder(leftWall, 0xff9ec7, -W.side + 0.55, 1.15, 7.4, 0.16, 0.3);
    ball(leftWall, 0x5cc84a, -W.side + 0.55, 1.45, 7.4, 0.25);

    // posters with IT humor
    const poster = (wall, x, y, z, ry, lines, color, emoji) => {
      const tex = canvasTexture(160, 210, (ctx, w, h) => {
        ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff"; ctx.font = "bold 19px 'Nunito', sans-serif"; ctx.textAlign = "center";
        lines.forEach((t, i) => ctx.fillText(t, w / 2, 36 + i * 24));
        ctx.font = "54px sans-serif"; ctx.fillText(emoji, w / 2, 185);
      });
      const g = group(wall, x, y, z, ry);
      block(g, 0xffffff, 0, 0, 0, 1.7, 2.2, 0.06, 0.02);
      put(g, new THREE.PlaneGeometry(1.5, 2.0), toon(0xffffff, { map: tex }), { z: 0.04, shadow: false });
    };
    poster(backWall, -5, 5.2, W.back + 0.08, 0, ["HAVE YOU", "TRIED TURNING", "IT OFF AND", "ON AGAIN?"], "#ff7a59", "🔌");
    poster(backWall, 5, 5.2, W.back + 0.08, 0, ["STRONG", "PASSWORDS", "SAVE LIVES"], "#5f7da3", "🔒");
    poster(rightWall, W.side - 0.28, 5.3, 5, -Math.PI / 2, ["BACK UP", "YOUR FILES!"], "#5cb85c", "💾");

    const clock = group(backWall, 15, 6.4, W.back + 0.1);
    cylinder(clock, 0xffffff, 0, 0, 0, 0.8, 0.1, { rx: Math.PI / 2 });
    put(clock, G.torus(0.8, 0.08), toon(0x4a90e2), {});
    const hourHand = dynamic(group(clock, 0, 0, 0.08));
    const minHand = dynamic(group(clock, 0, 0, 0.1));
    block(hourHand, 0x333333, 0, 0.22, 0, 0.07, 0.45, 0.02, 0.02);
    block(minHand, 0x333333, 0, 0.32, 0, 0.05, 0.65, 0.02, 0.02);
    anim.push(() => {
      const now = new Date();
      hourHand.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU;
      minHand.rotation.z = -(now.getMinutes() + now.getSeconds() / 60) / 60 * TAU;
    });

    // ceiling lights over the desks
    for (const x of [-8, 0, 8]) {
      cylinder(root, 0x444444, x, 9.4, -4.5, 0.015, 3.0, { shadow: false });
      block(root, 0xeef2f6, x, 7.9, -4.5, 2.4, 0.12, 0.6, 0.05, { shadow: false });
      block(root, glow(0xfffbe8, 1), x, 7.83, -4.5, 2.2, 0.03, 0.45, 0.01, { shadow: false });
    }

    // ===== tech desks =====
    const pods = [
      { x: -8, z: -4.5, colors: [0x7cc6e8, 0xff7a59], kinds: [0, 1] },
      { x: 0, z: -4.5, colors: [0xffcf5a, 0x5cc84a], kinds: [2, 3] },
      { x: 8, z: -4.5, colors: [0xb58cff, 0x4a90e2], kinds: [1, 0] },
    ];
    pods.forEach((p) => deskPod(root, p.x, p.z, p.colors, p.kinds));

    // ===== the help desk (front left) =====
    const H = { x: -11.5, z: 3.2 };
    const desk = group(root, H.x, 0, H.z);
    block(desk, 0x4a90e2, 0, 0.55, 0, 6.2, 1.1, 0.9, 0.08);
    block(desk, 0xffffff, 0, 1.15, 0.05, 6.4, 0.1, 1.1, 0.04);
    block(desk, 0x3a78c8, 0, 0.55, 0.47, 6.2, 0.9, 0.02, 0.01, { shadow: false });
    const deskSign = canvasTexture(256, 48, (ctx, w, h) => {
      ctx.fillStyle = "#3a78c8"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff"; ctx.font = "bold 28px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("IT SUPPORT", w / 2, h / 2 + 1);
    });
    put(desk, new THREE.PlaneGeometry(2.6, 0.5), toon(0xffffff, { map: deskSign }), { y: 0.62, z: 0.5, shadow: false });
    for (const sx of [-1.4, 1.4]) {
      block(desk, 0x2f3542, sx, 1.55, -0.1, 0.8, 0.5, 0.05, 0.03);                       // monitor (faces the agent)
      put(desk, new THREE.PlaneGeometry(0.72, 0.42), new THREE.MeshBasicMaterial({ map: screenTexture(3), toneMapped: false }), { x: sx, y: 1.55, z: -0.13, ry: Math.PI, shadow: false });
      block(desk, 0x2f3542, sx, 1.25, -0.08, 0.1, 0.25, 0.1, 0.03);
      block(desk, 0xf4f4f4, sx, 1.22, -0.35, 0.6, 0.03, 0.2, 0.02);
      officeChair(desk, sx, -1.15, 0, 0x3a78c8);
    }
    // service bell, ticket dispenser and a jar of free stickers on the counter
    cylinder(desk, 0xd9d9d9, 0, 1.22, 0.25, 0.14, 0.04);
    ball(desk, 0xffcf5a, 0, 1.25, 0.25, 0.11, { sy: 0.8 });
    block(desk, 0xff5a64, 2.8, 1.45, 0.3, 0.35, 0.5, 0.25, 0.08);
    block(desk, 0xffffff, 2.8, 1.33, 0.44, 0.2, 0.08, 0.02, 0.01);
    cylinder(desk, toon(0xcfeaff, { transparent: true, opacity: 0.55 }), -2.7, 1.38, 0.25, 0.16, 0.36);
    for (let i = 0; i < 5; i++) ball(desk, [0xff6fa5, 0x5cc84a, 0xffcf5a, 0x4a90e2, 0xb58cff][i], -2.7 + Math.cos(i) * 0.07, 1.28 + (i % 2) * 0.08, 0.25 + Math.sin(i) * 0.07, 0.05);
    // big hanging sign
    const bigSign = canvasTexture(512, 112, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#3a78c8"; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
      ctx.fillStyle = "#24283b"; ctx.font = "bold 58px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🛠 IT HELP DESK", w / 2, h / 2 + 2);
    });
    const hang = group(root, H.x, 0, H.z + 0.1);
    for (const sx of [-1.4, 1.4]) cylinder(hang, 0x666666, sx, 6.7, 0, 0.012, 2.6, { shadow: false });
    block(hang, 0xffffff, 0, 5.1, 0, 3.7, 0.85, 0.1, 0.05);
    put(hang, new THREE.PlaneGeometry(3.5, 0.76), toon(0xffffff, { map: bigSign }), { y: 5.1, z: 0.06, shadow: false });
    // "Now serving" number display that counts up
    let serving = 41;
    const servingCanvas = document.createElement("canvas");
    servingCanvas.width = 256; servingCanvas.height = 96;
    const servingTex = new THREE.CanvasTexture(servingCanvas);
    servingTex.encoding = THREE.sRGBEncoding;
    const drawServing = (flash) => {
      const ctx = servingCanvas.getContext("2d");
      ctx.fillStyle = flash ? "#3a2a00" : "#111418"; ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = "#9aa3b5"; ctx.font = "bold 20px 'Nunito', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("NOW SERVING", 128, 26);
      ctx.fillStyle = "#ffcf3a"; ctx.font = "bold 52px monospace";
      ctx.fillText(String(serving).padStart(3, "0"), 128, 80);
      servingTex.needsUpdate = true;
    };
    drawServing(false);
    const servingBox = group(root, H.x + 4.2, 0, H.z - 0.2);
    cylinder(servingBox, 0x666666, 0, 1.5, 0, 0.05, 3.0);
    block(servingBox, 0x2f3542, 0, 3.4, 0, 1.6, 0.7, 0.18, 0.06);
    put(servingBox, new THREE.PlaneGeometry(1.45, 0.56), new THREE.MeshBasicMaterial({ map: servingTex, toneMapped: false }), { y: 3.4, z: 0.1, shadow: false });
    let nextNumber = 14;
    anim.push((t) => {
      if (t > nextNumber) {
        serving = serving >= 999 ? 1 : serving + 1;
        nextNumber = t + 15 + Math.random() * 15;
        drawServing(true);
        setTimeout(() => drawServing(false), 600);
      }
    });
    // waiting area: a row of chairs, a little table and a plant
    const WA = { x: -12.5, z: 7.6 };
    const waiting = group(root, WA.x, 0, WA.z, Math.PI);
    block(waiting, 0x8f96a3, 0, 0.3, 0, 4.8, 0.08, 0.5, 0.02);
    for (let i = 0; i < 4; i++) {
      const cx = -1.8 + i * 1.2;
      block(waiting, 0xff7a59, cx, 0.6, 0, 1.0, 0.14, 0.75, 0.06);
      block(waiting, 0xff7a59, cx, 1.05, -0.38, 1.0, 0.8, 0.12, 0.06);
      block(waiting, 0x8f96a3, cx, 0.3, 0, 0.08, 0.6, 0.08, 0.02);
    }
    const magTable = group(root, WA.x + 3.5, 0, WA.z);
    cylinder(magTable, 0xf0d3a8, 0, 0.55, 0, 0.55, 0.08);
    cylinder(magTable, 0x8f96a3, 0, 0.28, 0, 0.06, 0.55);
    block(magTable, 0xff5a64, -0.1, 0.61, 0.05, 0.42, 0.03, 0.3, 0.01, { ry: 0.4 });
    block(magTable, 0x4a90e2, 0.1, 0.64, -0.05, 0.42, 0.03, 0.3, 0.01, { ry: -0.2 });

    // ===== server room (back right) =====
    const SR = { x: 12.8, z: -8.6 };
    block(root, 0xcfd6df, SR.x, 0.06, SR.z + 0.4, 8.2, 0.12, 4.6, 0.02); // raised floor
    const tile = canvasTexture(64, 64, (ctx) => { ctx.fillStyle = "#cfd6df"; ctx.fillRect(0, 0, 64, 64); ctx.strokeStyle = "#a9b3c0"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, 64, 64); ctx.fillStyle = "#b7c0cc"; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ctx.fillRect(10 + i * 12, 10 + j * 12, 4, 4); }, [8, 4]);
    put(root, new THREE.PlaneGeometry(8.2, 4.6), toon(0xffffff, { map: tile }), { x: SR.x, y: 0.125, z: SR.z + 0.4, rx: -Math.PI / 2, shadow: false });
    const rackFront = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = "#1f242c"; ctx.fillRect(0, 0, w, h);
      for (let y = 8; y < h - 8; y += 20) {
        ctx.fillStyle = y % 60 === 8 ? "#3a4250" : "#2c333e"; ctx.fillRect(8, y, w - 16, 16);
        ctx.fillStyle = "#151920"; for (let x = 40; x < w - 14; x += 6) ctx.fillRect(x, y + 4, 3, 8);
      }
    });
    const ledSpots = [];
    for (let i = 0; i < 4; i++) {
      const rx = SR.x - 2.7 + i * 1.8;
      const rack = group(root, rx, 0.12, SR.z);
      block(rack, 0x2a2f38, 0, 1.7, 0, 1.2, 3.4, 1.2, 0.04);
      put(rack, new THREE.PlaneGeometry(1.0, 3.1), toon(0xffffff, { map: rackFront }), { y: 1.7, z: 0.61, shadow: false });
      block(rack, 0x8f96a3, 0, 3.45, 0, 1.25, 0.08, 1.25, 0.02);
      for (let k = 0; k < 14; k++) ledSpots.push({ x: rx - 0.4 + (k % 2) * 0.08, y: 0.4 + Math.floor(k / 2) * 0.42 + 0.12, z: SR.z + 0.63 });
    }
    // blinking lights on the servers (one shape drawn many times, colors change)
    const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), ledSpots.length);
    const tmpO = new THREE.Object3D();
    const ledColors = [new THREE.Color(0x3cff6e), new THREE.Color(0xffb02e), new THREE.Color(0x4ab8ff)];
    const ledOff = new THREE.Color(0x1d3a24);
    ledSpots.forEach((q, i) => { tmpO.position.set(q.x, q.y, q.z); tmpO.updateMatrix(); leds.setMatrixAt(i, tmpO.matrix); leds.setColorAt(i, ledColors[i % 3]); });
    root.add(dynamic(leds));
    let ledTimer = 0;
    anim.push((t) => {
      if (t < ledTimer) return;
      ledTimer = t + 0.12;
      for (let i = 0; i < ledSpots.length; i++) if (Math.random() < 0.3) leds.setColorAt(i, Math.random() < 0.6 ? ledColors[i % 3] : ledOff);
      leds.instanceColor.needsUpdate = true;
    });
    // cable tray over the racks, an air conditioner, and a fire extinguisher
    block(root, 0xffcf3a, SR.x, 3.95, SR.z, 7.4, 0.1, 0.6, 0.02);
    for (let i = 0; i < 6; i++) cylinder(root, [0x4a90e2, 0xff5a64, 0x5cc84a, 0xffcf3a, 0xb58cff, 0xffffff][i], SR.x, 4.05, SR.z - 0.2 + i * 0.08, 0.03, 7.2, { rz: Math.PI / 2, shadow: false });
    block(root, 0xf2f4f7, SR.x + 4.1, 1.2, SR.z, 0.9, 2.4, 1.0, 0.1);
    for (let i = 0; i < 5; i++) block(root, 0xc9d2dc, SR.x + 4.1, 1.5 + i * 0.18, SR.z + 0.51, 0.8, 0.06, 0.02, 0.01);
    cylinder(root, 0xe23b3b, SR.x - 3.7, 0.45, SR.z - 0.9, 0.16, 0.75);
    cylinder(root, 0x222222, SR.x - 3.7, 0.9, SR.z - 0.9, 0.05, 0.15);
    const srSign = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.fillStyle = "#24283b"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#7fe0ff"; ctx.font = "bold 32px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("SERVER ROOM", w / 2, h / 2 + 1);
    });
    put(backWall, new THREE.PlaneGeometry(2.6, 0.65), toon(0xffffff, { map: srSign }), { x: 13.8, y: 8.4, z: W.back + 0.05, shadow: false });

    // ===== repair bench (right wall) =====
    const RB = { x: 16.2, z: -0.5 };
    const bench = group(root, RB.x, 0, RB.z, -Math.PI / 2);
    block(bench, 0xb98a5e, 0, 1.0, 0, 5.0, 0.12, 1.3, 0.04);
    for (const sx of [-2.3, 2.3]) block(bench, 0x8f96a3, sx, 0.5, 0, 0.12, 1.0, 1.1, 0.03);
    block(bench, 0x8f96a3, 0, 0.35, 0.2, 4.6, 0.06, 0.9, 0.02); // shelf underneath
    block(bench, 0x2e8b57, 0, 1.07, 0, 3.6, 0.02, 1.0, 0.01, { shadow: false }); // anti-static mat
    // an opened-up PC
    const pc = group(bench, -1.2, 1.08, 0);
    block(pc, 0x3a3f4a, 0, 0.45, 0, 0.5, 0.9, 1.0, 0.04);
    block(pc, 0x1f7a4a, 0.26, 0.45, 0, 0.02, 0.75, 0.85, 0.01);
    ball(pc, 0x666666, 0.28, 0.6, 0.15, 0.12, { sx: 0.2 });
    block(pc, 0x5cc84a, 0.28, 0.3, -0.2, 0.03, 0.08, 0.35, 0.01);
    block(pc, 0x5cc84a, 0.28, 0.38, -0.2, 0.03, 0.08, 0.35, 0.01);
    // a laptop
    const lap = group(bench, 0.6, 1.08, 0.1);
    block(lap, 0xc9d2dc, 0, 0.02, 0, 0.8, 0.04, 0.55, 0.02);
    block(lap, 0xc9d2dc, 0, 0.3, -0.27, 0.8, 0.55, 0.03, 0.02, { rx: -0.25 });
    put(lap, new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ map: screenTexture(1), toneMapped: false }), { y: 0.3, z: -0.25, rx: -0.25, shadow: false });
    // toolbox and screwdrivers
    block(bench, 0xe23b3b, 1.7, 1.25, -0.2, 0.7, 0.35, 0.35, 0.05);
    for (let i = 0; i < 3; i++) {
      cylinder(bench, [0xffcf3a, 0xff5a64, 0x4a90e2][i], 1.4 + i * 0.15, 1.1, 0.35, 0.03, 0.18, { rx: Math.PI / 2 });
      cylinder(bench, 0xbbbbbb, 1.4 + i * 0.15, 1.1, 0.53, 0.012, 0.2, { rx: Math.PI / 2 });
    }
    // magnifying lamp
    cylinder(bench, 0x666666, -2.2, 1.6, -0.4, 0.03, 1.0);
    put(bench, G.torus(0.18, 0.03), toon(0x666666), { x: -2.0, y: 2.1, z: -0.2, rx: 1.0 });
    // pegboard with tools on the wall
    const peg = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = "#e4c9a0"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#c7a97d"; for (let y = 8; y < h; y += 14) for (let x = 8; x < w; x += 14) ctx.fillRect(x, y, 3, 3);
      ctx.fillStyle = "#e23b3b"; ctx.fillRect(30, 30, 10, 60); ctx.fillStyle = "#666"; ctx.fillRect(26, 22, 18, 12);
      ctx.fillStyle = "#4a90e2"; ctx.fillRect(70, 40, 40, 8); ctx.fillRect(70, 40, 8, 40);
      ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(160, 64, 22, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.fillRect(210, 25, 8, 70); ctx.fillRect(225, 25, 8, 55);
    });
    put(rightWall, new THREE.PlaneGeometry(4.6, 2.3), toon(0xffffff, { map: peg }), { x: W.side - 0.26, y: 3.4, z: RB.z, ry: -Math.PI / 2, shadow: false });

    // ===== spare parts shelving (left wall, back) =====
    const shelfX = -16.9;
    const parts = [];
    const pr2 = seeded(21);
    for (const sz of [-8.6, -6.2]) {
      const sh = group(root, shelfX, 0, sz, Math.PI / 2);
      for (const sx of [-1.1, 1.1]) for (const dz of [-0.35, 0.35]) block(sh, 0x8f96a3, sx, 1.9, dz, 0.07, 3.8, 0.07, 0.02);
      for (let row = 0; row < 4; row++) {
        block(sh, 0xb8c2cf, 0, 0.25 + row * 1.1, 0, 2.3, 0.06, 0.8, 0.02);
        // boxes and bins on each shelf
        let bx = -1.0;
        while (bx < 0.9) {
          const bw = 0.28 + pr2() * 0.3, bh = 0.3 + pr2() * 0.4;
          const wx = shelfX + 0.0, wz = sz + bx + bw / 2; // the shelf is turned to face +x
          parts.push({ x: wx + (pr2() - 0.5) * 0.1, y: 0.28 + row * 1.1 + bh / 2, z: wz, sx: 0.55, sy: bh, sz: bw, color: [0xc9a46a, 0x4a90e2, 0xff7a59, 0x5cc84a, 0xffcf3a, 0xd8b98a][Math.floor(pr2() * 6)] });
          bx += bw + 0.06;
        }
      }
    }
    scatter(root, G.box(), toon(0xffffff), parts, true);
    // boxes of new laptops stacked on the floor, and a rolling cart of monitors
    for (let i = 0; i < 4; i++) block(root, 0xc9a46a, -15.6 + (i % 2) * 0.05, 0.3 + i * 0.5, -3.8 + (i % 2) * 0.08, 1.0, 0.48, 0.75, 0.04, { ry: i * 0.1 });
    const cart = group(root, -12.6, 0, -8.6, 0.3);
    block(cart, 0x8f96a3, 0, 0.5, 0, 1.6, 0.06, 0.9, 0.02);
    block(cart, 0x8f96a3, 0, 1.1, 0, 1.6, 0.06, 0.9, 0.02);
    for (const [sx, sz] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]]) {
      block(cart, 0x8f96a3, sx, 0.65, sz, 0.05, 1.1, 0.05, 0.01);
      ball(cart, 0x222222, sx, 0.08, sz, 0.08);
    }
    for (let i = 0; i < 3; i++) block(cart, 0x2f3542, -0.4 + i * 0.4, 1.45, 0, 0.12, 0.6, 0.8, 0.03);

    // ===== ticket dashboard TV (left wall) =====
    const dashCanvas = document.createElement("canvas");
    dashCanvas.width = 384; dashCanvas.height = 216;
    const dashTex = new THREE.CanvasTexture(dashCanvas);
    dashTex.encoding = THREE.sRGBEncoding;
    let openTickets = 12, solved = 37;
    const drawDash = () => {
      const ctx = dashCanvas.getContext("2d");
      ctx.fillStyle = "#14213d"; ctx.fillRect(0, 0, 384, 216);
      ctx.fillStyle = "#7fe0ff"; ctx.font = "bold 22px 'Nunito', sans-serif"; ctx.fillText("TICKET DASHBOARD", 16, 32);
      ctx.fillStyle = "#ffcf3a"; ctx.font = "bold 40px 'Nunito', sans-serif"; ctx.fillText(String(openTickets), 20, 88);
      ctx.fillStyle = "#5cff8a"; ctx.fillText(String(solved), 200, 88);
      ctx.fillStyle = "#9aa3b5"; ctx.font = "bold 16px 'Nunito', sans-serif"; ctx.fillText("OPEN", 22, 108); ctx.fillText("SOLVED TODAY", 202, 108);
      const bars = [0.4, 0.6, 0.35, 0.8, 0.55, 0.7, Math.min(1, solved / 60)];
      bars.forEach((b, i) => { ctx.fillStyle = i === bars.length - 1 ? "#5cff8a" : "#4a90e2"; ctx.fillRect(22 + i * 48, 200 - b * 70, 32, b * 70); });
      dashTex.needsUpdate = true;
    };
    drawDash();
    const tv = group(leftWall, -W.side + 0.35, 4.6, -0.8, Math.PI / 2);
    block(tv, 0x1a1d24, 0, 0, 0, 4.2, 2.45, 0.12, 0.05);
    put(tv, new THREE.PlaneGeometry(4.0, 2.25), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }), { z: 0.07, shadow: false });
    let dashNext = 6;
    anim.push((t) => {
      if (t < dashNext) return;
      dashNext = t + 6;
      if (Math.random() < 0.6 && openTickets > 0) { openTickets--; solved++; } else openTickets++;
      drawDash();
    });

    // rolling whiteboard with a network diagram
    const wbTex = canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#4a90e2"; ctx.lineWidth = 3;
      const boxes = [[110, 18, "ROUTER"], [30, 80, "PCs"], [190, 80, "WiFi"], [110, 120, "SERVER"]];
      for (const [x, y] of boxes.slice(1)) { ctx.beginPath(); ctx.moveTo(140, 40); ctx.lineTo(x + 30, y); ctx.stroke(); }
      ctx.font = "bold 14px 'Nunito', sans-serif"; ctx.textAlign = "center";
      for (const [x, y, label] of boxes) { ctx.strokeStyle = "#24283b"; ctx.strokeRect(x, y, 60, 24); ctx.fillStyle = "#24283b"; ctx.fillText(label, x + 30, y + 17); }
      ctx.fillStyle = "#e2445c"; ctx.font = "bold 16px 'Nunito', sans-serif"; ctx.fillText("Ticket #404 ?!", 60, 150);
    });
    const wb = group(root, -4.2, 0, 1.0, 0.15);
    for (const sx of [-1.2, 1.2]) { block(wb, 0x8f96a3, sx, 1.4, 0, 0.08, 2.8, 0.08, 0.02); ball(wb, 0x222222, sx, 0.08, 0, 0.08); block(wb, 0x8f96a3, sx, 0.15, 0, 0.08, 0.06, 0.8, 0.02); }
    block(wb, 0xd0d6de, 0, 2.0, 0, 2.5, 1.6, 0.06, 0.03);
    put(wb, new THREE.PlaneGeometry(2.36, 1.48), toon(0xffffff, { map: wbTex }), { y: 2.0, z: 0.035, shadow: false });

    // printer (out of order, of course), e-waste and recycling bins
    const pr = group(root, 4, 0, W.back + 1.0);
    block(pr, 0xd9dde3, 0, 0.5, 0, 1.4, 1.0, 1.0, 0.08);
    block(pr, 0xeef0f3, 0, 1.15, 0, 1.3, 0.3, 0.9, 0.06);
    block(pr, 0xffffff, 0, 1.33, 0.1, 0.7, 0.04, 0.5, 0.01);
    ball(pr, toon(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 1 }), 0.5, 1.15, 0.46, 0.05);
    const oooTex = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = "#fffbe8"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e2445c"; ctx.font = "bold 20px 'Nunito', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("OUT OF", w / 2, 26); ctx.fillText("ORDER :(", w / 2, 50);
    });
    put(pr, new THREE.PlaneGeometry(0.6, 0.3), toon(0xffffff, { map: oooTex }), { y: 0.75, z: 0.51, rz: 0.06, shadow: false });
    dynamic(pr); // (it can come to life: see printerFrenzy)
    const printerRare = printerFrenzy(root, pr);
    const bin = (x, z, color, label) => {
      const b = group(root, x, 0, z);
      block(b, color, 0, 0.5, 0, 0.7, 1.0, 0.7, 0.08);
      block(b, 0x24283b, 0, 1.02, 0, 0.72, 0.06, 0.72, 0.03);
      const lt = canvasTexture(96, 40, (ctx, w, h) => { ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, w / 2, h / 2); });
      put(b, new THREE.PlaneGeometry(0.6, 0.25), toon(0xffffff, { map: lt, transparent: true }), { y: 0.7, z: 0.36, shadow: false });
    };
    bin(5.6, W.back + 0.9, 0x5cb85c, "E-WASTE");
    bin(6.5, W.back + 0.9, 0x4a90e2, "RECYCLE");

    // ===== break area (front right): coffee, water, vending machine, a little table =====
    const K = { x: 11.5, z: 8.8 };
    block(root, 0xffffff, K.x, 0.55, K.z, 3.6, 1.1, 1.0, 0.06);
    block(root, 0xf0d3a8, K.x, 1.15, K.z, 3.7, 0.1, 1.1, 0.03);
    const coffee = group(root, K.x - 0.9, 1.2, K.z);
    block(coffee, 0x3a3f4a, 0, 0.4, 0, 0.6, 0.8, 0.5, 0.06);
    ball(coffee, glow(0x5cff8a, 1), 0.2, 0.65, -0.26, 0.04);
    cylinder(coffee, 0xffffff, 0, 0.1, -0.15, 0.08, 0.18);
    const steam = [];
    for (let i = 0; i < 4; i++) steam.push(dynamic(ball(coffee, toon(0xffffff, { transparent: true, opacity: 0.6 }), 0, 0.3, -0.15, 0.08, { shadow: false })));
    anim.push((t) => steam.forEach((s, i) => {
      const k = (t * 0.5 + i / 4) % 1;
      s.position.set(Math.sin(t * 2 + i) * 0.05, 0.25 + k * 0.6, -0.15);
      s.scale.setScalar(0.06 + k * 0.08);
      s.material.opacity = 0.6 * (1 - k);
    }));
    block(root, 0xeeeeee, K.x + 0.6, 1.45, K.z, 0.8, 0.5, 0.5, 0.06); // microwave
    block(root, 0x222222, K.x + 0.5, 1.45, K.z - 0.26, 0.5, 0.35, 0.02, 0.02);
    const cooler = group(root, K.x + 2.6, 0, K.z + 0.1);
    block(cooler, 0xf2f4f7, 0, 0.75, 0, 0.8, 1.5, 0.8, 0.12);
    cylinder(cooler, toon(0x8fd8ff, { transparent: true, opacity: 0.8 }), 0, 1.95, 0, 0.36, 0.9);
    block(cooler, 0x4a90e2, 0, 1.15, -0.42, 0.18, 0.1, 0.08, 0.02);
    const vend = group(root, 16.8, 0, 6.2, -Math.PI / 2);
    block(vend, 0xff5a64, 0, 1.6, 0, 1.8, 3.2, 1.0, 0.1);
    const vendTex = canvasTexture(128, 160, (ctx, w, h) => {
      ctx.fillStyle = "#dff4ff"; ctx.fillRect(0, 0, w, h);
      const cols = ["#ff5a64", "#ffcf5a", "#5cc84a", "#4a90e2", "#b58cff"];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { ctx.fillStyle = cols[(r + c) % 5]; ctx.fillRect(10 + c * 28, 10 + r * 36, 18, 26); }
    });
    put(vend, new THREE.PlaneGeometry(1.1, 1.9), new THREE.MeshBasicMaterial({ map: vendTex, toneMapped: false }), { x: -0.2, y: 2.0, z: 0.51, shadow: false });
    const cafe = group(root, 9.2, 0, 5.2);
    cylinder(cafe, 0xffffff, 0, 1.0, 0, 0.6, 0.06);
    cylinder(cafe, 0x8f96a3, 0, 0.5, 0, 0.05, 1.0);
    cylinder(cafe, 0x8f96a3, 0, 0.03, 0, 0.35, 0.05);
    cylinder(cafe, 0xff7a59, 0.15, 1.08, 0.1, 0.07, 0.14);

    // plants in the corners
    const plantAt = (x, z, s) => {
      const pl = group(root, x, 0, z, 0, s);
      cylinder(pl, 0xffffff, 0, 0.45, 0, 0.45, 0.9);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        put(pl, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: Math.cos(a) * 0.4, y: 1.7 + (i % 3) * 0.3, z: Math.sin(a) * 0.4, sx: 0.22, sy: 0.85, sz: 0.22, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
      }
    };
    plantAt(-16.6, 9.6, 1); plantAt(-7.6, 8.6, 0.8); plantAt(16.6, 9.8, 0.9); plantAt(-3.4, -9.9, 0.8);

    const walls = [
      { group: backWall, axis: "z", at: W.back, outside: -1 },
      { group: frontWall, axis: "z", at: W.front, outside: 1 },
      { group: leftWall, axis: "x", at: -W.side, outside: -1 },
      { group: rightWall, axis: "x", at: W.side, outside: 1 },
    ];
    for (const w of walls) {
      // the clock hands and screens change, so they're kept out of the merge
      mergeStatic(w.group);
      dynamic(w.group);
    }
    mergeStatic(root);

    const deskSpots = [];
    pods.forEach((p, pi) => {
      for (let i = 0; i < 2; i++) {
        const sx = p.x + (i === 0 ? -0.75 : 0.75), sz = p.z - 1.05;
        deskSpots.push({
          x: sx, z: sz - 1.2, yaw: 0, arms: "type", emoji: ["🎧", "💻", "🖥️", "📞", "⌨️", "🐛"][pi * 2 + i], activity: "working on tickets",
          seat: { x: sx, z: sz + 0.05, y: 0.0 },
          lines: [["*click clack*", "Ticket closed! Next!", "Who wrote this code?!"],
            ["Have you tried restarting it?", "Please hold...", "I'll escalate that ticket."],
            ["Talking to the rubber duck...", "Found the bug!", "It works on my machine!"]][(pi + i) % 3],
        });
      }
    });
    const agentSpots = [-1.4, 1.4].map((sx) => ({
      x: H.x + sx, z: H.z - 2.4, yaw: 0, arms: "type", emoji: "🛠️", activity: "staffing the help desk",
      seat: { x: H.x + sx, z: H.z - 1.15, y: 0.0 },
      lines: ["IT help desk, how can I help?", "Have you tried turning it off and on again?", "Next please!", "Is it plugged in?"],
    }));
    const waitSeats = [-1.8, -0.6, 0.6, 1.8].map((cx, i) => ({
      x: WA.x - cx, z: WA.z + 1.35, yaw: Math.PI, emoji: "🎫", activity: "waiting for help",
      seat: { x: WA.x - cx, z: WA.z - 0.05, y: 0.0 },
      lines: ["How long is the wait?", "My laptop makes a weird noise...", "*checks phone*", "I hope they can fix it."],
    }));

    return {
      group: root,
      background: 0xd8efff,
      fog: [0xd8efff, 90, 340],
      cameraTilt: 0.5,
      rare: printerRare, // the printer goes haywire
      bounds: { minX: -17, maxX: 17, minZ: -10.4, maxZ: 10 },
      water: [],
      // each desk pod's zone also covers the chairs behind it
      obstacles: pods.map((p) => ({ x: p.x, z: p.z - 0.45, w: 3.1, d: 2.3 }))
        .concat([
          { x: H.x, z: H.z - 0.55, w: 6.6, d: 2.3 },                 // help desk counter + agent chairs
          { x: H.x + 4.2, z: H.z - 0.2, r: 0.35 },                   // "now serving" stand
          { x: WA.x, z: WA.z, w: 5.0, d: 1.1 },                       // waiting chairs
          { x: WA.x + 3.5, z: WA.z, r: 0.7 },                         // magazine table
          { x: SR.x, z: SR.z, w: 7.6, d: 1.5 },                       // server racks
          { x: SR.x + 4.1, z: SR.z, w: 1.1, d: 1.2 },                 // air conditioner
          { x: SR.x - 3.7, z: SR.z - 0.9, r: 0.3 },                   // fire extinguisher
          { x: RB.x - 0.1, z: RB.z, w: 1.5, d: 5.1 },                 // repair bench
          { x: shelfX + 0.2, z: -7.4, w: 1.2, d: 5.2 },               // parts shelves
          { x: -15.6, z: -3.8, w: 1.2, d: 1.0 },                      // laptop boxes
          { x: -12.6, z: -8.6, w: 1.9, d: 1.4, rot: -0.3 },           // monitor cart
          { x: -4.2, z: 1.0, w: 2.8, d: 0.9, rot: -0.15 },            // whiteboard
          { x: 4, z: W.back + 1.0, w: 1.5, d: 1.1 },                  // printer
          { x: 6.05, z: W.back + 0.9, w: 1.7, d: 0.8 },               // bins
          { x: K.x, z: K.z, w: 3.8, d: 1.1 },                         // break counter
          { x: K.x + 2.6, z: K.z + 0.1, r: 0.6 },                     // water cooler
          { x: 16.8, z: 6.2, w: 1.0, d: 1.9 },                        // vending machine
          { x: 9.2, z: 5.2, r: 0.7 },                                 // café table
          { x: -16.6, z: 9.6, r: 0.95 }, { x: -7.6, z: 8.6, r: 0.8 }, { x: 16.6, z: 9.8, r: 0.85 }, { x: -3.4, z: -9.9, r: 0.8 },
        ]),
      spots: deskSpots.concat(agentSpots, waitSeats, [
        { x: H.x - 1.0, z: H.z + 1.5, yaw: Math.PI, emoji: "😩", activity: "asking for help",
          lines: ["My computer won't turn on!", "I forgot my password... again.", "The Wi-Fi is down!", "I spilled coffee on my keyboard..."] },
        { x: SR.x - 0.9, z: SR.z + 1.9, yaw: Math.PI, emoji: "🖥️", activity: "checking the servers",
          lines: ["All systems go!", "Why is this one beeping?", "It's so loud in here!", "Uptime: 99.9%!"] },
        { x: RB.x - 1.75, z: RB.z + 1.0, yaw: Math.PI / 2, arms: "type", emoji: "🔧", activity: "fixing a computer",
          lines: ["Who spilled juice in this?!", "Needs more thermal paste.", "Aha! A loose cable!", "Good as new!"] },
        { x: shelfX + 1.6, z: -7.4, yaw: -Math.PI / 2, emoji: "📦", activity: "looking for spare parts",
          lines: ["Where are the HDMI cables?", "We're out of mice again.", "Found a keyboard!"] },
        { x: -15.6, z: -0.8, yaw: -Math.PI / 2, lookUp: 0.3, emoji: "📈", activity: "checking the ticket queue",
          lines: ["So many tickets!", "We're crushing it today!", "Ticket #404... not found."] },
        { x: -4.0, z: 2.2, yaw: Math.PI - 0.15, emoji: "📝", activity: "planning the network",
          lines: ["If we move the router here...", "Hmm, where does this cable go?", "Needs more Wi-Fi."] },
        { x: K.x - 0.9, z: K.z - 1.2, yaw: 0, emoji: "☕", activity: "making coffee",
          lines: ["Coffee, please!", "Coffee first, then code.", "Who drank the last cup?!"] },
        { x: K.x + 2.6, z: K.z - 1.1, yaw: 0, emoji: "💧", activity: "getting water",
          lines: ["*glug glug*", "Staying hydrated!", "Any gossip today?"] },
        { x: 4, z: W.back + 2.2, yaw: Math.PI, emoji: "🖨️", activity: "trying the printer",
          lines: ["Paper jam AGAIN?!", "It says OUT OF ORDER...", "Have you tried turning it off and on again?"] },
        { x: 15.4, z: 6.2, yaw: -Math.PI / 2, emoji: "🥤", activity: "at the vending machine",
          lines: ["Snack time!", "It ate my coin!", "Ooh, melon soda!"] },
        // gazing out of the big windows at the city
        { x: -10, z: -9.7, yaw: Math.PI, lookUp: 0.1, emoji: "🏙️", activity: "gazing out the window",
          lines: ["What a view!", "I can see the river from here!", "The cars look like toys!", "Is that a hot-air balloon?"] },
        { x: 0.6, z: -9.7, yaw: Math.PI, lookUp: 0.1, emoji: "🏙️", activity: "gazing out the window",
          lines: ["We're SO high up!", "I can see my house from here!", "Look at all the little cars!", "Nice day for a walk in the park."] },
        { x: -16.5, z: 5.2, yaw: -Math.PI / 2, lookUp: 0.1, emoji: "🏙️", activity: "gazing out the window",
          lines: ["I could watch the city all day.", "Ooh, a skyscraper!", "Is it lunchtime yet?", "Those clouds look like sheep."] },
      ]),
      lines: [
        "Have you tried turning it off and on again?", "It works on my machine!", "Who unplugged the router?!",
        "Did you clear your cache?", "Password123 is NOT a good password.", "The Wi-Fi is down again!",
        "Is it plugged in?", "I need more RAM... and coffee.", "Ticket closed!", "Have you updated your drivers?",
      ],
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

  // =====================================================================
  // OUTER SPACE — a cute moon base
  // =====================================================================
  function buildSpace() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xc9c2ff, ground: 0x5a4f8a, hemi: 0.5, sun: 0.9, sunColor: 0xfff6e8, ambient: 0.3, fill: 0.35 });

    // nebula sky painted onto a big sphere
    const skyTex = canvasTexture(1024, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#0b0830"); g.addColorStop(0.5, "#271a5e"); g.addColorStop(1, "#3a2470");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const r = seeded(31);
      for (let i = 0; i < 14; i++) {
        const x = r() * w, y = h * 0.15 + r() * h * 0.45, rad = 60 + r() * 140;
        const c = ["255,120,200", "120,160,255", "190,120,255", "120,230,255"][i % 4];
        // drawn three times (shifted left and right) so the clouds wrap round
        // the sky smoothly, without a hard line where the picture's edges meet
        for (const dx of [-w, 0, w]) {
          const ng = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
          ng.addColorStop(0, "rgba(" + c + ",0.35)"); ng.addColorStop(1, "rgba(" + c + ",0)");
          ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h);
        }
      }
      // (stars are separate round dots, added below)
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, toneMapped: false }));
    dynamic(sky);
    root.add(sky);
    anim.push((t) => { sky.rotation.y = t * 0.003; });

    // twinkling stars in front of the sky
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    const r = seeded(3);
    for (let i = 0; i < 1600; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() * 0.7 + 0.03, r() - 0.5).normalize().multiplyScalar(200);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    // round, soft star dots (instead of squares)
    const dot = canvasTexture(32, 32, (ctx) => {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    });
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 4.5, map: dot, transparent: true, depthWrite: false, fog: false }));
    dynamic(stars);
    root.add(stars);
    anim.push((t) => { stars.material.opacity = 0.6 + Math.sin(t * 2.5) * 0.35; });

    // Earth with a separate cloud layer, plus a ringed planet
    const earthTex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = "#2f8ae0"; ctx.fillRect(0, 0, w, h);
      const rr = seeded(9);
      ctx.fillStyle = "#5cc84a";
      for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.ellipse(rr() * w, h * 0.2 + rr() * h * 0.6, 20 + rr() * 45, 14 + rr() * 26, rr() * 3, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, 16); ctx.fillRect(0, h - 16, w, 16);
    });
    const earth = dynamic(put(root, new THREE.SphereGeometry(22, 64, 40), toon(0xffffff, { map: earthTex, fog: false }), { x: 42, y: 36, z: -185, shadow: false, receive: false }));
    const cloudTex = canvasTexture(512, 256, (ctx, w, h) => {
      const rr = seeded(14);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(rr() * w, rr() * h, 15 + rr() * 35, 5 + rr() * 8, 0, 0, TAU); ctx.fill(); }
    });
    const earthClouds = dynamic(put(root, new THREE.SphereGeometry(22.6, 64, 40), new THREE.MeshToonMaterial({ map: cloudTex, transparent: true, gradientMap: gradient, fog: false }), { x: 42, y: 36, z: -185, shadow: false, receive: false }));
    const atmo = put(root, new THREE.SphereGeometry(24.2, 64, 40), new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.3, side: THREE.BackSide, toneMapped: false, fog: false }), { x: 42, y: 36, z: -185, shadow: false });
    dynamic(atmo);
    anim.push((t) => { earth.rotation.y = t * 0.04; earthClouds.rotation.y = t * 0.06; });
    const planet = dynamic(group(root, -85, 34, -150));
    put(planet, G.sphere(), toon(0xffb46b, { fog: false }), { s: 11, shadow: false });
    put(planet, G.sphere(), toon(0xff9a5a, { fog: false }), { s: 11.05, sy: 0.25, shadow: false });
    put(planet, G.torus(18, 2.0), toon(0xffe0b0, { transparent: true, opacity: 0.85, fog: false }), { rx: 1.25, ry: 0.3, sz: 0.1, shadow: false });

    // more planets and moons, dotted all around the sky
    const stripes = (colors, seed) => canvasTexture(256, 128, (ctx, w, h) => {
      const rr = seeded(seed);
      let y = 0, i = 0;
      while (y < h) { const bh = 6 + rr() * 18; ctx.fillStyle = colors[i++ % colors.length]; ctx.fillRect(0, y, w, bh + 1); y += bh; }
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.ellipse(w * 0.3, h * 0.6, 16, 7, 0, 0, TAU); ctx.fill();
    });
    const spotty = (base, dark, seed) => canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      const rr = seeded(seed);
      for (let i = 0; i < 26; i++) {
        const x = rr() * w, y = 10 + rr() * (h - 20), rad = 3 + rr() * 9;
        ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
      }
    });
    const spinners = [];
    const skyPlanet = (x, y, z, r, tex, tilt, spin) => {
      const m = dynamic(put(root, cachedGeo("planetSphere", () => new THREE.SphereGeometry(1, 40, 24)), toon(0xffffff, { map: tex, fog: false }), { x, y, z, s: r, rz: tilt || 0, shadow: false, receive: false }));
      spinners.push([m, spin || 0.03]);
      return m;
    };
    // a big striped gas giant behind the camera, with its little yellow moon
    skyPlanet(-110, 40, 150, 18, stripes(["#7fd8d0", "#5fbfc9", "#a8ece0", "#4aa6b8", "#c9f4ea"], 3), 0.2, 0.02);
    put(root, G.sphere(), toon(0xffe27a, { fog: false }), { x: -76, y: 62, z: 126, s: 4, shadow: false, receive: false });
    // a lavender moon covered in craters (right)
    skyPlanet(178, 30, 42, 9, spotty("#d9c8f5", "rgba(150,120,200,0.55)", 8), 0.3, -0.04);
    // a small red planet with a thin ring (left)
    const redP = group(root, -186, 26, -26);
    put(redP, G.sphere(), toon(0xff7a6b, { fog: false }), { s: 7, shadow: false, receive: false });
    put(redP, G.torus(11, 0.6), toon(0xffd0c0, { transparent: true, opacity: 0.8, fog: false }), { rx: 1.3, ry: -0.4, sz: 0.1, shadow: false, receive: false });
    anim.push((t) => spinners.forEach(([m, s]) => { m.rotation.y = t * s; }));

    // a ring-shaped space station, slowly turning (one painted shape)
    const skyPaint = paintedMat.clone();
    skyPaint.fog = false;
    const station = dynamic(put(root, bakeGeo((g) => {
      put(g, new THREE.TorusGeometry(9, 1.0, 10, 40), toon(0xf2f0fa));
      put(g, G.cyl(16), toon(0xd5d8e3), { sx: 1.8, sy: 7, sz: 1.8, rx: Math.PI / 2 });
      ball(g, 0xf2f0fa, 0, 0, 0, 2.6);
      for (let i = 0; i < 4; i++) put(g, G.cyl(8), toon(0xc9cce0), { sx: 0.35, sy: 18, sz: 0.35, rz: (i / 4) * Math.PI });
      for (const z of [-5.5, 5.5]) {
        block(g, 0x2e5fd6, 0, 0, z, 16, 0.2, 3.2, 0.05);
        block(g, 0x9fc3ff, 0, 0.12, z, 15.6, 0.04, 0.12, 0.01);
      }
      for (let i = 0; i < 8; i++) ball(g, i % 2 ? 0xffcf3a : 0x7fe0ff, Math.cos((i / 8) * TAU) * 9, Math.sin((i / 8) * TAU) * 9, 1.0, 0.35);
    }), skyPaint, { x: 112, y: 42, z: 116, ry: -2.38, rx: 0.35, shadow: false, receive: false })); // (turned to face the moon base)
    anim.push((t) => { station.rotation.z = t * 0.05; });

    // little satellites zooming round overhead
    const satGeo = bakeGeo((g) => {
      block(g, 0xffcf3a, 0, 0, 0, 1.2, 1.2, 1.6, 0.15);
      for (const x of [-1.9, 1.9]) block(g, 0x2e5fd6, x, 0, 0, 2.4, 0.08, 1.0, 0.03);
      cylinder(g, 0xbbbbbb, 0, 0, 0, 0.05, 6.2, { rz: Math.PI / 2, seg: 6 });
      put(g, G.cone(10), toon(0xf2f3f8), { y: 0.95, s: 0.5, sy: 0.4, rx: Math.PI });
      ball(g, 0xff5a64, 0, -0.75, 0.5, 0.15);
    });
    const sats = [
      { mesh: dynamic(painted(root, satGeo, { s: 1.2 })), r: 52, y: 26, speed: 0.05, start: 0 },
      { mesh: dynamic(painted(root, satGeo, { s: 1.0 })), r: 70, y: 34, speed: -0.035, start: 2.5 },
    ];
    anim.push((t) => sats.forEach((s, i) => {
      const a = s.start + t * s.speed;
      s.mesh.position.set(Math.cos(a) * s.r, s.y + Math.sin(a * 2 + i) * 3, Math.sin(a) * s.r);
      s.mesh.rotation.set(t * 0.3, -a, Math.sin(t * 0.5) * 0.4);
    }));

    // a comet with a glowing tail, slowly sweeping across the sky
    const comet = dynamic(group(root, 0, 0, 0));
    ball(comet, toon(0xf4feff, { emissive: 0xbff3ff, emissiveIntensity: 1, fog: false }), 0, 0, 0, 1.7, { shadow: false, receive: false });
    // the soft glow and tail are see-through, and "add" their light to the sky
    const glowy = (opacity, map) => new THREE.MeshBasicMaterial({ color: 0x9fe8ff, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, toneMapped: false });
    const tailTex = canvasTexture(16, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(255,255,255,0.45)"); g.addColorStop(1, "rgba(255,255,255,1)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    put(comet, G.midSphere(), glowy(0.35), { s: 3.4, shadow: false, receive: false });
    put(comet, new THREE.ConeGeometry(2.0, 30, 16, 1, true), glowy(0.8, tailTex), { z: -15, rx: -Math.PI / 2, shadow: false, receive: false });
    put(comet, new THREE.ConeGeometry(3.6, 18, 16, 1, true), glowy(0.4, tailTex), { z: -9, rx: -Math.PI / 2, shadow: false, receive: false });
    const cometNext = new THREE.Vector3();
    const cometAt = (t, v) => v.set(Math.cos(t * 0.018) * 170, 48 + Math.sin(t * 0.03) * 12, Math.sin(t * 0.018) * 170);
    anim.push((t) => {
      cometAt(t, comet.position);
      comet.lookAt(cometAt(t + 1, cometNext)); // the tail trails behind
    });


    // moon ground with soft bumps and speckles. It's a big round disc that is
    // flat where the Miis walk, bumpy further out, and rises into a ring of
    // hills at the edge, so there's a horizon whichever way you look.
    const moonTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#b9b0d6"; ctx.fillRect(0, 0, w, h);
      const rr = seeded(5);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = rr() < 0.5 ? "rgba(150,138,190,0.28)" : "rgba(225,220,245,0.3)";
        ctx.beginPath(); ctx.arc(rr() * w, rr() * h, 2 + rr() * 6, 0, TAU); ctx.fill();
      }
    }, [29, 29]);
    // how high the ground is at (x, z)
    const moonY = (x, z) => {
      const d = Math.hypot(x / 1.3, z);
      if (d < 24) return 0;
      const bump = Math.sin(x * 0.12) * Math.cos(z * 0.1) * 1.6 + Math.sin(x * 0.05 - z * 0.07) * 2.5;
      const a = Math.atan2(z, x);
      const rim = Math.max(0, (Math.hypot(x, z) - 120) / 110); // 0 near us, 1 at the edge
      return bump * 0.5 * Math.min(1, (d - 24) / 14) + rim * rim * (9 + Math.sin(a * 5) * 4 + Math.sin(a * 13 + 1) * 2);
    };
    const groundGeo = new THREE.RingGeometry(0.5, 235, 96, 48);
    const gp = groundGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) gp.setZ(i, moonY(gp.getX(i), -gp.getY(i))); // (the disc is turned to lie flat below)
    groundGeo.computeVertexNormals();
    put(root, groundGeo, toon(0xffffff, { map: moonTex }), { rx: -Math.PI / 2, shadow: false });

    // big craters and lumpy mountains further out, all the way around
    const farCraters = [], farRims = [], peaks = [];
    const fr = seeded(41);
    for (let i = 0; i < 22; i++) {
      const a = fr() * TAU, d = 42 + fr() * 100;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, rad = 3 + fr() * 6;
      const y = moonY(x, z);
      farRims.push({ x, y: y - 0.2, z, s: rad, sz: rad * 0.45, rx: -Math.PI / 2, color: fr() < 0.5 ? 0xa79dc8 : 0x9d93c0 });
      farCraters.push({ x, y: y + 0.05, z, s: rad, rx: -Math.PI / 2, color: 0x8f85b4 });
    }
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU + fr() * 0.12, d = 175 + fr() * 45;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, s = 10 + fr() * 14;
      peaks.push({ x, y: moonY(x, z) - 3, z, sx: s * 1.6, sy: 7 + fr() * 13, sz: s, ry: -a, color: [0x9d93c6, 0x8a80b5, 0xb2a8d8][i % 3] });
    }
    painted(root, bakeCopies([[G.torus(1, 0.22), farRims], [G.circle(), farCraters], [G.midSphere(), peaks]]));

    // a tiny far-away outpost on the hills, with a blinking beacon
    const outpost = group(root, -100, moonY(-100, 70) - 0.5, 70, 0.6);
    put(outpost, new THREE.SphereGeometry(3, 16, 8, 0, TAU, 0, Math.PI / 2), toon(0xf2f0fa), { shadow: false });
    cylinder(outpost, 0xd5d8e3, 5, 1.2, 0, 1.2, 2.4, { seg: 12, shadow: false });
    cylinder(outpost, 0x8f96a3, -2, 5, 1, 0.12, 8, { seg: 6, shadow: false });
    const beacon = dynamic(ball(outpost, toon(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 1 }), -2, 9.2, 1, 0.45, { shadow: false }));
    anim.push((t) => { beacon.material.emissiveIntensity = Math.floor(t * 1.5) % 2 ? 1 : 0.1; });

    // craters
    const cr = seeded(7);
    const craters = [];
    for (let i = 0; i < 12; i++) {
      const x = (cr() - 0.5) * 36, z = (cr() - 0.5) * 22;
      if (Math.hypot(x + 10, z + 3) < 5 || Math.hypot(x - 6, z + 4) < 5) continue;
      const rad = 0.7 + cr() * 1.3;
      put(root, G.torus(rad, rad * 0.22), toon(0xa79dc8), { x, y: 0.02, z, rx: -Math.PI / 2, sz: 0.45 });
      disc(root, toon(0x9a90bd), x, 0.025, z, rad);
      craters.push({ x, z, r: rad + 0.2 });
    }

    // the base: a glass dome with a little garden, a tunnel, and a module
    const D = { x: 6, z: -5 };
    const dome = group(root, D.x, 0, D.z);
    cylinder(dome, 0xe8e6f2, 0, 0.2, 0, 3.4, 0.4, { seg: 40 });
    disc(dome, toon(0x7fd65a), 0, 0.41, 0, 3.1);
    roundTree(dome, 0, 0, 0.55, [0x5cc84a, 0x8ae065], 0xff4b3a);
    bush(dome, -1.6, 1, 0.8, 0x4fbf47, 0xff6fa5);
    bush(dome, 1.7, 0.6, 0.8, 0x5cc84a, 0xffe25a);
    put(dome, new THREE.SphereGeometry(3.3, 40, 20, 0, TAU, 0, Math.PI / 2), new THREE.MeshToonMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, gradientMap: gradient, depthWrite: false }), { y: 0.4, shadow: false });
    for (let i = 0; i < 6; i++) put(dome, G.torus(3.3, 0.06), toon(0xffffff), { y: 0.4, rx: 0, ry: (i / 6) * Math.PI, sz: 1, sy: 1, shadow: false }).scale.set(1, 1, 1);
    // ribs: half rings over the dome
    const ribs = dome.children.slice(-6);
    ribs.forEach((rb, i) => { rb.geometry = new THREE.TorusGeometry(3.3, 0.06, 8, 40, Math.PI); rb.rotation.set(0, (i / 6) * Math.PI, 0); });
    put(root, G.cyl(24), toon(0xe8e6f2), { x: D.x + 5.2, y: 1.0, z: D.z - 0.5, sx: 0.8, sy: 3.5, sz: 0.8, rz: Math.PI / 2 });
    const mod = group(root, D.x + 8.3, 0, D.z - 0.5);
    put(mod, G.capsule(), toon(0xf5f3fb), { y: 1.4, sx: 2.6, sy: 2.2, sz: 2.6, rz: Math.PI / 2 });
    for (const dx of [-1.0, 0, 1.0]) ball(mod, glow(0x8fd3ff, 0.6), dx, 1.6, 1.28, 0.3, { sz: 0.3 });
    block(mod, 0xff7a59, 0, 0.2, 0, 3.0, 0.4, 2.0, 0.1);

    // rocket on a launch pad, with blinking lights
    const R = { x: -11, z: -4 };
    const pad = group(root, R.x, 0, R.z);
    cylinder(pad, 0x5a5f73, 0, 0.12, 0, 3.0, 0.24, { seg: 8 });
    disc(pad, toon(0xffcf3a), 0, 0.25, 0, 2.2);
    disc(pad, toon(0x3a3f4a), 0, 0.26, 0, 1.8);
    const blinkers = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      blinkers.push(dynamic(ball(pad, toon(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 1 }), Math.cos(a) * 2.7, 0.3, Math.sin(a) * 2.7, 0.1)));
    }
    anim.push((t) => blinkers.forEach((b, i) => { b.material.emissiveIntensity = (Math.floor(t * 2) + i) % 2 ? 1 : 0.1; }));
    const rocket = group(root, R.x, 0.25, R.z);
    put(rocket, G.capsule(), toon(0xffffff), { y: 3.6, sx: 2.0, sy: 4.4, sz: 2.0 });
    put(rocket, G.cone(32), toon(0xff5a64), { y: 7.0, s: 0.95, sy: 1.6 });
    put(rocket, G.cyl(32), toon(0xff5a64), { y: 2.2, sx: 1.03, sy: 0.4, sz: 1.03 });
    for (const y of [4.4, 3.3]) {
      ball(rocket, 0x8f96a3, 0, y, 0.88, 0.38, { sz: 0.3 });
      ball(rocket, glow(0x8fd3ff, 0.5), 0, y, 0.95, 0.28, { sz: 0.25 });
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 6;
      const fin = group(rocket, Math.sin(a) * 0.95, 1.3, Math.cos(a) * 0.95, a);
      block(fin, 0xff5a64, 0, 0, 0.3, 0.14, 1.6, 0.9, 0.06, { rx: 0.25 });
    }
    put(rocket, G.taper(0.55, 0.75), toon(0x5a5f73), { y: 0.55, sy: 0.6 });
    // gantry tower
    const tower = group(root, R.x - 3.2, 0, R.z - 0.8);
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) block(tower, 0xff9a3a, sx, 3.5, sz, 0.12, 7, 0.12, 0.03);
    for (let y = 0.6; y < 7; y += 0.9) {
      block(tower, 0xff9a3a, 0, y, -0.45, 1.0, 0.08, 0.08, 0.02);
      block(tower, 0xff9a3a, 0, y, 0.45, 1.0, 0.08, 0.08, 0.02);
      block(tower, 0xff9a3a, -0.45, y, 0, 0.08, 0.08, 1.0, 0.02);
      block(tower, 0xff9a3a, 0.45, y, 0, 0.08, 0.08, 1.0, 0.02);
    }
    block(tower, 0xff9a3a, 1.3, 5.2, 0.4, 1.6, 0.12, 0.3, 0.03);
    const smoke = [];
    for (let i = 0; i < 6; i++) smoke.push(dynamic(ball(root, toon(0xece8f8, { transparent: true, opacity: 0.6 }), R.x, 0.3, R.z, 0.5, { shadow: false })));
    anim.push((t) => smoke.forEach((p, i) => {
      const k = (t * 0.35 + i / smoke.length) % 1;
      const a = i * 2.1;
      p.position.set(R.x + Math.cos(a) * (0.6 + k * 2.4), 0.4 + k * 0.6, R.z + Math.sin(a) * (0.6 + k * 2.4));
      p.scale.setScalar(0.3 + k * 0.7);
      p.material.opacity = 0.6 * (1 - k);
    }));

    // solar panels
    for (let i = 0; i < 3; i++) {
      const sp2 = group(root, -3 + i * 2.6, 0, -9.5);
      cylinder(sp2, 0x8f96a3, 0, 0.6, 0, 0.07, 1.2);
      const panelTex = canvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = "#2e5fd6"; ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = "#9fc3ff"; ctx.lineWidth = 2;
        for (let k = 0; k <= 64; k += 16) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 64); ctx.moveTo(0, k); ctx.lineTo(64, k); ctx.stroke(); }
      });
      block(sp2, toon(0xffffff, { map: panelTex }), 0, 1.3, 0, 2.2, 0.06, 1.4, 0.02, { rx: 0.5 });
    }

    // satellite dish that slowly turns
    const dishG = group(root, 14, 0, -8);
    cylinder(dishG, 0xd5d8e3, 0, 0.8, 0, 0.12, 1.6);
    const dishHead = dynamic(group(dishG, 0, 1.7, 0));
    put(dishHead, new THREE.SphereGeometry(1.1, 24, 10, 0, TAU, 0, 1.0), toon(0xf2f3f8, { side: THREE.DoubleSide }), { rx: -1.0 });
    cylinder(dishHead, 0x8f96a3, 0, 0.3, 0.45, 0.04, 0.9, { rx: -1.0 });
    anim.push((t) => { dishHead.rotation.y = Math.sin(t * 0.3) * 1.2; });

    // rover
    const rover = group(root, 11, 0, 5, -0.6);
    block(rover, 0xffcf3a, 0, 1.0, 0, 2.6, 0.7, 1.6, 0.25);
    block(rover, 0xffffff, 0.3, 1.55, 0, 1.2, 0.5, 1.2, 0.2);
    ball(rover, glow(0x8fd3ff, 0.5), 0.95, 1.6, 0, 0.18, { sx: 0.3 });
    for (const [x, z] of [[-0.9, 0.85], [0.9, 0.85], [-0.9, -0.85], [0.9, -0.85]]) {
      put(rover, G.cyl(20), toon(0x3a3f4a), { x, y: 0.42, z, sx: 0.42, sy: 0.3, sz: 0.42, rx: Math.PI / 2 });
      put(rover, G.cyl(12), toon(0xd5d8e3), { x, y: 0.42, z: z * 1.17, sx: 0.18, sy: 0.05, sz: 0.18, rx: Math.PI / 2 });
    }
    cylinder(rover, 0x8f96a3, -0.8, 1.8, 0, 0.03, 0.9);
    ball(rover, toon(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 0.8 }), -0.8, 2.28, 0, 0.08);

    // flag that waves
    const flagGroup = group(root, 0.5, 0, 1);
    cylinder(flagGroup, 0xe0e0ea, 0, 1.7, 0, 0.05, 3.4);
    ball(flagGroup, 0xffcf3a, 0, 3.45, 0, 0.1);
    const flagGeo = new THREE.PlaneGeometry(1.7, 1.05, 14, 4);
    flagGeo.translate(0.85, 0, 0);
    const flagTex = canvasTexture(128, 80, (ctx, w, h) => {
      ctx.fillStyle = "#ff5a7a"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(w / 2, h / 2, 24, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ff5a7a"; ctx.font = "bold 24px 'Nunito', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("Mii", w / 2, h / 2 + 1);
    });
    const flag = dynamic(put(flagGroup, flagGeo, toon(0xffffff, { map: flagTex, side: THREE.DoubleSide }), { x: 0.04, y: 2.85 }));
    const flagBase = flagGeo.attributes.position.array.slice();
    anim.push((t) => {
      const p = flagGeo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = flagBase[i * 3]; p.setZ(i, Math.sin(t * 3 + x * 3) * 0.12 * x); }
      p.needsUpdate = true;
      flagGeo.computeVertexNormals();
    });

    // crates, rocks and glowing crystals
    const crates = [[13.5, -1.5], [14.6, -1.4], [14.0, -1.2, 1]];
    crates.forEach(([x, z, top]) => block(root, 0xff9a3a, x, top ? 1.3 : 0.45, z, 0.9, 0.9, 0.9, 0.1, { ry: x }));
    const rocks = [[-3.5, 8.5, 0.9], [16, 4, 0.8], [-16, 6, 1.1], [3, 9, 0.6], [-17, -7, 1.3]];
    rocks.forEach(([x, z, s]) => rock(root, x, z, s, 0x9a90bd));
    const crystals = [[-6, 6.5, 0x7ff0ff], [15.2, 3.4, 0xff8ad8], [-16.5, 4.8, 0xb58cff], [-16, -8, 0x7ff0ff]];
    const crystalMeshes = [];
    crystals.forEach(([x, z, c], ci) => {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7 + ci;
        const m = put(root, G.cone(6), toon(c, { emissive: c, emissiveIntensity: 0.5 }), { x: x + Math.cos(a) * 0.35, y: 0.5, z: z + Math.sin(a) * 0.35, sx: 0.22, sy: 1.0 + (i % 2) * 0.5, sz: 0.22, rz: Math.cos(a) * 0.3, rx: Math.sin(a) * 0.3 });
        dynamic(m);
        crystalMeshes.push(m);
      }
    });
    anim.push((t) => crystalMeshes.forEach((m, i) => { m.material.emissiveIntensity = 0.4 + Math.sin(t * 2 + i) * 0.25; }));

    // a UFO that zooms past now and then
    const ufo = dynamic(group(root, 0, 0, 0));
    put(ufo, G.sphere(), toon(0xd5d8e3), { s: 1.6, sy: 0.35, shadow: false });
    put(ufo, G.sphere(), toon(0x8fffb0, { transparent: true, opacity: 0.7 }), { y: 0.35, s: 0.7, shadow: false });
    const ufoLights = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ufoLights.push(ball(ufo, toon(0xffcf3a, { emissive: 0xffcf3a, emissiveIntensity: 1 }), Math.cos(a) * 1.35, -0.05, Math.sin(a) * 1.35, 0.12, { shadow: false }));
    }
    // RARE: now and then (very rarely, and only while you watch) the UFO stops and tries to
    // beam up a Mii. It never works: the Mii drops back down and the UFO flees. (A sticker!)
    const beam = put(ufo, G.taper ? G.taper(0.18, 1) : new THREE.CylinderGeometry(0.18, 1, 1, 18, 1, true), toon(0x9dffc0, { transparent: true, opacity: 0.35, emissive: 0x6cff9a, emissiveIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false }), { y: -0.2, shadow: false });
    beam.visible = false;
    let abduct = null, lastK = 1;
    anim.push((t) => {
      ufo.rotation.y = t * 3;
      ufoLights.forEach((l, i) => {
        l.material.emissiveIntensity = (Math.floor(t * 6) + i) % 2 ? 1 : 0.2;
        l.material.emissive.setHex(abduct && abduct.phase === "leave" ? 0xff4a4a : 0xffcf3a);
      });
      if (abduct) return; // (the rare event is flying it)
      const cycle = t % 28;
      const k = cycle / 7;
      ufo.visible = k < 1;
      ufo.position.set(-60 + k * 120, 14 + Math.sin(k * 12) * 1.5, -25);
    });
    const smooth = (u) => u * u * (3 - 2 * u);
    const ufoRare = {
      update(dt, t, ctx) {
        const k = (t % 28) / 7;
        if (!abduct) {
          // as each normal pass begins, there's a tiny chance it comes down instead
          const starting = k < lastK && k < 0.2;
          lastK = k;
          if (!starting || Math.random() > 0.012) return;
          this.force(ctx);
          return;
        }
        const a = abduct, w = a.w;
        // (the Mii left or got picked up: never mind)
        if (w.held || w.vanish > 0 || w.leaving) { w.rareLift = 0; abduct = null; ufo.visible = false; beam.visible = false; return; }
        a.time += dt;
        const above = () => ({ x: w.x, y: 7.5, z: w.z });
        if (a.phase === "come") {
          const u = smooth(Math.min(1, a.time / 3)), p = above();
          ufo.visible = true;
          ufo.position.set(a.from.x + (p.x - a.from.x) * u, a.from.y + (p.y - a.from.y) * u, a.from.z + (p.z - a.from.z) * u);
          if (a.time >= 3) { a.phase = "beam"; a.time = 0; beam.visible = true; ctx.say(w, "Wh-whoa!! Put me down!!", 3); }
        } else if (a.phase === "beam") {
          const p = above();
          ufo.position.set(p.x, p.y + Math.sin(a.time * 3) * 0.15, p.z);
          beam.scale.set(1.6, 7.3, 1.6); beam.position.y = -0.2 - 3.65;
          beam.material.opacity = 0.25 + Math.sin(a.time * 14) * 0.08;
          w.rareLift = smooth(Math.min(1, a.time / 2.8)) * 1.6 + Math.sin(a.time * 5) * 0.08;
          if (a.time >= 3.4) { a.phase = "fail"; a.time = 0; a.liftV = 0; }
        } else if (a.phase === "fail") {
          // the beam sputters out: the Mii falls back down
          beam.visible = Math.floor(a.time * 16) % 3 === 0 && a.time < 0.4;
          a.liftV -= dt * 14;
          w.rareLift = Math.max(0, (w.rareLift || 0) + a.liftV * dt);
          if (w.rareLift === 0 && !a.landed) { a.landed = true; ctx.say(w, "Phew... that was close!", 2.5); }
          if (a.time >= 1.3) { a.phase = "leave"; a.time = 0; a.from = ufo.position.clone(); beam.visible = false; w.rareLift = 0; }
        } else if (a.phase === "leave") {
          const u = Math.min(1, a.time / 2.2), e = u * u;
          ufo.position.set(a.from.x + 70 * e, a.from.y + 28 * e, a.from.z - 30 * e);
          if (a.time >= 2.2) { abduct = null; ufo.visible = false; ctx.event("ufo"); }
        }
      },
      _state: () => abduct, // (for testing)
      force(ctx) { // (also used for testing)
        const miis = ctx.miis();
        if (!miis.length || abduct) return;
        abduct = { w: miis[Math.floor(Math.random() * miis.length)], phase: "come", time: 0, from: ufo.visible ? ufo.position.clone() : new THREE.Vector3(-60, 14, -25) };
      },
    };

    mergeStatic(root);

    return {
      group: root,
      background: 0x120c3a,
      fog: [0x2c2068, 110, 330],
      cameraTilt: 0.2,
      cameraTargetY: 3.2,
      rare: ufoRare, // the UFO's (failed) abduction
      helmet: true,
      floaty: true,
      bounds: { minX: -18, maxX: 18, minZ: -11, maxZ: 11 },
      water: [],
      obstacles: [
        { x: D.x, z: D.z, r: 3.5 }, { x: D.x + 5.2, z: D.z - 0.5, w: 3.6, d: 1.8 }, { x: D.x + 8.3, z: D.z - 0.5, w: 4.6, d: 2.7 },
        { x: R.x, z: R.z, r: 3.0 }, { x: R.x - 3.2, z: R.z - 0.8, w: 1.2, d: 1.2 },
        { x: 0.5, z: 1, r: 0.25 }, { x: 14, z: -8, r: 0.6 }, { x: 11, z: 5, w: 3.0, d: 2.5, rot: 0.6 },
        { x: 14.0, z: -1.4, w: 2.2, d: 1.1 }, { x: -0.4, z: -9.5, w: 8.0, d: 1.7 },
      ].concat(rocks.map(([x, z, s]) => ({ x, z, r: s * 1.05 })))
        .concat(crystals.map(([x, z]) => ({ x, z, r: 0.6 }))),
      spots: [
        { x: R.x + 3.4, z: R.z + 1.8, yaw: -2.2, emoji: "🚀", activity: "checking the rocket",
          lines: ["3... 2... 1... just kidding!", "Fuel looks good!", "Who wants a ride?"] },
        { x: 0.9, z: 2.6, yaw: Math.PI, arms: "up", emoji: "🚩", activity: "saluting the flag",
          lines: ["One small step for a Mii!", "We made it!", "I claim this rock!"] },
        { x: 9.6, z: 6.8, yaw: 2.4, emoji: "🔧", activity: "fixing the rover",
          lines: ["Beep boop?", "Needs a new wheel.", "Vroom vroom... slowly."] },
        { x: 0, z: 6, yaw: 2.92, lookUp: 0.35, emoji: "🌍", activity: "gazing at Earth",
          lines: ["I can see my house from here!", "Earth looks so tiny!", "Hi Mom!"] },
        { x: D.x, z: D.z + 4.4, yaw: Math.PI, emoji: "🌱", activity: "looking at the space garden",
          lines: ["A tree on the moon!", "Space apples!", "The plants look happy."] },
        { x: -6, z: 8, yaw: Math.PI, emoji: "💎", activity: "admiring the crystals",
          lines: ["So shiny!", "They're glowing!", "Can I take one home?"] },
      ],
      lines: [
        "I'm floating!", "Look, no gravity!", "Space is so quiet...", "Houston, we have a Mii!",
        "Where's the space ice cream?", "Moon jump!", "The stars are amazing!", "Is that a UFO?!",
        "Boing... boing...", "My helmet is foggy.",
      ],
      update(t) { anim.forEach((a) => a(t)); },
    };
  }

  const builders = { park: buildPark, office: buildOffice, space: buildSpace };
  const list = [
    { id: "park", name: "Park", icon: "🌳" },
    { id: "office", name: "Office", icon: "🏢" },
    { id: "space", name: "Outer Space", icon: "🚀" },
  ];

  // Places that aren't buttons at the top (like the inside of a Mii's home).
  const hiddenPlaces = [];

  // opts: anything the place needs (for a home: whose home and its furniture)
  function build(id, opts) {
    splitFar = true;
    let s;
    try { s = builders[id](opts || {}); } finally { splitFar = false; }
    const meta = list.find((l) => l.id === id) || hiddenPlaces.find((l) => l.id === id);
    return Object.assign(s, meta, { helmet: !!s.helmet, floaty: !!s.floaty });
  }

  // Lets other files (like homes3d.js) add places. meta = { id, name, icon }.
  // hidden: true = not shown as a button at the top.
  function addPlace(meta, builder, hidden) {
    builders[meta.id] = builder;
    (hidden ? hiddenPlaces : list).push(meta);
  }

  // Frees the GPU memory used by a place when we leave it.
  function dispose(scene) {
    scene.group.traverse((o) => {
      if (o.geometry && !Array.from(geoCache.values()).includes(o.geometry)) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => { if (m.map) m.map.dispose(); });
    });
  }

  // the building blocks, so other files can make places in the same style
  const kit = {
    THREE, TAU, toon, glow, G, put, ball, cylinder, block, disc, group, dynamic, canvasTexture, seeded,
    skyDome, addLights, mergeStatic, scatter, roundTree, palmTree, bush, parkBench, lampPost, rock,
    bakeGeo, paintedMat,
  };

  root.World3D = { build, dispose, list, debug, kit, addPlace, markFar, FAR_LAYER, SMALL_LAYER };
})(typeof self !== "undefined" ? self : this);
