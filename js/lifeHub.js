/*
 * lifeHub.js
 * Shows the things from life.js in the 3D hub:
 *   - concert stage: a Mii goes up and plays an instrument while the others gather
 *     round and clap at the end; and a band's big show (the "show" wish)
 *   - Miis at work: they do their job's things (help desk, lifeguard tower...)
 *   - coming home from a vacation
 *
 * app.js makes one with MiiLifeHub.create({...}) and calls tick(dt) every frame.
 */
(function (root) {
  "use strict";

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const PARTS = ["vocals", "drums", "keys", "guitar", "bass"];
  const PART_ICON = { vocals: "🎤", drums: "🥁", keys: "🎹", guitar: "🎸", bass: "🎸" };
  const PART_ARMS = { vocals: "sing", drums: "drum", keys: "type", guitar: "strum", bass: "strum" };

  /*
   * opts = { hub, town, progress, records, nameOf, toast, walkerOf(id), goToScene(id), soundOn() }
   */
  function create(opts) {
    const { hub, town, records } = opts;
    const L = root.MiiLife, LM = root.MiiLifeModels, Band = root.MiiBand, P = root.MiiProgress;
    let show = null;           // what's happening on the stage right now
    let soloIn = rnd(25, 50);  // seconds until a Mii might get up on stage
    let workIn = 1;
    const walkerOf = (id) => hub.walkers.find((w) => w.id === id) || null;
    const onStage = () => !hub.visiting && hub.world && hub.world.id === "stage";
    const free = (w) => !hub.isBusy(w) && w.appear >= 1 && !w.leaving && w.state !== "playing";
    const soundOn = () => (opts.soundOn ? opts.soundOn() : true);

    // ---------- where the band stands ----------
    // (the stage's own spots for the mic, drums and keyboard; the guitar and bass
    // stand between them)
    function stageSpots() {
      const spots = (hub.world && hub.world.spots) || [];
      const find = (re) => spots.find((s) => re.test(s.activity || ""));
      const mic = find(/singing on stage/), drums = find(/playing the drums/), keys = find(/playing the keyboard/);
      if (!mic || !drums || !keys) return null;
      const y = mic.stand ? mic.stand.y : 1;
      const make = (base, part, extra) => Object.assign({}, base, {
        arms: PART_ARMS[part], emoji: PART_ICON[part], activity: "playing " + (part === "vocals" ? "the mic" : "the " + part) + " on stage",
        lines: ["Let's rock!", "Here we go!", "Check, check... one, two!"], part, inShow: true,
      }, extra || {});
      return {
        vocals: make(mic, "vocals"),
        drums: make(drums, "drums"),
        keys: make(keys, "keys"),
        guitar: make(mic, "guitar", { x: mic.x + 2.4, stand: { x: mic.x + 2.4, z: mic.stand.z - 0.45, y } }),
        bass: make(mic, "bass", { x: mic.x - 2.4, stand: { x: mic.x - 2.4, z: mic.stand.z - 0.45, y } }),
        front: mic.z, // the ground in front of the stage
      };
    }

    // Puts a walker on its spot straight away (it hops up onto the stage).
    function place(w, spot) {
      w.spot = spot;
      w.state = "activity";
      w.timer = 9999;
      w.path = null;
      w.anchor = spot.seat ? { kind: "sit", at: spot.seat } : spot.stand ? { kind: "stand", at: spot.stand } : null;
      if (w.anchor) w.anchor.yaw = spot.seat && spot.seat.yaw !== undefined ? spot.seat.yaw : spot.yaw || 0;
      w.targetYaw = spot.yaw || 0;
    }
    // Sends a walker to its spot (it walks there, then gets on).
    function send(w, spot) {
      hub.endInteraction(w);
      w.inShow = true;
      w.clearEmote();
      w.dance = false; w.sleep = false;
      w.anchor = null;
      w.spot = spot;
      w.seated = false;
      if (!w.goTo(spot.x, spot.z)) { w.x = spot.x; w.z = spot.z; place(w, spot); }
    }
    // Is it on its spot yet? (hub3d.js puts it in "activity" when it gets there)
    function settle(w) {
      if (w.state === "activity" && w.spot && w.spot.inShow) { w.timer = 9999; w.seated = true; }
      return w.seated;
    }
    function release(w, delay) {
      hub.later(w, delay || 0, () => {
        if (LM) LM.hold(w, null);
        w.inShow = false;
        w.dance = false;
        if (w.state === "activity" && w.spot && w.spot.inShow) w.timer = 0; // gets down and wanders off
        else if (w.spot && w.spot.inShow) { w.spot = null; w.state = "idle"; w.timer = rnd(0.5, 2); }
      });
    }

    // The others come and watch: a few rows in front of the stage, facing it.
    function gatherCrowd(except, front) {
      const crowd = [];
      const list = hub.walkers.filter((w) => !except.includes(w) && free(w));
      list.forEach((w, i) => {
        const row = Math.floor(i / 5), col = i % 5;
        const x = (col - 2) * 1.5 + (row % 2 ? 0.75 : 0) + rnd(-0.2, 0.2);
        const z = front + 1.8 + row * 1.3;
        const spot = { x, z, yaw: Math.PI, emoji: "🎶", activity: "watching the show", lines: ["Ooh, a show!", "Front row!", "Yay!"], inShow: true, audience: true };
        send(w, spot);
        crowd.push(w);
      });
      return crowd;
    }

    // A little "♪" floating up from a performer.
    function note(w) {
      const THREE = root.THREE;
      if (!THREE || !hub.camera) return;
      const s = w.inst.holder.scale.y;
      const v = new THREE.Vector3(w.inst.holder.position.x, w.inst.holder.position.y + 1.9 * s, w.inst.holder.position.z).project(hub.camera);
      if (v.z >= 1) return;
      const el = document.createElement("div");
      el.className = "note-pop";
      el.textContent = pick(["♪", "♫", "♬", "♩"]);
      el.style.left = (v.x * 0.5 + 0.5) * hub.W + rnd(-14, 14) + "px";
      el.style.top = (-v.y * 0.5 + 0.5) * hub.H + "px";
      hub.overlay.appendChild(el);
      setTimeout(() => el.remove(), 1600);
    }

    // ---------- a Mii plays on stage by itself ----------
    function startSolo(w, part, songId) {
      const spots = stageSpots();
      if (!spots || show) return false;
      part = part || pick(["vocals", "drums", "keys", "guitar"]);
      const known = (w.record.songs || []);
      const song = songId || (known.length ? pick(known) : pick(Object.keys(Band ? Band.SONGS : { sunny: 1 })));
      send(w, spots[part]);
      w.say(pick(["Time to rock!", "Can I play something?", "Watch this!", "This one's for you!"]), 2.2);
      show = { kind: "solo", phase: "gather", t: 0, performers: [{ w, part }], crowd: [], song, bars: 8, front: spots.front };
      return true;
    }

    // ---------- a band's big show (the "show" wish) ----------
    function startBand(leader) {
      const b = leader.band;
      if (!b) return false;
      if (show) stop(true);
      const recs = [leader].concat(b.members.map((id) => records.get(id))).filter((r) => r && r.place !== "away");
      if (opts.goToScene) opts.goToScene("stage");
      for (const r of recs) if (r.place !== "stage" || town.isTravelling(r)) town.sendTo(r, "stage", { quick: true });
      show = { kind: "band", phase: "gather", t: 0, leader, recs, performers: [], crowd: [], song: b.song, front: 0 };
      opts.toast("🎸 " + opts.nameOf(leader) + "'s band is getting ready on the concert stage!");
      return true;
    }

    function begin() {
      show.phase = "play";
      show.t = 0;
      for (const p of show.performers) {
        if (LM && (p.part === "guitar" || p.part === "bass" || p.part === "vocals")) LM.hold(p.w, p.part);
        p.w.showEmote(PART_ICON[p.part], 999);
      }
      const P2 = show.performers.map((p) => p.part);
      const parts = show.kind === "band" ? PARTS : P2;
      const bars = show.kind === "band" ? undefined : show.bars;
      show.length = Band ? Band.duration(show.song, bars) : 20;
      show.audio = Band && soundOn() ? Band.play(show.song, { parts, bars }) : null;
      if (show.audio && root.MiiMusic) { root.MiiMusic.pause(true); show.ducked = true; }
      const title = (P && P.SONGS.find((s) => s.id === show.song) || { title: "a song" }).title;
      const lead = show.performers[0].w;
      lead.say(show.kind === "band" ? "Hello, everyone! This is “" + title + "”!" : "♪ “" + title + "” ♪", 3);
      hub.addFeed(show.kind === "band" ? opts.nameOf(show.leader) + "'s band is playing “" + title + "” on stage! 🎸" : lead.look.name + " is playing " + (show.performers[0].part === "vocals" ? "a song" : "the " + show.performers[0].part) + " on stage! " + PART_ICON[show.performers[0].part]);
      show.lines = P && P.SONGS.find((s) => s.id === show.song) ? P.SONGS.find((s) => s.id === show.song).lines : [];
    }

    function finish() {
      const s = show;
      s.phase = "applause";
      s.t = 0;
      if (s.audio) s.audio.stop();
      if (s.ducked && root.MiiMusic) root.MiiMusic.pause(false);
      if (Band && soundOn() && s.crowd.length) Band.applause(3.2, s.kind === "band" ? 0.8 : 0.5);
      for (const p of s.performers) {
        p.w.spot = Object.assign({}, p.w.spot, { arms: "cheer" });
        p.w.clearEmote();
        p.w.say(pick(["Thank you!", "Thanks, everyone!", "You've been great!", "*bows*"]), 2.5);
        release(p.w, 2.8);
      }
      for (const w of s.crowd) {
        if (!w.spot || !w.spot.audience) continue;
        w.spot = Object.assign({}, w.spot, { arms: "clap" });
        w.dance = false;
        hub.later(w, rnd(0, 0.6), () => { w.say(pick(["Bravo!", "Encore!", "Woo-hoo!", "Amazing!", "*clap clap*"]), 2); w.showEmote("👏", 2.6); if (Math.random() < 0.5) w.hop(3); });
        release(w, 3.2);
      }
      if (s.kind === "band") {
        if (opts.progress) opts.progress.finishShow(s.leader);
      } else {
        const w = s.performers[0].w;
        if (s.crowd.length) hub.later(w, 1.5, () => hub.awardCoins(w, 3, "show"));
        if (opts.progress) opts.progress.event({ type: "life", what: "solos" });
      }
      show = null;
    }

    // Stops whatever is going on (you left, or someone went missing).
    function stop(quiet) {
      if (!show) return;
      const s = show;
      show = null;
      if (s.audio) s.audio.stop();
      if (s.ducked && root.MiiMusic) root.MiiMusic.pause(false);
      for (const p of s.performers) if (hub.walkers.includes(p.w)) release(p.w, 0);
      for (const w of s.crowd) if (hub.walkers.includes(w)) release(w, 0);
      // a band that already played (you just didn't stay) still gets its reward
      if (s.kind === "band" && s.phase === "play" && s.t > s.length * 0.5 && opts.progress) opts.progress.finishShow(s.leader);
      else if (s.kind === "band" && !quiet) opts.toast("🎸 The show didn't happen... maybe next time!");
    }

    function tickShow(dt) {
      const s = show;
      s.t += dt;
      if (!onStage()) { stop(); return; }
      if (s.kind === "band" && s.phase === "gather") {
        const spots = stageSpots();
        if (!spots) { stop(); return; }
        s.front = spots.front;
        // band members arriving: each goes to its instrument (the leader sings)
        s.recs.forEach((r, i) => {
          if (s.performers.some((p) => p.w.id === r.id) || i >= PARTS.length) return;
          const w = walkerOf(r.id);
          if (!w || w.appear < 1 || w.leaving) return;
          send(w, spots[PARTS[i]]);
          s.performers.push({ w, part: PARTS[i] });
        });
        const ready = s.performers.filter((p) => settle(p.w)).length;
        const all = ready >= s.recs.length && ready === s.performers.length;
        if ((all || (s.t > 30 && ready >= 2)) && s.performers.length) {
          // anyone still on the way joins in straight away
          for (const p of s.performers) if (!p.w.seated) { p.w.x = p.w.spot.x; p.w.z = p.w.spot.z; place(p.w, p.w.spot); p.w.seated = true; }
          s.crowd = gatherCrowd(s.performers.map((p) => p.w), s.front);
          s.phase = "crowd";
          s.t = 0;
        } else if (s.t > 60) { stop(); }
        return;
      }
      if (s.phase === "gather") {
        // a solo: wait for the performer, and bring the crowd over
        const p = s.performers[0];
        if (!hub.walkers.includes(p.w)) { stop(); return; }
        if (!s.crowd.length && s.t > 0.5) s.crowd = gatherCrowd([p.w], s.front);
        if (settle(p.w) || s.t > 15) {
          if (!p.w.seated) { p.w.x = p.w.spot.x; p.w.z = p.w.spot.z; place(p.w, p.w.spot); p.w.seated = true; }
          s.phase = "crowd";
          s.t = 0;
        }
        return;
      }
      if (s.phase === "crowd") {
        // give the crowd a few seconds to get there
        if (s.t > 5 || s.crowd.every((w) => settle(w) || !hub.walkers.includes(w))) begin();
        return;
      }
      if (s.phase === "play") {
        for (const p of s.performers) {
          if (!hub.walkers.includes(p.w)) continue;
          settle(p.w);
          if (Math.random() < dt * 2.2) note(p.w);
        }
        for (const w of s.crowd) {
          if (!hub.walkers.includes(w) || !w.spot || !w.spot.audience) continue;
          settle(w);
          w.dance = w.trait("energy") > 45; // energetic Miis dance along
        }
        // the singer sings the words now and then
        if (s.lines.length && Math.random() < dt * 0.25) {
          const v = s.performers.find((p) => p.part === "vocals");
          if (v) v.w.say(pick(s.lines), 2.2);
        }
        if (s.t >= s.length) finish();
      }
    }

    function maybeSolo(dt) {
      if (show || !onStage()) return;
      soloIn -= dt;
      if (soloIn > 0) return;
      soloIn = rnd(45, 90);
      const list = hub.walkers.filter(free);
      if (list.length < 2) return; // (needs someone to play to)
      const w = root.Dialogue.weighted(list.map((x) => [x, 0.3 + (x.trait("humor") + x.trait("energy")) / 100 + (x.record.songs || []).length * 0.2]));
      startSolo(w);
    }

    // ---------- Miis at work ----------
    function tickWork(dt) {
      workIn -= dt;
      if (workIn > 0 || hub.visiting || !L) return;
      workIn = 1;
      for (const w of hub.walkers) {
        const job = town.workingAs(w.record);
        if (!job || w.inShow) continue;
        const j = L.job(job);
        // now and then it says something about its job
        w.jobTalkIn = (w.jobTalkIn === undefined ? rnd(2, 8) : w.jobTalkIn) - 1;
        if (w.jobTalkIn <= 0 && !hub.isBusy(w) && !w.bubble) {
          w.jobTalkIn = rnd(14, 26);
          w.say(pick(j.lines), 2.6);
          w.showEmote(j.icon, 2.6);
        }
        // when it's standing around, it goes and does something work-ish
        if (w.state === "idle" && !hub.isBusy(w) && w.timer < 1.2) {
          const spots = (hub.world.spots || []).filter((s) => j.spots.test(s.activity || "") && !hub.walkers.some((o) => o !== w && o.spot === s));
          if (spots.length && Math.random() < 0.75) { const s = pick(spots); w.spot = s; w.goTo(s.x, s.z); }
        }
      }
    }

    // ---------- back from vacation ----------
    function homecoming(rec, gifts) {
      const w = walkerOf(rec.id);
      const d = gifts && gifts.dest;
      if (!w) return;
      hub.later(w, 1.4, () => {
        w.say(d ? "I'm back from " + d.name + "! " + d.icon : "I'm back!", 3);
        w.showEmote("🧳", 3.5);
        w.arms = "wave";
        w.hop(4);
        hub.later(w, 2, () => { if (w.arms === "wave") w.arms = "down"; });
      });
      // the others say hi
      for (const o of hub.walkers) {
        if (o === w || hub.isBusy(o)) continue;
        hub.later(o, rnd(1.8, 3.2), () => {
          if (hub.isBusy(o)) return;
          o.targetYaw = Math.atan2(w.x - o.x, w.z - o.z);
          o.say(pick(["Welcome back, " + w.look.name + "!", "You're back!", "How was " + (d ? d.name : "your trip") + "?", "Did you bring souvenirs?"]), 2.4);
          o.showEmote("🎉", 2.2);
        });
      }
    }

    function tick(dt) {
      if (show) tickShow(dt);
      else maybeSolo(dt);
      tickWork(dt);
    }

    return { tick, startSolo, startBand, stop, homecoming, stageSpots, get show() { return show; }, set soloIn(v) { soloIn = v; } };
  }

  root.MiiLifeHub = { create };
})(typeof self !== "undefined" ? self : this);
