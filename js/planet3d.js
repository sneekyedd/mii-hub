/*
 * planet3d.js
 * The little round world all the places sit on (like a tiny Animal Crossing
 * planet), and the Moon the moon base is on. hub3d.js keeps every place it has
 * built on here, each on its own flat patch of ground, and flies the camera over
 * the curve from one place to the next (or off into space to the Moon).
 *
 * This file has:
 *   - where every place is (spots, frames: each place's own little x/y/z)
 *   - the planet you see while flying (globe, sea, trees, clouds, the Moon, stars)
 *     and the one sun that lights it
 *   - the camera's flight path between two places (flightPath / samplePath)
 *   - the cars, boats, planes and rockets Miis ride in between places (createTraffic)
 *
 * A place's frame: x = east, y = up (away from the planet), z = south. So the
 * camera, which starts on a place's +z side, looks north (unless the place is turned).
 */
(function (root) {
  "use strict";

  const THREE = root.THREE;
  const V3 = THREE.Vector3;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (k) => k * k * (3 - 2 * k);

  // ------------------------------------------------------------------
  // The planet, the Moon and where everything is
  // ------------------------------------------------------------------
  const EARTH_R = 130;
  const MOON_R = 72;
  const EARTH = new V3(0, 0, 0);

  function dirOf(lat, lon) {
    const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
    return new V3(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b));
  }
  // the Moon hangs in the sky above the town, a good way off
  const MOON = dirOf(34, 6).multiplyScalar(660);

  // Where each place sits (latitude / longitude in degrees on the planet), which
  // way it's turned (yaw, degrees) and the color of the ground under it.
  // The town is on one big island; the beach and the park have islands of their own.
  const SPOTS = {
    apartments: { lat: 10, lon: 0, ground: 0x9ad27a },
    cafe: { lat: 13, lon: 34, ground: 0xd9cfc0 },
    stage: { lat: 13, lon: -34, ground: 0x8fcf6a },
    office: { lat: 44, lon: 24, ground: 0x9ad27a },
    school: { lat: 44, lon: -24, ground: 0xa9d98a },
    beach: { lat: -30, lon: 16, yaw: 180, ground: 0xf5dfa4 }, // (its sea faces the open ocean)
    park: { lat: -30, lon: -34, ground: 0x8fd16f },
    space: { moon: true, ground: 0xbcaee2, side: 0x9d8fc6 },
  };
  // Places added later that aren't in the list get a spot round the back.
  const SPARE = [[-6, 150], [22, -150], [-40, 110], [40, 160], [-10, -110], [8, 100]];

  // Patches of land (lat, lon, size in degrees). Everything else is sea.
  const BLOBS = [
    [10, 0, 24], [13, 34, 22], [13, -34, 22], [44, 24, 22], [44, -24, 22], [30, 0, 26], [62, 0, 20], [28, 52, 12], [26, -54, 12],
    [-30, 16, 17], [-30, -34, 17], [-18, -46, 6],                     // the beach and park islands (and a little one)
    [-6, 150, 13], [22, -150, 11], [-40, 110, 10], [40, 160, 15], [-10, -110, 9], [-58, -160, 12], // round the back
  ].map(([lat, lon, r]) => ({ c: dirOf(lat, lon), r: (r * Math.PI) / 180 }));

  // > 0 = land, < 0 = sea (a direction from the middle of the planet)
  function land(d) {
    let v = -1;
    for (const b of BLOBS) {
      const ang = Math.acos(clamp(d.dot(b.c), -1, 1));
      v = Math.max(v, 1 - ang / b.r);
    }
    // wobbly coasts
    v += (Math.sin(d.x * 9.1 + d.y * 3.3) * 0.5 + Math.sin(d.y * 11.7 - d.z * 5.2) * 0.3 + Math.sin(d.z * 15.1 + d.x * 6.4) * 0.2) * 0.13;
    return v;
  }

  const frames = new Map(); // id -> frame
  // A place's frame: { id, body: "earth" | "moon", center (of its planet), radius,
  //   pos, up (= y), x, z, matrix (place -> planet), inverse }
  function frameFor(id) {
    if (frames.has(id)) return frames.get(id);
    let spot = SPOTS[id];
    if (!spot) {
      const k = frames.size % SPARE.length;
      spot = { lat: SPARE[k][0], lon: SPARE[k][1], ground: 0x9ad27a };
    }
    const f = { id, ground: spot.ground, side: spot.side };
    if (spot.moon) {
      // The moon base: turned so that the Earth painted in its sky (low, ahead and a
      // little to the right, see buildSpace) is where the real planet is.
      f.body = "moon"; f.center = MOON.clone(); f.radius = MOON_R;
      const toEarth = EARTH.clone().sub(MOON).normalize();
      const side = new V3(0, 1, 0).projectOnPlane(toEarth).normalize();
      const sky = new V3(42, 36, -185).normalize(); // (where the Earth is in the moon base's own sky)
      const elev = Math.asin(sky.y);
      const tilt = Math.PI / 2 - elev;
      f.up = toEarth.clone().multiplyScalar(Math.cos(tilt)).add(side.clone().multiplyScalar(Math.sin(tilt))).normalize();
      f.pos = f.center.clone().addScaledVector(f.up, f.radius);
      const earthDir = EARTH.clone().sub(f.pos).normalize();
      const flat = earthDir.clone().projectOnPlane(f.up).normalize(); // the Earth, along the ground
      const want = new V3(sky.x, 0, sky.z).normalize();                 // ...and where it should be in the place
      // pick the turn that puts "want" onto "flat"
      let best = null;
      for (let i = 0; i < 72; i++) {
        const z = flat.clone().negate().applyAxisAngle(f.up, (i / 72) * TAU);
        const x = new V3().crossVectors(f.up, z);
        const got = x.clone().multiplyScalar(want.x).addScaledVector(z, want.z);
        const score = got.dot(flat);
        if (!best || score > best.score) best = { score, x, z };
      }
      f.x = best.x; f.z = best.z;
    } else {
      f.body = "earth"; f.center = EARTH.clone(); f.radius = EARTH_R;
      f.up = dirOf(spot.lat, spot.lon);
      f.pos = f.up.clone().multiplyScalar(EARTH_R);
      const east = new V3(0, 1, 0).cross(f.up);
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
      east.normalize();
      const yaw = ((spot.yaw || 0) * Math.PI) / 180;
      f.x = east.applyAxisAngle(f.up, yaw);
      f.z = new V3().crossVectors(f.x, f.up);
    }
    f.matrix = new THREE.Matrix4().makeBasis(f.x, f.up, f.z).setPosition(f.pos);
    f.inverse = f.matrix.clone().invert();
    frames.set(id, f);
    return f;
  }

  // How high the ground is in direction d (from the middle of the planet): the
  // planet itself, or the flat top of a place's patch of ground (with a slope round it).
  function groundRadius(d, pads) {
    let r = EARTH_R;
    for (const p of pads.values()) {
      if (p.frame.body !== "earth") continue;
      const c = d.dot(p.frame.up);
      if (c <= 0.5) continue;
      const ang = Math.acos(clamp(c, -1, 1));
      const edge = p.radius / EARTH_R, slope = (p.radius + 8) / EARTH_R;
      if (ang > slope) continue;
      const top = (EARTH_R - 0.05) / c; // (the flat top: the place's own ground)
      r = Math.max(r, ang <= edge ? top : top + (EARTH_R - top) * smooth((ang - edge) / (slope - edge)));
    }
    return r;
  }

  // ------------------------------------------------------------------
  // The planet you see while flying
  // ------------------------------------------------------------------
  function colorOf(d, out) {
    const v = land(d);
    // deep sea, shallow sea, a sandy beach, then grass (blended, so the coasts look soft)
    if (v < 0) out.setHex(0x2f8ae0).lerp(SHALLOW, smooth(clamp((v + 0.3) / 0.3, 0, 1)));
    else if (v < 0.1) out.copy(SAND).lerp(GRASS, smooth(clamp((v - 0.04) / 0.06, 0, 1)));
    else out.copy(GRASS).lerp(GRASS2, clamp(Math.sin(d.x * 21 + d.z * 17) * 0.5 + 0.5, 0, 1) * 0.5);
    // ...and snow at the poles
    return out.lerp(SNOW, smooth(clamp((Math.abs(d.y) - 0.91 - Math.sin(d.x * 13) * 0.015) / 0.04, 0, 1)));
  }

  const SHALLOW = new THREE.Color(0x6cc6f2), SAND = new THREE.Color(0xf2dca0), GRASS = new THREE.Color(0x6cc85a), GRASS2 = new THREE.Color(0x58b04c), SNOW = new THREE.Color(0xf4f8ff);

  // A sphere whose corners are colored by fn(direction, color).
  function paintedSphere(r, wSeg, hSeg, fn) {
    const geo = new THREE.SphereGeometry(r, wSeg, hSeg);
    const pos = geo.attributes.position, n = pos.count;
    const colors = new Float32Array(n * 3), d = new V3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      fn(d, c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }

  /*
   * Planet.create() -> {
   *   group      everything for flying (planet, Moon, patches under the places, sun...)
   *   setPad(id, radius)   the patch of ground under a place (once we know its size)
   *   pads       id -> { frame, radius }
   *   rig        the sun and sky light used while flying (see setRig)
   *   setRig(a, b, k, at, basis)  mixes the lights of two places (lightState), around point at
   *   lightState(world)  how a place is lit right now (null: the flying lights)
   *   update(space)  the stars show up (space: 0 near the ground .. 1 out in space)
   * }
   */
  function create() {
    const K = root.World3D.kit;
    const group = new THREE.Group();
    group.name = "planet";
    group.visible = false;

    const paint = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: K.paintedMat.gradientMap, vertexColors: true });

    // the planet
    const globe = new THREE.Mesh(paintedSphere(EARTH_R, 200, 136, colorOf), paint);
    globe.receiveShadow = true;
    group.add(globe);
    // a soft blue glow round it
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.07, 64, 40), new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.22, side: THREE.BackSide, depthWrite: false, toneMapped: false }));
    group.add(atmo);

    // the Moon, covered in craters
    const craters = [];
    const cr = (() => { let s = 5; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 40; i++) craters.push({ c: new V3(cr() - 0.5, cr() - 0.5, cr() - 0.5).normalize(), r: 0.08 + cr() * 0.2 });
    const moon = new THREE.Mesh(paintedSphere(MOON_R, 128, 88, (d, out) => {
      out.setHex(0xb9a9dd);
      for (const k of craters) {
        const a = Math.acos(clamp(d.dot(k.c), -1, 1)) / k.r;
        if (a < 1) out.lerp(new THREE.Color(a > 0.8 ? 0xd6cbf2 : 0x9c8bc8), a > 0.8 ? 0.6 : 0.7);
      }
    }), paint);
    moon.position.copy(MOON);
    group.add(moon);

    // the patches of ground under the places (flat on top, sloping down into the planet)
    const pads = new Map();
    const padMeshes = new Map();
    function padGeo(radius, color, sideColor) {
      const g = new THREE.CylinderGeometry(radius, radius + 9, 10, 56, 1, false);
      g.translate(0, -5.06, 0);
      const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
      const colors = new Float32Array(n * 3), top = new THREE.Color(color), side = sideColor ? new THREE.Color(sideColor) : new THREE.Color(color).lerp(new THREE.Color(0xb58a5c), 0.55);
      for (let i = 0; i < n; i++) {
        const c = nor.getY(i) > 0.9 ? top : side;
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      return g;
    }
    function setPad(id, radius) {
      const frame = frameFor(id);
      radius = radius || 26;
      const old = padMeshes.get(id);
      if (old && pads.get(id).radius === radius) return;
      if (old) { group.remove(old); old.geometry.dispose(); }
      const m = new THREE.Mesh(padGeo(radius, frame.ground, frame.side), paint);
      m.matrixAutoUpdate = false;
      m.matrix.copy(frame.matrix);
      m.receiveShadow = true;
      group.add(m);
      padMeshes.set(id, m);
      pads.set(id, { frame, radius });
    }

    // trees all over the land (one shape, copied)
    const treeGeo = K.bakeGeo((g) => {
      K.put(g, K.G.cyl(8), K.toon(0x9a6a40), { y: 0.6, sx: 0.22, sy: 1.2, sz: 0.22 });
      K.put(g, K.G.lowSphere(), K.toon(0x5fc04f), { y: 1.7, s: 0.9 });
      K.put(g, K.G.lowSphere(), K.toon(0x72d060), { x: 0.3, y: 2.2, z: 0.15, s: 0.6 });
    });
    const treeSpots = [];
    const tr = (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const pd = new V3();
    for (let tries = 0; tries < 9000 && treeSpots.length < 340; tries++) {
      pd.set(tr() * 2 - 1, tr() * 2 - 1, tr() * 2 - 1);
      if (pd.lengthSq() > 1 || pd.lengthSq() < 0.01) continue;
      pd.normalize();
      if (land(pd) < 0.12 || Math.abs(pd.y) > 0.88) continue;
      // not on (or right by) a place
      if (Object.keys(SPOTS).some((id) => !SPOTS[id].moon && pd.dot(frameFor(id).up) > Math.cos(40 / EARTH_R))) continue;
      treeSpots.push(pd.clone());
    }
    const trees = new THREE.InstancedMesh(treeGeo, paint, treeSpots.length);
    const o = new THREE.Object3D();
    treeSpots.forEach((d, i) => {
      o.position.copy(d).multiplyScalar(EARTH_R - 0.2);
      o.quaternion.setFromUnitVectors(new V3(0, 1, 0), d);
      o.rotateY(tr() * TAU);
      o.scale.setScalar(2.2 + tr() * 1.6);
      o.updateMatrix();
      trees.setMatrixAt(i, o.matrix);
    });
    group.add(trees);

    // a few puffy clouds
    const cloudGeo = K.bakeGeo((g) => {
      const puff = (x, y, z, s) => K.put(g, K.G.lowSphere(), K.toon(0xffffff), { x, y, z, s });
      puff(0, 0, 0, 2.2); puff(2.2, -0.4, 0.3, 1.6); puff(-2.1, -0.5, 0, 1.5); puff(0.6, 1.1, 0, 1.4); puff(-0.9, 0.7, 0.6, 1.2);
    });
    const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: K.paintedMat.gradientMap, vertexColors: true, transparent: true, opacity: 0.92 });
    // (not over the places, where they'd get in the camera's way)
    const cloudSpots = [];
    for (let tries = 0; tries < 400 && cloudSpots.length < 16; tries++) {
      pd.set(tr() * 2 - 1, (tr() * 2 - 1) * 0.8, tr() * 2 - 1).normalize();
      if (!Object.keys(SPOTS).some((id) => !SPOTS[id].moon && pd.dot(frameFor(id).up) > Math.cos(48 / EARTH_R))) cloudSpots.push(pd.clone());
    }
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudSpots.length);
    for (let i = 0; i < cloudSpots.length; i++) {
      pd.copy(cloudSpots[i]);
      o.position.copy(pd).multiplyScalar(EARTH_R + 24 + tr() * 10);
      o.quaternion.setFromUnitVectors(new V3(0, 1, 0), pd);
      o.scale.set(2.2 + tr(), 1.4 + tr() * 0.6, 2 + tr());
      o.updateMatrix();
      clouds.setMatrixAt(i, o.matrix);
    }
    group.add(clouds);

    // stars (they show when you're high up, or on the way to the Moon)
    const sp = [];
    for (let i = 0; i < 1400; i++) {
      pd.set(tr() * 2 - 1, tr() * 2 - 1, tr() * 2 - 1);
      if (pd.lengthSq() < 0.01) continue;
      pd.normalize().multiplyScalar(1600);
      sp.push(pd.x, pd.y, pd.z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    stars.frustumCulled = false;
    group.add(stars);

    // the lights while flying: the same kinds as a place has (see World3D.kit.addLights),
    // so nothing needs redrawing when we switch between them
    const rig = {
      hemi: new THREE.HemisphereLight(0xd6f0ff, 0x8fd16f, 0.55),
      amb: new THREE.AmbientLight(0xffffff, 0.28),
      sun: new THREE.DirectionalLight(0xfff4e0, 0.95),
      fill: new THREE.DirectionalLight(0xffffff, 0.3),
    };
    rig.sun.castShadow = true;
    rig.sun.shadow.mapSize.set(1024, 1024);
    const sc = rig.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 70;
    rig.sun.shadow.bias = -0.0004;
    rig.sun.shadow.normalBias = 0.03;
    sc.layers.enable(root.World3D.SMALL_LAYER); // (little things cast shadows too, like at a place)
    group.add(rig.hemi, rig.amb, rig.sun, rig.sun.target, rig.fill, rig.fill.target);

    // the lights of a place: { hemi, amb, sun, fill } (found once)
    function lightsOf(world) {
      if (world._lights) return world._lights;
      const L = {};
      world.group.traverse((x) => {
        if (x.isHemisphereLight && !L.hemi) L.hemi = x;
        else if (x.isAmbientLight && !L.amb) L.amb = x;
        else if (x.isDirectionalLight) { if (x.castShadow && !L.sun) L.sun = x; else if (!x.castShadow && !L.fill) L.fill = x; }
      });
      return (world._lights = L);
    }
    // How a place is lit right now (weather included).
    function lightState(world) {
      const L = world ? lightsOf(world) : rig; // (no place: the flying lights as they are now)
      const s = {
        sky: new THREE.Color(0xd6f0ff), ground: new THREE.Color(0x8fd16f), hemi: 0.55, amb: new THREE.Color(0xffffff), ambI: 0.28,
        sun: new THREE.Color(0xfff4e0), sunI: 0.95, fill: new THREE.Color(0xffffff), fillI: 0.3,
      };
      if (L.hemi) { s.sky.copy(L.hemi.color); s.ground.copy(L.hemi.groundColor); s.hemi = L.hemi.intensity; }
      if (L.amb) { s.amb.copy(L.amb.color); s.ambI = L.amb.intensity; }
      if (L.sun) { s.sun.copy(L.sun.color); s.sunI = L.sun.intensity; }
      if (L.fill) { s.fill.copy(L.fill.color); s.fillI = L.fill.intensity; }
      return s;
    }
    const lerp = (a, b, k) => a + (b - a) * k;
    const tv = new V3();
    // a, b: light states; k: 0..1 between them; at: the point the camera looks at;
    // basis: { x, up, z } there (the sun shines from the same side as at a place)
    function setRig(a, b, k, at, basis) {
      rig.hemi.color.copy(a.sky).lerp(b.sky, k);
      rig.hemi.groundColor.copy(a.ground).lerp(b.ground, k);
      rig.hemi.intensity = lerp(a.hemi, b.hemi, k);
      rig.amb.color.copy(a.amb).lerp(b.amb, k);
      rig.amb.intensity = lerp(a.ambI, b.ambI, k);
      rig.sun.color.copy(a.sun).lerp(b.sun, k);
      rig.sun.intensity = lerp(a.sunI, b.sunI, k);
      rig.fill.color.copy(a.fill).lerp(b.fill, k);
      rig.fill.intensity = lerp(a.fillI, b.fillI, k);
      const local = (x, y, z) => tv.copy(at).addScaledVector(basis.x, x).addScaledVector(basis.up, y).addScaledVector(basis.z, z);
      rig.hemi.position.copy(basis.up);
      rig.sun.position.copy(local(10, 22, 14));
      rig.sun.target.position.copy(at);
      rig.fill.position.copy(local(0, 8, 20));
      rig.fill.target.position.copy(at);
    }

    function update(space) {
      stars.material.opacity = clamp(space, 0, 1) * 0.9;
      stars.visible = space > 0.02;
    }

    return { group, pads, setPad, rig, setRig, lightState, update, globe, moon };
  }

  // ------------------------------------------------------------------
  // The camera's flight
  // ------------------------------------------------------------------
  // A camera "state": { target (point looked at), up, z (the place's south, sideways
  // reference), d (distance), p (angle down from straight overhead), a (turned round) }
  // all in planet space.
  const onEarth = (p) => p.distanceTo(EARTH) < EARTH_R + 25;
  const angleDiff = (a, b) => ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;

  // Plans a flight between two camera states.
  function flightPath(from, to) {
    const f = { from, to, earth: onEarth(from.target) && onEarth(to.target) };
    const len = from.target.distanceTo(to.target);
    if (f.earth) {
      f.angle = from.target.angleTo(to.target);
      const arc = f.angle * EARTH_R;
      f.bump = clamp(30 + arc * 1.25, 50, 300);
      f.dur = clamp(1.7 + f.angle * 1.9, 1.8, 4.6);
    } else {
      // up off one planet and down onto the other
      const k = len * 0.38;
      f.c1 = from.target.clone().addScaledVector(from.up, k);
      f.c2 = to.target.clone().addScaledVector(to.up, k);
      f.bump = clamp(len * 0.3, 120, 260);
      f.len = len;
      f.dur = 5.2;
    }
    if (len < 0.5) f.dur = 0.8; // (already there)
    return f;
  }

  const bez = (p0, p1, p2, p3, s, out) => {
    const u = 1 - s;
    return out.set(0, 0, 0).addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * s).addScaledVector(p2, 3 * u * s * s).addScaledVector(p3, s * s * s);
  };
  const unitY = new V3(0, 1, 0);
  // Turns direction a towards direction b (both length 1) by k (0..1), along the shortest way round.
  const axisTmp = new V3();
  function slerpDir(a, b, k, out) {
    axisTmp.crossVectors(a, b);
    const len = axisTmp.length();
    if (len < 1e-6) return out.copy(a).lerp(b, k).normalize();
    const ang = Math.atan2(len, a.dot(b));
    return out.copy(a).applyAxisAngle(axisTmp.divideScalar(len), ang * k);
  }
  // Where the camera is at k (0..1) of the flight. out = { target, up, z, x, d, p, a, cam }
  function samplePath(f, k, out) {
    out = out || { target: new V3(), up: new V3(), z: new V3(), x: new V3(), cam: new V3(), look: new V3(), d: 0, p: 0, a: 0 };
    const A = f.from, B = f.to;
    const e = smooth(k);
    const hump = Math.sin(Math.PI * k);
    if (f.earth) {
      // over the curve of the planet
      const ra = A.target.length(), rb = B.target.length();
      slerpDir(tmpA.copy(A.target).normalize(), tmpB.copy(B.target).normalize(), e, out.target).multiplyScalar(ra + (rb - ra) * e);
    } else {
      bez(A.target, f.c1, f.c2, B.target, e, out.target);
    }
    // the way up (and the sideways reference) turn smoothly from one place's to the other's
    slerpDir(A.up, B.up, e, out.up);
    out.z.copy(A.z).lerp(B.z, e);
    out.z.addScaledVector(out.up, -out.z.dot(out.up));
    if (out.z.lengthSq() < 1e-6) out.z.copy(B.z).addScaledVector(out.up, -B.z.dot(out.up));
    out.z.normalize();
    out.x.crossVectors(out.up, out.z);
    // the camera backs off (way up high in the middle of the trip) and looks down
    out.d = A.d + (B.d - A.d) * e + f.bump * Math.pow(hump, 0.85);
    const p = A.p + (B.p - A.p) * e;
    out.p = p + (0.5 - p) * Math.min(1, hump * 1.4);
    out.a = A.a + angleDiff(A.a, B.a) * e;
    const sp = Math.sin(out.p);
    out.cam.copy(out.target)
      .addScaledVector(out.x, out.d * sp * Math.sin(out.a))
      .addScaledVector(out.up, out.d * Math.cos(out.p))
      .addScaledVector(out.z, out.d * sp * Math.cos(out.a));
    out.look.copy(out.target);
    if (!f.earth) {
      // out in space: the camera swings round behind and looks ahead, at the place it's going to
      const w = smooth(Math.min(1, hump * 1.8));
      const T = tmpA.copy(B.target).sub(out.target);
      if (T.lengthSq() > 1) {
        T.normalize();
        const side = tmpB.copy(out.up).addScaledVector(T, -out.up.dot(T));
        if (side.lengthSq() < 1e-6) side.copy(out.z);
        side.normalize();
        behind.copy(out.target).addScaledVector(T, -out.d * 0.8).addScaledVector(side, out.d * 0.35);
        out.cam.lerp(behind, w);
        out.look.lerp(B.target, w * 0.85);
      }
    }
    return out;
  }
  const tmpA = new V3(), tmpB = new V3(), behind = new V3();

  // How "in space" a point is: 0 near the ground, 1 high above the planet or near the Moon.
  function spaceAt(p) {
    const up = p.distanceTo(EARTH) - EARTH_R;
    return clamp((up - 90) / 220, 0, 1);
  }

  // ------------------------------------------------------------------
  // Miis on the move: cars, boats, planes and rockets
  // ------------------------------------------------------------------
  const KINDS = {
    car: { icon: "🚗" }, boat: { icon: "⛵" }, plane: { icon: "✈️" }, rocket: { icon: "🚀" },
  };
  let models = null; // the shapes, made the first time they're needed
  // Each vehicle: trim (its own colors) + paint (the Mii's color) + where the Mii sits.
  function makeModels() {
    const K = root.World3D.kit;
    const { ball, block, cylinder, put, G, toon } = K;
    const bake = K.bakeGeo;
    const m = {};
    // a little round car
    m.car = {
      trim: bake((g) => {
        for (const [x, z] of [[-0.85, 1.05], [0.85, 1.05], [-0.85, -1.05], [0.85, -1.05]]) {
          cylinder(g, 0x2d2d38, x, 0.38, z, 0.38, 0.3, { rz: Math.PI / 2, seg: 14 });
          cylinder(g, 0xd8dbe6, x * 1.02, 0.38, z, 0.18, 0.32, { rz: Math.PI / 2, seg: 10 });
        }
        block(g, 0xbfe6ff, 0, 1.25, 0.75, 1.5, 0.5, 0.08, 0.04, { rx: -0.35 });          // windscreen
        ball(g, 0xfff3b0, -0.55, 0.75, 1.62, 0.16); ball(g, 0xfff3b0, 0.55, 0.75, 1.62, 0.16); // lights
        block(g, 0x3a3a48, 0, 0.82, 0.35, 0.12, 0.5, 0.12, 0.04, { rx: -0.6 });           // steering wheel post
        cylinder(g, 0x3a3a48, 0, 1.08, 0.2, 0.22, 0.06, { rx: -0.9, seg: 14 });
      }),
      paint: bake((g) => {
        block(g, 0xffffff, 0, 0.7, 0, 1.9, 0.62, 3.3, 0.28);
        block(g, 0xffffff, 0, 0.98, 1.1, 1.8, 0.2, 1.0, 0.1);
        block(g, 0xffffff, 0, 1.0, -1.25, 1.8, 0.35, 0.7, 0.12);
      }),
      seat: { y: 0.62, z: -0.25, s: 0.62 },
    };
    // a little boat with a sail
    m.boat = {
      trim: bake((g) => {
        block(g, 0xffffff, 0, 0.62, 0, 1.6, 0.12, 3.0, 0.06);
        cylinder(g, 0xa87444, 0, 2.2, 0.55, 0.06, 3.4, { seg: 8 });
        put(g, G.cone(3), toon(0xfffaf0), { x: 0, y: 2.4, z: 0.95, sx: 0.06, sy: 2.6, sz: 0.85, ry: Math.PI / 2 });
        ball(g, 0xff5a64, 0, 4.0, 0.55, 0.14);
      }),
      paint: bake((g) => {
        block(g, 0xffffff, 0, 0.3, 0, 1.9, 0.62, 3.6, 0.3);
        put(g, G.cone(16), toon(0xffffff), { y: 0.3, z: 1.95, sx: 0.95, sy: 0.6, sz: 0.31, rx: Math.PI / 2 });
      }),
      seat: { y: 0.66, z: -0.6, s: 0.62 },
    };
    // a little propeller plane
    m.plane = {
      trim: bake((g) => {
        block(g, 0xffffff, 0, 0.75, 0.1, 6.0, 0.14, 1.1, 0.06);   // wings
        block(g, 0xffffff, 0, 1.0, -2.0, 2.2, 0.1, 0.6, 0.04);    // tail wings
        block(g, 0xffffff, 0, 1.45, -2.05, 0.1, 0.9, 0.6, 0.04);  // tail fin
        cylinder(g, 0x3a3a48, 0, 0.75, 2.05, 0.12, 0.2, { rx: Math.PI / 2, seg: 10 });
        block(g, 0x3a3a48, 0, 0.75, 2.18, 1.5, 0.12, 0.04, 0.03); // propeller
        block(g, 0xbfe6ff, 0, 1.3, 0.75, 0.9, 0.4, 0.06, 0.03, { rx: -0.4 });
      }),
      paint: bake((g) => {
        put(g, G.capsule(), toon(0xffffff), { y: 0.85, sx: 1.3, sy: 2.1, sz: 1.3, rx: Math.PI / 2 });
      }),
      seat: { y: 0.82, z: 0.2, s: 0.55 },
    };
    // a rocket (points up its own y; it flies nose first)
    m.rocket = {
      trim: bake((g) => {
        put(g, G.cone(18), toon(0xff5a64), { y: 3.3, sx: 0.85, sy: 1.3, sz: 0.85 });
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU;
          block(g, 0xff5a64, Math.sin(a) * 0.85, 0.5, Math.cos(a) * 0.85, 0.12, 1.1, 0.8, 0.04, { ry: a });
        }
        cylinder(g, 0xbfe6ff, 0, 2.0, 0.78, 0.32, 0.12, { rx: Math.PI / 2, seg: 16 }); // window
        put(g, G.cone(12), toon(0xffd23f, { emissive: 0xffa020, emissiveIntensity: 1 }), { y: -0.55, sx: 0.5, sy: 1.1, sz: 0.5, rx: Math.PI });
      }),
      paint: bake((g) => { cylinder(g, 0xffffff, 0, 1.4, 0, 0.82, 2.8, { seg: 18 }); }),
      seat: null,
    };
    return m;
  }

  /*
   * createTraffic(hub, planet) -> { group, update(dt), clear(), list }
   * Every frame it asks hub.travelers() for the Miis on their way somewhere:
   * [{ id, from, to, k (0..1 of the way), name }] and moves a vehicle for each.
   */
  function createTraffic(hub, planet) {
    const group = new THREE.Group();
    group.name = "traffic";
    const list = new Map(); // id -> vehicle
    const M = root.MiiModel;
    const placeOf = (id) => (id === "home" ? "apartments" : id);

    // a point at the edge of a place's patch of ground, on the side facing the point "toward"
    function edgePoint(id, toward) {
      const f = frameFor(id);
      const pad = planet.pads.get(id);
      const r = (pad ? pad.radius : 26) + 2;
      const flat = toward.clone().sub(f.pos).projectOnPlane(f.up);
      if (flat.lengthSq() < 1e-6) flat.copy(f.z);
      flat.normalize();
      return f.pos.clone().addScaledVector(flat, r);
    }

    function kindFor(from, to) {
      if (from === "space" || to === "space") return "rocket";
      if (from === "away" || to === "away") return "plane";
      return frameFor(from).up.angleTo(frameFor(to).up) > 1.0 ? "plane" : "surface";
    }

    // Plans a trip from a to b (place ids, "away" = off on vacation).
    function route(from, to, start) {
      const r = { from, to, kind: kindFor(from, to) };
      const away = from === "away" || to === "away";
      const here = frameFor(away ? (from === "away" ? to : from) : from);
      const there = away ? null : frameFor(to);
      if (away) {
        // up into the sky and off over the horizon (or back down)
        const p0 = edgePoint(here.id, here.pos.clone().add(here.x));
        const side = here.x.clone();
        const pts = [p0, p0.clone().addScaledVector(here.up, 40).addScaledVector(side, 60), p0.clone().addScaledVector(here.up, 130).addScaledVector(side, 170), p0.clone().addScaledVector(here.up, 230).addScaledVector(side, 260)];
        if (from === "away") pts.reverse();
        r.pts = pts;
        r.bez = true;
      } else if (r.kind === "rocket") {
        const a = start || edgePoint(here.id, there.pos), b = edgePoint(there.id, here.pos);
        const na = a.clone().sub(here.center).normalize(), nb = b.clone().sub(there.center).normalize();
        const len = a.distanceTo(b);
        r.pts = [a, a.clone().addScaledVector(na, len * 0.4), b.clone().addScaledVector(nb, len * 0.3), b];
        r.bez = true;
      } else {
        const a = start || edgePoint(here.id, there.pos), b = edgePoint(there.id, here.pos);
        r.da = a.clone().normalize(); r.db = b.clone().normalize();
      }
      return r;
    }

    // where a vehicle is at s (0..1) of route r; also says if it's on the sea
    function pointAt(r, s, out) {
      if (r.bez) return { p: bez(r.pts[0], r.pts[1], r.pts[2], r.pts[3], s, out), sea: false };
      const d = slerpDir(r.da, r.db, s, tmpA);
      const ground = groundRadius(d, planet.pads);
      let h = 0.05;
      if (r.kind === "plane") h = 24 * smooth(Math.min(1, Math.min(s, 1 - s) / 0.22));
      const sea = r.kind !== "plane" && land(d) < 0 && ground <= EARTH_R + 0.01;
      return { p: out.copy(d).multiplyScalar(ground + h - (sea ? 0.25 : 0)), sea };
    }

    function colorFor(id) {
      const info = hub.miiInfo && hub.miiInfo(id);
      const c = info && (info.look.shirt || info.template.source.shirt);
      if (Array.isArray(c)) return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
      if (typeof c === "string" && c[0] === "#") return new THREE.Color(c);
      let h = 0;
      for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.6);
    }

    function makeVehicle(t) {
      if (!models) models = makeModels();
      const v = { id: t.id, to: t.to, root: new THREE.Group(), body: {}, shown: null, k0: 0 };
      const paintMat = new THREE.MeshToonMaterial({ color: colorFor(t.id), gradientMap: root.World3D.kit.paintedMat.gradientMap, vertexColors: true });
      v.paintMat = paintMat;
      for (const kind of ["car", "boat", "plane", "rocket"]) {
        const g = new THREE.Group();
        const trim = new THREE.Mesh(models[kind].trim, root.World3D.kit.paintedMat);
        const paint = new THREE.Mesh(models[kind].paint, paintMat);
        trim.castShadow = paint.castShadow = true;
        g.add(trim, paint);
        g.visible = false;
        v.body[kind] = g;
        v.root.add(g);
      }
      // the Mii, sitting in it (if its model is loaded)
      const info = hub.miiInfo && hub.miiInfo(t.id);
      if (info && info.template && M) {
        v.mii = M.createInstance(info.template, info.look || {});
        v.mii.holder.rotation.order = "YXZ";
        v.mii.holder.traverse((x) => { if (x.isMesh) x.castShadow = false; });
      }
      v.tag = document.createElement("div");
      v.tag.className = "vehicle-tag";
      hub.overlay.appendChild(v.tag);
      v.route = route(t.from, t.to);
      group.add(v.root);
      return v;
    }

    function removeVehicle(v) {
      group.remove(v.root);
      if (v.mii) M.disposeObject(v.mii.holder);
      v.paintMat.dispose();
      v.tag.remove();
      list.delete(v.id);
    }

    const pos = new V3(), ahead = new V3(), fwd = new V3(), upv = new V3(), right = new V3(), m4 = new THREE.Matrix4();
    const camW = new V3(), wp = new V3(), ndc = new V3();
    let time = 0;
    function update(dt) {
      time += dt;
      const now = hub.travelers ? hub.travelers() : [];
      const seen = new Set();
      hub.camera.getWorldPosition(camW);
      group.updateMatrixWorld();
      for (const t of now) {
        const from = placeOf(t.from), to = placeOf(t.to);
        if (!from || !to || from === to || (from === "away" && to === "away")) continue;
        seen.add(t.id);
        let v = list.get(t.id);
        if (v && (v.to !== to)) {
          // it changed its mind on the way: a new trip from where it is now
          v.route = v.route.bez && kindFor(from, to) !== "rocket" ? route(from, to) : route(from, to, v.root.position.clone());
          v.to = to; v.k0 = t.k;
        }
        if (!v) { v = makeVehicle(Object.assign({}, t, { from, to })); list.set(t.id, v); }
        const s = clamp((t.k - v.k0) / Math.max(0.05, 1 - v.k0), 0, 1);
        const here = pointAt(v.route, s, pos);
        pointAt(v.route, Math.min(1, s + 0.01), ahead);
        if (s >= 0.995) pointAt(v.route, s - 0.01, ahead).p.sub(pos).negate().add(pos); // (at the very end: keep facing the same way)
        // which vehicle: a rocket, a plane, or by car over land and boat over the sea
        const kind = v.route.kind === "surface" ? (here.sea ? "boat" : "car") : v.route.kind;
        if (v.shown !== kind) {
          for (const k in v.body) v.body[k].visible = k === kind;
          v.shown = kind;
          v.tag.textContent = KINDS[kind].icon + " " + (t.name || "");
          if (v.mii) {
            const seat = models[kind].seat;
            if (seat) {
              v.body[kind].add(v.mii.holder);
              v.mii.holder.position.set(0, seat.y, seat.z);
              v.mii.holder.scale.setScalar(seat.s);
              v.mii.holder.visible = true;
            } else v.mii.holder.visible = false;
          }
        }
        // face the way it's going, upright on the planet (a rocket flies nose first)
        fwd.copy(ahead).sub(pos);
        if (fwd.lengthSq() < 1e-8) fwd.copy(v.lastFwd || frameFor(to).z);
        fwd.normalize();
        v.lastFwd = (v.lastFwd || new V3()).copy(fwd);
        const center = pos.distanceTo(MOON) < pos.distanceTo(EARTH) ? MOON : EARTH;
        upv.copy(pos).sub(center).normalize();
        if (kind === "rocket") {
          right.crossVectors(fwd, upv);
          if (right.lengthSq() < 1e-6) right.set(1, 0, 0).projectOnPlane(fwd);
          right.normalize();
          const back = new V3().crossVectors(right, fwd);
          m4.makeBasis(right, fwd, back);
        } else {
          right.crossVectors(upv, fwd).normalize();
          const fw = new V3().crossVectors(right, upv).normalize();
          m4.makeBasis(right, upv, fw);
        }
        v.root.quaternion.setFromRotationMatrix(m4);
        v.root.position.copy(pos);
        if (kind === "boat") v.root.position.addScaledVector(upv, Math.sin(time * 2.4 + v.id.length) * 0.08);
        if (kind === "plane") v.root.rotateZ(Math.sin(time * 1.3) * 0.08);
        // pop in at the start and out at the end; bigger when far away, so you can spot it
        v.root.getWorldPosition(wp);
        const dist = wp.distanceTo(camW);
        const pop = smooth(clamp(Math.min(s, 1 - s) / 0.04, 0, 1));
        v.root.scale.setScalar(Math.max(0.01, pop * clamp(dist / 80, 1, 3)));
        // the Mii only moves when you can see it
        const onScreen = ndc.copy(wp).project(hub.camera);
        const visible = !hub.visiting && // (not while you're inside a home)
          ndc.z < 1 && Math.abs(ndc.x) < 1.1 && Math.abs(ndc.y) < 1.1;
        if (v.mii) v.mii.holder.visible = !!models[v.shown].seat && visible && dist < 300;
        if (v.mii && v.mii.holder.visible && dist < 160) {
          v.mii.rig.pose({ t: time, dt, arms: v.shown === "car" ? "type" : "down", sit: true, walk: 0, phase: 0, legsOut: true });
        }
        // the name tag
        const tagOn = visible && dist < 260 && pop > 0.5;
        v.tag.style.display = tagOn ? "" : "none";
        if (tagOn) v.tag.style.transform = "translate(" + ((onScreen.x * 0.5 + 0.5) * hub.W) + "px," + ((-onScreen.y * 0.5 + 0.5) * hub.H - 18) + "px)";
      }
      for (const v of Array.from(list.values())) if (!seen.has(v.id)) removeVehicle(v);
    }

    function clear() { for (const v of Array.from(list.values())) removeVehicle(v); }

    return { group, update, clear, list, route, kindFor };
  }

  root.MiiPlanet3D = {
    EARTH_R, MOON_R, EARTH, MOON, SPOTS,
    frameFor, land, groundRadius, create, flightPath, samplePath, spaceAt, createTraffic,
  };
})(typeof self !== "undefined" ? self : this);
