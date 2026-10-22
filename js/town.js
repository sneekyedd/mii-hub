/*
 * town.js
 * Every Mii lives its own life: it decides where it wants to be (the park, the
 * office, the moon base, the apartment courtyard or at home), walks off, travels
 * there, stays a while, and moves on. Each Mii has a favorite place, and its
 * personality decides how much it likes the others:
 *   - lazy / shy Miis spend lots of time at home
 *   - serious, hard-working Miis go to the office
 *   - energetic, outdoorsy Miis like the park
 *   - adventurous Miis visit the moon
 *   - friendly neighbors hang out in the apartment courtyard
 *
 * Only the place you're looking at is shown in 3D (by hub3d.js). For the other
 * places, this file keeps track of who's there, and lets them chat with each other
 * (and phone friends who are somewhere else) "off screen".
 */
(function (root) {
  "use strict";

  const PLACES = [
    { id: "park", name: "the park", icon: "🌳" },
    { id: "office", name: "the office", icon: "🏢" },
    { id: "space", name: "the moon base", icon: "🚀" },
    { id: "apartments", name: "the courtyard", icon: "🏘️" },
    { id: "beach", name: "the beach", icon: "🏖️" },
    { id: "cafe", name: "Café Street", icon: "☕" },
    { id: "school", name: "college", icon: "🎓" }, // (the id stays "school" so saved games still work)
    { id: "stage", name: "the concert stage", icon: "🎤" },
    { id: "home", name: "home", icon: "🏠" },
    { id: "away", name: "vacation", icon: "✈️" }, // away on vacation (see life.js): not a real place
  ];
  // only places that exist in this version of the game (and home)
  const available = () => PLACES.filter((p) => p.id !== "away" && (p.id === "home" || !root.World3D || root.World3D.list.some((l) => l.id === p.id)));
  const placeInfo = (id) => PLACES.find((p) => p.id === id) || PLACES[0];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // How much a personality likes each place (before the favorite-place bonus).
  function placeLikes(p) {
    const e = p.energy / 100, s = p.social / 100, h = p.humor / 100, k = p.kindness / 100;
    return {
      park: 0.8 + e * 1.0 + s * 0.4,              // active, outdoorsy
      office: 0.5 + (1 - h) * 1.3 + e * 0.3,      // serious, hard-working
      space: 0.4 + e * 0.7 + h * 0.4 + (1 - s) * 0.2, // adventurous, curious
      apartments: 0.5 + s * 0.8 + k * 0.6,        // friendly neighbors
      home: 0.3 + (1 - e) * 1.2 + (1 - s) * 0.4,  // lazy homebodies
      beach: 0.5 + e * 0.8 + h * 0.4,               // fun in the sun
      cafe: 0.4 + s * 0.7 + p.chatty / 100 * 0.6,   // chatty socialisers
      school: 0.3 + (1 - h) * 0.8 + k * 0.3,        // curious, studious (the college)
      stage: 0.3 + h * 0.7 + e * 0.5 + s * 0.3,     // performers
    };
  }

  // A Mii's favorite place, worked out from its personality (with a little luck).
  function guessFavorite(p) {
    const likes = placeLikes(p);
    let best = "park", bestV = -1;
    for (const [id, v] of Object.entries(likes)) {
      if (!available().some((p) => p.id === id)) continue;
      const score = v * rnd(0.85, 1.15);
      if (score > bestV) { bestV = score; best = id; }
    }
    return best;
  }

  /*
   * opts = {
   *   hub, records (Map id -> record), templateFor(rec) -> Promise<template>,
   *   lookFor(rec, template), nameOf(rec), save(rec), changed() (refresh the side panel)
   * }
   */
  function create(opts) {
    const { hub, records, D } = opts;
    const L = root.MiiLife; // jobs (life.js)
    const rt = new Map(); // id -> { stay, travel, homeAct, homeActIn, hold }
    let socialIn = 6, phoneIn = 12, refreshIn = 1;

    const info = (rec) => {
      if (!rt.has(rec.id)) rt.set(rec.id, { stay: rnd(40, 140), travel: null, homeAct: null, homeActIn: 0 });
      return rt.get(rec.id);
    };

    // the place you're looking at (not counting a home visit)
    const viewed = () => (hub.visiting ? hub.mainWorld && hub.mainWorld.id : hub.world && hub.world.id);
    const walkerOf = (id) => hub.walkers.find((w) => w.id === id) || null;
    const visitingId = () => (hub.visiting ? hub.visiting.record.id : null);

    // How long a Mii stays somewhere (longer at its favorite place).
    function stayFor(rec, place) {
      const p = D.traits(rec);
      let t = rnd(70, 200);
      if (place === rec.favPlace) t *= 1.7;
      if (place === "home") t *= 0.8 + (100 - p.energy) / 100;
      return t;
    }

    function choosePlace(rec, exclude) {
      const p = D.traits(rec);
      const likes = placeLikes(p);
      const options = [];
      const sweetheart = rec.sweetheart && records.get(rec.sweetheart);
      for (const pl of available()) {
        if (pl.id === exclude) continue;
        let w = likes[pl.id];
        if (pl.id === rec.favPlace) w *= 3;
        if (opts.placeMood) w *= opts.placeMood(pl.id); // rain keeps Miis indoors...
        if (sweetheart && sweetheart.place === pl.id) w *= 2.5; // couples like to be together
        options.push([pl.id, w]);
      }
      return D.weighted(options);
    }

    // ---------- moving between places ----------
    // Starts the trip once the Mii has left where it was.
    function startTravel(rec, to, quick) {
      const r = info(rec);
      const from = rec.place;
      // home <-> courtyard is just the front door; anywhere else takes a little while
      const t = quick ? 0.3 : (from === "home" && to === "apartments") || (from === "apartments" && to === "home") ? 1.5 : rnd(5, 12);
      r.travel = { to, left: t, from };
      opts.changed();
    }

    async function arrive(rec, to) {
      const r = info(rec);
      const from = r.travel ? r.travel.from : rec.place;
      r.travel = null;
      rec.place = to;
      r.stay = r.sentStay || stayFor(rec, to);
      r.sentStay = 0;
      opts.save(rec);
      if (to === "home") r.homeActIn = 0; // pick something to do at home right away
      if (to === viewed() && to !== "home" && !walkerOf(rec.id)) {
        const template = await opts.templateFor(rec);
        if (rec.place !== to || walkerOf(rec.id) || !records.has(rec.id)) return; // changed its mind meanwhile
        hub.arrive(rec, template, opts.lookFor(rec, template), from);
      }
      if (opts.arrived) opts.arrived(rec, from, to); // (e.g. back from a vacation)
      opts.changed();
    }

    // Makes a Mii head off to `to`. If it's in the place you're looking at, it
    // says bye and walks out (or to its front door) first.
    function go(rec, to, how) {
      how = how || {};
      const r = info(rec);
      // sent somewhere else in the middle of a shift: no pay this time
      if (r.shift && L && to !== L.job(r.shift.job).place) { r.shift = null; r.jobIn = L.shiftGap(); }
      if (r.travel) { r.travel.to = to; if (how.quick) r.travel.left = Math.min(r.travel.left, 0.3); if (how.then) r.then = how.then; return; }
      if (rec.place === to) { if (how.then) how.then(); return; }
      if (how.stay) r.sentStay = how.stay;
      if (how.then) r.then = how.then;
      const w = walkerOf(rec.id);
      if (w && !w.leaving) {
        hub.leavePlace(rec.id, to, () => startTravel(rec, to, how.quick), how.quick);
        r.travel = null;
        r.leavingTo = to;
      } else if (!w) {
        startTravel(rec, to, how.quick);
      }
    }

    // You sent a Mii somewhere from its menu: it goes, and stays a good while.
    function sendTo(rec, to, how) {
      how = Object.assign({ stay: rnd(240, 360) }, how || {});
      go(rec, to, how);
    }

    // ---------- what Miis do at home (shown through their window) ----------
    function newHomeActivity(rec) {
      const r = info(rec);
      const H = root.MiiHomes;
      const items = (rec.home && rec.home.items) || {};
      const options = [];
      const p = D.traits(rec);
      for (const id of Object.values(items)) {
        const it = H && H.item(id);
        if (!it || !it.use) continue;
        let w = 1;
        if (it.use.lie) w = 0.6 + (100 - p.energy) / 60;    // sleepy Miis nap more
        if (it.use.run || it.use.arms === "punch") w = 0.3 + p.energy / 60;
        options.push([Object.assign({ itemId: it.id, slot: it.slot }, it.use), w]);
      }
      options.push([null, 0.6]); // just looking out of the window
      r.homeAct = D.weighted(options);
      r.homeActIn = r.homeAct && r.homeAct.lie ? rnd(40, 90) : rnd(20, 50);
      opts.changed();
    }

    // ---------- jobs ----------
    // Every so often a Mii goes to work (a "shift"), wears its uniform there, and
    // gets paid when the shift is over. A teacher's class brings the students along.
    function workingAs(rec) {
      const r = info(rec);
      return r.shift && !r.travel && L && rec.place === L.job(r.shift.job).place ? r.shift.job : null;
    }
    function startShift(rec, jobId, length) {
      if (!L || rec.place === "away") return false;
      const j = L.job(jobId || L.ensureJob(rec));
      if (!j || !available().some((p) => p.id === j.place)) return false;
      const r = info(rec);
      const len = length || L.shiftLength();
      if (rec.id === visitingId()) return false;
      r.shift = { job: j.id, left: len };
      r.jobIn = L.shiftGap();
      if (rec.place === j.place && !r.travel) {
        r.stay = Math.max(r.stay, len + 5);
        if (opts.restyle) opts.restyle(rec, "work");
      } else go(rec, j.place, { stay: len + 5 });
      if (j.id === "teacher") callStudents(rec, len);
      opts.changed();
      return true;
    }
    function callStudents(teacher, len) {
      const free = (x) => x !== teacher && x.place !== "away" && !info(x).shift && !info(x).travel && x.id !== visitingId();
      let kids = Array.from(records.values()).filter((x) => free(x) && x.job === "student");
      // nobody studying? a couple of Miis sit in on the class
      if (!kids.length) kids = Array.from(records.values()).filter(free).sort(() => Math.random() - 0.5).slice(0, 2);
      for (const k of kids.slice(0, 3)) startShift(k, "student", len);
    }
    function endShift(rec) {
      const r = info(rec);
      const j = L.job(r.shift.job);
      r.shift = null;
      r.jobIn = L.shiftGap();
      const pay = L.jobPay(j.id, rec.level);
      rec.coins = (rec.coins || 0) + pay;
      rec.shifts = (rec.shifts || 0) + 1;
      r.stay = rnd(4, 10); // then off somewhere else
      opts.save(rec);
      if (opts.restyle) opts.restyle(rec, "home");
      if (opts.onShift) opts.onShift(rec, j, pay);
      opts.changed();
      return pay;
    }
    // (called every frame for each Mii that isn't travelling)
    function tickJob(rec, r, dt) {
      if (!L) return;
      if (r.shift) {
        const j = L.job(r.shift.job);
        if (rec.place !== j.place) { r.shift = null; r.jobIn = L.shiftGap(); return; } // went somewhere else
        r.shift.left -= dt;
        r.stay = Math.max(r.stay, 3);
        if (r.shift.left <= 0) endShift(rec);
        return;
      }
      if (r.jobIn === undefined) r.jobIn = rnd(90, 420);
      r.jobIn -= dt;
      if (r.jobIn > 0) return;
      const w = walkerOf(rec.id);
      if (w && (hub.isBusy(w) || w.state === "playing")) { r.jobIn = 15; return; }
      if (rec.wish && rec.wish.type === "goPlace") { r.jobIn = 60; return; } // (it'd rather go there first)
      startShift(rec);
    }

    // ---------- the clock ----------
    function tick(dt) {
      const view = viewed();
      const visitId = visitingId();
      for (const rec of records.values()) {
        const r = info(rec);
        if (rec.place === "away" && !r.travel) continue; // on vacation (life.js brings it back)
        if (rec.id === visitId) { r.stay = Math.max(r.stay, 30); continue; } // you're visiting: they stay home
        // social energy comes back with time alone (Miis on screen do this in hub3d.js)
        if (!walkerOf(rec.id)) hub.setBattery(rec.id, Math.min(1, hub.batteryOf(rec.id) + dt * 0.008 * (0.6 + D.traits(rec).social / 100)));
        if (rec.place === "home" && !r.travel) {
          r.homeActIn -= dt;
          if (r.homeActIn <= 0) newHomeActivity(rec);
        }
        if (r.travel) {
          r.travel.left -= dt;
          if (r.travel.left <= 0) {
            const then = r.then; r.then = null;
            arrive(rec, r.travel.to).then(() => { if (then) then(); });
          }
          continue;
        }
        const w = walkerOf(rec.id);
        if (w && w.leaving) continue;
        tickJob(rec, r, dt);
        r.stay -= dt;
        if (r.stay > 0) continue;
        // time to go somewhere else (unless it's busy with something)
        if (w && (hub.isBusy(w) || w.state === "playing")) { r.stay = 8; continue; }
        const to = choosePlace(rec, rec.place);
        go(rec, to);
      }

      // Miis in places you're not looking at still hang out with each other
      socialIn -= dt * hub.chattiness;
      if (socialIn <= 0) {
        socialIn = rnd(8, 14);
        for (const pl of available()) {
          if (pl.id === view || pl.id === "home") continue;
          const here = Array.from(records.values()).filter((r) => r.place === pl.id && !info(r).travel);
          if (here.length < 2 || Math.random() > 0.1 * Math.min(2, here.length / 3)) continue;
          const a = pick(here), b = pick(here.filter((x) => x !== a));
          hub.offscreenHangout(a, b, pl.id);
        }
      }

      // ...and phone friends who are somewhere else
      phoneIn -= dt * hub.chattiness;
      if (phoneIn <= 0) {
        phoneIn = rnd(14, 28);
        tryPhoneCall();
      }

      refreshIn -= dt;
      if (refreshIn <= 0) { refreshIn = 1; opts.changed(true); }
    }

    function tryPhoneCall() {
      const all = Array.from(records.values()).filter((r) => !info(r).travel && r.id !== visitingId() && r.place !== "away");
      if (all.length < 2) return;
      // chatty, outgoing Miis call more
      const A = D.weighted(all.map((r) => { const p = D.traits(r); return [r, 0.4 + p.chatty / 60 + p.social / 100]; }));
      // they call someone somewhere else, usually a friend
      const others = all.filter((r) => r !== A && r.place !== A.place);
      if (!others.length) return;
      const B = D.weighted(others.map((r) => [r, 0.4 + Math.min(20, hub.friendships[pairKey(A, r)] || 0) / 4]));
      const view = viewed();
      const wa = A.place === view && walkerOf(A.id);
      const wb = B.place === view && walkerOf(B.id);
      const ok = (w) => w && !hub.isBusy(w) && !w.leaving && w.appear >= 1 && w.cooldown <= 0;
      if (ok(wa)) hub.startPhone(wa, B, "caller");
      else if (ok(wb)) hub.startPhone(wb, A, "callee");
      else if (!wa && !wb) hub.offscreenHangout(A, B, "phone");
    }

    const pairKey = (a, b) => (a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id);

    // The Miis who should be in a place when you start looking at it.
    async function populate(placeId) {
      for (const rec of records.values()) {
        if (rec.place !== placeId || info(rec).travel || walkerOf(rec.id)) continue;
        const template = await opts.templateFor(rec);
        if (rec.place !== placeId || info(rec).travel || walkerOf(rec.id) || viewed() !== placeId) continue;
        hub.addWalker(rec, template, opts.lookFor(rec, template), true);
      }
      opts.changed();
    }

    // What the side panel says about where a Mii is.
    function whereText(rec) {
      const r = info(rec);
      if (r.travel && r.travel.to === "away") return "Off on vacation ✈️";
      if (r.travel) return "On the way to " + placeInfo(r.travel.to).name + " " + placeInfo(r.travel.to).icon;
      const pl = placeInfo(rec.place);
      if (rec.place === "away" && L && rec.vacation) { const d = L.destination(rec.vacation.dest); return "On vacation in " + d.name + " " + d.icon + " (" + L.backIn(rec) + ")"; }
      const job = workingAs(rec);
      if (job) return "At work: " + L.job(job).name + " " + L.job(job).icon;
      if (rec.place === "home") return "At home 🏠";
      return "At " + pl.name + " " + pl.icon;
    }

    function isTravelling(rec) { return !!info(rec).travel; }
    function homeActivity(rec) { return rec.place === "home" && !info(rec).travel ? info(rec).homeAct : null; }
    function forget(id) { rt.delete(id); }

    return { tick, go, sendTo, populate, choosePlace, whereText, isTravelling, homeActivity, forget, info, workingAs, startShift, endShift };
  }

  root.MiiTown = { create, PLACES, placeInfo, placeLikes, guessFavorite, available };
})(typeof self !== "undefined" ? self : this);
