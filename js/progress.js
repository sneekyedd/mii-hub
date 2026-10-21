/*
 * progress.js
 * Everything that gives you a reason to play:
 *
 *   - Wishes: Miis ask you for things (food, furniture, a game, meeting someone,
 *     making up after a fight, a visit...). Helping makes them happy.
 *   - Mii levels: happiness fills a meter; a full meter = level up, and you pick
 *     a gift for the Mii (a special move, a song, furniture or coins).
 *   - Town level: every wish you grant gives the town XP. Town levels unlock new
 *     things in the shop and new things Miis do together.
 *   - Daily goals, a sticker book, relationships (fights, crushes, couples,
 *     rivals), weather, seasons, festivals and a shop that changes every day.
 *
 * This file is only rules and data (no 3D, no buttons): app.js shows it on screen,
 * hub3d.js and town.js tell it what happens.
 */
(function (root) {
  "use strict";

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // A random number generator that gives the same numbers for the same seed
  // (so "today's" shop and goals stay the same all day).
  function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s >>> 0) / 4294967296));
  }
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
  const daySeed = (key) => { let h = 2166136261; for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------------------------------------------------------------------
  // Gifts a Mii can get when it levels up
  // ---------------------------------------------------------------------
  const MOVES = [
    { id: "spin", name: "Spin", icon: "🌀", desc: "Twirls round and round" },
    { id: "flip", name: "Backflip", icon: "🤸", desc: "A big backflip" },
    { id: "moonwalk", name: "Moonwalk", icon: "🕺", desc: "Slides backwards, smooth as can be" },
    { id: "flex", name: "Flex", icon: "💪", desc: "Shows off its muscles" },
    { id: "bow", name: "Bow", icon: "🙇", desc: "A very polite bow" },
    { id: "sing", name: "Sing", icon: "🎤", desc: "Sings one of its songs" },
  ];
  const SONGS = [
    { id: "sunny", title: "Sunny Day Shuffle", lines: ["♪ The sun is out, so am I! ♪", "♪ Shuffle left, shuffle right! ♪", "♪ Sunny day, all the way! ♪"] },
    { id: "pizza", title: "Pizza Love", lines: ["♪ Cheesy, cheesy, oh so pleasy ♪", "♪ Pizza, you're my one true love ♪", "♪ Extra cheese from up above! ♪"] },
    { id: "moon", title: "Moon Bounce", lines: ["♪ Boing, boing, on the moon ♪", "♪ Earth looks like a blue balloon ♪", "♪ See you there real soon! ♪"] },
    { id: "friends", title: "Best Friends Forever", lines: ["♪ You and me, a perfect pair ♪", "♪ Friends forever, everywhere ♪", "♪ La la la, I'll always care ♪"] },
    { id: "rain", title: "Rainy Window Blues", lines: ["♪ Pitter patter on the glass ♪", "♪ I know this rain will pass ♪", "♪ Bluuues... ♪"] },
    { id: "office", title: "Monday Morning", lines: ["♪ Coffee, coffee, save my day ♪", "♪ Tickets piling all the way ♪", "♪ Is it Friday yet? Nay! ♪"] },
    { id: "lullaby", title: "Starry Lullaby", lines: ["♪ Twinkle stars, sleepy eyes ♪", "♪ Dream of cake and big blue skies ♪", "♪ Hushabye... ♪"] },
    { id: "rock", title: "Mii Rock Anthem", lines: ["♪ WE ARE THE MIIS! ♪", "♪ ROCK ALL NIGHT, ROCK ALL DAY! ♪", "♪ *air guitar solo* ♪"] },
  ];

  // ---------------------------------------------------------------------
  // Town levels: what each one unlocks (no places are locked)
  // ---------------------------------------------------------------------
  const UNLOCKS = [
    { level: 2, key: "picnic", icon: "🧺", text: "Miis can have picnics together" },
    { level: 2, key: "tier2", icon: "🛍️", text: "More furniture and food in the shop" },
    { level: 3, key: "romance", icon: "💗", text: "Miis can get crushes and become couples" },
    { level: 4, key: "karaoke", icon: "🎤", text: "Miis can sing karaoke together" },
    { level: 4, key: "tier3", icon: "🛍️", text: "Fancier furniture and food in the shop" },
    { level: 5, key: "festivals", icon: "🎆", text: "Festivals happen more often" },
    { level: 6, key: "rivals", icon: "⚡", text: "Miis who keep arguing become rivals (and have contests)" },
    { level: 6, key: "tier4", icon: "🛍️", text: "The fanciest things in the shop" },
    { level: 7, key: "stories", icon: "📚", text: "Miis tell each other stories" },
    { level: 8, key: "tier5", icon: "🛍️", text: "Rare foods from far away" },
  ];
  // Rare events: they almost never happen, and only while you're looking at the place
  const HIDDEN_EVENTS = [
    { id: "mustang", icon: "🏎️", name: "Fastback", desc: "Got a honk and a rev from a '69 Mustang on Café Street", hint: "Keep an eye on the traffic on Café Street. Something classic might roll by..." },
    { id: "ufo", icon: "🛸", name: "Close Encounter", desc: "Saw the UFO try (and fail) to beam up a Mii on the Moon", hint: "The UFO on the Moon is up to something. Keep watching the sky..." },
    { id: "crabs", icon: "🦀", name: "Pinch Pinch Shuffle", desc: "Watched the crabs' whole dance party on the Beach", hint: "The crabs on the Beach are practicing something. One day they might put on a show... stay for all of it!" },
    { id: "boo", icon: "👻", name: "Boo!", desc: "Caught a prankster at the window while visiting a Mii's home", hint: "When you visit a Mii at home, glance at the window now and then. Who's that peeking in?" },
    { id: "ducks", icon: "🦆", name: "Duck Parade", desc: "Watched a duck family march right across the Park", hint: "The ducks in the Park sometimes go for a very long walk. Follow them all the way!" },
    { id: "printer", icon: "🖨️", name: "Off and On Again", desc: "Unplugged the haywire printer at the Office", hint: "That printer at the Office isn't as broken as it looks. If it ever acts up, you know what to do..." },
    { id: "koi", icon: "🐟", name: "Golden Koi", desc: "Made the golden koi leap out of the Courtyard pond", hint: "Something shiny sometimes swims in the Courtyard's koi pond. Give it a tap!" },
    { id: "plane", icon: "✈️", name: "Air Mail", desc: "Caught a paper airplane in the College lecture hall", hint: "Someone at the College passes notes in class... by air. Catch one!" },
    { id: "cat", icon: "🐱", name: "Purrformance", desc: "Saw a cat sing on the Concert Stage", hint: "The Concert Stage has a surprise guest star now and then. Stay for the whole show!" },
  ];
  const xpNeeded = (level) => 80 + level * 45; // XP to go from `level` to the next
  const levelCoins = (level) => Math.min(100, 10 * level); // what every Mii gets when the town reaches `level`

  // ---------------------------------------------------------------------
  // Weather, seasons and festivals
  // ---------------------------------------------------------------------
  const WEATHER_ICONS = { sunny: "☀️", cloudy: "⛅", rain: "🌧️", storm: "⛈️", snow: "❄️", windy: "🍃" };
  const SEASON_ICONS = { spring: "🌸", summer: "🌞", autumn: "🍂", winter: "⛄" };
  const FESTIVALS = {
    fireworks: { name: "Fireworks Festival", icon: "🎆", night: true },
    lanterns: { name: "Lantern Festival", icon: "🏮", night: true },
    cherry: { name: "Cherry Blossom Festival", icon: "🌸" },
    spooky: { name: "Spooky Night", icon: "🎃", night: true },
    starfall: { name: "Shooting Star Night", icon: "🌠", night: true },
    snowfest: { name: "Winter Lights", icon: "✨", night: true },
  };
  function seasonOf(date) {
    const m = date.getMonth(); // 0 = January
    return m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
  }
  const WEATHER_BY_SEASON = {
    spring: [["sunny", 4], ["cloudy", 2], ["rain", 2], ["windy", 1.5]],
    summer: [["sunny", 6], ["cloudy", 1.5], ["storm", 0.8], ["rain", 0.7]],
    autumn: [["sunny", 2], ["cloudy", 3], ["rain", 2], ["windy", 2.5], ["storm", 0.5]],
    winter: [["snow", 3.5], ["cloudy", 2.5], ["sunny", 2], ["windy", 0.8]],
  };
  const FESTIVALS_BY_SEASON = {
    spring: ["cherry", "lanterns", "starfall"], summer: ["fireworks", "lanterns", "starfall"],
    autumn: ["spooky", "lanterns", "starfall"], winter: ["snowfest", "fireworks", "starfall"],
  };
  const WEATHER_LINES = {
    sunny: ["What a sunny day!", "I love sunshine!", "Perfect weather!"],
    cloudy: ["Looks a bit gray today.", "I hope it doesn't rain.", "That cloud looks like a sandwich."],
    rain: ["It's raining! ☔", "Pitter patter...", "I forgot my umbrella!", "Splash! Puddles!"],
    storm: ["Eek! Thunder!", "What a storm!", "I'm staying inside today."],
    snow: ["Snow! ❄️", "Let's build a snowman!", "Brrr, so cold!", "Snowball fight?!"],
    windy: ["Whoa, so windy!", "Hold on to your hat!", "Wheee, the wind!"],
  };

  // ---------------------------------------------------------------------
  // The shop: what's for sale depends on the town level and the day
  // ---------------------------------------------------------------------
  // extra foods that show up as the town grows (tier = town level tier)
  const EXTRA_FOODS = [
    { id: "pancakes", name: "Pancakes", icon: "🥞", price: 4, tags: ["sweet"], tier: 2 },
    { id: "hotdog", name: "Hot dog", icon: "🌭", price: 3, tags: ["junk"], tier: 2 },
    { id: "watermelon", name: "Watermelon", icon: "🍉", price: 3, tags: ["healthy", "sweet"], tier: 2 },
    { id: "cupcake", name: "Cupcake", icon: "🧁", price: 4, tags: ["sweet", "cute"], tier: 3 },
    { id: "spaghetti", name: "Spaghetti", icon: "🍝", price: 5, tags: ["fancy"], tier: 3 },
    { id: "dumplings", name: "Dumplings", icon: "🥟", price: 5, tags: ["spicy"], tier: 3 },
    { id: "bento", name: "Bento box", icon: "🍱", price: 6, tags: ["healthy", "fancy"], tier: 4 },
    { id: "chocolate", name: "Fancy chocolate", icon: "🍫", price: 6, tags: ["sweet", "fancy"], tier: 4 },
    { id: "croissant", name: "Croissant", icon: "🥐", price: 4, tags: ["fancy"], tier: 4 },
    { id: "pudding", name: "Pudding", icon: "🍮", price: 5, tags: ["sweet"], tier: 5 },
    { id: "tempura", name: "Tempura", icon: "🍤", price: 7, tags: ["fancy"], tier: 5 },
    { id: "lobster", name: "Lobster", icon: "🦞", price: 12, tags: ["fancy"], tier: 5 },
  ];
  const tierOf = (it) => it.tier || (it.price <= 15 ? 1 : it.price <= 30 ? 2 : it.price <= 45 ? 3 : 4);

  // ---------------------------------------------------------------------
  // Daily goals and stickers
  // ---------------------------------------------------------------------
  const GOALS = [
    { id: "wish", text: "Grant {n} wishes", icon: "💭", n: [3, 5] },
    { id: "food", text: "Give food {n} times", icon: "🍙", n: [2, 4] },
    { id: "game", text: "Play {n} mini-games", icon: "🎮", n: [1, 3] },
    { id: "visit", text: "Visit {n} homes", icon: "🏡", n: [1, 3] },
    { id: "furniture", text: "Buy {n} furniture", icon: "🛋️", n: [1, 2] },
    { id: "sent", text: "Send Miis somewhere {n} times", icon: "📍", n: [2, 3] },
    { id: "poke", text: "Say hi to {n} Miis (click them)", icon: "👋", n: [3, 6] },
    { id: "hangoutSeen", text: "Watch {n} Miis hang out", icon: "👀", n: [3, 5] },
    { id: "view", text: "Look at {n} different places", icon: "🗺️", n: [3, 5] },
    { id: "perform", text: "Ask Miis to do {n} tricks", icon: "✨", n: [2, 4] },
  ];

  function create(opts) {
    const { records, D, H, hub } = opts;
    const T = root.MiiTown;
    // the town's progress (saved with the settings)
    const st = Object.assign({
      xp: 0, level: 1, granted: 0, stickers: {}, pairs: {}, daily: null,
      seen: { places: {}, weather: {}, festivals: {}, foods: {}, furniture: {} },
      wins: { mii: 0, you: 0 }, levelups: 0, shopDay: null, weather: null,
    }, opts.saved || {});
    for (const k of ["places", "weather", "festivals", "foods", "furniture"]) st.seen[k] = st.seen[k] || {};
    const rt = new Map(); // id -> { wishIn }
    const listeners = { change: [], toast: [], levelup: [], townlevel: [], sticker: [], event: [] };
    const emit = (k, ...a) => listeners[k].forEach((f) => f(...a));
    const on = (k, f) => listeners[k].push(f);
    const save = () => opts.saveState(st);
    const changed = () => { save(); emit("change"); };
    const info = (rec) => { if (!rt.has(rec.id)) rt.set(rec.id, { wishIn: rnd(20, 90) }); return rt.get(rec.id); };
    const nameOf = (rec) => rec.name || "?";
    const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
    const pair = (a, b) => { const k = pairKey(a, b); return st.pairs[k] || (st.pairs[k] = {}); };
    const points = (a, b) => hub.friendships[pairKey(a, b)] || 0;
    // sandbox mode (Settings): everything is unlocked
    let sandbox = false;
    const unlocked = (key) => sandbox || UNLOCKS.some((u) => u.key === key && u.level <= st.level);

    // ---------- Mii levels ----------
    function ensure(rec) {
      if (typeof rec.level !== "number") rec.level = 1;
      if (typeof rec.happy !== "number") rec.happy = 0;
      rec.moves = rec.moves || [];
      rec.songs = rec.songs || [];
      rec.foods = rec.foods || {};
      return rec;
    }
    const happyNeeded = (rec) => 3 + ensure(rec).level;

    function addHappy(rec, n) {
      ensure(rec);
      rec.happy = Math.max(0, rec.happy + n);
      while (rec.happy >= happyNeeded(rec)) {
        rec.happy -= happyNeeded(rec);
        rec.level += 1;
        st.levelups += 1;
        addXp(30);
        emit("levelup", rec, giftChoices(rec));
        emit("toast", "⭐ " + nameOf(rec) + " is now level " + rec.level + "!");
      }
      opts.saveMii(rec);
    }

    // Three gifts to pick from when a Mii levels up.
    function giftChoices(rec) {
      const out = [];
      const moves = MOVES.filter((m) => !rec.moves.includes(m.id));
      const songs = SONGS.filter((s) => !rec.songs.includes(s.id));
      if (moves.length) { const m = pick(moves); out.push({ kind: "move", id: m.id, icon: m.icon, title: "Special move: " + m.name, desc: m.desc }); }
      if (songs.length) { const s = pick(songs); out.push({ kind: "song", id: s.id, icon: "🎵", title: "New song: " + s.title, desc: "It can sing it (and do karaoke)" }); }
      const p = D.traits(rec);
      const furn = H.ITEMS.filter((it) => !it.starter && it.price > 0 && !(rec.home && rec.home.owned.includes(it.id)));
      if (furn.length) {
        const loved = furn.filter((it) => H.opinion(p, rec, it) === "love");
        const it = pick(loved.length ? loved : furn);
        out.push({ kind: "furniture", id: it.id, icon: it.icon, title: "Free: " + it.name, desc: "Delivered to its home" });
      }
      const coins = 25 + rec.level * 5;
      out.push({ kind: "coins", n: coins, icon: "🪙", title: coins + " coins", desc: "Spending money for its home" });
      return out.slice(0, 3);
    }

    function applyGift(rec, g) {
      ensure(rec);
      if (g.kind === "move" && !rec.moves.includes(g.id)) rec.moves.push(g.id);
      if (g.kind === "song" && !rec.songs.includes(g.id)) rec.songs.push(g.id);
      if (g.kind === "furniture" && rec.home && !rec.home.owned.includes(g.id)) { rec.home.owned.push(g.id); st.seen.furniture[g.id] = true; }
      if (g.kind === "coins") rec.coins = (rec.coins || 0) + g.n;
      opts.saveMii(rec);
      checkStickers();
      changed();
    }

    // ---------- town level ----------
    function addXp(n) {
      st.xp += n;
      while (st.xp >= xpNeeded(st.level)) {
        st.xp -= xpNeeded(st.level);
        st.level += 1;
        const news = UNLOCKS.filter((u) => u.level === st.level);
        // every Miis gets a little present when the town grows
        for (const r of records.values()) { r.coins = (r.coins || 0) + levelCoins(st.level); opts.saveMii(r); }
        emit("townlevel", st.level, news);
      }
      changed();
    }

    // ---------- wishes ----------
    const placeName = (id) => (T ? T.placeInfo(id).name : id);
    const others = (rec) => Array.from(records.values()).filter((r) => r !== rec);

    // Furniture a Mii could still get for a slot: things in the shop today that it
    // doesn't own yet (what it owns includes what's placed). A Mii only wishes for a
    // new thing in a slot when there's actually something new to buy for it.
    const STYLE_SLOTS = ["wallpaper", "floor"];
    const FURNITURE_SLOTS = H.SLOTS.map((s) => s.id).filter((id) => !STYLE_SLOTS.includes(id));
    function newFor(rec, slot) {
      const owned = (rec.home && rec.home.owned) || [];
      const placed = (rec.home && rec.home.items) || {};
      return shopItems(slot).filter((it) => !it.starter && it.price > 0 && !owned.includes(it.id) && placed[slot] !== it.id);
    }
    const wishSlots = (rec, ids) => H.SLOTS.filter((s) => ids.includes(s.id) && newFor(rec, s.id).length > 0);

    // Each kind of wish: when it can happen, what the Mii says, and what grants it.
    const WISH_TYPES = [
      { type: "hungry", icon: "🍙", w: 1.6, make(rec) {
        const foods = shopFoods();
        if (Math.random() < 0.45 && foods.length) {
          const f = pick(foods);
          return { text: pick(["I'm craving " + f.name.toLowerCase() + "!", "I could really go for some " + f.name.toLowerCase() + "...", f.icon + " " + f.name + "! I need it!"]), food: f.id, icon: f.icon };
        }
        return { text: pick(["I'm starving!", "My tummy is rumbling...", "Snack time? Please?"]) };
      } },
      { type: "newFood", icon: "😋", w: 0.7, make(rec) {
        return { text: pick(["I want to try a food I've never had!", "Surprise me with something new to eat!"]) };
      } },
      { type: "furniture", icon: "🛋️", w: 1.1, can: (rec) => wishSlots(rec, FURNITURE_SLOTS).length > 0, make(rec) {
        const s = pick(wishSlots(rec, FURNITURE_SLOTS));
        return { text: pick(["My " + s.name.toLowerCase() + " is so boring... can I get a new one?", "I want a new " + s.name.toLowerCase() + "!", "I've been dreaming of a new " + s.name.toLowerCase() + "."]), slot: s.id, icon: s.icon };
      } },
      { type: "style", icon: "🎨", w: 0.6, can: (rec) => wishSlots(rec, STYLE_SLOTS).length > 0, make(rec) {
        const s = pick(wishSlots(rec, STYLE_SLOTS)).id;
        return { text: s === "wallpaper" ? "My walls need a makeover!" : "I'm tired of my floor...", slot: s, icon: s === "wallpaper" ? "🧱" : "🟧" };
      } },
      { type: "game", icon: "🎮", w: 1.2, make(rec) {
        const G = root.MiniGames && root.MiniGames.GAMES;
        const g = G ? pick(Object.values(G)) : { id: "rps", name: "Rock Paper Scissors", icon: "✊" };
        return { text: pick(["Play " + g.name + " with me!", "I've been practicing " + g.name + "! Wanna play?", "I bet I can beat you at " + g.name + "!"]), game: g.id, icon: g.icon };
      } },
      { type: "meet", icon: "🤝", w: 0.9, can: (rec) => others(rec).some((o) => points(rec.id, o.id) === 0), make(rec) {
        const o = pick(others(rec).filter((o) => points(rec.id, o.id) === 0));
        return { text: pick(["I'd love to meet " + nameOf(o) + "!", nameOf(o) + " seems nice. Can you introduce us?"]), target: o.id };
      } },
      { type: "makeUp", icon: "🩹", w: 3, can: (rec) => others(rec).some((o) => pair(rec.id, o.id).fight), make(rec) {
        const o = others(rec).find((o) => pair(rec.id, o.id).fight);
        return { text: pick([nameOf(o) + " and I had a fight... 😢", "I said something mean to " + nameOf(o) + "... I feel bad."]), target: o.id };
      } },
      { type: "crush", icon: "💗", w: 0.8, can: (rec) => unlocked("romance") && !partnerOf(rec) && others(rec).some((o) => points(rec.id, o.id) >= 9 && !partnerOf(o)), make(rec) {
        const o = pick(others(rec).filter((o) => points(rec.id, o.id) >= 9 && !partnerOf(o)));
        return { text: pick(["I think I like " + nameOf(o) + "... should I tell them? 💗", "Every time I see " + nameOf(o) + ", my heart goes doki doki!"]), target: o.id };
      } },
      { type: "catchphrase", icon: "💬", w: 0.5, make: () => ({ text: pick(["I want a new catchphrase!", "Can you think of a cool catchphrase for me?"]) }) },
      { type: "visit", icon: "🏠", w: 0.9, make: () => ({ text: pick(["Come visit me at home!", "Want to see my place?", "I'm lonely... come over?"]) }) },
      { type: "goPlace", icon: "📍", w: 0.9, make(rec) {
        const places = (T ? T.available() : []).filter((p) => p.id !== "home" && p.id !== rec.place);
        const p = places.length ? pick(places) : { id: "park", name: "the park", icon: "🌳" };
        return { text: pick(["I want to go to " + p.name + "!", "Take me to " + p.name + "! " + p.icon]), place: p.id, icon: p.icon };
      } },
      { type: "highFive", icon: "✋", w: 0.8, make: () => ({ text: pick(["Give me a high five!", "Say hi to me!", "Boop me! Hehe."]) }) },
      { type: "trick", icon: "✨", w: 0.7, make(rec) {
        const kinds = ["dance", "jump", "wave"].concat(ensure(rec).moves);
        const k = pick(kinds);
        const mv = MOVES.find((m) => m.id === k);
        return { text: "Ask me to " + (mv ? mv.name.toLowerCase() : k) + "! I've been practicing!", kind: k, icon: mv ? mv.icon : k === "dance" ? "💃" : k === "jump" ? "🦘" : "👋" };
      } },
    ];
    const typeOf = (t) => WISH_TYPES.find((w) => w.type === t);

    function makeWish(rec) {
      const options = WISH_TYPES.filter((w) => !w.can || w.can(rec)).map((w) => [w, w.w]);
      if (!options.length) return null;
      const W = D.weighted(options);
      const wish = W.make(rec);
      if (!wish) return null;
      return Object.assign({ type: W.type, icon: wish.icon || W.icon, at: Date.now(), left: 480 }, wish);
    }

    function wishOf(rec) { return rec.wish || null; }

    // How many wishes can be waiting at once (pretty needy!)
    const maxWishes = () => Math.min(4, Math.max(1, Math.ceil(records.size * 0.25)));

    function grant(rec, how) {
      const w = rec.wish;
      if (!w) return;
      rec.wish = null;
      st.granted += 1;
      const bonus = how && how.bonus ? how.bonus : 0;
      const coins = Math.round(rnd(5, 10) + rec.level * 1.5 + bonus * 4);
      rec.coins = (rec.coins || 0) + coins;
      info(rec).wishIn = rnd(60, 150);
      emit("event", { type: "wishGranted", rec, wish: w, coins });
      emit("toast", "💭 " + nameOf(rec) + "'s wish came true! +" + coins + " 🪙");
      daily("wish");
      addXp(20 + bonus * 5);
      addHappy(rec, 1 + bonus);
      checkStickers();
      changed();
    }

    // Something happened in the game: does it grant any wishes / count for goals?
    function event(e) {
      const rec = e.id ? records.get(e.id) : null;
      if (rec) ensure(rec);
      switch (e.type) {
        case "food": {
          const f = e.food;
          st.seen.foods[f.id] = true;
          const first = !rec.foods[f.id];
          rec.foods[f.id] = true;
          daily("food");
          const w = rec.wish;
          if (w && w.type === "hungry" && (!w.food || w.food === f.id)) grant(rec, { bonus: w.food ? 1 : e.opinion === "love" ? 1 : 0 });
          else if (w && w.type === "newFood" && first) grant(rec, { bonus: 0 });
          else if (e.opinion === "love") addHappy(rec, 1);
          break;
        }
        case "furniture": {
          st.seen.furniture[e.item.id] = true;
          daily("furniture");
          const w = rec.wish;
          if (w && (w.type === "furniture" || w.type === "style") && w.slot === e.item.slot && !e.item.starter) grant(rec, { bonus: e.opinion === "love" ? 1 : 0 });
          else if (e.opinion === "love") addHappy(rec, 1);
          break;
        }
        case "game": {
          daily("game");
          if (e.result === "mii") st.wins.mii += 1;
          if (e.result === "you") st.wins.you += 1;
          addXp(5);
          const w = rec.wish;
          if (w && w.type === "game" && w.game === e.game) grant(rec, { bonus: e.result === "mii" ? 1 : 0 });
          break;
        }
        case "visit": daily("visit"); if (rec.wish && rec.wish.type === "visit") grant(rec); break;
        case "catchphrase": if (rec.wish && rec.wish.type === "catchphrase") grant(rec); break;
        case "sent": daily("sent"); if (rec.wish && rec.wish.type === "goPlace" && rec.wish.place === e.place) grant(rec); break;
        case "poke": daily("poke", e.id); if (rec.wish && rec.wish.type === "highFive") grant(rec); break;
        case "perform": daily("perform"); if (rec.wish && rec.wish.type === "trick" && rec.wish.kind === e.kind) grant(rec, { bonus: 1 }); break;
        case "view": st.seen.places[e.place] = true; daily("view", e.place); checkStickers(); break;
        case "hangout": hangout(e); break;
      }
      changed();
    }

    // Two Miis hung out (on screen or off): relationships, wishes, stickers.
    function hangout(e) {
      const A = records.get(e.a), B = records.get(e.b);
      if (!A || !B) return;
      const p = pair(A.id, B.id);
      if (e.visible) daily("hangoutSeen");
      for (const [x, y] of [[A, B], [B, A]]) {
        const w = x.wish;
        if (w && w.type === "meet" && w.target === y.id) grant(x, { bonus: 0 });
      }
      if (e.kind === "makeUp") {
        p.fight = false; p.makeUp = false; p.fights = Math.max(0, (p.fights || 0) - 1);
        for (const [x, y] of [[A, B], [B, A]]) if (x.wish && x.wish.type === "makeUp" && x.wish.target === y.id) grant(x, { bonus: 1 });
        emit("toast", "🩹 " + nameOf(A) + " and " + nameOf(B) + " made up!");
        st.seen.madeUp = true;
      } else if (e.kind === "disagree") {
        // arguments sometimes turn into a real fight (dialogue.js decides: grumpy Miis fight more)
        if (e.fight) {
          p.fight = true;
          p.fights = (p.fights || 0) + 1;
          emit("toast", "💢 " + nameOf(A) + " and " + nameOf(B) + " had a fight!");
          if (unlocked("rivals") && p.fights >= 3 && !p.rival) { p.rival = true; emit("toast", "⚡ " + nameOf(A) + " and " + nameOf(B) + " are now rivals!"); }
          // one of them wants your help (soon)
          const who = Math.random() < 0.5 ? A : B;
          if (!who.wish) { who.wish = Object.assign({ type: "makeUp", icon: "🩹", at: Date.now(), left: 600 }, typeOf("makeUp").make(who)); }
        }
      } else if (e.kind === "confess") {
        p.confess = null;
        const c = e.success;
        if (c) {
          A.sweetheart = B.id; B.sweetheart = A.id;
          p.couple = true;
          emit("toast", "💑 " + nameOf(A) + " and " + nameOf(B) + " are now a couple!");
          addHappy(A, 2); addHappy(B, 2);
        } else {
          emit("toast", "💔 " + nameOf(B) + " just wants to be friends with " + nameOf(A) + "...");
        }
        opts.saveMii(A); opts.saveMii(B);
      } else if (e.kind === "rivalry" && p.rival && e.after >= 16) {
        p.rival = false; // best friends now
      }
      if (e.after >= 16 && e.before < 16) st.seen.bestFriends = (st.seen.bestFriends || 0) + 1;
      if (e.after >= 4 && e.before < 4) addXp(5);
      checkStickers();
    }

    function partnerOf(rec) { return rec.sweetheart && records.has(rec.sweetheart) ? records.get(rec.sweetheart) : null; }

    // What the dialogue needs to know about two Miis (see dialogue.js).
    function context(a, b) {
      const p = st.pairs[pairKey(a.id, b.id)] || {};
      const recA = records.get(a.id), recB = records.get(b.id);
      return {
        fight: !!p.fight, makeUp: !!p.makeUp, rival: !!p.rival && unlocked("rivals"),
        couple: !!(recA && recB && recA.sweetheart === recB.id),
        confess: p.confess && p.confess.from === a.id ? p.confess : null,
        unlocked: { picnic: unlocked("picnic"), karaoke: unlocked("karaoke"), stories: unlocked("stories") },
        songs: (recA && recA.songs || []).concat(recB && recB.songs || []).map((id) => SONGS.find((s) => s.id === id)).filter(Boolean),
        weather: st.weather ? st.weather.weather : "sunny",
      };
    }

    // ---------- wish buttons ----------
    // What you can do about a wish (app.js turns these into buttons).
    function wishActions(rec) {
      const w = rec.wish;
      if (!w) return [];
      const acts = [];
      const t = w.type;
      if (t === "hungry" || t === "newFood") acts.push({ id: "food", text: "🍙 Give food" });
      if (t === "furniture" || t === "style") acts.push({ id: "visit", text: "🛋️ Go decorate" });
      if (t === "game") acts.push({ id: "game", text: "🎮 Play" });
      if (t === "visit") acts.push({ id: "visit", text: "🏡 Visit" });
      if (t === "goPlace") acts.push({ id: "send", text: "📍 Take them" });
      if (t === "catchphrase") acts.push({ id: "menu", text: "💬 Change it" });
      if (t === "highFive" || t === "trick") acts.push({ id: "see", text: "👀 Go see" });
      if (t === "meet") acts.push({ id: "together", text: "🤝 Introduce" });
      if (t === "makeUp") acts.push({ id: "makeUp", text: "🩹 Help them make up" });
      if (t === "crush") { acts.push({ id: "confess", text: "💌 Go for it!" }); acts.push({ id: "notYet", text: "Not yet" }); }
      return acts;
    }

    // Brings two Miis to the same place (so they can meet / make up / confess).
    function bringTogether(a, b) {
      const town = opts.town();
      const placeA = a.place === "home" ? "apartments" : a.place;
      if (a.place === "home") town.sendTo(a, placeA);
      if (b.place !== placeA) town.sendTo(b, placeA);
      opts.meetUp(a, b);
    }

    function startMakeUp(rec) {
      const o = records.get(rec.wish && rec.wish.target);
      if (!o) return;
      pair(rec.id, o.id).makeUp = true;
      bringTogether(rec, o);
      changed();
    }

    function startConfession(rec) {
      const o = records.get(rec.wish && rec.wish.target);
      if (!o) return;
      const pts = points(rec.id, o.id);
      const pb = D.traits(o);
      const chance = clamp(0.25 + pts / 40 + pb.kindness / 300 + (pb.social - 50) / 400, 0.15, 0.9);
      pair(rec.id, o.id).confess = { from: rec.id, success: Math.random() < chance };
      rec.wish = null; // the wish is "go for it": the confession is the reward (good or bad)
      st.granted += 1;
      daily("wish");
      addXp(20);
      info(rec).wishIn = rnd(90, 180);
      bringTogether(rec, o);
      changed();
    }

    function dismiss(rec) {
      if (!rec.wish) return;
      rec.wish = null;
      info(rec).wishIn = rnd(60, 150);
      changed();
    }

    // ---------- daily goals ----------
    function rollDaily() {
      const key = today();
      if (st.daily && st.daily.day === key) return;
      const r = seeded(daySeed(key));
      const pool = GOALS.slice();
      const goals = [];
      while (goals.length < 3 && pool.length) {
        const g = pool.splice(Math.floor(r() * pool.length), 1)[0];
        const n = g.n[0] + Math.floor(r() * (g.n[1] - g.n[0] + 1));
        goals.push({ id: g.id, icon: g.icon, text: g.text.replace("{n}", n), n, count: 0, seen: [], claimed: false });
      }
      st.daily = { day: key, goals, bonus: false };
      changed();
    }

    function daily(kind, unique) {
      rollDaily();
      for (const g of st.daily.goals) {
        if (g.id !== kind || g.count >= g.n) continue;
        if (unique !== undefined) { if (g.seen.includes(unique)) continue; g.seen.push(unique); }
        g.count += 1;
        if (g.count >= g.n) emit("toast", "📅 Daily goal done: " + g.text + "!");
      }
    }

    function claim(i) {
      const g = st.daily && st.daily.goals[i];
      if (!g || g.claimed || g.count < g.n) return;
      g.claimed = true;
      for (const r of records.values()) { r.coins = (r.coins || 0) + 8; opts.saveMii(r); }
      addXp(40);
      if (st.daily.goals.every((x) => x.claimed) && !st.daily.bonus) {
        st.daily.bonus = true;
        st.stickers["daily-" + st.daily.day] = true;
        st.dailyStreak = (st.dailyStreak || 0) + 1;
        addXp(60);
        emit("toast", "🌟 All daily goals done! Bonus +60 XP");
      }
      checkStickers();
      changed();
    }

    // ---------- the shop ----------
    const maxTier = () => 1 + ["tier2", "tier3", "tier4", "tier5"].filter(unlocked).length;
    const allFoods = () => H.FOODS.concat(EXTRA_FOODS);
    function shopFoods() {
      const r = seeded(daySeed(today() + "food"));
      const ok = allFoods().filter((f) => tierOf(f) <= maxTier());
      return ok.filter(() => r() < 0.75).slice(0, 12);
    }
    // Furniture for sale today (owned things can always be used).
    function shopItems(slot) {
      const r = seeded(daySeed(today() + slot));
      const ok = H.ITEMS.filter((it) => it.slot === slot && (it.starter || tierOf(it) <= maxTier()));
      return ok.filter((it) => it.starter || r() < 0.8);
    }
    function deals() {
      const r = seeded(daySeed(today() + "deal"));
      const ok = H.ITEMS.filter((it) => !it.starter && it.price > 0 && tierOf(it) <= maxTier());
      const out = [];
      while (out.length < 2 && ok.length) out.push(ok.splice(Math.floor(r() * ok.length), 1)[0].id);
      return out;
    }
    const priceOf = (it) => (deals().includes(it.id) ? Math.ceil(it.price * 0.7) : it.price);
    const lockedTier = (it) => tierOf(it) > maxTier();
    const unlockLevelForTier = (tier) => { const u = UNLOCKS.find((x) => x.key === "tier" + tier); return u ? u.level : 1; };

    // ---------- weather, seasons, festivals ----------
    function rollWeather(force) {
      const now = new Date();
      const season = seasonOf(now);
      const hour = now.getHours();
      const night = hour >= 20 || hour < 6;
      const w = st.weather;
      if (!force && w && w.until > Date.now() && w.season === season) { w.night = night; return; }
      const weather = D.weighted(WEATHER_BY_SEASON[season]);
      // festivals: some days have one (more often at a higher town level), mostly at night
      const r = seeded(daySeed(today() + "fest"));
      const festDay = r() < (unlocked("festivals") ? 0.55 : 0.3);
      let festival = null;
      if (festDay) festival = FESTIVALS_BY_SEASON[season][Math.floor(r() * 3)];
      const month = now.getMonth(), date = now.getDate();
      if (month === 9 && date >= 25) festival = "spooky";
      if (month === 11 && date >= 20) festival = "snowfest";
      if (month === 6 && date === 4) festival = "fireworks";
      if (festival && FESTIVALS[festival].night && !night && Math.random() < 0.6) festival = festival === "cherry" ? "cherry" : null;
      const old = w ? w.weather : null;
      st.weather = { weather: festival && FESTIVALS[festival].night && (weather === "rain" || weather === "storm") ? "cloudy" : weather, season, festival, night, until: Date.now() + rnd(8, 16) * 60000 };
      st.seen.weather[st.weather.weather] = true;
      if (festival) st.seen.festivals[festival] = true;
      if (old && old !== st.weather.weather) emit("toast", WEATHER_ICONS[st.weather.weather] + " The weather changed: " + st.weather.weather + "!");
      checkStickers();
      changed();
    }
    function weather() { if (!st.weather) rollWeather(true); return st.weather; }
    function weatherText() {
      const w = weather();
      let s = (WEATHER_ICONS[w.weather] || "") + " " + w.weather[0].toUpperCase() + w.weather.slice(1) + " · " + SEASON_ICONS[w.season] + " " + w.season[0].toUpperCase() + w.season.slice(1);
      if (w.festival) s += " · " + FESTIVALS[w.festival].icon + " " + FESTIVALS[w.festival].name;
      return s;
    }
    function weatherLine() {
      const w = weather();
      if (w.festival && Math.random() < 0.5) return pick(["It's the " + FESTIVALS[w.festival].name + "!", "I love festivals! " + FESTIVALS[w.festival].icon, "So pretty! " + FESTIVALS[w.festival].icon]);
      return pick(WEATHER_LINES[w.weather] || WEATHER_LINES.sunny);
    }
    // bad weather makes outdoor places less tempting
    function placeMood(place) {
      const w = weather().weather;
      const outdoor = ["park", "beach", "apartments", "stage", "cafe"].includes(place);
      if (w === "rain" || w === "storm") return outdoor ? (place === "cafe" ? 0.8 : 0.4) : 1.5;
      if (w === "snow") return place === "beach" ? 0.3 : outdoor ? 0.8 : 1.2;
      if (w === "sunny") return place === "beach" || place === "park" ? 1.4 : 1;
      return 1;
    }

    // ---------- stickers ----------
    function stickerPages() {
      const t = st;
      const foods = allFoods();
      const furn = H.ITEMS.filter((it) => !it.starter);
      const places = T ? T.available().filter((p) => p.id !== "home") : [];
      const couples = Object.values(t.pairs).filter((p) => p.couple).length;
      const maxMiiLevel = Math.max(1, ...Array.from(records.values()).map((r) => r.level || 1));
      const masters = Array.from(records.values()).some((r) => r.games && Object.values(r.games).some((g) => g.skill >= 90));
      return [
        { name: "Food", icon: "🍙", stickers: foods.map((f) => ({ id: "food-" + f.id, icon: f.icon, name: f.name, desc: "A Mii ate " + f.name.toLowerCase(), got: !!t.seen.foods[f.id] })) },
        { name: "Furniture", icon: "🛋️", stickers: furn.map((it) => ({ id: "furn-" + it.id, icon: it.icon, name: it.name, desc: "Got a " + it.name.toLowerCase(), got: !!t.seen.furniture[it.id] })) },
        { name: "Places", icon: "🗺️", stickers: places.map((p) => ({ id: "place-" + p.id, icon: p.icon, name: p.name[0].toUpperCase() + p.name.slice(1), desc: "Looked at " + p.name, got: !!t.seen.places[p.id] })) },
        { name: "Weather & Festivals", icon: "🌈", stickers: Object.keys(WEATHER_ICONS).map((k) => ({ id: "w-" + k, icon: WEATHER_ICONS[k], name: k[0].toUpperCase() + k.slice(1), desc: "Saw " + k + " weather", got: !!t.seen.weather[k] }))
          .concat(Object.keys(FESTIVALS).map((k) => ({ id: "f-" + k, icon: FESTIVALS[k].icon, name: FESTIVALS[k].name, desc: "Was there for the " + FESTIVALS[k].name, got: !!t.seen.festivals[k] }))) },
        { name: "Friends & Love", icon: "💖", stickers: [
          { id: "bf1", icon: "💖", name: "Best Friends", desc: "Two Miis became best friends", got: (t.seen.bestFriends || 0) >= 1 },
          { id: "bf5", icon: "💞", name: "Friendship Town", desc: "5 pairs of best friends", got: (t.seen.bestFriends || 0) >= 5 },
          { id: "couple1", icon: "💑", name: "First Couple", desc: "Two Miis became a couple", got: couples >= 1 },
          { id: "couple3", icon: "💒", name: "Love Is in the Air", desc: "3 couples in town", got: couples >= 3 },
          { id: "madeup", icon: "🩹", name: "Peacemaker", desc: "Helped two Miis make up", got: !!t.seen.madeUp },
          { id: "rival", icon: "⚡", name: "Rivals!", desc: "Two Miis became rivals", got: Object.values(t.pairs).some((p) => p.rival) },
        ] },
        { name: "Games", icon: "🎮", stickers: [
          { id: "g-you1", icon: "🏆", name: "First Win", desc: "You beat a Mii at a game", got: t.wins.you >= 1 },
          { id: "g-you20", icon: "👑", name: "Champion", desc: "You won 20 games", got: t.wins.you >= 20 },
          { id: "g-mii1", icon: "😅", name: "Good Sport", desc: "A Mii beat you", got: t.wins.mii >= 1 },
          { id: "g-master", icon: "🧠", name: "Master Player", desc: "A Mii became a Master at a game", got: masters },
        ] },
        { name: "Town", icon: "🏙️", stickers: [
          { id: "t-wish1", icon: "💭", name: "Wish Granter", desc: "Granted a wish", got: t.granted >= 1 },
          { id: "t-wish25", icon: "🌠", name: "Fairy Godparent", desc: "Granted 25 wishes", got: t.granted >= 25 },
          { id: "t-wish100", icon: "🪄", name: "Wish Wizard", desc: "Granted 100 wishes", got: t.granted >= 100 },
          { id: "t-lv3", icon: "🏘️", name: "Growing Town", desc: "Town level 3", got: t.level >= 3 },
          { id: "t-lv6", icon: "🏙️", name: "Busy Town", desc: "Town level 6", got: t.level >= 6 },
          { id: "t-lv10", icon: "🌆", name: "Big City", desc: "Town level 10", got: t.level >= 10 },
          { id: "t-mii5", icon: "⭐", name: "Rising Star", desc: "A Mii reached level 5", got: maxMiiLevel >= 5 },
          { id: "t-mii10", icon: "🌟", name: "Superstar", desc: "A Mii reached level 10", got: maxMiiLevel >= 10 },
          { id: "t-daily", icon: "📅", name: "Busy Day", desc: "Finished all daily goals", got: (t.dailyStreak || 0) >= 1 },
          { id: "t-daily7", icon: "🗓️", name: "Every Day!", desc: "Finished all daily goals 7 times", got: (t.dailyStreak || 0) >= 7 },
        ] },
        // rare things that only happen while you're watching: the page is "???" until you've seen one
        (() => {
          const h = t.seen.hidden || {};
          const list = HIDDEN_EVENTS.map((e) => ({ id: "h-" + e.id, icon: e.icon, name: e.name, desc: e.desc, hint: e.hint, got: !!h[e.id] }));
          const any = list.some((x) => x.got);
          return { name: any ? "Hidden Events" : "???", icon: any ? "✨" : "❔", hidden: true, stickers: list };
        })(),
      ];
    }
    // a rare event (see HIDDEN_EVENTS) was seen in full
    function hiddenEvent(id) {
      if (!HIDDEN_EVENTS.some((e) => e.id === id)) return;
      st.seen.hidden = st.seen.hidden || {};
      if (st.seen.hidden[id]) return;
      st.seen.hidden[id] = true;
      checkStickers();
      changed();
    }
    function checkStickers() {
      if (st.lock) return; // (sandbox / fast simulation: no stickers)
      for (const page of stickerPages()) for (const s of page.stickers) {
        if (s.got && !st.stickers[s.id] && !(st.voided && st.voided[s.id])) {
          st.stickers[s.id] = true;
          emit("sticker", s);
        }
      }
    }

    // ---------- sandbox mode and simulation speed (Settings) ----------
    // While either is on, no stickers can be earned. Things you see or do meanwhile
    // (places, weather, foods, furniture, wins, wishes...) are forgotten when it goes
    // off, so you can still earn those stickers properly later. Milestones that can't
    // be undone (a couple, a town level...) reached meanwhile never give their sticker.
    function setStickerLock(on) {
      if (on && !st.lock) {
        st.lock = { seen: JSON.parse(JSON.stringify(st.seen)), wins: Object.assign({}, st.wins), granted: st.granted, dailyStreak: st.dailyStreak || 0 };
        save();
      } else if (!on && st.lock) {
        const l = st.lock;
        st.seen = l.seen; st.wins = l.wins; st.granted = l.granted; st.dailyStreak = l.dailyStreak;
        st.lock = null;
        st.voided = st.voided || {};
        for (const page of stickerPages()) for (const s of page.stickers) if (s.got && !st.stickers[s.id]) st.voided[s.id] = true;
        changed();
      }
    }
    function setSandbox(on) { sandbox = !!on; }

    // ---------- the clock ----------
    let weatherIn = 0;
    function tick(dt) {
      rollDaily();
      weatherIn -= dt;
      if (weatherIn <= 0) { weatherIn = 30; rollWeather(false); }
      const waiting = Array.from(records.values()).filter((r) => r.wish).length;
      for (const rec of records.values()) {
        ensure(rec);
        const r = info(rec);
        if (rec.wish) {
          // (a furniture wish that can't come true any more, e.g. it got the last one as a gift, goes away quietly)
          if ((rec.wish.type === "furniture" || rec.wish.type === "style") && rec.wish.slot && !newFor(rec, rec.wish.slot).length) {
            rec.wish = null;
            r.wishIn = rnd(20, 60);
            opts.saveMii(rec);
            changed();
            continue;
          }
          rec.wish.left -= dt;
          if (rec.wish.left <= 0) {
            emit("event", { type: "wishExpired", rec, wish: rec.wish });
            rec.wish = null;
            rec.happy = Math.max(0, rec.happy - 1);
            r.wishIn = rnd(60, 150);
            opts.saveMii(rec);
            changed();
          }
          continue;
        }
        r.wishIn -= dt;
        if (r.wishIn <= 0) {
          // (the more Miis in town, the longer each one waits, so the town doesn't drown in wishes)
          r.wishIn = rnd(80, 180) * Math.max(1, records.size / 4);
          if (waiting >= maxWishes()) continue;
          const w = makeWish(rec);
          if (w) { rec.wish = w; opts.saveMii(rec); emit("event", { type: "newWish", rec, wish: w }); changed(); }
        }
      }
      // pending confessions between Miis who aren't on screen happen by themselves
      for (const [key, p] of Object.entries(st.pairs)) {
        if (!p.confess) continue;
        p.confess.wait = (p.confess.wait || 0) + dt;
        if (p.confess.wait > 40) {
          const [a, b] = key.split("|");
          const from = p.confess.from, to = from === a ? b : a;
          if (opts.offscreen(from, to, "confess")) p.confess = null;
        }
      }
      for (const [key, p] of Object.entries(st.pairs)) {
        if (!p.makeUp) continue;
        p.makeUpWait = (p.makeUpWait || 0) + dt;
        if (p.makeUpWait > 45) { const [a, b] = key.split("|"); if (opts.offscreen(a, b, "makeUp")) { p.makeUpWait = 0; } }
      }
    }

    function forget(id) {
      rt.delete(id);
      for (const k of Object.keys(st.pairs)) if (k.split("|").includes(id)) delete st.pairs[k];
      for (const r of records.values()) if (r.sweetheart === id) r.sweetheart = null;
    }

    rollDaily();
    rollWeather(false);

    return {
      state: st, on, tick, event, ensure, happyNeeded, addHappy, applyGift, makeWish, wishOf, wishActions, grant, dismiss,
      startMakeUp, startConfession, bringTogether, context, partnerOf, claim, rollDaily, weather, weatherText, weatherLine,
      placeMood, stickerPages, shopFoods, shopItems, newFor, deals, priceOf, lockedTier, unlockLevelForTier, tierOf, allFoods,
      xpNeeded, levelCoins, unlocked, hiddenEvent, HIDDEN_EVENTS, forget, pair, MOVES, SONGS, UNLOCKS, FESTIVALS,
      setStickerLock, setSandbox, stickersLocked: () => !!st.lock, isVoided: (id) => !!(st.voided && st.voided[id]),
    };
  }

  root.MiiProgress = { create, MOVES, SONGS, UNLOCKS, EXTRA_FOODS, FESTIVALS };
})(typeof self !== "undefined" ? self : this);
