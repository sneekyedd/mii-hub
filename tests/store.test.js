// Run with: node tests/store.test.js
// The store (all shared state): saved Miis, the board, locations, events, the
// 6:00 PM rule when the page is open and when it's opened again later, and two tabs.
const assert = require("assert");
const S = require("../js/nscc/store.js");

const at = (h, m, dayOffset) => new Date(2026, 9, 28 + (dayOffset || 0), h, m || 0, 0, 0).getTime();

// two "tabs" on one computer: they share storage, and a channel between them
function fakeChannelPair() {
  const a = { onMessage: null }, b = { onMessage: null };
  a.post = (m) => setTimeout(() => b.onMessage && b.onMessage(m), 0);
  b.post = (m) => setTimeout(() => a.onMessage && a.onMessage(m), 0);
  return [a, b];
}

(async () => {
  let now = at(9, 0);
  const clock = () => now;
  const kv = S.memoryKV(), db = S.memoryDB();
  const store = S.createStore({ kv, db, channel: null, now: clock });
  await store.ready;
  const events = [];
  const off = store.on((e) => events.push(e.type));

  // ---------- saved Miis ----------
  assert.deepStrictEqual(await store.listSaved(), []);
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const joe = await store.saveMii({ name: "Joe", fileName: "Joe.glb", bytes });
  const ann = await store.saveMii({ name: "Ann", fileName: "Ann.glb", bytes });
  assert.ok(joe.id && ann.id && joe.id !== ann.id);
  assert.deepStrictEqual((await store.listSaved()).map((r) => r.name), ["Joe", "Ann"]);
  assert.ok(events.includes("saved"));
  // same id = a new look for the same Mii (not a second one)
  await store.saveMii({ id: joe.id, name: "Joe", fileName: "Joe2.glb", bytes });
  assert.strictEqual((await store.listSaved()).length, 2);
  assert.strictEqual((await store.listSaved()).find((r) => r.id === joe.id).fileName, "Joe2.glb");

  // ---------- the board ----------
  assert.deepStrictEqual(await store.getBoard(), []);
  events.length = 0;
  await store.addToBoard(joe.id);
  await store.addToBoard(ann.id);
  await store.addToBoard(ann.id); // (twice = still once)
  let board = await store.getBoard();
  assert.deepStrictEqual(board.map((m) => [m.name, m.location, m.leftAt]), [["Joe", "", null], ["Ann", "", null]]);
  assert.ok(events.includes("board"));
  await assert.rejects(store.addToBoard("nobody"));
  // can't forget a saved Mii that's on the board
  await assert.rejects(store.deleteSaved(joe.id));

  // ---------- location: out, then back ----------
  now = at(14, 15);
  await store.setLocation(ann.id, "  Dentist ");
  board = await store.getBoard();
  const a1 = board.find((m) => m.id === ann.id);
  assert.strictEqual(a1.location, "Dentist");
  assert.strictEqual(a1.leftAt, at(14, 15));
  now = at(15, 0);
  await store.setLocation(ann.id, "");
  const a2 = (await store.getBoard()).find((m) => m.id === ann.id);
  assert.strictEqual(a2.location, "");
  assert.strictEqual(a2.leftAt, null);
  await store.setLocation(ann.id, "Lunch");
  assert.strictEqual(await store.setLocation("nobody", "x"), null);

  // ---------- reloading the page during the day: everything is still there ----------
  now = at(16, 0);
  const reopened = S.createStore({ kv, db, channel: null, now: clock });
  await reopened.ready;
  board = await reopened.getBoard();
  assert.deepStrictEqual(board.map((m) => [m.name, m.location]), [["Joe", ""], ["Ann", "Lunch"]]);
  assert.strictEqual((await reopened.listSaved()).length, 2);

  // ---------- 6:00 PM with the page open ----------
  now = at(17, 59, 0);
  assert.deepStrictEqual(await store.sweep(), []);
  assert.strictEqual((await store.getBoard()).length, 2);
  now = at(18, 0);
  // (even before the sweep runs, nobody is on the board any more)
  assert.deepStrictEqual(await store.getBoard(), []);
  events.length = 0;
  const gone = await store.sweep();
  assert.deepStrictEqual(gone.sort(), [joe.id, ann.id].sort());
  assert.deepStrictEqual(events, ["board"]);
  assert.strictEqual((await store.listSaved()).length, 2, "saved Miis stay saved for tomorrow");
  await store.deleteSaved(ann.id); // (now it can be forgotten)
  assert.deepStrictEqual((await store.listSaved()).map((r) => r.name), ["Joe"]);

  // ---------- opening the page after 6 PM / the next day: an empty office ----------
  const kv2 = S.memoryKV(), db2 = S.memoryDB();
  now = at(10, 0);
  const day = S.createStore({ kv: kv2, db: db2, channel: null, now: clock });
  await day.ready;
  const bo = await day.saveMii({ name: "Bo", bytes });
  await day.addToBoard(bo.id);
  await day.setLocation(bo.id, "Meeting");
  now = at(19, 30); // the page was closed all evening
  const evening = S.createStore({ kv: kv2, db: db2, channel: null, now: clock });
  await evening.ready;
  assert.deepStrictEqual(await evening.getBoard(), [], "after 6 PM the office starts empty");
  now = at(8, 30, 1); // next morning
  const morning = S.createStore({ kv: kv2, db: db2, channel: null, now: clock });
  await morning.ready;
  assert.deepStrictEqual(await morning.getBoard(), []);
  assert.deepStrictEqual((await morning.listSaved()).map((r) => r.name), ["Bo"], "and can be re-added from the saved Miis");
  await morning.addToBoard(bo.id);
  assert.strictEqual((await morning.getBoard())[0].location, "", "a new day starts in the office");
  // added after 6 PM: stays until midnight
  now = at(19, 0, 1);
  await morning.sweep();
  await morning.addToBoard(bo.id);
  now = at(23, 0, 1);
  assert.strictEqual((await morning.getBoard()).length, 1);
  now = at(0, 1, 2);
  assert.strictEqual((await morning.getBoard()).length, 0);

  // ---------- two tabs stay in sync ----------
  now = at(9, 0, 3);
  const kv3 = S.memoryKV(), db3 = S.memoryDB();
  const [c1, c2] = fakeChannelPair();
  const tab1 = S.createStore({ kv: kv3, db: db3, channel: c1, now: clock });
  const tab2 = S.createStore({ kv: kv3, db: db3, channel: c2, now: clock });
  await Promise.all([tab1.ready, tab2.ready]);
  const seen = [];
  tab2.on((e) => seen.push(e.type));
  const cy = await tab1.saveMii({ name: "Cy", bytes });
  await tab1.addToBoard(cy.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(seen.includes("saved") && seen.includes("board"));
  assert.deepStrictEqual((await tab2.listSaved()).map((r) => r.name), ["Cy"]);
  await tab2.setLocation(cy.id, "Gym");
  assert.strictEqual((await tab1.getBoard())[0].location, "Gym");

  // ---------- workspaces (who sits where): saved, swapped, kept from day to day, in sync ----------
  {
    now = at(9, 0, 5);
    const kv4 = S.memoryKV(), db4 = S.memoryDB();
    const [d1, d2] = fakeChannelPair();
    const s1 = S.createStore({ kv: kv4, db: db4, channel: d1, now: clock });
    const s2 = S.createStore({ kv: kv4, db: db4, channel: d2, now: clock });
    await Promise.all([s1.ready, s2.ready]);
    const seen2 = [], seen1 = [];
    s1.on((e) => seen1.push(e.type));
    s2.on((e) => seen2.push(e.type));
    assert.deepStrictEqual(await s1.getAssignments(), {});
    const x = await s1.saveMii({ name: "X", bytes }), y = await s1.saveMii({ name: "Y", bytes });
    let r = await s1.assignSpot(x.id, "desk-4");
    assert.deepStrictEqual(r.assignments, { [x.id]: "desk-4" });
    assert.ok(seen1.includes("assign"), "a change event");
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(seen2.includes("assign"), "the other tab hears about it");
    assert.deepStrictEqual(await s2.getAssignments(), { [x.id]: "desk-4" });
    // taking someone's spot swaps
    await s2.assignSpot(y.id, "office-B");
    r = await s2.assignSpot(y.id, "desk-4");
    assert.strictEqual(r.swapped, x.id);
    assert.deepStrictEqual(await s1.getAssignments(), { [x.id]: "office-B", [y.id]: "desk-4" });
    // nothing changes = no event
    seen1.length = 0;
    await s1.assignSpot(y.id, "desk-4");
    assert.deepStrictEqual(seen1, []);
    // it stays after 6 PM and the next day (it isn't part of the daily board)
    now = at(8, 0, 6);
    const next = S.createStore({ kv: kv4, db: db4, channel: null, now: clock });
    await next.ready;
    assert.deepStrictEqual(await next.getAssignments(), { [x.id]: "office-B", [y.id]: "desk-4" });
    // back to "any free desk"
    await next.assignSpot(x.id, null);
    assert.deepStrictEqual(await next.getAssignments(), { [y.id]: "desk-4" });
    // forgetting a saved Mii frees its desk
    await next.deleteSaved(y.id);
    assert.deepStrictEqual(await next.getAssignments(), {});
    await assert.rejects(next.assignSpot("", "desk-1"));
    // a broken saved value doesn't break anything
    kv4.set(S.ASSIGN_KEY, "{not json");
    assert.deepStrictEqual(await next.getAssignments(), {});
  }

  off();
  console.log("All store tests passed.");
})().catch((e) => { console.error(e); process.exit(1); });
