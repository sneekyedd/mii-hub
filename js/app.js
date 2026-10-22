/*
 * app.js
 * Connects the buttons and side panels on the page to the 3D hub,
 * loads/saves the Miis, and runs home visits (decorating and food).
 */
(async function () {
  "use strict";

  const M = window.MiiModel;
  const D = window.Dialogue;
  const S = window.MiiStorage;
  const H = window.MiiHomes;
  const $ = (id) => document.getElementById(id);
  const errorMsg = $("errorMsg");
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // colors for the random Miis (your own Miis keep the colors from Mii Creator)
  const SKINS = ["#ffd3ad", "#ffb669", "#de7942", "#ffaa8c", "#ad5129", "#632c18"];
  const HAIRS = ["#1e1a18", "#402010", "#5c1812", "#7c3a14", "#787878", "#4e3e10", "#84581c", "#d0a04a"];
  const SHIRTS = M.FAVORITE_COLORS.map((c) => c.hex).concat(["#191f40"]);
  const PANTS = ["#40464e", "#2b3a67", "#1c1c1c", "#6b4f2a", "#c9b38a", "#5a6b3a", "#e0e0e0"];
  const EYES = ["#0a4a35", "#000000", "#6c7070", "#663c2c", "#4870a0", "#605e30"];

  // Wait for the rounded font, so signs and posters drawn in 3D use it too.
  try {
    await Promise.all(["400", "700", "800"].map((w) => document.fonts.load(w + " 20px Nunito")));
  } catch (e) { /* the font is optional */ }

  const splash = window.MiiSplash || { set() {}, done() {} };
  splash.set(45, "Building the town…");
  // ---------- the hub ----------
  const hub = new window.MiiHub3D.Hub3D($("hub"), $("overlay"));
  // sign in (or play offline) first: account.js puts the right world on this device
  if (window.MiiAccount) await window.MiiAccount.ready;
  const settings = S.loadSettings();
  hub.friendships = settings.friendships || {};
  hub.chattiness = settings.chattiness || 1;
  // Settings (⚙️): light/dark mode, sandbox mode, simulation speed
  const prefs = {
    theme: settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system",
    sandbox: !!settings.sandbox,
    simSpeed: [1, 2, 4].includes(settings.simSpeed) ? settings.simSpeed : 1,
  };
  hub.timeScale = prefs.simSpeed;
  hub.setScene(settings.scene && window.World3D.list.some((l) => l.id === settings.scene) ? settings.scene : "park");

  // ---------- every Mii you have (out and about, or at home) ----------
  const records = new Map(); // id -> record
  const infos = new Map();   // id -> info from the .glb (name, height...)
  const loaded = new Map();  // id -> loaded 3D template (for Miis seen through windows)
  const T = window.MiiTown;
  // the place you're looking at (not counting a home visit)
  const viewedPlace = () => (hub.visiting ? hub.mainWorld && hub.mainWorld.id : hub.world.id);
  const isHome = (rec) => rec.place === "home";

  // ---------- templates (one per .glb file) ----------
  const templates = new Map();
  function base64ToBuffer(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.buffer;
  }
  function sampleTemplate() {
    if (!templates.has("sample")) {
      const s = window.SAMPLE_GLBS[0];
      templates.set("sample", M.loadTemplate(base64ToBuffer(s.base64), s.fileName));
    }
    return templates.get("sample");
  }
  function templateFor(record) {
    if (record.kind === "glb") {
      if (!templates.has(record.id)) templates.set(record.id, M.loadTemplate(record.bytes.slice(0), record.fileName));
      return templates.get(record.id);
    }
    return sampleTemplate();
  }

  function lookFor(record, template) {
    // Your own Miis look exactly like they do in Mii Creator. Only the random
    // Miis get colors picked here.
    const look = record.kind === "demo" ? Object.assign({}, record.look || {}) : {};
    look.name = record.name || template.info.name;
    look.favoriteColorName = M.colorName(look.shirt || template.source.shirt, "top");
    // clothes (life.js): its uniform while it's at work, otherwise the outfit it's wearing
    const fit = outfitOf(record);
    if (fit) { look.shirt = fit.shirt; look.pants = fit.pants; look.extras = fit.extras; }
    return look;
  }
  const LF = window.MiiLife;
  let lifeTown = null; // (the town, once it's made: lookFor is used before that)
  function outfitOf(record) {
    if (!LF) return null;
    const job = lifeTown && lifeTown.workingAs(record);
    if (job) return LF.job(job).uniform;
    return record.wardrobe && record.wardrobe.wearing ? LF.outfit(record.wardrobe.wearing) : null;
  }
  const outfitKey = (record) => { const f = outfitOf(record); return f ? "|" + f.shirt + f.pants + (f.extras || []).join(",") : ""; };

  const nameOf = (rec) => rec.name || (infos.get(rec.id) || {}).name || "Mii";
  const walkerOf = (id) => hub.walkers.find((w) => w.id === id) || (hub.visiting && hub.visiting.record.id === id ? hub.visiting.walker : null);

  function save(record) { S.putMii(record); }
  let saveTimers = new Map();
  function saveSoon(record) {
    clearTimeout(saveTimers.get(record.id));
    saveTimers.set(record.id, setTimeout(() => S.putMii(record), 400));
  }

  async function addRecord(record, silent, opts) {
    // every Mii gets a personality (you can change it from its menu) and a home
    if (!record.personality) record.personality = D.randomPersonality();
    H.ensureHome(record);
    // colors can only be changed in Mii Creator now, so drop any old changes
    if (record.kind === "glb" && record.look && Object.keys(record.look).length) record.look = {};
    // where it is right now, and where it likes to be
    if (!record.place) record.place = record.atHome ? "home" : viewedPlace();
    delete record.atHome;
    // (closed the game while it was on its way back from a vacation)
    if (record.place === "away" && !record.vacation) record.place = "apartments";
    if (!record.favPlace) record.favPlace = T.guessFavorite(D.traits(record));
    records.set(record.id, record);
    const template = await templateFor(record);
    infos.set(record.id, template.info);
    loaded.set(record.id, template);
    if (!record.name) record.name = template.info.name;
    if (record.place !== viewedPlace() || town.isTravelling(record) || walkerOf(record.id)) { refreshAll(true); return null; }
    return hub.addWalker(record, template, lookFor(record, template), silent, opts);
  }

  // ---------- places and residents (one drop-down in the top bar) ----------
  // Every place, with the Miis who are there right now under it, then the Miis at
  // home and on the way somewhere. Click a Mii to go to wherever it is.
  const tabs = $("sceneTabs");
  const placeBtn = document.createElement("button");
  placeBtn.className = "place-pick";
  placeBtn.setAttribute("aria-haspopup", "true");
  placeBtn.setAttribute("aria-expanded", "false");
  const placeMenu = document.createElement("div");
  placeMenu.className = "place-menu";
  placeMenu.hidden = true;
  const residentLists = new Map(); // place id ("home", "away" too) -> the list of Miis under it
  for (const scene of window.World3D.list) {
    const b = document.createElement("button");
    b.className = "place-item";
    b.innerHTML = '<span class="pi-icon">' + scene.icon + '</span><span class="pi-name">' + scene.name + '</span><span class="tab-count"></span>';
    b.dataset.scene = scene.id;
    b.addEventListener("click", () => { showPlaceMenu(false); goToScene(scene.id); });
    const list = document.createElement("div");
    list.className = "pm-miis";
    residentLists.set(scene.id, list);
    placeMenu.append(b, list);
  }
  for (const [id, label] of [["home", "🏠 At home"], ["away", "🚶 On the way"], ["vacation", "✈️ On vacation"]]) {
    const h = document.createElement("div");
    h.className = "pm-head";
    h.dataset.group = id;
    h.textContent = label;
    const list = document.createElement("div");
    list.className = "pm-miis";
    residentLists.set(id, list);
    placeMenu.append(h, list);
  }
  const pmFoot = document.createElement("div");
  pmFoot.className = "pm-foot";
  placeMenu.appendChild(pmFoot);
  tabs.append(placeBtn, placeMenu);
  function showPlaceMenu(show) {
    placeMenu.hidden = !show;
    placeBtn.setAttribute("aria-expanded", String(show));
    if (show) renderPlaceMenu(true);
  }
  placeBtn.addEventListener("click", () => showPlaceMenu(placeMenu.hidden));
  document.addEventListener("pointerdown", (e) => { if (!placeMenu.hidden && !tabs.contains(e.target)) showPlaceMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !placeMenu.hidden) showPlaceMenu(false); });
  function goToScene(id) {
    hub.setScene(id);
    if (progress) progress.event({ type: "view", place: id });
    saveSettings();
    updateTabs();
  }
  // the place buttons show how many Miis are there right now
  function updateTabs() {
    const current = hub.visiting ? null : hub.world.id;
    const counts = {};
    for (const r of records.values()) if (!town.isTravelling(r)) counts[r.place] = (counts[r.place] || 0) + 1;
    for (const b of document.querySelectorAll("[data-scene]")) {
      b.setAttribute("aria-pressed", String(b.dataset.scene === current));
      const n = counts[b.dataset.scene] || 0;
      const c = b.querySelector(".tab-count");
      if (c) c.textContent = n ? String(n) : "";
      const meta = window.World3D.list.find((l) => l.id === b.dataset.scene);
      if (meta) b.title = meta.name + " (" + n + " Mii" + (n === 1 ? "" : "s") + " here)";
    }
    // the drop-down button shows where you are
    const meta = window.World3D.list.find((l) => l.id === current);
    const n = meta ? counts[meta.id] || 0 : 0;
    placeBtn.innerHTML = meta
      ? '<span class="pi-icon">' + meta.icon + '</span><span class="pi-name">' + meta.name + '</span>' + (n ? '<span class="tab-count">' + n + "</span>" : "") + '<span class="caret">▾</span>'
      : '<span class="pi-icon">🏠</span><span class="pi-name">Visiting a home</span><span class="caret">▾</span>';
  }

  function saveSettings() {
    const scene = hub.visiting ? (hub.mainWorld && hub.mainWorld.id) : hub.world.id;
    S.saveSettings({ scene, friendships: hub.friendships, chattiness: hub.chattiness, theme: prefs.theme, sandbox: prefs.sandbox, simSpeed: prefs.simSpeed });
  }

  // ---------- a little pop-up with choices ----------
  // choices: [{ label, value, kind }] -> resolves with the chosen value (or null)
  function ask(title, text, choices) {
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "choice-modal";
      const card = document.createElement("div");
      card.className = "choice-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      const h = document.createElement("h3");
      h.textContent = title;
      const p = document.createElement("p");
      p.textContent = text;
      card.append(h, p);
      const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      for (const c of choices) {
        const b = document.createElement("button");
        b.className = "choice-btn" + (c.kind ? " " + c.kind : "");
        b.innerHTML = c.label;
        b.addEventListener("click", () => done(c.value));
        card.appendChild(b);
      }
      back.appendChild(card);
      back.addEventListener("pointerdown", (e) => { if (e.target === back) done(null); });
      $("stage").appendChild(back);
      const first = card.querySelector("button");
      if (first) first.focus();
    });
  }

  // ---------- loading .glb files ----------
  async function loadFiles(files) {
    errorMsg.textContent = "";
    const problems = [];
    for (const file of files) {
      try {
        if (/\.(miic|mii|ffsd|cfsd)$/i.test(file.name)) {
          throw new Error("this app now uses 3D .glb files. In Mii Creator, export your Mii as a 3D model (.glb)");
        }
        if (file.size > 30 * 1024 * 1024) throw new Error("file is too big");
        const bytes = await file.arrayBuffer();
        const info = M.readInfo(new Uint8Array(bytes), file.name); // throws if it isn't a .glb
        // already have a Mii with this name?
        const same = Array.from(records.values()).find((r) => nameOf(r).toLowerCase() === info.name.toLowerCase());
        if (same) {
          const choice = await ask("You already have a Mii called " + info.name + "!", "What would you like to do with this file?", [
            { label: "✨ <b>Update " + escapeHtml(info.name) + "'s look</b><small>New model, same personality, friends, home and coins</small>", value: "update", kind: "primary" },
            { label: "➕ <b>Add as a new Mii</b><small>Keep both</small>", value: "new" },
            { label: "🔄 <b>Replace " + escapeHtml(info.name) + "</b><small>Start fresh: the old one moves away</small>", value: "replace", kind: "danger" },
            { label: "Cancel", value: null, kind: "plain" },
          ]);
          if (!choice) continue;
          if (choice === "update") { await updateModel(same, bytes, file.name); continue; }
          if (choice === "replace") forgetMii(same, true);
          if (choice === "new") {
            const taken = new Set(Array.from(records.values()).map((r) => nameOf(r).toLowerCase()));
            let n = 2;
            while (taken.has((info.name + " " + n).toLowerCase())) n++;
            info.name = info.name + " " + n;
          }
        }
        const record = { id: "glb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), kind: "glb", fileName: file.name, bytes, name: info.name, look: {}, added: Date.now() };
        await addRecord(record);
        save(record);
      } catch (e) {
        problems.push(file.name + " (" + e.message + ")");
      }
    }
    if (problems.length) errorMsg.textContent = "Couldn't add: " + problems.join("; ");
    refreshAll();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // A new .glb for a Mii you already have: new model, same everything else.
  async function updateModel(rec, bytes, fileName) {
    const template = await M.loadTemplate(bytes.slice(0), fileName);
    rec.kind = "glb";
    rec.bytes = bytes;
    rec.fileName = fileName;
    rec.look = {};
    templates.set(rec.id, Promise.resolve(template));
    infos.set(rec.id, template.info);
    portraits.delete(rec.id);
    save(rec);
    const w = walkerOf(rec.id);
    if (w) {
      w.template = template;
      w.look = lookFor(rec, template);
      w.buildModel();
      w.say(pick(["Do you like my new look?", "Ta-da! New me!", "How do I look?"]), 2.5);
      w.hop(4);
    }
    hub.addFeed(nameOf(rec) + " got a new look! ✨");
    refreshAll(true);
  }

  $("fileInput").addEventListener("change", (e) => {
    loadFiles(Array.from(e.target.files));
    e.target.value = "";
  });

  const stage = $("stage");
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dragover"); });
  stage.addEventListener("dragleave", () => stage.classList.remove("dragover"));
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    stage.classList.remove("dragover");
    loadFiles(Array.from(e.dataTransfer.files));
  });

  // ---------- random generic Miis ----------
  // New players start with a few of these, and "Add random Miis" makes more.
  const NAMES = ["Mia", "Leo", "Ava", "Sam", "Kai", "Zoe", "Max", "Ivy", "Ben", "Lily", "Owen", "Ruby", "Finn", "Nora", "Theo",
    "Ella", "Jack", "Maya", "Noah", "Rosa", "Eli", "Luna", "Hugo", "Iris", "Gus", "June", "Omar", "Pia", "Ravi", "Suki",
    "Toby", "Vera", "Wade", "Yuki", "Zara", "Ash", "Bea", "Cole", "Dina", "Ezra", "Fay", "Gabe", "Hana", "Ian", "Jade",
    "Kian", "Lena", "Milo", "Nia", "Otto", "Pax", "Quinn", "Remy", "Sol", "Tess", "Uma", "Vic", "Wren", "Xavi", "Yara"];
  const CATCHPHRASES = ["Let's gooo!", "Yay, friends!", "Boop!", "Interesting!", "Oh, um... okay!", "Back in my day...",
    "Easy peasy!", "Wowza!", "Hmph. Fine.", "Let's do this!", "Snack time?", "You got this!", "Whoopsie!", "Neat-o!", ""];

  function randomMiiRecord(taken) {
    const free = NAMES.filter((n) => !taken.has(n));
    const name = free.length ? pick(free) : pick(NAMES) + " " + (2 + Math.floor(Math.random() * 8));
    taken.add(name);
    const personality = D.randomPersonality();
    // spread personalities out a bit so Miis feel different from each other
    for (const k of ["energy", "social", "chatty", "humor", "kindness"]) {
      personality[k] = Math.round(Math.max(5, Math.min(95, 50 + (Math.random() - 0.5) * 90)));
    }
    personality.catchphrase = pick(CATCHPHRASES);
    return {
      id: "mii-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      kind: "demo", // built from the bundled model, recolored
      name,
      look: { skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS), eyes: pick(EYES), beard: Math.random() < 0.2 },
      personality,
      added: Date.now(),
    };
  }

  async function addRandomMiis(count) {
    const taken = new Set(Array.from(records.values()).map(nameOf));
    for (let i = 0; i < count; i++) {
      const record = randomMiiRecord(taken);
      await addRecord(record);
      save(record);
    }
  }
  $("demoBtn").addEventListener("click", () => { errorMsg.textContent = ""; addRandomMiis(3); });
  // the cyclists on Café Street are random generic Miis too
  let riderTpl = null;
  hub.riderMii = () => {
    if (!riderTpl) {
      const p = sampleTemplate();
      if (p && p.then) p.then((t) => { riderTpl = t; });
      else if (p) riderTpl = p;
      return null;
    }
    const tpl = riderTpl;
    const r = randomMiiRecord(new Set());
    return { template: tpl, look: lookFor(r, tpl) };
  };

  // (Settings: Remove all Miis)
  async function removeAllMiis() {
    if (!records.size) return;
    const ok = await ask("Remove every Mii?", "All your Miis, their homes, coins and friendships will be gone for good.", [
      { label: "<b>Yes, remove everyone</b>", value: true, kind: "danger" },
      { label: "Cancel", value: false, kind: "plain" },
    ]);
    if (!ok) return;
    closeMiiMenu();
    closeHomePanel();
    hub.clearAll();
    S.clearMiis();
    records.clear();
    portraits.clear();
    saveSettings();
    refreshAll(true);
  }

  // ---------- going places, home visits, moving away ----------
  // Miis decide for themselves where to go (see town.js); you can also send them.
  const town = T.create({
    hub, records, D, templateFor, lookFor, nameOf, save,
    // light = just the numbers and "where is everyone" changed
    changed: (light) => { if (light) refreshLight(); else refreshAll(true); },
    placeMood: (place) => (progress ? progress.placeMood(place) : 1),
    restyle: (rec) => restyle(rec),
    onShift: (rec, job, pay) => shiftDone(rec, job, pay),
    arrived: (rec, from) => { if (from === "away") cameHome(rec); },
  });
  lifeTown = town;
  let progress = null; // wishes, levels, goals... (made below)
  let life = null, lifeHub = null; // vacations, and shows / jobs in 3D (made below)
  hub.onTick = (dt) => { town.tick(dt); if (progress) progress.tick(dt); if (life) life.tick(dt); if (lifeHub) lifeHub.tick(dt); };
  hub.onSceneChange = (id) => town.populate(id);

  function sendHome(rec, then, quick) {
    town.sendTo(rec, "home", { then, quick });
  }

  function sendTo(rec, place) {
    if (hub.visiting && hub.visiting.record.id === rec.id && place !== "home") leaveHome();
    town.sendTo(rec, place);
    progress.event({ type: "sent", id: rec.id, place });
  }

  // Invite a Mii out of its home to the place you're looking at.
  function inviteOut(rec) {
    if (hub.visiting && hub.visiting.record.id === rec.id) leaveHome();
    const to = viewedPlace() && viewedPlace() !== "home" ? viewedPlace() : "apartments";
    town.sendTo(rec, to);
  }

  // opts.empty: look around the home while the Mii is out (it stays where it is)
  async function visit(rec, opts) {
    closeMiiMenu();
    const empty = !!(opts && opts.empty);
    const go = async () => {
      const template = await templateFor(rec);
      hub.visitHome(rec, template, lookFor(rec, template), { empty, room: opts && opts.room });
      openHomePanel(rec);
      updateTabs();
      if (!empty) progress.event({ type: "visit", id: rec.id });
    };
    if (empty || (isHome(rec) && !town.isTravelling(rec))) go();
    else town.sendTo(rec, "home", { quick: true, then: go });
  }

  function leaveHome() {
    closeHomePanel();
    hub.leaveHome();
    updateTabs();
  }
  hub.onLeftHome = () => { closeHomePanel(); updateTabs(); };

  // Removes a Mii for good. quiet = no goodbye scene (used when replacing it).
  function forgetMii(rec, quiet) {
    if (hub.visiting && hub.visiting.record.id === rec.id) leaveHome();
    if (quiet) hub.removeWalker(rec.id, true);
    else hub.moveAway(rec.id, nameOf(rec));
    records.delete(rec.id);
    town.forget(rec.id);
    progress.forget(rec.id);
    loaded.delete(rec.id);
    templates.delete(rec.id);
    portraits.delete(rec.id);
    S.deleteMii(rec.id);
    saveSettings();
    refreshAll(true);
  }

  async function moveAway(rec) {
    const ok = await ask(nameOf(rec) + " is moving away?", "This removes " + nameOf(rec) + " from your world for good, along with their home, coins and friendships. The other Miis will react depending on how close they were.", [
      { label: "📦 <b>Yes, move away</b>", value: true, kind: "danger" },
      { label: "Cancel", value: false, kind: "plain" },
    ]);
    if (ok) { closeMiiMenu(); forgetMii(rec, false); }
  }

  // Click an apartment in the Apartments to visit whoever lives there.
  hub.onRareEvent = (id) => progress.hiddenEvent(id); // a rare event was seen: its sticker
  hub.miiInfo = (id) => { const r = records.get(id), t = r && loaded.get(id); return t ? { record: r, template: t, look: lookFor(r, t) } : null; }; // (for rare-event guests)
  hub.onApartmentClick = (id) => {
    const rec = records.get(id);
    if (rec) visit(rec, { empty: !isHome(rec) || town.isTravelling(rec) }); // (out? you can still look around)
  };

  // ---------- roster ----------
  const portraits = new Map(); // id -> { key, url }

  function portraitFor(rec) {
    const tpl = templates.get(rec.id) || (rec.kind !== "glb" ? templates.get("sample") : null);
    const cached = portraits.get(rec.id);
    const key = JSON.stringify(rec.look || {}) + (rec.fileName || "") + outfitKey(rec);
    if (cached && cached.key === key) return cached.url;
    // the template might still be loading: draw the picture once it's ready
    if (!cached || cached.key !== key) {
      portraits.set(rec.id, { key, url: cached ? cached.url : "" });
      Promise.resolve(tpl || templateFor(rec)).then((t) => {
        const url = M.portrait(t, lookFor(rec, t), 96);
        portraits.set(rec.id, { key, url });
        document.querySelectorAll('img[data-portrait="' + rec.id + '"]').forEach((img) => { img.src = url; });
      });
    }
    return portraits.get(rec.id).url;
  }
  if (window.MiiHomes3D) window.MiiHomes3D.portraitFor = portraitFor; // the self-portrait painting in a Mii's home

  function sortedRecords() {
    return Array.from(records.values()).sort((a, b) => (a.added || 0) - (b.added || 0));
  }

  // Goes to wherever the Mii is (or visits it at home) and opens its menu.
  function goToMii(rec) {
    // inside someone else's home: go out to where this Mii is
    if (hub.visiting && hub.visiting.record.id !== rec.id) {
      leaveHome();
      if (isHome(rec) && !town.isTravelling(rec)) { visit(rec); return; }
    }
    if (town.isTravelling(rec)) { toast(nameOf(rec) + " is on the way somewhere. Try again in a moment!"); return; }
    const ww = walkerOf(rec.id);
    if (ww) { openMiiMenu(ww); return; }
    if (isHome(rec)) { visit(rec); return; }
    // somewhere else: go and look, then open its menu there
    withWalker(rec, (w2) => openMiiMenu(w2));
  }

  // The residents under each place in the drop-down.
  // force = rebuild even if nobody came or went (otherwise just the little details)
  let placeMenuKey = "";
  function renderPlaceMenu(force) {
    if (placeMenu.hidden) return;
    const all = sortedRecords();
    const groupOf = (r) => (r.place === "away" && !town.isTravelling(r) ? "vacation" : town.isTravelling(r) ? "away" : isHome(r) ? "home" : residentLists.has(r.place) ? r.place : "away");
    const key = all.map((r) => r.id + groupOf(r) + nameOf(r) + (r.wish ? 1 : 0)).join(",");
    if (!force && key === placeMenuKey) {
      for (const el of placeMenu.querySelectorAll("[data-where]")) {
        const rec = records.get(el.dataset.where);
        if (rec) el.textContent = whereNow(rec);
      }
      return;
    }
    placeMenuKey = key;
    for (const list of residentLists.values()) list.innerHTML = "";
    for (const rec of all) {
      const g = groupOf(rec);
      const row = document.createElement("div");
      row.className = "pm-mii" + (g === "home" ? " at-home" : "");
      const who = document.createElement("button");
      who.className = "pm-who";
      who.title = g === "home" ? "Visit " + nameOf(rec) + " at home" : "Go to " + nameOf(rec);
      who.innerHTML = '<img alt="" data-portrait="' + rec.id + '" src="' + portraitFor(rec) + '"><span class="pm-name">' + escapeHtml(nameOf(rec)) +
        ' <span class="wish-flag" data-wish-flag="' + rec.id + '" hidden>💭</span></span>' +
        '<span class="pm-meta"><span class="coins" data-coins="' + rec.id + '">🪙 ' + (rec.coins || 0) + "</span>" +
        (g === "away" || g === "vacation" || hub.calls.has(rec.id) ? ' · <span class="where" data-where="' + rec.id + '">' + escapeHtml(whereNow(rec)) + "</span>" : "") + "</span>";
      who.addEventListener("click", () => { showPlaceMenu(false); goToMii(rec); });
      row.appendChild(who);
      const btn = (icon, title, fn) => {
        const b = document.createElement("button");
        b.className = "pm-act";
        b.textContent = icon;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", () => { showPlaceMenu(false); fn(); });
        row.appendChild(b);
      };
      if (isHome(rec)) {
        btn("🏡", "Visit " + nameOf(rec) + " at home", () => visit(rec));
        btn("🚪", "Invite " + nameOf(rec) + " out", () => inviteOut(rec));
      } else {
        btn("🏠", "Send " + nameOf(rec) + " home", () => sendHome(rec));
        btn("🔑", "Look around " + nameOf(rec) + "'s home (while they're out)", () => visit(rec, { empty: true }));
      }
      residentLists.get(g).appendChild(row);
    }
    // the "At home" / "On the way" headings only show when someone's there
    for (const h of placeMenu.querySelectorAll(".pm-head")) h.hidden = !residentLists.get(h.dataset.group).children.length;
    pmFoot.textContent = all.length ? all.length + " resident" + (all.length === 1 ? "" : "s") + " · click a Mii to go to them" : "No Miis yet: ➕ Add Miis!";
    renderWishes(true);
  }

  // Updates just the coin numbers (cheap, so it can happen often).
  function renderCoins() {
    for (const el of document.querySelectorAll("[data-coins]")) {
      const rec = records.get(el.dataset.coins);
      if (rec) el.textContent = "🪙 " + (rec.coins || 0);
    }
  }

  hub.onCoins = (w) => {
    saveSoon(w.record);
    renderCoins();
  };

  // ---------- friendships & feed ----------
  function renderFriends() {
    const list = $("friends");
    if (!list) return; // (friendships now live in each Mii's menu)
    list.innerHTML = "";
    const pairs = Object.entries(hub.friendships)
      .map(([key, pts]) => { const [a, b] = key.split("|"); return { a: records.get(a), b: records.get(b), pts }; })
      .filter((p) => p.a && p.b && p.pts > 0)
      .sort((x, y) => y.pts - x.pts)
      .slice(0, 10);
    if (!pairs.length) {
      list.innerHTML = '<li class="empty">Nobody has met yet. Give them a minute!</li>';
      return;
    }
    for (const p of pairs) {
      const level = D.levelFor(p.pts);
      const li = document.createElement("li");
      li.textContent = nameOf(p.a) + " & " + nameOf(p.b);
      const lv = document.createElement("span");
      lv.className = "level";
      lv.textContent = level.emoji + " " + level.name;
      li.appendChild(lv);
      list.appendChild(li);
    }
  }

  // who lives in which apartment (for the Apartments place)
  function updateResidents() {
    hub.setResidents(sortedRecords().map((r) => {
      const home = isHome(r) && !town.isTravelling(r);
      const template = loaded.get(r.id);
      return {
        id: r.id, name: nameOf(r), home, record: r,
        items: (r.home && r.home.items) || {},
        activity: home ? town.homeActivity(r) : null,
        template: home ? template : null,
        look: home && template ? lookFor(r, template) : null,
      };
    }));
  }

  let pending = false;
  let rosterKey = "";
  let menu = null, menuWalker = null; // the Mii menu (made below) and whose it is
  // force = rebuild the roster even if nobody came or went
  function refreshAll(force) {
    const key = sortedRecords().map((r) => r.id + r.place + nameOf(r)).join(",");
    if (force || key !== rosterKey) { rosterKey = key; renderPlaceMenu(true); updateResidents(); if (typeof renderWishes === "function") renderWishes(true); }
    renderFriends();
    updateTabs();
  }
  // where a Mii is, for the places drop-down (or who they're on the phone with)
  function whereNow(rec) {
    const call = hub.calls && hub.calls.get(rec.id);
    if (call) {
      const other = [call.a, call.b, call.caller, call.callee].map((x) => (x && x.id) || x).find((id) => typeof id === "string" && id !== rec.id);
      const o = other && records.get(other);
      return "📱 On the phone" + (o ? " with " + nameOf(o) : "");
    }
    return town.whereText(rec);
  }
  // Every second: who's where (cheap updates, no rebuilding the lists).
  function refreshLight() {
    for (const el of document.querySelectorAll("[data-where]")) {
      const rec = records.get(el.dataset.where);
      if (rec) el.textContent = whereNow(rec);
    }
    renderPlaceMenu(false);
    updateResidents();
    updateTabs();
    // the Mii whose menu is open went somewhere else: close it
    if (menu && !menu.hidden && menuWalker && !hub.active().includes(menuWalker)) closeMiiMenu();
  }

  hub.onChange = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      refreshAll(false);
      saveSettings();
    }, 250);
  };

  // ---------- start ----------
  updateTabs();
  hub.start();

  splash.set(55, "Waking up your Miis…");
  const saved = (await S.getAllMiis()).sort((a, b) => (a.added || 0) - (b.added || 0));
  for (const r of saved) {
    splash.set(55 + (40 * (saved.indexOf(r) + 1)) / saved.length);
    try {
      const hadLook = r.kind === "glb" && r.look && Object.keys(r.look).length;
      const hadHome = !!r.home;
      await addRecord(r, true);
      if (hadLook || !hadHome) save(r);
    } catch (e) { console.warn("Couldn't load saved Mii", e); }
  }
  if (!records.size) {
    // First visit: a few random generic Miis to get things going.
    try {
      splash.set(70, "Making some new Miis…");
      await addRandomMiis(5);
    } catch (e) {
      errorMsg.textContent = "Couldn't create the starter Miis: " + e.message;
    }
  }
  refreshAll(true);


  // ---------- the Mii menu (right-click a Mii) ----------
  const MG = window.MiniGames;
  // each Mii's record of how good it is at each game
  function gameStats(rec, id) {
    rec.games = rec.games || {};
    if (!rec.games[id]) rec.games[id] = MG.newStats();
    return rec.games[id];
  }

  // The Mii menu and the home panel open in the side panel, beside the 3D view
  // (where the old right-hand menu was), so they don't cover the Miis.
  const sidePanel = $("sidePanel");
  menu = document.createElement("div");
  menu.className = "mii-menu";
  menu.hidden = true;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Mii menu");
  sidePanel.appendChild(menu);
  function updateSidePanel() {
    const open = !menu.hidden || !panel.hidden;
    sidePanel.hidden = !open;
    document.querySelector(".layout").classList.toggle("has-side", open);
  }

  function closeMiiMenu() {
    if (!menu) return;
    menu.hidden = true;
    menuWalker = null;
    updateSidePanel();
  }

  // (clientX, clientY: where you clicked; not needed now the menu has its own place)
  function openMiiMenu(w) {
    const rec = w.record;
    menuWalker = w;
    rec.personality = Object.assign({}, D.DEFAULT_PERSONALITY, rec.personality || {});
    const p = rec.personality;
    const atHomeVisit = hub.visiting && hub.visiting.walker === w;
    menu.innerHTML = "";

    // header: picture, name, personality type, coins
    const head = document.createElement("div");
    head.className = "mm-head";
    const img = document.createElement("img");
    img.src = portraitFor(rec);
    img.dataset.portrait = rec.id;
    img.alt = "";
    const titles = document.createElement("div");
    titles.className = "mm-titles";
    const nameInput = document.createElement("input");
    nameInput.className = "mm-name";
    nameInput.value = w.look.name;
    nameInput.maxLength = 12;
    nameInput.setAttribute("aria-label", "Name");
    nameInput.addEventListener("input", () => {
      const name = nameInput.value.trim();
      if (!name) return;
      rec.name = name;
      w.look.name = name;
      w.uiName.textContent = name;
      saveSoon(rec);
      hub.onChange();
    });
    const label = document.createElement("div");
    label.className = "mm-label";
    label.innerHTML = escapeHtml(D.personalityLabel(p)) + ' · <span data-coins="' + rec.id + '">🪙 ' + (rec.coins || 0) + "</span>";
    // level and happiness (granting wishes fills it up)
    progress.ensure(rec);
    const lvl = document.createElement("div");
    lvl.className = "mm-level";
    const need = progress.happyNeeded(rec);
    lvl.innerHTML = "<b>⭐ Lv " + rec.level + "</b> " + "❤️".repeat(rec.happy) + "🤍".repeat(Math.max(0, need - rec.happy));
    lvl.title = "Grant " + nameOf(rec) + "'s wishes and give it things it loves to fill its hearts and level it up";
    titles.append(nameInput, label, lvl);
    const close = document.createElement("button");
    close.className = "mm-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeMiiMenu);
    // 📷 group picture with the Miis here (not inside a home)
    const cam = document.createElement("button");
    cam.className = "mm-cam";
    cam.textContent = "📷";
    const posers = photoCandidates();
    cam.hidden = !!hub.visiting;
    cam.disabled = posers.length < 2 || !posers.includes(w);
    cam.title = cam.disabled ? "Group picture: needs at least 2 Miis here" : "Take a group picture with the Miis here";
    cam.setAttribute("aria-label", cam.title);
    cam.addEventListener("click", () => openPhotoPicker(w));
    head.append(img, titles, cam, close);
    // e.g. a "head only" export: it can't walk properly
    let warn = null;
    if (w.inst && w.inst.rig && !w.inst.rig.canAnimate) {
      warn = document.createElement("p");
      warn.className = "mm-warn";
      warn.textContent = "⚠ No skeleton found, so it can only hop. Export it from Mii Creator as \"Full body\".";
    }

    // quick actions
    const acts = document.createElement("div");
    acts.className = "mm-actions";
    const actList = [["👋", "Wave", "wave"], ["💃", "Dance", "dance"], ["🦘", "Jump", "jump"], ["😴", "Nap", "nap"], ["💬", "Catchphrase", "catchphrase"]];
    // special moves it learned when levelling up
    for (const id of rec.moves || []) {
      const mv = progress.MOVES.find((m) => m.id === id);
      if (mv) actList.push([mv.icon, mv.name, mv.id]);
    }
    for (const [icon, text, kind] of actList) {
      const b = document.createElement("button");
      b.innerHTML = "<span>" + icon + "</span>" + text;
      b.addEventListener("click", () => hub.perform(w, kind));
      acts.appendChild(b);
    }
    const snack = document.createElement("button");
    snack.innerHTML = "<span>🍙</span>Give food";
    snack.addEventListener("click", () => { closeMiiMenu(); openFoodPicker(rec); });
    acts.appendChild(snack);

    // personality sliders
    const pers = document.createElement("div");
    pers.className = "mm-section";
    pers.innerHTML = "<h3>Personality</h3>";
    for (const t of D.TRAITS) {
      const row = document.createElement("label");
      row.className = "mm-slider";
      const lo = document.createElement("span"); lo.textContent = t.low;
      const hi = document.createElement("span"); hi.textContent = t.high;
      const r = document.createElement("input");
      r.type = "range"; r.min = 0; r.max = 100; r.value = p[t.key];
      r.setAttribute("aria-label", t.low + " to " + t.high);
      r.addEventListener("input", () => {
        p[t.key] = Number(r.value);
        label.firstChild.textContent = D.personalityLabel(p) + " · ";
        saveSoon(rec);
      });
      r.addEventListener("change", () => refreshAll(true));
      row.append(lo, r, hi);
      pers.appendChild(row);
    }
    const cpRow = document.createElement("label");
    cpRow.className = "mm-catch";
    cpRow.textContent = "Catchphrase";
    const cp = document.createElement("input");
    cp.maxLength = 40;
    cp.placeholder = "e.g. Let's gooo!";
    cp.value = p.catchphrase || "";
    cp.addEventListener("input", () => { p.catchphrase = cp.value; saveSoon(rec); });
    cp.addEventListener("change", () => { if (cp.value.trim()) progress.event({ type: "catchphrase", id: rec.id }); });
    cpRow.appendChild(cp);
    pers.appendChild(cpRow);

    // mini-games, with this Mii's skill meter for each
    const games = document.createElement("div");
    games.className = "mm-section";
    games.innerHTML = "<h3>Play a game</h3>";
    for (const g of Object.values(MG.GAMES)) {
      const st = gameStats(rec, g.id);
      const row = document.createElement("div");
      row.className = "mm-game";
      const glabel = document.createElement("div");
      glabel.className = "mm-game-name";
      glabel.innerHTML = "<span>" + g.icon + "</span>" + g.short;
      const meterWrap = document.createElement("div");
      meterWrap.className = "mm-game-meter";
      const meter = document.createElement("div");
      meter.className = "skill-meter";
      const fill = document.createElement("div");
      fill.className = "skill-fill";
      fill.style.width = st.skill.toFixed(0) + "%";
      meter.appendChild(fill);
      const lvl = document.createElement("div");
      lvl.className = "mm-game-level";
      lvl.textContent = MG.skillLevel(st.skill) + " · " + Math.round(st.skill) + (st.played ? " · " + st.played + " played" : "");
      meterWrap.append(meter, lvl);
      const play = document.createElement("button");
      play.className = "mm-play";
      play.textContent = "Play";
      play.title = g.name + " (" + g.format + ")";
      play.addEventListener("click", () => openGame(w, g.id));
      row.append(glabel, meterWrap, play);
      games.appendChild(row);
    }

    // friendships (including Miis who are at home right now)
    const fr = document.createElement("div");
    fr.className = "mm-section";
    const pals = sortedRecords().filter((o) => o.id !== rec.id)
      .map((o) => ({ o, pts: hub.friendships[rec.id < o.id ? rec.id + "|" + o.id : o.id + "|" + rec.id] || 0 }))
      .filter((x) => x.pts > 0)
      .sort((a, b) => b.pts - a.pts);
    fr.innerHTML = "<h3>Friendships</h3>";
    const ul = document.createElement("ul");
    // sweethearts, rivals and fights
    const love = progress.partnerOf(rec);
    if (love) { const li = document.createElement("li"); li.textContent = "💑 Dating " + nameOf(love); ul.appendChild(li); }
    for (const o of sortedRecords()) {
      if (o === rec) continue;
      const pr = progress.state.pairs[rec.id < o.id ? rec.id + "|" + o.id : o.id + "|" + rec.id];
      if (!pr) continue;
      if (pr.fight) {
        const li = document.createElement("li");
        li.textContent = "💢 Not talking to " + nameOf(o) + " ";
        if (pr.makeUp) li.append("(making up...)");
        else {
          const mb = document.createElement("button");
          mb.className = "tb-btn mm-makeup";
          mb.textContent = "🩹 Make up";
          mb.title = "Send " + nameOf(rec) + " to apologize to " + nameOf(o);
          mb.addEventListener("click", () => { progress.startMakeUp(rec, o); toast("🩹 " + nameOf(rec) + " is going to apologize to " + nameOf(o) + "..."); mb.replaceWith("(making up...)"); });
          li.appendChild(mb);
        }
        ul.appendChild(li);
      }
      else if (pr.rival) { const li = document.createElement("li"); li.textContent = "⚡ Rivals with " + nameOf(o); ul.appendChild(li); }
    }
    if (!pals.length) ul.innerHTML = '<li class="empty">No friends yet!</li>';
    for (const { o, pts } of pals) {
      const li = document.createElement("li");
      const lv = D.levelFor(pts);
      li.textContent = lv.emoji + " " + nameOf(o) + " — " + lv.name;
      ul.appendChild(li);
    }
    fr.appendChild(ul);
    // a long list folds up: the closest few, then "show all"
    const items = ul.querySelectorAll("li");
    if (items.length > 5) {
      items.forEach((li, i) => { if (i >= 5) li.hidden = true; });
      const more = document.createElement("button");
      more.className = "link-btn mm-more";
      more.textContent = "Show all (" + items.length + ")";
      more.addEventListener("click", () => {
        const open = more.dataset.open !== "1";
        more.dataset.open = open ? "1" : "";
        items.forEach((li, i) => { if (i >= 5) li.hidden = !open; });
        more.textContent = open ? "Show fewer" : "Show all (" + items.length + ")";
      });
      fr.appendChild(more);
    }

    // where to go: send the Mii somewhere, and its favorite place
    const places = document.createElement("div");
    places.className = "mm-section";
    places.innerHTML = "<h3>Go to…</h3>";
    const goRow = document.createElement("div");
    goRow.className = "mm-places";
    for (const pl of T.available()) {
      const b = document.createElement("button");
      b.innerHTML = "<span>" + pl.icon + "</span>" + (pl.id === "apartments" ? "Courtyard" : pl.id === "space" ? "Moon" : pl.name.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()));
      b.title = "Send " + nameOf(rec) + " to " + pl.name;
      b.disabled = rec.place === pl.id && !town.isTravelling(rec);
      b.addEventListener("click", () => { closeMiiMenu(); sendTo(rec, pl.id); });
      goRow.appendChild(b);
    }
    const favRow = document.createElement("label");
    favRow.className = "mm-fav";
    favRow.textContent = "Favorite place ";
    const fav = document.createElement("select");
    for (const pl of T.available()) {
      const o = document.createElement("option");
      o.value = pl.id;
      o.textContent = pl.icon + " " + pl.name.replace(/^./, (c) => c.toUpperCase());
      fav.appendChild(o);
    }
    fav.value = rec.favPlace || "park";
    fav.addEventListener("change", () => { rec.favPlace = fav.value; saveSoon(rec); });
    favRow.appendChild(fav);
    places.append(goRow, favRow);

    // footer
    const foot = document.createElement("div");
    foot.className = "mm-foot";
    const homeBtn = document.createElement("button");
    if (atHomeVisit) {
      homeBtn.textContent = "🚪 Invite out";
      homeBtn.title = "Bring " + nameOf(rec) + " back out to hang out";
      homeBtn.addEventListener("click", () => { closeMiiMenu(); inviteOut(rec); });
    } else {
      homeBtn.textContent = "🏠 Send home";
      homeBtn.title = nameOf(rec) + " goes home. You can visit them there, and invite them back out any time.";
      homeBtn.addEventListener("click", () => { closeMiiMenu(); sendHome(rec); });
    }
    const visitBtn = document.createElement("button");
    visitBtn.textContent = "🏡 Visit home";
    visitBtn.addEventListener("click", () => visit(rec));
    const peekBtn = document.createElement("button");
    peekBtn.textContent = "🔑 Look inside";
    peekBtn.title = "Look around " + nameOf(rec) + "'s home without them";
    peekBtn.addEventListener("click", () => visit(rec, { empty: true }));
    const away = document.createElement("button");
    away.className = "danger";
    away.textContent = "📦 Move away";
    away.title = "Remove " + nameOf(rec) + " from your world for good";
    away.addEventListener("click", () => moveAway(rec));
    foot.append(homeBtn);
    if (!atHomeVisit) foot.append(visitBtn, peekBtn);
    foot.append(away);

    // its wish, if it has one: you only find out by talking to it (here)
    let wishSec = null;
    if (rec.wish) {
      wishSec = document.createElement("div");
      wishSec.className = "mm-section mm-wish";
      wishSec.innerHTML = "<h3>💭 " + escapeHtml(nameOf(rec)) + "'s wish</h3><p>" + rec.wish.icon + " “" + escapeHtml(rec.wish.text) + "”</p>";
      const wa = document.createElement("div");
      wa.className = "mm-wish-acts";
      for (const a of progress.wishActions(rec)) {
        const b = document.createElement("button");
        b.textContent = a.text;
        // (the menu stays open while you help; it just updates)
        b.addEventListener("click", (e) => {
          wishAction(rec, a.id, e);
          setTimeout(() => { if (!menu.hidden && menuWalker && menuWalker.record === rec) openMiiMenu(menuWalker); }, 0);
        });
        wa.appendChild(b);
      }
      wishSec.appendChild(wa);
      if (!rec.wish.heard) { rec.wish.heard = true; saveSoon(rec); renderWishes(true); }
    }
    menu.append(head);
    if (warn) menu.append(warn);
    if (wishSec) menu.append(wishSec);
    menu.append(acts, lifeSection(rec, w), places, games, pers, fr, foot);
    menu.hidden = false;
    // (a fresh menu starts at the top, above the home panel if that's open too)
    sidePanel.insertBefore(menu, sidePanel.firstChild);
    updateSidePanel();
    sidePanel.scrollTop = 0;
  }

  hub.onSelect = (w) => openMiiMenu(w);
  // (the menu stays open while you watch; ✕ or Escape closes it)
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".choice-modal")) closeMiiMenu(); });


  // ---------- visiting a Mii's home: decorating and food ----------
  const panel = document.createElement("div");
  panel.className = "home-panel";
  panel.hidden = true;
  sidePanel.appendChild(panel);
  let panelTab = "decorate";
  let panelSlot = "bed";

  // What the Mii says to you while you visit.
  hub.onHomeTalk = (w, kind) => {
    const rec = w.record;
    const p = w.personality;
    if (kind === "hello") {
      if (p.social <= 35) return pick(["Oh! A visitor... h-hi!", "You came to see me? Um, come in..."]);
      if (p.kindness <= 35) return pick(["Oh. It's you. Come in, I guess.", "Wipe your feet."]);
      if (p.energy >= 70) return pick(["YOU'RE HERE! Come in, come in!", "A visitor! Yay!"]);
      return pick(["Welcome to my home!", "Oh, hi! Come on in!", "Make yourself at home!"]);
    }
    return H.homeLine(rec, p, rec.home && rec.home.lastGift);
  };

  function openHomePanel(rec) {
    panel.hidden = false;
    panel.dataset.id = rec.id;
    renderHomePanel();
    updateSidePanel();
  }
  function closeHomePanel() {
    panel.hidden = true;
    delete panel.dataset.id;
    updateSidePanel();
  }

  const EMOTE = { love: "😍", like: "😊", okay: "🙂", dislike: "😒" };

  function renderHomePanel() {
    const rec = records.get(panel.dataset.id);
    if (!rec) { closeHomePanel(); return; }
    const p = D.traits(rec);
    panel.innerHTML = "";

    const head = document.createElement("div");
    head.className = "hp-head";
    head.innerHTML = "<div><b>🏠 " + escapeHtml(nameOf(rec)) + "'s home</b><div class=\"hp-sub\">Mood " + H.moodFace(rec.mood) +
      ' · <span class="hp-coins" data-coins="' + rec.id + '">🪙 ' + (rec.coins || 0) + "</span></div></div>";
    const leave = document.createElement("button");
    leave.className = "hp-leave";
    leave.textContent = "← Leave";
    leave.title = "Go back outside";
    leave.addEventListener("click", leaveHome);
    head.appendChild(leave);

    const tabsEl = document.createElement("div");
    tabsEl.className = "hp-tabs";
    const out = hub.visiting && hub.visiting.empty; // looking around while the Mii is out
    const roomTabs = roomSwitcher(rec);
    if (out) head.querySelector(".hp-sub").insertAdjacentHTML("beforeend", " · <i>" + escapeHtml(nameOf(rec)) + " is out</i>");
    for (const [id, text] of (out ? [["decorate", "🛋️ Decorate"]] : [["decorate", "🛋️ Decorate"], ["food", "🍙 Give food"], ["more", "⋯ More"]])) {
      const b = document.createElement("button");
      b.textContent = text;
      b.setAttribute("aria-pressed", String(panelTab === id));
      b.addEventListener("click", () => { panelTab = id; renderHomePanel(); });
      tabsEl.appendChild(b);
    }
    panel.append(head);
    if (roomTabs) panel.append(roomTabs);
    panel.append(tabsEl);

    const body = document.createElement("div");
    body.className = "hp-body";
    if (panelTab === "decorate") {
      const slots = document.createElement("div");
      slots.className = "hp-slots";
      // (each room has its own kinds of furniture)
      const roomSlots = H.slotsOfRoom ? H.slotsOfRoom(currentRoom()) : H.SLOTS;
      if (!roomSlots.some((s) => s.id === panelSlot)) panelSlot = roomSlots[0].id;
      for (const s of roomSlots) {
        const b = document.createElement("button");
        b.textContent = s.icon;
        b.title = s.name;
        b.setAttribute("aria-label", s.name);
        b.setAttribute("aria-pressed", String(panelSlot === s.id));
        b.addEventListener("click", () => { panelSlot = s.id; renderHomePanel(); });
        slots.appendChild(b);
      }
      const slotName = document.createElement("div");
      slotName.className = "hp-slotname";
      slotName.textContent = roomSlots.find((s) => s.id === panelSlot).name;
      const grid = document.createElement("div");
      grid.className = "hp-grid";
      // today's stock (it changes every day), plus everything the Mii already owns,
      // plus a peek at fancier things that a higher town level unlocks
      const forSale = progress.shopItems(panelSlot);
      const deals = progress.deals();
      // (its favorite is always in stock for it, so every Mii's favorite can be found)
      const favId = H.favoriteItem && H.favoriteItem(rec, panelSlot);
      const list = (H.itemsFor ? H.itemsFor(panelSlot) : H.ITEMS).filter((i) => i.slot === panelSlot && (forSale.includes(i) || i.id === favId || rec.home.owned.includes(i.id) || progress.lockedTier(i)));
      for (const it of list) {
        const owned = rec.home.owned.includes(it.id);
        const placed = rec.home.items[it.slot] === it.id;
        const locked = !owned && progress.lockedTier(it);
        const price = costOf(progress.priceOf(it));
        const deal = !owned && deals.includes(it.id);
        const b = document.createElement("button");
        b.className = "hp-item" + (placed ? " placed" : "") + (deal ? " deal" : "") + (locked ? " locked" : "");
        // its one favorite in this category (you find out once it has it)
        const fav = owned && H.favoriteItem && H.favoriteItem(rec, it.slot) === it.id;
        b.innerHTML = "<span class=\"hp-icon\">" + (locked ? "🔒" : it.icon) + "</span><span class=\"hp-name\">" + escapeHtml(it.name) + (fav ? " ❤️" : "") + "</span><span class=\"hp-price\">" +
          (placed ? "✓ In use" : owned ? "Owned" : locked ? "Town Lv " + progress.unlockLevelForTier(progress.tierOf(it)) : prefs.sandbox ? "🧪 Free" : (deal ? "⭐ " : "") + "🪙 " + price) + "</span>";
        b.disabled = placed || locked || (!owned && (rec.coins || 0) < price);
        if (!owned && !locked && (rec.coins || 0) < price) b.title = nameOf(rec) + " needs " + (price - (rec.coins || 0)) + " more coins";
        if (fav) b.title = nameOf(rec) + "'s favorite " + it.slot + "!";
        if (deal) b.title = "Today's deal: 30% off!";
        b.addEventListener("click", () => placeItem(rec, it));
        grid.appendChild(b);
      }
      body.append(slots, slotName, grid);
    } else if (panelTab === "food") {
      const grid = document.createElement("div");
      grid.className = "hp-grid";
      foodButtons(rec, grid);
      const tip = document.createElement("p");
      tip.className = "hp-tip";
      tip.textContent = "Every Mii has a favorite food (and one they can't stand). The menu changes every day!";
      body.append(tip, grid);
    } else {
      const tip = document.createElement("p");
      tip.className = "hp-tip";
      tip.innerHTML = "Miis earn 🪙 coins by spending meaningful time with each other: trying new things, making new friends and stepping out of their comfort zone. " +
        "Chatting about the same thing with the same Mii over and over doesn't earn much. Playing games with you earns coins too.";
      const out = document.createElement("button");
      out.className = "hp-wide";
      out.textContent = "🚪 Invite " + nameOf(rec) + " out";
      out.addEventListener("click", () => inviteOut(rec));
      const away = document.createElement("button");
      away.className = "hp-wide danger";
      away.textContent = "📦 Move away for good";
      away.addEventListener("click", () => moveAway(rec));
      body.append(tip, out, away);
    }
    panel.appendChild(body);
  }

  function placeItem(rec, it) {
    const owned = rec.home.owned.includes(it.id);
    if (!owned) {
      const price = costOf(progress.priceOf(it));
      if ((rec.coins || 0) < price || progress.lockedTier(it)) return;
      rec.coins -= price;
      rec.home.owned.push(it.id);
    }
    rec.home.items[it.slot] = it.id;
    hub.refreshHome();
    if (it.price > 0 || it.tags.length) {
      const p = D.traits(rec);
      const op = H.opinion(p, rec, it);
      // a Mii only gets excited about something the first time
      if (!owned) rec.mood = Math.max(0, Math.min(100, (rec.mood || 60) + H.MOOD_CHANGE[op]));
      if (op !== "dislike") rec.home.lastGift = it.name;
      hub.homeReact(H.reaction("item", op, it, p), EMOTE[op], it.id);
      if (!owned) progress.event({ type: "furniture", id: rec.id, item: it, opinion: op });
    }
    save(rec);
    renderHomePanel();
    renderCoins();
  }

  // The foods on today's menu, as buttons that feed this Mii.
  function foodButtons(rec, grid, after) {
    for (const f of progress.shopFoods()) {
      const b = document.createElement("button");
      b.className = "hp-item";
      b.innerHTML = "<span class=\"hp-icon\">" + f.icon + "</span><span class=\"hp-name\">" + escapeHtml(f.name) + "</span><span class=\"hp-price\">" + (prefs.sandbox ? "🧪 Free" : "🪙 " + f.price) + "</span>";
      b.disabled = (rec.coins || 0) < costOf(f.price);
      b.addEventListener("click", () => { giveFood(rec, f); if (after) after(); });
      grid.appendChild(b);
    }
  }

  // What something costs right now (everything's free in sandbox mode).
  function costOf(price) { return prefs.sandbox ? 0 : price; }

  // Feeds a Mii (paid with its own coins). It eats on screen if you can see it.
  function giveFood(rec, f) {
    if ((rec.coins || 0) < costOf(f.price)) return;
    if (hub.visiting && hub.visiting.empty) return; // (they're not here to eat it)
    rec.coins -= costOf(f.price);
    const p = D.traits(rec);
    const op = H.opinion(p, rec, f);
    rec.mood = Math.max(0, Math.min(100, (rec.mood || 60) + H.MOOD_CHANGE[op] * 0.6));
    const text = H.reaction("food", op, f, p), emote = op === "dislike" ? "🤢" : EMOTE[op];
    const w = walkerOf(rec.id);
    if (w) hub.giveFood(f, text, emote, w);
    else toast(f.icon + " " + nameOf(rec) + ": \u201c" + text + "\u201d");
    progress.event({ type: "food", id: rec.id, food: f, opinion: op });
    save(rec);
    if (!panel.hidden) renderHomePanel();
    renderCoins();
  }


  // =====================================================================
  // Progression: wishes, Mii levels, town level, daily goals, sticker book
  // =====================================================================
  const PROGRESS_KEY = "mii-hub-3d-progress";
  let savedProgress = null;
  try { savedProgress = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch (e) { /* none yet */ }
  let saveProgressTimer = null;
  let resetting = false; // (Settings: reset all progress)
  const meetUps = []; // Miis you brought together, waiting to meet: { a, b, until }

  progress = window.MiiProgress.create({
    records, D, H, hub, saved: savedProgress,
    saveState: (st) => { if (resetting) return; clearTimeout(saveProgressTimer); saveProgressTimer = setTimeout(() => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } }, 500); },
    saveMii: (rec) => saveSoon(rec),
    town: () => town,
    meetUp: (a, b) => meetUps.push({ a: a.id, b: b.id, until: Date.now() + 120000 }),
    // makes two Miis hang out right now (on screen if they're here, otherwise off screen)
    offscreen: (fromId, toId) => {
      const A = records.get(fromId), B = records.get(toId);
      if (!A || !B) return true;
      const wa = walkerOf(A.id), wb = walkerOf(B.id);
      if (wa && wb && !hub.visiting) {
        if (hub.isBusy(wa) || hub.isBusy(wb)) return false;
        hub.startInteraction(wa, wb);
        return true;
      }
      if (wa || wb) return false; // one of them is on screen: wait until they meet properly
      return hub.offscreenHangout(A, B, A.place === "home" ? "apartments" : A.place) !== false; // false: one is on the phone
    },
  });
  for (const r of records.values()) progress.ensure(r);
  progress.setSandbox(prefs.sandbox);
  progress.setStickerLock(prefs.sandbox || prefs.simSpeed > 1);
  hub.relation = (a, b) => progress.context(a, b);
  // Miis on the phone stay where they are until they hang up; one that sets off anyway (or is gone) ends the call
  hub.callHold = (rec) => {
    if (!records.has(rec.id) || town.isTravelling(rec)) return false;
    const r = town.info(rec);
    r.stay = Math.max(r.stay, 4);
    return true;
  };
  hub.onHangout = (e) => progress.event(Object.assign({ type: "hangout" }, e));
  hub.onPerform = (w, kind) => progress.event({ type: "perform", id: w.id, kind });
  hub.onPoke = (w) => progress.event({ type: "poke", id: w.id });
  // over its head: just a 💭 until you've talked to it, then what it wants
  hub.wishIconFor = (rec) => (rec.wish ? (rec.wish.heard ? rec.wish.icon : "❗") : null);
  hub.weatherLine = () => progress.weatherLine();
  progress.event({ type: "view", place: hub.world.id });

  // Brought-together Miis meet as soon as they're in the same place.
  setInterval(() => {
    for (let i = meetUps.length - 1; i >= 0; i--) {
      const m = meetUps[i];
      const A = records.get(m.a), B = records.get(m.b);
      if (!A || !B || Date.now() > m.until) { meetUps.splice(i, 1); continue; }
      if (A.place !== B.place || town.isTravelling(A) || town.isTravelling(B)) continue;
      const wa = walkerOf(A.id), wb = walkerOf(B.id);
      if (wa && wb) {
        if (hub.isBusy(wa) || hub.isBusy(wb) || wa.appear < 1 || wb.appear < 1) continue;
        hub.startInteraction(wa, wb);
      } else if (!wa && !wb) {
        if (hub.offscreenHangout(A, B, A.place === "home" ? "apartments" : A.place) === false) continue; // on the phone
      } else continue;
      meetUps.splice(i, 1);
    }
  }, 1000);

  // ---------- little messages at the top of the scene ----------
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  $("stage").appendChild(toasts);
  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => t.classList.add("bye"), 3800);
    setTimeout(() => t.remove(), 4400);
  }
  progress.on("toast", toast);
  progress.on("event", (e) => {
    const w = walkerOf(e.rec.id);
    if (e.type === "wishGranted") {
      if (w) { w.say(D.pick(["Thank you!!", "You're the best!", "Yay! My wish came true!", "I'm so happy!"]), 2.4); w.showEmote("🎉", 2.5); w.hop(4.5); }
      renderCoins();
    }
    if (e.type === "newWish" && w) { w.say(e.wish.text, 3.2); }
    if (e.type === "wishExpired" && w) { w.say(D.pick(["Oh well... never mind.", "Nobody listens to me...", "*sigh*"]), 2.4); w.showEmote("😔", 2.5); }
    renderWishes(true);
  });
  progress.on("sticker", (st) => toast("🏷️ New sticker: " + st.icon + " " + st.name + "!"));

  // ---------- town level, weather and buttons in the top bar ----------
  const townBar = document.createElement("div");
  townBar.className = "town-bar";
  townBar.innerHTML = '<div class="town-level" role="button" tabindex="0" title="Town level: click to see what each level gives"><b>🏙️ Lv <span id="townLv"></span></b><div class="xp"><div class="xp-fill" id="townXp"></div></div></div>' +
    '<div class="weather" id="weatherText"></div>' +
    '<button class="tb-btn" id="dailyBtn">📅 Daily <span id="dailyCount"></span></button>' +
    '<button class="tb-btn" id="bookBtn">📖 Book</button>' +
    '<button class="tb-btn" id="musicBtn" title="Music on/off">🎵</button>' +
    '<div class="play-wrap"><button class="tb-btn play" id="playBtn" aria-haspopup="true" aria-expanded="false">🎮 Play ▾</button><div class="play-menu" id="playMenu" hidden>' +
    '<button class="tb-btn pb" id="paintballBtn" title="Paintball: first-person, against a Mii or online">🎯 Paintball</button>' +
    '<button class="tb-btn chess" id="chessBtn" title="Chess: play one of your Miis, or someone online">♟️ Chess</button></div></div>' +
    '<button class="tb-btn mode-badge" id="modeBadge" hidden></button>' +
    '<button class="tb-btn gear" id="settingsBtn" title="Settings" aria-label="Settings">⚙️<span class="dot-badge" id="settingsDot" hidden></span></button>';
  document.querySelector(".topbar").appendChild(townBar);
  $("dailyBtn").addEventListener("click", openDaily);
  townBar.querySelector(".town-level").addEventListener("click", openTownLevels);
  $("bookBtn").addEventListener("click", openBook);
  // 🎮 Play: every game with online play lives in this menu
  const playMenu = $("playMenu"), playBtn = $("playBtn");
  const showPlay = (on) => { playMenu.hidden = !on; playBtn.setAttribute("aria-expanded", String(on)); };
  playBtn.addEventListener("click", () => showPlay(playMenu.hidden));
  playMenu.addEventListener("click", (e) => { if (e.target.closest("button")) showPlay(false); });
  document.addEventListener("pointerdown", (e) => { if (!playMenu.hidden && !e.target.closest(".play-wrap")) showPlay(false); });
  $("paintballBtn").addEventListener("click", () => openPaintball());
  $("chessBtn").addEventListener("click", () => openChessLobby());
  // background music (everywhere except Paintball)
  if (window.MiiMusic) {
    const mb = $("musicBtn");
    MiiMusic.onChange = (on) => { mb.textContent = on ? "🎵" : "🔇"; mb.title = on ? "Music: on (click to turn off)" : "Music: off (click to turn on)"; };
    MiiMusic.onChange(MiiMusic.isOn());
    mb.addEventListener("click", () => MiiMusic.toggle());
    MiiMusic.start();
  } else $("musicBtn").hidden = true;

  function renderTownBar() {
    const st = progress.state;
    $("townLv").textContent = st.level;
    $("townXp").style.width = Math.min(100, (st.xp / progress.xpNeeded(st.level)) * 100) + "%";
    $("townXp").parentElement.title = st.xp + " / " + progress.xpNeeded(st.level) + " XP to town level " + (st.level + 1);
    $("weatherText").textContent = $("weatherText").title = progress.weatherText();
    const d = st.daily;
    if (d) {
      const done = d.goals.filter((g) => g.count >= g.n).length;
      const ready = d.goals.some((g) => g.count >= g.n && !g.claimed);
      $("dailyCount").textContent = done + "/" + d.goals.length;
      $("dailyBtn").classList.toggle("ready", ready);
    }
  }

  // ---------- weather effects (rain, snow, festivals...) ----------
  let weatherFx = null;
  let lastWeatherKey = "";
  function applyWeather() {
    if (!window.Weather3D) return;
    if (!weatherFx) {
      weatherFx = window.Weather3D.create(hub);
      const update = hub.update.bind(hub);
      hub.update = (dt) => { update(dt); weatherFx.update(dt, hub.time); };
      const useWorld = hub.useWorld.bind(hub);
      hub.useWorld = (world) => { useWorld(world); weatherFx.setWorld(world); weatherFx.set(stateNow()); };
      weatherFx.setWorld(hub.world);
    }
    const s = stateNow();
    const key = JSON.stringify(s);
    if (key !== lastWeatherKey) { lastWeatherKey = key; weatherFx.set(s); }
  }
  const stateNow = () => { const w = progress.weather(); return { weather: w.weather, season: w.season, festival: w.festival, night: !!w.night }; };

  // ---------- wishes panel ----------
  let wishKey = "";

  // Who has a wish: a 💭 by their name in Residents (and over their head). What the wish is,
  // you find out by talking to them (their menu).
  function renderWishes(force) {
    const list = sortedRecords().filter((r) => r.wish);
    for (const el of document.querySelectorAll("[data-wish-flag]")) {
      const r = records.get(el.dataset.wishFlag);
      el.hidden = !(r && r.wish);
      if (r && r.wish) el.title = nameOf(r) + " wants something! Go and talk to " + nameOf(r) + " to find out what.";
      el.classList.toggle("new", !!(r && r.wish && !r.wish.heard));
    }
    if (!$("wishes")) return;
    const key = list.map((r) => r.id + r.wish.type + r.wish.at + (r.wish.target || "")).join(",");
    $("wishCount").textContent = list.length;
    // just update the timers if nothing else changed
    if (!force && key === wishKey) {
      for (const el of document.querySelectorAll("[data-wish-time]")) {
        const r = records.get(el.dataset.wishTime);
        if (r && r.wish) el.style.width = Math.max(0, Math.min(100, (r.wish.left / 480) * 100)) + "%";
      }
      return;
    }
    wishKey = key;
    const ul = $("wishes");
    ul.innerHTML = "";
    if (!list.length) { ul.innerHTML = '<li class="empty">No wishes right now. Check back soon!</li>'; return; }
    for (const rec of list) {
      const w = rec.wish;
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.alt = ""; img.dataset.portrait = rec.id; img.src = portraitFor(rec);
      const body = document.createElement("div");
      body.className = "wish-body";
      body.innerHTML = "<div class=\"wish-text\"><b>" + escapeHtml(nameOf(rec)) + "</b> " + w.icon + " " + escapeHtml(w.text) + "</div>" +
        '<div class="wish-time"><div data-wish-time="' + rec.id + '"></div></div>';
      const acts = document.createElement("div");
      acts.className = "wish-acts";
      for (const a of progress.wishActions(rec)) {
        const b = document.createElement("button");
        b.textContent = a.text;
        b.addEventListener("click", (e) => wishAction(rec, a.id, e));
        acts.appendChild(b);
      }
      body.appendChild(acts);
      li.append(img, body);
      ul.appendChild(li);
    }
    renderWishes(false);
  }

  // Runs fn with the Mii on screen: goes to where it is (or visits it at home) first.
  function withWalker(rec, fn) {
    let w = walkerOf(rec.id);
    if (w) { fn(w); return; }
    if (rec.place === "away") { toast(nameOf(rec) + " is on vacation! ✈️"); return; }
    if (town.isTravelling(rec)) { toast(nameOf(rec) + " is on the way somewhere. Try again in a moment!"); return; }
    if (rec.place === "home") visit(rec);
    else goToScene(rec.place);
    let tries = 0;
    const iv = setInterval(() => {
      w = walkerOf(rec.id);
      if (w || ++tries > 40) { clearInterval(iv); if (w) fn(w); }
    }, 200);
  }

  function wishAction(rec, id, e) {
    const w = rec.wish;
    if (!w) return;
    switch (id) {
      case "food": openFoodPicker(rec); break;
      case "visit":
        if (w.slot) { panelTab = "decorate"; panelSlot = w.slot; }
        visit(rec, w.slot && H.roomOf ? { room: H.roomOf(w.slot) } : undefined);
        break;
      case "band": progress.startBand(rec); break;
      case "show": if (lifeHub) lifeHub.startBand(rec); break;
      case "game":
        withWalker(rec, (ww) => openGame(ww, w.game));
        break;
      case "send": sendTo(rec, w.place); break;
      case "menu": withWalker(rec, (ww) => { openMiiMenu(ww, innerWidth / 2, innerHeight / 2); const cp = menu.querySelector(".mm-catch input"); if (cp) cp.focus(); }); break;
      case "see":
        withWalker(rec, () => toast(w.type === "highFive" ? "Click " + nameOf(rec) + " to say hi! 👋" : "Right-click " + nameOf(rec) + " and pick the trick from the menu!"));
        break;
      case "together": { const o = records.get(w.target); if (o) { progress.bringTogether(rec, o); toast("🤝 " + nameOf(rec) + " and " + nameOf(o) + " are heading to the same place!"); } break; }
      case "makeUp": progress.startMakeUp(rec); toast("🩹 " + nameOf(rec) + " is going to apologize..."); break;
      case "confess": progress.startConfession(rec); toast("💌 " + nameOf(rec) + " is working up the courage..."); break;
      case "notYet": progress.dismiss(rec); break;
    }
  }

  // ---------- giving food from anywhere ----------
  function openFoodPicker(rec) {
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big";
    card.innerHTML = "<h3>🍙 Food for " + escapeHtml(nameOf(rec)) + "</h3><p>" + (prefs.sandbox ? "🧪 Sandbox mode: everything's free!" : "Paid with " + escapeHtml(nameOf(rec)) + "'s coins: <b>🪙 " + (rec.coins || 0) + "</b>.") + " Today's menu:</p>";
    const grid = document.createElement("div");
    grid.className = "hp-grid wide";
    const close = () => back.remove();
    foodButtons(rec, grid, close);
    const cancel = document.createElement("button");
    cancel.className = "choice-btn plain";
    cancel.textContent = "Close";
    cancel.addEventListener("click", close);
    card.append(grid, cancel);
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
  }

  // ---------- mini-games (also counts for wishes and goals) ----------
  function openGame(w, gameId) {
    const rec = w.record;
    const g = window.MiniGames.GAMES[gameId];
    closeMiiMenu();
    if (gameId === "paintball") { openPaintball({ opponent: rec }); return g; }
    if (gameId === "chess") {
      window.ChessUI.playMii({
        walker: w, hub, stage: $("stage"),
        portrait: portraitFor(rec), stats: gameStats(rec, "chess"),
        onSave: () => saveSoon(rec),
        onFinish: (result) => progress.event({ type: "game", id: rec.id, game: "chess", result }),
      });
      return g;
    }
    window.MiiGamesUI.open({
      walker: w, game: gameId, hub, stage: $("stage"),
      portrait: portraitFor(rec), stats: gameStats(rec, gameId),
      onSave: () => saveSoon(rec),
      onFinish: (result) => progress.event({ type: "game", id: rec.id, game: gameId, result }),
    });
    return g;
  }

  // ---------- Paintball (its files only load when you open it) ----------
  let pbLoading = null;
  function loadPaintball() {
    if (window.Paintball) return Promise.resolve();
    if (pbLoading) return pbLoading;
    const files = ["pb-engine.js", "pb-skins.js", "pb-layouts.js", "pb-scenery.js", "pb-map.js", "pb-models.js", "pb-audio.js", "pb-crates.js", "pb-game.js", "pb-online.js"];
    // pb-config.js (the online server's address) only exists in built apps: it's fine if it's missing
    const optional = new Promise((resolve) => {
      const sc = document.createElement("script");
      sc.src = "js/paintball/pb-config.js";
      sc.onload = sc.onerror = () => resolve();
      document.head.appendChild(sc);
    });
    pbLoading = files.reduce((p, f) => p.then(() => new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "js/paintball/" + f;
      sc.onload = resolve;
      sc.onerror = () => reject(new Error("couldn't load " + f));
      document.head.appendChild(sc);
    })), optional);
    pbLoading.catch(() => { pbLoading = null; });
    return pbLoading;
  }
  async function openPaintball(o) {
    o = o || {};
    closeMiiMenu();
    if (records.size < 2) { toast("🎯 Paintball needs at least 2 Miis"); return; }
    const btn = $("paintballBtn");
    btn.disabled = true; btn.textContent = "🎯 Loading…";
    try { await loadPaintball(); } catch (err) { toast("Couldn't load Paintball: " + err.message); btn.disabled = false; btn.textContent = "🎯 Paintball"; return; }
    btn.disabled = false; btn.textContent = "🎯 Paintball";
    hub.paused = true; // the hub stops drawing while you play
    if (window.MiiMusic) MiiMusic.pause(true); // no hub music during Paintball
    window.Paintball.open({
      records: sortedRecords(),
      templateFor, lookFor, portraitFor,
      statsFor: (r) => gameStats(r, "paintball"),
      onSave: (r) => saveSoon(r),
      onFinish: ({ result, opp }) => {
        opp.coins = (opp.coins || 0) + (result === "mii" ? 5 : 3); // playing with you is time well spent
        saveSoon(opp);
        progress.event({ type: "game", id: opp.id, game: "paintball", result });
        renderCoins();
      },
      onClose: () => { hub.paused = false; if (window.MiiMusic) MiiMusic.pause(false); },
      opponent: o.opponent, player: o.player,
    });
  }

  // ---------- Chess lobby (VS a Mii, or online) ----------
  // your color online: a random Mii's shirt, or a Mii file's favorite color
  function favColorOf(rec) {
    if (rec.look && rec.look.shirt) return rec.look.shirt;
    const fav = (infos.get(rec.id) || {}).favoriteColor;
    return (M.FAVORITE_COLORS[fav] || M.FAVORITE_COLORS[5]).hex;
  }
  function openChessLobby() {
    closeMiiMenu();
    window.ChessUI.openLobby({
      records: sortedRecords(), stage: $("stage"),
      portraitFor, nameOf, colorFor: favColorOf,
      statsFor: (r) => gameStats(r, "chess"),
      onPlay: (r) => withWalker(r, (ww) => openGame(ww, "chess")),
    });
  }

  // ---------- level ups ----------
  const levelQueue = [];
  let levelOpen = false;
  progress.on("levelup", (rec, choices) => { levelQueue.push({ rec, choices }); nextLevelUp(); });
  async function nextLevelUp() {
    if (levelOpen || !levelQueue.length) return;
    levelOpen = true;
    const { rec, choices } = levelQueue.shift();
    const w = walkerOf(rec.id);
    if (w) { w.showEmote("⭐", 3); w.hop(5); w.arms = "cheer"; hub.later(w, 2, () => { if (w.arms === "cheer") w.arms = "down"; }); }
    const pickd = await ask("⭐ " + nameOf(rec) + " is now level " + rec.level + "!", "Pick a present for " + nameOf(rec) + ":",
      choices.map((c) => ({ label: c.icon + " <b>" + escapeHtml(c.title) + "</b><small>" + escapeHtml(c.desc) + "</small>", value: c, kind: "primary" })));
    progress.applyGift(rec, pickd || choices[choices.length - 1]);
    const g = pickd || choices[choices.length - 1];
    toast("🎁 " + nameOf(rec) + " got: " + g.title);
    levelOpen = false;
    nextLevelUp();
  }
  progress.on("townlevel", async (level, news) => {
    toast("🏙️ The town reached level " + level + "!");
    await ask("🏙️ Town level " + level + "!", "Your town is growing! Every Mii got " + progress.levelCoins(level) + " coins." + (news.length ? " New:" : ""),
      news.map((u) => ({ label: u.icon + " " + escapeHtml(u.text), value: true, kind: "plain" })).concat([{ label: "<b>Yay!</b>", value: true, kind: "primary" }]));
  });

  // ---------- daily goals ----------
  function openDaily() {
    progress.rollDaily();
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big";
    const close = () => back.remove();
    function draw() {
      const d = progress.state.daily;
      card.innerHTML = "<h3>📅 Today's goals</h3><p>New goals every day. Each one gives 40 town XP and 8 coins to every Mii; finish all three for a bonus!</p>";
      d.goals.forEach((g, i) => {
        const row = document.createElement("div");
        row.className = "goal" + (g.claimed ? " claimed" : "");
        const pct = Math.min(100, (g.count / g.n) * 100);
        row.innerHTML = '<span class="goal-icon">' + g.icon + '</span><div class="goal-body"><div>' + escapeHtml(g.text) + ' <small>' + Math.min(g.count, g.n) + "/" + g.n + '</small></div><div class="xp"><div class="xp-fill" style="width:' + pct + '%"></div></div></div>';
        const b = document.createElement("button");
        b.className = "tb-btn";
        b.textContent = g.claimed ? "✓" : "Claim";
        b.disabled = g.claimed || g.count < g.n;
        b.addEventListener("click", () => { progress.claim(i); draw(); renderTownBar(); });
        row.appendChild(b);
        card.appendChild(row);
      });
      const ok = document.createElement("button");
      ok.className = "choice-btn plain";
      ok.textContent = "Close";
      ok.addEventListener("click", close);
      card.appendChild(ok);
    }
    draw();
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
  }

  townBar.querySelector(".town-level").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTownLevels(); } });

  // ---------- town levels: what you've got so far, and what's next ----------
  function openTownLevels() {
    const st = progress.state;
    const U = window.MiiProgress.UNLOCKS;
    const last = Math.max(st.level + 2, U.reduce((m, u) => Math.max(m, u.level), 2));
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big town-levels";
    const close = () => back.remove();
    const need = progress.xpNeeded(st.level);
    card.innerHTML = "<h3>🏙️ Town level " + st.level + "</h3><p>Grant your Miis' wishes (and finish daily goals) to earn town XP. Every new level gives each Mii coins (10 × the level, up to 100), and some unlock new things.</p>" +
      '<div class="tl-now"><div class="xp"><div class="xp-fill" style="width:' + Math.min(100, (st.xp / need) * 100) + '%"></div></div><small>' + st.xp + " / " + need + " XP to level " + (st.level + 1) + "</small></div>";
    const list = document.createElement("div");
    list.className = "tl-list";
    for (let lv = 2; lv <= last; lv++) {
      const got = lv <= st.level, next = lv === st.level + 1;
      const row = document.createElement("div");
      row.className = "tl-row" + (got ? " got" : "") + (next ? " next" : "");
      const items = U.filter((u) => u.level === lv).map((u) => "<li>" + u.icon + " " + escapeHtml(u.text) + "</li>").join("") + "<li>🪙 " + progress.levelCoins(lv) + " coins for every Mii</li>";
      row.innerHTML = '<div class="tl-badge">' + (got ? "✓" : next ? "▶" : "🔒") + '</div><div class="tl-body"><b>Level ' + lv + (next ? " · next" : got ? "" : "") + "</b><ul>" + items + "</ul></div>";
      list.appendChild(row);
    }
    card.appendChild(list);
    const ok = document.createElement("button");
    ok.className = "choice-btn plain";
    ok.textContent = "Close";
    ok.addEventListener("click", close);
    card.appendChild(ok);
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
    const nx = list.querySelector(".next");
    if (nx) nx.scrollIntoView({ block: "center" });
  }

  // ---------- sticker book ----------
  // a hint for a sticker you don't have yet (without giving it all away)
  function stickerHint(st) {
    const id = st.id;
    if (id.startsWith("food-")) return "Feed a Mii something it hasn't eaten yet. Keep an eye on the daily shop.";
    if (id.startsWith("furn-")) return "Buy something new for a Mii's home. Some things only show up at higher town levels.";
    if (id.startsWith("place-")) return "Go and look somewhere you haven't been yet.";
    if (id.startsWith("w-")) return "Keep playing: the weather changes from day to day.";
    if (id.startsWith("f-")) return "Some days are festival days. Be there when it happens!";
    if (id.startsWith("bf") || id.startsWith("couple")) return "Help your Miis get closer: let them chat, grant their wishes...";
    if (id === "madeup") return "When two Miis fall out, help them patch things up.";
    if (id === "rival") return "Sometimes Miis who keep arguing never quite get along...";
    if (id.startsWith("g-")) return "Play mini-games with your Miis.";
    if (id.startsWith("t-wish")) return "Grant your Miis' wishes.";
    if (id.startsWith("t-lv")) return "Grow your town by granting wishes and finishing daily goals.";
    if (id.startsWith("t-mii")) return "Help a Mii level up by keeping it happy.";
    if (id === "t-daily") return "Finish all three of today's goals (📅 Daily).";
    if (id === "t-daily7") return "Finish all your daily goals on 7 different days (📅 Daily).";
    if (id.startsWith("h-")) return st.hint || "Something rare happens somewhere, but only while you're watching...";
    // anything else: just the vaguest version of what it is
    return "Something to do with: " + String(st.desc).split(" ").slice(0, 3).join(" ") + "…";
  }
  function openBook() {
    const pages = progress.stickerPages();
    let page = 0;
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card book";
    const close = () => back.remove();
    // (in sandbox mode / at a faster speed nothing new sticks; a milestone reached then never counts)
    const locked = progress.stickersLocked();
    const earned = progress.state.stickers;
    for (const p of pages) for (const s of p.stickers) {
      s.voided = !earned[s.id] && progress.isVoided(s.id);
      s.got = !!earned[s.id] || (s.got && !locked && !s.voided);
    }
    function draw() {
      const all = pages.flatMap((p) => p.stickers);
      card.innerHTML = "<h3>📖 Sticker book <small>" + all.filter((s) => s.got).length + " / " + all.length + "</small></h3>" +
        (locked ? '<p class="book-locked">⏸️ Stickers are paused while ' + modeText() + " (⚙️ Settings).</p>" : "");
      const tabsEl = document.createElement("div");
      tabsEl.className = "book-tabs";
      pages.forEach((p, i) => {
        const b = document.createElement("button");
        b.textContent = p.icon + " " + p.name;
        b.setAttribute("aria-pressed", String(i === page));
        b.addEventListener("click", () => { page = i; draw(); });
        tabsEl.appendChild(b);
      });
      const grid = document.createElement("div");
      grid.className = "stickers";
      for (const st of pages[page].stickers) {
        const d = document.createElement("div");
        d.className = "sticker" + (st.got ? " got" : "");
        d.dataset.tip = st.got ? "✔ " + st.desc : st.voided ? "🚫 This happened while sandbox mode or a faster speed was on, so it doesn't count." : "Hint: " + stickerHint(st);
        d.innerHTML = "<span>" + (st.got ? st.icon : "❔") + "</span><small>" + escapeHtml(st.got ? st.name : "???") + "</small>";
        grid.appendChild(d);
      }
      const ok = document.createElement("button");
      ok.className = "choice-btn plain";
      ok.textContent = "Close";
      ok.addEventListener("click", close);
      // hover (or tap) a sticker: how you got it, or a hint
      const tip = document.createElement("div");
      tip.className = "sticker-tip";
      tip.textContent = "Hover over a sticker to see how to get it.";
      const showTip = (e) => { const sd = e.target.closest(".sticker"); if (sd) { tip.textContent = sd.dataset.tip; tip.classList.toggle("got", sd.classList.contains("got")); } };
      grid.addEventListener("mouseover", showTip);
      grid.addEventListener("click", showTip);
      card.append(tabsEl, grid, tip, ok);
    }
    draw();
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
  }

  progress.on("change", () => { renderWishes(false); renderTownBar(); });
  setInterval(() => { renderWishes(false); renderTownBar(); applyWeather(); }, 1000);
  renderWishes(true); renderTownBar(); applyWeather();

  // ---------- full screen (the 3D scene, and the side panel if it's open) ----------
  const stageEl = $("stage");
  const layoutEl = document.querySelector(".layout");
  const fsBtn = $("fullscreenBtn");
  const isFull = () => document.fullscreenElement === layoutEl || document.webkitFullscreenElement === layoutEl;
  function toggleFullscreen() {
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (layoutEl.requestFullscreen || layoutEl.webkitRequestFullscreen).call(layoutEl).catch(() => {});
  }
  fsBtn.addEventListener("click", toggleFullscreen);
  for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(ev, () => {
      const on = isFull();
      fsBtn.textContent = on ? "✕" : "⛶";
      fsBtn.title = on ? "Exit full screen (F or Esc)" : "Full screen (F)";
      stageEl.classList.toggle("is-full", on);
      layoutEl.classList.toggle("is-full", on);
      // let the browser finish resizing, then fit the 3D view to the new size
      requestAnimationFrame(() => hub.resize());
    });
  }
  document.addEventListener("keydown", (e) => {
    const typing = /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || "");
    if (!typing && (e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
  });
  // the side panel opening/closing (or a smaller window) changes the 3D view's size:
  // fit it without moving the camera
  if (window.ResizeObserver) new ResizeObserver(() => hub.resize(true)).observe(stageEl);

  // little place buttons on the scene itself (handy in full screen)
  const stageScenes = $("stageScenes");
  for (const scene of window.World3D.list) {
    const b = document.createElement("button");
    b.className = "stage-btn";
    b.textContent = scene.icon;
    b.title = scene.name;
    b.setAttribute("aria-label", scene.name);
    b.dataset.scene = scene.id;
    b.addEventListener("click", () => goToScene(scene.id));
    stageScenes.appendChild(b);
  }

  // ---------- ➕ Add Miis (top bar) ----------
  const addMenu = $("addMenu"), addBtn = $("addBtn");
  const showAdd = (on) => { addMenu.hidden = !on; addBtn.setAttribute("aria-expanded", String(on)); };
  addBtn.addEventListener("click", () => showAdd(addMenu.hidden));
  $("demoBtn").addEventListener("click", () => showAdd(false));
  $("fileInput").addEventListener("change", () => showAdd(false));
  document.addEventListener("pointerdown", (e) => { if (!addMenu.hidden && !e.target.closest(".add-wrap")) showAdd(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") showAdd(false); });
  // (errors from adding files show up even with the menu closed)
  new MutationObserver(() => { if (errorMsg.textContent) toast("⚠ " + errorMsg.textContent); }).observe(errorMsg, { childList: true, characterData: true, subtree: true });

  // ---------- sandbox mode / simulation speed: a badge in the top bar while on ----------
  function modeText() {
    const on = [];
    if (prefs.sandbox) on.push("sandbox mode");
    if (prefs.simSpeed > 1) on.push(prefs.simSpeed + "× speed");
    return on.join(" and ") + (on.length > 1 ? " are on" : " is on");
  }
  function renderModeBadge() {
    const b = $("modeBadge");
    b.hidden = !prefs.sandbox && prefs.simSpeed <= 1;
    b.textContent = (prefs.sandbox ? "🧪 Sandbox" : "") + (prefs.sandbox && prefs.simSpeed > 1 ? " · " : "") + (prefs.simSpeed > 1 ? "⏩ " + prefs.simSpeed + "×" : "");
    b.title = "Stickers are paused while " + modeText() + ". Click to change it in Settings.";
  }
  $("modeBadge").addEventListener("click", () => openSettings());
  renderModeBadge();

  // Turns sandbox mode / a faster speed on or off (asks first: no stickers while either is on).
  async function setMode(kind, value) {
    const was = prefs.sandbox || prefs.simSpeed > 1;
    const turningOn = kind === "sandbox" ? value && !prefs.sandbox : value > 1 && prefs.simSpeed <= 1;
    if (turningOn && !was) {
      const what = kind === "sandbox"
        ? "🧪 Sandbox mode makes everything free and unlocks everything in the shop (whatever the town level), so you can try things out."
        : "⏩ " + value + "× speed makes everything in town happen " + value + " times faster: walking, chatting, friendships, wishes...";
      const ok = await ask(kind === "sandbox" ? "Turn on sandbox mode?" : "Speed things up?",
        what + " While it's on, you can't earn any stickers. Things you see or do meanwhile won't count for stickers later, and milestones reached meanwhile (like a new couple or town level) never give their sticker.", [
          { label: "<b>Yes, turn it on</b><small>No stickers until I turn it off again</small>", value: true, kind: "primary" },
          { label: "Cancel", value: false, kind: "plain" },
        ]);
      if (!ok) return false;
    }
    if (kind === "sandbox") prefs.sandbox = !!value;
    else prefs.simSpeed = value;
    hub.timeScale = prefs.simSpeed;
    progress.setSandbox(prefs.sandbox);
    progress.setStickerLock(prefs.sandbox || prefs.simSpeed > 1);
    if (was && !(prefs.sandbox || prefs.simSpeed > 1)) toast("🏷️ Stickers are back on!");
    saveSettings();
    renderModeBadge();
    if (!panel.hidden) renderHomePanel();
    return true;
  }

  // ---------- light / dark mode ----------
  function applyTheme() {
    if (prefs.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = prefs.theme;
  }
  applyTheme();

  // ---------- reset all progress (keeps the Miis themselves) ----------
  async function resetProgress() {
    const ok = await ask("Reset all progress?", "This starts your town over: the town level, sticker book, daily goals, every friendship, couple and fight, and each Mii's level, hearts, coins, wishes, special moves, songs, game skills and furniture. Your Miis stay (names, looks and personalities).", [
      { label: "🔄 <b>Reset everything</b>", value: true, kind: "danger" },
      { label: "Cancel", value: false, kind: "plain" },
    ]);
    if (!ok) return;
    const sure = await ask("Are you really sure?", "There's no undo. Everything your town has earned so far will be gone for good.", [
      { label: "Cancel", value: false, kind: "primary" },
      { label: "⚠️ <b>Yes, reset all progress</b>", value: true, kind: "danger" },
    ]);
    if (!sure) return;
    closeMiiMenu();
    if (hub.visiting) leaveHome();
    resetting = true; // (nothing more gets saved from the old progress)
    clearTimeout(saveProgressTimer);
    for (const rec of records.values()) {
      for (const k of ["level", "happy", "moves", "songs", "foods", "wish", "games", "sweetheart", "home", "mood"]) delete rec[k];
      rec.coins = undefined;
      H.ensureHome(rec);
    }
    await Promise.all(Array.from(records.values()).map((r) => S.putMii(r)));
    hub.friendships = {};
    prefs.sandbox = false;
    prefs.simSpeed = 1;
    saveSettings();
    try { localStorage.removeItem(PROGRESS_KEY); } catch (e) { /* private window */ }
    location.reload();
  }

  // ---------- desktop app: version and updates ----------
  const desktop = window.miiHubDesktop;
  let appVersion = null;
  let updateState = null;
  if (desktop) {
    desktop.onUpdateStatus((st) => { updateState = st; renderUpdateStatus(); });
    desktop.getStatus().then((st) => {
      updateState = st;
      renderUpdateStatus();
      if (!st || !st.version) return;
      appVersion = st.version;
      // the first time Mii Hub opens after an update, show what's new
      let seen = null;
      try { seen = localStorage.getItem("mii-hub-notes-version"); localStorage.setItem("mii-hub-notes-version", appVersion); } catch (e) { return; }
      if (seen !== appVersion && window.PatchNotes) setTimeout(() => { PatchNotes.open(appVersion); renderNotesBadge(); }, 800);
    });
  }
  function updateText(st) {
    if (!st) return "Updates are checked automatically.";
    return {
      idle: "Updates are checked automatically.",
      dev: "Running from source code: updates are off.",
      checking: "Checking for updates…",
      latest: "You have the latest version. ✓",
      available: "Version " + st.latest + " is available!",
      downloading: "Downloading update… " + (st.percent || 0) + "%",
      ready: "Update ready: it installs when you restart Mii Hub.",
      error: "Couldn't check for updates right now.",
    }[st.state] || "";
  }
  function renderUpdateStatus() {
    const el = $("updateStatus"), btn = $("checkUpdatesBtn");
    if (el) el.textContent = updateText(updateState);
    if (btn) btn.disabled = !!updateState && (updateState.state === "checking" || updateState.state === "downloading");
    const v = $("appVersion");
    if (v && updateState && updateState.version) v.textContent = "v" + updateState.version;
  }
  // a dot on ⚙️ while there are patch notes you haven't read
  function renderNotesBadge() {
    const unseen = !!(window.PatchNotes && PatchNotes.unseen());
    $("settingsDot").hidden = !unseen;
    const nb = $("patchNotesNew");
    if (nb) nb.hidden = !unseen;
  }
  renderNotesBadge();

  // ---------- ⚙️ Settings ----------
  $("settingsBtn").addEventListener("click", () => openSettings());
  function openSettings() {
    closeSettings();
    const back = document.createElement("div");
    back.className = "choice-modal settings-modal";
    back.id = "settings";
    const card = document.createElement("div");
    card.className = "choice-card settings-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Settings");
    const seg = (name, options, value, onPick) =>
      '<div class="seg" role="radiogroup" aria-label="' + name + '">' + options.map(([v, text]) =>
        '<button role="radio" data-seg="' + name + '" data-v="' + v + '" aria-checked="' + String(String(v) === String(value)) + '">' + text + "</button>").join("") + "</div>";
    card.innerHTML =
      '<div class="set-head"><h3>⚙️ Settings</h3><button class="mm-close" id="setClose" aria-label="Close">✕</button></div>' +
      '<section class="set-sec"><h4>Look</h4>' +
        '<div class="set-row"><span>🌙 Dark mode</span>' + seg("theme", [["system", "Auto"], ["light", "☀️ Light"], ["dark", "🌙 Dark"]], prefs.theme) + "</div>" +
        (desktop ? '<div class="set-row"><span>🌐 Show as tab in browser<small>Opens Mii Hub in your web browser too. (Its Miis are saved separately from the app\'s.)</small></span><button class="tb-btn" id="openBrowserBtn">Open</button></div>' : "") +
      "</section>" +
      '<section class="set-sec"><h4>Your Miis</h4>' +
        '<label class="set-row"><span>💬 How chatty?<small>How often Miis start chatting</small></span><input type="range" id="chatty" min="0.3" max="2.5" step="0.1" value="' + hub.chattiness + '" /></label>' +
        '<div class="set-row"><span>⏩ Simulation speed<small>Faster = no stickers while it\'s on</small></span>' + seg("speed", [[1, "1×"], [2, "2×"], [4, "4×"]], prefs.simSpeed) + "</div>" +
        '<div class="set-row"><span>🧪 Sandbox mode<small>Everything free and unlocked. No stickers while it\'s on</small></span>' + seg("sandbox", [["off", "Off"], ["on", "On"]], prefs.sandbox ? "on" : "off") + "</div>" +
        (prefs.sandbox || prefs.simSpeed > 1 ? '<p class="set-warn">⏸️ Stickers are paused while ' + modeText() + ".</p>" : "") +
      "</section>" +
      '<section class="set-sec"><h4>Updates</h4>' +
        (desktop ? '<div class="set-row"><span>Mii Hub <b id="appVersion"></b><small id="updateStatus"></small></span><button class="tb-btn" id="checkUpdatesBtn">Check for updates</button></div>' : "") +
        '<div class="set-row"><span>📜 Patch notes<small>What\'s new in every update</small></span><button class="tb-btn" id="patchNotesBtn">Open<span class="pn-badge" id="patchNotesNew" hidden>NEW</span></button></div>' +
      "</section>" +
      '<section class="set-sec danger"><h4>Start over</h4>' +
        '<div class="set-row"><span>🔄 Reset all progress<small>Town level, stickers, friendships, levels, coins and furniture. Your Miis stay.</small></span><button class="tb-btn danger" id="resetBtn">Reset…</button></div>' +
        '<div class="set-row"><span>📦 Remove all Miis<small>Everyone moves away, with their homes</small></span><button class="tb-btn danger" id="clearBtn">Remove…</button></div>' +
      "</section>";
    // your account, worlds, saving and backups go first (account.js)
    if (window.MiiAccount) card.insertBefore(window.MiiAccount.settingsSection(), card.querySelector(".set-sec"));
    back.appendChild(card);
    document.body.appendChild(back);
    const close = () => closeSettings();
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    card.querySelector("#setClose").addEventListener("click", close);
    // the segmented buttons
    for (const b of card.querySelectorAll("[data-seg]")) {
      b.addEventListener("click", async () => {
        const v = b.dataset.v;
        if (b.dataset.seg === "theme") { prefs.theme = v; applyTheme(); saveSettings(); }
        else {
          closeSettings(); // (so the "are you sure?" question isn't hidden behind it)
          if (b.dataset.seg === "speed") await setMode("speed", Number(v));
          else await setMode("sandbox", v === "on");
        }
        openSettings(); // (redraw)
      });
    }
    $("chatty").addEventListener("input", (e) => { hub.chattiness = parseFloat(e.target.value); saveSettings(); });
    if (desktop) {
      $("openBrowserBtn").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const r = await desktop.openInBrowser();
          toast(r && r.ok ? "🌐 Opened Mii Hub in your browser" : "Couldn't open the browser" + (r && r.error ? ": " + r.error : ""));
        } catch (err) { toast("Couldn't open the browser: " + err.message); }
        btn.disabled = false;
      });
      $("checkUpdatesBtn").addEventListener("click", () => desktop.checkForUpdates());
      renderUpdateStatus();
    }
    if (window.PatchNotes) $("patchNotesBtn").addEventListener("click", () => { PatchNotes.open(appVersion); renderNotesBadge(); });
    else $("patchNotesBtn").closest(".set-row").hidden = true;
    renderNotesBadge();
    $("resetBtn").addEventListener("click", () => { close(); resetProgress(); });
    $("clearBtn").addEventListener("click", () => { close(); removeAllMiis(); });
    document.addEventListener("keydown", settingsKey);
    const first = card.querySelector("[aria-checked=true]");
    if (first) first.focus();
  }
  function settingsKey(e) { if (e.key === "Escape") closeSettings(); }
  function closeSettings() {
    const m = document.getElementById("settings");
    if (m) m.remove();
    document.removeEventListener("keydown", settingsKey);
  }

  // =====================================================================
  // 📷 Group picture: pick poses for the Miis here, then take a picture of the 3D view
  // =====================================================================
  // Poses: some need a friend standing next to them (the closer, the fancier).
  const POSES = [
    { id: "stand", icon: "🧍", name: "Stand", pose: { arms: "down" } },
    { id: "wave", icon: "👋", name: "Wave", pose: { arms: "wave" } },
    { id: "cheer", icon: "🙌", name: "Hands up", pose: { arms: "cheer" } },
    { id: "flex", icon: "💪", name: "Flex", pose: { arms: "flex" } },
    { id: "bow", icon: "🙇", name: "Bow", pose: { bow: true } },
    { id: "lean", icon: "🤗", name: "Lean in", need: 4, pose: { lean: 1 } },
    { id: "highfive", icon: "✋", name: "High five", need: 9, pose: { arms: "up", face: 1 } },
    { id: "heart", icon: "💕", name: "Heart", need: 16, love: true, pose: { lean: 1, face: 0.5 }, mark: "💕" },
  ];
  const JUMP_NEED = 4; // everyone jumps: all of them at least Friends
  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  const ptsOf = (a, b) => hub.friendships[pairKey(a.id, b.id)] || 0;
  const fighting = (a, b) => { const p = progress.state.pairs[pairKey(a.id, b.id)]; return !!(p && p.fight); };
  const sweethearts = (a, b) => a.sweetheart === b.id || b.sweetheart === a.id || !!(progress.state.pairs[pairKey(a.id, b.id)] || {}).couple;
  const levelName = (pts) => { const l = D.levelFor(pts); return l.emoji + " " + l.name; };
  const needName = (n) => levelName(n);

  // the Miis who can be in a picture right now (here, not busy leaving or on the phone)
  function photoCandidates() {
    if (hub.visiting) return [];
    return hub.walkers.filter((w) => !w.leaving && w.vanish <= 0 && w.appear >= 0.5 && !hub.calls.has(w.id) && w.state !== "playing");
  }

  function openPhotoPicker(firstW) {
    const here = photoCandidates();
    if (here.length < 2 || !here.includes(firstW)) { toast("📷 A group picture needs at least 2 Miis here"); return; }
    const first = firstW.record;
    const recs = here.map((w) => w.record);
    // who's in it: everyone who isn't fighting with someone already in (best friends of the first Mii first)
    const inPic = new Set([first.id]);
    for (const r of recs.filter((r) => r !== first).sort((a, b) => ptsOf(first, b) - ptsOf(first, a))) {
      if (!recs.some((o) => inPic.has(o.id) && fighting(o, r))) inPic.add(r.id);
    }
    const pose = new Map(recs.map((r) => [r.id, "wave"]));
    let jump = false;

    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big photo-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Group picture");
    back.appendChild(card);
    $("stage").appendChild(back);
    // everyone here holds still while you set it up (and goes back to normal when it closes)
    hub.holdForPhoto(here);
    let keepHold = false;
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); if (!keepHold) hub.releasePhotoHold(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });

    // left to right: start with the first Mii, then always its closest friend next to the last one
    function lineUp() {
      const left = recs.filter((r) => inPic.has(r.id) && r !== first);
      const order = [first];
      while (left.length) {
        const last = order[order.length - 1];
        left.sort((a, b) => ptsOf(last, b) - ptsOf(last, a));
        order.push(left.shift());
      }
      return order;
    }
    // the friend next to them (left or right) they're closest to
    function bestNeighbor(order, i) {
      const ns = [order[i - 1], order[i + 1]].filter(Boolean);
      ns.sort((a, b) => ptsOf(order[i], b) - ptsOf(order[i], a));
      return ns[0] || null;
    }
    // can this Mii do this pose here? (null = yes, or why not)
    function whyNot(P, order, i) {
      if (!P.need) return null;
      const me = order[i];
      const ok = [order[i - 1], order[i + 1]].filter(Boolean).some((o) => ptsOf(me, o) >= P.need || (P.love && sweethearts(me, o)));
      return ok ? null : "Needs someone next to them who's " + needName(P.need) + (P.love ? " (or their sweetheart)" : "") + " in the picture";
    }
    const allFriends = (order) => order.every((a) => order.every((b) => a === b || ptsOf(a, b) >= JUMP_NEED));

    function draw() {
      const order = lineUp();
      // (a pose that isn't possible any more falls back to waving)
      order.forEach((r, i) => { const P = POSES.find((x) => x.id === pose.get(r.id)); if (whyNot(P, order, i)) pose.set(r.id, "wave"); });
      if (jump && !allFriends(order)) jump = false;
      const place = T.placeInfo(viewedPlace());
      card.innerHTML = "<h3>📷 Group picture at " + escapeHtml(place.name) + "</h3><p>Pick who's in it and how they pose. The picture is saved to your Downloads folder.</p>";

      // who's in it
      const who = document.createElement("div");
      who.className = "ph-who";
      const fights = [];
      for (const r of recs) {
        const foe = recs.find((o) => o !== r && inPic.has(o.id) && fighting(o, r));
        const b = document.createElement("button");
        b.className = "ph-mii";
        b.setAttribute("aria-pressed", String(inPic.has(r.id)));
        b.innerHTML = '<img alt="" data-portrait="' + r.id + '" src="' + portraitFor(r) + '"><span>' + escapeHtml(nameOf(r)) + "</span>" + (foe && !inPic.has(r.id) ? '<small>💢</small>' : "");
        if (r === first) { b.disabled = true; b.title = nameOf(r) + " is taking the picture with everyone"; }
        else if (foe && !inPic.has(r.id)) {
          b.disabled = true;
          b.title = nameOf(r) + " and " + nameOf(foe) + " are fighting, so they won't be in the same picture";
        }
        b.addEventListener("click", () => { if (inPic.has(r.id)) inPic.delete(r.id); else inPic.add(r.id); draw(); });
        who.appendChild(b);
      }
      // explain fights (among everyone here)
      for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++) if (fighting(recs[i], recs[j])) fights.push([recs[i], recs[j]]);
      card.appendChild(who);
      for (const [a, b] of fights) {
        const p = document.createElement("p");
        p.className = "ph-fight";
        p.textContent = "💢 " + nameOf(a) + " and " + nameOf(b) + " had a fight and aren't talking to each other, so they won't be in the same picture. Take one of them out to add the other, or help them make up first (🩹 Make up in a Mii's menu)!";
        card.appendChild(p);
      }

      // poses, left to right
      const list = document.createElement("div");
      list.className = "ph-poses";
      order.forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "ph-row";
        const nb = bestNeighbor(order, i);
        row.innerHTML = '<div class="ph-name"><img alt="" data-portrait="' + r.id + '" src="' + portraitFor(r) + '"><span><b>' + escapeHtml(nameOf(r)) + "</b>" +
          (nb ? "<small>next to " + escapeHtml(nameOf(nb)) + ": " + (sweethearts(r, nb) ? "💑 Sweethearts" : levelName(ptsOf(r, nb))) + "</small>" : "") + "</span></div>";
        const btns = document.createElement("div");
        btns.className = "ph-pose-btns";
        for (const P of POSES) {
          const why = whyNot(P, order, i);
          const b = document.createElement("button");
          b.textContent = why ? "🔒" : P.icon;
          b.title = P.name + (why ? ": " + why : "");
          b.setAttribute("aria-label", b.title);
          b.setAttribute("aria-pressed", String(pose.get(r.id) === P.id));
          b.disabled = !!why;
          b.addEventListener("click", () => { pose.set(r.id, P.id); draw(); });
          btns.appendChild(b);
        }
        row.appendChild(btns);
        list.appendChild(row);
      });
      card.appendChild(list);
      const key = document.createElement("p");
      key.className = "ph-key";
      key.textContent = "🤗 Lean in needs a " + needName(4) + " next to them, ✋ High five needs " + needName(9) + ", 💕 Heart needs " + needName(16) + " or sweethearts. The closer they are, the more poses they can do!";
      card.appendChild(key);

      // everyone jumps (only if they're all friends)
      const jumpOk = allFriends(order);
      const jb = document.createElement("label");
      jb.className = "ph-jump" + (jumpOk ? "" : " off");
      jb.innerHTML = '<input type="checkbox"' + (jump ? " checked" : "") + (jumpOk ? "" : " disabled") + "> 🦘 Everyone jumps!" +
        (jumpOk ? "" : "<small>🔒 Only if everyone in the picture is at least " + escapeHtml(needName(JUMP_NEED)) + " with each other</small>");
      jb.querySelector("input").addEventListener("change", (e) => { jump = e.target.checked; });
      card.appendChild(jb);

      const go = document.createElement("button");
      go.className = "choice-btn primary ph-go";
      go.innerHTML = "📸 <b>Take the picture</b>";
      go.addEventListener("click", () => {
        keepHold = true; // (still holding still for the picture itself)
        close();
        const poses = {};
        order.forEach((r, i) => {
          const P = POSES.find((x) => x.id === pose.get(r.id));
          const p = Object.assign({}, P.pose);
          // lean / turn toward the friend next to them
          const nbr = bestNeighbor(order, i);
          const side = nbr ? (order.indexOf(nbr) > i ? 1 : -1) : 0;
          if (p.lean) p.lean *= side;
          if (p.face) p.face *= side;
          if (P.mark) p.mark = P.mark;
          poses[r.id] = p;
        });
        takeGroupPhoto(order, poses, jump);
      });
      const cancel = document.createElement("button");
      cancel.className = "choice-btn plain";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", close);
      card.append(go, cancel);
    }
    draw();
  }

  // Takes the picture (with the screen tidied away), frames it like a photo and saves it.
  let photoBusy = false;
  async function takeGroupPhoto(order, poses, jump) {
    const list = order.map((r) => walkerOf(r.id)).filter(Boolean);
    if (list.length < 2 || photoBusy) { if (!photoBusy) hub.releasePhotoHold(); return; }
    photoBusy = true;
    closeMiiMenu();
    const say = pick(list);
    say.say(pick(["Say cheese!", "Everybody smile!", "1, 2, 3... cheese!"]), 1.2);
    stageEl.classList.add("photo-mode");
    let shot = null;
    try {
      shot = await hub.takePhoto(list, poses, { jump });
    } catch (err) {
      toast("📷 Couldn't take the picture: " + err.message);
    }
    // the flash
    const flash = document.createElement("div");
    flash.className = "photo-flash";
    stageEl.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
    stageEl.classList.remove("photo-mode");
    hub.releasePhotoHold();
    photoBusy = false;
    if (!shot) return;
    const r = pick(list);
    hub.later(r, 0.6, () => r.say(pick(["Let me see!", "I hope my eyes were open!", "That's a keeper!", "Can I get a copy?"]), 2));
    const url = await framePhoto(shot, order, poses);
    const place = T.placeInfo(viewedPlace());
    const d = new Date();
    const stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + "." + String(d.getMinutes()).padStart(2, "0") + "." + String(d.getSeconds()).padStart(2, "0");
    const fileName = "Mii Hub - " + place.name.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()) + " " + stamp + ".png";
    await savePhoto(url, fileName);
  }

  // A white border with the place and date written under the picture, like a real photo
  // (with a 💕 over anyone doing the heart pose).
  function framePhoto(shot, order, poses) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // crop around the group (a 3:2 picture with a little room around everyone)
        const W = shot.width, Hh = shot.height;
        const xs = shot.heads.map((p) => p.x * W), tops = shot.heads.map((p) => p.y * Hh), feet = shot.heads.map((p) => p.feet.y * Hh);
        const tall = Math.max(...feet.map((f, i) => f - tops[i]), 40);
        let x0 = Math.min(...xs) - tall * 0.75, x1 = Math.max(...xs) + tall * 0.75;
        let y0 = Math.min(...tops) - tall * 0.45, y1 = Math.max(...feet) + tall * 0.3;
        const grow = (a, b, size, max) => { const c = (a + b) / 2, s = Math.min(size, max); let lo = c - s / 2; lo = Math.max(0, Math.min(lo, max - s)); return [lo, lo + s]; };
        if ((x1 - x0) / (y1 - y0) < 1.5) [x0, x1] = grow(x0, x1, (y1 - y0) * 1.5, W);
        else [y0, y1] = grow(y0, y1, (x1 - x0) / 1.5, Hh);
        [x0, x1] = grow(x0, x1, x1 - x0, W);
        [y0, y1] = grow(y0, y1, y1 - y0, Hh);
        const w = Math.round(x1 - x0), h = Math.round(y1 - y0);
        for (const p of shot.heads) { p.x = (p.x * W - x0) / w; p.y = (p.y * Hh - y0) / h; }
        const pad = Math.round(w * 0.03), bottom = Math.round(w * 0.085);
        const c = document.createElement("canvas");
        c.width = w + pad * 2;
        c.height = h + pad + bottom;
        const g = c.getContext("2d");
        g.fillStyle = "#fdfcf8";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, x0, y0, w, h, pad, pad, w, h);
        g.strokeStyle = "rgba(0,0,0,0.12)";
        g.lineWidth = Math.max(1, w / 900);
        g.strokeRect(pad, pad, w, h);
        g.textAlign = "center";
        g.textBaseline = "middle";
        for (const hd of shot.heads) {
          const p = poses[hd.id];
          if (!p || !p.mark) continue;
          g.font = Math.round(w * 0.035) + "px sans-serif";
          g.fillText(p.mark, pad + hd.x * w, pad + hd.y * h);
        }
        const place = T.placeInfo(viewedPlace());
        g.fillStyle = "#3a3f55";
        g.font = "800 " + Math.round(bottom * 0.34) + "px Nunito, sans-serif";
        g.fillText(place.icon + " " + order.map(nameOf).join(", "), c.width / 2, h + pad + bottom * 0.4, w);
        g.fillStyle = "#8a90a6";
        g.font = "700 " + Math.round(bottom * 0.22) + "px Nunito, sans-serif";
        g.fillText(place.name.replace(/^./, (ch) => ch.toUpperCase()) + " · " + new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), c.width / 2, h + pad + bottom * 0.75, w);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => resolve(shot.url);
      img.src = shot.url;
    });
  }

  // =====================================================================
  // Life: clothes, rooms, jobs, vacations and bands (life.js, lifeHub.js)
  // =====================================================================
  if (LF) {
    life = LF.create({
      records, H, D,
      // (not while you're visiting it, it's at work, it's in a band or on its way somewhere)
      canLeave: (rec) => !(hub.visiting && hub.visiting.record.id === rec.id) && !town.info(rec).shift && !progress.bandOf(rec.id) && !town.isTravelling(rec),
      leave: (rec) => town.go(rec, "away"),
      comeBack: (rec, gifts) => { homeGifts.set(rec.id, gifts); progress.event({ type: "life", what: "trips" }); town.go(rec, "apartments"); },
      saveMii: (rec) => saveSoon(rec),
      feed: (text) => hub.addFeed(text),
    });
  }
  if (window.MiiLifeHub) {
    lifeHub = window.MiiLifeHub.create({
      hub, town, progress, records, nameOf, toast, goToScene,
      soundOn: () => !window.MiiMusic || MiiMusic.isOn(),
    });
  }
  const homeGifts = new Map(); // id -> what a Mii brought back from its vacation

  // A Mii changed clothes (bought an outfit, or went to / left work): new look on screen.
  function restyle(rec) {
    const w = walkerOf(rec.id);
    if (w && !w.leaving) {
      w.look = lookFor(rec, w.template);
      w.buildModel();
      w.showEmote("✨", 1.5);
    }
    portraitFor(rec);
    if (hub.visiting && hub.visiting.record.id === rec.id && !w) hub.refreshHome();
  }

  // A shift is over: it got paid.
  function shiftDone(rec, job, pay) {
    hub.addFeed(nameOf(rec) + " finished a shift as " + (/^[aeiou]/i.test(job.name) ? "an " : "a ") + job.name.toLowerCase() + ". +" + pay + " 🪙 " + job.icon);
    const w = walkerOf(rec.id);
    if (w) { w.say(D.pick(["Shift's over! Payday!", "Phew, what a day!", "Time to relax!"]), 2.4); w.showEmote("🪙", 2.4); }
    progress.event({ type: "life", what: "shifts" });
    renderCoins();
  }

  // Back from a vacation: a little welcome, and what it brought home.
  function cameHome(rec) {
    const g = homeGifts.get(rec.id);
    homeGifts.delete(rec.id);
    if (lifeHub) lifeHub.homecoming(rec, g);
    refreshAll(true);
    if (!g) return;
    hub.addFeed(nameOf(rec) + " is back from " + g.dest.name + "! " + g.dest.icon);
    const items = g.souvenirs.map((id) => H.item(id)).filter(Boolean);
    ask("🧳 " + nameOf(rec) + " is back from " + g.dest.name + "! " + g.dest.icon,
      nameOf(rec) + " had a great time, and brought back 🪙 " + g.coins + " coins" + (items.length ? " and souvenirs for their home:" : "!"),
      items.map((it) => ({ label: it.icon + " " + escapeHtml(it.name), value: true, kind: "plain" })).concat([{ label: "<b>Welcome home!</b>", value: true, kind: "primary" }]));
    renderCoins();
  }

  // The "Life" part of the Mii menu: clothes, rooms, its job and its band.
  function lifeSection(rec, w) {
    const sec = document.createElement("div");
    sec.className = "mm-section mm-life";
    if (!LF) return sec;
    sec.innerHTML = "<h3>Life</h3>";
    const row = document.createElement("div");
    row.className = "mm-actions";
    const btn = (icon, text, title, fn) => {
      const b = document.createElement("button");
      b.innerHTML = "<span>" + icon + "</span>" + text;
      b.title = title;
      b.addEventListener("click", () => { closeMiiMenu(); fn(); });
      row.appendChild(b);
    };
    btn("👕", "Buy clothes", "Buy " + nameOf(rec) + " an outfit (paid with its coins)", () => openClothesShop(rec));
    btn("🚪", "Buy rooms", "Buy " + nameOf(rec) + " an extra room for its home", () => openRoomShop(rec));
    sec.appendChild(row);
    // its job (you can change it)
    const jobRow = document.createElement("label");
    jobRow.className = "mm-fav";
    jobRow.textContent = "💼 Job ";
    const sel = document.createElement("select");
    for (const j of LF.JOBS) {
      const o = document.createElement("option");
      o.value = j.id;
      o.textContent = j.icon + " " + j.name + " (" + T.placeInfo(j.place).name + ")";
      sel.appendChild(o);
    }
    sel.value = LF.ensureJob(rec);
    sel.addEventListener("change", () => { rec.job = sel.value; saveSoon(rec); });
    jobRow.appendChild(sel);
    sec.appendChild(jobRow);
    const notes = [];
    const working = town.workingAs(rec);
    if (working) notes.push("At work right now: " + LF.job(working).name + " " + LF.job(working).icon);
    if (rec.shifts) notes.push(rec.shifts + " shift" + (rec.shifts === 1 ? "" : "s") + " worked");
    const band = progress.bandOf(rec.id);
    if (band) {
      const song = (progress.SONGS.find((s) => s.id === band.band.song) || {}).title;
      notes.push(band === rec ? "🎸 Its band (“" + song + "”): " + (band.band.status === "ready" ? "ready to play!" : band.band.members.length + "/" + LF.BAND_SIZE + " members")
        : "🎸 In " + nameOf(band) + "'s band");
    }
    if ((rec.songs || []).length) notes.push("🎵 Knows " + rec.songs.length + " song" + (rec.songs.length === 1 ? "" : "s"));
    if (notes.length) {
      const p = document.createElement("div");
      p.className = "mm-life-notes";
      p.textContent = notes.join(" · ");
      sec.appendChild(p);
    }
    return sec;
  }

  // ---------- the clothes shop ----------
  function openClothesShop(rec) {
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big";
    const close = () => back.remove();
    function draw() {
      const wr = LF.ensureWardrobe(rec);
      const lv = LF.wardrobeLevel(rec);
      const next = LF.WARDROBE_STEPS[lv + 1];
      card.innerHTML = "<h3>👕 Clothes for " + escapeHtml(nameOf(rec)) + "</h3><p>Paid with " + escapeHtml(nameOf(rec)) + "'s coins: <b>🪙 " + (rec.coins || 0) + "</b>. " +
        "Wardrobe size " + (lv + 1) + "/" + LF.WARDROBE_STEPS.length + (next ? " (it grows at " + next + " outfits)" : " (the biggest!)") + "</p>";
      const grid = document.createElement("div");
      grid.className = "hp-grid wide";
      const p = D.traits(rec);
      for (const f of LF.OUTFITS) {
        const owned = wr.owned.includes(f.id), wearing = wr.wearing === f.id;
        const b = document.createElement("button");
        b.className = "hp-item" + (wearing ? " placed" : "");
        b.innerHTML = '<span class="hp-icon">' + f.icon + '</span><span class="hp-name">' + escapeHtml(f.name) + '</span><span class="hp-price">' +
          (wearing ? "✓ Wearing" : owned ? "Wear it" : (prefs.sandbox ? "🧪 Free" : "🪙 " + f.price)) + "</span>";
        b.style.borderBottom = "4px solid " + f.shirt;
        b.disabled = !owned && (rec.coins || 0) < costOf(f.price);
        if (b.disabled) b.title = nameOf(rec) + " needs " + (costOf(f.price) - (rec.coins || 0)) + " more coins";
        b.addEventListener("click", () => {
          if (wearing) { wr.wearing = null; }
          else if (owned) wr.wearing = f.id;
          else {
            if ((rec.coins || 0) < costOf(f.price)) return;
            rec.coins -= costOf(f.price);
            wr.owned.push(f.id);
            wr.wearing = f.id;
            progress.event({ type: "life", what: "outfits" });
            const op = H.opinion(p, rec, { id: f.id, tags: f.tags });
            const ww = walkerOf(rec.id);
            if (ww) { ww.say(H.reaction("item", op, f, p), 3); ww.showEmote(EMOTE[op], 3); }
            if (op !== "dislike") progress.addHappy(rec, op === "love" || op === "like" ? 1 : 0);
            if (LF.wardrobeLevel(rec) > lv) toast("🚪 " + nameOf(rec) + "'s wardrobe got bigger!");
          }
          save(rec);
          restyle(rec);
          if (hub.visiting && hub.visiting.record.id === rec.id) hub.refreshHome(); // (the wardrobe)
          renderCoins();
          draw();
        });
        grid.appendChild(b);
      }
      const ok = document.createElement("button");
      ok.className = "choice-btn plain";
      ok.textContent = "Close";
      ok.addEventListener("click", close);
      card.append(grid, ok);
    }
    draw();
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
  }

  // ---------- extra rooms ----------
  const currentRoom = () => (hub.visiting && hub.visiting.room) || "main";
  function openRoomShop(rec) {
    const back = document.createElement("div");
    back.className = "choice-modal";
    const card = document.createElement("div");
    card.className = "choice-card big";
    const close = () => back.remove();
    function draw() {
      H.ensureHome(rec);
      card.innerHTML = "<h3>🚪 Rooms for " + escapeHtml(nameOf(rec)) + "</h3><p>Every room has its own kinds of furniture. Paid with " + escapeHtml(nameOf(rec)) + "'s coins: <b>🪙 " + (rec.coins || 0) + "</b></p>";
      const grid = document.createElement("div");
      grid.className = "hp-grid wide";
      for (const r of H.ROOMS) {
        const owned = rec.home.rooms.includes(r.id);
        const b = document.createElement("button");
        b.className = "hp-item" + (owned ? " placed" : "");
        b.innerHTML = '<span class="hp-icon">' + r.icon + '</span><span class="hp-name">' + escapeHtml(r.name) + '</span><span class="hp-price">' + (owned ? "Visit" : (prefs.sandbox ? "🧪 Free" : "🪙 " + r.price)) + "</span>";
        b.title = H.slotsOfRoom(r.id).map((s) => s.icon + " " + s.name).join(", ");
        b.disabled = !owned && (rec.coins || 0) < costOf(r.price);
        b.addEventListener("click", () => {
          if (!owned) {
            if ((rec.coins || 0) < costOf(r.price)) return;
            rec.coins -= costOf(r.price);
            H.addRoom(rec, r.id);
            progress.event({ type: "life", what: "rooms" });
            toast(r.icon + " " + nameOf(rec) + " has a new " + r.name.toLowerCase() + "!");
            save(rec);
            renderCoins();
          }
          close();
          panelTab = "decorate";
          if (hub.visiting && hub.visiting.record.id === rec.id) { hub.setHomeRoom(r.id); renderHomePanel(); }
          else visit(rec, { room: r.id, empty: !isHome(rec) || town.isTravelling(rec) });
        });
        grid.appendChild(b);
      }
      const ok = document.createElement("button");
      ok.className = "choice-btn plain";
      ok.textContent = "Close";
      ok.addEventListener("click", close);
      card.append(grid, ok);
    }
    draw();
    back.appendChild(card);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    $("stage").appendChild(back);
  }

  // The room buttons in the home panel (only once the Mii has more than one room).
  function roomSwitcher(rec) {
    const rooms = (rec.home && rec.home.rooms) || [];
    if (!rooms.length || !hub.visiting) return null;
    const el = document.createElement("div");
    el.className = "hp-tabs hp-rooms";
    for (const [id, text] of [["main", "🛏️ Main room"]].concat(rooms.map((r) => [r, H.room(r).icon + " " + H.room(r).name]))) {
      const b = document.createElement("button");
      b.textContent = text;
      b.setAttribute("aria-pressed", String(currentRoom() === id));
      b.addEventListener("click", () => { hub.setHomeRoom(id); panelTab = "decorate"; renderHomePanel(); });
      el.appendChild(b);
    }
    return el;
  }

  // Saves to the Downloads folder (the desktop app does it itself; a browser downloads it).
  async function savePhoto(url, fileName) {
    if (desktop && desktop.savePhoto) {
      try {
        const r = await desktop.savePhoto(url, fileName);
        if (r && r.ok) { toast("📷 Saved to Downloads: " + r.name); return; }
        toast("📷 Couldn't save the picture" + (r && r.error ? ": " + r.error : ""));
      } catch (err) { toast("📷 Couldn't save the picture: " + err.message); }
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("📷 Picture saved to your Downloads!");
  }

  window.hub = hub; // handy for poking around in the browser console
  window.miiApp = { records, openPaintball, visit, sendHome, sendTo, inviteOut, moveAway, forgetMii, loadFiles, leaveHome, town, get prog() { return progress; },
    life, lifeHub, openClothesShop, openRoomShop, restyle, goToScene, renderHomePanel,
    prefs, openSettings, setMode, openMiiMenu, openPhotoPicker, takeGroupPhoto, goToMii, costOf }; // for tests (and other parts of the app)
  splash.done();
})();
