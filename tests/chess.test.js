// Run with: node tests/chess.test.js
// Checks the chess rules (move generator, endings, FEN) and that a Mii's
// chess skill really changes how well it plays (without being Stockfish).
const assert = require("assert");
const C = require("../js/chess.js");

// a repeatable random number generator, so test results don't change
function seeded(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const play = (state, ...moves) => moves.reduce((st, m) => { const n = C.move(st, m); assert.ok(n, "move " + m + " should be legal"); return n; }, state);

// ---- perft: counts every position a few moves deep, so the move generator must be exact ----
const start = C.newGame();
assert.deepStrictEqual([1, 2, 3].map((d) => C.perft(start, d)), [20, 400, 8902], "perft from the start position");
const kiwipete = C.fromFEN("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
assert.deepStrictEqual([1, 2].map((d) => C.perft(kiwipete, d)), [48, 2039], "perft Kiwipete");
assert.strictEqual(C.perft(C.fromFEN("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 3), 2812, "perft position 3 (en passant and pins)");
assert.strictEqual(C.perft(C.fromFEN("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 3), 9467, "perft position 4 (promotions)");
assert.strictEqual(C.legalMoves(start).length, 20);
assert.strictEqual(C.legalMoves(kiwipete).length, 48);

// ---- basic API ----
assert.strictEqual(C.turn(start), "w");
assert.deepStrictEqual(C.piece(start, "e1"), { color: "w", type: "k" });
assert.deepStrictEqual(C.piece(start, "d8"), { color: "b", type: "q" });
assert.strictEqual(C.piece(start, "e4"), null);
assert.strictEqual(C.move(start, { from: "e2", to: "e5" }), null, "illegal moves give null");
assert.strictEqual(C.move(start, { from: "e7", to: "e5" }), null, "can't move the other side's pieces");
const e4 = C.move(start, { from: "e2", to: "e4" });
assert.strictEqual(C.toFEN(start), C.START_FEN, "the old state doesn't change");
assert.strictEqual(start.history.length, 0);
assert.strictEqual(C.toFEN(e4), "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
assert.deepStrictEqual(e4.history, ["e4"]);
assert.strictEqual(C.turn(e4), "b");
assert.deepStrictEqual(C.legalMoves(start, "g1").map((m) => m.san).sort(), ["Nf3", "Nh3"], "knight moves from g1");
assert.deepStrictEqual(C.legalMoves(C.move(start, "Nf3"), "b8").map((m) => m.to).sort(), ["a6", "c6"]);
assert.ok(C.move(start, "Nf3") && C.move(start, "g1f3"), "SAN and coordinate strings work too");
const kiwiSan = C.legalMoves(kiwipete).map((m) => m.san);
assert.ok(kiwiSan.includes("O-O") && kiwiSan.includes("O-O-O"), "castling both ways in Kiwipete");
assert.ok(kiwiSan.includes("Bxa6") && kiwiSan.includes("Nxf7") && kiwiSan.includes("Qxf6"));
assert.ok(C.legalMoves(kiwipete).find((m) => m.san === "Qxf6").capture);

// castling isn't allowed through check
const throughCheck = C.fromFEN("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
assert.ok(!C.legalMoves(throughCheck).some((m) => m.san === "O-O"), "can't castle through an attacked square");

// ---- FEN and JSON round trips ----
for (const fen of [C.START_FEN, "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "8/8/8/4k3/8/8/4K3/4R3 b - - 37 80", "r3k3/8/8/8/8/8/8/4K2R w Kq - 3 20"]) {
  assert.strictEqual(C.toFEN(C.fromFEN(fen)), fen, "FEN round trip: " + fen);
}
assert.strictEqual(C.fromFEN("not a fen"), null);
let game = play(start, "e4", "e5", "Nf3", "Nc6");
const copy = JSON.parse(JSON.stringify(game));
assert.strictEqual(C.toFEN(copy), C.toFEN(game));
assert.deepStrictEqual(C.legalMoves(copy), C.legalMoves(game), "a state still works after a JSON round trip");
assert.strictEqual(C.toFEN(C.move(copy, "Bb5")), "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3");

// ---- en passant ----
let ep = play(start, "e4", "a6", "e5", "d5");
const epMove = C.legalMoves(ep, "e5").find((m) => m.to === "d6");
assert.ok(epMove && epMove.capture && epMove.san === "exd6", "en passant is legal right after the double step");
ep = C.move(ep, { from: "e5", to: "d6" });
assert.strictEqual(C.piece(ep, "d5"), null, "en passant removes the passed pawn");
assert.deepStrictEqual(C.piece(ep, "d6"), { color: "w", type: "p" });
assert.ok(!C.legalMoves(play(start, "e4", "a6", "e5", "d5", "a3", "a5"), "e5").some((m) => m.to === "d6"), "only straight after the double step");
const epPinned = C.fromFEN("8/8/8/KPp4r/8/8/8/7k w - c6 0 1");
assert.ok(!C.legalMoves(epPinned).some((m) => m.to === "c6"), "en passant that exposes the king is illegal");

// ---- promotion ----
const promo = C.fromFEN("8/P7/8/8/8/8/8/k6K w - - 0 1");
const promos = C.legalMoves(promo, "a7");
assert.strictEqual(promos.length, 4, "4 entries for a promoting move");
assert.deepStrictEqual(promos.map((m) => m.promo).sort(), ["b", "n", "q", "r"]);
const knighted = C.move(promo, { from: "a7", to: "a8", promo: "n" });
assert.deepStrictEqual(C.piece(knighted, "a8"), { color: "w", type: "n" });
assert.strictEqual(knighted.history[0], "a8=N");
assert.deepStrictEqual(C.piece(C.move(promo, { from: "a7", to: "a8" }), "a8"), { color: "w", type: "q" }, "promotes to a queen by default");
assert.ok(promos.find((m) => m.promo === "q").check, "a8=Q gives check along the rank");

// ---- endings ----
const fools = play(start, "f3", "e5", "g4", "Qh4");
assert.deepStrictEqual(C.status(fools), { over: true, result: "b", reason: "checkmate", check: true });
assert.strictEqual(fools.history[3], "Qh4#");
assert.strictEqual(C.legalMoves(fools).length, 0);
assert.strictEqual(C.aiMove(fools, 50), null, "no move when the game is over");
const stale = C.fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
assert.deepStrictEqual(C.status(stale), { over: true, result: "draw", reason: "stalemate", check: false });
let rep = start;
for (let i = 0; i < 2; i++) rep = play(rep, "Nf3", "Nf6", "Ng1", "Ng8");
assert.deepStrictEqual(C.status(rep), { over: true, result: "draw", reason: "repetition", check: false }, "the start position 3 times");
assert.strictEqual(C.status(play(start, "Nf3", "Nf6", "Ng1", "Ng8")).over, false, "twice isn't enough");
const fifty = C.move(C.fromFEN("8/8/8/4k3/8/8/4K3/4R3 w - - 99 80"), "Ra1");
assert.deepStrictEqual(C.status(fifty), { over: true, result: "draw", reason: "fifty", check: false });
assert.strictEqual(C.status(C.fromFEN("8/8/8/4k3/8/8/4K3/4R3 w - - 98 80")).over, false);
assert.strictEqual(C.status(C.fromFEN("8/8/8/4k3/8/8/4K3/4B3 w - - 0 1")).reason, "material", "K+B vs K is a draw");
assert.strictEqual(C.status(C.fromFEN("8/8/8/4k3/8/8/4K3/8 w - - 0 1")).reason, "material");
assert.strictEqual(C.status(C.fromFEN("8/8/3b4/4k3/8/8/4K3/4B3 w - - 0 1")).reason, "material", "bishops on the same color");
assert.strictEqual(C.status(C.fromFEN("8/8/2b5/4k3/8/8/4K3/4B3 w - - 0 1")).over, false, "bishops on different colors can still mate");
assert.strictEqual(C.status(C.fromFEN("8/8/8/4k3/8/8/4K3/4P3 w - - 0 1")).over, false);
// captured pieces
assert.deepStrictEqual(C.captured(play(start, "e4", "d5", "exd5", "Qxd5")), { w: ["p"], b: ["p"] });

// ---- the opening book only has legal lines ----
for (const line of C.BOOK_LINES) {
  let st = start;
  for (const mv of line.split(" ")) { st = C.move(st, mv); assert.ok(st, "book move " + mv + " in " + line); }
}

// ---- the Mii brain ----
// always returns a legal move, at every skill
let rand = seeded(9);
for (const skill of [0, 13, 37, 50, 64, 88, 100]) {
  const mv = C.aiMove(kiwipete, skill, rand);
  assert.ok(mv && C.move(kiwipete, mv), "skill " + skill + " plays a legal move");
}

// a master Mii never misses mate in one
const mateIn1 = [
  "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
  "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
  "1r4k1/8/8/8/8/8/5PPP/6K1 b - - 0 1",
  "k7/8/1K6/8/8/8/8/7Q w - - 0 1",
  "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", // smothered mate
];
rand = seeded(4);
for (const fen of mateIn1) {
  for (let i = 0; i < 15; i++) {
    const st = C.fromFEN(fen);
    const after = C.move(st, C.aiMove(st, 100, rand));
    assert.strictEqual(C.status(after).reason, "checkmate", "skill 100 should find mate in one: " + fen);
  }
}

// ...and doesn't hang its queen
const queenTrouble = [
  "rnbqkbnr/pp1p1ppp/8/2p5/3Q4/8/PPP1PPPP/RNB1KBNR w KQkq - 0 3", // queen attacked by a pawn
  "rnb1kbnr/pppp1ppp/8/4p3/4P2q/6P1/PPPP1P1P/RNBQKBNR b KQkq - 0 3", // same for black
  "r1b1kbnr/pppp1ppp/2n5/4p3/2B1P2q/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 4", // attacked by a knight
  "rnb1kbnr/pppp1ppp/8/4p3/4P1q1/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3", // lots of tempting squares
];
rand = seeded(6);
for (const fen of queenTrouble) {
  const st = C.fromFEN(fen);
  const me = C.turn(st) === "w" ? 1 : -1;
  const before = C.evaluate(st) * me;
  for (let i = 0; i < 12; i++) {
    const mv = C.aiMove(st, 100, rand);
    const after = C.evaluate(C.move(st, mv)) * me;
    assert.ok(after > before - 250, `skill 100 shouldn't throw away its queen (${fen}: ${mv.san}, ${before} -> ${after})`);
  }
}

// skill matters: a master beats a beginner, and every move is quick
function match(skillW, skillB, games, rand, times) {
  const score = { a: 0, b: 0, draw: 0 };
  for (let g = 0; g < games; g++) {
    let st = C.newGame();
    const aWhite = g % 2 === 0;
    for (let ply = 0; ply < 240; ply++) {
      const s = C.status(st);
      if (s.over) { if (s.result === "draw") score.draw++; else if ((s.result === "w") === aWhite) score.a++; else score.b++; break; }
      if (ply === 239) { score.draw++; break; }
      const aToMove = (C.turn(st) === "w") === aWhite;
      const skill = aToMove ? skillW : skillB;
      const t0 = Date.now();
      const mv = C.aiMove(st, skill, rand);
      if (times && skill === 100) times.push(Date.now() - t0);
      st = C.move(st, mv);
      assert.ok(st, "AI moves are legal");
    }
  }
  return score;
}
const times = [];
const masterVsBeginner = match(100, 0, 10, seeded(42), times);
assert.ok(masterVsBeginner.a >= 7, "skill 100 should beat skill 0 in most games: " + JSON.stringify(masterVsBeginner));
const midVsBeginner = match(60, 0, 4, seeded(5));
assert.ok(midVsBeginner.a >= 3, "skill 60 should beat skill 0: " + JSON.stringify(midVsBeginner));
const masterVsMid = match(100, 45, 4, seeded(8), times);
assert.ok(masterVsMid.a >= 3, "skill 100 should beat skill 45: " + JSON.stringify(masterVsMid));
const avg = times.reduce((a, b) => a + b, 0) / times.length;
assert.ok(avg < 700, "skill-100 moves should take under 700 ms on average (took " + avg.toFixed(0) + " ms)");

// the profile gets smoothly better with skill
let prev = C.profile(0);
for (let s = 5; s <= 100; s += 5) {
  const p = C.profile(s);
  assert.ok(p.noise < prev.noise && p.blunderChance < prev.blunderChance && p.depth >= prev.depth, "skill " + s + " should be better than " + (s - 5));
  prev = p;
}
assert.ok(C.profile(100).blunderChance <= 0.03 && C.profile(100).depth <= 3, "a master is good, but not Stockfish");

// ---- learning: a beginner Mii becomes a master in about 15-25 finished games ----
const G = require("../js/minigames.js");
assert.ok(G.GAMES.chess && G.GAMES.chess.icon === "♟️" && G.LEARN_RATE.chess > 0);
function gamesToMaster(lose) {
  const st = { skill: 15, played: 0, wins: 0, losses: 0 };
  let n = 0;
  while (st.skill < 90) { G.learn(st, "chess", lose); n++; }
  return n;
}
const slow = gamesToMaster(false), fast = gamesToMaster(true);
assert.ok(slow >= 15 && slow <= 25 && fast >= 12 && fast < slow, `learning speed: ${slow} games winning, ${fast} losing`);
const half = { skill: 15 };
G.learn(half, "chess", false, 0.3);
const full = { skill: 15 };
G.learn(full, "chess", false);
assert.ok(half.skill > 15 && half.skill < full.skill, "part of a game teaches less than a whole game");

console.log(`All chess tests passed. Learning: master after ${slow} games (${fast} if losing).`,
  `Perft OK; skill 100 vs 0: ${JSON.stringify(masterVsBeginner)}, 60 vs 0: ${JSON.stringify(midVsBeginner)}, 100 vs 45: ${JSON.stringify(masterVsMid)};`,
  `skill-100 move time avg ${avg.toFixed(1)} ms, max ${Math.max(...times)} ms`);
