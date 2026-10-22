/*
 * chessOnline.js
 * Online chess against other people, through the same server as online Paintball.
 * Shown in the Chess window's "Online" tab: find a game or host one (optional
 * password and clock), then play. The server keeps the real board and the clocks
 * (see server/chess-rooms.js), so nobody can cheat by sending impossible moves.
 *
 * Use: const view = ChessOnline.mount(container, { createBoard, Chess, playerName, playerColor })
 *      view.destroy()   (also happens by itself when the container leaves the page)
 */
(function (root) {
  "use strict";

  const VERSION = 5;          // must match the server's VERSION (server/paintball-server.js)
  const DEFAULT_PORT = 8787;
  const TIMES = [
    { id: "0+0", label: "No clock", time: 0, inc: 0 },
    { id: "1+0", label: "1 min (bullet)", time: 1, inc: 0 },
    { id: "3+2", label: "3 + 2 (blitz)", time: 3, inc: 2 },
    { id: "5+0", label: "5 min (blitz)", time: 5, inc: 0 },
    { id: "10+0", label: "10 min (rapid)", time: 10, inc: 0 },
    { id: "15+10", label: "15 + 10 (rapid)", time: 15, inc: 10 },
    { id: "30+0", label: "30 min (classical)", time: 30, inc: 0 },
  ];
  const REASONS = {
    checkmate: "by checkmate", stalemate: "stalemate", repetition: "threefold repetition", fifty: "fifty-move rule",
    material: "not enough pieces to mate", resign: "by resignation", time: "on time", left: "opponent left", agreed: "agreed draw",
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtClock = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.ceil(ms / 1000);
    if (ms < 10000) return (ms / 1000).toFixed(1);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  const timeLabel = (t, i) => (!t ? "No clock" : t + (i ? " + " + i : " min"));

  function normalizeUrl(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
    if (!/^wss?:\/\//i.test(s)) s = "ws://" + s;
    try {
      const u = new URL(s);
      if (u.protocol === "ws:" && !u.port) u.port = String(DEFAULT_PORT);
      return u.toString().replace(/\/$/, "");
    } catch (e) { return s; }
  }
  // the same server Paintball uses (built apps know it; you can also type one in Paintball's Online tab)
  let configLoading = null;
  function loadConfig() {
    if (root.PB_CONFIG) return Promise.resolve();
    if (configLoading) return configLoading;
    configLoading = new Promise((resolve) => {
      const sc = document.createElement("script");
      sc.src = "js/paintball/pb-config.js";
      sc.onload = sc.onerror = () => resolve();
      document.head.appendChild(sc);
    });
    return configLoading;
  }
  function serverUrl() {
    let saved = "";
    try { saved = (JSON.parse(localStorage.getItem("mii-hub-paintball") || "{}").server || "").trim(); } catch (e) { /* private window */ }
    return normalizeUrl(saved || (root.PB_CONFIG && root.PB_CONFIG.server) || "");
  }

  // a tiny "tock" for moves (no sound files needed)
  let actx = null;
  let lastTock = 0;
  function tock(capture) {
    if (Date.now() - lastTock < 150) return; // never twice for one move
    lastTock = Date.now();
    try {
      actx = actx || new (root.AudioContext || root.webkitAudioContext)();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(capture ? 300 : 520, t); o.frequency.exponentialRampToValueAtTime(capture ? 120 : 260, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(capture ? 0.35 : 0.25, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.14);
    } catch (e) { /* no audio */ }
  }

  function injectStyle() {
    if (document.getElementById("cho-style")) return;
    const st = document.createElement("style");
    st.id = "cho-style";
    st.textContent = `
.cho{display:flex;flex-direction:column;gap:12px;color:var(--text)}
.cho-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.85rem;color:var(--muted);font-weight:700}
.cho-bar .dot{color:#2fbf5a}
.cho-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:700px){.cho-cols{grid-template-columns:1fr}}
.cho-card{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:12px}
.cho-card h3{margin:0 0 8px;font-size:.95rem}
.cho-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.cho-room{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--panel);border:1px solid var(--border)}
.cho-room .nm{flex:1;min-width:0}
.cho-room .nm b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cho-room .nm small{color:var(--muted);font-weight:700}
.cho-empty{color:var(--muted);font-size:.85rem;padding:10px 4px}
.cho-form{display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;font-size:.85rem;font-weight:700}
.cho-form input,.cho-form select{padding:7px 9px;border-radius:9px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-weight:600;min-width:0}
.cho-btn{padding:8px 14px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-weight:800;cursor:pointer;font:inherit;font-weight:800}
.cho-btn:hover{background:var(--accent-dark)}
.cho-btn.alt{background:var(--panel);color:var(--text);border:1px solid var(--border)}
.cho-btn.warn{background:var(--danger)}
.cho-btn:disabled{opacity:.5;cursor:default}
.cho-msg{font-size:.85rem;font-weight:700;min-height:1.2em}
.cho-msg.err{color:var(--danger)}
.cho-game{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:14px;align-items:start}
.cl-card.cl-playing{width:min(1060px,100%)}
.cl-playing .cho-game{grid-template-columns:minmax(0,1fr) 250px;justify-items:center}
.cl-playing .cho-boardwrap{width:min(100%,calc(100vh - 250px));min-width:280px}
.cl-playing .cho-side{justify-self:stretch}
@media (max-width:760px){.cho-game{grid-template-columns:1fr}}
.cho-boardwrap{display:flex;flex-direction:column;gap:8px;min-width:0}
.cho-player{display:flex;align-items:center;gap:8px;font-weight:800}
.cho-player .sw{width:14px;height:14px;border-radius:50%;border:2px solid var(--border)}
.cho-player .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cho-clock{font-variant-numeric:tabular-nums;font-size:1.05rem;padding:3px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);min-width:64px;text-align:center}
.cho-clock.run{background:var(--accent);color:#fff;border-color:var(--accent)}
.cho-clock.low{background:var(--danger);color:#fff;border-color:var(--danger)}
.cho-side{display:flex;flex-direction:column;gap:10px}
.cho-moves{max-height:260px;overflow:auto;font-size:.85rem;display:grid;grid-template-columns:auto 1fr 1fr;gap:2px 8px;font-variant-numeric:tabular-nums}
.cho-moves .n{color:var(--muted)}
.cho-status{font-weight:800;font-size:.95rem}
.cho-result{padding:10px;border-radius:12px;text-align:center;font-weight:900;background:var(--bg);border:2px solid var(--accent)}
.cho-row{display:flex;gap:6px;flex-wrap:wrap}
`;
    document.head.appendChild(st);
  }

  function mount(container, ctx) {
    injectStyle();
    const C = ctx.Chess || root.Chess;
    const wrap = el("div", "cho");
    container.innerHTML = "";
    container.appendChild(wrap);
    let ws = null, myId = null, destroyed = false, rooms = [], room = null, board = null, boardOrient = null;
    let clockTimer = null, clockSnap = null, lastMoves = -1, askPass = null;

    const bar = el("div", "cho-bar", "Connecting…");
    const msg = el("div", "cho-msg");
    const body = el("div");
    wrap.append(bar, msg, body);
    const say = (t, err) => { msg.textContent = t || ""; msg.classList.toggle("err", !!err); };
    const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

    // ---------- the lobby list + host form ----------
    let lobbyEls = null;
    function renderLobby() {
      if (!lobbyEls || !body.contains(lobbyEls.cols)) buildLobby();
      const { list, busyNote } = lobbyEls;
      list.innerHTML = "";
      const open = rooms.filter((r) => r.players < 2);
      if (!open.length) list.appendChild(el("div", "cho-empty", "No open games right now. Host one and a friend can join!"));
      for (const r of open) {
        const row = el("div", "cho-room");
        const nm = el("div", "nm");
        nm.append(el("b", null, (r.locked ? "🔒 " : "♟️ ") + r.name), el("small", null, "Host: " + r.host + " · " + timeLabel(r.time, r.inc)));
        const b = el("button", "cho-btn", "Join");
        b.onclick = () => {
          if (r.locked) { askPass = r.id; renderLobby(); return; }
          send({ t: "chJoin", room: r.id });
        };
        row.append(nm, b);
        list.appendChild(row);
        if (askPass === r.id) {
          const pr = el("div", "cho-room");
          const inp = el("input"); inp.type = "password"; inp.placeholder = "Password"; inp.style.flex = "1";
          const go = el("button", "cho-btn", "Join");
          const join = () => send({ t: "chJoin", room: r.id, password: inp.value });
          go.onclick = join; inp.onkeydown = (e) => { if (e.key === "Enter") join(); };
          pr.append(inp, go);
          list.appendChild(pr);
          setTimeout(() => inp.focus(), 0);
        }
      }
      const busy = rooms.length - open.length;
      busyNote.textContent = busy ? busy + " game" + (busy > 1 ? "s" : "") + " being played right now." : "";
    }
    function buildLobby() {
      setPlaying(false);
      stopBoard();
      gameEls = null;
      body.innerHTML = "";
      const cols = el("div", "cho-cols");
      const find = el("div", "cho-card");
      find.appendChild(el("h3", null, "🔎 Find a game"));
      const list = el("div", "cho-list");
      const busyNote = el("div", "cho-empty");
      find.append(list, busyNote);

      const host = el("div", "cho-card");
      host.appendChild(el("h3", null, "🏠 Host a game"));
      const form = el("div", "cho-form");
      const name = el("input"); name.value = (ctx.playerName || "Mii") + "'s game"; name.maxLength = 32;
      const pass = el("input"); pass.type = "password"; pass.placeholder = "(optional)"; pass.maxLength = 32;
      const time = el("select");
      for (const t of TIMES) { const o = el("option", null, t.label); o.value = t.id; time.appendChild(o); }
      time.value = "10+0";
      const side = el("select");
      for (const [v, l] of [["random", "Random"], ["w", "White"], ["b", "Black"]]) { const o = el("option", null, l); o.value = v; side.appendChild(o); }
      form.append(el("span", null, "Name"), name, el("span", null, "Password"), pass, el("span", null, "Clock"), time, el("span", null, "You play"), side);
      const go = el("button", "cho-btn", "Host game");
      go.style.marginTop = "10px";
      go.onclick = () => {
        const t = TIMES.find((x) => x.id === time.value) || TIMES[0];
        send({ t: "chCreate", name: name.value, password: pass.value, time: t.time, inc: t.inc, side: side.value });
      };
      host.append(form, go);
      cols.append(find, host);
      body.appendChild(cols);
      lobbyEls = { cols, list, busyNote };
    }

    // ---------- your game ----------
    function myColor() { return room && room.white && room.white.id === myId ? "w" : room && room.black && room.black.id === myId ? "b" : null; }
    function stopBoard() {
      clearInterval(clockTimer); clockTimer = null;
      if (board) { board.destroy(); board = null; boardOrient = null; }
      lastMoves = -1;
    }
    let gameEls = null;
    // while you're in a game, the chess window grows so the board is big
    const setPlaying = (on) => { const card = container.closest(".cl-card"); if (card) card.classList.toggle("cl-playing", on); };
    function renderGame() {
      setPlaying(!!room && room.state !== "waiting"); // (once your opponent is here)
      const me = myColor();
      if (!gameEls || !body.contains(gameEls.root)) {
        stopBoard();
        body.innerHTML = "";
        const g = el("div", "cho-game");
        const bw = el("div", "cho-boardwrap");
        const top = el("div", "cho-player"), bottom = el("div", "cho-player");
        const holder = el("div");
        bw.append(top, holder, bottom);
        const side = el("div", "cho-side");
        const status = el("div", "cho-status");
        const result = el("div", "cho-result"); result.hidden = true;
        const actions = el("div", "cho-row");
        const moves = el("div", "cho-moves");
        const movesCard = el("div", "cho-card");
        movesCard.append(el("h3", null, "Moves"), moves);
        side.append(status, result, actions, movesCard);
        g.append(bw, side);
        body.appendChild(g);
        board = ctx.createBoard(holder, {
          orientation: me || "w",
          onMove: (mv) => {
            if (!room || room.state !== "playing" || C.turn(gameState()) !== me) return;
            // show it straight away; the server confirms (or puts it back)
            const next = C.move(gameState(), mv);
            if (!next) return;
            const lm = C.legalMoves(gameState(), mv.from).find((m) => m.to === mv.to);
            tock(lm && lm.capture);
            lastMoves = room.moves.length + 1; // so the server's echo of this move doesn't tock again
            board.setPosition(next, { from: mv.from, to: mv.to });
            board.setInteractive(null);
            send({ t: "chMove", from: mv.from, to: mv.to, promo: mv.promo, n: room.moves.length });
          },
        });
        boardOrient = me || "w";
        gameEls = { root: g, top, bottom, status, result, actions, moves };
        clockTimer = setInterval(tickClocks, 100);
      }
      const E = gameEls;
      if ((me || "w") !== boardOrient) { board.setOrientation(me || "w"); boardOrient = me || "w"; }
      // players (you at the bottom)
      const bottomCol = me || "w", topCol = bottomCol === "w" ? "b" : "w";
      const fill = (row, col) => {
        const p = col === "w" ? room.white : room.black;
        row.innerHTML = "";
        const sw = el("span", "sw"); sw.style.background = col === "w" ? "#f4f4f4" : "#222";
        const nm = el("span", "nm", p ? p.name + (p.id === myId ? " (you)" : "") : "Waiting for an opponent…");
        if (p) nm.style.color = p.color;
        const ck = el("span", "cho-clock"); ck.dataset.col = col;
        ck.hidden = !room.time;
        row.append(sw, nm, ck);
      };
      fill(E.top, topCol); fill(E.bottom, bottomCol);
      // board
      const st = gameState();
      if (room.moves.length !== lastMoves) {
        if (lastMoves >= 0 && room.moves.length > lastMoves && room.last) tock(/x/.test(room.moves[room.moves.length - 1] || ""));
        lastMoves = room.moves.length;
      }
      board.setPosition(st, room.last || null);
      board.setInteractive(room.state === "playing" && me && C.turn(st) === me ? me : null);
      // status, result, buttons
      E.result.hidden = room.state !== "over";
      if (room.state === "over") {
        const won = room.result === me, draw = room.result === "draw";
        E.result.textContent = (draw ? "½–½ Draw" : won ? "🏆 You won" : room.result ? "You lost" : "Game over") + " · " + (REASONS[room.reason] || room.reason || "");
        E.result.style.borderColor = draw ? "var(--muted)" : won ? "#2fbf5a" : "var(--danger)";
        // game review (once per game)
        const key = room.id + ":" + room.game;
        if (root.ChessAnalysis && E.reviewed !== key) {
          E.reviewed = key;
          if (E.review) E.review.remove();
          E.review = el("div");
          E.result.after(E.review);
          root.ChessAnalysis.render(E.review, { moves: room.moves.slice(), you: me || "w", names: { w: room.white ? room.white.name : "White", b: room.black ? room.black.name : "Black" } });
        }
      } else if (E.review) { E.review.remove(); E.review = null; E.reviewed = null; }
      E.status.textContent = room.state === "waiting" ? "Waiting for someone to join \"" + room.name + "\"…"
        : room.state === "playing" ? (C.turn(st) === me ? "Your move" + (room.check ? " · check!" : "") : "Opponent's move" + (room.check ? " · check!" : ""))
        : "";
      E.actions.innerHTML = "";
      const btn = (label, cls, fn, dis) => { const b = el("button", "cho-btn " + (cls || ""), label); b.onclick = fn; b.disabled = !!dis; E.actions.appendChild(b); return b; };
      if (room.state === "playing") {
        if (room.drawOffer && room.drawOffer !== myId) {
          btn("Accept draw", "", () => send({ t: "chDraw", a: "accept" }));
          btn("Decline", "alt", () => send({ t: "chDraw", a: "decline" }));
        } else btn(room.drawOffer === myId ? "Draw offered…" : "Offer draw", "alt", () => send({ t: "chDraw", a: "offer" }), !!room.drawOffer);
        btn("Resign", "warn", () => { if (confirm("Resign this game?")) send({ t: "chResign" }); });
      } else if (room.state === "over" && room.white && room.black) {
        const asked = room.rematch.includes(myId), they = room.rematch.some((id) => id !== myId);
        btn(asked ? "Waiting for them…" : they ? "Accept rematch" : "Rematch", "", () => send({ t: "chRematch" }), asked);
      }
      btn("Leave", "alt", () => {
        if (room.state === "playing" && !confirm("Leaving now loses the game. Leave?")) return;
        send({ t: "chLeave" }); room = null; gameEls = null; send({ t: "chList" }); renderLobby();
      });
      // move list
      E.moves.innerHTML = "";
      for (let i = 0; i < room.moves.length; i += 2) {
        E.moves.append(el("span", "n", i / 2 + 1 + "."), el("span", null, room.moves[i]), el("span", null, room.moves[i + 1] || ""));
      }
      E.moves.scrollTop = E.moves.scrollHeight;
      clockSnap = room.clock ? { w: room.clock.w, b: room.clock.b, running: room.clock.running, at: performance.now() } : null;
      tickClocks();
    }
    function gameState() { return room && room.fen ? C.fromFEN(room.fen) : C.newGame(); }
    function tickClocks() {
      if (!gameEls) return;
      if (!body.isConnected || !container.isConnected) return destroy();
      if (!clockSnap) return;
      for (const ck of gameEls.root.querySelectorAll(".cho-clock")) {
        const col = ck.dataset.col;
        let t = clockSnap[col];
        if (clockSnap.running === col) t -= performance.now() - clockSnap.at;
        ck.textContent = fmtClock(t);
        ck.classList.toggle("run", clockSnap.running === col && t >= 20000);
        ck.classList.toggle("low", clockSnap.running === col && t < 20000);
      }
    }

    // ---------- the connection ----------
    async function connect() {
      await loadConfig();
      if (destroyed) return;
      const url = serverUrl();
      if (!url) { bar.textContent = "No online server is set up in this copy of Mii Hub."; return; }
      try { ws = new WebSocket(url); } catch (e) { bar.textContent = "That server address doesn't look right."; return; }
      const slow = setTimeout(() => { if (ws.readyState !== 1) bar.textContent = "Waking up the server…"; }, 5000);
      ws.onopen = () => {
        clearTimeout(slow);
        send({ t: "hello", v: VERSION, name: ctx.playerName || "Mii", color: ctx.playerColor || "#2b7cff", mii: { kind: "demo" } });
      };
      ws.onerror = () => { if (!destroyed) bar.textContent = "Couldn't reach the online server. It may be switched off: try again in a bit."; };
      ws.onclose = () => {
        if (destroyed) return;
        stopBoard(); gameEls = null; room = null;
        body.innerHTML = "";
        bar.textContent = "Disconnected from the server.";
        const again = el("button", "cho-btn", "Reconnect");
        again.onclick = () => { bar.textContent = "Connecting…"; body.innerHTML = ""; connect(); };
        body.appendChild(again);
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === "welcome") {
          myId = m.id;
          bar.innerHTML = "";
          const d = el("span", "dot", "🟢"); bar.append(d, document.createTextNode(" " + m.name + " · " + m.online + " online"));
          send({ t: "chList" });
          renderLobby();
        } else if (m.t === "chRooms") {
          rooms = m.rooms;
          if (!room) renderLobby();
        } else if (m.t === "chRoom") {
          room = m.room; askPass = null; say("");
          renderGame();
        } else if (m.t === "err") {
          say(m.msg, true);
          if (m.code === "password") { askPass = m.room; if (!room) renderLobby(); }
        }
      };
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      setPlaying(false);
      stopBoard();
      if (ws) { try { ws.close(); } catch (e) { /* closed */ } }
    }
    // tidy up by ourselves if the window is closed
    const watch = setInterval(() => { if (!container.isConnected || !wrap.isConnected) { clearInterval(watch); destroy(); } }, 1000);
    connect();
    return { destroy: () => { clearInterval(watch); destroy(); } };
  }

  root.ChessOnline = { mount, VERSION, normalizeUrl };
})(typeof window !== "undefined" ? window : globalThis);
