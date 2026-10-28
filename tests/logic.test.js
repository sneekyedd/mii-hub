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

console.log("All logic tests passed.");
