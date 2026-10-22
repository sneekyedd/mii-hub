/*
 * places-seaside.js
 * Two more places for the Miis to hang out in:
 *
 *   "beach"  a sunny sandy beach with the sea, a wooden pier, umbrellas,
 *            deck chairs, a lifeguard tower, volleyball, sandcastles and
 *            an ice-cream stand. A little seaside town is behind the dunes.
 *   "cafe"   a cozy shopping street: a café with a terrace, a bakery, a
 *            clothes shop, a toy shop, a flower stall, a fountain, a bus
 *            stop and bunting overhead. A tram rattles past now and then.
 *
 * Both are built with the same toolkit as the other places (World3D.kit), so
 * they share the soft, rounded, toon-shaded Tomodachi Life look.
 *
 * Speed tips used here (so slower computers stay smooth):
 *   - things that never move are merged together (mergeStatic)
 *   - lots of copies of one shape are drawn in one go (scatter / InstancedMesh)
 *   - far-away scenery is "painted": one shape, one material, one draw call
 */
(function (root) {
  "use strict";

  if (!root.World3D || !root.World3D.kit) return; // (not in a browser, e.g. the tests)

  const {
    THREE, TAU, toon, glow, G, put, ball, cylinder, block, disc, group, dynamic, canvasTexture, seeded,
    skyDome, addLights, mergeStatic, scatter, palmTree, bush, parkBench, lampPost,
  } = root.World3D.kit;
  const PI = Math.PI;

  // =====================================================================
  // Small helpers shared by both places
  // =====================================================================

  const hex = (n) => "#" + n.toString(16).padStart(6, "0");

  // The toon "light bands" picture, borrowed from a toolkit material.
  const gradient = toon(0xffffff).gradientMap;

  // "Painted" models: every part keeps its own color, but the whole model is
  // ONE shape with ONE material, so the computer draws it in a single go.
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
  function painted(parent, geo, o) {
    return put(parent, geo, paintedMat, Object.assign({ shadow: false, receive: false }, o));
  }
  // Something that moves as one piece (a boat, a tram, a crab...), as one painted shape.
  function mover(parent, build, shadow) {
    return dynamic(painted(parent, bakeGeo(build), { shadow: !!shadow }));
  }

  // Lots of copies of one shape far away: never catch shadows, always drawn.
  function farScatter(parent, geo, mat, items) {
    const m = scatter(parent, geo, mat, items, false);
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }

  // Copies of one shape that we move every frame (crabs, pigeons, wings...).
  // set(i, x, y, z, ry, rz, s) puts copy number i somewhere.
  // (each gets its own copy of the material: three.js gets confused when one
  // material is shared by copies with and without their own colors)
  function movingCopies(parent, geo, mat, count, shadow) {
    const m = dynamic(new THREE.InstancedMesh(geo, mat.clone(), count));
    m.castShadow = !!shadow;
    m.frustumCulled = false;
    parent.add(m);
    const tmp = new THREE.Object3D();
    return {
      mesh: m,
      set(i, x, y, z, ry, rz, s, rx) {
        tmp.position.set(x, y, z);
        tmp.rotation.set(rx || 0, ry || 0, rz || 0);
        tmp.scale.setScalar(s || 1);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        m.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // A two-sided triangle (for sails and flags), as a geometry.
  function triangleGeo(pts) {
    const [a, b, c] = [pts.slice(0, 3), pts.slice(3, 6), pts.slice(6, 9)];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
    g.computeVertexNormals();
    return g;
  }

  // A triangle "tent" shape (for pointy roofs): 1 long (x), 1 deep (z), 1 tall (y),
  // standing on y = 0.
  let prismCache = null;
  function prismGeo() {
    if (prismCache) return prismCache;
    const A = (x) => [x, 0, -0.5], B = (x) => [x, 0, 0.5], C = (x) => [x, 1, 0];
    const tris = [
      [A(0.5), C(0.5), B(0.5)], [A(-0.5), B(-0.5), C(-0.5)],             // the two ends
      [A(-0.5), C(-0.5), C(0.5)], [A(-0.5), C(0.5), A(0.5)],             // back slope
      [B(-0.5), B(0.5), C(0.5)], [B(-0.5), C(0.5), C(-0.5)],             // front slope
      [A(-0.5), A(0.5), B(0.5)], [A(-0.5), B(0.5), B(-0.5)],             // bottom
    ];
    // make sure every triangle faces outwards
    const pos = [];
    const v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    for (const [p, q, r] of tris) {
      const n = v(q).sub(v(p)).cross(v(r).sub(v(p)));
      const mid = v(p).add(v(q)).add(v(r)).divideScalar(3).sub(new THREE.Vector3(0, 0.33, 0));
      if (n.dot(mid) < 0) pos.push(...p, ...r, ...q); else pos.push(...p, ...q, ...r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    prismCache = g;
    return g;
  }
  const roof = (p, color, x, y, z, w, h, d, o) => put(p, prismGeo(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));

  // A plain (sharp-cornered) box: lighter than a rounded block, good for far details.
  function bx(p, color, x, y, z, w, h, d, o) {
    return put(p, G.box(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));
  }
  // A flat picture (sign, window...). Faces +z unless turned.
  function plane(p, w, h, mat, o) {
    return put(p, new THREE.PlaneGeometry(w, h), mat, Object.assign({ shadow: false }, o));
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
  // Picks a font size so the text fits in maxW pixels.
  function fitFont(ctx, text, maxW, size, weight) {
    let s = size;
    for (;;) {
      ctx.font = (weight || "bold") + " " + s + "px 'Nunito', sans-serif";
      if (ctx.measureText(text).width <= maxW || s <= 10) return s;
      s -= 2;
    }
  }

  // A shop sign: rounded board with a border, an emoji and some text.
  // o = { bg, fg, border, emoji, w, h }
  function signTexture(text, o) {
    const w = o.w || 512, h = o.h || 128;
    return canvasTexture(w, h, (ctx) => {
      ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 10; ctx.strokeStyle = o.border || "#ffffff";
      roundRect(ctx, 8, 8, w - 16, h - 16, 26); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      let tx = w / 2;
      if (o.emoji) {
        ctx.font = Math.round(h * 0.55) + "px sans-serif";
        ctx.fillText(o.emoji, h * 0.55, h / 2 + 4);
        ctx.fillText(o.emoji, w - h * 0.55, h / 2 + 4);
      }
      ctx.fillStyle = o.fg;
      fitFont(ctx, text, w - (o.emoji ? h * 2.3 : 60), Math.round(h * 0.56));
      ctx.fillText(text, tx, h / 2 + 3);
    });
  }

  // Stripes (for awnings, towels, umbrellas, beach balls).
  // colors = list of colors; n stripes; across = stripes go across (horizontal)
  function stripeTexture(colors, n, across, scallop) {
    return canvasTexture(128, 128, (ctx, w, h) => {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = hex(colors[i % colors.length]);
        if (across) ctx.fillRect(0, (i * h) / n, w, h / n + 1);
        else ctx.fillRect((i * w) / n, 0, w / n + 1, h);
      }
      if (scallop) {
        // cut little half-circles out of the bottom edge (for an awning's frilly edge)
        ctx.globalCompositeOperation = "destination-out";
        const r = w / n / 2;
        ctx.fillRect(0, h * 0.62, w, h);
        ctx.globalCompositeOperation = "destination-over";
        ctx.globalCompositeOperation = "source-over";
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = hex(colors[i % colors.length]);
          ctx.beginPath(); ctx.arc((i + 0.5) * (w / n), h * 0.62, r, 0, PI); ctx.fill();
        }
      }
    });
  }

  // One puffy cloud shape, and a ring of them that slowly turns around the sky.
  let cloudGeoCache = null;
  function cloudGeo() {
    if (!cloudGeoCache) {
      cloudGeoCache = bakeGeo((g) => {
        const puff = (x, y, z, s, o) => put(g, G.midSphere(), toon(0xffffff), Object.assign({ x, y, z, s }, o));
        puff(0, 0, 0, 2.2); puff(2.2, -0.4, 0.3, 1.6); puff(-2.1, -0.5, 0, 1.5); puff(0.6, 1.1, 0, 1.4); puff(-0.9, 0.7, 0.6, 1.2);
        puff(0, -0.9, 0, 3.2, { sy: 0.6, sz: 0.5 });
      });
    }
    return cloudGeoCache;
  }
  function cloudRing(parent, anim, mat, o) {
    const r = seeded(o.seed || 1);
    const items = [];
    for (let i = 0; i < o.count; i++) {
      const a = ((i + r() * 0.7) / o.count) * TAU;
      const d = o.rMin + r() * (o.rMax - o.rMin);
      const s = o.sMin + r() * (o.sMax - o.sMin);
      items.push({ x: Math.cos(a) * d, y: o.yMin + r() * (o.yMax - o.yMin), z: Math.sin(a) * d, s, sy: s * (0.75 + r() * 0.3), ry: -a + PI / 2 });
    }
    const ring = dynamic(farScatter(parent, cloudGeo(), mat, items));
    anim.push((t) => { ring.rotation.y = (o.start || 0) + t * o.speed; });
  }
  function skyClouds(root, anim) {
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
    cloudRing(root, anim, cloudMat, { count: 10, rMin: 50, rMax: 72, yMin: 17, yMax: 26, sMin: 0.8, sMax: 1.3, speed: 0.008, seed: 5 });
    cloudRing(root, anim, cloudMat, { count: 13, rMin: 95, rMax: 135, yMin: 24, yMax: 40, sMin: 1.4, sMax: 2.2, speed: 0.005, seed: 9, start: 1 });
    cloudRing(root, anim, cloudMat, { count: 11, rMin: 150, rMax: 190, yMin: 28, yMax: 52, sMin: 2.4, sMax: 3.4, speed: 0.003, seed: 13, start: 2 });
  }

  // A material that paints rows of windows onto any box (using where each bit
  // of the box is in the world, so tall and short buildings get the same size
  // windows). Copies can each have their own wall color.
  function windowMaterial(o) {
    o = o || {};
    const mat = new THREE.MeshToonMaterial({ color: o.color || 0xffffff, gradientMap: gradient });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.winSize = { value: new THREE.Vector2(o.w || 2.4, o.h || 3.4) };
      sh.uniforms.winGlass = { value: new THREE.Color(o.glass || 0x8fd0ff) };
      sh.uniforms.winLit = { value: new THREE.Color(o.lit || 0xfff1a8) };
      sh.uniforms.winMinY = { value: o.minY === undefined ? -1000 : o.minY };
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
      sh.fragmentShader = "uniform vec2 winSize;\nuniform vec3 winGlass;\nuniform vec3 winLit;\nuniform float winMinY;\nvarying vec3 vWinPos;\nvarying vec3 vWinN;\n" +
        sh.fragmentShader.replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float winAmt = 0.0;",
          "vec3 winCol = winGlass;",
          "if (abs(vWinN.y) < 0.5 && vWinPos.y > winMinY) {", // only on the walls, not the roof
          "  float u = abs(vWinN.x) > abs(vWinN.z) ? vWinPos.z : vWinPos.x;",
          "  vec2 cell = vec2(u, vWinPos.y) / winSize;",
          "  vec2 f = fract(cell);",
          "  winAmt = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.8);",
          "  float frame = winAmt * (1.0 - step(0.26, f.x) * step(f.x, 0.74) * step(0.34, f.y) * step(f.y, 0.76));",
          "  float rnd = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);",
          "  winCol = rnd > 0.87 ? winLit : mix(winGlass, vec3(1.0), f.y * 0.35);",
          "  winCol = mix(winCol, vec3(1.0), frame);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, winCol, winAmt);",
          "}",
        ].join("\n")).replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += winCol * winAmt * 0.2;");
    };
    return mat;
  }

  // Far-away trees and palms (low detail, for painted scenery).
  function farTree(p, x, z, s, colors, y) {
    const t = group(p, x, y || 0, z, 0, s);
    cylinder(t, 0x9a6a3c, 0, 0.5, 0, 0.22, 2.6, { seg: 6, shadow: false });
    put(t, G.tinySphere(), toon(colors ? colors[0] : 0x4fbf47), { y: 2.4, s: 1.2, shadow: false });
    put(t, G.tinySphere(), toon(colors ? colors[1] : 0x7fdc5c), { x: 0.4, y: 2.9, z: 0.3, s: 0.75, shadow: false });
    return t;
  }
  function farPalm(p, x, z, s, lean, y) {
    const t = group(p, x, y || 0, z, lean, s);
    for (let i = 0; i < 4; i++) put(t, G.taper(0.2 - i * 0.02, 0.24 - i * 0.02, 6), toon(i % 2 ? 0xb88a55 : 0xa47a48), { x: i * i * 0.06, y: 0.5 + i * 0.95, sy: 1.0, rz: -0.1 * i, shadow: false });
    const top = 4.0;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      put(t, G.tinySphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: 0.6 + Math.cos(a) * 0.9, y: top, z: Math.sin(a) * 0.9, sx: 1.1, sy: 0.12, sz: 0.38, ry: -a, rz: -0.35, shadow: false });
    }
    return t;
  }

  // A strip lying on the ground that follows a wiggly line z = fn(x).
  // The strip goes from fn(x) + a to fn(x) + b (a < b), at heights ya and yb.
  function ribbonGeo(fn, x0, x1, n, a, b, ya, yb) {
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = fn(x);
      pos.push(x, ya, z + a, x, yb === undefined ? ya : yb, z + b);
    }
    for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // A rope hanging between two points, as a list of points along the sag.
  function sagPoints(a, b, sag, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - Math.sin(k * PI) * sag, a.z + (b.z - a.z) * k));
    }
    return pts;
  }
  // A thin rope through some points (as one tube shape).
  function rope(p, pts, color, r) {
    const curve = new THREE.CatmullRomCurve3(pts);
    return put(p, new THREE.TubeGeometry(curve, pts.length * 2, r || 0.025, 5, false), toon(color), { shadow: false });
  }

  // Seagulls gliding in circles, with flapping wings. Wings and bodies are
  // copies of one shape each, so all the gulls take just two draw calls.
  function seagulls(root, anim, list) {
    const n = list.length;
    const wingGeo = new THREE.SphereGeometry(1, 8, 4);
    wingGeo.translate(1, 0, 0); // the wing turns around its shoulder
    const bodies = movingCopies(root, G.lowSphere(), toon(0xffffff), n);
    const wings = movingCopies(root, wingGeo, toon(0xf4f4f4), n * 2);
    const tmp = new THREE.Object3D();
    anim.push((t) => list.forEach((g, i) => {
      const a = t * g.speed + g.start;
      const x = g.x + Math.cos(a) * g.rx, z = g.z + Math.sin(a) * g.rz, y = g.y + Math.sin(t * 0.7 + i) * 0.6;
      const heading = Math.atan2(-Math.sin(a) * g.rx * Math.sign(g.speed), Math.cos(a) * g.rz * Math.sign(g.speed));
      // body: a stretched ball pointing the way it flies
      tmp.position.set(x, y, z); tmp.rotation.set(0, heading, 0); tmp.scale.set(0.14, 0.14, 0.32); tmp.updateMatrix();
      bodies.mesh.setMatrixAt(i, tmp.matrix);
      const flap = Math.sin(t * 6 + i * 1.7) * 0.5;
      for (const side of [-1, 1]) {
        tmp.position.set(x, y + 0.03, z);
        tmp.rotation.set(0, heading + (side < 0 ? PI : 0), flap, "YXZ"); // (the left wing is the right one turned round)
        tmp.scale.set(0.45, 0.04, 0.13);
        tmp.updateMatrix();
        wings.mesh.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), tmp.matrix);
      }
    }));
    anim.push(() => { bodies.mesh.instanceMatrix.needsUpdate = true; wings.mesh.instanceMatrix.needsUpdate = true; });
  }

  // A painted sailboat (front points along +z).
  function sailboatGeo(sail, stripe) {
    return bakeGeo((b) => {
      block(b, 0xffffff, 0, 0.15, -0.2, 1.2, 0.6, 2.6, 0.25);
      ball(b, 0xffffff, 0, 0.15, 1.05, 0.6, { sx: 1, sy: 0.5, sz: 1.3 });
      block(b, stripe, 0, 0.32, -0.2, 1.24, 0.1, 2.62, 0.04);
      block(b, 0xd9a06a, 0, 0.47, -0.3, 1.0, 0.06, 2.2, 0.03);
      cylinder(b, 0x9a6a3c, 0, 2.2, 0.1, 0.06, 3.4, { seg: 8 });
      put(b, triangleGeo([0, 0.75, 0.05, 0, 3.75, 0.05, 0, 0.8, -1.35]), toon(sail));
      put(b, triangleGeo([0, 3.5, 0.2, 0, 0.75, 0.25, 0, 0.75, 1.35]), toon(0xffffff));
    });
  }

  // =====================================================================
  // BEACH — sand, sea, a pier, and a little seaside town behind the dunes
  // =====================================================================
  // The sea is at the back (towards -z), the town is behind the camera (+z).
  function buildBeach() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xd6f0ff, ground: 0xf5dfa4, hemi: 0.55, sun: 0.95, ambient: 0.28 });
    skyDome(root, 0x3fa9f5, 0xcdeeff, 0x3fb6e8);

    const SEA_Y = -0.35; // the water level (the sand is at 0)
    // Where the dry sand ends, for each x. A gentle wiggle in the middle, and at
    // the sides the land curves out into the sea (so the beach is a cozy bay).
    const shore = (x) => {
      let z = -4.6 + 0.25 * Math.sin(x * 0.5) + 0.1 * Math.sin(x * 1.3 + 1);
      const ax = Math.abs(x);
      if (ax > 22) z -= (ax - 22) * (ax - 22) * 0.025;
      return Math.max(z, -170);
    };
    const SAND = 0xedce8c;

    // ---------- the sea ----------
    const waveTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#3db3e6"; ctx.fillRect(0, 0, w, h);
      const r = seeded(4);
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 14; i++) {
        const x = r() * w, y = r() * h;
        ctx.beginPath(); ctx.arc(x, y, 9, PI * 1.15, PI * 1.85); ctx.stroke();
      }
    }, [30, 30]);
    dynamic(disc(root, toon(0xffffff, { map: waveTex }), 0, SEA_Y, 0, 245, { receive: true }));
    anim.push((t) => { waveTex.offset.set(t * 0.003, t * 0.006); });
    // shallow water near the beach is lighter (two bands)
    put(root, ribbonGeo(shore, -75, 75, 600, -5.0, -2.4, SEA_Y + 0.008), toon(0x5fcbe8), { shadow: false });
    put(root, ribbonGeo(shore, -75, 75, 600, -2.4, -0.4, SEA_Y + 0.012), toon(0x8ee3e2), { shadow: false });
    // the wet sand slopes down into the water
    put(root, ribbonGeo(shore, -75, 75, 600, -0.9, 0, -0.5, 0), toon(0xe8c88c), { shadow: false });
    put(root, ribbonGeo(shore, -75, 75, 600, 0, 0.55, 0.004), toon(0xeed29a), { shadow: false });

    // foam lapping at the water's edge, and wave crests rolling in
    const foamMat = toon(0xffffff, { transparent: true, opacity: 0.85 });
    const foam = dynamic(put(root, ribbonGeo(shore, -75, 75, 600, -0.85, -0.5, SEA_Y + 0.02), foamMat, { shadow: false }));
    anim.push((t) => {
      foam.position.z = Math.sin(t * 0.9) * 0.22;
      foamMat.opacity = 0.7 + Math.sin(t * 0.9 + 1) * 0.15;
    });
    const crests = [0, 1, 2].map((i) => {
      const mat = toon(0xffffff, { transparent: true, opacity: 0.6 });
      const m = dynamic(put(root, ribbonGeo(shore, -60, 60, 400, -4.4 - (i % 2) * 0.3, -4.15 - (i % 2) * 0.3, SEA_Y + 0.016), mat, { shadow: false }));
      return { m, mat, i };
    });
    anim.push((t) => crests.forEach(({ m, mat, i }) => {
      const k = (t * 0.14 + i / 3) % 1;
      m.position.z = k * 3.3;
      mat.opacity = Math.sin(k * PI) * 0.75;
    }));

    // ---------- sand and grass ----------
    const sandTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = hex(SAND); ctx.fillRect(0, 0, w, h);
      const r = seeded(21);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = r() < 0.5 ? "rgba(200,160,95,0.45)" : "rgba(255,244,214,0.7)";
        ctx.beginPath(); ctx.arc(r() * w, r() * h, 1 + r() * 1.6, 0, TAU); ctx.fill();
      }
    });
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(0.14, 0.14);
    // (a flat shape is drawn in x/y and laid down, so its y becomes -z)
    const sandShape = new THREE.Shape();
    sandShape.moveTo(-75, -shore(-75));
    for (let x = -74.75; x <= 75; x += 0.25) sandShape.lineTo(x, -shore(x));
    sandShape.lineTo(75, -40); sandShape.lineTo(-75, -40);
    put(root, new THREE.ShapeGeometry(sandShape), toon(0xffffff, { map: sandTex }), { rx: -PI / 2, shadow: false });
    const grassShape = new THREE.Shape();
    grassShape.moveTo(-250, -shore(-250));
    for (let x = -248; x <= 250; x += 2) grassShape.lineTo(x, -shore(x));
    grassShape.lineTo(250, -250); grassShape.lineTo(-250, -250);
    put(root, new THREE.ShapeGeometry(grassShape), toon(0x8fd16f), { y: -0.03, rx: -PI / 2, shadow: false, receive: false });

    // ---------- the wooden pier ----------
    const PX = 10, PZ0 = -3.4, PZ1 = -13.5; // the middle line, where it starts and ends
    const planks = [];
    for (let z = PZ0; z >= PZ1; z -= 0.32) planks.push({ x: PX, y: -0.01, z, sx: 2.8, sy: 0.1, sz: 0.27, color: (Math.round(z * 3) % 3) ? 0xd9a06a : 0xc98f5a });
    scatter(root, G.box(), toon(0xffffff), planks, true);
    const posts = [], legs = [];
    for (let z = PZ0 - 0.2; z >= PZ1 - 0.01; z -= 1.5) {
      for (const side of [-1, 1]) {
        posts.push({ x: PX + side * 1.32, y: 0.45, z, sx: 0.09, sy: 0.9, sz: 0.09 });
        if (z < -4.6) legs.push({ x: PX + side * 1.2, y: -0.7, z, sx: 0.13, sy: 1.4, sz: 0.13 });
      }
    }
    scatter(root, G.cyl(8), toon(0xa86b3c), posts, true);
    scatter(root, G.cyl(8), toon(0x8a5a32), legs, false);
    for (const side of [-1, 1]) {
      for (const y of [0.55, 0.92]) block(root, 0xc98f5a, PX + side * 1.32, y, (PZ0 + PZ1) / 2 - 0.1, 0.08, 0.08, PZ0 - PZ1 + 0.2, 0.03);
    }
    // a lifebuoy on a post, and a lamp at the end
    put(root, G.torus(0.28, 0.08), toon(0xff5a5a), { x: PX - 1.4, y: 0.6, z: -7.6, ry: PI / 2 });
    lampPost(root, PX + 1.32, PZ1 + 0.3);
    lampPost(root, PX - 1.32, PZ1 + 0.3);
    // a fishing rod leaning over the railing, with a bobber on the water
    const rodBase = new THREE.Vector3(PX + 1.25, 0.9, -12.2), rodTip = new THREE.Vector3(PX + 3.2, 2.4, -12.2);
    const rodLen = rodBase.distanceTo(rodTip);
    cylinder(root, 0x3d4a5c, (rodBase.x + rodTip.x) / 2, (rodBase.y + rodTip.y) / 2, -12.2, 0.025, rodLen, { rz: -Math.atan2(rodTip.x - rodBase.x, rodTip.y - rodBase.y) });
    cylinder(root, 0xeeeeee, rodTip.x, (rodTip.y + SEA_Y) / 2, -12.2, 0.006, rodTip.y - SEA_Y, { shadow: false });
    const bobber = dynamic(group(root, rodTip.x, SEA_Y, -12.2));
    ball(bobber, 0xff4b4b, 0, 0.08, 0, 0.09);
    ball(bobber, 0xffffff, 0, 0.0, 0, 0.09, { sy: 0.6 });
    anim.push((t) => { bobber.position.y = SEA_Y + Math.sin(t * 2.2) * 0.04 - (Math.sin(t * 0.37) > 0.93 ? 0.12 : 0); });
    block(root, 0x4a90e2, PX - 0.95, 0.22, -12.6, 0.36, 0.36, 0.36, 0.06); // bait bucket
    // a little rowing boat tied to the pier
    const rowboat = mover(root, (b) => {
      block(b, 0xffffff, 0, 0.0, 0, 1.1, 0.45, 2.4, 0.2);
      block(b, 0x4a90e2, 0, 0.12, 0, 1.14, 0.12, 2.44, 0.05);
      block(b, 0xc98f5a, 0, 0.2, 0, 0.9, 0.06, 2.1, 0.03);
      block(b, 0xa86b3c, 0, 0.3, 0.3, 1.0, 0.08, 0.3, 0.03);
      cylinder(b, 0xa86b3c, 0.3, 0.32, -0.5, 0.03, 1.6, { rz: 1.2, rx: 0.2 });
    }, true);
    anim.push((t) => {
      rowboat.position.set(PX + 2.3, SEA_Y + 0.1 + Math.sin(t * 1.3) * 0.05, -8.6);
      rowboat.rotation.set(Math.sin(t * 1.1) * 0.03, 0.12, Math.sin(t * 1.3 + 1) * 0.05);
    });

    // ---------- the boardwalk over the dunes (where Miis arrive) ----------
    const BWX = -1;
    const boards = [];
    for (let z = 5.6; z <= 26; z += 0.34) boards.push({ x: BWX, y: 0.0, z, sx: 2.2, sy: 0.08, sz: 0.28, color: (Math.round(z * 3) % 2) ? 0xd9a06a : 0xcf9762 });
    scatter(root, G.box(), toon(0xffffff), boards, true);
    // "Mii Beach" sign by the boardwalk
    const SG = { x: 1.6, z: 9.0 };
    const sign = group(root, SG.x, 0, SG.z, -0.2);
    // (the posts stand behind the board, so they don't poke through it)
    cylinder(sign, 0x9a6a3c, -0.9, 0.8, -0.14, 0.08, 1.6);
    cylinder(sign, 0x9a6a3c, 0.9, 0.8, -0.14, 0.08, 1.6);
    block(sign, toon(0xffffff, { map: signTexture("Mii Beach", { bg: "#3fb6e8", fg: "#ffffff", w: 384, h: 128 }) }), 0, 1.35, 0, 2.2, 0.75, 0.1, 0.04);

    // ---------- lifeguard tower ----------
    const LG = { x: -3, z: -2.4 };
    const lg = group(root, LG.x, 0, LG.z);
    const lgRed = 0xff5a5a;
    for (const [sx, sz] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) cylinder(lg, 0xffffff, sx, 1.0, sz, 0.08, 2.0);
    for (const sz of [-0.75, 0.75]) block(lg, 0xffffff, 0, 0.9, sz, 1.5, 0.06, 0.06, 0.02, { rz: 0.9 });
    block(lg, 0xd9a06a, 0, 1.98, 0, 1.95, 0.14, 1.95, 0.04);
    for (const [sx, sz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) cylinder(lg, 0xffffff, sx, 3.35, sz, 0.05, 2.6);
    block(lg, lgRed, 0, 2.6, -0.92, 1.85, 1.1, 0.08, 0.03);                // back wall
    for (const sx of [-0.92, 0.92]) block(lg, 0xffffff, sx, 2.45, 0, 0.06, 0.06, 1.85, 0.02); // side rails
    block(lg, toon(0xffffff, { map: signTexture("LIFEGUARD", { bg: "#ff5a5a", fg: "#ffffff", w: 384, h: 96 }) }), 0, 2.35, 0.93, 1.86, 0.5, 0.06, 0.02);
    put(lg, G.cone(4), toon(lgRed), { y: 4.95, sx: 1.7, sy: 0.8, sz: 1.7, ry: PI / 4 });
    put(lg, G.cone(4), toon(0xffffff), { y: 4.62, sx: 1.72, sy: 0.15, sz: 1.72, ry: PI / 4 });
    cylinder(lg, 0xffffff, 0, 5.8, 0, 0.03, 1.2);
    put(lg, triangleGeo([0, 6.35, 0, 0, 6.0, 0, 0.6, 6.17, 0]), toon(0xffcf3a));
    // ladder up the front
    for (const sx of [-0.35, 0.35]) block(lg, 0xffffff, sx, 1.0, 1.25, 0.07, 2.2, 0.07, 0.02, { rx: 0.27 });
    for (let i = 0; i < 5; i++) block(lg, 0xffffff, 0, 0.3 + i * 0.4, 1.43 - i * 0.107, 0.7, 0.05, 0.08, 0.02);
    put(lg, G.torus(0.26, 0.07), toon(0xff7a2b), { x: 0.82, y: 1.45, z: 0.82, ry: PI / 4 });

    // ---------- beach volleyball ----------
    const VB = { x: -9.6, z: 0.8 };
    const netTex = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    });
    for (const sx of [-3.2, 3.2]) cylinder(root, 0x3d4a5c, VB.x + sx, 1.3, VB.z, 0.07, 2.6);
    plane(root, 6.3, 0.85, toon(0xffffff, { map: netTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 }), { x: VB.x, y: 1.95, z: VB.z });
    block(root, 0xffffff, VB.x, 2.4, VB.z, 6.4, 0.09, 0.05, 0.02);
    block(root, 0xffffff, VB.x, 1.52, VB.z, 6.4, 0.03, 0.03, 0.01);
    // court lines (blue ropes on the sand)
    for (const sz of [-3.0, 3.0]) block(root, 0x4a90e2, VB.x, 0.02, VB.z + sz, 7.2, 0.03, 0.08, 0.01, { shadow: false });
    for (const sx of [-3.6, 3.6]) block(root, 0x4a90e2, VB.x + sx, 0.02, VB.z, 0.08, 0.03, 6.0, 0.01, { shadow: false });
    // the volleyball flies over the net between the two players
    const vball = dynamic(ball(root, 0xffffff, 0, 0, 0, 0.17));
    const vbA = { x: VB.x - 1.2, z: VB.z - 1.7 }, vbB = { x: VB.x + 1.2, z: VB.z + 1.7 };
    anim.push((t) => {
      const k = (t * 0.45) % 2, f = k < 1 ? k : 2 - k; // 0..1..0
      vball.position.set(vbA.x + (vbB.x - vbA.x) * f, 2.75 + Math.sin(f * PI) * 2.2, vbA.z + (vbB.z - vbA.z) * f);
      vball.rotation.set(t * 3, t * 2, 0);
    });

    // ---------- towels with beach umbrellas ----------
    const towels = [
      { x: 1.2, z: 1.4, colors: [0xff6fa5, 0xffffff], umbrella: [0xff6fa5, 0xffffff] },
      { x: 5.0, z: 3.7, colors: [0x4a90e2, 0xffe25a], umbrella: [0xffcf3a, 0x4a90e2] },
      { x: -6.4, z: -3.6, colors: [0x5cc84a, 0xffffff], umbrella: [0xff7a59, 0xffffff] },
    ];
    for (const T of towels) {
      block(root, toon(0xffffff, { map: stripeTexture(T.colors, 8, false) }), T.x, 0.015, T.z, 2.4, 0.03, 1.2, 0.01, { shadow: false });
      block(root, T.colors[0], T.x + 1.0, 0.09, T.z, 0.35, 0.16, 1.0, 0.08); // rolled-up towel pillow
      const ux = T.x + 0.95, uz = T.z - 0.85;
      cylinder(root, 0xffffff, ux, 1.4, uz, 0.045, 2.8, { rx: 0.1 });
      put(root, G.cone(16), toon(0xffffff, { map: stripeTexture(T.umbrella, 8, false) }), { x: ux, y: 2.85, z: uz + 0.14, sx: 1.7, sy: 0.55, sz: 1.7, rx: 0.1 });
      ball(root, T.umbrella[0], ux, 3.16, uz + 0.17, 0.07);
      T.pole = { x: ux, z: uz };
    }
    // sunglasses, a book and a drink by the towels
    block(root, 0x333333, 1.6, 0.04, 2.35, 0.36, 0.05, 0.1, 0.02);
    block(root, 0x4a90e2, 4.2, 0.05, 4.65, 0.4, 0.08, 0.3, 0.02, { ry: 0.4 });
    cylinder(root, 0xff9a3a, 6.3, 0.15, 4.5, 0.07, 0.28);
    cylinder(root, 0xffffff, 6.33, 0.36, 4.5, 0.01, 0.2, { rz: 0.3 });

    // ---------- deck chairs facing the sun (towards the camera) ----------
    const chairFabric = toon(0xffffff, { map: stripeTexture([0x4fb7c9, 0xffffff], 6, false) });
    const chairs = [{ x: 8.8, z: 5.6 }, { x: 11.0, z: 5.6 }];
    for (const C of chairs) {
      const c = group(root, C.x, 0, C.z);
      for (const sx of [-0.33, 0.33]) {
        block(c, 0xd9a06a, sx, 0.22, 0.3, 0.06, 0.45, 0.06, 0.02, { rx: -0.3 });
        block(c, 0xd9a06a, sx, 0.22, -0.2, 0.06, 0.45, 0.06, 0.02, { rx: 0.3 });
        block(c, 0xd9a06a, sx, 0.42, 0.08, 0.06, 0.06, 0.8, 0.02);
        block(c, 0xd9a06a, sx, 0.85, -0.42, 0.06, 0.95, 0.06, 0.02, { rx: -0.35 });
        block(c, 0xd9a06a, sx, 0.6, 0.15, 0.06, 0.05, 0.5, 0.02); // arm rests
      }
      block(c, chairFabric, 0, 0.42, 0.08, 0.62, 0.05, 0.72, 0.02);
      block(c, chairFabric, 0, 0.88, -0.42, 0.62, 0.9, 0.05, 0.02, { rx: -0.35 });
    }
    // a little table with coconut drinks, and an umbrella between the chairs
    const tbl = { x: 9.9, z: 5.9 };
    cylinder(root, 0xffffff, tbl.x, 0.3, tbl.z, 0.05, 0.6);
    cylinder(root, 0xffffff, tbl.x, 0.6, tbl.z, 0.3, 0.05);
    ball(root, 0x8a5a32, tbl.x - 0.1, 0.72, tbl.z, 0.12);
    cylinder(root, 0xff6fa5, tbl.x - 0.1, 0.88, tbl.z, 0.012, 0.25, { rz: 0.3 });
    cylinder(root, 0xffffff, tbl.x, 1.45, tbl.z - 0.5, 0.045, 2.9);
    put(root, G.cone(16), toon(0xffffff, { map: stripeTexture([0x4fb7c9, 0xffffff], 8, false) }), { x: tbl.x, y: 2.95, z: tbl.z - 0.5, sx: 1.8, sy: 0.55, sz: 1.8 });

    // ---------- ice-cream stand (its counter faces -x) ----------
    const IC = { x: 12.6, z: 1.0 };
    const ic = group(root, IC.x, 0, IC.z, -PI / 2);
    block(ic, 0xffffff, 0, 0.75, 0, 2.3, 1.0, 1.1, 0.12);
    plane(ic, 2.1, 0.7, toon(0xffffff, { map: signTexture("ICE CREAM", { bg: "#ff8fb8", fg: "#ffffff", emoji: "🍦", w: 512, h: 160 }) }), { y: 0.78, z: 0.56 });
    block(ic, 0xffb3cf, 0, 1.3, 0.05, 2.45, 0.1, 1.25, 0.04);
    for (const sx of [-0.95, 0.95]) cylinder(ic, 0x3d4a5c, sx, 0.25, 0.56, 0.24, 0.12, { rx: PI / 2 }); // wheels
    // tubs of ice cream in the counter
    [0xffb3cf, 0xfff1b8, 0x9be7c4, 0x8a5a32, 0xffffff].forEach((c, i) => {
      cylinder(ic, 0xdddddd, -0.8 + i * 0.4, 1.38, 0.1, 0.16, 0.08);
      ball(ic, c, -0.8 + i * 0.4, 1.42, 0.1, 0.14, { sy: 0.55 });
    });
    for (const sx of [-1.1, 1.1]) cylinder(ic, 0xffffff, sx, 2.05, -0.45, 0.05, 1.5);
    block(ic, toon(0xffffff, { map: stripeTexture([0xff8fb8, 0xffffff], 8, false) }), 0, 2.85, 0.05, 2.6, 0.08, 1.6, 0.03, { rx: 0.2 });
    // a giant cone on the roof
    put(ic, G.cone(14), toon(0xe6b36a), { y: 3.45, s: 0.32, sy: 0.75, rx: PI });
    ball(ic, 0xffb3cf, 0, 3.92, 0, 0.36);
    ball(ic, 0x9be7c4, 0, 4.3, 0, 0.3);
    ball(ic, 0xff3b3b, 0, 4.62, 0, 0.09);

    // ---------- sandcastles ----------
    const SC = { x: -5.6, z: 5.0 };
    const sc = group(root, SC.x, 0, SC.z);
    const castleSand = 0xe6c483;
    ball(sc, castleSand, 0, 0.0, 0, 1.0, { sy: 0.35 });
    cylinder(sc, castleSand, 0, 0.55, 0, 0.36, 0.8);
    put(sc, G.cone(12), toon(castleSand), { y: 1.15, s: 0.38, sy: 0.4 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      cylinder(sc, castleSand, Math.cos(a) * 0.62, 0.38, Math.sin(a) * 0.62, 0.17, 0.5);
      for (let k = 0; k < 4; k++) block(sc, castleSand, Math.cos(a) * 0.62 + Math.cos(k * PI / 2) * 0.13, 0.67, Math.sin(a) * 0.62 + Math.sin(k * PI / 2) * 0.13, 0.08, 0.08, 0.08, 0.02);
    }
    cylinder(sc, 0x3d4a5c, 0, 1.55, 0, 0.012, 0.5, { shadow: false });
    put(sc, triangleGeo([0, 1.78, 0, 0, 1.58, 0, 0.3, 1.68, 0]), toon(0xff5a5a));
    put(sc, G.torus(1.12, 0.07), toon(0xc9a86a), { y: 0.01, rx: PI / 2, shadow: false }); // moat edge
    // a bucket and spade
    put(root, G.taper(0.2, 0.15), toon(0xff5a5a), { x: SC.x + 1.4, y: 0.17, z: SC.z + 0.3, sy: 0.34 });
    put(root, G.torus(0.17, 0.015), toon(0xffcf3a), { x: SC.x + 1.4, y: 0.38, z: SC.z + 0.3, rx: 0.3 });
    block(root, 0x4a90e2, SC.x - 1.3, 0.05, SC.z + 0.6, 0.2, 0.04, 0.3, 0.02, { ry: 0.5 });
    cylinder(root, 0xffcf3a, SC.x - 1.15, 0.06, SC.z + 0.95, 0.02, 0.5, { rx: PI / 2, ry: 0.5, shadow: false });
    // a second, smaller castle (a bucket-shaped tower) nearby
    put(root, G.taper(0.25, 0.32), toon(castleSand), { x: SC.x + 2.3, y: 0.2, z: SC.z - 0.6, sy: 0.4 });
    put(root, G.taper(0.15, 0.22), toon(castleSand), { x: SC.x + 2.3, y: 0.55, z: SC.z - 0.6, sy: 0.3 });

    // ---------- surfboards ----------
    const SB = { x: -13.9, z: -3.1 };
    const boardColors = [[0xff7a59, 0xffffff], [0x4fb7c9, 0xffe25a], [0xb58cff, 0xffffff]];
    boardColors.forEach(([c1, c2], i) => {
      const bx2 = SB.x + (i - 1) * 0.65, rz = (i - 1) * 0.12;
      ball(root, c1, bx2, 1.05, SB.z + (i % 2) * 0.25, 1, { sx: 0.3, sy: 1.2, sz: 0.06, rz });
      ball(root, c2, bx2, 1.05, SB.z + (i % 2) * 0.25, 1, { sx: 0.07, sy: 1.18, sz: 0.065, rz, shadow: false });
    });
    // one lying flat on the sand, to practice on
    const SF = { x: -13.6, z: 5.4 };
    ball(root, 0xffcf3a, SF.x, 0.07, SF.z, 1, { sx: 1.3, sy: 0.06, sz: 0.34 });
    ball(root, 0xff5a5a, SF.x, 0.08, SF.z, 1, { sx: 1.28, sy: 0.062, sz: 0.06, shadow: false });

    // ---------- beach balls, shells and starfish ----------
    const ballMat = toon(0xffffff, { map: stripeTexture([0xff5a5a, 0xffffff, 0x4a90e2, 0xffffff, 0xffcf3a, 0xffffff], 6, false) });
    const balls = [{ x: 3.4, z: 6.0 }, { x: -3.0, z: 7.2 }, { x: 7.6, z: 1.6 }];
    balls.forEach((b, i) => put(root, G.sphere(), ballMat, { x: b.x, y: 0.3, z: b.z, s: 0.3, ry: i * 1.3, rz: 0.4 }));
    const shellR = seeded(31);
    const shells = [], stars = [];
    for (let i = 0; i < 70; i++) {
      const x = -17 + shellR() * 34, z = shore(x) + 0.4 + Math.pow(shellR(), 2) * 6;
      if (Math.abs(x - PX) < 1.7 && z < -2) continue;
      if (Math.abs(x - BWX) < 1.4 && z > 5) continue;
      shells.push({ x, y: 0.02, z, s: 0.07 + shellR() * 0.05, sy: 0.04, ry: shellR() * 6, color: [0xffd6e0, 0xffffff, 0xffc7a0, 0xf5b8d0][i % 4] });
    }
    // extra shells where the "collecting shells" spot is
    for (let i = 0; i < 10; i++) shells.push({ x: 6.5 + (shellR() - 0.5) * 2.4, y: 0.02, z: -3.8 + shellR() * 1.2, s: 0.08 + shellR() * 0.05, sy: 0.04, ry: shellR() * 6, color: [0xffd6e0, 0xffffff, 0xffc7a0][i % 3] });
    scatter(root, G.sphere(), toon(0xffffff), shells);
    for (const [x, z, c] of [[7.6, -3.3, 0xff7a59], [-9.6, -3.6, 0xffa23a], [-0.5, -3.7, 0xff6fa5]]) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        stars.push({ x: x + Math.cos(a) * 0.1, y: 0.03, z: z + Math.sin(a) * 0.1, sx: 0.14, sy: 0.03, sz: 0.05, ry: -a, color: c });
      }
    }
    scatter(root, G.lowSphere(), toon(0xffffff), stars);

    // ---------- palm trees ----------
    const palms = [[-15.6, 7.4, 1.0, 0.4], [-12.6, 9.4, 0.9, 2.0], [16.2, 9.4, 1.05, 3.6], [15.6, 6.4, 0.95, 5.0], [-16.4, -3.4, 1.1, 1.0], [15.8, -2.4, 1.0, 4.2], [13.4, 8.8, 0.85, 2.6]];
    palms.forEach(([x, z, s, l]) => palmTree(root, x, z, s, l));

    // ---------- crabs scuttling sideways along the shore ----------
    const crabGeo = bakeGeo((c) => {
      ball(c, 0xff5a3a, 0, 0.12, 0, 0.16, { sx: 1.3, sy: 0.6 });
      for (const sx of [-1, 1]) {
        ball(c, 0xff5a3a, sx * 0.25, 0.14, 0.12, 0.07, { sx: 1.3 });       // claws
        cylinder(c, 0xff5a3a, sx * 0.06, 0.24, 0.08, 0.015, 0.12);          // eye stalks
        ball(c, 0xffffff, sx * 0.06, 0.31, 0.08, 0.035);
        ball(c, 0x222222, sx * 0.06, 0.31, 0.11, 0.018);
        for (let k = 0; k < 3; k++) cylinder(c, 0xe0472a, sx * 0.22, 0.06, -0.06 + k * 0.07, 0.015, 0.16, { rz: sx * 1.1 });
      }
    });
    const crabList = [{ x: 4.5, z: -3.7, range: 2.2, speed: 0.6 }, { x: -9.0, z: -3.5, range: 1.6, speed: 0.8 }, { x: 13.5, z: -3.3, range: 1.2, speed: 0.5 }];
    const crabs = movingCopies(root, crabGeo, paintedMat, crabList.length, true);
    anim.push((t) => crabList.forEach((c, i) => {
      // they walk a bit, stop, then walk back (crabs are busy!)
      const p = Math.sin(t * c.speed + i * 2) + 0.3 * Math.sin(t * c.speed * 3.1 + i);
      const x = c.x + p * c.range;
      crabs.set(i, x, Math.abs(Math.sin(t * 14 + i)) * 0.02, shore(x) + 0.9 + (c.z - -3.6) * 0.3, Math.sin(t * 0.3 + i) * 0.3, Math.sin(t * 16 + i) * 0.06);
    }));

    // ---------- seagulls (flying, and one standing on the pier) ----------
    seagulls(root, anim, [
      { x: 0, z: -14, rx: 22, rz: 9, y: 10, speed: 0.17, start: 0 },
      { x: 6, z: -18, rx: 16, rz: 7, y: 12, speed: -0.13, start: 2 },
      { x: -8, z: -10, rx: 12, rz: 6, y: 8.5, speed: 0.2, start: 4 },
    ]);
    const gull = dynamic(group(root, PX - 1.32, 0.92, -9.4 + 0.0));
    ball(gull, 0xffffff, 0, 0.18, 0, 0.16, { sz: 1.5 });
    ball(gull, 0xb9c3cf, 0, 0.22, -0.04, 0.12, { sx: 1.3, sz: 1.4, sy: 0.6 });
    const gullHead = group(gull, 0, 0.36, 0.17);
    ball(gullHead, 0xffffff, 0, 0, 0, 0.1);
    put(gullHead, G.cone(), toon(0xffb02b), { z: 0.13, s: 0.05, sy: 0.14, rx: PI / 2 });
    ball(gullHead, 0x222222, 0.06, 0.03, 0.05, 0.02);
    ball(gullHead, 0x222222, -0.06, 0.03, 0.05, 0.02);
    for (const sx of [-0.05, 0.05]) cylinder(gull, 0xffb02b, sx, 0.03, 0, 0.012, 0.08);
    gull.rotation.y = PI / 2;
    anim.push((t) => { gullHead.rotation.y = Math.sin(t * 0.8) > 0.4 ? 0.7 : (Math.sin(t * 0.8) < -0.6 ? -0.6 : 0); gullHead.rotation.x = Math.sin(t * 3) > 0.97 ? 0.4 : 0; });

    // ---------- scenery all around ----------
    beachScenery(root, anim, shore, SEA_Y, BWX);
    skyClouds(root, anim);

    mergeStatic(root);

    // ---------- where Miis can't go ----------
    // The sea (with a gap for the pier), and the things on the sand.
    const SEA_EDGE = -4.9;
    const seaL = { x: (-18 + PX - 1.2) / 2, z: (SEA_EDGE - 14) / 2, w: PX - 1.2 + 18, d: 14 + SEA_EDGE };
    const seaR = { x: (PX + 1.2 + 18) / 2, z: seaL.z, w: 18 - PX - 1.2, d: seaL.d };
    const chairSpot = (C, lines, emoji) => ({
      x: C.x, z: C.z + 1.25, yaw: 0, arms: "eat", emoji, activity: "relaxing in a deck chair",
      seat: { x: C.x, z: C.z + 0.08, y: 0.45 - 0.56 }, lines,
    });
    const towelSpot = (T, activity, lines) => ({
      x: T.x - 0.4, z: T.z + 1.25, yaw: 0, emoji: "😎", activity,
      lie: { x: T.x, z: T.z, y: 0.03, yaw: PI / 2 }, lines,
    });

    const beach = {
      group: root,
      background: 0xcdeeff,
      fog: [0xd8f2ff, 90, 270],
      cameraTilt: 0.44,
      cameraMaxDistance: 30, // (don't end up out behind the cliffs and the headland)
      cameraTargetY: 1,
      bounds: { minX: -17, maxX: 17, minZ: -12.9, maxZ: 10 },
      entrance: { x: BWX, z: 9.3 },
      water: [seaL, seaR],
      obstacles: [
        seaL, seaR,
        { x: LG.x, z: LG.z + 0.3, w: 2.0, d: 2.6 },                   // lifeguard tower and its ladder
        { x: VB.x, z: VB.z, w: 6.6, d: 0.3 },                          // volleyball net
        { x: IC.x, z: IC.z, w: 1.5, d: 2.7 },                          // ice-cream stand
        { x: SC.x, z: SC.z, r: 1.15 }, { x: SC.x + 2.3, z: SC.z - 0.6, r: 0.35 }, { x: SC.x + 1.4, z: SC.z + 0.3, r: 0.2 }, // sandcastles, bucket
        { x: SB.x, z: SB.z + 0.1, w: 2.0, d: 0.8 },                    // surfboards stuck in the sand
        { x: SF.x, z: SF.z, w: 2.7, d: 0.75 },                         // surfboard on the sand
        { x: SG.x, z: SG.z, w: 2.3, d: 0.4, rot: 0.2 },                // the sign
        { x: tbl.x, z: tbl.z, r: 0.35 }, { x: tbl.x, z: tbl.z - 0.5, r: 0.12 },
        { x: PX + 1.32, z: PZ1 + 0.3, r: 0.25 }, { x: PX - 1.32, z: PZ1 + 0.3, r: 0.25 }, // pier lamps
        { x: PX - 0.95, z: -12.6, r: 0.22 },                           // bait bucket
      ].concat(towels.map((T) => ({ x: T.x, z: T.z, w: 2.4, d: 1.2 })))
        .concat(towels.map((T) => ({ x: T.pole.x, z: T.pole.z + 0.1, r: 0.12 })))
        .concat(chairs.map((C) => ({ x: C.x, z: C.z - 0.08, w: 0.85, d: 1.35 })))
        .concat(balls.map((b) => ({ x: b.x, z: b.z, r: 0.3 })))
        .concat(palms.map(([x, z]) => ({ x, z, r: 0.45 }))),
      spots: [
        towelSpot(towels[0], "sunbathing", ["Ahh, so warm...", "Don't let me get sunburnt!", "Zzz... five more minutes...", "Perfect tanning weather!"]),
        towelSpot(towels[1], "napping on a towel", ["The waves are so relaxing...", "*snore*", "Wake me up for ice cream."]),
        chairSpot(chairs[0], ["This is the life!", "Mmm, coconut juice!", "Nobody disturb me.", "I could stay here forever."], "🥥"),
        chairSpot(chairs[1], ["Ahh, holiday mode!", "Sunglasses: on.", "Sip... sip... ahh."], "🍹"),
        { x: 3.2, z: -4.3, yaw: 0, arms: "wave", emoji: "🏊", activity: "swimming in the sea",
          stand: { x: 3.2, z: -6.7, y: -1.15 },
          lines: ["The water's lovely!", "Come on in!", "Brr, a bit cold!", "Splish splash!", "Did something touch my foot?!"] },
        { x: SC.x, z: SC.z - 1.85, yaw: 0, arms: "type", emoji: "🏰", activity: "building a sandcastle",
          lines: ["It needs a moat!", "My castle is the best!", "Don't knock it over!", "One more tower..."] },
        { x: vbA.x, z: vbA.z, yaw: 0, arms: "up", emoji: "🏐", activity: "playing volleyball",
          lines: ["Mine! Mine!", "Spike!", "Nice serve!", "Point for us!"] },
        { x: vbB.x, z: vbB.z, yaw: PI, arms: "up", emoji: "🏐", activity: "playing volleyball",
          lines: ["Got it!", "Over the net!", "Woohoo!", "Rematch!"] },
        { x: IC.x - 1.85, z: IC.z, yaw: PI / 2, arms: "eat", emoji: "🍦", activity: "buying ice cream",
          lines: ["Strawberry, please!", "Two scoops!", "It's melting! Quick!", "Brain freeze!"] },
        { x: SF.x, z: SF.z + 1.15, yaw: 0, arms: "out", emoji: "🏄", activity: "practicing surfing",
          stand: { x: SF.x, z: SF.z, y: 0.12 },
          lines: ["Cowabunga!", "Hang ten!", "Surf's up!", "Whoa, whoa... balance!"] },
        { x: PX + 0.45, z: -12.2, yaw: PI / 2, arms: "out", emoji: "🎣", activity: "fishing on the pier",
          lines: ["Something's biting!", "I caught... a boot.", "The big one got away!", "Shh, you'll scare the fish."] },
        { x: 6.5, z: -3.4, yaw: PI * 0.85, emoji: "🐚", activity: "collecting shells",
          lines: ["Ooh, a pretty shell!", "I can hear the sea in it!", "This one's pink!", "Ouch, a crab!"] },
        { x: LG.x + 0.2, z: LG.z + 2.25, yaw: 0, emoji: "🛟", activity: "on lifeguard duty",
          stand: { x: LG.x, z: LG.z + 0.1, y: 2.05 },
          lines: ["Everyone's safe!", "No running on the pier!", "I see a shark! ...No, a dolphin!", "Swim between the flags!"] },
      ],
      lines: [
        "I love the beach!", "Surf's up!", "Who wants ice cream?", "Don't forget sunscreen!",
        "Sand between my toes!", "Look, a crab!", "The sea is so blue!", "Let's build a sandcastle!",
        "Smell that sea air!", "Hot sand, hot sand!", "Is that a seagull? Hide your chips!",
      ],
      update(t) { anim.forEach((a) => a(t)); },
    };
    beach.rare = crabParty(root, shore, beach.obstacles); // (very rarely, the crabs throw a dance party)
    return beach;
  }

  // ---------- RARE: the crab dance party ----------
  // Well under 1% of the time (and only while you're watching), crabs come marching
  // out of the sea, fill the beach and dance to their song for a minute (js/crabSong.js;
  // the hub music fades out meanwhile). The Miis dance along with every move they know.
  // Then the crabs scuttle back into the sea. Watch it all for a sticker (leave the
  // beach before the end and it's just over).
  function crabParty(root, shore, obstacles) {
    const BEAT = 0.5;               // 120 beats a minute, like the song
    const ARRIVE = 8, LEAVE = 7;    // seconds to march in / scuttle off
    const COUNT = 26;               // crabs (plus the king)
    const RED = 0xff5a3a;
    const bodyGeo = bakeGeo((c) => {
      ball(c, RED, 0, 0.12, 0, 0.16, { sx: 1.3, sy: 0.6 });
      ball(c, 0xff8a6a, 0, 0.17, 0.04, 0.1, { sx: 1.3, sy: 0.4 }); // a lighter shell on top
      for (const sx of [-1, 1]) {
        cylinder(c, RED, sx * 0.06, 0.24, 0.08, 0.015, 0.12);          // eye stalks
        ball(c, 0xffffff, sx * 0.06, 0.31, 0.08, 0.035);
        ball(c, 0x222222, sx * 0.06, 0.31, 0.11, 0.018);
        for (let k = 0; k < 3; k++) cylinder(c, 0xe0472a, sx * 0.22, 0.06, -0.06 + k * 0.07, 0.015, 0.16, { rz: sx * 1.1 });
      }
      ball(c, 0x6a1a10, 0, 0.12, 0.2, 0.025, { sx: 2 }); // a little smile
    });
    // the claws on their arms (they wave about, so they're their own shape)
    const clawGeo = bakeGeo((c) => {
      for (const sx of [-1, 1]) {
        cylinder(c, RED, sx * 0.2, 0.16, 0.12, 0.022, 0.16, { rz: sx * 0.9, rx: 0.5 });
        ball(c, RED, sx * 0.27, 0.22, 0.2, 0.08, { sx: 1.25, sy: 0.9 });
        ball(c, 0xff7a5a, sx * 0.29, 0.29, 0.24, 0.045, { sx: 1.2 }); // the pincer's "thumb"
      }
    });
    const crownGeo = bakeGeo((c) => {
      cylinder(c, 0xffcf3a, 0, 0.3, 0, 0.09, 0.06);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        put(c, G.cone(), toon(0xffcf3a), { x: Math.cos(a) * 0.075, y: 0.37, z: Math.sin(a) * 0.075, s: 0.025, sy: 0.07, shadow: false });
      }
      ball(c, 0xff4fa0, 0, 0.31, 0.09, 0.022);
    });
    const N = COUNT + 1; // copy 0 is the king
    const make = (geo) => {
      const m = dynamic(new THREE.InstancedMesh(geo, paintedMat.clone(), N));
      m.castShadow = true; m.frustumCulled = false; m.visible = false;
      root.add(m);
      return m;
    };
    const bodies = make(bodyGeo), claws = make(clawGeo);
    const crown = dynamic(painted(root, crownGeo, { shadow: false }));
    crown.visible = false;
    const tmp = new THREE.Object3D();
    tmp.rotation.order = "YXZ"; // turn first, then lift the claws, then wiggle

    // a spot on the sand that isn't taken by a towel, chair, tower...
    const free = (x, z) => z > shore(x) + 0.7 && !obstacles.some((o) => {
      if (o.outside) return false;
      if (o.r !== undefined) return Math.hypot(x - o.x, z - o.z) < o.r + 0.6;
      if (o.rx !== undefined) return Math.hypot((x - o.x) / (o.rx + 0.6), (z - o.z) / (o.rz + 0.6)) < 1;
      return Math.abs(x - o.x) < o.w / 2 + 0.55 && Math.abs(z - o.z) < o.d / 2 + 0.55;
    });
    let party = null, check = 4;
    const crabs = [];
    function setup() {
      // where everyone dances: rows across the beach, the king in the front middle
      const spots = [];
      for (let z = -3.3; z < 8.5; z += 1.9) for (let x = -14.5; x <= 14.5; x += 2.1) {
        const jx = x + (Math.random() - 0.5) * 0.6 + (Math.round(z) % 2 ? 0.9 : 0), jz = z + (Math.random() - 0.5) * 0.5;
        if (free(jx, jz)) spots.push({ x: jx, z: jz });
      }
      spots.sort((a, b) => Math.hypot(a.x, a.z - 1) - Math.hypot(b.x, b.z - 1));
      let king = { x: 0, z: -2.6 };
      for (let k = 0; k < 40 && !free(king.x, king.z); k++) king = { x: (Math.random() - 0.5) * 8, z: -2.8 + Math.random() * 3 };
      const chosen = [king].concat(spots.filter((p) => Math.hypot(p.x - king.x, p.z - king.z) > 1.4).slice(0, COUNT));
      crabs.length = 0;
      chosen.forEach((p, i) => {
        const sx = p.x + (Math.random() - 0.5) * 3;
        crabs.push({
          x: p.x, z: p.z, hx: p.x, hz: p.z, s: i === 0 ? 3.0 : 1.55 + Math.random() * 0.35,
          from: { x: sx, z: shore(sx) - 2.6 }, delay: i === 0 ? 2.2 : Math.random() * 3.2,
          to: null, y: -1, ry: 0, row: Math.round(p.z / 1.9), seed: Math.random() * 10,
        });
      });
      // (any copies left over stay out of sight)
      for (let i = chosen.length; i < N; i++) { tmp.position.set(0, -50, 0); tmp.scale.setScalar(0.001); tmp.updateMatrix(); bodies.setMatrixAt(i, tmp.matrix); claws.setMatrixAt(i, tmp.matrix); }
    }
    // the sand slopes down into the sea: how high the ground is at (x, z)
    const groundY = (x, z) => Math.max(-0.7, Math.min(0, (z - shore(x)) * 0.5));
    function place(i, c, raise, wiggle, hop) {
      tmp.position.set(c.x, c.y + hop, c.z);
      tmp.rotation.set(0, c.ry, wiggle);
      tmp.scale.setScalar(c.s);
      tmp.updateMatrix();
      bodies.setMatrixAt(i, tmp.matrix);
      tmp.rotation.set(-raise * 1.15, c.ry, wiggle * 1.6);
      tmp.updateMatrix();
      claws.setMatrixAt(i, tmp.matrix);
      if (i === 0) { crown.position.set(c.x, c.y + hop, c.z); crown.rotation.set(0, c.ry, wiggle); crown.scale.setScalar(c.s); }
    }
    const music = (fn) => { try { fn(); } catch (e) { /* no sound */ } };
    const lines = ["Pinch pinch!", "Crab dance!", "Snip snap, snip snap!", "Everybody, sideways!", "♪ Pinch pinch shuffle ♪", "These crabs can MOVE!", "Claws up!"];
    function finish(ctx, done) {
      party = null;
      check = 4;
      bodies.visible = claws.visible = crown.visible = false;
      if (window.MiiCrabSong && !done) music(() => window.MiiCrabSong.stop());
      if (window.MiiMusic) music(() => window.MiiMusic.duck(false));
      if (done) ctx.event("crabs");
    }

    return {
      update(dt, t, ctx) {
        if (!party) {
          check -= dt;
          if (check > 0) return;
          check = 4;
          if (Math.random() < 0.005) this.force(ctx);
          return;
        }
        const P = party;
        P.time += dt;
        if (P.phase === "arrive") {
          // marching out of the sea, sideways of course
          crabs.forEach((c, i) => {
            const k = Math.max(0, Math.min(1, (P.time - c.delay) / (ARRIVE - 1 - c.delay)));
            const e = k * k * (3 - 2 * k);
            c.x = c.from.x + (c.hx - c.from.x) * e;
            c.z = c.from.z + (c.hz - c.from.z) * e;
            c.y = groundY(c.x, c.z);
            c.ry = k < 1 ? Math.PI / 2 * Math.min(1, (1 - k) * 6) : 0;
            const walk = k > 0 && k < 1 ? 1 : 0;
            place(i, c, 0.15, Math.sin(t * 18 + c.seed) * 0.12 * walk, Math.abs(Math.sin(t * 16 + c.seed)) * 0.04 * walk);
          });
          if (!P.oohs && P.time > 2.5) {
            P.oohs = true;
            ctx.all().slice(0, 3).forEach((w, i) => ctx.say(w, ["Crabs?!", "Whoa, so many crabs!", "Are they... lining up?"][i], 2.6));
          }
          if (P.time >= ARRIVE) {
            P.phase = "dance"; P.time = 0;
            P.length = (window.MiiCrabSong && window.MiiCrabSong.duration()) || 60;
            if (window.MiiCrabSong) music(() => window.MiiCrabSong.play());
          }
        } else if (P.phase === "dance") {
          const b = P.time / ((window.MiiCrabSong && window.MiiCrabSong.beat) ? window.MiiCrabSong.beat() : BEAT); // beats since the song began
          const move = Math.floor(b / 8) % 5;       // a new move every 2 bars
          const pulse = Math.pow(1 - (b % 1), 2.5); // a kick on every beat
          const finale = P.time > P.length - 2.2;
          crabs.forEach((c, i) => {
            let raise = 0.3 + pulse * 0.4, wiggle = Math.sin(b * Math.PI) * 0.18, hop = 0, ry = 0;
            c.x = c.hx; c.z = c.hz;
            if (finale) { raise = 1; wiggle = Math.sin(t * 20) * 0.05; }
            else if (move === 0) { hop = pulse * 0.06 * c.s; }                                   // bop
            else if (move === 1) { c.x = c.hx + Math.sin(b * Math.PI / 2) * 0.5; raise = 0.6; }   // shuffle left, shuffle right
            else if (move === 2) { raise = 0.5 + 0.5 * Math.sin(b * Math.PI - c.hx * 0.45); }    // the claw wave
            else if (move === 3) { ry = (b % 4) < 2 ? Math.min(1, (b % 2) / 1.5) * TAU : 0; raise = 0.8; } // spin!
            else { hop = ((Math.floor(b) + c.row + (i % 2)) % 2 ? pulse : 0) * 0.35; raise = hop > 0.05 ? 1 : 0.2; } // hop, hop
            c.ry = ry;
            c.y = 0;
            place(i, c, raise, wiggle, hop);
          });
          // the Miis dance along, going through every move they know
          if (!finale) for (const w of ctx.all()) {
            if (w.state === "perform" && P.dancing.has(w.id)) continue;
            const moves = ctx.moves(w);
            const n = P.dancing.get(w.id) || 0;
            P.dancing.set(w.id, n + 1);
            ctx.perform(w, moves[n % moves.length], true);
          }
          P.chatter -= dt;
          if (P.chatter <= 0) {
            P.chatter = 4 + Math.random() * 4;
            const all = ctx.all();
            if (all.length) ctx.say(all[Math.floor(Math.random() * all.length)], lines[Math.floor(Math.random() * lines.length)], 2.2);
          }
          if (P.time >= P.length) {
            P.phase = "leave"; P.time = 0;
            crabs.forEach((c) => { const tx = c.x + (Math.random() - 0.5) * 4; c.from = { x: c.x, z: c.z }; c.to = { x: tx, z: shore(tx) - 2.8 }; c.delay = Math.random() * 1.8; });
            ctx.all().slice(0, 2).forEach((w, i) => ctx.say(w, ["Bye, crabs!", "Come back soon!"][i], 2.4));
          }
        } else if (P.phase === "leave") {
          if (!P.musicBack && P.time > 1.2) { P.musicBack = true; if (window.MiiMusic) music(() => window.MiiMusic.duck(false)); }
          // and off they scuttle, back into the sea
          crabs.forEach((c, i) => {
            const k = Math.max(0, Math.min(1, (P.time - c.delay) / (LEAVE - 1.9)));
            const e = k * k;
            c.x = c.from.x + (c.to.x - c.from.x) * e;
            c.z = c.from.z + (c.to.z - c.from.z) * e;
            c.y = groundY(c.x, c.z) - (k > 0.85 ? (k - 0.85) * 3 : 0);
            c.ry = k > 0 ? Math.PI / 2 * Math.min(1, k * 8) : 0;
            const walk = k > 0 && k < 1 ? 1 : 0;
            place(i, c, 0.15, Math.sin(t * 20 + c.seed) * 0.12 * walk, Math.abs(Math.sin(t * 18 + c.seed)) * 0.04 * walk);
          });
          if (P.time >= LEAVE) finish(ctx, true);
        }
        bodies.instanceMatrix.needsUpdate = true;
        claws.instanceMatrix.needsUpdate = true;
      },
      stop(ctx) { if (party) finish(ctx, false); },
      force(ctx) { // (also used for testing)
        if (party) return;
        setup();
        party = { phase: "arrive", time: 0, dancing: new Map(), chatter: 3, length: 60 };
        crabs.forEach((c, i) => { c.x = c.from.x; c.z = c.from.z; c.y = -1; place(i, c, 0, 0, 0); });
        bodies.instanceMatrix.needsUpdate = true;
        claws.instanceMatrix.needsUpdate = true;
        bodies.visible = claws.visible = crown.visible = true;
        if (window.MiiCrabSong) music(() => window.MiiCrabSong.prepare());
        if (window.MiiMusic) music(() => window.MiiMusic.duck(true));
      },
      _state: () => party, _crabs: crabs, // (for testing)
    };
  }

  // Everything far away around the beach: cliffs, islands, the town and road
  // behind the dunes, beach huts, a Ferris wheel and boats.
  function beachScenery(root, anim, shore, SEA_Y, BWX) {
    const r = seeded(17);

    // ----- dunes with tufts of grass and a little sand fence -----
    const dunes = [], tufts = [], fence = [];
    for (let x = -60; x <= 60; x += 4.2) {
      if (Math.abs(x - BWX) < 2.6) continue;
      const z = 14.5 + r() * 3;
      dunes.push({ x, y: -0.2, z, sx: 3.2 + r() * 2, sy: 1.1 + r() * 0.8, sz: 3 + r() * 0.5, color: 0xf3d99a });
      for (let k = 0; k < 4; k++) tufts.push({ x: x + (r() - 0.5) * 4, y: 0.9 + r() * 0.5, z: z + (r() - 0.5) * 2.5, s: 0.25, sy: 0.6 + r() * 0.4, ry: r() * 3, color: r() < 0.5 ? 0x7cbf4a : 0x95cf5a });
    }
    for (let x = -40; x <= 40; x += 0.9) {
      if (Math.abs(x - BWX) < 1.6) continue;
      fence.push({ x, y: 0.3, z: 12.4 + Math.sin(x * 0.3) * 0.2, sx: 0.07, sy: 0.6 + (Math.round(x * 10) % 3) * 0.06, sz: 0.05, color: 0xb8a080 });
    }
    scatter(root, G.lowSphere(), toon(0xffffff), dunes, false);
    scatter(root, G.cone(5), toon(0xffffff), tufts, false);
    scatter(root, G.box(), toon(0xffffff), fence, true);

    // ----- the coastal road with cars -----
    const RZ = 25;
    put(root, new THREE.PlaneGeometry(500, 7), toon(0x8a92a6), { y: 0.02, z: RZ, rx: -PI / 2, shadow: false, receive: false });
    put(root, new THREE.PlaneGeometry(500, 1.4), toon(0xd9d2c0), { y: 0.03, z: RZ - 4.1, rx: -PI / 2, shadow: false, receive: false });
    put(root, new THREE.PlaneGeometry(500, 1.4), toon(0xd9d2c0), { y: 0.03, z: RZ + 4.1, rx: -PI / 2, shadow: false, receive: false });
    const dashes = [];
    for (let x = -240; x <= 240; x += 4) dashes.push({ x, y: 0.04, z: RZ, sx: 2, sy: 0.02, sz: 0.2, color: 0xffffff });
    farScatter(root, G.box(), toon(0xffffff), dashes);
    const carGeo = (color) => bakeGeo((c) => {
      block(c, color, 0, 0.55, 0, 3.4, 0.7, 1.6, 0.25);
      block(c, color, -0.2, 1.1, 0, 2.0, 0.7, 1.5, 0.25);
      block(c, 0xbfe6ff, -0.2, 1.12, 0, 2.05, 0.5, 1.52, 0.1);
      for (const sx of [-1.1, 1.1]) for (const sz of [-0.75, 0.75]) cylinder(c, 0x333333, sx, 0.32, sz, 0.32, 0.25, { rx: PI / 2, seg: 10 });
    });
    const cars = [
      { geo: carGeo(0xff5a5a), lane: RZ - 1.6, speed: 6, off: 0 },
      { geo: carGeo(0x4a90e2), lane: RZ + 1.6, speed: -5, off: 80 },
      { geo: carGeo(0xffcf3a), lane: RZ - 1.6, speed: 6, off: 120 },
      { geo: carGeo(0x5cc84a), lane: RZ + 1.6, speed: -5.5, off: 30 },
    ].map((c) => Object.assign(c, { mesh: dynamic(painted(root, c.geo)) }));
    anim.push((t) => cars.forEach((c) => {
      const x = ((((t * c.speed + c.off) % 200) + 300) % 200) - 100;
      c.mesh.position.set(x, 0, c.lane);
      c.mesh.rotation.y = c.speed > 0 ? 0 : PI;
    }));

    // ----- the seaside town: houses and a hotel (windows painted on) -----
    const houseMat = windowMaterial({ glass: 0x8fd0ff, w: 2.0, h: 2.6 });
    const pastel = [0xffe2b8, 0xffc4a8, 0xbcdcff, 0xc8eab6, 0xffc8dc, 0xd6c8ff, 0xf6e7c4, 0xffffff, 0xffe08a];
    const roofColors = [0xff6b5a, 0x4fb7c9, 0xff9a3a, 0x7a8cff, 0xe86a9a];
    const houses = [], roofs = [];
    for (let x = -110; x <= 110; x += 7 + r() * 2) {
      const w = 4.5 + r() * 2, h = 3.5 + Math.floor(r() * 3) * 2.6, d = 5;
      const z = 33 + r() * 3;
      houses.push({ x, y: h / 2, z, sx: w, sy: h, sz: d, color: pastel[Math.floor(r() * pastel.length)] });
      roofs.push({ x, y: h, z, sx: w + 0.6, sy: 1.6 + r(), sz: d + 0.6, color: roofColors[Math.floor(r() * roofColors.length)] });
      // a second row behind, a bit higher up the hill
      if (r() < 0.7) {
        const h2 = 4 + Math.floor(r() * 3) * 2.6;
        houses.push({ x: x + 3, y: 1 + h2 / 2, z: z + 10, sx: w, sy: h2, sz: d, color: pastel[Math.floor(r() * pastel.length)] });
        roofs.push({ x: x + 3, y: 1 + h2, z: z + 10, sx: w + 0.6, sy: 1.8, sz: d + 0.6, color: roofColors[Math.floor(r() * roofColors.length)] });
      }
    }
    // the big seaside hotel
    houses.push({ x: 22, y: 9, z: 46, sx: 22, sy: 18, sz: 8, color: 0xffffff });
    houses.push({ x: -30, y: 6.5, z: 47, sx: 14, sy: 13, sz: 7, color: 0xffd8b0 });
    farScatter(root, G.box(), houseMat, houses);
    farScatter(root, prismGeo(), toon(0xffffff), roofs);

    // ----- beach huts on the right (one painted shape) -----
    painted(root, bakeGeo((g) => {
      const hutColors = [0xff8fb8, 0x6fc3ff, 0xffe25a, 0x8fe08a, 0xffa25a, 0xc39bff];
      for (let i = 0; i < 6; i++) {
        const z = -3 + i * 2.1, c = hutColors[i];
        const hut = group(g, 21.8, 0, z, -PI / 2);
        bx(hut, 0xffffff, 0, 0.12, 0, 1.9, 0.24, 1.9);
        bx(hut, c, 0, 1.25, 0, 1.6, 2.0, 1.6);
        roof(hut, 0xffffff, 0, 2.25, 0, 1.6, 0.8, 1.9, { ry: PI / 2 });
        bx(hut, 0xffffff, 0, 1.1, 0.81, 0.75, 1.5, 0.04);
        bx(hut, c, 0, 1.1, 0.83, 0.6, 1.35, 0.04);
      }
      // ----- the Ferris wheel's stand (the wheel itself turns, see below) -----
      const fw = group(g, 34, 0, 10);
      for (const sz of [-1.2, 1.2]) {
        bx(fw, 0xffffff, -2.2, 4.4, sz, 0.35, 9.4, 0.35, { rz: -0.45 });
        bx(fw, 0xffffff, 2.2, 4.4, sz, 0.35, 9.4, 0.35, { rz: 0.45 });
      }
      bx(fw, 0xff8fb8, 0, 0.4, 0, 7, 0.8, 3.4);
    }));
    // the Ferris wheel itself, slowly turning, with its cabins kept upright
    const FW = { x: 34, y: 8.6, z: 10 };
    const wheel = mover(root, (w) => {
      put(w, new THREE.TorusGeometry(6.5, 0.18, 6, 40), toon(0xffffff), {});
      put(w, new THREE.TorusGeometry(5.6, 0.1, 6, 40), toon(0xff8fb8), {});
      for (let i = 0; i < 10; i++) bx(w, 0xffffff, 0, 0, 0, 0.12, 13, 0.12, { rz: (i / 10) * PI });
      cylinder(w, 0xffcf3a, 0, 0, 0, 0.6, 2.6, { rx: PI / 2 });
    });
    wheel.position.set(FW.x, FW.y, FW.z);
    const cabinGeo = bakeGeo((c) => {
      block(c, 0xffffff, 0, -0.75, 0, 1.0, 0.9, 1.0, 0.2);
      block(c, 0xbfe6ff, 0, -0.6, 0, 1.04, 0.4, 0.8, 0.05);
      cylinder(c, 0x888888, 0, -0.15, 0, 0.03, 0.4);
    });
    const cabinColors = [0xff5a5a, 0x4a90e2, 0xffcf3a, 0x5cc84a, 0xb58cff];
    const cabins = movingCopies(root, cabinGeo, paintedMat, 10);
    for (let i = 0; i < 10; i++) cabins.mesh.setColorAt(i, new THREE.Color(cabinColors[i % 5]));
    anim.push((t) => {
      const a0 = t * 0.08;
      wheel.rotation.z = a0;
      for (let i = 0; i < 10; i++) {
        const a = a0 + (i / 10) * TAU;
        cabins.set(i, FW.x + Math.cos(a) * 6.5, FW.y + Math.sin(a) * 6.5, FW.z + 1.4, 0, Math.sin(t * 1.3 + i) * 0.06);
      }
    });

    // ----- cliffs, headlands, hills, islands: all painted into ONE shape -----
    painted(root, bakeGeo((g) => {
      const S = G.tinySphere();
      const lump = (x, y, z, sx, sy, sz, color) => put(g, G.lowSphere(), toon(color), { x, y, z, sx, sy, sz, ry: x * 0.3 });
      // the cliffs on the left, going out into the sea
      const cliffs = [[-26, 14, 7, 6], [-29, 4, 8, 7], [-33, -6, 8, 8], [-38, -15, 7, 7.5], [-44, -24, 6.5, 6], [-50, -31, 5, 4.5]];
      for (const [x, z, s, h] of cliffs) {
        lump(x, 0, z, s, h, s * 0.9, 0xe0b98a);
        lump(x + 0.5, h * 0.45, z, s * 0.95, h * 0.55, s * 0.85, 0xd1a674);
        lump(x - 0.5, h * 0.85, z, s * 0.8, 1.2, s * 0.7, 0x7cc85a); // grassy top
      }
      for (const [x, z, s] of [[-54, -38, 2.2], [-49, -40, 1.4], [-24, -10, 1.0], [-22.5, -7, 0.7]]) lump(x, SEA_Y, z, s, s * 1.3, s, 0xb8b3a8);
      // the lighthouse on the cliff top
      const lh = group(g, -33, 7.6, -6);
      for (let i = 0; i < 4; i++) cylinder(lh, i % 2 ? 0xff5a5a : 0xffffff, 0, 0.75 + i * 1.5, 0, 1.1 - i * 0.12, 1.5, { seg: 12 });
      cylinder(lh, 0xfff2a8, 0, 6.6, 0, 0.55, 0.9, { seg: 12 });
      put(lh, G.cone(12), toon(0xff5a5a), { y: 7.5, s: 0.85, sy: 0.9 });
      const cot = group(g, -30, 8.2, -2, 0.4);
      bx(cot, 0xffffff, 0, 1, 0, 3, 2, 2.4);
      roof(cot, 0x4a90e2, 0, 2, 0, 3.4, 1.4, 2.8);
      for (const [x, z] of [[-27, 9], [-30, 13], [-35, 0], [-37, -11], [-27, 0]]) farTree(g, x, z, 1.2, null, 6.5);
      // the headland on the right, behind the beach huts
      const head = [[30, -8, 8, 4], [38, -16, 9, 5], [47, -24, 7, 4], [55, -32, 5, 3], [44, -4, 10, 6]];
      for (const [x, z, s, h] of head) {
        lump(x, 0, z, s, h, s * 0.9, 0xd8b88f);
        lump(x, h * 0.6, z, s * 0.9, h * 0.5, s * 0.8, 0x7cc85a);
      }
      for (const [x, z] of [[30, -8], [37, -15], [45, -22], [41, -6]]) farPalm(g, x, z, 1.3, x * 0.7, 3);
      for (const [x, z, s] of [[58, -37, 1.8], [52, -40, 1.1], [24.5, -12, 0.8]]) lump(x, SEA_Y, z, s, s * 1.2, s, 0xb8b3a8);
      // green hills behind the town, all the way round the back
      for (let i = 0; i < 16; i++) {
        const a = PI * 0.05 + (i / 15) * PI * 0.9;
        const d = 95 + r() * 30;
        lump(Math.cos(a) * d * 1.3, -2, Math.sin(a) * d, 18 + r() * 10, 12 + r() * 10, 14 + r() * 6, i % 2 ? 0x6cc84a : 0x5cb84a);
      }
      for (let i = 0; i < 40; i++) {
        const x = -120 + r() * 240, z = 52 + r() * 25;
        farTree(g, x, z, 1.4 + r(), r() < 0.2 ? [0xff9ec7, 0xffc3dc] : [0x4fbf47, 0x7fdc5c]);
      }
      // trees along the road, and palms on the grass between the dunes and road
      for (let x = -80; x <= 80; x += 9) farPalm(g, x + r() * 3, 20 + r() * 1.5, 1.1, r() * 6);
      // islands out at sea
      const island = (x, z, s, hill) => {
        const isl = group(g, x, SEA_Y, z);
        put(isl, S, toon(0xf5dfa4), { y: -1.2, sx: s * 1.4, sy: 1.6, sz: s });
        put(isl, S, toon(0x6cc84a), { y: -0.6, sx: s * 1.1, sy: 1.5 * hill, sz: s * 0.8 });
        return group(isl, 0, -0.6 + 1.5 * hill - 0.15, 0);
      };
      const i1 = island(-34, -62, 6, 1.2);
      farPalm(i1, -1, 0, 1.4, 0.5); farPalm(i1, 2, 1, 1.1, 2.4); farTree(i1, -3, -1, 1.1);
      const i2 = island(28, -58, 4, 0.8);
      farPalm(i2, 0, 0, 1.3, 1.2);
      const i3 = island(4, -105, 14, 1.4);
      put(i3, G.cone(10), toon(0x5cb84a), { y: 5, sx: 9, sy: 12, sz: 7 });
      for (let i = 0; i < 6; i++) farTree(i3, -10 + i * 4, 3 + (i % 2), 1.5);
      const i4 = island(-95, -95, 10, 1.6);
      for (let i = 0; i < 4; i++) farTree(i4, -6 + i * 4, 0, 1.6);
      const i5 = island(90, -88, 12, 1.3);
      put(i5, G.cone(8), toon(0x6cc84a), { y: 4, sx: 7, sy: 9, sz: 6 });
      const i6 = island(-8, -160, 20, 1.8);
      put(i6, G.cone(10), toon(0x5cb84a), { x: -6, y: 8, sx: 14, sy: 18, sz: 10 });
      put(i6, G.cone(10), toon(0x6cc84a), { x: 9, y: 5, sx: 10, sy: 12, sz: 8 });
      // a little rocky islet with a hut, close by
      const i7 = island(-14, -36, 2.4, 0.5);
      bx(i7, 0xd9a86a, 0.3, 0.5, 0, 1.2, 1.0, 1.0);
      roof(i7, 0xe6c36a, 0.3, 1.0, 0, 1.4, 0.7, 1.3);
      // a line of buoys marking the swimming area
      for (let x = -14; x <= 6; x += 2.5) {
        ball(g, x % 5 === 0 ? 0xff5a5a : 0xffffff, x, SEA_Y + 0.05, -18 + Math.sin(x) * 0.5, 0.25, { shadow: false });
      }
    }));

    // ----- sailboats far out at sea -----
    const boats = [
      { geo: sailboatGeo(0x6fc3ff, 0x4a90e2), z: -40, speed: 1.2, off: 0, s: 1.3 },
      { geo: sailboatGeo(0xff9ec7, 0xff5a64), z: -55, speed: -0.9, off: 60, s: 1.5 },
      { geo: sailboatGeo(0xffd166, 0x5cc84a), z: -80, speed: 0.7, off: 30, s: 1.8 },
    ].map((b) => Object.assign(b, { mesh: dynamic(painted(root, b.geo, { s: b.s })) }));
    anim.push((t) => boats.forEach((b, i) => {
      const x = ((((t * b.speed + b.off) % 140) + 210) % 140) - 70;
      b.mesh.position.set(x, SEA_Y - 0.6 + Math.sin(t * 1.4 + i) * 0.08, b.z);
      b.mesh.rotation.set(0, b.speed > 0 ? PI / 2 : -PI / 2, Math.sin(t * 1.2 + i) * 0.05);
    }));
  }

  // =====================================================================
  // CAFÉ STREET — a cozy little shopping street with a fountain
  // =====================================================================
  // The shops are along the back (towards -z); a tram road runs along the front.
  function buildCafe() {
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xd6f0ff, ground: 0xd9c8a8, hemi: 0.55, sun: 0.95, ambient: 0.28 });
    skyDome(root, 0x3fa9f5, 0xcdeeff, 0xd9e8f0);
    const FZ = -10.6; // the front of the shops at the back

    // ---------- the ground: cobbles, a tram road at the front ----------
    const cobbleTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#b8a98f"; ctx.fillRect(0, 0, w, h);
      const r = seeded(3);
      const cols = ["#d9c8a8", "#cdbb9b", "#d4c3a2", "#c8b391", "#e0d1b4"];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = cols[Math.floor(r() * cols.length)];
          roundRect(ctx, x * 32 + (y % 2) * 16 + 2 - 16, y * 32 + 2, 28, 28, 7); ctx.fill();
          if (x === 0) { roundRect(ctx, 8 * 32 + (y % 2) * 16 + 2 - 16, y * 32 + 2, 28, 28, 7); ctx.fill(); }
        }
      }
    });
    cobbleTex.wrapS = cobbleTex.wrapT = THREE.RepeatWrapping;
    cobbleTex.repeat.set(26, 18);
    put(root, new THREE.PlaneGeometry(60, 34), toon(0xe8e0d4, { map: cobbleTex }), { y: 0, z: -1, rx: -PI / 2, shadow: false });
    // a big plain ground under everything further away
    disc(root, toon(0xbdb4a4), 0, -0.05, 0, 240, { receive: false });
    // a ring of lighter paving around the fountain
    const F = { x: 3.0, z: 0.5 };
    disc(root, toon(0xf2e8d5), F.x, 0.01, F.z, 3.4, { receive: true });
    put(root, G.torus(3.4, 0.08), toon(0xc9b99a), { x: F.x, y: 0.0, z: F.z, rx: PI / 2, shadow: false });
    // the tram road and pavement at the front
    const TZ = 12.6;
    put(root, new THREE.PlaneGeometry(400, 4.6), toon(0x8a92a6), { y: 0.015, z: TZ, rx: -PI / 2, shadow: false });
    block(root, 0xe6ddd0, 0, 0.06, TZ - 2.45, 400, 0.12, 0.3, 0.03, { shadow: false }); // kerbs
    block(root, 0xe6ddd0, 0, 0.06, TZ + 2.45, 400, 0.12, 0.3, 0.03, { shadow: false });
    put(root, new THREE.PlaneGeometry(400, 3), toon(0xd8ccb8), { y: 0.02, z: TZ + 4.1, rx: -PI / 2, shadow: false });
    for (const dz of [-0.75, 0.75]) block(root, 0xb9c3cf, 0, 0.03, TZ + dz, 400, 0.04, 0.1, 0.01, { shadow: false }); // tram rails

    // ---------- the four shops along the back ----------
    // They're kept in their own group: when the camera swings round behind
    // them, we hide them so you can still see the square (see update below).
    const back = group(root);
    // Each shop: a ground floor with a big window, a door, an awning and a sign.
    // The floors above are boxes with windows painted on (one material for all).
    const upperMat = windowMaterial({ glass: 0x8fcfee, w: 2.2, h: 3.0, minY: 5.6 });
    const uppers = [], roofs = [], cornices = [];
    const shops = [
      { id: "bakery", x0: -20.5, x1: -11, h: 9.5, wall: 0xffcf7a, trim: 0xb9763a, roof: 0xd96b4a, name: "Bakery", emoji: "🥐", bg: "#b9763a", awn: [0xb9763a, 0xfff1d6], door: 0x8a5a32, win: [-17.2, -13.4] },
      { id: "cafe", x0: -11, x1: -0.5, h: 8.2, wall: 0x96dcbc, trim: 0x2f8f6f, roof: 0x2f8f6f, name: "Mii Café", emoji: "☕", bg: "#2f8f6f", awn: [0x2f8f6f, 0xffffff], door: 0x2f6f5a, win: [-8.2, -4.2], door2: -1.8 },
      { id: "clothes", x0: -0.5, x1: 8.2, h: 10.4, wall: 0xff9fc2, trim: 0xe0628f, roof: 0x7a8cff, name: "Boutique", emoji: "👗", bg: "#e0628f", awn: [0xe0628f, 0xffffff], door: 0xe0628f, win: [2.0, 6.0] },
      { id: "toys", x0: 8.2, x1: 18.2, h: 8.8, wall: 0xffe066, trim: 0xff5a5a, roof: 0xff5a5a, name: "Toy Box", emoji: "🧸", bg: "#ff5a5a", awn: [0xff5a5a, 0xffe25a], door: 0x4a90e2, win: [10.6, 14.6] },
      { id: "corner", x0: 18.2, x1: 24, h: 11.5, wall: 0xb9a6ff, trim: 0x7a6ad0, roof: 0x7a6ad0 },
      { id: "corner2", x0: -26, x1: -20.5, h: 12.5, wall: 0x94c4ff, trim: 0x4a7fc0, roof: 0x4a7fc0 },
    ];
    const GF = 3.9; // ground floor height
    for (const S of shops) {
      const w = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2, D = 6;
      bx(back, S.wall, cx, GF / 2, FZ - D / 2, w, GF, D);
      uppers.push({ x: cx, y: GF + (S.h - GF) / 2, z: FZ - D / 2, sx: w, sy: S.h - GF, sz: D, color: S.wall });
      // a band between the shop and the flats, and a cornice at the top
      cornices.push({ x: cx, y: GF + 0.1, z: FZ + 0.05, sx: w + 0.05, sy: 0.35, sz: 0.3, color: S.trim });
      cornices.push({ x: cx, y: S.h, z: FZ - D / 2 + 0.1, sx: w + 0.2, sy: 0.4, sz: D + 0.4, color: 0xffffff });
      roofs.push({ x: cx, y: S.h + 0.2, z: FZ - D / 2, sx: w + 0.1, sy: 2.6, sz: D + 0.3, color: S.roof });
      if (!S.name) continue;
      // shop window: a bay with a frame, a little shelf for the display, and glass
      for (const wx of S.win) {
        bx(back, 0x5a4636, wx, 1.9, FZ + 0.02, 3.2, 2.5, 0.04); // the dim shop inside
        block(back, 0xffffff, wx, 0.45, FZ + 0.3, 3.5, 0.9, 0.62, 0.04);       // sill
        block(back, S.trim, wx, 3.25, FZ + 0.3, 3.5, 0.22, 0.62, 0.04);        // top
        for (const sx of [-1.68, 1.68]) block(back, S.trim, wx + sx, 1.9, FZ + 0.3, 0.16, 2.9, 0.62, 0.04);
        plane(back, 3.2, 2.3, toon(0xd8f2ff, { transparent: true, opacity: 0.22 }), { x: wx, y: 2.0, z: FZ + 0.6 });
        // a white shine streak on the glass
        plane(back, 0.25, 2.1, toon(0xffffff, { transparent: true, opacity: 0.35 }), { x: wx - 0.7, y: 2.0, z: FZ + 0.61, rz: -0.35 });
      }
      // the door
      const dx = S.door2 !== undefined ? S.door2 : (S.win[0] + S.win[1]) / 2 + (S.id === "bakery" ? 0 : 0);
      block(back, 0xffffff, dx, 1.35, FZ + 0.05, 1.5, 2.7, 0.14, 0.04);
      block(back, S.door, dx, 1.3, FZ + 0.12, 1.2, 2.5, 0.08, 0.04);
      block(back, 0xd8f2ff, dx, 1.85, FZ + 0.17, 0.7, 0.9, 0.02, 0.04);
      ball(back, 0xffcf3a, dx + 0.42, 1.2, FZ + 0.2, 0.06);
      // a striped awning over the windows, with a frilly edge
      const aw = w - 0.6, awZ = FZ + 0.85, awY = 3.75;
      const stripes = stripeTexture(S.awn, 10, false);
      stripes.repeat.set(aw / 4, 1);
      stripes.wrapS = THREE.RepeatWrapping;
      put(back, new THREE.PlaneGeometry(aw, 1.75), toon(0xffffff, { map: stripes, side: THREE.DoubleSide }), { x: cx, y: awY, z: awZ, rx: -PI / 2 + 0.55, shadow: true });
      const frill = stripeTexture(S.awn, 10, false, true);
      frill.repeat.set(aw / 4, 1);
      frill.wrapS = THREE.RepeatWrapping;
      plane(back, aw, 0.42, toon(0xffffff, { map: frill, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), { x: cx, y: awY - 0.86, z: FZ + 1.6 });
      // the shop sign above the awning
      block(back, toon(0xffffff, { map: signTexture(S.name, { bg: S.bg, fg: "#ffffff", emoji: S.emoji }) }), cx, 4.75, FZ + 0.18, Math.min(w - 1, 6), 1.3, 0.12, 0.06);
      // flower boxes under some of the upstairs windows
      for (let k = Math.ceil(S.x0 / 2.2); k < Math.floor(S.x1 / 2.2); k++) {
        const wxx = (k + 0.5) * 2.2;
        if (wxx < S.x0 + 0.9 || wxx > S.x1 - 0.9 || (k * 7) % 3 === 0) continue;
        block(back, S.trim, wxx, 6.75, FZ + 0.18, 1.2, 0.26, 0.3, 0.04);
        for (let f = 0; f < 4; f++) ball(back, [0xff6fa5, 0xffe25a, 0xffffff, 0xff7a59][(((f + k) % 4) + 4) % 4], wxx - 0.42 + f * 0.28, 6.95, FZ + 0.22, 0.12);
      }
    }
    farScatter(back, G.box(), upperMat, uppers).castShadow = true;
    scatter(back, G.box(), toon(0xffffff), cornices, false);
    farScatter(back, prismGeo(), toon(0xffffff), roofs);
    // chimneys
    for (const [x, z] of [[-14, -13.5], [-3, -14.5], [12, -13], [5, -15]]) bx(back, 0xc98b6a, x, 10.5, z, 0.8, 3, 0.8);

    // ---------- what's in the shop windows ----------
    // bakery: loaves, croissants and a cake
    for (let i = 0; i < 5; i++) {
      ball(back, 0xd9984a, -18.4 + i * 0.6, 1.08, FZ + 0.3, 0.2, { sx: 1.4, sy: 0.7 });
      ball(back, 0xe6b36a, -14.6 + i * 0.6, 1.05, FZ + 0.3, 0.16, { sx: 1.5, sy: 0.6, rz: 0.2 });
    }
    block(back, 0xffffff, -17.2, 1.85, FZ + 0.25, 2.8, 0.06, 0.4, 0.02);
    cylinder(back, 0xffd0e0, -17.2, 2.15, FZ + 0.25, 0.4, 0.5);
    cylinder(back, 0xffffff, -17.2, 2.42, FZ + 0.25, 0.42, 0.06);
    ball(back, 0xff3b3b, -17.2, 2.5, FZ + 0.25, 0.08);
    for (let i = 0; i < 4; i++) ball(back, 0xc98b4a, -14.5 + i * 0.4, 2.0, FZ + 0.25, 0.16, { sy: 0.6 });
    // café: cakes and cups on the counter by the window
    for (let i = 0; i < 4; i++) {
      cylinder(back, 0xffffff, -9.3 + i * 0.7, 1.0, FZ + 0.3, 0.13, 0.2);
      ball(back, [0xffd0e0, 0x8a5a32, 0xfff1b8, 0x9be7c4][i], -5.3 + i * 0.6, 1.05, FZ + 0.3, 0.18, { sy: 0.7 });
    }
    // boutique: two mannequins wearing outfits, and a rack of clothes
    for (const [mx, top, bottom] of [[1.2, 0xff6fa5, 0x4a90e2], [2.9, 0xffe25a, 0xffffff]]) {
      ball(back, 0xfff1e0, mx, 2.65, FZ + 0.3, 0.2);
      put(back, G.taper(0.22, 0.32), toon(top), { x: mx, y: 2.15, z: FZ + 0.3, sy: 0.75 });
      put(back, G.taper(0.32, 0.45), toon(bottom), { x: mx, y: 1.45, z: FZ + 0.3, sy: 0.65 });
      cylinder(back, 0x888888, mx, 1.0, FZ + 0.3, 0.03, 0.4);
    }
    cylinder(back, 0x888888, 6.0, 2.6, FZ + 0.25, 0.02, 2.4, { rz: PI / 2 });
    [0xff7a59, 0x5cc84a, 0x4a90e2, 0xb58cff, 0xffcf3a].forEach((c, i) => block(back, c, 5.1 + i * 0.45, 2.1, FZ + 0.25, 0.38, 0.9, 0.1, 0.05));
    // toy shop: a big teddy bear, blocks, a rocket and a ball
    const teddy = group(back, 10.0, 0.9, FZ + 0.3);
    ball(teddy, 0xc98b4a, 0, 0.45, 0, 0.42);
    ball(teddy, 0xc98b4a, 0, 1.05, 0, 0.32);
    for (const sx of [-0.22, 0.22]) ball(teddy, 0xc98b4a, sx, 1.33, 0, 0.11);
    ball(teddy, 0xf0d0a0, 0, 1.0, 0.27, 0.12);
    for (const sx of [-0.1, 0.1]) ball(teddy, 0x222222, sx, 1.12, 0.27, 0.035);
    put(teddy, G.torus(0.14, 0.04), toon(0xff5a5a), { y: 0.78, z: 0.05, rx: PI / 2 });
    [0xff5a5a, 0x4a90e2, 0xffcf3a, 0x5cc84a].forEach((c, i) => block(back, c, 11.0 + (i % 2) * 0.42, 1.12 + Math.floor(i / 2) * 0.42, FZ + 0.3, 0.38, 0.38, 0.38, 0.05));
    put(back, G.capsule(), toon(0xffffff), { x: 14.0, y: 1.65, z: FZ + 0.3, s: 0.4, sy: 0.75 });
    put(back, G.cone(), toon(0xff5a5a), { x: 14.0, y: 2.33, z: FZ + 0.3, s: 0.2, sy: 0.4 });
    ball(back, 0x6fc3ff, 14.0, 1.75, FZ + 0.5, 0.08);
    ball(back, 0xff7a59, 15.4, 1.2, FZ + 0.3, 0.3);
    ball(back, 0xffe25a, 15.4, 1.2, FZ + 0.3, 0.305, { sy: 0.2 });
    // a spinning pinwheel by the toy shop door
    cylinder(root, 0xffffff, 16.9, 0.75, FZ + 0.6, 0.025, 1.5);
    const pinwheel = dynamic(group(root, 16.9, 1.5, FZ + 0.68));
    [0xff5a5a, 0xffcf3a, 0x4a90e2, 0x5cc84a].forEach((c, i) => put(pinwheel, triangleGeo([0, 0, 0, 0.35, 0.05, 0, 0.1, 0.33, 0]), toon(c), { rz: (i * PI) / 2 }));
    anim.push((t) => { pinwheel.rotation.z = -t * 3; });

    // ---------- the café terrace ----------
    const terraceTables = [-8.6, -5.6, -2.6].map((x) => ({ x, z: -7.3 }));
    const chairC = [0x2f8f6f, 0xffffff];
    for (const T of terraceTables) {
      cylinder(root, 0x3d4a5c, T.x, 0.4, T.z, 0.05, 0.8);
      cylinder(root, 0x3d4a5c, T.x, 0.03, T.z, 0.28, 0.06);
      cylinder(root, 0xffffff, T.x, 0.82, T.z, 0.5, 0.06);
      // a cup and a slice of cake on each table
      cylinder(root, 0xffffff, T.x - 0.12, 0.92, T.z - 0.15, 0.07, 0.14);
      cylinder(root, 0x6b3e1e, T.x - 0.12, 0.99, T.z - 0.15, 0.06, 0.01, { shadow: false });
      put(root, G.cyl(3), toon(0xffd0e0), { x: T.x + 0.15, y: 0.9, z: T.z + 0.1, sx: 0.12, sy: 0.1, sz: 0.12 });
      for (const side of [-1, 1]) {
        const c = group(root, T.x, 0, T.z + side * 0.85, side < 0 ? 0 : PI);
        block(c, chairC[0], 0, 0.48, 0, 0.5, 0.07, 0.5, 0.03);
        for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) cylinder(c, 0x3d4a5c, lx, 0.24, lz, 0.025, 0.48);
        block(c, chairC[0], 0, 0.82, -0.23, 0.5, 0.45, 0.05, 0.03);
        block(c, chairC[1], 0, 0.82, -0.205, 0.38, 0.3, 0.02, 0.02, { shadow: false });
      }
    }
    // a big parasol over the middle table
    cylinder(root, 0xffffff, -5.6, 1.6, -7.3, 0.04, 3.2);
    put(root, G.cone(16), toon(0xffffff, { map: stripeTexture([0x2f8f6f, 0xffffff], 8, false) }), { x: -5.6, y: 3.25, z: -7.3, sx: 1.9, sy: 0.6, sz: 1.9 });
    // fairy lights over the terrace
    const bulbs = [];
    const lightPoles = [{ x: -11.1, z: -5.2 }, { x: -0.3, z: -5.2 }];
    for (const P of lightPoles) cylinder(root, 0x3d4a5c, P.x, 1.9, P.z, 0.06, 3.8);
    const lightLines = [
      [new THREE.Vector3(-11.1, 3.75, -5.2), new THREE.Vector3(-0.3, 3.75, -5.2)],
      [new THREE.Vector3(-11.1, 3.75, -5.2), new THREE.Vector3(-6, 5.6, FZ + 0.1)],
      [new THREE.Vector3(-0.3, 3.75, -5.2), new THREE.Vector3(-6, 5.6, FZ + 0.1)],
    ];
    for (const [a, b] of lightLines) {
      const pts = sagPoints(a, b, 0.5, 14);
      rope(root, pts, 0x333333, 0.015);
      const curve = new THREE.CatmullRomCurve3(pts);
      const n = Math.round(a.distanceTo(b) / 0.6);
      for (let i = 1; i < n; i++) { const p = curve.getPoint(i / n); bulbs.push({ x: p.x, y: p.y - 0.08, z: p.z, s: 0.07, color: [0xfff1a8, 0xffd0e0, 0xbfe6ff][i % 3] }); }
    }
    scatter(root, G.tinySphere(), glow(0xffffff, 0.6), bulbs, false);
    // the menu board (an A-frame chalkboard) by the terrace
    const MB = { x: 1.2, z: -4.5 };
    const menuTex = canvasTexture(192, 256, (ctx, w, h) => {
      ctx.fillStyle = "#2f3b36"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#c98b4a"; ctx.lineWidth = 12; ctx.strokeRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
      ctx.font = "bold 30px 'Nunito', sans-serif"; ctx.fillText("MENU", w / 2, 46);
      ctx.font = "20px 'Nunito', sans-serif";
      ["☕ Coffee", "🍵 Tea", "🧁 Cupcake", "🍰 Cake", "🥐 Croissant"].forEach((t, i) => ctx.fillText(t, w / 2, 86 + i * 34));
    });
    const mb = group(root, MB.x, 0, MB.z);
    for (const side of [-1, 1]) {
      const leaf = group(mb, 0, 0, side * 0.22, 0);
      leaf.rotation.x = side * 0.2;
      block(leaf, 0xc98b4a, 0, 0.62, 0, 0.8, 1.25, 0.05, 0.02);
      plane(leaf, 0.68, 0.95, toon(0xffffff, { map: menuTex }), { y: 0.7, z: side * 0.03, ry: side < 0 ? PI : 0 });
    }

    // ---------- the coffee kiosk (its counter faces +x) ----------
    const K = { x: -12.6, z: 1.2 };
    const kiosk = group(root, K.x, 0, K.z, PI / 2);
    cylinder(kiosk, 0x2f8f6f, 0, 0.6, 0, 1.25, 1.2, { seg: 16 });
    cylinder(kiosk, 0xc98b4a, 0, 1.25, 0, 1.35, 0.1, { seg: 16 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; cylinder(kiosk, 0xffffff, Math.cos(a) * 1.15, 2.1, Math.sin(a) * 1.15, 0.05, 1.7); }
    cylinder(kiosk, 0x2f8f6f, 0, 2.15, -0.3, 0.9, 1.6, { seg: 16 }); // the back part, with the coffee machine
    put(kiosk, G.cone(16), toon(0xffffff, { map: stripeTexture([0x2f8f6f, 0xffffff], 8, false) }), { y: 3.35, sx: 1.7, sy: 0.75, sz: 1.7 });
    ball(kiosk, 0xc98b4a, 0, 3.8, 0, 0.12);
    block(kiosk, 0xb9c3cf, 0, 1.6, 0.55, 0.7, 0.6, 0.4, 0.06);   // coffee machine
    for (const sx of [-0.15, 0.15]) cylinder(kiosk, 0xffffff, sx, 1.38, 0.8, 0.06, 0.14);
    cylinder(kiosk, 0xffffff, 0.75, 1.38, 0.75, 0.07, 0.16);
    // a giant coffee cup on the roof, with steam
    cylinder(kiosk, 0xffffff, 0, 4.2, 0, 0.35, 0.6);
    put(kiosk, G.torus(0.18, 0.05), toon(0xffffff), { x: 0.38, y: 4.2, ry: 0 });
    cylinder(kiosk, 0x6b3e1e, 0, 4.48, 0, 0.3, 0.04, { shadow: false });
    block(kiosk, toon(0xffffff, { map: signTexture("Coffee", { bg: "#2f8f6f", fg: "#ffffff", emoji: "☕", w: 384, h: 128 }) }), 0, 0.65, 1.3, 1.6, 0.5, 0.06, 0.03);
    const steamMat = toon(0xffffff, { transparent: true, opacity: 0.6 });
    const steam = [0, 1, 2].map(() => dynamic(put(root, G.lowSphere(), steamMat, { s: 0.15, shadow: false })));
    anim.push((t) => steam.forEach((s, i) => {
      const k = (t * 0.4 + i / 3) % 1;
      s.position.set(K.x + Math.sin(t + i) * 0.1, 4.6 + k * 1.2, K.z + Math.cos(t * 1.3 + i) * 0.1);
      s.scale.setScalar(0.12 + k * 0.18);
    }));

    // ---------- flower stall (its front faces -x) ----------
    const FS = { x: 14.4, z: -2.6 };
    const fs = group(root, FS.x, 0, FS.z, -PI / 2);
    for (let tier = 0; tier < 3; tier++) block(fs, 0xc98b4a, 0, 0.35 + tier * 0.4, -tier * 0.38, 2.6, 0.12, 0.45, 0.03);
    for (const sx of [-1.25, 1.25]) for (const sz of [0.15, -0.9]) cylinder(fs, 0xa86b3c, sx, 1.4, sz, 0.05, 2.8);
    block(fs, toon(0xffffff, { map: stripeTexture([0xff8fb8, 0xffffff], 10, false) }), 0, 2.85, -0.35, 2.9, 0.06, 1.6, 0.02, { rx: 0.2 });
    block(fs, toon(0xffffff, { map: signTexture("Flowers", { bg: "#ff8fb8", fg: "#ffffff", emoji: "🌷", w: 384, h: 112 }) }), 0, 2.45, 0.42, 1.8, 0.45, 0.05, 0.03);
    const flowerItems = [], buckets = [], stems = [];
    const fcols = [0xff5a7a, 0xffe25a, 0xffffff, 0xb58cff, 0xff9a3a, 0xff8fb8];
    const fr = seeded(41);
    for (let tier = 0; tier < 3; tier++) {
      for (let i = 0; i < 5; i++) {
        const lx = -1.0 + i * 0.5, ly = 0.41 + tier * 0.4, lz = -tier * 0.38;
        // turn the stall's own coordinates into world positions (it's turned -90°)
        const wx = FS.x - lz, wz = FS.z + lx;
        buckets.push({ x: wx, y: ly + 0.12, z: wz, s: 0.15, sy: 0.25, color: [0x8fa6c0, 0xb9c3cf][(i + tier) % 2] });
        const c = fcols[Math.floor(fr() * fcols.length)];
        for (let k = 0; k < 5; k++) {
          const ox = (fr() - 0.5) * 0.22, oz = (fr() - 0.5) * 0.22;
          flowerItems.push({ x: wx + ox, y: ly + 0.45 + fr() * 0.12, z: wz + oz, s: 0.075, color: c });
          stems.push({ x: wx + ox, y: ly + 0.3, z: wz + oz, sx: 0.015, sy: 0.32, sz: 0.015 });
        }
      }
    }
    scatter(root, G.cyl(8), toon(0xffffff), buckets, true);
    scatter(root, G.tinySphere(), toon(0xffffff), flowerItems, false);
    scatter(root, G.cyl(4), toon(0x4f9e35), stems, false);

    // ---------- the fountain in the middle ----------
    const f = group(root, F.x, 0, F.z);
    cylinder(f, 0xe8e2d6, 0, 0.3, 0, 1.9, 0.6, { seg: 32 });
    put(f, G.torus(1.85, 0.16), toon(0xf4efe4), { y: 0.6, rx: PI / 2 });
    disc(f, toon(0x6fd0f7), 0, 0.56, 0, 1.72);
    cylinder(f, 0xe8e2d6, 0, 1.2, 0, 0.28, 1.4);
    put(f, G.taper(0.9, 0.3), toon(0xf4efe4), { y: 1.95, sy: 0.3 });
    disc(f, toon(0x6fd0f7), 0, 2.11, 0, 0.82);
    // a little fish statue spouting water on top
    ball(f, 0xffb02b, 0, 2.45, 0, 0.26, { sx: 0.8, sz: 1.2 });
    put(f, G.cone(), toon(0xffb02b), { y: 2.45, z: -0.35, s: 0.2, sy: 0.3, rx: -PI / 2 });
    for (const sx of [-0.12, 0.12]) ball(f, 0x222222, sx, 2.55, 0.18, 0.04);
    const DROPS = 40;
    const drops = movingCopies(root, G.tinySphere(), toon(0xbdeeff, { transparent: true, opacity: 0.9 }), DROPS);
    anim.push((t) => {
      for (let i = 0; i < DROPS; i++) {
        const k = (t * 0.6 + i / DROPS) % 1;
        const a = (i / DROPS) * TAU * 3;
        const tier = i % 2;
        const rr = (tier ? 0.15 : 0.85) + k * (tier ? 0.65 : 0.9);
        const y0 = tier ? 2.7 : 2.15;
        drops.set(i, F.x + Math.cos(a) * rr, y0 + Math.sin(k * PI) * 0.45 - k * (tier ? 0.6 : 1.55), F.z + Math.sin(a) * rr, 0, 0, 0.065);
      }
    });
    // a street clock next to the fountain, showing the real time
    const CL = { x: 6.8, z: 3.4 };
    cylinder(root, 0x2f4f46, CL.x, 0.12, CL.z, 0.25, 0.24);
    cylinder(root, 0x2f4f46, CL.x, 1.8, CL.z, 0.08, 3.4);
    const clock = group(root, CL.x, 3.85, CL.z);
    cylinder(clock, 0x2f4f46, 0, 0, 0, 0.55, 0.3, { rx: PI / 2 });
    for (const side of [-1, 1]) {
      const face = group(clock, 0, 0, side * 0.16, side < 0 ? PI : 0);
      disc(face, toon(0xffffff), 0, 0, 0, 0.46, { rx: 0 });
      for (let i = 0; i < 12; i++) block(face, 0x333333, Math.sin((i / 12) * TAU) * 0.38, Math.cos((i / 12) * TAU) * 0.38, 0.01, 0.04, 0.08, 0.01, 0.005, { rz: -(i / 12) * TAU, shadow: false });
      const hour = dynamic(group(face, 0, 0, 0.02));
      const min = dynamic(group(face, 0, 0, 0.03));
      block(hour, 0x333333, 0, 0.12, 0, 0.05, 0.25, 0.01, 0.005, { shadow: false });
      block(min, 0x333333, 0, 0.17, 0, 0.035, 0.36, 0.01, 0.005, { shadow: false });
      anim.push(() => {
        const now = new Date();
        const m = now.getMinutes() + now.getSeconds() / 60, h = (now.getHours() % 12) + m / 60;
        hour.rotation.z = -(h / 12) * TAU;
        min.rotation.z = -(m / 60) * TAU;
      });
    }
    ball(root, 0x2f4f46, CL.x, 4.5, CL.z, 0.12);

    // ---------- the busker's drum and hat ----------
    const BK = { x: -6.2, z: 4.2 };
    const drum = group(root, BK.x, 0, BK.z + 0.95);
    cylinder(drum, 0xff5a5a, 0, 0.35, 0, 0.35, 0.7);
    cylinder(drum, 0xfff6e0, 0, 0.71, 0, 0.34, 0.02, { shadow: false });
    for (const y of [0.05, 0.66]) put(drum, G.torus(0.35, 0.03), toon(0xffcf3a), { y, rx: PI / 2 });
    cylinder(root, 0xc98b4a, BK.x + 0.25, 0.85, BK.z + 0.8, 0.015, 0.4, { rz: 0.8 });
    const hat = group(root, BK.x + 0.95, 0, BK.z + 0.6);
    cylinder(hat, 0x333333, 0, 0.03, 0, 0.3, 0.04);
    cylinder(hat, 0x333333, 0, 0.12, 0, 0.18, 0.18);
    for (let i = 0; i < 3; i++) cylinder(hat, 0xffcf3a, (i - 1) * 0.06, 0.22, 0.02, 0.04, 0.01, { shadow: false });

    // ---------- bus stop with a bench (it faces the road, +z) ----------
    const BS = { x: 9.4, z: 7.6 };
    const bs = group(root, BS.x, 0, BS.z);
    for (const sx of [-1.6, 1.6]) cylinder(bs, 0x55606e, sx, 1.4, -0.45, 0.06, 2.8);
    block(bs, toon(0xd8f2ff, { transparent: true, opacity: 0.45, depthWrite: false }), 0, 1.55, -0.5, 3.2, 1.9, 0.04, 0.01);
    block(bs, 0x4a90e2, 0, 2.85, -0.1, 3.6, 0.12, 1.3, 0.04);
    block(bs, 0x4a90e2, 0, 0.47, -0.2, 2.4, 0.07, 0.5, 0.03);
    for (const sx of [-1.0, 1.0]) block(bs, 0x55606e, sx, 0.23, -0.2, 0.06, 0.46, 0.4, 0.02);
    // the bus stop sign and timetable
    cylinder(bs, 0x55606e, 2.0, 1.4, 0.3, 0.05, 2.8);
    cylinder(bs, 0xffffff, 2.0, 2.65, 0.3, 0.32, 0.06, { rx: PI / 2 });
    put(bs, G.torus(0.32, 0.05), toon(0x4a90e2), { x: 2.0, y: 2.65, z: 0.3 });
    plane(bs, 0.5, 0.5, toon(0xffffff, { map: canvasTexture(64, 64, (ctx) => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 64, 64); ctx.font = "44px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🚌", 32, 34); }) }), { x: 2.0, y: 2.65, z: 0.34 });
    block(bs, 0xffffff, -1.6, 1.4, -0.36, 0.08, 0.9, 0.5, 0.02);

    // ---------- benches, lamps and planters around the street ----------
    const BN = { x: -9.6, z: 7.2, ry: 0 };
    parkBench(root, BN.x, BN.z, BN.ry);
    const lamps = [[-12.6, -3.2], [8.6, -4.0], [-6.0, 9.0], [4.6, 8.8], [17.0, 6.5], [-17.2, 5.0]];
    lamps.forEach(([x, z]) => lampPost(root, x, z));
    const planters = [
      { x: -11.6, z: -5.0, w: 1.4, tree: false }, { x: 8.2, z: -7.0, w: 1.2, tree: true }, { x: -17.0, z: 8.6, w: 1.2, tree: true },
      { x: 16.8, z: 2.8, w: 1.2, tree: true }, { x: -2.4, z: 9.2, w: 1.0, tree: false }, { x: 16.8, z: -8.4, w: 1.0, tree: false },
    ];
    for (const P of planters) {
      block(root, 0xa86b3c, P.x, 0.35, P.z, P.w, 0.7, P.w, 0.1);
      block(root, 0x6b4a2a, P.x, 0.68, P.z, P.w - 0.15, 0.05, P.w - 0.15, 0.02, { shadow: false });
      if (P.tree) {
        put(root, G.taper(0.08, 0.12), toon(0x9a6a3c), { x: P.x, y: 1.4, z: P.z, sy: 1.6 });
        ball(root, 0x5cc84a, P.x, 2.6, P.z, 0.85);
        ball(root, 0x7fdc5c, P.x + 0.25, 2.9, P.z + 0.3, 0.45);
      } else {
        bush(root, P.x, P.z, 0.55, 0x5cc84a, 0xff6fa5).position.y = 0.6;
      }
    }

    // ---------- bunting across the street ----------
    const flags = [];
    const flagGeo = triangleGeo([-0.17, 0, 0, 0.17, 0, 0, 0, -0.42, 0]);
    const bColors = [0xff5a5a, 0xffcf3a, 0x4a90e2, 0x5cc84a, 0xff8fb8, 0xffffff];
    for (const z of [-2.2, 4.2]) {
      const pts = sagPoints(new THREE.Vector3(-21, 7.2, z), new THREE.Vector3(21, 7.2, z), 1.4, 30);
      rope(root, pts, 0xffffff, 0.02);
      const curve = new THREE.CatmullRomCurve3(pts);
      for (let i = 1; i < 60; i++) {
        const p = curve.getPoint(i / 60);
        flags.push({ x: p.x, y: p.y - 0.02, z, color: bColors[i % bColors.length] });
      }
    }
    scatter(root, flagGeo, toon(0xffffff, { side: THREE.DoubleSide }), flags, false);

    // ---------- buildings on the left, right and front ----------
    const zones = cafeScenery(root, anim, FZ, TZ);
    skyClouds(root, anim);

    // ---------- pigeons pecking around the fountain ----------
    const pigeonGeo = bakeGeo((p) => {
      ball(p, 0xa9b3c4, 0, 0.16, 0, 0.14, { sz: 1.4 });
      ball(p, 0x8a95a8, 0, 0.18, -0.06, 0.11, { sx: 1.2, sz: 1.4, sy: 0.7 });
      ball(p, 0x7fa89a, 0, 0.3, 0.14, 0.09);
      ball(p, 0x222222, 0.05, 0.33, 0.19, 0.018);
      ball(p, 0x222222, -0.05, 0.33, 0.19, 0.018);
      put(p, G.cone(), toon(0xffb02b), { y: 0.3, z: 0.24, s: 0.03, sy: 0.08, rx: PI / 2 });
    });
    const pigeons = movingCopies(root, pigeonGeo, paintedMat, 4, true);
    const pg = [{ x: 0.0, z: 3.4 }, { x: 0.9, z: 4.0 }, { x: 5.6, z: -2.0 }, { x: -2.5, z: 1.0 }];
    anim.push((t) => pg.forEach((p, i) => {
      const wander = t * 0.2 + i * 1.7;
      const x = p.x + Math.sin(wander) * 0.8, z = p.z + Math.cos(wander * 0.8) * 0.5;
      const peck = Math.max(0, Math.sin(t * 5 + i * 2)) > 0.8 ? 0.45 : 0;
      pigeons.set(i, x, 0, z, Math.cos(wander) * 0.8 + i, 0, 1, peck);
    }));

    mergeStatic(back);
    dynamic(back); // (so the merge below leaves it alone)
    mergeStatic(root);

    const tableSpot = (T, activity, emoji, lines) => ({
      x: T.x + 0.95, z: T.z - 0.85, yaw: 0, arms: "eat", emoji, activity,
      seat: { x: T.x, z: T.z - 0.85, y: 0.52 - 0.56 }, lines,
    });

    return {
      group: root,
      background: 0xcdeeff,
      fog: [0xd8f2ff, 80, 240],
      cameraTilt: 0.42,
      cameraTargetY: 1.6,
      // zoomed right out, the camera stays inside the ring of nearby buildings
      // (the ones further out start beyond it), so they can't block the view
      cameraMaxDistance: 30,
      riders: zones.riders, // random Miis on the bikes (the hub adds them)
      rare: zones.rare,     // the rare Mustang (see cafeScenery)
      bounds: { minX: -17, maxX: 17, minZ: -9.8, maxZ: 10 },
      entrance: { x: 0.6, z: 9.4 },
      water: [{ x: F.x, z: F.z, r: 1.7 }],
      obstacles: [
        { x: 0, z: FZ - 4, w: 60, d: 8.2 },                              // the shops
        { x: F.x, z: F.z, r: 2.0 },                                      // fountain
        { x: CL.x, z: CL.z, r: 0.3 },                                    // clock
        { x: K.x, z: K.z, r: 1.4 },                                      // coffee kiosk
        { x: FS.x + 0.4, z: FS.z, w: 1.5, d: 2.8 },                      // flower stall
        { x: MB.x, z: MB.z, w: 0.85, d: 0.7 },                           // menu board
        { x: BK.x, z: BK.z + 0.95, r: 0.38 }, { x: BK.x + 0.95, z: BK.z + 0.6, r: 0.3 }, // drum and hat
        { x: BS.x, z: BS.z - 0.2, w: 3.6, d: 1.2 }, { x: BS.x + 2.0, z: BS.z + 0.3, r: 0.12 }, // bus stop
        { x: BN.x, z: BN.z - 0.05, w: 2.5, d: 1.0 },                     // bench
        ...lightPoles.map((P) => ({ x: P.x, z: P.z, r: 0.12 })),
        ...terraceTables.map((T) => ({ x: T.x, z: T.z, r: 0.55 })),
        ...terraceTables.map((T) => ({ x: T.x, z: T.z - 0.85, w: 0.55, d: 0.55 })),
        ...terraceTables.map((T) => ({ x: T.x, z: T.z + 0.85, w: 0.55, d: 0.55 })),
      ].concat(lamps.map(([x, z]) => ({ x, z, r: 0.25 })))
        .concat(planters.map((P) => ({ x: P.x, z: P.z, w: P.w, d: P.w }))),
      spots: [
        tableSpot(terraceTables[0], "sipping coffee", "☕", ["Mmm, a perfect latte!", "Careful, it's hot!", "Coffee makes everything better.", "One more cup, please!"]),
        tableSpot(terraceTables[1], "having cake at the café", "🍰", ["This cake is amazing!", "Just one more bite...", "Strawberry shortcake, my favorite!", "Nom nom nom."]),
        { x: K.x + 2.0, z: K.z, yaw: -PI / 2, arms: "wave", emoji: "☕", activity: "ordering a coffee",
          lines: ["One cappuccino, please!", "Extra foam!", "Can I get a muffin too?", "Smells so good!"] },
        { x: MB.x, z: MB.z - 1.15, yaw: 0, emoji: "📋", activity: "reading the menu",
          lines: ["Hmm, so many choices...", "Cupcake or cake?", "Ooh, a new special!", "I'll have... everything!"] },
        { x: -15.3, z: -9.25, yaw: PI, arms: "eat", emoji: "🥖", activity: "buying bread",
          lines: ["Fresh from the oven!", "One croissant, please!", "Mmm, still warm!", "I'll take two loaves."] },
        { x: 4.0, z: -9.25, yaw: PI, emoji: "👗", activity: "window shopping",
          lines: ["That dress is so cute!", "Do they have it in my size?", "I need new shoes...", "Ooh, a sale!"] },
        { x: 12.6, z: -9.25, yaw: PI, arms: "cheer", emoji: "🧸", activity: "looking at the toys",
          lines: ["A teddy bear!", "I want that rocket!", "Toys aren't just for kids!", "So many toys!"] },
        { x: FS.x - 1.6, z: FS.z, yaw: PI / 2, emoji: "💐", activity: "smelling the flowers",
          lines: ["Mmm, roses!", "Achoo!", "I'll buy a bunch for a friend.", "So colorful!"] },
        { x: BS.x, z: BS.z + 1.35, yaw: 0, emoji: "🚌", activity: "waiting for the bus",
          seat: { x: BS.x, z: BS.z - 0.2, y: 0.51 - 0.56 },
          lines: ["Is the bus late again?", "Any minute now...", "I hope there's a seat.", "*checks the timetable*"] },
        { x: F.x, z: F.z - 2.55, yaw: 0, emoji: "⛲", activity: "making a wish at the fountain",
          lines: ["*makes a wish*", "I threw a coin in!", "The fishy is so cute!", "So sparkly!"] },
        { x: BK.x, z: BK.z, yaw: 0, arms: "drum", emoji: "🥁", activity: "busking on the drum",
          lines: ["Ba-dum tss!", "Thank you, thank you!", "Any requests?", "Boom boom boom!"] },
        { x: BN.x, z: BN.z + 1.2, yaw: BN.ry, emoji: "🪑", activity: "people watching on the bench",
          seat: { x: BN.x, z: BN.z + 0.08, y: 0 },
          lines: ["Such a lively street!", "I love it here.", "Look at all the shops!", "*people watching*"] },
      ],
      lines: [
        "Let's get a coffee!", "I love this street!", "Smell the fresh bread!", "Shopping time!",
        "Look at that cute dress!", "Ding ding! The tram!", "Meet you at the fountain!", "Cake o'clock!",
        "So many shops!", "What a lovely day for a stroll!",
      ],
      update(t, camera) {
        anim.forEach((a) => a(t));
        // camera behind the shops? hide them so they don't block the view
        if (camera) {
          const c = camera.position;
          back.visible = c.z > FZ - 1.5;
          // the same for the trees and buildings round the square: whichever side
          // the camera has swung round to (or past) hides, so you always see the street
          zones.behind.visible = c.z > FZ - 1.5;
          zones.left.visible = c.x > -ZONE_X;
          zones.right.visible = c.x < ZONE_X;
          zones.front.visible = c.z < TZ + ZONE_FRONT;
        }
      },
    };
  }

  // Where the scenery round Café Street is split into zones (see cafeScenery).
  const ZONE_X = 17.5, ZONE_FRONT = 5.5;

  // The rest of the town around the café street. Right around the square it's
  // kept low (trees, a little park across the tram road), and the buildings
  // start further out. Everything is split into zones (left, right, in front
  // across the tram road, behind the shops): when you spin the camera round
  // zoomed out, the zone it's in or behind hides, so nothing ever stands
  // between the camera and the street. Returns the zone groups.
  function cafeScenery(root, anim, FZ, TZ) {
    const r = seeded(29);
    const zones = { left: dynamic(group(root)), right: dynamic(group(root)), front: dynamic(group(root)), behind: dynamic(group(root)) };
    const zoneOf = (x, z) => (z < FZ - 6 ? "behind" : x < -ZONE_X ? "left" : x > ZONE_X ? "right" : z > TZ + ZONE_FRONT ? "front" : null);
    // scatter (or farScatter), one lot per zone
    const zScatter = (geo, mat, items, castShadow, far) => {
      const by = new Map();
      for (const it of items) { const k = zoneOf(it.x, it.z); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
      for (const [k, list] of by) {
        const parent = k ? zones[k] : root;
        if (far) farScatter(parent, geo, mat, list); else scatter(parent, geo, mat, list, castShadow);
      }
    };
    const winMat = windowMaterial({ glass: 0x8fcfee, w: 2.2, h: 3.0, minY: 3.8 });
    const farWinMat = windowMaterial({ glass: 0x8fcfee, w: 2.6, h: 3.4 });
    const pastel = [0xffd29a, 0xffb59a, 0xa9d0ff, 0xb5e3a0, 0xffb8d2, 0xc9b8ff, 0xf3dfb0, 0x9fd4ee, 0xffdc70, 0xf2f2f2];
    const roofColors = [0xff6b5a, 0x4fb7c9, 0xff9a3a, 0x7a8cff, 0x5cb85c, 0xe86a9a];
    const pick = (list) => list[Math.floor(r() * list.length)];

    // ---------- green strips on both sides, and a little park across the road ----------
    const grass = toon(0x8fd16f);
    for (const side of [-1, 1]) put(root, new THREE.PlaneGeometry(11, 20), grass, { x: side * 24, y: 0.012, z: 0.4, rx: -PI / 2, shadow: false });
    put(root, new THREE.PlaneGeometry(64, 12), grass, { y: 0.012, z: TZ + 12, rx: -PI / 2, shadow: false });
    const trunks = [], crowns = [], hedges = [];
    const tree = (x, z, s) => {
      trunks.push({ x, y: 1.1 * s, z, sx: 0.22 * s, sy: 2.2 * s, sz: 0.22 * s, color: 0x9a6a3c });
      crowns.push({ x, y: 2.9 * s, z, s: 1.5 * s, sy: 1.35 * s, color: r() < 0.25 ? 0xff9ec7 : pick([0x5cc84a, 0x4fbf47, 0x6cc84a]) });
      crowns.push({ x: x + 0.5 * s, y: 3.5 * s, z: z + 0.3 * s, s: 0.85 * s, color: 0x7fdc5c });
    };
    for (const side of [-1, 1]) {
      for (let z = -7.5; z <= 9.5; z += 3.4) tree(side * (20.5 + r() * 1.2), z + (r() - 0.5), 0.95 + r() * 0.2);
      for (let z = -6; z <= 9; z += 4) tree(side * (25.5 + r() * 2), z + (r() - 0.5) * 2, 1.1 + r() * 0.3);
      hedges.push({ x: side * 18.6, y: 0.4, z: 0.4, sx: 0.9, sy: 0.8, sz: 19.4, color: 0x4fae3f });
    }
    for (let x = -28; x <= 28; x += 4.5) tree(x + (r() - 0.5) * 1.5, TZ + 9 + r() * 6, 1.0 + r() * 0.4);
    hedges.push({ x: 0, y: 0.35, z: TZ + 6.6, sx: 60, sy: 0.7, sz: 0.8, color: 0x4fae3f });
    zScatter(G.cyl(8), toon(0xffffff), trunks, true);
    zScatter(G.lowSphere(), toon(0xffffff), crowns, true);
    zScatter(G.rbox(1, 1, 1, 0.3), toon(0xffffff), hedges, true);

    // ---------- the next streets: low shops and houses facing the square ----------
    const near = [], roofs = [], shopfronts = [], awnings = [];
    const fronts = [];
    // (x, z) = middle, w = along its street, h = height, face = the way its front faces (ry)
    const building = (x, z, w, h, ry) => {
      const color = pick(pastel), d = 8;
      const along = Math.abs(Math.sin(ry)) < 0.5; // its street runs along x
      const sx = along ? w : d, sz = along ? d : w;
      shopfronts.push({ x, y: 3.9 / 2, z, sx, sy: 3.9, sz, color });
      near.push({ x, y: 3.9 + (h - 3.9) / 2, z, sx, sy: h - 3.9, sz, color });
      roofs.push({ x, y: h, z, sx: w + 0.2, sy: 2.2, sz: d + 0.2, ry: along ? 0 : PI / 2, color: pick(roofColors) });
      const fx = x + Math.sin(ry) * (d / 2 + 0.03), fz = z + Math.cos(ry) * (d / 2 + 0.03);
      awnings.push({ x: fx + Math.sin(ry) * 0.6, y: 3.3, z: fz + Math.cos(ry) * 0.6, sx: w - 1, sy: 0.12, sz: 1.3, ry, color: pick([0xff5a5a, 0x4a90e2, 0x5cc84a, 0xffcf3a, 0xff8fb8, 0x7a6ad0]) });
      fronts.push({ fx, fz, ry });
    };
    for (const side of [-1, 1]) {
      for (let z = -20; z <= 28; z += 8.4) building(side * 34, z, 8.2, 7 + Math.floor(r() * 3) * 1.5, side < 0 ? PI / 2 : -PI / 2);
    }
    for (let x = -25.2; x <= 25.2; x += 8.4) building(x, TZ + 23.5, 8.2, 7 + Math.floor(r() * 3) * 1.5, PI);
    zScatter(G.box(), toon(0xffffff), shopfronts, false, true);
    zScatter(G.box(), winMat, near, false, true);
    zScatter(prismGeo(), toon(0xffffff), roofs, false, true);
    zScatter(G.box(), toon(0xffffff), awnings, false, true);
    // shop windows and doors on those buildings (one painted shape per zone)
    for (const k of Object.keys(zones)) painted(zones[k], bakeGeo((g) => {
      for (const F of fronts) {
        if (zoneOf(F.fx, F.fz) !== k) continue;
        const s = group(g, F.fx, 0, F.fz, F.ry);
        bx(s, 0x5a4636, -1.6, 1.7, 0.02, 2.6, 2.2, 0.04);
        bx(s, 0xd8f2ff, -1.6, 1.7, 0.05, 2.4, 2.0, 0.02);
        bx(s, 0xffffff, 1.9, 1.3, 0.03, 1.4, 2.6, 0.06);
        bx(s, pick([0x4a90e2, 0x2f8f6f, 0xff5a5a, 0x8a5a32]), 1.9, 1.25, 0.06, 1.1, 2.4, 0.04);
      }
    }));

    // ---------- further away: blocks of buildings all around ----------
    const far = [], farRoofs = [], trees = [];
    for (let x = -150; x <= 150; x += 11) {
      for (let z = -150; z <= 150; z += 11) {
        const jx = x + (r() - 0.5) * 3, jz = z + (r() - 0.5) * 3;
        if (Math.abs(jx) < 44 && jz > -33 && jz < 46) continue; // the square and the streets around it
        const dist = Math.hypot(jx, jz);
        if (dist > 160) continue;
        if (r() < 0.15) { trees.push({ x: jx, y: 2.6, z: jz, s: 2.4, sy: 2.2, color: r() < 0.3 ? 0xff9ec7 : 0x5cc84a }); continue; }
        const w = 6 + r() * 3.5, d = 6 + r() * 3.5;
        // taller buildings further out, a tall one now and then
        const h = 7 + r() * 6 + Math.max(0, dist - 40) * 0.08 + (r() < 0.08 ? 10 : 0);
        far.push({ x: jx, y: h / 2, z: jz, sx: w, sy: h, sz: d, color: pick(pastel) });
        if (r() < 0.75) farRoofs.push({ x: jx, y: h, z: jz, sx: w + 0.3, sy: 2.4 + r() * 1.5, sz: d + 0.3, ry: r() < 0.5 ? 0 : PI / 2, color: pick(roofColors) });
      }
    }
    // the buildings right behind the shops
    for (let x = -26; x <= 26; x += 8.5) {
      const h = 11 + r() * 6;
      far.push({ x, y: h / 2, z: FZ - 22, sx: 8.2, sy: h, sz: 6, color: pick(pastel) });
      farRoofs.push({ x, y: h, z: FZ - 22, sx: 8.4, sy: 2.6, sz: 6.3, color: pick(roofColors) });
    }
    zScatter(G.box(), farWinMat, far, false, true);
    zScatter(prismGeo(), toon(0xffffff), farRoofs, false, true);
    zScatter(G.lowSphere(), toon(0xffffff), trees, false, true);
    // a church tower and a few hills far away (one painted shape)
    painted(root, bakeGeo((g) => {
      const ch = group(g, -18, 0, -48);
      bx(ch, 0xfff6e0, 0, 9, 0, 6, 18, 6);
      roof(ch, 0x5cb85c, 0, 18, 0, 6.4, 7, 6.4);
      put(ch, G.cone(4), toon(0x5cb85c), { y: 23, sx: 3.5, sy: 9, sz: 3.5, ry: PI / 4 });
      cylinder(ch, 0xffffff, 0, 14, 3.05, 1.5, 0.2, { rx: PI / 2 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        put(g, G.lowSphere(), toon(i % 2 ? 0x6cc84a : 0x5cb84a), { x: Math.cos(a) * 205, y: -6, z: Math.sin(a) * 205, sx: 40, sy: 22 + (i % 3) * 8, sz: 26 });
      }
    }));

    // ---------- the tram ----------
    const tram = mover(root, (t) => {
      for (let k = 0; k < 2; k++) {
        const ox = (k - 0.5) * 7.4;
        block(t, 0xffcf3a, ox, 1.65, 0, 7.2, 2.4, 2.4, 0.4);
        block(t, 0xffffff, ox, 0.62, 0, 7.25, 0.5, 2.45, 0.2);
        block(t, 0xbfe6ff, ox, 2.05, 0, 6.6, 0.9, 2.46, 0.15);
        for (let i = 0; i < 5; i++) bx(t, 0xffcf3a, ox - 2.8 + i * 1.4, 2.05, 0, 0.12, 0.92, 2.5);
        block(t, 0xff5a5a, ox, 2.95, 0, 7.0, 0.2, 2.2, 0.1);
        for (const sx of [-2.4, 2.4]) cylinder(t, 0x333333, ox + sx, 0.35, 0, 0.35, 2.2, { rx: PI / 2, seg: 10 });
      }
      for (const sx of [-7.4, 7.4]) ball(t, 0xfff6c0, sx, 1.0, 0, 0.25, { sx: 0.3 });
      // the pole that touches the wire
      bx(t, 0x333333, 0, 3.6, 0, 0.08, 1.2, 0.08, { rz: 0.5 });
      bx(t, 0x333333, -0.5, 4.3, 0, 1.2, 0.06, 0.06);
    }, true);
    tram.position.set(-200, 0, TZ);
    anim.push((t) => {
      // the tram comes past every 40 seconds, slowing down a little in front of the square
      const cycle = (t + 8) % 40;
      const x = cycle < 18 ? -90 + cycle * 10 - Math.sin((cycle / 18) * PI) * 25 : 200;
      tram.position.x = x;
    });

    // ---------- RARE: a 1969 Mustang fastback rolls down the tram road ----------
    // (well under 1% of the time, and only while you're watching). Click it: it honks,
    // stops, revs its engine and speeds off, and you get a sticker.
    const stang = mover(root, (c) => {
      const red = 0xc4161c, black = 0x1a1a1e, chrome = 0xdfe4ea;
      block(c, red, 0, 0.62, 0, 4.6, 0.5, 1.85, 0.18);                 // body
      block(c, red, -0.25, 1.28, 0, 1.3, 0.42, 1.5, 0.16);             // the cabin
      for (const sz of [-0.755, 0.755]) block(c, 0x9fd8ff, -0.2, 1.3, sz, 1.0, 0.26, 0.02, 0.03); // side windows
      block(c, 0x9fd8ff, 0.47, 1.25, 0, 0.04, 0.38, 1.36, 0.02, { rz: 0.6 }); // windshield, leaning back
      // the fastback: one long slope from the roof down to the tail
      block(c, red, -1.55, 1.2, 0, 1.45, 0.1, 1.5, 0.04, { rz: 0.39 });
      block(c, 0x9fd8ff, -1.32, 1.3, 0, 0.75, 0.02, 1.25, 0.01, { rz: 0.39 }); // rear glass
      block(c, black, 1.5, 0.89, 0, 1.4, 0.02, 0.42, 0.01);           // black hood stripe
      block(c, black, 2.32, 0.6, 0, 0.06, 0.3, 1.45, 0.02);           // grille
      for (const sz of [-0.58, 0.58]) ball(c, 0xfff6c0, 2.33, 0.62, sz, 0.12, { sx: 0.4 }); // headlights
      for (const sx of [2.38, -2.32]) block(c, chrome, sx, 0.4, 0, 0.08, 0.1, 1.9, 0.03); // bumpers
      for (const sz of [-0.45, -0.2, 0.2, 0.45]) block(c, 0xff3b3b, -2.31, 0.66, sz, 0.04, 0.12, 0.18, 0.01); // tail lights
      for (const sx of [-1.45, 1.4]) for (const sz of [-0.88, 0.88]) {
        cylinder(c, black, sx, 0.36, sz, 0.36, 0.26, { rx: PI / 2, seg: 14 });
        cylinder(c, chrome, sx, 0.36, sz * 1.08, 0.18, 0.04, { rx: PI / 2, seg: 10 });
      }
    }, true);
    stang.visible = false;
    let sfx = null;
    const sound = (kind) => {
      try {
        sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = sfx.currentTime, g = sfx.createGain();
        g.connect(sfx.destination);
        if (kind === "honk") {
          for (const [f, at] of [[392, 0], [494, 0], [392, 0.28], [494, 0.28]]) {
            const o = sfx.createOscillator(); o.type = "square"; o.frequency.value = f;
            const og = sfx.createGain(); og.gain.setValueAtTime(0, t0 + at); og.gain.linearRampToValueAtTime(0.07, t0 + at + 0.02); og.gain.setValueAtTime(0.07, t0 + at + 0.2); og.gain.linearRampToValueAtTime(0, t0 + at + 0.24);
            o.connect(og).connect(g); o.start(t0 + at); o.stop(t0 + at + 0.26);
          }
        } else {
          // the V8: a growly sawtooth that revs up twice, then roars off
          const o = sfx.createOscillator(), o2 = sfx.createOscillator(), lp = sfx.createBiquadFilter();
          o.type = "sawtooth"; o2.type = "square"; lp.type = "lowpass"; lp.frequency.value = 700;
          const f = (v, at) => { o.frequency.linearRampToValueAtTime(v, t0 + at); o2.frequency.linearRampToValueAtTime(v * 0.5, t0 + at); };
          o.frequency.setValueAtTime(45, t0); o2.frequency.setValueAtTime(22, t0);
          f(140, 0.35); f(55, 0.75); f(170, 1.1); f(60, 1.5); f(220, 2.4); f(260, 3.2);
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 0.1); g.gain.setValueAtTime(0.12, t0 + 2.6); g.gain.linearRampToValueAtTime(0, t0 + 3.4);
          o.connect(lp); o2.connect(lp); lp.connect(g); o.start(t0); o2.start(t0); o.stop(t0 + 3.5); o2.stop(t0 + 3.5);
        }
      } catch (e) { /* no sound */ }
    };
    const CAR_Z = TZ - 1.6;
    const car = { state: "idle", x: -80, v: 0, timer: 0, check: 4 };
    const startCar = () => { Object.assign(car, { state: "drive", x: -75, v: 11, timer: 0 }); stang.visible = true; };
    zones.rare = {
      update(dt, t, ctx) {
        if (car.state === "idle") {
          car.check -= dt;
          if (car.check <= 0) {
            car.check = 4;
            if (Math.random() < 0.008 && tram.position.x > 150) startCar();
          }
          return;
        }
        car.timer += dt;
        if (car.state === "honk") { // slow down and stop
          car.v = Math.max(0, car.v - dt * 9);
          if (car.v === 0 && car.timer > 0.5) { car.state = "rev"; car.timer = 0; sound("rev"); }
        } else if (car.state === "rev") { // rev the engine, bouncing on its springs
          stang.rotation.z = Math.sin(car.timer * 38) * 0.012 + (car.timer % 0.75 < 0.3 ? 0.025 : 0);
          if (car.timer > 2.3) { car.state = "go"; car.timer = 0; stang.rotation.z = 0.04; }
        } else if (car.state === "go") { // floor it
          car.v += dt * 22;
          stang.rotation.z = Math.max(0, stang.rotation.z - dt * 0.05);
        }
        car.x += car.v * dt;
        stang.position.set(car.x, 0, CAR_Z);
        if (car.x > 80) {
          if (car.state === "go") ctx.event("mustang");
          car.state = "idle"; stang.visible = false; stang.rotation.z = 0;
        }
      },
      pick(ray) {
        if (car.state !== "drive") return false;
        if (!ray.intersectsBox(new THREE.Box3().setFromObject(stang))) return false;
        car.state = "honk"; car.timer = 0; sound("honk");
        return true;
      },
      force: startCar, _car: stang, _state: car, // (for testing)
    };

    // ---------- cyclists on the street in front of the shops ----------
    const bikeGeo = (shirt) => bakeGeo((b) => {
      for (const sx of [-0.55, 0.55]) put(b, G.torus(0.33, 0.04), toon(0x333333), { x: sx, y: 0.36 });
      bx(b, 0xff5a5a, 0, 0.6, 0, 1.0, 0.07, 0.07, { rz: 0.15 });
      bx(b, 0xff5a5a, 0.4, 0.75, 0, 0.07, 0.6, 0.07, { rz: -0.3 });
      bx(b, 0x333333, 0.5, 1.05, 0, 0.08, 0.06, 0.6);
      bx(b, 0x333333, -0.15, 0.95, 0, 0.3, 0.08, 0.2);
      // (the rider is a real random Mii, added by the hub: see world.riders)
    });
    const bikes = [
      { mesh: dynamic(painted(root, bikeGeo(0x5cc84a))), z: 10.7, speed: 3.2, off: 0 },
      { mesh: dynamic(painted(root, bikeGeo(0xff8fb8))), z: 11.1, speed: -2.7, off: 40 },
    ];
    // where the hub sits a random Mii on each bike (facing the way the bike goes)
    zones.riders = bikes.map((b) => ({ parent: b.mesh, x: -0.15, y: 0.42, z: 0, yaw: PI / 2 })); // (y: the saddle, minus the seat drop)
    anim.push((t) => bikes.forEach((b, i) => {
      const x = ((((t * b.speed + b.off) % 120) + 180) % 120) - 60;
      b.mesh.position.set(x, Math.abs(Math.sin(t * 6 + i)) * 0.02, b.z);
      b.mesh.rotation.y = b.speed > 0 ? 0 : PI;
    }));
    return zones;
  }

  root.World3D.addPlace({ id: "beach", name: "Beach", icon: "🏖️" }, buildBeach);
  root.World3D.addPlace({ id: "cafe", name: "Café Street", icon: "☕" }, buildCafe);
})(typeof self !== "undefined" ? self : this);
