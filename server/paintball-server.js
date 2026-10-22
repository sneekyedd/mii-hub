/*
 * Mii Hub — online Paintball server
 *
 * Run it on a computer your friends can reach (see server/README.md):
 *     npm install
 *     npm start            (or: node paintball-server.js)
 *
 * Settings (environment variables):
 *     PORT        which port to listen on (default 8787)
 *     HOST        which address to listen on (default: all; 127.0.0.1 = this computer only)
 *     MAX_PLAYERS players per room (default 8)
 *
 * What it does:
 *   - keeps a list of rooms; players create or join one
 *   - passes everyone's movement, shots and sounds on to the others in the room
 *   - is the referee: it keeps everyone's HP and score, checks that hits are
 *     believable (damage numbers, fire rate), decides kills, respawns and who wins
 *   - also hosts online chess games (see chess-rooms.js)
 *   - and Mii Hub accounts with cloud saves (see accounts.js; saved in DATA_DIR, default ./data)
 *
 * Every message is a small JSON object with a type "t" (see PROTOCOL below).
 */
"use strict";

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const VERSION = 5; // (2: lobbies with warmup, modes and voting; 3: AWP loadout; 4: weapon skins; 5: online chess)
const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 = only reachable through Tailscale Funnel
const MAX_PLAYERS = Math.max(2, Math.min(16, parseInt(process.env.MAX_PLAYERS || "8", 10))); // most a host can pick
const TO_WIN = 20;               // first to 20 eliminations
const TIME_LIMIT = 10 * 60e3;    // or whoever's ahead after 10 minutes
const RESPAWN_MS = parseInt(process.env.RESPAWN_MS || "2000", 10);
const COUNTDOWN_MS = parseInt(process.env.COUNTDOWN_MS || "3000", 10);
const ROUNDS_TO_WIN = 7;                 // rounds mode: first to 7 rounds
const ROUND_TIME = 90e3;                 // a round with no winner after 1:30 is a draw
const ROUND_FREEZE_MS = parseInt(process.env.ROUND_FREEZE_MS || "3000", 10);
const ROUND_END_MS = parseInt(process.env.ROUND_END_MS || "3500", 10);
const INTERMISSION_MS = parseInt(process.env.INTERMISSION_MS || "15000", 10);
const SERVER_NAME = process.env.SERVER_NAME || "Admin Server"; // what players see in the list (never the address)
const MAX_MII_BYTES = 6 * 1024 * 1024;
const MAX_ROOMS = 200;

// Damage rules (the same numbers as the game: CS:GO's AK, AWP, Deagle and knife)
const AK_ZONES = { head: 4, chest: 1, arm: 1, stomach: 1.25, leg: 0.75 };
const KNIFE_DAMAGE = [25, 40, 65, 90, 180];

/*
 * PROTOCOL
 * client -> server
 *   hello  { v, name, color, mii, skins }  mii = { kind: "glb", b64, fileName } or { kind: "demo", look }
 *   skins  { s: { ak, awp, deagle, knife } }   the weapon skins you have equipped (skin ids or null)
 *   list   {}                            ask for the room list
 *   create { name, password, max }       host a lobby (password optional; max players 2..MAX_PLAYERS)
 *   join   { room, password }            join a lobby by id (password if it has one)
 *   leave  {}
 *   vote   { mode, map }                 during the 15 s intermission: what to play next
 *   st     { s: [x, y, z, vx, vz, yaw, pitch, duck, flags] }   your movement, ~30 times a second
 *   shot   { w, o: [x,y,z], e: [x,y,z], n: [nx,ny,nz] | null, m }  w = "ak" | "awp" | "deagle"  a paintball you fired (for everyone's screens)
 *   ev     { k }                         a sound to play at your position (reload, deploy, land...)
 *   hit    { v, z, d, w, b }             you hit player v in zone z for d damage with weapon w (b = backstab)
 *   spawn  { x, z, yaw }                 you're back in after being splattered
 *   ping   { c }
 * server -> client
 *   welcome { id, v, maxPlayers, name, online }   rooms { rooms }   room { room }   mii { id, name, color, mii, skins }   skins { id, s }   bye { id }
 *   warmup {}                        nobody to play with yet: run around freely
 *   start { in, mode, map, toWin, timeLimit, late?, round? }   a match begins after `in` ms
 *   round { n, in, scores }  roundEnd { winner, scores }   (rounds mode)
 *   st { id, s }  shot { id, ... }  ev { id, k }
 *   dmg { v, by, d, z, hp, w }  kill { v, by, w, h, b, scores }  spawn { id, x, z, yaw }
 *   over { winner, scores, mode }  intermission { in, modes, maps }  votes { modes, maps }  voted { mode, map }
 *   pong { c, s }  err { msg }
 */

let nextId = 1;
const players = new Map(); // id -> player
const rooms = new Map();   // id -> room

// everyone in a room gets their own paint color
const PALETTE = ["#ff3fa4", "#3de0ff", "#ffb21e", "#78d220", "#9b5cff", "#ff3b30", "#ffe94d", "#2b7cff", "#00c896", "#ff8a00", "#e0e0e0", "#f55a7d", "#7328ad", "#00a0a0", "#c08040", "#a0ff40"];

const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}
function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const id of room.players) if (id !== except) { const p = players.get(id); if (p) send(p, s); }
}

const hashPass = (salt, pw) => crypto.createHash("sha256").update(salt + "\u0000" + pw).digest("hex");

function roomInfo(room) {
  return {
    id: room.id, name: room.name, host: room.host, state: room.state, toWin: TO_WIN, timeLimit: TIME_LIMIT, max: room.max, locked: !!room.pass,
    players: room.players.map((id) => {
      const p = players.get(id);
      return { id, name: p.name, color: p.color, score: p.score, deaths: p.deaths, alive: p.alive };
    }),
  };
}
function roomList() {
  return Array.from(rooms.values()).map((r) => {
    const host = players.get(r.host);
    return { id: r.id, name: r.name, host: host ? host.name : "", players: r.players.length, max: r.max, state: r.state, locked: !!r.pass };
  });
}
function sendRoomList(p) { send(p, { t: "rooms", rooms: roomList() }); }
function roomChanged(room) {
  broadcast(room, { t: "room", room: roomInfo(room) });
  // people in the menu see the room list change
  for (const p of players.values()) if (!p.room) sendRoomList(p);
}
function scores(room) {
  const s = {};
  for (const id of room.players) { const p = players.get(id); s[id] = p.score; }
  return s;
}

// ---------------------------------------------------------------------
// A lobby's life:  warmup (run around until a 2nd player joins) -> countdown
//   -> live (respawn: first to 20 | rounds: last one standing wins the round)
//   -> intermission (15 s: vote for the next mode/map) -> countdown -> ...
// ---------------------------------------------------------------------
const MODES = {
  respawn: { id: "respawn", name: "Respawn", desc: "Back in 2 s after being splattered. First to " + TO_WIN + " eliminations.", toWin: TO_WIN, timeLimit: TIME_LIMIT },
  rounds: { id: "rounds", name: "Rounds", desc: "No respawning: the last one standing wins the round. First to " + ROUNDS_TO_WIN + " rounds.", toWin: ROUNDS_TO_WIN, timeLimit: 0 },
};
const MAPS = { shipment: { id: "shipment", name: "Shipment" } };

function clearTimers(room) {
  clearTimeout(room.timer); clearTimeout(room.roundTimer);
  room.timer = room.roundTimer = null;
}

function toWarmup(room) {
  clearTimers(room);
  room.state = "warmup";
  room.votes = new Map();
  for (const id of room.players) { const p = players.get(id); p.score = 0; p.deaths = 0; }
  broadcast(room, { t: "warmup" });
  roomChanged(room);
}

// a 2nd player is here: get going
function maybeStart(room) {
  if (room.state === "warmup" && room.players.length >= 2) startMatch(room, room.mode);
}

function startMatch(room, mode) {
  clearTimers(room);
  const M = MODES[mode] || MODES.respawn;
  room.mode = M.id;
  room.state = "live";
  room.startedAt = Date.now() + COUNTDOWN_MS;
  room.round = 0;
  for (const id of room.players) {
    const p = players.get(id);
    p.score = 0; p.deaths = 0; p.hp = 100; p.alive = false; p.diedAt = 0; p.inRound = false;
    p.lastAk = 0; p.lastAwp = 0; p.lastDeagle = 0; p.lastKnife = 0;
  }
  broadcast(room, { t: "start", in: COUNTDOWN_MS, mode: M.id, map: room.map, toWin: M.toWin, timeLimit: M.timeLimit });
  if (M.id === "respawn") room.timer = setTimeout(() => endMatch(room), COUNTDOWN_MS + TIME_LIMIT);
  else startRound(room, COUNTDOWN_MS);
  roomChanged(room);
}

// ---- rounds mode ----
function startRound(room, freeze) {
  clearTimeout(room.roundTimer);
  room.round++;
  room.roundLiveAt = Date.now() + freeze;
  room.roundOver = false;
  for (const id of room.players) { const p = players.get(id); p.alive = false; p.hp = 100; p.inRound = true; p.diedAt = 0; }
  broadcast(room, { t: "round", n: room.round, in: freeze, scores: scores(room) });
  room.roundTimer = setTimeout(() => endRound(room, null), freeze + ROUND_TIME);
}
function endRound(room, winner) {
  if (room.state !== "live" || room.mode !== "rounds" || room.roundOver) return;
  room.roundOver = true;
  clearTimeout(room.roundTimer);
  if (winner) winner.score++;
  broadcast(room, { t: "roundEnd", winner: winner ? winner.id : null, scores: scores(room) });
  roomChanged(room);
  if (winner && winner.score >= ROUNDS_TO_WIN) { room.roundTimer = setTimeout(() => endMatch(room), ROUND_END_MS); return; }
  room.roundTimer = setTimeout(() => startRound(room, ROUND_FREEZE_MS), ROUND_END_MS);
}
function checkRound(room) {
  if (room.mode !== "rounds" || room.roundOver) return;
  const left = room.players.map((id) => players.get(id)).filter((p) => p.inRound && p.alive);
  const inRound = room.players.map((id) => players.get(id)).filter((p) => p.inRound);
  if (inRound.length >= 2 && left.length <= 1) endRound(room, left[0] || null);
}

// ---- the end, and voting for what's next ----
function endMatch(room) {
  if (room.state !== "live") return;
  clearTimers(room);
  let winner = null, best = -1;
  for (const id of room.players) { const p = players.get(id); if (p.score > best) { best = p.score; winner = id; } }
  broadcast(room, { t: "over", winner, scores: scores(room), mode: room.mode });
  if (room.players.length < 2) return toWarmup(room);
  room.state = "intermission";
  room.votes = new Map();
  room.voteEnds = Date.now() + INTERMISSION_MS;
  broadcast(room, {
    t: "intermission", in: INTERMISSION_MS,
    modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, desc: m.desc })),
    maps: Object.values(MAPS).map((m) => ({ id: m.id, name: m.name })),
  });
  room.timer = setTimeout(() => finishVote(room), INTERMISSION_MS);
  roomChanged(room);
}
function voteCounts(room) {
  const modes = {}, maps = {};
  for (const v of room.votes.values()) {
    if (v.mode) modes[v.mode] = (modes[v.mode] || 0) + 1;
    if (v.map) maps[v.map] = (maps[v.map] || 0) + 1;
  }
  return { modes, maps };
}
// most votes wins; a tie (or no votes) is picked at random among the leaders
function pickVote(counts, options) {
  let best = -1, top = [];
  for (const id of options) {
    const n = counts[id] || 0;
    if (n > best) { best = n; top = [id]; } else if (n === best) top.push(id);
  }
  return top[Math.floor(Math.random() * top.length)];
}
function finishVote(room) {
  if (room.state !== "intermission") return;
  const c = voteCounts(room);
  const mode = pickVote(c.modes, Object.keys(MODES));
  room.map = pickVote(c.maps, Object.keys(MAPS));
  broadcast(room, { t: "voted", mode, map: room.map, counts: c });
  if (room.players.length >= 2) startMatch(room, mode);
  else { room.mode = mode; toWarmup(room); }
}

function leaveRoom(p) {
  const room = p.room && rooms.get(p.room);
  p.room = null;
  clearTimeout(p.spawnTimer);
  if (!room) return;
  room.players = room.players.filter((id) => id !== p.id);
  if (room.votes) room.votes.delete(p.id);
  broadcast(room, { t: "bye", id: p.id });
  if (!room.players.length) { clearTimers(room); rooms.delete(room.id); }
  else {
    if (room.host === p.id) room.host = room.players[0];
    // only one player left: back to running around until someone else joins
    if (room.players.length < 2 && room.state !== "warmup") { toWarmup(room); return; }
    if (room.state === "live" && room.mode === "rounds") checkRound(room);
  }
  roomChanged(room);
}

function joinRoom(p, room) {
  if (room.players.length >= room.max) return send(p, { t: "err", msg: "That lobby is full." });
  leaveRoom(p);
  // a color nobody else in the room has
  const used = new Set(room.players.map((id) => players.get(id).color.toLowerCase()));
  if (used.has(p.color.toLowerCase())) p.color = PALETTE.find((c) => !used.has(c)) || p.color;
  p.room = room.id;
  p.score = 0; p.deaths = 0; p.hp = 100;
  p.alive = false; p.diedAt = 0; p.inRound = false; // joins as "waiting to spawn"
  room.players.push(p.id);
  // tell everyone what the new player's Mii looks like, and the new player about everyone else
  const meMii = JSON.stringify({ t: "mii", id: p.id, name: p.name, color: p.color, mii: p.mii, skins: p.skins });
  for (const id of room.players) {
    if (id === p.id) continue;
    const o = players.get(id);
    send(o, meMii);
    send(p, { t: "mii", id: o.id, name: o.name, color: o.color, mii: o.mii, skins: o.skins });
  }
  roomChanged(room);
  // what's going on in here right now
  const now = Date.now();
  const M = MODES[room.mode] || MODES.respawn;
  if (room.state === "warmup") send(p, { t: "warmup" });
  else if (room.state === "live") {
    send(p, { t: "start", in: Math.max(0, room.startedAt - now), mode: room.mode, map: room.map, toWin: M.toWin, timeLimit: M.timeLimit ? M.timeLimit - Math.max(0, now - room.startedAt) : 0, late: true, round: room.round });
  } else if (room.state === "intermission") {
    send(p, { t: "over", winner: null, scores: scores(room), mode: room.mode, late: true });
    send(p, { t: "intermission", in: Math.max(0, room.voteEnds - now), modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, desc: m.desc })), maps: Object.values(MAPS).map((m) => ({ id: m.id, name: m.name })) });
    send(p, Object.assign({ t: "votes" }, voteCounts(room)));
  }
  // who's already running around (they spawned before you got here)
  for (const id of room.players) {
    const o = players.get(id);
    if (o !== p && o.alive && o.pos) send(p, { t: "spawn", id: o.id, x: o.pos[0], z: o.pos[2], yaw: o.yaw || 0 });
  }
  maybeStart(room);
}

function doSpawn(p, sp) {
  const room = p.room && rooms.get(p.room);
  if (!room || p.alive) return;
  if (room.state !== "live" && room.state !== "warmup") return;
  p.alive = true; p.hp = 100;
  p.pos = [sp.x, 0, sp.z];
  p.yaw = sp.yaw;
  broadcast(room, { t: "spawn", id: p.id, x: sp.x, z: sp.z, yaw: sp.yaw });
}

// Equipped weapon skins: just short ids (or none)
function cleanSkins(s) {
  const out = { ak: null, awp: null, deagle: null, knife: null };
  if (s && typeof s === "object") for (const k of Object.keys(out)) if (typeof s[k] === "string" && /^[a-z0-9_]{1,32}$/.test(s[k])) out[k] = s[k];
  return out;
}

// Is this hit believable? (stops someone with a modified game from cheating)
function validHit(p, v, msg, now) {
  const d = num(msg.d);
  if (msg.w === "ak" || msg.w === "awp" || msg.w === "deagle") {
    const awp = msg.w === "awp", dg = msg.w === "deagle";
    const mult = AK_ZONES[msg.z];
    if (!mult) return false;
    const base = awp ? 115 : dg ? 63 : 36;
    // (the Deagle loses a lot of damage over distance: 0.81 per 500 units)
    const max = Math.round(base * mult), min = Math.floor(base * mult * (dg ? 0.5 : 0.8));
    if (d < min || d > max) return false;
    if (awp) {
      if (now - p.lastAwp < 1300) return false; // the bolt takes ~1.5 s
      p.lastAwp = now;
    } else if (dg) {
      if (now - p.lastDeagle < 190) return false; // 0.225 s between shots
      p.lastDeagle = now;
    } else {
      if (now - p.lastAk < 85) return false; // faster than 600 shots a minute
      p.lastAk = now;
    }
  } else if (msg.w === "knife") {
    if (!KNIFE_DAMAGE.includes(d)) return false;
    if (now - p.lastKnife < 350) return false;
    // you have to be close to someone to knife them
    if (p.pos && v.pos && Math.hypot(p.pos[0] - v.pos[0], p.pos[2] - v.pos[2]) > 4.5) return false;
    p.lastKnife = now;
  } else return false;
  return true;
}

// online chess lives in its own file (it shares the players and the connection)
const chess = require("./chess-rooms.js")({ players, send, clean, num, log: (s) => log(s) });
// so do accounts and cloud saves
const accounts = require("./accounts.js")({ send, clean, log: (s) => log(s) });

function onMessage(p, msg) {
  if (chess.handle(p, msg)) return;
  if (accounts.handle(p, msg)) return;
  const now = Date.now();
  const room = p.room ? rooms.get(p.room) : null;
  switch (msg.t) {
    case "hello": {
      if (msg.v !== VERSION) return send(p, { t: "err", msg: "Your Mii Hub and this server are different versions. Update Mii Hub and try again." });
      p.name = clean(msg.name, 20) || "Mii";
      p.color = isColor(msg.color) ? msg.color.toLowerCase() : "#ff3fa4";
      p.skins = cleanSkins(msg.skins);
      const mii = msg.mii || {};
      if (mii.kind === "glb" && typeof mii.b64 === "string" && mii.b64.length * 0.75 <= MAX_MII_BYTES) {
        p.mii = { kind: "glb", b64: mii.b64, fileName: clean(mii.fileName, 80) || "mii.glb" };
      } else {
        p.mii = { kind: "demo", look: mii.look && typeof mii.look === "object" ? mii.look : {} };
      }
      p.ready = true;
      send(p, { t: "welcome", id: p.id, v: VERSION, maxPlayers: MAX_PLAYERS, name: SERVER_NAME, online: players.size });
      sendRoomList(p);
      break;
    }
    case "list": sendRoomList(p); break;
    case "create": {
      if (!p.ready) return;
      if (rooms.size >= MAX_ROOMS) return send(p, { t: "err", msg: "There are too many lobbies right now. Try joining one!" });
      const id = "r" + (nextId++);
      const pw = clean(msg.password, 32);
      const salt = crypto.randomBytes(8).toString("hex");
      const max = Math.max(2, Math.min(MAX_PLAYERS, Math.round(num(msg.max)) || MAX_PLAYERS));
      const r = {
        id, name: clean(msg.name, 32) || p.name + "'s lobby", host: p.id, players: [], state: "warmup", timer: null, roundTimer: null, startedAt: 0,
        max, salt, pass: pw ? hashPass(salt, pw) : null, mode: "respawn", map: "shipment", votes: new Map(), round: 0,
      };
      rooms.set(id, r);
      joinRoom(p, r);
      break;
    }
    case "join": {
      if (!p.ready) return;
      const r = rooms.get(msg.room);
      if (!r) return send(p, { t: "err", msg: "That lobby doesn't exist any more." });
      if (r.pass) {
        // a few tries a minute, so nobody can guess passwords by trying thousands
        p.tries = (p.tries || []).filter((t) => now - t < 60e3);
        if (p.tries.length >= 6) return send(p, { t: "err", code: "slow", msg: "Too many wrong passwords. Wait a minute and try again." });
        if (hashPass(r.salt, clean(msg.password, 32)) !== r.pass) {
          p.tries.push(now);
          return send(p, { t: "err", code: "password", room: r.id, msg: msg.password ? "Wrong password." : "This lobby has a password." });
        }
      }
      joinRoom(p, r);
      break;
    }
    case "leave": leaveRoom(p); break;
    case "vote": {
      if (!room || room.state !== "intermission") return;
      const v = room.votes.get(p.id) || {};
      if (MODES[msg.mode]) v.mode = msg.mode;
      if (MAPS[msg.map]) v.map = msg.map;
      room.votes.set(p.id, v);
      broadcast(room, Object.assign({ t: "votes" }, voteCounts(room)));
      break;
    }
    case "st": {
      if (!room || !Array.isArray(msg.s) || msg.s.length !== 9) return;
      if (now - p.lastSt < 12) return; // more than ~80 a second: ignore
      p.lastSt = now;
      const s = msg.s.map(num);
      p.pos = [s[0], s[1], s[2]];
      p.yaw = s[5];
      broadcast(room, { t: "st", id: p.id, s }, p.id);
      break;
    }
    case "shot": {
      if (!room || (room.state !== "live" && room.state !== "warmup") || !p.alive) return;
      if (!Array.isArray(msg.o) || !Array.isArray(msg.e)) return;
      broadcast(room, { t: "shot", id: p.id, o: msg.o.slice(0, 3).map(num), e: msg.e.slice(0, 3).map(num), n: Array.isArray(msg.n) ? msg.n.slice(0, 3).map(num) : null, m: clean(msg.m, 10), w: msg.w === "awp" || msg.w === "deagle" ? msg.w : "ak" }, p.id);
      break;
    }
    case "skins": {
      p.skins = cleanSkins(msg.s);
      if (room) broadcast(room, { t: "skins", id: p.id, s: p.skins }, p.id);
      break;
    }
    case "ev": {
      if (!room) return;
      broadcast(room, { t: "ev", id: p.id, k: clean(msg.k, 16) }, p.id);
      break;
    }
    case "hit": {
      if (!room || room.state !== "live" || !p.alive || now < room.startedAt) return;
      if (room.mode === "rounds" && (now < room.roundLiveAt || room.roundOver)) return;
      const v = players.get(msg.v);
      if (!v || v.room !== room.id || v === p || !v.alive) return;
      if (!validHit(p, v, msg, now)) return;
      const d = num(msg.d);
      v.hp = Math.max(0, v.hp - d);
      broadcast(room, { t: "dmg", v: v.id, by: p.id, d, z: msg.z, hp: v.hp, w: msg.w });
      if (v.hp <= 0) {
        v.alive = false; v.diedAt = now; v.deaths++;
        if (room.mode === "respawn") p.score++;
        broadcast(room, { t: "kill", v: v.id, by: p.id, w: msg.w, h: msg.z === "head" ? 1 : 0, b: msg.b ? 1 : 0, scores: scores(room) });
        roomChanged(room);
        if (room.mode === "respawn" && p.score >= TO_WIN) endMatch(room);
        else checkRound(room);
      }
      break;
    }
    case "spawn": {
      if (!room || p.alive) return;
      const sp = { x: num(msg.x), z: num(msg.z), yaw: num(msg.yaw) };
      clearTimeout(p.spawnTimer);
      if (room.state === "warmup") return doSpawn(p, sp); // running around freely
      if (room.state !== "live") return;
      if (room.mode === "rounds") {
        // you come in at the start of a round (people who joined mid-round watch until the next)
        if (p.inRound && !room.roundOver && !p.diedAt && now < room.roundLiveAt + 3000) doSpawn(p, sp);
        return;
      }
      // a bit early (lag)? let them in as soon as it's allowed
      const wait = Math.max(p.diedAt ? p.diedAt + RESPAWN_MS * 0.85 - now : 0, room.startedAt - 250 - now);
      if (wait > 0) p.spawnTimer = setTimeout(() => doSpawn(p, sp), wait);
      else doSpawn(p, sp);
      break;
    }
    case "ping": send(p, { t: "pong", c: num(msg.c), s: now }); break;
  }
}

// ---------------------------------------------------------------------
// The server itself
// ---------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // open http://<this computer>:8787 in a browser to check it's running
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(SERVER_NAME + " (Mii Hub Paintball) is running.\n" + players.size + " player(s) online, " + rooms.size + " room(s).\n");
});
const wss = new WebSocketServer({ server, maxPayload: MAX_MII_BYTES * 1.4 + 4096 });

wss.on("connection", (ws, req) => {
  const p = { id: "p" + (nextId++), ws, name: "Mii", color: "#ff3fa4", mii: null, skins: { ak: null, awp: null, deagle: null, knife: null }, room: null, ready: false, alive: false, hp: 100, score: 0, deaths: 0, lastSt: 0, lastAk: 0, lastKnife: 0, pos: null, isAlive: true, ip: req.socket.remoteAddress || "?" };
  players.set(p.id, p);
  log("+ " + p.id + " connected from " + (req.socket.remoteAddress || "?") + " (" + players.size + " online)");
  ws.on("pong", () => { p.isAlive = true; });
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== "string") return;
    try { onMessage(p, msg); } catch (e) { log("error handling " + msg.t + ": " + e.message); }
  });
  ws.on("close", () => {
    leaveRoom(p);
    chess.leave(p);
    accounts.leave(p);
    players.delete(p.id);
    log("- " + p.id + " (" + p.name + ") left (" + players.size + " online)");
  });
  ws.on("error", () => { /* closed below */ });
});

// drop connections that went quiet (laptop closed, wifi gone...)
const beat = setInterval(() => {
  for (const p of players.values()) {
    if (!p.isAlive) { p.ws.terminate(); continue; }
    p.isAlive = false;
    try { p.ws.ping(); } catch (e) { /* ignore */ }
  }
}, 15000);
if (beat.unref) beat.unref();
wss.on("close", () => clearInterval(beat));

function log(s) { console.log(new Date().toISOString().slice(11, 19) + "  " + s); }

// Start listening (tries the next ports if this one is taken). Resolves with the port.
function start(port) {
  port = port || PORT;
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = (p) => {
      const onErr = (err) => {
        server.removeListener("listening", onOk);
        if (err.code === "EADDRINUSE" && tries++ < 10) attempt(p + 1);
        else reject(err);
      };
      const onOk = () => { server.removeListener("error", onErr); resolve(server.address().port); };
      server.once("error", onErr);
      server.once("listening", onOk);
      server.listen(p, HOST);
    };
    attempt(port);
  });
}

// Stop: everyone is disconnected and all rooms are closed.
function stop() {
  return new Promise((resolve) => {
    for (const p of players.values()) { try { p.ws.close(1001, "The host stopped the game"); } catch (e) { /* ignore */ } }
    for (const r of rooms.values()) clearTimeout(r.timer);
    rooms.clear();
    setTimeout(() => {
      for (const p of players.values()) { try { p.ws.terminate(); } catch (e) { /* ignore */ } }
      players.clear();
      if (server.listening) server.close(() => resolve()); else resolve();
    }, 100);
  });
}
const running = () => server.listening;

if (require.main === module) {
  start(PORT).then((port) => {
    log("Mii Hub Paintball server listening on port " + port + " (max " + MAX_PLAYERS + " players a room)");
    log("Check it: open http://localhost:" + port + " in a browser on this computer.");
  }).catch((err) => { log("Couldn't start: " + err.message); process.exit(1); });
}

module.exports = { server, wss, VERSION, PORT, rooms, players, chess, accounts, start, stop, running };
