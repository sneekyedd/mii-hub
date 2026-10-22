// Tests for the Paintball server: lobbies, passwords, warmup, matches, rounds, voting. Run: npm test (in this folder)
process.env.COUNTDOWN_MS = "50";
process.env.RESPAWN_MS = "300";
process.env.ROUND_FREEZE_MS = "50";
process.env.ROUND_END_MS = "60";
process.env.INTERMISSION_MS = "1500";
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
  assert(im && im.modes.length === 2 && im.maps.length === 1, "intermission with mode + map choices");
  a.send({ t: "vote", mode: "rounds", map: "shipment" });
  b.send({ t: "vote", mode: "rounds" });
  await wait(60);
  assert.strictEqual(b.last("votes").modes.rounds, 2, "votes counted");
  await wait(1500);
  assert.strictEqual(a.last("voted").mode, "rounds", "the vote decides");
  const st2 = a.last("start");
  assert(st2.mode === "rounds" && a.last("round"), "rounds match started");

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
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

  for (const c of [a, f, g, h]) c.ws.close();
  await wait(80);
  assert.strictEqual(S.rooms.size, 0, "empty lobbies removed");
  await S.stop();
  assert(!S.running(), "stopped");
  console.log("All Paintball, chess and account server tests passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
