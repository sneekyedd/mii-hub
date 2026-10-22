/*
 * account.js
 * Accounts and cloud saves: sign in with a username + password on any device
 * and your worlds come with you. Also: several worlds per account, backups on
 * this device, and playing offline (with no account, or when the server is away).
 *
 * How it fits together:
 *   - "This device's world" is what the rest of the game already uses: the Miis
 *     in IndexedDB (storage.js) and a few localStorage keys (WORLD_KEYS).
 *   - Before app.js reads any of it, it waits for MiiAccount.ready. By then you've
 *     signed in (or picked "Play offline") and the right world is on this device.
 *   - While you play, changes are noticed (storage.js's onChange + localStorage
 *     writes) and the world is saved to the server a little later, every couple
 *     of minutes, on "Save now", and when you leave. Offline? It's kept here and
 *     saved online next time the server can be reached.
 *   - Switching worlds or restoring a backup puts that world in a waiting slot
 *     and reloads the page, so nothing from the old world can be saved over it.
 *
 * The server address comes from js/paintball/pb-config.js (made by the build,
 * never in the repository), or one typed into Paintball's Online tab. With no
 * address, there are no accounts: the game just plays offline.
 *
 * Talks to server/accounts.js (see its PROTOCOL).
 */
(function (root) {
  "use strict";

  const S = root.MiiStorage;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_PORT = 8787;
  const META_KEY = "mii-hub-account";
  // the localStorage parts of a world (Miis themselves are in IndexedDB)
  const WORLD_KEYS = ["mii-hub-3d-settings", "mii-hub-3d-progress", "mii-hub-paintball-locker"];
  const BLOB_CHUNK = 512 * 1024;          // must match server/accounts.js
  const SAVE_AFTER_CHANGE = 20e3;         // save online this long after something changes
  const SAVE_EVERY = 2 * 60e3;            // ...and at least this often while there are changes
  const BACKUP_EVERY = 10 * 60e3;         // a backup on this device every 10 minutes (if anything changed)
  const MAX_BACKUPS = 8;
  const IDLE_CLOSE = 60e3;                // hang up when there's nothing to say (lets a free server sleep)

  // ---------------------------------------------------------------------
  // Little helpers
  // ---------------------------------------------------------------------
  const keyOf = (user) => String(user || "").toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function setSplash(text) { if (root.MiiSplash) root.MiiSplash.set(0, text); }

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  }
  let meta = loadMeta();
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* private window */ }
  }

  function toU8(b) { return b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b); }
  function toBase64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // SHA-256 names each Mii model, so the same model is only ever uploaded once.
  // (crypto.subtle only exists on https/file pages, so there's a small fallback.)
  async function sha256(u8) {
    if (root.crypto && root.crypto.subtle) {
      try { return hex(new Uint8Array(await root.crypto.subtle.digest("SHA-256", u8))); } catch (e) { /* fall back */ }
    }
    return hex(sha256js(u8));
  }
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  function sha256js(data) {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = data.length, total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(data); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }

  // ---------------------------------------------------------------------
  // The server address (the same one Paintball and online chess use)
  // ---------------------------------------------------------------------
  function normalizeUrl(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
    if (!/^wss?:\/\//i.test(s)) s = "ws://" + s;
    try {
      const u = new URL(s);
      if (u.protocol === "ws:" && !u.port) u.port = String(DEFAULT_PORT);
      return u.toString().replace(/\/$/, "");
    } catch (e) { return s; }
  }
  function loadConfig() {
    if (root.PB_CONFIG) return Promise.resolve();
    return new Promise((resolve) => {
      const sc = document.createElement("script");
      sc.src = "js/paintball/pb-config.js";
      sc.onload = sc.onerror = () => resolve();
      document.head.appendChild(sc);
    });
  }
  function serverUrl() {
    let saved = "";
    try { saved = (JSON.parse(localStorage.getItem("mii-hub-paintball") || "{}").server || "").trim(); } catch (e) { /* private window */ }
    return normalizeUrl(saved || (root.PB_CONFIG && root.PB_CONFIG.server) || "");
  }

  // ---------------------------------------------------------------------
  // Talking to the server: one connection, opened when needed, closed when idle
  // ---------------------------------------------------------------------
  let url = "", ws = null, opening = null, authed = false, idleTimer = null, nextQ = 1;
  let online = false;        // did the last try reach the server?
  const waiting = new Map(); // q -> { resolve, reject, timer }

  function netError(msg) { const e = new Error(msg || "Couldn't reach the online server."); e.code = "net"; return e; }
  function open(timeout) {
    if (ws && ws.readyState === 1) return Promise.resolve(ws);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let s;
      try { s = new WebSocket(url); } catch (e) { opening = null; return reject(netError("That server address doesn't look right.")); }
      const slow = setTimeout(() => { try { s.close(); } catch (e) { /* ignore */ } }, timeout || 15000);
      s.onopen = () => { clearTimeout(slow); ws = s; opening = null; authed = false; resolve(s); };
      s.onclose = () => {
        clearTimeout(slow);
        if (opening) { opening = null; reject(netError()); }
        if (ws === s) ws = null;
        authed = false;
        for (const [q, w] of waiting) { clearTimeout(w.timer); w.reject(netError("Lost the connection to the server.")); waiting.delete(q); }
      };
      s.onerror = () => { /* onclose follows */ };
      s.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t !== "acRes" || !waiting.has(m.q)) return;
        const w = waiting.get(m.q);
        waiting.delete(m.q); clearTimeout(w.timer);
        if (m.ok) w.resolve(m);
        else { const e = new Error(m.msg || "Something went wrong."); e.code = m.code; e.rev = m.rev; w.reject(e); }
        idleSoon();
      };
    });
    return opening;
  }
  function idleSoon() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (ws && !waiting.size) ws.close(); }, IDLE_CLOSE);
  }
  function raw(msg, timeout) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(netError());
      const q = nextQ++;
      const timer = setTimeout(() => { waiting.delete(q); reject(netError("The server took too long to answer.")); }, timeout || 30000);
      waiting.set(q, { resolve, reject, timer });
      ws.send(JSON.stringify(Object.assign({ q }, msg)));
    });
  }
  // a request that needs you signed in (signs this connection in with your token first)
  async function rpc(msg, timeout) {
    try {
      await open();
      if (!authed) {
        if (!meta.token) { const e = new Error("Please sign in again."); e.code = "token"; throw e; }
        await raw({ t: "acToken", user: meta.user, token: meta.token });
        authed = true;
      }
      const r = await raw(msg, timeout);
      setOnline(true);
      return r;
    } catch (e) {
      if (e.code === "net") setOnline(false);
      if (e.code === "token") tokenRefused();
      throw e;
    }
  }
  function setOnline(v) { if (online !== v) { online = v; renderStatus(); } }
  // the server doesn't know this device any more (signed out elsewhere, or a year unused)
  function tokenRefused() {
    if (!meta.token) return;
    meta.token = null; saveMeta();
    renderPanel();
  }

  // ---------------------------------------------------------------------
  // This device's world: read it, replace it, and turn it into a cloud save
  // ---------------------------------------------------------------------
  let quiet = 0; // > 0 while this file writes the world (those writes aren't "changes")

  async function readLocal() {
    const keys = {};
    for (const k of WORLD_KEYS) { try { keys[k] = localStorage.getItem(k); } catch (e) { keys[k] = null; } }
    return { miis: await S.getAllMiis(), keys };
  }
  const hasData = (snap) => snap.miis.length > 0 || WORLD_KEYS.some((k) => snap.keys[k] != null);
  async function writeLocal(snap) {
    quiet++;
    try {
      await S.clearMiis();
      for (const m of snap.miis || []) await S.putMii(m);
      for (const k of WORLD_KEYS) {
        const v = snap.keys && snap.keys[k];
        try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ }
      }
    } finally { quiet--; }
  }
  const EMPTY = { miis: [], keys: {} };

  // Miis' .glb models go up separately (by their SHA-256); the rest is JSON
  async function toCloud(snap) {
    const blobs = new Map(), miis = [];
    for (const m of snap.miis) {
      const c = Object.assign({}, m);
      if (m.bytes) {
        const u8 = toU8(m.bytes), h = await sha256(u8);
        blobs.set(h, u8); c.blob = h; delete c.bytes;
      }
      miis.push(c);
    }
    // (JSON both ways, so what's saved is exactly what can be sent)
    return { data: JSON.parse(JSON.stringify({ v: 1, miis, keys: snap.keys, saved: Date.now() })), blobs };
  }
  async function fromCloud(data, onProgress) {
    // models already on this device don't need downloading again
    const have = new Map();
    for (const m of (await readLocal()).miis) if (m.bytes) { const u8 = toU8(m.bytes); have.set(await sha256(u8), u8); }
    const miis = [], list = (data && data.miis) || [];
    let i = 0;
    for (const m of list) {
      const c = Object.assign({}, m);
      if (c.blob) {
        if (onProgress) onProgress(++i, list.length);
        let u8 = have.get(c.blob);
        if (!u8) u8 = await downloadBlob(c.blob);
        c.bytes = u8.slice().buffer;
        delete c.blob;
      }
      miis.push(c);
    }
    const keys = {};
    for (const k of WORLD_KEYS) keys[k] = data && data.keys && typeof data.keys[k] === "string" ? data.keys[k] : null;
    return { miis, keys };
  }
  async function downloadBlob(hash) {
    const parts = [];
    let n = 1;
    for (let i = 0; i < n; i++) {
      const r = await rpc({ t: "acBlobGet", hash, i }, 60000);
      n = r.n; parts.push(fromBase64(r.b64));
    }
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    if ((await sha256(all)) !== hash) throw new Error("A Mii's model got mixed up on the way. Try again.");
    return all;
  }
  async function uploadBlob(hash, u8) {
    const n = Math.max(1, Math.ceil(u8.length / BLOB_CHUNK));
    for (let i = 0; i < n; i++) {
      await rpc({ t: "acBlobPut", hash, i, n, b64: toBase64(u8.subarray(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK)) }, 60000);
    }
  }
  // download a world from your account: { snap, rev, name } (snap is EMPTY for a brand-new world)
  async function fetchWorld(id, onProgress) {
    const r = await rpc({ t: "acGet", id }, 60000);
    return { id: r.id, rev: r.rev, name: r.name, isNew: !r.data, snap: r.data ? await fromCloud(r.data, onProgress) : EMPTY };
  }

  // ---------------------------------------------------------------------
  // Backups on this device (and the waiting slot for the next world to open)
  // ---------------------------------------------------------------------
  let bdb = null;
  function backupDb() {
    if (bdb) return bdb;
    bdb = new Promise((resolve) => {
      try {
        const req = indexedDB.open("mii-hub-account", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
          req.result.createObjectStore("slots", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return bdb;
  }
  async function bRun(store, mode, fn) {
    const db = await backupDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function backup(label, snap) {
    snap = snap || (await readLocal());
    if (!hasData(snap)) return;
    await bRun("backups", "readwrite", (s) => s.add({ at: Date.now(), label, world: meta.token || meta.owner ? meta.worldName || "" : "", user: meta.user || "", miis: snap.miis, keys: snap.keys }));
    // keep the newest few
    const all = await listBackups();
    for (const b of all.slice(MAX_BACKUPS)) await bRun("backups", "readwrite", (s) => s.delete(b.id));
    changedSinceBackup = false;
  }
  async function listBackups() {
    const all = (await bRun("backups", "readonly", (s) => s.getAll())) || [];
    return all.sort((a, b) => b.at - a.at);
  }
  // open this world next time the page loads (switching worlds, restoring a backup)
  async function openNext(snap, info) {
    leaving = true;
    await bRun("slots", "readwrite", (s) => s.put({ id: "next", miis: snap.miis, keys: snap.keys }));
    meta.next = info;
    saveMeta();
    location.reload();
  }
  async function applyNext() {
    const info = meta.next;
    delete meta.next;
    saveMeta();
    const slot = await bRun("slots", "readonly", (s) => s.get("next"));
    if (!slot) return;
    await writeLocal(slot);
    await bRun("slots", "readwrite", (s) => s.delete("next"));
    Object.assign(meta, info);
    saveMeta();
  }

  // ---------------------------------------------------------------------
  // Noticing changes and saving online
  // ---------------------------------------------------------------------
  // when you last clicked or pressed a key here: Miis change the world by themselves all the time,
  // so a change only counts as yours (meta.touchedAt, kept between visits) if you just did something
  let lastTouch = 0;
  for (const ev of ["pointerdown", "keydown", "wheel"]) root.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true });
  let changeSeq = 0, changedSinceBackup = false, saveTimer = null, saving = null, leaving = false, started = false;
  const signedIn = () => !!(meta.token && meta.owner);

  function markChanged() {
    if (quiet || leaving || !started) return;
    changeSeq++;
    changedSinceBackup = true;
    if (Date.now() - lastTouch < 15000 && Date.now() - (meta.touchedAt || 0) > 5000) { meta.touchedAt = Date.now(); saveMeta(); }
    if (meta.owner && !meta.dirty) { meta.dirty = true; saveMeta(); renderStatus(); }
    if (signedIn() && !saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveOnline().catch(() => {}); }, SAVE_AFTER_CHANGE);
  }
  if (S) S.onChange = markChanged;
  // progress and the Paintball locker are written straight to localStorage
  try {
    const proto = root.Storage.prototype, set = proto.setItem, del = proto.removeItem;
    proto.setItem = function (k, v) { set.call(this, k, v); if (this === root.localStorage && WORLD_KEYS.includes(k)) markChanged(); };
    proto.removeItem = function (k) { del.call(this, k); if (this === root.localStorage && WORLD_KEYS.includes(k)) markChanged(); };
  } catch (e) { /* no localStorage */ }

  // save this device's world to your account (only one save at a time)
  function saveOnline() {
    if (saving) return saving;
    if (!signedIn() || leaving) return Promise.resolve(false);
    saving = (async () => {
      const seq = changeSeq;
      renderStatus("saving");
      const { data, blobs } = await toCloud(await readLocal());
      const have = await rpc({ t: "acBlobHave", hashes: Array.from(blobs.keys()) });
      for (const h of have.need) await uploadBlob(h, blobs.get(h));
      let r;
      try {
        r = await rpc({ t: "acSave", id: meta.worldId, base: meta.rev || 0, data }, 60000);
      } catch (e) {
        if (e.code === "conflict") r = await conflict(data);
        else if (e.code === "noworld") r = await saveAsNew(data);
        else throw e;
        if (!r) return false;
      }
      meta.rev = r.rev;
      meta.lastSave = Date.now();
      if (changeSeq === seq) meta.dirty = false;
      saveMeta();
      return true;
    })().finally(() => { saving = null; renderStatus(); });
    return saving;
  }
  // saved on another device since this copy was loaded: which one do you want?
  async function conflict(data) {
    // nothing you did here since the last online save (only the Miis living their lives): take the newer one
    const idle = !((meta.touchedAt || 0) > (meta.lastSave || 0));
    const pick = idle ? "theirs" : await dialog("This world changed somewhere else",
      "“" + (meta.worldName || "This world") + "” was saved on another device while this one had changes that weren't saved online. Which one do you want to keep?",
      [{ label: "💻 Keep this device's world", value: "mine", kind: "primary" }, { label: "☁️ Use the other device's world", value: "theirs" }]);
    if (pick === "theirs") {
      await backup("Before using the other device's world");
      const w = await fetchWorld(meta.worldId);
      await openNext(w.snap, { worldId: w.id, worldName: w.name, rev: w.rev, dirty: w.isNew });
      return null;
    }
    return rpc({ t: "acSave", id: meta.worldId, base: meta.rev || 0, data, force: true }, 60000);
  }
  // the world was deleted on another device: keep it as a new world
  async function saveAsNew(data) {
    const c = await rpc({ t: "acCreate", name: (meta.worldName || "My island") + " (saved)" });
    worlds = c.worlds;
    meta.worldId = c.id; meta.rev = 0;
    meta.worldName = (c.worlds.find((w) => w.id === c.id) || {}).name || meta.worldName;
    saveMeta();
    return rpc({ t: "acSave", id: c.id, base: 0, data }, 60000);
  }

  setInterval(() => { if (meta.dirty && signedIn() && !saving) saveOnline().catch(() => {}); }, SAVE_EVERY);
  setInterval(() => { if (changedSinceBackup && started && !leaving) backup("Automatic backup").catch(() => {}); }, BACKUP_EVERY);
  // leaving the page: try to get the last changes up (they're kept here either way)
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && meta.dirty && signedIn()) saveOnline().catch(() => {}); });
  root.addEventListener("pagehide", () => { if (meta.dirty && signedIn() && !leaving) saveOnline().catch(() => {}); });

  // ---------------------------------------------------------------------
  // A small pop-up (works before and after the game has started)
  // buttons: [{ label, value, kind }]; input: default text -> resolves { value, text }
  // ---------------------------------------------------------------------
  function dialog(title, text, buttons, input) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "ac-modal";
      const card = document.createElement("div");
      card.className = "ac-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      const h = document.createElement("h3"); h.textContent = title;
      const p = document.createElement("p"); p.textContent = text;
      card.append(h, p);
      let field = null;
      if (input != null) {
        field = document.createElement("input");
        field.className = "ac-input"; field.maxLength = 32; field.value = input;
        card.appendChild(field);
      }
      const row = document.createElement("div");
      row.className = "ac-dlg-btns";
      const done = (value) => { wrap.remove(); document.removeEventListener("keydown", onKey, true); resolve(input != null ? { value, text: field.value.trim() } : value); };
      for (const b of buttons) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "btn" + (b.kind === "primary" ? " primary" : b.kind === "danger" ? " ac-danger" : "");
        el.textContent = b.label;
        el.addEventListener("click", () => done(b.value));
        row.appendChild(el);
      }
      card.appendChild(row);
      wrap.appendChild(card);
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); done(null); }
        else if (e.key === "Enter" && field && document.activeElement === field) { e.preventDefault(); done(buttons[0].value); }
      };
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(wrap);
      (field || row.querySelector("button")).focus();
      if (field) field.select();
    });
  }

  // ---------------------------------------------------------------------
  // Signing in: put the right world on this device
  // ---------------------------------------------------------------------
  let worlds = [];

  // after the server said yes. how: "signup" | "login" | "resume"
  async function afterSignIn(r, how) {
    const user = keyOf(r.user);
    meta.user = r.user;
    if (r.token) meta.token = r.token;
    meta.offline = false;
    worlds = r.worlds || [];
    const local = await readLocal();
    const mine = meta.owner === user;
    const progress = (i, n) => setSplash("Downloading your Miis… " + i + "/" + n);
    const take = (w, dirty) => { meta.owner = user; meta.worldId = w.id; meta.worldName = w.name; meta.rev = w.rev; meta.dirty = dirty; saveMeta(); };
    const download = async (id, label) => {
      if (label && hasData(local)) await backup(label, local);
      const w = await fetchWorld(id, progress);
      await writeLocal(w.snap);
      take(w, w.isNew);
    };

    if (how === "signup") {
      const first = worlds.find((w) => w.id === r.current) || worlds[0];
      if (hasData(local) && meta.owner && !mine) {
        // this device's world belongs to another account: start fresh (and keep a backup)
        await backup("Before creating " + r.user, local);
        await writeLocal(EMPTY);
      }
      // otherwise the world already on this device becomes the new account's first world
      take(first, true);
      return;
    }

    const known = mine && worlds.find((w) => w.id === meta.worldId);
    if (known) {
      meta.worldName = known.name;
      if (meta.dirty && known.rev !== (meta.rev || 0)) {
        // changed here (offline) AND somewhere else: ask
        const pick = await dialog("This world changed in two places",
          "“" + known.name + "” has changes on this device that weren't saved online, and it was also saved on another device. Which one do you want?",
          [{ label: "💻 Keep this device's world", value: "mine", kind: "primary" }, { label: "☁️ Use the saved one", value: "theirs" }]);
        if (pick === "theirs") await download(known.id, "Before using the saved world");
        else { meta.rev = known.rev; meta.force = true; saveMeta(); }
      } else if (!meta.dirty && known.rev !== (meta.rev || 0)) {
        await download(known.id); // saved elsewhere since: get the new one
      }
      saveMeta();
      return;
    }
    if (hasData(local) && !meta.owner) {
      // Miis made on this device before signing in: don't lose them
      const pick = await dialog("Bring this device's world along?",
        "This device has a world (" + local.miis.length + " Mii" + (local.miis.length === 1 ? "" : "s") + ") that isn't in your account yet.",
        [{ label: "➕ Add it to my account as a new world", value: "add", kind: "primary" }, { label: "Open my account's world (keep this one as a backup)", value: "skip" }]);
      if (pick !== "skip") {
        try {
          const c = await rpc({ t: "acCreate", name: "World from this device" });
          await rpc({ t: "acCurrent", id: c.id });
          worlds = c.worlds;
          take(c.worlds.find((w) => w.id === c.id), true);
          return;
        } catch (e) {
          await dialog("Couldn't add it", e.message + " This world is kept as a backup on this device instead.", [{ label: "OK", value: true, kind: "primary" }]);
        }
      }
      await download(r.current, "This device's world before signing in");
      return;
    }
    // a new device, or one with another account's world (kept as a backup)
    await download(r.current, "Before signing in as " + r.user);
  }

  // ---------------------------------------------------------------------
  // The sign-in page (shown over the splash screen)
  // ---------------------------------------------------------------------
  function showLogin(message) {
    return new Promise((resolve) => {
      const page = $("login"), form = $("loginForm"), user = $("lgUser"), pass = $("lgPass"), pass2 = $("lgPass2");
      const msg = $("lgMsg"), note = $("lgNote"), go = $("lgGo");
      let mode = "in", busy = false;
      if (root.MiiSplash && root.MiiSplash.hold) root.MiiSplash.hold(true);
      page.hidden = false;
      requestAnimationFrame(() => page.classList.add("show"));
      if (meta.user) user.value = meta.user;
      msg.textContent = message || "";
      readLocal().then((local) => {
        const has = hasData(local) && !meta.owner;
        note.dataset.local = has ? "1" : "";
        setMode(mode);
      });
      function setMode(m) {
        mode = m;
        $("lgTabIn").classList.toggle("on", m === "in");
        $("lgTabUp").classList.toggle("on", m === "up");
        $("lgTabIn").setAttribute("aria-selected", String(m === "in"));
        $("lgTabUp").setAttribute("aria-selected", String(m === "up"));
        $("lgPass2Row").hidden = m === "in";
        pass.autocomplete = m === "in" ? "current-password" : "new-password";
        go.textContent = m === "in" ? "Sign in" : "Create account";
        note.textContent = m === "up" && note.dataset.local ? "🏝️ Your Miis on this device become your account's first world." : m === "up" ? "Pick a username and password. You can sign in with them on any device." : "";
        msg.textContent = "";
      }
      $("lgTabIn").onclick = () => setMode("in");
      $("lgTabUp").onclick = () => setMode("up");
      (meta.user ? pass : user).focus();

      function finish() {
        page.classList.remove("show");
        setTimeout(() => { page.hidden = true; }, 300);
        if (root.MiiSplash && root.MiiSplash.hold) root.MiiSplash.hold(false);
        resolve();
      }
      $("lgOffline").onclick = () => {
        if (busy) return;
        meta.offline = true; saveMeta();
        finish();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        const u = user.value.trim(), pw = pass.value;
        if (!/^[A-Za-z0-9_.-]{3,20}$/.test(u)) { msg.textContent = "Usernames are 3 to 20 letters, numbers, dots, dashes or underscores."; return; }
        if (mode === "up" && pw.length < 6) { msg.textContent = "Passwords need at least 6 characters."; return; }
        if (mode === "up" && pw !== pass2.value) { msg.textContent = "The two passwords don't match."; return; }
        busy = true; go.disabled = true;
        msg.textContent = mode === "in" ? "Signing in…" : "Creating your account…";
        const slow = setTimeout(() => { msg.textContent = "Waking up the server… (this can take up to a minute)"; }, 5000);
        try {
          await open(70000);
          const r = await raw(mode === "in" ? { t: "acLogin", user: u, pass: pw } : { t: "acSignup", user: u, pass: pw, world: "My island" }, 30000);
          clearTimeout(slow);
          authed = true; setOnline(true);
          pass.value = pass2.value = "";
          msg.textContent = "Getting your world ready…";
          await afterSignIn(r, mode === "in" ? "login" : "signup");
          finish();
        } catch (err) {
          clearTimeout(slow);
          msg.textContent = err.code === "net" ? "Couldn't reach the online server. You can play offline and sign in later." : err.message;
        } finally { busy = false; go.disabled = false; }
      };
    });
  }

  // ---------------------------------------------------------------------
  // Starting up
  // ---------------------------------------------------------------------
  let noServer = false;
  async function start() {
    if (!S) return;
    if (meta.next) await applyNext();
    await loadConfig();
    url = serverUrl();
    if (!url) { noServer = true; return; }
    if (meta.token && meta.user) {
      setSplash("Signing in as " + meta.user + "…");
      try {
        await open(10000);
        const r = await raw({ t: "acToken", user: meta.user, token: meta.token }, 15000);
        authed = true; setOnline(true);
        await afterSignIn(r, "resume");
      } catch (e) {
        if (e.code === "token") { meta.token = null; saveMeta(); return showLogin("Please sign in again."); }
        // the server is away: play with this device's copy, save online later
        setOnline(false);
        if (e.code !== "net") console.warn("Couldn't load your world from the server:", e);
      }
      return;
    }
    if (meta.offline) return;
    return showLogin();
  }

  const ready = start().catch((e) => { console.warn("Account start-up problem:", e); }).then(() => {
    started = true;
    if (signedIn()) refreshWorlds();
    // first save of a new account, a world brought along, or changes made offline
    if (signedIn() && (meta.dirty || meta.force)) {
      changeSeq++;
      setTimeout(() => {
        const force = meta.force;
        delete meta.force;
        if (force) forceSave().catch(() => {}); else saveOnline().catch(() => {});
      }, 1500);
    }
  });
  // "keep this device's world" chosen at start-up: overwrite the saved one
  async function forceSave() {
    const { data, blobs } = await toCloud(await readLocal());
    const have = await rpc({ t: "acBlobHave", hashes: Array.from(blobs.keys()) });
    for (const h of have.need) await uploadBlob(h, blobs.get(h));
    const r = await rpc({ t: "acSave", id: meta.worldId, base: meta.rev || 0, data, force: true }, 60000);
    meta.rev = r.rev; meta.dirty = false; meta.lastSave = Date.now(); saveMeta(); renderStatus();
  }

  // ---------------------------------------------------------------------
  // The Account section at the top of ⚙️ Settings (app.js asks for it each
  // time Settings opens: MiiAccount.settingsSection())
  // ---------------------------------------------------------------------
  function settingsSection() {
    const sec = document.createElement("section");
    sec.className = "set-sec ac-sec";
    sec.id = "acSection";
    sec.innerHTML =
      "<h4>Account</h4>" +
      '<p class="ac-status" id="acStatus"></p>' +
      '<div id="acWorldsBox" hidden>' +
        '<label class="set-row"><span>🏝️ World<small>Each world has its own Miis, homes and progress</small></span><select id="acWorldSel" class="ac-select" aria-label="Your worlds"></select></label>' +
        '<div class="ac-btns"><button class="tb-btn" id="acNew">➕ New world</button><button class="tb-btn" id="acRename">✏️ Rename</button><button class="tb-btn" id="acDelete">🗑️ Delete…</button></div>' +
      "</div>" +
      '<div class="set-row"><span>💾 Save<small id="acSaveHint"></small></span><span class="ac-btns"><button class="tb-btn" id="acSaveNow">Save now</button><button class="tb-btn" id="acBackups">🕘 Backups</button></span></div>' +
      '<ul class="ac-backups" id="acBackupList" hidden></ul>' +
      '<div class="set-row" id="acSignRow"><span id="acSignText"></span><button class="tb-btn" id="acSignOut"></button></div>';
    const q = (id) => sec.querySelector("#" + id);
    q("acWorldSel").addEventListener("change", (e) => switchWorld(e.target.value));
    q("acNew").addEventListener("click", newWorld);
    q("acRename").addEventListener("click", renameWorld);
    q("acDelete").addEventListener("click", deleteWorld);
    q("acSaveNow").addEventListener("click", saveNow);
    q("acBackups").addEventListener("click", toggleBackups);
    q("acSignOut").addEventListener("click", signOutOrIn);
    // (filled in once it's on the page)
    setTimeout(() => { renderPanel(); if (signedIn()) refreshWorlds(); }, 0);
    return sec;
  }
  async function refreshWorlds() {
    try { const r = await rpc({ t: "acWorlds" }); worlds = r.worlds; } catch (e) { /* offline: keep what we have */ }
    renderPanel();
  }
  function renderPanel() {
    if (!$("acSection") || !started) return;
    const inAccount = signedIn();
    $("acWorldsBox").hidden = !inAccount;
    $("acSignRow").hidden = noServer;
    $("acSignOut").textContent = inAccount ? "Sign out" : "Sign in…";
    $("acSignText").textContent = inAccount ? "🚪 Sign out of this device" : "☁️ Sign in or create an account";
    $("acSaveHint").textContent = inAccount ? "Saves online now (it also saves by itself), plus a backup on this device" : "Keeps a backup on this device (one is also made every 10 minutes)";
    const sel = $("acWorldSel");
    sel.innerHTML = "";
    const list = worlds.length ? worlds : meta.worldId ? [{ id: meta.worldId, name: meta.worldName || "My island" }] : [];
    for (const w of list) {
      const o = document.createElement("option");
      o.value = w.id; o.textContent = w.name;
      sel.appendChild(o);
    }
    sel.value = meta.worldId || "";
    renderStatus();
  }
  function renderStatus(state) {
    const el = $("acStatus");
    if (!el || !started) return;
    const time = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    let who, sync = "";
    if (signedIn()) {
      who = "👤 Signed in as <b></b>";
      if (state === "saving" || saving) sync = "⏳ Saving online…";
      else if (!online && meta.dirty) sync = "📴 Offline: your changes are kept on this device and saved online when the server is back.";
      else if (!online) sync = "📴 Offline right now: changes are kept on this device.";
      else if (meta.dirty) sync = "✏️ Some changes aren't saved online yet.";
      else sync = "☁️ Saved online" + (meta.lastSave ? " at " + time(meta.lastSave) : "") + ".";
    } else if (noServer) {
      who = "📴 Playing offline. Online accounts aren't set up in this copy of Mii Hub.";
    } else if (meta.owner && meta.user) {
      who = "📴 Playing offline (signed out). Sign in as <b></b> to save this world online.";
    } else {
      who = "📴 Playing offline. Sign in to keep your worlds online and play them on any device.";
    }
    el.innerHTML = who + (sync ? "<br><small></small>" : "");
    const b = el.querySelector("b"); if (b) b.textContent = meta.user || "";
    const sm = el.querySelector("small"); if (sm) sm.textContent = sync;
  }

  // ---------- worlds ----------
  async function leaveThisWorld() {
    // save this world before opening another (or keep it in a backup if that can't happen)
    if (meta.dirty) {
      try { await saveOnline(); } catch (e) {
        const go = await dialog("Couldn't save online", "This world's latest changes couldn't be saved online (" + e.message + "). They'll be kept in a backup on this device. Carry on?",
          [{ label: "Carry on", value: true, kind: "primary" }, { label: "Cancel", value: false }]);
        if (!go) return false;
      }
    }
    await backup("Before leaving " + (meta.worldName || "this world"));
    return true;
  }
  async function switchWorld(id) {
    const sel = $("acWorldSel") || {};
    if (id === meta.worldId) return;
    sel.disabled = true;
    try {
      if (!(await leaveThisWorld())) { sel.value = meta.worldId; return; }
      renderStatusText("⏳ Opening the other world…");
      const w = await fetchWorld(id, (i, n) => renderStatusText("⏳ Downloading Miis… " + i + "/" + n));
      await rpc({ t: "acCurrent", id }).catch(() => {});
      await openNext(w.snap, { worldId: w.id, worldName: w.name, rev: w.rev, dirty: w.isNew });
    } catch (e) {
      sel.value = meta.worldId;
      await dialog("Couldn't switch worlds", e.message, [{ label: "OK", value: true, kind: "primary" }]);
      renderStatus();
    } finally { sel.disabled = false; }
  }
  function renderStatusText(t) { const el = $("acStatus"); if (el) el.textContent = t; }
  async function newWorld() {
    const r = await dialog("A new world", "A brand-new island with a few new Miis. Your other worlds stay just as they are.", [{ label: "Create", value: true, kind: "primary" }, { label: "Cancel", value: false }], "World " + (worlds.length + 1));
    if (!r || !r.value) return;
    try {
      const c = await rpc({ t: "acCreate", name: r.text });
      worlds = c.worlds;
      renderPanel();
      await switchWorld(c.id);
    } catch (e) { await dialog("Couldn't create a world", e.message, [{ label: "OK", value: true, kind: "primary" }]); }
  }
  async function renameWorld() {
    const cur = worlds.find((w) => w.id === meta.worldId) || { name: meta.worldName || "" };
    const r = await dialog("Rename this world", "", [{ label: "Rename", value: true, kind: "primary" }, { label: "Cancel", value: false }], cur.name);
    if (!r || !r.value || !r.text) return;
    try {
      const c = await rpc({ t: "acRename", id: meta.worldId, name: r.text });
      worlds = c.worlds;
      meta.worldName = (worlds.find((w) => w.id === meta.worldId) || {}).name || r.text;
      saveMeta();
      renderPanel();
    } catch (e) { await dialog("Couldn't rename it", e.message, [{ label: "OK", value: true, kind: "primary" }]); }
  }
  async function deleteWorld() {
    const others = worlds.filter((w) => w.id !== meta.worldId);
    if (!others.length) return dialog("This is your only world", "Make another world first, then you can delete this one.", [{ label: "OK", value: true, kind: "primary" }]);
    const pick = await dialog("Delete a world", "Which world do you want to delete forever? (You can't delete the one you're in: switch to another first.)",
      others.map((w) => ({ label: "🗑️ " + w.name, value: w.id, kind: "danger" })).concat([{ label: "Cancel", value: null }]));
    if (!pick) return;
    const w = others.find((x) => x.id === pick);
    const sure = await dialog("Delete “" + w.name + "”?", "Its Miis, homes and progress will be gone from your account on every device.", [{ label: "Delete it", value: true, kind: "danger" }, { label: "Keep it", value: false }]);
    if (!sure) return;
    try { const c = await rpc({ t: "acDelete", id: pick }); worlds = c.worlds; renderPanel(); } catch (e) { await dialog("Couldn't delete it", e.message, [{ label: "OK", value: true, kind: "primary" }]); }
  }

  // ---------- saving and backups ----------
  async function saveNow() {
    const btn = $("acSaveNow") || {};
    btn.disabled = true;
    try {
      await backup("Saved with “Save now”");
      if (signedIn()) {
        if (saving) await saving.catch(() => {});
        changeSeq++;
        if (!meta.dirty) { meta.dirty = true; saveMeta(); }
        try { await saveOnline(); } catch (e) { renderStatusText("📴 Saved on this device. Couldn't save online (" + e.message + "): it'll try again later."); return; }
      } else renderStatusText("💾 Saved a backup on this device.");
      if ($("acBackupList") && !$("acBackupList").hidden) renderBackups();
    } finally { btn.disabled = false; }
  }
  function toggleBackups() {
    const list = $("acBackupList");
    list.hidden = !list.hidden;
    if (!list.hidden) renderBackups();
  }
  async function renderBackups() {
    const list = $("acBackupList");
    if (!list) return;
    const all = await listBackups();
    list.innerHTML = "";
    if (!all.length) { const li = document.createElement("li"); li.className = "ac-empty"; li.textContent = "No backups yet. One is made every 10 minutes while you play, and when you press Save now."; list.appendChild(li); return; }
    for (const b of all) {
      const li = document.createElement("li");
      const txt = document.createElement("span");
      const d = new Date(b.at);
      txt.textContent = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " · " + b.miis.length + " Mii" + (b.miis.length === 1 ? "" : "s") + (b.world ? " · " + b.world : "");
      txt.title = b.label || "";
      const btn = document.createElement("button");
      btn.className = "link-btn"; btn.textContent = "Restore";
      btn.addEventListener("click", () => restore(b));
      li.append(txt, btn);
      list.appendChild(li);
    }
  }
  async function restore(b) {
    const sure = await dialog("Restore this backup?", "This world goes back to how it was then" + (signedIn() ? " (and is saved online like that)" : "") + ". What you have now is backed up first.",
      [{ label: "Restore", value: true, kind: "primary" }, { label: "Cancel", value: false }]);
    if (!sure) return;
    await backup("Before restoring a backup");
    await openNext({ miis: b.miis, keys: b.keys }, { dirty: !!meta.owner });
  }

  // ---------- signing out (or in) ----------
  async function signOutOrIn() {
    if (!signedIn()) {
      meta.offline = false; saveMeta();
      leaving = true;
      location.reload();
      return;
    }
    const sure = await dialog("Sign out?", "This world stays on this device, and you can sign back in any time.", [{ label: "Sign out", value: true, kind: "primary" }, { label: "Cancel", value: false }]);
    if (!sure) return;
    if (meta.dirty) await saveOnline().catch(() => {});
    await backup("Before signing out");
    try { await rpc({ t: "acLogout" }, 5000); } catch (e) { /* the token is forgotten here anyway */ }
    meta.token = null; meta.offline = false;
    saveMeta();
    leaving = true;
    location.reload();
  }

  root.MiiAccount = {
    ready,
    saveNow,
    settingsSection,
    get user() { return signedIn() ? meta.user : null; },
    get online() { return online; },
    _meta: () => Object.assign({}, meta, { token: meta.token ? "(set)" : null }), // for tests
  };
})(typeof self !== "undefined" ? self : this);
