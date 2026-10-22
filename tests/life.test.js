// Checks outfits, jobs, vacations, rooms, band wishes and favorite hints (no 3D needed).
// Run with: node tests/life.test.js
"use strict";
const assert = require("assert");
global.self = global;
require("../js/homes.js");
require("../js/dialogue.js");
require("../js/minigames.js");
require("../js/town.js");
require("../js/life.js");
require("../js/progress.js");
require("../js/bandMusic.js");
const D = global.Dialogue, H = global.MiiHomes, L = global.MiiLife, P = global.MiiProgress, B = global.MiiBand, T = global.MiiTown;

// ---------- rooms ----------
const r0 = { id: "room-test" };
H.ensureHome(r0);
assert.deepStrictEqual(r0.home.rooms, [], "old saves get an empty room list");
assert(!H.slotsFor(r0).some((s) => s.id === "stove"), "no kitchen slots before buying a kitchen");
assert(H.addRoom(r0, "kitchen"), "buying a kitchen");
assert(!H.addRoom(r0, "kitchen"), "can't buy the same room twice");
assert(H.slotsFor(r0).some((s) => s.id === "stove"), "a kitchen unlocks the stove category");
assert.strictEqual(r0.home.items.stove, "stove-basic", "a new room comes with its starter furniture");
assert(r0.home.owned.includes("counter-basic"));
for (const room of H.ROOMS) {
  const slots = H.slotsOfRoom(room.id);
  assert.strictEqual(slots.length, room.slots.length, room.id + " slots");
  for (const s of slots) {
    assert.strictEqual(H.roomOf(s.id), room.id);
    assert(H.itemsFor(s.id).some((it) => it.starter), s.id + " has a starter item");
    assert(H.favoriteItem(r0, s.id), s.id + " has a favorite");
  }
}
assert.strictEqual(H.roomOf("bed"), "main");
// favorite hints: a favorite it doesn't own yet
const favs = H.unownedFavorites(r0);
assert(favs.length >= 9 && favs.every((it) => !r0.home.owned.includes(it.id)), "unowned favorites");
const hint = D.buildInteraction({ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "park", lines: [] }, 5, { ctx: { favWant: { name: "Pool table", icon: "🎱" } } });
assert(hint.steps.length > 0);
let saw = false;
for (let i = 0; i < 300 && !saw; i++) {
  const p = D.buildInteraction({ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "park", lines: [] }, 5, { ctx: { favWant: { name: "Pool table", icon: "🎱" } } });
  if (p.type === "hint") { saw = true; assert(/I wish I had a pool table|pool table|Pool table/i.test(p.steps.map((s) => s.say).join(" "))); assert(/pool table/.test(p.feed)); }
}
assert(saw, "Miis sometimes hint at their favorite furniture");

// ---------- outfits ----------
const r1 = { id: "fit" };
L.ensureWardrobe(r1);
assert.strictEqual(L.wardrobeLevel(r1), 0);
r1.wardrobe.owned = L.OUTFITS.slice(0, 4).map((o) => o.id);
assert.strictEqual(L.wardrobeLevel(r1), 2, "the wardrobe grows with more outfits");
r1.wardrobe.owned = L.OUTFITS.map((o) => o.id);
assert.strictEqual(L.wardrobeLevel(r1), L.WARDROBE_STEPS.length - 1);
r1.wardrobe.wearing = "nope";
L.ensureWardrobe(r1);
assert.strictEqual(r1.wardrobe.wearing, null, "an unknown outfit is taken off");

// ---------- jobs ----------
for (const j of L.JOBS) assert(T.PLACES.some((p) => p.id === j.place), j.id + " works somewhere real");
assert.strictEqual(L.jobPay("helpdesk", 1), 14);
assert(L.jobPay("astronaut", 10) > L.jobPay("astronaut", 1), "higher-level Miis earn more");
assert.strictEqual(L.jobPay("nope", 3), 0);
assert.strictEqual(L.pickJob({ energy: 50 }, "same"), L.pickJob({ energy: 50 }, "same"), "the same Mii always gets the same job");
const jobs = new Set();
for (let i = 0; i < 200; i++) jobs.add(L.pickJob({ energy: i % 100, social: (i * 7) % 100, humor: (i * 13) % 100, kindness: (i * 3) % 100, chatty: 50 }, "m" + i));
assert.strictEqual(jobs.size, L.JOBS.length, "every job gets picked by someone");

// shifts in town: go to work, wear the uniform, get paid
{
  const records = new Map();
  const rec = { id: "w1", name: "Wes", place: "park", level: 1, coins: 0, personality: D.DEFAULT_PERSONALITY, job: "lifeguard" };
  H.ensureHome(rec);
  records.set(rec.id, rec);
  const hub = { walkers: [], setBattery() {}, batteryOf: () => 1, isBusy: () => false, chattiness: 1, friendships: {}, offscreenHangout() {} };
  let paid = null;
  const town = T.create({ hub, records, D, templateFor: async () => ({}), lookFor: () => ({}), save() {}, changed() {}, onShift: (r, j, pay) => { paid = pay; } });
  assert(town.startShift(rec, "lifeguard", 30));
  assert(!town.workingAs(rec), "not at work yet (on the way)");
  for (let i = 0; i < 40; i++) town.tick(0.5);
  assert.strictEqual(rec.place, "beach");
  assert.strictEqual(town.workingAs(rec), "lifeguard", "at work: wears the uniform");
  for (let i = 0; i < 80; i++) town.tick(0.5);
  assert.strictEqual(paid, L.jobPay("lifeguard", 1), "paid at the end of the shift");
  assert.strictEqual(rec.coins, paid);
  assert(!town.workingAs(rec));
  // sent somewhere else mid-shift: no pay
  town.startShift(rec, "lifeguard", 30);
  town.sendTo(rec, "park");
  assert(!town.info(rec).shift, "sending a Mii away ends its shift");
}

// ---------- vacations ----------
{
  let now = 1000000;
  const records = new Map();
  for (let i = 0; i < 6; i++) { const r = { id: "v" + i, name: "V" + i, level: 2, coins: 0, place: "park", personality: D.DEFAULT_PERSONALITY }; H.ensureHome(r); records.set(r.id, r); }
  const left = [], back = [];
  const life = L.create({ records, H, D, now: () => now, saveMii() {}, leave: (r) => { left.push(r.id); r.place = "away"; }, comeBack: (r, g) => back.push([r.id, g]) });
  assert.strictEqual(life.maxAway(), 1);
  const v = records.get("v0");
  const ownedBefore = v.home.owned.length;
  assert(life.start(v, "tokyo", 30 * L.MINUTE));
  assert(!life.start(v, "tokyo"), "already away");
  assert.strictEqual(v.vacation.dest, "tokyo");
  assert(/back in 30 min/.test(L.backIn(v, now)));
  life.tick(1);
  assert.strictEqual(back.length, 0, "not back yet");
  now += 31 * L.MINUTE; // (real time: works across saves)
  life.tick(1);
  assert.strictEqual(back.length, 1, "back after the vacation time");
  const g = back[0][1];
  assert(g.coins >= 45 + 12, "brings lots of coins");
  assert.strictEqual(v.coins, g.coins);
  assert(g.souvenirs.length >= 2 && g.souvenirs.every((id) => v.home.owned.includes(id)), "souvenirs are added to its home");
  assert.strictEqual(v.home.owned.length, ownedBefore + g.souvenirs.length);
  assert(g.souvenirs.every((id) => H.item(id)), "souvenirs are real furniture");
  for (const d of L.DESTINATIONS) for (const id of d.souvenirs) assert(H.item(id), d.id + " souvenir " + id);
  assert.strictEqual(v.vacation, null);
  // never more than a few away at once
  now += 1;
  for (let i = 0; i < 2000; i++) life.tick(30);
  assert(Array.from(records.values()).filter((r) => r.vacation).length <= life.maxAway());
}

// ---------- bands ----------
{
  const records = new Map();
  for (const [i, name] of ["Mia", "Leo", "Ava", "Sam", "Kai", "Zoe"].entries()) {
    const r = { id: "b" + i, name, place: "park", personality: Object.assign({}, D.DEFAULT_PERSONALITY, { energy: 80, humor: 80, social: 80 }) };
    H.ensureHome(r);
    records.set(r.id, r);
  }
  const hub = { friendships: {} };
  const prog = P.create({ records, D, H, hub, saveState() {}, saveMii() {}, town: () => ({ sendTo() {} }), meetUp() {}, offscreen: () => true });
  const toasts = [];
  prog.on("toast", (t) => toasts.push(t));
  for (const r of records.values()) prog.ensure(r);
  const mia = records.get("b0");
  assert(!prog.canStartBand(mia), "needs a song first");
  // levelling up teaches a song
  prog.addHappy(mia, prog.happyNeeded(mia));
  assert.strictEqual(mia.songs.length, 1, "Miis learn a song when they level up");
  assert(toasts.some((t) => /learned a new song/.test(t)));
  for (const s of prog.SONGS) { const d = B.duration(s.id); assert(d >= 30 && d <= 60, s.id + " lasts 30 s - 1 min: " + d); }
  assert(prog.canStartBand(mia));
  mia.wish = Object.assign({ type: "band", icon: "🎸", left: 480 }, { text: "band!", song: mia.songs[0] });
  assert(prog.wishActions(mia).some((a) => a.id === "band"));
  prog.startBand(mia);
  assert.strictEqual(mia.band.status, "recruiting");
  assert.strictEqual(mia.wish, null);
  // it asks the others when they hang out
  const leo = records.get("b1");
  const ctx = prog.context(mia, leo);
  assert(ctx.bandAsk, "the leader asks Miis it hasn't asked yet");
  const plan = D.buildInteraction(mia, leo, { id: "park", lines: [] }, 3, { ctx: Object.assign(ctx, { bandAsk: { song: "x", accept: true } }) });
  assert.strictEqual(plan.type, "bandInvite");
  assert.strictEqual(plan.success, true);
  prog.event({ type: "hangout", a: mia.id, b: leo.id, kind: "bandInvite", success: false, before: 0, after: 1 });
  assert.strictEqual(mia.band.members.length, 0, "a no is a no");
  assert(!prog.context(mia, leo).bandAsk, "doesn't ask the same Mii twice in a row");
  for (const id of ["b2", "b3", "b4"]) prog.event({ type: "hangout", a: mia.id, b: id, kind: "bandInvite", success: true, before: 0, after: 1 });
  assert.strictEqual(mia.band.status, "recruiting", "needs 4 members");
  assert(!prog.canStartBand(records.get("b2")), "one band at a time");
  prog.event({ type: "hangout", a: mia.id, b: "b5", kind: "bandInvite", success: true, before: 0, after: 1 });
  assert.strictEqual(mia.band.status, "ready", "4 yeses: the band is ready");
  assert.strictEqual(mia.wish && mia.wish.type, "show", "then it wishes for you to come to the show");
  assert(prog.wishActions(mia).some((a) => a.id === "show"));
  const before = { mia: mia.coins, ava: records.get("b2").coins, xp: prog.state.xp + prog.state.level * 10000 };
  prog.finishShow(mia);
  assert.strictEqual(mia.band, null);
  assert.strictEqual(mia.wish, null, "the show wish is granted");
  assert(mia.coins > before.mia && records.get("b2").coins >= before.ava + 15, "the band gets coins");
  assert(records.get("b2").songs.includes(mia.songs[0]) || records.get("b2").songs.length > 0, "members learn the song");
  assert.strictEqual(prog.state.seen.shows, 1);
  // Miis away on vacation make no wishes
  const zoe = records.get("b5");
  zoe.place = "away"; zoe.wish = { type: "hungry", left: 100 };
  prog.tick(1);
  assert.strictEqual(zoe.wish, null, "no wishes on vacation");
}

console.log("All life tests passed. Outfits: " + L.OUTFITS.length + ", jobs: " + L.JOBS.length + ", rooms: " + H.ROOMS.length + ", songs: " + Object.keys(B.SONGS).map((k) => Math.round(B.duration(k)) + "s").join(" "));
