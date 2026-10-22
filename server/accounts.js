/*
 * Accounts and cloud saves for Mii Hub (runs inside the same server as Paintball).
 *
 * Players pick a username + password, then sign in on any device and get their
 * worlds (Miis, homes, progress) back. Everything is kept on this computer's disk
 * as plain JSON files, in the folder DATA_DIR (default: server/data, which is
 * never committed):
 *
 *   data/users/<name>/account.json        name, password hash + salt, sign-in tokens (hashed), world list
 *   data/users/<name>/worlds/<id>.json    a world: { rev, data }   (+ <id>.prev.json, the save before)
 *   data/users/<name>/blobs/<sha256>.glb  the Mii .glb models the worlds use (stored once each)
 *
 * Passwords are hashed with scrypt and a salt of their own, and never stored,
 * sent back or logged. Signing in gives a random token; only its hash is kept.
 *
 * Big Mii models are sent in small pieces (BLOB_CHUNK), so no single message gets
 * near the server's message size limit.
 *
 * PROTOCOL (no hello needed). Every request has a number q; the answer is
 *   acRes { q, ok: true, ... }  or  acRes { q, ok: false, code, msg }
 * client -> server
 *   acSignup  { user, pass }               -> { user, token, worlds, current }
 *   acLogin   { user, pass }               -> the same
 *   acToken   { user, token }              -> the same (stay signed in on this device)
 *   acLogout  {}                           forgets this device's token
 *   acWorlds  {}                           -> { worlds, current }
 *   acCreate  { name }                     -> { id, worlds, current }  a new, empty world
 *   acRename  { id, name }                 -> { worlds, current }
 *   acDelete  { id }                       -> { worlds, current }
 *   acCurrent { id }                       -> { worlds, current }  the world to open next time
 *   acGet     { id }                       -> { id, rev, data }    (data is null for a new world)
 *   acSave    { id, base, data, force }    -> { id, rev }  base = the rev your copy started from;
 *                                             someone else saved since? code "conflict" (unless force)
 *   acBlobHave { hashes }                  -> { need }   which models the server doesn't have yet
 *   acBlobPut  { hash, i, n, b64 }         -> { done }   piece i of n of a model (done: all stored)
 *   acBlobGet  { hash, i }                 -> { hash, i, n, b64 }
 */
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const MAX_ACCOUNTS = parseInt(process.env.MAX_ACCOUNTS || "5000", 10);
const MAX_WORLDS = 12;                      // worlds per account
const MAX_WORLD_BYTES = 5 * 1024 * 1024;    // one world without its models (JSON)
const MAX_BLOB_BYTES = 30 * 1024 * 1024;    // one Mii model (the game takes files up to 30 MB)
const MAX_USER_BLOB_BYTES = 300 * 1024 * 1024; // all of one account's models together
const BLOB_CHUNK = 512 * 1024;              // model pieces: 512 KB (about 700 KB as base64)
const MAX_TOKENS = 10;                      // devices signed in at once (the oldest is signed out)
const TOKEN_DAYS = 365;                     // a device unused for a year signs in again
const SCRYPT = { N: 16384, r: 8, p: 1 };

// never let saves fill the disk (other things on this computer need it too):
// accounts stop saving while less than this is free
const MIN_FREE_BYTES = parseFloat(process.env.MIN_FREE_GB || "10") * 1024 ** 3;

const USER_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^w[0-9a-z]{4,24}$/;

module.exports = function accounts(ctx) {
  const { send, clean, log } = ctx;
  const usersDir = path.join(DATA_DIR, "users");
  // (if the folder can't be made, e.g. no permission, accounts are off but games still work)
  let off = null;
  try { fs.mkdirSync(usersDir, { recursive: true }); fs.accessSync(usersDir, fs.constants.W_OK); } catch (e) {
    off = e.code || "error";
    log("⚠️ accounts are OFF: can't write to " + usersDir + " (" + off + "). Set DATA_DIR to a folder this server can write to.");
  }
  let accountCount = 0;
  try { accountCount = fs.readdirSync(usersDir).length; } catch (e) { /* new folder */ }

  // ---------- small helpers ----------
  async function diskOk() {
    if (!fsp.statfs) return true; // (older Node: can't tell)
    try { const st = await fsp.statfs(DATA_DIR); return st.bavail * st.bsize > MIN_FREE_BYTES; } catch (e) { return true; }
  }
  async function needDisk() {
    if (!(await diskOk())) { log("⚠️ accounts: disk almost full, not saving"); throw err("disk", "The server is out of space right now. Your world is still saved on this device."); }
  }
  const keyOf = (user) => String(user).toLowerCase();
  const userDir = (key) => path.join(usersDir, key);
  const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const scrypt = (pass, salt) => new Promise((resolve, reject) => {
    crypto.scrypt(pass, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });

  // one thing at a time per account, so two saves can't mix up the files
  const queues = new Map();
  function locked(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return next;
  }
  // write to a temporary file first, so a crash never leaves half a file
  async function writeJson(file, obj) {
    const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    await fsp.writeFile(tmp, typeof obj === "string" ? obj : JSON.stringify(obj));
    await fsp.rename(tmp, file);
  }
  async function readJson(file) {
    try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch (e) { return null; }
  }
  const loadAccount = (key) => readJson(path.join(userDir(key), "account.json"));
  const saveAccount = (acc) => writeJson(path.join(userDir(keyOf(acc.user)), "account.json"), acc);

  const worldList = (acc) => acc.worlds.map((w) => ({ id: w.id, name: w.name, rev: w.rev, updated: w.updated, size: w.size || 0 }));
  const listReply = (acc) => ({ worlds: worldList(acc), current: acc.current });
  function newWorld(acc, name) {
    const w = { id: "w" + crypto.randomBytes(6).toString("hex"), name: clean(name, 32) || "My island", rev: 0, updated: Date.now(), size: 0 };
    acc.worlds.push(w);
    return w;
  }

  // ---------- slowing down password guessing ----------
  // per connection, per address and per account (failed tries only for accounts)
  const hits = new Map(); // "ip:1.2.3.4" / "user:ann" / "signup:1.2.3.4" -> [times]
  function tooMany(k, max, windowMs, now) {
    const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
    hits.set(k, list);
    return list.length >= max;
  }
  const note = (k) => { const l = hits.get(k) || []; l.push(Date.now()); hits.set(k, l); };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, l] of hits) if (!l.length || now - l[l.length - 1] > 3600e3) hits.delete(k);
  }, 600e3);
  if (sweep.unref) sweep.unref();

  // ---------- signing in ----------
  async function issueToken(acc) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    acc.tokens = (acc.tokens || []).filter((t) => now - t.last < TOKEN_DAYS * 86400e3);
    acc.tokens.push({ h: sha256(token), at: now, last: now });
    acc.tokens.sort((a, b) => a.last - b.last);
    while (acc.tokens.length > MAX_TOKENS) acc.tokens.shift();
    return token;
  }
  // token: a new one to hand out (null when signing in with one you have)
  function signedIn(p, acc, token, tokenHash) {
    p.acUser = keyOf(acc.user);
    p.acTokenHash = token ? sha256(token) : tokenHash;
    return Object.assign({ user: acc.user, token }, listReply(acc));
  }

  async function signup(p, msg) {
    const user = String(msg.user || "").trim(), pass = String(msg.pass || "");
    if (!USER_RE.test(user)) throw err("user", "Usernames are 3 to 20 letters, numbers, dots, dashes or underscores.");
    if (pass.length < 6 || pass.length > 200) throw err("pass", "Passwords need at least 6 characters.");
    if (tooMany("signup:" + p.ip, 20, 3600e3, Date.now())) throw err("slow", "Too many new accounts from here. Try again later.");
    if (accountCount >= MAX_ACCOUNTS) throw err("full", "This server can't take any more accounts.");
    await needDisk();
    const key = keyOf(user);
    return locked(key, async () => {
      try { await fsp.mkdir(userDir(key)); } catch (e) {
        if (e.code === "EEXIST") throw err("taken", "That username is taken. Try another one!");
        throw e;
      }
      note("signup:" + p.ip);
      accountCount++;
      await fsp.mkdir(path.join(userDir(key), "worlds"), { recursive: true });
      await fsp.mkdir(path.join(userDir(key), "blobs"), { recursive: true });
      const salt = crypto.randomBytes(16).toString("hex");
      const acc = { v: 1, user, salt, hash: (await scrypt(pass, salt)).toString("hex"), created: Date.now(), tokens: [], worlds: [], current: null };
      acc.current = newWorld(acc, msg.world || "My island").id;
      const token = await issueToken(acc);
      await saveAccount(acc);
      log("👤 new account " + key);
      return signedIn(p, acc, token);
    });
  }

  async function login(p, msg) {
    const user = String(msg.user || "").trim(), pass = String(msg.pass || "");
    const now = Date.now(), key = keyOf(user);
    if (tooMany("conn:" + p.id, 6, 60e3, now) || tooMany("ip:" + p.ip, 30, 60e3, now) || (USER_RE.test(user) && tooMany("user:" + key, 8, 600e3, now))) {
      throw err("slow", "Too many tries. Wait a minute and try again.");
    }
    note("conn:" + p.id); note("ip:" + p.ip);
    const wrong = () => err("login", "Wrong username or password.");
    if (!USER_RE.test(user) || pass.length > 200) throw wrong();
    return locked(key, async () => {
      const acc = await loadAccount(key);
      // (hash anyway, so a missing account takes as long as a wrong password)
      const got = await scrypt(pass, acc ? acc.salt : "no-such-account");
      if (!acc || !crypto.timingSafeEqual(got, Buffer.from(acc.hash, "hex"))) { note("user:" + key); throw wrong(); }
      const token = await issueToken(acc);
      await saveAccount(acc);
      return signedIn(p, acc, token);
    });
  }

  async function tokenLogin(p, msg) {
    const user = String(msg.user || "").trim(), token = String(msg.token || "");
    const now = Date.now(), key = keyOf(user);
    if (tooMany("conn:" + p.id, 6, 60e3, now) || tooMany("ip:" + p.ip, 30, 60e3, now)) throw err("slow", "Too many tries. Wait a minute and try again.");
    const bad = () => err("token", "Please sign in again.");
    if (!USER_RE.test(user) || !HASH_RE.test(token)) { note("conn:" + p.id); throw bad(); }
    return locked(key, async () => {
      const acc = await loadAccount(key);
      const h = sha256(token);
      const t = acc && (acc.tokens || []).find((x) => x.h === h && now - x.last < TOKEN_DAYS * 86400e3);
      if (!t) { note("conn:" + p.id); note("ip:" + p.ip); throw bad(); }
      if (now - t.last > 3600e3) { t.last = now; await saveAccount(acc); }
      return signedIn(p, acc, null, h);
    });
  }

  // ---------- worlds ----------
  const worldFile = (key, id, prev) => path.join(userDir(key), "worlds", id + (prev ? ".prev" : "") + ".json");
  function findWorld(acc, id) {
    const w = acc.worlds.find((x) => x.id === id);
    if (!w) throw err("noworld", "That world doesn't exist any more.");
    return w;
  }
  // the models a world uses (each Mii's .glb, by its SHA-256)
  function blobsIn(data) {
    const out = new Set();
    if (data && Array.isArray(data.miis)) for (const m of data.miis) if (m && typeof m.blob === "string" && HASH_RE.test(m.blob)) out.add(m.blob);
    return out;
  }
  // models no world uses any more (only old ones: a save may be about to use a new one)
  async function tidyBlobs(key, acc) {
    const used = new Set();
    for (const w of acc.worlds) for (const h of blobsIn((await readJson(worldFile(key, w.id)) || {}).data)) used.add(h);
    const dir = path.join(userDir(key), "blobs");
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      const h = f.replace(/\.glb$/, "");
      if (used.has(h)) continue;
      const st = await fsp.stat(path.join(dir, f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 3600e3) await fsp.unlink(path.join(dir, f)).catch(() => {});
    }
  }
  async function blobBytes(key) {
    const dir = path.join(userDir(key), "blobs");
    let total = 0;
    for (const f of await fsp.readdir(dir).catch(() => [])) { const st = await fsp.stat(path.join(dir, f)).catch(() => null); if (st) total += st.size; }
    return total;
  }

  async function worldOp(p, msg) {
    const key = p.acUser;
    return locked(key, async () => {
      const acc = await loadAccount(key);
      if (!acc || !(acc.tokens || []).some((t) => t.h === p.acTokenHash)) { p.acUser = null; throw err("token", "Please sign in again."); }
      switch (msg.t) {
        case "acWorlds": return listReply(acc);
        case "acCreate": {
          if (acc.worlds.length >= MAX_WORLDS) throw err("max", "You can have up to " + MAX_WORLDS + " worlds.");
          const w = newWorld(acc, msg.name || "World " + (acc.worlds.length + 1));
          await saveAccount(acc);
          return Object.assign({ id: w.id }, listReply(acc));
        }
        case "acRename": {
          const w = findWorld(acc, msg.id);
          w.name = clean(msg.name, 32) || w.name;
          await saveAccount(acc);
          return listReply(acc);
        }
        case "acDelete": {
          findWorld(acc, msg.id);
          if (acc.worlds.length <= 1) throw err("last", "You need at least one world.");
          acc.worlds = acc.worlds.filter((x) => x.id !== msg.id);
          if (acc.current === msg.id) acc.current = acc.worlds[0].id;
          await saveAccount(acc);
          await fsp.unlink(worldFile(key, msg.id)).catch(() => {});
          await fsp.unlink(worldFile(key, msg.id, true)).catch(() => {});
          await tidyBlobs(key, acc);
          return listReply(acc);
        }
        case "acCurrent": {
          findWorld(acc, msg.id);
          acc.current = msg.id;
          await saveAccount(acc);
          return listReply(acc);
        }
        case "acGet": {
          const w = findWorld(acc, msg.id);
          const f = await readJson(worldFile(key, w.id));
          return { id: w.id, name: w.name, rev: w.rev, data: f ? f.data : null };
        }
        case "acSave": {
          const w = findWorld(acc, msg.id);
          if (!msg.force && w.rev !== msg.base) throw Object.assign(err("conflict", "This world was saved on another device."), { rev: w.rev });
          await needDisk();
          const data = msg.data;
          if (!data || typeof data !== "object" || !Array.isArray(data.miis)) throw err("bad", "That save doesn't look right.");
          const blobs = path.join(userDir(key), "blobs");
          for (const h of blobsIn(data)) if (!fs.existsSync(path.join(blobs, h + ".glb"))) throw err("blob", "A Mii's model hasn't been uploaded yet.");
          const json = JSON.stringify({ rev: w.rev + 1, data });
          if (json.length > MAX_WORLD_BYTES) throw err("big", "This world is too big to save online.");
          const file = worldFile(key, w.id);
          if (fs.existsSync(file)) await fsp.copyFile(file, worldFile(key, w.id, true)); // keep the save before, just in case
          await writeJson(file, json);
          w.rev++; w.updated = Date.now(); w.size = json.length;
          await saveAccount(acc);
          return { id: w.id, rev: w.rev };
        }
        case "acBlobHave": {
          const hashes = Array.isArray(msg.hashes) ? msg.hashes.filter((h) => HASH_RE.test(h)).slice(0, 500) : [];
          const dir = path.join(userDir(key), "blobs");
          return { need: hashes.filter((h) => !fs.existsSync(path.join(dir, h + ".glb"))) };
        }
        case "acBlobGet": {
          if (!HASH_RE.test(msg.hash)) throw err("bad", "No such model.");
          const file = path.join(userDir(key), "blobs", msg.hash + ".glb");
          const st = await fsp.stat(file).catch(() => null);
          if (!st) throw err("noblob", "No such model.");
          const n = Math.max(1, Math.ceil(st.size / BLOB_CHUNK)), i = Math.floor(Number(msg.i) || 0);
          if (i < 0 || i >= n) throw err("bad", "No such piece.");
          const fh = await fsp.open(file, "r");
          try {
            const len = Math.min(BLOB_CHUNK, st.size - i * BLOB_CHUNK);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, i * BLOB_CHUNK);
            return { hash: msg.hash, i, n, size: st.size, b64: buf.toString("base64") };
          } finally { await fh.close(); }
        }
        case "acBlobPut": {
          // pieces arrive in order; the finished file must match its hash
          const h = msg.hash, n = Math.floor(Number(msg.n) || 0), i = Math.floor(Number(msg.i) || 0);
          if (!HASH_RE.test(h) || n < 1 || n > Math.ceil(MAX_BLOB_BYTES / BLOB_CHUNK) || typeof msg.b64 !== "string") throw err("bad", "That model doesn't look right.");
          const piece = Buffer.from(msg.b64, "base64");
          if (piece.length > BLOB_CHUNK) throw err("bad", "That piece is too big.");
          if (i === 0) { await needDisk(); p.acUp = { hash: h, n, next: 0, parts: [], size: 0 }; }
          const up = p.acUp;
          if (!up || up.hash !== h || up.n !== n || up.next !== i) { p.acUp = null; throw err("order", "Model pieces arrived out of order."); }
          up.parts.push(piece); up.size += piece.length; up.next++;
          if (up.size > MAX_BLOB_BYTES) { p.acUp = null; throw err("big", "That Mii's model is too big."); }
          if (up.next < n) return { done: false };
          p.acUp = null;
          const all = Buffer.concat(up.parts);
          if (sha256(all) !== h) throw err("hash", "That model got mixed up on the way. Try again.");
          if ((await blobBytes(key)) + all.length > MAX_USER_BLOB_BYTES) throw err("space", "Your account is out of space for Mii models.");
          const file = path.join(userDir(key), "blobs", h + ".glb");
          if (!fs.existsSync(file)) { await fsp.writeFile(file + ".tmp", all); await fsp.rename(file + ".tmp", file); }
          return { done: true };
        }
      }
      throw err("bad", "Unknown request.");
    });
  }

  async function logout(p) {
    const key = p.acUser, h = p.acTokenHash;
    p.acUser = null; p.acTokenHash = null;
    if (!key) return {};
    return locked(key, async () => {
      const acc = await loadAccount(key);
      if (acc) { acc.tokens = (acc.tokens || []).filter((t) => t.h !== h); await saveAccount(acc); }
      return {};
    });
  }

  function err(code, msg) { const e = new Error(msg); e.code = code; e.mine = true; return e; }

  // ---------- messages ----------
  function handle(p, msg) {
    if (typeof msg.t !== "string" || msg.t.slice(0, 2) !== "ac") return false;
    const q = msg.q;
    const reply = (r) => send(p, Object.assign({ t: "acRes", q, ok: true }, r));
    const fail = (e) => {
      if (!e.mine) log("accounts: " + msg.t + " failed: " + e.message);
      send(p, Object.assign({ t: "acRes", q, ok: false, code: e.code && e.mine ? e.code : "server", msg: e.mine ? e.message : "The server had a problem. Try again in a bit." }, e.rev != null ? { rev: e.rev } : {}));
    };
    let job;
    if (off) { fail(err("off", "Accounts aren't available on this server right now.")); return true; }
    switch (msg.t) {
      case "acSignup": job = signup(p, msg); break;
      case "acLogin": job = login(p, msg); break;
      case "acToken": job = tokenLogin(p, msg); break;
      case "acLogout": job = logout(p); break;
      case "acWorlds": case "acCreate": case "acRename": case "acDelete": case "acCurrent": case "acGet": case "acSave":
      case "acBlobHave": case "acBlobGet": case "acBlobPut":
        job = p.acUser ? worldOp(p, msg) : Promise.reject(err("token", "Please sign in first."));
        break;
      default: job = Promise.reject(err("bad", "Unknown request."));
    }
    job.then(reply, fail);
    return true;
  }
  function leave(p) { p.acUp = null; hits.delete("conn:" + p.id); }

  return { handle, leave, DATA_DIR, BLOB_CHUNK };
};
