/*
 * pb-models.js
 * Procedural weapon models + first-person viewmodel animation for the Paintball mini-game.
 *   - "AK": an AK-47 silhouette dressed as a modern paintball marker: a clear banana mag with the
 *     paintballs stacked inside (no hopper, so the view over the gun stays clear), air-tank stock,
 *     ported barrel, anodised accent parts.
 *   - "AWP": thumbhole sniper marker with a slim clear feed tube and a box mag.
 *   - "Deagle": Desert Eagle sidearm: big angular slide with a clear chamber window, triangular
 *     barrel, chunky raked grip with a clear window onto the paintball-filled mag.
 *   - Butterfly knife (balisong) with two handles that really rotate around their own pivot pins.
 *   - Mii arms: plain round sleeves with a ball for a hand (the grip goes through it). In first
 *     person both hands hold the guns (left hand under the AK's handguard / the AWP's forend,
 *     cupping the right hand on the Deagle); the knife stays one-handed.
 * Everything is built from merged, vertex-colored BufferGeometry (few draw calls), no assets.
 * Classic script: uses the global THREE (r147) and exposes window.PBModels.
 *
 * Weapon skins (PBSkins, see pb-skins.js): pattern textures, skin materials and preview pictures
 * are attached to PBSkins at the end of this file.
 *
 * Viewmodel space = camera space (x right, y up, looking down -Z). The viewmodel group carries
 * its OWN lights (hemisphere + key + rim) unless opts.lights === false.
 */
(function (root) {
  "use strict";
  var THREE = root.THREE;
  var PI = Math.PI, TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------------------------
  // Small math / geometry helpers
  // ---------------------------------------------------------------------------------------------
  var _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();

  function mtx(px, py, pz, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0, "XYZ");
    _q.setFromEuler(_e);
    if (sx === undefined) sx = 1;
    if (sy === undefined) sy = sx;
    if (sz === undefined) sz = sx;
    return new THREE.Matrix4().compose(new THREE.Vector3(px || 0, py || 0, pz || 0), _q.clone(), new THREE.Vector3(sx, sy, sz));
  }

  function lin(hex) { // configurable sRGB hex -> linear working color (renderer outputs sRGB)
    var c = new THREE.Color(hex);
    if (c.convertSRGBToLinear) c.convertSRGBToLinear();
    return c;
  }
  function shade(c, k) { return c.clone().multiplyScalar(k); }
  function mix(a, b, t) { return a.clone().lerp(b, t); }

  // Builder: collects geometry parts (with a vertex color each) and merges them into one geometry.
  // Skins: parts added while `b.skin` is 1 get skinMask = 1 (they wear the weapon skin; the rest keep
  // their vertex color), and when `b.uvp` is set every part gets box-projected UVs in gun space
  // (side faces: u along the gun, v up; top/bottom faces: v across the width), so the pattern lines
  // up across all the merged parts. `b.pivot` = where a withOffset() builder's origin sits in gun space.
  function Builder() { this.parts = []; this.off = new THREE.Matrix4(); this.pivot = null; this.skin = 0; this.uvp = null; }
  function projectUV(P, U, n, q, pv) {
    var ox = pv ? pv.x : 0, oy = pv ? pv.y : 0, oz = pv ? pv.z : 0;
    for (var t = 0; t + 2 < n; t += 3) {
      var i0 = t * 3, i1 = i0 + 3, i2 = i0 + 6;
      var ax = P[i1] - P[i0], ay = P[i1 + 1] - P[i0 + 1], az = P[i1 + 2] - P[i0 + 2];
      var bx = P[i2] - P[i0], by = P[i2 + 1] - P[i0 + 1], bz = P[i2 + 2] - P[i0 + 2];
      var nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
      var top = ny > nx && ny > nz, end = nz > nx && nz > ny;
      for (var k = 0; k < 3; k++) {
        var j = (t + k) * 3, x = P[j] + ox, y = P[j + 1] + oy, z = P[j + 2] + oz;
        var u = (z - q.z0) * q.su, v = top ? 0.5 + x / q.H : (y - q.y0) / q.H;
        if (end) u += x * Math.abs(q.su);
        U[(t + k) * 2] = u; U[(t + k) * 2 + 1] = v;
      }
    }
  }
  Builder.prototype.add = function (geo, color, m) {
    var g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    var full = new THREE.Matrix4();
    if (m) full.multiplyMatrices(this.off, m); else full.copy(this.off);
    g.applyMatrix4(full);
    var pos = g.attributes.position.array, nor = g.attributes.normal.array;
    var n = pos.length / 3;
    var P = new Float32Array(pos), N = new Float32Array(nor);
    if (full.determinant() < 0) { // mirrored: fix winding
      for (var t = 0; t < n; t += 3) {
        for (var k = 0; k < 3; k++) {
          var a = (t + 1) * 3 + k, b = (t + 2) * 3 + k, tmp;
          tmp = P[a]; P[a] = P[b]; P[b] = tmp;
          tmp = N[a]; N[a] = N[b]; N[b] = tmp;
        }
      }
    }
    var C = new Float32Array(n * 3);
    var col = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (var i = 0; i < n; i++) { C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; }
    var U = new Float32Array(n * 2), SK = new Float32Array(n);
    if (this.skin) SK.fill(1);
    if (this.uvp) projectUV(P, U, n, this.uvp, this.pivot);
    this.parts.push({ p: P, n: N, c: C, u: U, s: SK });
    g.dispose();
    if (geo !== g && geo.userData && geo.userData.temp) geo.dispose();
    return this;
  };
  Builder.prototype.geometry = function () {
    var total = 0, i;
    for (i = 0; i < this.parts.length; i++) total += this.parts[i].p.length;
    var P = new Float32Array(total), N = new Float32Array(total), C = new Float32Array(total), o = 0;
    var U = new Float32Array(total / 3 * 2), SK = new Float32Array(total / 3);
    for (i = 0; i < this.parts.length; i++) {
      P.set(this.parts[i].p, o); N.set(this.parts[i].n, o); C.set(this.parts[i].c, o);
      U.set(this.parts[i].u, o / 3 * 2); SK.set(this.parts[i].s, o / 3);
      o += this.parts[i].p.length;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("color", new THREE.BufferAttribute(C, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("skinMask", new THREE.BufferAttribute(SK, 1));
    g.computeBoundingSphere();
    return g;
  };
  Builder.prototype.mesh = function (mat) {
    var m = new THREE.Mesh(this.geometry(), mat);
    m.frustumCulled = false;
    return m;
  };
  function withOffset(b, x, y, z) { b.off = new THREE.Matrix4().makeTranslation(-x, -y, -z); b.pivot = new THREE.Vector3(x, y, z); return b; }
  function withUV(q) { for (var i = 1; i < arguments.length; i++) arguments[i].uvp = q; }

  // Skin UV layouts (gun space). u runs butt -> muzzle (blade: tang -> tip), v bottom -> top; the
  // texture canvases (W x H px) have square pixels for these spans, so patterns are not stretched.
  var SKIN_UV = {
    ak: { z0: 0.36, su: -1 / 1.0, y0: -0.226, H: 0.32, W: 1024, Hpx: 328 },
    awp: { z0: 0.375, su: -1 / 1.18, y0: -0.15, H: 0.31, W: 1024, Hpx: 269 },
    deagle: { z0: 0.072, su: -1 / 0.33, y0: -0.016, H: 0.076, W: 1024, Hpx: 236 }, // slide, barrel and frame band
    blade: { z0: 0.013, su: -1 / 0.128, y0: -0.016, H: 0.032, W: 1024, Hpx: 256 },
    handle: { z0: -0.009, su: 1 / 0.14, y0: -0.016, H: 0.032 * 1.094, W: 1024, Hpx: 256 }
  };

  // Geometry primitives -------------------------------------------------------------------------
  function roundRectShape(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // Rounded box: w (x) * h (y) * d (z), corner radius cr in xy, bevel b on the z faces. Centerd.
  function rbox(w, h, d, cr, b) {
    b = b === undefined ? Math.min(w, h, d) * 0.12 : b;
    var s = roundRectShape(Math.max(w - 2 * b, 1e-4), Math.max(h - 2 * b, 1e-4), Math.max(cr - b, 0));
    var g = new THREE.ExtrudeGeometry(s, { depth: Math.max(d - 2 * b, 1e-4), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    return g;
  }
  // Side profile extrusion: pts = [[z,y],...] outline in the gun's side view, extruded across x (width).
  function sideShape(pts, width, bevel, holes) {
    bevel = bevel === undefined ? 0.002 : bevel;
    var s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    if (holes) for (var h = 0; h < holes.length; h++) s.holes.push(holes[h]);
    var depth = Math.max(width - 2 * bevel, 1e-4);
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(-PI / 2); // shape x -> +z, extrusion -> -x
    g.translate(depth / 2, 0, 0);
    return g;
  }
  function shapeSide(shape, width, bevel) { // same as sideShape for a prepared THREE.Shape
    bevel = bevel || 0;
    var depth = Math.max(width - 2 * bevel, 1e-4);
    var g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 2, curveSegments: 10 });
    g.rotateY(-PI / 2);
    g.translate(depth / 2, 0, 0);
    return g;
  }
  function circlePath(cx, cy, r, seg) {
    var p = new THREE.Path(); seg = seg || 12;
    for (var i = 0; i <= seg; i++) {
      var a = -i / seg * TAU; // clockwise for holes
      if (i === 0) p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return p;
  }
  function slotPath(x0, x1, cy, r) { // stadium-shaped hole (clockwise)
    var p = new THREE.Path(), seg = 6, i, a;
    p.moveTo(x0, cy + r);
    for (i = 0; i <= seg; i++) { a = PI / 2 + i / seg * PI; p.lineTo(x0 + Math.cos(a) * r, cy + Math.sin(a) * r); }
    p.lineTo(x1, cy - r);
    for (i = 0; i <= seg; i++) { a = -PI / 2 + i / seg * PI; p.lineTo(x1 + Math.cos(a) * r, cy + Math.sin(a) * r); }
    p.lineTo(x0, cy + r);
    // reverse to clockwise
    var pts = p.getPoints(), q = new THREE.Path();
    pts.reverse(); q.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) q.lineTo(pts[i].x, pts[i].y);
    return q;
  }
  function cylZ(r1, r2, len, seg, open) { // along z, centerd
    var g = new THREE.CylinderGeometry(r2, r1, len, seg || 16, 1, !!open);
    g.rotateX(PI / 2); // top (r2) goes to +z
    return g;
  }
  function cylY(r1, r2, len, seg) { return new THREE.CylinderGeometry(r2, r1, len, seg || 16); }
  function cylX(r, len, seg) { var g = new THREE.CylinderGeometry(r, r, len, seg || 12); g.rotateZ(PI / 2); return g; }
  function sph(r, ws, hs) { return new THREE.SphereGeometry(r, ws || 14, hs || 10); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  // ---------------------------------------------------------------------------------------------
  // Shared procedural environment map (gives metal & gloss something to reflect, no assets)
  // ---------------------------------------------------------------------------------------------
  var _env = null;
  function envMap() {
    if (_env) return _env;
    if (typeof document === "undefined") return null;
    var faces = [], S = 64;
    for (var f = 0; f < 6; f++) {
      var c = document.createElement("canvas"); c.width = c.height = S;
      var g = c.getContext("2d");
      if (f === 2) { // +Y sky
        var rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S * 0.7);
        rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.4, "#e6eef8"); rg.addColorStop(1, "#b9c6d6");
        g.fillStyle = rg; g.fillRect(0, 0, S, S);
      } else if (f === 3) { // -Y floor
        g.fillStyle = "#3a3734"; g.fillRect(0, 0, S, S);
      } else {
        var lg = g.createLinearGradient(0, 0, 0, S);
        lg.addColorStop(0, "#d7e2ee"); lg.addColorStop(0.47, "#9aa6b2"); lg.addColorStop(0.53, "#5d5a55"); lg.addColorStop(1, "#2f2c29");
        g.fillStyle = lg; g.fillRect(0, 0, S, S);
        // soft boxes
        g.fillStyle = "rgba(255,255,255,0.95)";
        if (f === 0 || f === 4) g.fillRect(S * 0.15, S * 0.12, S * 0.3, S * 0.18);
        if (f === 1) g.fillRect(S * 0.55, S * 0.1, S * 0.25, S * 0.12);
      }
      faces.push(c);
    }
    _env = new THREE.CubeTexture(faces);
    _env.needsUpdate = true;
    return _env;
  }

  function stdMat(o) {
    var m = new THREE.MeshStandardMaterial({
      vertexColors: o.vc !== false, color: o.color || 0xffffff,
      roughness: o.rough === undefined ? 0.5 : o.rough, metalness: o.metal || 0,
      envMap: o.env === false ? null : envMap(), envMapIntensity: o.envI === undefined ? 0.9 : o.envI,
      transparent: !!o.transparent, opacity: o.opacity === undefined ? 1 : o.opacity,
      depthWrite: o.transparent ? false : true, side: o.side || THREE.FrontSide
    });
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // AK paintball marker geometry.  Gun space: origin = top of the pistol grip (center), barrel -Z.
  // ---------------------------------------------------------------------------------------------
  var AK = {
    magPivot: new THREE.Vector3(0, -0.006, -0.142),
    boltPos: new THREE.Vector3(0.024, 0.036, -0.152),
    muzzle: new THREE.Vector3(0, 0.012, -0.62)
  };

  function akPalette(accent) {
    var A = lin(accent);
    return {
      accent: A, accentD: shade(A, 0.55), accentL: mix(A, new THREE.Color(1, 1, 1), 0.25),
      dark: new THREE.Color(0.035, 0.037, 0.042), dark2: new THREE.Color(0.075, 0.078, 0.085),
      gray: new THREE.Color(0.22, 0.23, 0.25), steel: new THREE.Color(0.6, 0.62, 0.65),
      white: new THREE.Color(0.9, 0.9, 0.9), black: new THREE.Color(0.01, 0.01, 0.012),
      ball: mix(A, new THREE.Color(1, 0.85, 0.1), 0.0),
      lens: new THREE.Color(0.1, 0.28, 0.5), glint: new THREE.Color(1, 1, 1)
    };
  }

  // Banana magazine curve (gun space): centerline c(s), s = 0 (top, in the magwell) .. 1 (floor plate).
  // The mag sweeps forward like a real AK mag; its edges are offset along the curve's normal so the
  // floor plate ends up square to the mag.
  function akMagFrame(s) {
    var z = -0.108 - 0.095 * Math.pow(s, 1.45), y = -0.006 - 0.19 * s;
    var tz = -0.1378 * Math.pow(Math.max(s, 1e-4), 0.45), ty = -0.19, tl = Math.sqrt(tz * tz + ty * ty);
    tz /= tl; ty /= tl;
    return { z: z, y: y, tz: tz, ty: ty, nz: -ty, ny: tz, w: 0.034 + 0.006 * s }; // n = toward the rear edge
  }

  // B = { poly, metal, mag, magShell, magBalls, bolt } (any can be the same builder)
  function buildAK(B, pal) {
    var poly = B.poly, metal = B.metal, i;
    // ---- receiver (stamped AK shape) ----
    poly.skin = 1;
    poly.add(sideShape([[0.088, 0.0], [0.088, 0.046], [0.078, 0.058], [-0.196, 0.058], [-0.212, 0.05], [-0.212, -0.004], [-0.17, -0.004], [-0.162, -0.016], [-0.072, -0.016], [-0.066, -0.002], [0.088, 0.0]], 0.040, 0.0025), pal.dark2);
    poly.skin = 0;
    // dust cover (rounded, ribbed) on top
    var dc = new THREE.CylinderGeometry(0.0195, 0.0195, 0.25, 18, 1, false, PI / 2, PI);
    dc.rotateX(PI / 2);
    metal.skin = 1;
    metal.add(dc, pal.gray, mtx(0, 0.052, -0.06));
    metal.skin = 0;
    for (i = 0; i < 3; i++) metal.add(new THREE.TorusGeometry(0.0196, 0.0016, 4, 12, PI), pal.dark, mtx(0, 0.052, 0.04 - i * 0.012, 0, 0, 0));
    metal.add(rbox(0.036, 0.012, 0.02, 0.004, 0.002), pal.gray, mtx(0, 0.06, 0.07)); // rear lip
    // trunnion rivets + side rail plate (left side) + accent stripe
    for (i = 0; i < 4; i++) {
      metal.add(cylX(0.0028, 0.043, 8), pal.steel, mtx(0, 0.014 + (i % 2) * 0.022, -0.2 + Math.floor(i / 2) * 0.012));
      metal.add(cylX(0.0028, 0.043, 8), pal.steel, mtx(0, 0.008 + (i % 2) * 0.022, 0.06 + Math.floor(i / 2) * 0.012));
    }
    poly.add(rbox(0.006, 0.026, 0.12, 0.004, 0.0015), pal.dark, mtx(-0.021, 0.024, -0.03));
    poly.add(box(0.003, 0.006, 0.28), pal.accent, mtx(-0.0205, 0.044, -0.06));
    poly.add(box(0.003, 0.006, 0.28), pal.accent, mtx(0.0205, 0.044, -0.06));
    // ejection port + selector lever (right side)
    poly.add(box(0.004, 0.02, 0.07), pal.black, mtx(0.019, 0.036, -0.09));
    metal.add(sideShape([[0.06, 0.03], [0.065, 0.034], [-0.13, 0.03], [-0.125, 0.026]], 0.004, 0.0008), pal.steel, mtx(0.023, -0.002, 0));
    metal.add(sideShape([[-0.13, 0.028], [-0.142, 0.012], [-0.136, 0.01], [-0.124, 0.027]], 0.004, 0.0008), pal.steel, mtx(0.023, 0, 0));
    // ---- trigger guard + trigger ----
    poly.add(sideShape([[-0.072, -0.016], [-0.072, -0.034], [-0.062, -0.044], [0.0, -0.044], [0.008, -0.036], [0.004, -0.02], [-0.0, -0.022], [-0.002, -0.036], [-0.06, -0.036], [-0.064, -0.028], [-0.064, -0.016]], 0.012, 0.0012), pal.dark);
    metal.add(sideShape([[-0.03, -0.004], [-0.036, -0.016], [-0.04, -0.03], [-0.034, -0.034], [-0.031, -0.022], [-0.024, -0.004]], 0.006, 0.001), pal.accentL);
    // ---- pistol grip (accent rubber) ----
    poly.add(sideShape([[0.022, 0.0], [-0.022, 0.0], [-0.012, -0.03], [-0.002, -0.06], [0.004, -0.098], [0.016, -0.112], [0.042, -0.108], [0.046, -0.094], [0.036, -0.05], [0.028, -0.02]], 0.034, 0.005), pal.accent);
    for (i = 0; i < 4; i++) poly.add(rbox(0.036, 0.0035, 0.012, 0.0015, 0.0008), pal.accentD, mtx(0, -0.035 - i * 0.017, 0.033 + i * 0.0045 - 0.004, 0.33));
    // ---- lower handguard (accent) with grooves and M-LOK slots ----
    poly.skin = 1;
    poly.add(sideShape([[-0.212, -0.006], [-0.212, 0.034], [-0.395, 0.034], [-0.405, 0.024], [-0.405, -0.0], [-0.39, -0.024], [-0.235, -0.024], [-0.222, -0.012]], 0.052, 0.006), pal.accent);
    poly.skin = 0;
    for (i = 0; i < 3; i++) {
      poly.add(rbox(0.0035, 0.012, 0.03, 0.005, 0.001), pal.dark, mtx(-0.0262, 0.004, -0.255 - i * 0.045));
      poly.add(rbox(0.0035, 0.012, 0.03, 0.005, 0.001), pal.dark, mtx(0.0262, 0.004, -0.255 - i * 0.045));
    }
    poly.add(rbox(0.054, 0.004, 0.005, 0.002, 0.001), pal.dark, mtx(0, -0.018, -0.3));
    metal.add(rbox(0.05, 0.03, 0.012, 0.006, 0.002), pal.dark2, mtx(0, 0.01, -0.408)); // handguard retainer
    // ---- gas tube + upper handguard ----
    metal.add(cylZ(0.0105, 0.0105, 0.27, 14), pal.gray, mtx(0, 0.052, -0.33));
    poly.skin = 1;
    poly.add(sideShape([[-0.2, 0.038], [-0.2, 0.066], [-0.205, 0.072], [-0.36, 0.072], [-0.37, 0.06], [-0.37, 0.038]], 0.034, 0.006), pal.accent);
    poly.skin = 0;
    for (i = 0; i < 4; i++) poly.add(rbox(0.036, 0.003, 0.012, 0.0015, 0.0008), pal.accentD, mtx(0, 0.074, -0.23 - i * 0.035));
    // gas block + front sight
    metal.add(sideShape([[-0.44, -0.012], [-0.44, 0.062], [-0.47, 0.062], [-0.475, 0.04], [-0.475, -0.012]], 0.03, 0.002), pal.dark2);
    metal.add(sideShape([[-0.505, -0.014], [-0.505, 0.03], [-0.512, 0.078], [-0.53, 0.078], [-0.536, 0.03], [-0.536, -0.014]], 0.026, 0.002), pal.dark2);
    metal.add(cylY(0.0018, 0.0018, 0.028, 6), pal.steel, mtx(0, 0.072, -0.521));
    // ---- rear sight block + leaf ----
    metal.add(sideShape([[-0.19, 0.056], [-0.19, 0.074], [-0.2, 0.08], [-0.232, 0.08], [-0.24, 0.07], [-0.24, 0.056]], 0.034, 0.002), pal.dark2);
    metal.add(sideShape([[-0.2, 0.078], [-0.21, 0.087], [-0.29, 0.082], [-0.29, 0.078]], 0.022, 0.0008), pal.gray);
    metal.add(rbox(0.024, 0.008, 0.008, 0.002, 0.001), pal.accentL, mtx(0, 0.084, -0.255));
    // ---- barrel: thick paintball barrel with ported tip and slanted brake ----
    metal.add(cylZ(0.0145, 0.0145, 0.3, 20), pal.gray, mtx(0, 0.012, -0.36));
    metal.add(cylZ(0.0165, 0.0165, 0.012, 20), pal.dark, mtx(0, 0.012, -0.42));
    metal.add(cylZ(0.016, 0.0155, 0.07, 20), pal.accent, mtx(0, 0.012, -0.545)); // ported tip
    for (i = 0; i < 4; i++) {
      for (var k = 0; k < 6; k++) {
        var ang = k / 6 * TAU + (i % 2) * 0.5;
        poly.add(cylY(0.0028, 0.0028, 0.004, 8), pal.black, mtx(Math.cos(ang) * 0.0155, 0.012 + Math.sin(ang) * 0.0155, -0.52 - i * 0.016, 0, 0, ang - PI / 2));
      }
    }
    var brake = cylZ(0.019, 0.019, 0.045, 20);
    var bp = brake.attributes.position;
    for (i = 0; i < bp.count; i++) if (bp.getZ(i) < 0) bp.setZ(i, bp.getZ(i) - 0.012 + bp.getY(i) * 0.6); // slanted front
    brake.computeVertexNormals();
    metal.add(brake, pal.dark2, mtx(0, 0.012, -0.598));
    metal.add(cylZ(0.0115, 0.0115, 0.002, 16), pal.black, mtx(0, 0.012, -0.633)); // bore shadow
    metal.add(rbox(0.005, 0.012, 0.022, 0.002, 0.001), pal.black, mtx(0, 0.03, -0.6)); // brake port slot
    // ---- stock: skeleton frame (accent) + compressed-air tank (as the stock) ----
    poly.skin = 1;
    poly.add(sideShape([[0.086, 0.048], [0.12, 0.044], [0.3, 0.012], [0.33, 0.012], [0.33, 0.0], [0.3, 0.0], [0.12, 0.03], [0.086, 0.03]], 0.02, 0.003), pal.accent);
    poly.skin = 0;
    poly.add(sideShape([[0.31, 0.02], [0.345, 0.024], [0.348, -0.072], [0.31, -0.07]], 0.046, 0.006), pal.dark); // butt pad
    var tilt = -0.11;
    var tankM = function (x, y, z) { return new THREE.Matrix4().compose(new THREE.Vector3(x || 0, (y || 0) - 0.032, z || 0.205), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1)); };
    metal.skin = 1;
    metal.add(cylZ(0.034, 0.034, 0.17, 24), pal.steel, tankM());
    var cap = sph(0.034, 24, 12); cap.scale(1, 1, 0.55);
    metal.add(cap, pal.steel, tankM(0, 0, 0.29));
    metal.skin = 0;
    for (i = 0; i < 2; i++) metal.add(cylZ(0.0352, 0.0352, 0.012, 24), pal.accent, tankM(0, 0, 0.15 + i * 0.1));
    metal.add(cylZ(0.022, 0.03, 0.02, 20), pal.gray, tankM(0, 0, 0.11)); // regulator
    metal.add(cylZ(0.02, 0.02, 0.03, 16), pal.dark2, tankM(0, 0.0, 0.088)); // ASA adapter
    metal.add(cylX(0.011, 0.012, 16), pal.steel, tankM(-0.018, 0.02, 0.112)); // gauge
    poly.add(cylX(0.009, 0.0125, 16), pal.white, tankM(-0.0185, 0.02, 0.112));
    poly.add(box(0.001, 0.008, 0.0012), pal.black, tankM(-0.025, 0.022, 0.112).multiply(mtx(0, 0, 0, 0.8)));
    // stock-to-receiver plate
    poly.skin = 1;
    poly.add(rbox(0.036, 0.05, 0.016, 0.006, 0.002), pal.dark2, mtx(0, 0.022, 0.09));
    poly.skin = 0;

    // ---- magazine: a clear polycarbonate banana mag full of paintballs, in a slim frame ----
    // (built in gun space; the mag builders are offset to the mag pivot)
    var mag = B.mag, N = 16, f, sh = [], rearS = [], frontS = [];
    for (i = 0; i <= N; i++) { f = akMagFrame(i / N); sh.push([f.z + f.nz * f.w, f.y + f.ny * f.w]); }
    for (i = N; i >= 0; i--) { f = akMagFrame(i / N); sh.push([f.z - f.nz * f.w, f.y - f.ny * f.w]); }
    B.magShell.add(sideShape(sh, 0.025, 0.003), pal.white); // the clear body
    var core = []; // a thin dark divider down the middle, so the balls stand out against it
    for (i = 0; i <= N; i++) { f = akMagFrame(i / N); core.push([f.z + f.nz * (f.w - 0.004), f.y + f.ny * (f.w - 0.004)]); }
    for (i = N; i >= 0; i--) { f = akMagFrame(i / N); core.push([f.z - f.nz * (f.w - 0.004), f.y - f.ny * (f.w - 0.004)]); }
    B.mag.add(sideShape(core, 0.0024, 0.0004), pal.dark);
    // rear + front spines (the frame that holds the clear body; these wear the skin)
    for (i = 0; i <= N; i++) { f = akMagFrame(i / N); rearS.push([f.z + f.nz * (f.w + 0.002), f.y + f.ny * (f.w + 0.002)]); }
    for (i = N; i >= 0; i--) { f = akMagFrame(i / N); rearS.push([f.z + f.nz * (f.w - 0.009), f.y + f.ny * (f.w - 0.009)]); }
    for (i = 0; i <= N; i++) { f = akMagFrame(i / N); frontS.push([f.z - f.nz * (f.w + 0.002), f.y - f.ny * (f.w + 0.002)]); }
    for (i = N; i >= 0; i--) { f = akMagFrame(i / N); frontS.push([f.z - f.nz * (f.w - 0.008), f.y - f.ny * (f.w - 0.008)]); }
    mag.skin = 1;
    mag.add(sideShape(rearS, 0.029, 0.0025), pal.dark2);
    mag.add(sideShape(frontS, 0.029, 0.0025), pal.dark2);
    // floor plate (square to the mag) + feed lips
    f = akMagFrame(1);
    mag.add(rbox(0.034, 0.012, f.w * 2 + 0.01, 0.004, 0.002), pal.dark2, mtx(0, f.y - f.ty * 0.003, f.z - f.tz * 0.003, Math.atan2(-f.ny, f.nz)));
    mag.skin = 0;
    mag.add(rbox(0.036, 0.004, f.w * 2 + 0.006, 0.0015, 0.001), pal.accent, mtx(0, f.y - f.ty * 0.0105, f.z - f.tz * 0.0105, Math.atan2(-f.ny, f.nz)));
    mag.add(rbox(0.03, 0.01, 0.07, 0.003, 0.0015), pal.dark, mtx(0, -0.009, -0.108)); // feed lips
    // accent ribs around the clear body + a round-count scale on the rear spine
    for (i = 0; i < 3; i++) {
      f = akMagFrame(0.3 + i * 0.25);
      mag.add(rbox(0.0285, 0.0035, f.w * 2, 0.0012, 0.0008), pal.accent, mtx(0, f.y, f.z, Math.atan2(-f.ny, f.nz)));
    }
    for (i = 1; i < 9; i++) {
      f = akMagFrame(i / 9.5);
      var tx = f.z + f.nz * (f.w - 0.004), ty = f.y + f.ny * (f.w - 0.004);
      mag.add(box(0.0305, 0.0014, i % 2 ? 0.004 : 0.007), pal.white, mtx(0, ty, tx - f.nz * 0.001, Math.atan2(-f.ny, f.nz)));
    }
    // paintballs: a staggered double stack following the curve (the top one peeks out of the lips)
    var rb = 0.0086, ballGeo = sph(rb, 12, 9), arc = 0, next = 0.0, prev = akMagFrame(0), side = 0, seed = 11;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var hi = mix(pal.ball, new THREE.Color(1, 1, 1), 0.35);
    for (i = 0; i <= 400; i++) {
      f = akMagFrame(0.045 + i / 400 * 0.86);
      arc += Math.sqrt((f.z - prev.z) * (f.z - prev.z) + (f.y - prev.y) * (f.y - prev.y));
      prev = f;
      if (arc < next) continue;
      var off = (side ? 1 : -1) * 0.0084;
      B.magBalls.add(ballGeo, rnd() < 0.82 ? pal.ball : hi, mtx((side ? 1 : -1) * 0.0018, f.y + f.ny * off, f.z + f.nz * off, rnd() * 3, rnd() * 3, 0));
      side ^= 1; next += 0.0124;
    }

    // ---- charging handle (relative to boltPos) ----
    B.bolt.add(cylX(0.0055, 0.022, 10), pal.steel, mtx(AK.boltPos.x + 0.008, AK.boltPos.y, AK.boltPos.z));
    B.bolt.add(sph(0.0075, 12, 8), pal.accent, mtx(AK.boltPos.x + 0.021, AK.boltPos.y, AK.boltPos.z));
    B.bolt.add(box(0.004, 0.012, 0.05), pal.steel, mtx(AK.boltPos.x - 0.003, AK.boltPos.y, AK.boltPos.z + 0.022));
  }

  // ---------------------------------------------------------------------------------------------
  // AWP paintball "sniper" marker geometry. Same gun space as the AK: origin = top of the pistol
  // grip, barrel -Z, bore axis at y = AWP.boreY. Accuracy-International style thumbhole chassis in
  // the accent color, round dark action, long fluted barrel with a big ported brake, a fat scope,
  // a bolt handle on the right, a box mag, and a slim clear paintball feed tube along the left side.
  // ---------------------------------------------------------------------------------------------
  var AWP = {
    boreY: 0.032, scopeY: 0.108,
    magPivot: new THREE.Vector3(0, -0.03, -0.1),
    boltPos: new THREE.Vector3(0, 0.032, 0.032), // bolt rotation axis (z) / pivot
    knob: new THREE.Vector3(0.05, -0.026, 0.006), // bolt knob center relative to boltPos (closed)
    muzzle: new THREE.Vector3(0, 0.032, -0.805)
  };

  // fluted cylinder along z (grooves cut every 60 degrees)
  function flutedZ(r, len, flutes, depth) {
    var g = new THREE.CylinderGeometry(r, r, len, flutes * 6, 1, false);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), z = p.getZ(i), rr = Math.sqrt(x * x + z * z);
      if (rr < r * 0.5) continue;
      var a = Math.atan2(z, x), c = Math.cos(a * flutes);
      var k = c > 0.35 ? 1 - depth : 1;
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    g.rotateX(PI / 2);
    return g;
  }

  // B = { poly, metal, mag, bolt, shell, balls, lens }
  function buildAWP(B, pal) {
    var poly = B.poly, metal = B.metal, lens = B.lens, i, k;
    var by = AWP.boreY, sy = AWP.scopeY;
    // ---- thumbhole stock + pistol grip (accent) ----
    var hole = new THREE.Path();
    var hp = [[0.066, 0.004], [0.24, 0.014], [0.262, 0.002], [0.262, -0.088], [0.245, -0.1], [0.095, -0.084], [0.07, -0.066], [0.062, -0.03]];
    hole.moveTo(hp[0][0], hp[0][1]); for (i = 1; i < hp.length; i++) hole.lineTo(hp[i][0], hp[i][1]);
    poly.skin = 1;
    poly.add(sideShape([[-0.026, 0.024], [0.06, 0.024], [0.1, 0.044], [0.13, 0.058], [0.3, 0.058], [0.335, 0.052], [0.352, 0.044], [0.356, -0.13],
      [0.34, -0.142], [0.29, -0.134], [0.13, -0.104], [0.07, -0.112], [0.048, -0.122], [0.02, -0.12], [0.008, -0.106], [0.002, -0.07], [-0.008, -0.034], [-0.022, -0.012]],
      0.04, 0.005, [hole]), pal.accent);
    poly.skin = 0;
    for (i = 0; i < 4; i++) poly.add(rbox(0.042, 0.0035, 0.012, 0.0015, 0.0008), pal.accentD, mtx(0, -0.04 - i * 0.017, -0.004 + i * 0.0035, 0.2)); // grip grooves
    poly.add(rbox(0.05, 0.19, 0.02, 0.008, 0.004), pal.dark, mtx(0, -0.044, 0.364)); // butt pad
    poly.add(rbox(0.034, 0.012, 0.13, 0.005, 0.003), pal.dark, mtx(0, 0.062, 0.215)); // cheek piece
    metal.add(cylY(0.004, 0.004, 0.02, 8), pal.steel, mtx(0, 0.052, 0.16));
    metal.add(cylY(0.004, 0.004, 0.02, 8), pal.steel, mtx(0, 0.052, 0.27));
    poly.add(box(0.003, 0.006, 0.2), pal.dark, mtx(-0.0205, 0.036, 0.2)); // side accent lines
    poly.add(box(0.003, 0.006, 0.2), pal.dark, mtx(0.0205, 0.036, 0.2));
    metal.add(cylX(0.006, 0.044, 10), pal.steel, mtx(0, -0.118, 0.29)); // sling stud
    // ---- chassis / forend (accent) under the action and barrel ----
    poly.skin = 1;
    poly.add(sideShape([[0.06, 0.024], [0.06, -0.006], [0.0, -0.03], [-0.17, -0.03], [-0.19, -0.022], [-0.44, -0.018], [-0.462, -0.008], [-0.466, 0.014], [-0.456, 0.026], [-0.2, 0.026], [-0.17, 0.024]], 0.054, 0.006), pal.accent);
    poly.skin = 0;
    for (i = 0; i < 5; i++) { // vent slots
      poly.add(rbox(0.004, 0.012, 0.036, 0.005, 0.001), pal.dark, mtx(-0.0272, 0.004, -0.23 - i * 0.045));
      poly.add(rbox(0.004, 0.012, 0.036, 0.005, 0.001), pal.dark, mtx(0.0272, 0.004, -0.23 - i * 0.045));
    }
    poly.add(rbox(0.056, 0.005, 0.006, 0.002, 0.001), pal.dark, mtx(0, -0.012, -0.19));
    poly.add(rbox(0.04, 0.008, 0.08, 0.003, 0.001), pal.dark, mtx(0, -0.022, -0.37)); // under rail
    // magwell + trigger guard + trigger
    metal.add(rbox(0.04, 0.016, 0.092, 0.004, 0.002), pal.dark2, mtx(0, -0.034, -0.1));
    poly.add(sideShape([[-0.054, -0.03], [-0.054, -0.05], [-0.044, -0.062], [0.004, -0.062], [0.01, -0.052], [0.004, -0.03], [-0.002, -0.032], [-0.003, -0.054], [-0.04, -0.054], [-0.046, -0.046], [-0.046, -0.03]], 0.012, 0.0012), pal.dark);
    metal.add(sideShape([[-0.022, -0.026], [-0.028, -0.036], [-0.031, -0.05], [-0.025, -0.053], [-0.022, -0.04], [-0.016, -0.026]], 0.006, 0.001), pal.accentL);
    // ---- action: round receiver, rail, ejection port ----
    metal.skin = 1;
    metal.add(cylZ(0.021, 0.021, 0.23, 22), pal.dark2, mtx(0, by, -0.055));
    metal.skin = 0;
    metal.add(cylZ(0.0225, 0.0225, 0.012, 22), pal.dark, mtx(0, by, 0.052));
    metal.add(cylZ(0.0225, 0.0225, 0.012, 22), pal.dark, mtx(0, by, -0.165));
    metal.add(rbox(0.024, 0.008, 0.25, 0.002, 0.001), pal.dark, mtx(0, by + 0.024, -0.06)); // picatinny rail
    for (i = 0; i < 12; i++) metal.add(box(0.026, 0.004, 0.009), pal.gray, mtx(0, by + 0.029, 0.055 - i * 0.02));
    poly.add(rbox(0.006, 0.014, 0.07, 0.003, 0.001), pal.black, mtx(0.019, by + 0.008, -0.045)); // ejection port
    metal.add(rbox(0.008, 0.012, 0.03, 0.003, 0.001), pal.accent, mtx(-0.02, by - 0.006, 0.03)); // safety / bolt release
    // ---- barrel: shank, long fluted section, crown + big ported brake ----
    metal.skin = 1; // barrel shroud / fluted barrel wears the skin too
    metal.add(cylZ(0.016, 0.016, 0.07, 22), pal.gray, mtx(0, by, -0.2));
    metal.add(flutedZ(0.0138, 0.44, 6, 0.17), pal.gray, mtx(0, by, -0.455));
    metal.skin = 0;
    metal.add(cylZ(0.0145, 0.0145, 0.008, 18), pal.dark, mtx(0, by, -0.24));
    metal.add(cylZ(0.0125, 0.0125, 0.05, 18), pal.gray, mtx(0, by, -0.69));
    metal.add(cylZ(0.0155, 0.0155, 0.01, 18), pal.dark, mtx(0, by, -0.715)); // lock nut
    var brake = rbox(0.038, 0.034, 0.08, 0.012, 0.004);
    metal.add(brake, pal.accent, mtx(0, by, -0.762));
    for (i = 0; i < 3; i++) {
      poly.add(rbox(0.04, 0.02, 0.012, 0.003, 0.001), pal.black, mtx(0, by, -0.738 - i * 0.022));
    }
    metal.add(cylZ(0.009, 0.009, 0.002, 16), pal.black, mtx(0, by, -0.8025)); // bore
    poly.add(cylZ(0.0075, 0.0075, 0.003, 12), pal.ball, mtx(0, by, -0.8)); // paintball in the bore
    // ---- scope: mounts, tube, turrets, bells, lenses ----
    for (k = 0; k < 2; k++) {
      var mz = k ? -0.15 : 0.018;
      metal.add(rbox(0.028, sy - by - 0.03, 0.02, 0.004, 0.002), pal.dark2, mtx(0, (sy + by + 0.03) / 2 - 0.004, mz));
      metal.add(cylZ(0.0175, 0.0175, 0.018, 20), pal.dark2, mtx(0, sy, mz));
      metal.add(cylZ(0.018, 0.018, 0.006, 20), pal.accent, mtx(0, sy, mz));
      metal.add(cylX(0.004, 0.04, 8), pal.steel, mtx(0, by + 0.036, mz));
    }
    metal.add(cylZ(0.0135, 0.0135, 0.27, 20), pal.dark, mtx(0, sy, -0.065)); // main tube
    metal.add(rbox(0.032, 0.032, 0.06, 0.008, 0.003), pal.dark2, mtx(0, sy, -0.07)); // turret saddle
    metal.add(cylY(0.012, 0.012, 0.03, 16), pal.dark, mtx(0, sy + 0.026, -0.07)); // elevation turret
    metal.add(cylY(0.0125, 0.0125, 0.008, 16), pal.accent, mtx(0, sy + 0.044, -0.07));
    metal.add(cylX(0.011, 0.028, 16), pal.dark, mtx(0.027, sy, -0.07)); // windage
    metal.add(cylX(0.0115, 0.007, 16), pal.accent, mtx(0.043, sy, -0.07));
    metal.add(cylX(0.009, 0.024, 14), pal.dark, mtx(-0.024, sy, -0.07)); // parallax
    for (i = 0; i < 4; i++) metal.add(cylY(0.0125, 0.0125, 0.0015, 16), pal.gray, mtx(0, sy + 0.016 + i * 0.006, -0.07));
    // rear bell / eyepiece
    metal.add(cylZ(0.0135, 0.021, 0.032, 22), pal.dark, mtx(0, sy, 0.084));
    metal.add(cylZ(0.021, 0.021, 0.04, 22), pal.dark2, mtx(0, sy, 0.12));
    metal.add(cylZ(0.0215, 0.0215, 0.008, 22), pal.accent, mtx(0, sy, 0.106));
    metal.add(cylZ(0.022, 0.0225, 0.016, 22), pal.dark, mtx(0, sy, 0.146)); // rubber eyecup
    // front bell / objective
    metal.add(cylZ(0.03, 0.0135, 0.07, 24), pal.dark, mtx(0, sy, -0.235));
    metal.add(cylZ(0.03, 0.03, 0.05, 24), pal.dark2, mtx(0, sy, -0.295));
    metal.add(cylZ(0.031, 0.031, 0.01, 24), pal.accent, mtx(0, sy, -0.316));
    for (i = 0; i < 2; i++) metal.add(cylZ(0.0305, 0.0305, 0.003, 24), pal.gray, mtx(0, sy, -0.28 + i * 0.01));
    // lenses (glossy, with painted glints)
    lens.add(cylZ(0.0265, 0.0265, 0.002, 24), pal.lens, mtx(0, sy, -0.3215));
    lens.add(cylZ(0.0175, 0.0175, 0.002, 20), pal.lens, mtx(0, sy, 0.1545));
    var glint = new THREE.CircleGeometry(1, 14);
    lens.add(glint, pal.glint, mtx(-0.009, sy + 0.009, -0.323, 0, PI, 0, 0.0065, 0.0042, 1));
    lens.add(glint, pal.glint, mtx(0.011, sy - 0.01, -0.323, 0, PI, 0, 0.0028, 0.0028, 1));
    lens.add(glint, pal.glint, mtx(-0.006, sy + 0.006, 0.156, 0, 0, 0, 0.0042, 0.0028, 1));
    // ---- slim paintball feed tube along the left side (clear, balls inside) ----
    var tz0 = -0.4, tz1 = -0.06, tx = -0.036, ty = 0.01, tr = 0.0095;
    B.shell.add(cylZ(tr, tr, tz1 - tz0, 16, true), pal.white, mtx(tx, ty, (tz0 + tz1) / 2));
    poly.add(cylZ(tr + 0.0015, tr + 0.0015, 0.016, 16), pal.accent, mtx(tx, ty, tz0 - 0.004)); // front cap
    poly.add(sph(tr + 0.0015, 14, 8), pal.accent, mtx(tx, ty, tz0 - 0.012, 0, 0, 0, 1, 1, 0.6));
    for (i = 0; i < 3; i++) poly.add(cylZ(tr + 0.0012, tr + 0.0012, 0.006, 16), pal.dark, mtx(tx, ty, -0.12 - i * 0.12)); // clamps
    var elbow = new THREE.TorusGeometry(0.014, tr, 10, 14, PI / 2);
    B.shell.add(elbow, pal.white, mtx(tx + 0.014, ty, tz1, PI / 2, 0, PI / 2));
    poly.add(cylX(tr + 0.002, 0.01, 14), pal.dark, mtx(-0.028, ty, tz1 + 0.014)); // feed port collar
    var rb = 0.0078, bg = sph(rb, 10, 8);
    for (var z = tz0 + 0.012; z < tz1 - 0.004; z += rb * 2.02) B.balls.add(bg, pal.ball, mtx(tx, ty, z));
    // ---- magazine (box mag, paintballs visible through the side slot) – relative to the mag pivot ----
    var mag = B.mag, mp = AWP.magPivot;
    mag.skin = 1;
    mag.add(rbox(0.03, 0.07, 0.074, 0.006, 0.003), pal.dark2, mtx(0, mp.y - 0.032, mp.z));
    mag.skin = 0;
    mag.add(rbox(0.036, 0.012, 0.082, 0.004, 0.002), pal.accent, mtx(0, mp.y - 0.07, mp.z)); // floor plate
    mag.add(rbox(0.032, 0.004, 0.06, 0.002, 0.001), pal.accent, mtx(0, mp.y - 0.02, mp.z));
    for (i = 0; i < 3; i++) for (k = -1; k <= 1; k += 2) mag.add(sph(0.0085, 10, 8), pal.ball, mtx(k * 0.009, mp.y - 0.034, mp.z + 0.02 - i * 0.02));
    mag.add(rbox(0.031, 0.012, 0.056, 0.004, 0.001), pal.black, mtx(0, mp.y - 0.034, mp.z)); // window slot behind the balls
    // ---- bolt: shroud + body + handle + knob, relative to the bolt pivot (closed = handle down/right) ----
    var bp = AWP.boltPos, bolt = B.bolt;
    bolt.add(cylZ(0.0115, 0.0115, 0.12, 14), pal.steel, mtx(0, bp.y, bp.z - 0.065)); // bolt body (seen when open)
    bolt.add(cylZ(0.016, 0.014, 0.032, 18), pal.dark, mtx(0, bp.y, bp.z + 0.04)); // shroud
    bolt.add(cylZ(0.006, 0.006, 0.012, 10), pal.accent, mtx(0, bp.y, bp.z + 0.06)); // cocking indicator
    var kn = AWP.knob;
    var arm = cylY(0.0042, 0.0048, 1, 10); // stalk from the bolt to the knob
    var dx = kn.x, dy = kn.y, L = Math.sqrt(dx * dx + dy * dy);
    bolt.add(arm, pal.steel, mtx(bp.x + dx / 2, bp.y + dy / 2, bp.z + kn.z, 0, 0, Math.atan2(dy, dx) - PI / 2, 1, L, 1));
    bolt.add(sph(0.0115, 14, 10), pal.accent, mtx(bp.x + kn.x, bp.y + kn.y, bp.z + kn.z));
  }

  // ---------------------------------------------------------------------------------------------
  // "Paint Deagle" (Desert Eagle) geometry. Same gun space: origin = top of the grip, barrel -Z,
  // bore at y = DG.boreY. Big angular slide (with a clear chamber window: two paintballs inside),
  // the fixed triangular barrel with a top rib, a chunky raked grip with a clear window low on each
  // side, through which the paintball-filled mag shows, and the big squared trigger guard with the
  // hooked front. The slide (blowback) and the mag (drops down the grip axis) are separate parts.
  // ---------------------------------------------------------------------------------------------
  var DG_GD = new THREE.Vector2(0.287, -0.958).normalize(); // grip axis in the side view (z, y), top -> bottom
  var DG_ROT = Math.atan2(-DG_GD.x, -DG_GD.y); // rotation about X that lines a box's +Y up the grip
  var DG = {
    boreY: 0.031,
    gripTop: new THREE.Vector3(0, 0, 0.03), // top of the grip axis (= the mag pivot)
    gripDir: new THREE.Vector3(0, DG_GD.y, DG_GD.x), // down the grip, gun space
    muzzle: new THREE.Vector3(0, 0.031, -0.262),
    slideTravel: 0.05
  };
  // point on the grip: s along its axis (down), o across it (+ = toward the back strap); [z, y] or Vector3
  function dgGrip(s, o) { return [DG.gripTop.z + DG_GD.x * s - DG_GD.y * o, DG.gripTop.y + DG_GD.y * s + DG_GD.x * o]; }
  function dgGripV(s, o, x) { var p = dgGrip(s, o || 0); return new THREE.Vector3(x || 0, p[1], p[0]); }
  // a hole for sideShape(), wound against the outline (so ExtrudeGeometry cuts it out either way)
  function holeFor(outer, pts) {
    var V = function (a) { return a.map(function (p) { return new THREE.Vector2(p[0], p[1]); }); };
    var hp = V(pts);
    if (THREE.ShapeUtils.isClockWise(hp) === THREE.ShapeUtils.isClockWise(V(outer))) hp.reverse();
    var path = new THREE.Path(); path.moveTo(hp[0].x, hp[0].y);
    for (var i = 1; i < hp.length; i++) path.lineTo(hp[i].x, hp[i].y);
    return path;
  }
  function stadiumPts(z0, z1, cy, r) { // a slot outline [[z, y], ...] (z0 < z1)
    var pts = [], i, a;
    for (i = 0; i <= 6; i++) { a = -PI / 2 + i / 6 * PI; pts.push([z1 + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    for (i = 0; i <= 6; i++) { a = PI / 2 + i / 6 * PI; pts.push([z0 + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }

  // B = { poly, metal, slide, slideShell, slideBalls, mag, magShell, magBalls } (any can be shared)
  function buildDeagle(B, pal) {
    var poly = B.poly, metal = B.metal, sl = B.slide, i, by = DG.boreY, gp = dgGrip, s;
    // ---- frame / dust cover + the big squared trigger guard with the hooked front (skinned) ----
    poly.skin = 1;
    poly.add(sideShape([[0.066, 0.013], [0.066, -0.004], [0.05, -0.012], [-0.236, -0.012], [-0.252, -0.003], [-0.252, 0.013]], 0.032, 0.003), pal.dark2);
    poly.add(sideShape([[-0.004, -0.011], [0.004, -0.03], [-0.001, -0.047], [-0.008, -0.058], [-0.074, -0.058], [-0.086, -0.05], [-0.09, -0.036], [-0.098, -0.03],
      [-0.094, -0.022], [-0.088, -0.011], [-0.078, -0.011], [-0.08, -0.044], [-0.07, -0.05], [-0.012, -0.05], [-0.008, -0.04], [-0.012, -0.011]], 0.012, 0.0015), pal.dark2);
    poly.skin = 0;
    for (i = -1; i <= 1; i += 2) {
      poly.add(box(0.0025, 0.005, 0.2), pal.accent, mtx(i * 0.0162, 0.0, -0.13)); // accent stripe on the dust cover
    }
    poly.add(rbox(0.005, 0.009, 0.022, 0.003, 0.001), pal.accent, mtx(-0.0175, 0.003, -0.112)); // takedown lever
    metal.add(cylX(0.0025, 0.0335, 8), pal.steel, mtx(0, -0.003, 0.042)); // frame pins
    metal.add(cylX(0.0025, 0.0335, 8), pal.steel, mtx(0, 0.002, -0.07));
    metal.add(sideShape([[-0.036, -0.01], [-0.042, -0.024], [-0.046, -0.04], [-0.04, -0.043], [-0.037, -0.028], [-0.03, -0.01]], 0.007, 0.001), pal.accentL); // trigger
    poly.add(sideShape([[0.06, 0.012], [0.066, 0.03], [0.074, 0.034], [0.078, 0.028], [0.07, 0.023], [0.068, 0.012]], 0.012, 0.0015), pal.accent); // hammer
    // ---- chunky raked grip (accent) with a clear window low on each side (the mag's balls show through) ----
    var gOut = [gp(-0.004, -0.024), gp(0.125, -0.027), gp(0.134, -0.02), gp(0.134, 0.023), gp(0.124, 0.03), gp(0.012, 0.03), gp(-0.002, 0.037), gp(-0.008, 0.032), gp(-0.008, -0.024)];
    var gWin = [gp(0.086, -0.012), gp(0.118, -0.012), gp(0.118, 0.014), gp(0.086, 0.014)];
    poly.add(sideShape(gOut, 0.036, 0.004, [holeFor(gOut, gWin)]), pal.accent);
    for (i = 0; i < 3; i++) { // grip grooves on the front strap
      var gq = dgGripV(0.03 + i * 0.022, -0.025);
      poly.add(rbox(0.037, 0.0035, 0.008, 0.0015, 0.0008), pal.accentD, mtx(0, gq.y, gq.z, DG_ROT));
    }
    // ---- slide: big and angular, rear serrations, safety levers, clear chamber window (skinned) ----
    var sOut = [[0.064, 0.012], [0.066, 0.047], [0.057, 0.056], [-0.104, 0.056], [-0.113, 0.049], [-0.113, 0.012]];
    sl.skin = 1;
    sl.add(sideShape(sOut, 0.037, 0.003, [holeFor(sOut, stadiumPts(-0.073, -0.035, 0.033, 0.0105))]), pal.gray);
    sl.skin = 0;
    for (i = -1; i <= 1; i += 2) {
      for (var k = 0; k < 7; k++) sl.add(box(0.0025, 0.03, 0.0028), pal.dark, mtx(i * 0.0186, 0.034, 0.022 + k * 0.0056, 0, 0, 0));
      sl.add(rbox(0.006, 0.01, 0.018, 0.003, 0.001), pal.accent, mtx(i * 0.0205, 0.045, 0.045)); // ambidextrous safety
      sl.add(box(0.0025, 0.0035, 0.16), pal.accent, mtx(i * 0.0186, 0.0175, -0.028)); // accent line under the window
    }
    sl.add(sideShape([[0.059, 0.055], [0.059, 0.067], [0.046, 0.067], [0.04, 0.055]], 0.03, 0.001), pal.dark); // rear sight
    sl.add(box(0.008, 0.006, 0.003), pal.black, mtx(0, 0.065, 0.0595)); // its notch
    B.slideShell.add(cylZ(0.0145, 0.0145, 0.064, 18), pal.white, mtx(0, 0.033, -0.054)); // clear chamber tube
    var bGeo = sph(0.0132, 14, 10);
    B.slideBalls.add(bGeo, pal.ball, mtx(0, 0.033, -0.0715)); B.slideBalls.add(bGeo, pal.ball, mtx(0, 0.033, -0.0455));
    // ---- the fixed barrel: triangular profile with a top rib, side flutes, paintball in the bore ----
    var tri = new THREE.Shape(); tri.moveTo(-0.0175, 0.012); tri.lineTo(0.0175, 0.012); tri.lineTo(0.0075, 0.0555); tri.lineTo(-0.0075, 0.0555); tri.closePath();
    var bar = new THREE.ExtrudeGeometry(tri, { depth: 0.146, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2 });
    bar.translate(0, 0, -0.255);
    metal.skin = 1;
    metal.add(bar, pal.gray);
    metal.skin = 0;
    metal.add(box(0.002, 0.011, 0.12), pal.dark, mtx(0.0146, 0.03, -0.185, 0, 0, 0.214)); // side flutes
    metal.add(box(0.002, 0.011, 0.12), pal.dark, mtx(-0.0146, 0.03, -0.185, 0, 0, -0.214));
    metal.add(rbox(0.01, 0.004, 0.13, 0.0015, 0.001), pal.accent, mtx(0, 0.059, -0.183)); // top rib
    metal.add(sideShape([[-0.236, 0.057], [-0.24, 0.068], [-0.25, 0.068], [-0.252, 0.057]], 0.006, 0.0008), pal.dark2); // front sight
    metal.add(box(0.0065, 0.004, 0.003), pal.accentL, mtx(0, 0.066, -0.2365));
    metal.add(cylZ(0.0095, 0.0095, 0.002, 16), pal.black, mtx(0, by, -0.2575)); // bore
    poly.add(cylZ(0.008, 0.008, 0.003, 12), pal.ball, mtx(0, by, -0.2555)); // paintball in the bore
    // ---- magazine (gun space; the mag builders are offset to the grip top): clear body full of balls ----
    var mid = dgGripV(0.068, 0);
    B.magShell.add(rbox(0.022, 0.128, 0.034, 0.005, 0.002), pal.white, mtx(0, mid.y, mid.z, DG_ROT));
    for (i = -1; i <= 1; i += 2) { var sp = dgGripV(0.068, i * 0.0175); B.mag.add(rbox(0.024, 0.126, 0.005, 0.002, 0.001), pal.dark2, mtx(0, sp.y, sp.z, DG_ROT)); }
    var fp = dgGripV(0.139, 0.001), fa = dgGripV(0.1455, 0.001), fl = dgGripV(0.006, 0);
    B.mag.add(rbox(0.034, 0.011, 0.058, 0.004, 0.002), pal.dark2, mtx(0, fp.y, fp.z, DG_ROT)); // floor plate
    B.mag.add(rbox(0.036, 0.004, 0.06, 0.0015, 0.001), pal.accent, mtx(0, fa.y, fa.z, DG_ROT));
    B.mag.add(rbox(0.024, 0.01, 0.03, 0.003, 0.001), pal.dark, mtx(0, fl.y, fl.z, DG_ROT)); // feed lips
    var hi = mix(pal.ball, new THREE.Color(1, 1, 1), 0.3), mb = sph(0.0094, 12, 9);
    for (i = 0; i < 6; i++) { s = dgGripV(0.016 + i * 0.0196, i % 2 ? 0.0016 : -0.0016); B.magBalls.add(mb, i === 2 ? hi : pal.ball, mtx(0, s.y, s.z, i, i * 2, 0)); }
  }

  // ---------------------------------------------------------------------------------------------
  // Butterfly knife geometry. Knife frame: tang center at origin, blade forward (-Z), spine +Y.
  // The two pivot pins run along X through the tang: the safe handle (A) on the spine-side pin at
  // y = +PIN, the bite handle (B) on the edge-side pin at y = -PIN.
  //
  // Hinge rules (like a real balisong), with a = blade angle about pin A (relative to handle A) and
  // b = handle B angle about pin B (relative to the blade), both rotations about +X:
  //   a = 0 open (blade out, B lying against A), a = PI blade closed into A's channel (spine first);
  //   b = 0 B open (against A),                  b = PI B closed onto the blade (edge in B's channel).
  // Each joint only ever moves inside [0, PI]. Every handle's pivot end is a half-disc of radius
  // H_H/2 <= PIN around its own pin, so the two pivot ends never overlap, and the hardware that
  // crosses a handle's channel (screws, spacers) sits on the side the blade never sweeps (A: -y,
  // B: +y) and beyond the blade's reach near the pommel, so the blade only ever passes through the
  // open channel between the liners.
  // ---------------------------------------------------------------------------------------------
  var PIN = 0.0082, H_LEN = 0.128, H_H = 0.0162, PLATE_X = 0.0034, PLATE_T = 0.0019;

  function knifePalette(accent) {
    var A = lin(accent || "#ff3fa4");
    return { accent: A, accentD: shade(A, 0.5), steel: new THREE.Color(0.78, 0.8, 0.83), steelD: new THREE.Color(0.4, 0.42, 0.45), dark: new THREE.Color(0.03, 0.03, 0.035), gold: new THREE.Color(0.85, 0.6, 0.25) };
  }

  function buildBlade(b, pal) {
    // blade outline in (u forward, v up)
    var s = new THREE.Shape();
    s.moveTo(-0.008, 0.006);
    s.quadraticCurveTo(-0.011, 0.0, -0.008, -0.006);
    s.lineTo(-0.004, -0.0115);
    s.lineTo(0.012, -0.0115);
    s.quadraticCurveTo(0.014, -0.0075, 0.018, -0.0075); // choil/kicker notch
    s.lineTo(0.02, -0.011);
    s.lineTo(0.06, -0.0115);
    s.quadraticCurveTo(0.094, -0.011, 0.112, 0.004); // belly to tip
    s.quadraticCurveTo(0.095, 0.006, 0.075, 0.0115); // clip point
    s.lineTo(0.004, 0.0115);
    s.quadraticCurveTo(-0.004, 0.0115, -0.008, 0.006);
    s.holes.push(circlePath(0.03, 0.002, 0.0032, 14));
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0009, bevelSegments: 1, curveSegments: 10 });
    g.rotateY(PI / 2); // u -> -z, extrusion -> +x
    g.translate(-0.0008, 0, 0);
    b.skin = 1;
    b.add(g, pal.steel);
    // fuller/grind line (darker strip on both faces)
    b.add(box(0.0032, 0.0016, 0.05), pal.steelD, mtx(0, 0.0065, -0.045));
    b.skin = 0;
    // tang pins
    b.add(cylX(0.0022, 0.0095, 10), pal.steel, mtx(0, PIN, 0));
    b.add(cylX(0.0022, 0.0095, 10), pal.steel, mtx(0, -PIN, 0));
    b.add(cylX(0.001, 0.0085, 8), pal.dark, mtx(0, 0, 0.004)); // tang stop pin (sits in the gap between the handles)
  }

  // Handle built relative to its own pin (pin at origin), extending to +Z when open.
  function buildHandle(b, pal, isBite) {
    var s = new THREE.Shape(), L = H_LEN, h = H_H / 2;
    s.moveTo(0, -h);
    s.lineTo(L - 0.006, -h);
    s.quadraticCurveTo(L + 0.002, -h, L + 0.002, 0);
    s.quadraticCurveTo(L + 0.002, h, L - 0.006, h);
    s.lineTo(0, h);
    s.absarc(0, 0, h, PI / 2, PI * 1.5, false); // pivot end: a half-disc around the pin
    // skeleton holes
    s.holes.push(circlePath(0.0, 0.0, 0.0024, 10));
    var x0 = 0.014;
    for (var i = 0; i < 4; i++) {
      var a = x0 + i * 0.027;
      s.holes.push(slotPath(a, a + 0.016, 0.0, 0.0034));
    }
    var col = pal.accent;
    var plate = shapeSide(s, PLATE_T, 0.0004);
    b.skin = 1;
    b.add(plate, col, mtx(PLATE_X, 0, 0));
    b.add(plate, col, mtx(-PLATE_X, 0, 0));
    b.skin = 0;
    // channel-crossing hardware: on the side of the channel the blade never sweeps (see above)
    var hw = isBite ? 1 : -1, CW = PLATE_X * 2 + PLATE_T * 2 + 0.001;
    b.add(rbox(PLATE_X * 2, H_H * 0.62, 0.006, 0.002, 0.0005), pal.dark, mtx(0, 0, L - 0.003)); // pommel spacer
    b.add(rbox(PLATE_X * 2, 0.003, 0.012, 0.0012, 0.0005), pal.dark, mtx(0, hw * (h - 0.0022), 0.021)); // spacer
    for (var k = 0; k < 3; k++) b.add(cylX(0.0014, CW, 8), pal.steelD, mtx(0, hw * 0.0062, 0.035 + k * 0.0275));
    b.add(cylX(0.0028, CW + 0.0002, 12), pal.gold, mtx(0, 0, 0)); // pivot screw heads
    if (isBite) { // latch at the end of the bite handle (beyond the blade tip's reach); clasps A when closed
      b.add(rbox(0.0028, 0.0036, 0.016, 0.0012, 0.0004), pal.steel, mtx(0, -h - 0.0012, L - 0.004, 0.06));
      b.add(cylX(0.0016, CW, 8), pal.steel, mtx(0, -h + 0.001, L - 0.002));
    }
  }

  // Knife rig: returns { root (=held safe handle frame), bladeNode, handleBNode, set(a,b) }
  function makeBalisong(accent, mats) {
    var pal = knifePalette(accent);
    var rootK = new THREE.Group();
    var bA = new Builder(), bB = new Builder(), bl = new Builder();
    withUV(SKIN_UV.handle, bA, bB); withUV(SKIN_UV.blade, bl);
    buildHandle(bA, pal, false); buildHandle(bB, pal, true); buildBlade(bl, pal);
    var handleA = bA.mesh(mats.metal); handleA.position.set(0, PIN, 0); rootK.add(handleA);
    var bladeNode = new THREE.Group(); bladeNode.position.set(0, PIN, 0); rootK.add(bladeNode);
    var blade = bl.mesh(mats.steel); blade.position.set(0, -PIN, 0); bladeNode.add(blade);
    var bNode = new THREE.Group(); bNode.position.set(0, -2 * PIN, 0); bladeNode.add(bNode);
    var handleB = bB.mesh(mats.metal); bNode.add(handleB);
    return {
      root: rootK,
      set: function (a, b) { bladeNode.rotation.x = a; bNode.rotation.x = b; },
      meshes: [handleA, blade, handleB], blade: blade, handles: [handleA, handleB]
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Mii mitten hand. Hand space: gripped object axis = +Y through origin, palm/back of hand on
  // the +X side, fingers wrap around the front (-Z) to -X, thumb wraps around the back (+Z).
  // ---------------------------------------------------------------------------------------------
  function buildHand(b, skin, R) {
    // A Mii hand is just a ball on the end of the arm: the grip goes right through it.
    b.add(sph(R, 20, 16), skin, mtx(0, 0, 0));
  }
  // where the arm (sleeve) meets the ball: just inside it, behind the grip (+Z)
  var WRIST = function () { return new THREE.Vector3(0, -0.006, 0.026); };

  function buildSleeve(b, col) {
    // a plain round Mii arm along +Y from 0 (the hand) to 0.6
    b.add(cylY(0.039, 0.043, 0.6, 20), col, mtx(0, 0.3, 0));
  }

  // ---------------------------------------------------------------------------------------------
  // Keyframe helpers
  // ---------------------------------------------------------------------------------------------
  var EASE = {
    s: function (u) { return u * u * (3 - 2 * u); },
    l: function (u) { return u; },
    o: function (u) { return 1 - (1 - u) * (1 - u) * (1 - u); },
    i: function (u) { return u * u * u; },
    b: function (u) { var c = 1.7; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }, // back-out
    q: function (u) { return 1 - (1 - u) * (1 - u); }, // quad out (ballistic rise)
    Q: function (u) { return u * u; } // quad in (ballistic fall)
  };
  // keys: [[t, v, ease?], ...]
  function K(keys) {
    return function (t) {
      if (t <= keys[0][0]) return keys[0][1];
      for (var i = 0; i < keys.length - 1; i++) {
        var a = keys[i], b = keys[i + 1];
        if (t < b[0]) {
          var u = (t - a[0]) / Math.max(b[0] - a[0], 1e-6);
          return a[1] + (b[1] - a[1]) * (EASE[b[2] || "s"])(u);
        }
      }
      return keys[keys.length - 1][1];
    };
  }
  // scale times of a key list
  function KS(keys, f, off) { return keys.map(function (k) { return [k[0] * f + (off || 0), k[1], k[2]]; }); }

  function Spring(k, damp) { this.x = 0; this.v = 0; this.k = k; this.c = 2 * Math.sqrt(k) * damp; }
  Spring.prototype.step = function (dt, target) {
    target = target || 0;
    var n = Math.ceil(dt / (1 / 240));
    var h = dt / Math.max(n, 1);
    for (var i = 0; i < n; i++) {
      var a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  };

  // ---------------------------------------------------------------------------------------------
  // Textures: paint splats + muzzle puff
  // ---------------------------------------------------------------------------------------------
  function seeded(seed) { var s = seed >>> 0 || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function drawSplat(g, S, rnd, color) {
    g.fillStyle = color;
    var cx = S / 2, cy = S / 2, R = S * (0.2 + rnd() * 0.05), i, a, r;
    // main blob: noisy polygon with lobes
    var N = 48, lobes = [];
    for (i = 0; i < 9; i++) lobes.push({ a: rnd() * TAU, w: 0.15 + rnd() * 0.3, h: 0.15 + rnd() * 0.5 });
    g.beginPath();
    for (i = 0; i <= N; i++) {
      a = i / N * TAU; r = R * (0.85 + rnd() * 0.12);
      for (var l = 0; l < lobes.length; l++) {
        var d = Math.atan2(Math.sin(a - lobes[l].a), Math.cos(a - lobes[l].a));
        r += R * lobes[l].h * Math.exp(-(d * d) / (lobes[l].w * lobes[l].w * 0.25));
      }
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    // streaks / tendrils
    for (i = 0; i < 7; i++) {
      a = rnd() * TAU; var len = R * (1.1 + rnd() * 0.9), w = R * (0.06 + rnd() * 0.08);
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.beginPath(); g.moveTo(R * 0.5, -w); g.quadraticCurveTo(len, -w * 0.4, len + w, 0); g.quadraticCurveTo(len, w * 0.4, R * 0.5, w); g.fill();
      g.beginPath(); g.arc(len + w * 0.6, 0, w * 1.3, 0, TAU); g.fill();
      g.restore();
    }
    // droplets
    for (i = 0; i < 26; i++) {
      a = rnd() * TAU; r = R * (1.15 + rnd() * 1.0); var dr = S * (0.004 + rnd() * rnd() * 0.022);
      if (cx + Math.cos(a) * r + dr > S - 2 || cx + Math.cos(a) * r - dr < 2) r *= 0.8;
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dr, 0, TAU); g.fill();
    }
  }

  var _splats = null;
  function splatTextures() {
    if (_splats) return _splats;
    _splats = [];
    if (typeof document === "undefined") return _splats;
    for (var k = 0; k < 4; k++) {
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var g = c.getContext("2d");
      drawSplat(g, 256, seeded(1234 + k * 977), "#ffffff");
      // subtle inner shading in alpha (thicker paint in the middle)
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      _splats.push(t);
    }
    return _splats;
  }

  function puffTexture(accentHex) {
    var c = document.createElement("canvas"); c.width = c.height = 128;
    var g = c.getContext("2d");
    var rnd = seeded(99);
    g.globalAlpha = 0.95;
    drawSplat(g, 128, rnd, accentHex);
    g.globalCompositeOperation = "source-atop";
    var rg = g.createRadialGradient(64, 64, 0, 64, 64, 60);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.28, "rgba(255,255,255,0.75)"); rg.addColorStop(0.6, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  var _ballMats = {};
  function paintBallMaterial(color) { // cached per color (shared instance: do not dispose per ball)
    var key = String(color || "#ff3fa4");
    if (_ballMats[key]) return _ballMats[key];
    return (_ballMats[key] = new THREE.MeshPhongMaterial({ color: lin(color || "#ff3fa4"), shininess: 120, specular: new THREE.Color(0.55, 0.55, 0.55), emissive: lin(color || "#ff3fa4").multiplyScalar(0.12) }));
  }

  // ---------------------------------------------------------------------------------------------
  // Weapon skins: pattern textures (drawn by PBSkins.drawPattern in pb-skins.js) and materials,
  // both cached per skin id. A skin material is a MeshStandardMaterial with a small shader patch:
  // parts whose skinMask is 1 take the pattern (and the skin's metalness / roughness / glow), the
  // rest of the merged mesh keeps its vertex colors, so skinning a gun costs no extra draw calls.
  //   fx.glow  -> emissive map (the pattern's bright accent colors)
  //   fx.metal -> high metalness, reflecting the shared envMap
  //   fx.shift -> fresnel hue shift (colors slide with the viewing angle) + a slow shimmer
  // ---------------------------------------------------------------------------------------------
  var _skinTime = { value: 0 }; // shared shimmer clock (advanced by the viewmodel's update)
  var _skinTex = {}, _skinMats = {};
  var HANDLE_PATTERNS = { web: 1, casehardened: 1, slaughter: 1, solid: 1, dragon: 1 }; // knife skins that cover the handles too
  function skinOf(id) { var S = root.PBSkins; return id && S && S.BY_ID ? S.BY_ID[id] || null : null; }
  function skinLayout(skin) { return SKIN_UV[skin.weapon === "knife" ? "blade" : skin.weapon] || SKIN_UV.ak; }
  function skinsHandles(skin) { if (typeof skin === "string") skin = skinOf(skin); return !!(skin && HANDLE_PATTERNS[skin.pattern]); }
  function canvasTex(c) {
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function drawSkin(skin, scale) {
    var L = skinLayout(skin);
    return root.PBSkins.drawPattern(skin, Math.round(L.W * scale), Math.round(L.Hpx * scale));
  }
  function skinTextures(id) {
    if (_skinTex[id]) return _skinTex[id];
    var s = skinOf(id);
    if (!s || typeof document === "undefined" || !root.PBSkins.drawPattern) return null;
    var art = drawSkin(s, 1);
    return (_skinTex[id] = { skin: s, map: canvasTex(art.color), glow: art.glow ? canvasTex(art.glow) : null });
  }

  var PART_BASE = { // the unskinned look of each part kind (same as the default materials)
    poly: { rough: 0.55, metal: 0.05, envI: 0.6 }, metal: { rough: 0.3, metal: 0.65, envI: 0.9 },
    blade: { rough: 0.16, metal: 0.95, envI: 1.25 }, handle: { rough: 0.28, metal: 0.7, envI: 0.9 }
  };
  var SKIN_VERT_PARS = "attribute float skinMask;\nvarying float vSkin;\n";
  var SKIN_FRAG_PARS = [
    "uniform float uSkinMetal;", "uniform float uSkinRough;", "uniform float uShift;", "uniform float uTime;", "varying float vSkin;",
    "vec3 pbHue( vec3 c, float a ) { const vec3 k = vec3( 0.57735 ); float ca = cos( a ); return c * ca + cross( k, c ) * sin( a ) + k * dot( k, c ) * ( 1.0 - ca ); }", ""].join("\n");
  var SKIN_MAP = [
    "vec3 pbBase = diffuseColor.rgb;",
    "#ifdef USE_COLOR", "pbBase *= vColor;", "#endif",
    "vec3 pbTex = texture2D( map, vUv ).rgb;",
    "float pbShift = 0.0;",
    "#ifdef SKIN_SHIFT",
    "float pbFr = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );",
    "pbShift = uShift * ( pbFr * pbFr * 2.4 + 0.3 * sin( uTime * 0.9 + vUv.x * 7.0 ) );",
    "pbTex = max( pbHue( pbTex, pbShift ), 0.0 );",
    "#endif",
    "diffuseColor.rgb = mix( pbBase, pbTex, vSkin );"].join("\n");
  var SKIN_EMISSIVE = [
    "#ifdef USE_EMISSIVEMAP",
    "vec3 pbGlow = texture2D( emissiveMap, vUv ).rgb;",
    "#ifdef SKIN_SHIFT", "pbGlow = max( pbHue( pbGlow, pbShift ), 0.0 );", "#endif",
    "totalEmissiveRadiance *= pbGlow * vSkin;",
    "#endif"].join("\n");
  function patchSkinShader(sh, u) {
    for (var k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + SKIN_VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvSkin = skinMask;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + SKIN_FRAG_PARS)
      .replace("#include <map_fragment>", SKIN_MAP)
      .replace("#include <color_fragment>", "")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix( roughness, uSkinRough, vSkin );")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = mix( metalness, uSkinMetal, vSkin );")
      .replace("#include <emissivemap_fragment>", SKIN_EMISSIVE);
  }
  function makeSkinMaterial(skin, tex, part) {
    var b = PART_BASE[part] || PART_BASE.poly, fx = skin.fx || {}, gold = skin.tier === "gold";
    var m = stdMat({ rough: b.rough, metal: b.metal, envI: fx.metal ? Math.max(b.envI, gold ? 1.35 : 1.1) : b.envI });
    m.map = tex.map;
    if (tex.glow) { m.emissiveMap = tex.glow; m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = gold ? 0.85 : 1.0; }
    var sMetal = fx.metal ? (gold ? 0.88 : 0.7) : (part === "blade" ? 0.45 : skin.tier === "blue" ? 0.04 : 0.12);
    var sRough = fx.metal ? (gold ? 0.18 : 0.28) : (skin.tier === "blue" ? 0.62 : skin.tier === "purple" ? 0.5 : 0.4);
    var u = { uSkinMetal: { value: sMetal }, uSkinRough: { value: sRough }, uShift: { value: fx.shift ? 1 : 0 }, uTime: _skinTime };
    if (fx.shift) m.defines = { SKIN_SHIFT: "" };
    m.onBeforeCompile = function (sh) { patchSkinShader(sh, u); };
    m.customProgramCacheKey = function () { return "pbskin"; };
    m.userData.pbSkin = skin.id;
    return m;
  }
  // PBSkins.material(skinId, part): part = "poly" (plastic/painted parts), "metal", "blade" or "handle".
  // Cached and shared (do not dispose). Returns null for an unknown skin. For a knife skin whose
  // pattern does not cover the handles, "handle" gives the plain (unskinned) handle material.
  function skinMaterial(id, part) {
    if (!PART_BASE[part]) part = "poly";
    var key = id + "|" + part;
    if (_skinMats[key]) return _skinMats[key];
    var tx = skinTextures(id);
    if (!tx) return null;
    if (part === "handle" && !skinsHandles(tx.skin)) return (_skinMats[key] = stdMat({ rough: 0.28, metal: 0.7 }));
    return (_skinMats[key] = makeSkinMaterial(tx.skin, tx, part));
  }

  // ---------------------------------------------------------------------------------------------
  // Gun meshes in gun space (shared by the world models and the skin previews)
  // ---------------------------------------------------------------------------------------------
  function worldMats(shellOpacity) {
    return {
      poly: stdMat({ rough: 0.55, metal: 0.05, envI: 0.6 }), metal: stdMat({ rough: 0.32, metal: 0.65 }),
      shell: stdMat({ rough: 0.08, metal: 0, transparent: true, opacity: shellOpacity, envI: 1.4 }),
      lens: stdMat({ rough: 0.05, metal: 0.6, envI: 2.0 })
    };
  }
  function buildGunMeshes(kind, accent, mats) {
    var pal = akPalette(accent || "#ff3fa4");
    var poly = new Builder(), metal = new Builder(), shell = new Builder(), lens = kind === "awp" ? new Builder() : null;
    withUV(SKIN_UV[kind === "awp" || kind === "deagle" ? kind : "ak"], poly, metal);
    if (kind === "awp") buildAWP({ poly: poly, metal: metal, mag: poly, bolt: metal, shell: shell, balls: poly, lens: lens }, pal);
    else if (kind === "deagle") buildDeagle({ poly: poly, metal: metal, slide: metal, slideShell: shell, slideBalls: poly, mag: poly, magShell: shell, magBalls: poly }, pal);
    else buildAK({ poly: poly, metal: metal, mag: poly, magShell: shell, magBalls: poly, bolt: metal }, pal);
    var grp = new THREE.Group();
    var pm = poly.mesh(mats.poly), mm = metal.mesh(mats.metal);
    grp.add(pm, mm);
    if (lens) grp.add(lens.mesh(mats.lens));
    var sh = shell.mesh(mats.shell); sh.renderOrder = 2; grp.add(sh);
    return { group: grp, poly: pm, metal: mm };
  }
  function skinGun(gm, mats, skinId) {
    var p = skinId ? skinMaterial(skinId, "poly") : null, m = skinId ? skinMaterial(skinId, "metal") : null;
    gm.poly.material = p || mats.poly; gm.metal.material = m || mats.metal;
  }
  function skinKnife(k, mats, skinId) {
    var b = skinId ? skinMaterial(skinId, "blade") : null, h = skinId ? skinMaterial(skinId, "handle") : null;
    k.blade.material = b || mats.steel;
    k.handles[0].material = k.handles[1].material = h || mats.metal;
  }

  // ---------------------------------------------------------------------------------------------
  // Skin previews: a side view (muzzle / blade tip to the right) on a transparent background, from
  // one small offscreen renderer that is created once and reused. Cached per skin id + size.
  // ---------------------------------------------------------------------------------------------
  var _pv = null, _pvCache = {};
  function previewRig() {
    if (_pv) return _pv;
    var r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputEncoding = THREE.sRGBEncoding; r.setPixelRatio(1); r.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    var key = new THREE.DirectionalLight(0xfff6ea, 1.05); key.position.set(1.0, 1.4, -0.3);
    var fill = new THREE.DirectionalLight(0xbfd8ff, 0.4); fill.position.set(1.0, -0.4, 0.8);
    scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a4038, 0.75), key, fill);
    _pv = { r: r, scene: scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20), models: {} };
    return _pv;
  }
  function previewModel(kind) {
    var pv = previewRig();
    if (pv.models[kind]) return pv.models[kind];
    var o;
    if (kind === "knife") {
      var km = { metal: stdMat({ rough: 0.3, metal: 0.7 }), steel: stdMat({ rough: 0.18, metal: 0.95, envI: 1.2 }) };
      var k = makeBalisong("#2a2d33", km); k.set(0, 0);
      o = { group: k.root, parts: [[k.blade, "blade", km.steel], [k.handles[0], "handle", km.metal], [k.handles[1], "handle", km.metal]] };
    } else {
      var d = worldMats(0.4), gm = buildGunMeshes(kind, "#3d4149", d);
      o = { group: gm.group, parts: [[gm.poly, "poly", d.poly], [gm.metal, "metal", d.metal]] };
    }
    o.group.visible = false;
    pv.scene.add(o.group);
    // camera: from the right-hand side (+X), a touch above, fitted to the model's bounds
    o.group.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(o.group), c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length();
    o.camPos = c.clone().add(new THREE.Vector3(R * 2, R * 0.32, R * 0.04)); o.center = c; o.R = R;
    o.box = box;
    return (pv.models[kind] = o);
  }
  function fitPreviewCam(cam, o, aspect) {
    cam.position.copy(o.camPos); cam.lookAt(o.center); cam.updateMatrixWorld(true);
    var inv = cam.matrixWorldInverse, b = o.box, v = new THREE.Vector3(), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    var w = (x1 - x0) * 1.04, h = (y1 - y0) * 1.08, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    cam.left = cx - w / 2; cam.right = cx + w / 2; cam.top = cy + h / 2; cam.bottom = cy - h / 2;
    cam.near = 0.01; cam.far = o.R * 5; cam.updateProjectionMatrix();
  }
  // PBSkins.preview(skinId, w, h) -> HTMLCanvasElement (w x h) with the weapon wearing the skin
  function preview(id, w, h) {
    w = Math.max(16, Math.round(w || 256)); h = Math.max(16, Math.round(h || w / 2));
    var key = id + "@" + w + "x" + h;
    if (_pvCache[key]) return _pvCache[key];
    var out = document.createElement("canvas"); out.width = w; out.height = h;
    var s = skinOf(id);
    if (!s) return out;
    var tex = null, mats = [];
    try {
      var pv = previewRig(), kind = s.weapon === "awp" || s.weapon === "knife" || s.weapon === "deagle" ? s.weapon : "ak";
      var o = previewModel(kind), ss = w * h > 300000 ? 1 : 2;
      // a half-resolution copy of the pattern is plenty for a small picture; freed right after
      var art = drawSkin(s, 0.5);
      tex = { map: canvasTex(art.color), glow: art.glow ? canvasTex(art.glow) : null };
      for (var i = 0; i < o.parts.length; i++) {
        var p = o.parts[i], m = p[1] !== "handle" || skinsHandles(s) ? makeSkinMaterial(s, tex, p[1]) : null;
        p[0].material = m || p[2];
        if (m) mats.push(m);
      }
      o.group.visible = true;
      fitPreviewCam(pv.cam, o, w / h);
      pv.r.setSize(w * ss, h * ss, false);
      pv.r.render(pv.scene, pv.cam);
      var g = out.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(pv.r.domElement, 0, 0, w, h);
      o.group.visible = false;
    } catch (e) { /* no WebGL here: leave the picture blank */ }
    for (var j = 0; j < mats.length; j++) mats[j].dispose();
    if (tex) { tex.map.dispose(); if (tex.glow) tex.glow.dispose(); }
    _pvCache[key] = out;
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // World (third-person) models. Each has userData.setSkin(skinId|null) to re-skin it later.
  // ---------------------------------------------------------------------------------------------
  function createWorldGun(accent, kind, skinId) {
    if (kind === "awp") return createWorldAWP(accent, skinId);
    if (kind === "deagle") return createWorldDeagle(accent, skinId);
    var mats = worldMats(0.42), gm = buildGunMeshes("ak", accent, mats);
    var g = new THREE.Group();
    var inner = gm.group; inner.rotation.y = PI; inner.scale.setScalar(0.9); g.add(inner); // barrel -> +Z, ~0.88 m long
    g.name = "PBWorldGun";
    g.userData.kind = "ak";
    g.userData.muzzle = new THREE.Vector3(-AK.muzzle.x, AK.muzzle.y, -AK.muzzle.z).multiplyScalar(0.9); // local muzzle point (tracer start)
    g.userData.setSkin = function (id) { skinGun(gm, mats, id); };
    skinGun(gm, mats, skinId);
    return g;
  }

  // third-person AWP: origin at the top of the pistol grip, barrel +Z, ~1.15 m long, 4 draw calls
  function createWorldAWP(accent, skinId) {
    var mats = worldMats(0.38), gm = buildGunMeshes("awp", accent, mats);
    var S = 0.98;
    var g = new THREE.Group();
    var inner = gm.group; inner.rotation.y = PI; inner.scale.setScalar(S); g.add(inner);
    g.name = "PBWorldAWP";
    g.userData.kind = "awp";
    g.userData.muzzle = new THREE.Vector3(-AWP.muzzle.x, AWP.muzzle.y, -AWP.muzzle.z).multiplyScalar(S);
    g.userData.setSkin = function (id) { skinGun(gm, mats, id); };
    skinGun(gm, mats, skinId);
    return g;
  }

  // third-person Deagle (held in one hand): origin on the grip axis just under the top of the grip
  // (where the hand closes, like the rifles' origin at the top of their pistol grip), barrel +Z,
  // ~0.32 m long, 4 draw calls
  function createWorldDeagle(accent, skinId) {
    var mats = worldMats(0.4), gm = buildGunMeshes("deagle", accent, mats);
    var S = 0.95, hold = dgGripV(0.03, 0);
    var g = new THREE.Group();
    var inner = gm.group; inner.rotation.y = PI; inner.scale.setScalar(S);
    inner.position.set(0, -hold.y * S, hold.z * S); // (rotated half a turn: gun-space z -> -z)
    g.add(inner);
    g.name = "PBWorldDeagle";
    g.userData.kind = "deagle";
    g.userData.muzzle = new THREE.Vector3(-DG.muzzle.x, DG.muzzle.y, -DG.muzzle.z).multiplyScalar(S).add(inner.position);
    g.userData.setSkin = function (id) { skinGun(gm, mats, id); };
    skinGun(gm, mats, skinId);
    return g;
  }

  function createWorldKnife(accent, skinId) {
    var mats = { metal: stdMat({ rough: 0.3, metal: 0.7 }), steel: stdMat({ rough: 0.18, metal: 0.95, envI: 1.2 }) };
    var k = makeBalisong(accent || "#ff3fa4", mats);
    var g = new THREE.Group();
    var inner = new THREE.Group(); inner.rotation.y = PI; inner.position.z = 0.06; // grip center at origin
    inner.add(k.root); g.add(inner);
    k.set(0, 0);
    g.userData.setOpen = function (open) { if (open) k.set(0, 0); else k.set(PI, PI); };
    g.userData.setAngles = function (a, b) { k.set(a, b); }; // a: blade about the safe pin, b: bite handle about its pin (0..PI each)
    g.userData.setSkin = function (id) { skinKnife(k, mats, id); };
    skinKnife(k, mats, skinId);
    g.name = "PBWorldKnife";
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // First-person viewmodel
  // ---------------------------------------------------------------------------------------------
  function createViewmodel(opts) {
    opts = opts || {};
    var accentHex = opts.accent || "#ff3fa4";
    var sleeveCol = lin(opts.sleeve || "#2b7cff"), skinCol = lin(opts.skin || "#f2c7a5");
    var pal = akPalette(accentHex);
    var disposables = [];

    var group = new THREE.Group(); group.name = "PBViewmodel";
    if (opts.lights !== false) {
      var hemi = new THREE.HemisphereLight(0xeef4ff, 0x4a4038, 0.6);
      var key = new THREE.DirectionalLight(0xfff6ea, 1.0); key.position.set(0.6, 1.2, 0.5);
      var rim = new THREE.DirectionalLight(0xbfd8ff, 0.55); rim.position.set(-1.0, 0.4, -0.8);
      key.target.position.set(0, 0, -0.3); rim.target.position.set(0, 0, -0.3);
      group.add(hemi, key, key.target, rim, rim.target);
    }
    var swayRoot = new THREE.Group(); group.add(swayRoot);

    // materials
    var M = {
      poly: stdMat({ rough: 0.55, metal: 0.05, envI: 0.6 }),
      metal: stdMat({ rough: 0.3, metal: 0.65 }),
      shell: stdMat({ rough: 0.06, metal: 0, transparent: true, opacity: 0.4, envI: 1.5 }),
      balls: stdMat({ rough: 0.12, metal: 0, envI: 1.0 }),
      skin: stdMat({ rough: 0.7, metal: 0, envI: 0.25 }),
      sleeve: stdMat({ rough: 0.9, metal: 0, envI: 0.15 }),
      kmetal: stdMat({ rough: 0.28, metal: 0.7 }),
      ksteel: stdMat({ rough: 0.16, metal: 0.95, envI: 1.25 }),
      lens: stdMat({ rough: 0.04, metal: 0.6, envI: 2.2 })
    };
    for (var mk in M) disposables.push(M[mk]);

    // ------------------------------------------------------------------ AK rig
    var akRoot = new THREE.Group(); swayRoot.add(akRoot);
    var akGun = new THREE.Group(); akRoot.add(akGun);
    var bPoly = new Builder(), bMetal = new Builder();
    var mp = AK.magPivot;
    var bMag = withOffset(new Builder(), mp.x, mp.y, mp.z), bMagShell = withOffset(new Builder(), mp.x, mp.y, mp.z), bMagBalls = withOffset(new Builder(), mp.x, mp.y, mp.z);
    var bBolt = withOffset(new Builder(), AK.boltPos.x, AK.boltPos.y, AK.boltPos.z);
    withUV(SKIN_UV.ak, bPoly, bMetal, bMag);
    buildAK({ poly: bPoly, metal: bMetal, mag: bMag, magShell: bMagShell, magBalls: bMagBalls, bolt: bBolt }, pal);
    var akPoly = bPoly.mesh(M.poly), akMetal = bMetal.mesh(M.metal);
    akGun.add(akPoly, akMetal);
    // the clear banana mag: frame + paintballs + clear body, moved as one by the reload
    var magMesh = new THREE.Group(); magMesh.position.copy(mp); akGun.add(magMesh);
    var akMagFrameMesh = bMag.mesh(M.poly), akMagBalls = bMagBalls.mesh(M.balls), akMagShell = bMagShell.mesh(M.shell);
    akMagShell.renderOrder = 2;
    magMesh.add(akMagFrameMesh, akMagBalls, akMagShell);
    var boltMesh = bBolt.mesh(M.metal); boltMesh.position.copy(AK.boltPos); akGun.add(boltMesh);
    var muzzleNode = new THREE.Object3D(); muzzleNode.position.copy(AK.muzzle); akGun.add(muzzleNode);
    // muzzle paint puff
    var puffTex = puffTexture(accentHex); disposables.push(puffTex);
    var puffMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 });
    disposables.push(puffMat);
    var puff = new THREE.Sprite(puffMat); puff.position.copy(AK.muzzle).add(new THREE.Vector3(0, 0, -0.04)); puff.visible = false; puff.renderOrder = 3;
    akGun.add(puff);

    // hands for the AK
    var HR = 0.02;
    var bRH = new Builder(); buildHand(bRH, skinCol, 0.042);
    var bLH = new Builder(); buildHand(bLH, skinCol, 0.042);
    var rHandAK = bRH.mesh(M.skin), lHandAK = bLH.mesh(M.skin);
    akGun.add(rHandAK, lHandAK);
    // right hand on the pistol grip
    (function () {
      var up = new THREE.Vector3(0, 0.1, -0.034).normalize();
      var X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3().crossVectors(X, up);
      rHandAK.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
      rHandAK.position.set(0.0, -0.05, 0.014);
    })();
    // left-hand poses (in gun space). LH_GUARD = supporting the gun: wrapped around the lower left
    // side of the handguard (low, so the hand never covers the sights)
    var LH_GUARD = { p: new THREE.Vector3(-0.026, -0.016, -0.3), q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0))) };
    LH_GUARD.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0)));
    var LH_MAG_LOCAL = { p: new THREE.Vector3(0, -0.075, -0.05), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0)) };
    var LH_BOLT = { p: new THREE.Vector3(0.05, 0.05, -0.15), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.6, 1.9)) };

    // ------------------------------------------------------------------ AWP rig
    var awpRoot = new THREE.Group(); swayRoot.add(awpRoot);
    var awpGun = new THREE.Group(); awpRoot.add(awpGun);
    var wPoly = new Builder(), wMetal = new Builder(), wLens = new Builder(), wShell = new Builder();
    var wMag = withOffset(new Builder(), AWP.magPivot.x, AWP.magPivot.y, AWP.magPivot.z);
    var wBolt = withOffset(new Builder(), AWP.boltPos.x, AWP.boltPos.y, AWP.boltPos.z);
    withUV(SKIN_UV.awp, wPoly, wMetal, wMag);
    buildAWP({ poly: wPoly, metal: wMetal, mag: wMag, bolt: wBolt, shell: wShell, balls: wPoly, lens: wLens }, pal);
    var awpPoly = wPoly.mesh(M.poly), awpMetal = wMetal.mesh(M.metal);
    awpGun.add(awpPoly, awpMetal, wLens.mesh(M.lens));
    var awpTube = wShell.mesh(M.shell); awpTube.renderOrder = 2; awpGun.add(awpTube);
    var awpMag = wMag.mesh(M.poly); awpMag.position.copy(AWP.magPivot); awpGun.add(awpMag);
    var awpBolt = wBolt.mesh(M.metal); awpBolt.position.copy(AWP.boltPos); awpGun.add(awpBolt);
    var awpMuzzleNode = new THREE.Object3D(); awpMuzzleNode.position.copy(AWP.muzzle); awpGun.add(awpMuzzleNode);
    var awpPuff = new THREE.Sprite(puffMat); awpPuff.position.copy(AWP.muzzle); awpPuff.visible = false; awpPuff.renderOrder = 3;
    awpGun.add(awpPuff);
    var rHandAWP = new THREE.Mesh(rHandAK.geometry, M.skin), lHandAWP = new THREE.Mesh(lHandAK.geometry, M.skin);
    rHandAWP.frustumCulled = lHandAWP.frustumCulled = false;
    awpGun.add(rHandAWP, lHandAWP);
    // right hand on the grip (same grip angle as the AK)
    var RH_GRIP_AWP = { p: new THREE.Vector3(0.0, -0.058, 0.02), q: new THREE.Quaternion() };
    (function () {
      var up = new THREE.Vector3(0, 0.11, -0.03).normalize();
      var X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3().crossVectors(X, up);
      RH_GRIP_AWP.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
    })();
    // right hand on the bolt knob: ball beside/behind the knob, arm coming from the lower right
    var RH_BOLT_OFF = new THREE.Vector3(0.03, -0.014, 0.012);
    var RH_BOLT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.3, -0.5));
    var LH_MAG_AWP = { p: new THREE.Vector3(0, -0.095, 0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0)) };
    // scoped pose: the scope axis on the camera axis, eyepiece just ahead of the eye
    var AWP_SCOPE = { p: new THREE.Vector3(0, -AWP.scopeY, -0.24), r: new THREE.Euler(0, 0, 0) };
    // left hand supporting the AWP: under the forend, ahead of the mag
    var LH_SUP_AWP = new THREE.Vector3(-0.022, -0.042, -0.3);

    // ------------------------------------------------------------------ Deagle rig
    var dgRoot = new THREE.Group(); swayRoot.add(dgRoot);
    var dgGun = new THREE.Group(); dgRoot.add(dgGun);
    // the pistol itself is drawn a bit oversized next to the (big) Mii ball hands; dgModel holds the
    // gun parts in gun space, hand targets are scaled by DG_VM_S
    var DG_VM_S = 1.2;
    var dgModel = new THREE.Group(); dgModel.scale.setScalar(DG_VM_S); dgGun.add(dgModel);
    var gTop = DG.gripTop;
    var dPoly = new Builder(), dMetal = new Builder(), dSlideB = new Builder(), dSlideShell = new Builder(), dSlideBalls = new Builder();
    var dMag = withOffset(new Builder(), gTop.x, gTop.y, gTop.z), dMagShell = withOffset(new Builder(), gTop.x, gTop.y, gTop.z), dMagBalls = withOffset(new Builder(), gTop.x, gTop.y, gTop.z);
    withUV(SKIN_UV.deagle, dPoly, dMetal, dSlideB, dMag);
    buildDeagle({ poly: dPoly, metal: dMetal, slide: dSlideB, slideShell: dSlideShell, slideBalls: dSlideBalls, mag: dMag, magShell: dMagShell, magBalls: dMagBalls }, pal);
    var dgPoly = dPoly.mesh(M.poly), dgMetal = dMetal.mesh(M.metal);
    dgModel.add(dgPoly, dgMetal);
    // the slide (blows back on every shot) carries its clear chamber window and the two balls in it
    var dgSlide = new THREE.Group(); dgModel.add(dgSlide);
    var dgSlideMesh = dSlideB.mesh(M.metal), dgWin = dSlideShell.mesh(M.shell); dgWin.renderOrder = 2;
    dgSlide.add(dgSlideMesh, dSlideBalls.mesh(M.balls), dgWin);
    // the mag slides out along the grip axis
    var dgMag = new THREE.Group(); dgMag.position.copy(gTop); dgModel.add(dgMag);
    var dgMagFrame = dMag.mesh(M.poly), dgMagShell = dMagShell.mesh(M.shell); dgMagShell.renderOrder = 2;
    dgMag.add(dgMagFrame, dMagBalls.mesh(M.balls), dgMagShell);
    var dgMuzzleNode = new THREE.Object3D(); dgMuzzleNode.position.copy(DG.muzzle); dgModel.add(dgMuzzleNode);
    var dgPuff = new THREE.Sprite(puffMat); dgPuff.position.copy(DG.muzzle); dgPuff.visible = false; dgPuff.renderOrder = 3;
    dgModel.add(dgPuff);
    // two-handed pistol grip: the right ball on the grip, the left ball cupping it from below-left
    var rHandDG = new THREE.Mesh(rHandAK.geometry, M.skin), lHandDG = new THREE.Mesh(rHandAK.geometry, M.skin);
    rHandDG.frustumCulled = lHandDG.frustumCulled = false;
    dgGun.add(rHandDG, lHandDG);
    var RH_DG = dgGripV(0.05, 0.004).multiplyScalar(DG_VM_S);
    rHandDG.position.copy(RH_DG);
    var LH_DG_CUP = RH_DG.clone().add(new THREE.Vector3(-0.034, -0.032, -0.012));
    var LH_DG_SLIDE = new THREE.Vector3(-0.004, 0.066, 0.036).multiplyScalar(DG_VM_S); // over the rear serrations (+ the slide's offset)
    var LH_DG_OFF = new THREE.Vector3(-0.24, -0.32, 0.2); // let go (inspect): down and back toward the shoulder

    // ------------------------------------------------------------------ knife rig
    // knAll holds everything knife-related. Each ball hand has its own frame whose axes are the
    // knife axes when held (blade -Z, pins X, spine +Y) with the ball center at the origin; the
    // grip runs through the ball. The knife itself lives in knNode, placed every frame from the
    // holding hand(s) (or the air, during tosses).
    var knAll = new THREE.Group(); swayRoot.add(knAll);
    var knRoot = new THREE.Group(); knAll.add(knRoot); // right hand frame
    var bKH = new Builder(); buildHand(bKH, skinCol, 0.04);
    var kHand = bKH.mesh(M.skin);
    knRoot.add(kHand);
    var knLRoot = new THREE.Group(); knAll.add(knLRoot); // left hand frame (inspect only)
    var kHandL = new THREE.Mesh(kHand.geometry, M.skin); knLRoot.add(kHandL);
    var knNode = new THREE.Group(); knAll.add(knNode); // knife root (tang)
    var knFree = knNode; // (kept name for tuning)
    var bali = makeBalisong(accentHex, { metal: M.kmetal, steel: M.ksteel });
    knNode.add(bali.root);
    bali.root.scale.setScalar(1.45);
    var KN_GRIP = 0.1; // ball center sits this far behind the pivot, on the closed handles

    // ------------------------------------------------------------------ sleeves
    var bS = new Builder(); buildSleeve(bS, sleeveCol);
    var sGeo = bS.geometry();
    var sleeveR = new THREE.Mesh(sGeo, M.sleeve), sleeveL = new THREE.Mesh(sGeo, M.sleeve);
    sleeveR.frustumCulled = sleeveL.frustumCulled = false;
    swayRoot.add(sleeveR, sleeveL);
    var wristR_AK = new THREE.Object3D(); wristR_AK.position.copy(WRIST(HR)); rHandAK.add(wristR_AK);
    var wristR_AWP = new THREE.Object3D(); wristR_AWP.position.copy(WRIST(HR)); rHandAWP.add(wristR_AWP);
    // left arms (and both Deagle arms): the sleeve starts at the ball center (hidden inside the ball),
    // so it stays attached however the hand moves around the gun
    var wristL_AK = new THREE.Object3D(); lHandAK.add(wristL_AK);
    var wristL_AWP = new THREE.Object3D(); lHandAWP.add(wristL_AWP);
    var wristR_DG = new THREE.Object3D(); rHandDG.add(wristR_DG);
    var wristL_DG = new THREE.Object3D(); lHandDG.add(wristL_DG);
    var SHOULDER_R_DG = new THREE.Vector3(0.32, -0.62, 0.0), SHOULDER_L_DG = new THREE.Vector3(-0.3, -0.75, -0.1);
    var SLEEVE_L_LEN = 1.6; // the left sleeve is stretched while holding a gun so it always reaches out of the frame
    // knife arms: the sleeve starts at the ball center (hidden inside the ball), so it stays attached in any pose
    var wristR_K = new THREE.Object3D(); kHand.add(wristR_K);
    var wristL_K = new THREE.Object3D(); kHandL.add(wristL_K);
    var SHOULDER_LK = new THREE.Vector3(-0.75, -0.35, 0.0);
    var SHOULDER_RK = new THREE.Vector3(0.75, -0.32, 0.0), SHOULDER_R = new THREE.Vector3(0.3, -0.7, -0.05), SHOULDER_L = new THREE.Vector3(-0.45, -0.8, -0.3); // (low: the forearm comes up from the lower left, under the hand)

    // ------------------------------------------------------------------ poses
    // (the gun points almost straight ahead, CS-style, rather than angled in toward the middle)
    var AK_BASE = { p: new THREE.Vector3(0.17, -0.155, -0.43), r: new THREE.Euler(0.03, -0.07, 0.0) };
    // knife hand poses: position of the ball + orientation built from the blade direction and the flat's normal
    function knQ(dir, xHint) {
      var Z = new THREE.Vector3().copy(dir).normalize().negate();
      var X = new THREE.Vector3().copy(xHint).addScaledVector(Z, -xHint.dot(Z)).normalize();
      var Y = new THREE.Vector3().crossVectors(Z, X);
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    }
    var KN_BASE = { p: new THREE.Vector3(0.17, -0.15, -0.38), q: knQ(new THREE.Vector3(-0.3, 0.6, -0.7), new THREE.Vector3(0.2, -0.3, 1)) }; // hammer grip, blade up-left
    // inspect poses: the pin axis is tilted so twirls sweep in front of the forearm, not behind it
    var KN_SHOW = { p: new THREE.Vector3(0.13, -0.07, -0.42), q: knQ(new THREE.Vector3(-0.3, 0.9, -0.3), new THREE.Vector3(-0.75, 0, 0.63)) };
    var KN_LEFT = { p: new THREE.Vector3(-0.15, -0.08, -0.42), q: knQ(new THREE.Vector3(0.3, 0.9, -0.3), new THREE.Vector3(0.75, 0, 0.63)) };
    var KN_LOFF = new THREE.Vector3(-0.32, -0.36, 0.1); // left hand offscreen offset (slides in along the arm)
    akRoot.position.copy(AK_BASE.p); akRoot.rotation.copy(AK_BASE.r);
    var AWP_BASE = { p: new THREE.Vector3(0.19, -0.17, -0.52), r: new THREE.Euler(0.03, -0.065, 0.0) };
    var DG_BASE = { p: new THREE.Vector3(0.135, -0.14, -0.41), r: new THREE.Euler(0.03, 0.2, 0.05) }; // angled in a little: the left side shows

    // channel lists
    var AWP_CH = ["px", "py", "pz", "rx", "ry", "rz", "magY", "magZ", "magRX", "lhW", "lhX", "lhY", "lhZ", "rbW", "boltR", "boltZ"];
    var AK_CH = ["px", "py", "pz", "rx", "ry", "rz", "magY", "magZ", "magRX", "lhW", "lbW", "bolt", "lhX", "lhY", "lhZ"];
    var DG_CH = ["px", "py", "pz", "rx", "ry", "rz", "magS", "hS", "hX", "lhW", "lsW", "lo", "slide"];
    var KN_CH = ["px", "py", "pz", "rx", "ry", "rz", "sw", "a", "b", "kx", "ky", "kz", "krx", "kry", "krz",
      "lw", "lpx", "lpy", "lpz", "lrx", "lry", "lrz", "lkrx", "lkry", "hw", "kh", "ksp"];
    var KN_ANG = { a: 1, b: 1, krx: 1, kry: 1, krz: 1, lkrx: 1, lkry: 1, ksp: 1 }; // blended the short way on cancel

    function akReloadAction(empty) {
      var f = 1.0; // magazine part time scale (mag out ~0.4 s, mag seated ~1.45 s, bolt slam ~2.1 s when empty)
      var ch = {
        rx: K(KS([[0, 0], [0.22, 0.12], [0.5, 0.18], [0.95, 0.1], [1.35, 0.16], [1.47, 0.24, "o"], [1.62, 0.1], [2.0, 0.04], [2.43 / f, 0]], f)),
        rz: K(KS([[0, 0], [0.25, -0.42], [1.3, -0.38], [1.48, -0.48, "o"], [1.75, -0.25], [2.2, -0.03], [2.43 / f, 0]], f)),
        ry: K(KS([[0, 0], [0.25, 0.12], [1.3, 0.12], [1.9, 0.02], [2.43 / f, 0]], f)),
        py: K(KS([[0, 0], [0.25, 0.02], [0.5, 0.035], [0.9, 0.04], [1.46, 0.03], [1.5, 0.042, "o"], [1.7, 0.02], [2.43 / f, 0]], f)),
        px: K(KS([[0, 0], [0.25, -0.03], [1.5, -0.035], [2.1, -0.005], [2.43 / f, 0]], f)),
        pz: K(KS([[0, 0], [0.25, 0.02], [1.6, 0.02], [2.43 / f, 0]], f)),
        magRX: K(KS([[0, 0], [0.3, 0], [0.45, 0.32, "o"], [0.7, 0.4], [0.82, 0.1], [1.12, 0.35], [1.32, 0.3], [1.45, 0.0, "o"]], f)),
        magY: K(KS([[0, 0], [0.38, 0], [0.5, -0.03, "i"], [0.78, -0.45, "i"], [0.82, -0.5], [0.95, -0.45], [1.18, -0.06, "o"], [1.32, -0.012], [1.45, 0, "o"]], f)),
        magZ: K(KS([[0, 0], [0.4, 0], [0.78, 0.05], [0.95, 0.05], [1.2, -0.01], [1.45, 0]], f)),
        lhW: K(KS([[0, 0], [0.32, 1, "o"], [1.48, 1], [1.62, 0]], f)),
        lhY: K(KS([[0, 0], [1.4, 0], [1.48, -0.02, "o"], [1.62, 0]], f)),
        lbW: K([[0, 0], [1, 0]]), bolt: K([[0, 0], [1, 0]])
      };
      if (empty) {
        var b0 = 1.66;
        ch.lbW = K([[0, 0], [b0, 0], [b0 + 0.2, 1, "o"], [b0 + 0.5, 1], [b0 + 0.68, 0]]);
        ch.bolt = K([[0, 0], [b0 + 0.22, 0], [b0 + 0.34, 1, "o"], [b0 + 0.4, 1], [b0 + 0.44, 0, "i"]]);
        ch.rz = K(KS([[0, 0], [0.25, -0.42], [1.3, -0.38], [1.48, -0.48, "o"], [1.62, -0.2]], f).concat([[b0 + 0.15, 0.32], [b0 + 0.45, 0.36], [b0 + 0.5, 0.3, "o"], [2.43, 0]]));
        ch.py = K(KS([[0, 0], [0.25, 0.02], [0.5, 0.035], [0.9, 0.04], [1.46, 0.03], [1.5, 0.042, "o"], [1.7, 0.02]], f).concat([[b0 + 0.3, 0.03], [b0 + 0.44, 0.04, "o"], [2.43, 0]]));
        ch.px = K(KS([[0, 0], [0.25, -0.03], [1.5, -0.035]], f).concat([[b0 + 0.3, -0.05], [2.43, 0]]));
        ch.rx = K(KS([[0, 0], [0.22, 0.12], [0.5, 0.18], [0.95, 0.1], [1.35, 0.16], [1.47, 0.24, "o"], [1.62, 0.1]], f).concat([[b0 + 0.3, 0.12], [b0 + 0.45, 0.16, "o"], [2.43, 0]]));
      }
      return { name: "reload", dur: 2.43, ch: ch };
    }

    function akDrawAction() {
      return {
        name: "draw", dur: 1.0, ch: {
          py: K([[0, -0.24], [0.42, 0.006, "o"], [0.55, 0]]),
          pz: K([[0, 0.05], [0.42, 0, "o"]]),
          rx: K([[0, -0.9], [0.42, 0.04, "o"], [0.55, 0], [0.7, 0.03], [0.82, 0.07, "o"], [1.0, 0]]),
          ry: K([[0, 0.3], [0.45, 0, "o"]]),
          rz: K([[0, 0.6], [0.45, 0, "o"], [0.6, 0.32], [0.84, 0.36], [1.0, 0]]),
          lbW: K([[0, 0], [0.45, 0], [0.62, 1, "o"], [0.84, 1], [1.0, 0]]),
          bolt: K([[0, 0], [0.64, 0], [0.74, 1, "o"], [0.8, 1], [0.84, 0, "i"]]),
          px: K([[0, 0.03], [0.45, 0, "o"], [0.62, -0.02], [1.0, 0]])
        }
      };
    }

    function akInspectAction() {
      var D = 4.6;
      return {
        name: "inspect", dur: D, ch: {
          px: K([[0, 0], [0.6, -0.07], [1.9, -0.075], [2.6, -0.13], [3.7, -0.135], [D, 0]]),
          py: K([[0, 0], [0.6, 0.045], [1.9, 0.05], [2.6, 0.05], [3.7, 0.055], [D, 0]]),
          pz: K([[0, 0], [0.6, 0.02], [1.9, 0.02], [2.6, -0.02], [3.7, -0.03], [D, 0]]),
          ry: K([[0, 0], [0.6, 0.85], [1.9, 0.95], [2.6, -0.55], [3.7, -0.62], [D, 0]]),
          rz: K([[0, 0], [0.6, 0.25], [1.9, 0.35], [2.6, 0.2], [3.7, 0.28], [D, 0]]),
          rx: K([[0, 0], [0.6, 0.1], [1.9, 0.05], [2.6, 0.12], [3.7, 0.08], [D, 0]])
        }
      };
    }

    // AWP actions. Extra channels: rbW = right hand grip (0) -> bolt knob (1), boltR = bolt lift
    // (0..1), boltZ = bolt pulled back (0..1). The bolt timing matches the "awpBolt" sound, which the
    // game plays 0.45 s after the shot (lift ~0.51, pull ~0.68, push ~0.84, lock ~0.92).
    function awpBoltKeys(t0) { // t0 = moment the hand reaches the knob
      return {
        boltR: [[0, 0], [t0 + 0.02, 0], [t0 + 0.1, 1, "o"], [t0 + 0.42, 1], [t0 + 0.5, 0, "i"]],
        boltZ: [[0, 0], [t0 + 0.14, 0], [t0 + 0.26, 1, "o"], [t0 + 0.32, 1], [t0 + 0.42, 0, "i"]]
      };
    }
    function awpFireAction() {
      var D = 1.45, bk = awpBoltKeys(0.42);
      return {
        name: "fire", dur: D, ch: {
          rbW: K([[0, 0], [0.2, 0], [0.42, 1, "o"], [0.94, 1], [1.16, 0]]),
          boltR: K(bk.boltR), boltZ: K(bk.boltZ),
          rz: K([[0, 0], [0.2, 0], [0.44, 0.5], [0.94, 0.55], [1.25, 0]]),
          ry: K([[0, 0], [0.25, 0], [0.5, 0.05], [0.94, 0.06], [1.3, 0]]),
          px: K([[0, 0], [0.25, 0], [0.5, -0.025], [0.95, -0.03], [1.3, 0]]),
          py: K([[0, 0], [0.25, 0], [0.48, 0.02], [0.66, 0.024], [0.76, 0.03, "o"], [0.92, 0.016], [1.3, 0]]),
          pz: K([[0, 0], [0.62, 0], [0.68, 0.014, "o"], [0.8, 0.004], [0.84, -0.008, "o"], [1.0, 0]]),
          rx: K([[0, 0], [0.5, 0], [0.68, 0.05, "o"], [0.8, 0.02], [0.84, -0.025, "o"], [0.95, 0.012], [1.05, 0], [1.45, 0]])
        }
      };
    }
    function awpReloadAction(empty) {
      // mag out ~0.55 s (game sound 0.52), new mag seated ~2.15 s, bolt sound at ~3.04 s when empty
      var D = 3.6;
      var ch = {
        rz: K([[0, 0], [0.35, -0.36], [2.05, -0.33], [2.15, -0.43, "o"], [2.45, -0.2], [3.1, -0.03], [D, 0]]),
        rx: K([[0, 0], [0.3, 0.1], [0.6, 0.15], [1.2, 0.08], [2.05, 0.13], [2.15, 0.2, "o"], [2.45, 0.08], [3.1, 0.02], [D, 0]]),
        ry: K([[0, 0], [0.35, 0.1], [2.1, 0.1], [2.9, 0.02], [D, 0]]),
        py: K([[0, 0], [0.35, 0.025], [2.1, 0.035], [2.16, 0.046, "o"], [2.45, 0.02], [D, 0]]),
        px: K([[0, 0], [0.35, -0.04], [2.15, -0.045], [3.0, -0.01], [D, 0]]),
        pz: K([[0, 0], [0.35, 0.03], [2.3, 0.03], [D, 0]]),
        magRX: K([[0, 0], [0.55, 0], [0.95, 0.3], [1.6, 0.3], [2.0, 0.04], [2.15, 0, "o"]]),
        magY: K([[0, 0], [0.5, 0], [0.6, -0.03, "i"], [0.95, -0.46, "i"], [1.0, -0.5], [1.55, -0.45], [2.02, -0.04, "o"], [2.1, -0.008], [2.15, 0, "o"]]),
        magZ: K([[0, 0], [0.6, 0], [0.95, 0.04], [1.55, 0.04], [2.0, 0.004], [2.15, 0]]),
        lhW: K([[0, 0], [0.4, 1, "o"], [2.22, 1], [2.5, 0]]),
        lhY: K([[0, 0], [2.08, 0], [2.16, 0.012, "o"], [2.3, 0]]),
        rbW: K([[0, 0], [1, 0]]), boltR: K([[0, 0], [1, 0]]), boltZ: K([[0, 0], [1, 0]])
      };
      if (empty) {
        var bk = awpBoltKeys(3.0);
        ch.rbW = K([[0, 0], [2.7, 0], [3.0, 1, "o"], [3.5, 1], [D, 0]]);
        ch.boltR = K(bk.boltR); ch.boltZ = K(bk.boltZ);
        ch.rz = K([[0, 0], [0.35, -0.36], [2.05, -0.33], [2.15, -0.43, "o"], [2.45, -0.2], [2.95, 0.24], [3.45, 0.27], [D, 0]]);
        ch.py = K([[0, 0], [0.35, 0.025], [2.1, 0.035], [2.16, 0.046, "o"], [2.45, 0.02], [2.95, 0.02], [3.26, 0.028, "o"], [D, 0]]);
        ch.rx = K([[0, 0], [0.3, 0.1], [0.6, 0.15], [1.2, 0.08], [2.05, 0.13], [2.15, 0.2, "o"], [2.45, 0.08], [3.0, 0.02], [3.26, 0.05, "o"], [3.42, -0.02, "o"], [D, 0]]);
      }
      return { name: "reload", dur: D, ch: ch };
    }
    function awpDrawAction() {
      // swings up from below, then a quick chamber check on the bolt
      return {
        name: "draw", dur: 1.1, ch: {
          py: K([[0, -0.26], [0.45, 0.008, "o"], [0.58, 0]]),
          pz: K([[0, 0.06], [0.45, 0, "o"]]),
          rx: K([[0, -0.85], [0.45, 0.05, "o"], [0.58, 0], [0.8, 0.02], [0.88, -0.02, "o"], [1.1, 0]]),
          ry: K([[0, 0.3], [0.48, 0, "o"]]),
          rz: K([[0, 0.55], [0.48, 0, "o"], [0.62, 0.2], [0.95, 0.22], [1.1, 0]]),
          px: K([[0, 0.04], [0.48, 0, "o"], [0.65, -0.015], [1.1, 0]]),
          rbW: K([[0, 0], [0.5, 0], [0.64, 1, "o"], [0.92, 1], [1.08, 0]]),
          boltR: K([[0, 0], [0.66, 0], [0.73, 1, "o"], [0.84, 1], [0.9, 0, "i"]]),
          boltZ: K([[0, 0], [0.74, 0], [0.78, 0.25, "o"], [0.83, 0, "i"]])
        }
      };
    }
    function awpInspectAction() {
      var D = 5.0;
      return {
        name: "inspect", dur: D, ch: {
          // 1) swing the rifle across to show its whole left side (feed tube, scope, brake)
          // 2) push it out and roll it to show the top / right side and check the bolt
          px: K([[0, 0], [0.7, -0.09], [2.0, -0.095], [2.8, -0.06], [4.2, -0.065], [D, 0]]),
          py: K([[0, 0], [0.7, 0.06], [2.0, 0.065], [2.8, 0.07], [4.2, 0.072], [D, 0]]),
          pz: K([[0, 0], [0.7, 0.04], [2.0, 0.045], [2.8, -0.1], [4.2, -0.105], [D, 0]]),
          ry: K([[0, 0], [0.7, 0.62], [2.0, 0.7], [2.8, 0.3], [4.2, 0.26], [D, 0]]),
          rz: K([[0, 0], [0.7, 0.2], [2.0, 0.3], [2.8, 0.55], [4.2, 0.6], [D, 0]]),
          rx: K([[0, 0], [0.7, 0.14], [2.0, 0.1], [2.8, 0.22], [4.2, 0.18], [D, 0]]),
          // a bolt check while the right side faces up
          rbW: K([[0, 0], [3.0, 0], [3.2, 1, "o"], [3.85, 1], [4.05, 0]]),
          boltR: K([[0, 0], [3.22, 0], [3.3, 1, "o"], [3.72, 1], [3.8, 0, "i"]]),
          boltZ: K([[0, 0], [3.34, 0], [3.44, 0.45, "o"], [3.56, 0.45], [3.68, 0, "i"]])
        }
      };
    }

    // Deagle actions. Extra channels: magS = mag out along the grip axis (m), hS / hX = left hand
    // below the grip (distance along the axis / sideways) while it handles the mag, lhW = left hand
    // support (0) -> mag (1), lsW -> over the slide (1), lo = left hand let go (inspect), slide = slide
    // pulled back (0..1). The shot kick is not an action (see dgShot), so it never blends or stalls.
    // Timings match the game's sounds (reload 2.2 s: mag out ~0.32, mag in ~1.31, slide ~1.86 when empty).
    function dgDrawAction() {
      // swings up from below, the left hand racks the slide (slams home at 0.70 s), settles by 1.0 s
      return {
        name: "draw", dur: 1.0, ch: {
          py: K([[0, -0.22], [0.36, 0.006, "o"], [0.46, 0]]),
          pz: K([[0, 0.05], [0.36, 0, "o"]]),
          rx: K([[0, -0.85], [0.36, 0.05, "o"], [0.46, 0], [0.6, 0.03], [0.7, 0.08, "o"], [0.86, 0]]),
          ry: K([[0, 0.25], [0.4, 0, "o"]]),
          rz: K([[0, 0.5], [0.38, 0, "o"], [0.5, 0.28], [0.72, 0.3], [0.94, 0]]),
          px: K([[0, 0.03], [0.38, 0, "o"], [0.52, -0.015], [0.95, 0]]),
          lsW: K([[0, 0], [0.4, 0], [0.53, 1, "o"], [0.72, 1], [0.9, 0]]),
          slide: K([[0, 0], [0.55, 0], [0.63, 1, "o"], [0.66, 1], [0.7, 0, "i"]])
        }
      };
    }
    function dgReloadAction(empty) {
      // the pistol comes up and cants left so the mag well is in view while the left hand works
      var D = 2.2;
      var up = [[0, 0], [0.25, 0.12], [1.28, 0.125], [1.32, 0.14, "o"], [1.55, 0.06]];
      var ch = {
        rz: K([[0, 0], [0.22, -0.6], [1.2, -0.55], [1.31, -0.64, "o"], [1.55, -0.26], [2.0, -0.02], [D, 0]]),
        rx: K([[0, 0], [0.22, 0.2], [0.5, 0.24], [1.0, 0.18], [1.25, 0.2], [1.31, 0.28, "o"], [1.5, 0.1], [D, 0]]),
        ry: K([[0, 0], [0.25, 0.1], [1.3, 0.1], [1.9, 0.02], [D, 0]]),
        py: K(up.concat([[D, 0]])),
        px: K([[0, 0], [0.25, -0.04], [1.4, -0.04], [2.0, -0.005], [D, 0]]),
        pz: K([[0, 0], [0.25, -0.02], [1.5, -0.02], [D, 0]]),
        // left hand: waits under the grip, the old mag drops past it, it fetches a new one from
        // below the screen, pushes it up the grip, slaps it home and goes back to the grip
        lhW: K([[0, 0], [0.06, 0], [0.28, 1, "o"], [1.34, 1], [1.6, 0]]),
        hS: K([[0, 0.17], [0.4, 0.17], [0.5, 0.21], [0.78, 0.505, "i"], [0.82, 0.505], [1.12, 0.255, "o"], [1.31, 0.135, "o"]]), // = magS + 0.135 while it carries the mag
        hX: K([[0, -0.05], [0.52, -0.05], [0.8, 0], [1.31, 0]]),
        magS: K([[0, 0], [0.32, 0], [0.36, 0.02, "o"], [0.6, 0.6, "i"], [0.8, 0.6], [0.8001, 0.37, "l"], [0.82, 0.37], [1.12, 0.12, "o"], [1.31, 0, "o"]]),
        lsW: K([[0, 0], [1, 0]]), slide: K([[0, 0], [1, 0]])
      };
      if (empty) { // then over the top: rack the slide and let it slam home (~1.86 s)
        ch.lhW = K([[0, 0], [0.06, 0], [0.28, 1, "o"], [1.34, 1], [1.5, 0]]);
        ch.lsW = K([[0, 0], [1.34, 0], [1.56, 1, "o"], [1.9, 1], [2.1, 0]]);
        ch.slide = K([[0, 0], [1.64, 0], [1.76, 1, "o"], [1.82, 1], [1.86, 0, "i"]]);
        ch.rz = K([[0, 0], [0.22, -0.6], [1.2, -0.55], [1.31, -0.64, "o"], [1.56, 0.15], [1.8, 0.25], [1.88, 0.2, "o"], [D, 0]]);
        ch.rx = K([[0, 0], [0.22, 0.2], [0.5, 0.24], [1.0, 0.18], [1.25, 0.2], [1.31, 0.28, "o"], [1.5, 0.08], [1.84, 0.06], [1.88, 0.13, "o"], [D, 0]]);
        ch.py = K(up.concat([[1.84, 0.04], [1.88, 0.055, "o"], [D, 0]]));
        ch.px = K([[0, 0], [0.25, -0.04], [1.4, -0.04], [1.7, -0.05], [D, 0]]);
      }
      return { name: "reload", dur: D, ch: ch };
    }
    function dgInspectAction() {
      // the left hand lets go; turn the pistol to show its left side, then roll it over to show the
      // right side and the top, and bring it back into the two-handed grip
      var D = 4.0;
      return {
        name: "inspect", dur: D, ch: {
          lo: K([[0, 0], [0.4, 1], [3.3, 1], [3.85, 0, "o"]]),
          px: K([[0, 0], [0.55, -0.055], [1.6, -0.06], [2.3, -0.12], [3.2, -0.125], [3.9, 0]]),
          py: K([[0, 0], [0.55, 0.05], [1.6, 0.055], [2.3, 0.06], [3.2, 0.062], [3.9, 0]]),
          pz: K([[0, 0], [0.55, 0.03], [1.6, 0.03], [2.3, 0.0], [3.2, -0.005], [3.9, 0]]),
          ry: K([[0, 0], [0.55, 0.95], [1.6, 1.05], [2.3, -1.05], [3.2, -1.12], [3.9, 0]]),
          rz: K([[0, 0], [0.55, 0.3], [1.6, 0.38], [2.3, -0.25], [3.2, -0.3], [3.9, 0]]),
          rx: K([[0, 0], [0.55, 0.12], [1.6, 0.08], [2.3, 0.1], [3.2, 0.06], [3.9, 0]])
        }
      };
    }
    // shot kick: big flip up and back, slide blows back, settled within ~0.2 s (fire cycle 0.225 s)
    var DG_KICK = {
      rx: K([[0, 0], [0.035, 0.3, "o"], [0.11, 0.07, "s"], [0.2, 0, "s"]]),
      pz: K([[0, 0], [0.03, 0.06, "o"], [0.12, 0.01], [0.2, 0]]),
      py: K([[0, 0], [0.035, 0.018, "o"], [0.2, 0]]),
      slide: K([[0, 0], [0.018, 1, "o"], [0.07, 0, "i"]])
    };

    // Knife actions. Channels: px..rz = right hand offset (camera space), sw = blend toward the
    // inspect "show" pose, a/b = balisong handle angles, kx..krz = knife trick offset about the right
    // ball, lw = left hand slide-in, lpx..lrz = left hand offset, lkrx/lkry = knife trick about the
    // left ball, hw = knife carried right (0) -> left (1), kh = toss height, ksp = in-air spin.
    function knDrawAction() {
      // comes up closed, flicks the bite handle out, then swings the blade open around the safe pin
      return {
        name: "draw", dur: 1.0, ch: {
          py: K([[0, -0.3], [0.36, 0.012, "o"], [0.56, -0.008], [0.8, 0.004], [1.0, 0]]),
          px: K([[0, 0.09], [0.36, 0.0, "o"], [1.0, 0]]),
          pz: K([[0, 0.04], [0.36, 0, "o"]]),
          rx: K([[0, -0.9], [0.34, 0.06, "o"], [0.46, -0.1], [0.62, 0.12, "o"], [0.82, -0.03], [1.0, 0]]),
          rz: K([[0, -0.7], [0.36, -0.12, "o"], [0.62, 0.1], [1.0, 0]]),
          ry: K([[0, 0.35], [0.4, 0, "o"]]),
          b: K([[0, PI], [0.22, PI], [0.44, 0, "o"]]),
          a: K([[0, PI], [0.44, PI], [0.7, 0, "o"]])
        }
      };
    }

    function knSlashAction(alt) {
      if (!alt) return { // right -> left
        name: "slash", dur: 0.4, ch: {
          px: K([[0, 0], [0.07, 0.05], [0.2, -0.24, "o"], [0.4, 0]]),
          py: K([[0, 0], [0.07, 0.03], [0.2, 0.0, "o"], [0.4, 0]]),
          pz: K([[0, 0], [0.07, 0.01], [0.2, -0.05, "o"], [0.4, 0]]),
          ry: K([[0, 0], [0.07, -0.55], [0.2, 0.8, "o"], [0.4, 0]]),
          rz: K([[0, 0], [0.07, -0.3], [0.2, 0.5, "o"], [0.4, 0]]),
          rx: K([[0, 0], [0.07, 0.1], [0.2, -0.15, "o"], [0.4, 0]])
        }
      };
      return { // left -> right (backhand)
        name: "slash", dur: 0.4, ch: {
          px: K([[0, 0], [0.09, -0.2], [0.21, 0.08, "o"], [0.4, 0]]),
          py: K([[0, 0], [0.09, 0.04], [0.21, 0.0, "o"], [0.4, 0]]),
          pz: K([[0, 0], [0.09, -0.03], [0.21, -0.05, "o"], [0.4, 0]]),
          ry: K([[0, 0], [0.09, 0.45], [0.21, -0.55, "o"], [0.4, 0]]),
          rz: K([[0, 0], [0.09, 0.35], [0.22, -1.05, "o"], [0.4, 0]]),
          rx: K([[0, 0], [0.09, 0.05], [0.21, -0.1, "o"], [0.4, 0]])
        }
      };
    }

    function knStabAction() {
      // pull back with the tip raised, then drive it forward toward the crosshair and recover
      return {
        name: "stab", dur: 1.0, ch: {
          pz: K([[0, 0], [0.3, 0.04], [0.44, -0.14, "o"], [0.6, -0.13], [1.0, 0]]),
          px: K([[0, 0], [0.3, 0.03], [0.44, -0.07, "o"], [0.6, -0.065], [1.0, 0]]),
          py: K([[0, 0], [0.3, -0.015], [0.44, 0.05, "o"], [0.6, 0.045], [1.0, 0]]),
          rx: K([[0, 0], [0.3, 0.3], [0.44, -0.12, "o"], [0.6, -0.1], [1.0, 0]]),
          ry: K([[0, 0], [0.3, 0.12], [0.44, -0.15, "o"], [0.6, -0.14], [1.0, 0]]),
          rz: K([[0, 0], [0.3, -0.15], [0.44, 0.2, "o"], [0.6, 0.18], [1.0, 0]])
        }
      };
    }

    function knInspectAction() {
      var D = 4.9;
      var T1 = 1.8, T2 = 2.4, R1 = 3.62, R2 = 4.12; // toss (right -> left) and throw back (left -> right)
      return {
        name: "inspect", dur: D, ch: {
          // right hand: up into the show pose, two twirls + a bite-handle fan, flick-toss, wait low, catch, settle
          sw: K([[0, 0], [0.42, 1], [4.3, 1], [D, 0]]),
          py: K([[0, 0], [1.55, 0], [1.7, -0.03], [1.84, 0.035, "o"], [2.05, 0], [2.4, -0.05], [3.4, -0.055], [3.85, 0], [R2, 0], [R2 + 0.08, -0.03, "o"], [4.4, 0]]),
          rz: K([[0, 0], [0.42, 0], [0.8, 0.08], [1.25, -0.06], [1.55, 0], [1.7, 0.15], [1.84, -0.2, "o"], [2.1, 0], [R2, 0], [R2 + 0.08, -0.1, "o"], [4.4, 0]]),
          krx: K([[0, 0], [0.45, 0], [1.15, 2 * TAU, "s"]]),
          // bite-handle fans: B swings down around its own pin, closes onto the blade's edge and swings
          // back out (b stays in 0..PI, so it never passes through the safe handle)
          b: K([[0, 0], [1.05, 0], [1.27, PI, "o"], [1.5, 0, "s"], [3.02, 0], [3.24, PI, "o"], [3.45, 0, "s"]]),
          // the toss: carried in a ballistic arc while flipping end over end
          hw: K([[0, 0], [T1, 0], [T2, 1, "l"], [R1, 1], [R2, 0, "l"]]),
          kh: K([[0, 0], [T1, 0], [(T1 + T2) / 2, 0.13, "q"], [T2, 0, "Q"], [R1, 0], [(R1 + R2) / 2, 0.12, "q"], [R2, 0, "Q"]]),
          ksp: K([[0, 0], [T1, 0], [T2, 2 * TAU, "l"], [R1, 2 * TAU], [R2, 0, "l"]]),
          // left hand: slides in from the lower left, catches, twirls + fans, throws back, slides out
          lw: K([[0, 0], [1.15, 0], [1.65, 1, "o"], [4.1, 1], [4.6, 0, "s"]]),
          lpy: K([[0, 0], [T2, 0], [T2 + 0.08, -0.035, "o"], [2.68, 0], [3.45, 0], [3.56, -0.025], [3.66, 0.03, "o"], [3.85, 0]]),
          lrz: K([[0, 0], [T2, 0], [T2 + 0.08, 0.08, "o"], [2.68, 0], [3.45, 0], [3.56, 0.15], [3.68, -0.18, "o"], [3.95, 0]]),
          lkrx: K([[0, 0], [2.62, 0], [3.12, -TAU, "s"]])
        }
      };
    }

    // ------------------------------------------------------------------ state
    var weapon = "ak", skins = { ak: null, awp: null, deagle: null, knife: null };
    var action = null, actT = 0, snap = null, snapT = 1;
    var cur = {}; // last evaluated channel values
    var kickZ = new Spring(520, 0.62), kickR = new Spring(520, 0.55), kickRoll = new Spring(380, 0.5), kickX = new Spring(420, 0.6);
    var ballS = new Spring(300, 0.3); // paintballs rattling in the clear mag

    var landS = new Spring(140, 0.45), dryS = new Spring(900, 0.6);
    var sm = { sx: 0, sy: 0, crouch: 0, air: 0, speed: 0, rollLag: 0 };
    var puffT = 1, time = 0, recoilHeat = 0;
    var awpKZ = new Spring(150, 0.5), awpKR = new Spring(120, 0.42), awpKRoll = new Spring(140, 0.45), awpKX = new Spring(160, 0.5);
    var scoped = false, scopeW = 0;
    var dgShot = { t: 9, k: 1, roll: 0 }; // time since the last Deagle shot (drives the kick)

    function channels() { return weapon === "ak" ? AK_CH : weapon === "awp" ? AWP_CH : weapon === "deagle" ? DG_CH : KN_CH; }
    function startAction(a) {
      // snapshot current values for a smooth blend into the new action
      snap = {}; var chs = channels();
      for (var i = 0; i < chs.length; i++) snap[chs[i]] = cur[chs[i]] || 0;
      snapT = 0;
      action = a; actT = 0;
    }
    function cancelAction() { if (action) startAction(null); }
    function evalChannels(dt) {
      var chs = channels(), out = {};
      if (action) {
        actT += dt;
        if (actT >= action.dur) { action = null; }
      }
      for (var i = 0; i < chs.length; i++) {
        var c = chs[i], v = 0;
        if (action && action.ch[c]) v = action.ch[c](actT);
        out[c] = v;
      }
      if (snap && snapT < 1) {
        snapT = Math.min(1, snapT + dt / 0.14);
        var w = EASE.s(snapT);
        for (var j = 0; j < chs.length; j++) {
          var cc = chs[j];
          var sv = snap[cc] || 0;
          if (KN_ANG[cc] && weapon === "knife") { // angles: blend the short way
            var d = out[cc] - sv; d = Math.atan2(Math.sin(d), Math.cos(d)); out[cc] = sv + d * w;
            continue;
          }
          if ((cc === "magY" || cc === "magS" || cc === "hS") && Math.abs(sv - out[cc]) > 0.2) continue; // mag offscreen: no visible blend
          out[cc] = sv + (out[cc] - sv) * w;
        }
      }
      cur = out;
      return out;
    }

    var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpQ2 = new THREE.Quaternion(), tmpP2 = new THREE.Vector3();
    var magQ = new THREE.Quaternion(), magP = new THREE.Vector3();

    function placeSleeve(sleeve, wristObj, shoulder) {
      // wrist position in swayRoot space
      wristObj.updateWorldMatrix(true, false);
      tmpM.copy(swayRoot.matrixWorld).invert().multiply(wristObj.matrixWorld);
      tmpP.setFromMatrixPosition(tmpM);
      sleeve.position.copy(tmpP);
      _v.copy(shoulder).sub(tmpP).normalize();
      sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
    }

    // The left hand always supports the gun (AK: under the handguard, AWP: under the forend, Deagle:
    // cupping the right hand); it leaves only to swap the mag / work the bolt or slide.
    function updateAK(dt, c) {
      akRoot.position.set(AK_BASE.p.x + c.px, AK_BASE.p.y + c.py, AK_BASE.p.z + c.pz);
      akRoot.rotation.set(AK_BASE.r.x + c.rx, AK_BASE.r.y + c.ry, AK_BASE.r.z + c.rz);
      // recoil springs
      var kz = kickZ.step(dt), kr = kickR.step(dt), kroll = kickRoll.step(dt), kx = kickX.step(dt), dz = dryS.step(dt);
      recoilHeat = Math.max(0, recoilHeat - dt * 2.5);
      akGun.position.set(kx * 0.004, kr * 0.006 + recoilHeat * 0.004, kz * 0.032 + dz * 0.004);
      akGun.rotation.set(kr * 0.07 + recoilHeat * 0.02, kx * 0.02, kroll * 0.05);
      // the balls in the clear mag rattle a little with each shot
      akMagBalls.position.y = ballS.step(dt) * 0.0012;
      // mag
      magMesh.position.set(AK.magPivot.x, AK.magPivot.y + c.magY, AK.magPivot.z + c.magZ);
      magMesh.rotation.set(c.magRX, 0, 0);
      magMesh.visible = c.magY > -0.44;
      // bolt
      boltMesh.position.set(AK.boltPos.x, AK.boltPos.y, AK.boltPos.z + c.bolt * 0.105);
      // left hand: guard pose -> mag pose -> bolt pose
      var p = tmpP.copy(LH_GUARD.p), q = tmpQ.copy(LH_GUARD.q);
      if (c.lhW > 0.001) {
        magQ.copy(magMesh.quaternion);
        magP.copy(LH_MAG_LOCAL.p).applyQuaternion(magQ).add(magMesh.position);
        tmpQ2.copy(magQ).multiply(LH_MAG_LOCAL.q);
        p.lerp(magP, c.lhW); q.slerp(tmpQ2, c.lhW);
      }
      if (c.lbW > 0.001) {
        tmpP2.copy(LH_BOLT.p); tmpP2.z += c.bolt * 0.105;
        p.lerp(tmpP2, c.lbW); q.slerp(LH_BOLT.q, c.lbW);
      }
      lHandAK.position.set(p.x + c.lhX, p.y + c.lhY, p.z + c.lhZ);
      lHandAK.quaternion.copy(q);
      // muzzle puff
      if (puffT < 1) {
        puffT += dt / 0.09;
        puff.visible = puffT < 1;
        var u = Math.min(puffT, 1);
        puffMat.opacity = Math.pow(1 - u, 1.4);
        var sc = 0.09 + Math.sqrt(u) * 0.13;
        puff.scale.set(sc, sc, sc);
        puff.position.z = AK.muzzle.z - 0.05 - u * 0.08;
      }
    }

    var _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _wq2 = new THREE.Quaternion(), _we = new THREE.Euler();
    function updateAWP(dt, c) {
      // scope raise: 0.12 s ease toward the eye
      scopeW = Math.max(0, Math.min(1, scopeW + (scoped ? 1 : -1) * dt / 0.12));
      var sw = EASE.s(scopeW);
      _wp.set(AWP_BASE.p.x + c.px, AWP_BASE.p.y + c.py, AWP_BASE.p.z + c.pz);
      awpRoot.position.lerpVectors(_wp, AWP_SCOPE.p, sw);
      _wq.setFromEuler(_we.set(AWP_BASE.r.x + c.rx, AWP_BASE.r.y + c.ry, AWP_BASE.r.z + c.rz));
      _wq2.setFromEuler(AWP_SCOPE.r);
      awpRoot.quaternion.slerpQuaternions(_wq, _wq2, sw);
      // heavy recoil springs: the rifle jumps up and back
      var kz = awpKZ.step(dt), kr = awpKR.step(dt), kroll = awpKRoll.step(dt), kx = awpKX.step(dt), dz = dryS.step(dt);
      awpGun.position.set(kx * 0.006, kr * 0.022, kz * 0.07 + dz * 0.004);
      awpGun.rotation.set(kr * 0.2, kx * 0.03, kroll * 0.06);
      // mag
      awpMag.position.set(AWP.magPivot.x, AWP.magPivot.y + c.magY, AWP.magPivot.z + c.magZ);
      awpMag.rotation.set(c.magRX, 0, 0);
      awpMag.visible = c.magY > -0.44;
      // bolt: lift (rotate about the bore), then slide back
      awpBolt.position.set(AWP.boltPos.x, AWP.boltPos.y, AWP.boltPos.z + c.boltZ * 0.1);
      awpBolt.rotation.set(0, 0, c.boltR * 1.25);
      // right hand: grip -> bolt knob
      var p = tmpP.copy(RH_GRIP_AWP.p), q = tmpQ.copy(RH_GRIP_AWP.q);
      if (c.rbW > 0.001) {
        awpBolt.updateMatrix();
        tmpP2.copy(AWP.knob).applyMatrix4(awpBolt.matrix).add(RH_BOLT_OFF);
        p.lerp(tmpP2, c.rbW); q.slerp(RH_BOLT_Q, c.rbW);
      }
      rHandAWP.position.copy(p); rHandAWP.quaternion.copy(q);
      // left hand: under the forend, over to the mag for the magazine swap
      var lp = tmpP2.copy(LH_SUP_AWP);
      if (c.lhW > 0.001) {
        magQ.copy(awpMag.quaternion);
        magP.copy(LH_MAG_AWP.p).applyQuaternion(magQ).add(awpMag.position);
        lp.lerp(magP, c.lhW);
      }
      lHandAWP.position.set(lp.x + c.lhX, lp.y + c.lhY, lp.z + c.lhZ);
      // muzzle puff (bigger and longer than the AK's)
      if (puffT < 1) {
        puffT += dt / 0.13;
        awpPuff.visible = puffT < 1;
        var u = Math.min(puffT, 1);
        puffMat.opacity = Math.pow(1 - u, 1.3);
        var sc = 0.2 + Math.sqrt(u) * 0.3;
        awpPuff.scale.set(sc, sc, sc);
        awpPuff.position.z = AWP.muzzle.z - 0.07 - u * 0.12;
      }
    }

    var _dp = new THREE.Vector3();
    function updateDeagle(dt, c) {
      dgRoot.position.set(DG_BASE.p.x + c.px, DG_BASE.p.y + c.py, DG_BASE.p.z + c.pz);
      dgRoot.rotation.set(DG_BASE.r.x + c.rx, DG_BASE.r.y + c.ry, DG_BASE.r.z + c.rz);
      // shot kick (keyframed envelope, scaled a little per shot) + dry-fire twitch
      dgShot.t += dt;
      var on = dgShot.t < 0.25, k = dgShot.k, dz = dryS.step(dt);
      var krx = on ? DG_KICK.rx(dgShot.t) * k : 0;
      dgGun.position.set(0, on ? DG_KICK.py(dgShot.t) * k : 0, (on ? DG_KICK.pz(dgShot.t) * k : 0) + dz * 0.004);
      dgGun.rotation.set(krx, krx * dgShot.roll * 0.15, krx * dgShot.roll * 0.3);
      // slide: blowback on the shot, or worked by hand
      var sl = Math.max(c.slide, on ? DG_KICK.slide(dgShot.t) : 0);
      dgSlide.position.z = sl * DG.slideTravel;
      // mag: along the grip axis
      dgMag.position.copy(DG.gripTop).addScaledVector(DG.gripDir, c.magS);
      dgMag.visible = c.magS < 0.4;
      // left hand: cupping the right -> under the grip (mag work) -> over the slide; or let go
      var p = _dp.copy(LH_DG_CUP);
      if (c.lhW > 0.001) { tmpP2.copy(DG.gripTop).addScaledVector(DG.gripDir, c.hS).multiplyScalar(DG_VM_S); tmpP2.x += c.hX; p.lerp(tmpP2, c.lhW); }
      if (c.lsW > 0.001) { tmpP2.copy(LH_DG_SLIDE); tmpP2.z += sl * DG.slideTravel * DG_VM_S; p.lerp(tmpP2, c.lsW); }
      if (c.lo > 0.001) p.addScaledVector(LH_DG_OFF, EASE.s(c.lo));
      lHandDG.position.copy(p);
      lHandDG.visible = c.lo < 0.995;
      // muzzle puff (between the AK's and the AWP's)
      if (puffT < 1) {
        puffT += dt / 0.1;
        dgPuff.visible = puffT < 1;
        var u = Math.min(puffT, 1);
        puffMat.opacity = Math.pow(1 - u, 1.4);
        var sc = 0.12 + Math.sqrt(u) * 0.18;
        dgPuff.scale.set(sc, sc, sc);
        dgPuff.position.z = DG.muzzle.z - 0.05 - u * 0.09;
      }
    }

    var _kq = new THREE.Quaternion(), _kq2 = new THREE.Quaternion(), _ke = new THREE.Euler(), _kp = new THREE.Vector3();
    var _kX = new THREE.Vector3(1, 0, 0);
    var knPR = new THREE.Vector3(), knQR = new THREE.Quaternion(), knPL = new THREE.Vector3(), knQL = new THREE.Quaternion();
    // knife root pose for a hand = hand * trick (offset + rotation about the ball center) * grip offset
    function knHeld(hand, ex, ey, ez, rx, ry, rz, outP, outQ) {
      outQ.copy(hand.quaternion).multiply(_kq.setFromEuler(_ke.set(rx, ry, rz)));
      outP.set(0, 0, -KN_GRIP).applyQuaternion(outQ).add(_kp.set(ex, ey, ez).applyQuaternion(hand.quaternion)).add(hand.position);
    }
    function updateKnife(dt, c) {
      // right hand: idle pose blended toward the inspect show pose, then camera-space offsets + breathing
      knRoot.position.lerpVectors(KN_BASE.p, KN_SHOW.p, c.sw).add(_kp.set(c.px, c.py, c.pz));
      _kq2.slerpQuaternions(KN_BASE.q, KN_SHOW.q, c.sw);
      knRoot.quaternion.setFromEuler(_ke.set(c.rx + Math.sin(time * 1.3) * 0.012, c.ry + Math.sin(time * 0.8 + 0.7) * 0.01, c.rz)).multiply(_kq2);
      // left hand (inspect only): slides in along its arm from the lower left
      var lw = c.lw;
      knLRoot.visible = lw > 0.002;
      knLRoot.position.copy(KN_LEFT.p).addScaledVector(KN_LOFF, 1 - lw).add(_kp.set(c.lpx, c.lpy, c.lpz));
      knLRoot.quaternion.setFromEuler(_ke.set(c.lrx + (1 - lw) * 0.5, c.lry, c.lrz - (1 - lw) * 0.4)).multiply(KN_LEFT.q);
      // knife
      bali.set(c.a, c.b);
      knHeld(knRoot, c.kx, c.ky, c.kz, c.krx, c.kry, c.krz, knPR, knQR);
      if (c.hw > 0.0005) {
        knHeld(knLRoot, 0, 0, 0, c.lkrx, c.lkry, 0, knPL, knQL);
        knNode.position.lerpVectors(knPR, knPL, c.hw);
        knNode.quaternion.slerpQuaternions(knQR, knQL, c.hw);
      } else { knNode.position.copy(knPR); knNode.quaternion.copy(knQR); }
      knNode.position.y += c.kh;
      if (c.ksp) knNode.quaternion.multiply(_kq.setFromAxisAngle(_kX, c.ksp));
    }

    function update(dt, s) {
      s = s || {};
      dt = Math.min(Math.max(dt || 0, 0), 0.05);
      time = s.t !== undefined ? s.t : time + dt;
      _skinTime.value = time;
      var speed = Math.max(0, Math.min(1, s.speed || 0)), phase = s.phase || 0;
      // smoothed inputs
      var kS = 1 - Math.exp(-dt * 10);
      sm.sx += ((s.swayX || 0) - sm.sx) * kS;
      sm.sy += ((s.swayY || 0) - sm.sy) * kS;
      sm.crouch += ((s.crouch || 0) - sm.crouch) * (1 - Math.exp(-dt * 8));
      sm.air += ((s.airborne ? 1 : 0) - sm.air) * (1 - Math.exp(-dt * 7));
      sm.speed += (speed - sm.speed) * (1 - Math.exp(-dt * 6));
      if (s.landed) { landS.v -= 2.4 + sm.air; }
      var land = landS.step(dt);
      var sp = sm.speed * (1 - sm.air);
      // bob + breathing
      var bobX = Math.sin(phase) * 0.0085 * sp;
      var bobY = -Math.abs(Math.cos(phase)) * 0.009 * sp + 0.0045 * sp;
      var bR = Math.sin(phase) * 0.018 * sp;
      var br = Math.sin(time * 1.7) * 0.0016, br2 = Math.sin(time * 0.9 + 1.3) * 0.0012;
      var swX = Math.max(-1, Math.min(1, sm.sx / 60)), swY = Math.max(-1, Math.min(1, sm.sy / 60));
      swayRoot.position.set(
        bobX + br2 - swX * 0.014 - sm.crouch * 0.006,
        bobY + br + swY * 0.01 - sm.crouch * 0.012 + land * 0.012 + sm.air * 0.008,
        sm.crouch * 0.012 - Math.abs(swX) * 0.004
      );
      swayRoot.rotation.set(
        br * 0.6 - swY * 0.04 + sm.air * 0.06 + land * 0.05,
        -swX * 0.05,
        bR - swX * 0.05 - sm.crouch * 0.04
      );
      var c = evalChannels(dt);
      akRoot.visible = weapon === "ak";
      awpRoot.visible = weapon === "awp";
      dgRoot.visible = weapon === "deagle";
      knAll.visible = weapon === "knife";
      if (weapon === "ak") updateAK(dt, c); else if (weapon === "awp") updateAWP(dt, c); else if (weapon === "deagle") updateDeagle(dt, c); else updateKnife(dt, c);
      // sleeves follow the wrists
      swayRoot.updateMatrixWorld(true);
      sleeveL.scale.y = weapon === "knife" ? 1 : SLEEVE_L_LEN;
      if (weapon === "ak") {
        placeSleeve(sleeveR, wristR_AK, SHOULDER_R);
        placeSleeve(sleeveL, wristL_AK, SHOULDER_L);
        sleeveL.visible = true;
      } else if (weapon === "awp") {
        placeSleeve(sleeveR, wristR_AWP, SHOULDER_R);
        placeSleeve(sleeveL, wristL_AWP, SHOULDER_L);
        sleeveL.visible = true;
      } else if (weapon === "deagle") {
        placeSleeve(sleeveR, wristR_DG, SHOULDER_R_DG);
        placeSleeve(sleeveL, wristL_DG, SHOULDER_L_DG);
        sleeveL.visible = lHandDG.visible;
      } else {
        placeSleeve(sleeveR, wristR_K, SHOULDER_RK);
        sleeveL.visible = knLRoot.visible;
        if (knLRoot.visible) placeSleeve(sleeveL, wristL_K, SHOULDER_LK);
      }
    }

    var api = {
      group: group,
      setWeapon: function (w) {
        weapon = w === "knife" || w === "awp" || w === "deagle" ? w : "ak";
        cur = {}; snap = null; snapT = 1;
        action = null;
        puffT = 1; puff.visible = false; awpPuff.visible = false; dgPuff.visible = false;
        scoped = false; scopeW = 0; dgShot.t = 9;
        startAction(weapon === "ak" ? akDrawAction() : weapon === "awp" ? awpDrawAction() : weapon === "deagle" ? dgDrawAction() : knDrawAction());
        snapT = 1; // no blend on draw
        update(0, {});
      },
      fire: function () {
        if (weapon === "awp") {
          startAction(awpFireAction()); // kick + bolt cycle (also cancels an inspect)
          awpKZ.v += 24 + Math.random() * 3;
          awpKR.v += 20 + Math.random() * 3;
          awpKRoll.v += (Math.random() - 0.5) * 10;
          awpKX.v += (Math.random() - 0.5) * 6;
          puffT = 0; awpPuff.visible = true; puffMat.rotation = Math.random() * TAU;
          return;
        }
        if (weapon === "deagle") {
          if (action && action.name === "inspect") cancelAction();
          dgShot.t = 0; dgShot.k = 0.9 + Math.random() * 0.2; dgShot.roll = Math.random() * 2 - 1;
          puffT = 0; dgPuff.visible = true; puffMat.rotation = Math.random() * TAU;
          return;
        }
        if (weapon !== "ak") return;
        if (action && action.name === "inspect") cancelAction();
        kickZ.v += 9 + Math.random() * 2;
        kickR.v += 7 + Math.random() * 3;
        kickRoll.v += (Math.random() - 0.5) * 12;
        kickX.v += (Math.random() - 0.5) * 6;
        ballS.v += 3;
        recoilHeat = Math.min(1, recoilHeat + 0.25);
        puffT = 0; puff.visible = true; puffMat.rotation = Math.random() * TAU;
      },
      dryFire: function () {
        if (weapon === "knife") return;
        if (action && action.name === "inspect") cancelAction();
        dryS.v += 4;
      },
      reload: function (empty) {
        if (weapon === "awp") { scoped = false; startAction(awpReloadAction(!!empty)); return; }
        if (weapon === "deagle") { startAction(dgReloadAction(!!empty)); return; }
        if (weapon !== "ak") return;
        startAction(akReloadAction(!!empty));
      },
      slash: function (alt) {
        if (weapon !== "knife") return;
        startAction(knSlashAction(alt ? 1 : 0));
      },
      stab: function () {
        if (weapon !== "knife") return;
        startAction(knStabAction());
      },
      inspect: function () {
        if (action && action.name !== "inspect") return; // don't interrupt draw/reload/attacks
        if (action && action.name === "inspect" && actT < action.dur * 0.5) return;
        startAction(weapon === "ak" ? akInspectAction() : weapon === "awp" ? awpInspectAction() : weapon === "deagle" ? dgInspectAction() : knInspectAction());
      },
      // AWP scope: quick raise toward the eye (the game hides the group once scoped)
      setScoped: function (on) { scoped = !!on && weapon === "awp"; },
      update: update,
      muzzle: function (target) {
        target = target || new THREE.Vector3();
        group.updateMatrixWorld(true);
        // muzzle position expressed in the group's parent space (= camera space)
        tmpM.copy(group.matrixWorld).invert().multiply((weapon === "awp" ? awpMuzzleNode : weapon === "deagle" ? dgMuzzleNode : muzzleNode).matrixWorld);
        target.setFromMatrixPosition(tmpM).applyMatrix4(group.matrix);
        return target;
      },
      _tune: { AK_BASE: AK_BASE, KN_BASE: KN_BASE, KN_SHOW: KN_SHOW, KN_LEFT: KN_LEFT, SHOULDER_LK: SHOULDER_LK, SHOULDER_R: SHOULDER_R, SHOULDER_RK: SHOULDER_RK, SHOULDER_L: SHOULDER_L, LH_GUARD: LH_GUARD, LH_MAG_LOCAL: LH_MAG_LOCAL, LH_BOLT: LH_BOLT, kHand: kHand, bali: bali, rHandAK: rHandAK, lHandAK: lHandAK, AWP_BASE: AWP_BASE, AWP_SCOPE: AWP_SCOPE, RH_GRIP_AWP: RH_GRIP_AWP, RH_BOLT_OFF: RH_BOLT_OFF, RH_BOLT_Q: RH_BOLT_Q, LH_MAG_AWP: LH_MAG_AWP, rHandAWP: rHandAWP, lHandAWP: lHandAWP,
        LH_SUP_AWP: LH_SUP_AWP, DG_BASE: DG_BASE, RH_DG: RH_DG, LH_DG_CUP: LH_DG_CUP, LH_DG_SLIDE: LH_DG_SLIDE, LH_DG_OFF: LH_DG_OFF, SHOULDER_R_DG: SHOULDER_R_DG, SHOULDER_L_DG: SHOULDER_L_DG, rHandDG: rHandDG, lHandDG: lHandDG },
      current: function () { return { weapon: weapon, action: action ? action.name : null, t: actT }; },
      // Re-skin the held weapons at any time: { ak, awp, deagle, knife: skinId|null }
      // (a missing key leaves that weapon as it is, null = the default look). Skin materials are
      // cached and shared, so this is cheap to call again.
      setSkins: function (o) {
        o = o || {};
        if ("ak" in o) {
          var ap = o.ak ? skinMaterial(o.ak, "poly") : null, am = o.ak ? skinMaterial(o.ak, "metal") : null;
          akPoly.material = akMagFrameMesh.material = ap || M.poly; akMetal.material = am || M.metal;
          skins.ak = ap ? o.ak : null;
        }
        if ("awp" in o) {
          var wp = o.awp ? skinMaterial(o.awp, "poly") : null, wm = o.awp ? skinMaterial(o.awp, "metal") : null;
          awpPoly.material = awpMag.material = wp || M.poly; awpMetal.material = wm || M.metal;
          skins.awp = wp ? o.awp : null;
        }
        if ("deagle" in o) {
          var dp = o.deagle ? skinMaterial(o.deagle, "poly") : null, dm = o.deagle ? skinMaterial(o.deagle, "metal") : null;
          dgPoly.material = dp || M.poly; dgMetal.material = dgSlideMesh.material = dm || M.metal;
          skins.deagle = dp ? o.deagle : null;
        }
        if ("knife" in o) {
          skinKnife(bali, { metal: M.kmetal, steel: M.ksteel }, o.knife || null);
          skins.knife = o.knife && skinOf(o.knife) ? o.knife : null;
        }
      },
      skins: function () { return { ak: skins.ak, awp: skins.awp, deagle: skins.deagle, knife: skins.knife }; },
      dispose: function () {
        group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        for (var i = 0; i < disposables.length; i++) disposables[i].dispose();
        if (group.parent) group.parent.remove(group);
      }
    };
    api.setWeapon("ak");
    action = null; // start idle; the lead calls setWeapon() to play the draw
    update(0, {});
    return api;
  }

  root.PBModels = {
    createViewmodel: createViewmodel,
    createWorldGun: createWorldGun,
    createWorldKnife: createWorldKnife,
    splatTextures: splatTextures,
    paintBallMaterial: paintBallMaterial
  };

  // Skin rendering lives on PBSkins next to the catalog (pb-skins.js draws the pattern art)
  var PBS = root.PBSkins || (root.PBSkins = {});
  PBS.material = skinMaterial; // (skinId, part: "poly" | "metal" | "blade" | "handle") -> THREE.Material (cached, shared)
  PBS.preview = preview; // (skinId, w, h) -> HTMLCanvasElement, transparent side view (cached per id + size)
  PBS.textures = skinTextures; // (skinId) -> { map, glow|null } (cached)
  PBS.skinsHandles = skinsHandles; // (skinId | skin) -> does this knife skin cover the handles too?
})(typeof window !== "undefined" ? window : this);
