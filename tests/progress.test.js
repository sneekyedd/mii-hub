// Checks wishes, levels, town level, daily goals and stickers (no 3D needed).
// Run with: node tests/progress.test.js
"use strict";
const assert = require("assert");
global.self = global;
require("../js/homes.js");
require("../js/dialogue.js");
require("../js/minigames.js");
require("../js/town.js");
require("../js/progress.js");
const D = global.Dialogue, H = global.MiiHomes, P = global.MiiProgress;

const records = new Map();
for (const [i, name] of ["Mia", "Leo", "Ava", "Sam"].entries()) {
  const r = { id: "m" + i, name, place: "park", personality: { energy: 50, social: 50, chatty: 50, humor: 50, kindness: 50 } };
  H.ensureHome(r);
  records.set(r.id, r);
}
const hub = { friendships: {} };
const events = { levelup: [], townlevel: [], toast: [] };
let saved = null;
const prog = P.create({
  records, D, H, hub, saveState: (s) => { saved = s; }, saveMii: () => {},
  town: () => ({ sendTo: () => {} }), meetUp: () => {}, offscreen: () => true,
});
for (const k of Object.keys(events)) prog.on(k, (...a) => events[k].push(a));
for (const r of records.values()) prog.ensure(r);

// wishes appear over time (not too many at once)
// (count every wish made, not just the ones still waiting at the end: wishes also expire)
const madeWishes = new Set();
prog.on("event", (e) => { if (e && e.type === "newWish") madeWishes.add(e.rec.id); });
let most = 0;
for (let i = 0; i < 600; i++) { prog.tick(1); most = Math.max(most, Array.from(records.values()).filter((r) => r.wish).length); }
const wishing = Array.from(records.values()).filter((r) => r.wish);
assert(madeWishes.size >= 1, "a few Miis should have wished for something after a while: " + madeWishes.size);
assert(most <= 4, "not too many wishes at once: " + most);

// granting a food wish: coins, happiness, town XP
const mia = records.get("m0");
mia.wish = { type: "hungry", icon: "🍙", text: "I'm starving!", left: 480 };
const coins = mia.coins, xp = prog.state.xp + prog.state.level * 1000;
prog.event({ type: "food", id: "m0", food: H.FOODS[0], opinion: "like" });
assert.strictEqual(mia.wish, null, "the food wish is granted");
assert(mia.coins > coins, "granting a wish gives the Mii coins");
assert(prog.state.xp + prog.state.level * 1000 > xp, "granting a wish gives town XP");

// a wrong action doesn't grant a wish
mia.wish = { type: "game", game: "ttt", icon: "⭕", text: "Play!", left: 480 };
prog.event({ type: "game", id: "m0", game: "rps", result: "you" });
assert(mia.wish, "playing a different game doesn't count");
prog.event({ type: "game", id: "m0", game: "ttt", result: "mii" });
assert.strictEqual(mia.wish, null, "playing the right game does");

// enough happiness = level up with 3 gift choices; gifts apply
prog.addHappy(mia, 20);
assert(mia.level > 1, "the Mii levelled up");
const [rec, choices] = events.levelup[0];
assert.strictEqual(rec, mia);
assert.strictEqual(choices.length, 3);
const move = choices.find((c) => c.kind === "move");
if (move) { prog.applyGift(mia, move); assert(mia.moves.includes(move.id)); }

// town level goes up with XP and unlocks things
for (let i = 0; i < 40; i++) { mia.wish = { type: "visit", icon: "🏠", text: "", left: 480 }; prog.event({ type: "visit", id: "m0" }); }
assert(prog.state.level >= 3, "the town grows when you grant wishes");
assert(events.townlevel.length >= 2);
assert(prog.unlocked("romance"), "romance unlocks at town level 3");

// daily goals: three of them, they count up and can be claimed
prog.rollDaily();
assert.strictEqual(prog.state.daily.goals.length, 3);

// fights and making up
const leo = records.get("m1");
prog.event({ type: "hangout", a: "m0", b: "m1", kind: "disagree", before: 2, after: 3, fight: true });
assert(prog.pair("m0", "m1").fight, "an argument can turn into a fight");
prog.event({ type: "hangout", a: "m0", b: "m1", kind: "makeUp", before: 3, after: 6 });
assert(!prog.pair("m0", "m1").fight, "making up ends the fight");

// confessions: success makes a couple
hub.friendships["m0|m1"] = 12;
mia.wish = { type: "crush", target: "m1", icon: "💗", text: "", left: 480 };
prog.startConfession(mia);
assert(prog.pair("m0", "m1").confess, "a confession is planned");
prog.event({ type: "hangout", a: "m0", b: "m1", kind: "confess", before: 12, after: 15, success: true });
assert.strictEqual(prog.partnerOf(mia), leo, "they're a couple now");
assert(prog.context(mia, leo).couple);

// the shop: a daily stock, deals cost less, high tiers locked at the start
const deals = prog.deals();
assert(deals.length === 2);
const dealItem = H.item(deals[0]);
assert(prog.priceOf(dealItem) < dealItem.price);
assert(prog.shopFoods().length > 0);

// weather and stickers
assert(prog.weather().season);
assert(prog.weatherText().length > 0);
const pages = prog.stickerPages();
assert(pages.length >= 6 && pages.every((p) => p.stickers.length > 0));
assert(Object.keys(prog.state.stickers).length > 0, "some stickers are earned by now");
// furniture wishes only ask for things the Mii can actually get: never for a slot
// where it already owns everything that's for sale
{
  const sam = records.get("m3");
  sam.wish = null;
  const all = H.ITEMS.filter((it) => !it.starter).map((it) => it.id);
  sam.home.owned = Array.from(new Set(sam.home.owned.concat(all)));
  for (const s of H.SLOTS) assert.strictEqual(prog.newFor(sam, s.id).length, 0, "nothing new left for " + s.id);
  for (let i = 0; i < 400; i++) {
    const w = prog.makeWish(sam);
    assert(!w || (w.type !== "furniture" && w.type !== "style"), "impossible furniture wish: " + (w && w.text));
  }
  // one thing left to buy (and in the shop today): furniture wishes are only for that kind of thing
  // (which kinds are in stock changes every day, so pick one that is today)
  const slot = H.SLOTS.map((s) => s.id).find((id) => !["wallpaper", "floor"].includes(id) && prog.shopItems(id).some((it) => !it.starter));
  const plant = slot && prog.shopItems(slot).find((it) => !it.starter);
  assert(plant, "something is for sale today");
  sam.home.owned = sam.home.owned.filter((id) => id !== plant.id);
  let furn = 0;
  for (let i = 0; i < 600; i++) {
    const w = prog.makeWish(sam);
    if (w && w.type === "furniture") { furn++; assert.strictEqual(w.slot, slot, "only that slot has something new"); }
    assert(!w || w.type !== "style", "walls and floor are all owned");
  }
  assert(furn > 0, "a furniture wish can still happen when there's something new");
  // ...and the wish goes away by itself if the Mii gets the last one some other way
  sam.wish = { type: "furniture", slot, icon: "🪴", text: "I want something new!", left: 480 };
  sam.home.owned.push(plant.id);
  prog.tick(0.1);
  assert(!sam.wish || sam.wish.type !== "furniture", "an impossible furniture wish is dropped");
  // a Mii that owns only starter things can wish for anything that's for sale
  const fresh = { id: "m9", name: "Kai", place: "park", personality: { energy: 50, social: 50, chatty: 50, humor: 50, kindness: 50 } };
  H.ensureHome(fresh);
  assert(H.SLOTS.every((s) => prog.newFor(fresh, s.id).every((it) => !fresh.home.owned.includes(it.id))));
}
// rare events: each one has its own hidden sticker (the page is "???" until you've seen one)
{
  const ids = prog.HIDDEN_EVENTS.map((e) => e.id);
  for (const id of ["mustang", "ufo", "crabs", "boo", "ducks", "printer", "koi", "plane", "cat"]) assert(ids.includes(id), "hidden event " + id);
  assert.strictEqual(new Set(ids).size, ids.length, "hidden event ids are unique");
  assert(prog.HIDDEN_EVENTS.every((e) => e.icon && e.name && e.desc && e.hint), "every hidden event has an icon, name, description and hint");
  const hiddenPage = () => prog.stickerPages().find((p) => p.hidden);
  const before = hiddenPage().stickers.filter((s) => s.got).length;
  let got = [];
  prog.on("sticker", (s) => got.push(s.id));
  prog.hiddenEvent("not-a-real-event");
  assert.strictEqual(got.length, 0, "unknown rare events give nothing");
  prog.hiddenEvent("crabs");
  prog.hiddenEvent("crabs"); // (seeing it again gives nothing new)
  assert.deepStrictEqual(got, ["h-crabs"], "the crab dance gives its sticker once");
  for (const id of ["boo", "ducks", "printer", "koi", "plane", "cat"]) prog.hiddenEvent(id);
  assert.strictEqual(hiddenPage().stickers.filter((s) => s.got).length, before + 7, "all the new rare events give stickers");
  assert.strictEqual(hiddenPage().name, "Hidden Events");
}

// the crabs' song: 30 full bars (60 seconds at 120 bpm), every bar of the tune adds up
{
  require("../js/crabSong.js");
  const S = global.MiiCrabSong;
  // the real song is a file next to the game (the made-up one is only a fallback)
  if (S.SONG_URL) assert(require("fs").existsSync(require("path").join(__dirname, "..", S.SONG_URL)), "the crab song file is there: " + S.SONG_URL);
  assert.strictEqual(S.duration(), 60);
  const { TUNE, CHORDS, BARS } = S._score;
  assert.strictEqual(CHORDS.length, BARS);
  assert.strictEqual(TUNE.length, BARS);
  TUNE.forEach((bar, i) => { if (bar) assert.strictEqual(bar.reduce((n, [, len]) => n + len, 0), 8, "bar " + (i + 1) + " is 8 eighths long"); });
}

assert(saved, "progress is saved");
console.log("All progress tests passed. Town level " + prog.state.level + ", " + Object.keys(prog.state.stickers).length + " stickers, " + wishing.length + " wishes after 600 s.");
