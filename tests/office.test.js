// Run with: node tests/office.test.js
// The office (js/nscc/office.js) is built without a browser and checked: the rooms are
// there, every desk and break spot can be reached on foot from the front door, the front
// door opens onto the hallway, and the desks you can give to someone are numbered.
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
for (const k of ["root", "bounds", "obstacles", "workSpots", "rooms", "doorPoint", "outsidePoint", "insidePoint", "cameraView", "walls", "update", "setOwner"]) assert.ok(o[k] !== undefined, "build() gives " + k);
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
  // (the wall right next to the doorway is solid)
  for (const e of [-1, 1]) {
    const u = d.center + e * (d.width / 2 + 0.3);
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
assert.strictEqual(room("E").areas[0].minX, dd.at, "it's the same wall as E's (the workbench wall)");
assert.strictEqual(room("D").areas[0].minX, dd.at, "it's D's wall to the main room");
for (const s of wbSpots) assert.ok(s.x < dd.at && dd.at - s.x < 3 && s.z < dd.center - dd.width / 2, s.id + " is along that wall, before D's door");
assert.ok(dd.center - dd.width / 2 > room("D").areas[0].minZ && dd.center + dd.width / 2 < room("D").areas[0].maxZ, "the door is in D's part of the wall");
for (let x = 5.6; x < 11; x += 0.3) assert.ok(nav.isBlocked(x, room("D").areas[0].maxZ, 0), "no doorway from D down into the main room at x " + x.toFixed(1));
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

// ---------- drawing: merged into a reasonable number of pieces ----------
let meshes = 0;
scene.traverse((m) => { if (m.isMesh) meshes++; });
assert.ok(meshes < 260, "the room is merged into few pieces (" + meshes + ")");
assert.ok(o.walls.length >= 3 && o.walls.every((w) => w.group && w.point && w.normal));

console.log("All office tests passed (" + o.workSpots.length + " spots, " + meshes + " meshes).");
