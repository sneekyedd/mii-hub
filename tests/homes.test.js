// Checks the furniture shop data, Mii tastes, and long-distance conversations.
// Run with: node tests/homes.test.js
"use strict";
const assert = require("assert");
global.self = global;
require("../js/homes.js");
require("../js/dialogue.js");
const H = global.MiiHomes;
const D = global.Dialogue;

// every slot has a free starter item, and every item is in a real slot
const slots = new Set(H.SLOTS.map((s) => s.id));
for (const it of H.ITEMS) assert(slots.has(it.slot), it.id + " has an unknown slot");
for (const s of H.SLOTS) assert(H.ITEMS.some((i) => i.slot === s.id && i.starter && i.price === 0), s.id + " has no free starter item");
const ids = H.ITEMS.concat(H.FOODS).map((i) => i.id);
assert.strictEqual(new Set(ids).size, ids.length, "item ids must be unique");

// a new Mii gets a home, pocket money and tastes; old saves are filled in
const rec = { id: "mii-test-1", name: "Test" };
H.ensureHome(rec);
assert.strictEqual(rec.coins, 10);
assert(rec.home.items.bed && rec.home.owned.includes(rec.home.items.bed));
assert(rec.tastes.favorite !== rec.tastes.hate, "favorite and hated food must differ");
const again = H.ensureHome({ id: "mii-test-1" });
assert.deepStrictEqual(again.tastes, rec.tastes, "tastes must stay the same for the same Mii");

// personalities have different tastes
const energetic = { energy: 95, social: 60, chatty: 50, humor: 50, kindness: 50 };
const calm = { energy: 5, social: 40, chatty: 50, humor: 50, kindness: 50 };
const treadmill = H.item("tv-treadmill"), sofa = H.item("sofa-comfy");
assert.strictEqual(H.opinion(energetic, null, treadmill), "love");
assert.strictEqual(H.opinion(calm, null, treadmill), "dislike");
assert(["love", "like"].includes(H.opinion(calm, null, sofa)));
assert.strictEqual(H.opinion(calm, rec, H.item(rec.tastes.favorite)), "love");
assert.strictEqual(H.opinion(calm, rec, H.item(rec.tastes.hate)), "dislike");

// far-away conversations: only talking, and they end with a goodbye
const A = { personality: energetic, facts: {} }, B = { personality: calm, facts: { top: "red", garment: "hoodie" } };
for (let i = 0; i < 200; i++) {
  for (const mode of ["shout", "phone"]) {
    const plan = D.buildInteraction(A, B, { id: "park" }, 1 + (i % 20), { remote: mode });
    assert(["chat", "joke", "compliment", "disagree"].includes(plan.type), "remote " + plan.type);
    assert(!plan.steps.some((s) => s.arms === "up" || s.dance || s.moonJump), "no high fives or dancing from far away");
    assert(!plan.steps.some((s) => /hoodie|red/.test(s.say || "")), "can't see clothes from far away");
  }
}
// compliments never mention things that aren't known to be true
for (let i = 0; i < 300; i++) {
  const plan = D.buildInteraction(A, { personality: calm, facts: {} }, { id: "park" }, 5);
  for (const s of plan.steps) assert(!/beard|top|hair|tall/i.test(s.say || "") || !/love your|suits you|hair looks|so tall/i.test(s.say || ""), "made-up compliment: " + s.say);
}
// every piece of furniture has a 3D model, and every wallpaper / floor pattern is drawn
// (homes3d.js needs a browser, so this reads its source)
{
  const src = require("fs").readFileSync(require("path").join(__dirname, "../js/homes3d.js"), "utf8");
  const furn = src.slice(src.indexOf("const FURNITURE = {"), src.indexOf("// A computer screen full of code"));
  for (const it of H.ITEMS) {
    if (it.slot === "wallpaper" || it.slot === "floor") {
      const pat = it.pattern || "plain";
      assert(pat === "plain" || src.includes('pat === "' + pat + '"'), it.id + ": pattern " + pat + " is not drawn");
      assert(/^#[0-9a-f]{6}$/i.test(it.color) && /^#[0-9a-f]{6}$/i.test(it.accent), it.id + " needs a color and an accent");
    } else {
      assert(furn.includes('"' + it.id + '": {'), it.id + " has no 3D model");
    }
    assert(it.starter ? it.price === 0 : it.price > 0, it.id + " price");
    assert(Array.isArray(it.tags) && (it.starter || it.tags.length), it.id + " needs tags");
    if (it.use) assert(it.use.activity && it.use.emoji && it.use.lines.length >= 2, it.id + " use needs an activity, emoji and lines");
  }
  // there's plenty to choose from in every slot
  for (const s of H.SLOTS) assert(H.ITEMS.filter((i) => i.slot === s.id && !i.starter).length >= 4, s.id + " needs more things to buy");
}
console.log("All home and conversation tests passed. Items: " + H.ITEMS.length + ", foods: " + H.FOODS.length);
