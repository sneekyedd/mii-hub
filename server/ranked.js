/*
 * Ranked Paintball: ranks, MMR and matchmaking (runs inside the Paintball server).
 *
 * The format: free-for-all Respawn, up to 4 players (RANKED_SIZE), first to 15
 * eliminations or the most after 8 minutes, on a random map. No voting.
 * The server decides the placements from its own kill count (most eliminations
 * first, then fewest deaths); nothing the game sends about results is trusted.
 *
 * MMR ("matchmaking rating") is a hidden-at-first number per ACCOUNT, saved in
 * DATA_DIR/ranked.json (next to the accounts, written the same safe way: a
 * temporary file first, then renamed over the old one).
 *
 *   Elo, placement by placement: every player is compared with every other
 *   player in the match (finishing above someone = a win against them, level = a
 *   draw). Beating higher-rated players is worth more, losing to lower-rated
 *   players costs more. The sum is scaled by K / (players - 1), so a 4-player
 *   win against equals is worth the same as a 1-on-1 win (+K/2).
 *     K = 40 normally, 80 during the 5 placement matches (bigger swings).
 *   The winner always gains at least 1, last place always loses at least 1.
 *   Leaving (or staying disconnected past the 30 s grace) = last place.
 *
 * Placements: your first 5 matches. Your MMR moves but stays hidden (you see
 * "Placement 3/5"); after the 5th your rank is revealed.
 * Rank protection: after promoting into a new tier, the very first loss can't
 * drop you out of it (you stop at the bottom of the tier instead).
 *
 * This file has no networking: paintball-server.js does the rooms and messages.
 */
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------
// The ladder. Iron..Diamond have divisions IV (lowest) -> I, 100 MMR each.
//   Iron 0–399 · Bronze 400–799 · Silver 800–1199 · Gold 1200–1599
//   Platinum 1600–1999 · Emerald 2000–2399 · Diamond 2400–2799
//   Master 2800–3199 · Grandmaster 3200+ · Predator: the top 10 at Master or higher
// (js/paintball/pb-ranked.js has the same table for drawing; the tests check they match)
// ---------------------------------------------------------------------
const TIERS = [
  { id: "iron", name: "Iron", min: 0, divs: 4 },
  { id: "bronze", name: "Bronze", min: 400, divs: 4 },
  { id: "silver", name: "Silver", min: 800, divs: 4 },
  { id: "gold", name: "Gold", min: 1200, divs: 4 },
  { id: "platinum", name: "Platinum", min: 1600, divs: 4 },
  { id: "emerald", name: "Emerald", min: 2000, divs: 4 },
  { id: "diamond", name: "Diamond", min: 2400, divs: 4 },
  { id: "master", name: "Master", min: 2800, divs: 0 },
  { id: "grandmaster", name: "Grandmaster", min: 3200, divs: 0 },
  { id: "predator", name: "Predator", min: 2800, divs: 0 }, // not by MMR: the top PREDATOR_TOP (at least Master)
];
const DIV_SIZE = 100;
const START_MMR = 1200;     // where everyone starts (hidden): the Silver / Gold line
const PLACEMENTS = 5;
const K = 40;
const K_PLACEMENT = 80;
const PREDATOR_TOP = 10;
const ROMAN = ["", "I", "II", "III", "IV"];

// Matchmaking: who you can be matched with widens the longer you wait
const RANGE_BASE = 100;     // ±100 MMR straight away
const RANGE_PER_SEC = 20;   // +20 every second
const RANGE_ANY_AFTER = 60; // anyone after a minute

const tierIndex = (id) => TIERS.findIndex((t) => t.id === id);
// the tier an MMR is in by numbers alone (never Predator)
function tierOfMmr(mmr) {
  let i = 0;
  for (let j = 0; j < TIERS.length; j++) if (TIERS[j].id !== "predator" && mmr >= TIERS[j].min) i = j;
  return i;
}

// mmr -> { tier, name, div, label, step, mmr }   (div: 4 = IV ... 1 = I, 0 = no divisions)
// o.placed false: "Unranked" (still in placements). o.predator: one of the top 10.
function rankFor(mmr, o) {
  o = o || {};
  mmr = Math.max(0, Math.round(mmr || 0));
  if (o.placed === false) return { tier: "unranked", name: "Unranked", div: 0, label: "Unranked", step: -1, mmr: null };
  let ti = tierOfMmr(mmr);
  if (o.predator && ti >= tierIndex("master")) ti = tierIndex("predator");
  const T = TIERS[ti];
  let div = 0;
  if (T.divs) div = T.divs - Math.min(T.divs - 1, Math.floor((mmr - T.min) / DIV_SIZE));
  return { tier: T.id, name: T.name, div, label: T.name + (div ? " " + ROMAN[div] : ""), step: ti * 10 + (div ? 5 - div : 0), mmr };
}

// how far through your division (or tier, for Master) you are: { floor, ceil, pct }
function progress(mmr) {
  const ti = tierOfMmr(mmr), T = TIERS[ti];
  if (T.divs) {
    const floor = T.min + Math.min(T.divs - 1, Math.floor((mmr - T.min) / DIV_SIZE)) * DIV_SIZE;
    return { floor, ceil: floor + DIV_SIZE, pct: Math.max(0, Math.min(1, (mmr - floor) / DIV_SIZE)) };
  }
  const next = TIERS[ti + 1] && TIERS[ti + 1].id !== "predator" ? TIERS[ti + 1].min : T.min + 400;
  return { floor: T.min, ceil: next, pct: Math.max(0, Math.min(1, (mmr - T.min) / (next - T.min))) };
}

// ---------------------------------------------------------------------
// Elo for a free-for-all: players = [{ mmr, place, k }] (place 1 = best, ties share a place)
// -> the MMR change for each (same order)
// ---------------------------------------------------------------------
const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
function eloDeltas(players) {
  const n = players.length;
  if (n < 2) return players.map(() => 0);
  const best = Math.min(...players.map((p) => p.place)), worst = Math.max(...players.map((p) => p.place));
  return players.map((p, i) => {
    let sum = 0;
    players.forEach((o, j) => {
      if (i === j) return;
      const s = p.place < o.place ? 1 : p.place === o.place ? 0.5 : 0;
      sum += s - expected(p.mmr, o.mmr);
    });
    let d = Math.round(((p.k || K) / (n - 1)) * sum);
    if (best !== worst) {
      if (p.place === best) d = Math.max(1, d);       // a win always gains
      else if (p.place === worst) d = Math.min(-1, d); // last always loses
    }
    return d;
  });
}

// how wide (± MMR) someone who has waited this long can be matched
function searchRange(waitMs) {
  const s = Math.max(0, waitMs) / 1000;
  return s >= RANGE_ANY_AFTER ? Infinity : Math.round(RANGE_BASE + RANGE_PER_SEC * s);
}

// The matchmaker: queue = [{ key, mmr, at }] -> groups of entries that should play.
// The longest-waiting player picks the closest players both of them accept; a group
// starts when it's full, or with 2+ players once that player has waited fillMs.
function formMatches(queue, now, o) {
  const size = o.size, fillMs = o.fillMs;
  const left = queue.slice().sort((a, b) => a.at - b.at);
  const groups = [];
  while (left.length >= 2) {
    const anchor = left.shift();
    const ra = searchRange(now - anchor.at);
    const fits = left
      .filter((e) => { const d = Math.abs(e.mmr - anchor.mmr); return d <= ra && d <= searchRange(now - e.at); })
      .sort((a, b) => Math.abs(a.mmr - anchor.mmr) - Math.abs(b.mmr - anchor.mmr))
      .slice(0, size - 1);
    if (fits.length + 1 >= size || (fits.length >= 1 && now - anchor.at >= fillMs)) {
      groups.push([anchor].concat(fits));
      for (const f of fits) left.splice(left.indexOf(f), 1);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------
// The saved ratings: DATA_DIR/ranked.json  { v: 1, players: { key: rec } }
//   rec = { user, mmr, games, wins, shield, peak, updated }
// ---------------------------------------------------------------------
function createStore(o) {
  const file = path.join(o.dataDir, "ranked.json");
  const log = o.log || (() => {});
  let players = {};
  let off = false;
  try {
    fs.mkdirSync(o.dataDir, { recursive: true });
    const txt = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (txt) { const j = JSON.parse(txt); if (j && j.players && typeof j.players === "object") players = j.players; }
  } catch (e) {
    // a broken file is kept aside (never thrown away), and ranked starts from what's left
    if (e instanceof SyntaxError) { try { fs.renameSync(file, file + ".broken-" + Date.now()); } catch (e2) { /* ignore */ } log("⚠️ ranked.json couldn't be read; kept it as ranked.json.broken-*"); }
    else { off = true; log("⚠️ ranked is OFF: can't use " + o.dataDir + " (" + (e.code || e.message) + ")"); }
  }

  // saving: one write at a time; changes during a write are saved right after it
  let writing = null, again = false;
  function save() {
    if (off) return Promise.resolve();
    if (writing) { again = true; return writing; }
    writing = (async () => {
      do {
        again = false;
        const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
        try {
          await fsp.writeFile(tmp, JSON.stringify({ v: 1, players }));
          await fsp.rename(tmp, file);
        } catch (e) { log("⚠️ couldn't save ranked.json: " + e.message); await fsp.unlink(tmp).catch(() => {}); }
      } while (again);
      writing = null;
    })();
    return writing;
  }

  const get = (key) => players[key] || null;
  const fresh = (user) => ({ user, mmr: START_MMR, games: 0, wins: 0, shield: false, peak: 0, updated: 0 });
  const isPlaced = (rec) => !!rec && rec.games >= PLACEMENTS;

  // the top PREDATOR_TOP placed players at Master or higher (ties: who got there first)
  function predators() {
    const list = Object.keys(players).filter((k) => isPlaced(players[k]) && players[k].mmr >= TIERS[tierIndex("master")].min)
      .sort((a, b) => players[b].mmr - players[a].mmr || players[a].updated - players[b].updated);
    return new Set(list.slice(0, PREDATOR_TOP));
  }
  function rankOf(key, preds) {
    const rec = players[key];
    if (!rec) return rankFor(START_MMR, { placed: false });
    return rankFor(rec.mmr, { placed: isPlaced(rec), predator: (preds || predators()).has(key) });
  }
  // what a player sees about themselves (the MMR stays hidden during placements)
  function info(key, user) {
    const rec = players[key] || fresh(user || key);
    const placed = isPlaced(rec);
    return {
      user: rec.user || user, rank: rankOf(key), mmr: placed ? rec.mmr : null, games: rec.games, wins: rec.wins,
      placements: { done: Math.min(rec.games, PLACEMENTS), of: PLACEMENTS }, shield: placed && !!rec.shield,
      progress: placed ? progress(rec.mmr) : null, peak: placed ? rec.peak : null, pos: placed ? position(key) : null,
    };
  }
  function sorted() {
    return Object.keys(players).filter((k) => isPlaced(players[k]))
      .sort((a, b) => players[b].mmr - players[a].mmr || players[a].updated - players[b].updated);
  }
  function position(key) { const i = sorted().indexOf(key); return i < 0 ? null : i + 1; }
  // the leaderboard: the best n placed players
  function top(n) {
    const preds = predators();
    return sorted().slice(0, n).map((k, i) => {
      const r = players[k];
      return { pos: i + 1, user: r.user, mmr: r.mmr, rank: rankOf(k, preds), games: r.games, wins: r.wins, key: k };
    });
  }

  // A finished match. results = [{ key, user, place, leaver }] (place 1 = best).
  // Returns { key: { before, after, delta, place, of, leaver, placement, justPlaced, promoted, demoted, protected } }
  function applyMatch(results, now) {
    now = now || Date.now();
    const predsBefore = predators();
    const recs = results.map((r) => { if (!players[r.key]) players[r.key] = fresh(r.user); const rec = players[r.key]; if (r.user) rec.user = r.user; return rec; });
    const before = results.map((r, i) => ({ rank: rankOf(r.key, predsBefore), mmr: recs[i].mmr, placed: isPlaced(recs[i]) }));
    const deltas = eloDeltas(results.map((r, i) => ({ mmr: recs[i].mmr, place: r.place, k: isPlaced(recs[i]) ? K : K_PLACEMENT })));
    const out = {};
    const protectedKeys = new Set();
    results.forEach((r, i) => {
      const rec = recs[i];
      const wasPlaced = isPlaced(rec);
      let mmr = Math.max(0, rec.mmr + deltas[i]);
      if (wasPlaced && deltas[i] < 0) {
        const floor = TIERS[tierOfMmr(rec.mmr)].min;
        if (rec.shield && mmr < floor) { mmr = floor; protectedKeys.add(r.key); }
        rec.shield = false; // the first loss after a promotion uses it up either way
      }
      if (wasPlaced && tierOfMmr(mmr) > tierOfMmr(rec.mmr)) rec.shield = true; // promoted into a new tier
      rec.mmr = mmr;
      rec.games++;
      if (r.place === 1 && !r.leaver) rec.wins++;
      if (isPlaced(rec)) rec.peak = Math.max(rec.peak || 0, mmr);
      rec.updated = now;
    });
    const predsAfter = predators();
    const of = results.length;
    results.forEach((r, i) => {
      const rec = recs[i], b = before[i];
      const after = { rank: rankOf(r.key, predsAfter), mmr: rec.mmr, placed: isPlaced(rec) };
      const justPlaced = !b.placed && after.placed;
      const shown = b.placed; // the numbers stay hidden until placements are done
      out[r.key] = {
        user: rec.user, place: r.place, of, leaver: !!r.leaver,
        delta: shown ? rec.mmr - b.mmr : null,
        before: { rank: b.rank, mmr: shown ? b.mmr : null, progress: shown ? progress(b.mmr) : null },
        after: { rank: after.rank, mmr: after.placed ? rec.mmr : null, progress: after.placed ? progress(rec.mmr) : null },
        placement: !b.placed ? { done: Math.min(rec.games, PLACEMENTS), of: PLACEMENTS } : null,
        justPlaced,
        promoted: shown && after.rank.step > b.rank.step, demoted: shown && after.rank.step < b.rank.step,
        tierUp: shown && tierIndex(after.rank.tier) > tierIndex(b.rank.tier), tierDown: shown && tierIndex(after.rank.tier) < tierIndex(b.rank.tier),
        protected: protectedKeys.has(r.key), shield: after.placed && !!rec.shield,
      };
    });
    save();
    return out;
  }

  return { get, info, rankOf, top, position, applyMatch, predators, save, flush: () => writing || Promise.resolve(), file, get off() { return off; }, _players: () => players };
}

module.exports = {
  TIERS, DIV_SIZE, START_MMR, PLACEMENTS, K, K_PLACEMENT, PREDATOR_TOP, ROMAN,
  RANGE_BASE, RANGE_PER_SEC, RANGE_ANY_AFTER,
  rankFor, progress, tierOfMmr, eloDeltas, expected, searchRange, formMatches, createStore,
};
