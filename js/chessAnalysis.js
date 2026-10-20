/*
 * chessAnalysis.js
 * Game review after a chess game (vs a Mii or online), like chess.com's: how good each of
 * your moves was (Best, Excellent, Good, Inaccuracy, Mistake, Blunder...), your accuracy,
 * and what would have been better.
 *
 * Use: ChessAnalysis.render(container, { startFen, moves: [SAN...], you: "w" | "b", names: { w, b } })
 */
(function (root) {
  "use strict";
  const C = root.Chess;

  const KINDS = {
    book: { name: "Book", icon: "📖", cls: "book" },
    best: { name: "Best", icon: "⭐", cls: "best" },
    excellent: { name: "Excellent", icon: "👍", cls: "excellent" },
    good: { name: "Good", icon: "✔️", cls: "good" },
    inaccuracy: { name: "Inaccuracy", icon: "?!", cls: "inaccuracy" },
    mistake: { name: "Mistake", icon: "?", cls: "mistake" },
    blunder: { name: "Blunder", icon: "??", cls: "blunder" },
  };
  const ORDER = ["book", "best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // centipawns -> chance of winning (the curve chess.com uses), for the side the score is for
  function winPct(cp) {
    if (Math.abs(cp) > 20000) return cp > 0 ? 100 : 0; // a forced mate
    cp = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }
  const moveAccuracy = (drop) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669));

  function classify(drop, isBest, inBook) {
    if (inBook) return "book";
    if (isBest || drop <= 0.5) return "best";
    if (drop <= 2.5) return "excellent";
    if (drop <= 6) return "good";
    if (drop <= 12) return "inaccuracy";
    if (drop <= 22) return "mistake";
    return "blunder";
  }

  // Works through the game a few positions at a time, so the page stays responsive.
  function analyze(o, onProgress) {
    return new Promise((resolve) => {
      let state = o.startFen ? C.fromFEN(o.startFen) : C.newGame();
      const book = C.BOOK_LINES || [];
      const out = [];
      let i = 0, before = C.analyze(state);
      const uci = []; // the moves so far as "e2e4 e7e5..." (how the opening book is written)
      const step = () => {
        const t0 = Date.now();
        while (i < o.moves.length && Date.now() - t0 < 40) {
          const mover = C.turn(state), san = o.moves[i];
          const lm = C.legalMoves(state).find((m) => m.san === san);
          if (lm) uci.push(lm.from + lm.to + (lm.promo || ""));
          const next = C.move(state, san);
          if (!next) { i = o.moves.length; break; }
          const after = C.analyze(next);
          const sign = mover === "w" ? 1 : -1;
          const drop = winPct(sign * before.score) - winPct(sign * after.score);
          const isBest = !!(before.best && before.best.san === san);
          const line = uci.join(" ");
          const inBook = i < 12 && book.some((b) => b === line || b.startsWith(line + " "));
          out.push({ n: i, mover, san, drop, kind: classify(drop, isBest, inBook), best: before.best && before.best.san, acc: inBook ? 100 : moveAccuracy(drop) });
          state = next; before = after; i++;
        }
        if (onProgress) onProgress(i / Math.max(1, o.moves.length));
        if (i < o.moves.length) setTimeout(step, 0); else resolve(out);
      };
      step();
    });
  }

  function summary(list, side) {
    const mine = list.filter((m) => m.mover === side);
    const counts = {};
    for (const k of ORDER) counts[k] = mine.filter((m) => m.kind === k).length;
    const acc = mine.length ? mine.reduce((t, m) => t + m.acc, 0) / mine.length : 100;
    return { acc, counts, n: mine.length };
  }

  function render(container, o) {
    injectStyle();
    const box = el("div", "ca");
    const btn = el("button", "ca-go", "📊 Review the game");
    if (!o.moves || o.moves.length < 2) return box;
    box.appendChild(btn);
    container.appendChild(box);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const bar = el("div", "ca-bar"), fill = el("div");
      bar.appendChild(fill);
      btn.replaceWith(bar);
      const list = await analyze(o, (p) => { fill.style.width = Math.round(p * 100) + "%"; });
      bar.remove();
      draw(list);
    });

    function draw(list) {
      const you = o.you || "w";
      const names = o.names || { w: "White", b: "Black" };
      const sides = el("div", "ca-sides");
      for (const side of ["w", "b"]) {
        const s = summary(list, side);
        const card = el("div", "ca-side" + (side === you ? " you" : ""));
        card.append(el("div", "ca-who", (side === "w" ? "⚪ " : "⚫ ") + (names[side] || side) + (side === you ? " (you)" : "")), el("div", "ca-acc", s.acc.toFixed(1) + "%"), el("div", "ca-acclbl", "accuracy"));
        const counts = el("div", "ca-counts");
        for (const k of ORDER) {
          if (!s.counts[k]) continue;
          const c = el("span", "ca-k " + KINDS[k].cls, KINDS[k].icon + " " + s.counts[k]);
          c.title = KINDS[k].name;
          counts.appendChild(c);
        }
        card.appendChild(counts);
        sides.appendChild(card);
      }
      box.appendChild(sides);
      // your moves, one by one
      const ml = el("div", "ca-moves");
      for (const m of list) {
        const row = el("div", "ca-move " + KINDS[m.kind].cls + (m.mover === you ? " you" : ""));
        const num = Math.floor(m.n / 2) + 1 + (m.mover === "w" ? "." : "...");
        row.append(el("span", "ca-num", num), el("span", "ca-san", m.san), el("span", "ca-tag", KINDS[m.kind].icon + " " + KINDS[m.kind].name));
        if (["inaccuracy", "mistake", "blunder"].includes(m.kind) && m.best) row.appendChild(el("span", "ca-best", "best: " + m.best));
        ml.appendChild(row);
      }
      box.appendChild(ml);
    }
    return box;
  }

  function injectStyle() {
    if (document.getElementById("ca-style")) return;
    const st = document.createElement("style");
    st.id = "ca-style";
    st.textContent = `
.ca{margin-top:10px;display:flex;flex-direction:column;gap:10px}
.ca-go{padding:9px 14px;border:none;border-radius:12px;background:#81b64c;color:#fff;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 3px 0 #5d8b33}
.ca-go:hover{filter:brightness(1.05)}
.ca-bar{height:10px;border-radius:999px;background:var(--bg);overflow:hidden;border:1px solid var(--border)}
.ca-bar div{height:100%;width:0;background:#81b64c;transition:width .15s}
.ca-sides{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ca-side{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:8px 10px;text-align:center}
.ca-side.you{border:2px solid #81b64c}
.ca-who{font-weight:800;font-size:.85rem}
.ca-acc{font-size:1.6rem;font-weight:900;line-height:1.1}
.ca-acclbl{font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.ca-counts{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:6px}
.ca-k{font-size:.75rem;font-weight:800;padding:1px 6px;border-radius:8px;background:var(--panel)}
.ca-moves{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:2px;font-size:.82rem}
.ca-move{display:flex;gap:8px;align-items:center;padding:3px 8px;border-radius:8px;opacity:.65}
.ca-move.you{opacity:1;background:var(--bg)}
.ca-num{color:var(--muted);width:3.2em;font-variant-numeric:tabular-nums}
.ca-san{font-weight:800;width:4.5em}
.ca-tag{font-weight:800}
.ca-best{margin-left:auto;color:var(--muted);font-weight:700}
.book .ca-tag,.ca-k.book{color:#a88865}
.best .ca-tag,.ca-k.best{color:#5d9b2a}
.excellent .ca-tag,.ca-k.excellent{color:#5d9b2a}
.good .ca-tag,.ca-k.good{color:#7aa36b}
.inaccuracy .ca-tag,.ca-k.inaccuracy{color:#e6a817}
.mistake .ca-tag,.ca-k.mistake{color:#e5762b}
.blunder .ca-tag,.ca-k.blunder{color:#d9372b}
`;
    document.head.appendChild(st);
  }

  root.ChessAnalysis = { render, analyze, winPct, classify };
})(typeof window !== "undefined" ? window : globalThis);
