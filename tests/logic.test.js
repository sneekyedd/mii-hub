// Run with: node tests/logic.test.js
// The board's rules: in/out, the 6:00 PM rule, the top bar, and what the office does.
const assert = require("assert");
const L = require("../js/nscc/logic.js");

const at = (h, m, dayOffset) => new Date(2026, 9, 28 + (dayOffset || 0), h, m || 0, 0, 0).getTime();

// ---------- location text ----------
assert.strictEqual(L.cleanLocation("  Lunch   with  team "), "Lunch with team");
assert.strictEqual(L.cleanLocation(null), "");
assert.strictEqual(L.cleanLocation("x".repeat(200)).length, L.MAX_LOCATION);

// ---------- in -> out -> in ----------
const joe = { id: "a", name: "Joe", addedAt: at(9), location: "", leftAt: null };
assert.strictEqual(L.isOut(joe), false);
const out = L.withLocation(joe, "Lunch", at(12, 5));
assert.strictEqual(out.location, "Lunch");
assert.strictEqual(out.leftAt, at(12, 5), "leftAt is the moment the field was filled");
assert.strictEqual(L.isOut(out), true);
// changing where you are keeps the time you left
const moved = L.withLocation(out, "Client visit", at(13, 0));
assert.strictEqual(moved.location, "Client visit");
assert.strictEqual(moved.leftAt, at(12, 5));
// clearing the field = back in
const back = L.withLocation(moved, "   ", at(14, 0));
assert.strictEqual(back.location, "");
assert.strictEqual(back.leftAt, null);
assert.strictEqual(L.isOut(back), false);
assert.strictEqual(joe.location, "", "withLocation doesn't change the old object");

// ---------- time text ----------
assert.strictEqual(L.formatTime(at(14, 15)), "2:15 PM");
assert.strictEqual(L.formatTime(at(9, 5)), "9:05 AM");
assert.strictEqual(L.formatTime(at(0, 0)), "12:00 AM");
assert.strictEqual(L.formatTime(at(12, 30)), "12:30 PM");

// ---------- the 6:00 PM rule ----------
assert.strictEqual(L.expiresAt(at(9)), at(18));
assert.strictEqual(L.expiresAt(at(17, 59)), at(18));
assert.strictEqual(L.isExpired(joe, at(17, 59)), false);
assert.strictEqual(L.isExpired(joe, at(18, 0)), true, "gone at exactly 6:00 PM");
assert.strictEqual(L.isExpired(joe, at(9, 0, 1)), true, "and still gone the next morning");
// added after 6 PM: stays until midnight
const late = { id: "b", name: "Ann", addedAt: at(19), location: "", leftAt: null };
assert.strictEqual(L.expiresAt(late.addedAt), at(0, 0, 1));
assert.strictEqual(L.isExpired(late, at(23, 59)), false);
assert.strictEqual(L.isExpired(late, at(0, 0, 1)), true);
assert.strictEqual(L.isAfterEndOfDay(at(17, 59)), false);
assert.strictEqual(L.isAfterEndOfDay(at(18, 0)), true);
assert.strictEqual(L.nextSweep([joe, late], at(10)), at(18));
assert.strictEqual(L.nextSweep([], at(10)), Infinity);

// ---------- the top bar: only the people who are out ----------
const board = [
  { id: "1", name: "Joe", addedAt: at(9), location: "", leftAt: null },
  { id: "2", name: "Ann", addedAt: at(9), location: "Dentist", leftAt: at(14, 15) },
  { id: "3", name: "Bo", addedAt: at(9), location: "Lunch", leftAt: at(12, 0) },
];
const bar = L.topBarEntries(board);
assert.deepStrictEqual(bar.map((e) => e.name), ["Bo", "Ann"], "out only, first to leave first");
assert.deepStrictEqual(bar[1], { id: "2", name: "Ann", location: "Dentist", leftAt: at(14, 15), leftText: "Left 2:15 PM" });
assert.deepStrictEqual(L.topBarEntries([board[0]]), [], "empty when everyone is in");
const ten = Array.from({ length: 10 }, (_, i) => ({ id: "m" + i, name: "M" + i, addedAt: at(9), location: "Out " + i, leftAt: at(10, i) }));
assert.strictEqual(L.topBarEntries(ten).length, 10);

// ---------- what the office does (reconcile) ----------
const acts = (members, present, first) => L.reconcile(members, present, first).map((a) => a.id + ":" + a.action).sort();
// page opened: the ones who are in appear at their desks, the ones out stay out
assert.deepStrictEqual(acts(board, {}, true), ["1:appear"]);
// added later: walks in through the door
assert.deepStrictEqual(acts(board, {}, false), ["1:enter"]);
// a location typed: walks out
assert.deepStrictEqual(acts([out], { a: "in" }, false), ["a:leave"]);
assert.deepStrictEqual(acts([out], { a: "entering" }, false), ["a:leave"]);
// already walking out: nothing more to do
assert.deepStrictEqual(acts([out], { a: "leaving" }, false), []);
// gone out of the door: nothing to do while it's out
assert.deepStrictEqual(acts([out], {}, false), []);
// cleared while still walking out: turns back
assert.deepStrictEqual(acts([back], { a: "leaving" }, false), ["a:return"]);
// cleared after it left: walks back in
assert.deepStrictEqual(acts([back], {}, false), ["a:enter"]);
// nothing changes while it's in
assert.deepStrictEqual(acts([back], { a: "in" }, false), []);
// 6 PM (or removed from the board): everyone still drawn walks out for good
assert.deepStrictEqual(acts([], { a: "in", b: "leaving", c: "entering" }, false), ["a:remove", "b:remove", "c:remove"]);
assert.deepStrictEqual(acts([], { a: "removing" }, false), []);

assert.strictEqual(L.dayKey(at(9)), "2026-10-28");

// ---------- workspaces: who sits where ----------
{
  // giving out spots, and swapping when it was someone else's
  let r = L.assignSpot({}, "joe", "desk-3");
  assert.deepStrictEqual(r, { assignments: { joe: "desk-3" }, swapped: null });
  r = L.assignSpot(r.assignments, "ann", "office-A");
  r = L.assignSpot(r.assignments, "ann", "desk-3"); // (it's Joe's: they swap)
  assert.deepStrictEqual(r.assignments, { joe: "office-A", ann: "desk-3" });
  assert.strictEqual(r.swapped, "joe");
  r = L.assignSpot(r.assignments, "bo", "desk-3"); // Bo had nothing: Ann goes back to any free desk
  assert.deepStrictEqual(r.assignments, { joe: "office-A", bo: "desk-3" });
  assert.strictEqual(r.swapped, "ann");
  r = L.assignSpot(r.assignments, "bo", null);
  assert.deepStrictEqual(r.assignments, { joe: "office-A" });
  assert.strictEqual(L.ownerOf(r.assignments, "office-A"), "joe");
  assert.strictEqual(L.ownerOf(r.assignments, "desk-1"), null);
  const before = { joe: "desk-1" };
  L.assignSpot(before, "ann", "desk-1");
  assert.deepStrictEqual(before, { joe: "desk-1" }, "assignSpot doesn't change the old object");
  // a spot only ever has one owner
  let a = {};
  for (const [who, spot] of [["a", "desk-1"], ["b", "desk-1"], ["c", "desk-2"], ["a", "desk-2"], ["c", "office-B"], ["b", "office-B"]]) {
    a = L.assignSpot(a, who, spot).assignments;
    const spots = Object.values(a);
    assert.strictEqual(new Set(spots).size, spots.length, "no two Miis on one spot");
  }

  // picking a desk
  const desks = [{ id: "desk-1" }, { id: "desk-2" }, { id: "desk-3" }, { id: "office-A", private: true }];
  const pick = (id, assignments, taken, onBoard, prefer) => L.pickDesk({ id, desks, assignments, taken, onBoard, prefer });
  assert.strictEqual(pick("joe", { joe: "office-A" }, {}, ["joe"]), "office-A", "your own spot");
  assert.strictEqual(pick("joe", { joe: "desk-2" }, {}, ["joe"]), "desk-2");
  assert.strictEqual(pick("joe", { joe: "gone-desk" }, {}, ["joe"]), "desk-1", "a spot that isn't in this office: any free desk");
  assert.strictEqual(pick("ann", { joe: "desk-1" }, {}, ["joe", "ann"]), "desk-2", "never someone else's desk");
  assert.strictEqual(pick("ann", {}, { "desk-1": "bo" }, ["ann", "bo"]), "desk-2", "not a desk someone is using");
  assert.strictEqual(pick("ann", {}, {}, ["ann"], 2), "desk-3", "the preferred desk when it's free");
  assert.strictEqual(pick("ann", { joe: "desk-3" }, {}, ["ann", "joe"], 2), "desk-1", "...but not when it's someone's");
  assert.strictEqual(pick("ann", {}, { "desk-1": "x", "desk-2": "y", "desk-3": "z" }, []), null, "private offices are never used by others");
  // all the free desks belong to someone: one whose owner isn't here today
  assert.strictEqual(pick("ann", { joe: "desk-1", bo: "desk-2", cy: "desk-3" }, {}, ["ann", "joe", "cy"]), "desk-2");
  assert.strictEqual(pick("ann", { joe: "desk-1", bo: "desk-2", cy: "desk-3" }, {}, ["ann", "joe", "bo", "cy"]), null);
  // ten Miis, five desks with owners: everyone different, owners on their own desks
  const many = Array.from({ length: 12 }, (_, i) => ({ id: "desk-" + i }));
  const own = { m0: "desk-5", m1: "desk-0", m2: "desk-11" };
  const taken = {};
  for (let i = 0; i < 10; i++) {
    const id = "m" + i, d = L.pickDesk({ id, desks: many, assignments: own, taken, onBoard: Object.keys(own), prefer: i });
    assert.ok(d && !taken[d], id + " gets a desk nobody else has");
    if (own[id]) assert.strictEqual(d, own[id]);
    else assert.ok(!Object.values(own).includes(d), id + " doesn't take an owned desk");
    taken[d] = id;
  }
}

console.log("All logic tests passed.");
