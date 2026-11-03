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
 *   - and Ranked: a matchmaking queue, ranks and MMR per account (see ranked.js; saved in DATA_DIR/ranked.json)
 *
 * Every message is a small JSON object with a type "t" (see PROTOCOL below).
 */
"use strict";

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const VERSION = 7; // (2: lobbies with warmup, modes and voting; 3: AWP loadout; 4: weapon skins; 5: online chess; 6: more maps; 7: Ranked)
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

// Ranked (see ranked.js): free-for-all Respawn, matched by MMR
const envInt = (k, d) => { const v = parseInt(process.env[k] || "", 10); return isFinite(v) ? v : d; };
const RANKED_SIZE = Math.max(2, Math.min(8, envInt("RANKED_SIZE", 4)));   // players in a ranked match (at most)
const RANKED_TO_WIN = Math.max(1, envInt("RANKED_TO_WIN", 15));          // first to 15 eliminations
const RANKED_TIME = 8 * 60e3;                                             // or the most after 8 minutes
const RANKED_COUNTDOWN_MS = envInt("RANKED_COUNTDOWN_MS", 8000);          // time to load the map
const RANKED_FILL_MS = envInt("RANKED_FILL_MS", 20000);                   // start with fewer players after waiting this long
const RECONNECT_MS = envInt("RECONNECT_MS", 30000);                      // a dropped player can come back this long
const RANKED_TICK_MS = Math.max(20, envInt("RANKED_TICK_MS", 1000));      // how often the matchmaker looks
const DODGE_MS = 2 * 60e3;                                                // leaving before a match starts: wait to search again

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
 *   vote   { mode, map }                 during the 15 s intermission: what to play next (map: one of the two shown, or "random")
 *   st     { s: [x, y, z, vx, vz, yaw, pitch, duck, flags] }   your movement, ~30 times a second
 *   shot   { w, o: [x,y,z], e: [x,y,z], n: [nx,ny,nz] | null, m }  w = "ak" | "awp" | "deagle"  a paintball you fired (for everyone's screens)
 *   ev     { k }                         a sound to play at your position (reload, deploy, land...)
 *   hit    { v, z, d, w, b }             you hit player v in zone z for d damage with weapon w (b = backstab)
 *   spawn  { x, z, yaw }                 you're back in after being splattered
 *   ping   { c }
 *   rkInfo   {}                         your rank (you sign in on this connection first: acToken, see accounts.js)
 *   rkQueue  {}                         search for a ranked match (or rejoin the one you dropped out of)
 *   rkCancel {}                         stop searching
 *   rkRejoin {}                         back into the ranked match you got disconnected from
 *   rkTop    {}                         the Ranked leaderboard
 * server -> client
 *   welcome { id, v, maxPlayers, name, online }   rooms { rooms }   room { room }   mii { id, name, color, mii, skins }   skins { id, s }   bye { id }
 *   warmup { map }                   nobody to play with yet: run around freely (on this map)
 *   start { in, mode, map, toWin, timeLimit, late?, round? }   a match begins after `in` ms
 *   round { n, in, scores }  roundEnd { winner, scores }   (rounds mode)
 *   st { id, s }  shot { id, ... }  ev { id, k }
 *   dmg { v, by, d, z, hp, w }  kill { v, by, w, h, b, scores }  spawn { id, x, z, yaw }
 *   over { winner, scores, mode }  intermission { in, modes, maps }  votes { modes, maps }  voted { mode, map, name, random }
 *   (intermission maps: two maps + { id: "random" }; "random" ends up as a map that wasn't one of the two)
 *   pong { c, s }  err { msg }
 *   rkMe { signedIn, info, queued, active, rules }   info = { user, rank, mmr (null in placements), games, wins, placements, progress, pos, shield }
 *   rkQueued { n, size }  rkSearch { wait, range, n }  rkCancelled {}  rkErr { code, msg }
 *   rkFound { map, players }   then the usual room / mii / start (room.ranked: true, players have a rank)
 *   rkAway { name, in }  rkBack { name }  rkGone { name }   someone dropped out / came back / is out for good
 *   rkResult { place, of, delta, before, after, placement, justPlaced, promoted, demoted, protected, leaver }
 *   rkCancel { msg }   the match was called off before it started (nobody's MMR changed)
 *   rkTop { list: [{ pos, user, mmr, rank, games, wins, you }], you }
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
    id: room.id, name: room.name, host: room.host, state: room.state, map: room.map, toWin: modeOf(room).toWin, timeLimit: modeOf(room).timeLimit, max: room.max, locked: !!room.pass,
    ranked: !!room.ranked,
    players: room.players.map((id) => {
      const p = players.get(id);
      const e = room.ranked && room.ranked.entrants.get(p.rkKey);
      return Object.assign({ id, name: p.name, color: p.color, score: p.score, deaths: p.deaths, alive: p.alive }, e ? { rank: e.rank, user: e.user } : {});
    }),
  };
}
function roomList() {
  return Array.from(rooms.values()).filter((r) => !r.ranked).map((r) => {
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
// The maps (the same ids as js/paintball/pb-layouts.js; the server doesn't need
// their shapes: it only decides which one is played)
const MAP_LIST = [
  ["shipment_park", "Shipment Park"], ["shipment_cafe", "Shipment Café"], ["shipment_beach", "Shipment Beach"],
  ["shipment_moon", "Shipment Moon"], ["shipment_office", "Shipment Office"],
  ["picnic", "Picnic Park"], ["market", "Market Square"], ["boardwalk", "Boardwalk"], ["moonbase", "Moon Base"], ["openoffice", "Open Office"],
];
const MAPS = {};
for (const [id, name] of MAP_LIST) MAPS[id] = { id, name };
const RANKED_MODE = { id: "respawn", name: "Ranked", toWin: RANKED_TO_WIN, timeLimit: RANKED_TIME };
const modeOf = (room) => (room.ranked ? RANKED_MODE : MODES[room.mode] || MODES.respawn);
const RANDOM = { id: "random", name: "Random", desc: "Any other map, picked by chance." };
const anyOf = (list) => list[Math.floor(Math.random() * list.length)];
// two different maps to vote on (not the one just played)
function voteMaps(current) {
  const a = anyOf(Object.keys(MAPS).filter((id) => id !== current));
  const b = anyOf(Object.keys(MAPS).filter((id) => id !== current && id !== a));
  return [a, b];
}
// "Random": any map that isn't one of the two shown
const randomOther = (shown) => anyOf(Object.keys(MAPS).filter((id) => !shown.includes(id)));
const mapOptions = (room) => room.voteMaps.map((id) => MAPS[id]).concat([RANDOM]);

function clearTimers(room) {
  clearTimeout(room.timer); clearTimeout(room.roundTimer);
  room.timer = room.roundTimer = null;
}

function toWarmup(room) {
  clearTimers(room);
  room.state = "warmup";
  room.votes = new Map();
  for (const id of room.players) { const p = players.get(id); p.score = 0; p.deaths = 0; }
  broadcast(room, { t: "warmup", map: room.map });
  roomChanged(room);
}

// a 2nd player is here: get going
function maybeStart(room) {
  if (room.state === "warmup" && room.players.length >= 2) startMatch(room, room.mode);
}

function startMatch(room, mode, countdown) {
  clearTimers(room);
  const cd = countdown == null ? COUNTDOWN_MS : countdown;
  room.mode = (MODES[mode] || MODES.respawn).id;
  const M = modeOf(room);
  room.state = "live";
  room.startedAt = Date.now() + cd;
  room.round = 0;
  for (const id of room.players) {
    const p = players.get(id);
    p.score = 0; p.deaths = 0; p.hp = 100; p.alive = false; p.diedAt = 0; p.inRound = false;
    p.lastAk = 0; p.lastAwp = 0; p.lastDeagle = 0; p.lastKnife = 0;
  }
  broadcast(room, { t: "start", in: cd, mode: M.id, map: room.map, toWin: M.toWin, timeLimit: M.timeLimit, ranked: !!room.ranked });
  if (M.id === "respawn") room.timer = setTimeout(() => endMatch(room), cd + M.timeLimit);
  else startRound(room, cd);
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
  if (room.ranked) return rankedEnd(room);
  let winner = null, best = -1;
  for (const id of room.players) { const p = players.get(id); if (p.score > best) { best = p.score; winner = id; } }
  broadcast(room, { t: "over", winner, scores: scores(room), mode: room.mode });
  if (room.players.length < 2) return toWarmup(room);
  room.state = "intermission";
  room.votes = new Map();
  room.voteEnds = Date.now() + INTERMISSION_MS;
  room.voteMaps = voteMaps(room.map);
  broadcast(room, {
    t: "intermission", in: INTERMISSION_MS,
    modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, desc: m.desc })),
    maps: mapOptions(room),
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
  const shown = room.voteMaps || voteMaps(room.map);
  const pick = pickVote(c.maps, shown.concat(["random"]));
  room.map = pick === "random" ? randomOther(shown) : pick;
  broadcast(room, { t: "voted", mode, map: room.map, name: MAPS[room.map].name, random: pick === "random", counts: c });
  if (room.players.length >= 2) startMatch(room, mode);
  else { room.mode = mode; toWarmup(room); }
}

// why: "disconnect" when the connection dropped (ranked gives you a little while to come back)
function leaveRoom(p, why) {
  const room = p.room && rooms.get(p.room);
  p.room = null;
  clearTimeout(p.spawnTimer);
  if (!room) return;
  room.players = room.players.filter((id) => id !== p.id);
  if (room.votes) room.votes.delete(p.id);
  broadcast(room, { t: "bye", id: p.id });
  if (room.ranked) return rankedLeft(room, p, why);
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
  const M = modeOf(room);
  if (room.state === "warmup") send(p, { t: "warmup", map: room.map });
  else if (room.state === "live") {
    send(p, { t: "start", in: Math.max(0, room.startedAt - now), mode: room.mode, map: room.map, toWin: M.toWin, timeLimit: M.timeLimit ? M.timeLimit - Math.max(0, now - room.startedAt) : 0, late: true, round: room.round, ranked: !!room.ranked });
  } else if (room.state === "intermission") {
    send(p, { t: "over", winner: null, scores: scores(room), mode: room.mode, late: true });
    send(p, { t: "intermission", in: Math.max(0, room.voteEnds - now), modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, desc: m.desc })), maps: mapOptions(room) });
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

// ---------------------------------------------------------------------
// Ranked: the queue, ranked matches, results (the math and saving are in ranked.js)
// ---------------------------------------------------------------------
const R = require("./ranked.js");
const store = R.createStore({ dataDir: accounts.DATA_DIR, log: (s) => log(s) });
const queue = new Map();        // account -> { key, user, p, mmr, at }   (searching)
const activeRanked = new Map(); // account -> ranked room id (a match you're in, or dropped out of)
const dodged = new Map();       // account -> when they can search again
const rkHits = new Map();       // account -> [times they started searching]
const rankedRules = () => ({ size: RANKED_SIZE, toWin: RANKED_TO_WIN, timeLimit: RANKED_TIME, placements: R.PLACEMENTS, reconnect: RECONNECT_MS });
const rkErr = (p, code, msg) => send(p, { t: "rkErr", code, msg });

function rankedMe(p) {
  const key = p.acUser;
  const q = key && queue.get(key);
  const id = key && activeRanked.get(key);
  const room = id && rooms.get(id);
  const e = room && room.ranked.entrants.get(key);
  send(p, {
    t: "rkMe", signedIn: !!key, off: store.off, info: key ? store.info(key, p.acName) : null,
    queued: q && q.p === p ? { wait: Date.now() - q.at } : null,
    active: !!(e && e.away && !e.gone), rules: rankedRules(),
  });
}

function rankedQueue(p) {
  if (!p.ready) return;
  if (store.off) return rkErr(p, "off", "Ranked isn't available on this server right now.");
  const key = p.acUser;
  if (!key) return rkErr(p, "signin", "Ranked needs a Mii Hub account. Sign in first!");
  const now = Date.now();
  // a few searches a minute is plenty (per connection and per account)
  p.rkTries = (p.rkTries || []).filter((t) => now - t < 60e3);
  const acct = (rkHits.get(key) || []).filter((t) => now - t < 60e3);
  rkHits.set(key, acct);
  if (p.rkTries.length >= 8 || acct.length >= 12) return rkErr(p, "slow", "Slow down a little: try again in a minute.");
  p.rkTries.push(now); acct.push(now);
  if (activeRanked.has(key) && rankedRejoin(p, true)) return;
  const q = queue.get(key);
  if (q) return rkErr(p, "already", q.p === p ? "You're already searching." : "You're already searching on another device.");
  if (p.room) return rkErr(p, "inroom", "Leave your lobby first.");
  const until = dodged.get(key) || 0;
  if (until > now) {
    const s = Math.ceil((until - now) / 1000);
    return rkErr(p, "cooldown", "You left a ranked match before it started. You can search again in " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + ".");
  }
  const rec = store.get(key);
  queue.set(key, { key, user: p.acName || key, p, mmr: rec ? rec.mmr : R.START_MMR, at: now });
  send(p, { t: "rkQueued", n: queue.size, size: RANKED_SIZE });
}
function rankedUnqueue(p, tell) {
  let was = false;
  for (const [k, q] of queue) if (q.p === p) { queue.delete(k); was = true; }
  if (tell && was) send(p, { t: "rkCancelled" });
}

// the matchmaker: every second, make matches from who's searching
function rankedTick() {
  const now = Date.now();
  for (const [k, q] of queue) if (q.p.acUser !== k || !players.has(q.p.id) || q.p.room) queue.delete(k);
  const groups = R.formMatches(Array.from(queue.values()), now, { size: RANKED_SIZE, fillMs: RANKED_FILL_MS });
  for (const g of groups) {
    if (rooms.size >= MAX_ROOMS) break; // (they keep searching)
    for (const q of g) queue.delete(q.key);
    startRanked(g);
  }
  for (const q of queue.values()) {
    const range = R.searchRange(now - q.at);
    send(q.p, { t: "rkSearch", wait: now - q.at, range: isFinite(range) ? range : null, n: queue.size });
  }
}
const rkTimer = setInterval(rankedTick, RANKED_TICK_MS);
if (rkTimer.unref) rkTimer.unref();

function startRanked(group) {
  const id = "k" + (nextId++);
  const map = anyOf(Object.keys(MAPS));
  const room = {
    id, name: "Ranked · " + MAPS[map].name, host: group[0].p.id, players: [], state: "starting", timer: null, roundTimer: null, startedAt: 0,
    max: group.length, salt: "", pass: null, mode: "respawn", map, votes: new Map(), voteMaps: null, round: 0,
    ranked: { entrants: new Map(), done: false },
  };
  rooms.set(id, room);
  const preds = store.predators();
  for (const q of group) {
    room.ranked.entrants.set(q.key, { key: q.key, user: q.user, name: q.p.name, pid: q.p.id, score: 0, deaths: 0, away: false, gone: false, leftAt: 0, timer: null, rank: store.rankOf(q.key, preds), queuedAt: q.at });
    activeRanked.set(q.key, id);
  }
  const who = group.map((q) => ({ name: q.p.name, user: q.user, rank: room.ranked.entrants.get(q.key).rank }));
  for (const q of group) send(q.p, { t: "rkFound", map, name: MAPS[map].name, players: who });
  for (const q of group) { q.p.rkKey = q.key; joinRoom(q.p, room); }
  startMatch(room, "respawn", RANKED_COUNTDOWN_MS);
  log("🏆 ranked match " + id + " on " + map + ": " + group.map((q) => q.key + " (" + q.mmr + ")").join(", "));
}

// someone left a ranked match: a dropped connection gets RECONNECT_MS to come back, leaving on purpose is final
function rankedLeft(room, p, why) {
  const Rk = room.ranked;
  const e = Rk.entrants.get(p.rkKey);
  p.rkKey = null;
  if (Rk.done || !e) { if (!room.players.length && Rk.done) rooms.delete(room.id); return; }
  e.score = p.score; e.deaths = p.deaths; e.pid = null; e.leftAt = Date.now();
  if (why === "disconnect" && RECONNECT_MS > 0) {
    e.away = true;
    broadcast(room, { t: "rkAway", name: e.name, in: RECONNECT_MS });
    e.timer = setTimeout(() => { e.away = false; rankedGone(room, e); }, RECONNECT_MS);
  } else rankedGone(room, e);
  if (!Rk.done) roomChanged(room);
}
function rankedGone(room, e) {
  if (room.ranked.done || e.gone) return;
  e.gone = true;
  activeRanked.delete(e.key);
  broadcast(room, { t: "rkGone", name: e.name });
  checkRanked(room);
}
function checkRanked(room) {
  const Rk = room.ranked;
  if (Rk.done) return;
  const list = Array.from(Rk.entrants.values());
  // someone left before it even started: called off, nobody's MMR changes
  const early = list.find((e) => e.gone && e.leftAt < room.startedAt);
  if (early) {
    dodged.set(early.key, Date.now() + DODGE_MS);
    return rankedCancel(room, early.name + " left before the match started, so it was called off. Nobody's MMR changed.");
  }
  // one player (or nobody) still in: it's over
  if (list.filter((e) => !e.gone).length <= 1) endMatch(room);
}
function closeRanked(room) {
  room.ranked.done = true;
  clearTimers(room);
  for (const e of room.ranked.entrants.values()) { clearTimeout(e.timer); activeRanked.delete(e.key); }
  for (const id of room.players) { const p = players.get(id); if (p) { p.room = null; p.rkKey = null; clearTimeout(p.spawnTimer); } }
  room.players = [];
  rooms.delete(room.id);
}
function rankedCancel(room, msg) {
  const back = room.players.map((id) => players.get(id)).filter(Boolean);
  broadcast(room, { t: "rkCancel", msg });
  const at = new Map(Array.from(room.ranked.entrants.values()).map((e) => [e.key, e.queuedAt]));
  closeRanked(room);
  // everyone else goes straight back to searching (keeping their place in the queue)
  for (const p of back) {
    if (!p.acUser || queue.has(p.acUser)) continue;
    const rec = store.get(p.acUser);
    queue.set(p.acUser, { key: p.acUser, user: p.acName || p.acUser, p, mmr: rec ? rec.mmr : R.START_MMR, at: at.get(p.acUser) || Date.now() });
    send(p, { t: "rkQueued", n: queue.size, size: RANKED_SIZE, requeued: true });
  }
  log("🏆 ranked match " + room.id + " called off");
}

// the end: placements from the server's own score (most eliminations, then fewest deaths); leavers last
function rankedEnd(room) {
  const Rk = room.ranked;
  for (const id of room.players) { const p = players.get(id); const e = p && Rk.entrants.get(p.rkKey); if (e) { e.score = p.score; e.deaths = p.deaths; } }
  const list = Array.from(Rk.entrants.values());
  for (const e of list) if (e.away) { e.away = false; e.gone = true; } // still disconnected at the end: left
  const stayed = list.filter((e) => !e.gone);
  const better = (a, b) => b.score > a.score || (b.score === a.score && b.deaths < a.deaths); // is b ahead of a?
  const results = list.map((e) => ({
    key: e.key, user: e.user, leaver: e.gone,
    place: e.gone ? stayed.length + 1 : 1 + stayed.filter((o) => better(e, o)).length,
  }));
  const res = list.length >= 2 ? store.applyMatch(results) : {};
  // the winner: the one player in 1st place (a shared 1st place has no single winner)
  const firsts = results.filter((r) => r.place === 1 && !r.leaver);
  const win = firsts.length === 1 ? Rk.entrants.get(firsts[0].key) : null;
  broadcast(room, { t: "over", winner: win && win.pid ? win.pid : null, scores: scores(room), mode: "respawn", ranked: true });
  for (const e of list) {
    const r = res[e.key];
    if (!r) continue;
    // (leavers get theirs too, if they're still online somewhere)
    const p = e.pid ? players.get(e.pid) : Array.from(players.values()).find((x) => x.acUser === e.key && !x.room);
    if (p) send(p, Object.assign({ t: "rkResult" }, r));
  }
  log("🏆 ranked match " + room.id + " over: " + results.map((r) => r.key + " #" + r.place + (r.leaver ? " (left)" : "") + (res[r.key] && res[r.key].delta != null ? " " + (res[r.key].delta >= 0 ? "+" : "") + res[r.key].delta : "")).join(", "));
  const online = room.players.map((id) => players.get(id)).filter(Boolean);
  closeRanked(room);
  for (const p of online) rankedMe(p);
}

// back into the ranked match you dropped out of
function rankedRejoin(p, quiet) {
  const key = p.acUser;
  const room = key && rooms.get(activeRanked.get(key));
  const e = room && !room.ranked.done && room.ranked.entrants.get(key);
  if (!e || e.gone) { if (key) activeRanked.delete(key); if (!quiet) rkErr(p, "nomatch", "That match is over."); return false; }
  if (!e.away) { rkErr(p, "elsewhere", "You're already playing this match on another device."); return true; }
  clearTimeout(e.timer);
  e.away = false; e.pid = p.id; e.name = p.name;
  rankedUnqueue(p);
  if (p.room) leaveRoom(p);
  p.rkKey = key;
  joinRoom(p, room);
  p.score = e.score; p.deaths = e.deaths;
  broadcast(room, { t: "rkBack", name: p.name }, p.id);
  roomChanged(room);
  return true;
}

function rankedTop(p) {
  const now = Date.now();
  if (now - (p.lastTop || 0) < 800) return; // (one a second is plenty)
  p.lastTop = now;
  const list = store.top(50).map((r) => ({ pos: r.pos, user: r.user, mmr: r.mmr, rank: r.rank, games: r.games, wins: r.wins, you: r.key === p.acUser }));
  send(p, { t: "rkTop", list, you: p.acUser ? store.info(p.acUser, p.acName) : null });
}

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
    case "rkInfo": rankedMe(p); break;
    case "rkQueue": rankedQueue(p); break;
    case "rkCancel": rankedUnqueue(p, true); break;
    case "rkRejoin": if (p.ready) rankedRejoin(p); break;
    case "rkTop": rankedTop(p); break;
    case "create": {
      if (!p.ready) return;
      rankedUnqueue(p, true);
      if (rooms.size >= MAX_ROOMS) return send(p, { t: "err", msg: "There are too many lobbies right now. Try joining one!" });
      const id = "r" + (nextId++);
      const pw = clean(msg.password, 32);
      const salt = crypto.randomBytes(8).toString("hex");
      const max = Math.max(2, Math.min(MAX_PLAYERS, Math.round(num(msg.max)) || MAX_PLAYERS));
      const r = {
        id, name: clean(msg.name, 32) || p.name + "'s lobby", host: p.id, players: [], state: "warmup", timer: null, roundTimer: null, startedAt: 0,
        max, salt, pass: pw ? hashPass(salt, pw) : null, mode: "respawn", map: anyOf(Object.keys(MAPS)), votes: new Map(), voteMaps: null, round: 0,
      };
      rooms.set(id, r);
      joinRoom(p, r);
      break;
    }
    case "join": {
      if (!p.ready) return;
      const r = rooms.get(msg.room);
      if (!r || r.ranked) return send(p, { t: "err", msg: "That lobby doesn't exist any more." });
      rankedUnqueue(p, true);
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
      if (msg.map === "random" || (room.voteMaps || []).includes(msg.map)) v.map = msg.map;
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
        if (room.mode === "respawn" && p.score >= modeOf(room).toWin) endMatch(room);
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

// who's connecting: behind a proxy on this computer (like Tailscale Funnel) every connection comes
// from 127.0.0.1, so the real address is the last one the proxy added to X-Forwarded-For
function clientIp(req) {
  const direct = req.socket.remoteAddress || "?";
  const local = direct === "127.0.0.1" || direct === "::1" || direct === "::ffff:127.0.0.1";
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return local && fwd.length ? fwd[fwd.length - 1].slice(0, 64) : direct;
}

wss.on("connection", (ws, req) => {
  const p = { id: "p" + (nextId++), ws, name: "Mii", color: "#ff3fa4", mii: null, skins: { ak: null, awp: null, deagle: null, knife: null }, room: null, ready: false, alive: false, hp: 100, score: 0, deaths: 0, lastSt: 0, lastAk: 0, lastKnife: 0, pos: null, isAlive: true, ip: clientIp(req) };
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
    rankedUnqueue(p);
    leaveRoom(p, "disconnect");
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
    for (const r of rooms.values()) { clearTimers(r); if (r.ranked) for (const e of r.ranked.entrants.values()) clearTimeout(e.timer); }
    rooms.clear();
    queue.clear(); activeRanked.clear();
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

module.exports = { server, wss, VERSION, PORT, rooms, players, chess, accounts, start, stop, running, MAPS, voteMaps, randomOther, ranked: { store, queue, activeRanked, tick: rankedTick, R } };
