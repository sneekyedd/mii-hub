/*
 * Online chess for Mii Hub (runs inside the same server as Paintball).
 *
 * Players host or join a chess lobby (optional password, optional clock),
 * then play one another. The server is the referee: it keeps the real board,
 * only accepts legal moves from the player whose turn it is, runs the clocks,
 * and decides how the game ends (checkmate, stalemate, draws, resigning,
 * running out of time, or leaving).
 *
 * PROTOCOL (on top of the Paintball server's hello/welcome)
 * client -> server
 *   chList   {}                                   ask for the chess lobby list (and keep it updated)
 *   chCreate { name, password, time, inc, side } host: time = minutes each (0 = no clock), inc = seconds added per move, side = "w" | "b" | "random"
 *   chJoin   { room, password }
 *   chLeave  {}
 *   chMove   { from, to, promo, n }              n = how many moves had been played (so old clicks are ignored)
 *   chResign {}
 *   chDraw   { a: "offer" | "accept" | "decline" }
 *   chRematch {}                                 after a game: when both ask, colors swap and a new game starts
 * server -> client
 *   chRooms  { rooms }                            the lobby list
 *   chRoom   { room }                             everything about your game, sent whenever it changes
 *   err      { msg }
 */
"use strict";

const crypto = require("crypto");

let Chess = null;
try { Chess = require("../js/chess.js"); } catch (e) { Chess = null; }

const MAX_CHESS_ROOMS = 200;
const TIMES = [0, 1, 3, 5, 10, 15, 30];   // minutes each
const INCS = [0, 1, 2, 3, 5, 10];         // seconds per move

module.exports = function chessRooms(ctx) {
  const { players, send, clean, num, log } = ctx;
  const rooms = new Map();
  let nextId = 1;
  const hashPass = (salt, pw) => crypto.createHash("sha256").update(salt + "\u0000" + pw).digest("hex");

  const who = (id) => {
    const p = id && players.get(id);
    return p ? { id: p.id, name: p.name, color: p.color } : null;
  };
  // how much time each side has right now (the side to move is losing time)
  function clockNow(r, now) {
    if (!r.time) return null;
    const c = { w: r.clock.w, b: r.clock.b, running: null };
    if (r.state === "playing" && r.clock.turnStart) {
      const t = Chess.turn(r.game);
      c[t] = Math.max(0, c[t] - (now - r.clock.turnStart));
      c.running = t;
    }
    return c;
  }
  function info(r, now) {
    const st = r.game ? Chess.status(r.game) : null;
    return {
      id: r.id, name: r.name, host: r.host, locked: !!r.pass, time: r.time, inc: r.inc,
      white: who(r.white), black: who(r.black), state: r.state,
      fen: r.game ? Chess.toFEN(r.game) : null, moves: r.moves.slice(), last: r.last,
      check: !!(st && st.check), clock: clockNow(r, now || Date.now()),
      result: r.result, reason: r.reason, drawOffer: r.drawOffer, rematch: Array.from(r.rematch), game: r.gameNo,
    };
  }
  function list() {
    return Array.from(rooms.values()).map((r) => {
      const h = players.get(r.host);
      return { id: r.id, name: r.name, host: h ? h.name : "", players: [r.white, r.black].filter(Boolean).length, locked: !!r.pass, state: r.state, time: r.time, inc: r.inc };
    });
  }
  const members = (r) => [r.white, r.black].filter(Boolean);
  function update(r) {
    const m = { t: "chRoom", room: info(r) };
    for (const id of members(r)) { const p = players.get(id); if (p) send(p, m); }
  }
  function listChanged() {
    const m = { t: "chRooms", rooms: list() };
    for (const p of players.values()) if (p.chessMenu && !p.chessRoom) send(p, m);
  }

  function startGame(r) {
    r.game = Chess.newGame();
    r.moves = []; r.last = null; r.result = null; r.reason = null; r.drawOffer = null; r.rematch = new Set();
    r.state = "playing"; r.gameNo++;
    r.clock = { w: r.time * 60e3, b: r.time * 60e3, turnStart: Date.now() };
    armFlag(r);
    log("♟ " + r.id + " game " + r.gameNo + " started");
  }
  function endGame(r, result, reason) {
    if (r.state !== "playing") return;
    if (r.time) { const c = clockNow(r, Date.now()); r.clock.w = c.w; r.clock.b = c.b; r.clock.turnStart = 0; }
    clearTimeout(r.flag);
    r.state = "over"; r.result = result; r.reason = reason; r.drawOffer = null;
    log("♟ " + r.id + " over: " + result + " (" + reason + ")");
  }
  // run out of time: lose (or draw if the other side can't possibly mate... kept simple: lose)
  function armFlag(r) {
    clearTimeout(r.flag);
    if (!r.time || r.state !== "playing") return;
    const t = Chess.turn(r.game);
    const left = clockNow(r, Date.now())[t];
    r.flag = setTimeout(() => {
      if (r.state !== "playing" || Chess.turn(r.game) !== t) return;
      if (clockNow(r, Date.now())[t] > 0) return armFlag(r);
      endGame(r, t === "w" ? "b" : "w", "time");
      update(r); listChanged();
    }, left + 30);
    if (r.flag.unref) r.flag.unref();
  }
  function leave(p) {
    const r = p.chessRoom && rooms.get(p.chessRoom);
    p.chessRoom = null;
    if (!r) return;
    const color = r.white === p.id ? "w" : "b";
    if (r.state === "playing") endGame(r, color === "w" ? "b" : "w", "left");
    if (color === "w") r.white = null; else r.black = null;
    r.rematch.delete(p.id);
    if (!members(r).length) { clearTimeout(r.flag); rooms.delete(r.id); }
    else {
      if (r.host === p.id) r.host = members(r)[0];
      if (r.state === "over" || r.state === "playing") r.state = "waiting";
      update(r);
    }
    listChanged();
  }
  function join(p, r) {
    if (r.white && r.black) return send(p, { t: "err", msg: "That chess game is already full." });
    if (!r.white && !r.black) r[r.side === "b" ? "black" : r.side === "w" ? "white" : (Math.random() < 0.5 ? "white" : "black")] = p.id;
    else if (!r.white) r.white = p.id;
    else r.black = p.id;
    p.chessRoom = r.id;
    if (r.white && r.black) startGame(r);
    update(r); listChanged();
  }

  function handle(p, msg) {
    if (typeof msg.t !== "string" || msg.t.slice(0, 2) !== "ch") return false;
    if (!p.ready) return true;
    if (!Chess) { send(p, { t: "err", msg: "This server can't host chess games (it's missing js/chess.js)." }); return true; }
    const now = Date.now();
    const r = p.chessRoom ? rooms.get(p.chessRoom) : null;
    switch (msg.t) {
      case "chList": p.chessMenu = true; send(p, { t: "chRooms", rooms: list() }); break;
      case "chCreate": {
        if (r) leave(p);
        if (rooms.size >= MAX_CHESS_ROOMS) return send(p, { t: "err", msg: "There are too many chess games right now. Try joining one!" }), true;
        const pw = clean(msg.password, 32), salt = crypto.randomBytes(8).toString("hex");
        const nr = {
          id: "c" + (nextId++), name: clean(msg.name, 32) || p.name + "'s chess game", host: p.id,
          white: null, black: null, side: ["w", "b"].includes(msg.side) ? msg.side : "random",
          time: TIMES.includes(num(msg.time)) ? num(msg.time) : 0, inc: INCS.includes(num(msg.inc)) ? num(msg.inc) : 0,
          salt, pass: pw ? hashPass(salt, pw) : null, state: "waiting", game: null, moves: [], last: null,
          result: null, reason: null, drawOffer: null, rematch: new Set(), clock: { w: 0, b: 0, turnStart: 0 }, flag: null, gameNo: 0,
        };
        rooms.set(nr.id, nr);
        join(p, nr);
        break;
      }
      case "chJoin": {
        const nr = rooms.get(msg.room);
        if (!nr) return send(p, { t: "err", msg: "That chess game doesn't exist any more." }), true;
        if (nr === r) return true;
        if (nr.pass) {
          p.tries = (p.tries || []).filter((t) => now - t < 60e3);
          if (p.tries.length >= 6) return send(p, { t: "err", code: "slow", msg: "Too many wrong passwords. Wait a minute and try again." }), true;
          if (hashPass(nr.salt, clean(msg.password, 32)) !== nr.pass) {
            p.tries.push(now);
            return send(p, { t: "err", code: "password", room: nr.id, msg: msg.password ? "Wrong password." : "This game has a password." }), true;
          }
        }
        if (r) leave(p);
        join(p, nr);
        break;
      }
      case "chLeave": leave(p); break;
      case "chMove": {
        if (!r || r.state !== "playing") return true;
        const color = r.white === p.id ? "w" : r.black === p.id ? "b" : null;
        if (!color || Chess.turn(r.game) !== color) return true;
        if (num(msg.n) !== r.moves.length) return true; // an old click
        const sq = (s) => typeof s === "string" && /^[a-h][1-8]$/.test(s);
        if (!sq(msg.from) || !sq(msg.to)) return true;
        const mv = { from: msg.from, to: msg.to };
        if (["q", "r", "b", "n"].includes(msg.promo)) mv.promo = msg.promo;
        const legal = Chess.legalMoves(r.game, mv.from).find((m) => m.to === mv.to && (m.promo || null) === (mv.promo || null));
        if (!legal) return update(r), true; // put their board back
        const next = Chess.move(r.game, mv);
        if (!next) return update(r), true;
        if (r.time) {
          const c = clockNow(r, now);
          if (c[color] <= 0) { endGame(r, color === "w" ? "b" : "w", "time"); update(r); listChanged(); return true; }
          r.clock[color] = c[color] + r.inc * 1000;
          r.clock.turnStart = now;
        }
        r.game = next;
        r.moves.push(legal.san);
        r.last = { from: mv.from, to: mv.to };
        if (r.drawOffer && r.drawOffer !== p.id) r.drawOffer = null; // moving declines their offer
        const st = Chess.status(next);
        if (st.over) { endGame(r, st.result, st.reason); listChanged(); }
        else armFlag(r);
        update(r);
        break;
      }
      case "chResign": {
        if (!r || r.state !== "playing") return true;
        endGame(r, r.white === p.id ? "b" : "w", "resign");
        update(r); listChanged();
        break;
      }
      case "chDraw": {
        if (!r || r.state !== "playing") return true;
        if (msg.a === "offer" && !r.drawOffer) r.drawOffer = p.id;
        else if (msg.a === "accept" && r.drawOffer && r.drawOffer !== p.id) endGame(r, "draw", "agreed");
        else if (msg.a === "decline" && r.drawOffer && r.drawOffer !== p.id) r.drawOffer = null;
        else return true;
        update(r); listChanged();
        break;
      }
      case "chRematch": {
        if (!r || r.state !== "over" || !(r.white && r.black)) return true;
        r.rematch.add(p.id);
        if (r.rematch.size >= 2) { const w = r.white; r.white = r.black; r.black = w; startGame(r); listChanged(); }
        update(r);
        break;
      }
      default: return false;
    }
    return true;
  }

  return { handle, leave, rooms, available: !!Chess, _armFlag: armFlag };
};
