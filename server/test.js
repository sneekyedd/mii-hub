// Tests for the Paintball server: lobbies, passwords, warmup, matches, rounds, voting, Ranked. Run: npm test (in this folder)
process.env.COUNTDOWN_MS = "50";
process.env.RESPAWN_MS = "300";
process.env.ROUND_FREEZE_MS = "50";
process.env.ROUND_END_MS = "60";
process.env.INTERMISSION_MS = "1500";
// ranked: small and quick (3 players a match at most, first to 3, a short grace period)
Object.assign(process.env, { RANKED_SIZE: "3", RANKED_TO_WIN: "3", RANKED_COUNTDOWN_MS: "250", RANKED_FILL_MS: "300", RECONNECT_MS: "400", RANKED_TICK_MS: "50" });
// accounts are saved in a throwaway folder
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mii-hub-accounts-"));
const assert = require("assert");
const WebSocket = require("ws");
const S = require("./paintball-server.js");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:" + port);
    const c = { ws, msgs: [], send: (m) => ws.send(JSON.stringify(m)) };
    c.last = (t) => c.msgs.filter((m) => m.t === t).pop();
    c.all = (t) => c.msgs.filter((m) => m.t === t);
    ws.on("message", (d) => c.msgs.push(JSON.parse(d.toString())));
    ws.on("open", () => resolve(c));
  });
}
async function player(port, name, mii) {
  const c = await client(port);
  c.send({ t: "hello", v: S.VERSION, name, color: "#ff3fa4", mii: mii || { kind: "demo" } });
  await wait(60);
  c.id = c.last("welcome").id;
  return c;
}

(async () => {
  const port = await S.start(18787);

  // the server's name (never its address), and the version check
  const old = await client(port);
  old.send({ t: "hello", v: 1, name: "Old" });
  await wait(50);
  assert(old.last("err"), "old versions are told to update");
  old.ws.close();
  const a = await player(port, "Ann", { kind: "demo", look: { shirt: "#ff0000" } });
  assert.strictEqual(a.last("welcome").name, "Admin Server");

  // hosting: you're straight in, running around on your own
  a.send({ t: "create", name: "Shipment" });
  await wait(80);
  const roomId = a.last("room").room.id;
  assert(a.last("warmup"), "warmup while alone");
  assert(S.MAPS[a.last("warmup").map] && a.last("room").room.map === a.last("warmup").map, "warmup says which map");
  // the map list matches the game's, and voting never offers the same map twice
  {
    const L = require("../js/paintball/pb-layouts.js");
    assert.deepStrictEqual(Object.keys(S.MAPS).sort(), L.MAPS.map((m) => m.id).sort(), "server and game know the same maps");
    for (const m of L.MAPS) assert.strictEqual(S.MAPS[m.id].name, m.name, "same name for " + m.id);
    for (let i = 0; i < 300; i++) {
      const cur = L.MAPS[i % L.MAPS.length].id, two = S.voteMaps(cur);
      assert(two[0] !== two[1] && !two.includes(cur), "two other maps");
      const r = S.randomOther(two);
      assert(S.MAPS[r] && !two.includes(r), "Random isn't one of the two shown");
    }
  }
  a.send({ t: "spawn", x: 1, z: 2, yaw: 0 });
  await wait(40);
  assert(a.last("spawn") && a.last("spawn").id === a.id, "spawn in warmup");

  // a 2nd player joins: the match starts by itself
  const b = await player(port, "Bob<script>", { kind: "glb", b64: Buffer.from("glTF....").toString("base64"), fileName: "bob.glb" });
  assert(b.last("rooms").rooms.some((r) => r.id === roomId), "lobby listed");
  b.send({ t: "join", room: roomId });
  await wait(120);
  const room = a.last("room").room;
  assert.strictEqual(room.players.length, 2);
  assert(room.players.find((p) => p.id === b.id).name === "Bobscript", "names are cleaned");
  assert(a.last("mii").id === b.id && b.last("mii").mii.look.shirt === "#ff0000", "Miis shared");
  assert.notStrictEqual(room.players[0].color, room.players[1].color, "different colors");
  assert(b.last("spawn") && b.last("spawn").id === a.id, "B sees A already running around");
  const st = a.last("start");
  assert(st && st.mode === "respawn" && st.toWin === 20 && b.last("start"), "match started (respawn)");
  a.send({ t: "spawn", x: 0, z: 10, yaw: 0 });
  b.send({ t: "spawn", x: 0, z: -10, yaw: 3 });
  await wait(80);

  // movement is passed on
  a.send({ t: "st", s: [1, 0, 2, 0, 0, 0, 0, 0, 9] });
  await wait(40);
  assert.deepStrictEqual(b.last("st").s, [1, 0, 2, 0, 0, 0, 0, 0, 9]);

  // believable hits only
  a.send({ t: "hit", v: b.id, z: "head", d: 999, w: "ak" });
  a.send({ t: "hit", v: b.id, z: "nose", d: 36, w: "ak" });
  a.send({ t: "hit", v: a.id, z: "chest", d: 36, w: "ak" });
  await wait(50);
  assert(!b.last("dmg"), "fake hits ignored");
  a.send({ t: "hit", v: b.id, z: "chest", d: 36, w: "ak" });
  a.send({ t: "hit", v: b.id, z: "chest", d: 36, w: "ak" });
  await wait(50);
  assert.strictEqual(b.all("dmg").length, 1, "fire rate checked");
  await wait(100);
  a.send({ t: "hit", v: b.id, z: "head", d: 143, w: "ak" });
  await wait(60);
  assert(b.last("kill") && b.last("kill").scores[a.id] === 1, "headshot kill");
  const spawnsBefore = a.all("spawn").length;
  b.send({ t: "spawn", x: 5, z: 5, yaw: 0 });
  await wait(30);
  assert.strictEqual(a.all("spawn").length, spawnsBefore, "too early: not yet");
  await wait(320);
  assert.strictEqual(a.all("spawn").length, spawnsBefore + 1, "...let in when allowed");

  // the AWP: big damage, but only one shot per bolt
  const dmgBefore = b.all("dmg").length;
  a.send({ t: "hit", v: b.id, z: "leg", d: 86, w: "awp" });
  await wait(30);
  a.send({ t: "hit", v: b.id, z: "leg", d: 86, w: "awp" });
  a.send({ t: "hit", v: b.id, z: "leg", d: 30, w: "awp" });
  await wait(50);
  assert.strictEqual(b.all("dmg").length, dmgBefore + 1, "AWP bolt + damage checked");
  // the Deagle: 63 a bullet (less far away), one shot every 0.225 s
  await wait(200);
  const dgBefore = b.all("dmg").length;
  a.send({ t: "hit", v: b.id, z: "leg", d: 40, w: "deagle" });
  a.send({ t: "hit", v: b.id, z: "leg", d: 40, w: "deagle" });
  a.send({ t: "hit", v: b.id, z: "leg", d: 10, w: "deagle" });
  await wait(50);
  assert.strictEqual(b.all("dmg").length, dgBefore + 1, "Deagle fire rate + damage checked");
  a.send({ t: "shot", w: "awp", o: [0, 1, 0], e: [1, 1, 1], n: null, m: "" });
  await wait(40);
  assert.strictEqual(b.last("shot").w, "awp", "shot says which gun");
  a.send({ t: "skins", s: { ak: "ak_redline", awp: "<script>", knife: "kn_fade" } });
  await wait(40);
  assert.deepStrictEqual(b.last("skins").s, { ak: "ak_redline", awp: null, deagle: null, knife: "kn_fade" }, "skins relayed (and cleaned)");

  // first to 20, then the intermission vote
  for (let i = 1; i < 20; i++) {
    a.send({ t: "hit", v: b.id, z: "head", d: 143, w: "ak" });
    await wait(330);
    b.send({ t: "spawn", x: 5, z: 5, yaw: 0 });
    await wait(20);
  }
  await wait(80);
  const over = a.last("over");
  assert(over && over.winner === a.id && over.scores[a.id] === 20, "A wins at 20");
  const im = b.last("intermission");
  // two maps (not the one just played) + "Random"
  const played = st.map;
  assert(im && im.modes.length === 2 && im.maps.length === 3, "intermission with mode + map choices");
  assert(im.maps[2].id === "random" && S.MAPS[im.maps[0].id] && S.MAPS[im.maps[1].id] && im.maps[0].id !== im.maps[1].id, "two different maps and Random");
  assert(im.maps[0].id !== played && im.maps[1].id !== played, "not the map just played");
  const shown = [im.maps[0].id, im.maps[1].id];
  a.send({ t: "vote", mode: "rounds", map: "random" });
  b.send({ t: "vote", mode: "rounds", map: "random" });
  await wait(60);
  assert.strictEqual(b.last("votes").modes.rounds, 2, "votes counted");
  assert.strictEqual(b.last("votes").maps.random, 2, "map votes counted");
  await wait(1500);
  const voted = a.last("voted");
  assert.strictEqual(voted.mode, "rounds", "the vote decides");
  assert(voted.random && S.MAPS[voted.map] && !shown.includes(voted.map), "Random picked a map that wasn't shown: " + voted.map);
  const st2 = a.last("start");
  assert(st2.mode === "rounds" && a.last("round") && st2.map === voted.map, "rounds match started on the voted map");
  assert(a.last("room").room.map === voted.map, "the room says which map");

  // rounds: no respawning, last one standing wins the round
  await wait(60);
  a.send({ t: "spawn", x: 0, z: 10, yaw: 0 });
  b.send({ t: "spawn", x: 0, z: -10, yaw: 0 });
  await wait(80);
  a.send({ t: "hit", v: b.id, z: "head", d: 143, w: "ak" });
  await wait(40);
  const re = a.last("roundEnd");
  assert(re && re.winner === a.id && re.scores[a.id] === 1, "round won by the last one standing");
  const before = a.all("spawn").length;
  b.send({ t: "spawn", x: 5, z: 5, yaw: 0 }); // splattered: no coming back this round
  await wait(30);
  assert.strictEqual(a.all("spawn").length, before, "no respawning in rounds");
  await wait(150);
  assert(a.all("round").length >= 2, "next round");

  // a tie is picked at random (both options happen)
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(["respawn", "rounds"][Math.random() < 0.5 ? 0 : 1]);
  assert(seen.size === 2);

  // B leaves: back to warmup
  b.ws.close();
  await wait(100);
  assert(a.last("bye") && a.last("bye").id === b.id, "bye");
  assert(a.msgs.lastIndexOf(a.last("warmup")) > a.msgs.lastIndexOf(a.last("round")), "alone again: warmup");

  // passwords and max players
  const f = await player(port, "Fin"), g = await player(port, "Gus"), h = await player(port, "Hal");
  f.send({ t: "create", name: "Secret", password: "pickles", max: 2 });
  await wait(80);
  const secret = g.last("rooms").rooms.find((r) => r.name === "Secret");
  assert(secret && secret.locked && secret.max === 2 && secret.host === "Fin", "locked lobby listed with host + max");
  g.send({ t: "join", room: secret.id });
  await wait(50);
  assert.strictEqual(g.last("err").code, "password", "asks for the password");
  g.send({ t: "join", room: secret.id, password: "nope" });
  await wait(50);
  assert.strictEqual(g.last("err").msg, "Wrong password.");
  g.send({ t: "join", room: secret.id, password: "pickles" });
  await wait(100);
  assert(g.last("room") && g.last("room").room.players.length === 2, "right password lets you in");
  assert(!JSON.stringify(g.msgs).includes("pickles"), "the password is never sent out");
  h.send({ t: "join", room: secret.id, password: "pickles" });
  await wait(50);
  assert.strictEqual(h.last("err").msg, "That lobby is full.", "max players");
  for (let i = 0; i < 7; i++) h.send({ t: "join", room: secret.id, password: "x" + i });
  await wait(80);
  assert.strictEqual(h.last("err").code, "slow", "password guessing is slowed down");

  // ---- online chess ----
  const w1 = await player(port, "Kasparov"), b1 = await player(port, "Carlsen"), x1 = await player(port, "Spectator");
  b1.send({ t: "chList" });
  w1.send({ t: "chCreate", name: "Blitz", password: "rook", time: 1, inc: 0, side: "w" });
  await wait(60);
  assert(b1.last("chRooms").rooms.some((r) => r.name === "Blitz" && r.locked && r.time === 1), "chess lobby listed");
  const cid = w1.last("chRoom").room.id;
  b1.send({ t: "chJoin", room: cid, password: "nope" });
  await wait(40);
  assert.strictEqual(b1.last("err").msg, "Wrong password.");
  b1.send({ t: "chJoin", room: cid, password: "rook" });
  await wait(60);
  let cr = b1.last("chRoom").room;
  assert(cr.state === "playing" && cr.white.name === "Kasparov" && cr.black.name === "Carlsen", "game starts, host is white");
  x1.send({ t: "chJoin", room: cid, password: "rook" });
  await wait(40);
  assert.strictEqual(x1.last("err").msg, "That chess game is already full.");
  b1.send({ t: "chMove", from: "e7", to: "e5", n: 0 });  // not black's turn
  w1.send({ t: "chMove", from: "e2", to: "e5", n: 0 });  // illegal
  await wait(40);
  assert.strictEqual(w1.last("chRoom").room.moves.length, 0, "wrong-turn and illegal moves refused");
  // fool's mate
  const play = async (c, from, to, n) => { c.send({ t: "chMove", from, to, n }); await wait(30); };
  await play(w1, "f2", "f3", 0); await play(b1, "e7", "e5", 1); await play(w1, "g2", "g4", 2); await play(b1, "d8", "h4", 3);
  cr = w1.last("chRoom").room;
  assert(cr.state === "over" && cr.result === "b" && cr.reason === "checkmate", "checkmate ends it: " + JSON.stringify([cr.state, cr.result, cr.reason]));
  assert.deepStrictEqual(cr.moves, ["f3", "e5", "g4", "Qh4#"], "moves in SAN");
  w1.send({ t: "chRematch" }); b1.send({ t: "chRematch" });
  await wait(60);
  cr = w1.last("chRoom").room;
  assert(cr.state === "playing" && cr.white.name === "Carlsen" && cr.game === 2, "rematch swaps colors");
  // draw offer, then resign
  await play(cr.white.name === "Carlsen" ? b1 : w1, "e2", "e4", 0);
  w1.send({ t: "chDraw", a: "offer" }); await wait(30);
  assert.strictEqual(b1.last("chRoom").room.drawOffer, w1.id, "draw offered");
  b1.send({ t: "chDraw", a: "decline" }); await wait(30);
  assert.strictEqual(w1.last("chRoom").room.drawOffer, null, "draw declined");
  b1.send({ t: "chResign" }); await wait(40);
  cr = w1.last("chRoom").room;
  assert(cr.result === "b" && cr.reason === "resign", "Carlsen (white) resigned, black wins");
  // the clock: 1 minute each, so make white's flag fall quickly by winding the clock down
  w1.send({ t: "chRematch" }); b1.send({ t: "chRematch" }); await wait(60);
  const chr = S.chess.rooms.get(cid);
  chr.clock.w = 150; chr.clock.turnStart = Date.now();
  S.chess._armFlag(chr);
  await wait(400);
  cr = w1.last("chRoom").room;
  assert(cr.state === "over" && cr.reason === "time" && cr.result === "b", "flag falls: " + JSON.stringify([cr.state, cr.reason, cr.result]));
  // leaving mid-game loses
  w1.send({ t: "chRematch" }); b1.send({ t: "chRematch" }); await wait(60);
  b1.ws.close(); await wait(80);
  cr = w1.last("chRoom").room;
  assert(cr.reason === "left" && cr.state === "waiting", "opponent left: you win, lobby waits");
  w1.send({ t: "chLeave" }); await wait(40);
  assert.strictEqual(S.chess.rooms.size, 0, "empty chess lobby removed");
  for (const c of [w1, x1]) c.ws.close();

  // ---- accounts and cloud saves ----
  let q = 0;
  const ask = (c, m) => new Promise((resolve) => {
    const id = ++q, n0 = c.msgs.length;
    c.send(Object.assign({ q: id }, m));
    const look = setInterval(() => {
      const r = c.msgs.slice(n0).find((x) => x.t === "acRes" && x.q === id);
      if (r) { clearInterval(look); resolve(r); }
    }, 10);
  });
  const d1 = await client(port);
  let r = await ask(d1, { t: "acWorlds" });
  assert(!r.ok && r.code === "token", "worlds need signing in");
  r = await ask(d1, { t: "acSignup", user: "a", pass: "secret123" });
  assert(!r.ok && r.code === "user", "username too short");
  r = await ask(d1, { t: "acSignup", user: "Ann", pass: "123" });
  assert(!r.ok && r.code === "pass", "password too short");
  r = await ask(d1, { t: "acSignup", user: "Ann", pass: "secret123", world: "Ann's island" });
  assert(r.ok && r.user === "Ann" && /^[0-9a-f]{64}$/.test(r.token) && r.worlds.length === 1 && r.worlds[0].name === "Ann's island" && r.current === r.worlds[0].id, "signed up with a first world");
  const token = r.token, wA = r.current;
  r = await ask(await client(port), { t: "acSignup", user: "ANN", pass: "whatever1" });
  assert(!r.ok && r.code === "taken", "usernames are case-insensitive and unique");
  // the password and token are never stored as they are
  const accFile = fs.readFileSync(path.join(process.env.DATA_DIR, "users", "ann", "account.json"), "utf8");
  assert(!accFile.includes("secret123") && !accFile.includes(token), "only hashes on disk");
  assert(/^[0-9a-f]{32}$/.test(JSON.parse(accFile).salt), "a salt of its own");

  // wrong password, then the right one on another device
  const d2 = await client(port);
  r = await ask(d2, { t: "acLogin", user: "ann", pass: "nope-nope" });
  assert(!r.ok && r.code === "login" && r.msg === "Wrong username or password.", "wrong password");
  r = await ask(d2, { t: "acLogin", user: "nobody", pass: "secret123" });
  assert(!r.ok && r.code === "login", "no such account looks the same");
  r = await ask(d2, { t: "acLogin", user: "ann", pass: "secret123" });
  assert(r.ok && r.user === "Ann" && r.token !== token && r.current === wA, "signed in on a 2nd device");
  // the 1st device stays signed in with its token
  const d3 = await client(port);
  r = await ask(d3, { t: "acToken", user: "Ann", token: "f".repeat(64) });
  assert(!r.ok && r.code === "token", "made-up token refused");
  r = await ask(d3, { t: "acToken", user: "Ann", token });
  assert(r.ok && r.token == null && r.current === wA, "token sign-in");

  // worlds: create, rename, switch, delete
  r = await ask(d3, { t: "acCreate", name: "Beach <b>town</b>" });
  assert(r.ok && r.worlds.length === 2 && r.worlds[1].name === "Beach btown/b", "world created (name cleaned)");
  const wB = r.id;
  r = await ask(d3, { t: "acRename", id: wB, name: "Beach town" });
  assert(r.ok && r.worlds.find((w) => w.id === wB).name === "Beach town", "renamed");
  r = await ask(d3, { t: "acCurrent", id: wB });
  assert(r.ok && r.current === wB, "switched");
  r = await ask(d3, { t: "acGet", id: wB });
  assert(r.ok && r.data === null && r.rev === 0, "a new world is empty");

  // a big save: a 2.5 MB Mii model in pieces + a 3 MB world
  const glb = crypto.randomBytes(2.5 * 1024 * 1024), hash = crypto.createHash("sha256").update(glb).digest("hex");
  r = await ask(d3, { t: "acSave", id: wA, base: 0, data: { miis: [{ id: "m1", blob: hash }] } });
  assert(!r.ok && r.code === "blob", "can't save a world before its models");
  r = await ask(d3, { t: "acBlobHave", hashes: [hash, "nope"] });
  assert(r.ok && r.need.length === 1 && r.need[0] === hash, "server asks for the model");
  const CH = S.accounts.BLOB_CHUNK, n = Math.ceil(glb.length / CH);
  r = await ask(d3, { t: "acBlobPut", hash, i: 1, n, b64: glb.subarray(CH, 2 * CH).toString("base64") });
  assert(!r.ok && r.code === "order", "pieces must come in order");
  for (let i = 0; i < n; i++) r = await ask(d3, { t: "acBlobPut", hash, i, n, b64: glb.subarray(i * CH, (i + 1) * CH).toString("base64") });
  assert(r.ok && r.done, "model stored");
  const big = { v: 1, miis: [{ id: "m1", kind: "glb", name: "Joe", blob: hash }, { id: "m2", kind: "demo", name: "Pat" }], settings: { scene: "park" }, progress: "x".repeat(3 * 1024 * 1024), locker: null };
  r = await ask(d3, { t: "acSave", id: wA, base: 0, data: big });
  assert(r.ok && r.rev === 1, "big world saved");
  r = await ask(d2, { t: "acSave", id: wA, base: 0, data: { miis: [] } });
  assert(!r.ok && r.code === "conflict" && r.rev === 1, "an old copy can't overwrite a newer save");
  r = await ask(d2, { t: "acGet", id: wA });
  assert(r.ok && r.rev === 1 && r.data.miis[0].blob === hash && r.data.progress.length === 3 * 1024 * 1024, "the other device loads the same world");
  const parts = [];
  for (let i = 0; i < n; i++) { const g = await ask(d2, { t: "acBlobGet", hash, i }); assert(g.ok && g.n === n); parts.push(Buffer.from(g.b64, "base64")); }
  assert(Buffer.concat(parts).equals(glb), "model downloaded in pieces, byte for byte");
  r = await ask(d2, { t: "acSave", id: wA, base: 0, data: { miis: [] }, force: true });
  assert(r.ok && r.rev === 2, "keep this device's copy (force)");
  r = await ask(d3, { t: "acDelete", id: wB });
  assert(r.ok && r.worlds.length === 1 && r.current === wA, "deleted (current moves to another world)");
  r = await ask(d3, { t: "acDelete", id: wA });
  assert(!r.ok && r.code === "last", "can't delete the last world");

  // signing out forgets that device's token; guessing passwords is slowed down
  r = await ask(d3, { t: "acLogout" });
  r = await ask(await client(port), { t: "acToken", user: "ann", token });
  assert(!r.ok && r.code === "token", "token forgotten after signing out");
  const d4 = await client(port);
  for (let i = 0; i < 6; i++) await ask(d4, { t: "acLogin", user: "ann", pass: "guess" + i });
  r = await ask(d4, { t: "acLogin", user: "ann", pass: "secret123" });
  assert(!r.ok && r.code === "slow", "too many tries");
  const d5 = await client(port);
  r = await ask(d5, { t: "acLogin", user: "ann", pass: "guess-again" });
  r = await ask(d5, { t: "acLogin", user: "ann", pass: "secret123" });
  assert(!r.ok && r.code === "slow", "the account is protected from guessing on new connections too");
  assert(!fs.readdirSync(process.env.DATA_DIR, { recursive: true }).some((f) => f.endsWith(".tmp")), "no half-written files");
  for (const c of [d1, d2, d3, d4, d5]) c.ws.close();

  // ---- Ranked: the math ----
  const RK = S.ranked.R;
  {
    const lbl = (m, o) => RK.rankFor(m, o).label;
    assert.strictEqual(lbl(0), "Iron IV"); assert.strictEqual(lbl(99), "Iron IV"); assert.strictEqual(lbl(100), "Iron III"); assert.strictEqual(lbl(399), "Iron I");
    assert.strictEqual(lbl(400), "Bronze IV"); assert.strictEqual(lbl(1199), "Silver I"); assert.strictEqual(lbl(1200), "Gold IV"); assert.strictEqual(lbl(1650), "Platinum IV");
    assert.strictEqual(lbl(2050), "Emerald IV"); assert.strictEqual(lbl(2799), "Diamond I"); assert.strictEqual(lbl(2800), "Master"); assert.strictEqual(lbl(3199), "Master");
    assert.strictEqual(lbl(3200), "Grandmaster"); assert.strictEqual(lbl(9000), "Grandmaster"); assert.strictEqual(lbl(-50), "Iron IV");
    assert.strictEqual(lbl(2900, { predator: true }), "Predator", "a top-10 Master is a Predator");
    assert.strictEqual(lbl(2500, { predator: true }), "Diamond III", "Predator needs at least Master");
    assert.strictEqual(lbl(1500, { placed: false }), "Unranked", "unranked during placements");
    assert(RK.rankFor(1300).step > RK.rankFor(1299).step && RK.rankFor(2800).step > RK.rankFor(2799).step && RK.rankFor(3200, { predator: true }).step > RK.rankFor(5000).step, "ranks go up in order");
    const pr = RK.progress(1250);
    assert(pr.floor === 1200 && pr.ceil === 1300 && pr.pct === 0.5, "progress through a division");
    assert(RK.progress(3000).floor === 2800 && RK.progress(3000).ceil === 3200, "Master's progress is to Grandmaster");
    assert.strictEqual(RK.START_MMR, 1200, "everyone starts at the Silver / Gold line");
    // Elo: 1 vs 1 between equals is ±K/2; placements swing twice as much
    assert.deepStrictEqual(RK.eloDeltas([{ mmr: 1200, place: 1 }, { mmr: 1200, place: 2 }]), [20, -20]);
    assert.deepStrictEqual(RK.eloDeltas([{ mmr: 1200, place: 1, k: 80 }, { mmr: 1200, place: 2, k: 80 }]), [40, -40]);
    // beating someone better is worth more; an upset costs the favorite more
    const up = RK.eloDeltas([{ mmr: 1000, place: 1 }, { mmr: 1400, place: 2 }]), fav = RK.eloDeltas([{ mmr: 1400, place: 1 }, { mmr: 1000, place: 2 }]);
    assert(up[0] > 30 && fav[0] < 10 && fav[0] >= 1 && up[1] < -30, "upsets are worth more: " + up + " / " + fav);
    // free-for-all: placement by placement, the winner gains, last loses, middle places in between
    const ffa = RK.eloDeltas([1, 2, 3, 4].map((place) => ({ mmr: 1200, place })));
    assert(ffa[0] === 20 && ffa[3] === -20 && ffa[1] > 0 && ffa[2] < 0 && ffa[0] + ffa[1] + ffa[2] + ffa[3] === 0, "FFA deltas " + ffa);
    const tie = RK.eloDeltas([{ mmr: 1200, place: 1 }, { mmr: 1200, place: 1 }, { mmr: 1200, place: 3 }]);
    assert(tie[0] === tie[1] && tie[0] > 0 && tie[2] < 0, "a shared place is a draw between them");
    const big = RK.eloDeltas([{ mmr: 3000, place: 1 }, { mmr: 200, place: 2 }]);
    assert(big[0] === 1 && big[1] === -1, "a win always gains, last always loses: " + big);
    // matchmaking: the range widens the longer you wait
    assert.strictEqual(RK.searchRange(0), 100); assert.strictEqual(RK.searchRange(10e3), 300); assert.strictEqual(RK.searchRange(60e3), Infinity);
    for (let t = 0; t < 59e3; t += 1000) assert(RK.searchRange(t + 1000) >= RK.searchRange(t), "never narrows");
    const now = 1e6, o = { size: 4, fillMs: 20e3 };
    const qa = { key: "a", mmr: 1200, at: now }, qb = { key: "b", mmr: 1700, at: now };
    assert.strictEqual(RK.formMatches([qa, qb], now, o).length, 0, "500 MMR apart: not straight away");
    assert.strictEqual(RK.formMatches([Object.assign({}, qa, { at: now - 21e3 }), Object.assign({}, qb, { at: now - 21e3 })], now, o).length, 1, "...but after waiting the range is wide enough");
    const four = ["a", "b", "c", "d"].map((key, i) => ({ key, mmr: 1200 + i * 20, at: now }));
    assert.deepStrictEqual(RK.formMatches(four, now, o).map((g) => g.length), [4], "4 close players: a full match at once");
    assert.strictEqual(RK.formMatches(four.slice(0, 3), now, o).length, 0, "3 players wait for a 4th...");
    assert.deepStrictEqual(RK.formMatches(four.slice(0, 3).map((e) => Object.assign({}, e, { at: now - 20e3 })), now, o).map((g) => g.length), [3], "...for a while, then start with 3");
    const spread = [{ key: "lo", mmr: 400, at: now - 5e3 }, { key: "lo2", mmr: 450, at: now - 5e3 }, { key: "hi", mmr: 2500, at: now - 5e3 }, { key: "hi2", mmr: 2480, at: now - 5e3 }];
    const gs = RK.formMatches(spread, now, { size: 2, fillMs: 1e3 });
    assert(gs.length === 2 && gs.every((g) => Math.abs(g[0].mmr - g[1].mmr) < 100), "similar MMRs are matched together");
  }

  // ---- Ranked: placements, rank protection, Predator, saving ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mii-hub-ranked-"));
    const st = RK.createStore({ dataDir: dir });
    for (let i = 0; i < 4; i++) {
      const r = st.applyMatch([{ key: "pat", user: "Pat", place: 1 }, { key: "sam", user: "Sam", place: 2 }]);
      assert(r.pat.delta === null && r.pat.after.mmr === null && r.pat.after.rank.tier === "unranked" && r.pat.placement.done === i + 1, "placements: MMR hidden");
      assert.strictEqual(st.info("pat").mmr, null, "hidden in your info too");
    }
    assert(st.get("pat").mmr > 1300, "placements swing big: " + st.get("pat").mmr);
    const r5 = st.applyMatch([{ key: "pat", user: "Pat", place: 1 }, { key: "sam", user: "Sam", place: 2 }]);
    assert(r5.pat.justPlaced && r5.pat.after.mmr === st.get("pat").mmr && r5.pat.after.rank.tier !== "unranked", "5th placement reveals the rank: " + r5.pat.after.rank.label);
    assert(r5.sam.justPlaced && st.get("sam").mmr < 1200, "the loser places lower: " + r5.sam.after.rank.label);
    // rank protection: promote into Gold, then the first loss can't drop you out of it
    const P = st._players();
    P.pat.mmr = 1190; P.pat.shield = false; P.sam.mmr = 1190;
    let r = st.applyMatch([{ key: "pat", place: 1 }, { key: "sam", place: 2 }]);
    assert(r.pat.promoted && r.pat.tierUp && r.pat.after.rank.label === "Gold IV" && P.pat.shield && r.pat.shield, "promoted into Gold (protected)");
    assert(!r.sam.promoted && !r.sam.demoted && r.sam.after.rank.label === "Silver I", "Sam stays in Silver I: " + r.sam.after.rank.label);
    r = st.applyMatch([{ key: "sam", place: 1 }, { key: "pat", place: 2 }]);
    assert(r.pat.protected && P.pat.mmr === 1200 && r.pat.after.rank.label === "Gold IV" && !P.pat.shield, "first loss after promoting: stays in Gold");
    r = st.applyMatch([{ key: "sam", place: 1 }, { key: "pat", place: 2 }]);
    assert(!r.pat.protected && r.pat.demoted && r.pat.tierDown && r.pat.after.rank.label === "Silver I", "the next loss demotes");
    // Predator: the top 10 at Master or higher, recomputed as MMR changes
    for (let i = 0; i < 12; i++) P["m" + i] = { user: "M" + i, mmr: 2810 + i * 10, games: 9, wins: 5, shield: false, peak: 0, updated: i };
    P.dia = { user: "Dia", mmr: 2790, games: 30, wins: 20, shield: false, peak: 0, updated: 0 };
    let preds = st.predators();
    assert(preds.size === 10 && !preds.has("m0") && !preds.has("m1") && preds.has("m11") && !preds.has("dia"), "top 10 Masters are Predators");
    assert.strictEqual(st.rankOf("m11").tier, "predator"); assert.strictEqual(st.rankOf("m0").tier, "master"); assert.strictEqual(st.rankOf("dia").label, "Diamond I");
    P.m0.mmr = 3500;
    preds = st.predators();
    assert(preds.has("m0") && !preds.has("m2") && st.rankOf("m2").tier === "master", "recomputed when MMR changes");
    const lb = st.top(5);
    assert(lb.length === 5 && lb[0].key === "m0" && lb[0].rank.tier === "predator" && lb.every((x, i) => !i || lb[i - 1].mmr >= x.mmr), "leaderboard sorted");
    // saved, and back after a restart
    st.save();
    await st.flush();
    const again = RK.createStore({ dataDir: dir });
    assert.strictEqual(again.get("pat").mmr, P.pat.mmr, "MMR survives a restart");
    assert.strictEqual(again.rankOf("m0").tier, "predator", "Predator too");
    assert.strictEqual(again.info("pat").placements.done, 5);
    assert(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), "no half-written ranked files");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- Ranked online: queue, matches, leavers ----
  {
    const ranked = async (name) => {
      const c = await player(port, name);
      const r = await ask(c, { t: "acSignup", user: "rk" + name, pass: "secret123" });
      assert(r.ok, "signed up " + name + ": " + r.msg);
      c.token = r.token; c.user = "rk" + name; c.key = c.user.toLowerCase();
      return c;
    };
    const old6 = await client(port);
    old6.send({ t: "hello", v: 6, name: "Old" });
    await wait(50);
    assert(/different versions/.test(old6.last("err").msg), "version 6 is told to update");
    old6.ws.close();
    const anon = await player(port, "Anon");
    anon.send({ t: "rkQueue" });
    await wait(40);
    assert.strictEqual(anon.last("rkErr").code, "signin", "Ranked needs an account");
    const A = await ranked("Ada"), B = await ranked("Bea");
    A.send({ t: "rkInfo" });
    await wait(40);
    let me = A.last("rkMe");
    assert(me.signedIn && me.info.rank.tier === "unranked" && me.info.mmr === null && me.info.placements.done === 0 && me.rules.size === 3, "your rank: unranked, 0/5");
    A.send({ t: "rkQueue" });
    await wait(30);
    A.send({ t: "rkQueue" });
    await wait(30);
    assert(A.last("rkQueued") && A.last("rkErr").code === "already" && S.ranked.queue.size === 1, "can't queue twice");
    const A2 = await player(port, "Ada again");
    await ask(A2, { t: "acToken", user: A.user, token: A.token });
    A2.send({ t: "rkQueue" });
    await wait(30);
    assert(A2.last("rkErr").code === "already" && S.ranked.queue.size === 1, "...not even from another device");
    A2.ws.close();
    B.send({ t: "rkQueue" });
    await wait(500); // 2 of 3: they start after RANKED_FILL_MS
    assert(A.last("rkFound") && B.last("rkFound") && A.last("rkFound").players.length === 2, "match found");
    let st = A.last("start");
    assert(st && st.ranked && st.toWin === 3 && st.mode === "respawn" && S.MAPS[st.map], "ranked match: respawn, first to 3, random map");
    const rr = A.last("room").room;
    assert(rr.ranked && rr.players.every((p) => p.rank && p.rank.tier === "unranked"), "players have rank badges");
    assert(!anon.last("rooms").rooms.some((x) => x.id === rr.id), "ranked rooms aren't in the lobby list");
    anon.send({ t: "join", room: rr.id });
    await wait(40);
    assert(!anon.last("room"), "and can't be joined");
    const spawnBoth = async (x, y) => { x.send({ t: "spawn", x: 0, z: 10, yaw: 0 }); y.send({ t: "spawn", x: 0, z: -10, yaw: 0 }); await wait(320); };
    const kills = async (x, y, n) => { for (let i = 0; i < n; i++) { x.send({ t: "hit", v: y.id, z: "head", d: 143, w: "ak" }); await wait(330); y.send({ t: "spawn", x: 5, z: 5, yaw: 0 }); await wait(20); } };
    // a fake "I won" message does nothing: only the server's own count matters
    A.send({ t: "over", winner: A.id }); A.send({ t: "rkResult", place: 1 });
    await spawnBoth(A, B);
    await kills(A, B, 3);
    await wait(80);
    let over = A.last("over");
    assert(over && over.ranked && over.winner === A.id, "first to 3 wins");
    let ra = A.last("rkResult"), rb = B.last("rkResult");
    assert(ra.place === 1 && rb.place === 2 && ra.of === 2 && ra.placement.done === 1 && ra.delta === null, "placement 1/5 (MMR hidden)");
    assert(S.ranked.store.get(A.key).mmr === 1240 && S.ranked.store.get(B.key).mmr === 1160, "placement swing ±40");
    assert(!Array.from(S.rooms.values()).some((x) => x.ranked) && !S.ranked.activeRanked.size, "the ranked room is closed");
    // the leaver penalty: B drops out mid-match, comes back in time, then leaves for good
    A.send({ t: "rkQueue" }); B.send({ t: "rkQueue" });
    await wait(500);
    assert(B.all("rkFound").length === 2, "2nd match");
    await spawnBoth(A, B);
    A.send({ t: "hit", v: B.id, z: "head", d: 143, w: "ak" });
    await wait(60);
    B.ws.close();
    await wait(60);
    assert(A.last("rkAway"), "B dropped: a short wait for them to come back");
    const B2 = await player(port, "Bea");
    await ask(B2, { t: "acToken", user: B.user, token: B.token });
    B2.send({ t: "rkInfo" });
    await wait(40);
    assert(B2.last("rkMe").active, "you have a match to get back to");
    B2.send({ t: "rkRejoin" });
    await wait(80);
    assert(B2.last("start") && B2.last("start").late && A.last("rkBack"), "back in");
    assert.strictEqual(A.last("room").room.players.find((p) => p.id === A.id).score, 1, "score kept");
    B2.send({ t: "leave" });
    await wait(80);
    ra = A.last("rkResult"); rb = B2.last("rkResult");
    assert(A.last("rkGone") && ra.place === 1 && rb && rb.leaver && rb.place === 2, "leaving = last place (a loss)");
    assert(S.ranked.store.get(B.key).mmr < 1160 && S.ranked.store.get(B.key).games === 2, "leaver lost MMR");
    // disconnecting and not coming back: a loss after the grace period
    A.send({ t: "rkQueue" }); B2.send({ t: "rkQueue" });
    for (let i = 0; i < 200 && !B2.last("rkFound"); i++) await wait(25);
    assert(B2.last("rkFound") && A.last("rkSearch").range > 100, "3rd match (150 MMR apart: after the range widened)");
    await spawnBoth(A, B2);
    const bMmr = S.ranked.store.get(B.key).mmr;
    B2.ws.close();
    await wait(200);
    assert(S.ranked.store.get(B.key).mmr === bMmr, "not yet: there's a grace period");
    await wait(450);
    assert(S.ranked.store.get(B.key).mmr < bMmr && S.ranked.store.get(B.key).games === 3, "gone for good: counts as a loss");
    assert(A.last("over") && A.all("rkResult").length === 3, "the one left wins");
    // too few players: someone leaves before it starts -> called off, nobody's MMR changes
    const C = await ranked("Cy");
    const before = [A.key, C.key].map((k) => (S.ranked.store.get(k) || { mmr: null }).mmr);
    A.send({ t: "rkQueue" }); C.send({ t: "rkQueue" });
    for (let i = 0; i < 200 && !C.last("rkFound"); i++) await wait(25);
    assert(C.last("rkFound"), "matched with a wider range after a moment");
    C.send({ t: "leave" });
    await wait(60);
    assert(A.last("rkCancel") && /called off/.test(A.last("rkCancel").msg), "called off");
    assert.deepStrictEqual([A.key, C.key].map((k) => (S.ranked.store.get(k) || { mmr: null }).mmr), before, "no MMR change");
    assert(S.ranked.queue.has(A.key) && A.last("rkQueued").requeued, "the others go back to searching");
    C.send({ t: "rkQueue" });
    await wait(40);
    assert.strictEqual(C.last("rkErr").code, "cooldown", "the leaver waits a bit");
    A.send({ t: "rkCancel" });
    await wait(40);
    assert(A.last("rkCancelled") && !S.ranked.queue.size, "cancel searching");
    // searching too often is slowed down
    for (let i = 0; i < 10; i++) { A.send({ t: "rkQueue" }); A.send({ t: "rkCancel" }); }
    await wait(80);
    assert.strictEqual(A.last("rkErr").code, "slow", "queue joins are rate-limited");
    // the leaderboard (Ada is placed after a few more matches; here we make her placed)
    const PL = S.ranked.store._players();
    PL[A.key].games = 5; PL[A.key].mmr = 1450;
    PL.zed = { user: "Zed", mmr: 2000, games: 20, wins: 10, shield: false, peak: 2000, updated: 1 };
    await wait(900);
    A.send({ t: "rkTop" });
    await wait(50);
    const top = A.last("rkTop");
    assert(top.list[0].user === "Zed" && top.list.some((x) => x.you && x.user === "rkAda" && x.rank.label === "Gold II") && top.you.pos === top.list.find((x) => x.you).pos, "leaderboard with you highlighted");
    assert(!JSON.stringify(top).includes("secret123") && !top.list.some((x) => "key" in x), "nothing private on the leaderboard");
    // saved to disk (survives a restart)
    await S.ranked.store.flush();
    const disk = RK.createStore({ dataDir: process.env.DATA_DIR });
    assert.strictEqual(disk.get(B.key).mmr, S.ranked.store.get(B.key).mmr, "ranked.json next to the accounts");
    for (const c of [anon, A, C]) c.ws.close();
  }

  for (const c of [a, f, g, h]) c.ws.close();
  await wait(80);
  assert.strictEqual(S.rooms.size, 0, "empty lobbies removed");
  await S.stop();
  assert(!S.running(), "stopped");
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  console.log("All Paintball, chess, account and Ranked server tests passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
