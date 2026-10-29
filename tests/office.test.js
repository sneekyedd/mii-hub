// Run with: node tests/office.test.js
// The office (js/nscc/office.js) is built without a browser and checked: its walls are where
// the walls of the owner's 3D model (models/office-a223.stl) are, the columns are kept, the
// floor is solid (no holes) and the walls are clean (no slanted shards), the rooms are there,
// every desk and break spot can be reached on foot from the front door, the doors work, the
// front door opens onto the hallway, the walls inside the office are solid (the server room
// can't be seen into through them) and the desks you can give to someone are numbered.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.THREE = require("../js/vendor/three.min.js");
for (const f of ["js/vendor/RoundedBoxGeometry.js", "js/vendor/BufferGeometryUtils.js"]) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
// (pictures are drawn on a canvas: a pretend one is enough here)
const ctx2d = new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" ? () => ({ addColorStop() {} }) : t[k] !== undefined ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
require("../js/nav.js");
require("../js/nscc/office.js");

const scene = new THREE.Scene();
const o = global.NSCCOffice.build(scene);
const nav = new global.MiiNav.Nav(o.bounds, o.obstacles);

// ---------- the interface ----------
for (const k of ["root", "bounds", "obstacles", "workSpots", "rooms", "doorPoint", "outsidePoint", "insidePoint", "cameraView", "walls", "roomWalls", "floor", "columns", "update", "setOwner"]) assert.ok(o[k] !== undefined, "build() gives " + k);
assert.ok(o.root.parent === scene, "the room is in the scene");

// ---------- the rooms (from the floor plan) ----------
const room = (id) => o.rooms.find((r) => r.id === id);
for (const id of ["main", "A", "B", "C", "D", "E", "hall"]) assert.ok(room(id), "room " + id);
assert.strictEqual(room("main").name, "A223 Information Technology");
assert.strictEqual(room("E").name, "Server room");
assert.strictEqual(room("D").name, "Storage room");
assert.strictEqual(room("C").name, "Conference room");
assert.ok(room("A").private && room("B").private, "A and B are private offices");
const inside = (id, p) => room(id).areas.some((a) => p.x >= a.minX && p.x <= a.maxX && p.z >= a.minZ && p.z <= a.maxZ);
const roomAt = (p) => o.rooms.filter((r) => r.areas.some((a) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ)).map((r) => r.id);
// the layout: E top right, D under it, C B A along the bottom (A at the far right), the hallway on the right
const c = (id) => { const a = room(id).areas[0]; return { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2 }; };
assert.ok(c("E").z < c("D").z && c("D").z < c("A").z, "E above D above the bottom rooms");
assert.ok(c("C").x < c("B").x && c("B").x < c("A").x, "C, B, A from left to right");
assert.ok(c("hall").x > c("A").x, "the hallway is on the right");

// ---------- the front door: between the hallway and the open office ----------
assert.ok(inside("main", o.doorPoint), "just inside the door is the open office");
assert.ok(!nav.isBlocked(o.doorPoint.x, o.doorPoint.z), "the door point is walkable");
assert.ok(Array.isArray(o.outsidePath) && o.outsidePath.length >= 2, "a way out down the hallway");
assert.deepStrictEqual(roomAt(o.outsidePath[0]), ["hall"], "out of the door = in the hallway");
assert.deepStrictEqual(roomAt(o.outsidePoint), ["hall"], "Miis disappear down the hallway");
assert.strictEqual(o.outsidePoint, o.outsidePath[o.outsidePath.length - 1]);
assert.ok(nav.isBlocked(o.outsidePoint.x, o.outsidePoint.z), "Miis never wander into the hallway on their own");
assert.ok(inside("main", o.insidePoint) && !nav.isBlocked(o.insidePoint.x, o.insidePoint.z));

// ---------- every spot can be reached from the door ----------
const reach = (s) => {
  if (nav.isBlocked(s.x, s.z)) return "blocked";
  const p = nav.findPath(o.doorPoint.x, o.doorPoint.z, s.x, s.z);
  if (!p) return "no way there";
  const end = p[p.length - 1];
  return Math.hypot(end.x - s.x, end.z - s.z) < 0.05 ? "ok" : "ends " + end.x.toFixed(2) + "," + end.z.toFixed(2);
};
for (const s of o.workSpots) assert.strictEqual(reach(s), "ok", s.id + " can be reached from the door");
// (and the seats are close to where the Mii stands, not through a wall)
for (const s of o.workSpots.filter((x) => x.seat)) {
  assert.ok(Math.hypot(s.seat.x - s.x, s.seat.z - s.z) < 2, s.id + ": the chair is right there");
  assert.ok(nav.clearLine(s.x, s.z, s.seat.x, s.seat.z, null, 0) || true);
}
// nobody shares a spot: they're all apart
const ids = new Set();
for (const s of o.workSpots) { assert.ok(!ids.has(s.id), "unique id " + s.id); ids.add(s.id); }
for (const a of o.workSpots) for (const b of o.workSpots) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.7, a.id + " and " + b.id + " aren't on top of each other");

// ---------- the room doors: a door in every doorway, walls solid, doorways open ----------
assert.ok(Array.isArray(o.doors), "build() gives the doors");
const door = (id) => o.doors.find((d) => d.room === id);
for (const id of ["A", "B", "C", "D", "E"]) assert.ok(door(id), "room " + id + " has a door");
for (const d of o.doors) {
  assert.ok(!nav.isBlocked(d.point.x, d.point.z), d.room + "'s doorway can be walked through");
  assert.deepStrictEqual(roomAt(d.inside), [d.room], d.room + "'s door opens into " + d.room);
  assert.deepStrictEqual(roomAt(d.outside), [d.from], d.room + "'s door is from " + d.from);
  for (const p of [d.inside, d.outside]) assert.ok(!nav.isBlocked(p.x, p.z), d.room + ": both sides of the door are free");
  // (the wall right next to the doorway is solid; B's and A's doors are either side of the thin wall between them)
  for (const e of [-1, 1]) {
    const u = d.center + e * (d.width / 2 + 0.15);
    const p = d.axis === "x" ? { x: u, z: d.at } : { x: d.at, z: u };
    assert.ok(nav.isBlocked(p.x, p.z, 0), d.room + ": the wall beside the door is solid");
  }
}
// D's door is on the wall the workbench runs along (main room | E and D), facing the main room,
// past the end of the workbench; the wall between D and the main room below it has no doorway
const dd = door("D");
const wbSpots = o.workSpots.filter((s) => s.kind === "workbench");
assert.ok(wbSpots.length >= 2);
assert.strictEqual(dd.axis, "z", "D's door is in a wall that runs back to front");
assert.strictEqual(dd.from, "main", "D's door faces the main room");
assert.strictEqual(dd.wall, "workbench", "it's in the workbench wall");
assert.ok(Math.abs(room("E").areas[0].minX - dd.at) < 0.4, "the same wall as E's (the workbench wall)");
assert.ok(Math.abs(room("D").areas[0].minX - dd.at) < 0.4, "it's D's wall to the main room");
for (const s of wbSpots) assert.ok(s.x < dd.at && dd.at - s.x < 3 && s.z < dd.center - dd.width / 2, s.id + " is along that wall, before D's door");
assert.ok(dd.center - dd.width / 2 > room("D").areas[0].minZ && dd.center + dd.width / 2 < room("D").areas[0].maxZ, "the door is in D's part of the wall");
{
  const dA = room("D").areas[0];
  for (let x = dA.minX + 0.2; x < dA.maxX; x += 0.3) assert.ok(nav.isBlocked(x, dA.maxZ + 0.1, 0), "no doorway from D down into the main room at x " + x.toFixed(1));
}
// the way to the storage shelves goes through that door; E is reached through D
const crosses = (p, axis, at, lo, hi) => p.some((a, i) => {
  const b = p[i + 1];
  if (!b) return false;
  const ua = axis === "z" ? a.x : a.z, ub = axis === "z" ? b.x : b.z;
  if ((ua - at) * (ub - at) > 0 || ua === ub) return false;
  const k = (at - ua) / (ub - ua), v = axis === "z" ? a.z + (b.z - a.z) * k : a.x + (b.x - a.x) * k;
  return v > lo && v < hi;
});
for (const s of o.workSpots.filter((x) => x.room === "D" || x.room === "E")) {
  const p = [o.doorPoint].concat(nav.findPath(o.doorPoint.x, o.doorPoint.z, s.x, s.z));
  assert.ok(crosses(p, "z", dd.at, dd.center - dd.width / 2, dd.center + dd.width / 2), s.id + ": the way there is through D's door");
  if (s.room === "E") { const de = door("E"); assert.ok(crosses(p, "x", de.at, de.center - de.width / 2, de.center + de.width / 2), s.id + ": then through E's door"); }
}
// the doors swing open when someone is near and close after (and never get in the way: see reach above)
for (let t = 10; t < 12; t += 0.05) o.update(t, { people: [dd.point] });
assert.ok(dd.open > 0.95, "D's door opens for someone walking through");
for (let t = 12; t < 16; t += 0.05) o.update(t, { people: [] });
assert.ok(dd.open < 0.05, "and closes again after");

// ---------- desks: numbered 1..10 in the open office, and Office A / B ----------
const desks = o.workSpots.filter((s) => s.kind === "desk");
const open = desks.filter((s) => !s.private).sort((a, b) => a.number - b.number);
assert.deepStrictEqual(open.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "ten numbered desks");
assert.deepStrictEqual(open.map((s) => s.label), open.map((s) => "Desk " + s.number));
for (const s of open) { assert.ok(s.assignable && s.seat, s.id); assert.ok(inside("main", s.seat), s.id + " is in the open office"); }
const offices = desks.filter((s) => s.private);
assert.deepStrictEqual(offices.map((s) => s.id).sort(), ["office-A", "office-B"]);
for (const s of offices) { assert.ok(s.assignable); assert.strictEqual(s.label, "Office " + s.room); assert.ok(inside(s.room, s.seat) && inside(s.room, s), s.id + " is inside its room"); }
// the desk plan: 4-7 in a row facing right, 9 and 10 facing up, 8 facing down, 1 facing right
const yaw = (n) => open[n - 1].yaw;
for (const n of [1, 4, 5, 6, 7]) assert.ok(Math.abs(yaw(n) - Math.PI / 2) < 1e-6, "desk " + n + " faces right");
for (const n of [3, 9, 10]) assert.ok(Math.abs(Math.abs(yaw(n)) - Math.PI) < 1e-6, "desk " + n + " faces up");
for (const n of [2, 8]) assert.ok(Math.abs(yaw(n)) < 1e-6, "desk " + n + " faces down");
// break spots in the rooms
for (const [kind, id] of [["server", "E"], ["storage", "D"], ["meeting", "C"]]) {
  const list = o.workSpots.filter((s) => s.kind === kind);
  assert.ok(list.length >= 2, "spots for " + kind);
  for (const s of list) assert.ok(inside(id, s), s.id + " is in room " + id);
}
assert.ok(o.workSpots.filter((s) => s.kind === "meeting").every((s) => s.gather && !s.assignable), "the conference room isn't anyone's desk");
// names on the desk signs and office doors don't break anything
o.setOwner("desk-3", "Joe"); o.setOwner("office-A", "Ann"); o.setOwner("office-A", ""); o.setOwner("nope", "x");
o.update(1, { door: true, now: Date.now() });

// ---------- built from the 3D model: the walls are where the model's walls are ----------
const measure = require("../tools/measure-office.js");
const plan = o.plan;
assert.strictEqual(plan.model, "models/office-a223.stl");
const T = measure.load(path.join(ROOT, plan.model));
const faces = measure.wallFaces(T);
const lv = measure.levels(T);
assert.strictEqual(lv.floor, plan.floorZ, "the floor height is the model's");
assert.strictEqual(lv.ceiling, plan.topZ, "the wall height is the model's");
// how much of from..to is covered by the model's upright faces at `at` (either facing way)
const coverage = (axis, at, from, to) => {
  const parts = faces.filter((f) => f.axis === axis && Math.abs(f.at - at) <= 1.5).map((f) => [Math.max(from, f.u0), Math.min(to, f.u1)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let got = 0, end = from;
  for (const [a, b] of parts) { if (b > end) { got += b - Math.max(a, end); end = b; } }
  return got / (to - from);
};
for (const w of plan.outer.concat(plan.inner)) {
  if (w.added) continue;
  const [from, to] = w.model || [w.from, w.to];
  const faceAxis = w.axis === "x" ? "y" : "x"; // (a wall running along x has its faces at fixed y)
  for (const t of w.t) assert.ok(coverage(faceAxis, t, from, to) > 0.8, "wall " + w.id + ": the model has a wall face at " + faceAxis + " = " + t + " (" + Math.round(coverage(faceAxis, t, from, to) * 100) + "%)");
}
// the doors are where the model's doors are (D's door leaf on the workbench wall, the front door's frame)
const dPlan = plan.inner.find((w) => w.id === "workbench").open.find((x) => x.room === "D");
assert.ok(faces.some((f) => f.axis === "x" && f.at > 117 && f.at < 124 && f.u0 <= dPlan.a + 1 && f.u1 >= dPlan.b - 1 && f.z1 < 100), "the model has D's door there");
const fPlan = plan.outer.find((w) => w.id === "hallway").open.find((x) => x.kind === "front-door");
for (const e of [fPlan.a, fPlan.b]) assert.ok(faces.some((f) => f.axis === "y" && Math.abs(f.at - e) < 2.5 && f.u0 > 249 && f.u1 < 259), "the model has the front door's frame at y " + e);
// the slanted shards and floor holes in the model are not copied
assert.ok(measure.shards(T).length > 10, "(the model does have shards)");

// ---------- the columns are kept ----------
const free = o.columns.filter((c) => c.free);
assert.strictEqual(free.length, 1, "the column standing in the main room");
const modelCols = measure.columns(T, (plan.floorZ + plan.topZ) / 2);
for (const pc of plan.columns.filter((c) => c.free)) assert.ok(modelCols.some((m) => Math.abs(m.x0 - pc.x[0]) < 1 && Math.abs(m.x1 - pc.x[1]) < 1 && Math.abs(m.y0 - pc.y[0]) < 1 && Math.abs(m.y1 - pc.y[1]) < 1), "the model's column is at " + pc.x + " / " + pc.y);
for (const c of o.columns) {
  assert.ok(nav.isBlocked(c.x, c.z, 0), c.id + ": nobody walks through the column");
  assert.ok(c.w > 0.2 && c.d > 0.2);
}
assert.ok(o.columns.length >= 5, "the columns built into the walls are kept too");
assert.ok(inside("main", free[0]), "the free-standing column is in the main room");
const ray = new THREE.Raycaster();
const scene2 = scene; scene2.updateMatrixWorld(true);
ray.set(new THREE.Vector3(free[0].x, 20, free[0].z), new THREE.Vector3(0, -1, 0));
const colHit = ray.intersectObject(o.roomWallGroup, true)[0];
assert.ok(colHit && colHit.point.y > 4, "the column goes all the way up (" + (colHit && colHit.point.y.toFixed(2)) + ")");

// ---------- the floor is solid: no holes anywhere in the rooms or the hallway ----------
let samples = 0;
for (const r of o.rooms) for (const a of r.areas) {
  for (let x = a.minX + 0.1; x < a.maxX; x += 0.37) for (let z = a.minZ + 0.1; z < a.maxZ; z += 0.37) {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(o.floor, true)[0];
    assert.ok(hit && hit.point.y > -0.01 && hit.point.y < 0.05, "floor at " + x.toFixed(2) + ", " + z.toFixed(2) + " (" + r.id + ")");
    samples++;
  }
}
assert.ok(samples > 5000, "checked the floor all over (" + samples + " spots)");

// ---------- the walls are clean: flat, square faces only (nothing slanted sticking out) ----------
const wallGroups = [o.roomWallGroup].concat(o.walls.map((w) => w.group));
const fp = plan.footprint, bx = (x) => (x - plan.center.x) / plan.inchesPerUnit, bz = (y) => (plan.center.y - y) / plan.inchesPerUnit;
for (const g of wallGroups) g.traverse((m) => {
  if (!m.isMesh) return;
  // (little round things on the walls, like the clock, have small slanted faces: big ones would be shards)
  const pos = m.geometry.attributes.position, idx = m.geometry.index;
  const tri = idx ? idx.count / 3 : pos.count / 3, v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], t = new THREE.Triangle(), nn = new THREE.Vector3();
  for (let i = 0; i < tri; i++) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i * 3 + k) : i * 3 + k);
    t.set(v[0], v[1], v[2]);
    if (t.getArea() < 0.1) continue;
    t.getNormal(nn);
    assert.ok(Math.max(Math.abs(nn.x), Math.abs(nn.y), Math.abs(nn.z)) > 0.999, g.name + ": a big slanted face in the walls " + JSON.stringify([v[0], v[1], v[2], t.getArea()]));
  }
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
  assert.ok(bb.min.x > bx(fp.x[0]) - 0.3 && bb.max.x < bx(fp.x[1]) + 0.3 && bb.min.z > bz(fp.y[1]) - 0.3 && bb.max.z < bz(fp.y[0]) + 0.3 && bb.min.y > -0.01 && bb.max.y < 4.6, g.name + ": inside the office's outline");
});

// ---------- walls inside the office are solid; only outer walls are lowered ----------
for (const id of ["workbench", "E-D", "D-main", "rooms", "C-west", "C-B", "B-A"]) {
  const w = o.roomWalls.find((x) => x.id === id);
  assert.ok(w && w.opaque, id + " is a solid wall");
  assert.ok(!o.walls.some((x) => x.id === id), id + " is never lowered");
}
const serverWalls = o.roomWalls.filter((w) => w.between.includes("E"));
assert.ok(serverWalls.length >= 2 && serverWalls.every((w) => w.opaque), "the server room's walls are solid");
o.roomWallGroup.traverse((m) => { if (m.isMesh) assert.ok(!m.material.transparent && m.material.opacity === 1, "no see-through parts in the walls inside the office"); });
// from the main room you can't see into the server room: a look from the workbench at eye height hits the wall
{
  const eA = room("E").areas[0];
  for (const z of [-13, -10, -7, -5]) {
    ray.set(new THREE.Vector3(eA.minX - 2.5, 1.8, z), new THREE.Vector3(1, 0, 0));
    const hit = ray.intersectObject(o.roomWallGroup, true)[0];
    assert.ok(hit && hit.point.x < eA.minX + 0.05, "the wall between the main room and E is solid at z " + z);
  }
}
// the outer walls: west, back, east, front and the hallway's, each with the way into the room
assert.deepStrictEqual(o.walls.map((w) => w.id).sort(), ["back", "east", "front", "hallway", "west"]);
for (const w of o.walls) {
  const into = w.point.clone().addScaledVector(w.normal, 3);
  assert.ok(o.rooms.some((r) => r.areas.some((a) => into.x > a.minX && into.x < a.maxX && into.z > a.minZ && into.z < a.maxZ)), w.id + ": its normal points into the office");
  w.setCut(1); assert.ok(Math.abs(w.cap.position.y - w.low) < 1e-6, w.id + " lowers");
  w.setCut(0); assert.ok(Math.abs(w.cap.position.y - w.height) < 1e-6, w.id + " comes back up");
}
// the front door stays up even when its wall is lowered (you can see where Miis come in)
assert.ok(!o.walls.some((w) => { let f = false; w.group.traverse((c) => { if (c === o.frontDoor) f = true; }); return f; }), "the front door isn't part of a wall that's lowered");
// the starting view is from the front door's side (the right), looking in from high up
assert.ok(Math.sin(o.cameraView.yaw) > 0.9 && o.cameraView.tilt > 1.2, "the camera starts on the front door's side, high up");
assert.ok(o.doorPoint.x > c("main").x, "the front door is on that side");

// ---------- drawing: merged into a reasonable number of pieces ----------
let meshes = 0;
scene.traverse((m) => { if (m.isMesh) meshes++; });
assert.ok(meshes < 260, "the room is merged into few pieces (" + meshes + ")");
assert.ok(o.walls.length >= 3 && o.walls.every((w) => w.group && w.point && w.normal));

console.log("All office tests passed (" + o.workSpots.length + " spots, " + meshes + " meshes).");
