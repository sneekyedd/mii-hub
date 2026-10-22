// Tests for the Paintball rules (movement, weapons, hit boxes). Run: node tests/paintball.test.js
const assert = require("assert");
require("../js/paintball/pb-engine.js");
const E = globalThis.PBEngine;
const T = 1 / 128;

const map = {
  boxes: [
    { x: 0, z: -5, hw: 2, hd: 0.5, rot: 0, y0: 0, y1: 2.6, mat: "metal" },   // a wall ahead
    { x: 4, z: 0, hw: 0.5, hd: 0.5, rot: 0, y0: 0, y1: 0.4, mat: "wood" },    // a step
    { x: -4, z: 0, hw: 0.7, hd: 1.5, rot: 0, y0: 0, y1: 1.2, mat: "wood" }, // a crate
    { x: 8, z: 8, hw: 1.5, hd: 0.4, rot: 0.6, y0: 0, y1: 2.6, mat: "metal" }, // a turned container wall
  ],
  cyls: [{ x: 6, z: -3, r: 0.3, y0: 0, y1: 0.9 }],
  bounds: { minX: -15, maxX: 15, minZ: -15, maxZ: 15 },
};
const world = new E.World(map);
const run = (m, secs, inp) => { for (let i = 0; i < secs / T; i++) m.step(T, Object.assign({ fwd: 0, side: 0, yaw: 0, maxSpeed: E.CFG.speedAK }, inp)); };

// top speed with the AK and with the knife
let m = new E.Mover(world); m.place(0, 10);
run(m, 1.5, { side: 1 });
assert(Math.abs(m.speed2d() - 215 * E.U) < 0.05, "AK top speed " + m.speed2d());
m.place(0, 10); run(m, 1.5, { side: 1, maxSpeed: E.CFG.speedKnife });
assert(Math.abs(m.speed2d() - 250 * E.U) < 0.05, "knife top speed");
// walking and crouching
m.place(0, 10); run(m, 1.5, { side: 1, walk: true });
assert(Math.abs(m.speed2d() - 215 * 0.52 * E.U) < 0.05, "walk speed");
// stopping from full speed takes a fraction of a second (counter-strafe is faster)
m.place(0, 10); run(m, 1.5, { side: 1 });
let t = 0; while (m.speed2d() > 215 * 0.34 * E.U) { m.step(T, { fwd: 0, side: 0, yaw: 0, maxSpeed: E.CFG.speedAK }); t += T; }
let t2 = 0; m.place(0, 10); run(m, 1.5, { side: 1 });
while (m.speed2d() > 215 * 0.34 * E.U) { m.step(T, { fwd: 0, side: -1, yaw: 0, maxSpeed: E.CFG.speedAK }); t2 += T; }
assert(t > 0.08 && t < 0.3 && t2 < t, "stopping " + t.toFixed(3) + " counter-strafe " + t2.toFixed(3));

// jump height ~1.72 m (the map is 1.25x bigger than real Shipment)
m.place(0, 10);
let top = 0; m.step(T, { jump: true, yaw: 0, maxSpeed: 5 }); for (let i = 0; i < 128; i++) { m.step(T, { yaw: 0, maxSpeed: 5 }); top = Math.max(top, m.pos.y); }
assert(Math.abs(top - 1.72) < 0.05 && m.onGround, "jump apex " + top);

// walls stop you
m.place(0, -2); run(m, 1, { fwd: 1 });
assert(m.pos.z > -4.5 + E.CFG.radius - 0.02 && m.pos.z < -4.0, "wall stop " + m.pos.z);
// you walk up a low step but not onto a crate...
m.place(2.5, 0);
let maxY = 0; for (let i = 0; i < 128; i++) { m.step(T, { side: 1, yaw: 0, maxSpeed: E.CFG.speedAK }); maxY = Math.max(maxY, m.pos.y); }
assert(Math.abs(maxY - 0.4) < 0.01 && m.pos.y === 0 && m.pos.x > 5, "stepped up and down " + maxY);
m.place(-2, 0); run(m, 1, { side: -1, yaw: 0 });
assert(m.pos.y === 0 && m.pos.x > -3.2, "crate blocks " + m.pos.x);
// ...but you can jump onto it
m.place(-2, 0); run(m, 0.25, { side: -1 }); m.step(T, { side: -1, jump: true, yaw: 0, maxSpeed: E.CFG.speedAK }); run(m, 1, { side: -1 });
assert(Math.abs(m.pos.y - 1.2) < 0.01, "jumped onto crate " + m.pos.y);
// you never end up inside a turned box, whichever way you run into it
for (let a = 0; a < 16; a++) {
  const ang = (a / 16) * Math.PI * 2;
  m.place(8 + Math.sin(ang) * 3, 8 + Math.cos(ang) * 3);
  for (let i = 0; i < 128; i++) {
    m.step(T, { fwd: 1, yaw: ang, maxSpeed: E.CFG.speedKnife });
    assert(!world.circleHitsBox(world.boxes[3], m.pos.x, m.pos.z, E.CFG.radius - 0.01), "inside turned box at angle " + a);
  }
}
// the classic: crouch-jump from a barrel onto a container (both 1.25x size, like the game's map)
{
  const K = 1.25;
  const w2 = new E.World({ boxes: [{ x: 0, z: -3, hw: 2, hd: 1.2, rot: 0, y0: 0, y1: 2.59 * K }], cyls: [{ x: 0, z: -1, r: 0.3 * K, y0: 0, y1: 0.9 * K }], bounds: map.bounds });
  const c = new E.Mover(w2); c.place(0, -0.8); c.pos.y = 0.9 * K; // on the barrel, a step's run-up
  for (let i = 0; i < 8; i++) c.step(T, { fwd: 1, yaw: 0, maxSpeed: E.CFG.speedAK });
  c.step(T, { fwd: 1, yaw: 0, jump: true, duck: true, maxSpeed: E.CFG.speedAK });
  for (let i = 0; i < 200; i++) c.step(T, { fwd: 1, yaw: 0, duck: true, maxSpeed: E.CFG.speedAK });
  assert(Math.abs(c.pos.y - 2.59 * K) < 0.01, "barrel to container crouch-jump " + c.pos.y);
  // ...but not straight from the ground
  c.place(0, 0.5);
  c.step(T, { fwd: 1, yaw: 0, jump: true, duck: true, maxSpeed: E.CFG.speedAK });
  for (let i = 0; i < 200; i++) c.step(T, { fwd: 1, yaw: 0, duck: true, maxSpeed: E.CFG.speedAK });
  assert(c.pos.y < 2, "can't jump onto a container from the ground");
}
// crouching makes you shorter
m.place(0, 10); run(m, 0.5, { duck: true });
assert(m.duck === 1 && m.height() < 1.6, "crouch");

// bullets hit walls, drums and the ground
let h = world.ray({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
assert(h && Math.abs(h.t - 4.5) < 1e-6 && h.nz === 1, "wall hit");
h = world.ray({ x: 6, y: 0.5, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
assert(h && Math.abs(h.t - 2.7) < 1e-6, "drum hit");
h = world.ray({ x: 0, y: 1.5, z: 10 }, { x: 0, y: -1, z: 0 }, 50);
assert(h && h.mat === "ground" && Math.abs(h.t - 1.5) < 1e-9, "ground hit");

// damage: one headshot kills, chest needs 3, legs need 4
assert(E.damageFor("head", 10) >= 100);
assert(E.damageFor("chest", 10) * 2 < 100 && E.damageFor("chest", 10) * 3 >= 100);
assert(E.damageFor("leg", 10) * 3 < 100 && E.damageFor("leg", 10) * 4 >= 100);

// the AWP: one shot to the head, chest or stomach; not the legs
assert(E.damageFor("head", 20, "awp") >= 100 && E.damageFor("chest", 20, "awp") >= 100 && E.damageFor("stomach", 20, "awp") >= 100);
assert(E.damageFor("leg", 20, "awp") < 100, "AWP leg shot doesn't kill");
{
  const aw = new E.Arms("awp");
  const mv = new E.Mover(world); mv.place(0, 10);
  assert(aw.weapon === "awp" && aw.ammo === 10 && aw.reserve === 30, "AWP mag");
  const noScope = E.inaccuracy(mv, aw);
  aw.zoom = 1;
  const scoped = E.inaccuracy(mv, aw);
  assert(noScope > 0.05 && scoped < 0.003, "AWP: no-scope " + noScope + " vs scoped " + scoped);
  assert(Math.abs(aw.maxSpeed() - 100 * E.U) < 1e-9, "scoped speed");
  aw.zoom = 0;
  assert(Math.abs(aw.maxSpeed() - 200 * E.U) < 1e-9, "AWP speed");
  aw.weapon = "knife";
  assert(aw.maxSpeed() === E.CFG.speedKnife);
}

// the Deagle: a sidearm in both classes, with its own ammo
{
  const ar = new E.Arms("awp");
  assert(ar.secondary === "deagle" && ar.primary === "awp", "sidearm");
  ar.weapon = "deagle"; ar.lastGun = "deagle";
  assert(ar.ammo === 7 && ar.reserve === 35, "Deagle mag 7 / 35");
  ar.ammo = 3;
  ar.weapon = "awp"; ar.lastGun = "awp";
  assert(ar.ammo === 10, "the AWP keeps its own ammo");
  ar.weapon = "deagle";
  assert(ar.ammo === 3 && Math.abs(ar.maxSpeed() - 230 * E.U) < 1e-9, "Deagle ammo + speed");
  assert(E.damageFor("head", 5, "deagle") >= 100, "Deagle headshot splats up close");
  assert(E.damageFor("chest", 5, "deagle") < 100 && E.damageFor("chest", 5, "deagle") * 2 >= 100, "two to the chest");
  assert(E.damageFor("chest", 30, "deagle") < E.damageFor("chest", 5, "deagle") * 0.8, "loses damage over distance");
  assert(E.WEAPONS.deagle.semi && Math.abs(E.WEAPONS.deagle.cycle - 0.225) < 1e-9, "semi-automatic, 0.225 s");
}

// hit boxes
const boxes = E.bodyBoxes({ x: 0, y: 0, z: -10 }, E.CFG.eyeStand, 0);
let hb = E.rayHitboxes({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, boxes, 50);
assert(hb && hb.zone === "head", "head hitbox");
hb = E.rayHitboxes({ x: 0, y: 0.8, z: 0 }, { x: 0, y: 0, z: -1 }, boxes, 50);
assert(hb && hb.zone === "stomach", "stomach hitbox " + (hb && hb.zone));
hb = E.rayHitboxes({ x: 0, y: 0.3, z: 0 }, { x: 0, y: 0, z: -1 }, boxes, 50);
assert(hb && hb.zone === "leg", "leg hitbox " + (hb && hb.zone));

// accuracy: standing still is accurate, running isn't, the first bullets of a spray go where you aim
m.place(0, 10);
const arms = new E.Arms();
assert(E.inaccuracy(m, arms) < 0.008, "standing accurate");
run(m, 1.5, { side: 1 });
assert(E.inaccuracy(m, arms) > 0.15, "running inaccurate");
m.place(0, 10);
const f = { mover: m, arms, yaw: 0, pitch: 0 };
let maxOff = 0;
for (let i = 0; i < 3; i++) {
  const d = E.shotDirection(f, i * 0.1);
  maxOff = Math.max(maxOff, Math.acos(-d.z));
  for (let k = 0; k < 13; k++) E.updateArms(arms, m, T, i * 0.1 + k * T);
}
assert(maxOff < 0.03, "first bullets accurate " + maxOff);
for (let i = 3; i < 12; i++) { E.shotDirection(f, i * 0.1); for (let k = 0; k < 13; k++) E.updateArms(arms, m, T, i * 0.1 + k * T); }
assert(arms.recY > 6, "spray climbs " + arms.recY);
// moving shots miss (like CS): how often does a first shot land on a Mii-sized target (0.5 x 1.6 m) 10 m away?
const hitRate = (weapon, setup, zoom) => {
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const mv = new E.Mover(world); mv.place(0, 10);
    const a = new E.Arms(weapon); a.zoom = zoom || 0;
    setup(mv, a);
    const d = E.shotDirection({ mover: mv, arms: a, yaw: 0, pitch: 0 }, 0);
    const t = 10 / -d.z, x = d.x * t, y = d.y * t;
    if (Math.abs(x) < 0.25 && Math.abs(y) < 0.8) hits++;
  }
  return hits / 2000;
};
const running = (mv, a) => run(mv, 1.5, { side: 1, maxSpeed: a.maxSpeed() });
const jumping = (mv, a) => { run(mv, 1.5, { side: 1, maxSpeed: a.maxSpeed() }); run(mv, 0.15, { side: 1, jump: true, maxSpeed: a.maxSpeed() }); assert(!mv.onGround, "in the air"); };
const still = () => {};
const rates = { akStill: hitRate("ak", still), akRun: hitRate("ak", running), akJump: hitRate("ak", jumping), awpScoped: hitRate("awp", still, 1), awpScopedRun: hitRate("awp", running, 1), awpNoScope: hitRate("awp", still) };
assert(rates.akStill > 0.99, "AK standing hits " + rates.akStill);
assert(rates.akRun < 0.12, "AK running mostly misses " + rates.akRun);
assert(rates.akJump < 0.05, "AK jumping almost never hits " + rates.akJump);
assert(rates.awpScoped > 0.99, "AWP scoped + still hits " + rates.awpScoped);
assert(rates.awpScopedRun < 0.15, "AWP scoped + moving misses " + rates.awpScopedRun);
assert(rates.awpNoScope < 0.7, "AWP no-scope is a gamble " + rates.awpNoScope);

// recoil settles after letting go
for (let k = 0; k < 128; k++) E.updateArms(arms, m, T, 2 + k * T);
assert(arms.recY < 0.5 && arms.recoilIdx < 1, "recoil resets");

// ---------------------------------------------------------------------
// The maps (pb-layouts.js): the list, voting, and each place's own floor plan
// ---------------------------------------------------------------------
const LY = require("../js/paintball/pb-layouts.js");
const { MiiNav } = require("../js/nav.js");
const mapReport = [];
{
  const K = 1.25; // the game makes every map this much bigger
  const ids = LY.MAPS.map((m) => m.id);
  assert(ids.length === new Set(ids).size && ids.length >= 10, "map ids are unique");
  for (const s of LY.SETTINGS) {
    const of = LY.MAPS.filter((m) => m.setting === s.id);
    assert(of.some((m) => m.layout === "shipment") && of.some((m) => m.layout !== "shipment"), s.id + ": Shipment + its own map");
  }
  for (const m of LY.MAPS) assert(LY.SETTINGS.some((s) => s.id === m.setting) && (m.layout === "shipment" || LY.LAYOUTS[m.layout]), "map " + m.id);
  assert(LY.mapById(LY.DEFAULT_MAP), "default map");
  // voting: two different maps, then Random is never one of them
  for (let i = 0; i < 500; i++) {
    const cur = ids[i % ids.length], two = LY.pickVoteMaps(cur);
    assert(two.length === 2 && two[0] !== two[1] && !two.includes(cur), "vote maps " + two);
    const r = LY.randomOther(two);
    assert(ids.includes(r) && !two.includes(r), "random isn't one of the shown maps");
  }

  // the same reach a player has (crouch-jumps included), measured with the real movement
  const reach = (crouch) => {
    let best = 0;
    for (let h = 0.4; h < 3.2; h += 0.05) {
      const w = new E.World({ boxes: [{ x: 0, z: -8, hw: 2, hd: 6, rot: 0, y0: 0, y1: h * K }], cyls: [], bounds: map.bounds });
      const mv = new E.Mover(w); mv.place(0, -1.4);
      for (let i = 0; i < 8; i++) mv.step(T, { fwd: 1, yaw: 0, maxSpeed: E.CFG.speedAK });
      mv.step(T, { fwd: 1, yaw: 0, jump: true, duck: crouch, maxSpeed: E.CFG.speedAK });
      for (let i = 0; i < 200; i++) mv.step(T, { fwd: 1, yaw: 0, duck: crouch, maxSpeed: E.CFG.speedAK });
      if (Math.abs(mv.pos.y - h * K) < 0.01) best = h;
    }
    return best;
  };
  const JUMP = reach(false), CJUMP = reach(true);
  assert(CJUMP > JUMP && JUMP > 1, "crouch-jumps reach higher: " + JUMP.toFixed(2) + " / " + CJUMP.toFixed(2));

  const scaled = (L) => ({
    boxes: L.boxes.map((b) => ({ x: b.x * K, z: b.z * K, hw: b.hw * K, hd: b.hd * K, rot: b.rot, y0: b.y0 * K, y1: b.y1 * K, mat: b.mat })),
    cyls: L.cyls.map((c) => ({ x: c.x * K, z: c.z * K, r: c.r * K, y0: c.y0 * K, y1: c.y1 * K, mat: c.mat })),
    bounds: { minX: L.bounds.minX * K, maxX: L.bounds.maxX * K, minZ: L.bounds.minZ * K, maxZ: L.bounds.maxZ * K },
  });
  const inside = (q, x, z, pad) => {
    if (q.t === "cyl") return Math.hypot(x - q.x, z - q.z) < q.r - pad;
    const c = Math.cos(q.rot), s = Math.sin(q.rot), dx = x - q.x, dz = z - q.z;
    return Math.abs(dx * c - dz * s) < q.w / 2 - pad && Math.abs(dx * s + dz * c) < q.d / 2 - pad;
  };
  for (const id of Object.keys(LY.LAYOUTS)) {
    const L = LY.build(id), S = scaled(L), W = new E.World(S), B = L.bounds;
    // nothing pokes out of the arena, and no two things are inside each other
    for (const p of L.pieces) {
      const R = p.t === "cyl" ? p.r : Math.hypot(p.w, p.d) / 2;
      assert(p.x - R > B.minX - 0.6 && p.x + R < B.maxX + 0.6 && p.z - R > B.minZ - 0.6 && p.z + R < B.maxZ + 0.6, id + ": " + p.k + " is in the arena");
    }
    for (let i = 0; i < L.pieces.length; i++) for (let j = i + 1; j < L.pieces.length; j++) {
      const a = L.pieces[i], b = L.pieces[j];
      if (!(a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01)) continue; // one on top of the other
      const R = a.t === "cyl" ? a.r : Math.hypot(a.w, a.d) / 2;
      for (let x = a.x - R; x <= a.x + R; x += 0.08) for (let z = a.z - R; z <= a.z + R; z += 0.08) {
        assert(!(inside(a, x, z, 0.02) && inside(b, x, z, 0.02)), id + ": " + a.k + " and " + b.k + " overlap at " + x.toFixed(1) + "," + z.toFixed(1));
      }
    }
    // fair spawns: the same for both teams (turned around), not in anything, and out of sight of each other
    assert(L.spawns.a.length >= 4 && L.spawns.a.length === L.spawns.b.length, id + ": spawns");
    L.spawns.a.forEach((a, i) => assert(Math.abs(a.x + L.spawns.b[i].x) < 1e-9 && Math.abs(a.z + L.spawns.b[i].z) < 1e-9, id + ": spawns mirror each other"));
    for (const sp of L.spawns.a.concat(L.spawns.b)) {
      const x = sp.x * K, z = sp.z * K;
      assert(x > S.bounds.minX + E.CFG.radius && x < S.bounds.maxX - E.CFG.radius && z > S.bounds.minZ + E.CFG.radius && z < S.bounds.maxZ - E.CFG.radius, id + ": spawn in bounds");
      for (const b of W.boxes) if (b.y0 < E.CFG.standH) assert(!W.circleHitsBox(b, x, z, E.CFG.radius + 0.1), id + ": spawn " + sp.x + "," + sp.z + " inside a box");
      for (const c of S.cyls) if (c.y0 < E.CFG.standH) assert(Math.hypot(x - c.x, z - c.z) > c.r + E.CFG.radius + 0.1, id + ": spawn inside a cylinder");
    }
    for (const a of L.spawns.a) for (const b of L.spawns.b) {
      assert(!W.clear({ x: a.x * K, y: E.CFG.eyeStand, z: a.z * K }, { x: b.x * K, y: E.CFG.eyeStand, z: b.z * K }), id + ": spawns see each other " + a.x + "," + a.z);
    }
    // the bot's routes: from every spawn to every other one, and to most of the open floor
    const obstacles = [];
    for (const b of S.boxes) if (b.y1 > E.CFG.step && b.y0 < 1.6) obstacles.push({ x: b.x, z: b.z, w: b.hw * 2, d: b.hd * 2, rot: -(b.rot || 0) });
    for (const c of S.cyls) if (c.y1 > E.CFG.step && c.y0 < 1.6) obstacles.push({ x: c.x, z: c.z, r: c.r });
    const nav = new MiiNav.Nav(S.bounds, obstacles, 0.35);
    const all = L.spawns.a.concat(L.spawns.b);
    for (const a of all) {
      assert(!nav.isBlocked(a.x * K, a.z * K), id + ": spawn on open floor (for the bot)");
      for (const b of all) if (a !== b) {
        const path = nav.findPath(a.x * K, a.z * K, b.x * K, b.z * K);
        assert(path && path.length && Math.hypot(path[path.length - 1].x - b.x * K, path[path.length - 1].z - b.z * K) < 0.6, id + ": bot route " + a.x + "," + a.z + " -> " + b.x + "," + b.z);
      }
    }
    // flood fill the bot's grid from a spawn: (almost) all open floor is connected
    const s0 = nav.cellOf(all[0].x * K, all[0].z * K), seen = new Uint8Array(nav.cols * nav.rows), q = [s0.r * nav.cols + s0.c];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop(), c = k % nav.cols, r = (k / nav.cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c2 = c + dc, r2 = r + dr, k2 = r2 * nav.cols + c2;
        if (c2 < 0 || r2 < 0 || c2 >= nav.cols || r2 >= nav.rows || seen[k2] || nav.blocked[k2]) continue;
        seen[k2] = 1; q.push(k2);
      }
    }
    let free = 0, reached = 0;
    for (let k = 0; k < nav.blocked.length; k++) if (!nav.blocked[k]) { free++; if (seen[k]) reached++; }
    assert(reached / free > 0.97, id + ": bots can get almost everywhere (" + reached + "/" + free + ")");
    // higher ground: tops you can stand on, reached by jumping/crouch-jumping from the floor or other tops
    const tops = L.pieces.filter((p) => p.t === "box" && p.w >= 0.8 && p.d >= 0.8 && !L.pieces.some((o) => o !== p && o.y >= p.y + p.h - 0.01 && o.y < p.y + p.h + E.CFG.standH / K && inside(o, p.x, p.z, 0)));
    const gap = (a, b) => { // rough distance between two footprints (box-box, by sampling a's edge)
      let best = Infinity;
      for (let i = 0; i < 64; i++) {
        const u = (i % 16) / 15 - 0.5, side = i >> 4, c = Math.cos(a.rot), s = Math.sin(a.rot);
        const lx = side < 2 ? u * a.w : (side === 2 ? -1 : 1) * a.w / 2, lz = side < 2 ? (side ? -1 : 1) * a.d / 2 : u * a.d;
        const x = a.x + lx * c + lz * s, z = a.z - lx * s + lz * c;
        const bc = Math.cos(b.rot), bs = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
        const bx = dx * bc - dz * bs, bz = dx * bs + dz * bc;
        best = Math.min(best, Math.hypot(Math.max(0, Math.abs(bx) - b.w / 2), Math.max(0, Math.abs(bz) - b.d / 2)));
      }
      return best;
    };
    const level = new Map();
    const queue = tops.filter((p) => p.y + p.h <= JUMP - 0.05);
    queue.forEach((p) => level.set(p, 0));
    while (queue.length) {
      const a = queue.shift();
      for (const b of tops) if (!level.has(b) && b.y + b.h - (a.y + a.h) <= CJUMP - 0.08 && gap(a, b) < 0.5) { level.set(b, level.get(a) + 1); queue.push(b); }
    }
    const high = tops.filter((p) => level.has(p) && p.y + p.h >= 1.9);
    assert(high.length >= 2, id + ": higher ground you can climb to (" + high.map((p) => p.k).join(", ") + ")");
    assert(high.some((p) => level.get(p) >= 1), id + ": some of it needs a (crouch-)jump from something lower");
    // nobody gets stuck or ends up inside anything: Miis running around at random
    let stuck = 0;
    const r = ((seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647))(id.length * 77 + 5);
    for (let w = 0; w < 24; w++) {
      const sp = all[w % all.length], mv = new E.Mover(W);
      mv.place(sp.x * K, sp.z * K);
      let yaw = r() * 6.28, moved = 0, last = { x: mv.pos.x, z: mv.pos.z };
      for (let i = 0; i < 128 * 6; i++) {
        if (i % 64 === 0) yaw = r() * 6.28;
        mv.step(T, { fwd: 1, side: r() < 0.3 ? 1 : 0, yaw, jump: r() < 0.01, duck: r() < 0.05, maxSpeed: E.CFG.speedAK });
        for (const b of W.boxes) if (b.y1 > mv.pos.y + E.CFG.step + 0.02 && b.y0 < mv.pos.y + mv.height() - 0.02) assert(!W.circleHitsBox(b, mv.pos.x, mv.pos.z, E.CFG.radius - 0.03), id + ": inside a " + (b.mat) + " box at " + mv.pos.x.toFixed(2) + "," + mv.pos.z.toFixed(2) + " y " + mv.pos.y.toFixed(3) + " box " + JSON.stringify([b.x, b.z, b.y0, b.y1]) + " ground " + mv.onGround + " tick " + i);
        if (i % 128 === 127) { moved += Math.hypot(mv.pos.x - last.x, mv.pos.z - last.z) > 0.5 ? 1 : 0; last = { x: mv.pos.x, z: mv.pos.z }; }
      }
      if (moved < 2) stuck++;
    }
    assert(stuck <= 2, id + ": walkers got stuck " + stuck + " times");
    mapReport.push(id + " (high ground: " + high.map((p) => p.k + " " + (p.y + p.h).toFixed(1)).join(", ") + ")");
  }
}
console.log("Maps OK: " + LY.MAPS.length + " maps; own layouts: " + mapReport.join("; "));

console.log("All paintball tests passed. Stop " + (t * 1000).toFixed(0) + " ms, counter-strafe " + (t2 * 1000).toFixed(0) + " ms, jump " + top.toFixed(2) + " m, AK hits at 10 m: still " + rates.akStill + " / running " + rates.akRun + " / jumping " + rates.akJump + ", AK head " + E.damageFor("head", 10) + " / chest " + E.damageFor("chest", 10));
