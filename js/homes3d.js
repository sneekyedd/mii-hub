/*
 * homes3d.js
 * Two places that are all about where Miis live:
 *
 *   "apartments"  a cheerful apartment block with a courtyard. Every Mii has
 *                 its own apartment (a door, a name plate and a window). The
 *                 window is lit with the curtains open when that Mii is home.
 *   "home"        the inside of one Mii's apartment, built from the furniture
 *                 it owns (see homes.js for the furniture list).
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
  const PI = Math.PI;
  const W3D = root.World3D;
  // (newer kit parts, for the courtyard outside: plain stand-ins if the kit doesn't have them)
  const kit = root.World3D.kit;
  const detailMat = kit.detailMat || ((kind, color) => toon(color));
  const plasterMat = kit.plasterMat || ((color) => toon(color));
  const blobShadows = kit.blobShadows || (() => null);
  const uvScaled = kit.uvScaled || ((geo) => geo);

  // =====================================================================
  // Small helpers shared by both places
  // =====================================================================

  // A flat picture (sign, screen, painting...). Faces +z unless turned.
  function plane(p, w, h, mat, o) {
    return put(p, new THREE.PlaneGeometry(w, h), mat, Object.assign({ shadow: false }, o));
  }
  // A material that ignores lights (for screens and painted views).
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

  // Picks a font size so the text fits in maxW pixels.
  function fitFont(ctx, text, maxW, size, weight) {
    let s = size;
    for (;;) {
      ctx.font = (weight || "bold") + " " + s + "px 'Nunito', sans-serif";
      if (ctx.measureText(text).width <= maxW || s <= 10) return s;
      s -= 2;
    }
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

  const hex = (n) => "#" + n.toString(16).padStart(6, "0");

  // A plain (sharp-cornered) box: much lighter than a rounded block, good for
  // small or far-away details.
  function bx(p, color, x, y, z, w, h, d, o) {
    return put(p, G.box(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, sx: w, sy: h, sz: d }, o));
  }

  // A round stick from (x1, y1, z1) to (x2, y2, z2) (easel legs, stool legs...).
  const UP = new THREE.Vector3(0, 1, 0), tmpDir = new THREE.Vector3();
  function rod(p, color, x1, y1, z1, x2, y2, z2, r) {
    tmpDir.set(x2 - x1, y2 - y1, z2 - z1);
    const len = tmpDir.length();
    const m = put(p, G.cyl(10), typeof color === "object" ? color : toon(color), { x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: (z1 + z2) / 2, sx: r, sy: len, sz: r });
    m.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
    return m;
  }

  // Builds something that moves as one piece (a car, a cloud...) and merges its
  // parts into a few shapes, so it's quick to draw. Build it at the origin.
  function movingThing(parent, build) {
    if (kit.bakeGeo && kit.paintedMat) {
      // one painted shape (every part keeps its color): the whole thing is drawn in one go
      const m = new THREE.Mesh(kit.bakeGeo(build), kit.paintedMat);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return dynamic(m);
    }
    const g = new THREE.Group();
    build(g);
    mergeStatic(g);
    parent.add(g);
    return dynamic(g);
  }

  // A lighter version of the round tree for scenery far away (fewer triangles).
  function farTree(p, x, z, s, colors) {
    const t = group(p, x, 0, z, 0, s);
    put(t, G.taper(0.24, 0.36, 8), toon(0x9a6a3c), { y: 1.6, sy: 3.2 });
    const [c1, c2] = colors || [0x5cc84a, 0x7fdc5c];
    const S = G.lowSphere();
    put(t, S, toon(c1), { y: 4.1, s: 1.45 });
    put(t, S, toon(c1), { x: -0.95, y: 3.7, z: 0.25, s: 1.0 });
    put(t, S, toon(c1), { x: 0.95, y: 3.75, z: -0.1, s: 1.05 });
    put(t, S, toon(c2), { x: -0.35, y: 4.55, z: 0.55, s: 0.85 });
    return t;
  }

  // A fluffy cloud made of a few balls. All clouds share one material.
  function cloud(p, mat, x, y, z, s) {
    // (a shared emissive material is fine to merge: all clouds look the same)
    const c = new THREE.Group();
    const S = G.lowSphere();
    put(c, S, mat, { s: 2.2, shadow: false });
    put(c, S, mat, { x: 2.2, y: -0.4, z: 0.3, s: 1.6, shadow: false });
    put(c, S, mat, { x: -2.1, y: -0.5, s: 1.5, shadow: false });
    put(c, S, mat, { x: 0.6, y: 1.1, s: 1.4, shadow: false });
    mergeStatic(c);
    c.position.set(x, y, z);
    if (s) c.scale.setScalar(s);
    p.add(c);
    return dynamic(c);
  }

  // A cute little house: walls with a pointy gable at the front (+z), a roof,
  // a door and windows. o = { w, d, h, rh, wall, roof, door, s }
  function house(p, x, z, ry, o) {
    const g = group(p, x, 0, z, ry, o.s);
    const w = o.w || 4, d = o.d || 3.6, h = o.h || 2.6, rh = o.rh || 1.7;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h); shape.lineTo(0, h + rh); shape.lineTo(-w / 2, h); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    put(g, geo, toon(o.wall || 0xfff1dc), {});
    // roof: two thick boards meeting at the top
    const half = Math.hypot(w / 2, rh), ang = Math.atan2(rh, w / 2);
    for (const side of [-1, 1]) {
      block(g, o.roof || 0xe2574c, side * (w / 4 + 0.06), h + rh / 2 + 0.1, 0, half + 0.5, 0.2, d + 0.5, 0.08, { rz: -side * ang });
    }
    bx(g, o.door || 0x9a6a3c, 0, 0.8, d / 2 + 0.03, 0.8, 1.6, 0.1);
    put(g, G.lowSphere(), toon(0xffcf5a), { x: 0.25, y: 0.8, z: d / 2 + 0.1, s: 0.06 });
    const winC = o.lit ? glow(0xffe2a0, 0.5) : toon(0xbfe6ff);
    for (const sx of [-1, 1]) {
      bx(g, 0xffffff, sx * w * 0.3, 1.55, d / 2 + 0.02, 0.85, 0.85, 0.08);
      bx(g, winC, sx * w * 0.3, 1.55, d / 2 + 0.05, 0.65, 0.65, 0.04);
      // windows at the back too, so houses look fine from every side
      bx(g, 0xffffff, sx * w * 0.25, 1.55, -d / 2 - 0.02, 0.85, 0.85, 0.08);
      bx(g, winC, sx * w * 0.25, 1.55, -d / 2 - 0.05, 0.65, 0.65, 0.04);
    }
    bx(g, winC, 0, h + rh * 0.4, d / 2 + 0.03, 0.5, 0.5, 0.06); // little attic window
    bx(g, o.roof || 0xe2574c, w * 0.25, h + rh * 0.8, -d * 0.2, 0.45, 1.0, 0.45); // chimney
    return g;
  }

  // =====================================================================
  // APARTMENTS — the building where every Mii has a home
  // =====================================================================

  // The building: 4 apartments per floor, at least 3 floors. When every apartment
  // is taken, the building gets another floor (like in Tomodachi Life), up to
  // MAX_FLOORS. Ground floor doors open straight onto the courtyard; upper floors
  // open onto walkway balconies, reached by the lift (left) or the stairs (right).
  const APT = { front: -11.6, back: -18, floorH: 3.5, unitW: 6.4, cols: 4, floors: 3 };
  const MAX_FLOORS = 10;
  // How many floors the building needs for this many Miis.
  function floorsFor(residents) {
    return Math.max(APT.floors, Math.min(MAX_FLOORS, Math.ceil((residents || 0) / APT.cols)));
  }
  const UNIT_COLORS = [
    [0xff7a8a, 0xffb3c1], [0x5cb8ff, 0xa8d8ff], [0x6fcf6a, 0xbdecb8], [0xffad3a, 0xffd99a],
    [0xb58cff, 0xdccbff], [0xff8a5c, 0xffc2a6], [0x3fc2b9, 0xa5e8e2], [0xf06fb0, 0xf9b5d8],
    [0x8bc34a, 0xd3eba8], [0x6f8cff, 0xbdcaff], [0xf2c230, 0xfff0a0], [0xe0605a, 0xf4b0aa],
  ];

  function unitInfo(i) {
    const f = Math.floor(i / APT.cols), c = i % APT.cols;
    const cx = -((APT.cols - 1) / 2) * APT.unitW + c * APT.unitW;
    return {
      i, f, c, cx, y: f * APT.floorH,
      doorX: cx - 1.75, winX: cx + 1.05,
      num: (f + 1) * 100 + c + 1,
      door: UNIT_COLORS[i % UNIT_COLORS.length][0], curtain: UNIT_COLORS[i % UNIT_COLORS.length][1],
    };
  }

  // Each flat's front window (heights above the flat's floor) and the little
  // room behind it: 4 wide, 2.9 deep, behind a front wall 0.25 thick.
  const WIN = { w: 2.8, sill: 0.42, top: 2.78 };
  const FLAT = { hw: 2.0, depth: 2.9, wall: 0.25, ceil: 3.15 };

  // Grass and paving pictures (shared by the courtyard and the view from a flat).
  function grassTexture(repeat, seed, blades) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#86d65e"; ctx.fillRect(0, 0, w, h);
      const r = seeded(seed || 12);
      for (let i = 0; i < (blades || 150); i++) {
        const x = r() * w, y = r() * h;
        ctx.strokeStyle = r() < 0.5 ? "rgba(70,150,45,0.5)" : "rgba(180,240,130,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x + 3, y); ctx.lineTo(x + 4, y - 7); ctx.stroke();
      }
    }, repeat);
  }
  function paveTexture(repeat) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#c9a982"; ctx.fillRect(0, 0, w, h);
      const r = seeded(3);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const off = (y % 2) * 32;
        ctx.fillStyle = ["#e4c9a0", "#dcc095", "#e0c49a", "#d4b68a"][Math.floor(r() * 4)];
        roundRect(ctx, x * 64 + off - 64 + 3, y * 64 + 3, 58, 58, 8); ctx.fill();
        roundRect(ctx, x * 64 + off + 3, y * 64 + 3, 58, 58, 8); ctx.fill();
      }
    }, repeat);
  }

  // The courtyard's paving: bigger than paveTexture (8 x 8 slabs before it repeats), and
  // every slab a little different: worn ones, a cracked one, moss in some of the joints.
  function courtPaveTexture(repeat) {
    return canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#c9a982"; ctx.fillRect(0, 0, w, h);
      const r = seeded(17);
      const shades = ["#e4c9a0", "#dcc095", "#e0c49a", "#d4b68a", "#e8d0aa", "#d8bc90"];
      for (let y = 0; y < 8; y++) for (let x = -1; x < 8; x++) {
        const px = x * 64 + (y % 2) * 32 + 3, py = y * 64 + 3;
        ctx.fillStyle = shades[Math.floor(r() * shades.length)];
        roundRect(ctx, px, py, 58, 58, 8); ctx.fill();
        // soft light and dark patches (worn by feet) and a few specks
        const g = ctx.createRadialGradient(px + 29, py + 29, 2, px + 29, py + 29, 40);
        const lit = r() < 0.5;
        g.addColorStop(0, lit ? "rgba(255,250,235,0.25)" : "rgba(150,110,70,0.12)"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; roundRect(ctx, px, py, 58, 58, 8); ctx.fill();
        for (let k = 0; k < 6; k++) { ctx.fillStyle = "rgba(120,90,60,0.18)"; ctx.fillRect(px + 4 + r() * 50, py + 4 + r() * 50, 2, 2); }
        ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(px + 6, py + 3, 46, 2);
        if (r() < 0.12) { // moss in the joint
          ctx.fillStyle = "rgba(110,160,70,0.55)";
          for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(px - 1 + r() * 4, py + 10 + r() * 40, 2 + r() * 2, 0, TAU); ctx.fill(); }
        }
      }
      ctx.strokeStyle = "rgba(110,80,50,0.4)"; ctx.lineWidth = 1.5; // a crack
      ctx.beginPath(); ctx.moveTo(206, 140); ctx.lineTo(220, 158); ctx.lineTo(216, 176); ctx.lineTo(230, 190); ctx.stroke();
    }, repeat);
  }

  // Window glass: almost clear, with a faint blue tint and two soft streaks of shine.
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

  // opts.residents = how many Miis live here (decides how many floors to build)
  // RARE (courtyard): a golden koi turns up in the koi pond, glittering. Click it and
  // it leaps right out of the water in a big sparkly arc (very lucky!) for a sticker.
  // Leave it be and it slips away again after a while.
  function goldenKoi(root, KP) {
    const fish = dynamic(group(root, KP.x, -2, KP.z));
    const gold = toon(0xffc93a, { emissive: 0xffb000, emissiveIntensity: 0.45 });
    put(fish, G.sphere(), gold, { s: 0.3, sx: 1.0, sy: 0.3, sz: 0.48, shadow: false });
    put(fish, G.sphere(), toon(0xfff1a8, { emissive: 0xffe070, emissiveIntensity: 0.5 }), { x: 0.08, y: 0.04, s: 0.12, sy: 0.3, shadow: false });
    put(fish, G.cone(4), gold, { x: -0.38, s: 0.17, sy: 0.25, rz: PI / 2, sz: 0.06, shadow: false });
    put(fish, G.cone(4), gold, { y: 0.09, s: 0.1, sy: 0.14, sz: 0.04, shadow: false }); // fin
    for (const sz of [-0.09, 0.09]) ball(fish, 0x222222, 0.22, 0.03, sz, 0.025, { shadow: false });
    fish.visible = false;
    // glitter around it, and the splash when it jumps
    const sparkles = [];
    for (let i = 0; i < 10; i++) {
      const s = dynamic(ball(root, glow(0xfff3a0, 1.4), KP.x, -2, KP.z, 0.05, { shadow: false }));
      s.visible = false;
      sparkles.push(s);
    }
    const ring = dynamic(put(root, G.torus(1, 0.04), toon(0xffffff, { transparent: true, opacity: 0.8 }), { x: KP.x, y: 0.08, z: KP.z, rx: -PI / 2, shadow: false }));
    ring.visible = false;
    let ev = null, check = 5;
    const tmpV = new THREE.Vector3();
    function end(ctx, done) {
      ev = null; check = 5;
      fish.visible = ring.visible = false;
      sparkles.forEach((s) => { s.visible = false; });
      if (done) ctx.event("koi");
    }
    // where it swims: a lazy figure of eight round the pond
    const swimAt = (u) => ({ x: KP.x + Math.sin(u) * (KP.rx - 0.8), z: KP.z + Math.sin(u * 2) * (KP.rz - 0.6) * 0.8 });
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
        let glitter = 1;
        if (ev.phase === "swim" || ev.phase === "away") {
          ev.u += dt * 0.55;
          const a = swimAt(ev.u), b = swimAt(ev.u + 0.05);
          const rise = ev.phase === "away" ? 1 - Math.min(1, ev.time / 1.5) : Math.min(1, ev.time / 1.2);
          fish.position.set(a.x, 0.02 - (1 - rise) * 0.4, a.z);
          fish.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
          fish.rotation.y += Math.sin(t * 7) * 0.15;
          glitter = rise;
          if (ev.phase === "swim" && !ev.noticed && ev.time > 3) {
            ev.noticed = true;
            const w = ctx.all().sort((p, q) => Math.hypot(p.x - KP.x, p.z - KP.z) - Math.hypot(q.x - KP.x, q.z - KP.z))[0];
            if (w) ctx.say(w, "Is that... a golden koi?!", 2.6);
          }
          if (ev.phase === "swim" && ev.time > 30) { ev.phase = "away"; ev.time = 0; }
          if (ev.phase === "away" && ev.time > 1.5) { end(ctx, false); return; }
        } else if (ev.phase === "jump") {
          // a big arc out of the water, turning head over tail
          const k = Math.min(1, ev.time / 1.6);
          const x = ev.from.x + (ev.to.x - ev.from.x) * k, z = ev.from.z + (ev.to.z - ev.from.z) * k;
          fish.position.set(x, 0.05 + Math.sin(k * PI) * 2.8, z);
          fish.rotation.set(0, -Math.atan2(ev.to.z - ev.from.z, ev.to.x - ev.from.x), PI / 2 - k * PI);
          if (k >= 1 && !ev.splashed) { ev.splashed = true; ev.splashT = 0; ring.position.set(x, 0.08, z); }
          if (ev.splashT !== undefined) {
            ev.splashT += dt;
            const r = ev.splashT / 1.1;
            ring.visible = r < 1;
            ring.scale.set(0.2 + r * 1.3, 0.2 + r * 0.9, 1);
            ring.material.opacity = 0.8 * (1 - r);
            fish.position.y = -Math.min(0.5, ev.splashT * 0.6); // (and away it goes)
            glitter = Math.max(0, 1 - ev.splashT);
          }
          if (!ev.cheered && ev.time > 0.8) {
            ev.cheered = true;
            const cheers = ["Whoa! A golden koi!", "Make a wish, quick!", "So lucky!!", "Did you see that?!"];
            ctx.all().slice(0, 4).forEach((w, i) => { ctx.say(w, cheers[i], 2.6); if (!w.anchored) w.targetYaw = Math.atan2(KP.x - w.x, KP.z - w.z); });
          }
          if (ev.time > 3) { end(ctx, true); return; }
        }
        // the glitter twinkles round the fish
        sparkles.forEach((s, i) => {
          const a = t * 1.7 + (i / sparkles.length) * TAU, r = 0.35 + (i % 3) * 0.18;
          s.visible = glitter > 0.05;
          s.position.set(fish.position.x + Math.cos(a) * r, Math.max(0.12, fish.position.y) + 0.12 + Math.sin(t * 4 + i) * 0.12 + (i % 2) * 0.15, fish.position.z + Math.sin(a) * r * 0.7);
          s.scale.setScalar(0.07 * glitter * (0.6 + 0.6 * Math.abs(Math.sin(t * 6 + i * 1.3))));
        });
      },
      pick(ray) {
        if (!ev || ev.phase !== "swim" || ev.time < 1) return false;
        tmpV.copy(fish.position).setY(0.1);
        if (ray.distanceSqToPoint(tmpV) > 0.9 * 0.9) return false;
        this.leap();
        return true;
      },
      leap() { // (also used for testing)
        if (!ev || ev.phase !== "swim") return;
        const a = swimAt(ev.u), b = swimAt(ev.u + 0.6);
        Object.assign(ev, { phase: "jump", time: 0, from: { x: a.x, z: a.z }, to: { x: b.x, z: b.z } });
      },
      stop(ctx) { if (ev) end(ctx, false); },
      force() { // (also used for testing)
        if (ev) return;
        ev = { phase: "swim", time: 0, u: Math.random() * TAU };
        fish.visible = true;
      },
      _state: () => ev, _fish: fish, // (for testing)
    };
  }

  function buildApartments(opts) {
    const FL = floorsFor(opts && opts.residents);
    const N = FL * APT.cols; // number of apartments
    const root = new THREE.Group();
    const anim = [];
    addLights(root, { sky: 0xd6f0ff, ground: 0x9ad27a, hemi: 0.5, sun: 0.9, ambient: 0.24 });
    skyDome(root, 0x3fa9f5, 0xcdeeff, 0xa8dc8a);
    const FZ = APT.front, H = APT.floorH;

    // ---------- ground: grass everywhere, a paved courtyard in the middle ----------
    disc(root, toon(0xffffff, { map: grassTexture([60, 60]) }), 0, -0.02, 0, 170, { receive: true });
    const paveTex = courtPaveTexture([4.5, 3]);
    put(root, new THREE.PlaneGeometry(36, 22.6), toon(0xffffff, { map: paveTex }), { y: 0.01, z: (FZ + 11) / 2, rx: -PI / 2, shadow: false });
    // two lawns (left and right) with the playground and the picnic area, edged with bricks
    const lawnTex = grassTexture([3, 2.4], 31, 110);
    const brickEdge = detailMat("brick", 0xd98a6a);
    for (const [lx, lz, lw, ld] of [[-11.8, 5.6, 10.6, 8.4], [12.6, 5.2, 9.6, 9.2]]) {
      block(root, toon(0xffffff, { map: lawnTex }), lx, 0.03, lz, lw, 0.06, ld, 0.03, { shadow: false });
      for (const [ex, ez, ew, ed] of [[0, -ld / 2, lw + 0.24, 0.12], [0, ld / 2, lw + 0.24, 0.12], [-lw / 2, 0, 0.12, ld], [lw / 2, 0, 0.12, ld]]) {
        put(root, uvScaled(G.box(), Math.max(ew, ed) * 4.5, 0.6), brickEdge, { x: lx + ex, y: 0.05, z: lz + ez, sx: ew, sy: 0.1, sz: ed, shadow: false });
      }
    }

    // ---------- the apartment building ----------
    const W = APT.unitW * APT.cols; // 25.6
    const D = APT.back - FZ;
    const wallC = 0xffe6c7, trimC = 0xff8a7a, railC = 0x6fcfbf;
    // The back part of the building is one solid block. The front part is a wall
    // with a real window opening for every flat, and a little room behind each one
    // (built further down). Between the rooms it's hollow, but nobody can see that.
    const RZ0 = FZ - FLAT.wall;          // inside face of the front wall
    const RZ1 = RZ0 - FLAT.depth;        // back wall of the rooms
    const bodyD = RZ1 - 0.03 - APT.back;
    // (the walls are soft plaster: see the kit's plasterMat)
    const wallM = plasterMat(wallC);
    block(root, wallM, 0, (H * FL) / 2, APT.back + bodyD / 2, W, H * FL, bodyD, 0.08);
    const fwz = FZ - FLAT.wall / 2;
    for (let f = 0; f < FL; f++) {
      bx(root, wallM, 0, f * H + WIN.sill / 2, fwz, W, WIN.sill, FLAT.wall);                       // below the windows
      bx(root, wallM, 0, f * H + (WIN.top + H) / 2, fwz, W, H - WIN.top, FLAT.wall);              // above them
    }
    // the bits of wall between the windows, all the way up
    const winXs = [];
    for (let c = 0; c < APT.cols; c++) winXs.push(unitInfo(c).winX);
    const edges = [-W / 2].concat(...winXs.map((x) => [x - WIN.w / 2, x + WIN.w / 2]), [W / 2]);
    for (let k = 0; k < edges.length; k += 2) bx(root, wallM, (edges[k] + edges[k + 1]) / 2, (H * FL) / 2, fwz, edges[k + 1] - edges[k], H * FL, FLAT.wall);
    put(root, uvScaled(G.rbox(W, 0.4, 0.12, 0.03), 14.5, 0.33), detailMat("brick", 0xe0a080), { y: 0.2, z: FZ + 0.02 }); // a brick plinth
    // gentle stripes between the floors
    for (let f = 1; f < FL; f++) block(root, 0xffd3a8, 0, f * H - 0.42, FZ + 0.01, W, 0.18, 0.06, 0.02, { shadow: false });
    // walkway balconies (2nd and 3rd floor) with railings, held up by pillars
    const balusters = [];
    for (let f = 1; f < FL; f++) {
      const y = f * H;
      block(root, 0xfdf8f0, 0, y - 0.11, FZ + 0.76, W + 0.1, 0.22, 1.52, 0.04);
      block(root, trimC, 0, y - 0.12, FZ + 1.53, W + 0.2, 0.3, 0.1, 0.04);
      block(root, railC, 0, y + 0.95, FZ + 1.45, W + 0.1, 0.1, 0.12, 0.04);
      block(root, railC, 0, y + 0.18, FZ + 1.45, W + 0.1, 0.07, 0.08, 0.03);
      for (let x = -W / 2 + 0.2; x <= W / 2 - 0.1; x += 0.32) balusters.push({ x, y: y + 0.56, z: FZ + 1.45, sx: 0.035, sy: 0.78, sz: 0.035 });
    }
    scatter(root, G.cyl(6), toon(railC), balusters, true);
    const pillarXs = [];
    for (let c = 0; c <= APT.cols; c++) pillarXs.push(-W / 2 + c * APT.unitW);
    for (const x of pillarXs) cylinder(root, 0xfdf8f0, x, (H * (FL - 1)) / 2, FZ + 1.3, 0.15, H * (FL - 1));
    // roof with a parapet, a sign, a water tank and a TV aerial
    block(root, trimC, 0, H * FL + 0.22, (FZ + APT.back) / 2, W + 0.4, 0.44, -D + 0.4, 0.08);
    block(root, 0xd9cfc2, 0, H * FL + 0.46, (FZ + APT.back) / 2, W - 0.4, 0.06, -D - 0.4, 0.02, { shadow: false });
    const roofSign = canvasTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 8; ctx.strokeStyle = "#ff8a7a"; roundRect(ctx, 8, 8, w - 16, h - 16, 22); ctx.stroke();
      ctx.fillStyle = "#e2574c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fitFont(ctx, "Mii Apartments", w - 60, 58);
      ctx.fillText("Mii Apartments", w / 2, h / 2 + 3);
    });
    for (const sx of [-2.6, 2.6]) block(root, 0x8f96a3, sx, H * FL + 0.9, FZ + 0.4, 0.12, 1.0, 0.12, 0.03);
    block(root, 0xffffff, 0, H * FL + 1.55, FZ + 0.4, 7.0, 1.3, 0.14, 0.12);
    plane(root, 6.9, 1.29, toon(0xffffff, { map: roofSign }), { y: H * FL + 1.55, z: FZ + 0.48 });
    plane(root, 6.9, 1.29, toon(0xffffff, { map: roofSign }), { y: H * FL + 1.55, z: FZ + 0.32, ry: PI });
    const tank = group(root, 8.5, H * FL + 0.45, -15.5);
    for (const [sx, sz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) block(tank, 0x8f96a3, sx, 0.6, sz, 0.12, 1.2, 0.12, 0.03);
    cylinder(tank, 0x7cc6e8, 0, 1.9, 0, 1.1, 1.5);
    put(tank, G.cone(), toon(0x5aa8d0), { y: 2.9, s: 1.15, sy: 0.5 });
    const aer = group(root, -7, H * FL + 0.45, -14.5);
    cylinder(aer, 0x8f96a3, 0, 1.0, 0, 0.04, 2.0);
    for (let i = 0; i < 3; i++) cylinder(aer, 0x8f96a3, 0, 1.4 + i * 0.25, 0, 0.025, 1.2 - i * 0.25, { rz: PI / 2 });
    for (let i = 0; i < 5; i++) block(root, [0x5cc84a, 0x4fbf47][i % 2], -11 + i * 1.3, H * FL + 0.75, -17.4, 0.9, 0.6, 0.6, 0.25);

    // the back of the building: a window (with a little balcony upstairs) for every flat
    for (let i = 0; i < N; i++) {
      const u = unitInfo(i);
      const wx = -u.cx, by = u.y + 1.8, bz = APT.back - 0.02;
      bx(root, 0xffffff, wx, by, bz, 2.6, 1.6, 0.1);
      bx(root, 0x9fd0f0, wx, by, bz - 0.05, 2.3, 1.3, 0.04);
      bx(root, 0xffffff, wx, by, bz - 0.08, 0.08, 1.3, 0.04);
      bx(root, 0xffffff, wx, by - 0.86, bz - 0.12, 2.9, 0.1, 0.3);  // the sill
      bx(root, 0xffffff, wx, by + 0.86, bz - 0.06, 2.8, 0.12, 0.16); // and the top of the frame
      // (its curtains open and shut with the front ones: see backCurtains)
      if (u.f > 0) {
        block(root, 0xfdf8f0, wx, u.y - 0.1, bz - 0.55, 3.0, 0.2, 1.1, 0.04);
        block(root, railC, wx, u.y + 0.5, bz - 1.07, 3.0, 0.9, 0.06, 0.04);
        put(root, G.taper(0.16, 0.12), toon(0xe0784a), { x: wx + 1.1, y: u.y + 0.15, z: bz - 0.5, sy: 0.3 });
        put(root, G.lowSphere(), toon(0x5cc84a), { x: wx + 1.1, y: u.y + 0.45, z: bz - 0.5, s: 0.22 });
      } else {
        bx(root, 0x55606e, wx + 1.9, 0.45, bz - 0.35, 0.8, 0.7, 0.5); // air conditioner
        cylinder(root, 0x8f96a3, wx + 1.9, 0.45, bz - 0.61, 0.22, 0.03, { rx: PI / 2 });
      }
    }
    for (let x = -12; x <= 12; x += 4) bush(root, x + 2, APT.back - 1.2, 0.8, 0x4fbf47, [0xff6fa5, null, 0xffe25a][(x / 4 + 3) % 3]);

    // ---------- the two towers: lift (left) and stairs (right) ----------
    const TX = W / 2 + 1.8; // 14.6
    const towerTop = H * FL + 1.4;
    const stairTex = canvasTexture(64, 256, (ctx, w, h) => {
      ctx.fillStyle = "#cfeaff"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#8aa6c4"; ctx.lineWidth = 6;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const y0 = h - k * 64; ctx.moveTo(k % 2 ? w : 0, y0); ctx.lineTo(k % 2 ? 0 : w, y0 - 64); }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(6, 0, 8, h);
    });
    for (const side of [-1, 1]) {
      const tx = side * TX;
      block(root, plasterMat(0xffd6b0), tx, towerTop / 2, (FZ + APT.back) / 2 + 0.1, 3.6, towerTop, -D + 0.4, 0.1);
      block(root, trimC, tx, towerTop + 0.2, (FZ + APT.back) / 2 + 0.1, 3.9, 0.4, -D + 0.7, 0.1);
      // the entrance
      block(root, 0xffffff, tx, 1.3, FZ + 0.25, 2.2, 2.6, 0.12, 0.05);
      if (side < 0) {
        // lift doors with up/down buttons and a floor display
        block(root, 0xb9c3cf, tx - 0.42, 1.2, FZ + 0.32, 0.8, 2.3, 0.08, 0.02);
        block(root, 0xb9c3cf, tx + 0.42, 1.2, FZ + 0.32, 0.8, 2.3, 0.08, 0.02);
        block(root, 0x2f3542, tx + 1.35, 1.25, FZ + 0.26, 0.24, 0.5, 0.06, 0.03);
        ball(root, glow(0xffcf5a, 0.9), tx + 1.35, 1.36, FZ + 0.3, 0.05);
        ball(root, glow(0xffcf5a, 0.9), tx + 1.35, 1.14, FZ + 0.3, 0.05);
        block(root, 0x2f3542, tx, 2.85, FZ + 0.32, 1.1, 0.3, 0.06, 0.03);
        for (let k = 0; k < 3; k++) ball(root, k === 0 ? glow(0xff8a5c, 1) : toon(0x55606e), tx - 0.3 + k * 0.3, 2.85, FZ + 0.36, 0.06);
      } else {
        // glass door to the stairs
        block(root, toon(0xbfe6ff, { transparent: true, opacity: 0.85 }), tx, 1.2, FZ + 0.32, 1.7, 2.3, 0.06, 0.03);
        block(root, 0xffffff, tx, 1.2, FZ + 0.36, 0.08, 2.3, 0.04, 0.02);
        ball(root, 0xffcf5a, tx + 0.18, 1.1, FZ + 0.4, 0.06);
      }
      // tall window showing the lift shaft / the zig-zag stairs
      put(root, new THREE.PlaneGeometry(1.4, H * (FL - 1) + 0.6), toon(0xffffff, { map: side > 0 ? stairTex : null, color: side > 0 ? 0xffffff : 0xd6ecff }), { x: tx, y: H + (H * (FL - 1)) / 2 - 0.1, z: FZ + 0.32, shadow: false });
      block(root, 0xffffff, tx, H + 0.15, FZ + 0.3, 1.6, 0.12, 0.1, 0.03);
      block(root, 0xffffff, tx, H * FL + 0.65, FZ + 0.3, 1.6, 0.12, 0.1, 0.03);
      const lbl = canvasTexture(256, 64, (ctx, w, h) => {
        ctx.fillStyle = "#2f6f9f"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "bold 34px 'Nunito', sans-serif";
        ctx.fillText(side < 0 ? "▲▼  LIFT" : "STAIRS  ⤴", w / 2, h / 2 + 2);
      });
      plane(root, 1.6, 0.4, toon(0xffffff, { map: lbl }), { x: tx, y: side < 0 ? 3.35 : 2.86, z: FZ + 0.34 });
      // windows on the outer side of the tower
      for (let f = 0; f < FL; f++) {
        bx(root, 0xffffff, tx + side * 1.82, f * H + 1.9, (FZ + APT.back) / 2, 0.1, 1.3, 1.3);
        bx(root, 0x9fd0f0, tx + side * 1.86, f * H + 1.9, (FZ + APT.back) / 2, 0.04, 1.05, 1.05);
        bx(root, 0xffffff, tx + side * 1.9, f * H + 1.22, (FZ + APT.back) / 2, 0.22, 0.08, 1.5); // a sill
      }
      // a little canopy over the entrance
      block(root, trimC, tx, 3.05 + (side < 0 ? 0.55 : 0), FZ + 0.75, 2.6, 0.12, 1.1, 0.05);
    }

    // ---------- each apartment: a door, a name plate, a window ----------
    const forRentTex = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#e2574c"; ctx.lineWidth = 5; roundRect(ctx, 5, 5, w - 10, h - 10, 8); ctx.stroke();
      ctx.fillStyle = "#e2574c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 24px 'Nunito', sans-serif"; ctx.fillText("FOR RENT", w / 2, h / 2 + 1);
    });
    const glassMat = glassMaterial();
    const doormat = detailMat("coir", 0xc99a62); // (one bristly mat for every door: drawn in one go)
    const lampSpots = [];
    const units = [];
    const WH = WIN.top - WIN.sill, WY = (WIN.top + WIN.sill) / 2;
    const roomZ = RZ0 - FLAT.depth / 2; // the middle of each little room
    for (let i = 0; i < N; i++) {
      const u = unitInfo(i);
      const y = u.y;
      // door (with a little round window and a knob) and its frame
      block(root, 0xffffff, u.doorX, y + 1.2, FZ + 0.03, 1.4, 2.4, 0.08, 0.04);
      block(root, u.door, u.doorX, y + 1.12, FZ + 0.09, 1.15, 2.22, 0.12, 0.06);
      disc(root, toon(0xdff3ff), u.doorX, y + 1.72, FZ + 0.16, 0.17, { rx: 0 });
      ball(root, 0xffcf5a, u.doorX + 0.4, y + 1.05, FZ + 0.19, 0.07);
      block(root, doormat, u.doorX, y + 0.02, FZ + 0.55, 1.1, 0.04, 0.6, 0.02, { shadow: false }); // a bristly doormat
      // wall lamp by the door (lit when someone's home)
      block(root, 0x55606e, u.doorX - 0.9, y + 1.85, FZ + 0.08, 0.1, 0.22, 0.12, 0.03);
      lampSpots.push({ x: u.doorX - 0.9, y: y + 1.85, z: FZ + 0.2 });
      // name plate: hung on the railing upstairs, on a flower box under the window downstairs
      let plateAt;
      if (u.f === 0) {
        block(root, 0xc98b4a, u.winX, 0.32, FZ + 0.4, WIN.w + 0.2, 0.64, 0.62, 0.06);
        block(root, 0x7a4e2c, u.winX, 0.62, FZ + 0.4, WIN.w, 0.06, 0.48, 0.02, { shadow: false });
        for (let k = 0; k < 7; k++) {
          const fx = u.winX - 1.2 + k * 0.4;
          put(root, G.lowSphere(), toon(0x5cc84a), { x: fx, y: 0.7, z: FZ + 0.38 + (k % 2) * 0.1, s: 0.2, sy: 0.15 });
          put(root, G.lowSphere(), toon([0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff][(k + u.c) % 4]), { x: fx + 0.06, y: 0.8, z: FZ + 0.44, s: 0.09, shadow: false });
        }
        plateAt = { y: 0.32, z: FZ + 0.72, w: 2.5, h: 0.56 };
      } else {
        block(root, 0x9a6a3c, u.winX, y + 0.58, FZ + 1.53, 2.62, 0.72, 0.06, 0.05);
        plateAt = { y: y + 0.58, z: FZ + 1.57, w: 2.5, h: 0.65 };
      }
      const plateCanvas = document.createElement("canvas");
      plateCanvas.width = 384; plateCanvas.height = 100;
      const plateTex = new THREE.CanvasTexture(plateCanvas);
      plateTex.encoding = THREE.sRGBEncoding;
      plateTex.anisotropy = 8;
      dynamic(plane(root, plateAt.w, plateAt.h, toon(0xffffff, { map: plateTex }), { x: u.winX, y: plateAt.y, z: plateAt.z }));
      // window: an opening in the wall with a frame, a sill and real glass
      const wy = y + WY;
      block(root, 0xffffff, u.winX, y + WIN.top + 0.07, FZ + 0.03, WIN.w + 0.34, 0.16, 0.16, 0.04);
      block(root, 0xffffff, u.winX, y + WIN.sill - 0.05, FZ + 0.06, WIN.w + 0.46, 0.12, 0.34, 0.04);
      for (const sx of [-1, 1]) block(root, 0xffffff, u.winX + sx * (WIN.w / 2 + 0.07), wy, FZ + 0.03, 0.16, WH + 0.1, 0.16, 0.04);
      plane(root, WIN.w, WH, glassMat, { x: u.winX, y: wy, z: FZ - 0.07 });
      cylinder(root, 0x9a6a3c, u.winX, y + WIN.top - 0.1, FZ - 0.13, 0.03, WIN.w, { rz: PI / 2, shadow: false });
      if (u.f === 0) {
        // a potted plant by each ground floor door
        put(root, G.taper(0.2, 0.15), toon(u.door), { x: u.doorX + 0.95, y: 0.2, z: FZ + 0.35, sy: 0.4 });
        disc(root, toon(0x6b4a2a), u.doorX + 0.95, 0.405, FZ + 0.35, 0.18);
        ball(root, 0x5cc84a, u.doorX + 0.95, 0.6, FZ + 0.35, 0.28);
        ball(root, [0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff][u.c], u.doorX + 0.95, 0.82, FZ + 0.42, 0.1);
      } else if ((u.i + u.f) % 2 === 0) {
        // and a little one on the walkway outside every other door upstairs
        put(root, G.taper(0.16, 0.12), toon(u.door), { x: u.doorX + 0.95, y: y + 0.16, z: FZ + 0.3, sy: 0.32 });
        ball(root, 0x5cc84a, u.doorX + 0.95, y + 0.46, FZ + 0.3, 0.22);
        ball(root, [0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff][(u.c + u.f) % 4], u.doorX + 1.0, y + 0.62, FZ + 0.37, 0.08);
      }
      // the little room behind the window (filled in when someone lives here)
      const room = dynamic(group(root, u.winX, y, roomZ));
      room.visible = false;
      units.push(Object.assign(u, {
        plateCanvas, plateTex, room, shell: null, contents: null, anim: [], spot: null,
        open: 0, openNow: -1, home: null, plateKey: null, builtKey: null, resident: null,
      }));
    }
    // curtains (two per window) and the "For rent" signs: one shape each, drawn in one go
    // (soft folds in the cloth: they bunch up as the curtains open, like the ones inside)
    const curtains = new THREE.InstancedMesh(G.rbox(1, 1, 1, 0.08), detailMat("folds", 0xffffff), N * 2);
    const rentSigns = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.0, 0.5), toon(0xffffff, { map: forRentTex }), N);
    const tmpO = new THREE.Object3D();
    const curtainCol = new THREE.Color();
    units.forEach((u, i) => {
      curtainCol.set(u.curtain);
      curtains.setColorAt(i * 2, curtainCol);
      curtains.setColorAt(i * 2 + 1, curtainCol);
    });
    // the window at the back of each flat has curtains too (shut while the Mii is out)
    const backCurtains = new THREE.InstancedMesh(G.box(), detailMat("folds", 0xffffff), N * 2);
    units.forEach((u, i) => {
      curtainCol.set(u.curtain);
      backCurtains.setColorAt(i * 2, curtainCol);
      backCurtains.setColorAt(i * 2 + 1, curtainCol);
    });
    for (const m of [curtains, rentSigns, backCurtains]) { m.castShadow = false; m.frustumCulled = false; root.add(dynamic(m)); }
    function placeBackCurtains(u) {
      const half = 1.17, bw = half + (0.42 - half) * Math.max(0, u.openNow);
      const wx = -u.cx, by = u.y + 1.8, bz = APT.back - 0.11;
      for (const s of [0, 1]) {
        tmpO.position.set(s ? wx + half - bw / 2 : wx - half + bw / 2, by, bz);
        tmpO.rotation.set(0, 0, 0);
        tmpO.scale.set(bw, 1.3, 0.04);
        tmpO.updateMatrix();
        backCurtains.setMatrixAt(u.i * 2 + s, tmpO.matrix);
      }
      backCurtains.instanceMatrix.needsUpdate = true;
    }
    function placeCurtains(u) {
      placeBackCurtains(u);
      const cw = (WIN.w / 2 + 0.06) + (0.34 - (WIN.w / 2 + 0.06)) * Math.max(0, u.openNow); // each curtain's width
      for (const s of [0, 1]) {
        tmpO.position.set(s ? u.winX + WIN.w / 2 + 0.02 - cw / 2 : u.winX - WIN.w / 2 - 0.02 + cw / 2, u.y + WY - 0.05, FZ - 0.17);
        tmpO.rotation.set(0, 0, 0);
        tmpO.scale.set(cw, WH - 0.04, 0.06);
        tmpO.updateMatrix();
        curtains.setMatrixAt(u.i * 2 + s, tmpO.matrix);
      }
      curtains.instanceMatrix.needsUpdate = true;
    }
    function placeRentSign(u, show) {
      tmpO.position.set(u.winX - 0.6, u.y + WY + 0.1, FZ - 0.03);
      tmpO.rotation.set(0, 0, 0.06);
      tmpO.scale.setScalar(show ? 1 : 0.0001);
      tmpO.updateMatrix();
      rentSigns.setMatrixAt(u.i, tmpO.matrix);
      rentSigns.instanceMatrix.needsUpdate = true;
    }
    // porch lamps: one shape drawn 12 times, colored on/off
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), lampSpots.length);
    const lampOn = new THREE.Color(0xffe08a), lampOff = new THREE.Color(0x9aa3b0);
    lampSpots.forEach((q, i) => { tmpO.position.set(q.x, q.y, q.z); tmpO.rotation.set(0, 0, 0); tmpO.scale.setScalar(1); tmpO.updateMatrix(); lamps.setMatrixAt(i, tmpO.matrix); lamps.setColorAt(i, lampOff); });
    root.add(dynamic(lamps));

    function drawPlate(u, res) {
      const ctx = u.plateCanvas.getContext("2d");
      const w = 384, h = 100;
      ctx.fillStyle = "#9a6a3c"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = res ? "#fffaf0" : "#ece6da"; roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fill();
      ctx.fillStyle = hex(u.door); roundRect(ctx, 8, 8, 92, h - 16, 14); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 38px 'Nunito', sans-serif"; ctx.fillText(String(u.num), 54, h / 2 + 2);
      const mid = 108 + (w - 120) / 2;
      if (res) {
        ctx.fillStyle = "#3a2a1a";
        fitFont(ctx, res.name || "?", w - 130, 58);
        ctx.fillText(res.name || "?", mid, h / 2 + 3);
      } else {
        ctx.fillStyle = "#9a8f80";
        ctx.font = "italic bold 40px 'Nunito', sans-serif";
        ctx.fillText("For rent", mid, h / 2 + 2);
      }
      u.plateTex.needsUpdate = true;
    }

    // ---------- courtyard things to do ----------
    // mailboxes (one little box per apartment, in each apartment's color)
    const MB = { x: -16.7, z: -7.0 };
    const mb = group(root, MB.x, 0, MB.z, PI / 2);
    for (const sx of [-1.0, 1.0]) block(mb, 0x8f96a3, sx, 0.4, 0, 0.12, 0.8, 0.12, 0.03);
    block(mb, 0xdfe4ea, 0, 1.35, 0, 2.5, 1.3, 0.55, 0.08);
    const rowH = Math.min(0.4, 1.2 / FL); // more floors = more (smaller) mailboxes
    for (let i = 0; i < N; i++) {
      const u = unitInfo(i);
      const bx = -0.87 + u.c * 0.58, by = 1.82 - u.f * rowH;
      block(mb, u.door, bx, by, 0.27, 0.5, rowH * 0.8, 0.04, 0.03);
      block(mb, 0x2f3542, bx, by + rowH * 0.2, 0.3, 0.26, 0.03, 0.02, 0.01);
    }
    block(mb, 0x9aa3b0, 0, 2.05, 0, 2.6, 0.08, 0.65, 0.03);
    // a cat napping on top of the mailboxes, swishing its tail
    const cat = group(mb, 0.6, 2.09, 0, 0.3);
    ball(cat, 0xffa94d, 0, 0.18, 0, 0.26, { sx: 1.4, sy: 0.75 });
    ball(cat, 0xffa94d, 0.33, 0.3, 0.05, 0.17);
    for (const sz of [-0.08, 0.13]) put(cat, G.cone(), toon(0xffa94d), { x: 0.36, y: 0.46, z: sz + 0.02, s: 0.07, sy: 0.12 });
    ball(cat, 0x3a2a1a, 0.46, 0.32, -0.02, 0.022);
    ball(cat, 0x3a2a1a, 0.46, 0.32, 0.12, 0.022);
    const tail = dynamic(group(cat, -0.33, 0.18, 0));
    cylinder(tail, 0xff9a33, -0.2, 0, 0, 0.045, 0.45, { rz: PI / 2 - 0.3 });
    anim.push((t) => { tail.rotation.y = Math.sin(t * 2.2) * 0.5; });

    // vending machine
    const VM = { x: 16.6, z: -6.5 };
    const vm = group(root, VM.x, 0, VM.z, -PI / 2);
    block(vm, 0x4a90e2, 0, 1.4, 0, 1.6, 2.8, 0.9, 0.1);
    const vendTex = canvasTexture(128, 160, (ctx, w, h) => {
      ctx.fillStyle = "#e6f6ff"; ctx.fillRect(0, 0, w, h);
      const cols = ["#ff5a64", "#ffcf5a", "#5cc84a", "#ff8ad8", "#b58cff"];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        ctx.fillStyle = cols[(r * 2 + c) % 5]; roundRect(ctx, 10 + c * 28, 10 + r * 36, 18, 28, 5); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.fillRect(13 + c * 28, 16 + r * 36, 12, 4);
      }
    });
    plane(vm, 1.1, 1.6, basic(vendTex), { x: -0.15, y: 1.85, z: 0.46 });
    block(vm, 0x2f3542, -0.15, 0.55, 0.45, 1.1, 0.3, 0.06, 0.03);
    block(vm, 0xdfe4ea, 0.6, 1.5, 0.46, 0.22, 0.5, 0.04, 0.02);
    ball(vm, glow(0x5cff8a, 0.9), 0.6, 1.9, 0.48, 0.05);

    // washing line with sheets and shirts flapping in the breeze
    const LL = { x1: 7.2, x2: 12.6, z: -7.4 };
    for (const x of [LL.x1, LL.x2]) {
      cylinder(root, 0xd9894a, x, 1.3, LL.z, 0.07, 2.6);
      cylinder(root, 0xd9894a, x, 2.55, LL.z, 0.05, 0.9, { rx: PI / 2 });
    }
    for (const dz of [-0.3, 0.3]) cylinder(root, 0xffffff, (LL.x1 + LL.x2) / 2, 2.5, LL.z + dz, 0.012, LL.x2 - LL.x1, { rz: PI / 2, shadow: false });
    const washing = [];
    const clothes = [[7.9, 0.3, 0x8fd3ff, "sheet"], [9.0, 0.3, 0xff9ec7, "shirt"], [9.9, 0.3, 0xffffff, "sheet"], [11.1, 0.3, 0xffd166, "shirt"], [8.6, -0.3, 0x5cc84a, "shirt"], [10.6, -0.3, 0xb58cff, "sheet"], [11.9, -0.3, 0xff7a59, "shirt"]];
    for (const [x, dz, color, kind] of clothes) {
      // (each piece of washing, pegs and all, is one painted shape: see movingThing)
      const g = movingThing(root, (g) => {
        if (kind === "sheet") block(g, color, 0, -0.6, 0, 0.95, 1.2, 0.03, 0.02);
        else {
          block(g, color, 0, -0.4, 0, 0.6, 0.75, 0.04, 0.03);
          for (const sx of [-1, 1]) block(g, color, sx * 0.4, -0.18, 0, 0.3, 0.25, 0.04, 0.03, { rz: sx * 0.5 });
        }
        block(g, 0xd9894a, -0.25, 0.0, 0, 0.05, 0.12, 0.06, 0.01);
        block(g, 0xd9894a, 0.25, 0.0, 0, 0.05, 0.12, 0.06, 0.01);
      });
      g.position.set(x, 2.5, LL.z + dz);
      washing.push(g);
    }
    anim.push((t) => washing.forEach((g, i) => { g.rotation.x = Math.sin(t * 1.7 + i * 0.9) * 0.16 + 0.08; }));

    // round flower bed with a little cherry tree
    const FB = { x: 0, z: -5.0, r: 1.6 };
    put(root, uvScaled(G.cyl(32), 5.7, 0.37), brickEdge, { x: FB.x, y: 0.22, z: FB.z, sx: FB.r, sy: 0.44, sz: FB.r });
    disc(root, toon(0x8a5a3a), FB.x, 0.45, FB.z, FB.r - 0.12);
    const fl = seeded(7), heads = [], stems = [];
    for (let i = 0; i < 40; i++) {
      const a = fl() * TAU, d = 0.5 + fl() * (FB.r - 0.7);
      const x = FB.x + Math.cos(a) * d, z = FB.z + Math.sin(a) * d;
      stems.push({ x, y: 0.62, z, sx: 0.03, sy: 0.35, sz: 0.03 });
      heads.push({ x, y: 0.82, z, s: 0.13, sy: 0.09, color: [0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff, 0xff8a4c][i % 5] });
    }
    scatter(root, G.cyl(6), toon(0x4f9e35), stems);
    scatter(root, G.sphere(), toon(0xffffff), heads);
    roundTree(group(root, FB.x, 0.45, FB.z), 0, 0, 0.5, [0xff9ec7, 0xffc3dc]);

    // a bench under a tree
    const BN = { x: -5.6, z: 0.6, ry: 0 };
    parkBench(root, BN.x, BN.z, BN.ry);
    bush(root, BN.x, BN.z - 1.25, 0.8, 0x5cc84a, 0xffe25a);

    // sandbox with a sandcastle, bucket and spade
    const SB = { x: -11.0, z: 5.6, w: 3.8, d: 3.2 };
    for (const [x, z, w, d] of [[0, -SB.d / 2, SB.w, 0.25], [0, SB.d / 2, SB.w, 0.25], [-SB.w / 2, 0, 0.25, SB.d], [SB.w / 2, 0, 0.25, SB.d]]) block(root, 0xd9894a, SB.x + x, 0.2, SB.z + z, w, 0.4, d, 0.06);
    block(root, 0xf6dd9a, SB.x, 0.2, SB.z, SB.w - 0.2, 0.3, SB.d - 0.2, 0.05, { shadow: false });
    const castle = group(root, SB.x + 0.3, 0.35, SB.z - 0.2);
    block(castle, 0xe9c77a, 0, 0.25, 0, 1.0, 0.5, 0.8, 0.05);
    for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) {
      cylinder(castle, 0xe9c77a, x, 0.4, z, 0.18, 0.8);
      put(castle, G.cone(), toon(0xe0b868), { x, y: 0.95, z, s: 0.22, sy: 0.3 });
    }
    block(castle, 0xc9a35a, 0, 0.18, 0.41, 0.25, 0.35, 0.04, 0.05);
    put(castle, G.taper(0.2, 0.15), toon(0xff5a64), { x: 1.25, y: 0.2, z: 0.6, sy: 0.35 });
    put(castle, G.torus(0.19, 0.015), toon(0xffcf5a), { x: 1.25, y: 0.4, z: 0.6, rx: PI / 2 - 0.4 });
    block(castle, 0x4a90e2, -1.1, 0.03, 0.7, 0.12, 0.05, 0.6, 0.02, { ry: 0.6 });
    block(castle, 0x4a90e2, -1.25, 0.03, 0.95, 0.25, 0.05, 0.3, 0.03, { ry: 0.6 });

    // a little slide
    const SL = { x: -15.4, z: 1.8 };
    const slide = group(root, SL.x, 0, SL.z);
    for (const sx of [-0.45, 0.45]) {
      block(slide, 0x4a90e2, sx, 1.0, -1.3, 0.1, 2.0, 0.1, 0.04);
      block(slide, 0x4a90e2, sx, 0.8, -0.5, 0.1, 1.6, 0.1, 0.04);
      block(slide, 0xffcf5a, sx * 0.95, 0.58, 0.95, 0.08, 0.2, 3.2, 0.03, { rx: 0.5 });
    }
    for (let k = 0; k < 4; k++) block(slide, 0xffffff, 0, 0.35 + k * 0.42, -1.3, 0.9, 0.06, 0.12, 0.02);
    block(slide, 0xff7a59, 0, 1.62, -0.9, 1.0, 0.12, 0.9, 0.04);
    block(slide, 0xffcf5a, 0, 0.82, 0.85, 0.82, 0.08, 3.1, 0.04, { rx: 0.5 });
    block(slide, 0xffcf5a, 0, 0.1, 2.5, 0.82, 0.08, 0.5, 0.04);

    // BBQ grill with sizzling sausages and smoke
    const BQ = { x: 9.6, z: 1.4 };
    const bbq = group(root, BQ.x, 0, BQ.z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      cylinder(bbq, 0x3a3f4a, Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3, 0.04, 0.95, { rx: Math.sin(a) * 0.25, rz: -Math.cos(a) * 0.25 });
    }
    // the bowl and the open lid are thin half-spheres, so draw both sides of them
    // (otherwise you can see straight through from underneath)
    const grillMat = toon(0x2f3542, { side: THREE.DoubleSide });
    put(bbq, new THREE.SphereGeometry(0.55, 24, 12, 0, TAU, PI / 2, PI / 2), grillMat, { y: 1.05 });
    cylinder(bbq, 0x8f96a3, 0, 1.05, 0, 0.55, 0.02);
    put(bbq, new THREE.SphereGeometry(0.55, 24, 12, 0, TAU, 0, PI / 2), grillMat, { x: 0, y: 1.05, z: -0.55, rx: -1.3 });
    for (let k = 0; k < 3; k++) put(bbq, G.capsule(), toon(0xc0593a), { x: -0.25 + k * 0.25, y: 1.1, z: 0.05, sx: 0.09, sy: 0.25, sz: 0.09, rx: PI / 2 });
    put(bbq, G.capsule(), toon(0x8ad43a), { x: 0.15, y: 1.1, z: 0.3, sx: 0.08, sy: 0.12, sz: 0.08, rz: PI / 2 });
    const smoke = [];
    const smokeMat = [];
    for (let i = 0; i < 5; i++) {
      const m = toon(0xf2f2f2, { transparent: true, opacity: 0.5 });
      smokeMat.push(m);
      smoke.push(dynamic(ball(root, m, BQ.x, 1.3, BQ.z, 0.2, { shadow: false })));
    }
    anim.push((t) => smoke.forEach((s, i) => {
      const k = (t * 0.4 + i / smoke.length) % 1;
      s.position.set(BQ.x + Math.sin(t + i * 2) * 0.15 + k * 0.4, 1.3 + k * 2.2, BQ.z + 0.05);
      s.scale.setScalar(0.15 + k * 0.35);
      smokeMat[i].opacity = 0.5 * (1 - k);
    }));

    // picnic table
    const PT = { x: 13.2, z: 2.2 };
    const pt = group(root, PT.x, 0, PT.z);
    const ptWood = toon(0xc98b4a);
    block(pt, ptWood, 0, 0.8, 0, 2.4, 0.1, 0.95, 0.04);
    for (const sz of [-0.8, 0.8]) block(pt, ptWood, 0, 0.48, sz, 2.4, 0.08, 0.38, 0.03);
    for (const sx of [-0.95, 0.95]) {
      block(pt, ptWood, sx, 0.4, 0, 0.1, 0.8, 0.1, 0.02);
      block(pt, ptWood, sx, 0.4, 0, 0.1, 0.08, 1.9, 0.02);
    }
    ball(pt, 0xff5a64, -0.4, 0.92, 0.1, 0.11);
    block(pt, 0xf5d48e, 0.3, 0.9, -0.1, 0.4, 0.1, 0.3, 0.04);
    cylinder(pt, 0xffffff, 0.75, 0.97, 0.15, 0.08, 0.25);

    // bike rack with three bikes
    const BR = { x: 16.3, z: 6.6 };
    for (let i = 0; i < 3; i++) {
      const bz = BR.z - 1.1 + i * 1.1;
      put(root, G.torus(0.35, 0.04), toon(0x8f96a3), { x: BR.x + 0.25, y: 0.35, z: bz - 0.2, ry: PI / 2 });
      const bk = group(root, BR.x, 0, bz, -PI / 2 + (i - 1) * 0.06);
      const col = [0xff5a64, 0x4a90e2, 0x5cc84a][i];
      for (const sx of [-0.55, 0.55]) put(bk, G.torus(0.32, 0.045), toon(0x2f3542), { x: sx, y: 0.36 });
      cylinder(bk, col, 0, 0.6, 0, 0.04, 1.0, { rz: PI / 2 });
      cylinder(bk, col, -0.2, 0.5, 0, 0.035, 0.55, { rz: 0.9 });
      cylinder(bk, col, 0.4, 0.55, 0, 0.035, 0.5, { rz: -0.4 });
      block(bk, 0x2f3542, -0.25, 0.85, 0, 0.32, 0.07, 0.14, 0.03);
      cylinder(bk, 0x2f3542, 0.5, 0.88, 0, 0.025, 0.55, { rx: PI / 2 });
      if (i === 1) block(bk, 0xc98b4a, 0.62, 0.72, 0, 0.3, 0.22, 0.3, 0.04); // a basket on the front
    }

    // koi pond with a stone lantern
    const KP = { x: 4.6, z: 5.6, rx: 2.8, rz: 1.7 };
    disc(root, toon(0x5aa646), KP.x, 0.02, KP.z, 1, { sx: KP.rx + 0.35, sy: KP.rz + 0.35 });
    const pondWater = disc(root, toon(0x4fb8e8), KP.x, 0.05, KP.z, 1, { sx: KP.rx, sy: KP.rz });
    pondWater.receiveShadow = true;
    const rim = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      rim.push({ x: KP.x + Math.cos(a) * (KP.rx + 0.2), y: 0.1, z: KP.z + Math.sin(a) * (KP.rz + 0.2), s: 0.3 + ((i * 7) % 5) * 0.04, sy: 0.2, ry: i, color: i % 2 ? 0xc9c4b8 : 0xb3ada0 });
    }
    scatter(root, G.lowSphere(), toon(0xffffff), rim, true);
    for (const [lx, lz, f] of [[3.0, 5.2, true], [6.1, 6.2, false], [5.5, 4.6, true]]) {
      disc(root, toon(0x4fae3f), lx, 0.08, lz, 0.32);
      if (f) ball(root, 0xff9ec7, lx, 0.14, lz, 0.12, { sy: 0.6 });
    }
    const lantern = group(root, KP.x + KP.rx + 1.0, 0, KP.z - 1.2);
    block(lantern, 0xbdb6a8, 0, 0.3, 0, 0.5, 0.6, 0.5, 0.06);
    cylinder(lantern, 0xbdb6a8, 0, 0.8, 0, 0.12, 0.5);
    block(lantern, 0xbdb6a8, 0, 1.2, 0, 0.55, 0.4, 0.55, 0.06);
    ball(lantern, glow(0xffe8a0, 0.6), 0, 1.2, 0.2, 0.12);
    put(lantern, G.cone(4), toon(0xa8a092), { y: 1.6, s: 0.55, sy: 0.4, ry: PI / 4 });
    const koi = [];
    for (let i = 0; i < 4; i++) {
      const c = [0xff7a2a, 0xffffff, 0xffb02e, 0xff5a3a][i];
      const f = movingThing(root, (f) => {
        ball(f, c, 0, 0, 0, 0.22, { sx: 1.0, sy: 0.25, sz: 0.45 });
        if (i !== 2) ball(f, i === 1 ? 0xff5a3a : 0xffffff, 0.05, 0.03, 0, 0.1, { sy: 0.3 });
        put(f, G.cone(4), toon(c), { x: -0.27, s: 0.12, sy: 0.18, rz: PI / 2, sz: 0.05 });
      });
      koi.push(f);
    }
    anim.push((t) => koi.forEach((f, i) => {
      const a = t * (0.35 + i * 0.07) * (i % 2 ? -1 : 1) + i * 1.6;
      const rx = (KP.rx - 0.7) * (0.6 + 0.3 * Math.sin(i + t * 0.2)), rz = (KP.rz - 0.5) * (0.6 + 0.3 * Math.cos(i * 2 + t * 0.17));
      f.position.set(KP.x + Math.cos(a) * rx, 0.07, KP.z + Math.sin(a) * rz);
      const dir = i % 2 ? -1 : 1;
      const vx = -Math.sin(a) * rx * dir, vz = Math.cos(a) * rz * dir;
      f.rotation.y = -Math.atan2(vz, vx) + Math.sin(t * 6 + i) * 0.15;
    }));
    const koiRare = goldenKoi(root, KP); // (very rarely, a golden one)

    // trees, bushes and lamps around the courtyard
    const trees = [[-16.0, -2.4, 1.0, [0x5cc84a, 0x7fdc5c], null], [15.9, -2.6, 1.0, [0x4fbf47, 0x79d65a], 0xff4b3a],
      [-16.0, 9.3, 0.9, [0x5cc84a, 0x8ae065], null], [16.3, 9.6, 0.85, [0xff9ec7, 0xffc3dc], null],
    ];
    // low flowering bushes along the front (so they don't hide the courtyard)
    const bushes = [[-7.2, 9.4, 0xff6fa5], [-4.2, 9.5, 0xffe25a], [7.6, 9.4, 0xffffff], [11.0, 9.5, 0xff6fa5]];
    bushes.forEach(([x, z, f]) => bush(root, x, z, 0.85, 0x4fbf47, f));
    trees.forEach(([x, z, s, c, fruit]) => roundTree(root, x, z, s, c, fruit));
    const lampsAt = [[-5.0, -4.6], [5.0, -4.6], [-12.4, -1.2], [12.0, -1.2]];
    lampsAt.forEach(([x, z]) => lampPost(root, x, z));

    // hedge all around with a gate at the front
    const hedgeMat = toon(0x4fae3f);
    const hedge = (x, z, w, d) => {
      block(root, hedgeMat, x, 0.5, z, w, 1.0, d, 0.35);
      for (let k = 0; k < Math.max(w, d) / 1.2; k++) {
        const t = (k + 0.5) / (Math.max(w, d) / 1.2);
        put(root, G.lowSphere(), toon(0x5cbe48), { x: w > d ? x - w / 2 + t * w : x, y: 1.0, z: w > d ? z : z - d / 2 + t * d, s: 0.42, sy: 0.6 });
      }
    };
    hedge(-9.9, 10.9, 16.2, 0.8); hedge(9.9, 10.9, 16.2, 0.8);
    // wooden planters with little round trees, either side of the way in
    const planters = [-2.65, 2.65].map((x) => ({ x, z: 9.75, w: 0.8 }));
    for (const P of planters) {
      block(root, detailMat("wood", 0xa86b3c), P.x, 0.35, P.z, P.w, 0.7, P.w, 0.08);
      block(root, 0x6b4a2a, P.x, 0.68, P.z, P.w - 0.14, 0.05, P.w - 0.14, 0.02, { shadow: false });
      cylinder(root, 0x9a6a3c, P.x, 1.1, P.z, 0.06, 0.9);
      ball(root, 0x5cc84a, P.x, 1.75, P.z, 0.55);
      ball(root, 0x7fdc5c, P.x + 0.18, 1.98, P.z + 0.2, 0.3);
    }
    hedge(-18.2, -0.3, 0.8, 22.4); hedge(18.2, -0.3, 0.8, 22.4);
    // the gate: two brick pillars with lamps on top where the hedge opens up
    for (const sx of [-1.75, 1.75]) {
      put(root, uvScaled(G.rbox(0.7, 1.3, 0.7, 0.08), 0.4, 1.1), brickEdge, { x: sx, y: 0.65, z: 10.9 });
      block(root, 0xf0c9a4, sx, 1.36, 10.9, 0.84, 0.14, 0.84, 0.05);
      cylinder(root, 0x2f4f46, sx, 1.55, 10.9, 0.06, 0.3);
      ball(root, kit.sharedGlow ? kit.sharedGlow(0xfff1b8, 0.9) : glow(0xfff1b8, 0.9), sx, 1.85, 10.9, 0.22);
      put(root, G.cone(), toon(0x2f4f46), { x: sx, y: 2.1, z: 10.9, s: 0.26, sy: 0.18 });
    }

    // soft shadows on the paving and grass under things (see blobShadows)
    blobShadows(root, [
      ...trees.map(([x, z, s]) => ({ x, z, r: 1.9 * s })),
      ...bushes.map(([x, z]) => ({ x, z, r: 1.05, sz: 0.8 })), { x: BN.x, z: BN.z - 1.25, r: 1.0, sz: 0.75 },
      ...lampsAt.map(([x, z]) => ({ x, z, r: 0.45 })), ...planters.map((P) => ({ x: P.x, z: P.z, r: 0.75 })),
      { x: BN.x, z: BN.z, r: 1.45, sz: 0.65, ry: BN.ry }, { x: MB.x, z: MB.z, r: 0.6, sz: 1.5 }, { x: VM.x, z: VM.z, r: 0.75, sz: 1.1 },
      { x: BQ.x, z: BQ.z, r: 0.75 }, { x: PT.x, z: PT.z, r: 1.6, sz: 1.25 }, { x: BR.x, z: BR.z, r: 0.9, sz: 2.0 },
      { x: SL.x, z: SL.z + 0.5, r: 0.8, sz: 2.2 }, { x: FB.x, z: FB.z, r: FB.r + 0.4 }, { x: KP.x + KP.rx + 1.0, z: KP.z - 1.2, r: 0.45 },
      { x: LL.x1, z: LL.z, r: 0.35 }, { x: LL.x2, z: LL.z, r: 0.35 }, { x: 1.75, z: 10.9, r: 0.55 }, { x: -1.75, z: 10.9, r: 0.55 },
      ...units.filter((u) => u.f === 0).map((u) => ({ x: u.winX, z: FZ + 0.55, r: 1.7, sz: 0.45 })),
    ], 0.22);

    // ---------- outside the courtyard: the street, houses, hills ----------
    // pavement, road with a zebra crossing, and the far pavement
    block(root, 0xd8d4cc, 0, 0.06, 12.4, 300, 0.12, 1.8, 0.02, { shadow: false });
    block(root, 0x6b6f78, 0, 0.02, 16.0, 300, 0.04, 5.4, 0.01, { shadow: false });
    block(root, 0xd8d4cc, 0, 0.06, 19.6, 300, 0.12, 1.8, 0.02, { shadow: false });
    const dashes = [];
    for (let x = -150; x < 150; x += 3) if (Math.abs(x) > 3) dashes.push({ x, y: 0.05, z: 16, sx: 1.6, sy: 0.02, sz: 0.14 });
    for (let k = 0; k < 7; k++) dashes.push({ x: -2.4 + k * 0.8, y: 0.05, z: 16, sx: 0.45, sy: 0.02, sz: 5.0 });
    scatter(root, G.box(), toon(0xfdfdf5), dashes);
    for (let x = -36; x <= 36; x += 12) lampPost(root, x, 19.1);

    // houses across the street and to the sides
    const houseCols = [[0xfff1dc, 0xe2574c], [0xdff3ff, 0x4a90e2], [0xffe0ec, 0xb58cff], [0xeaffd9, 0xff8a4c], [0xfff6c2, 0x3fb39a]];
    let hc = 0;
    for (let x = -44; x <= 44; x += 11) {
      const [wall, roof] = houseCols[hc++ % houseCols.length];
      house(root, x, 25.5, PI, { w: 5, d: 4.2, h: 2.8, rh: 2.0, wall, roof, door: [0x9a6a3c, 0x4a90e2, 0xff7a8a][hc % 3] });
      farTree(root, x + 5.5, 22.5, 0.8, hc % 2 ? [0x5cc84a, 0x7fdc5c] : [0x4fbf47, 0x8ae065]);
      bush(root, x - 2.5, 22.6, 0.8, 0x4fbf47, [0xff6fa5, 0xffe25a, null][hc % 3]);
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const [wall, roof] = houseCols[(k + (side > 0 ? 2 : 0)) % houseCols.length];
        house(root, side * (25 + (k % 2) * 3), -6 + k * 8, -side * PI / 2, { w: 4.6, d: 4.0, h: 2.6, rh: 1.8, wall, roof });
        farTree(root, side * 21.5, -9 + k * 8, 0.9 + (k % 2) * 0.15, k % 2 ? [0x5cc84a, 0x7fdc5c] : [0x4fbf47, 0x79d65a]);
      }
      farTree(root, side * 33, 14, 1.1);
    }
    // behind the building: a garden, trees and taller blocks in town
    for (let x = -30; x <= 30; x += 6) farTree(root, x + ((x / 6) % 2) * 1.5, -21.5 - Math.abs(x % 4), 1.0 + (Math.abs(x) % 3) * 0.1, Math.abs(x) % 12 ? [0x5cc84a, 0x7fdc5c] : [0xff9ec7, 0xffc3dc]);
    const blockTex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      for (let y = 12; y < h - 10; y += 30) for (let x = 12; x < w - 10; x += 28) {
        ctx.fillStyle = (x * 7 + y * 3) % 5 === 0 ? "#ffe9a8" : "#a9d4f2"; ctx.fillRect(x, y, 16, 18);
      }
    });
    const blockMat = toon(0xffffff, { map: blockTex });
    const tall = [[-40, -38, 8, 18, 0xffd8c2], [-26, -42, 7, 24, 0xd9ecff], [-12, -46, 9, 20, 0xffeab8], [6, -44, 8, 28, 0xe6dcff], [22, -40, 9, 19, 0xd6f5e3], [38, -36, 7, 22, 0xffd6e6], [52, -20, 8, 16, 0xd9ecff], [-54, -18, 8, 17, 0xffeab8]];
    for (const [x, z, w, h, c] of tall) {
      const m = blockMat.clone(); m.color.set(c);
      put(root, G.box(), m, { x, y: h / 2, z, sx: w, sy: h, sz: w * 0.8 });
      block(root, 0xffffff, x, h + 0.2, z, w + 0.4, 0.4, w * 0.8 + 0.4, 0.1);
    }
    // soft hills all the way round
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.2;
      const r = 95 + (i % 3) * 12;
      const s = 28 + ((i * 7) % 5) * 6;
      put(root, G.lowSphere(), toon(i % 2 ? 0x7fcf5a : 0x6cc24a), { x: Math.cos(a) * r, y: -s * 0.45, z: Math.sin(a) * r, sx: s, sy: s * 0.75, sz: s * 0.7, shadow: false, receive: false });
    }

    // cars driving up and down the street (they face along +x)
    const cars = [];
    const carCols = [0xff5a64, 0x4a90e2, 0xffcf3a];
    for (let i = 0; i < 3; i++) {
      const c = movingThing(root, (c) => {
        block(c, carCols[i], 0, 0.6, 0, 3.0, 0.7, 1.5, 0.3);
        block(c, 0xffffff, -0.2, 1.15, 0, 1.6, 0.6, 1.3, 0.25);
        block(c, 0xa9dcff, -0.2, 1.17, 0, 1.4, 0.4, 1.34, 0.12);
        block(c, 0xa9dcff, 0.25, 1.17, 0, 0.6, 0.4, 1.34, 0.12);
        for (const [x, z] of [[-0.9, 0.7], [0.9, 0.7], [-0.9, -0.7], [0.9, -0.7]]) {
          cylinder(c, 0x2f3542, x, 0.33, z, 0.33, 0.25, { rx: PI / 2 });
          cylinder(c, 0xdfe4ea, x, 0.33, z * 1.1, 0.14, 0.1, { rx: PI / 2 });
        }
        ball(c, glow(0xfff4c2, 0.8), 1.5, 0.65, 0.45, 0.11);
        ball(c, glow(0xfff4c2, 0.8), 1.5, 0.65, -0.45, 0.11);
        ball(c, glow(0xff3b3b, 0.6), -1.5, 0.65, 0.5, 0.08);
        ball(c, glow(0xff3b3b, 0.6), -1.5, 0.65, -0.5, 0.08);
      });
      cars.push({ c, dir: i === 1 ? -1 : 1, speed: 5 + i * 1.3, off: i * 47 });
    }
    anim.push((t) => cars.forEach((q) => {
      // drive along the road, then pause off-screen before coming round again
      const L = 220;
      const k = ((t * q.speed + q.off) % L) - L / 2;
      q.c.position.set(k * q.dir, Math.abs(Math.sin(t * 9 + q.off)) * 0.03, q.dir > 0 ? 17.4 : 14.6);
      q.c.rotation.y = q.dir > 0 ? 0 : PI;
    }));

    // clouds drifting across the sky
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25 });
    const clouds = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      clouds.push({ c: cloud(root, cloudMat, 0, 20 + (i % 3) * 4, 0, 1 + (i % 2) * 0.3), a, r: 55 + (i % 3) * 15 });
    }
    anim.push((t) => clouds.forEach((q) => {
      const a = q.a + t * 0.006;
      q.c.position.x = Math.cos(a) * q.r;
      q.c.position.z = Math.sin(a) * q.r;
    }));

    mergeStatic(root);

    // ---------- residents ----------
    // list = [{ id, name, home, items, activity }]
    //   items     the Mii's furniture ({ slot: itemId }, like record.home.items)
    //   activity  null, or what it's doing at home: { itemId, slot, activity, sit, lie, run, arms, lookUp }
    // This is called often, so a flat's room is only rebuilt when what's in it changes.
    let residents = [];
    function setResidents(list) {
      residents = Array.isArray(list) ? list.slice(0, units.length) : [];
      let lampsDirty = false;
      units.forEach((u, i) => {
        const r = residents[i] || null;
        u.resident = r;
        const plateKey = r ? r.id + "|" + r.name : "";
        if (plateKey !== u.plateKey) {
          u.plateKey = plateKey;
          drawPlate(u, r);
          placeRentSign(u, !r);
        }
        const home = !!(r && r.home);
        if (home !== u.home) {
          u.home = home;
          u.open = home ? 1 : 0;
          lamps.setColorAt(i, home ? lampOn : lampOff);
          lampsDirty = true;
        }
        if (home) {
          const key = flatKey(r);
          if (key !== u.builtKey) { u.builtKey = key; furnish(u, r); }
        }
      });
      if (lampsDirty) lamps.instanceColor.needsUpdate = true;
    }

    // Fills a flat's little room: wallpaper, floor, a ceiling light, and the
    // furniture the Mii is using right now (plus a couple of its other things).
    function furnish(u, r) {
      const items = resolveItems({ home: { items: r.items || {} } });
      if (!u.shell) u.shell = flatShell(u.room);
      u.shell.walls.material = flatMaterial(items.wallpaper, false);
      u.shell.floor.material = flatMaterial(items.floor, true);
      if (u.contents) { u.room.remove(u.contents); disposeFlat(u.contents); }
      u.anim = [];
      const f = flatContents(items, r.activity || null, r.name, u.anim, r.record);
      u.contents = f.group;
      u.spot = f.spot;
      u.room.add(u.contents);
    }

    const indexOf = (id) => residents.findIndex((r) => r && r.id === id);

    // Where the hub should put this Mii so you can see it through its window,
    // doing what it's doing (feet position in world coordinates), or null if it's out.
    //   { x, y, z, yaw, pose: "stand" | "sit" | "lie" | "run", arms, lookUp }
    //   sit: (x, y, z) = the seat point (y = seat height - 0.56, like the home spots)
    //   lie: (x, z) = the middle of the mattress, y = its top, yaw = from feet to head
    //   otherwise yaw = the way the Mii faces (0 = towards the courtyard)
    function windowSpot(id) {
      const i = indexOf(id);
      if (i < 0) return null;
      const u = units[i];
      if (!u.home || !u.spot) return null;
      const s = u.spot;
      return { x: u.winX + s.x, y: u.y + s.y, z: roomZ + s.z, yaw: s.yaw, pose: s.pose, arms: s.arms, lookUp: s.lookUp, legs: s.legs };
    }

    // The courtyard spot in front of someone's door. Upper floors are reached by
    // the lift (left) or the stairs (right), so they head for that door.
    function doorFor(id) {
      const i = indexOf(id);
      if (i < 0) return null;
      const u = units[i];
      if (u.f === 0) return { x: u.doorX, z: FZ + 1.3 };
      const side = u.c < 2 ? -1 : 1;
      const k = ((u.f - 1) * 2 + (u.c % 2)) % 4; // 0..3, so they don't all stand on one spot
      return { x: side * TX + (k - 1.5) * 0.55, z: FZ + 1.4 };
    }

    // Which apartment (door / window / name plate) does this ray point at?
    const box = new THREE.Box3(), hit = new THREE.Vector3();
    function pickApartment(ray) {
      let best = null, bestD = Infinity;
      units.forEach((u, i) => {
        const r = residents[i];
        if (!r) return;
        box.min.set(u.cx - APT.unitW / 2 + 0.1, u.y, FZ - 0.3);
        box.max.set(u.cx + APT.unitW / 2 - 0.1, u.y + H, FZ + 1.5);
        if (ray.intersectBox(box, hit)) {
          const d = hit.distanceTo(ray.origin);
          if (d < bestD) { bestD = d; best = r.id; }
        }
      });
      return best;
    }

    setResidents([]);

    // curtains slide open when the Mii comes home (and shut when it goes out);
    // the room behind is only drawn while you can see into it
    function updateWindows(dt, t) {
      let moved = false;
      for (const u of units) {
        if (u.openNow < 0) { u.openNow = u.open; placeCurtains(u); moved = true; }
        if (Math.abs(u.open - u.openNow) > 0.002) {
          u.openNow += (u.open - u.openNow) * Math.min(1, dt * 3);
          if (Math.abs(u.open - u.openNow) <= 0.002) u.openNow = u.open;
          placeCurtains(u);
          moved = true;
        }
        u.room.visible = !!u.contents && u.openNow > 0.01;
        if (u.room.visible) for (const a of u.anim) a(t);
      }
      return moved;
    }

    let lastT = null;
    const benchFx = Math.sin(BN.ry), benchFz = Math.cos(BN.ry);

    return {
      group: root,
      background: 0xcdeeff,
      fog: [0xd8f2ff, 70, 190],
      rare: koiRare,
      cameraTilt: 0.42,
      cameraTargetY: 3.4 + (FL - 3) * 0.5,
      capacity: N, // how many apartments there are
      bounds: { minX: -17, maxX: 17, minZ: -11, maxZ: 10 },
      water: [{ x: KP.x, z: KP.z, rx: KP.rx, rz: KP.rz }],
      obstacles: [
        { x: 0, z: (FZ + APT.back) / 2 + 0.1, w: 2 * TX + 3.8, d: FZ - APT.back + 0.4 }, // the building
        ...pillarXs.map((x) => ({ x, z: FZ + 1.3, r: 0.2 })),
        { x: MB.x, z: MB.z, w: 0.75, d: 2.7 },                       // mailboxes
        { x: VM.x, z: VM.z, w: 1.0, d: 1.7 },                        // vending machine
        { x: (LL.x1 + LL.x2) / 2, z: LL.z, w: LL.x2 - LL.x1 + 0.3, d: 1.1 }, // washing line
        { x: FB.x, z: FB.z, r: FB.r + 0.1 },                         // flower bed
        { x: BN.x, z: BN.z - 0.05, w: 2.5, d: 1.0 },                 // bench
        { x: SB.x, z: SB.z, w: SB.w, d: SB.d },                      // sandbox
        { x: SL.x, z: SL.z + 0.55, w: 1.2, d: 4.2 },                 // slide
        { x: BQ.x, z: BQ.z, r: 0.65 },                               // BBQ
        { x: PT.x, z: PT.z, w: 2.5, d: 2.1 },                        // picnic table
        { x: BR.x + 0.1, z: BR.z, w: 1.5, d: 3.4 },                  // bikes
        { x: KP.x, z: KP.z, rx: KP.rx + 0.3, rz: KP.rz + 0.3 },      // koi pond
        { x: KP.x + KP.rx + 1.0, z: KP.z - 1.2, r: 0.4 },            // stone lantern
        { x: 1.75, z: 10.9, r: 0.45 }, { x: -1.75, z: 10.9, r: 0.45 }, // gate pillars
        ...planters.map((P) => ({ x: P.x, z: P.z, w: P.w, d: P.w })),   // planters by the gate
        ...units.filter((u) => u.f === 0).map((u) => ({ x: u.winX, z: FZ + 0.4, w: WIN.w + 0.3, d: 0.7 })), // flower boxes
      ].concat(trees.map(([x, z, s]) => ({ x, z, r: 0.55 * s })))
        .concat(lampsAt.map(([x, z]) => ({ x, z, r: 0.25 })))
        .concat(bushes.map(([x, z]) => ({ x, z, r: 0.9 })))
        .concat([{ x: BN.x, z: BN.z - 1.25, r: 0.9 }]),
      spots: [
        { x: MB.x + 1.4, z: MB.z, yaw: -PI / 2, emoji: "📬", activity: "checking the mail",
          lines: ["Any letters for me?", "Ooh, a postcard!", "Just bills again...", "Hi, kitty!"] },
        { x: BN.x + benchFx * 1.2, z: BN.z + benchFz * 1.2, yaw: BN.ry, emoji: "🪑", activity: "sitting on the bench",
          seat: { x: BN.x + benchFx * 0.08, z: BN.z + benchFz * 0.08, y: 0 },
          lines: ["Nice and shady here.", "I love this courtyard.", "*people watching*"] },
        { x: SB.x, z: SB.z + SB.d / 2 + 0.9, yaw: PI, emoji: "🏰", activity: "building a sandcastle",
          lines: ["My castle needs a moat!", "Sand everywhere!", "King of the sandbox!"] },
        { x: SL.x, z: SL.z + 3.25, yaw: 0, arms: "cheer", emoji: "🛝", activity: "playing on the slide",
          lines: ["Wheee!", "One more time!", "I'm too big for this... again!"] },
        // stand on the open side (the lid is propped up at the back, towards the building)
        { x: BQ.x, z: BQ.z + 1.35, yaw: PI, arms: "type", emoji: "🍖", activity: "grilling at the BBQ",
          lines: ["Who wants a sausage?", "*sizzle sizzle*", "Smells amazing!", "Medium or well done?"] },
        { x: PT.x, z: PT.z - 1.95, yaw: 0, arms: "eat", emoji: "🍙", activity: "having a snack",
          seat: { x: PT.x, z: PT.z - 0.8, y: -0.06 },
          lines: ["Snack time!", "Mmm, rice ball!", "Lunch in the sun!"] },
        { x: (LL.x1 + LL.x2) / 2, z: LL.z + 1.15, yaw: PI, arms: "up", emoji: "👕", activity: "hanging up the laundry",
          lines: ["Perfect drying weather!", "Whose socks are these?", "Fresh and clean!"] },
        { x: VM.x - 1.4, z: VM.z, yaw: PI / 2, emoji: "🥤", activity: "at the vending machine",
          lines: ["Melon soda, please!", "It ate my coin!", "So many choices!"] },
        { x: FB.x, z: FB.z + FB.r + 0.75, yaw: PI, emoji: "🌷", activity: "smelling the flowers",
          lines: ["Mmm, lovely!", "Achoo!", "Who planted these? So pretty!"] },
        { x: BR.x - 1.55, z: BR.z, yaw: PI / 2, emoji: "🚲", activity: "checking their bike",
          lines: ["Time for a ride?", "Flat tire again...", "Ding ding!"] },
        { x: KP.x, z: KP.z + KP.rz + 0.85, yaw: PI, emoji: "🐟", activity: "feeding the koi",
          lines: ["Here, fishy fishy!", "That one's so big!", "Blub blub!"] },
      ],
      lines: [
        "Home sweet home!", "I love living here!", "Hi, neighbor!", "Who's cooking? Smells great!",
        "Did you get your mail?", "Nice weather for laundry!", "The koi look hungry.", "I should water my plants.",
        "Let's have a BBQ!", "My apartment is the best one!",
      ],
      setResidents,
      doorFor,
      pickApartment,
      windowSpot,
      update(t, camera) {
        const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
        lastT = t;
        anim.forEach((a) => a(t));
        updateWindows(dt, t);
      },
    };
  }

  // =====================================================================
  // HOME — the inside of one Mii's apartment
  // =====================================================================

  const ROOM = { x: 6, z: 4.5, h: 5.2 };
  const TILE = 2; // one wallpaper / floor picture covers 2 x 2 units

  // ---------- fine detail (only inside a Mii's home) ----------
  // Furniture is also built, small, in the little rooms seen through the apartment
  // windows (flatContents). Those stay plain and light: FINE is only switched on
  // while a home is being built, and the extra touches below check it.
  let FINE = false;

  // Soft surface pictures, multiplied by a part's color: wood grain, woven cloth,
  // padded cushions (a stitched seam round each face), brushed metal, and pleats
  // for curtains. Each is drawn once and shared; each (picture, color) pair is one
  // material shared by every piece, so parts still merge into a few draw calls.
  // (They're mostly white, so the colors stay as bright as before.)
  const SURF = {
    wood(c, w, h) {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
      const r = seeded(41);
      // long grain lines, drawn twice (one tile apart) so they wrap round
      for (let i = 0; i < 34; i++) {
        const y = r() * h, a = 1.5 + r() * 3.5, ph = r() * TAU, k = 1 + Math.floor(r() * 2);
        c.strokeStyle = "rgba(110,64,30," + (0.05 + r() * 0.08).toFixed(3) + ")"; c.lineWidth = 0.6 + r() * 1.2;
        for (const dy of [-h, 0, h]) {
          c.beginPath();
          for (let x = 0; x <= w; x += 4) { const yy = y + dy + Math.sin((x / w) * TAU * k + ph) * a; if (x) c.lineTo(x, yy); else c.moveTo(x, yy); }
          c.stroke();
        }
      }
      // one little knot
      for (let k = 2; k >= 1; k--) { c.strokeStyle = "rgba(110,64,30,0.1)"; c.lineWidth = 1; c.beginPath(); c.ellipse(w * 0.7, h * 0.62, k * 4, k * 1.5, 0, 0, TAU); c.stroke(); }
      c.fillStyle = "rgba(110,64,30,0.14)"; c.beginPath(); c.ellipse(w * 0.7, h * 0.62, 2.5, 1, 0, 0, TAU); c.fill();
    },
    fabric(c, w, h) {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
      // a soft basket weave
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
        c.fillStyle = ((x + y) / 4) % 2 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.0)";
        c.fillRect(x, y, 4, 4);
      }
      const r = seeded(5);
      for (let i = 0; i < 180; i++) { c.fillStyle = "rgba(0,0,0," + (0.03 + r() * 0.04).toFixed(3) + ")"; c.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    },
    cushion(c, w, h) {
      SURF.fabric(c, w, h);
      // darker toward the edges (a padded, puffy look) and a stitched seam
      const e = 14;
      for (const [x, y, gw, gh, x0, y0, x1, y1] of [[0, 0, w, e, 0, 0, 0, e], [0, h - e, w, e, 0, h, 0, h - e], [0, 0, e, h, 0, 0, e, 0], [w - e, 0, e, h, w, 0, w - e, 0]]) {
        const gr = c.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, "rgba(40,20,10,0.16)"); gr.addColorStop(1, "rgba(40,20,10,0)");
        c.fillStyle = gr; c.fillRect(x, y, gw, gh);
      }
      c.strokeStyle = "rgba(40,20,10,0.28)"; c.lineWidth = 1.6; c.setLineDash([5, 4]);
      c.strokeRect(9, 9, w - 18, h - 18);
      c.setLineDash([]);
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1; c.strokeRect(11, 11, w - 22, h - 22);
    },
    metal(c, w, h) {
      // brushed: fine streaks, with a bright band and a soft dark band (round a pole, a shine)
      const gr = c.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, "#d4d4d4"); gr.addColorStop(0.18, "#ffffff"); gr.addColorStop(0.26, "#f2f2f2");
      gr.addColorStop(0.55, "#c4c4c4"); gr.addColorStop(0.8, "#e8e8e8"); gr.addColorStop(1, "#d4d4d4");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      const r = seeded(8);
      for (let i = 0; i < 50; i++) { c.fillStyle = "rgba(255,255,255," + (0.1 + r() * 0.2).toFixed(3) + ")"; c.fillRect(r() * w, 0, 1, h); }
    },
    pleat(c, w, h) {
      // soft vertical folds
      const gr = c.createLinearGradient(0, 0, w, 0);
      for (let k = 0; k <= 4; k++) { gr.addColorStop(k / 4, "#ffffff"); if (k < 4) gr.addColorStop(k / 4 + 0.125, "#d8d8d8"); }
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      SURF.fabricNoise(c, w, h);
    },
    fabricNoise(c, w, h) {
      const r = seeded(9);
      for (let i = 0; i < 120; i++) { c.fillStyle = "rgba(0,0,0,0.04)"; c.fillRect(r() * w, r() * h, 1, 2 + r() * 3); }
    },
  };
  const surfTex = {}, surfMats = new Map();
  function surface(kind) {
    if (!surfTex[kind]) surfTex[kind] = canvasTexture(128, 128, SURF[kind], [1, 1]);
    return surfTex[kind];
  }
  // A material with a surface picture (plain color outside a home: see FINE).
  // (paintRoom later swaps it for one material per picture, with the color kept
  // in the shape, so wood of every color is drawn in one go.)
  function fine(kind, color) {
    if (!FINE) return toon(color);
    const key = kind + ":" + color;
    if (!surfMats.has(key)) {
      const m = toon(color, { map: surface(kind) });
      m.userData.keep = true;
      m.userData.surface = kind;
      surfMats.set(key, m);
    }
    return surfMats.get(key);
  }
  const kindMats = {};
  function kindMat(kind) {
    if (!kindMats[kind]) {
      kindMats[kind] = toon(0xffffff, { map: surface(kind), vertexColors: true });
      kindMats[kind].userData.keep = true;
    }
    return kindMats[kind];
  }

  // Gives every plain-colored part under g (but not the moving ones) the shared
  // "colors in the shape" material (and parts with a surface picture the shared one
  // for that picture), so mergeStatic joins a whole room into a handful of draw
  // calls instead of one per color. It looks exactly the same.
  function paintRoom(g) {
    if (W3D.debug && W3D.debug.noMerge) return;
    const skip = new Set();
    g.traverse((o) => { if (o !== g && o.userData.dynamic) o.traverse((c) => skip.add(c)); });
    g.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || skip.has(o)) return;
      const m = o.material;
      if (Array.isArray(m) || !m.isMeshToonMaterial || m.vertexColors || m.transparent || m.alphaTest || m.side !== THREE.FrontSide || (m.emissive && m.emissive.getHex())) return;
      const kind = m.userData.surface;
      if (m.map && !kind) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = m.color.r; col[i * 3 + 1] = m.color.g; col[i * 3 + 2] = m.color.b; }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      o.geometry = geo;
      o.material = kind ? kindMat(kind) : W3D.kit.paintedMat;
    });
  }
  const woody = (c) => fine("wood", c), cloth = (c) => fine("fabric", c), padded = (c) => fine("cushion", c), shiny = (c) => fine("metal", c);

  // Lots of little colored bits (books, buttons, stitches...) as ONE painted shape
  // that keeps their colors: every painted bit in a room is drawn in one go.
  // build(p) adds the parts to p with the usual helpers. Only inside a home.
  // Small balls and rings for those bits (much lighter than ball and G.torus).
  function bead(p, color, x, y, z, r, o) {
    return put(p, r > 0.06 ? G.lowSphere() : G.tinySphere(), typeof color === "object" ? color : toon(color), Object.assign({ x, y, z, s: r }, o));
  }
  const lowTori = new Map();
  function lowTorus(r, tube) {
    const k = r + "," + tube;
    if (!lowTori.has(k)) lowTori.set(k, new THREE.TorusGeometry(r, tube, 6, 18));
    return lowTori.get(k);
  }
  // A plain box for those bits (a rounded block has ~50 times the triangles).
  function slab(p, color, x, y, z, w, h, d, r, o) { return bx(p, color, x, y, z, w, h, d, o); }
  function bits(g, build, o) {
    if (!FINE) return null;
    const geo = W3D.kit.bakeGeo(build);
    if (!geo) return null;
    return put(g, geo, W3D.kit.paintedMat, Object.assign({ shadow: false }, o));
  }

  // ---------- soft shadows and light pools (cheap, baked) ----------
  // Shadows that sit on the floor under furniture (and in the corners), and warm
  // pools of light under lamps: flat shapes whose edges fade out (the fading is in
  // the vertex colors, no pictures), all sharing two materials, so all of them
  // together are only a couple of draw calls.
  let decalMats = null;
  function decals() {
    if (!decalMats) {
      const base = { vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      decalMats = {
        shade: new THREE.MeshBasicMaterial(Object.assign({ color: 0x3a2414 }, base)),
        light: new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff, blending: THREE.AdditiveBlending }, base)),
      };
      decalMats.shade.userData.keep = decalMats.light.userData.keep = true;
    }
    return decalMats;
  }
  // A flat rectangle (w x d, lying on the floor) whose edges fade out over `soft`:
  // a 4 x 4 grid, solid in the middle, clear round the outside. rgb = its tint.
  function fadeRectGeo(w, d, soft, a, rgb) {
    const xs = [-w / 2 - soft, -w / 2 + soft * 0.4, w / 2 - soft * 0.4, w / 2 + soft];
    const zs = [-d / 2 - soft, -d / 2 + soft * 0.4, d / 2 - soft * 0.4, d / 2 + soft];
    if (xs[1] > xs[2]) xs[1] = xs[2] = 0;
    if (zs[1] > zs[2]) zs[1] = zs[2] = 0;
    const pos = [], col = [], idx = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      pos.push(xs[i], 0, zs[j]);
      const inner = i > 0 && i < 3 && j > 0 && j < 3;
      col.push(rgb[0], rgb[1], rgb[2], inner ? a : 0);
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const p = j * 4 + i;
      idx.push(p, p + 4, p + 1, p + 1, p + 4, p + 5);
    }
    return decalGeo(pos, col, idx);
  }
  // A round pool: solid middle (inner part of r), fading out to r.
  function fadeDiscGeo(r, inner, a, rgb) {
    const n = 20, pos = [0, 0, 0], col = [rgb[0], rgb[1], rgb[2], a], idx = [];
    for (const [rr, aa] of [[r * inner, a * 0.75], [r, 0]]) for (let k = 0; k < n; k++) {
      const t = (k / n) * TAU;
      pos.push(Math.cos(t) * rr, 0, Math.sin(t) * rr);
      col.push(rgb[0], rgb[1], rgb[2], aa);
    }
    for (let k = 0; k < n; k++) {
      const a1 = 1 + k, a2 = 1 + ((k + 1) % n), b1 = a1 + n, b2 = a2 + n;
      idx.push(0, a2, a1, a1, a2, b2, a1, b2, b1);
    }
    return decalGeo(pos, col, idx);
  }
  function decalGeo(pos, col, idx) {
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    return g;
  }
  const WARM = [1, 0.82, 0.5];
  // o = { x, y, z, ry, rx, rz } (the shape lies flat: turn it with rx to stand it on a wall)
  function shadeRect(p, w, d, o, a, soft) {
    return put(p, fadeRectGeo(w, d, soft || 0.35, a === undefined ? 0.32 : a, [1, 1, 1]), decals().shade, Object.assign({ shadow: false, receive: false }, o));
  }
  function shadeDisc(p, r, o, a) {
    return put(p, fadeDiscGeo(r, 0.55, a === undefined ? 0.32 : a, [1, 1, 1]), decals().shade, Object.assign({ shadow: false, receive: false }, o));
  }
  function lightPool(p, r, o, a, rgb) {
    return put(p, fadeDiscGeo(r, 0.25, a === undefined ? 0.22 : a, rgb || WARM), decals().light, Object.assign({ shadow: false, receive: false }, o));
  }
  function lightRect(p, w, d, o, a, rgb, soft) {
    return put(p, fadeRectGeo(w, d, soft || 0.4, a === undefined ? 0.16 : a, rgb || WARM), decals().light, Object.assign({ shadow: false, receive: false }, o));
  }

  // A wall or floor rectangle like patchGeo, cut into a grid that is finer near the
  // edges, with a shade (0..1) per corner from shade(x, y) (x, y from its bottom-left,
  // in units): darker into the corners and along the floor, a cheap "ambient occlusion".
  function shadedPatch(w, h, u0, v0, shade, cuts) {
    const steps = (len, a0, a1) => {
      const s = new Set([0, len]);
      for (const c of cuts) { if (a0 && c < len) s.add(c); if (a1 && len - c > 0) s.add(len - c); }
      return [...s].filter((v) => v >= 0 && v <= len).sort((a, b) => a - b);
    };
    const xs = steps(w, true, true), ys = steps(h, true, true);
    const pos = [], uv = [], col = [], idx = [];
    for (const y of ys) for (const x of xs) {
      pos.push(x - w / 2, y - h / 2, 0);
      uv.push((u0 + x) / TILE, (v0 + y) / TILE);
      const s = shade(x, y);
      col.push(s, s, s);
    }
    const nx = xs.length;
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const p = j * nx + i;
      idx.push(p, p + 1, p + nx, p + 1, p + nx + 1, p + nx);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 2 ? 1 : 0)), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  // Wallpaper and floor pictures (they repeat across the walls and floor).
  // (size: the picture is drawn at 256 x 256 and scaled down to size x size)
  // The picture tiles, so anything drawn near an edge is drawn again on the other
  // side (wrapped), or there'd be cut-off shapes and seams where tiles meet.
  function patternTexture(it, isFloor, size) {
    const base = it.color || (isFloor ? "#c98a52" : "#f6ead2");
    const acc = it.accent || base;
    const pat = it.pattern || "plain";
    const S = size || 256;
    return canvasTexture(S, S, (ctx) => {
      const w = 256, h = 256;
      ctx.scale(S / 256, S / 256);
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      const r = seeded(17);
      // draws f(x, y) at (x, y) and at its copies one tile away, so it wraps round
      const wrap = (x, y, f) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) f(x + dx, y + dy); };
      const dot = (x, y, rad) => wrap(x, y, (px, py) => { ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill(); });
      if (pat === "stripes") {
        ctx.fillStyle = acc;
        for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 28, h);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (let x = 0; x < w; x += 64) ctx.fillRect(x + 40, 0, 4, h);
      } else if (pat === "hearts") {
        ctx.fillStyle = acc;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) heart(ctx, x * 64 + (y % 2) * 32 + 16, y * 64 + 18, 26);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) dot(x * 64 + (y % 2 ? 0 : 32) + 16, y * 64 + 48, 3);
      } else if (pat === "clouds") {
        // fluffy white clouds on a soft sky: each cloud is one solid shape (no
        // see-through overlaps), with a pale blue shadow underneath, wrapped at the edges
        const puff = (x, y, col, dy) => {
          ctx.fillStyle = col;
          wrap(x, y + dy, (px, py) => {
            ctx.beginPath();
            for (const [ox, oy, rr] of [[-26, 6, 15], [-8, -6, 20], [14, -2, 18], [30, 7, 13]]) { ctx.moveTo(px + ox + rr, py + oy); ctx.arc(px + ox, py + oy, rr, 0, TAU); }
            ctx.rect(px - 26, py + 6, 56, 14);
            ctx.fill();
          });
        };
        ctx.fillStyle = acc; ctx.globalAlpha = 0.35;
        for (const [x, y] of [[40, 30], [170, 96], [100, 170], [230, 220]]) dot(x, y, 2.5);
        ctx.globalAlpha = 1;
        const spots = [[64, 58], [196, 34], [150, 150], [32, 196], [236, 128]];
        for (const [x, y] of spots) puff(x, y, acc, 5);
        for (const [x, y] of spots) puff(x, y, "#ffffff", 0);
      } else if (pat === "grid") {
        ctx.strokeStyle = acc; ctx.lineWidth = 3; ctx.shadowColor = acc; ctx.shadowBlur = 10;
        for (let k = 0; k <= w; k += 64) {
          ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(w, k); ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#6ff0ff";
        for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 4) * 64, y = Math.floor(r() * 4) * 64; dot(x, y, 5); }
      } else if (pat === "damask") {
        ctx.fillStyle = acc;
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const cx = x * 128 + 64 + (y % 2) * 64, cy = y * 128 + 64;
          wrap(cx, cy, (px, py) => damask(ctx, px, py));
        }
      } else if (pat === "planks") {
        // long boards (two units), their ends staggered row by row, each a slightly
        // different shade, with wavy grain, the odd knot and a soft bevel at the joins
        const tones = ["#c98a52", "#c28149", "#d0935c", "#bd7c45", "#c68650", "#cf9058", "#ba7943", "#c48450"];
        const ends = [40, 168, 104, 232];
        for (let row = 0; row < 4; row++) {
          const y0 = row * 64, e = ends[row];
          ctx.fillStyle = tones[row * 2 % tones.length];
          if (it.color) ctx.globalAlpha = 0.55;
          ctx.fillRect(0, y0, w, 64);
          ctx.globalAlpha = 1;
          // grain: wavy lines along each board (they wrap round with the tile)
          for (let g = 0; g < 6; g++) {
            const y = y0 + 7 + g * 9 + r() * 5, a = 1.5 + r() * 2.5, ph = r() * TAU;
            ctx.strokeStyle = "rgba(110,60,25," + (0.12 + r() * 0.12).toFixed(3) + ")"; ctx.lineWidth = 1 + r() * 1.2;
            ctx.beginPath();
            for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin((x / w) * TAU * 2 + ph) * a; if (x) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
            ctx.stroke();
          }
          // a knot now and then
          const kx = (e + 60 + r() * 120) % w, ky = y0 + 20 + r() * 24;
          wrap(kx, ky, (px, py) => {
            ctx.strokeStyle = "rgba(110,60,25,0.25)"; ctx.lineWidth = 1.2;
            for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(px, py, 4 + k * 4, 2 + k * 1.6, 0, 0, TAU); ctx.stroke(); }
            ctx.fillStyle = "rgba(110,60,25,0.35)"; ctx.beginPath(); ctx.ellipse(px, py, 4, 2, 0, 0, TAU); ctx.fill();
          });
          // the joins: a dark gap with a little light edge beside it
          ctx.fillStyle = acc; ctx.fillRect(0, y0, w, 3);
          ctx.fillStyle = "rgba(255,240,215,0.28)"; ctx.fillRect(0, y0 + 3, w, 2);
          ctx.fillStyle = "rgba(80,40,15,0.14)"; ctx.fillRect(0, y0 + 58, w, 6);
          wrap(e, y0, (px, py) => {
            ctx.fillStyle = acc; ctx.fillRect(px - 1, py, 3, 64);
            ctx.fillStyle = "rgba(255,240,215,0.28)"; ctx.fillRect(px + 2, py + 3, 2, 61);
          });
        }
      } else if (pat === "checker") {
        ctx.fillStyle = acc;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 64, y * 64, 64, 64);
        // glazed tiles: a soft shine in one corner of each, and thin grout lines
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const gr = ctx.createRadialGradient(x * 64 + 18, y * 64 + 16, 2, x * 64 + 18, y * 64 + 16, 34);
          gr.addColorStop(0, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gr; ctx.fillRect(x * 64, y * 64, 64, 64);
          ctx.fillStyle = "rgba(0,0,0,0.06)"; ctx.fillRect(x * 64 + 4, y * 64 + 58, 58, 3); ctx.fillRect(x * 64 + 58, y * 64 + 4, 3, 56);
        }
        ctx.fillStyle = "rgba(150,150,165,0.55)";
        for (let k = 0; k < 4; k++) { ctx.fillRect(k * 64 - 1, 0, 2, h); ctx.fillRect(0, k * 64 - 1, w, 2); }
        ctx.fillRect(w - 1, 0, 1, h); ctx.fillRect(0, h - 1, w, 1);
      } else if (pat === "marble") {
        // veins start and end at the same height, so they carry on into the next tile
        ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8;
        for (let i = 0; i < 7; i++) {
          const y = r() * h, a = (r() - 0.5) * 120, b = (r() - 0.5) * 120;
          wrap(0, y, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.bezierCurveTo(px + 85, py + a, px + 170, py + b, px + w, py); ctx.stroke(); });
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(150,150,170,0.6)"; ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 128, 128); ctx.strokeRect(128, 0, 128, 128); ctx.strokeRect(0, 128, 128, 128); ctx.strokeRect(128, 128, 128, 128);
      } else if (pat === "stars") {
        // a night sky: twinkly dots, little stars and a crescent moon
        for (let i = 0; i < 70; i++) { ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.55)" : "rgba(255,240,190,0.4)"; dot(r() * w, r() * h, 0.8 + r() * 1.2); }
        ctx.fillStyle = acc;
        for (const [x, y, s] of [[40, 50, 11], [160, 30, 8], [210, 150, 12], [90, 130, 7], [30, 220, 9], [150, 210, 10], [250, 80, 7]]) wrap(x, y, (px, py) => star(ctx, px, py, s));
        wrap(110, 70, (px, py) => {
          ctx.fillStyle = "#fff4c4"; ctx.beginPath(); ctx.arc(px, py, 18, 0, TAU); ctx.fill();
          ctx.fillStyle = base; ctx.beginPath(); ctx.arc(px + 8, py - 6, 16, 0, TAU); ctx.fill();
        });
      } else if (pat === "leaves") {
        // big jungle leaves in two greens, on the slant
        const leaf = (x, y, a, s, col) => wrap(x, y, (px, py) => {
          ctx.save(); ctx.translate(px, py); ctx.rotate(a);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.6, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s * 0.6, -s * 0.2, 0, -s); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 0.9); ctx.stroke();
          for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(0, k * s * 0.3); ctx.lineTo(s * 0.3, k * s * 0.3 - s * 0.18); ctx.moveTo(0, k * s * 0.3); ctx.lineTo(-s * 0.3, k * s * 0.3 - s * 0.18); ctx.stroke(); }
          ctx.restore();
        });
        const light = "#8fd07a";
        for (const [x, y, a, s, c] of [[50, 60, 0.6, 46, acc], [180, 40, -0.5, 40, light], [130, 150, 0.2, 50, acc], [30, 190, -0.7, 38, light], [220, 190, 0.9, 44, acc], [100, 240, -0.2, 30, light]]) leaf(x, y, a, s, c);
      } else if (pat === "brick") {
        // rows of bricks with light mortar between them
        ctx.fillStyle = acc; ctx.fillRect(0, 0, w, h);
        const bh = 32, bw = 64;
        for (let row = 0; row < h / bh; row++) {
          const off = (row % 2) * (bw / 2);
          for (let k = -1; k <= w / bw; k++) {
            const x = k * bw + off;
            ctx.fillStyle = ["#b9553f", "#a84a36", "#c46149", "#b04f3b"][(row * 3 + k + 8) % 4];
            ctx.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
            ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x + 3, row * bh + 3, bw - 6, 4);
          }
        }
      } else if (pat === "tatami") {
        // two tatami mats per tile (one each way), woven, with dark cloth edges
        const mat = (x, y, mw, mh, across) => {
          ctx.fillStyle = base; ctx.fillRect(x, y, mw, mh);
          ctx.strokeStyle = "rgba(120,130,60,0.35)"; ctx.lineWidth = 1.5;
          if (across) for (let k = 3; k < mh; k += 6) { ctx.beginPath(); ctx.moveTo(x, y + k); ctx.lineTo(x + mw, y + k); ctx.stroke(); }
          else for (let k = 3; k < mw; k += 6) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k, y + mh); ctx.stroke(); }
          ctx.fillStyle = acc;
          if (across) { ctx.fillRect(x, y, 6, mh); ctx.fillRect(x + mw - 6, y, 6, mh); } else { ctx.fillRect(x, y, mw, 6); ctx.fillRect(x, y + mh - 6, mw, 6); }
        };
        mat(0, 0, 128, 256, false);
        mat(128, 0, 128, 128, true);
        mat(128, 128, 128, 128, true);
      } else if (pat === "hex") {
        // honeycomb: 4 x 4 hexagons per tile (every other row shifted), so it tiles
        const cw = 64, rh = 64, rx = cw / Math.sqrt(3), ry = rh / 1.5;
        ctx.lineWidth = 5; ctx.strokeStyle = acc; ctx.lineJoin = "round";
        for (let row = -1; row <= 4; row++) for (let col = -1; col <= 4; col++) {
          const cx = col * cw + (row % 2 ? cw / 2 : 0), cy = row * rh;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = PI / 6 + k * PI / 3; const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          ctx.closePath();
          if ((((row + 3 * col) % 4) + 4) % 4 === 0) { ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fill(); }
          ctx.stroke();
        }
      } else if (pat === "chevron") {
        // parquet: short planks on the slant, every other column the other way (a zig-zag)
        const cw = 64, T = 32;
        const tones = [base, "#b2733f", "#9c5f31", "#b87a46"];
        ctx.strokeStyle = acc; ctx.lineWidth = 2.5;
        for (let col = 0; col < 4; col++) {
          const x0 = col * cw, up = col % 2 === 0;
          for (let k = -2; k < 12; k++) {
            const y = k * T;
            const yl = up ? y : y - cw, yr = up ? y - cw : y; // left / right edge heights
            ctx.fillStyle = tones[((k % 4) + 4) % 4];
            ctx.beginPath(); ctx.moveTo(x0, yl); ctx.lineTo(x0 + cw, yr); ctx.lineTo(x0 + cw, yr + T); ctx.lineTo(x0, yl + T); ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
        }
      } else {
        // plain: a soft speckle (carpet, or grass blades for fake grass)
        const grass = /grass/.test(it.id || "");
        if (isFloor && !grass) {
          // carpet: rows of little woven loops
          for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) {
            ctx.fillStyle = "rgba(0,0,0,0.07)"; ctx.fillRect(x, y + 3, 4, 2);
            ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(x, y, 4, 2);
          }
        }
        for (let i = 0; i < (grass ? 260 : 400); i++) {
          const x = r() * w, y = r() * h;
          ctx.fillStyle = r() < 0.5 ? acc : "rgba(255,255,255,0.18)";
          if (grass) wrap(x, y, (px, py) => ctx.fillRect(px, py, 2, 7)); else dot(x, y, 1.6);
        }
        if (!isFloor) {
          ctx.fillStyle = acc;
          for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) dot(x * 64 + (y % 2) * 32 + 16, y * 64 + 32, 4);
        }
      }
      // a fine grain over everything, like paper (walls) or a worn surface (floors)
      // (only on the big pictures in a home: the little ones are too small to see it)
      if (S >= 512) {
        const n = seeded(77);
        for (let i = 0; i < 700; i++) {
          ctx.fillStyle = n() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.06)";
          ctx.fillRect(n() * w, n() * h, 0.6 + n(), isFloor ? 0.6 + n() : 1.5 + n() * 3);
        }
      }
    }, [1, 1]);
  }

  // A five-pointed star.
  function star(ctx, x, y, s) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -PI / 2 + k * PI / 5, rr = k % 2 ? s * 0.45 : s;
      if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function damask(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 30, 0, 0, TAU); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(s * 22, -10, 8, 18, s * 0.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 18, 22, 6, 12, -s * 0.5, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(8, -34); ctx.lineTo(-8, -34); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 42, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // A rectangle of wall/floor whose picture lines up with its neighbors:
  // (u0, v0) = where its bottom-left corner is on the wall, in units.
  function patchGeo(w, h, u0, v0) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + uv.getX(i) * w) / TILE, (v0 + uv.getY(i) * h) / TILE);
    return g;
  }

  // Which item is in each slot (falling back to the starter item).
  function resolveItems(record) {
    const H = root.MiiHomes;
    const chosen = (record && record.home && record.home.items) || {};
    const out = {};
    const start = H ? H.starterHome().items : {};
    for (const slot of Object.keys(start)) {
      const id = chosen[slot];
      const it = id && H.item(id);
      out[slot] = it && it.slot === slot ? it : H.item(start[slot]);
    }
    return out;
  }

  // ---------- where each slot goes in the room ----------
  // Every slot has an anchor point and a turn (ry). Furniture is modelled facing
  // +z around its anchor, then turned into place.
  const SLOT_PLACES = {
    bed: { x: -4.25, z: -2.95, ry: 0 },              // back-left corner, head against the back wall
    sofa: { x: -4.8, z: 1.4, ry: PI / 2 - 0.3 },     // against the left wall, turned a little toward you
    table: { x: 0.3, z: 1.0, ry: 0 },                // middle of the room
    tv: { x: 5.4, z: -0.4, ry: -PI / 2 },            // against the right wall, facing into the room
    rug: { x: 0.3, z: 1.0, ry: 0 },                  // under the table
    lamp: { x: -2.4, z: -4.0, ry: 0 },               // on the bedside table (floor lamp: by the left wall)
    plant: { x: -5.1, z: 3.7, ry: 0.4 },             // front-left corner
    art: { x: 2.4, z: -4.5, ry: 0 },                 // on the back wall
    special: { x: 4.5, z: -3.4, ry: 0 },             // back-right corner
  };
  const WINDOW = { x: -0.4, w: 2.4, y0: 1.5, y1: 3.6 };
  // lamps that stand on the bedside table (so the clock and book move off it)
  const NIGHTSTAND_LAMPS = ["lamp-lava", "lamp-moon"];
  const DOOR = { z: 3.0, w: 1.3, h: 2.5 };

  function toWorld(place, lx, lz) {
    const c = Math.cos(place.ry), s = Math.sin(place.ry);
    return { x: place.x + lx * c + lz * s, z: place.z - lx * s + lz * c };
  }

  // Where a home's self-portrait gets its picture: opts.portrait (a function
  // record -> picture URL, or a URL), or else MiiHomes3D.portraitFor(record),
  // which the app sets up. Returns a function giving the URL ("" = not ready yet).
  function portraitSource(opts, record) {
    const o = opts && opts.portrait;
    if (typeof o === "function") return () => o(record);
    if (typeof o === "string") return () => o;
    if (!record || !record.id) return null;
    return () => {
      const f = root.MiiHomes3D && root.MiiHomes3D.portraitFor;
      return typeof f === "function" ? f(record) : "";
    };
  }

  // ---------- furniture models ----------
  // Each one: build(g, ctx) draws it around (0, 0) facing +z.
  //   obs   obstacles in the item's own coordinates (rect: cx, cz, w, d / circle: cx, cz, r)
  //   spot  where a Mii stands to use it (lx, lz) and which way it looks (yaw)
  //   seat / lie / stand  where the Mii goes when it sits / lies / runs (h = height of the surface)
  const FURNITURE = {
    // ===== beds (head at -z against the wall, foot toward +z) =====
    "bed-basic": {
      obs: [{ cx: 0, cz: 0, w: 2.2, d: 3.0 }], spot: { lx: 2.05, lz: 0.5, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.1, h: 0.82, yaw: PI },
      build(g) {
        const wood = woody(0xc98b4a);
        block(g, wood, 0, 0.3, 0, 2.0, 0.36, 2.95, 0.08);
        for (const [x, z] of [[-0.9, -1.35], [0.9, -1.35], [-0.9, 1.35], [0.9, 1.35]]) block(g, wood, x, 0.08, z, 0.16, 0.16, 0.16, 0.04);
        block(g, padded(0xffffff), 0, 0.6, 0.02, 1.86, 0.3, 2.85, 0.12);
        block(g, wood, 0, 0.9, -1.44, 2.1, 1.4, 0.14, 0.1);
        block(g, woody(0xe2a35e), 0, 1.45, -1.44, 1.5, 0.3, 0.16, 0.1);
        block(g, wood, 0, 0.55, 1.45, 2.1, 0.7, 0.12, 0.08);
        block(g, padded(0xfff8ee), 0, 0.84, -1.05, 1.2, 0.22, 0.55, 0.11);
        block(g, padded(0x7fb8f0), 0, 0.78, 0.4, 1.95, 0.08, 2.0, 0.04);
        block(g, cloth(0xffffff), 0, 0.83, -0.55, 1.95, 0.06, 0.22, 0.03);
        for (let k = 0; k < 4; k++) ball(g, 0xffffff, -0.6 + k * 0.4, 0.83, 0.6 + (k % 2) * 0.5, 0.08, { sy: 0.3 });
        bits(g, (p) => {
          // a blanket hem, round knobs on the posts, a heart on the footboard and a little plush bunny
          slab(p, 0x5f9ad8, 0, 0.78, 1.4, 1.97, 0.1, 0.06, 0.03);
          for (const x of [-0.98, 0.98]) { bead(p, 0xe2a35e, x, 1.64, -1.44, 0.09); bead(p, 0xe2a35e, x, 0.94, 1.45, 0.08); }
          bead(p, 0xff8a9a, -0.06, 0.58, 1.52, 0.08, { sz: 0.35 });
          bead(p, 0xff8a9a, 0.06, 0.58, 1.52, 0.08, { sz: 0.35 });
          put(p, G.cone(4), toon(0xff8a9a), { y: 0.5, z: 1.52, s: 0.11, sy: 0.12, rx: PI, ry: PI / 4, sz: 0.04 });
          bead(p, 0xffffff, 0.6, 0.95, -0.95, 0.12, { sy: 0.9 });
          bead(p, 0xffffff, 0.6, 1.1, -0.95, 0.1);
          for (const s of [-1, 1]) put(p, G.capsule(), toon(0xffffff), { x: 0.6 + s * 0.04, y: 1.24, z: -0.95, sx: 0.04, sy: 0.12, sz: 0.03, rz: -s * 0.2 });
          bead(p, 0xff9ec7, 0.6, 1.08, -0.86, 0.02);
        });
      },
    },
    "bed-canopy": {
      obs: [{ cx: 0, cz: 0, w: 2.4, d: 3.05 }], spot: { lx: 2.15, lz: 0.5, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.1, h: 0.9, yaw: PI },
      build(g, ctx) {
        const white = woody(0xfff6fa), pink = cloth(0xffa8c8), gold = shiny(0xffcf3a);
        block(g, white, 0, 0.32, 0, 2.1, 0.4, 2.95, 0.1);
        block(g, padded(0xfff0f6), 0, 0.66, 0.02, 1.95, 0.34, 2.85, 0.14);
        block(g, padded(0xff8ab8), 0, 0.85, 0.45, 2.02, 0.08, 1.95, 0.05);
        bits(g, (p) => {
          // little hearts along the blanket's hem, and a lacy frill round the mattress
          for (let k = 0; k < 6; k++) bead(p, 0xffffff, -0.75 + k * 0.3, 0.9, 1.35, 0.045, { sy: 0.4 });
          for (let k = 0; k < 8; k++) bead(p, 0xffffff, -0.95 + k * 0.27, 0.5, 1.49, 0.08, { sy: 0.55, sz: 0.4 });
        });
        block(g, white, 0, 1.05, -1.44, 2.15, 1.7, 0.14, 0.3);
        ball(g, 0xff8ab8, 0, 1.4, -1.36, 0.3, { sz: 0.25 });
        for (let k = 0; k < 3; k++) put(g, G.cone(), gold, { x: -0.3 + k * 0.3, y: 2.1 + (k === 1 ? 0.12 : 0), z: -1.44, s: 0.1, sy: 0.3 });
        ball(g, 0xffffff, -0.45, 0.93, -1.05, 0.28, { sy: 0.4, sx: 1.3 });
        ball(g, 0xffd6e6, 0.45, 0.93, -1.05, 0.28, { sy: 0.4, sx: 1.3 });
        for (const [x, z] of [[-1.05, -1.48], [1.05, -1.48], [-1.05, 1.48], [1.05, 1.48]]) {
          cylinder(g, white, x, 1.7, z, 0.07, 3.4);
          ball(g, gold, x, 3.45, z, 0.1);
        }
        block(g, pink, 0, 3.35, 0, 2.3, 0.12, 3.15, 0.05);
        const sc = [];
        for (let k = 0; k <= 10; k++) for (const s of [-1, 1]) sc.push({ x: -1.1 + k * 0.22, y: 3.2, z: s * 1.56, s: 0.13, sy: 0.18 });
        for (let k = 0; k <= 14; k++) for (const s of [-1, 1]) sc.push({ x: s * 1.13, y: 3.2, z: -1.54 + k * 0.22, s: 0.13, sy: 0.18 });
        scatter(g, G.lowSphere(), toon(0xff8ab8), sc);
        // curtains tied back at each post, swaying gently
        const cur = [];
        for (const [x, z] of [[-1.05, -1.3], [1.05, -1.3], [-1.05, 1.3], [1.05, 1.3]]) {
          const c = dynamic(group(g, x, 3.25, z));
          put(c, G.capsule(), toon(0xffc6dc, { transparent: true, opacity: 0.92 }), { y: -1.3, sx: 0.32, sy: 1.55, sz: 0.2, shadow: false });
          put(c, G.torus(0.13, 0.03), gold, { y: -1.5, rx: PI / 2 });
          cur.push(c);
        }
        ctx.anim.push((t) => cur.forEach((c, i) => { c.rotation.z = Math.sin(t * 1.2 + i) * 0.03; }));
      },
    },
    "bed-race": {
      obs: [{ cx: 0, cz: 0.2, w: 2.5, d: 3.45 }], spot: { lx: 2.2, lz: 0.6, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.0, h: 0.86, yaw: PI },
      build(g) {
        const red = shiny(0xff3b3b);
        block(g, red, 0, 0.5, 0.2, 2.2, 0.75, 3.4, 0.28);
        block(g, padded(0xffffff), 0, 0.75, -0.15, 1.7, 0.2, 2.4, 0.08);
        bits(g, (p) => {
          // racing number on each side, a grille, and bolts on the wheels
          for (const sx of [-1, 1]) {
            for (const [x, z] of [[-1.13, -0.95], [1.13, -0.95], [-1.13, 1.3], [1.13, 1.3]]) if (Math.sign(x) === sx) for (let k = 0; k < 5; k++) bead(p, 0x9aa3b0, x * 1.12, 0.38 + Math.cos(k * 1.26) * 0.09, z + Math.sin(k * 1.26) * 0.09, 0.025);
            slab(p, 0x2f3542, sx * 0.015 + sx * 1.1, 0.48, 0.25, 0.02, 0.06, 0.16, 0.01);
          }
          for (let k = 0; k < 5; k++) slab(p, 0x2f3542, -0.4 + k * 0.2, 0.55, 1.91, 0.08, 0.2, 0.02, 0.01);
        });
        block(g, 0x4a90e2, 0, 0.84, 0.55, 1.72, 0.06, 1.2, 0.03);
        ball(g, 0xffffff, 0, 0.92, -1.0, 0.3, { sx: 1.8, sy: 0.4 });
        block(g, red, 0, 0.88, 1.45, 2.2, 0.22, 0.7, 0.1, { rx: -0.2 }); // the hood
        block(g, 0xffffff, -0.35, 0.93, 1.45, 0.25, 0.04, 0.72, 0.02, { rx: -0.2 });
        block(g, 0xffffff, 0.35, 0.93, 1.45, 0.25, 0.04, 0.72, 0.02, { rx: -0.2 });
        ball(g, glow(0xfff4c2, 0.9), -0.7, 0.6, 1.9, 0.15, { sz: 0.5 });
        ball(g, glow(0xfff4c2, 0.9), 0.7, 0.6, 1.9, 0.15, { sz: 0.5 });
        for (const [x, z] of [[-1.13, -0.95], [1.13, -0.95], [-1.13, 1.3], [1.13, 1.3]]) {
          cylinder(g, 0x2f3542, x, 0.38, z, 0.38, 0.28, { rz: PI / 2 });
          cylinder(g, 0xdfe4ea, x * 1.08, 0.38, z, 0.17, 0.08, { rz: PI / 2 });
        }
        for (const sx of [-0.7, 0.7]) block(g, 0x2f3542, sx, 1.15, -1.35, 0.1, 0.7, 0.1, 0.03);
        block(g, red, 0, 1.5, -1.38, 2.3, 0.12, 0.5, 0.05); // spoiler
        for (const sx of [-1, 1]) {
          disc(g, toon(0xffffff), sx * 1.11, 0.55, 0.25, 0.3, { rx: 0, ry: sx * PI / 2 });
          block(g, 0x2f3542, sx * 1.12, 0.55, 0.25, 0.02, 0.32, 0.08, 0.01);
        }
      },
    },
    "bed-hammock": {
      // (a gentle sag, and the Mii lies just on top of it: head and feet stay above the cloth)
      obs: [{ cx: 0, cz: 0.05, w: 1.7, d: 3.3 }], spot: { lx: 1.85, lz: 0.4, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.05, h: 1.07, yaw: PI },
      build(g) {
        const wood = woody(0xa47a48);
        for (const z of [-1.45, 1.55]) {
          block(g, wood, 0, 1.0, z, 0.2, 2.0, 0.2, 0.06);
          block(g, wood, 0, 0.06, z, 1.2, 0.12, 0.3, 0.05);
          ball(g, 0x5cc84a, 0, 2.15, z, 0.18);
        }
        bits(g, (p) => {
          // leaves round the post tops, rope lashings and a hook at each end
          for (const z of [-1.45, 1.55]) {
            for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ball(p, k % 2 ? 0x46b04a : 0x7fdc5c, Math.cos(a) * 0.17, 2.12, z + Math.sin(a) * 0.17, 0.09, { sy: 0.6 }); }
            for (let k = 0; k < 3; k++) put(p, lowTorus(0.12, 0.02), toon(0xf4efe4), { y: 1.82 + k * 0.05, z, rx: PI / 2 });
            put(p, lowTorus(0.05, 0.015), toon(0x8f96a3), { y: 1.9, z: z - Math.sign(z) * 0.12 });
          }
        });
        // the cloth: a curved, striped sheet sagging in the middle
        const stripes = canvasTexture(64, 128, (ctx, w, h) => {
          const cols = ["#ff7a59", "#ffcf5a", "#5cc8b8", "#ffffff"];
          for (let i = 0; i < 8; i++) { ctx.fillStyle = cols[i % 4]; ctx.fillRect(0, i * 16, w, 16); }
        });
        const nu = 16, nv = 6, geo = new THREE.BufferGeometry();
        const pos = [], uvs = [], idx = [];
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
          const a = i / nu, b = j / nv, zt = a * 2 - 1, vt = b * 2 - 1;
          pos.push(vt * 0.6, 0.95 + 0.34 * zt * zt + 0.12 * vt * vt, -1.15 + a * 2.4);
          uvs.push(b, a);
        }
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
          const a = i * (nv + 1) + j, b = a + nv + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        geo.setIndex(idx);
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.computeVertexNormals();
        put(g, geo, toon(0xffffff, { map: stripes, side: THREE.DoubleSide }), {});
        // ropes from the ends of the cloth up to the posts
        for (const [z, zz] of [[-1.15, -1.45], [1.25, 1.55]]) {
          const y = 1.32, yy = 1.9;
          cylinder(g, 0xf4efe4, 0, (y + yy) / 2, (z + zz) / 2, 0.025, Math.hypot(zz - z, yy - y), { rx: Math.atan2(zz - z, yy - y) });
        }
        ball(g, 0xffffff, 0, 1.25, -0.85, 0.24, { sx: 1.5, sy: 0.45 });
      },
    },

    // ===== seats (facing +z) =====
    "sofa-basic": {
      obs: [{ cx: 0, cz: 0, w: 1.4, d: 1.2 }], spot: { lx: 0, lz: 1.3, yaw: 0 }, seat: { lx: 0, lz: 0.02, h: 0.56, legs: "out" },
      build(g) {
        const c = cloth(0xffb84a);
        block(g, c, 0, 0.3, 0, 1.3, 0.4, 1.1, 0.12);
        block(g, padded(0xffd27a), 0, 0.5, 0.05, 1.0, 0.14, 0.92, 0.07);
        block(g, c, 0, 0.9, -0.45, 1.3, 0.85, 0.24, 0.12);
        for (const sx of [-0.56, 0.56]) block(g, c, sx, 0.62, 0.02, 0.22, 0.42, 1.05, 0.1);
        for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) block(g, woody(0x8a5a3a), x, 0.06, z, 0.1, 0.12, 0.1, 0.03);
        ball(g, cloth(0xff7a8a), 0.35, 0.78, -0.25, 0.2, { sz: 0.5, rz: 0.4 });
        bits(g, (p) => {
          // buttons tufted into the back, piping round the arms, and a little knitted throw
          for (const [x, y] of [[-0.3, 1.0], [0, 1.0], [0.3, 1.0], [-0.15, 0.78], [0.15, 0.78]]) bead(p, 0xe89a30, x, y, -0.33, 0.03, { sz: 0.5 });
          for (const sx of [-0.56, 0.56]) slab(p, 0xffd27a, sx, 0.835, 0.02, 0.2, 0.02, 1.0, 0.01);
          slab(p, 0x8fd3ff, -0.38, 1.1, -0.3, 0.42, 0.2, 0.05, 0.02, { rx: -0.2, rz: 0.08 });
          for (let k = 0; k < 4; k++) slab(p, 0xffffff, -0.38, 1.03 + k * 0.045, -0.27 + k * 0.009, 0.4, 0.012, 0.01, 0.003, { rx: -0.2, rz: 0.08 });
        });
      },
    },
    "sofa-comfy": {
      obs: [{ cx: 0, cz: 0, w: 2.75, d: 1.25 }], spot: { lx: 0, lz: 1.35, yaw: 0 }, seat: { lx: 0, lz: 0.05, h: 0.6, legs: "out" },
      build(g) {
        const c = cloth(0x4fb8b0), c2 = padded(0x7fd6cc);
        bits(g, (p) => {
          // tufted buttons on the back cushions, and the piping along the front of the seat
          for (const sx of [-0.6, 0.6]) for (const [x, y] of [[-0.25, 1.08], [0.25, 1.08], [0, 0.86]]) bead(p, 0x3a9a92, sx + x, y, -0.2 - (1.08 - y) * 0.12, 0.035, { sz: 0.5 });
          slab(p, 0x3a9a92, 0, 0.42, 0.6, 2.3, 0.03, 0.03, 0.01);
        });
        block(g, c, 0, 0.3, 0, 2.6, 0.42, 1.2, 0.14);
        for (const sx of [-0.6, 0.6]) block(g, c2, sx, 0.53, 0.07, 1.15, 0.18, 1.0, 0.09);
        block(g, c, 0, 0.95, -0.5, 2.6, 0.9, 0.3, 0.15);
        for (const sx of [-0.6, 0.6]) block(g, c2, sx, 0.95, -0.32, 1.1, 0.65, 0.2, 0.1, { rx: -0.12 });
        for (const sx of [-1.25, 1.25]) put(g, G.capsule(), c, { x: sx, y: 0.62, z: 0.0, sx: 0.32, sy: 0.75, sz: 0.32, rx: PI / 2 });
        ball(g, cloth(0xff9ec7), -0.95, 0.85, -0.2, 0.22, { sz: 0.5, rz: -0.4 });
        ball(g, cloth(0xffe25a), 0.95, 0.85, -0.2, 0.22, { sz: 0.5, rz: 0.4 });
        for (const [x, z] of [[-1.15, -0.45], [1.15, -0.45], [-1.15, 0.45], [1.15, 0.45]]) ball(g, woody(0x8a5a3a), x, 0.06, z, 0.07);
      },
    },
    "sofa-beanbag": {
      obs: [{ cx: 0, cz: -0.05, r: 0.85 }], spot: { lx: 0, lz: 1.45, yaw: 0 }, seat: { lx: 0, lz: 0.0, h: 0.45, legs: "out" },
      build(g) {
        ball(g, cloth(0xb58cff), 0, 0.36, -0.05, 0.8, { sy: 0.48 });
        ball(g, cloth(0xb58cff), 0, 0.62, -0.42, 0.55, { sy: 0.65, sz: 0.6 });
        ball(g, cloth(0xc9a8ff), 0, 0.46, 0.05, 0.5, { sy: 0.25 });
        bits(g, (p) => {
          // a sewn-on label, a star patch and a seam round the middle
          slab(p, 0xffffff, 0.55, 0.3, 0.48, 0.16, 0.1, 0.02, 0.01, { ry: 0.7 });
          put(p, G.cone(5), toon(0xffe25a), { x: -0.52, y: 0.42, z: 0.52, s: 0.09, sy: 0.02, rx: PI / 2 - 0.5, ry: -0.6 });
          put(p, lowTorus(0.79, 0.012), toon(0x9a70e0), { y: 0.36, z: -0.05, sy: 0.48, rx: PI / 2 });
        });
        ball(g, 0xffffff, 0.45, 0.75, -0.55, 0.06);
        ball(g, 0xffffff, -0.55, 0.58, -0.35, 0.05);
      },
    },
    "sofa-throne": {
      obs: [{ cx: 0, cz: -0.05, w: 1.9, d: 1.7 }], spot: { lx: 0, lz: 1.6, yaw: 0 }, seat: { lx: 0, lz: 0.05, h: 0.81, legs: "out" },
      build(g) {
        const gold = shiny(0xffcf3a), red = padded(0xd8344a);
        bits(g, (p) => {
          // gold studs round the red back panel
          for (let k = 0; k < 8; k++) { const t = k / 7; bead(p, 0xffe27a, -0.45 + t * 0.9, 2.15, -0.37, 0.025); bead(p, 0xffe27a, -0.45 + t * 0.9, 0.75, -0.37, 0.025); }
          for (let k = 0; k < 6; k++) for (const sx of [-0.45, 0.45]) bead(p, 0xffe27a, sx, 0.95 + k * 0.2, -0.37, 0.025);
        });
        block(g, red, 0, 0.12, -0.05, 1.8, 0.24, 1.6, 0.06);
        block(g, gold, 0, 0.25, -0.05, 1.84, 0.04, 1.64, 0.02);
        block(g, gold, 0, 0.5, 0.0, 1.15, 0.5, 0.95, 0.08);
        block(g, red, 0, 0.78, 0.04, 1.0, 0.1, 0.85, 0.05);
        block(g, gold, 0, 1.55, -0.5, 1.2, 1.9, 0.2, 0.1);
        block(g, red, 0, 1.45, -0.39, 0.9, 1.4, 0.04, 0.08);
        for (const sx of [-0.6, 0.6]) {
          block(g, gold, sx, 0.98, 0.0, 0.16, 0.12, 0.95, 0.05);
          ball(g, gold, sx, 1.02, 0.5, 0.11);
          ball(g, gold, sx, 2.55, -0.5, 0.13);
          block(g, gold, sx, 0.75, 0.38, 0.12, 0.45, 0.12, 0.04);
        }
        put(g, G.cone(5), gold, { y: 2.75, z: -0.5, s: 0.22, sy: 0.4 });
        ball(g, glow(0xff3b6b, 0.6), 0, 2.2, -0.39, 0.12, { sz: 0.5 });
        ball(g, glow(0x3bb5ff, 0.6), -0.3, 2.0, -0.39, 0.07, { sz: 0.5 });
        ball(g, glow(0x5cff8a, 0.6), 0.3, 2.0, -0.39, 0.07, { sz: 0.5 });
      },
    },

    // ===== tables (the Mii stands behind them, at -z, facing you) =====
    "table-basic": {
      obs: [{ cx: 0, cz: 0, w: 1.6, d: 1.1 }], spot: { lx: 0, lz: -1.2, yaw: 0 },
      build(g) {
        const wood = woody(0xe0a868);
        block(g, wood, 0, 0.82, 0, 1.6, 0.1, 1.1, 0.05);
        for (const [x, z] of [[-0.65, -0.4], [0.65, -0.4], [-0.65, 0.4], [0.65, 0.4]]) block(g, wood, x, 0.4, z, 0.1, 0.8, 0.1, 0.03);
        bits(g, (p) => {
          // a lace runner, a rail under the top, a fork, a napkin, a rim on the plate and a leaf on the flower
          slab(p, 0xfff6ea, 0, 0.873, 0, 0.42, 0.008, 1.14, 0.003);
          for (let k = 0; k < 5; k++) bead(p, 0xfff6ea, -0.16 + k * 0.08, 0.86, 0.57, 0.025, { sy: 0.3 });
          for (const z of [-0.47, 0.47]) slab(p, 0xc98b4a, 0, 0.72, z, 1.2, 0.08, 0.03, 0.01);
          slab(p, 0xff9ec7, 0.62, 0.877, 0.3, 0.2, 0.008, 0.2, 0.003, { ry: 0.3 });
          slab(p, 0xdfe4ea, 0.66, 0.885, 0.0, 0.03, 0.006, 0.24, 0.002);
          put(p, lowTorus(0.27, 0.012), toon(0xff9ec7), { x: 0.35, y: 0.912, z: 0.05, rx: PI / 2 });
          bead(p, 0x5cb840, -0.34, 1.3, 0, 0.06, { sx: 1.5, sy: 0.4, rz: -0.5 });
          put(p, lowTorus(0.12, 0.012), toon(0xffffff), { x: -0.4, y: 1.18, rx: PI / 2 });
        });
        cylinder(g, 0x7cc6e8, -0.4, 1.05, 0.0, 0.12, 0.35);
        cylinder(g, 0x4f9e35, -0.4, 1.35, 0.0, 0.02, 0.4);
        ball(g, 0xff6fa5, -0.4, 1.58, 0.0, 0.12);
        cylinder(g, 0xffffff, 0.35, 0.89, 0.05, 0.3, 0.04);
        ball(g, 0xff3b3b, 0.3, 0.98, 0.05, 0.1);
        ball(g, 0x8ad43a, 0.45, 0.98, 0.1, 0.09);
      },
    },
    "table-picnic": {
      obs: [{ cx: 0, cz: 0, w: 2.4, d: 2.25 }], spot: { lx: 0, lz: -1.7, yaw: 0 },
      build(g) {
        const wood = woody(0xc98b4a);
        const check = canvasTexture(64, 64, (ctx) => {
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 64, 64);
          ctx.fillStyle = "#ff5a64";
          for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
        }, [3, 1.5]);
        block(g, wood, 0, 0.8, 0, 2.2, 0.1, 0.95, 0.04);
        block(g, toon(0xffffff, { map: check }), 0, 0.86, 0, 2.0, 0.03, 1.05, 0.01);
        for (const sz of [-0.82, 0.82]) block(g, wood, 0, 0.48, sz, 2.2, 0.08, 0.36, 0.03);
        for (const sx of [-0.9, 0.9]) {
          block(g, wood, sx, 0.4, 0, 0.1, 0.8, 0.1, 0.02);
          block(g, wood, sx, 0.4, 0, 0.1, 0.08, 1.9, 0.02);
          block(g, wood, sx, 0.22, 0, 0.1, 0.44, 0.1, 0.02, { rz: sx * 0.2 });
        }
        block(g, 0xc98b4a, -0.5, 1.07, -0.05, 0.6, 0.4, 0.45, 0.08);
        put(g, G.torus(0.25, 0.03), toon(0xa86b32), { x: -0.5, y: 1.27, z: -0.05 });
        block(g, 0xf5d48e, 0.35, 0.95, 0.15, 0.4, 0.14, 0.3, 0.04);
        block(g, 0x8ad43a, 0.35, 1.03, 0.15, 0.42, 0.03, 0.32, 0.01);
        cylinder(g, 0xff9a3a, 0.8, 1.0, -0.15, 0.08, 0.28);
      },
    },
    "table-desk": {
      obs: [{ cx: 0, cz: 0.05, w: 2.15, d: 1.0 }], spot: { lx: 0, lz: -1.15, yaw: 0 },
      build(g, ctx) {
        const top = woody(0xf4f4f4), legs = shiny(0x8f96a3);
        bits(g, (p) => {
          // keys on the keyboard, sticky notes on the screen, a mug, pens and a stack of paper
          for (let row = 0; row < 3; row++) for (let k = 0; k < 10; k++) slab(p, 0xb8bcc8, -0.34 + k * 0.075, 1.085, -0.27 + row * 0.06, 0.055, 0.015, 0.045, 0.006);
          slab(p, 0xffe25a, 0.52, 1.82, 0.215, 0.14, 0.14, 0.01, 0.004, { rz: 0.08 });
          slab(p, 0xff9ec7, 0.48, 1.68, 0.215, 0.12, 0.12, 0.01, 0.004, { rz: -0.1 });
          cylinder(p, 0x8fd3ff, 0.6, 1.1, 0.12, 0.06, 0.13);
          put(p, lowTorus(0.04, 0.012), toon(0x8fd3ff), { x: 0.67, y: 1.1, z: 0.12 });
          for (const [dx, col] of [[-0.02, 0x4a90e2], [0.02, 0xe8424f], [0, 0x2f3542]]) cylinder(p, col, -0.8 + dx, 1.26, -0.15 + dx, 0.012, 0.18, { rz: dx * 6 });
          for (let k = 0; k < 4; k++) slab(p, k % 2 ? 0xffffff : 0xf4efe4, -0.5, 1.05 + k * 0.012, 0.18, 0.3, 0.012, 0.38, 0.003, { ry: k * 0.05 });
        });
        block(g, top, 0, 1.0, 0, 2.1, 0.08, 0.9, 0.04);
        for (const sx of [-0.98, 0.98]) block(g, legs, sx, 0.5, 0, 0.08, 1.0, 0.8, 0.03);
        block(g, 0x2f3542, 0, 1.55, 0.25, 1.2, 0.75, 0.06, 0.04);
        const scr = codeScreen();
        const screen = dynamic(plane(g, 1.1, 0.65, basic(scr), { y: 1.55, z: 0.215, ry: PI }));
        ctx.anim.push((t) => { scr.offset.y = -((t * 0.08) % 1); screen.material.color.setScalar(0.92 + Math.sin(t * 13) * 0.04); });
        block(g, 0x2f3542, 0, 1.12, 0.25, 0.1, 0.2, 0.1, 0.03);
        block(g, 0x2f3542, 0, 1.05, 0.25, 0.4, 0.03, 0.25, 0.02);
        block(g, 0xdfe4ea, 0, 1.06, -0.2, 0.8, 0.04, 0.25, 0.02);
        ball(g, 0xdfe4ea, 0.6, 1.07, -0.2, 0.06, { sy: 0.5, sz: 1.4 });
        block(g, 0x3a3f4a, 0.75, 0.42, 0.1, 0.35, 0.8, 0.7, 0.04);
        ball(g, glow(0x5cc8ff, 1), 0.75, 0.7, -0.26, 0.04);
        cylinder(g, 0xff7a59, -0.8, 1.13, -0.15, 0.08, 0.18);
        cylinder(g, 0xffcf3a, -0.8, 1.2, 0.2, 0.04, 0.35); // desk lamp
        put(g, G.cone(), toon(0xffcf3a), { x: -0.7, y: 1.42, z: 0.15, s: 0.16, sy: 0.18, rz: 0.6 });
      },
    },
    "table-tea": {
      obs: [{ cx: 0, cz: 0, r: 0.8 }], spot: { lx: 0, lz: -1.35, yaw: 0 },
      build(g) {
        cylinder(g, cloth(0xffffff), 0, 0.82, 0, 0.75, 0.06, { seg: 32 });
        put(g, G.taper(0.76, 0.84), fine("pleat", 0xfff0f6), { y: 0.6, sy: 0.42 });
        cylinder(g, shiny(0xd9a441), 0, 0.3, 0, 0.06, 0.6);
        cylinder(g, shiny(0xd9a441), 0, 0.03, 0, 0.4, 0.05);
        bits(g, (p) => {
          // a lacy scalloped edge on the tablecloth, and a sugar bowl with a spoon
          for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; bead(p, 0xffd6e6, Math.cos(a) * 0.84, 0.39, Math.sin(a) * 0.84, 0.05, { sy: 0.5 }); }
          bead(p, 0xffd6e6, 0.42, 0.92, 0.0, 0.07, { sy: 0.8 });
          bead(p, 0xffffff, 0.42, 0.98, 0.0, 0.03);
          slab(p, 0xdfe4ea, 0.3, 0.87, 0.18, 0.02, 0.006, 0.12, 0.002, { ry: 0.5 });
        });
        // teapot
        ball(g, 0xffffff, -0.25, 1.05, 0.0, 0.22, { sy: 0.85 });
        ball(g, 0xff9ec7, -0.25, 1.05, 0.0, 0.225, { sy: 0.2 });
        ball(g, 0xffffff, -0.25, 1.26, 0.0, 0.08);
        cylinder(g, 0xffffff, -0.02, 1.1, 0.0, 0.035, 0.25, { rz: -0.9 });
        put(g, G.torus(0.1, 0.025), toon(0xffffff), { x: -0.47, y: 1.07, z: 0 });
        // cups and saucers
        for (const [x, z] of [[0.3, -0.25], [0.25, 0.35]]) {
          cylinder(g, 0xffd6e6, x, 0.865, z, 0.13, 0.015);
          put(g, G.taper(0.08, 0.06), toon(0xffffff), { x, y: 0.92, z, sy: 0.1 });
        }
        // little cake stand
        cylinder(g, 0xd9a441, 0.0, 1.05, 0.3, 0.02, 0.4);
        cylinder(g, 0xffffff, 0.0, 0.95, 0.3, 0.2, 0.02);
        cylinder(g, 0xffffff, 0.0, 1.15, 0.3, 0.14, 0.02);
        ball(g, 0xff9ec7, 0.06, 0.99, 0.32, 0.05);
        ball(g, 0xffe25a, -0.07, 0.99, 0.27, 0.05);
        ball(g, 0xff3b5a, 0.0, 1.19, 0.3, 0.045);
      },
    },

    // ===== fun things (against the right wall; the Mii stands at +z facing them) =====
    "tv-none": {
      obs: [{ cx: 0, cz: -0.15, w: 1.0, d: 0.8 }], spot: { lx: 0, lz: 1.2, yaw: PI },
      build(g, ctx) {
        const wood = woody(0xc98b4a);
        block(g, wood, 0, 0.7, -0.15, 0.9, 0.08, 0.7, 0.03);
        for (const [x, z] of [[-0.38, -0.42], [0.38, -0.42], [-0.38, 0.12], [0.38, 0.12]]) block(g, wood, x, 0.35, z, 0.07, 0.7, 0.07, 0.02);
        block(g, shiny(0xff7a59), 0, 1.0, -0.15, 0.8, 0.52, 0.38, 0.12);
        bits(g, (p) => {
          // a carry handle, a tuning window with its needle, a lower shelf with a few records
          for (const s of [-1, 1]) slab(p, 0x8f96a3, s * 0.25, 1.3, -0.15, 0.04, 0.12, 0.04, 0.01);
          slab(p, 0x8f96a3, 0, 1.36, -0.15, 0.54, 0.04, 0.05, 0.015);
          slab(p, 0xfff1dc, 0.2, 1.18, 0.045, 0.3, 0.06, 0.01, 0.01);
          slab(p, 0xe8424f, 0.16, 1.18, 0.05, 0.01, 0.05, 0.01, 0.002);
          slab(p, 0xc98b4a, 0, 0.18, -0.15, 0.8, 0.04, 0.6, 0.01);
          for (let k = 0; k < 4; k++) slab(p, [0x2f3542, 0xe8424f, 0x4a90e2, 0xffcf3a][k], -0.25 + k * 0.05, 0.38, -0.2, 0.025, 0.34, 0.34, 0.01, { rz: k === 3 ? -0.2 : 0 });
        });
        disc(g, toon(0xfff1dc), -0.15, 1.0, 0.045, 0.17, { rx: 0 });
        for (let k = 0; k < 4; k++) block(g, 0xc98b4a, -0.15, 0.9 + k * 0.065, 0.05, 0.28, 0.02, 0.01, 0.005);
        ball(g, 0xffcf5a, 0.22, 1.08, 0.05, 0.06, { sz: 0.5 });
        ball(g, 0xffcf5a, 0.22, 0.92, 0.05, 0.05, { sz: 0.5 });
        cylinder(g, 0x8f96a3, 0.25, 1.5, -0.25, 0.015, 0.6, { rz: -0.4 });
        // music notes floating up
        const noteTex = canvasTexture(64, 64, (c) => {
          c.fillStyle = "#ff5a8a"; c.font = "bold 52px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("♪", 32, 34);
        });
        const notes = [];
        for (let i = 0; i < 3; i++) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false }));
          s.scale.setScalar(0.35);
          g.add(dynamic(s));
          notes.push(s);
        }
        ctx.anim.push((t) => notes.forEach((s, i) => {
          const k = (t * 0.35 + i / 3) % 1;
          s.position.set(Math.sin(t * 2 + i * 2) * 0.25, 1.35 + k * 1.3, -0.1 + k * 0.4);
          s.material.opacity = Math.min(1, (1 - k) * 2);
        }));
      },
    },
    "tv-retro": {
      obs: [{ cx: 0, cz: -0.05, w: 1.75, d: 1.05 }], spot: { lx: 0, lz: 1.85, yaw: PI },
      build(g, ctx) {
        const wood = woody(0xa86b32);
        block(g, wood, 0, 0.95, -0.1, 1.65, 1.25, 0.95, 0.14);
        bits(g, (p) => {
          // a speaker grille, a lace doily with a vase on top
          for (let k = 0; k < 4; k++) slab(p, 0x8a5a2a, 0.55, 1.52 - k * 0.04, 0.37, 0.24, 0.015, 0.01, 0.004);
          cylinder(p, 0xfff6ea, 0.3, 1.58, -0.1, 0.28, 0.01);
          for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; bead(p, 0xfff6ea, 0.3 + Math.cos(a) * 0.28, 1.58, -0.1 + Math.sin(a) * 0.28, 0.03, { sy: 0.3 }); }
          cylinder(p, 0x8fd3ff, 0.3, 1.7, -0.1, 0.06, 0.24);
          for (const [dx, col] of [[-0.04, 0xff6fa5], [0.05, 0xffe25a]]) { cylinder(p, 0x4f9e35, 0.3 + dx, 1.9, -0.1, 0.008, 0.2); ball(p, col, 0.3 + dx, 2.0, -0.1, 0.05); }
        });
        for (const sx of [-0.65, 0.65]) block(g, 0x6b4423, sx, 0.15, -0.1, 0.1, 0.3, 0.1, 0.03, { rz: sx * 0.3 });
        block(g, 0xe8dcc8, -0.2, 0.98, 0.37, 1.05, 0.85, 0.04, 0.12);
        const shows = [tvShow(0), tvShow(1), tvShow(2)];
        const scr = dynamic(plane(g, 0.92, 0.72, basic(shows[0]), { x: -0.2, y: 0.98, z: 0.395 }));
        for (let k = 0; k < 2; k++) ball(g, 0xffcf5a, 0.55, 1.15 - k * 0.3, 0.38, 0.07, { sz: 0.6 });
        for (let k = 0; k < 4; k++) block(g, 0x6b4423, 0.55, 0.65 - k * 0.06, 0.38, 0.22, 0.02, 0.01, 0.005);
        // rabbit-ear aerial
        ball(g, 0x3a3f4a, 0, 1.6, -0.1, 0.12, { sy: 0.6 });
        for (const s of [-1, 1]) cylinder(g, 0x8f96a3, s * 0.22, 1.95, -0.1, 0.015, 0.8, { rz: -s * 0.55 });
        let show = 0, next = 3;
        ctx.anim.push((t) => {
          if (t > next) { show = (show + 1) % shows.length; scr.material.map = shows[show]; next = t + 3 + Math.random() * 3; }
          scr.material.color.setScalar(0.85 + Math.random() * 0.15);
        });
      },
    },
    "tv-console": {
      obs: [{ cx: 0, cz: -0.2, w: 2.1, d: 0.75 }], spot: { lx: 0, lz: 1.5, yaw: PI },
      build(g, ctx) {
        block(g, woody(0xf4f4f4), 0, 0.3, -0.2, 2.0, 0.6, 0.6, 0.08);
        block(g, 0x3a3f4a, 0, 0.3, 0.11, 1.8, 0.4, 0.02, 0.02);
        block(g, shiny(0x2f3542), 0, 1.35, -0.3, 1.9, 1.1, 0.08, 0.05);
        bits(g, (p) => {
          // game boxes on the shelf, the console's vents and a power light on the TV
          for (let k = 0; k < 7; k++) slab(p, [0xe8424f, 0x4a90e2, 0x5cc84a, 0xffcf3a, 0x9b6bff, 0xff9a3a, 0xffffff][k], -0.75 + k * 0.07, 0.27, 0.0, 0.05, 0.3, 0.2, 0.01);
          slab(p, 0x9b6bff, 0.4, 0.13, 0.0, 0.36, 0.05, 0.22, 0.01);
          slab(p, 0xffcf3a, 0.42, 0.18, 0.0, 0.34, 0.05, 0.2, 0.01, { ry: 0.1 });
          for (let k = 0; k < 4; k++) slab(p, 0xb8bcc8, -0.6 + k * 0.05, 0.73, -0.15, 0.02, 0.005, 0.3, 0.002);
          bead(p, 0x5cff8a, 0.88, 0.84, -0.255, 0.012);
        });
        block(g, 0x2f3542, 0, 0.7, -0.3, 0.3, 0.2, 0.25, 0.04);
        const game = gameScreen();
        const scr = dynamic(plane(g, 1.8, 1.0, basic(game), { y: 1.35, z: -0.255 }));
        ctx.anim.push((t) => { game.offset.x = (t * 0.12) % 1; scr.material.color.setScalar(0.94 + Math.sin(t * 17) * 0.03); });
        // the console and two controllers
        block(g, 0xffffff, -0.45, 0.66, -0.15, 0.55, 0.12, 0.4, 0.05);
        ball(g, glow(0x5cc8ff, 1), -0.25, 0.67, 0.06, 0.03);
        block(g, 0xff3b3b, 0.35, 0.65, -0.05, 0.12, 0.08, 0.28, 0.04);
        block(g, 0x4a90e2, 0.55, 0.65, -0.05, 0.12, 0.08, 0.28, 0.04);
        cylinder(g, 0x2f3542, 0.0, 0.62, 0.1, 0.01, 0.6, { rz: PI / 2, shadow: false });
      },
    },
    "tv-treadmill": {
      obs: [{ cx: 0, cz: 0.4, w: 1.1, d: 2.1 }], spot: { lx: 0, lz: 2.15, yaw: PI }, stand: { lx: 0, lz: 0.45, h: 0.3 },
      build(g, ctx) {
        block(g, shiny(0x3a3f4a), 0, 0.15, 0.45, 1.0, 0.25, 2.0, 0.08);
        bits(g, (p) => {
          // a towel over the rail, and a rubber mat under it all
          slab(p, 0x5cc8b8, 0.48, 1.12, -0.05, 0.03, 0.26, 0.24, 0.01);
          slab(p, 0x5cc8b8, 0.5, 1.26, -0.05, 0.08, 0.03, 0.24, 0.01);
          slab(p, 0x2a2e36, 0, 0.01, 0.45, 1.25, 0.02, 2.25, 0.01);
        });
        const belt = canvasTexture(32, 128, (c, w, h) => {
          c.fillStyle = "#2a2e36"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#454b57"; for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 4);
        }, [1, 3]);
        dynamic(plane(g, 0.8, 1.9, toon(0xffffff, { map: belt }), { y: 0.285, z: 0.45, rx: -PI / 2 }));
        ctx.anim.push((t) => { belt.offset.y = (t * 1.6) % 1; });
        for (const sx of [-0.48, 0.48]) {
          block(g, 0x4a90e2, sx, 0.85, -0.38, 0.12, 1.4, 0.12, 0.05, { rx: 0.15 });
          block(g, 0xff7a59, sx, 1.22, 0.05, 0.1, 0.1, 0.9, 0.05); // handrails
          block(g, 0x3a3f4a, sx, 0.2, 0.45, 0.06, 0.18, 2.0, 0.03);
        }
        block(g, 0x4a90e2, 0, 1.55, -0.42, 0.9, 0.4, 0.2, 0.06, { rx: -0.4 });
        const disp = canvasTexture(64, 32, (c, w, h) => { c.fillStyle = "#14213d"; c.fillRect(0, 0, w, h); c.fillStyle = "#5cff8a"; c.font = "bold 16px monospace"; c.fillText("5.2km", 6, 21); });
        plane(g, 0.5, 0.22, basic(disp), { y: 1.6, z: -0.31, rx: -0.4 });
        cylinder(g, 0xffffff, 0.35, 1.32, -0.28, 0.06, 0.2); // water bottle
      },
    },
    "tv-piano": {
      obs: [{ cx: 0, cz: -0.05, w: 2.1, d: 1.05 }], spot: { lx: 0, lz: 1.2, yaw: PI },
      build(g) {
        const black = shiny(0x2a2430);
        block(g, black, 0, 0.85, -0.25, 2.0, 1.7, 0.6, 0.08);
        bits(g, (p) => {
          // gold pedals, a little bench cushion edge and a metronome on top
          for (let k = 0; k < 3; k++) slab(p, 0xd9a441, -0.15 + k * 0.15, 0.06, 0.15, 0.06, 0.03, 0.14, 0.01);
          slab(p, 0x3a3440, 0, 0.3, 0.02, 1.7, 0.5, 0.02, 0.02);
          put(p, G.cone(4), toon(0x9a6a3c), { x: 0.65, y: 1.88, z: -0.25, s: 0.12, sy: 0.24, ry: PI / 4 });
          slab(p, 0xd9a441, 0.65, 1.92, -0.17, 0.01, 0.16, 0.01, 0.002, { rz: 0.3 });
        });
        block(g, black, 0, 0.75, 0.2, 2.0, 0.12, 0.6, 0.04);
        const keys = canvasTexture(256, 32, (c, w, h) => {
          c.fillStyle = "#fffdf5"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#cfc8bc"; for (let x = 0; x < w; x += 10.6) c.fillRect(x, 0, 1.2, h);
          c.fillStyle = "#1a1a1a";
          for (let k = 0; k < 24; k++) if (![2, 6].includes(k % 7)) c.fillRect(k * 10.6 + 7, 0, 6, h * 0.6);
        });
        plane(g, 1.85, 0.3, toon(0xffffff, { map: keys }), { y: 0.82, z: 0.32, rx: -PI / 2 });
        block(g, black, 0, 0.88, 0.48, 2.0, 0.14, 0.05, 0.02);
        for (const sx of [-0.92, 0.92]) block(g, black, sx, 0.4, 0.3, 0.1, 0.8, 0.12, 0.03);
        block(g, 0xffffff, 0.1, 1.32, 0.07, 0.6, 0.42, 0.03, 0.01, { rx: -0.2 }); // sheet music
        for (let k = 0; k < 4; k++) block(g, 0x2a2430, 0.1, 1.2 + k * 0.08, 0.09, 0.45, 0.01, 0.01, 0.002, { rx: -0.2 });
        block(g, 0xd9a441, 0, 1.73, -0.25, 2.05, 0.06, 0.65, 0.02);
        cylinder(g, 0xffffff, -0.7, 1.85, -0.3, 0.06, 0.2);
        ball(g, glow(0xffc04d, 1), -0.7, 2.0, -0.3, 0.05, { sy: 1.6 });
      },
    },

    // ===== rugs (flat, under the table) =====
    "rug-none": { build() {} },
    "rug-round": {
      build(g) {
        const tex = canvasTexture(256, 256, (c, w, h) => {
          const cols = ["#ff8a4c", "#ffcf5a", "#ffb07a", "#fff1dc", "#ff8a4c"];
          for (let i = 0; i < cols.length; i++) { c.fillStyle = cols[i]; c.beginPath(); c.arc(128, 128, 128 - i * 24, 0, TAU); c.fill(); }
        });
        put(g, new THREE.CircleGeometry(2.0, 48), toon(0xffffff, { map: tex }), { y: 0.012, rx: -PI / 2, shadow: false });
      },
    },
    "rug-stripes": {
      build(g) {
        const tex = canvasTexture(256, 192, (c, w, h) => {
          c.fillStyle = "#ffffff"; roundRect(c, 0, 0, w, h, 40); c.fill();
          const cols = ["#ff5a64", "#ff9a3a", "#ffd23f", "#5cc84a", "#4a90e2", "#9b6bff"];
          c.save(); roundRect(c, 10, 10, w - 20, h - 20, 32); c.clip();
          cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(10, 10 + i * (h - 20) / 6, w - 20, (h - 20) / 6 + 1); });
          c.restore();
        });
        put(g, new THREE.PlaneGeometry(4.0, 3.0), toon(0xffffff, { map: tex, transparent: true }), { y: 0.012, rx: -PI / 2, shadow: false });
      },
    },
    "rug-fancy": {
      build(g) {
        const tex = canvasTexture(256, 176, (c, w, h) => {
          c.fillStyle = "#b8213a"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "#e8b84a"; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
          c.lineWidth = 3; c.strokeRect(22, 22, w - 44, h - 44);
          c.fillStyle = "#e8b84a";
          c.save(); c.translate(w / 2, h / 2); c.rotate(PI / 4); c.fillRect(-34, -34, 68, 68); c.restore();
          c.fillStyle = "#8a1428"; c.save(); c.translate(w / 2, h / 2); c.rotate(PI / 4); c.fillRect(-22, -22, 44, 44); c.restore();
          c.fillStyle = "#e8b84a";
          for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) { c.beginPath(); c.arc(x, y, 9, 0, TAU); c.fill(); }
        });
        put(g, new THREE.PlaneGeometry(4.4, 3.0), toon(0xffffff, { map: tex }), { y: 0.012, rx: -PI / 2, shadow: false });
        const tassels = [];
        for (const sx of [-1, 1]) for (let k = 0; k < 12; k++) tassels.push({ x: sx * 2.27, y: 0.02, z: -1.38 + k * 0.25, sx: 0.14, sy: 0.02, sz: 0.05 });
        scatter(g, G.box(), toon(0xe8b84a), tassels);
      },
    },

    // ===== lamps =====
    "lamp-basic": {
      // a floor lamp standing by the left wall, between the bed and the sofa
      at: { x: -5.45, z: -0.55 }, obs: [{ cx: 0, cz: 0, r: 0.32 }],
      build(g) {
        cylinder(g, shiny(0x8f96a3), 0, 0.04, 0, 0.3, 0.08);
        cylinder(g, shiny(0x8f96a3), 0, 1.2, 0, 0.035, 2.3);
        ball(g, glow(0xfff1b8, 1), 0, 2.25, 0, 0.13);
        put(g, G.taper(0.25, 0.45), toon(0xfff1dc, { emissive: 0xffe0a0, emissiveIntensity: 0.35 }), { y: 2.35, sy: 0.5 });
        bits(g, (p) => {
          // a foot switch, a collar on the pole, trim round the shade and a pull chain with a bead
          cylinder(p, 0x5a606e, 0.16, 0.1, 0.0, 0.05, 0.04);
          for (const y of [0.12, 1.15, 2.08]) cylinder(p, 0xd9a441, 0, y, 0, 0.05, 0.04);
          for (const [y, r] of [[2.11, 0.45], [2.59, 0.25]]) put(p, lowTorus(r, 0.018), toon(0xd9a441), { y, rx: PI / 2 });
          cylinder(p, 0xd9a441, 0.18, 1.98, 0, 0.004, 0.24);
          bead(p, 0xd9a441, 0.18, 1.85, 0, 0.022);
        });
      },
    },
    "lamp-lava": {
      obs: [], spot: { wx: -1.55, wz: -2.85, toward: true },
      build(g, ctx) {
        // (the bedside table it stands on is always there)
        const y0 = 0.72;
        put(g, G.taper(0.09, 0.17), toon(0x8f96a3), { y: y0 + 0.12, sy: 0.24 });
        const glass = put(g, G.taper(0.07, 0.15), toon(0xff8ad8, { transparent: true, opacity: 0.55, emissive: 0xff5ab8, emissiveIntensity: 0.5 }), { y: y0 + 0.55, sy: 0.65, shadow: false });
        dynamic(glass);
        put(g, G.taper(0.05, 0.08), toon(0x8f96a3), { y: y0 + 0.94, sy: 0.14 });
        const blobs = [];
        for (let i = 0; i < 3; i++) blobs.push(dynamic(ball(g, glow(0xffcf3a, 0.9), 0, y0 + 0.4, 0, 0.055, { shadow: false })));
        ctx.anim.push((t) => blobs.forEach((b, i) => {
          const k = (Math.sin(t * 0.5 + i * 2.1) + 1) / 2;
          b.position.set(Math.sin(t * 0.7 + i) * 0.02, y0 + 0.32 + k * 0.48, Math.cos(t * 0.6 + i) * 0.02);
          b.scale.set(0.05 + Math.sin(t * 1.3 + i) * 0.012, 0.06 + Math.cos(t * 1.1 + i) * 0.02, 0.05);
        }));
      },
    },
    "lamp-chandelier": {
      at: { x: 0.3, z: 1.0 }, obs: [], spot: { wx: -1.5, wz: 2.75, toward: true },
      build(g, ctx) {
        // it hangs on a golden chain from the ceiling (which you can't see: it's a dollhouse),
        // so the chain stops where the walls end
        const cy = ROOM.h - 1.2;
        cylinder(g, 0xd9a441, 0, (cy + ROOM.h) / 2, 0, 0.022, ROOM.h - cy, { shadow: false });
        put(g, G.torus(0.75, 0.05), toon(0xffcf3a), { y: cy, rx: PI / 2, shadow: false });
        ball(g, 0xffcf3a, 0, cy - 0.05, 0, 0.18, { shadow: false });
        put(g, G.cone(), toon(0xffcf3a), { y: cy - 0.3, s: 0.12, sy: 0.3, rx: PI, shadow: false });
        const flames = [], crystals = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const x = Math.cos(a) * 0.75, z = Math.sin(a) * 0.75;
          cylinder(g, 0xffcf3a, x / 2, cy - 0.02, z / 2, 0.02, 0.75, { rz: PI / 2, ry: -a, shadow: false });
          cylinder(g, 0xffcf3a, x, cy + 0.05, z, 0.07, 0.04, { shadow: false });
          cylinder(g, 0xfffdf5, x, cy + 0.2, z, 0.045, 0.26, { shadow: false });
          flames.push(dynamic(ball(g, glow(0xffb02e, 1.2), x, cy + 0.38, z, 0.05, { sy: 1.8, shadow: false })));
          const ca = a + PI / 6;
          crystals.push(dynamic(put(g, G.cone(4), toon(0xdff6ff, { emissive: 0xbfeaff, emissiveIntensity: 0.3 }), { x: Math.cos(ca) * 0.6, y: cy - 0.25, z: Math.sin(ca) * 0.6, s: 0.07, sy: 0.18, rx: PI, shadow: false })));
          cylinder(g, 0xdff6ff, Math.cos(ca) * 0.6, cy - 0.12, Math.sin(ca) * 0.6, 0.006, 0.18, { shadow: false });
        }
        ctx.anim.push((t) => {
          flames.forEach((f, i) => { f.scale.set(0.05, 0.08 + Math.sin(t * 13 + i * 3) * 0.02, 0.05); });
          crystals.forEach((c, i) => { c.material.emissiveIntensity = 0.2 + Math.max(0, Math.sin(t * 3 + i * 1.7)) * 0.9; });
        });
      },
    },

    // ===== plants (front-left corner) =====
    "plant-none": { build() {} },
    "plant-pot": {
      obs: [{ cx: 0, cz: 0, r: 0.5 }], spot: { wx: -3.75, wz: 3.55, toward: true },
      build(g, ctx) {
        put(g, G.taper(0.45, 0.32), toon(0xe0784a), { y: 0.35, sy: 0.7 });
        cylinder(g, 0xd06a3e, 0, 0.7, 0, 0.47, 0.1);
        disc(g, toon(0x6b4423), 0, 0.72, 0, 0.42);
        bits(g, (p) => {
          // a painted band round the pot, a saucer, and pebbles on the soil
          cylinder(p, 0xfff1dc, 0, 0.42, 0, 0.405, 0.06);
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; bead(p, 0xfff1dc, Math.cos(a) * 0.39, 0.3, Math.sin(a) * 0.39, 0.03); }
          cylinder(p, 0xc85e34, 0, 0.02, 0, 0.42, 0.04);
          for (let k = 0; k < 6; k++) { const a = k * 2.4; ball(p, [0xd8d0c0, 0xb8b0a0][k % 2], Math.cos(a) * 0.3, 0.73, Math.sin(a) * 0.3, 0.04, { sy: 0.5 }); }
        });
        const leaves = dynamic(group(g, 0, 0.7, 0));
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          put(leaves, G.sphere(), toon(i % 2 ? 0x46b04a : 0x5cc84a), { x: Math.cos(a) * 0.3, y: 0.55 + (i % 3) * 0.2, z: Math.sin(a) * 0.3, sx: 0.18, sy: 0.6, sz: 0.18, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
        }
        if (FINE) {
          // a midrib down each leaf, some smaller leaves in between, and a couple of curly new shoots
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * TAU;
            put(leaves, G.lowSphere(), toon(0x8fdc6a), { x: Math.cos(a) * 0.34, y: 0.55 + (i % 3) * 0.2, z: Math.sin(a) * 0.34, sx: 0.02, sy: 0.55, sz: 0.02, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
            const b = a + TAU / 18;
            put(leaves, G.lowSphere(), toon([0x3a9a3e, 0x7fd65c, 0x5cb840][i % 3]), { x: Math.cos(b) * 0.2, y: 0.35 + (i % 2) * 0.12, z: Math.sin(b) * 0.2, sx: 0.11, sy: 0.32, sz: 0.11, rx: Math.sin(b) * 0.9, rz: -Math.cos(b) * 0.9 });
          }
          for (const s of [-1, 1]) put(leaves, lowTorus(0.06, 0.015), toon(0x8fdc6a), { x: s * 0.08, y: 1.15, z: 0.05 * s, ry: s, rx: 0.4 });
        }
        ctx.anim.push((t) => { leaves.rotation.z = Math.sin(t * 1.3) * 0.04; leaves.rotation.x = Math.cos(t * 1.1) * 0.03; });
      },
    },
    "plant-cactus": {
      obs: [{ cx: 0, cz: 0, r: 0.5 }], spot: { wx: -3.75, wz: 3.55, toward: true },
      build(g, ctx) {
        put(g, G.taper(0.42, 0.32), toon(0x4a90e2), { y: 0.3, sy: 0.6 });
        cylinder(g, 0xffffff, 0, 0.6, 0, 0.44, 0.08);
        disc(g, toon(0xe8c98a), 0, 0.62, 0, 0.4);
        const c = dynamic(group(g, 0, 0.6, 0));
        const green = toon(0x4fae5a);
        put(c, G.capsule(), green, { y: 0.75, sx: 0.5, sy: 0.85, sz: 0.5 });
        put(c, G.capsule(), green, { x: 0.38, y: 0.85, sx: 0.22, sy: 0.32, sz: 0.22, rz: PI / 2 });
        put(c, G.capsule(), green, { x: 0.52, y: 1.1, sx: 0.22, sy: 0.4, sz: 0.22 });
        put(c, G.capsule(), green, { x: -0.36, y: 0.65, sx: 0.2, sy: 0.3, sz: 0.2, rz: PI / 2 });
        put(c, G.capsule(), green, { x: -0.48, y: 0.85, sx: 0.2, sy: 0.32, sz: 0.2 });
        const spines = [];
        for (let i = 0; i < 26; i++) { const a = i * 2.4, y = 0.35 + (i / 26) * 0.9; spines.push({ x: Math.cos(a) * 0.25, y, z: Math.sin(a) * 0.25, s: 0.025 }); }
        scatter(c, G.lowSphere(), toon(0xfff6c2), spines);
        for (let i = 0; i < 5; i++) ball(c, 0xff6fa5, Math.cos(i * 1.26) * 0.08, 1.45, Math.sin(i * 1.26) * 0.08, 0.07, { sy: 0.6 });
        ball(c, 0xffe25a, 0, 1.48, 0, 0.05);
        // a happy cactus face
        ball(c, 0x2a2430, -0.09, 0.95, 0.24, 0.025);
        ball(c, 0x2a2430, 0.09, 0.95, 0.24, 0.025);
        ball(c, 0xff8ab8, 0, 0.87, 0.245, 0.03, { sx: 1.5, sy: 0.6 });
        ctx.anim.push((t) => { c.rotation.z = Math.sin(t * 1.6) * 0.04; });
      },
    },
    "plant-tree": {
      obs: [{ cx: 0, cz: 0, r: 0.6 }], spot: { wx: -3.6, wz: 3.45, toward: true },
      build(g, ctx) {
        put(g, G.taper(0.55, 0.42), toon(0xfff1dc), { y: 0.4, sy: 0.8 });
        cylinder(g, shiny(0xd9a441), 0, 0.6, 0, 0.53, 0.06);
        disc(g, toon(0x6b4423), 0, 0.81, 0, 0.5);
        put(g, G.taper(0.09, 0.14), woody(0x9a6a3c), { y: 1.9, sy: 2.2 });
        bits(g, (p) => {
          // bark rings on the trunk, a side branch, and moss on the soil
          for (let k = 0; k < 6; k++) put(p, lowTorus(0.13 - k * 0.006, 0.012), toon(0x7a5230), { y: 1.0 + k * 0.32, rx: PI / 2 + (k % 2 ? 0.1 : -0.1) });
          rod(p, 0x9a6a3c, 0, 2.2, 0, 0.42, 2.62, 0.1, 0.035);
          for (let k = 0; k < 7; k++) { const a = k * 0.9; ball(p, k % 2 ? 0x5cb840 : 0x7fd65c, Math.cos(a) * 0.32, 0.83, Math.sin(a) * 0.32, 0.08, { sy: 0.4 }); }
        });
        const crown = dynamic(group(g, 0, 3.0, 0));
        ball(crown, 0x5cc84a, 0, 0.1, 0, 0.75);
        ball(crown, 0x4fbf47, -0.55, -0.15, 0.15, 0.5);
        ball(crown, 0x4fbf47, 0.55, -0.1, -0.1, 0.52);
        ball(crown, 0x7fdc5c, 0.1, 0.5, 0.3, 0.45);
        if (FINE) {
          // little leaf tufts poking out all over the crown, in a few greens
          const r = seeded(31);
          for (let i = 0; i < 26; i++) {
            const a = r() * TAU, e = (r() - 0.3) * 1.2, d = 0.72 + r() * 0.12;
            const x = Math.cos(a) * Math.cos(e) * d, y = 0.1 + Math.sin(e) * d * 0.9, z = Math.sin(a) * Math.cos(e) * d;
            put(crown, G.lowSphere(), toon([0x46b04a, 0x6fd25a, 0x8fe06a, 0x3f9e40][i % 4]), { x, y, z, sx: 0.16, sy: 0.08, sz: 0.11, rx: r() * 2, ry: a, rz: r() * 2 });
          }
        }
        for (let i = 0; i < 5; i++) ball(crown, 0xffa21c, Math.cos(i * 1.3) * 0.65, -0.1 + (i % 2) * 0.3, Math.sin(i * 1.3) * 0.65, 0.08);
        ctx.anim.push((t) => { crown.rotation.z = Math.sin(t * 0.9) * 0.03; });
      },
    },

    // ===== wall art (on the back wall) =====
    "art-none": { build() {} },
    "art-sunset": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      build(g) {
        const tex = canvasTexture(256, 180, (c, w, h) => {
          const gr = c.createLinearGradient(0, 0, 0, h * 0.65);
          gr.addColorStop(0, "#5a3a8a"); gr.addColorStop(0.5, "#ff7a59"); gr.addColorStop(1, "#ffd166");
          c.fillStyle = gr; c.fillRect(0, 0, w, h);
          c.fillStyle = "#fff2a8"; c.beginPath(); c.arc(w / 2, h * 0.62, 34, PI, 0); c.fill();
          c.fillStyle = "#2f7fb8"; c.fillRect(0, h * 0.62, w, h);
          c.fillStyle = "rgba(255,230,150,0.7)"; for (let k = 0; k < 6; k++) c.fillRect(w / 2 - 30 + k * 4, h * 0.66 + k * 9, 60 - k * 8, 4);
          c.fillStyle = "#3a2a4a"; c.beginPath(); c.moveTo(20, h); c.quadraticCurveTo(30, h * 0.5, 60, h * 0.42); c.lineTo(64, h * 0.46); c.quadraticCurveTo(38, h * 0.55, 34, h); c.fill();
          for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(60 + Math.cos(k * 1.25) * 18, h * 0.42 + Math.sin(k * 1.25) * 8, 22, 6, k * 1.25, 0, TAU); c.fill(); }
        });
        block(g, woody(0xc98b4a), 0, 0, 0, 2.0, 1.45, 0.1, 0.05);
        plane(g, 1.8, 1.25, toon(0xffffff, { map: tex }), { z: 0.06 });
        bits(g, (p) => {
          // an inner gold lip, a nail and the picture wire above it
          for (const [x, y, w, h] of [[0, 0.64, 1.82, 0.03], [0, -0.64, 1.82, 0.03], [0.9, 0, 0.03, 1.28], [-0.9, 0, 0.03, 1.28]]) slab(p, 0xd9a441, x, y, 0.06, w, h, 0.02, 0.008);
          bead(p, 0x8f96a3, 0, 0.98, -0.02, 0.03);
          for (const s of [-1, 1]) rod(p, 0x8f96a3, 0, 0.97, -0.03, s * 0.6, 0.7, -0.03, 0.006);
        });
      },
    },
    "art-poster": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      build(g) {
        const tex = canvasTexture(180, 256, (c, w, h) => {
          c.fillStyle = "#2e8b57"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 3; c.strokeRect(20, 150, w - 40, 90); c.beginPath(); c.arc(w / 2, 150, 30, 0, PI); c.stroke();
          c.fillStyle = "#ffffff"; c.beginPath(); c.arc(w / 2, 100, 38, 0, TAU); c.fill();
          c.fillStyle = "#222"; c.beginPath(); c.arc(w / 2, 100, 13, 0, TAU); c.fill();
          for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU - PI / 2; c.beginPath(); c.arc(w / 2 + Math.cos(a) * 28, 100 + Math.sin(a) * 28, 8, 0, TAU); c.fill(); }
          c.fillStyle = "#ffd23f"; c.font = "bold 44px 'Nunito', sans-serif"; c.textAlign = "center"; c.fillText("GOAL!", w / 2, 46);
          c.fillStyle = "#fff"; c.font = "bold 18px 'Nunito', sans-serif"; c.fillText("MII CUP CHAMPIONS", w / 2, 225);
        });
        plane(g, 1.3, 1.85, toon(0xffffff, { map: tex }), { z: 0.03, rz: 0.03 });
        // a curling corner
        bits(g, (p) => put(p, G.cone(3), toon(0xe8e4d8), { x: 0.61, y: -0.88, z: 0.045, s: 0.07, sy: 0.08, sz: 0.01, rz: 2.4 }));
        for (const [x, y] of [[-0.6, 0.86], [0.6, 0.86], [-0.6, -0.86], [0.6, -0.86]]) block(g, 0xfff6c2, x, y, 0.04, 0.22, 0.08, 0.01, 0.005, { rz: x * y > 0 ? 0.7 : -0.7 });
      },
    },
    "art-portrait": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      // The home's own Mii, painted in a golden frame. The picture comes from the
      // app (ctx.portrait gives the Mii's portrait picture, see portraitSource):
      // until it's ready, the canvas shows a soft "sketch" and is filled in after.
      build(g, ctx) {
        const name = (ctx.record && ctx.record.name) || "Me";
        const cv = document.createElement("canvas");
        cv.width = 192; cv.height = 240;
        const c = cv.getContext("2d");
        const tex = new THREE.CanvasTexture(cv);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = 8;
        const paint = (img) => {
          const w = cv.width, h = cv.height;
          const gr = c.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h / 2, 150);
          gr.addColorStop(0, "#d98a8f"); gr.addColorStop(1, "#6a2a3a");
          c.fillStyle = gr; c.fillRect(0, 0, w, h);
          // brush strokes, like an oil painting
          const r = seeded(7);
          for (let i = 0; i < 40; i++) {
            c.strokeStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(60,10,30,0.08)"; c.lineWidth = 6 + r() * 6;
            const x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 30 * (r() - 0.5), y + 30 * (r() - 0.5)); c.stroke();
          }
          if (img) {
            // the portrait is a square head-and-shoulders picture with a clear background
            const s = w * 1.12;
            c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
            c.drawImage(img, (w - s) / 2, h - s * 0.98, s, s);
            // a soft varnish glow over the top
            const v = c.createLinearGradient(0, 0, w, h);
            v.addColorStop(0, "rgba(255,240,210,0.12)"); v.addColorStop(0.5, "rgba(255,255,255,0)"); v.addColorStop(1, "rgba(80,20,40,0.12)");
            c.fillStyle = v; c.fillRect(0, 0, w, h);
          } else {
            // still being painted: a pale pencil sketch of a Mii
            c.strokeStyle = "rgba(255,240,230,0.6)"; c.lineWidth = 3; c.setLineDash([7, 6]);
            c.beginPath(); c.ellipse(w / 2, 110, 50, 58, 0, 0, TAU); c.stroke();
            c.beginPath(); c.ellipse(w / 2, h + 20, 74, 66, 0, PI, 0); c.stroke();
            c.setLineDash([]);
            c.fillStyle = "rgba(255,240,230,0.7)"; c.textAlign = "center"; c.textBaseline = "middle";
            c.font = "bold 34px 'Nunito', sans-serif"; c.fillText("🎨", w / 2, 112);
          }
          tex.needsUpdate = true;
        };
        paint(null);
        // ask for the picture now and then: it may not be drawn yet, or the Mii's look may change
        const src = ctx.portrait;
        if (src) {
          let last = "", next = 0;
          const check = (t) => {
            if (t < next) return;
            next = t + (last ? 2 : 0.4);
            let url = "";
            try { url = src() || ""; } catch (e) { url = ""; }
            if (!url || url === last) return;
            last = url;
            const img = new Image();
            img.onload = () => { if (last === url) paint(img); };
            img.src = url;
          };
          check(0);
          ctx.anim.push(check);
        }
        const gold = shiny(0xffcf3a);
        block(g, gold, 0, 0, 0, 1.45, 1.8, 0.12, 0.08);
        block(g, shiny(0xd9a441), 0, 0, 0.04, 1.25, 1.6, 0.06, 0.04);
        bits(g, (p) => {
          // carved beads round the frame
          for (let k = 0; k < 9; k++) for (const s of [-1, 1]) { bead(p, 0xffe27a, -0.56 + k * 0.14, s * 0.86, 0.065, 0.025); bead(p, 0xffe27a, s * 0.69, -0.72 + k * 0.18, 0.065, 0.025); }
        });
        plane(g, 1.12, 1.4, toon(0xffffff, { map: tex }), { z: 0.08 });
        for (const [x, y] of [[-0.72, 0.9], [0.72, 0.9], [-0.72, -0.9], [0.72, -0.9]]) ball(g, gold, x, y, 0.06, 0.1);
        ball(g, gold, 0, 1.0, 0.04, 0.16, { sz: 0.5 });
        const plaque = canvasTexture(192, 48, (c2, w, h) => {
          c2.fillStyle = "#d9a441"; c2.fillRect(0, 0, w, h);
          c2.fillStyle = "#4a3010"; c2.textAlign = "center"; c2.textBaseline = "middle"; fitFont(c2, name, w - 20, 30); c2.fillText(name, w / 2, h / 2 + 2);
        });
        plane(g, 0.8, 0.2, toon(0xffffff, { map: plaque }), { y: -1.08, z: 0.04 });
      },
    },
    // ===== special things (back-right corner) =====
    "special-none": { build() {} },
    "special-fishtank": {
      obs: [{ cx: 0, cz: -0.6, w: 2.3, d: 0.9 }], spot: { lx: 0, lz: 0.55, yaw: PI },
      build(g, ctx) {
        block(g, woody(0x8a5a3a), 0, 0.42, -0.6, 2.2, 0.84, 0.8, 0.06);
        for (const sx of [-0.55, 0.55]) ball(g, 0xffcf5a, sx, 0.45, -0.19, 0.05);
        block(g, shiny(0x2f3542), 0, 2.08, -0.6, 2.18, 0.1, 0.8, 0.03);
        bits(g, (p) => {
          // the cabinet's doors, the tank's frame, pebbles, a treasure chest and a little castle
          for (const sx of [-0.55, 0.55]) slab(p, 0x6b4423, sx, 0.42, -0.2, 0.98, 0.68, 0.02, 0.02);
          for (const [x, z] of [[-1.05, -0.97], [1.05, -0.97], [-1.05, -0.23], [1.05, -0.23]]) slab(p, 0x2f3542, x, 1.45, z, 0.04, 1.15, 0.04, 0.01);
          slab(p, 0x2f3542, 0, 0.9, -0.6, 2.18, 0.05, 0.8, 0.01);
          const r = seeded(19);
          for (let k = 0; k < 18; k++) ball(p, [0xb8b0a0, 0x8a8aa0, 0xd8c8a0, 0xff9ec7][k % 4], -0.95 + r() * 1.9, 1.0, -0.9 + r() * 0.6, 0.03 + r() * 0.025, { sy: 0.6 });
          slab(p, 0x8a5a3a, -0.35, 1.06, -0.5, 0.2, 0.12, 0.14, 0.02);
          slab(p, 0xffcf3a, -0.35, 1.13, -0.5, 0.21, 0.03, 0.15, 0.01);
          slab(p, 0xc8c0d8, 0.25, 1.15, -0.85, 0.22, 0.3, 0.16, 0.02);
          for (let k = 0; k < 3; k++) slab(p, 0xc8c0d8, 0.17 + k * 0.08, 1.33, -0.85, 0.05, 0.06, 0.16, 0.01);
          slab(p, 0x3a3f4a, 0.25, 1.08, -0.765, 0.08, 0.12, 0.01, 0.02);
        });
        put(g, G.box(), toon(0x8fd8ff, { transparent: true, opacity: 0.35, emissive: 0x2a8acc, emissiveIntensity: 0.25 }), { y: 1.45, z: -0.6, sx: 2.1, sy: 1.15, sz: 0.74, shadow: false });
        block(g, 0xf3dd9a, 0, 0.94, -0.6, 2.05, 0.12, 0.7, 0.02);
        for (let k = 0; k < 8; k++) ball(g, [0xff9ec7, 0xffffff, 0x8fd3ff][k % 3], -0.9 + k * 0.25, 1.0, -0.45 - (k % 2) * 0.25, 0.05);
        block(g, 0xb3ada0, 0.6, 1.2, -0.75, 0.35, 0.4, 0.25, 0.04);
        put(g, G.cone(4), toon(0xff7a59), { x: 0.6, y: 1.5, z: -0.75, s: 0.17, sy: 0.25, ry: PI / 4 });
        const weeds = [];
        for (let k = 0; k < 4; k++) {
          const w = dynamic(group(g, -0.85 + k * 0.35 + (k > 1 ? 0.7 : 0), 0.98, -0.85));
          put(w, G.capsule(), toon(0x3fae5a), { y: 0.3, sx: 0.07, sy: 0.4, sz: 0.07 });
          weeds.push(w);
        }
        const fish = [];
        for (let i = 0; i < 4; i++) {
          const f = dynamic(group(g, 0, 1.4, -0.6));
          const col = [0xff8a2a, 0x4ab8ff, 0xffd23f, 0xff6fa5][i];
          ball(f, col, 0, 0, 0, 0.11, { sx: 1.3, sz: 0.5 });
          put(f, G.cone(4), toon(col), { x: -0.16, s: 0.08, sy: 0.12, rz: PI / 2, sz: 0.04 });
          ball(f, 0x222222, 0.08, 0.03, 0.04, 0.018);
          fish.push(f);
        }
        const bubbles = [];
        for (let i = 0; i < 5; i++) bubbles.push(dynamic(ball(g, toon(0xffffff, { transparent: true, opacity: 0.7 }), 0.85, 1.0, -0.6, 0.03, { shadow: false })));
        ctx.anim.push((t) => {
          fish.forEach((f, i) => {
            const sp = 0.45 + i * 0.12, ph = t * sp + i * 1.7;
            const x = Math.sin(ph) * 0.8;
            f.position.set(x, 1.2 + i * 0.15 + Math.sin(t * 1.3 + i) * 0.06, -0.6 + Math.cos(ph * 1.7) * 0.15);
            f.rotation.y = Math.cos(ph) > 0 ? 0 : PI;
          });
          weeds.forEach((w, i) => { w.rotation.z = Math.sin(t * 1.5 + i) * 0.2; });
          bubbles.forEach((b, i) => { const k = (t * 0.5 + i / 5) % 1; b.position.set(0.85 + Math.sin(t * 4 + i) * 0.03, 1.0 + k * 0.95, -0.6); });
        });
      },
    },
    "special-drums": {
      obs: [{ cx: 0, cz: 0.85, w: 2.2, d: 1.0 }], spot: { lx: 0, lz: -0.42, yaw: 0 },
      build(g, ctx) {
        const shell = shiny(0xff3b5a), chrome = shiny(0xdfe4ea);
        bits(g, (p) => {
          // tension lugs round the bass drum, a stool and a pair of sticks
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; slab(p, 0xdfe4ea, Math.cos(a) * 0.46, 0.48 + Math.sin(a) * 0.46, 0.9, 0.04, 0.04, 0.4, 0.01); }
          cylinder(p, 0x2f3542, 0, 0.55, -0.0, 0.22, 0.08);
          cylinder(p, 0xb8bcc8, 0, 0.27, 0.0, 0.03, 0.5);
          for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; rod(p, 0xb8bcc8, 0, 0.1, 0, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, 0.015); }
          for (const s of [-1, 1]) rod(p, 0xe8c896, 0.2 + s * 0.05, 1.2, 0.68, 0.32 + s * 0.08, 1.22, 0.3, 0.012);
        });
        const logo = canvasTexture(128, 128, (c, w, h) => {
          c.fillStyle = "#ffffff"; c.beginPath(); c.arc(64, 64, 62, 0, TAU); c.fill();
          c.fillStyle = "#ff3b5a"; c.font = "bold 40px 'Nunito', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("MII", 64, 54);
          c.font = "bold 22px 'Nunito', sans-serif"; c.fillText("ROCK", 64, 88);
        });
        cylinder(g, shell, 0, 0.48, 0.9, 0.46, 0.45, { rx: PI / 2 });
        put(g, G.circle(), toon(0xffffff, { map: logo }), { y: 0.48, z: 1.13, s: 0.42, shadow: false });
        for (const s of [-1, 1]) {
          cylinder(g, shell, s * 0.28, 1.05, 0.8, 0.2, 0.2, { rx: 0.35 });
          cylinder(g, 0xffffff, s * 0.28, 1.15, 0.77, 0.19, 0.02, { rx: 0.35 });
        }
        cylinder(g, shell, -0.65, 0.78, 0.45, 0.24, 0.2, { rx: 0.2 });
        cylinder(g, 0xffffff, -0.65, 0.89, 0.43, 0.23, 0.02, { rx: 0.2 });
        cylinder(g, chrome, -0.65, 0.35, 0.45, 0.025, 0.7);
        cylinder(g, shell, 0.7, 0.5, 0.5, 0.26, 0.55);
        cylinder(g, 0xffffff, 0.7, 0.78, 0.5, 0.25, 0.02);
        const cym = [];
        for (const [x, y, z] of [[-0.95, 1.2, 0.75], [0.9, 1.55, 1.05]]) {
          cylinder(g, chrome, x, y / 2, z, 0.02, y);
          const c = dynamic(group(g, x, y, z));
          put(c, G.taper(0.02, 0.32), toon(0xffcf3a), { sy: 0.03 });
          cym.push(c);
        }
        ctx.anim.push((t) => cym.forEach((c, i) => { c.rotation.x = Math.sin(t * 7 + i * 2) * 0.08; c.rotation.z = Math.cos(t * 6 + i) * 0.06; }));
      },
    },
    "special-telescope": {
      obs: [{ cx: -0.2, cz: -0.3, r: 0.6 }], spot: { lx: 0.35, lz: 0.85, toward: { lx: -0.05, lz: 0.05 } },
      build(g, ctx) {
        const tp = dynamic(group(g, -0.2, 1.45, -0.3));
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + 0.4;
          cylinder(g, 0x9a6a3c, -0.2 + Math.cos(a) * 0.28, 0.72, -0.3 + Math.sin(a) * 0.28, 0.03, 1.5, { rx: -Math.sin(a) * 0.38, rz: Math.cos(a) * 0.38 });
        }
        ball(g, 0x3a3f4a, -0.2, 1.45, -0.3, 0.09);
        const inner = group(tp, 0, 0, 0);
        inner.rotation.x = -0.7; // tipped up toward the sky
        cylinder(inner, 0x4a5aa8, 0, 0, -0.3, 0.12, 1.3, { rx: PI / 2 });
        cylinder(inner, 0xffcf3a, 0, 0, -0.95, 0.15, 0.12, { rx: PI / 2 });
        cylinder(inner, 0x2f3542, 0, 0, 0.4, 0.05, 0.2, { rx: PI / 2 });
        cylinder(inner, 0xdfe4ea, 0, 0.17, -0.4, 0.035, 0.45, { rx: PI / 2 });
        tp.rotation.y = 0.3;
        ctx.anim.push((t) => { tp.rotation.y = 0.3 + Math.sin(t * 0.2) * 0.25; });
      },
    },
    "special-plushies": {
      obs: [{ cx: 0.3, cz: -0.35, r: 0.95 }], spot: { lx: -0.95, lz: 0.95, toward: { lx: 0.3, lz: -0.35 } },
      build(g, ctx) {
        // a big teddy, a bunny, a frog, a duck and a penguin, all piled up
        const pile = group(g, 0.3, 0, -0.35);
        ball(pile, 0xffd6e6, 0, 0.18, 0, 0.75, { sy: 0.3 });
        const bear = group(pile, 0, 0.25, -0.2, 0.2);
        ball(bear, 0xc98b4a, 0, 0.5, 0, 0.45, { sy: 0.9 });
        ball(bear, 0xc98b4a, 0, 1.1, 0, 0.34);
        for (const s of [-1, 1]) { ball(bear, 0xc98b4a, s * 0.26, 1.38, 0, 0.12); ball(bear, 0xc98b4a, s * 0.42, 0.55, 0.12, 0.15); }
        ball(bear, 0xf5d4a8, 0, 1.03, 0.28, 0.14, { sz: 0.6 });
        ball(bear, 0x2a2430, 0, 1.08, 0.36, 0.04);
        for (const s of [-1, 1]) ball(bear, 0x2a2430, s * 0.12, 1.18, 0.29, 0.035);
        block(bear, 0xff5a64, 0, 0.82, 0.2, 0.3, 0.12, 0.1, 0.05);
        const bunny = group(pile, 0.55, 0.15, 0.35, -0.4);
        ball(bunny, 0xffffff, 0, 0.3, 0, 0.28);
        ball(bunny, 0xffffff, 0, 0.68, 0, 0.22);
        for (const s of [-1, 1]) put(bunny, G.capsule(), toon(0xffffff), { x: s * 0.09, y: 1.0, sx: 0.09, sy: 0.25, sz: 0.06, rz: -s * 0.15 });
        for (const s of [-1, 1]) ball(bunny, 0x2a2430, s * 0.08, 0.72, 0.19, 0.03);
        ball(bunny, 0xff8ab8, 0, 0.65, 0.21, 0.03);
        const frog = group(pile, -0.55, 0.12, 0.35, 0.5);
        ball(frog, 0x6fcf6a, 0, 0.25, 0, 0.3, { sy: 0.8 });
        for (const s of [-1, 1]) { ball(frog, 0x6fcf6a, s * 0.14, 0.48, 0.05, 0.11); ball(frog, 0xffffff, s * 0.14, 0.5, 0.12, 0.06); ball(frog, 0x2a2430, s * 0.14, 0.5, 0.17, 0.03); }
        const duck = group(pile, 0.1, 0.4, 0.55);
        ball(duck, 0xffe25a, 0, 0.15, 0, 0.2);
        ball(duck, 0xffe25a, 0, 0.38, 0.05, 0.14);
        ball(duck, 0xff9a3a, 0, 0.36, 0.2, 0.06, { sx: 1.4, sy: 0.5 });
        const peng = group(pile, -0.6, 0.15, -0.35, 0.3);
        ball(peng, 0x2f3542, 0, 0.35, 0, 0.3, { sy: 1.3 });
        ball(peng, 0xffffff, 0, 0.3, 0.12, 0.22, { sy: 1.2 });
        ball(peng, 0xff9a3a, 0, 0.55, 0.28, 0.05);
        const bob = dynamic(group(pile, 0, 0, 0));
        bob.add(bunny); // the bunny bounces a little
        ctx.anim.push((t) => { bob.position.y = Math.abs(Math.sin(t * 1.5)) * 0.04; });
      },
    },
    "special-punchbag": {
      obs: [{ cx: 0.5, cz: -0.3, w: 1.1, d: 1.4 }], spot: { lx: -0.55, lz: 0.15, yaw: PI / 2 },
      build(g, ctx) {
        block(g, 0x3a3f4a, 0.5, 0.05, -0.55, 0.9, 0.1, 0.8, 0.04);
        cylinder(g, 0x3a3f4a, 0.5, 1.45, -0.8, 0.07, 2.8);
        cylinder(g, 0x3a3f4a, 0.5, 2.8, -0.42, 0.05, 0.8, { rx: PI / 2 });
        const bag = dynamic(group(g, 0.5, 2.8, 0.0));
        cylinder(bag, 0x8f96a3, 0, -0.2, 0, 0.012, 0.4);
        put(bag, G.capsule(), padded(0xe2384a), { y: -1.05, sx: 0.62, sy: 1.0, sz: 0.62 });
        if (FINE) for (const y of [-0.55, -1.5]) block(bag, 0x2f3542, 0, y, 0, 0.64, 0.06, 0.64, 0.03);
        block(bag, 0x2f3542, 0, -0.95, 0, 0.64, 0.12, 0.64, 0.05);
        for (const s of [-1, 1]) ball(g, 0xff3b3b, -0.2 + s * 0.15, 0.12, -0.6, 0.13, { sx: 1.2 });
        ctx.anim.push((t) => { bag.rotation.z = Math.sin(t * 2.2) * 0.06; bag.rotation.x = Math.sin(t * 1.7) * 0.04; });
      },
    },

    // =====================================================================
    // More furniture (same slots, same rules as above)
    // =====================================================================

    // ===== beds =====
    "bed-cloud": {
      obs: [{ cx: 0, cz: 0, w: 2.6, d: 3.0 }], spot: { lx: 2.2, lz: 0.5, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.1, h: 0.84, yaw: PI },
      build(g, ctx) {
        // a puffy cloud: a soft base with round puffs all round, and a cloud headboard
        block(g, 0xdcecff, 0, 0.21, 0, 2.1, 0.42, 2.9, 0.18);
        const puffs = [];
        for (let k = 0; k < 7; k++) for (const s of [-1, 1]) puffs.push({ x: s * 1.0, y: 0.3, z: -1.2 + k * 0.4, sx: 0.28, sy: 0.24, sz: 0.3 });
        for (let k = 0; k < 5; k++) puffs.push({ x: -0.8 + k * 0.4, y: 0.3, z: 1.38, sx: 0.28, sy: 0.24, sz: 0.22 });
        scatter(g, G.lowSphere(), toon(0xffffff), puffs, true);
        block(g, 0xffffff, 0, 0.62, 0, 1.9, 0.3, 2.8, 0.14);
        block(g, 0xaee0ff, 0, 0.8, 0.42, 1.95, 0.08, 1.9, 0.04);
        for (let k = 0; k < 5; k++) ball(g, 0xffe98a, -0.7 + k * 0.35, 0.85, 0.3 + (k % 2) * 0.6, 0.06, { sy: 0.35 });
        ball(g, 0xffffff, 0, 0.88, -1.02, 0.3, { sx: 1.5, sy: 0.4 });
        for (const [x, y, r] of [[-0.75, 1.15, 0.42], [0, 1.45, 0.56], [0.75, 1.15, 0.42], [-0.38, 0.95, 0.38], [0.38, 0.95, 0.38]]) ball(g, 0xffffff, x, y, -1.38, r, { sz: 0.35 });
        // a little rainbow over the headboard, and a smiling sun
        for (const [r, col] of [[0.5, 0xff6b6b], [0.42, 0xffcf3a], [0.34, 0x6fcf6a], [0.26, 0x4a9ae2]]) put(g, new THREE.TorusGeometry(r, 0.045, 6, 24, PI), toon(col), { x: 0.85, y: 1.65, z: -1.46 });
        const sun = dynamic(group(g, -0.95, 1.95, -1.42));
        ball(sun, glow(0xffd23f, 0.5), 0, 0, 0, 0.2, { sz: 0.4 });
        for (const s of [-1, 1]) ball(sun, 0x5a3a1a, s * 0.07, 0.04, 0.08, 0.025);
        ctx.anim.push((t) => { sun.rotation.z = Math.sin(t * 0.8) * 0.15; });
      },
    },
    "bed-futon": {
      // (the Mii lies on the mattress, on top of a thin quilt: h = the quilt's top)
      obs: [{ cx: 0, cz: 0, w: 2.2, d: 3.0 }], spot: { lx: 1.95, lz: 0.5, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.1, h: 0.34, yaw: PI },
      build(g) {
        // a low tatami platform with a futon, a quilt and a roll pillow
        block(g, cloth(0xd8d39a), 0, 0.06, 0, 2.2, 0.12, 3.0, 0.03);
        for (const s of [-1, 1]) block(g, 0x4a6a3a, s * 1.07, 0.065, 0, 0.08, 0.125, 3.0, 0.02);
        block(g, padded(0xfffaf0), 0, 0.21, -0.05, 1.7, 0.2, 2.6, 0.09);
        bits(g, (p) => {
          // the tatami's woven lines, and a cup of tea on a tray beside the pillow
          for (let k = 0; k < 9; k++) slab(p, 0xc4bf86, -0.92 + k * 0.23, 0.121, 1.38, 0.012, 0.004, 0.22, 0.002);
          slab(p, 0x6b4423, -0.85, 0.135, -1.3, 0.34, 0.03, 0.24, 0.01);
          cylinder(p, 0xf4efe4, -0.92, 0.19, -1.3, 0.05, 0.08);
          cylinder(p, 0x7aa84a, -0.92, 0.226, -1.3, 0.042, 0.005);
          bead(p, 0xff9ec7, -0.74, 0.18, -1.28, 0.04, { sy: 0.6 });
        });
        const quilt = canvasTexture(128, 128, (c, w, h) => {
          c.fillStyle = "#3f6fb5"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 2;
          for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.beginPath(); c.arc(x * 32 + 16, y * 32 + 16, 11, 0, TAU); c.stroke(); c.beginPath(); c.arc(x * 32 + 16, y * 32 + 16, 5, 0, TAU); c.stroke(); }
        }, [2, 2]);
        block(g, toon(0xffffff, { map: quilt }), 0, 0.32, 0.38, 1.78, 0.04, 1.75, 0.015);
        block(g, 0xff9ec7, 0, 0.32, -0.5, 1.78, 0.04, 0.12, 0.015);
        put(g, G.capsule(), toon(0xf0e3c8), { y: 0.42, z: -0.98, sx: 0.26, sy: 0.6, sz: 0.26, rz: PI / 2 });
        // a paper lantern on the floor by the head
        cylinder(g, 0x6b4423, 0.85, 0.16, -1.25, 0.12, 0.04);
        put(g, G.cyl(12), toon(0xfff1d6, { emissive: 0xffd890, emissiveIntensity: 0.5 }), { x: 0.85, y: 0.36, z: -1.25, sx: 0.13, sy: 0.36, sz: 0.13 });
        cylinder(g, 0x6b4423, 0.85, 0.56, -1.25, 0.12, 0.04);
      },
    },
    "bed-pirate": {
      obs: [{ cx: 0, cz: 0.3, w: 2.3, d: 3.6 }], spot: { lx: 2.15, lz: 0.6, yaw: -PI / 2 }, lie: { lx: 0, lz: 0.05, h: 1.0, yaw: PI },
      build(g, ctx) {
        const wood = woody(0x8a5a3a), gold = shiny(0xffcf3a);
        bits(g, (p) => {
          // the hull's planks, and rivets along the gold band
          for (const s of [-1, 1]) for (const y of [0.18, 0.32, 0.56]) slab(p, 0x6b4423, s * 1.1, y, -0.1, 0.012, 0.015, 2.6, 0.004);
          for (let k = 0; k < 9; k++) for (const s of [-1, 1]) bead(p, 0xd9a441, s * 1.12, 0.7, -1.4 + k * 0.32, 0.02);
        });
        // the hull, with a pointy bow at the foot
        block(g, wood, 0, 0.42, -0.1, 2.2, 0.84, 2.8, 0.16);
        put(g, G.box(), wood, { y: 0.42, z: 1.3, sx: 1.1, sy: 0.84, sz: 1.1, ry: PI / 4 });
        block(g, gold, 0, 0.7, -0.1, 2.24, 0.08, 2.84, 0.03);
        put(g, G.box(), gold, { y: 0.7, z: 1.3, sx: 1.13, sy: 0.08, sz: 1.13, ry: PI / 4 });
        ball(g, gold, 0, 0.62, 2.08, 0.12);
        for (const s of [-1, 1]) for (const z of [-0.9, -0.15, 0.6]) {
          put(g, G.circle(), toon(0x9fd8ff, { emissive: 0x5aa8e0, emissiveIntensity: 0.2 }), { x: s * 1.105, y: 0.4, z, s: 0.11, ry: s * PI / 2, shadow: false });
          put(g, G.torus(0.12, 0.025), gold, { x: s * 1.105, y: 0.4, z, ry: s * PI / 2 });
        }
        // the mattress and a striped blanket
        block(g, padded(0xffffff), 0, 0.88, -0.15, 1.9, 0.12, 2.6, 0.05);
        const stripes = canvasTexture(32, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#e8424f"; c.fillRect(0, i * 8, w, 8); } }, [1, 2]);
        block(g, toon(0xffffff, { map: stripes }), 0, 0.97, 0.35, 1.94, 0.06, 1.6, 0.03);
        ball(g, 0xffffff, 0, 1.03, -1.0, 0.28, { sx: 1.5, sy: 0.4 });
        // the mast, with a sail and a jolly flag
        cylinder(g, 0x6b4423, 0, 2.05, -1.42, 0.07, 2.9);
        cylinder(g, 0x6b4423, 0, 3.15, -1.36, 0.04, 1.9, { rz: PI / 2 });
        const sail = canvasTexture(128, 96, (c, w, h) => {
          c.fillStyle = "#fff6e0"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#e8424f"; c.fillRect(0, 30, w, 14); c.fillRect(0, 58, w, 14);
          c.strokeStyle = "rgba(150,110,60,0.4)"; c.lineWidth = 2; c.strokeRect(2, 2, w - 4, h - 4);
        });
        const sl = dynamic(group(g, 0, 3.12, -1.33));
        plane(sl, 1.6, 1.0, toon(0xffffff, { map: sail, side: THREE.DoubleSide }), { y: -0.55 });
        const flagTex = canvasTexture(64, 48, (c, w, h) => {
          c.fillStyle = "#222630"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#ffffff"; c.beginPath(); c.arc(32, 20, 10, 0, TAU); c.fill(); c.fillRect(26, 24, 12, 8);
          c.fillStyle = "#222630"; c.beginPath(); c.arc(28, 19, 3, 0, TAU); c.arc(36, 19, 3, 0, TAU); c.fill();
          c.strokeStyle = "#ffffff"; c.lineWidth = 4; c.beginPath(); c.moveTo(16, 34); c.lineTo(48, 44); c.moveTo(48, 34); c.lineTo(16, 44); c.stroke();
        });
        const flag = dynamic(group(g, 0, 3.38, -1.42));
        plane(flag, 0.42, 0.3, toon(0xffffff, { map: flagTex, side: THREE.DoubleSide }), { x: 0.24 });
        ball(g, gold, 0, 3.52, -1.42, 0.07);
        ctx.anim.push((t) => { sl.rotation.x = Math.sin(t * 1.1) * 0.05 - 0.04; flag.rotation.y = Math.sin(t * 2.3) * 0.25; });
      },
    },

    // ===== seats =====
    "sofa-rocking": {
      obs: [{ cx: 0, cz: -0.05, w: 1.15, d: 1.45 }], spot: { lx: 0, lz: 1.25, yaw: 0 }, seat: { lx: 0, lz: 0.04, h: 0.63, legs: "out" },
      build(g) {
        const wood = woody(0xb07a45), dark = woody(0x8a5a32);
        // the rockers: two long curves resting on the floor
        for (const sx of [-0.45, 0.45]) put(g, new THREE.TorusGeometry(2.0, 0.05, 6, 24, 0.72), dark, { x: sx, y: 2.05, rz: -PI / 2 - 0.36, ry: PI / 2 });
        for (const [x, z] of [[-0.45, -0.32], [0.45, -0.32], [-0.45, 0.32], [0.45, 0.32]]) cylinder(g, wood, x, 0.3, z, 0.04, 0.44);
        block(g, wood, 0, 0.5, 0.0, 0.96, 0.08, 0.86, 0.03);
        block(g, padded(0xff9a8a), 0, 0.58, 0.02, 0.84, 0.09, 0.76, 0.04);
        // the tall back with spindles
        for (const sx of [-0.43, 0.43]) cylinder(g, wood, sx, 1.08, -0.42, 0.045, 1.2);
        block(g, wood, 0, 1.68, -0.42, 1.0, 0.12, 0.08, 0.04);
        for (let k = 0; k < 4; k++) cylinder(g, wood, -0.24 + k * 0.16, 1.1, -0.43, 0.022, 1.1);
        block(g, padded(0xff9a8a), 0, 1.0, -0.36, 0.74, 0.7, 0.07, 0.035);
        bits(g, (p) => {
          // the blanket's knitted rows and fringe
          for (let k = 0; k < 5; k++) slab(p, 0xffffff, -0.15, 1.46 + k * 0.07, -0.345, 0.5, 0.012, 0.012, 0.004, { rz: 0.06 });
          for (let k = 0; k < 7; k++) slab(p, 0x7fc8ff, -0.36 + k * 0.07, 1.39, -0.345, 0.02, 0.07, 0.02, 0.005, { rz: 0.06 });
        });
        // a knitted blanket over the top, and arms
        block(g, 0x7fc8ff, -0.15, 1.6, -0.38, 0.5, 0.36, 0.06, 0.03, { rz: 0.06 });
        for (const sx of [-0.47, 0.47]) {
          block(g, wood, sx, 0.86, -0.02, 0.08, 0.06, 0.8, 0.03);
          cylinder(g, wood, sx, 0.68, 0.33, 0.03, 0.36);
        }
        // a ball of yarn and knitting needles on the floor
        ball(g, 0xe8424f, 0.66, 0.1, 0.45, 0.1);
        cylinder(g, 0xdfe4ea, 0.66, 0.16, 0.45, 0.01, 0.34, { rz: 0.9 });
      },
    },
    "sofa-egg": {
      obs: [{ cx: 0, cz: -0.2, r: 0.82 }], spot: { lx: 0, lz: 1.3, yaw: 0 }, seat: { lx: 0, lz: 0.06, h: 0.76, legs: "out" },
      build(g) {
        const metal = shiny(0xdfe4ea);
        // the stand: a heavy base, a pole and an arm over the top
        cylinder(g, metal, 0, 0.04, -0.62, 0.28, 0.08);
        cylinder(g, metal, 0, 1.47, -0.62, 0.045, 2.86);
        ball(g, metal, 0, 2.9, -0.62, 0.07);
        cylinder(g, metal, 0, 2.9, -0.33, 0.04, 0.58, { rx: PI / 2 });
        cylinder(g, 0x8f96a3, 0, 2.5, -0.05, 0.015, 0.8);
        put(g, G.torus(0.06, 0.015), toon(0x8f96a3), { y: 2.9, z: -0.05 });
        // the wicker egg, open at the front
        const wick = canvasTexture(64, 64, (c, w, h) => {
          c.fillStyle = "#d6ae72"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "#b88c50"; c.lineWidth = 3;
          for (let k = -64; k < 128; k += 10) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 64, 64); c.stroke(); c.beginPath(); c.moveTo(k + 64, 0); c.lineTo(k, 64); c.stroke(); }
        }, [6, 4]);
        const shell = new THREE.SphereGeometry(1, 28, 18, PI / 2 + 1.35, TAU - 2.7);
        put(g, shell, toon(0xffffff, { map: wick, side: THREE.DoubleSide }), { y: 1.2, z: -0.05, sx: 0.72, sy: 0.95, sz: 0.7 });
        ball(g, cloth(0xff9ec7), 0, 0.66, 0.0, 0.58, { sy: 0.18 });
        ball(g, cloth(0xffc6dc), 0, 1.15, -0.45, 0.4, { sy: 0.55, sz: 0.2 });
        ball(g, cloth(0xffffff), 0.25, 0.85, -0.3, 0.16, { sz: 0.5, rz: 0.4 });
      },
    },
    "sofa-gaming": {
      obs: [{ cx: 0, cz: -0.05, r: 0.6 }], spot: { lx: 0, lz: 1.2, yaw: 0 }, seat: { lx: 0, lz: 0.05, h: 0.63, legs: "out" },
      build(g) {
        const black = padded(0x2f3542), red = padded(0xff3b5a);
        // five-star base on wheels, and the gas lift
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + 0.3;
          put(g, G.box(), black, { x: Math.cos(a) * 0.22, y: 0.12, z: Math.sin(a) * 0.22, sx: 0.44, sy: 0.06, sz: 0.07, ry: -a });
          ball(g, 0x1e2228, Math.cos(a) * 0.43, 0.06, Math.sin(a) * 0.43, 0.06);
        }
        cylinder(g, 0x8f96a3, 0, 0.3, 0, 0.05, 0.36);
        block(g, black, 0, 0.52, 0.02, 0.9, 0.14, 0.86, 0.07);
        block(g, red, 0, 0.605, 0.02, 0.46, 0.04, 0.8, 0.02);
        // the tall racing back with red stripes, wings and a headrest pillow
        const back = group(g, 0, 0, -0.42);
        back.rotation.x = -0.08;
        block(back, black, 0, 1.25, 0, 0.84, 1.3, 0.16, 0.08);
        for (const sx of [-0.24, 0.24]) block(back, red, sx, 1.2, 0.085, 0.12, 1.15, 0.02, 0.01);
        for (const sx of [-0.43, 0.43]) block(back, black, sx, 1.35, 0.06, 0.08, 0.6, 0.2, 0.04);
        ball(back, red, 0, 1.72, 0.1, 0.16, { sx: 1.4, sz: 0.45 });
        // armrests
        for (const sx of [-0.47, 0.47]) {
          block(g, black, sx, 0.74, -0.02, 0.06, 0.28, 0.06, 0.02);
          block(g, 0x3a3f4a, sx, 0.9, 0.02, 0.1, 0.05, 0.42, 0.02);
        }
      },
    },

    // ===== tables (the Mii stands behind them, at -z, facing you) =====
    "table-kitchen": {
      obs: [{ cx: 0, cz: 0, w: 2.15, d: 1.05 }], spot: { lx: 0, lz: -1.15, yaw: 0 },
      build(g, ctx) {
        // the island: cupboards in front, a worktop with a hob, a chopping board and fruit
        block(g, 0xffffff, 0, 0.5, 0, 2.0, 0.92, 0.9, 0.05);
        block(g, 0x3a3f4a, 0, 0.03, 0.02, 1.9, 0.06, 0.82, 0.02);
        for (const x of [-0.62, 0, 0.62]) {
          block(g, 0x9fd8c8, x, 0.5, 0.455, 0.56, 0.72, 0.03, 0.03);
          ball(g, 0xffcf5a, x + 0.18, 0.72, 0.48, 0.035);
        }
        block(g, 0xf2efe8, 0, 0.99, 0, 2.1, 0.08, 1.0, 0.03);
        block(g, 0x2f3542, -0.45, 1.04, 0, 0.84, 0.03, 0.62, 0.015);
        for (const [x, z] of [[-0.65, 0.12], [-0.25, -0.12]]) put(g, G.torus(0.13, 0.02), toon(0xff5a3a, { emissive: 0xff3a1a, emissiveIntensity: 0.6 }), { x, y: 1.06, z, rx: PI / 2 });
        // a frying pan with an egg, and a pot of soup
        cylinder(g, 0x3a3f4a, -0.65, 1.09, 0.12, 0.19, 0.05);
        block(g, 0x3a3f4a, -0.65, 1.1, -0.2, 0.06, 0.03, 0.34, 0.01);
        disc(g, toon(0xffffff), -0.65, 1.117, 0.12, 0.11);
        ball(g, 0xffc21a, -0.63, 1.12, 0.13, 0.045, { sy: 0.6 });
        cylinder(g, 0xff7a59, -0.25, 1.17, -0.12, 0.16, 0.22);
        disc(g, toon(0xffb84a), -0.25, 1.27, -0.12, 0.14);
        for (const s of [-1, 1]) block(g, 0xff7a59, -0.25 + s * 0.19, 1.22, -0.12, 0.06, 0.03, 0.05, 0.01);
        block(g, 0xc98b4a, 0.42, 1.045, 0.05, 0.5, 0.03, 0.34, 0.015);
        put(g, G.capsule(), toon(0xff9a3a), { x: 0.38, y: 1.09, z: 0.06, sx: 0.06, sy: 0.18, sz: 0.06, rz: PI / 2 });
        for (let k = 0; k < 3; k++) cylinder(g, 0xff9a3a, 0.56 + k * 0.035, 1.07, 0.12 - k * 0.04, 0.03, 0.015);
        block(g, 0xdfe4ea, 0.48, 1.07, -0.06, 0.24, 0.01, 0.05, 0.005); // a knife
        put(g, G.taper(0.2, 0.12), toon(0xffffff), { x: 0.82, y: 1.09, z: -0.08, sy: 0.12 });
        ball(g, 0xff3b3b, 0.78, 1.17, -0.06, 0.07);
        ball(g, 0xffe25a, 0.88, 1.17, -0.12, 0.065, { sx: 1.4 });
        ball(g, 0x8ad43a, 0.84, 1.16, 0.0, 0.06);
        // steam from the pot
        const puff = canvasTexture(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
        const steam = [];
        for (let i = 0; i < 4; i++) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
          g.add(dynamic(s));
          steam.push(s);
        }
        ctx.anim.push((t) => steam.forEach((s, i) => {
          const k = (t * 0.4 + i / 4) % 1;
          s.position.set(-0.25 + Math.sin(t * 1.5 + i * 2) * 0.06, 1.32 + k * 0.8, -0.12);
          s.scale.setScalar(0.15 + k * 0.3);
          s.material.opacity = (1 - k) * 0.7;
        }));
      },
    },
    "table-pingpong": {
      obs: [{ cx: 0, cz: 0, w: 2.65, d: 1.5 }], spot: { lx: -1.72, lz: 0, yaw: PI / 2 },
      build(g, ctx) {
        const top = canvasTexture(256, 144, (c, w, h) => {
          c.fillStyle = "#2e7d5b"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4); c.fillRect(0, 0, 4, h); c.fillRect(w - 4, 0, 4, h); c.fillRect(0, h / 2 - 1, w, 2);
        });
        block(g, 0x245f45, 0, 0.77, 0, 2.6, 0.06, 1.45, 0.02);
        plane(g, 2.58, 1.43, toon(0xffffff, { map: top }), { y: 0.802, rx: -PI / 2 });
        for (const [x, z] of [[-1.1, -0.58], [1.1, -0.58], [-1.1, 0.58], [1.1, 0.58]]) block(g, shiny(0x3a3f4a), x, 0.37, z, 0.07, 0.74, 0.07, 0.02);
        for (const x of [-1.1, 1.1]) block(g, shiny(0x3a3f4a), x, 0.2, 0, 0.05, 0.05, 1.16, 0.02);
        bits(g, (p) => {
          // little wheels on the legs, and a spare ball and a towel on the floor
          for (const [x, z] of [[-1.1, -0.58], [1.1, -0.58], [-1.1, 0.58], [1.1, 0.58]]) cylinder(p, 0x2f3542, x, 0.04, z, 0.05, 0.04, { rz: PI / 2 });
          slab(p, 0xffffff, 0.95, 0.805, -0.6, 0.3, 0.01, 0.18, 0.004, { ry: 0.3 });
          for (let k = 0; k < 3; k++) slab(p, 0x4a90e2, 0.95, 0.808, -0.6 - 0.06 + k * 0.06, 0.3, 0.004, 0.015, 0.002, { ry: 0.3 });
        });
        // the net across the middle
        const net = canvasTexture(128, 16, (c, w, h) => {
          c.strokeStyle = "rgba(30,30,40,0.85)"; c.lineWidth = 1;
          for (let x = 0; x <= w; x += 6) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
          for (let y = 0; y <= h; y += 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
        });
        plane(g, 1.55, 0.15, toon(0xffffff, { map: net, transparent: true, side: THREE.DoubleSide }), { y: 0.88, ry: PI / 2 });
        block(g, 0xffffff, 0, 0.96, 0, 0.02, 0.02, 1.55, 0.005);
        for (const s of [-1, 1]) block(g, 0x3a3f4a, 0, 0.88, s * 0.78, 0.04, 0.17, 0.04, 0.01);
        // two floating paddles rallying a ball: it arcs over the net, bounces once on the far side, and gets hit back
        const pads = [-1, 1].map((s) => ({
          s, face: dynamic(cylinder(g, s < 0 ? 0xe8424f : 0x3a6bd8, s * 1.28, 0.97, 0, 0.13, 0.025, { rz: PI / 2 })),
          grip: dynamic(block(g, 0xc98b4a, s * 1.3, 0.8, 0, 0.03, 0.18, 0.05, 0.01)),
        }));
        const pb = dynamic(ball(g, 0xffffff, 0, 1, 0, 0.04, { shadow: false }));
        const LAND = 0.78; // where the ball bounces (as part of the way across)
        const zAt = (n) => Math.sin(n * 2.4) * 0.38; // each shot goes somewhere a bit different
        ctx.anim.push((t) => {
          const k = t * 0.45, n = Math.floor(k), p = k - n, dir = n % 2 ? -1 : 1;
          const x = dir * (-1.15 + p * 2.3);
          const arc = (u, y0, y1, h) => y0 + (y1 - y0) * u + 4 * h * u * (1 - u);
          const y = p < LAND ? arc(p / LAND, 0.95, 0.83, 0.28) : arc((p - LAND) / (1 - LAND), 0.83, 0.95, 0.06);
          const z = zAt(n) + (zAt(n + 1) - zAt(n)) * p;
          pb.position.set(x, y, z);
          // each paddle drifts to meet the ball and swings as it hits
          for (const pd of pads) {
            const incoming = pd.s === dir; // the ball is heading to this side
            const tz = incoming ? zAt(n + 1) : zAt(n);
            const near = incoming ? Math.max(0, 1 - Math.abs(1 - p) * 6) : Math.max(0, 1 - p * 6);
            pd.face.position.set(pd.s * (1.28 - near * 0.08), 0.97, tz);
            pd.face.rotation.set(0, 0, PI / 2 + pd.s * near * 0.5);
            pd.grip.position.set(pd.s * (1.3 - near * 0.08), 0.8, tz);
          }
        });
      },
    },

    // ===== fun things (against the right wall; the Mii stands at +z facing them) =====
    "tv-arcade": {
      obs: [{ cx: 0, cz: -0.12, w: 1.05, d: 0.95 }], spot: { lx: 0, lz: 1.1, yaw: PI },
      build(g, ctx) {
        const body = shiny(0x6a3df0), pink = toon(0xff4fd8);
        bits(g, (p) => {
          // star stickers down the sides, and a coin slot plate
          for (const s of [-1, 1]) for (let k = 0; k < 3; k++) put(p, G.cone(5), toon([0xffe25a, 0x5cc8ff, 0xff9ec7][k]), { x: s * 0.515, y: 0.5 + k * 0.4, z: -0.25 + (k % 2) * 0.2, s: 0.08, sy: 0.02, rz: s * PI / 2 });
        });
        block(g, body, 0, 0.95, -0.2, 0.95, 1.9, 0.75, 0.06);
        for (const s of [-1, 1]) block(g, pink, s * 0.49, 0.95, -0.2, 0.04, 1.92, 0.77, 0.015);
        block(g, 0x1a1530, 0, 1.36, 0.17, 0.8, 0.64, 0.04, 0.02, { rx: -0.22 });
        const scr = canvasTexture(128, 128, (c, w, h) => {
          c.fillStyle = "#0b0b22"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#ffffff"; const r = seeded(5); for (let i = 0; i < 30; i++) c.fillRect(r() * w, r() * h, 1.5, 1.5);
          c.fillStyle = "#5cff8a";
          for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) { const px = 14 + x * 22, py = 14 + y * 18; c.fillRect(px, py, 12, 6); c.fillRect(px + 2, py + 6, 3, 3); c.fillRect(px + 7, py + 6, 3, 3); c.fillRect(px + 3, py - 3, 6, 3); }
          c.fillStyle = "#ffd23f"; c.fillRect(56, 110, 16, 8); c.fillRect(62, 104, 4, 6);
          c.fillStyle = "#ff4fd8"; c.fillRect(63, 80, 2, 8);
        }, [1, 1]);
        const screen = dynamic(plane(g, 0.72, 0.56, basic(scr), { y: 1.36, z: 0.195, rx: -0.22 }));
        ctx.anim.push((t) => { scr.offset.x = Math.sin(t * 0.8) * 0.06; screen.material.color.setScalar(0.9 + Math.sin(t * 19) * 0.05); });
        // the glowing sign on top
        block(g, 0x2a2440, 0, 1.8, 0.1, 0.9, 0.24, 0.14, 0.03);
        const sign = canvasTexture(128, 32, (c, w, h) => {
          const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#ff4fd8"); gr.addColorStop(1, "#5cc8ff");
          c.fillStyle = gr; c.fillRect(0, 0, w, h);
          c.fillStyle = "#ffffff"; c.textAlign = "center"; c.textBaseline = "middle"; fitFont(c, "MII ARCADE", w - 10, 20); c.fillText("MII ARCADE", w / 2, h / 2 + 1);
        });
        plane(g, 0.84, 0.2, basic(sign), { y: 1.8, z: 0.172 });
        // the controls: a joystick and buttons on a sloping panel
        block(g, 0x2a2440, 0, 1.0, 0.3, 0.92, 0.1, 0.36, 0.03, { rx: 0.22 });
        cylinder(g, 0x2f3542, -0.2, 1.1, 0.3, 0.02, 0.14);
        const stick = dynamic(group(g, -0.2, 1.1, 0.3));
        ball(stick, 0xff3b3b, 0, 0.08, 0, 0.055);
        for (const [x, col] of [[0.05, 0xff3b5a], [0.17, 0xffd23f], [0.29, 0x5cc8ff]]) ball(g, glow(col, 0.6), x, 1.07, 0.33, 0.035, { sy: 0.5 });
        block(g, 0x2a2440, 0, 0.5, 0.18, 0.3, 0.3, 0.03, 0.01);
        block(g, 0x8f96a3, 0, 0.55, 0.2, 0.06, 0.1, 0.02, 0.005);
        ball(g, glow(0xffd23f, 0.8), 0, 0.42, 0.2, 0.03, { sz: 0.4 });
        ctx.anim.push((t) => { stick.rotation.z = Math.sin(t * 5) * 0.3; stick.rotation.x = Math.cos(t * 3.7) * 0.2; });
      },
    },
    "tv-bookshelf": {
      obs: [{ cx: 0, cz: -0.33, w: 1.95, d: 0.6 }], spot: { lx: 0, lz: 0.95, yaw: PI },
      build(g) {
        const wood = woody(0x9a6a3c);
        block(g, woody(0x7a5230), 0, 1.1, -0.56, 1.9, 2.2, 0.04, 0.01);
        for (const sx of [-0.92, 0.92]) block(g, wood, sx, 1.1, -0.33, 0.08, 2.2, 0.5, 0.02);
        for (const y of [0.05, 0.6, 1.15, 1.7, 2.17]) block(g, wood, 0, y, -0.33, 1.9, 0.07, 0.5, 0.02);
        // rows of books (some leaning), with gaps for a globe, a trophy and a plant
        const r = seeded(11), books = [];
        const cols = [0xe8424f, 0x4a90e2, 0xffcf3a, 0x5cc84a, 0xff9ec7, 0x9b6bff, 0xff9a3a, 0xf4efe4, 0x2f6f8f];
        const shelves = [[0.085, -0.86, 0.86], [0.635, -0.86, 0.3], [1.185, -0.4, 0.86], [1.735, -0.86, 0.45]];
        for (const [y0, x0, x1] of shelves) {
          let x = x0;
          while (x < x1) {
            const w = 0.06 + r() * 0.05, h = 0.32 + r() * 0.14, lean = r() < 0.12 && x > x0 + 0.1 ? 0.25 : 0;
            books.push({ x: x + w / 2 + lean * h * 0.5, y: y0 + h / 2 * Math.cos(lean), z: -0.33 + (r() - 0.5) * 0.04, sx: w, sy: h, sz: 0.36, rz: -lean, color: cols[Math.floor(r() * cols.length)] });
            x += w + 0.008 + lean * h * 0.6;
          }
        }
        scatter(g, G.box(), toon(0xffffff), books, true);
        // bands and titles on the spines (on every other book)
        bits(g, (p) => books.forEach((b, i) => {
          if (i % 2) return;
          for (const dy of [0.32, -0.3]) slab(p, i % 4 ? 0xffe9a8 : 0xffffff, b.x, b.y + b.sy * dy, b.z + 0.181, b.sx * 0.9, 0.018, 0.004, 0.002, { rz: b.rz });
        }));
        // a globe
        cylinder(g, 0x9a6a3c, 0.62, 0.66, -0.33, 0.08, 0.03);
        put(g, G.torus(0.17, 0.012), toon(0xd9a441), { x: 0.62, y: 0.85, z: -0.33, ry: PI / 2 });
        ball(g, 0x4a9ae2, 0.62, 0.85, -0.33, 0.15);
        ball(g, 0x5cc84a, 0.66, 0.9, -0.2, 0.06, { sz: 0.4 });
        // a trophy, and a little plant on top
        put(g, G.taper(0.09, 0.05), toon(0xffcf3a), { x: -0.65, y: 1.33, z: -0.3, sy: 0.18 });
        cylinder(g, 0xffcf3a, -0.65, 1.22, -0.3, 0.025, 0.08);
        block(g, 0x6b4423, -0.65, 1.2, -0.3, 0.16, 0.04, 0.12, 0.01);
        put(g, G.taper(0.12, 0.09), toon(0xe0784a), { x: 0.6, y: 2.29, z: -0.33, sy: 0.18 });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; put(g, G.sphere(), toon(0x5cc84a), { x: 0.6 + Math.cos(a) * 0.08, y: 2.45, z: -0.33 + Math.sin(a) * 0.08, sx: 0.06, sy: 0.16, sz: 0.06, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 }); }
        block(g, 0x4a90e2, -0.4, 2.25, -0.33, 0.32, 0.08, 0.24, 0.02);
        block(g, 0xffcf3a, -0.4, 2.33, -0.33, 0.28, 0.07, 0.22, 0.02);
      },
    },
    "tv-flatscreen": {
      obs: [{ cx: 0, cz: -0.3, w: 1.95, d: 0.6 }], spot: { lx: 0, lz: 1.65, yaw: PI },
      build(g, ctx) {
        // a low media unit with a big, thin TV on it
        for (const [x, z] of [[-0.85, -0.5], [0.85, -0.5], [-0.85, -0.1], [0.85, -0.1]]) cylinder(g, woody(0x9a6a3c), x, 0.05, z, 0.03, 0.1);
        block(g, woody(0xf4efe4), 0, 0.34, -0.3, 1.9, 0.48, 0.55, 0.04);
        for (const x of [-0.47, 0.47]) {
          block(g, woody(0xe0a868), x, 0.34, -0.02, 0.86, 0.36, 0.03, 0.02);
          block(g, shiny(0x8f96a3), x, 0.42, 0.0, 0.2, 0.025, 0.02, 0.01);
        }
        bits(g, (p) => {
          // a little plant and a photo frame on the unit, and the soundbar's grille
          put(p, G.taper(0.07, 0.05), toon(0xffffff), { x: -0.45, y: 0.64, z: -0.4, sy: 0.12 });
          for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ball(p, k % 2 ? 0x46b04a : 0x6fcf5a, -0.45 + Math.cos(a) * 0.05, 0.76, -0.4 + Math.sin(a) * 0.05, 0.05, { sy: 1.6, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }); }
          slab(p, 0xd9a441, 0.42, 0.7, -0.45, 0.2, 0.16, 0.02, 0.01, { rx: -0.15 });
          slab(p, 0x9fd8ff, 0.42, 0.7, -0.438, 0.15, 0.11, 0.005, 0.002, { rx: -0.15 });
          for (let k = 0; k < 10; k++) bead(p, 0x4a5060, -0.36 + k * 0.08, 0.62, -0.06, 0.012);
        });
        // a big TV mounted on the wall above the unit, playing a movie (widescreen, with black bars)
        block(g, 0x3a3f4a, 0, 1.62, -0.6, 0.5, 0.36, 0.05, 0.01); // wall bracket
        block(g, shiny(0x1e1e24), 0, 1.62, -0.55, 2.5, 1.45, 0.06, 0.03);
        const movie = canvasTexture(512, 256, (c, w, h) => {
          // a road movie at sunset: sky, sun, hills, a road and a little car, letterboxed
          const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#2b2a63"); sky.addColorStop(0.45, "#ff7a59"); sky.addColorStop(0.7, "#ffd27a");
          c.fillStyle = sky; c.fillRect(0, 0, w, h);
          c.fillStyle = "#fff2b0"; c.beginPath(); c.arc(w * 0.3, h * 0.58, 34, 0, TAU); c.fill();
          c.fillStyle = "#6a3a6b"; c.beginPath(); c.moveTo(0, h * 0.7);
          for (let x = 0; x <= w; x += 32) c.lineTo(x, h * 0.62 + Math.sin(x * 0.02) * 14 + Math.sin(x * 0.051) * 8);
          c.lineTo(w, h); c.lineTo(0, h); c.fill();
          c.fillStyle = "#2c2038"; c.fillRect(0, h * 0.74, w, h * 0.12);
          c.fillStyle = "#ffd27a"; for (let x = 8; x < w; x += 40) c.fillRect(x, h * 0.795, 20, 3);
          c.fillStyle = "#111"; c.fillRect(0, 0, w, h * 0.12); c.fillRect(0, h * 0.88, w, h * 0.12);
        }, [1, 1]);
        movie.wrapS = THREE.RepeatWrapping;
        const car = canvasTexture(64, 32, (c) => {
          c.fillStyle = "#e8424f"; c.fillRect(6, 12, 52, 12); c.fillRect(18, 4, 26, 10);
          c.fillStyle = "#9fd8ff"; c.fillRect(21, 6, 9, 7); c.fillRect(33, 6, 9, 7);
          c.fillStyle = "#111"; c.beginPath(); c.arc(17, 25, 6, 0, TAU); c.arc(47, 25, 6, 0, TAU); c.fill();
        }, [1, 1]);
        const scr = dynamic(plane(g, 2.4, 1.35, basic(movie), { y: 1.62, z: -0.517 }));
        const carMesh = dynamic(plane(g, 0.36, 0.18, basic(car, { transparent: true }), { x: -0.2, y: 1.26, z: -0.512 }));
        block(g, 0x2f3542, 0, 0.62, -0.12, 0.9, 0.08, 0.12, 0.03); // soundbar
        ball(g, glow(0x5cff8a, 1), 0.38, 0.62, -0.06, 0.012);
        // a bucket of popcorn and the remote
        put(g, G.taper(0.11, 0.08), toon(0xe8424f), { x: 0.72, y: 0.67, z: -0.25, sy: 0.18 });
        for (let i = 0; i < 7; i++) ball(g, 0xfff6d6, 0.72 + Math.cos(i * 2.4) * 0.06, 0.78 + (i % 2) * 0.03, -0.25 + Math.sin(i * 2.4) * 0.06, 0.04);
        block(g, 0x3a3f4a, -0.7, 0.6, -0.2, 0.06, 0.03, 0.2, 0.01);
        ctx.anim.push((t) => {
          movie.offset.x = (t * 0.03) % 1; // the scenery rolls past the car
          carMesh.position.y = 1.26 + Math.abs(Math.sin(t * 9)) * 0.008; // a bumpy road
          scr.material.color.setScalar(0.94 + Math.sin(t * 5) * 0.03);
        });
      },
    },

    // ===== rugs =====
    "rug-shag": {
      build(g) {
        const tex = canvasTexture(256, 256, (c, w, h) => {
          c.fillStyle = "#ff9ec7";
          c.beginPath(); c.arc(128, 128, 112, 0, TAU); c.fill();
          for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; c.beginPath(); c.arc(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112, 14, 0, TAU); c.fill(); }
          const r = seeded(3);
          for (let i = 0; i < 900; i++) {
            const a = r() * TAU, d = Math.sqrt(r()) * 118;
            c.strokeStyle = r() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(220,90,150,0.35)"; c.lineWidth = 2;
            const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
            c.beginPath(); c.arc(x, y, 3, r() * TAU, r() * TAU + 3); c.stroke();
          }
          c.fillStyle = "rgba(255,255,255,0.5)"; heart(c, 128, 104, 48);
        });
        put(g, new THREE.CircleGeometry(1.9, 48), toon(0xffffff, { map: tex, alphaTest: 0.5 }), { y: 0.012, rx: -PI / 2, shadow: false });
      },
    },
    "rug-space": {
      build(g) {
        const tex = canvasTexture(256, 180, (c, w, h) => {
          roundRect(c, 2, 2, w - 4, h - 4, 30); c.save(); c.clip();
          const gr = c.createRadialGradient(w * 0.6, h * 0.45, 10, w / 2, h / 2, 170);
          gr.addColorStop(0, "#5a3a9a"); gr.addColorStop(0.5, "#24306a"); gr.addColorStop(1, "#121633");
          c.fillStyle = gr; c.fillRect(0, 0, w, h);
          const r = seeded(9);
          c.fillStyle = "#ffffff"; for (let i = 0; i < 90; i++) { c.beginPath(); c.arc(r() * w, r() * h, 0.6 + r() * 1.4, 0, TAU); c.fill(); }
          c.fillStyle = "#ffe08a"; for (const [x, y, s] of [[40, 40, 8], [210, 140, 9], [190, 30, 6], [70, 150, 7]]) star(c, x, y, s);
          c.fillStyle = "#ff9a5a"; c.beginPath(); c.arc(150, 92, 30, 0, TAU); c.fill();
          c.strokeStyle = "#ffd23f"; c.lineWidth = 5; c.beginPath(); c.ellipse(150, 92, 52, 13, -0.3, 0, TAU); c.stroke();
          c.fillStyle = "#ffb07a"; c.beginPath(); c.arc(141, 82, 9, 0, TAU); c.fill();
          c.fillStyle = "#6fd0ff"; c.beginPath(); c.arc(60, 95, 14, 0, TAU); c.fill();
          c.restore();
          c.strokeStyle = "#ffd23f"; c.lineWidth = 5; roundRect(c, 5, 5, w - 10, h - 10, 27); c.stroke();
        });
        put(g, new THREE.PlaneGeometry(4.0, 2.8), toon(0xffffff, { map: tex, alphaTest: 0.5 }), { y: 0.012, rx: -PI / 2, shadow: false });
      },
    },
    "rug-leaf": {
      build(g) {
        const tex = canvasTexture(256, 170, (c, w, h) => {
          c.fillStyle = "#6fbf5a";
          c.beginPath(); c.moveTo(6, h / 2); c.bezierCurveTo(60, -10, 190, 0, 250, h / 2); c.bezierCurveTo(190, h, 60, h + 10, 6, h / 2); c.fill();
          c.fillStyle = "#86d16f"; c.beginPath(); c.moveTo(20, h / 2); c.bezierCurveTo(70, 8, 185, 14, 236, h / 2); c.lineTo(20, h / 2); c.fill();
          c.strokeStyle = "#e8f7d8"; c.lineWidth = 5; c.beginPath(); c.moveTo(14, h / 2); c.lineTo(242, h / 2); c.stroke();
          c.lineWidth = 3;
          for (let k = 0; k < 6; k++) {
            const x = 50 + k * 32;
            c.beginPath(); c.moveTo(x, h / 2); c.quadraticCurveTo(x + 14, h / 2 - 20, x + 30, h / 2 - 48 + Math.abs(k - 2.5) * 8); c.stroke();
            c.beginPath(); c.moveTo(x, h / 2); c.quadraticCurveTo(x + 14, h / 2 + 20, x + 30, h / 2 + 48 - Math.abs(k - 2.5) * 8); c.stroke();
          }
        });
        put(g, new THREE.PlaneGeometry(4.3, 2.85), toon(0xffffff, { map: tex, alphaTest: 0.5 }), { y: 0.012, rx: -PI / 2, rz: 0.12, shadow: false });
      },
    },

    // ===== lamps =====
    "lamp-moon": {
      obs: [], spot: { wx: -1.55, wz: -2.85, toward: true },
      build(g, ctx) {
        // a glowing moon on a little wooden stand (on the bedside table)
        const y0 = 0.72;
        cylinder(g, 0x9a6a3c, 0, y0 + 0.03, 0, 0.13, 0.06);
        cylinder(g, 0xd9a441, 0, y0 + 0.1, 0, 0.012, 0.1);
        const moon = dynamic(group(g, 0, y0 + 0.3, 0));
        const mat = toon(0xfff3c4, { emissive: 0xffe08a, emissiveIntensity: 0.7 });
        ball(moon, mat, 0, 0, 0, 0.19, { shadow: false });
        for (const [x, y, z, r] of [[0.08, 0.06, 0.15, 0.04], [-0.1, -0.04, 0.14, 0.05], [0.02, -0.11, 0.14, 0.03], [-0.05, 0.12, 0.12, 0.03]]) ball(moon, 0xf0d890, x, y, z, r, { sz: 0.4, shadow: false });
        // little stars on wires
        for (const [x, h, z] of [[0.16, 0.5, 0.05], [-0.15, 0.42, -0.04]]) {
          cylinder(g, 0xd9a441, x, y0 + h / 2, z, 0.006, h);
          ball(g, glow(0xffe08a, 0.9), x, y0 + h + 0.02, z, 0.035, { shadow: false });
        }
        ctx.anim.push((t) => { moon.rotation.y = t * 0.3; mat.emissiveIntensity = 0.6 + Math.sin(t * 1.4) * 0.12; });
      },
    },
    "lamp-disco": {
      at: { x: 0.3, z: 1.0 }, obs: [], spot: { wx: -1.5, wz: 2.75, toward: true },
      build(g, ctx) {
        // a mirror ball on a long chain (the chain must stay the first part: the
        // little rooms in the apartments take it off), turning, with colored spots
        const cy = ROOM.h - 1.2;
        cylinder(g, 0xb8bcc8, 0, cy + 6, 0, 0.02, 12, { shadow: false });
        cylinder(g, 0xb8bcc8, 0, cy - 0.02, 0, 0.06, 0.1, { shadow: false });
        const tiles = canvasTexture(128, 64, (c, w, h) => {
          const r = seeded(13);
          for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
            const v = 150 + Math.floor(r() * 105);
            c.fillStyle = r() < 0.12 ? ["#ff9ad8", "#9ad8ff", "#fff19a"][Math.floor(r() * 3)] : "rgb(" + v + "," + v + "," + (v + 10 > 255 ? 255 : v + 10) + ")";
            c.fillRect(x + 0.5, y + 0.5, 7, 7);
          }
        });
        const ballMat = toon(0xffffff, { map: tiles, emissive: 0xffffff, emissiveMap: tiles, emissiveIntensity: 0.35 });
        const db = dynamic(group(g, 0, cy - 0.5, 0));
        put(db, G.sphere(), ballMat, { s: 0.42, shadow: false });
        if (!ctx.flat) {
          // light spots sweeping round the floor
          const spots = dynamic(group(g, 0, 0.02, 0));
          const cols = [0xff5ab8, 0x5ac8ff, 0xffe25a, 0x7cff8a, 0xb58cff];
          for (let i = 0; i < 14; i++) {
            const a = i * 2.4, d = 1.0 + (i % 4) * 0.55;
            disc(spots, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }), Math.cos(a) * d, 0, Math.sin(a) * d, 0.1 + (i % 3) * 0.04);
          }
          ctx.anim.push((t) => { spots.rotation.y = -t * 0.6; });
        }
        ctx.anim.push((t) => { db.rotation.y = t * 0.6; ballMat.emissiveIntensity = 0.3 + Math.max(0, Math.sin(t * 5)) * 0.25; });
      },
    },

    // ===== plants =====
    "plant-sunflower": {
      obs: [{ cx: 0, cz: 0, r: 0.55 }], spot: { wx: -3.75, wz: 3.55, toward: true },
      build(g, ctx) {
        block(g, 0xc98b4a, 0, 0.3, 0, 0.8, 0.6, 0.6, 0.05);
        for (let k = 0; k < 3; k++) block(g, 0xb57843, 0, 0.12 + k * 0.18, 0.302, 0.8, 0.02, 0.01, 0.005);
        block(g, 0x6b4423, 0, 0.6, 0, 0.7, 0.04, 0.5, 0.01);
        for (const [x, z, h, s] of [[-0.2, 0.02, 1.7, 1], [0.08, -0.08, 2.05, 1.1], [0.26, 0.1, 1.45, 0.9]]) {
          cylinder(g, 0x4f9e35, x, 0.6 + (h - 0.6) / 2, z, 0.025, h - 0.6);
          for (const [dy, sd] of [[0.35, 1], [0.7, -1]]) put(g, G.sphere(), toon(0x5cb840), { x: x + sd * 0.1, y: 0.6 + dy, z, sx: 0.12, sy: 0.04, sz: 0.07, rz: sd * 0.4 });
          const head = dynamic(group(g, x, h, z + 0.02));
          head.rotation.x = -0.25;
          const petals = [];
          for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; petals.push({ x: Math.cos(a) * 0.17 * s, y: Math.sin(a) * 0.17 * s, z: 0, sx: 0.11 * s, sy: 0.05 * s, sz: 0.025, rz: a }); }
          scatter(head, G.lowSphere(), toon(0xffd23f), petals, true);
          ball(head, 0x7a4a1a, 0, 0, 0.02, 0.11 * s, { sz: 0.35 });
          ctx.anim.push((t) => { head.rotation.z = Math.sin(t * 0.9 + x * 5) * 0.06; });
        }
      },
    },
    "plant-bonsai": {
      obs: [{ cx: 0, cz: 0, r: 0.55 }], spot: { wx: -3.7, wz: 3.5, toward: true },
      build(g) {
        // a low wooden stand, a glazed pot and a tiny, twisty tree
        const wood = toon(0x6b4423);
        block(g, wood, 0, 0.47, 0, 0.9, 0.06, 0.6, 0.02);
        for (const [x, z] of [[-0.38, -0.23], [0.38, -0.23], [-0.38, 0.23], [0.38, 0.23]]) block(g, wood, x, 0.22, z, 0.06, 0.44, 0.06, 0.015);
        block(g, 0x3a6ab8, 0, 0.56, 0, 0.6, 0.12, 0.4, 0.03);
        block(g, 0x5a8a3a, 0, 0.62, 0, 0.54, 0.02, 0.34, 0.008);
        const bark = toon(0x7a5230);
        // each branch starts where the one it grows from is (trunk -> top, plus two side branches),
        // with a knot at every joint, and the leaf pads sit on the branch tips
        const tip = (x, y, rz, len) => [x - Math.sin(rz) * len, y + Math.cos(rz) * len];
        const branch = (x, y, r, len, rz) => {
          put(g, G.taper(r * 0.75, r), bark, { x: x - Math.sin(rz) * len / 2, y: y + Math.cos(rz) * len / 2, z: 0, sy: len, rz });
          ball(g, bark, x, y, 0, r * 0.95);
          return tip(x, y, rz, len);
        };
        const t0 = branch(0, 0.62, 0.06, 0.32, 0.25);
        const t1 = branch(t0[0], t0[1], 0.05, 0.3, -0.45);
        const t2 = branch(t0[0], t0[1], 0.04, 0.24, 0.6);
        const mid = tip(t0[0], t0[1], -0.45, 0.15);
        const t3 = branch(mid[0], mid[1], 0.03, 0.28, -1.1);
        for (const [x, y, r] of [[t1[0] - 0.08, t1[1] + 0.07, 0.2], [t1[0] + 0.08, t1[1] + 0.19, 0.15], [t3[0] + 0.03, t3[1] + 0.02, 0.15], [t2[0] - 0.03, t2[1] + 0.02, 0.13]]) ball(g, 0x4f9e35, x, y, 0, r, { sy: 0.45 });
        for (const [x, z] of [[0.18, 0.08], [-0.2, -0.06]]) ball(g, 0x9a9aa0, x, 0.64, z, 0.04, { sy: 0.6 });
        // little scissors on the stand
        for (const s of [-1, 1]) block(g, 0xdfe4ea, 0.36, 0.505, 0.17, 0.14, 0.01, 0.02, 0.004, { ry: s * 0.25 });
      },
    },

    // ===== wall art (on the back wall) =====
    "art-starry": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      build(g) {
        const tex = canvasTexture(256, 180, (c, w, h) => {
          c.fillStyle = "#1d3a7a"; c.fillRect(0, 0, w, h);
          // swirling sky
          const r = seeded(21);
          for (let i = 0; i < 70; i++) {
            c.strokeStyle = ["#3f6fc8", "#6f9ae8", "#9fc0ff", "#2a4f9a"][i % 4]; c.lineWidth = 3 + r() * 3;
            const x = r() * w, y = r() * h * 0.7, rad = 8 + r() * 26;
            c.beginPath(); c.arc(x, y, rad, r() * TAU, r() * TAU + 2); c.stroke();
          }
          c.strokeStyle = "#cfe0ff"; c.lineWidth = 4;
          for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(120, 62, 14 + k * 9, 0.4 + k, 0.4 + k + 4.4); c.stroke(); }
          for (const [x, y, s] of [[40, 30, 9], [200, 40, 8], [80, 90, 6], [168, 98, 7], [240, 100, 5]]) {
            c.fillStyle = "rgba(255,240,140,0.35)"; c.beginPath(); c.arc(x, y, s * 2.2, 0, TAU); c.fill();
            c.fillStyle = "#fff09a"; c.beginPath(); c.arc(x, y, s, 0, TAU); c.fill();
          }
          c.fillStyle = "rgba(255,220,90,0.4)"; c.beginPath(); c.arc(226, 26, 22, 0, TAU); c.fill();
          c.fillStyle = "#ffd23f"; c.beginPath(); c.arc(226, 26, 14, 0, TAU); c.fill();
          c.fillStyle = "#1d3a7a"; c.beginPath(); c.arc(232, 22, 12, 0, TAU); c.fill();
          // hills, a village with lit windows, and a tall dark tree
          c.fillStyle = "#26406a"; c.beginPath(); c.moveTo(0, 140); c.quadraticCurveTo(90, 115, 256, 135); c.lineTo(256, h); c.lineTo(0, h); c.fill();
          for (let k = 0; k < 7; k++) {
            const x = 90 + k * 22, y = 140 + (k % 2) * 6;
            c.fillStyle = "#3a3050"; c.fillRect(x, y, 16, 14);
            c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x + 8, y - 8); c.lineTo(x + 18, y); c.fill();
            c.fillStyle = "#ffd23f"; c.fillRect(x + 5, y + 4, 4, 4);
          }
          c.fillStyle = "#14261c";
          c.beginPath(); c.moveTo(30, h); c.bezierCurveTo(10, 120, 40, 60, 46, 20); c.bezierCurveTo(56, 70, 76, 120, 64, h); c.fill();
        });
        block(g, woody(0x3a2a1a), 0, 0, 0, 2.0, 1.45, 0.1, 0.05);
        block(g, shiny(0xd9a441), 0, 0, 0.03, 1.86, 1.31, 0.06, 0.02);
        // a little brass picture light above it, and its glow on the painting
        bits(g, (p) => {
          rod(p, 0xd9a441, 0, 0.72, 0.04, 0, 0.86, 0.2, 0.015);
          cylinder(p, 0xd9a441, 0, 0.86, 0.22, 0.05, 0.9, { rz: PI / 2 });
        });
        if (FINE) lightRect(g, 1.5, 0.7, { y: 0.35, z: 0.075, rx: PI / 2 }, 0.12, WARM, 0.35);
        plane(g, 1.8, 1.25, toon(0xffffff, { map: tex }), { z: 0.065 });
      },
    },
    "art-guitar": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      build(g) {
        // an electric guitar on a wall hook, tilted a little
        block(g, 0x3a3f4a, 0, 1.2, 0.02, 0.2, 0.06, 0.06, 0.02);
        const gg = group(g, 0, 0.1, 0.04);
        gg.rotation.z = 0.22;
        const red = toon(0xe8424f);
        ball(gg, red, 0, -0.42, 0.05, 0.38, { sy: 1.05, sz: 0.16 });
        ball(gg, red, 0.02, -0.02, 0.05, 0.29, { sz: 0.16 });
        ball(gg, 0xffffff, 0.08, -0.35, 0.1, 0.22, { sy: 1.2, sz: 0.06 });
        for (const y of [-0.15, -0.38]) block(gg, 0x2f3542, 0, y, 0.115, 0.2, 0.06, 0.02, 0.01);
        block(gg, 0xdfe4ea, 0, -0.6, 0.11, 0.22, 0.05, 0.02, 0.01);
        for (const [x, y] of [[0.2, -0.62], [0.26, -0.52], [0.22, -0.72]]) cylinder(gg, 0xffcf3a, x, y, 0.115, 0.03, 0.02, { rx: PI / 2 });
        block(gg, 0xd9a86a, 0, 0.68, 0.06, 0.1, 1.05, 0.05, 0.02);
        block(gg, 0x5a3a1a, 0, 0.68, 0.087, 0.085, 1.0, 0.01, 0.004);
        for (let k = 0; k < 9; k++) block(gg, 0xdfe4ea, 0, 0.22 + k * 0.105, 0.093, 0.085, 0.008, 0.004, 0.001);
        block(gg, 0x2f3542, 0, 1.3, 0.06, 0.17, 0.24, 0.05, 0.03);
        for (const s of [-1, 1]) for (let k = 0; k < 2; k++) ball(gg, 0xdfe4ea, s * 0.11, 1.24 + k * 0.1, 0.06, 0.025);
        for (let k = 0; k < 4; k++) block(gg, 0xf4f4f4, -0.03 + k * 0.02, 0.33, 0.1, 0.004, 1.86, 0.004, 0.001);
        // a little "ROCK" star sticker on the wall
        const st = canvasTexture(64, 64, (c) => { c.fillStyle = "#ffd23f"; star(c, 32, 34, 30); c.fillStyle = "#e8424f"; c.font = "bold 13px 'Nunito', sans-serif"; c.textAlign = "center"; c.fillText("ROCK", 32, 39); });
        plane(g, 0.5, 0.5, toon(0xffffff, { map: st, alphaTest: 0.5 }), { x: 0.68, y: 0.85, z: 0.01, rz: -0.2 });
      },
    },
    "art-photos": {
      spot: { wx: 2.4, wz: -3.2, yaw: PI },
      build(g, ctx) {
        // two strings of fairy lights with snapshots pegged on
        const scenes = [
          (c) => { c.fillStyle = "#7fd0ff"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#f5dfa4"; c.fillRect(0, 44, 64, 20); c.fillStyle = "#4a9ae2"; c.fillRect(0, 36, 64, 9); c.fillStyle = "#ffd23f"; c.beginPath(); c.arc(48, 14, 8, 0, TAU); c.fill(); },
          (c) => { c.fillStyle = "#cfe8ff"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#7a8aa8"; c.beginPath(); c.moveTo(0, 56); c.lineTo(24, 18); c.lineTo(44, 50); c.lineTo(56, 30); c.lineTo(64, 56); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(18, 28); c.lineTo(24, 18); c.lineTo(30, 28); c.fill(); c.fillStyle = "#5cc84a"; c.fillRect(0, 54, 64, 10); },
          (c) => { c.fillStyle = "#ffe9f0"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#ff9ec7"; c.fillRect(14, 32, 36, 20); c.fillStyle = "#fff"; c.fillRect(14, 28, 36, 6); c.fillStyle = "#ff3b5a"; c.beginPath(); c.arc(32, 24, 5, 0, TAU); c.fill(); c.fillStyle = "#ffcf3a"; c.fillRect(30, 12, 3, 8); },
          (c) => { c.fillStyle = "#fff1dc"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#ff9a3a"; c.beginPath(); c.arc(32, 40, 16, 0, TAU); c.fill(); c.beginPath(); c.moveTo(18, 30); c.lineTo(22, 14); c.lineTo(30, 26); c.moveTo(46, 30); c.lineTo(42, 14); c.lineTo(34, 26); c.fill(); c.fillStyle = "#222"; c.fillRect(25, 36, 4, 4); c.fillRect(35, 36, 4, 4); },
          (c) => { c.fillStyle = "#b8f0c8"; c.fillRect(0, 0, 64, 64); for (const [x, col] of [[18, "#ffd6b0"], [32, "#c98b5a"], [46, "#ffe0c0"]]) { c.fillStyle = col; c.beginPath(); c.arc(x, 28, 8, 0, TAU); c.fill(); c.fillStyle = ["#e8424f", "#4a90e2", "#ffcf3a"][Math.round(x / 14) % 3]; c.fillRect(x - 8, 38, 16, 22); } },
          (c) => { const gr = c.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, "#6a3a9a"); gr.addColorStop(0.6, "#ff8a59"); gr.addColorStop(1, "#ffd166"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); c.fillStyle = "#3a2a4a"; c.fillRect(0, 50, 64, 14); },
        ];
        const lights = [];
        for (const [row, y] of [[0, 0.45], [1, -0.4]]) {
          cylinder(g, 0x6b5a4a, 0, y + 0.04, 0.03, 0.008, 2.0, { rz: PI / 2, shadow: false });
          for (const s of [-1, 1]) ball(g, 0x8f96a3, s * 1.0, y + 0.04, 0.02, 0.03);
          for (let k = 0; k < 3; k++) {
            const x = -0.62 + k * 0.62, rz = [0.08, -0.05, 0.1, -0.09, 0.04, -0.07][row * 3 + k];
            const p = group(g, x, y - 0.25, 0.03);
            p.rotation.z = rz;
            block(p, 0xffffff, 0, 0, 0, 0.42, 0.5, 0.015, 0.005);
            plane(p, 0.36, 0.36, toon(0xffffff, { map: canvasTexture(64, 64, scenes[row * 3 + k]) }), { y: 0.04, z: 0.009 });
            block(p, 0xc98b4a, 0, 0.27, 0.012, 0.04, 0.1, 0.02, 0.005);
          }
          for (let k = 0; k < 6; k++) lights.push(dynamic(ball(g, glow([0xffe08a, 0xff9ec7, 0x9fd8ff][k % 3], 0.8), -0.95 + k * 0.38, y + 0.02, 0.04, 0.03, { shadow: false })));
        }
        ctx.anim.push((t) => lights.forEach((l, i) => { l.material.emissiveIntensity = 0.5 + Math.max(0, Math.sin(t * 2 + i * 1.3)) * 0.7; }));
      },
    },

    // ===== special things (back-right corner) =====
    "special-fridge": {
      obs: [{ cx: 0.55, cz: -0.62, w: 1.05, d: 0.9 }], spot: { lx: 0.45, lz: 0.4, yaw: PI },
      build(g) {
        // a rounded retro fridge covered in magnets and a drawing
        const blue = shiny(0x9fd8f0);
        block(g, blue, 0.55, 1.1, -0.62, 1.0, 2.2, 0.85, 0.14);
        block(g, 0x7fb8d0, 0.55, 1.45, -0.19, 0.96, 0.03, 0.02, 0.01);
        for (const [y, h] of [[1.8, 0.4], [1.0, 0.5]]) block(g, 0xdfe4ea, 0.14, y, -0.16, 0.05, h, 0.06, 0.02);
        block(g, 0xdfe4ea, 0.55, 2.0, -0.185, 0.3, 0.08, 0.01, 0.01);
        const drawing = canvasTexture(64, 80, (c, w, h) => {
          c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "#4a90e2"; c.lineWidth = 3; c.beginPath(); c.arc(32, 26, 12, 0, TAU); c.stroke();
          c.beginPath(); c.moveTo(32, 38); c.lineTo(32, 60); c.moveTo(18, 46); c.lineTo(46, 46); c.moveTo(32, 60); c.lineTo(22, 74); c.moveTo(32, 60); c.lineTo(42, 74); c.stroke();
          c.fillStyle = "#ffd23f"; c.beginPath(); c.arc(52, 10, 7, 0, TAU); c.fill();
          c.fillStyle = "#e8424f"; c.beginPath(); c.arc(28, 24, 2, 0, TAU); c.arc(36, 24, 2, 0, TAU); c.fill();
        });
        plane(g, 0.3, 0.38, toon(0xffffff, { map: drawing }), { x: 0.68, y: 0.95, z: -0.188, rz: 0.08 });
        ball(g, 0xe8424f, 0.68, 1.13, -0.17, 0.035, { sz: 0.5 });
        for (const [x, y, col] of [[0.4, 1.85, 0xffcf3a], [0.7, 1.7, 0x5cc84a], [0.85, 1.95, 0xff9ec7], [0.5, 1.62, 0x9b6bff]]) ball(g, col, x, y, -0.18, 0.045, { sz: 0.5 });
        block(g, 0xffffff, 0.75, 1.82, -0.186, 0.18, 0.12, 0.005, 0.002, { rz: -0.1 });
        // feet, and a cereal box and fruit on top
        for (const x of [0.15, 0.95]) block(g, 0x8f96a3, x, 0.02, -0.3, 0.08, 0.04, 0.08, 0.01);
        block(g, 0xffcf3a, 0.32, 2.38, -0.62, 0.32, 0.36, 0.12, 0.02);
        block(g, 0xe8424f, 0.32, 2.42, -0.555, 0.2, 0.08, 0.005, 0.002);
        put(g, G.taper(0.16, 0.1), toon(0xffffff), { x: 0.78, y: 2.25, z: -0.6, sy: 0.1 });
        ball(g, 0xffe25a, 0.76, 2.33, -0.58, 0.07, { sx: 1.6 });
        ball(g, 0xff9a3a, 0.84, 2.33, -0.66, 0.065);
      },
    },
    "special-easel": {
      obs: [{ cx: 0.35, cz: -0.45, r: 0.55 }, { cx: 1.0, cz: 0.05, r: 0.3 }], spot: { lx: -0.08, lz: 0.32, toward: { lx: 0.35, lz: -0.45 } },
      build(g) {
        // the easel, turned a little toward the room
        const e = group(g, 0.35, 0, -0.45, -0.5);
        const wood = 0xb07a45;
        for (const s of [-1, 1]) rod(e, wood, s * 0.38, 0, 0.18, s * 0.12, 1.95, -0.02, 0.03);
        rod(e, wood, 0, 0, -0.55, 0, 1.85, -0.05, 0.028);
        block(e, wood, 0, 0.88, 0.1, 0.9, 0.05, 0.12, 0.02);
        const art = canvasTexture(128, 100, (c, w, h) => {
          c.fillStyle = "#fffdf5"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#9fd8ff"; c.fillRect(0, 0, w * 0.75, h * 0.6);
          c.fillStyle = "#6fcf6a"; c.beginPath(); c.moveTo(0, h * 0.6); c.quadraticCurveTo(50, h * 0.45, w * 0.75, h * 0.62); c.lineTo(w * 0.75, h); c.lineTo(0, h); c.fill();
          c.fillStyle = "#8a5a3a"; c.fillRect(34, 36, 7, 26);
          c.fillStyle = "#3fae5a"; c.beginPath(); c.arc(38, 32, 15, 0, TAU); c.fill();
          c.fillStyle = "#ffd23f"; c.beginPath(); c.arc(80, 18, 9, 0, TAU); c.fill();
          // still being painted: a few strokes on the white part
          c.strokeStyle = "#ff7ab8"; c.lineWidth = 5; c.beginPath(); c.moveTo(100, 20); c.quadraticCurveTo(110, 40, 104, 60); c.stroke();
          c.strokeStyle = "#4a90e2"; c.beginPath(); c.moveTo(112, 70); c.lineTo(122, 88); c.stroke();
        });
        block(e, 0xfffdf5, 0, 1.3, 0.08, 0.9, 0.72, 0.04, 0.01, { rx: -0.08 });
        plane(e, 0.86, 0.68, toon(0xffffff, { map: art }), { y: 1.3, z: 0.104, rx: -0.08 });
        // paint splats on the floor
        bits(g, (p) => {
          for (const [x, z, s, col] of [[0.1, 0.25, 0.08, 0xff7ab8], [0.55, 0.1, 0.06, 0x4a90e2], [0.25, -0.05, 0.05, 0xffd23f]]) cylinder(p, col, x, 0.012, z, s, 0.004);
        });
        // a stool with the palette and a jar of brushes
        const st = group(g, 1.0, 0, 0.05);
        cylinder(st, 0xb07a45, 0, 0.5, 0, 0.24, 0.06);
        for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; rod(st, 0xb07a45, Math.cos(a) * 0.15, 0.47, Math.sin(a) * 0.15, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, 0.02); }
        ball(st, 0xe0b878, -0.04, 0.545, 0, 0.17, { sy: 0.1, sz: 0.8 });
        for (const [x, z, col] of [[-0.12, 0.05, 0xe8424f], [-0.05, 0.09, 0xffd23f], [0.03, 0.08, 0x4a90e2], [0.08, 0.0, 0x5cc84a]]) ball(st, col, x, 0.56, z, 0.025, { sy: 0.5 });
        cylinder(st, 0xbfe6ff, 0.12, 0.6, -0.08, 0.05, 0.14);
        for (const [dx, col] of [[-0.02, 0xe8424f], [0.02, 0x4a90e2]]) { cylinder(st, 0xc98b4a, 0.12 + dx, 0.72, -0.08, 0.008, 0.22, { rz: dx * 4 }); ball(st, col, 0.12 + dx * 2.6, 0.83, -0.08, 0.015, { sy: 1.6 }); }
      },
    },
    "special-robot": {
      obs: [{ cx: 0.45, cz: -0.5, r: 0.5 }], spot: { lx: 0.05, lz: 0.42, toward: { lx: 0.45, lz: -0.5 } },
      build(g, ctx) {
        // a friendly little robot that looks around and waves
        const r = group(g, 0.45, 0, -0.5, -0.35);
        const metal = shiny(0xdfe4ea), dark = toon(0x3a3f4a);
        for (const s of [-1, 1]) {
          block(r, dark, s * 0.15, 0.06, 0.04, 0.2, 0.12, 0.3, 0.05);
          cylinder(r, 0xb8bcc8, s * 0.15, 0.3, 0, 0.06, 0.38);
        }
        block(r, metal, 0, 0.78, 0, 0.7, 0.62, 0.5, 0.14);
        const chest = canvasTexture(64, 48, (c, w, h) => {
          c.fillStyle = "#1e2233"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#ff6fa5"; heart(c, 20, 12, 22);
          c.fillStyle = "#5cff8a"; for (let k = 0; k < 3; k++) c.fillRect(38, 12 + k * 9, 18 - k * 4, 5);
        });
        plane(r, 0.36, 0.26, basic(chest), { y: 0.8, z: 0.252 });
        for (const [x, col] of [[-0.2, 0xff3b5a], [0.2, 0xffd23f]]) ball(r, glow(col, 0.6), x, 0.6, 0.25, 0.03, { sz: 0.5 });
        // arms: the left one hangs down, the right one waves
        put(r, G.capsule(), metal, { x: -0.43, y: 0.72, sx: 0.12, sy: 0.4, sz: 0.12, rz: -0.15 });
        ball(r, dark, -0.47, 0.42, 0, 0.07);
        const arm = dynamic(group(r, 0.4, 0.95, 0));
        put(arm, G.capsule(), metal, { x: 0.1, y: 0.18, sx: 0.12, sy: 0.4, sz: 0.12, rz: -0.4 });
        ball(arm, dark, 0.2, 0.42, 0, 0.07);
        // the head, with screen eyes that blink, and an antenna
        cylinder(r, dark, 0, 1.12, 0, 0.08, 0.08);
        const head = dynamic(group(r, 0, 1.36, 0));
        block(head, metal, 0, 0, 0, 0.6, 0.44, 0.44, 0.12);
        block(head, 0x1e2233, 0, 0, 0.215, 0.48, 0.3, 0.02, 0.06);
        const eyes = [];
        for (const s of [-1, 1]) eyes.push(ball(head, glow(0x5cf0ff, 1), s * 0.11, 0.03, 0.23, 0.05, { sy: 1.3, sz: 0.4, shadow: false }));
        block(head, glow(0x5cf0ff, 0.8), 0, -0.08, 0.228, 0.12, 0.025, 0.01, 0.01);
        for (const s of [-1, 1]) cylinder(head, dark, s * 0.31, 0, 0, 0.06, 0.04, { rz: PI / 2 });
        cylinder(head, 0x8f96a3, 0, 0.3, 0, 0.012, 0.18);
        const bulb = ball(head, glow(0xff3b5a, 1), 0, 0.41, 0, 0.045, { shadow: false });
        ctx.anim.push((t) => {
          head.rotation.y = Math.sin(t * 0.7) * 0.35;
          head.rotation.z = Math.sin(t * 1.3) * 0.05;
          const blink = (t % 3.2) < 0.12 ? 0.15 : 1;
          eyes.forEach((e) => { e.scale.y = 0.065 * blink; });
          bulb.material.emissiveIntensity = (t % 1) < 0.5 ? 1.2 : 0.2;
          arm.rotation.z = 0.25 + Math.sin(t * 4) * 0.35;
        });
      },
    },
  };

  // A computer screen full of code (scrolls upward).
  function codeScreen() {
    return canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = "#1e2233"; c.fillRect(0, 0, w, h);
      const r = seeded(29);
      const cols = ["#ff7ab8", "#7fe0ff", "#ffd166", "#9cff8a", "#ffffff"];
      for (let y = 6; y < h; y += 8) {
        let x = 6 + Math.floor(r() * 3) * 8;
        while (x < w - 20 && r() < 0.8) { const l = 8 + r() * 26; c.fillStyle = cols[Math.floor(r() * cols.length)]; c.fillRect(x, y, l, 4); x += l + 5; }
      }
    }, [1, 1]);
  }
  // A side-scrolling game: hills, clouds, coins and a little hero.
  function gameScreen() {
    return canvasTexture(256, 128, (c, w, h) => {
      c.fillStyle = "#6cc2ff"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#ffffff"; for (const x of [30, 150, 220]) { c.beginPath(); c.arc(x, 28, 10, 0, TAU); c.arc(x + 12, 24, 12, 0, TAU); c.arc(x + 24, 28, 9, 0, TAU); c.fill(); }
      c.fillStyle = "#5cc84a"; for (const x of [40, 170]) { c.beginPath(); c.arc(x, h - 18, 34, PI, 0); c.fill(); }
      c.fillStyle = "#c97a3a"; c.fillRect(0, h - 18, w, 18);
      c.fillStyle = "#8ad43a"; c.fillRect(0, h - 20, w, 4);
      c.fillStyle = "#e0884a"; for (const x of [90, 106, 122]) c.fillRect(x, 60, 15, 15);
      c.fillStyle = "#ffd23f"; for (const x of [70, 200, 215, 230]) { c.beginPath(); c.ellipse(x, 52, 4, 6, 0, 0, TAU); c.fill(); }
      c.fillStyle = "#3db55a"; c.fillRect(150, h - 44, 18, 26); c.fillRect(146, h - 48, 26, 8);
    }, [1, 1]);
  }
  // A few different TV shows (switched every few seconds).
  function tvShow(kind) {
    return canvasTexture(128, 100, (c, w, h) => {
      if (kind === 0) { // cooking show
        c.fillStyle = "#ffe9c4"; c.fillRect(0, 0, w, h);
        c.fillStyle = "#ffffff"; c.fillRect(40, 22, 30, 22);
        c.fillStyle = "#ffd6b0"; c.beginPath(); c.arc(55, 50, 14, 0, TAU); c.fill();
        c.fillStyle = "#8a5a3a"; c.fillRect(0, 72, w, 28);
        c.fillStyle = "#555"; c.beginPath(); c.ellipse(90, 74, 22, 6, 0, 0, TAU); c.fill();
        c.fillStyle = "#ff7a59"; c.font = "bold 13px sans-serif"; c.fillText("COOKING!", 6, 14);
      } else if (kind === 1) { // weather
        c.fillStyle = "#4a90e2"; c.fillRect(0, 0, w, h);
        c.fillStyle = "#5cc84a"; c.beginPath(); c.ellipse(60, 60, 40, 26, 0.3, 0, TAU); c.fill();
        c.fillStyle = "#ffd23f"; c.beginPath(); c.arc(40, 45, 10, 0, TAU); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(80, 60, 10, 0, TAU); c.arc(92, 58, 12, 0, TAU); c.fill();
        c.font = "bold 16px sans-serif"; c.fillText("24°", 92, 92);
      } else { // a cartoon
        c.fillStyle = "#ffd6e6"; c.fillRect(0, 0, w, h);
        c.fillStyle = "#ff6fa5"; c.beginPath(); c.arc(64, 54, 26, 0, TAU); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(55, 48, 7, 0, TAU); c.arc(73, 48, 7, 0, TAU); c.fill();
        c.fillStyle = "#222"; c.beginPath(); c.arc(56, 49, 3, 0, TAU); c.arc(74, 49, 3, 0, TAU); c.fill();
        c.strokeStyle = "#222"; c.lineWidth = 2; c.beginPath(); c.arc(64, 60, 9, 0.2, PI - 0.2); c.stroke();
      }
      // old TV scan lines
      c.fillStyle = "rgba(0,0,0,0.08)"; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    });
  }

  // =====================================================================
  // The little rooms you see through the apartment windows
  // =====================================================================
  // Room-local coordinates: (0, 0, 0) is the middle of the room's floor, x runs
  // across (-2..2), z runs from the back wall (-1.45) to the window wall (+1.45).

  // Wallpaper and floor for the little rooms: one material per item, shared by
  // every flat that has it (smaller pictures than in a home: they're far away).
  const flatMats = new Map();
  function flatMaterial(it, isFloor) {
    const key = (isFloor ? "f:" : "w:") + ((it && it.id) || "-");
    if (!flatMats.has(key)) {
      const tex = patternTexture(it || {}, isFloor, 128);
      // a warm glow, as if the ceiling light were on
      const m = toon(0xffffff, { map: tex, emissive: 0xffe2b8, emissiveMap: tex, emissiveIntensity: isFloor ? 0.08 : 0.12 });
      m.userData.keep = true;
      flatMats.set(key, m);
    }
    return flatMats.get(key);
  }
  let flatLightMats = null;
  function flatLight() {
    if (!flatLightMats) {
      flatLightMats = {
        shade: toon(0xfff1dc, { emissive: 0xffd890, emissiveIntensity: 0.55 }),
        bulb: new THREE.MeshBasicMaterial({ color: 0xfff2c4, toneMapped: false }),
      };
      flatLightMats.shade.userData.keep = flatLightMats.bulb.userData.keep = true;
    }
    return flatLightMats;
  }

  // The walls, floor and ceiling of a little room (inside faces only).
  function flatShell(room) {
    const hw = FLAT.hw, d = FLAT.depth, ch = FLAT.ceil;
    const back = patchGeo(hw * 2, ch, 0, 0); back.translate(0, ch / 2, -d / 2);
    const left = patchGeo(d, ch, 0, 0); left.rotateY(PI / 2); left.translate(-hw, ch / 2, 0);
    const right = patchGeo(d, ch, 0, 0); right.rotateY(-PI / 2); right.translate(hw, ch / 2, 0);
    const floorGeo = patchGeo(hw * 2, d, 0, 0); floorGeo.rotateX(-PI / 2);
    const ceilGeo = new THREE.PlaneGeometry(hw * 2, d); ceilGeo.rotateX(PI / 2); ceilGeo.translate(0, ch, 0);
    const walls = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries([back, left, right]), toon(0xffffff));
    const floor = new THREE.Mesh(floorGeo, toon(0xffffff));
    const ceil = new THREE.Mesh(ceilGeo, toon(0xfff8ee));
    [back, left, right].forEach((g) => g.dispose());
    for (const m of [walls, floor, ceil]) { m.castShadow = m.receiveShadow = false; room.add(m); }
    return { walls, floor };
  }

  // What's in a flat, as a short text: the room is only rebuilt when this changes.
  function flatKey(r) {
    const a = r.activity;
    return JSON.stringify(r.items || {}) + "|" + r.name + "|" +
      (a ? [a.itemId, a.slot, !!a.sit, !!a.lie, !!a.run, a.arms, a.lookUp].join(",") : "-");
  }

  // Where the piece a Mii is using goes in its little room: x, z, turn (ry) and
  // size (k). stand = where the Mii stands (yaw, or toward: true = facing the
  // piece / { lx, lz } = a point on it); otherwise it's worked out from the
  // furniture's own spot. plant = a free corner for a pot plant.
  const FLAT_SLOTS = {
    bed: { x: -0.35, z: -0.38, ry: PI / 2, k: 0.85, plant: [1.55, -1.05] },        // along the back, head to the left wall
    sofa: { x: 0.1, z: -0.6, ry: 0, k: 1, plant: [-1.68, -1.1] },                    // facing the window
    table: { x: 0.2, z: 0.5, ry: 0, k: 0.9, plant: [-1.6, -1.05] },                  // the Mii stands behind it, facing you
    tv: { x: 1.45, z: 0.1, ry: -PI / 2, k: 0.9, plant: [-1.6, -1.05] },             // against the right wall (seen from the side)
    lamp: { x: 1.4, z: 0.4, ry: 0, k: 1, stand: { x: 0.2, z: -0.3, toward: true }, plant: [-1.6, -1.05] },
    plant: { x: 1.3, z: 0.5, ry: 0, k: 0.85, stand: { x: 0.1, z: -0.2, toward: true } },
    art: { x: -1.97, y: 1.75, z: 0.1, ry: PI / 2, k: 0.75, stand: { x: -0.75, z: 0.45, yaw: -1.2 }, plant: [1.55, -1.05] }, // on the left wall
    special: { x: 0.2, z: -0.15, ry: 0, k: 0.9, plant: [-1.6, -1.05] },
    window: { stand: { x: 0.35, z: 0.75, yaw: 0 }, plant: [-1.68, -1.1] },           // just looking out
  };
  const FLAT_ITEMS = {
    "table-picnic": { z: 0.4, k: 0.8 },
    "table-desk": { x: 0.55, z: 0.3, ry: PI / 2 },                                   // side on, so you see the screen and the Mii
    "lamp-lava": { nightstand: true },
    "lamp-chandelier": { x: -0.3, z: 0, k: 0.8, hang: true, stand: { x: 0.75, z: 0.35, yaw: -0.3 } },
    "plant-tree": { k: 0.7 },
    "tv-treadmill": { x: 0.9 },                                                      // (more in the middle, so you see the runner)
    "special-fishtank": { x: 0.95, z: 0, ry: -PI / 2 },
    "special-drums": { x: 0.1 },
    "special-telescope": { x: 0.3, z: 0.15, ry: PI, k: 1 },                          // pointing out of the window
    "special-plushies": { x: -0.95, z: 0.45, k: 0.85, stand: { x: 0.75, z: -0.3, toward: { lx: 0.3, lz: -0.35 } }, plant: [1.55, -1.05] },
    "special-punchbag": { x: 0.35 },
    "lamp-moon": { nightstand: true },
    "lamp-disco": { x: -0.3, z: 0, k: 0.8, hang: true, stand: { x: 0.75, z: 0.35, yaw: -0.3 } },
    "sofa-egg": { z: -0.35 },
    "table-pingpong": { z: 0.4, k: 0.75, stand: { x: -1.45, z: 0.4, yaw: PI / 2 } },
    "table-kitchen": { z: 0.45, k: 0.85 },
    "plant-sunflower": { k: 0.8 },
    "special-fridge": { x: -0.1, z: -0.1 },
    "special-easel": { x: -0.1, z: 0.1 },
    "special-robot": { x: -0.1, z: 0.1 },
  };

  // Where the Mii goes (room-local), following the same rules as the spots in a home.
  function flatSpot(def, L, act) {
    const k = L.k || 1, c = Math.cos(L.ry || 0), s = Math.sin(L.ry || 0);
    const tw = (lx, lz) => ({ x: L.x + (lx * c + lz * s) * k, z: L.z + (-lx * s + lz * c) * k });
    const spot = { pose: "stand", y: 0, arms: (act && act.arms) || undefined, lookUp: (act && act.lookUp) || 0 };
    if (act && act.lie && def.lie) return Object.assign(spot, tw(def.lie.lx, def.lie.lz), { y: def.lie.h * k, yaw: (L.ry || 0) + def.lie.yaw, pose: "lie" });
    if (act && act.sit && def.seat) return Object.assign(spot, tw(def.seat.lx, def.seat.lz), { y: def.seat.h * k - 0.56, yaw: L.ry || 0, pose: "sit", legs: def.seat.legs });
    if (act && act.run && def.stand) return Object.assign(spot, tw(def.stand.lx, def.stand.lz), { y: def.stand.h * k, yaw: (L.ry || 0) + ((def.spot && def.spot.yaw) || 0), pose: "run" });
    const st = L.stand || def.spot || { lx: 0, lz: 1, yaw: PI };
    const at = st.x !== undefined ? { x: st.x, z: st.z } : tw(st.lx, st.lz);
    let yaw = st.x !== undefined ? st.yaw : (L.ry || 0) + (st.yaw || 0);
    if (st.toward) {
      const tgt = st.toward === true ? { x: L.x, z: L.z } : tw(st.toward.lx, st.toward.lz);
      yaw = Math.atan2(tgt.x - at.x, tgt.z - at.z);
    }
    return Object.assign(spot, at, { yaw });
  }

  // Builds what's inside a flat (detached, around the room's origin) and works
  // out where its Mii goes. act = the resident's activity (or null).
  function flatContents(items, act, name, anim, record) {
    const H = root.MiiHomes;
    const g = new THREE.Group();
    const ctx = { anim, record: { name }, portrait: portraitSource(null, record), flat: true };
    let it = act && act.itemId && H ? H.item(act.itemId) : null;
    let def = it && FURNITURE[it.id];
    let slot = it ? it.slot : "window";
    if (!def || !FLAT_SLOTS[slot] || !it.use) { it = null; def = null; slot = "window"; }
    const L = Object.assign({ ry: 0, k: 1 }, FLAT_SLOTS[slot], it ? FLAT_ITEMS[it.id] : null);
    const add = (item, p) => {
      const d = item && FURNITURE[item.id];
      if (!d) return null;
      const ig = group(g, p.x, p.y || 0, p.z, p.ry || 0, p.k || 1);
      d.build(ig, ctx);
      return ig;
    };
    let spot;
    if (def) {
      const ig = add(it, L);
      if (L.nightstand) {
        // (the lava lamp stands on a little bedside table, like at home)
        block(ig, 0xc98b4a, 0, 0.36, 0, 0.75, 0.72, 0.65, 0.06);
        block(ig, 0xe0a868, 0, 0.42, 0.33, 0.6, 0.25, 0.02, 0.03);
      }
      if (L.hang) {
        // a chandelier: no long chain (this room has a ceiling), hung just under it
        ig.remove(ig.children[0]);
        const ringY = FLAT.ceil - 0.42;
        ig.position.y = ringY - (ROOM.h - 1.2) * L.k;
        cylinder(g, 0xd9a441, L.x, (ringY + FLAT.ceil) / 2, L.z, 0.02, FLAT.ceil - ringY, { shadow: false });
      }
      spot = flatSpot(def, L, act);
    } else {
      // nothing in particular: the armchair at the back, and the Mii looks out of the window
      if (items.sofa) add(items.sofa, FLAT_SLOTS.sofa);
      spot = Object.assign({ pose: "stand", y: 0, arms: undefined, lookUp: 0.1 }, FLAT_SLOTS.window.stand);
    }
    // a couple of the Mii's other things, so it looks like its home
    if (items.rug && items.rug.id !== "rug-none") add(items.rug, { x: 0, y: 0.015, z: 0.15, k: 0.5 });
    if (items.plant && items.plant.id !== "plant-none" && slot !== "plant" && L.plant) {
      add(items.plant, { x: L.plant[0], z: L.plant[1], k: items.plant.id === "plant-tree" ? 0.55 : 0.6 });
    }
    if (items.art && items.art.id !== "art-none" && slot !== "art") add(items.art, { x: 0.65, y: 2.05, z: -FLAT.depth / 2 + 0.03, k: 0.5 });
    // the ceiling light
    if (!L.hang) {
      const lm = flatLight(), lx = 1.1, lz = -0.15, ly = 2.82;
      cylinder(g, 0x8a7a6a, lx, (FLAT.ceil + ly) / 2, lz, 0.015, FLAT.ceil - ly, { shadow: false });
      put(g, G.taper(0.1, 0.28, 14), lm.shade, { x: lx, y: ly, z: lz, sy: 0.2, shadow: false });
      put(g, G.lowSphere(), lm.bulb, { x: lx, y: ly - 0.1, z: lz, s: 0.07, shadow: false });
    }
    g.traverse((o) => { if (o.isMesh || o.isSprite) { o.castShadow = false; o.receiveShadow = false; } });
    bakeFlat(g);
    return { group: g, spot };
  }

  // Joins all the plain-colored parts of a little room into ONE shape that keeps
  // their colors (so a whole room is only a few draw calls), then merges the rest.
  let flatPaint = null;
  function bakeFlat(g) {
    if (W3D.debug && W3D.debug.noMerge) return;
    g.updateMatrixWorld(true);
    // moving parts (swaying leaves, swimming fish...) are baked one by one, in their own space
    const movers = [];
    g.traverse((o) => { if (o !== g && o.userData.dynamic && !o.isMesh && !o.isSprite) movers.push(o); });
    for (const m of movers) paintTogether(m);
    paintTogether(g);
    mergeStatic(g);
  }
  // Joins the plain-colored shapes under c (but not inside its moving parts)
  // into one shape that keeps their colors.
  const tmpInv = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  function paintTogether(c, cast) {
    if (!flatPaint) flatPaint = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toon(0xffffff).gradientMap, vertexColors: true });
    tmpInv.copy(c.matrixWorld).invert();
    const geos = [], remove = [];
    const visit = (o) => {
      for (const ch of o.children) {
        if (ch.userData.dynamic) continue;
        visit(ch);
        if (!ch.isMesh || ch.isInstancedMesh) continue;
        const m = ch.material;
        if (Array.isArray(m) || !m.isMeshToonMaterial || m.map || m.transparent || m.vertexColors || m.side !== THREE.FrontSide || (m.emissive && m.emissive.getHex())) continue;
        const src = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
        if (!src.attributes.normal) src.computeVertexNormals();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", src.attributes.position);
        geo.setAttribute("normal", src.attributes.normal);
        geo.applyMatrix4(tmpM.multiplyMatrices(tmpInv, ch.matrixWorld));
        const n = geo.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = m.color.r; col[i * 3 + 1] = m.color.g; col[i * 3 + 2] = m.color.b; }
        geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        geos.push(geo);
        remove.push(ch);
      }
    };
    visit(c);
    if (geos.length < 2) { if (geos.length) geos[0].dispose(); return; }
    for (const o of remove) o.parent.remove(o);
    const mesh = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false), flatPaint);
    geos.forEach((x) => x.dispose());
    mesh.castShadow = mesh.receiveShadow = !!cast;
    c.add(dynamic(mesh)); // (dynamic: it's already in place, mergeStatic must leave it alone)
  }

  // The moving parts under g: each one's plain-colored parts become one shape.
  function paintMovers(g) {
    if (W3D.debug && W3D.debug.noMerge) return;
    const movers = [];
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (o !== g && o.userData.dynamic && !o.isMesh && !o.isSprite) movers.push(o); });
    for (const m of movers) paintTogether(m, true);
  }

  // Frees a little room's contents (keeps the shapes and materials that are shared).
  function disposeFlat(g) {
    W3D.dispose({ group: g });
    g.traverse((o) => {
      const m = o.material;
      if (m && !Array.isArray(m) && !m.userData.keep && (m.map || m.transparent || (m.emissive && m.emissive.getHex()))) m.dispose();
    });
  }

  // What a flat looks out on: the courtyard, the street, the houses across the
  // road, trees, hills and clouds. A lighter copy of the apartments place, in the
  // same coordinates (the ground is at y = 0, the building's front at z = APT.front).
  // It's only a backdrop, so: few, simple shapes, all merged later.
  function courtyardView(p, anim) {
    const FZ = APT.front;
    disc(p, toon(0xffffff, { map: grassTexture([60, 60], 12, 90) }), 0, -0.02, 0, 170);
    put(p, new THREE.PlaneGeometry(36, 22.6), toon(0xffffff, { map: paveTexture([9, 6]) }), { y: 0.01, z: (FZ + 11) / 2, rx: -PI / 2, shadow: false });
    block(p, 0x7fd05a, -11.8, 0.03, 5.6, 10.6, 0.06, 8.4, 0.03, { shadow: false });
    block(p, 0x7fd05a, 12.6, 0.03, 5.2, 9.6, 0.06, 9.2, 0.03, { shadow: false });
    // the round flower bed with its cherry tree
    cylinder(p, 0xd98a6a, 0, 0.22, -5, 1.6, 0.44, { seg: 20 });
    disc(p, toon(0x8a5a3a), 0, 0.45, -5, 1.48);
    const fr = seeded(7);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, d = 0.6 + fr() * 0.7;
      put(p, G.tinySphere(), toon([0xff6fa5, 0xffe25a, 0xffffff, 0xb58cff, 0xff8a4c][i % 5]), { x: Math.cos(a) * d, y: 0.62, z: -5 + Math.sin(a) * d, s: 0.16, sy: 0.11, shadow: false });
    }
    farTree(group(p, 0, 0.45, 0), 0, -5, 0.5, [0xff9ec7, 0xffc3dc]);
    // koi pond, sandbox, bench, picnic table, washing line
    disc(p, toon(0x5aa646), 4.6, 0.02, 5.6, 1, { sx: 3.15, sy: 2.05 });
    disc(p, toon(0x4fb8e8), 4.6, 0.05, 5.6, 1, { sx: 2.8, sy: 1.7 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      put(p, G.tinySphere(), toon(i % 2 ? 0xc9c4b8 : 0xb3ada0), { x: 4.6 + Math.cos(a) * 3.0, y: 0.1, z: 5.6 + Math.sin(a) * 1.9, s: 0.36, sy: 0.2, shadow: false });
    }
    bx(p, 0xd9894a, -11, 0.2, 5.6, 3.8, 0.4, 3.2);
    bx(p, 0xf6dd9a, -11, 0.22, 5.6, 3.5, 0.4, 2.9);
    parkBench(p, -5.6, 0.6, 0);
    bx(p, 0xc98b4a, 13.2, 0.8, 2.2, 2.4, 0.1, 0.95);
    for (const sz of [-0.8, 0.8]) bx(p, 0xc98b4a, 13.2, 0.48, 2.2 + sz, 2.4, 0.08, 0.38);
    for (const x of [7.2, 12.6]) bx(p, 0xd9894a, x, 1.3, -7.4, 0.12, 2.6, 0.12);
    [[7.9, 0x8fd3ff], [9.0, 0xff9ec7], [9.9, 0xffffff], [11.1, 0xffd166]].forEach(([x, c]) => bx(p, c, x, 1.95, -7.4, 0.8, 1.0, 0.04));
    for (const [x, z] of [[-5.0, -4.6], [5.0, -4.6], [-12.4, -1.2], [12.0, -1.2]]) lampPost(p, x, z);
    for (const [x, z, c] of [[-16, -2.4, 0], [15.9, -2.6, 0], [-16, 9.3, 0], [16.3, 9.6, 1]]) farTree(p, x, z, 0.95, c ? [0xff9ec7, 0xffc3dc] : null);
    // the hedge with the gate at the front
    for (const [x, z, w, d] of [[-9.9, 10.9, 16.2, 0.8], [9.9, 10.9, 16.2, 0.8], [-18.2, -0.3, 0.8, 22.4], [18.2, -0.3, 0.8, 22.4]]) bx(p, 0x4fae3f, x, 0.5, z, w, 1.0, d);
    for (const sx of [-1.75, 1.75]) {
      bx(p, 0xd98a6a, sx, 0.65, 10.9, 0.7, 1.3, 0.7);
      ball(p, glow(0xfff1b8, 0.9), sx, 1.6, 10.9, 0.22);
    }
    // the street, with a zebra crossing
    bx(p, 0xd8d4cc, 0, 0.06, 12.4, 300, 0.12, 1.8, { shadow: false });
    bx(p, 0x6b6f78, 0, 0.02, 16.0, 300, 0.04, 5.4, { shadow: false });
    bx(p, 0xd8d4cc, 0, 0.06, 19.6, 300, 0.12, 1.8, { shadow: false });
    for (let x = -90; x < 90; x += 3) if (Math.abs(x) > 3) bx(p, 0xfdfdf5, x, 0.05, 16, 1.6, 0.02, 0.14, { shadow: false });
    for (let k = 0; k < 7; k++) bx(p, 0xfdfdf5, -2.4 + k * 0.8, 0.05, 16, 0.45, 0.02, 5.0, { shadow: false });
    for (let x = -36; x <= 36; x += 12) lampPost(p, x, 19.1);
    // houses across the street, to the sides and further away
    const cols = [[0xfff1dc, 0xe2574c], [0xdff3ff, 0x4a90e2], [0xffe0ec, 0xb58cff], [0xeaffd9, 0xff8a4c], [0xfff6c2, 0x3fb39a]];
    let hc = 0;
    for (let x = -44; x <= 44; x += 11) {
      const [wall, roof] = cols[hc++ % cols.length];
      house(p, x, 25.5, PI, { w: 5, d: 4.2, h: 2.8, rh: 2.0, wall, roof, door: [0x9a6a3c, 0x4a90e2, 0xff7a8a][hc % 3] });
      farTree(p, x + 5.5, 22.5, 0.8, hc % 2 ? [0x5cc84a, 0x7fdc5c] : [0x4fbf47, 0x8ae065]);
    }
    for (let x = -50; x <= 50; x += 12.5) {
      const [wall, roof] = cols[hc++ % cols.length];
      house(p, x + 3, 40, PI, { w: 5, d: 4.2, h: 2.8, rh: 2.0, wall, roof, s: 1.2 });
      farTree(p, x - 2, 34 + (hc % 3) * 2, 1.1, hc % 2 ? [0x5cc84a, 0x7fdc5c] : [0x4fbf47, 0x8ae065]);
      farTree(p, x + 5, 50 + (hc % 2) * 4, 1.3);
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const [wall, roof] = cols[(k + (side > 0 ? 2 : 0)) % cols.length];
        house(p, side * (25 + (k % 2) * 3), -6 + k * 8, -side * PI / 2, { w: 4.6, d: 4.0, h: 2.6, rh: 1.8, wall, roof });
        farTree(p, side * 21.5, -9 + k * 8, 0.9 + (k % 2) * 0.15);
      }
    }
    // soft hills all the way round, and clouds
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.2, r = 95 + (i % 3) * 12, s = 28 + ((i * 7) % 5) * 6;
      put(p, G.lowSphere(), toon(i % 2 ? 0x7fcf5a : 0x6cc24a), { x: Math.cos(a) * r, y: -s * 0.45, z: Math.sin(a) * r, sx: s, sy: s * 0.75, sz: s * 0.7, shadow: false, receive: false });
    }
    const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25 });
    const clouds = [];
    for (let i = 0; i < 7; i++) clouds.push({ c: cloud(p, cloudMat, 0, 20 + (i % 3) * 4, 0, 1 + (i % 2) * 0.3), a: (i / 7) * TAU, r: 50 + (i % 3) * 14 });
    anim.push((t) => clouds.forEach((q) => { const a = q.a + t * 0.006; q.c.position.x = Math.cos(a) * q.r; q.c.position.z = Math.sin(a) * q.r; }));
  }

  // The front of the apartment building (doors, windows, curtains) as a picture,
  // one floor of two flats per tile: for the floors under a home's room.
  // (back = the back and sides of the building: just windows)
  // homes (optional, from the ground floor up): [{ here, next }] who's in the flat right
  // below and the one beside it (true = in: curtains open, false = out: curtains shut,
  // null = nobody lives there). Then the picture has one row per floor.
  function facadeTexture(floors, back, homes) {
    const rows = homes && homes.length === floors ? floors : 1;
    // a window's curtains (x, y, w, h = the glass), open or shut
    const curtains = (c, x, y, w, h, color, open) => {
      c.fillStyle = hex(color);
      if (open) { c.fillRect(x, y, w * 0.23, h); c.fillRect(x + w * 0.77, y, w * 0.23, h); return; }
      c.fillRect(x, y, w, h);
      c.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 1; k < 6; k++) c.fillRect(x + (w * k) / 6 - 1, y, 2, h); // the folds
      c.fillStyle = "rgba(255,255,255,0.7)"; c.fillRect(x + w / 2 - 1, y, 2, h);
    };
    return canvasTexture(512, 128 * rows, (c, w, H) => {
      for (let r = 0; r < rows; r++) {
        const y0 = r * 128;
        const row = rows > 1 ? homes[floors - 1 - r] : null; // (the top row is the floor just below)
        const isOpen = (here) => !row || row[here ? "here" : "next"] === true;
        c.fillStyle = "#ffe6c7"; c.fillRect(0, y0, w, 128);
        c.fillStyle = "#ffd3a8"; c.fillRect(0, y0, w, 6);
        if (back) {
          for (let k = 0; k < 3; k++) {
            const x0 = k * 170 + 30;
            c.fillStyle = "#ffffff"; c.fillRect(x0, y0 + 34, 110, 64);
            c.fillStyle = "#9fd0f0"; c.fillRect(x0 + 6, y0 + 40, 98, 52);
            curtains(c, x0 + 6, y0 + 40, 98, 52, UNIT_COLORS[(k * 5 + 2) % UNIT_COLORS.length][1], isOpen(k !== 1));
          }
          continue;
        }
        for (let k = 0; k < 2; k++) {
          const x0 = k * 256, col = UNIT_COLORS[(k * 3 + 1) % UNIT_COLORS.length];
          const open = isOpen(k === 0);
          c.fillStyle = "#ffffff"; c.fillRect(x0 + 32, y0 + 46, 54, 82);
          c.fillStyle = hex(col[0]); c.fillRect(x0 + 36, y0 + 50, 46, 78);
          c.fillStyle = "#ffffff"; c.fillRect(x0 + 108, y0 + 22, 124, 94);
          c.fillStyle = open ? "#bfe6ff" : "#9fc4dc"; c.fillRect(x0 + 114, y0 + 28, 112, 84);
          if (open) { c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(x0 + 150, y0 + 32, 8, 76); }
          curtains(c, x0 + 114, y0 + 28, 112, 84, col[1], open);
        }
      }
    }, [1, floors / rows]);
  }

  // Curtains drawn shut across a home's window (while the Mii is out): soft folds side
  // by side, from the rod down to the sill.
  function closedCurtains(p, wx, wy, ww, wh, color) {
    const mat = toon(color), dark = toon(new THREE.Color(color).multiplyScalar(0.86).getHex());
    const n = 12, span = ww + 0.7;
    for (let k = 0; k < n; k++) {
      const x = wx - span / 2 + (k + 0.5) * (span / n);
      put(p, G.capsule(), k % 2 ? dark : mat, { x, y: wy - 0.03, z: 0.16 + (k % 2) * 0.03, sx: span / n * 1.35, sy: (wh + 0.36) / 2, sz: 0.12, shadow: false });
    }
  }

  // RARE (well under 1% of the time, and only while you're visiting and the Mii is in):
  // another Mii peeks in through the window from outside. Turn round and click it: it
  // yells "BOO!", the Mii inside jumps out of its skin, the prankster runs off laughing,
  // and what the Mii says then depends on how the two get on. (A sticker!)
  //   outY = the ground outside the window (the walkway, or the courtyard on the ground floor)
  function windowPrank(outY) {
    const WX = WINDOW.x, WZ = -ROOM.z - 0.85; // where the prankster stands, just outside the glass
    let ev = null, check = 5;
    const shout = (w, text, secs) => { w.say(text, secs || 1.6); w.uiBubble.classList.add("shout"); };
    // what the Mii says once it's got its breath back (n = the prankster's name)
    function relief(rel, n) {
      if (rel.couple) return [n + "! You scared me half to death! ...You're lucky you're cute. 💕", "cheer"];
      if (rel.fight) return ["Hmph! As if we weren't fighting already, " + n + "!", "shout"];
      if (rel.rival) return [n + "!! I'll get you back for this. Just you wait!", "punch"];
      if (rel.points >= 16) return ["Hehe... classic " + n + "! Best friends forever... but I'll get you next time!", "cheer"];
      if (rel.points >= 9) return [n + ", you goof! My heart's still racing!", "down"];
      if (rel.points >= 4) return [n + "! You nearly gave me a heart attack!", "down"];
      if (rel.points >= 1) return ["Was that... " + n + "? We barely even know each other!", "down"];
      return ["Who WAS that?! I've never seen them before!", "down"];
    }
    function end(ctx, done) {
      const e = ev;
      ev = null;
      check = 5;
      if (!e) return;
      if (e.g) ctx.dropGuest(e.g);
      const h = e.host;
      if (h && e.scared) { h.shake = 0; h.nod = 0; h.arms = "down"; if (h.state === "perform") h.timer = 0; }
      if (done) ctx.event("boo");
    }
    const rare = {
      update(dt, t, ctx) {
        if (!ev) {
          check -= dt;
          if (check > 0) return;
          check = 5;
          if (Math.random() < 0.006) this.force(ctx);
          return;
        }
        const e = ev, g = e.g, h = ctx.host();
        if (!h || h !== e.host) { end(ctx, false); return; }
        e.time += dt;
        if (e.phase === "peek") {
          // rises up from under the sill, then bobs about, ducking down now and then
          const up = Math.min(1, e.time / 0.9);
          e.duck = Math.max(0, e.duck - dt);
          if (e.duck <= 0 && Math.random() < dt * 0.12) e.duck = 1.6;
          const down = e.duck > 0 ? Math.sin(Math.min(1, (1.6 - e.duck) / 1.6) * Math.PI) : 0;
          g.rareLift = outY - (1 - up) * 1.3 - down * 1.1 + Math.sin(e.time * 2.4) * 0.05;
          g.x = WX + Math.sin(e.time * 0.7) * 0.25;
          g.targetYaw = Math.sin(e.time * 0.9) * 0.3;
          if (e.time > 45) { e.phase = "sneak"; e.time = 0; } // (nobody noticed: off it goes)
        } else if (e.phase === "sneak") {
          g.rareLift = outY - Math.min(1, e.time / 0.8) * 1.4;
          if (e.time > 0.8) end(ctx, false);
        } else if (e.phase === "boo") {
          const turn = Math.atan2(g.x - h.x, g.z - h.z); // the Mii inside turns to the window
          if (e.time > 0.35) h.targetYaw = turn;
          if (!e.aah && e.time > 0.6) {
            e.aah = true;
            shout(h, "AAH!", 1.8);
            h.arms = "up"; h.shake = 1; h.hop(6);
          }
          if (e.time > 1.6 && h.shake) { h.shake = 0; h.arms = "down"; }
          if (!e.run && e.time > 1.3) { // the prankster runs off, laughing
            e.run = true;
            g.say("Hahaha! Gotcha!", 2.2);
            g.laugh = true; g.arms = "down";
          }
          if (e.run) {
            g.state = "walk"; g.curSpeed = 4.5; g.phase += dt * 13;
            g.targetYaw = Math.PI / 2;
            g.x += 4.5 * dt;
            g.rareLift = outY;
            if (g.x > WX + 9) { ctx.dropGuest(g); e.g = null; e.phase = "relief"; e.time = 0; }
          }
        } else if (e.phase === "relief") {
          if (!e.sigh && e.time > 0.6) { e.sigh = true; h.say("*sigh*... Phew.", 2); h.nod = 0.35; }
          if (!e.line && e.time > 2.8) {
            e.line = true;
            h.nod = 0;
            const [text, arms] = relief(ctx.relation(h.record, e.who.record), e.who.look.name);
            h.say(text, 3.6);
            h.arms = arms;
            if (arms === "shout" || arms === "punch") h.shake = 0.6;
          }
          if (e.time > 6.6) end(ctx, true);
        }
        if (e.host.state === "perform") e.host.timer = Math.max(e.host.timer, 1); // (stays put while this goes on)
      },
      pick(ray) {
        const e = ev;
        if (!e || e.phase !== "peek" || e.time < 0.6 || !e.g) return false;
        const g = e.g, s = g.sizeScale || 1.3;
        const p = g.inst.holder.position;
        const c = new THREE.Vector3(p.x, p.y + 1.3 * s, p.z);
        if (ray.distanceSqToPoint(c) > Math.pow(0.85 * s, 2)) return false;
        this.boo(e.ctx);
        return true;
      },
      boo(ctx) { // (also used for testing)
        const e = ev;
        if (!e || e.phase !== "peek") return;
        const h = ctx.host();
        if (!h) return;
        e.phase = "boo"; e.time = 0; e.duck = 0;
        e.g.rareLift = outY; e.g.x = WX; e.g.targetYaw = 0;
        e.g.arms = "up"; e.g.liftVel = 3.5;
        shout(e.g, "BOO!", 1.4);
        ctx.perform(h, "startled", true);
        h.timer = 30;
        e.scared = true;
      },
      stop(ctx) { end(ctx, false); },
      force(ctx) { // (also used for testing)
        if (ev || !ctx.host()) return false;
        const id = ctx.visitor();
        const g = id && ctx.guest(id);
        if (!g) return false;
        g.x = WX; g.z = WZ; g.yaw = g.targetYaw = 0;
        g.rareLift = outY - 1.3;
        ev = { g, who: g, host: ctx.host(), phase: "peek", time: 0, duck: 0, ctx };
        return true;
      },
      _state: () => ev, // (for testing)
    };
    return rare;
  }

  function buildHome(opts) {
    FINE = true; // (the finer touches: only in a home, see FINE)
    try { return buildHomeRoom(opts); } finally { FINE = false; }
  }
  function buildHomeRoom(opts) {
    const record = (opts && opts.record) || { name: "Mii", home: root.MiiHomes ? root.MiiHomes.starterHome() : { items: {} } };
    const items = resolveItems(record);
    const ctx = { anim: [], record, portrait: portraitSource(opts, record) };
    const anim = ctx.anim;
    const rootG = new THREE.Group();
    addLights(rootG, { sky: 0xfff6e8, ground: 0xd9c7a8, hemi: 0.5, sun: 0.62, ambient: 0.26, fill: 0.32 });
    skyDome(rootG, 0x4fb0f2, 0xd6f0ff, 0x9fd47f);
    const RX = ROOM.x, RZ = ROOM.z, RH = ROOM.h;

    // ---------- outside ----------
    // This room is one of the flats in the apartment building (opts.floor = which
    // floor, 0 = the ground floor), so out of the window you see the courtyard,
    // the street and the houses across the road, from up on that floor. The
    // window is in the back wall, so the outside is turned round to face it.
    const floorNo = Number.isFinite(+(opts && opts.floor)) && opts.floor !== null ? Math.max(0, Math.min(MAX_FLOORS - 1, Math.round(+opts.floor))) : 1;
    const drop = floorNo * APT.floorH + 0.3; // how far below the room's floor the ground is
    const FACE = -RZ - 0.3;                  // the outside of the back wall = the front of the building
    const view = group(rootG, WINDOW.x, -drop, FACE + APT.front, PI); // (turned round: the building front ends up along the back wall)
    courtyardView(view, anim);
    // the building under the room (it carries on a little to each side)
    const BW = RX + 1.5;
    bx(rootG, 0xffe6c7, 0, (-drop - 0.02) / 2, (FACE + RZ + 0.6) / 2, BW * 2, drop - 0.02, RZ + 0.6 - FACE);
    bx(rootG, 0xff8a7a, 0, -0.12, FACE - 0.03, BW * 2, 0.2, 0.08);
    // who's home in the flats below (their curtains are shut while they're out)
    const homes = opts && Array.isArray(opts.homes) && opts.homes.length === floorNo ? opts.homes : null;
    if (floorNo > 0) {
      const fac = facadeTexture(floorNo, false, homes);
      fac.repeat.x = (BW * 2) / (APT.unitW * 2);
      // (the flat right below this one sits under its window)
      fac.offset.x = 170 / 512 - ((BW - WINDOW.x) / (BW * 2)) * fac.repeat.x;
      const fy = -drop + (floorNo * APT.floorH) / 2, fh = floorNo * APT.floorH;
      plane(rootG, BW * 2, fh, toon(0xffffff, { map: fac }), { y: fy, z: FACE - 0.01, ry: PI });
      // the back and the sides of the building, with their windows
      const backTex = facadeTexture(floorNo, true, homes);
      backTex.repeat.x = (BW * 2) / 9;
      plane(rootG, BW * 2, fh, toon(0xffffff, { map: backTex }), { y: fy, z: RZ + 0.61 });
      const sideTex = facadeTexture(floorNo, true, homes);
      sideTex.repeat.x = (RZ + 0.6 - FACE) / 9;
      for (const sx of [-1, 1]) plane(rootG, RZ + 0.6 - FACE, fh, toon(0xffffff, { map: sideTex }), { x: sx * (BW + 0.01), y: fy, z: (FACE + RZ + 0.6) / 2, ry: sx * PI / 2 });
      // the walkway balconies (the top one runs right past the window), held up by pillars
      for (let k = 1; k <= floorNo; k++) {
        const y = (k - floorNo) * APT.floorH;
        bx(rootG, 0xfdf8f0, 0, y - 0.11, FACE - 0.76, BW * 2 + 0.1, 0.22, 1.52);
        bx(rootG, 0xff8a7a, 0, y - 0.12, FACE - 1.53, BW * 2 + 0.2, 0.3, 0.1);
        bx(rootG, 0x6fcfbf, 0, y + 0.95, FACE - 1.45, BW * 2 + 0.1, 0.1, 0.12);
        bx(rootG, 0x6fcfbf, 0, y + 0.18, FACE - 1.45, BW * 2 + 0.1, 0.07, 0.08);
        for (let x = -BW + 0.2; x <= BW - 0.1; x += 0.32) put(rootG, G.cyl(6), toon(0x6fcfbf), { x, y: y + 0.56, z: FACE - 1.45, sx: 0.035, sy: 0.78, sz: 0.035 });
      }
      for (let x = -APT.unitW * 2; x <= APT.unitW * 2 + 0.1; x += APT.unitW) cylinder(rootG, 0xfdf8f0, x + WINDOW.x, -drop / 2 - 0.15, FACE - 1.3, 0.15, drop - 0.3);
    }
    // (the scenery is only a backdrop: no shadows, so it's quick to draw)
    view.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // ---------- the room: floor, walls, window, door ----------
    const wallIt = items.wallpaper || {}, floorIt = items.floor || {};
    const wallTex = patternTexture(wallIt, false, 512);
    const floorTex = patternTexture(floorIt, true, 512);
    // (vertex colors: the walls and floor get a little darker into the corners, see shadedPatch)
    const wallMat = toon(0xffffff, { map: wallTex, vertexColors: true });
    const floorMat = toon(0xffffff, { map: floorTex, vertexColors: true });
    const nearEdge = (d, k, s) => 1 - k * Math.exp(-Math.max(0, d) / s);
    put(rootG, shadedPatch(RX * 2, RZ * 2, 0, 0, (x, y) => nearEdge(Math.min(x, RX * 2 - x), 0.2, 0.45) * nearEdge(Math.min(y, RZ * 2 - y), 0.2, 0.45), [0.25, 0.6, 1.1, 1.8]), floorMat, { y: 0.005, rx: -PI / 2, shadow: false });
    const dark = wallIt.id === "wall-dark" || wallIt.id === "wall-stars", fancy = wallIt.id === "wall-gold";
    const trimC = dark ? 0x4a4570 : fancy ? 0xd9a441 : 0xffffff;
    const shellC = 0xf6efe4;

    // Builds one wall in its own group. The group is turned so its local +z points
    // into the room and local x runs along the wall. hole = { u0, u1, v0, v1 }.
    // (The outer group stays at the origin: merging bakes in each shape's final
    // position, so the group the merged shape goes into must not move it again.)
    function wall(px, pz, ry, len, hole) {
      const outer = group(rootG);
      const g = group(outer, px, 0, pz, ry);
      g.userData.outer = outer;
      const T = 0.3;
      const pieces = [];
      if (!hole) pieces.push([-len / 2, len / 2, 0, RH]);
      else {
        pieces.push([-len / 2, hole.u0, 0, RH], [hole.u1, len / 2, 0, RH]);
        if (hole.v0 > 0) pieces.push([hole.u0, hole.u1, 0, hole.v0]);
        pieces.push([hole.u0, hole.u1, hole.v1, RH]);
      }
      for (const [u0, u1, v0, v1] of pieces) {
        const w = u1 - u0, h = v1 - v0;
        // a little darker down by the floor, into the corners and up under the ceiling line
        const shade = (x, y) => {
          const u = u0 + x, v = v0 + y;
          return nearEdge(v - 0.3, 0.2, 0.5) * nearEdge(len / 2 - Math.abs(u), 0.17, 0.45) * nearEdge(RH - 0.36 - v, 0.08, 0.35);
        };
        put(g, shadedPatch(w, h, u0 + len / 2, v0, shade, [0.3, 0.55, 0.9, 1.5]), wallMat, { x: (u0 + u1) / 2, y: (v0 + v1) / 2, z: 0.005, shadow: false });
        // the outside of the wall, a little wider so the corners close up
        const ext = (u0 <= -len / 2 + 0.01 ? T : 0) + (u1 >= len / 2 - 0.01 ? T : 0);
        const shift = (u0 <= -len / 2 + 0.01 ? -T / 2 : 0) + (u1 >= len / 2 - 0.01 ? T / 2 : 0);
        put(g, G.box(), toon(shellC), { x: (u0 + u1) / 2 + shift, y: (v0 + v1) / 2, z: -T / 2 - 0.002, sx: w + ext, sy: h, sz: T, shadow: false });
      }
      // skirting board along the bottom and a trim along the top
      const skirts = hole && hole.v0 === 0 ? [[-len / 2, hole.u0], [hole.u1, len / 2]] : [[-len / 2, len / 2]];
      for (const [a, b] of skirts) {
        block(g, trimC, (a + b) / 2, 0.14, 0.04, b - a, 0.28, 0.08, 0.02, { shadow: false });
        bx(g, trimC, (a + b) / 2, 0.3, 0.05, b - a, 0.05, 0.1, { shadow: false }); // its rounded top lip
      }
      block(g, trimC, 0, RH + 0.06, -T / 2, len + 2 * T + 0.02, 0.12, T + 0.14, 0.03, { shadow: false });
      block(g, trimC, 0, RH - 0.1, 0.03, len, 0.14, 0.06, 0.02, { shadow: false });
      // crown molding: a rounded cove under the top trim, and a thin step below it
      put(g, G.cyl(12), toon(trimC), { x: 0, y: RH - 0.22, z: 0, sx: 0.11, sy: len, sz: 0.11, rz: PI / 2, shadow: false });
      bx(g, trimC, 0, RH - 0.35, 0.025, len, 0.04, 0.05, { shadow: false });
      return g;
    }
    const winHole = { u0: WINDOW.x - WINDOW.w / 2, u1: WINDOW.x + WINDOW.w / 2, v0: WINDOW.y0, v1: WINDOW.y1 };
    const backWall = wall(0, -RZ, 0, RX * 2, winHole);
    const frontWall = wall(0, RZ, PI, RX * 2, null);
    const leftWall = wall(-RX, 0, PI / 2, RZ * 2, null);
    const rightWall = wall(RX, 0, -PI / 2, RZ * 2, { u0: DOOR.z - DOOR.w / 2, u1: DOOR.z + DOOR.w / 2, v0: 0, v1: DOOR.h });

    // the window: real glass you can see through (the courtyard is out there), frame, sill and curtains
    {
      const wx = WINDOW.x, wy = (WINDOW.y0 + WINDOW.y1) / 2, ww = WINDOW.w, wh = WINDOW.y1 - WINDOW.y0;
      plane(backWall, ww, wh, glassMaterial(), { x: wx, y: wy, z: -0.16 });
      // the sides of the hole
      block(backWall, trimC, wx, WINDOW.y0 - 0.04, -0.1, ww + 0.3, 0.12, 0.3, 0.02, { shadow: false });
      block(backWall, trimC, wx, WINDOW.y1 + 0.04, -0.1, ww + 0.3, 0.12, 0.3, 0.02, { shadow: false });
      for (const s of [-1, 1]) block(backWall, trimC, wx + s * (ww / 2 + 0.04), wy, -0.1, 0.12, wh + 0.2, 0.3, 0.02, { shadow: false });
      block(backWall, trimC, wx, wy, -0.12, 0.08, wh, 0.06, 0.02, { shadow: false });
      block(backWall, trimC, wx, wy, -0.12, ww, 0.08, 0.06, 0.02, { shadow: false });
      block(backWall, trimC, wx, WINDOW.y0 - 0.06, 0.15, ww + 0.5, 0.1, 0.35, 0.03); // sill
      // under the sill: an apron board and two little brackets; a latch on the frame
      bx(backWall, trimC, wx, WINDOW.y0 - 0.2, 0.04, ww + 0.2, 0.16, 0.07, { shadow: false });
      for (const s of [-1, 1]) bx(backWall, trimC, wx + s * (ww / 2 - 0.05), WINDOW.y0 - 0.2, 0.15, 0.08, 0.2, 0.18, { shadow: false });
      bx(backWall, 0xd9a441, wx, wy + 0.12, -0.08, 0.05, 0.16, 0.04, { shadow: false });
      cylinder(backWall, 0xe0784a, wx + 0.8, WINDOW.y0 + 0.1, 0.15, 0.12, 0.2);
      ball(backWall, 0xff6fa5, wx + 0.8, WINDOW.y0 + 0.3, 0.15, 0.13);
      bits(backWall, (p) => {
        // the pot gets a rim and some leaves; a tiny cactus keeps it company
        cylinder(p, 0xd06a3e, wx + 0.8, WINDOW.y0 + 0.2, 0.15, 0.135, 0.04);
        for (const s of [-1, 1]) bead(p, 0x5cb840, wx + 0.8 + s * 0.12, WINDOW.y0 + 0.25, 0.17, 0.07, { sx: 1.4, sy: 0.5, rz: s * 0.4 });
        cylinder(p, 0x8fd3ff, wx - 0.85, WINDOW.y0 + 0.06, 0.15, 0.07, 0.12);
        put(p, G.capsule(), toon(0x4fae5a), { x: wx - 0.85, y: WINDOW.y0 + 0.2, z: 0.15, sx: 0.09, sy: 0.14, sz: 0.09 });
        bead(p, 0xffe25a, wx - 0.85, WINDOW.y0 + 0.31, 0.15, 0.03);
      });
      cylinder(backWall, 0xb98a5e, wx, WINDOW.y1 + 0.25, 0.15, 0.03, ww + 1.2, { rz: PI / 2 });
      for (const s of [-1, 1]) {
        bead(backWall, 0xd9a441, wx + s * (ww / 2 + 0.66), WINDOW.y1 + 0.25, 0.15, 0.06, { shadow: false }); // rod ends
        bx(backWall, 0xb98a5e, wx + s * (ww / 2 + 0.5), WINDOW.y1 + 0.25, 0.06, 0.05, 0.08, 0.16, { shadow: false }); // its brackets
      }
      const curtainC = dark ? 0x7a5aff : fancy ? 0xd9a441 : 0xff9ec7;
      if (opts && opts.empty) closedCurtains(backWall, wx, wy, ww, wh, curtainC); // (nobody's home)
      else for (const s of [-1, 1]) {
        put(backWall, G.capsule(), fine("pleat", curtainC), { x: wx + s * (ww / 2 + 0.25), y: wy - 0.05, z: 0.15, sx: 0.4, sy: (wh + 0.3) / 2, sz: 0.14 });
        put(backWall, G.torus(0.12, 0.025), toon(trimC), { x: wx + s * (ww / 2 + 0.25), y: wy - 0.3, z: 0.15 });
        // a ring at the top where it hangs from the rod
        for (let k = 0; k < 3; k++) put(backWall, lowTorus(0.05, 0.012), toon(0xd9a441), { x: wx + s * (ww / 2 + 0.12 + k * 0.13), y: WINDOW.y1 + 0.2, z: 0.15, shadow: false });
      }
      // daylight from the window: a soft bright patch on the floor in front of it
      lightRect(rootG, ww + 0.3, 1.7, { x: wx, y: 0.02, z: -RZ + 1.15 }, 0.13, [1, 0.96, 0.82], 0.55);
    }
    // the front door (on the right wall, near the front)
    {
      const g = rightWall;
      block(g, 0x9a6a3c, DOOR.z, DOOR.h / 2, -0.12, DOOR.w - 0.05, DOOR.h - 0.02, 0.1, 0.04);
      block(g, 0xb57d4a, DOOR.z, DOOR.h * 0.72, -0.06, DOOR.w - 0.35, DOOR.h * 0.32, 0.03, 0.03);
      block(g, 0xb57d4a, DOOR.z, DOOR.h * 0.28, -0.06, DOOR.w - 0.35, DOOR.h * 0.36, 0.03, 0.03);
      ball(g, 0xffcf5a, DOOR.z - DOOR.w / 2 + 0.2, DOOR.h * 0.48, -0.02, 0.07);
      block(g, trimC, DOOR.z, DOOR.h + 0.06, 0.02, DOOR.w + 0.3, 0.12, 0.1, 0.02, { shadow: false });
      for (const s of [-1, 1]) block(g, trimC, DOOR.z + s * (DOOR.w / 2 + 0.06), DOOR.h / 2, 0.02, 0.12, DOOR.h, 0.1, 0.02, { shadow: false });
      block(g, 0x4a90e2, DOOR.z, 0.015, 0.7, 1.2, 0.03, 0.8, 0.02, { shadow: false }); // doormat
      // coat hooks with a scarf and a hat
      block(g, 0x9a6a3c, DOOR.z - 1.35, 2.0, 0.04, 0.8, 0.12, 0.06, 0.03);
      put(g, G.capsule(), toon(0xff5a64), { x: DOOR.z - 1.5, y: 1.6, z: 0.1, sx: 0.12, sy: 0.6, sz: 0.06 });
      ball(g, 0x4a90e2, DOOR.z - 1.15, 1.85, 0.14, 0.18, { sy: 0.6 });
    }
    // a clock on the left wall, above the sofa
    {
      const clock = group(leftWall, -1.6, 3.6, 0.06);
      cylinder(clock, 0xffffff, 0, 0, 0, 0.42, 0.08, { rx: PI / 2 });
      put(clock, G.torus(0.42, 0.05), toon(dark ? 0xff4fd8 : 0xff8a7a), {});
      const hh = dynamic(group(clock, 0, 0, 0.05)), mh = dynamic(group(clock, 0, 0, 0.06));
      block(hh, 0x333333, 0, 0.11, 0, 0.05, 0.24, 0.02, 0.02);
      block(mh, 0x333333, 0, 0.16, 0, 0.035, 0.34, 0.02, 0.015);
      anim.push(() => {
        const now = new Date();
        hh.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU;
        mh.rotation.z = -(now.getMinutes() + now.getSeconds() / 60) / 60 * TAU;
      });
    }
    // a bedside table (always there, the lava lamp sits on it)
    {
      const p = SLOT_PLACES.lamp;
      const ns = group(rootG, p.x, 0, p.z);
      block(ns, woody(0xc98b4a), 0, 0.36, 0, 0.75, 0.72, 0.65, 0.06);
      block(ns, woody(0xe0a868), 0, 0.42, 0.33, 0.6, 0.25, 0.02, 0.03);
      ball(ns, 0xffcf5a, 0, 0.42, 0.36, 0.04);
      bits(ns, (p) => {
        slab(p, 0xe0a868, 0, 0.15, 0.33, 0.6, 0.12, 0.02, 0.02); // a lower drawer
        bead(p, 0xffcf5a, 0, 0.15, 0.35, 0.03);
        for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) cylinder(p, 0x9a6a3c, x, 0.01, z, 0.05, 0.02);
      });
      if (!NIGHTSTAND_LAMPS.includes(items.lamp.id)) {
        block(ns, 0xff8a7a, -0.12, 0.85, 0.05, 0.3, 0.26, 0.15, 0.06); // alarm clock
        disc(ns, toon(0xffffff), -0.12, 0.85, 0.13, 0.09, { rx: 0 });
        block(ns, 0x4a90e2, 0.2, 0.76, -0.05, 0.25, 0.06, 0.32, 0.02); // a book
        bits(ns, (p) => {
          // the clock's bells, feet and hands; the book's pages and a bookmark
          for (const s of [-1, 1]) { bead(p, 0xffcf5a, -0.12 + s * 0.1, 1.0, 0.05, 0.05); slab(p, 0x9a6a3c, -0.12 + s * 0.1, 0.72, 0.05, 0.04, 0.03, 0.06, 0.01); }
          slab(p, 0x333333, -0.12, 0.87, 0.14, 0.012, 0.06, 0.005, 0.002);
          slab(p, 0x333333, -0.1, 0.85, 0.14, 0.05, 0.012, 0.005, 0.002);
          slab(p, 0xfff8ea, 0.21, 0.76, -0.05, 0.25, 0.04, 0.33, 0.01);
          slab(p, 0xe8424f, 0.25, 0.74, 0.12, 0.03, 0.08, 0.005, 0.002);
        });
      }
    }

    // ---------- furniture ----------
    const obstacles = [
      { x: 0, z: -RZ - 0.25, w: RX * 2 + 1, d: 0.5 }, { x: 0, z: RZ + 0.25, w: RX * 2 + 1, d: 0.5 },
      { x: -RX - 0.25, z: 0, w: 0.5, d: RZ * 2 + 1 }, { x: RX + 0.25, z: 0, w: 0.5, d: RZ * 2 + 1 },
      { x: SLOT_PLACES.lamp.x, z: SLOT_PLACES.lamp.z, w: 0.8, d: 0.75 }, // bedside table
    ];
    const spots = [];
    const order = ["rug", "bed", "sofa", "table", "tv", "lamp", "plant", "art", "special"];
    for (const slot of order) {
      const it = items[slot];
      if (!it) continue;
      const def = FURNITURE[it.id];
      if (!def) continue;
      const base = SLOT_PLACES[slot];
      const place = def.at ? { x: def.at.x, z: def.at.z, ry: def.at.ry || 0 } : base;
      const g = group(rootG, place.x, slot === "art" ? 3.0 : 0, place.z + (slot === "art" ? 0.06 : 0), place.ry);
      def.build(g, ctx);
      for (const o of def.obs || []) {
        const p = toWorld(place, o.cx, o.cz);
        obstacles.push(o.r !== undefined ? { x: p.x, z: p.z, r: o.r } : { x: p.x, z: p.z, w: o.w, d: o.d, rot: -place.ry, item: it.id });
      }
      if (!it.use || !def.spot) continue;
      const u = it.use;
      const sp = def.spot;
      const at = sp.wx !== undefined ? { x: sp.wx, z: sp.wz } : toWorld(place, sp.lx, sp.lz);
      let yaw;
      if (sp.toward) {
        const tgt = sp.toward === true ? { x: place.x, z: place.z } : toWorld(place, sp.toward.lx, sp.toward.lz);
        yaw = Math.atan2(tgt.x - at.x, tgt.z - at.z);
      } else yaw = (sp.wx !== undefined ? 0 : place.ry) + sp.yaw;
      const spot = {
        x: at.x, z: at.z, yaw, emoji: u.emoji, activity: u.activity, lines: u.lines.slice(),
        itemId: it.id, slot,
      };
      if (u.arms) spot.arms = u.arms;
      if (u.lookUp) spot.lookUp = u.lookUp;
      if (u.sit && def.seat) {
        const s = toWorld(place, def.seat.lx, def.seat.lz);
        // deep seats (sofas, bean bags): short Mii legs stick out over the cushion
        spot.seat = { x: s.x, z: s.z, y: def.seat.h - 0.56, legs: def.seat.legs };
        spot.yaw = place.ry; // sit facing the way the seat faces
      }
      if (u.lie && def.lie) {
        const s = toWorld(place, def.lie.lx, def.lie.lz);
        spot.lie = { x: s.x, z: s.z, y: def.lie.h, yaw: place.ry + def.lie.yaw };
      }
      if (u.run && def.stand) {
        const s = toWorld(place, def.stand.lx, def.stand.lz);
        spot.stand = { x: s.x, z: s.z, y: def.stand.h };
        spot.run = true;
      }
      spots.push(spot);
    }
    spots.push({
      x: WINDOW.x, z: -RZ + 1.25, yaw: PI, emoji: "🪟", activity: "gazing out of the window", slot: "window", lookUp: 0.1,
      lines: ["What a nice view!", "I can see the park from here.", "Is it going to rain?", "*sigh* So peaceful."],
    });

    // things other files add to the room (the wardrobe: see rooms3d.js)
    if (root.MiiRooms3D && root.MiiRooms3D.decorateMain) root.MiiRooms3D.decorateMain({ group: rootG, record, obstacles, spots, items, ctx });

    // soft shadows on the floor under everything that stands there (the first four
    // obstacles are the walls), a touch bigger than the piece and fading out
    for (const o of obstacles.slice(4)) {
      if (o.r !== undefined) shadeDisc(rootG, o.r + 0.35, { x: o.x, y: 0.02, z: o.z }, 0.42);
      else shadeRect(rootG, o.w + 0.05, o.d + 0.05, { x: o.x, y: 0.02, z: o.z, ry: -(o.rot || 0) }, 0.42, 0.4);
    }
    // warm pools of light round the lamps (on the floor, and up the wall behind)
    {
      const id = items.lamp && items.lamp.id, def = FURNITURE[id] || {};
      const at = def.at || SLOT_PLACES.lamp;
      if (id === "lamp-basic") {
        lightPool(rootG, 1.5, { x: at.x + 0.2, y: 0.025, z: at.z }, 0.2);
        lightPool(leftWall, 1.1, { x: -at.z, y: 2.4, z: 0.03, rx: PI / 2 }, 0.22);
      } else if (id === "lamp-lava" || id === "lamp-moon") {
        const rgb = id === "lamp-lava" ? [1, 0.55, 0.85] : [1, 0.9, 0.6];
        lightPool(rootG, 1.1, { x: at.x, y: 0.025, z: at.z + 0.4 }, 0.16, rgb);
        lightPool(backWall, 0.9, { x: at.x, y: 1.2, z: 0.03, rx: PI / 2 }, 0.2, rgb);
      } else if (id === "lamp-chandelier") {
        lightPool(rootG, 2.6, { x: at.x, y: 0.025, z: at.z }, 0.18);
      } else if (id === "lamp-disco") {
        lightPool(rootG, 2.2, { x: at.x, y: 0.025, z: at.z }, 0.1, [0.9, 0.6, 1]);
      }
    }

    // hide any wall that's between the camera and the room (like a dollhouse)
    const walls = [
      { group: backWall.userData.outer, axis: "z", at: -RZ, outside: -1 },
      { group: frontWall.userData.outer, axis: "z", at: RZ, outside: 1 },
      { group: leftWall.userData.outer, axis: "x", at: -RX, outside: -1 },
      { group: rightWall.userData.outer, axis: "x", at: RX, outside: 1 },
    ];
    for (const w of walls) { paintRoom(w.group); mergeStatic(w.group); }
    // things that move (swaying leaves, a waving robot...) can't join the rest, but
    // the plain-colored parts of each one are joined into one shape (see bakeFlat)
    paintMovers(rootG);
    for (const w of walls) dynamic(w.group);
    paintRoom(rootG);
    mergeStatic(rootG);

    const name = record.name || "I";
    return {
      group: rootG,
      background: 0xd6f0ff,
      fog: [0xd8f0ff, 45, 160],
      cameraTilt: 0.85,
      cameraTargetY: 1.9,
      isHome: true,
      rare: opts && opts.empty ? null : windowPrank(floorNo > 0 ? 0 : -drop), // someone at the window...
      bounds: { minX: -RX, maxX: RX, minZ: -RZ, maxZ: RZ },
      water: [],
      obstacles,
      spots,
      playerSpot: { x: 0, z: 3.1 },
      lines: [
        "Home sweet home!", "I love my room!", "Make yourself at home!", "Want some tea?",
        "I should tidy up a bit...", "It's so cozy in here.", "Welcome to " + (name === "I" ? "my" : name + "'s") + " place!",
        "La la la~", "What should I do today?", "Shoes off, please!",
      ],
      update(t, camera) {
        anim.forEach((a) => a(t));
        if (camera) {
          for (const w of walls) {
            const c = w.axis === "z" ? camera.position.z : camera.position.x;
            w.group.visible = (c - w.at) * w.outside < 0;
          }
        }
      },
    };
  }

  root.World3D.addPlace({ id: "apartments", name: "Courtyard", icon: "🏘️" }, buildApartments);
  root.World3D.addPlace({ id: "home", name: "Home", icon: "🏠" }, buildHome, true);
  // for tests and other files
  // portraitFor(record) -> picture URL: set by the app, used by the self-portrait painting
  root.MiiHomes3D = { FURNITURE, SLOT_PLACES, unitInfo, APT, floorsFor, MAX_FLOORS, portraitFor: null, patternTexture,
    // the finer touches, for the extra rooms (rooms3d.js): build(fn) runs fn with them on
    detail: {
      build(fn) { const was = FINE; FINE = true; try { return fn(); } finally { FINE = was; } },
      fine, bits, bead, slab, paintRoom, paintMovers, shadeRect, shadeDisc, lightPool, lightRect,
    },
  };
})(typeof self !== "undefined" ? self : this);
