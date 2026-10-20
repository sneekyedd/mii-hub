/*
 * chessUI.js
 * Everything you see of chess (the rules and the Mii brain are in chess.js):
 *
 *   ChessUI.createBoard(container, { orientation: "w"|"b", onMove(move, newState) })
 *     -> { el, setPosition(state, lastMove?), setInteractive(color|null), setOrientation(o), destroy() }
 *     A board with click-to-move, drag-and-drop, legal-move dots, last-move and
 *     check highlights, and a promotion picker. When you make a move it shows it
 *     right away and calls onMove({ from, to, promo?, san, capture, check }, newState).
 *     Return false from onMove to put the piece back. setInteractive("w" | "b" | "both" | null)
 *     says whose pieces you may move (only when it's that side's turn).
 *
 *   ChessUI.playMii({ walker, stats, portrait, stage, hub, onSave, onFinish })
 *     The window for a game of chess against a Mii (like MiiGamesUI.open).
 *
 *   ChessUI.openLobby({ records, stage, portraitFor, statsFor, nameOf, colorFor, player, onPlay(rec) })
 *     The ♟️ Chess window: play one of your Miis, or online (window.ChessOnline).
 */
(function (root) {
  "use strict";

  const C = root.Chess;
  const G = root.MiniGames;
  const D = root.Dialogue;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const FILES = "abcdefgh";

  // ---------------------------------------------------------------------
  // Pieces (SVG, drawn for this app; white = light fill, black = dark fill)
  // ---------------------------------------------------------------------
  const BASE = '<path d="M11.5 38.5h22c1 0 1.5-.6 1.5-1.4v-.6c0-1.6-1.2-2.5-2.6-2.5H12.6c-1.4 0-2.6.9-2.6 2.5v.6c0 .8.5 1.4 1.5 1.4z"/>';
  const SHAPES = {
    p: '<circle cx="22.5" cy="12.5" r="4.6"/><path d="M16.6 33.5c0-4.6 2-8.3 4.3-10.6h3.2c2.3 2.3 4.3 6 4.3 10.6z"/><rect x="17" y="19" width="11" height="3.6" rx="1.8"/>' + BASE,
    r: '<path d="M14.5 33.5l1.6-4.2h12.8l1.6 4.2z"/><path d="M16.6 29.3l1-12.3h9.8l1 12.3z"/><path d="M13.8 17V9.5h4v2.8h2.6V9.5h4.2v2.8h2.6V9.5h4V17z"/><path class="d" d="M17.6 21h9.8"/>' + BASE,
    b: '<circle cx="22.5" cy="7.6" r="2.3"/><path d="M22.5 10.2c-5.2 3.4-7.7 7.7-7.7 11.6 0 3.2 2 5.3 3.7 5.9h8c1.7-.6 3.7-2.7 3.7-5.9 0-3.9-2.5-8.2-7.7-11.6z"/><path class="d" d="M25.2 14.6l-4.6 5"/><rect x="16.2" y="27.4" width="12.6" height="3.4" rx="1.7"/><path d="M14.6 33.5l2-2.7h11.8l2 2.7z"/>' + BASE,
    n: '<path d="M24.2 9.5c7.4.7 11.5 6.6 10.8 24H15.4c-.4-5.6 6.5-8.6 5.4-14.3-1.6 1.6-2.6 3.2-5 4.2-1.8.7-3.9.4-4.6-1.1-.9-1.8.2-2.9 1.6-4.4 1.8-1.9 2.4-4.6 4.4-6.4.4-1.7 1.1-3 2.1-3.9l1.2 2.4c.7-.3 1.7-.5 3.7-.5z"/><circle class="e" cx="18.6" cy="14.6" r="1.25"/><path class="d" d="M27.6 13.5c2.6 3.4 3.4 9.3 3 16.5"/>' + BASE,
    q: '<circle cx="9.6" cy="13" r="2.2"/><circle cx="16" cy="9.6" r="2.2"/><circle cx="22.5" cy="8.4" r="2.2"/><circle cx="29" cy="9.6" r="2.2"/><circle cx="35.4" cy="13" r="2.2"/>' +
      '<path d="M12 30.2L9.8 15.4l6.4 8.7 .6-12 5.7 10.8 5.7-10.8.6 12 6.4-8.7L33 30.2z"/><rect x="11.4" y="29.8" width="22.2" height="4" rx="2"/>' + BASE,
    k: '<path class="x" d="M22.5 4.5v7M19.2 7.7h6.6"/><path d="M22.5 25.6s4.3-4.2 4.3-7.6c0-2.4-1.9-4.2-4.3-4.2s-4.3 1.8-4.3 4.2c0 3.4 4.3 7.6 4.3 7.6z"/>' +
      '<path d="M12.2 30.2c-3.4-4.9-2.6-11.6 3.3-12.1 3.4-.3 6 2 7 4.9 1-2.9 3.6-5.2 7-4.9 5.9.5 6.7 7.2 3.3 12.1z"/><rect x="11.4" y="29.8" width="22.2" height="4" rx="2"/>' + BASE,
  };
  const svgCache = {};
  function pieceSVG(color, type) {
    const key = color + type;
    if (!svgCache[key]) svgCache[key] = '<svg viewBox="0 0 45 45" class="cb-svg ' + (color === "w" ? "cw" : "cb") + '" aria-hidden="true">' + SHAPES[type] + "</svg>";
    return svgCache[key];
  }
  const PIECE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

  // ---------------------------------------------------------------------
  // The board
  // ---------------------------------------------------------------------
  function createBoard(container, opts) {
    opts = opts || {};
    let orientation = opts.orientation === "b" ? "b" : "w";
    let state = C.newGame();
    let lastMove = null;
    let interactive = null;
    let selected = null;
    let targets = []; // legal moves from the selected square
    let drag = null;
    let destroyed = false;
    let promoEl = null;

    const board = el("div", "cb-board");
    board.setAttribute("role", "grid");
    board.setAttribute("aria-label", "Chess board");
    const squares = {};
    for (let i = 0; i < 64; i++) {
      const sq = el("div", "cb-sq");
      board.appendChild(sq);
    }
    const ghost = el("div", "cb-ghost");
    ghost.hidden = true;
    board.appendChild(ghost);
    if (container) container.appendChild(board);

    // which square is at grid position i (0 = top-left)
    const nameAt = (i) => {
      const r = i >> 3, f = i & 7;
      return orientation === "w" ? FILES[f] + (8 - r) : FILES[7 - f] + (r + 1);
    };

    function layout() {
      const cells = board.querySelectorAll(".cb-sq");
      for (const k in squares) delete squares[k];
      cells.forEach((cell, i) => {
        const name = nameAt(i);
        squares[name] = cell;
        cell.dataset.sq = name;
        const file = name.charCodeAt(0) - 97, rank = Number(name[1]) - 1;
        cell.className = "cb-sq " + ((file + rank) % 2 ? "light" : "dark");
        cell.innerHTML = "";
        const r = i >> 3, f = i & 7;
        if (f === 0) cell.appendChild(el("span", "cb-coord rank", name[1]));
        if (r === 7) cell.appendChild(el("span", "cb-coord file", name[0]));
      });
      draw(null);
    }

    function kingSquare(color) {
      for (let r = 1; r <= 8; r++) for (const f of FILES) {
        const p = C.piece(state, f + r);
        if (p && p.type === "k" && p.color === color) return f + r;
      }
      return null;
    }

    function draw(anim) {
      const st = C.status(state);
      const checkSq = st.check ? kingSquare(C.turn(state)) : null;
      for (const name in squares) {
        const cell = squares[name];
        const old = cell.querySelector(".cb-piece");
        if (old) old.remove();
        const p = C.piece(state, name);
        cell.classList.toggle("last", !!lastMove && (lastMove.from === name || lastMove.to === name));
        cell.classList.toggle("check", name === checkSq);
        cell.classList.toggle("sel", name === selected);
        const t = targets.find((m) => m.to === name);
        cell.classList.toggle("dot", !!t && !t.capture);
        cell.classList.toggle("ring", !!t && t.capture);
        cell.classList.toggle("can", !!p && canMove(p.color));
        cell.setAttribute("aria-label", name + (p ? " " + (p.color === "w" ? "white " : "black ") + PIECE_NAME[p.type] : ""));
        if (!p) continue;
        const pe = el("div", "cb-piece");
        pe.innerHTML = pieceSVG(p.color, p.type);
        if (drag && drag.moved && drag.from === name) pe.classList.add("lifted");
        cell.appendChild(pe);
      }
      // slide the piece that just moved
      if (anim && squares[anim.from] && squares[anim.to]) {
        const pe = squares[anim.to].querySelector(".cb-piece");
        if (pe) {
          const a = squares[anim.from].getBoundingClientRect(), b = squares[anim.to].getBoundingClientRect();
          if (a.width) {
            pe.style.transition = "none";
            pe.style.transform = "translate(" + (a.left - b.left) + "px," + (a.top - b.top) + "px)";
            pe.style.zIndex = 3;
            void pe.offsetWidth;
            pe.style.transition = "transform 0.18s ease-out";
            pe.style.transform = "";
            setTimeout(() => { pe.style.zIndex = ""; }, 200);
          }
        }
      }
    }

    function canMove(color) {
      if (!interactive || C.status(state).over) return false;
      if (C.turn(state) !== color) return false;
      return interactive === "both" || interactive === color;
    }

    function select(name) {
      selected = name;
      targets = name ? C.legalMoves(state, name) : [];
      draw(null);
    }

    function squareAt(x, y) {
      const r = board.getBoundingClientRect();
      const f = Math.floor(((x - r.left) / r.width) * 8), rr = Math.floor(((y - r.top) / r.height) * 8);
      if (f < 0 || f > 7 || rr < 0 || rr > 7) return null;
      return nameAt(rr * 8 + f);
    }

    function commit(mv, slide) {
      const next = C.move(state, mv);
      if (!next) return;
      const full = C.legalMoves(state, mv.from).find((m) => m.to === mv.to && (!m.promo || m.promo === (mv.promo || "q")));
      const prev = state, prevLast = lastMove;
      state = next;
      lastMove = { from: mv.from, to: mv.to };
      selected = null; targets = [];
      draw(slide ? lastMove : null);
      const ok = opts.onMove ? opts.onMove(full || mv, next) : true;
      if (ok === false) { state = prev; lastMove = prevLast; draw(null); }
    }

    function tryMove(from, to, slide) {
      const ms = targets.filter((m) => m.from === from && m.to === to);
      if (!ms.length) return false;
      if (ms.length > 1) { askPromotion(from, to); return true; }
      commit({ from, to }, slide);
      return true;
    }

    function askPromotion(from, to) {
      closePromotion();
      const color = C.turn(state);
      promoEl = el("div", "cb-promo");
      const box = el("div", "cb-promo-box");
      box.appendChild(el("div", "cb-promo-title", "Promote to…"));
      const row = el("div", "cb-promo-row");
      for (const t of ["q", "r", "b", "n"]) {
        const b = el("button", "cb-promo-btn");
        b.type = "button";
        b.title = PIECE_NAME[t];
        b.setAttribute("aria-label", "Promote to a " + PIECE_NAME[t]);
        b.innerHTML = pieceSVG(color, t);
        b.addEventListener("click", (e) => { e.stopPropagation(); closePromotion(); commit({ from, to, promo: t }, false); });
        row.appendChild(b);
      }
      box.appendChild(row);
      promoEl.appendChild(box);
      promoEl.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (e.target === promoEl) { closePromotion(); select(null); }
      });
      board.appendChild(promoEl);
    }
    function closePromotion() { if (promoEl) { promoEl.remove(); promoEl = null; } }

    // ---- input: click a piece then a square, or drag it ----
    function onDown(e) {
      if (destroyed || promoEl || (e.button !== undefined && e.button !== 0)) return;
      const name = squareAt(e.clientX, e.clientY);
      if (!name) return;
      if (selected && name !== selected && targets.some((m) => m.to === name)) {
        e.preventDefault();
        tryMove(selected, name, true);
        return;
      }
      const p = C.piece(state, name);
      if (p && canMove(p.color)) {
        e.preventDefault();
        const again = selected === name;
        select(name);
        drag = { from: name, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, again };
        try { board.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      } else select(null);
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      const r = board.getBoundingClientRect(), size = r.width / 8;
      if (!drag.moved) {
        drag.moved = true;
        ghost.innerHTML = squares[drag.from].querySelector(".cb-piece").innerHTML;
        ghost.style.width = ghost.style.height = size + "px";
        ghost.hidden = false;
        const src = squares[drag.from].querySelector(".cb-piece");
        if (src) src.classList.add("lifted");
      }
      ghost.style.transform = "translate(" + (e.clientX - r.left - size / 2) + "px," + (e.clientY - r.top - size / 2) + "px) scale(1.12)";
      const over = squareAt(e.clientX, e.clientY);
      for (const n in squares) squares[n].classList.toggle("hover", n === over && targets.some((m) => m.to === n));
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      ghost.hidden = true;
      for (const n in squares) squares[n].classList.remove("hover");
      const name = squareAt(e.clientX, e.clientY);
      if (d.moved) {
        if (name && name !== d.from && tryMove(d.from, name, false)) return;
        draw(null); // put it back, still selected
      } else if (d.again) select(null); // clicking the selected piece again lets go of it
    }
    function onCancel() {
      if (!drag) return;
      drag = null;
      ghost.hidden = true;
      draw(null);
    }
    board.addEventListener("pointerdown", onDown);
    board.addEventListener("pointermove", onMove);
    board.addEventListener("pointerup", onUp);
    board.addEventListener("pointercancel", onCancel);
    board.addEventListener("contextmenu", (e) => e.preventDefault());

    layout();

    return {
      el: board,
      setPosition(st, lm) {
        if (!st) return;
        const same = st.fen === state.fen;
        const nextLast = lm !== undefined ? lm : C.lastMove(st);
        const changedLast = JSON.stringify(nextLast || null) !== JSON.stringify(lastMove || null);
        state = st;
        lastMove = nextLast || null;
        if (same && !changedLast) return;
        closePromotion();
        selected = null; targets = [];
        draw(!same && lastMove ? lastMove : null);
      },
      setInteractive(color) {
        interactive = color === "w" || color === "b" || color === "both" ? color : null;
        if (!interactive) { closePromotion(); selected = null; targets = []; }
        draw(null);
      },
      setOrientation(o) {
        orientation = o === "b" ? "b" : "w";
        layout();
      },
      getState: () => state,
      destroy() {
        destroyed = true;
        board.remove();
      },
    };
  }

  // ---------------------------------------------------------------------
  // Little helpers for the game windows
  // ---------------------------------------------------------------------
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  function capturedRow(types, color) {
    const row = el("div", "cg-caps");
    const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    types.slice().sort((a, b) => order[a] - order[b]).forEach((t) => {
      const s = el("span", "cg-cap");
      s.innerHTML = pieceSVG(color, t);
      row.appendChild(s);
    });
    return row;
  }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem("mii-hub-chess") || "{}"); } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem("mii-hub-chess", JSON.stringify(Object.assign(loadPrefs(), p))); } catch (e) { /* private window */ } }

  // ---------------------------------------------------------------------
  // A game against a Mii
  // ---------------------------------------------------------------------
  let current = null;

  function playMii(opts) {
    if (current) current.close(true);
    const { walker: w, hub } = opts;
    const stats = opts.stats;
    const info = G.GAMES.chess;
    const p = D && D.traits ? D.traits(w.record) : {};
    const name = w.look.name;
    const startSkill = stats.skill;
    let closed = false, started = false, finished = false, thinking = null, drawCooldown = 0;
    let state = C.newGame();
    let youColor = "w";
    const prefs = loadPrefs();
    let colorChoice = prefs.color === "w" || prefs.color === "b" ? prefs.color : "random";

    // ---------- the window ----------
    const backdrop = el("div", "game-modal chess-modal");
    const card = el("div", "game-card chess-card");
    backdrop.appendChild(card);

    const head = el("div", "gm-head");
    const img = el("img");
    img.src = opts.portrait || "";
    img.alt = "";
    if (w.record && w.record.id) img.dataset.portrait = w.record.id;
    const titles = el("div", "gm-titles");
    const sub = el("div", "gm-sub", info.format + " vs " + name);
    titles.append(el("div", "gm-title", info.icon + " " + info.name), sub);
    const closeBtn = el("button", "gm-close", "✕");
    closeBtn.title = "Quit game";
    closeBtn.setAttribute("aria-label", "Quit game");
    head.append(img, titles, closeBtn);

    const body = el("div", "cg-body");
    const left = el("div", "cg-left");
    const right = el("div", "cg-right");
    body.append(left, right);
    card.append(head, body);

    // players above and below the board
    const miiBar = el("div", "cg-player mii");
    const miiImg = el("img");
    miiImg.src = opts.portrait || ""; miiImg.alt = "";
    if (w.record && w.record.id) miiImg.dataset.portrait = w.record.id;
    const miiName = el("div", "cg-pname");
    const miiNameText = el("b", null, name);
    const miiSide = el("span", "cg-side");
    const think = el("span", "cg-think");
    think.innerHTML = "<i></i><i></i><i></i>";
    miiName.append(miiNameText, miiSide, think);
    const miiCaps = el("div", "cg-capwrap");
    miiBar.append(miiImg, miiName, miiCaps);

    const youBar = el("div", "cg-player you");
    const youDot = el("div", "cg-youdot", "🙂");
    const youName = el("div", "cg-pname");
    const youSide = el("span", "cg-side");
    youName.append(el("b", null, "You"), youSide);
    const youCaps = el("div", "cg-capwrap");
    youBar.append(youDot, youName, youCaps);

    const boardWrap = el("div", "cg-boardwrap");
    left.append(miiBar, boardWrap, youBar);
    const board = createBoard(boardWrap, { orientation: "w", onMove: onYourMove });

    // skill meter
    const skillRow = el("div", "gm-skill");
    const skillLabel = el("span", "gm-skill-label");
    const meter = el("div", "skill-meter");
    const fill = el("div", "skill-fill");
    meter.appendChild(fill);
    skillRow.append(el("span", "gm-skill-name", name + "'s skill"), meter, skillLabel);
    const showSkill = () => {
      fill.style.width = stats.skill.toFixed(0) + "%";
      skillLabel.textContent = G.skillLevel(stats.skill) + " · " + Math.round(stats.skill);
    };
    showSkill();

    const speech = el("div", "gm-speech");
    const status = el("div", "gm-status");
    const movesBox = el("div", "cg-moves");
    movesBox.setAttribute("aria-label", "Moves");
    const actions = el("div", "cg-actions");
    const footer = el("div", "gm-footer");
    right.append(skillRow, speech, status, movesBox, actions, footer);
    opts.stage.appendChild(backdrop);

    const say = (text) => {
      if (!text) return;
      speech.textContent = "“" + text + "”";
      speech.classList.remove("pop");
      void speech.offsetWidth;
      speech.classList.add("pop");
      if (w.say) w.say(text, 2.2); // the Mii says it in the 3D world too
    };
    const chance = (x) => Math.random() < x;

    // the Mii stops what it's doing to play with you
    hub.startGame(w, info.icon);
    say(G.talk("start", p));

    // ---------- drawing the sides ----------
    function refresh() {
      const caps = C.captured(state);
      const miiColor = youColor === "w" ? "b" : "w";
      miiCaps.innerHTML = ""; youCaps.innerHTML = "";
      // pieces each side has taken (shown in the color of the side they came from)
      const mat = (list) => list.reduce((s, t) => s + VALUE[t], 0);
      const youTook = caps[youColor], miiTook = caps[miiColor];
      youCaps.appendChild(capturedRow(youTook, miiColor));
      miiCaps.appendChild(capturedRow(miiTook, youColor));
      const diff = mat(youTook) - mat(miiTook);
      if (diff > 0) youCaps.appendChild(el("span", "cg-adv", "+" + diff));
      if (diff < 0) miiCaps.appendChild(el("span", "cg-adv", "+" + -diff));
      miiSide.textContent = miiColor === "w" ? "White" : "Black";
      youSide.textContent = youColor === "w" ? "White" : "Black";
      miiBar.classList.toggle("turn", started && !finished && C.turn(state) === miiColor);
      youBar.classList.toggle("turn", started && !finished && C.turn(state) === youColor);
      // move list
      movesBox.innerHTML = "";
      const h = state.history;
      if (!h.length) movesBox.appendChild(el("div", "cg-nomoves", started ? "No moves yet" : "Moves show up here"));
      for (let i = 0; i < h.length; i += 2) {
        const row = el("div", "cg-mrow");
        row.appendChild(el("span", "cg-mno", i / 2 + 1 + "."));
        const a = el("span", "cg-m", h[i]);
        const b = el("span", "cg-m", h[i + 1] || "");
        if (i === h.length - 1) a.classList.add("cur");
        if (i + 1 === h.length - 1) b.classList.add("cur");
        row.append(a, b);
        movesBox.appendChild(row);
      }
      movesBox.scrollTop = movesBox.scrollHeight;
    }

    // ---------- before the game: pick a color ----------
    function showSetup() {
      started = false; finished = false;
      state = C.newGame();
      board.setPosition(state, null);
      board.setInteractive(null);
      card.classList.remove("over");
      footer.innerHTML = "";
      actions.innerHTML = "";
      status.innerHTML = "";
      const pickRow = el("div", "cg-pick");
      pickRow.appendChild(el("div", "cg-pick-title", "Pick your color"));
      const seg = el("div", "cg-seg");
      const buttons = {};
      for (const [val, label] of [["w", "⚪ White"], ["random", "🎲 Random"], ["b", "⚫ Black"]]) {
        const b = el("button", "cg-seg-btn", label);
        b.type = "button";
        b.addEventListener("click", () => { colorChoice = val; savePrefs({ color: val }); mark(); });
        buttons[val] = b;
        seg.appendChild(b);
      }
      const mark = () => { for (const k in buttons) buttons[k].classList.toggle("on", k === colorChoice); };
      mark();
      pickRow.appendChild(seg);
      const go = el("button", "gm-btn primary cg-start", "Start game ▶");
      go.addEventListener("click", startGame);
      pickRow.appendChild(go);
      status.appendChild(pickRow);
      refresh();
    }

    function startGame() {
      youColor = colorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : colorChoice;
      started = true;
      state = C.newGame();
      board.setOrientation(youColor);
      board.setPosition(state, null);
      sub.textContent = info.format + " vs " + name + " · you're " + (youColor === "w" ? "White" : "Black");
      status.textContent = "";
      drawCooldown = 0;
      // in-game buttons
      actions.innerHTML = "";
      const drawBtn = el("button", "gm-btn small", "🤝 Offer draw");
      const resignBtn = el("button", "gm-btn small", "🏳️ Resign");
      let resignArmed = null;
      drawBtn.addEventListener("click", offerDraw);
      resignBtn.addEventListener("click", () => {
        if (finished || !started) return;
        if (!resignArmed) {
          resignBtn.textContent = "Really resign?";
          resignBtn.classList.add("danger");
          resignArmed = setTimeout(() => { resignArmed = null; resignBtn.textContent = "🏳️ Resign"; resignBtn.classList.remove("danger"); }, 5000);
          return;
        }
        clearTimeout(resignArmed);
        say(G.talk("resign", p));
        finish("mii", "You resigned");
      });
      actions.append(drawBtn, resignBtn);
      actions.drawBtn = drawBtn;
      refresh();
      nextTurn();
    }

    function nextTurn() {
      if (closed || finished) return;
      refresh();
      const st = C.status(state);
      if (st.over) { endByRules(st); return; }
      if (actions.drawBtn) actions.drawBtn.disabled = drawCooldown > 0;
      if (C.turn(state) === youColor) {
        board.setInteractive(youColor);
        status.textContent = st.check ? "Check! Your move." : "Your move!";
      } else {
        board.setInteractive(null);
        miiTurn();
      }
    }

    function miiTurn() {
      status.textContent = name + " is thinking…";
      think.classList.add("on");
      if (chance(0.12)) say(G.talk("think", p));
      const plies = state.history.length;
      const delay = plies < 6 ? 350 + Math.random() * 400 : 550 + Math.random() * 700;
      const startedAt = state.fen;
      // let the page paint first, then think
      thinking = setTimeout(() => {
        thinking = null;
        if (closed || finished || state.fen !== startedAt) return;
        const mv = C.aiMove(state, stats.skill);
        think.classList.remove("on");
        if (!mv) { nextTurn(); return; }
        const next = C.move(state, mv);
        if (!next) { nextTurn(); return; }
        const tookQueen = mv.capture && C.piece(state, mv.to) && C.piece(state, mv.to).type === "q";
        state = next;
        board.setPosition(state, { from: mv.from, to: mv.to });
        if (drawCooldown > 0) drawCooldown--;
        const st = C.status(state);
        if (!st.over) {
          if (mv.check && chance(0.55)) say(G.talk("check", p));
          else if (tookQueen) say(G.talk("capture", p));
          else if (mv.capture && chance(0.3)) say(G.talk("capture", p));
          else if (state.history.length % 14 === 0) moodComment();
        }
        nextTurn();
      }, delay);
    }

    function onYourMove(mv, next) {
      if (closed || finished || !started || C.turn(state) !== youColor) return false;
      const lost = mv.capture ? C.piece(state, mv.to) : null;
      state = next;
      board.setInteractive(null);
      if (drawCooldown > 0) drawCooldown--;
      const st = C.status(state);
      if (!st.over) {
        if (lost && lost.type === "q") say(G.talk("queenLost", p));
        else if (mv.check && chance(0.4)) say(G.talk("inCheck", p));
        else if (mv.capture && chance(0.3)) say(G.talk("lostPiece", p));
      }
      setTimeout(nextTurn, 0);
      return true;
    }

    // how the Mii thinks it's doing (centipawns, + = good for the Mii)
    function miiOutlook() {
      const v = C.evaluate(state);
      return youColor === "w" ? -v : v;
    }
    function moodComment() {
      const v = miiOutlook();
      if (v > 250) say(G.talk("winning", p));
      else if (v < -250) say(G.talk("losing", p));
    }

    function offerDraw() {
      if (finished || !started || drawCooldown > 0 || thinking) return;
      if (state.history.length < 2) { status.textContent = "Make a few moves first!"; return; }
      // a Mii only takes a draw when it's level or behind
      const v = miiOutlook();
      if (v <= 30) {
        say(G.talk("drawYes", p));
        finish("draw", "Draw agreed");
      } else {
        say(G.talk("drawNo", p));
        status.textContent = name + " wants to keep playing.";
        drawCooldown = 6;
        if (actions.drawBtn) actions.drawBtn.disabled = true;
      }
    }

    function endByRules(st) {
      const why = { checkmate: "Checkmate!", stalemate: "Stalemate", repetition: "Draw by repetition", fifty: "Draw by the 50-move rule", material: "Draw: not enough pieces to checkmate" }[st.reason] || "";
      const result = st.result === "draw" ? "draw" : st.result === youColor ? "you" : "mii";
      finish(result, why);
    }

    // ---------- finishing ----------
    function finish(result, why) {
      if (closed || finished) return;
      finished = true;
      if (thinking) { clearTimeout(thinking); thinking = null; }
      think.classList.remove("on");
      board.setInteractive(null);
      // a whole game teaches the Mii the most; a very short one less
      G.learn(stats, "chess", result === "you", Math.min(1, 0.3 + state.history.length / 40));
      showSkill();
      stats.played += 1;
      if (result === "mii") stats.wins += 1;
      if (result === "you") stats.losses += 1;
      opts.onSave();
      hub.endGame(w, result);
      if (opts.onFinish) opts.onFinish(result);
      if (!/resigned|agreed/.test(why || "")) say(G.talk(result === "mii" ? "winMatch" : result === "you" ? "loseMatch" : "draw", p));
      card.classList.add("over");
      refresh();
      const gained = stats.skill - startSkill;
      status.innerHTML = "";
      if (why) status.appendChild(el("div", "cg-why", why));
      const big = el("div", "gm-result " + result, result === "you" ? "🏆 You win!" : result === "mii" ? "🎉 " + name + " wins!" : "🤝 It's a draw!");
      const grow = el("div", "gm-grow", gained >= 0.5
        ? name + " got better at chess! +" + gained.toFixed(0) + " skill (" + G.skillLevel(stats.skill) + ")"
        : name + "'s chess skill: " + G.skillLevel(stats.skill));
      status.append(big, grow);
      // game review: how good each of your moves was
      if (root.ChessAnalysis) root.ChessAnalysis.render(status, { startFen: state.startFen, moves: state.history.slice(), you: youColor, names: { [youColor]: "You", [youColor === "w" ? "b" : "w"]: name } });
      actions.innerHTML = "";
      footer.innerHTML = "";
      const again = el("button", "gm-btn primary", "Play again");
      again.addEventListener("click", () => { close(true); playMii(opts); });
      const done = el("button", "gm-btn", "Back to the hub");
      done.addEventListener("click", () => close());
      footer.append(again, done);
    }

    function close(silent) {
      if (closed) return;
      // quitting halfway: the Mii learns a little, but it isn't a finished game
      if (started && !finished && state.history.length >= 4) {
        G.learn(stats, "chess", false, Math.min(0.4, state.history.length / 100));
        opts.onSave();
      }
      closed = true;
      if (thinking) clearTimeout(thinking);
      document.removeEventListener("keydown", onKey, true);
      board.destroy();
      backdrop.remove();
      if (current && current.close === close) current = null;
      if (!silent) hub.endGame(w, null);
    }
    function onKey(e) {
      if (e.key === "Escape" && (!started || finished)) { e.preventDefault(); close(); }
    }
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", () => close());
    // clicking outside only closes when you're not in the middle of a game
    backdrop.addEventListener("pointerdown", (e) => { if (e.target === backdrop && (!started || finished)) close(); });
    current = { close };

    showSetup();
    return { close, board };
  }

  // ---------------------------------------------------------------------
  // The ♟️ Chess lobby: play one of your Miis, or online
  // ---------------------------------------------------------------------
  let lobby = null;

  function openLobby(opts) {
    if (lobby) lobby.close();
    opts = opts || {};
    const records = (opts.records || []).filter(Boolean);
    const prefs = loadPrefs();
    let tab = opts.tab || (prefs.tab === "online" ? "online" : "mii");
    let closed = false;
    let online = null, onlineWait = null;
    const nameOf = opts.nameOf || ((r) => r.name || "Mii");
    let you = (opts.player && records.find((r) => r.id === opts.player.id)) || records.find((r) => r.id === prefs.player) || records[0] || null;

    const back = el("div", "game-modal chess-lobby");
    const card = el("div", "game-card cl-card");
    back.appendChild(card);
    const head = el("div", "gm-head");
    const titles = el("div", "gm-titles");
    titles.append(el("div", "gm-title", "♟️ Chess"), el("div", "gm-sub", "Play a Mii, or someone online"));
    const closeBtn = el("button", "gm-close", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    const icon = el("div", "cl-icon");
    icon.innerHTML = pieceSVG("w", "n");
    head.append(icon, titles, closeBtn);

    const tabs = el("div", "cl-tabs");
    tabs.setAttribute("role", "tablist");
    const tabMii = el("button", "cl-tab", "🤖 VS a Mii");
    const tabOnline = el("button", "cl-tab", "🌐 Online");
    for (const t of [tabMii, tabOnline]) { t.type = "button"; t.setAttribute("role", "tab"); }
    tabs.append(tabMii, tabOnline);
    const paneMii = el("div", "cl-pane");
    const paneOnline = el("div", "cl-pane online");
    card.append(head, tabs, paneMii, paneOnline);
    (opts.stage || document.body).appendChild(back);

    // ---- VS a Mii ----
    function drawMii() {
      paneMii.innerHTML = "";
      if (!records.length) { paneMii.appendChild(el("p", "cl-empty", "Add some Miis first, then challenge them to a game!")); return; }
      paneMii.appendChild(el("p", "cl-hint", "Every finished game makes a Mii better at chess. Masters know their stuff, but they're still beatable!"));
      const list = el("div", "cl-list");
      for (const r of records) {
        const st = opts.statsFor ? opts.statsFor(r) : { skill: 0, played: 0, wins: 0, losses: 0 };
        const row = el("div", "cl-row");
        const im = el("img");
        im.alt = ""; im.src = opts.portraitFor ? opts.portraitFor(r) : ""; im.dataset.portrait = r.id;
        const mid = el("div", "cl-mid");
        const nm = el("div", "cl-name", nameOf(r));
        const meter = el("div", "skill-meter");
        const fill = el("div", "skill-fill");
        fill.style.width = st.skill.toFixed(0) + "%";
        meter.appendChild(fill);
        const lvl = el("div", "cl-level", G.skillLevel(st.skill) + " · " + Math.round(st.skill) +
          (st.played ? " · " + st.played + " played · you " + st.losses + "–" + st.wins + " " + nameOf(r) : ""));
        mid.append(nm, meter, lvl);
        const play = el("button", "mm-play", "Play");
        play.addEventListener("click", () => { close(); if (opts.onPlay) opts.onPlay(r); });
        row.append(im, mid, play);
        list.appendChild(row);
      }
      paneMii.appendChild(list);
    }

    // ---- Online (built by window.ChessOnline) ----
    function onlineOpts() {
      return {
        createBoard: createBoard,
        Chess: C,
        playerName: you ? nameOf(you) : "Player",
        playerColor: you && opts.colorFor ? opts.colorFor(you) : "#2fa4e7",
        portrait: you && opts.portraitFor ? opts.portraitFor(you) : "",
      };
    }
    function unmountOnline() {
      if (online) {
        for (const k of ["destroy", "unmount", "dispose", "close"]) if (typeof online[k] === "function") { try { online[k](); } catch (e) { /* its problem */ } break; }
        online = null;
      }
    }
    function drawOnline() {
      unmountOnline();
      paneOnline.innerHTML = "";
      if (records.length > 1) {
        const who = el("label", "cl-who");
        who.appendChild(el("span", null, "Playing as"));
        const sel = el("select", "cl-select");
        for (const r of records) {
          const o = el("option", null, nameOf(r));
          o.value = r.id;
          if (r === you) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => { you = records.find((r) => r.id === sel.value) || you; savePrefs({ player: you && you.id }); drawOnline(); });
        who.appendChild(sel);
        paneOnline.appendChild(who);
      }
      const mount = el("div", "cl-online");
      paneOnline.appendChild(mount);
      const tryMount = () => {
        if (closed) return true;
        if (!root.ChessOnline || typeof root.ChessOnline.mount !== "function") return false;
        mount.innerHTML = "";
        try { online = root.ChessOnline.mount(mount, onlineOpts()) || null; }
        catch (err) { mount.innerHTML = ""; mount.appendChild(el("p", "cl-empty", "Online chess couldn't start: " + err.message)); }
        return true;
      };
      if (!tryMount()) {
        const wait = el("div", "cl-loading");
        wait.innerHTML = '<span class="cg-think on"><i></i><i></i><i></i></span> Online chess is loading…';
        mount.appendChild(wait);
        clearInterval(onlineWait);
        onlineWait = setInterval(() => { if (tryMount()) { clearInterval(onlineWait); onlineWait = null; } }, 500);
      }
    }

    function setTab(t) {
      tab = t;
      savePrefs({ tab: t });
      tabMii.classList.toggle("on", t === "mii");
      tabOnline.classList.toggle("on", t === "online");
      tabMii.setAttribute("aria-selected", t === "mii");
      tabOnline.setAttribute("aria-selected", t === "online");
      paneMii.hidden = t !== "mii";
      paneOnline.hidden = t !== "online";
      // the online view only lives while its tab is open
      if (t === "online") drawOnline();
      else { clearInterval(onlineWait); onlineWait = null; unmountOnline(); paneOnline.innerHTML = ""; }
    }
    tabMii.addEventListener("click", () => setTab("mii"));
    tabOnline.addEventListener("click", () => setTab("online"));

    function close() {
      if (closed) return;
      closed = true;
      clearInterval(onlineWait);
      unmountOnline();
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      if (lobby && lobby.close === close) lobby = null;
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", close);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });

    drawMii();
    setTab(tab);
    lobby = { close };
    return lobby;
  }

  root.ChessUI = { createBoard, playMii, openLobby, pieceSVG, isOpen: () => !!current || !!lobby };
})(typeof self !== "undefined" ? self : this);
