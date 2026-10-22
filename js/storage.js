/*
 * storage.js
 * Saves Miis in the browser so they're still there next time.
 *
 * .glb files are too big for localStorage, so Miis go into IndexedDB (the
 * browser's built-in database). Small settings (scene, friendships) use
 * localStorage. Both can be unavailable (e.g. private windows), so every call
 * fails quietly and the app keeps working without saving.
 */
(function (root) {
  "use strict";

  const DB_NAME = "mii-hub-3d";
  const STORE = "miis";
  const SETTINGS_KEY = "mii-hub-3d-settings";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // tells account.js something changed, so the world gets saved online
  const changed = () => { if (Storage.onChange) try { Storage.onChange(); } catch (e) { /* ignore */ } };

  const Storage = {
    onChange: null,
    getAllMiis: async () => (await run("readonly", (s) => s.getAll())) || [],
    putMii: (record) => (changed(), run("readwrite", (s) => s.put(record))),
    deleteMii: (id) => (changed(), run("readwrite", (s) => s.delete(id))),
    clearMiis: () => (changed(), run("readwrite", (s) => s.clear())),

    loadSettings() {
      try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      } catch (e) {
        return {};
      }
    },
    saveSettings(settings) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
      changed();
    },
  };

  root.MiiStorage = Storage;
})(typeof self !== "undefined" ? self : this);
