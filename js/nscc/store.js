/*
 * js/nscc/store.js
 * ALL the shared state of MiiNSCC lives behind this one module:
 *
 *   - the board:   the Miis in today's office, each with its location text
 *                  ("" = in the office) and the time it left (leftAt)
 *   - saved Miis:  every Mii ever added on this computer (name + its .glb file),
 *                  so it can be put back on the board with one click next day
 *   - workspaces:  which desk or private office belongs to which Mii (these stay
 *                  from day to day; a Mii without one takes any free desk)
 *
 * Right now it keeps everything in this browser (the board in localStorage, the
 * saved Miis in IndexedDB) and keeps tabs on the same computer in sync.
 *
 * LATER: a server. Write another object with the same methods (for example one
 * that talks to a WebSocket server: send the change, and call emit() when the
 * server says something changed) and hand it to the app instead of this one.
 * The rest of the app only ever uses the methods below, and listens to on().
 *
 * The API (everything returns a Promise):
 *   ready                      resolves once the store has loaded
 *   getBoard()                 -> [{ id, name, addedAt, location, leftAt }]
 *   listSaved()                -> [{ id, name, fileName, bytes (ArrayBuffer), savedAt }]
 *   saveMii({ id?, name, fileName, bytes }) -> the saved record (same id = replaced)
 *   deleteSaved(id)            forget a saved Mii (only when it isn't on the board)
 *   addToBoard(id)             put a saved Mii in the office (it walks in)
 *   removeFromBoard(id)        take a Mii off today's board (it walks out)
 *   setLocation(id, text)      "" = back in the office; anything else = out, there
 *   sweep()                    take expired Miis off the board (6 PM rule; see logic.js)
 *   getAssignments()           -> { miiId: spotId } (spot ids from office.js: "desk-3", "office-A")
 *   assignSpot(miiId, spotId)  give that Mii its own spot (null = any free desk). If the spot
 *                              was someone else's, they swap (see logic.js assignSpot)
 *                              -> { assignments, swapped }
 *   on(fn)                     fn({ type: "board" | "saved" | "assign" }) after any change,
 *                              also changes made in another tab. Returns an "off" function.
 */
(function (root) {
  "use strict";

  const L = root.NSCCLogic || (typeof require !== "undefined" ? require("./logic.js") : null);
  const BOARD_KEY = "miinscc-board";
  const ASSIGN_KEY = "miinscc-assignments";

  // ---------- small storage backends (swappable, so tests can use memory ones) ----------
  function memoryKV() {
    const data = new Map();
    return { get: (k) => (data.has(k) ? data.get(k) : null), set: (k, v) => data.set(k, v), onChange: null };
  }
  function memoryDB() {
    const data = new Map();
    return {
      getAll: async () => Array.from(data.values()),
      put: async (rec) => { data.set(rec.id, rec); },
      delete: async (id) => { data.delete(id); },
    };
  }
  function browserKV() {
    try {
      const ls = root.localStorage;
      ls.getItem(BOARD_KEY);
      const kv = {
        get: (k) => { try { return ls.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { ls.setItem(k, v); } catch (e) { /* full or blocked */ } },
        onChange: null,
      };
      // another tab changed the board
      root.addEventListener("storage", (e) => { if ((e.key === BOARD_KEY || e.key === ASSIGN_KEY) && kv.onChange) kv.onChange(e.key); });
      return kv;
    } catch (e) {
      return memoryKV(); // (private window with storage blocked: works, but forgets on reload)
    }
  }
  function browserDB() {
    const NAME = "miinscc", STORE = "savedMiis";
    let opening = null;
    const open = () => opening || (opening = new Promise((resolve) => {
      try {
        const req = root.indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null); // (another tab is holding an older copy open)
        setTimeout(() => resolve(null), 4000); // (the browser never answered: keep going without it)
      } catch (e) { resolve(null); }
    }));
    const fallback = memoryDB();
    const run = async (mode, fn, fb) => {
      const db = await open();
      if (!db) return fb();
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : null);
          tx.onerror = () => resolve(null);
        } catch (e) { resolve(fb()); }
      });
    };
    return {
      getAll: async () => (await run("readonly", (s) => s.getAll(), fallback.getAll)) || [],
      put: (rec) => run("readwrite", (s) => s.put(rec), () => fallback.put(rec)),
      delete: (id) => run("readwrite", (s) => s.delete(id), () => fallback.delete(id)),
    };
  }
  function browserChannel() {
    try {
      const bc = new root.BroadcastChannel("miinscc");
      const ch = { post: (m) => { try { bc.postMessage(m); } catch (e) { /* closed */ } }, onMessage: null };
      bc.onmessage = (e) => { if (ch.onMessage) ch.onMessage(e.data); };
      return ch;
    } catch (e) {
      return null;
    }
  }

  // ---------- the store ----------
  // opts: { kv, db, channel, now } (all optional: the browser's own are used)
  function createStore(opts) {
    opts = opts || {};
    const kv = opts.kv || browserKV();
    const db = opts.db || browserDB();
    const channel = opts.channel === undefined ? browserChannel() : opts.channel;
    const now = opts.now || (() => Date.now());
    const listeners = new Set();
    let saved = []; // cache of the saved Miis

    const emit = (type) => { for (const fn of Array.from(listeners)) { try { fn({ type }); } catch (e) { console.error(e); } } };

    function readBoard() {
      try {
        const raw = JSON.parse(kv.get(BOARD_KEY) || "null");
        return raw && Array.isArray(raw.members) ? raw.members.filter((m) => m && typeof m.id === "string") : [];
      } catch (e) {
        return [];
      }
    }
    function writeBoard(members) {
      kv.set(BOARD_KEY, JSON.stringify({ version: 1, members, updatedAt: now() }));
      if (channel) channel.post({ type: "board" });
      emit("board");
    }
    // the board as it is right now, without anyone whose day has ended
    function currentBoard() {
      const t = now();
      return readBoard().filter((m) => !L.isExpired(m, t));
    }
    async function loadSaved() {
      saved = (await db.getAll()).filter((r) => r && r.id).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      return saved;
    }

    function readAssignments() {
      try {
        const raw = JSON.parse(kv.get(ASSIGN_KEY) || "null");
        const out = {};
        if (raw && raw.assignments && typeof raw.assignments === "object") {
          for (const id of Object.keys(raw.assignments)) if (typeof raw.assignments[id] === "string" && raw.assignments[id]) out[id] = raw.assignments[id];
        }
        return out;
      } catch (e) {
        return {};
      }
    }
    function writeAssignments(assignments) {
      kv.set(ASSIGN_KEY, JSON.stringify({ version: 1, assignments, updatedAt: now() }));
      if (channel) channel.post({ type: "assign" });
      emit("assign");
    }

    if (kv.onChange !== undefined) kv.onChange = (key) => emit(key === ASSIGN_KEY ? "assign" : "board");
    if (channel) channel.onMessage = async (msg) => {
      if (!msg) return;
      if (msg.type === "saved") { await loadSaved(); emit("saved"); }
      else if (msg.type === "board") emit("board");
      else if (msg.type === "assign") emit("assign");
    };

    const store = {
      ready: null,
      async getBoard() { return currentBoard(); },
      async listSaved() { return saved.slice(); },
      async saveMii(rec) {
        const id = rec.id || "mii-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        const old = saved.find((r) => r.id === id);
        const record = { id, name: String(rec.name || "Mii").slice(0, 40), fileName: rec.fileName || "", bytes: rec.bytes, savedAt: old ? old.savedAt : now() };
        await db.put(record);
        saved = saved.filter((r) => r.id !== id).concat([record]).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
        // (a new name shows on the board too)
        const board = readBoard();
        if (board.some((m) => m.id === id && m.name !== record.name)) writeBoard(board.map((m) => (m.id === id ? Object.assign({}, m, { name: record.name }) : m)));
        if (channel) channel.post({ type: "saved" });
        emit("saved");
        return record;
      },
      async deleteSaved(id) {
        if (currentBoard().some((m) => m.id === id)) throw new Error("that Mii is on the board");
        await db.delete(id);
        saved = saved.filter((r) => r.id !== id);
        const a = readAssignments();
        if (a[id]) { delete a[id]; writeAssignments(a); } // (its desk is free again)
        if (channel) channel.post({ type: "saved" });
        emit("saved");
      },
      async addToBoard(id) {
        const rec = saved.find((r) => r.id === id);
        if (!rec) throw new Error("no saved Mii with that id");
        const board = currentBoard();
        if (board.some((m) => m.id === id)) return board.find((m) => m.id === id);
        const member = { id, name: rec.name, addedAt: now(), location: "", leftAt: null };
        writeBoard(board.concat([member]));
        return member;
      },
      async removeFromBoard(id) {
        const board = currentBoard();
        if (!board.some((m) => m.id === id)) return;
        writeBoard(board.filter((m) => m.id !== id));
      },
      async setLocation(id, text) {
        const board = currentBoard();
        const m = board.find((x) => x.id === id);
        if (!m) return null;
        const next = L.withLocation(m, text, now());
        if (next.location === (m.location || "") && next.leftAt === m.leftAt) return m; // (nothing changed)
        writeBoard(board.map((x) => (x.id === id ? next : x)));
        return next;
      },
      async sweep() {
        const all = readBoard();
        const t = now();
        const gone = all.filter((m) => L.isExpired(m, t)).map((m) => m.id);
        if (gone.length) writeBoard(all.filter((m) => !L.isExpired(m, t)));
        return gone;
      },
      async getAssignments() { return readAssignments(); },
      async assignSpot(miiId, spotId) {
        if (typeof miiId !== "string" || !miiId) throw new Error("which Mii?");
        const before = readAssignments();
        const result = L.assignSpot(before, miiId, spotId ? String(spotId) : null);
        if (JSON.stringify(result.assignments) !== JSON.stringify(before)) writeAssignments(result.assignments);
        return result;
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      emit, // (for a future server-backed store: call when the server reports a change)
    };
    store.ready = loadSaved().then(() => store.sweep()).then(() => store);
    return store;
  }

  const api = { createStore, memoryKV, memoryDB, BOARD_KEY, ASSIGN_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NSCCStore = api;
})(typeof self !== "undefined" ? self : this);
