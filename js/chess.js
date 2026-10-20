/*
 * chess.js
 * Chess rules and the Mii chess brain. No drawing code, so it runs in Node
 * (tests/chess.test.js) as well as the browser (global `Chess`).
 *
 * Squares are names "a1".."h8". Moves are { from, to, promo? } where promo is
 * "q" | "r" | "b" | "n". A game state is a plain JSON-friendly object:
 *   { fen, startFen, history: [SAN...], moves: [{from,to,promo?}...], keys: [position keys...] }
 * States are never changed: Chess.move returns a new one.
 *
 *   Chess.newGame()                       -> state at the start position
 *   Chess.fromFEN(fen) / Chess.toFEN(state)
 *   Chess.turn(state)                     -> "w" | "b"
 *   Chess.piece(state, "e4")              -> null | { color: "w"|"b", type: "p"|"n"|"b"|"r"|"q"|"k" }
 *   Chess.legalMoves(state, fromSq?)      -> [{ from, to, promo?, san, capture, check }]
 *   Chess.move(state, mv)                 -> new state, or null if illegal (mv may also be SAN or "e2e4")
 *   Chess.status(state)                   -> { over, result: "w"|"b"|"draw"|null, reason, check }
 *   Chess.aiMove(state, skill 0-100, rand?) -> a legal move for the side to move, or null
 *   Chess.evaluate(state)                 -> centipawns, + is good for white (a short search)
 *   Chess.captured(state)                 -> { w: [types white has taken], b: [types black has taken] }
 *   Chess.perft(state, depth), Chess.sqName(0..63), Chess.sqIndex("e4"), Chess.START_FEN
 *
 * Inside, the board is a 0x88 array and the search is alpha-beta with
 * quiescence, a transposition table and MVV-LVA / killer move ordering.
 * Skill decides how deep the Mii looks, how much it misjudges positions,
 * and how often it plays a careless move.
 */
(function (root) {
  "use strict";

  const WHITE = 0, BLACK = 8;
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const TYPE_CH = " pnbrqk";
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
  const BISHOP_D = [15, 17, -15, -17];
  const ROOK_D = [16, -16, 1, -1];
  const KING_D = [15, 16, 17, 1, -1, -15, -16, -17];
  const FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE = 3;
  const MAXPLY = 128;
  const MAXMOVES = 256;

  const enc = (from, to, promo, flag) => from | (to << 7) | (promo << 14) | (flag << 17);
  const mFrom = (m) => m & 127;
  const mTo = (m) => (m >> 7) & 127;
  const mPromo = (m) => (m >> 14) & 7;
  const mFlag = (m) => m >> 17;

  // castling rights: 1 = white O-O, 2 = white O-O-O, 4 = black O-O, 8 = black O-O-O
  const CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[0x00] = 15 & ~2; CASTLE_MASK[0x07] = 15 & ~1; CASTLE_MASK[0x04] = 15 & ~3;
  CASTLE_MASK[0x70] = 15 & ~8; CASTLE_MASK[0x77] = 15 & ~4; CASTLE_MASK[0x74] = 15 & ~12;

  // squares: names <-> 0x88 indexes
  const to88 = (i) => (i >> 3) * 16 + (i & 7);
  const from88 = (s) => (s >> 4) * 8 + (s & 7);
  function sqName(i) { return "abcdefgh"[i & 7] + ((i >> 3) + 1); }
  function sqIndex(name) {
    if (typeof name !== "string" || name.length !== 2) return -1;
    const f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
    return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
  }
  const name88 = (s) => "abcdefgh"[s & 7] + ((s >> 4) + 1);
  const idx88 = (name) => { const i = sqIndex(name); return i < 0 ? -1 : to88(i); };

  // ---------------------------------------------------------------------
  // Zobrist hashing (two 32-bit halves), from a fixed seed
  // ---------------------------------------------------------------------
  let seed = 0x9e3779b9 | 0;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZP1 = new Int32Array(16 * 128), ZP2 = new Int32Array(16 * 128);
  for (let i = 0; i < ZP1.length; i++) { ZP1[i] = rnd32(); ZP2[i] = rnd32(); }
  const ZC1 = new Int32Array(16), ZC2 = new Int32Array(16);
  for (let i = 0; i < 16; i++) { ZC1[i] = rnd32(); ZC2[i] = rnd32(); }
  const ZE1 = new Int32Array(128), ZE2 = new Int32Array(128);
  for (let i = 0; i < 128; i++) { ZE1[i] = rnd32(); ZE2[i] = rnd32(); }
  const ZS1 = rnd32(), ZS2 = rnd32();

  // ---------------------------------------------------------------------
  // Position: the fast mutable board used inside (make / unmake)
  // ---------------------------------------------------------------------
  function Position() {
    this.b = new Int8Array(128);
    this.side = WHITE;
    this.castle = 0;
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.king = [-1, -1];
    this.h1 = 0; this.h2 = 0;
    this.sp = 0;
    this.uCap = new Int8Array(MAXPLY * 4);
    this.uCastle = new Int8Array(MAXPLY * 4);
    this.uEp = new Int16Array(MAXPLY * 4);
    this.uHalf = new Int16Array(MAXPLY * 4);
    this.uH1 = new Int32Array(MAXPLY * 4);
    this.uH2 = new Int32Array(MAXPLY * 4);
  }

  Position.prototype.computeHash = function () {
    let h1 = 0, h2 = 0;
    for (let s = 0; s < 120; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.b[s];
      if (p) { h1 ^= ZP1[p * 128 + s]; h2 ^= ZP2[p * 128 + s]; }
    }
    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];
    if (this.ep >= 0) { h1 ^= ZE1[this.ep]; h2 ^= ZE2[this.ep]; }
    if (this.side === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
    this.h1 = h1; this.h2 = h2;
  };

  Position.prototype.attacked = function (sq, by) {
    const b = this.b;
    let s;
    if (by === WHITE) {
      s = sq - 15; if (!(s & 0x88) && b[s] === (WHITE | P)) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === (WHITE | P)) return true;
    } else {
      s = sq + 15; if (!(s & 0x88) && b[s] === (BLACK | P)) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === (BLACK | P)) return true;
    }
    const kn = by | N, ki = by | K, bi = by | B, ro = by | R, qu = by | Q;
    for (let i = 0; i < 8; i++) {
      s = sq + KNIGHT_D[i]; if (!(s & 0x88) && b[s] === kn) return true;
      s = sq + KING_D[i]; if (!(s & 0x88) && b[s] === ki) return true;
    }
    for (let i = 0; i < 4; i++) {
      let d = BISHOP_D[i];
      s = sq + d;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === bi || p === qu) return true; break; } s += d; }
      d = ROOK_D[i];
      s = sq + d;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === ro || p === qu) return true; break; } s += d; }
    }
    return false;
  };

  Position.prototype.inCheck = function () {
    return this.attacked(this.king[this.side >> 3], this.side ^ 8);
  };

  // Pseudo-legal moves into buf[off...]; returns the new end index.
  Position.prototype.gen = function (buf, off, capsOnly) {
    const b = this.b, us = this.side, them = us ^ 8;
    let n = off;
    const fwd = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, promoRank = us === WHITE ? 6 : 1;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p || (p & 8) !== us) continue;
      const t = p & 7;
      if (t === P) {
        const r = sq >> 4, to = sq + fwd;
        if (!b[to]) {
          if (r === promoRank) {
            buf[n++] = enc(sq, to, Q, 0);
            if (!capsOnly) { buf[n++] = enc(sq, to, R, 0); buf[n++] = enc(sq, to, B, 0); buf[n++] = enc(sq, to, N, 0); }
          } else if (!capsOnly) {
            buf[n++] = enc(sq, to, 0, 0);
            if (r === startRank && !b[to + fwd]) buf[n++] = enc(sq, to + fwd, 0, FLAG_DOUBLE);
          }
        }
        for (let k = -1; k <= 1; k += 2) {
          const c = to + k;
          if (c & 0x88) continue;
          const q = b[c];
          if (q && (q & 8) === them) {
            if (r === promoRank) {
              buf[n++] = enc(sq, c, Q, 0);
              if (!capsOnly) { buf[n++] = enc(sq, c, R, 0); buf[n++] = enc(sq, c, B, 0); buf[n++] = enc(sq, c, N, 0); }
            } else buf[n++] = enc(sq, c, 0, 0);
          } else if (c === this.ep && !q) buf[n++] = enc(sq, c, 0, FLAG_EP);
        }
      } else if (t === N || t === K) {
        const D = t === N ? KNIGHT_D : KING_D;
        for (let i = 0; i < 8; i++) {
          const to = sq + D[i];
          if (to & 0x88) continue;
          const q = b[to];
          if (!q) { if (!capsOnly) buf[n++] = enc(sq, to, 0, 0); }
          else if ((q & 8) === them) buf[n++] = enc(sq, to, 0, 0);
        }
      } else {
        const D = t === B ? BISHOP_D : t === R ? ROOK_D : KING_D;
        for (let i = 0; i < D.length; i++) {
          const d = D[i];
          let to = sq + d;
          while (!(to & 0x88)) {
            const q = b[to];
            if (!q) { if (!capsOnly) buf[n++] = enc(sq, to, 0, 0); }
            else { if ((q & 8) === them) buf[n++] = enc(sq, to, 0, 0); break; }
            to += d;
          }
        }
      }
    }
    if (!capsOnly && this.castle) {
      if (us === WHITE && b[0x04] === (WHITE | K)) {
        if ((this.castle & 1) && !b[0x05] && !b[0x06] && b[0x07] === (WHITE | R) &&
          !this.attacked(0x04, BLACK) && !this.attacked(0x05, BLACK) && !this.attacked(0x06, BLACK)) buf[n++] = enc(0x04, 0x06, 0, FLAG_CASTLE);
        if ((this.castle & 2) && !b[0x03] && !b[0x02] && !b[0x01] && b[0x00] === (WHITE | R) &&
          !this.attacked(0x04, BLACK) && !this.attacked(0x03, BLACK) && !this.attacked(0x02, BLACK)) buf[n++] = enc(0x04, 0x02, 0, FLAG_CASTLE);
      } else if (us === BLACK && b[0x74] === (BLACK | K)) {
        if ((this.castle & 4) && !b[0x75] && !b[0x76] && b[0x77] === (BLACK | R) &&
          !this.attacked(0x74, WHITE) && !this.attacked(0x75, WHITE) && !this.attacked(0x76, WHITE)) buf[n++] = enc(0x74, 0x76, 0, FLAG_CASTLE);
        if ((this.castle & 8) && !b[0x73] && !b[0x72] && !b[0x71] && b[0x70] === (BLACK | R) &&
          !this.attacked(0x74, WHITE) && !this.attacked(0x73, WHITE) && !this.attacked(0x72, WHITE)) buf[n++] = enc(0x74, 0x72, 0, FLAG_CASTLE);
      }
    }
    return n;
  };

  Position.prototype.make = function (m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
    const us = this.side, sp = this.sp++;
    const p = b[from];
    let cap = b[to], h1 = this.h1, h2 = this.h2;
    this.uCastle[sp] = this.castle; this.uEp[sp] = this.ep; this.uHalf[sp] = this.half;
    this.uH1[sp] = h1; this.uH2[sp] = h2;
    h1 ^= ZP1[p * 128 + from]; h2 ^= ZP2[p * 128 + from];
    if (cap) { h1 ^= ZP1[cap * 128 + to]; h2 ^= ZP2[cap * 128 + to]; }
    if (flag === FLAG_EP) {
      const cs = to + (us === WHITE ? -16 : 16);
      cap = b[cs]; b[cs] = 0;
      h1 ^= ZP1[cap * 128 + cs]; h2 ^= ZP2[cap * 128 + cs];
    }
    this.uCap[sp] = cap;
    const np = promo ? (us | promo) : p;
    b[to] = np; b[from] = 0;
    h1 ^= ZP1[np * 128 + to]; h2 ^= ZP2[np * 128 + to];
    if (flag === FLAG_CASTLE) {
      const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1, rk = us | R;
      b[rt] = rk; b[rf] = 0;
      h1 ^= ZP1[rk * 128 + rf] ^ ZP1[rk * 128 + rt]; h2 ^= ZP2[rk * 128 + rf] ^ ZP2[rk * 128 + rt];
    }
    if ((p & 7) === K) this.king[us >> 3] = to;
    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];
    if (this.ep >= 0) { h1 ^= ZE1[this.ep]; h2 ^= ZE2[this.ep]; }
    this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
    if (this.ep >= 0) { h1 ^= ZE1[this.ep]; h2 ^= ZE2[this.ep]; }
    this.half = (p & 7) === P || cap ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.side = us ^ 8;
    h1 ^= ZS1; h2 ^= ZS2;
    this.h1 = h1; this.h2 = h2;
  };

  Position.prototype.unmake = function (m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
    const sp = --this.sp;
    const us = this.side ^ 8;
    this.side = us;
    if (us === BLACK) this.full--;
    const moved = promo ? (us | P) : b[to];
    b[from] = moved;
    const cap = this.uCap[sp];
    if (flag === FLAG_EP) { b[to] = 0; b[to + (us === WHITE ? -16 : 16)] = cap; } else b[to] = cap;
    if (flag === FLAG_CASTLE) {
      const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
      b[rf] = b[rt]; b[rt] = 0;
    }
    if ((moved & 7) === K) this.king[us >> 3] = from;
    this.castle = this.uCastle[sp]; this.ep = this.uEp[sp]; this.half = this.uHalf[sp];
    this.h1 = this.uH1[sp]; this.h2 = this.uH2[sp];
  };

  // ---------------------------------------------------------------------
  // FEN
  // ---------------------------------------------------------------------
  function parseFEN(fen) {
    if (typeof fen !== "string") return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const pos = new Position();
    const rows = parts[0].split("/");
    if (rows.length !== 8) return null;
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= "1" && ch <= "8") { f += Number(ch); continue; }
        const t = TYPE_CH.indexOf(ch.toLowerCase());
        if (t <= 0 || f > 7) return null;
        const color = ch === ch.toLowerCase() ? BLACK : WHITE;
        const s = (7 - r) * 16 + f;
        pos.b[s] = color | t;
        if (t === K) pos.king[color >> 3] = s;
        f++;
      }
      if (f !== 8) return null;
    }
    if (pos.king[0] < 0 || pos.king[1] < 0) return null;
    if (parts[1] !== "w" && parts[1] !== "b") return null;
    pos.side = parts[1] === "w" ? WHITE : BLACK;
    const cs = parts[2] || "-";
    pos.castle = (cs.includes("K") ? 1 : 0) | (cs.includes("Q") ? 2 : 0) | (cs.includes("k") ? 4 : 0) | (cs.includes("q") ? 8 : 0);
    // drop rights that the board can't have
    if (pos.b[0x04] !== (WHITE | K)) pos.castle &= ~3;
    if (pos.b[0x07] !== (WHITE | R)) pos.castle &= ~1;
    if (pos.b[0x00] !== (WHITE | R)) pos.castle &= ~2;
    if (pos.b[0x74] !== (BLACK | K)) pos.castle &= ~12;
    if (pos.b[0x77] !== (BLACK | R)) pos.castle &= ~4;
    if (pos.b[0x70] !== (BLACK | R)) pos.castle &= ~8;
    pos.ep = parts[3] && parts[3] !== "-" ? idx88(parts[3]) : -1;
    pos.half = Math.max(0, parseInt(parts[4], 10) || 0);
    pos.full = Math.max(1, parseInt(parts[5], 10) || 1);
    pos.computeHash();
    return pos;
  }

  function boardFEN(pos) {
    let out = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = pos.b[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = TYPE_CH[p & 7];
        out += p & 8 ? ch : ch.toUpperCase();
      }
      if (empty) out += empty;
      if (r) out += "/";
    }
    return out;
  }
  function castleFEN(c) {
    const s = (c & 1 ? "K" : "") + (c & 2 ? "Q" : "") + (c & 4 ? "k" : "") + (c & 8 ? "q" : "");
    return s || "-";
  }
  // en passant square, only if a pawn could actually take there (so repetition works right)
  function realEp(pos) {
    if (pos.ep < 0) return -1;
    const pawn = pos.side | P, back = pos.side === WHITE ? -16 : 16;
    for (const d of [-1, 1]) { const s = pos.ep + back + d; if (!(s & 0x88) && pos.b[s] === pawn) return pos.ep; }
    return -1;
  }
  function posFEN(pos) {
    const ep = realEp(pos);
    return boardFEN(pos) + " " + (pos.side === WHITE ? "w" : "b") + " " + castleFEN(pos.castle) + " " + (ep >= 0 ? name88(ep) : "-") + " " + pos.half + " " + pos.full;
  }
  function posKey(pos) {
    const ep = realEp(pos);
    return boardFEN(pos) + " " + (pos.side === WHITE ? "w" : "b") + " " + castleFEN(pos.castle) + " " + (ep >= 0 ? name88(ep) : "-");
  }

  // a small cache so the UI can ask about the same state many times cheaply
  let cacheFen = null, cachePos = null;
  function posOf(state) {
    const fen = state && state.fen;
    if (fen === cacheFen && cachePos) return cachePos;
    const pos = parseFEN(fen);
    if (!pos) throw new Error("Chess: bad state");
    cacheFen = fen; cachePos = pos;
    return pos;
  }

  // ---------------------------------------------------------------------
  // Legal moves and SAN
  // ---------------------------------------------------------------------
  const apiBuf = new Int32Array(MAXMOVES);
  function legalList(pos) {
    const n = pos.gen(apiBuf, 0, false), out = [];
    const us = pos.side;
    for (let i = 0; i < n; i++) {
      const m = apiBuf[i];
      pos.make(m);
      if (!pos.attacked(pos.king[us >> 3], pos.side)) out.push(m);
      pos.unmake(m);
    }
    return out;
  }
  function hasLegal(pos) {
    const buf = new Int32Array(MAXMOVES);
    const n = pos.gen(buf, 0, false), us = pos.side;
    for (let i = 0; i < n; i++) {
      pos.make(buf[i]);
      const ok = !pos.attacked(pos.king[us >> 3], pos.side);
      pos.unmake(buf[i]);
      if (ok) return true;
    }
    return false;
  }
  function isCapture(pos, m) { return mFlag(m) === FLAG_EP || !!pos.b[mTo(m)]; }

  function sanOf(pos, m, legal) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), flag = mFlag(m);
    const t = pos.b[from] & 7;
    let s;
    if (flag === FLAG_CASTLE) s = to > from ? "O-O" : "O-O-O";
    else {
      const cap = isCapture(pos, m);
      if (t === P) s = (cap ? "abcdefgh"[from & 7] + "x" : "") + name88(to) + (promo ? "=" + TYPE_CH[promo].toUpperCase() : "");
      else {
        let sameFile = false, sameRank = false, other = false;
        for (const o of legal) {
          if (o === m || mTo(o) !== to || mFrom(o) === from || (pos.b[mFrom(o)] & 7) !== t) continue;
          other = true;
          if ((mFrom(o) & 7) === (from & 7)) sameFile = true;
          if ((mFrom(o) >> 4) === (from >> 4)) sameRank = true;
        }
        let dis = "";
        if (other) dis = !sameFile ? "abcdefgh"[from & 7] : !sameRank ? String((from >> 4) + 1) : name88(from);
        s = TYPE_CH[t].toUpperCase() + dis + (cap ? "x" : "") + name88(to);
      }
    }
    pos.make(m);
    const check = pos.inCheck();
    if (check) s += hasLegal(pos) ? "+" : "#";
    pos.unmake(m);
    return { san: s, check };
  }

  function apiMove(pos, m, legal) {
    const sc = sanOf(pos, m, legal);
    const o = { from: name88(mFrom(m)), to: name88(mTo(m)) };
    if (mPromo(m)) o.promo = TYPE_CH[mPromo(m)];
    o.san = sc.san;
    o.capture = isCapture(pos, m);
    o.check = sc.check;
    return o;
  }

  // ---------------------------------------------------------------------
  // Public state API
  // ---------------------------------------------------------------------
  function stateFromPos(pos) {
    const fen = posFEN(pos);
    return { fen, startFen: fen, history: [], moves: [], keys: [posKey(pos)] };
  }
  function newGame() { return fromFEN(START_FEN); }
  function fromFEN(fen) {
    const pos = parseFEN(fen);
    return pos ? stateFromPos(pos) : null;
  }
  function toFEN(state) { return state.fen; }
  function turn(state) { return state.fen.split(" ")[1] === "b" ? "b" : "w"; }
  function piece(state, sq) {
    const s = idx88(sq);
    if (s < 0) return null;
    const p = posOf(state).b[s];
    return p ? { color: p & 8 ? "b" : "w", type: TYPE_CH[p & 7] } : null;
  }
  function legalMoves(state, fromSq) {
    const pos = posOf(state);
    const legal = legalList(pos);
    const f = fromSq ? idx88(fromSq) : -1;
    const out = [];
    for (const m of legal) if (f < 0 || mFrom(m) === f) out.push(apiMove(pos, m, legal));
    return fromSq && f < 0 ? [] : out;
  }

  function findMove(pos, mv) {
    const legal = legalList(pos);
    if (typeof mv === "string") {
      const str = mv.trim();
      const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(str);
      if (uci) mv = { from: uci[1], to: uci[2], promo: uci[3] };
      else {
        const clean = (x) => x.replace(/[+#!?]/g, "").replace(/0/g, "O");
        for (const m of legal) if (clean(sanOf(pos, m, legal).san) === clean(str)) return { m, legal };
        return null;
      }
    }
    if (!mv) return null;
    const from = idx88(mv.from), to = idx88(mv.to);
    if (from < 0 || to < 0) return null;
    const want = mv.promo ? TYPE_CH.indexOf(String(mv.promo).toLowerCase()) : Q;
    for (const m of legal) {
      if (mFrom(m) !== from || mTo(m) !== to) continue;
      if (mPromo(m) && mPromo(m) !== want) continue;
      return { m, legal };
    }
    return null;
  }

  function move(state, mv) {
    let pos;
    try { pos = posOf(state); } catch (e) { return null; }
    const found = findMove(pos, mv);
    if (!found) return null;
    const { m, legal } = found;
    const am = apiMove(pos, m, legal);
    const work = parseFEN(state.fen);
    work.make(m);
    const rec = { from: am.from, to: am.to };
    if (am.promo) rec.promo = am.promo;
    return {
      fen: posFEN(work),
      startFen: state.startFen || state.fen,
      history: (state.history || []).concat([am.san]),
      moves: (state.moves || []).concat([rec]),
      keys: (state.keys || []).concat([posKey(work)]),
    };
  }

  function insufficient(pos) {
    let minors = 0, bishopsLight = 0, bishopsDark = 0, knights = 0;
    for (let s = 0; s < 120; s++) {
      if (s & 0x88) { s += 7; continue; }
      const t = pos.b[s] & 7;
      if (t === P || t === R || t === Q) return false;
      if (t === N) { knights++; minors++; }
      if (t === B) { minors++; if (((s >> 4) + (s & 7)) & 1) bishopsLight++; else bishopsDark++; }
    }
    if (minors <= 1) return true;
    return knights === 0 && (bishopsLight === 0 || bishopsDark === 0);
  }

  function status(state) {
    const pos = posOf(state);
    const check = pos.inCheck();
    const moves = hasLegal(pos);
    const side = pos.side === WHITE ? "w" : "b";
    if (!moves) return check
      ? { over: true, result: side === "w" ? "b" : "w", reason: "checkmate", check }
      : { over: true, result: "draw", reason: "stalemate", check };
    if (insufficient(pos)) return { over: true, result: "draw", reason: "material", check };
    const keys = state.keys || [];
    const last = keys[keys.length - 1];
    let reps = 0;
    for (const k of keys) if (k === last) reps++;
    if (reps >= 3) return { over: true, result: "draw", reason: "repetition", check };
    if (pos.half >= 100) return { over: true, result: "draw", reason: "fifty", check };
    return { over: false, result: null, reason: null, check };
  }

  function perftPos(pos, depth, buf, ply) {
    const off = ply * MAXMOVES;
    const n = pos.gen(buf, off, false), us = pos.side;
    let total = 0;
    for (let i = off; i < n; i++) {
      const m = buf[i];
      pos.make(m);
      if (!pos.attacked(pos.king[us >> 3], pos.side)) total += depth <= 1 ? 1 : perftPos(pos, depth - 1, buf, ply + 1);
      pos.unmake(m);
    }
    return total;
  }
  function perft(state, depth) {
    if (depth <= 0) return 1;
    return perftPos(parseFEN(state.fen), depth, new Int32Array(MAXMOVES * (depth + 1)), 0);
  }

  const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  function captured(state) {
    const pos = posOf(state);
    const left = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (let s = 0; s < 120; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = pos.b[s];
      if (!p || (p & 7) === K) continue;
      left[p & 8 ? "b" : "w"][TYPE_CH[p & 7]]++;
    }
    const out = { w: [], b: [] };
    for (const color of ["w", "b"]) {
      const taker = color === "w" ? "b" : "w";
      // a promoted pawn counts as a missing pawn
      let extra = 0;
      for (const t of ["q", "r", "b", "n"]) extra += Math.max(0, left[color][t] - START_COUNT[t]);
      for (const t of ["q", "r", "b", "n", "p"]) {
        let miss = START_COUNT[t] - left[color][t];
        if (t === "p") miss -= extra;
        for (let i = 0; i < miss; i++) out[taker].push(t);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Evaluation (centipawns, from the side to move's point of view)
  // ---------------------------------------------------------------------
  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const PHASE_W = [0, 0, 1, 1, 2, 4, 0];
  // tables are written rank 8 first, from white's point of view
  const PST_SRC = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    7: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };
  // PST[piece][sq88]: material + square bonus for that piece's own side (kings: mg in PST, eg in KEG)
  const PST = [];
  const KEG = [new Int16Array(128), new Int16Array(128)];
  for (let p = 0; p < 16; p++) PST.push(new Int16Array(128));
  for (let t = 1; t <= 6; t++) {
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      const r = s >> 4, f = s & 7;
      const wi = (7 - r) * 8 + f, bi = r * 8 + f;
      PST[WHITE | t][s] = VAL[t] + PST_SRC[t][wi];
      PST[BLACK | t][s] = VAL[t] + PST_SRC[t][bi];
      if (t === K) { KEG[0][s] = PST_SRC[7][wi]; KEG[1][s] = PST_SRC[7][bi]; }
    }
  }
  const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];
  const CENTER_DIST = new Int8Array(128);
  for (let s = 0; s < 128; s++) if (!(s & 0x88)) {
    const r = s >> 4, f = s & 7;
    CENTER_DIST[s] = Math.max(3 - r, r - 4) + Math.max(3 - f, f - 4);
  }

  const wMin = new Int8Array(8), wMax = new Int8Array(8), bMin = new Int8Array(8), bMax = new Int8Array(8);
  const wCnt = new Int8Array(8), bCnt = new Int8Array(8);

  function evaluate(pos) {
    const b = pos.b;
    let mat = 0, phase = 0, kmg = 0, keg = 0, wB = 0, bB = 0, wMat = 0, bMat = 0, wPawns = 0, bPawns = 0;
    wMin.fill(8); bMin.fill(8); wMax.fill(-1); bMax.fill(-1); wCnt.fill(0); bCnt.fill(0);
    let rooks = 0, rookSq0 = -1, rookSq1 = -1, rookSq2 = -1, rookSq3 = -1;
    for (let s = 0; s < 120; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p) continue;
      const t = p & 7, black = p & 8;
      if (t === K) {
        if (black) { kmg -= PST[p][s]; keg -= KEG[1][s]; } else { kmg += PST[p][s]; keg += KEG[0][s]; }
        continue;
      }
      phase += PHASE_W[t];
      if (black) { mat -= PST[p][s]; if (t !== P) bMat += VAL[t]; } else { mat += PST[p][s]; if (t !== P) wMat += VAL[t]; }
      if (t === P) {
        const r = s >> 4, f = s & 7;
        if (black) { bPawns++; bCnt[f]++; if (r < bMin[f]) bMin[f] = r; if (r > bMax[f]) bMax[f] = r; }
        else { wPawns++; wCnt[f]++; if (r < wMin[f]) wMin[f] = r; if (r > wMax[f]) wMax[f] = r; }
      } else if (t === B) { if (black) bB++; else wB++; }
      else if (t === R && rooks < 4) {
        const v = black ? -(s + 1) : s + 1;
        if (rooks === 0) rookSq0 = v; else if (rooks === 1) rookSq1 = v; else if (rooks === 2) rookSq2 = v; else rookSq3 = v;
        rooks++;
      }
    }
    if (phase > 24) phase = 24;
    const eg = 24 - phase;
    let score = mat + ((kmg * phase + keg * eg) / 24 | 0);
    if (wB >= 2) score += 30;
    if (bB >= 2) score -= 30;

    // pawn structure
    let pawnScore = 0, passedScore = 0;
    for (let f = 0; f < 8; f++) {
      if (wCnt[f]) {
        if (wCnt[f] > 1) pawnScore -= 12 * (wCnt[f] - 1);
        if ((f === 0 || !wCnt[f - 1]) && (f === 7 || !wCnt[f + 1])) pawnScore -= 12 * wCnt[f];
        // the most advanced white pawn on this file: passed if no black pawn ahead on this or nearby files
        const r = wMax[f];
        let passed = true;
        for (let g = f - 1; g <= f + 1; g++) if (g >= 0 && g < 8 && bMax[g] > r) { passed = false; break; }
        if (passed) passedScore += PASSED[r];
      }
      if (bCnt[f]) {
        if (bCnt[f] > 1) pawnScore += 12 * (bCnt[f] - 1);
        if ((f === 0 || !bCnt[f - 1]) && (f === 7 || !bCnt[f + 1])) pawnScore += 12 * bCnt[f];
        const r = bMin[f];
        let passed = true;
        for (let g = f - 1; g <= f + 1; g++) if (g >= 0 && g < 8 && wMin[g] < 8 && wMin[g] < r) { passed = false; break; }
        if (passed) passedScore -= PASSED[7 - r];
      }
    }
    score += pawnScore + ((passedScore * (12 + eg)) / 24 | 0);

    // rooks on open / half-open files
    const rookFile = (v) => {
      if (!v) return 0;
      const black = v < 0, s = (black ? -v : v) - 1, f = s & 7;
      const own = black ? bCnt[f] : wCnt[f], opp = black ? wCnt[f] : bCnt[f];
      const bonus = own ? 0 : opp ? 10 : 20;
      return black ? -bonus : bonus;
    };
    if (rooks) score += rookFile(rookSq0 === -1 ? 0 : rookSq0) + rookFile(rookSq1 === -1 ? 0 : rookSq1) + rookFile(rookSq2 === -1 ? 0 : rookSq2) + rookFile(rookSq3 === -1 ? 0 : rookSq3);

    // king safety: a pawn shield in front of a castled king (middlegame only)
    if (phase > 6) {
      let shield = 0;
      const wk = pos.king[0], bk = pos.king[1];
      if ((wk >> 4) <= 1) for (let d = 15; d <= 17; d++) {
        if (b[wk + d] === (WHITE | P)) shield += 10; else if (!((wk + d + 16) & 0x88) && b[wk + d + 16] === (WHITE | P)) shield += 5;
      }
      if ((bk >> 4) >= 6) for (let d = 15; d <= 17; d++) {
        if (b[bk - d] === (BLACK | P)) shield -= 10; else if (!((bk - d - 16) & 0x88) && b[bk - d - 16] === (BLACK | P)) shield -= 5;
      }
      score += (shield * phase / 24) | 0;
    }

    // endgame "mop-up": the side that's well ahead drives the other king to the edge
    const diff = wMat - bMat + (wPawns - bPawns) * 100;
    if (phase <= 8 && (diff >= 400 || diff <= -400)) {
      const wk = pos.king[0], bk = pos.king[1];
      const dist = Math.abs((wk >> 4) - (bk >> 4)) + Math.abs((wk & 7) - (bk & 7));
      const loserK = diff > 0 ? bk : wk;
      const mop = 10 * CENTER_DIST[loserK] + 4 * (14 - dist);
      score += diff > 0 ? mop : -mop;
    }

    score = pos.side === WHITE ? score : -score;
    return score + 10; // tempo
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  const MATE = 30000, INF = 32000;
  const TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int32Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE), ttUsed = new Uint8Array(TT_SIZE);
  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
  const moveBuf = new Int32Array(MAXPLY * MAXMOVES), scoreBuf = new Int32Array(MAXPLY * MAXMOVES);
  const killers = new Int32Array(MAXPLY * 2);
  const history = new Int32Array(16 * 128);
  const hashHist = new Int32Array(1024);
  let hashLen = 0;
  const S = { pos: null, nodes: 0, stop: false, deadline: 0, canStop: false, qMax: 8, extend: true };
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  function isRepetition(pos) {
    const cur = hashHist[hashLen - 1];
    const stop = Math.max(0, hashLen - 1 - pos.half);
    for (let i = hashLen - 3; i >= stop; i -= 2) if (hashHist[i] === cur) return true;
    return false;
  }

  function scoreMoves(pos, off, end, ttM, ply) {
    const b = pos.b;
    for (let i = off; i < end; i++) {
      const m = moveBuf[i];
      if (m === ttM) { scoreBuf[i] = 2000000; continue; }
      const to = (m >> 7) & 127, victim = (m >> 17) === FLAG_EP ? P : b[to] & 7, promo = (m >> 14) & 7;
      if (victim || promo) scoreBuf[i] = 1000000 + VAL[victim] * 10 - (b[m & 127] & 7) + (promo === Q ? 9000 : 0);
      else if (m === killers[ply * 2]) scoreBuf[i] = 900000;
      else if (m === killers[ply * 2 + 1]) scoreBuf[i] = 800000;
      else scoreBuf[i] = history[(b[m & 127]) * 128 + to];
    }
  }
  function pickNext(i, end) {
    let best = i;
    for (let j = i + 1; j < end; j++) if (scoreBuf[j] > scoreBuf[best]) best = j;
    if (best !== i) {
      const m = moveBuf[i]; moveBuf[i] = moveBuf[best]; moveBuf[best] = m;
      const s = scoreBuf[i]; scoreBuf[i] = scoreBuf[best]; scoreBuf[best] = s;
    }
    return moveBuf[i];
  }

  function qsearch(alpha, beta, ply, qd) {
    if ((++S.nodes & 1023) === 0 && S.canStop && now() > S.deadline) S.stop = true;
    if (S.stop) return 0;
    const pos = S.pos;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (qd >= S.qMax || ply >= MAXPLY - 1) return stand;
    if (stand > alpha) alpha = stand;
    const off = ply * MAXMOVES;
    const end = pos.gen(moveBuf, off, true);
    scoreMoves(pos, off, end, 0, ply);
    const us = pos.side;
    for (let i = off; i < end; i++) {
      const m = pickNext(i, end);
      const victim = (m >> 17) === FLAG_EP ? P : pos.b[(m >> 7) & 127] & 7;
      if (!((m >> 14) & 7) && stand + VAL[victim] + 200 < alpha) continue; // can't possibly help
      pos.make(m);
      if (pos.attacked(pos.king[us >> 3], pos.side)) { pos.unmake(m); continue; }
      const sc = -qsearch(-beta, -alpha, ply + 1, qd + 1);
      pos.unmake(m);
      if (S.stop) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply) {
    if ((++S.nodes & 1023) === 0 && S.canStop && now() > S.deadline) S.stop = true;
    if (S.stop) return 0;
    const pos = S.pos;
    if (ply > 0) {
      if (pos.half >= 100 || isRepetition(pos)) return 0;
      // mate distance pruning
      const ma = -MATE + ply, mb = MATE - ply - 1;
      if (alpha < ma) alpha = ma;
      if (beta > mb) beta = mb;
      if (alpha >= beta) return alpha;
    }
    const us = pos.side;
    const inCheck = pos.attacked(pos.king[us >> 3], us ^ 8);
    if (inCheck && S.extend && ply < 12) depth++;
    if (depth <= 0) return qsearch(alpha, beta, ply, 0);
    if (ply >= MAXPLY - 2) return evaluate(pos);

    const ti = pos.h1 & TT_MASK;
    let ttM = 0;
    if (ttUsed[ti] && ttKey[ti] === pos.h2) {
      ttM = ttMove[ti];
      if (ttDepth[ti] >= depth) {
        let sc = ttScore[ti];
        if (sc > MATE - 200) sc -= ply; else if (sc < -MATE + 200) sc += ply;
        const fl = ttFlag[ti];
        if (fl === TT_EXACT || (fl === TT_LOWER && sc >= beta) || (fl === TT_UPPER && sc <= alpha)) return sc;
      }
    }

    const off = ply * MAXMOVES;
    const end = pos.gen(moveBuf, off, false);
    scoreMoves(pos, off, end, ttM, ply);
    const origAlpha = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    for (let i = off; i < end; i++) {
      const m = pickNext(i, end);
      pos.make(m);
      if (pos.attacked(pos.king[us >> 3], pos.side)) { pos.unmake(m); continue; }
      legal++;
      hashHist[hashLen++] = pos.h1;
      const sc = -search(depth - 1, -beta, -alpha, ply + 1);
      hashLen--;
      pos.unmake(m);
      if (S.stop) return 0;
      if (sc > best) {
        best = sc; bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            const quiet = !pos.b[(m >> 7) & 127] && (m >> 17) !== FLAG_EP && !((m >> 14) & 7);
            if (quiet) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              history[pos.b[m & 127] * 128 + ((m >> 7) & 127)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    let store = best;
    if (store > MATE - 200) store += ply; else if (store < -MATE + 200) store -= ply;
    ttUsed[ti] = 1; ttKey[ti] = pos.h2; ttMove[ti] = bestMove; ttScore[ti] = store; ttDepth[ti] = depth;
    ttFlag[ti] = best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    return best;
  }

  // Scores every root move. Moves within `margin` of the best get exact
  // scores; worse ones only get an upper bound (that's all we need).
  function rootSearch(pos, gameHashes, maxDepth, margin, budgetMs) {
    S.pos = pos; S.nodes = 0; S.stop = false; S.canStop = false;
    const start = now();
    S.deadline = start + budgetMs;
    ttUsed.fill(0); killers.fill(0); history.fill(0);
    hashLen = 0;
    for (const h of gameHashes) hashHist[hashLen++] = h;
    hashHist[hashLen++] = pos.h1;
    const legal = legalList(pos);
    const root = legal.map((m) => ({ m, score: 0, cur: 0 }));
    if (!root.length) return root;
    const us = pos.side;
    let done = 0;
    for (let d = 1; d <= maxDepth; d++) {
      let best = -INF;
      for (const rm of root) {
        const alpha = best === -INF ? -INF : Math.max(-INF, best - margin);
        pos.make(rm.m);
        hashHist[hashLen++] = pos.h1;
        const sc = -search(d - 1, -INF, -alpha, 1);
        hashLen--;
        pos.unmake(rm.m);
        if (S.stop) break;
        rm.cur = sc;
        if (sc > best) best = sc;
      }
      if (S.stop) break;
      for (const rm of root) rm.score = rm.cur;
      root.sort((a, b) => b.score - a.score);
      done = d;
      S.canStop = true;
      if (best > MATE - 200 || best < -MATE + 200) break; // forced mate found
      if (now() - start > budgetMs * 0.3) break; // the next depth would take too long
    }
    void us;
    root.depth = done;
    root.nodes = S.nodes;
    return root;
  }

  function gameHashes(state) {
    // hashes of earlier positions since the last pawn move or capture (for repetition)
    const keys = state.keys || [];
    const pos = posOf(state);
    const out = [];
    const from = Math.max(0, keys.length - 1 - pos.half);
    for (let i = from; i < keys.length - 1; i++) {
      const p = parseFEN(keys[i] + " 0 1");
      if (p) out.push(p.h1);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Opening book (coordinate moves): Miis know a few common openings
  // ---------------------------------------------------------------------
  const BOOK = [
    "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6",
    "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8",
    "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8e7 e1g1 e8g8",
    "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5",
    "e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3",
    "e2e4 e7e5 b1c3 g8f6 g1f3 b8c6 f1b5 f8b4",
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5",
    "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6",
    "e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7",
    "e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6",
    "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7",
    "e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6",
    "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6",
    "e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6",
    "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5",
    "e2e4 g8f6 e4e5 f6d5 d2d4 d7d6 g1f3 c8g4",
    "e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f1e2 f8g7",
    "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7",
    "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5",
    "d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6",
    "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5",
    "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5",
    "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8",
    "d2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6",
    "d2d4 g8f6 g1f3 g7g6 c1f4 f8g7 e2e3 e8g8",
    "d2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7",
    "c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5",
    "c2c4 g8f6 b1c3 e7e6 e2e4 c7c5",
    "c2c4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7",
    "g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8",
    "g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8",
  ].map((l) => l.split(" "));

  function bookMove(state, rand) {
    if (state.startFen !== START_FEN) return null;
    const played = (state.moves || []).map((m) => m.from + m.to + (m.promo || ""));
    const options = [];
    for (const line of BOOK) {
      if (line.length <= played.length) continue;
      let ok = true;
      for (let i = 0; i < played.length; i++) if (line[i] !== played[i]) { ok = false; break; }
      if (ok) options.push(line[played.length]);
    }
    if (!options.length) return null;
    const pickd = options[Math.floor(rand() * options.length)];
    return { from: pickd.slice(0, 2), to: pickd.slice(2, 4) };
  }

  // ---------------------------------------------------------------------
  // The Mii brain
  // ---------------------------------------------------------------------
  // How a Mii plays at a given skill (0-100). Everything changes smoothly
  // except the search depth, which steps 1 -> 2 -> 3.
  function profile(skill) {
    const s = Math.max(0, Math.min(100, Number(skill) || 0)) / 100;
    const weak = 1 - s;
    return {
      s,
      depth: s < 0.15 ? 1 : s < 0.5 ? 2 : 3,
      qMax: s < 0.2 ? 0 : Math.round(2 + (s - 0.2) * 10), // how far it follows captures (0 = it doesn't see recaptures)
      extend: s >= 0.6, // looks further when in check
      noise: 12 + 130 * Math.pow(weak, 2), // how much it misjudges moves (centipawns)
      randomChance: 0.4 * Math.pow(weak, 3.5), // plays a "beginner" move without thinking
      blunderChance: 0.025 + 0.2 * Math.pow(weak, 1.3), // plays a worse move than it found
      blunderLimit: 60 + 600 * Math.pow(weak, 1.5), // ...but at most this much worse
      book: 0.25 + 0.75 * s,
    };
  }

  function gauss(rand) {
    let u = rand(); if (u < 1e-9) u = 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  function aiMove(state, skill, rand) {
    rand = rand || Math.random;
    let pos;
    try { pos = parseFEN(state.fen); } catch (e) { return null; }
    if (!pos) return null;
    const legal = legalList(pos);
    if (!legal.length) return null;
    const pr = profile(skill);
    const toApi = (m) => apiMove(pos, m, legal);
    if (legal.length === 1) return toApi(legal[0]);

    // the opening book
    if (rand() < pr.book) {
      const bm = bookMove(state, rand);
      if (bm) { const f = findMove(pos, bm); if (f) return toApi(f.m); }
    }

    // a beginner's move: whatever catches its eye, especially taking something
    if (rand() < pr.randomChance) {
      const weights = legal.map((m) => (isCapture(pos, m) ? 4 : 1));
      let total = weights.reduce((a, b) => a + b, 0), r = rand() * total;
      for (let i = 0; i < legal.length; i++) { r -= weights[i]; if (r <= 0) return toApi(legal[i]); }
    }

    S.qMax = pr.qMax;
    S.extend = pr.extend;
    const margin = Math.round(Math.max(pr.blunderLimit, pr.noise * 3) + 40);
    const root = rootSearch(pos, gameHashes(state), pr.depth, margin, 550);
    S.pos = null;
    const best = root[0];
    // never miss a forced mate it found (or walk into one it could avoid) at high skill
    const mateFound = best.score > MATE - 200;

    // a careless moment: a worse (but not much worse) move than the best
    if (!mateFound && rand() < pr.blunderChance && root.length > 1) {
      const ok = root.slice(1).filter((r) => r.score >= best.score - pr.blunderLimit && r.score > -MATE + 200);
      if (ok.length) return toApi(ok[Math.floor(rand() * ok.length)].m);
    }

    // judge each move with some noise; better Miis misjudge less
    let pickd = best, top = -Infinity;
    for (const r of root) {
      const isMate = r.score > MATE - 200;
      if (mateFound && pr.s >= 0.5 && !isMate) continue;
      const v = r.score + (isMate ? 0 : gauss(rand) * pr.noise);
      if (v > top) { top = v; pickd = r; }
    }
    return toApi(pickd.m);
  }

  // A short search: how the position looks (centipawns, + = good for white).
  function evaluateState(state) {
    const pos = parseFEN(state.fen);
    const st = status(state);
    if (st.over) return st.result === "w" ? MATE : st.result === "b" ? -MATE : 0;
    S.qMax = 8; S.extend = true;
    const root = rootSearch(pos, gameHashes(state), 2, 0, 300);
    S.pos = null;
    const sc = root.length ? root[0].score : 0;
    return pos.side === WHITE ? sc : -sc;
  }

  // For game reviews: a deeper look at a position. score = centipawns (+ = good for white),
  // best = the engine's best move there (with its SAN), or null when the game is over.
  function analyze(state, depth) {
    const pos = parseFEN(state.fen);
    const st = status(state);
    if (st.over) return { score: st.result === "w" ? MATE : st.result === "b" ? -MATE : 0, best: null };
    S.qMax = 8; S.extend = true;
    const legalInt = legalList(pos);
    const root = rootSearch(pos, gameHashes(state), depth || 3, 0, 450);
    S.pos = null;
    if (!root.length) return { score: 0, best: null };
    const sc = root[0].score;
    const bm = apiMove(parseFEN(state.fen), root[0].m, legalInt);
    const legal = legalMoves(state, bm.from).find((m) => m.to === bm.to && (m.promo || null) === (bm.promo || null));
    return { score: pos.side === WHITE ? sc : -sc, best: legal || bm };
  }

  const api = {
    START_FEN, newGame, fromFEN, toFEN, turn, piece, legalMoves, move, status, aiMove,
    evaluate: evaluateState, analyze, MATE, captured, perft, sqName, sqIndex, profile,
    lastMove: (state) => (state.moves && state.moves.length ? state.moves[state.moves.length - 1] : null),
    BOOK_LINES: BOOK.map((l) => l.join(" ")),
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Chess = api;
})(typeof self !== "undefined" ? self : this);
