/*
 * js/nscc/app.js
 * Connects the page to the store (store.js) and the 3D office (officeHub.js):
 *   - the "Add Mii" window (a saved Mii, or upload a new .glb)
 *   - the location panel (click a Mii, or a name in the top bar), with its Workspace picker
 *     (its own desk, Office A / B, or any free desk)
 *   - the top bar of who's out of the office
 *   - the 6:00 PM rule (everyone goes home; see logic.js)
 * The store is the only source of truth: every change goes to the store, and
 * the page and the office follow whatever the store says (also changes made in
 * another tab).
 */
(async function () {
  "use strict";

  const M = window.MiiModel;
  const L = window.NSCCLogic;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const QUICK_PLACES = ["Lunch", "Meeting", "Client visit", "Working from home", "Out sick"];

  try { await Promise.all(["400", "700", "800"].map((w) => document.fonts.load(w + " 20px Nunito"))); } catch (e) { /* optional */ }

  // The time. For trying things out, the page can pretend it's another time:
  // index.html?now=2026-10-28T17:59:30 (or window.miinscc.setTime(...) in the console).
  const clock = (() => {
    let offset = 0;
    try {
      const q = new URLSearchParams(location.search).get("now");
      const t = q ? Date.parse(q) : NaN;
      if (!isNaN(t)) offset = t - Date.now();
    } catch (e) { /* no address bar */ }
    return { now: () => Date.now() + offset, set: (ms) => { offset = ms - Date.now(); } };
  })();
  const store = window.NSCCStore.createStore({ now: clock.now });
  await store.ready;
  const hub = new window.NSCCOfficeHub.OfficeHub($("office"), $("overlay"));
  hub.clock = clock.now;
  hub.start();
  // turned or zoomed away? a button to glide back to the normal view
  const centerBtn = $("centerBtn");
  centerBtn.addEventListener("click", () => hub.center());
  setInterval(() => { const off = hub.offCenter(); if (centerBtn.hidden === off) centerBtn.hidden = !off; }, 250);
  if (window.NSCCSettings) window.NSCCSettings.init(hub); // ⚙️ Settings (updates, graphics)
  $("loading").remove();

  // ---------- the Miis' 3D models and pictures ----------
  let saved = await store.listSaved();
  let board = await store.getBoard();
  let assignments = await store.getAssignments();
  const savedById = () => new Map(saved.map((r) => [r.id, r]));
  const templates = new Map(); // id -> Promise<template>
  function templateFor(rec) {
    if (!templates.has(rec.id)) templates.set(rec.id, M.loadTemplate(rec.bytes.slice(0), rec.fileName));
    return templates.get(rec.id);
  }
  const portraits = new Map(); // id -> data URL
  function portraitInto(img, rec) {
    if (!rec) return;
    img.dataset.portrait = rec.id;
    if (portraits.has(rec.id)) { img.src = portraits.get(rec.id); return; }
    templateFor(rec).then((t) => {
      if (!portraits.has(rec.id)) portraits.set(rec.id, M.portrait(t, { name: rec.name }, 160));
      document.querySelectorAll('img[data-portrait="' + rec.id + '"]').forEach((el) => { el.src = portraits.get(rec.id); });
    }).catch(() => {});
  }

  // ---------- keeping the office in step with the board ----------
  let syncing = Promise.resolve();
  let prevBoard = new Map();
  function sync(first) {
    syncing = syncing.then(() => doSync(first)).catch((e) => console.error(e));
    return syncing;
  }
  // who has which desk / office: the office shows it, and Miis go to their own spot
  function nameOf(id) {
    const m = board.find((x) => x.id === id), r = savedById().get(id);
    return (m && m.name) || (r && r.name) || "";
  }
  function pushAssignments() {
    const names = {};
    for (const id of Object.keys(assignments)) names[id] = nameOf(id);
    hub.setAssignments(assignments, board.map((m) => m.id), names);
  }
  async function doSync(first) {
    board = await store.getBoard();
    pushAssignments();
    const byId = savedById();
    const now = clock.now();
    const actions = L.reconcile(board, hub.presence(), first);
    for (const a of actions) {
      const m = board.find((x) => x.id === a.id);
      if (a.action === "appear" || a.action === "enter") {
        const rec = byId.get(a.id);
        if (!rec) continue; // (its model isn't on this computer)
        let template;
        try { template = await templateFor(rec); } catch (e) { console.warn("couldn't load " + rec.name, e); continue; }
        // (the board may have changed while the model loaded)
        const still = (await store.getBoard()).find((x) => x.id === a.id);
        if (!still || L.isOut(still) || hub.walker(a.id)) continue;
        const prev = prevBoard.get(a.id);
        // (desk number: the order the Miis came in today, so everyone keeps their desk)
        hub.addMii(a.id, template, { name: m.name }, a.action === "appear" ? "appear" : prev && prev.location ? "return" : "enter", board.indexOf(m));
      } else if (a.action === "return") {
        hub.bringBack(a.id);
      } else if (a.action === "leave") {
        hub.sendOut(a.id, "leave", m.location);
      } else if (a.action === "remove") {
        const prev = prevBoard.get(a.id);
        hub.sendOut(a.id, "remove", prev && L.isExpired(prev, now) ? "endOfDay" : "");
      }
    }
    for (const m of board) { const w = hub.walker(m.id); if (w && w.look.name !== m.name) w.setName(m.name); }
    prevBoard = new Map(board.map((m) => [m.id, m]));
    renderTopBar();
    if (panelId && !board.some((m) => m.id === panelId)) closePanel();
    else if (panelId) renderPanel(false);
    if (!$("addModal").hidden) renderSaved();
  }

  store.on((e) => {
    if (e.type === "saved") store.listSaved().then((list) => { saved = list; sync(false); });
    else if (e.type === "assign") store.getAssignments().then((a) => { assignments = a; pushAssignments(); if (panelId) renderPanel(false); });
    else sync(false);
  });

  // ---------- the top bar: only the people who are out ----------
  let shownOut = new Set(); // (only cards that just appeared pop in)
  function renderTopBar() {
    const bar = $("outbar");
    const entries = L.topBarEntries(board);
    bar.classList.toggle("empty", !entries.length);
    if (!entries.length) {
      shownOut = new Set();
      const text = board.length ? "Everyone's in the office" : L.isAfterEndOfDay(clock.now()) ? "The office is closed for today. See you tomorrow!" : "Nobody's here yet. Add your Mii!";
      bar.innerHTML = '<p class="all-in">' + text + "</p>";
      return;
    }
    const byId = savedById();
    bar.innerHTML = "";
    for (const e of entries) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "out-card" + (shownOut.has(e.id) ? "" : " new");
      b.dataset.id = e.id;
      b.innerHTML = '<img class="portrait" alt="" /><span class="out-text"><span class="out-name"></span><span class="out-where"></span><span class="out-time"></span></span>';
      b.querySelector(".out-name").textContent = e.name;
      b.querySelector(".out-where").textContent = e.location;
      b.querySelector(".out-time").textContent = e.leftText;
      b.setAttribute("aria-label", e.name + ": " + e.location + ". " + e.leftText);
      portraitInto(b.querySelector("img"), byId.get(e.id));
      b.addEventListener("click", () => openPanel(e.id));
      bar.appendChild(b);
    }
    shownOut = new Set(entries.map((e) => e.id));
  }

  // ---------- the location panel ----------
  let panelId = null;
  const input = $("locationInput");
  function openPanel(id) {
    if (!board.some((m) => m.id === id)) return;
    panelId = id;
    $("panel").hidden = false;
    renderPanel(true);
    input.focus();
    input.select();
  }
  function renderPanel(fresh) {
    const m = board.find((x) => x.id === panelId);
    if (!m) return;
    $("panelName").textContent = m.name;
    const w = hub.walker(m.id);
    $("panelStatus").textContent = L.isOut(m) ? "Out: " + m.location + " · " + "Left " + L.formatTime(m.leftAt) : "In the office" + (w && w.desk ? " · " + w.desk.label : "");
    $("panelStatus").classList.toggle("out", L.isOut(m));
    portraitInto($("panelFace"), savedById().get(m.id));
    if (fresh || document.activeElement !== input) input.value = m.location || "";
    $("backBtn").hidden = !L.isOut(m);
    if (fresh) hideSwap();
    renderWorkspace();
  }
  function closePanel() {
    panelId = null;
    hideSwap();
    $("panel").hidden = true;
  }

  // ---------- the Workspace picker: own desk, Office A / B, or any free desk ----------
  const wsSelect = $("workspaceSelect");
  const spots = () => hub.office.workSpots.filter((s) => s.assignable);
  const spotLabel = (id) => { const s = spots().find((x) => x.id === id); return s ? s.label : "any free desk"; };
  function renderWorkspace() {
    if (!panelId) return;
    const mine = assignments[panelId] || "";
    const opt = (value, text) => '<option value="' + escapeHtml(value) + '"' + (value === mine ? " selected" : "") + ">" + escapeHtml(text) + "</option>";
    const owned = (s) => { const o = L.ownerOf(assignments, s.id); return o && o !== panelId ? " · " + (nameOf(o) || "someone") : o === panelId ? " · yours" : " · free"; };
    const offices = spots().filter((s) => s.private), desks = spots().filter((s) => !s.private).sort((a, b) => a.number - b.number);
    const html = opt("", "Any free desk") +
      '<optgroup label="Private offices">' + offices.map((s) => opt(s.id, s.label + owned(s))).join("") + "</optgroup>" +
      '<optgroup label="Desks">' + desks.map((s) => opt(s.id, s.label + owned(s))).join("") + "</optgroup>";
    if (wsSelect.dataset.html !== html) { wsSelect.innerHTML = html; wsSelect.dataset.html = html; }
    wsSelect.value = mine;
  }
  function hideSwap() { $("swapAsk").hidden = true; $("swapAsk").innerHTML = ""; }
  wsSelect.addEventListener("change", () => {
    const id = panelId, spot = wsSelect.value || null;
    if (!id) return;
    const other = spot ? L.ownerOf(assignments, spot) : null;
    if (!other || other === id) { hideSwap(); store.assignSpot(id, spot); return; }
    // it's someone else's: swap? (they get this Mii's old spot, or any free desk)
    const box = $("swapAsk"), mine = assignments[id] || null;
    box.innerHTML = "<p><b>" + escapeHtml(spotLabel(spot)) + "</b> is " + escapeHtml(nameOf(other) || "someone") + "'s. Swap? " +
      escapeHtml(nameOf(other) || "They") + " gets " + (mine ? "<b>" + escapeHtml(spotLabel(mine)) + "</b>" : "any free desk") + '.</p><div class="ask-row"><button type="button" class="btn primary" data-v="yes">Swap</button><button type="button" class="btn" data-v="no">Cancel</button></div>';
    box.hidden = false;
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      hideSwap();
      if (b.dataset.v === "yes" && panelId === id) store.assignSpot(id, spot);
      else renderWorkspace();
    }));
    box.querySelector("button").focus();
  });
  async function saveLocation(text) {
    if (!panelId) return;
    await store.setLocation(panelId, text);
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveLocation(input.value).then(closePanel); }
    if (e.key === "Escape") { input.value = (board.find((m) => m.id === panelId) || {}).location || ""; closePanel(); }
  });
  input.addEventListener("blur", () => { if (panelId) saveLocation(input.value); });
  $("chips").innerHTML = QUICK_PLACES.map((p) => '<button type="button" class="chip">' + escapeHtml(p) + "</button>").join("");
  $("chips").addEventListener("mousedown", (e) => e.preventDefault()); // (keep the field's focus: no early save on blur)
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    input.value = b.textContent;
    saveLocation(b.textContent).then(closePanel);
  });
  $("backBtn").addEventListener("click", () => { input.value = ""; saveLocation("").then(closePanel); });
  $("removeBtn").addEventListener("click", () => { const id = panelId; closePanel(); if (id) store.removeFromBoard(id); });
  $("panelClose").addEventListener("click", closePanel);
  hub.onSelect = (id) => openPanel(id);

  // ---------- the "Add Mii" window ----------
  const modal = $("addModal");
  function openAdd() {
    $("errorMsg").textContent = "";
    $("afterHours").hidden = !L.isAfterEndOfDay(clock.now());
    modal.hidden = false;
    renderSaved();
    const first = modal.querySelector(".saved-card:not([disabled]), .file-btn");
    if (first && first.focus) first.focus();
  }
  function closeAdd() {
    modal.hidden = true;
    hideAsk();
    try { sessionStorage.setItem("miinscc-asked", "1"); } catch (e) { /* ignore */ }
  }
  function renderSaved() {
    const list = $("savedList");
    if (!saved.length) { list.innerHTML = '<p class="hint">No saved Miis on this computer yet. Upload one below!</p>'; return; }
    const onBoard = new Map(board.map((m) => [m.id, m]));
    list.innerHTML = "";
    for (const rec of saved.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const m = onBoard.get(rec.id);
      const wrap = document.createElement("div");
      wrap.className = "saved-item";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "saved-card";
      card.disabled = !!m;
      card.innerHTML = '<img class="portrait" alt="" /><span class="saved-name"></span><span class="saved-state"></span>';
      card.querySelector(".saved-name").textContent = rec.name;
      card.querySelector(".saved-state").textContent = m ? (L.isOut(m) ? "Out" : "In the office") : "Add";
      portraitInto(card.querySelector("img"), rec);
      card.addEventListener("click", async () => {
        card.disabled = true;
        await store.addToBoard(rec.id);
        closeAdd();
      });
      wrap.appendChild(card);
      if (!m) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "icon-btn saved-del";
        del.title = "Forget " + rec.name + " on this computer";
        del.setAttribute("aria-label", "Forget " + rec.name);
        del.textContent = "×";
        del.addEventListener("click", async () => {
          if (await ask("Forget " + rec.name + "?", "The saved Mii is removed from this computer. You can upload it again any time.", [["Forget", "yes", "danger"], ["Cancel", null]]) === "yes") {
            await store.deleteSaved(rec.id).catch(() => {});
          }
        });
        wrap.appendChild(del);
      }
      list.appendChild(wrap);
    }
  }
  // A small question inside the Add window. choices: [[label, value, kind]]
  let askDone = null;
  function ask(title, text, choices) {
    hideAsk();
    const box = $("ask");
    box.innerHTML = "<h3>" + escapeHtml(title) + "</h3><p>" + escapeHtml(text) + '</p><div class="ask-row"></div>';
    return new Promise((resolve) => {
      askDone = resolve;
      for (const [label, value, kind] of choices) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn" + (kind ? " " + kind : "");
        b.textContent = label;
        b.addEventListener("click", () => { hideAsk(); resolve(value); });
        box.querySelector(".ask-row").appendChild(b);
      }
      box.hidden = false;
      box.querySelector("button").focus();
    });
  }
  function hideAsk() {
    $("ask").hidden = true;
    if (askDone) { const d = askDone; askDone = null; d(null); }
  }

  // Loading .glb files: checked, saved, and the Mii walks in.
  async function loadFiles(files) {
    $("errorMsg").textContent = "";
    const problems = [];
    let added = 0;
    for (const file of files) {
      try {
        if (/\.(miic|mii|ffsd|cfsd)$/i.test(file.name)) throw new Error("please export your Mii from Mii Creator as a 3D model (.glb)");
        if (file.size > 30 * 1024 * 1024) throw new Error("file is too big");
        const bytes = await file.arrayBuffer();
        const info = M.readInfo(new Uint8Array(bytes), file.name); // (throws if it isn't a .glb)
        const template = await M.loadTemplate(bytes.slice(0), file.name); // (throws if the model can't be read)
        let id = null, name = info.name;
        const same = saved.find((r) => r.name.toLowerCase() === name.toLowerCase());
        if (same) {
          const choice = await ask("There's already a saved Mii called " + same.name, "Is this a new look for " + same.name + ", or someone else?", [
            ["New look for " + same.name, "update", "primary"], ["Someone else", "new"], ["Cancel", null, "plain"],
          ]);
          if (!choice) continue;
          if (choice === "update") id = same.id;
          else {
            const taken = new Set(saved.map((r) => r.name.toLowerCase()));
            let n = 2;
            while (taken.has((name + " " + n).toLowerCase())) n++;
            name = name + " " + n;
          }
        }
        const rec = await store.saveMii({ id, name, fileName: file.name, bytes });
        templates.set(rec.id, Promise.resolve(template));
        portraits.delete(rec.id);
        saved = await store.listSaved();
        if (id && hub.walker(id)) { const w = hub.walker(id); w.template = template; w.buildModel(); }
        await store.addToBoard(rec.id);
        added++;
      } catch (e) {
        problems.push(file.name + " (" + e.message + ")");
      }
    }
    if (problems.length) { $("errorMsg").textContent = "Couldn't add: " + problems.join("; "); renderSaved(); }
    else if (added) closeAdd();
  }
  function sampleFile() {
    const s = window.SAMPLE_GLBS[0];
    const bin = atob(s.base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], s.fileName, { type: "model/gltf-binary" });
  }
  $("fileInput").addEventListener("change", (e) => { const files = Array.from(e.target.files); e.target.value = ""; loadFiles(files); });
  $("sampleBtn").addEventListener("click", () => loadFiles([sampleFile()]));
  $("addBtn").addEventListener("click", openAdd);
  $("addClose").addEventListener("click", closeAdd);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeAdd(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.hidden) closeAdd();
    else if (panelId && document.activeElement !== input) closePanel();
  });
  // dropping .glb files anywhere on the page
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) { dragDepth++; document.body.classList.add("dragover"); } });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragover"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) loadFiles(files);
  });

  // ---------- the clock, and the 6:00 PM rule ----------
  function tick() {
    const now = clock.now();
    $("clock").textContent = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) + " · " + L.formatTime(now);
    store.sweep();
    if (!board.length) renderTopBar(); // ("closed for today" after 6 PM)
  }
  setInterval(tick, 5000);
  tick();

  // ---------- start ----------
  await sync(true);
  let asked = false;
  try { asked = sessionStorage.getItem("miinscc-asked") === "1"; } catch (e) { /* ignore */ }
  if (!asked) openAdd();

  window.miinscc = { store, hub, setTime: (ms) => { clock.set(ms); tick(); } }; // (handy in the browser console)
})();
