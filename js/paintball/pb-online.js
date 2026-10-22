/*
 * paintball/pb-online.js
 * Online Paintball: talking to the server (server/paintball-server.js) and
 * the "Online" tab of the Paintball lobby.
 *
 *   1. Opening the Online tab connects to the Mii Hub Paintball server (one
 *      server everyone uses, so nobody has to open ports). Your chosen Mii (its
 *      .glb file, or its colors for a random Mii) is sent so others can see it.
 *   2. Find Lobby: a list of everyone hosting (🔒 = needs a password), or
 *      Host Lobby: a name, an optional password and how many players.
 *   3. The lobby's host presses Start. Everyone plays Respawn mode: first to
 *      20 eliminations (or the most after 10 minutes).
 *
 * The match itself is pb-game.js (Match with a `net`). The server is the
 * referee: it keeps everyone's HP and score.
 */
(function (root) {
  "use strict";

  const VERSION = 6;          // must match the server's VERSION
  const DEFAULT_PORT = 8787;
  // Where everyone meets to find lobbies (the Mii Hub Paintball server, see server/README.md).
  // It's built into the app from a secret when it's built (pb-config.js), so it's not in the code.
  const DEFAULT_SERVER = (root.PB_CONFIG && root.PB_CONFIG.server) || "";

  // "my-pc" -> "ws://my-pc:8787", "https://x.example" -> "wss://x.example"
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

  function toBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.buffer;
  }

  // ---------------------------------------------------------------------
  // The connection
  // ---------------------------------------------------------------------
  class Net {
    constructor(url) {
      this.url = url;
      this.handlers = new Map();
      this.id = null;
      this.ping = null;
      this.closed = false;
    }
    connect() {
      return new Promise((resolve, reject) => {
        let ws;
        try { ws = new WebSocket(this.url); } catch (e) { reject(new Error("That address doesn't look right.")); return; }
        this.ws = ws;
        let opened = false;
        // (a free cloud server can take a little while to wake up)
        const timer = setTimeout(() => { if (!opened) { ws.close(); reject(new Error("The Paintball server didn't answer. It may be switched off: try again in a bit.")); } }, 45000);
        if (this.onSlow) this.slowTimer = setTimeout(() => { if (!opened) this.onSlow(); }, 5000);
        ws.onopen = () => { opened = true; clearTimeout(timer); clearTimeout(this.slowTimer); resolve(); this.pingTimer = setInterval(() => this.send({ t: "ping", c: performance.now() }), 2000); };
        ws.onerror = () => { if (!opened) { clearTimeout(timer); clearTimeout(this.slowTimer); reject(new Error("Couldn't reach the Paintball server. It may be switched off: try again in a bit.")); } };
        ws.onclose = () => {
          clearInterval(this.pingTimer);
          const was = !this.closed;
          this.closed = true;
          if (opened && was) this.emit({ t: "close" });
        };
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === "pong") this.ping = Math.round(performance.now() - m.c);
          if (m.t === "welcome") this.id = m.id;
          this.emit(m);
        };
      });
    }
    emit(m) {
      const set = this.handlers.get(m.t);
      if (set) for (const fn of Array.from(set)) { try { fn(m); } catch (e) { console.error(e); } }
    }
    on(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(fn);
      return () => this.handlers.get(type).delete(fn);
    }
    // handle({ type: fn, ... }) -> a function that removes them all again
    handle(map) {
      const offs = Object.entries(map).map(([t, fn]) => this.on(t, fn));
      return () => offs.forEach((off) => off());
    }
    send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
    close() { this.closed = true; clearInterval(this.pingTimer); try { this.ws.close(); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------------
  // The Online tab
  // ---------------------------------------------------------------------
  function create(ctx) {
    const { el, opts, settings } = ctx;
    const st = {
      net: null, status: "", statusCls: "", connecting: false,
      rooms: [], room: null, roster: new Map(), loading: new Map(), starting: false,
      spawned: new Map(), // who's alive in the match and where they came in (for joining late)
      askPass: null,      // the lobby we're typing a password for
      failed: false,
    };
    let container = null;
    const rerender = () => { if (container && !ctx.inMatch()) render(container); };
    const setStatus = (text, cls) => { st.status = text; st.statusCls = cls || ""; rerender(); };

    // turn a player's Mii (as the server sent it) into something we can draw
    function loadMii(m) {
      if (st.loading.has(m.id)) return st.loading.get(m.id);
      const mii = m.mii || {};
      const rec = {
        id: "net-" + m.id, name: m.name, kind: mii.kind === "glb" ? "glb" : "demo",
        bytes: mii.kind === "glb" ? fromBase64(mii.b64) : null, fileName: mii.fileName || "mii.glb",
        look: mii.look || {},
      };
      const p = opts.templateFor(rec).then((tpl) => {
        const entry = { id: m.id, name: m.name, color: m.color, skins: m.skins || null, rec, tpl, look: opts.lookFor(rec, tpl) || {} };
        st.roster.set(m.id, entry);
        rerender();
        return entry;
      }).catch((err) => {
        console.error("Couldn't load " + m.name + "'s Mii", err);
        // fall back to the sample Mii so they can still play
        const r2 = Object.assign({}, rec, { kind: "demo", bytes: null });
        return opts.templateFor(r2).then((tpl) => {
          const entry = { id: m.id, name: m.name, color: m.color, skins: m.skins || null, rec: r2, tpl, look: {} };
          st.roster.set(m.id, entry);
          return entry;
        });
      });
      st.loading.set(m.id, p);
      return p;
    }

    // the Mii Hub online server everyone uses (can be changed under "Server")
    const serverAddress = () => (settings.server || DEFAULT_SERVER || "").trim();

    async function connect(address) {
      address = (address || "").trim();
      const url = normalizeUrl(address);
      if (!url) return setStatus("", "");
      disconnect(true);
      st.connecting = true;
      st.failed = false;
      setStatus("Connecting to the Paintball server…");
      const net = new Net(url);
      net.onSlow = () => setStatus("Waking up the Paintball server… (this can take up to a minute)");
      try {
        await net.connect();
      } catch (err) {
        st.connecting = false;
        st.failed = true;
        return setStatus(err.message, "err");
      }
      st.net = net;
      st.connecting = false;
      net.handle({
        welcome: (m) => { st.serverName = m.name || "Server"; st.online = m.online; setStatus("", ""); },
        rooms: (m) => { st.rooms = m.rooms; rerender(); },
        room: (m) => {
          st.room = m.room; st.askPass = null;
          // you're in a lobby: straight onto the map
          if (!ctx.inMatch() && !st.starting) enterLobby(); else rerender();
        },
        err: (m) => {
          if (m.code === "password") { st.askPass = m.room; setStatus(m.msg, "err"); }
          else setStatus(m.msg, "err");
        },
        mii: (m) => {
          loadMii(m).then((entry) => {
            const match = root.__pb;
            if (match && match.online && match.net === net && !match.disposed) match.addLateRemote(entry);
          });
        },
        bye: (m) => { st.roster.delete(m.id); st.loading.delete(m.id); rerender(); },
        skins: (m) => { const e = st.roster.get(m.id); if (e) e.skins = m.s; },
        // (remembered so a match that's still loading can catch up)
        warmup: (m) => { st.phase = stamp(m); st.over = st.inter = st.votes = null; },
        start: (m) => { st.phase = stamp(m); st.over = st.inter = st.votes = null; if (!m.late) st.spawned.clear(); },
        round: (m) => { st.roundMsg = stamp(m); st.spawned.clear(); },
        over: (m) => { st.over = stamp(m); },
        intermission: (m) => { st.inter = stamp(m); },
        votes: (m) => { st.votes = m; },
        spawn: (m) => st.spawned.set(m.id, m),
        kill: (m) => st.spawned.delete(m.v),
        close: () => {
          st.net = null; st.room = null; st.rooms = []; st.roster.clear(); st.loading.clear();
          st.failed = true;
          setStatus("Lost the connection to the Paintball server.", "err");
        },
      });
      await sendHello();
    }

    async function sendHello() {
      const you = ctx.you;
      const tpl = await opts.templateFor(you);
      const mii = you.kind === "glb" && you.bytes ? { kind: "glb", b64: toBase64(you.bytes), fileName: you.fileName || "mii.glb" } : { kind: "demo", look: you.look || {} };
      if (st.net) st.net.send({ t: "hello", v: VERSION, name: you.name || "Mii", color: ctx.paintFor(tpl), mii, skins: root.PBCrates && PBCrates.equipped ? PBCrates.equipped() : null });
    }

    function disconnect(quiet) {
      if (st.net) st.net.close();
      st.net = null; st.room = null; st.rooms = []; st.roster.clear(); st.loading.clear();
      if (!quiet) setStatus("");
    }

    function hostLobby(name, password, max) {
      st.net.send({ t: "create", name: name || (ctx.you.name || "My") + "'s lobby", password: password || "", max });
    }
    function joinLobby(id, password) {
      st.net.send({ t: "join", room: id, password: password || "" });
    }

    const stamp = (m) => Object.assign({ at: performance.now() }, m);

    // load the map and jump in (warmup, a match in progress, or the vote between matches)
    async function enterLobby() {
      if (st.starting) return;
      st.starting = true;
      try {
        const room = st.room;
        // wait for everyone's Mii to be ready (they're sent when you join)
        const ids = room ? room.players.map((p) => p.id).filter((id) => id !== st.net.id) : [];
        const entries = await Promise.all(ids.map((id) => st.loading.get(id) || Promise.resolve(st.roster.get(id))));
        if (!st.room || !st.net) return;
        // the server gives everyone in the lobby their own paint color
        const colorOf = (id) => { const p = st.room.players.find((x) => x.id === id); return p && p.color; };
        for (const e of entries) if (e && colorOf(e.id)) e.color = colorOf(e.id);
        for (const e of entries) if (e) e.spawn = st.spawned.get(e.id) || null;
        await ctx.startOnline({
          youColor: colorOf(st.net.id),
          net: st.net, roster: entries.filter(Boolean), roomName: st.room.name, map: (st.phase && st.phase.map) || st.room.map,
          initial: { phase: st.phase, round: st.roundMsg, over: st.over, inter: st.inter, votes: st.votes },
          onLeave: () => leaveLobby(),
        });
      } finally { st.starting = false; }
    }
    function leaveLobby() {
      if (st.net) { st.net.send({ t: "leave" }); st.net.send({ t: "list" }); }
      st.room = null; st.phase = st.roundMsg = st.over = st.inter = st.votes = null;
      st.spawned.clear();
    }

    // ---- drawing the tab ----
    const stop = (e) => e.stopPropagation(); // typing in a box shouldn't trigger game keys
    function input(placeholder, value, type) {
      const i = el("input"); i.type = type || "text"; i.placeholder = placeholder; i.value = value || "";
      i.spellcheck = false; i.addEventListener("keydown", stop);
      return i;
    }

    function render(c) {
      container = c;
      const old = c.querySelector(".pb-online");
      if (old) old.remove();
      const wrap = el("div", "pb-online");
      const addr = serverAddress();
      // connect by itself when you open the tab
      if (!st.net && !st.connecting && !st.failed && addr) setTimeout(() => connect(addr), 0);

      // left: who you play as (+ settings)
      const left = el("div");
      const inLobby = !!st.room;
      left.appendChild(el("h2", "pb-h2", "Play as"));
      left.appendChild(ctx.miiPicker(opts, ctx.recs, ctx.you, null, (r) => {
        if (inLobby) return setStatus("Leave the lobby to change your Mii.", "err");
        ctx.setYou(r);
        if (st.net) sendHello();
        rerender();
      }));
      const setBox = el("div", "pb-box");
      setBox.style.marginTop = "16px";
      setBox.appendChild(el("h3", null, "Settings"));
      ctx.settingsControls(setBox, settings, () => ctx.save());
      left.appendChild(setBox);

      const right = el("div");
      if (!st.net) right.appendChild(connectBox(addr));
      else if (!st.room) right.append(findBox(), hostBox());
      else right.appendChild(lobbyBox());
      wrap.append(left, right);
      c.appendChild(wrap);
    }

    // not connected (yet)
    function connectBox(addr) {
      const box = el("div", "pb-box");
      box.appendChild(el("h3", null, "Online"));
      if (st.connecting) box.appendChild(el("div", "pb-status", st.status || "Connecting to the Paintball server…"));
      else if (!addr) box.appendChild(el("div", "pb-help", "Online play isn't set up yet: it needs the Mii Hub Paintball server's address."));
      if (st.status && !st.connecting) box.appendChild(el("div", "pb-status " + st.statusCls, st.status));
      if (addr && !st.connecting) {
        const retry = el("button", "pb-btn primary", "Try again");
        retry.addEventListener("click", () => connect(addr));
        box.appendChild(retry);
      }
      box.appendChild(serverSetting(!addr));
      return box;
    }

    // "Server" (where everyone meets): hidden away unless it's needed
    function serverSetting(open) {
      const d = el("details", "pb-server");
      if (open) d.open = true;
      d.appendChild(el("summary", null, "Server"));
      const row = el("div", "pb-row");
      const inp = input("Your own server's address (leave empty for the normal one)", settings.server || "");
      const go = el("button", "pb-btn", "Connect");
      const doIt = () => { settings.server = inp.value.trim(); ctx.save(); connect(serverAddress()); };
      go.addEventListener("click", doIt);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doIt(); });
      row.append(inp, go);
      d.appendChild(row);
      d.appendChild(el("div", "pb-help", "Everyone has to use the same server. Leave this empty unless you run your own."));
      return d;
    }

    // the list of lobbies people are hosting
    function findBox() {
      const box = el("div", "pb-box");
      const head = el("div", "pb-boxhead");
      head.appendChild(el("h3", null, "Find Lobby"));
      head.appendChild(el("span", "pb-srv", "🟢 " + (st.serverName || "Server") + (st.online ? " · " + st.online + " online" : "")));
      const refresh = el("button", "pb-btn small", "↻");
      refresh.title = "Refresh";
      refresh.addEventListener("click", () => st.net.send({ t: "list" }));
      head.appendChild(refresh);
      box.appendChild(head);
      if (st.status && st.statusCls === "err" && !st.askPass) box.appendChild(el("div", "pb-status err", st.status));
      const list = el("div", "pb-rooms");
      if (!st.rooms.length) list.appendChild(el("div", "pb-help", "Nobody's hosting right now. Host a lobby below and your friends will see it here!"));
      for (const r of st.rooms) {
        const item = el("div", "pb-room");
        item.appendChild(el("span", "lock", r.locked ? "🔒" : "🌐"));
        const info = el("div", "info");
        info.append(el("b", null, r.name), el("span", null, "Host: " + (r.host || "?") + " · " + (r.state === "live" ? "playing" : r.state === "over" ? "just finished" : "waiting")));
        item.appendChild(info);
        item.appendChild(el("span", "count", r.players + "/" + r.max));
        const full = r.players >= r.max;
        if (st.askPass === r.id) {
          const pw = input("Password", "", "password");
          const go = el("button", "pb-btn primary", "Join");
          const doIt = () => joinLobby(r.id, pw.value);
          go.addEventListener("click", doIt);
          pw.addEventListener("keydown", (e) => { if (e.key === "Enter") doIt(); });
          const row = el("div", "pb-row pass");
          row.append(pw, go);
          item.appendChild(row);
          if (st.status) item.appendChild(el("div", "pb-status err", st.status));
          setTimeout(() => pw.focus(), 0);
        } else {
          const j = el("button", "pb-btn primary", full ? "Full" : "Join");
          j.disabled = full;
          j.addEventListener("click", () => { if (r.locked) { st.askPass = r.id; setStatus("", ""); } else joinLobby(r.id); });
          item.appendChild(j);
        }
        list.appendChild(item);
      }
      box.appendChild(list);
      return box;
    }

    // making your own lobby
    function hostBox() {
      const box = el("div", "pb-box");
      box.style.marginTop = "16px";
      box.appendChild(el("h3", null, "Host Lobby"));
      const name = input((ctx.you.name || "My") + "'s lobby", "");
      name.maxLength = 32;
      const pw = input("Password (optional: leave empty for anyone to join)", "", "password");
      pw.maxLength = 32;
      const max = el("select", "pb-select");
      for (let n = 2; n <= 8; n++) { const o = el("option", null, n + " players"); o.value = n; if (n === (settings.lobbyMax || 8)) o.selected = true; max.appendChild(o); }
      const go = el("button", "pb-go", "HOST ▶");
      go.addEventListener("click", () => { settings.lobbyMax = +max.value; ctx.save(); hostLobby(name.value.trim(), pw.value, +max.value); });
      const r1 = el("div", "pb-row"); r1.append(el("label", "pb-lbl", "Name"), name);
      const r2 = el("div", "pb-row"); r2.append(el("label", "pb-lbl", "Password"), pw);
      const r3 = el("div", "pb-row"); r3.append(el("label", "pb-lbl", "Players"), max, go);
      box.append(r1, r2, r3);
      box.appendChild(el("div", "pb-help", "Your lobby shows up in everyone's Find Lobby list. Nothing to set up: no ports, no addresses."));
      return box;
    }

    // you've joined a lobby: the map is loading
    function lobbyBox() {
      const box = el("div", "pb-box");
      box.appendChild(el("h3", null, (st.room.locked ? "🔒 " : "") + st.room.name));
      box.appendChild(el("div", "pb-status", "Joining…"));
      return box;
    }

    return {
      render,
      dispose() { disconnect(true); container = null; },
      get net() { return st.net; },
      get state() { return st; },
      connect, hostLobby, joinLobby, leaveLobby,
    };
  }

  root.PBOnline = { create, Net, normalizeUrl, VERSION, DEFAULT_SERVER };
})(window);
