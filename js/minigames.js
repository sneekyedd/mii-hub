/*
 * minigames.js
 * The rules and the Mii opponents for the mini-games you can play with a Mii:
 *   - Rock Paper Scissors (best of 5: first to 3 wins)
 *   - Tic-Tac-Toe (best of 3: first to 2 wins)
 *   - Connect 4 (one game, winner takes all)
 *   - Paintball (a first-person 1v1, first to 10 rounds: see js/paintball/)
 *   - Chess (one game: the rules and the Mii chess brain are in js/chess.js)
 *
 * Every Mii has a skill (0-100) for each game. Skill decides how cleverly the
 * Mii plays, and it goes up every time you play that game with them.
 * This file has no drawing code, so it can be tested on its own (tests/minigames.test.js).
 */
(function (root) {
  "use strict";

  const GAMES = {
    rps: { id: "rps", name: "Rock Paper Scissors", short: "RPS", icon: "✊", format: "Best of 5", target: 3 },
    ttt: { id: "ttt", name: "Tic-Tac-Toe", short: "Tic-Tac-Toe", icon: "⭕", format: "Best of 3", target: 2 },
    c4: { id: "c4", name: "Connect 4", short: "Connect 4", icon: "🔴", format: "Winner takes all", target: 1 },
    paintball: { id: "paintball", name: "Paintball", short: "Paintball", icon: "🎯", format: "First to 10 rounds", target: 10 },
    chess: { id: "chess", name: "Chess", short: "Chess", icon: "♟️", format: "One game", target: 1 },
  };

  // ---------------------------------------------------------------------
  // Skill: how good a Mii is at a game, and how it grows
  // ---------------------------------------------------------------------
  const SKILL_LEVELS = [
    { min: 0, name: "Beginner" },
    { min: 25, name: "Amateur" },
    { min: 50, name: "Skilled" },
    { min: 75, name: "Expert" },
    { min: 90, name: "Master" },
  ];

  function skillLevel(skill) {
    let level = SKILL_LEVELS[0];
    for (const l of SKILL_LEVELS) if (skill >= l.min) level = l;
    return level.name;
  }

  function newStats(rand) {
    rand = rand || Math.random;
    return { skill: Math.round(5 + rand() * 20), played: 0, wins: 0, losses: 0 };
  }

  // How much a Mii learns from one game (a round of RPS counts less than a
  // whole game of Connect 4). Learning slows down as they get better, and
  // they learn a bit more from losing.
  // Chess: a beginner becomes a Master (90+) after about 20 finished games
  // (about 15 if it keeps losing). `amount` (0-1) is for part of a game,
  // like a chess game you quit halfway.
  const LEARN_RATE = { rps: 0.025, ttt: 0.07, c4: 0.12, paintball: 0.018, chess: 0.1 }; // (paintball: per round)
  function learn(stats, game, lostThisGame, amount) {
    const rate = LEARN_RATE[game] * (lostThisGame ? 1.3 : 1) * (amount === undefined ? 1 : Math.max(0, Math.min(1, amount)));
    stats.skill = Math.min(100, stats.skill + (100 - stats.skill) * rate);
    return stats.skill;
  }

  function pick(arr, rand) {
    return arr[Math.floor((rand || Math.random)() * arr.length)];
  }

  // ---------------------------------------------------------------------
  // Rock Paper Scissors
  // ---------------------------------------------------------------------
  const RPS = ["rock", "paper", "scissors"];
  const RPS_ICON = { rock: "✊", paper: "✋", scissors: "✌️" };
  const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  const COUNTER = { rock: "paper", paper: "scissors", scissors: "rock" };

  // 1 = a wins, -1 = b wins, 0 = tie
  function rpsResult(a, b) {
    if (a === b) return 0;
    return BEATS[a] === b ? 1 : -1;
  }

  // Beginners just pick (and have a favorite move they overuse).
  // Skilled Miis notice your habits: what you pick most, and what you tend to
  // pick after each move, and play whatever beats your likely next move.
  function rpsMove(skill, history, favorite, rand) {
    rand = rand || Math.random;
    const smart = (skill / 100) * 0.9;
    if (history.length >= 2 && rand() < smart) {
      const last = history[history.length - 1];
      const after = { rock: 0, paper: 0, scissors: 0 };
      const total = { rock: 0, paper: 0, scissors: 0 };
      for (let i = 0; i < history.length; i++) {
        total[history[i]] += 1;
        if (i > 0 && history[i - 1] === last) after[history[i]] += 2; // what you did after this move before
      }
      const score = (m) => after[m] + total[m] * (skill > 60 ? 0.5 : 1);
      const predicted = RPS.slice().sort((x, y) => score(y) - score(x))[0];
      return COUNTER[predicted];
    }
    if (favorite && rand() < 0.45 * (1 - skill / 100)) return favorite;
    return pick(RPS, rand);
  }

  // ---------------------------------------------------------------------
  // Tic-Tac-Toe   (board: 9 cells, "X" = you, "O" = the Mii, null = empty)
  // ---------------------------------------------------------------------
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  function tttWinner(b) {
    for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return { winner: b[x], line: [x, y, z] };
    if (b.every(Boolean)) return { winner: "draw", line: null };
    return null;
  }

  function tttEmpty(b) {
    const out = [];
    b.forEach((c, i) => { if (!c) out.push(i); });
    return out;
  }

  // Perfect play (it can't lose): try every move and look ahead to the end.
  function tttMinimax(b, me, turn, depth) {
    const w = tttWinner(b);
    if (w) return w.winner === "draw" ? 0 : (w.winner === me ? 10 - depth : depth - 10);
    const other = turn === "X" ? "O" : "X";
    let best = turn === me ? -Infinity : Infinity;
    for (const i of tttEmpty(b)) {
      b[i] = turn;
      const v = tttMinimax(b, me, other, depth + 1);
      b[i] = null;
      best = turn === me ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  }

  function tttBestMoves(b, me) {
    const other = me === "X" ? "O" : "X";
    let best = -Infinity, moves = [];
    for (const i of tttEmpty(b)) {
      b[i] = me;
      const v = tttMinimax(b, me, other, 1);
      b[i] = null;
      if (v > best) { best = v; moves = [i]; } else if (v === best) moves.push(i);
    }
    return moves;
  }

  function tttFindLine(b, who) {
    for (const i of tttEmpty(b)) {
      b[i] = who;
      const w = tttWinner(b);
      b[i] = null;
      if (w && w.winner === who) return i;
    }
    return -1;
  }

  // Low skill: mostly random. Middle: takes wins and blocks yours.
  // High skill: perfect play more and more often (at 100 it never loses).
  function tttMove(b, skill, me, rand) {
    rand = rand || Math.random;
    me = me || "O";
    const other = me === "X" ? "O" : "X";
    const s = skill / 100;
    if (rand() < Math.pow(s, 1.4)) return pick(tttBestMoves(b, me), rand);
    if (skill >= 20) { const win = tttFindLine(b, me); if (win >= 0) return win; }
    if (skill >= 35) { const block = tttFindLine(b, other); if (block >= 0) return block; }
    if (skill >= 50 && !b[4]) return 4;
    return pick(tttEmpty(b), rand);
  }

  // ---------------------------------------------------------------------
  // Connect 4   (board: 6 rows x 7 columns, row 0 = top; 1 = you, 2 = the Mii)
  // ---------------------------------------------------------------------
  const ROWS = 6, COLS = 7;

  function c4New() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  }

  function c4Drop(board, col, who) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) { board[r][col] = who; return r; }
    }
    return -1; // column full
  }

  function c4Valid(board) {
    const out = [];
    for (let c = 0; c < COLS; c++) if (!board[0][c]) out.push(c);
    return out;
  }

  function c4Winner(board) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const who = board[r][c];
        if (!who) continue;
        for (const [dr, dc] of dirs) {
          const cells = [[r, c]];
          for (let k = 1; k < 4; k++) {
            const rr = r + dr * k, cc = c + dc * k;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr][cc] !== who) break;
            cells.push([rr, cc]);
          }
          if (cells.length === 4) return { winner: who, cells };
        }
      }
    }
    if (c4Valid(board).length === 0) return { winner: "draw", cells: null };
    return null;
  }

  // How good a position looks for `me` (used when we can't look all the way ahead).
  function c4Score(board, me) {
    const opp = me === 1 ? 2 : 1;
    let score = 0;
    for (let r = 0; r < ROWS; r++) if (board[r][3] === me) score += 3; // the middle column is strong
    const windowScore = (cells) => {
      let mine = 0, theirs = 0, empty = 0;
      for (const v of cells) { if (v === me) mine++; else if (v === opp) theirs++; else empty++; }
      if (mine === 4) return 1000;
      if (mine === 3 && empty === 1) return 6;
      if (mine === 2 && empty === 2) return 2;
      if (theirs === 3 && empty === 1) return -8;
      if (theirs === 2 && empty === 2) return -1;
      return 0;
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) score += windowScore([0, 1, 2, 3].map((k) => board[r][c + k]));
      if (r + 3 < ROWS) score += windowScore([0, 1, 2, 3].map((k) => board[r + k][c]));
      if (r + 3 < ROWS && c + 3 < COLS) score += windowScore([0, 1, 2, 3].map((k) => board[r + k][c + k]));
      if (r + 3 < ROWS && c - 3 >= 0) score += windowScore([0, 1, 2, 3].map((k) => board[r + k][c - k]));
    }
    return score;
  }

  // Looks `depth` moves ahead (alpha-beta search), center columns first.
  function c4Search(board, depth, alpha, beta, maximizing, me) {
    const opp = me === 1 ? 2 : 1;
    const w = c4Winner(board);
    if (w) return w.winner === "draw" ? 0 : (w.winner === me ? 100000 + depth : -100000 - depth);
    if (depth === 0) return c4Score(board, me);
    const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => !board[0][c]);
    if (maximizing) {
      let v = -Infinity;
      for (const c of order) {
        const r = c4Drop(board, c, me);
        v = Math.max(v, c4Search(board, depth - 1, alpha, beta, false, me));
        board[r][c] = 0;
        alpha = Math.max(alpha, v);
        if (alpha >= beta) break;
      }
      return v;
    }
    let v = Infinity;
    for (const c of order) {
      const r = c4Drop(board, c, opp);
      v = Math.min(v, c4Search(board, depth - 1, alpha, beta, true, me));
      board[r][c] = 0;
      beta = Math.min(beta, v);
      if (alpha >= beta) break;
    }
    return v;
  }

  function c4WinningMove(board, who) {
    for (const c of c4Valid(board)) {
      const r = c4Drop(board, c, who);
      const w = c4Winner(board);
      board[r][c] = 0;
      if (w && w.winner === who) return c;
    }
    return -1;
  }

  // Beginners drop pieces almost anywhere. Better Miis take wins, block yours,
  // and look further ahead the more skilled they are (up to 6 moves).
  function c4Move(board, skill, me, rand) {
    rand = rand || Math.random;
    me = me || 2;
    const opp = me === 1 ? 2 : 1;
    const valid = c4Valid(board);
    if (skill >= 15) { const win = c4WinningMove(board, me); if (win >= 0) return win; }
    if (skill >= 30) { const block = c4WinningMove(board, opp); if (block >= 0) return block; }
    if (rand() < (1 - skill / 100) * 0.6) return pick(valid, rand);
    const depth = 1 + Math.round((skill / 100) * 5);
    let best = -Infinity, bestCols = [];
    for (const c of [3, 2, 4, 1, 5, 0, 6].filter((x) => valid.includes(x))) {
      const r = c4Drop(board, c, me);
      const v = c4Search(board, depth - 1, -Infinity, Infinity, false, me);
      board[r][c] = 0;
      if (v > best) { best = v; bestCols = [c]; } else if (v === best) bestCols.push(c);
    }
    return pick(bestCols, rand);
  }

  // ---------------------------------------------------------------------
  // Things Miis say during games (depends on personality)
  // ---------------------------------------------------------------------
  function talk(kind, p) {
    p = p || {};
    const grumpy = p.kindness <= 35, sweet = p.kindness >= 65, silly = p.humor >= 65, shy = p.social <= 35, hyper = p.energy >= 70;
    const lines = {
      start: shy ? ["Oh! Um, okay... let's play.", "I'll try my best..."]
        : grumpy ? ["Prepare to lose.", "Fine. Let's get this over with."]
        : silly ? ["Game on! Prepare to be amazed!", "I've been practicing! ...Kind of."]
        : hyper ? ["YES! Let's play!!", "I love games! Let's gooo!"]
        : ["Let's play!", "Good luck!", "This'll be fun!"],
      think: ["Hmm...", "Let me think...", "Ooh, tricky...", "Hmmmm.", "Aha!"],
      winRound: grumpy ? ["Too easy.", "Ha!"] : silly ? ["Boom!", "Did you see that?!"] : ["Yes!", "Got it!", "Woohoo!"],
      loseRound: grumpy ? ["Hmph.", "Lucky..."] : shy ? ["Oh no...", "Aww..."] : ["Nice one!", "Darn!", "Ooh, good move!"],
      tie: ["Same!", "A tie!", "Great minds think alike!"],
      winMatch: grumpy ? ["I knew I'd win.", "Better luck next time."] : sweet ? ["Good game! You played great!", "That was so fun!"] : silly ? ["I am the champion! ♪", "Victory dance time!"] : ["I win! Good game!", "Yay, I won!"],
      loseMatch: grumpy ? ["Rematch. Now.", "...I wasn't trying."] : sweet ? ["You're so good! Well played!", "Congrats! That was fun!"] : shy ? ["You win... good game.", "W-well played!"] : ["You got me! Good game!", "Wow, you're good!"],
      draw: ["A draw! Evenly matched!", "Nobody wins... let's go again!"],
      // chess
      check: grumpy ? ["Check. Obviously.", "Check!"] : silly ? ["Check! Knock knock!", "Cheeeck!"] : shy ? ["Um... check?", "Ch-check..."] : ["Check!", "Check! Watch out!"],
      inCheck: grumpy ? ["Hmph. I saw that.", "Annoying..."] : shy ? ["Eep!", "Oh no, my king..."] : silly ? ["My king is sweating!", "Whoa there!"] : ["Yikes, check!", "Ooh, careful..."],
      capture: grumpy ? ["Mine now.", "Thanks for the snack."] : silly ? ["Om nom nom!", "Yoink!"] : sweet ? ["Sorry! I'll take that.", "Hehe, got one!"] : ["Got it!", "I'll take that!"],
      lostPiece: grumpy ? ["Ugh.", "I meant to do that."] : shy ? ["Oh... my piece...", "Aww..."] : silly ? ["Noooo, not Steve!", "He was my favorite!"] : ["Oops!", "Ouch!", "Good one!"],
      queenLost: grumpy ? ["MY QUEEN?!", "That's... not fair."] : silly ? ["My queen! She had a family!", "Queeeen!"] : ["Oh no, my queen!", "Not my queen!"],
      winning: grumpy ? ["This is going well. For me.", "Give up yet?"] : sweet ? ["I think I'm doing okay!", "This is fun!"] : silly ? ["I'm on fire! ♪", "Feeling like a grandmaster!"] : ["Things are looking good!", "I like my position!"],
      losing: grumpy ? ["This isn't over.", "Stop being good."] : shy ? ["Y-you're really good...", "Hmm... uh oh."] : silly ? ["Time for a comeback!", "This is all part of my plan. Probably."] : ["You're tough!", "I need to focus..."],
      drawYes: grumpy ? ["Fine. A draw.", "...I'll take it."] : sweet ? ["Sure! Good game!", "A draw sounds nice!"] : ["Okay, it's a draw!", "Deal!"],
      drawNo: grumpy ? ["No way. I'm winning.", "Nope."] : shy ? ["Um... I'd like to keep playing...", "M-maybe not yet..."] : silly ? ["Draw? I'm just getting started!", "Nope! Fight on!"] : ["No thanks, let's keep playing!", "Not yet!"],
      resign: grumpy ? ["Giving up? Figures.", "Ha. Too easy."] : sweet ? ["Aww, good game anyway!", "Next time for sure!"] : ["You resign? I win!", "Good game!"],
    }[kind];
    return pick(lines);
  }

  const api = {
    GAMES, SKILL_LEVELS, skillLevel, newStats, learn, LEARN_RATE,
    RPS, RPS_ICON, rpsResult, rpsMove,
    tttWinner, tttEmpty, tttMove, tttBestMoves,
    ROWS, COLS, c4New, c4Drop, c4Valid, c4Winner, c4Move,
    talk,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MiniGames = api;
})(typeof self !== "undefined" ? self : this);
