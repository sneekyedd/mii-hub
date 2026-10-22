/*
 * life.js
 * The bigger things in a Mii's life (rules and data only, no 3D):
 *
 *   - Outfits: clothes you buy for a Mii (shirt and pants colors, plus a hat or
 *     some other little extra). The wardrobe in its room grows as it owns more.
 *   - Jobs: every Mii has a job it goes to every so often (a "shift"), wearing
 *     a uniform, and it gets paid at the end of the shift.
 *   - Vacations: now and then a Mii goes away for a while (real time, saved).
 *     It comes back with lots of coins and souvenirs for its home.
 *   - Bands: a few helpers for the band wish (see progress.js).
 *
 * town.js moves Miis to work, app.js shows the shops, lifeHub.js shows it all in 3D.
 */
(function (root) {
  "use strict";

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // a number that's always the same for the same text
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------------------------------------------------------------------
  // Outfits
  // ---------------------------------------------------------------------
  // shirt / pants: new colors for the Mii's clothes. extras: little 3D things it
  // wears (see lifeModels.js): cap, beanie, tophat, crown, bow, sunhat, cowboy,
  // headband, nightcap, glasses, headset, visor, backpack, whistle, scarf, badge, cape, mortarboard
  const OUTFITS = [
    { id: "sporty", name: "Sporty tracksuit", icon: "🏃", price: 25, shirt: "#e8413c", pants: "#2b2f3a", extras: ["headband"], tags: ["sporty"] },
    { id: "cozy", name: "Cozy knit", icon: "🧶", price: 22, shirt: "#d9b48a", pants: "#6b4f2a", extras: ["beanie", "scarf"], tags: ["cozy"] },
    { id: "suit", name: "Fancy suit", icon: "🎩", price: 55, shirt: "#24242c", pants: "#24242c", extras: ["tophat"], tags: ["fancy"] },
    { id: "princess", name: "Royal gown", icon: "👑", price: 60, shirt: "#ff8fc8", pants: "#ff8fc8", extras: ["crown"], tags: ["fancy", "cute"] },
    { id: "street", name: "Street style", icon: "🧢", price: 30, shirt: "#ffd23f", pants: "#3b5b9a", extras: ["cap"], tags: ["silly", "sporty"] },
    { id: "beach", name: "Beach day", icon: "👒", price: 20, shirt: "#4fd6c8", pants: "#ff9f43", extras: ["sunhat", "glasses"], tags: ["nature"] },
    { id: "cowboy", name: "Cowboy", icon: "🤠", price: 35, shirt: "#c46a3a", pants: "#3d5a8a", extras: ["cowboy"], tags: ["silly", "nature"] },
    { id: "pajamas", name: "Starry pajamas", icon: "🌙", price: 18, shirt: "#9fc3ff", pants: "#9fc3ff", extras: ["nightcap"], tags: ["cozy", "cute"] },
    { id: "hero", name: "Superhero", icon: "🦸", price: 45, shirt: "#2f6fe0", pants: "#d93636", extras: ["cape"], tags: ["silly", "sporty"] },
    { id: "bow", name: "Sweet bow dress", icon: "🎀", price: 28, shirt: "#ffffff", pants: "#ff6fa5", extras: ["bow"], tags: ["cute"] },
    { id: "nerd", name: "Smart sweater", icon: "🤓", price: 24, shirt: "#5a8a5a", pants: "#8a7a5a", extras: ["glasses"], tags: ["techy"] },
    { id: "rocker", name: "Rock star", icon: "🎸", price: 40, shirt: "#1c1c22", pants: "#5a1c2a", extras: ["glasses", "badge"], tags: ["silly", "techy"] },
  ];
  const outfit = (id) => OUTFITS.find((o) => o.id === id) || null;

  // Makes sure a saved Mii has a wardrobe (old saves don't).
  function ensureWardrobe(rec) {
    if (!rec.wardrobe || !Array.isArray(rec.wardrobe.owned)) rec.wardrobe = { owned: [], wearing: null };
    rec.wardrobe.owned = rec.wardrobe.owned.filter((id) => outfit(id));
    if (rec.wardrobe.wearing && !rec.wardrobe.owned.includes(rec.wardrobe.wearing)) rec.wardrobe.wearing = null;
    return rec.wardrobe;
  }

  // How big the wardrobe in the Mii's room is: 0 (small) .. 4 (huge), by how many outfits it owns.
  const WARDROBE_STEPS = [0, 2, 4, 7, 10];
  function wardrobeLevel(rec) {
    const n = rec && rec.wardrobe && rec.wardrobe.owned ? rec.wardrobe.owned.length : 0;
    let lv = 0;
    WARDROBE_STEPS.forEach((min, i) => { if (n >= min) lv = i; });
    return lv;
  }

  // ---------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------
  // place: where the job is (a place id from town.js). pay: coins per shift (at level 1).
  // uniform: what the Mii wears at work. spots: what it does there (activity names
  // of the place's spots, see world3d.js / places-*.js).
  const JOBS = [
    { id: "helpdesk", name: "IT help desk", icon: "💻", place: "office", pay: 14,
      uniform: { shirt: "#6fa8dc", pants: "#2b3a67", extras: ["headset", "badge"] },
      spots: /help desk|fixing a computer|tickets|servers|network/i,
      lines: ["Have you tried turning it off and on again?", "Ticket closed!", "Who unplugged the server?!", "Hello, IT help desk!", "One sec, it's updating..."] },
    { id: "astronaut", name: "Astronaut", icon: "🧑‍🚀", place: "space", pay: 20,
      uniform: { shirt: "#f2f2f2", pants: "#f2f2f2", extras: ["badge"] },
      spots: /rocket|rover|flag|crystals|space garden/i,
      lines: ["Mission control, all good up here!", "Checking the oxygen levels...", "One small step for a Mii!", "Rover systems: go!"] },
    { id: "lifeguard", name: "Lifeguard", icon: "🛟", place: "beach", pay: 12,
      uniform: { shirt: "#e53935", pants: "#e53935", extras: ["visor", "whistle"] },
      spots: /lifeguard|swimming|looking at the sea|surfing/i,
      lines: ["*TWEET* No running by the water!", "Swim between the flags!", "Everyone stay safe out there!", "Sunscreen, everybody!"] },
    { id: "teacher", name: "Teacher", icon: "🧑‍🏫", place: "school", pay: 16,
      uniform: { shirt: "#8a5a3c", pants: "#4a4a52", extras: ["glasses"] },
      spots: /lecture|globe|lab experiment/i,
      lines: ["Settle down, class!", "Today's lesson is very important!", "Who knows the answer?", "Homework is due on Monday!"] },
    { id: "student", name: "Student", icon: "🎒", place: "school", pay: 5,
      uniform: { shirt: "#3f7fbf", pants: "#2b2f3a", extras: ["backpack"] }, // (no graduation cap: they haven't graduated yet!)
      spots: /notes|study|lockers|recital|easel/i,
      lines: ["Is this on the test?", "*scribble scribble*", "I love this class!", "Can I borrow a pencil?"] },
  ];
  const job = (id) => JOBS.find((j) => j.id === id) || null;

  // A job that suits a Mii's personality (always the same one for the same Mii).
  function pickJob(personality, id) {
    const p = Object.assign({ energy: 50, social: 50, chatty: 50, humor: 50, kindness: 50 }, personality || {});
    const h = hash(String(id || "mii") + "|job");
    if (h % 5 === 0) return "student"; // about one in five Miis is still studying
    const score = {
      helpdesk: (100 - p.humor) + (100 - p.social) * 0.5,
      astronaut: p.energy + p.humor * 0.4 + (100 - p.social) * 0.3,
      lifeguard: p.energy * 0.9 + p.kindness * 0.6,
      teacher: p.kindness * 0.6 + p.chatty * 0.6 + (100 - p.humor) * 0.4,
    };
    let best = "helpdesk", bestV = -1;
    Object.keys(score).forEach((k, i) => {
      const v = score[k] + ((h >>> (4 + i * 5)) % 25); // a little luck
      if (v > bestV) { bestV = v; best = k; }
    });
    return best;
  }

  // Coins for one shift: more for higher-level (more experienced) Miis.
  function jobPay(jobId, level) {
    const j = job(jobId);
    if (!j) return 0;
    return Math.round(j.pay * (1 + 0.08 * Math.max(0, (level || 1) - 1)));
  }
  // How long a shift lasts, and the time between shifts (seconds of play).
  const shiftLength = () => rnd(120, 200);
  const shiftGap = () => rnd(360, 720);

  function ensureJob(rec) {
    if (!rec.job || !job(rec.job)) rec.job = pickJob(rec.personality, rec.id);
    return rec.job;
  }

  // ---------------------------------------------------------------------
  // Vacations
  // ---------------------------------------------------------------------
  // souvenirs: furniture ids the Mii might bring back for its home
  const DESTINATIONS = [
    { id: "hawaii", name: "Hawaii", icon: "🌺", souvenirs: ["bed-hammock", "art-sunset", "plant-pot", "rug-leaf", "floor-grass"] },
    { id: "paris", name: "Paris", icon: "🗼", souvenirs: ["art-starry", "table-tea", "lamp-chandelier", "floor-parquet", "sofa-egg"] },
    { id: "tokyo", name: "Tokyo", icon: "🗾", souvenirs: ["bed-futon", "floor-tatami", "plant-bonsai", "tv-arcade", "special-robot"] },
    { id: "safari", name: "a safari", icon: "🦁", souvenirs: ["plant-tree", "art-photos", "rug-leaf", "wall-leaves", "special-fishtank"] },
    { id: "mountains", name: "the mountains", icon: "🏔️", souvenirs: ["sofa-rocking", "rug-shag", "plant-cactus", "art-photos", "lamp-moon"] },
    { id: "spacecamp", name: "space camp", icon: "🛰️", souvenirs: ["special-telescope", "rug-space", "lamp-lava", "wall-stars", "tv-console"] },
  ];
  const destination = (id) => DESTINATIONS.find((d) => d.id === id) || DESTINATIONS[0];
  const MINUTE = 60000;
  // a vacation lasts a few "days" in town: 40 minutes to 2 hours of real time
  const vacationLength = () => Math.round(rnd(40, 120)) * MINUTE;
  // coins it brings home: lots!
  const vacationCoins = (level) => Math.round(rnd(45, 80) + (level || 1) * 6);

  // Up to 3 souvenirs it doesn't own yet (from where it went, or anything if it has all of those).
  function pickSouvenirs(rec, dest, H, n) {
    const owned = (rec.home && rec.home.owned) || [];
    const ok = (id) => { const it = H && H.item(id); return it && !owned.includes(id); };
    let pool = destination(dest).souvenirs.filter(ok);
    if (pool.length < 2 && H) pool = pool.concat(H.ITEMS.filter((it) => !it.starter && it.price > 0 && !owned.includes(it.id) && !pool.includes(it.id)).map((it) => it.id));
    const out = [];
    const count = n || 2 + (Math.random() < 0.5 ? 1 : 0);
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }

  // How long until it's back, for the side panel ("back in 25 min").
  function backIn(rec, now) {
    const v = rec && rec.vacation;
    if (!v) return "";
    const m = Math.max(0, Math.ceil((v.until - (now || Date.now())) / MINUTE));
    return m <= 1 ? "back any minute" : m < 60 ? "back in " + m + " min" : "back in " + Math.round(m / 60 * 2) / 2 + " h";
  }

  /*
   * The vacation clock. opts = {
   *   records, H, D,
   *   leave(rec), comeBack(rec, gifts)  (town.js moves it; the app shows the homecoming)
   *   canLeave(rec) -> false if it's busy (you're visiting it, it's at work...)
   *   saveMii(rec), feed(text), now() (for tests)
   * }
   */
  function create(opts) {
    const { records, H } = opts;
    const now = () => (opts.now ? opts.now() : Date.now());
    const rt = new Map(); // id -> seconds of play until it might go on vacation
    const away = () => Array.from(records.values()).filter((r) => r.vacation);
    // only a few at a time, and never the last ones in town
    const maxAway = () => (records.size < 4 ? 0 : Math.max(1, Math.floor(records.size / 5)));
    const wait = () => rnd(900, 2400) * Math.max(1, records.size / 6);

    function start(rec, destId, length) {
      if (rec.vacation) return false;
      const d = destId ? destination(destId) : pick(DESTINATIONS);
      rec.vacation = { dest: d.id, from: now(), until: now() + (length || vacationLength()) };
      rec.wish = null;
      opts.leave(rec, d);
      opts.saveMii(rec);
      if (opts.feed) opts.feed(rec.name + " went on vacation to " + d.name + "! " + d.icon);
      return true;
    }

    function finish(rec) {
      const v = rec.vacation;
      if (!v) return null;
      const d = destination(v.dest);
      const coins = vacationCoins(rec.level);
      const souvenirs = pickSouvenirs(rec, d.id, H);
      rec.coins = (rec.coins || 0) + coins;
      if (rec.home) for (const id of souvenirs) if (!rec.home.owned.includes(id)) rec.home.owned.push(id);
      rec.vacation = null;
      rec.trips = (rec.trips || 0) + 1;
      const gifts = { dest: d, coins, souvenirs };
      opts.comeBack(rec, gifts);
      opts.saveMii(rec);
      return gifts;
    }

    function tick(dt) {
      const t = now();
      for (const rec of records.values()) {
        if (rec.vacation) { if (t >= rec.vacation.until) finish(rec); continue; }
        if (!rt.has(rec.id)) rt.set(rec.id, wait());
        rt.set(rec.id, rt.get(rec.id) - dt);
        if (rt.get(rec.id) > 0) continue;
        rt.set(rec.id, wait());
        if (away().length >= maxAway() || rec.wish || (opts.canLeave && !opts.canLeave(rec))) continue;
        // adventurous Miis travel more
        const p = opts.D ? opts.D.traits(rec) : { energy: 50 };
        if (Math.random() < 0.35 + p.energy / 200) start(rec);
      }
    }

    function forget(id) { rt.delete(id); }
    return { tick, start, finish, forget, maxAway, away };
  }

  // ---------------------------------------------------------------------
  // Bands
  // ---------------------------------------------------------------------
  // Where each band member stands on the concert stage, in this order.
  const BAND_PARTS = [
    { id: "vocals", name: "vocals", icon: "🎤" },
    { id: "drums", name: "drums", icon: "🥁" },
    { id: "keys", name: "keyboard", icon: "🎹" },
    { id: "guitar", name: "guitar", icon: "🎸" },
    { id: "bass", name: "bass", icon: "🎸" },
  ];
  const BAND_SIZE = 4; // members the leader needs (besides itself)
  // Would this Mii join? Friends, energetic and silly Miis say yes more.
  function joinChance(points, personality) {
    const p = Object.assign({ energy: 50, humor: 50, social: 50 }, personality || {});
    return clamp(0.3 + (points || 0) / 30 + (p.energy + p.humor + p.social - 150) / 400, 0.2, 0.92);
  }

  root.MiiLife = {
    OUTFITS, outfit, ensureWardrobe, wardrobeLevel, WARDROBE_STEPS,
    JOBS, job, pickJob, jobPay, shiftLength, shiftGap, ensureJob,
    DESTINATIONS, destination, vacationLength, vacationCoins, pickSouvenirs, backIn, create, MINUTE,
    BAND_PARTS, BAND_SIZE, joinChance, hash,
  };
})(typeof self !== "undefined" ? self : this);
