/*
 * js/nscc/officeHub.js
 * The 3D office view: draws the room (from office.js) and the Miis, walks them
 * around, sits them at their desks, sends them out of the door and back in, and
 * lets you click a Mii.
 *
 * The app tells it what to do (see app.js):
 *   hub.addMii(id, template, look, how, desk)   how: "appear" (straight to its desk), "enter" (in through
 *                                         the door) or "return" (in through the door, back from somewhere)
 *   hub.setAssignments(assignments, onBoard, names)  who has which desk / office ({ miiId: spotId }),
 *                                         who's on today's board, and everyone's name (for the desk signs)
 *   hub.sendOut(id, kind, place)          kind: "leave" (still on the board, out) or "remove" (off the board)
 *   hub.bringBack(id)                     it was walking out: turn round and go back to work
 *   hub.presence()                        { id: "in" | "entering" | "leaving" | "removing" }
 *   hub.onSelect = (id) => ...            someone clicked a Mii
 * Miis are only ever friendly co-workers here: they work, take little breaks,
 * and now and then have a short chat (lines in chatter.js).
 */
(function () {
  "use strict";

  const THREE = window.THREE;
  const M = window.MiiModel;
  const C = window.NSCCChatter;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (k) => k * k * (3 - 2 * k);
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
  const MII_HEIGHT = 1.8;
  const FADE_DIST = 1.5;  // a Mii walking out fades away over its last 1.5 steps of the hallway (about a second)
  const FADE_TIME = 0.8;  // and fades in over 0.8 seconds walking in
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reducedMotion = () => !!(motionQuery && motionQuery.matches);
  function angleDiff(a, b) { return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
  function turnToward(a, b, amount) { return a + angleDiff(a, b) * Math.min(1, amount); }

  // How a Mii moves: a little different for everyone (from its id, so it's the
  // same every day), but always cheerful.
  function styleFor(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    const r = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
    const e = 0.35 + r() * 0.45, s = 0.45 + r() * 0.4, fun = 0.3 + r() * 0.5;
    return {
      stride: 0.42 + e * 0.3, armSwing: 0.45 + e * 0.55, armsOut: 0.04 + fun * 0.06, bounce: 0.01 + e * 0.05,
      lean: (e - 0.5) * 0.12, headDown: 0, wobble: Math.max(0, fun - 0.6) * 0.15, stomp: e * 0.3,
      gesture: 0.4 + s * 0.4, waveSize: 0.6 + s * 0.6, tempo: 0.7 + e * 0.6, dance: "sway",
      idle: e > 0.7 ? "bouncy" : fun > 0.7 ? "silly" : s > 0.75 ? "proud" : "relaxed",
      fidget: e, speed: rnd(1.6, 2.1) * (0.85 + e * 0.3),
    };
  }

  // ------------------------------------------------------------------
  // One Mii in the office
  // ------------------------------------------------------------------
  class Walker {
    constructor(hub, id, template, look) {
      this.hub = hub;
      this.id = id;
      this.template = template;
      this.look = look;
      this.style = styleFor(id);
      this.x = 0; this.z = 0;
      this.yaw = 0; this.targetYaw = 0; this.moveYaw = null; this.yawVel = 0;
      this.lookYaw = 0; this.lookUp = 0; this.lookIn = rnd(1, 4); this.lookMode = "ahead";
      this.blinkIn = rnd(1, 4); this.blinkT = 0;
      this.lift = 0; this.liftVel = 0; this.squash = 0; this.squashVel = 0;
      this.phase = 0; this.walkAmt = 0; this.curSpeed = 0;
      this.state = "idle";       // idle | walk | activity | talk | wait | exit | vanish
      this.mode = "in";          // in | entering | leaving | removing (for the board)
      this.timer = rnd(0.5, 2);
      this.path = null;
      this.spot = null;          // the work spot it's going to / using
      this.desk = null;          // its own desk
      this.anchor = null;        // { at: seat, yaw } while sitting
      this.lastAnchor = null;
      this.seatBlend = 0;
      this.arms = "down";
      this.partner = null;
      this.appear = 1;
      this.fade = 1;             // 1 = fully there; fades out down the hallway and in on the way back (see updateFade)
      this.bubble = null; this.emote = null;
      this.talkIn = rnd(60, 160);
      this.breaks = 0;
      this.arrive = null;        // what to do on arriving (a function)

      this.ui = document.createElement("div");
      this.ui.className = "mii-ui";
      this.ui.innerHTML = '<div class="bubble"></div><div class="emote"></div><div class="nametag"></div>';
      this.uiBubble = this.ui.children[0];
      this.uiEmote = this.ui.children[1];
      this.uiName = this.ui.children[2];
      this.uiName.textContent = look.name;
      hub.overlay.appendChild(this.ui);
      this.buildModel();
    }

    buildModel() {
      const old = this.inst;
      this.inst = M.createInstance(this.template, this.look);
      const info = this.template.info;
      this.sizeScale = (0.9 + clamp(info.height, 0, 127) / 127 * 0.2) * 1.3;
      this.inst.holder.scale.setScalar(this.sizeScale);
      this.inst.holder.rotation.order = "YXZ";
      // (the blinking eyes get their own material now, so a fade below never has to chase it)
      if (M.setEyesClosed) M.setEyesClosed(this.inst, false);
      this.fadeSaved = null; this.fadeShown = 1;
      this.hub.miiGroup.add(this.inst.holder);
      if (old) { this.hub.miiGroup.remove(old.holder); M.disposeObject(old.holder); }
    }

    setName(name) { this.look.name = name; this.uiName.textContent = name; }

    say(text, dur) {
      const showing = !!this.bubble && this.uiBubble.classList.contains("show");
      this.bubble = { text, time: 0, dur: dur || Math.max(2.4, text.length * 0.08) };
      this.uiBubble.textContent = text;
      this.uiBubble.classList.remove("bump");
      if (showing) { void this.uiBubble.offsetWidth; this.uiBubble.classList.add("bump"); }
      else this.uiBubble.classList.add("show");
    }
    showEmote(icon, dur) {
      this.emote = { icon, time: 0, dur: dur || 2 };
      this.uiEmote.textContent = icon;
      this.uiEmote.classList.add("show");
    }
    clearEmote() { this.emote = null; this.uiEmote.classList.remove("show"); }

    get speed() { return this.style.speed; }
    get anchored() { return this.seatBlend > 0.02; }

    // Plans a route to (x, z) around the furniture and starts walking. then() runs on arrival.
    // (alone = don't plan around the other Miis: going through the door, they make way)
    goTo(x, z, then, alone) {
      const path = this.hub.nav.findPath(this.x, this.z, x, z, alone ? null : this.hub.standingMiis(this));
      this.anchor = null;
      this.arms = "down"; // (whatever it was doing there - typing, cheering - it stops to walk)
      if (!path) { this.state = "idle"; this.timer = rnd(0.5, 1.5); this.spot = null; this.arrive = null; return false; }
      this.path = path;
      this.state = "walk";
      this.arrive = then || null;
      this.stuckTime = 0; this.repaths = 0; this.bestDist = Infinity;
      return true;
    }

    remove() {
      this.hub.miiGroup.remove(this.inst.holder);
      M.disposeObject(this.inst.holder);
      this.ui.remove();
    }
  }

  // Graphics quality: goes down a step when frames are slow, back up when quick.
  // Everything stays sharp: the picture is never drawn below the screen's own resolution
  // (ss = extra "supersampling" on top of it, for extra-crisp edges when there's time to spare);
  // when frames are slow it gives up the extra sharpness and soft shadows first.
  // It starts at the screen's own sharpness (START_RUNG) and only climbs to the extra-smooth
  // steps when the computer has plenty of time to spare. The very last step (a little below the
  // screen's sharpness) is only used when even that is too slow, so it stays usable.
  const QUALITY = [
    { ss: 2, shadows: true }, { ss: 1.5, shadows: true }, { ss: 1.25, shadows: true },
    { ss: 1, shadows: true }, { ss: 1, shadows: false }, { ss: 0.75, shadows: false, last: true },
  ];
  const START_RUNG = 3;
  const MAX_PIXEL_RATIO = 3; // (very high-res screens: no point drawing more than this)

  const pickA = new THREE.Vector3(), pickB = new THREE.Vector3(), pickOnRay = new THREE.Vector3(), pickOnSeg = new THREE.Vector3();
  const pointerNdc = new THREE.Vector2();
  const tmpV = new THREE.Vector3(), feetV = new THREE.Vector3();

  class OfficeHub {
    constructor(canvas, overlay, officeModule) {
      this.canvas = canvas;
      this.overlay = overlay;
      this.walkers = [];
      this.time = 0;
      this.timers = [];
      this.chatIn = rnd(35, 70);  // the next little chat (seconds)
      this.assignments = {};      // { miiId: spotId } who has their own desk / office
      this.onBoard = [];          // who's on today's board (in or out)
      this.onSelect = null;
      this.onGone = null;         // (id, mode) a Mii went out of the door
      this.clock = () => Date.now(); // what time it is (the app can set its own)

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
      this.controls = new THREE.OrbitControls(this.camera, canvas);
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.rotateSpeed = 0.6;
      this.controls.zoomSpeed = 0.6;
      this.controls.addEventListener("start", () => { this.centering = null; }); // (grabbing the view stops a Center glide)

      this.office = (officeModule || window.NSCCOffice).build(this.scene);
      this.scene.background = new THREE.Color(this.office.background);
      this.nav = new window.MiiNav.Nav(this.office.bounds, this.office.obstacles);
      this.miiGroup = new THREE.Group();
      this.scene.add(this.miiGroup);

      this.raycaster = new THREE.Raycaster();
      this.quality = { rung: START_RUNG, samples: [], windowAt: 0, quick: 0, settle: true };
      this.fps = 0; this.fpsFrames = 0; this.fpsTime = 0;
      this.applyQuality();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.bindPointer();
    }

    // ---------- camera ----------
    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(200, rect.width), h = Math.max(200, rect.height);
      if (w === this.W && h === this.H) return;
      this.W = w; this.H = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.fitCamera();
    }
    fitCamera() {
      const v = this.office.cameraView;
      const vfov = (this.camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      // the whole width across, and the room from back to front up and down
      const depth = this.office.bounds.maxZ - this.office.bounds.minZ;
      const dist = clamp(Math.max((v.width / 2) / Math.tan(hfov / 2) * 1.0, (depth * 0.6) / Math.tan(vfov / 2)), 12, 60);
      const t = new THREE.Vector3(v.target[0], v.target[1], v.target[2]);
      const dir = new THREE.Vector3(Math.sin(v.yaw || 0), v.tilt, Math.cos(v.yaw || 0)).normalize();
      this.camera.position.copy(dir.multiplyScalar(dist)).add(t);
      this.controls.target.copy(t);
      this.controls.minDistance = dist * 0.55;
      this.controls.maxDistance = dist * 1.15;
      this.controls.minAzimuthAngle = v.azimuth[0];
      this.controls.maxAzimuthAngle = v.azimuth[1];
      this.controls.minPolarAngle = v.polar[0];
      this.controls.maxPolarAngle = v.polar[1];
      this.controls.update();
      // the "home" view (for Center)
      this.home = { pos: this.camera.position.clone(), target: t.clone(), dist };
    }
    // Is the camera turned or zoomed away from the home view? (then the Center button shows)
    offCenter() {
      if (!this.home || this.centering) return false;
      const a = this.camera.position.clone().sub(this.controls.target), b = this.home.pos.clone().sub(this.home.target);
      return a.angleTo(b) > 0.08 || Math.abs(a.length() / b.length() - 1) > 0.06;
    }
    // glide back to the home view, the short way round
    center() {
      if (!this.home) return;
      const from = this.camera.position.clone().sub(this.controls.target);
      const to = this.home.pos.clone().sub(this.home.target);
      this.centering = { t: 0, dur: 0.7, from: new THREE.Spherical().setFromVector3(from), to: new THREE.Spherical().setFromVector3(to) };
      let d = this.centering.to.theta - this.centering.from.theta;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.centering.dTheta = d;
    }
    stepCentering(dt) {
      const c = this.centering;
      if (!c) return;
      c.t = Math.min(1, c.t + dt / c.dur);
      const k = c.t < 0.5 ? 4 * c.t * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 3) / 2; // ease in and out
      const sp = new THREE.Spherical(c.from.radius + (c.to.radius - c.from.radius) * k, c.from.phi + (c.to.phi - c.from.phi) * k, c.from.theta + c.dTheta * k);
      this.camera.position.setFromSpherical(sp).add(this.home.target);
      this.controls.target.copy(this.home.target);
      this.controls.update();
      if (c.t >= 1) this.centering = null;
    }
    // walls between the camera and the room hide (like a dollhouse), so you can look from any side
    updateWalls() {
      const walls = this.office.walls;
      if (!walls) return;
      const cam = this.camera.position;
      for (const w of walls) {
        const outside = tmpV.copy(cam).sub(w.point).dot(w.normal) < 0.5;
        if (w.group.visible === outside) w.group.visible = !outside;
      }
    }
    viewYaw(w) { return Math.atan2(this.camera.position.x - w.x, this.camera.position.z - w.z); }

    // ---------- the board ----------
    presence() {
      const out = {};
      for (const w of this.walkers) out[w.id] = w.mode;
      return out;
    }
    walker(id) { return this.walkers.find((w) => w.id === id) || null; }
    later(w, delay, fn) { this.timers.push({ at: this.time + delay, w, fn }); }

    // A Mii's desk: its own desk or office if it has one; otherwise a free desk that isn't
    // anyone else's (desk number `prefer` if it's free: the app keeps that the same all day,
    // so a Mii comes back to the same desk). null = no desk left (it just takes breaks).
    deskFor(w, prefer) {
      if (prefer !== undefined) w.prefer = prefer;
      if (w.desk) return w.desk;
      const desks = this.office.workSpots.filter((s) => s.kind === "desk");
      const taken = {};
      for (const o of this.walkers) if (o !== w && o.desk) taken[o.desk.id] = o.id;
      const id = window.NSCCLogic.pickDesk({ id: w.id, desks, assignments: this.assignments, taken, onBoard: this.onBoard, prefer: w.prefer });
      w.desk = desks.find((d) => d.id === id) || null;
      return w.desk;
    }
    // Who has which desk / office. Miis sitting at a spot that's now someone else's (or that
    // were given a new spot) get up and go to the right one.
    setAssignments(assignments, onBoard, names) {
      this.assignments = Object.assign({}, assignments || {});
      if (onBoard) this.onBoard = onBoard.slice();
      names = names || {};
      for (const w of this.walkers) {
        if (!w.desk) continue;
        const mine = this.assignments[w.id];
        const owner = window.NSCCLogic.ownerOf(this.assignments, w.desk.id);
        if ((mine && mine !== w.desk.id) || (owner && owner !== w.id)) this.relocate(w);
      }
      // ones without a desk (none was free) may find one now
      for (const w of this.walkers) if (!w.desk && w.mode === "in") this.relocate(w);
      if (this.office.setOwner) {
        for (const s of this.office.workSpots) if (s.assignable) {
          const owner = window.NSCCLogic.ownerOf(this.assignments, s.id);
          this.office.setOwner(s.id, owner ? names[owner] || "" : "");
        }
      }
    }
    // Leave the old desk and pick again (it walks over there next).
    relocate(w) {
      const old = w.desk;
      w.desk = null;
      if (w.mode !== "in") return; // (coming in: it'll go to the right desk anyway)
      if (old && w.spot === old) {
        if (w.state === "activity") { w.spot = null; return; } // (gets up, then goes to the new one)
        if (w.state === "walk") { w.state = "idle"; w.timer = 0.2; w.path = null; w.arrive = null; w.spot = null; }
      }
    }

    addMii(id, template, look, how, prefer) {
      if (this.walker(id)) return this.walker(id);
      const w = new Walker(this, id, template, look);
      this.walkers.push(w);
      const desk = this.deskFor(w, prefer);
      if (how === "appear" && !desk) {
        const p = this.randomFloorPoint(w);
        w.x = p.x; w.z = p.z; w.appear = 0.4; w.inSince = this.time - 30;
      } else if (how === "appear") {
        // (opening the page: everyone who's in is already at work)
        w.x = desk.x; w.z = desk.z;
        w.spot = desk;
        w.state = "activity";
        w.timer = rnd(20, 90);
        w.anchor = w.lastAnchor = { at: desk.seat, yaw: desk.yaw };
        w.seatBlend = 1;
        w.yaw = w.targetYaw = desk.yaw;
        w.appear = 0.4;
        w.inSince = this.time - 30;
      } else {
        this.walkIn(w, how === "return");
      }
      return w;
    }

    // In through the door: from the end of the hallway (fading in as it walks), a few steps into
    // the room, then off to work. fromHere = it was on its way out down the hallway: it turns
    // round where it is and walks back (no jump to the end of the hallway).
    walkIn(w, returning, fromHere) {
      const o = this.office;
      w.mode = "entering";
      // (down the hallway to the door: the way out, backwards)
      const out = o.outsidePath && o.outsidePath.length ? o.outsidePath : [o.outsidePoint];
      if (fromHere && w.doorPath) {
        const behind = Math.max(0, out.length - w.doorPath.length);
        w.doorPath = out.slice(0, behind).reverse().concat([o.doorPoint]);
        w.targetYaw = Math.atan2(w.doorPath[0].x - w.x, w.doorPath[0].z - w.z);
      } else {
        w.doorPath = out.slice(0, -1).reverse().concat([o.doorPoint]);
        w.x = o.outsidePoint.x; w.z = o.outsidePoint.z;
        w.yaw = w.targetYaw = Math.atan2(w.doorPath[0].x - w.x, w.doorPath[0].z - w.z);
        w.fade = reducedMotion() ? 1 : 0;
      }
      w.inHall = false;
      w.appear = 1;
      w.arms = "down";
      w.state = "door-in";
      w.anchor = null; w.seatBlend = 0; w.spot = null;
      this.later(w, 1.2, () => w.say(C.pick(returning ? C.RETURN : C.ARRIVE), 2.6));
    }

    // Out of the door. kind: "leave" (it stays on the board) or "remove".
    sendOut(id, kind, place) {
      const w = this.walker(id);
      if (!w) { if (this.onGone) this.onGone(id, kind === "remove" ? "removing" : "leaving"); return; }
      const wasOut = w.mode === "leaving" || w.mode === "removing";
      w.mode = kind === "remove" ? "removing" : "leaving";
      if (wasOut) return; // (already on its way: it just won't come back)
      this.endChat(w);
      w.clearEmote();
      w.arms = "down";
      w.spot = null; w.anchor = null;
      const lines = kind === "remove" ? (place === "endOfDay" ? C.END_OF_DAY : C.REMOVED) : C.LEAVING;
      w.say(C.fill(C.pick(lines), { name: w.look.name, place: kind === "remove" ? "" : place }), 2.6);
      w.showEmote(kind === "remove" && place === "endOfDay" ? "🌙" : "👋", 3);
      w.leaveBy = this.time + 25;
      const d = this.office.doorPoint;
      const out = this.office.outsidePath && this.office.outsidePath.length ? this.office.outsidePath : [this.office.outsidePoint];
      this.later(w, 0.6, () => { if (w.mode === "leaving" || w.mode === "removing") w.goTo(d.x, d.z, () => { w.state = "door-out"; w.inHall = true; w.doorPath = out.slice(); }, true); });
    }

    // It was on its way out, but someone cleared its location: back to work.
    bringBack(id) {
      const w = this.walker(id);
      if (!w || (w.mode !== "leaving" && w.mode !== "removing")) return;
      w.mode = "in";
      if (w.state === "door-out" || (w.state === "vanish" && w.inHall)) { this.walkIn(w, true, true); return; }
      if (w.state === "vanish") { w.state = "idle"; w.timer = 0.4; return; } // (it was fading where it stood: it just comes back)
      w.say(C.pick(["Oh, never mind!", "Oops, I'm staying!", "Back to work!"]), 2);
      w.state = "idle"; w.timer = 0.4; w.path = null; w.arrive = null;
    }

    removeNow(w) {
      if (!this.walkers.includes(w)) return;
      this.endChat(w);
      w.remove();
      this.walkers = this.walkers.filter((x) => x !== w);
      if (this.onGone) this.onGone(w.id, w.mode);
    }

    clear() { for (const w of this.walkers.slice()) { w.mode = "removing"; this.removeNow(w); } }

    // ---------- what Miis do on their own ----------
    // The next thing to do: mostly work at its desk, now and then a short break.
    nextTask(w) {
      if (w.mode !== "in") return;
      const desk = this.deskFor(w);
      const atDesk = !!desk && w.lastSpot === desk;
      if (desk && (!atDesk || (w.breaks > 0 && Math.random() < 0.85))) {
        w.breaks = 0;
        return this.useSpot(w, desk);
      }
      w.breaks++;
      const free = this.office.workSpots.filter((s) => s.kind !== "desk" && !s.gather && !this.walkers.some((o) => o !== w && o.spot === s));
      if (free.length && Math.random() < 0.8) return this.useSpot(w, C.pick(free));
      // a little walk around the room
      const p = this.randomFloorPoint(w);
      w.goTo(p.x, p.z, () => { w.state = "idle"; w.timer = rnd(2, 5); w.targetYaw = this.viewYaw(w) + rnd(-0.6, 0.6); });
    }
    useSpot(w, spot) {
      w.spot = spot;
      if (!w.goTo(spot.x, spot.z, () => this.startActivity(w, spot))) { w.spot = null; w.state = "idle"; w.timer = rnd(1, 3); }
    }
    startActivity(w, spot) {
      w.state = "activity";
      w.lastSpot = spot;
      w.timer = spot.kind === "desk" ? rnd(45, 140) : spot.gather ? Math.max(6, (w.meetUntil || 0) - this.time) : rnd(7, 13);
      w.anchor = spot.seat ? { at: spot.seat, yaw: spot.yaw } : null;
      w.targetYaw = spot.yaw;
      const icon = { coffee: "☕", water: "💧", stretch: "🙆", window: "☀️", board: "📝", server: "🖥️", storage: "📦", workbench: "🔧", sofa: "🛋️", meeting: "📋" }[spot.kind];
      if (icon) w.showEmote(icon, w.timer);
      if (spot.kind !== "desk" && !spot.gather && C.BREAK[spot.kind] && Math.random() < 0.45) this.later(w, 1, () => { if (w.spot === spot) w.say(C.pick(C.BREAK[spot.kind])); });
    }
    // Somewhere to stand about: in the open office (not in someone's private office).
    randomFloorPoint(w) {
      const rooms = this.office.rooms || [];
      const inRoom = (p) => rooms.find((r) => r.areas.some((a) => p.x >= a.minX && p.x <= a.maxX && p.z >= a.minZ && p.z <= a.maxZ));
      const ok = (p) => {
        const r = inRoom(p);
        if (r && r.private) { const mine = w && w.desk; return !!mine && mine.room === r.id; }
        return !r || r.kind === "open";
      };
      let last = null;
      for (let i = 0; i < 30; i++) {
        const p = this.nav.randomFree();
        last = p;
        if (!ok(p)) continue;
        if (!this.walkers.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.5)) return p;
      }
      return last || this.nav.randomFree();
    }

    // ---------- a little meeting in the conference room now and then ----------
    // (two or three Miis who are free go and sit round the table for a bit, then back to work)
    runMeetings(dt) {
      this.meetIn = (this.meetIn === undefined ? rnd(120, 240) : this.meetIn) - dt;
      if (this.meetIn > 0) return;
      this.meetIn = rnd(200, 400);
      const chairs = this.office.workSpots.filter((s) => s.gather && !this.walkers.some((o) => o.spot === s));
      const free = this.walkers.filter((w) => this.canChat(w) && !w.anchored);
      const pool = free.length >= 2 ? free : this.walkers.filter((w) => this.canChat(w));
      if (pool.length < 2 || chairs.length < 2) return;
      const n = Math.min(chairs.length, pool.length, Math.random() < 0.5 ? 2 : 3);
      const people = pool.slice().sort(() => Math.random() - 0.5).slice(0, n);
      const lines = C.BREAK.meeting || ["Quick catch-up!"];
      people.forEach((w, i) => {
        this.endChat(w);
        w.clearEmote();
        w.anchor = null;
        w.state = "idle";
        this.useSpot(w, chairs[i]);
        w.meetUntil = this.time + rnd(16, 24);
        if (i === 0) this.later(w, 1, () => w.say(C.pick(["Quick meeting, everyone?", "Got a minute? Let's sync up.", "Meeting room, two minutes!"]), 2.6));
        this.later(w, 9 + i * 3, () => { if (w.spot && w.spot.gather && w.state === "activity") w.say(C.pick(lines), 2.6); });
      });
    }

    // ---------- a little chat now and then ----------
    // (only Miis that have settled in, and are working or standing about: nobody's stopped on the way somewhere)
    canChat(w) { return w.mode === "in" && !w.partner && this.time - (w.inSince || 0) > 40 && (w.state === "idle" || w.state === "activity"); }
    runChats(dt) {
      this.chatIn -= dt;
      if (this.chatIn > 0) return;
      this.chatIn = rnd(45, 110); // (not often: it's an office!)
      const free = this.walkers.filter((w) => this.canChat(w));
      if (free.length < 2) return;
      // someone who's up and about goes over to someone else
      const standing = free.filter((w) => !w.anchored);
      const A = standing.length ? C.pick(standing) : C.pick(free);
      const others = free.filter((w) => w !== A).sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
      const B = Math.random() < 0.6 ? others[0] : C.pick(others);
      this.startChat(A, B, C.pick(C.CONVERSATIONS));
    }
    startChat(A, B, lines) {
      A.partner = B; B.partner = A;
      A.chat = { lines, step: -1, next: 0, lead: true, by: this.time + 30 };
      B.chat = { lead: false };
      A.clearEmote();
      A.spot = null; A.anchor = null;
      if (B.state === "idle") B.state = "wait";
      const meet = this.meetingPoint(A, B);
      if (!A.goTo(meet.x, meet.z, () => { A.state = "talk"; })) this.endChat(A);
    }
    endChat(w) {
      const p = w.partner;
      for (const m of [w, p]) {
        if (!m) continue;
        m.partner = null; m.chat = null;
        if (m.state === "talk" || m.state === "wait") { m.state = "idle"; m.timer = rnd(0.5, 2); }
        if (m.state === "walk" && m.mode === "in" && !m.spot) { m.state = "idle"; m.timer = rnd(0.5, 1.5); m.path = null; m.arrive = null; }
      }
    }
    runChat(A, dt) {
      const B = A.partner, c = A.chat;
      if (!B || !c) return this.endChat(A);
      c.next -= dt;
      if (c.next > 0) return;
      c.step++;
      if (c.step >= c.lines.length) { this.endChat(A); return; }
      const who = c.step % 2 === 0 ? A : B;
      const other = who === A ? B : A;
      const line = C.fill(c.lines[c.step], { name: who.look.name, other: other.look.name });
      who.say(line, 2.8);
      c.next = 3.0;
    }
    meetingPoint(A, B) {
      const crowded = (x, z) => this.walkers.some((o) => o !== A && o !== B && Math.hypot(o.x - x, o.z - z) < 1.1);
      const bx = B.anchored && B.lastAnchor ? B.lastAnchor.at.x : B.x, bz = B.anchored && B.lastAnchor ? B.lastAnchor.at.z : B.z;
      const tries = B.anchored ? [[1.4, -0.4], [-1.4, -0.4], [0, -1.6], [1.6, 0.4], [-1.6, 0.4]] : [[1.8, 0], [-1.8, 0], [1.4, 0.9], [-1.4, 0.9], [0.2, 1.8], [0.2, -1.8]];
      for (const [ox, oz] of tries) {
        const sx = A.x < bx ? -1 : 1;
        const x = bx + ox * sx, z = bz + oz;
        if (!this.nav.isBlocked(x, z) && !crowded(x, z)) return { x, z };
      }
      return this.nav.nearestFree(bx + 1.8, bz);
    }
    standingMiis(self) {
      const out = [];
      for (const o of this.walkers) {
        if (o === self || o === self.partner || o.state === "walk" || o.state === "door-in" || o.state === "door-out") continue;
        out.push({ x: o.x, z: o.z, r: 0.75 });
      }
      return out;
    }

    // ---------- every frame ----------
    update(dt) {
      this.time += dt;
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) if (!t.w || this.walkers.includes(t.w)) t.fn();
      }
      this.runChats(dt);
      this.runMeetings(dt);
      const d = this.office.doorPoint;
      let door = false;
      for (const w of this.walkers.slice()) {
        w.appear = Math.min(1, w.appear + dt * 1.8);
        if (w.bubble) { w.bubble.time += dt; if (w.bubble.time > w.bubble.dur) { w.bubble = null; w.uiBubble.classList.remove("show"); } }
        if (w.emote) { w.emote.time += dt; if (w.emote.time > w.emote.dur) w.clearEmote(); }
        if (w.lift > 0 || w.liftVel !== 0) {
          w.liftVel -= 22 * dt; w.lift += w.liftVel * dt;
          if (w.lift <= 0) { w.lift = 0; if (w.liftVel < -1.5) w.squashVel -= Math.min(2.8, -w.liftVel * 0.4); w.liftVel = 0; }
        }
        if ((w.state === "door-in" || w.state === "door-out" || w.state === "vanish" || (w.mode !== "in" && w.mode !== "entering" && w.state === "walk")) && Math.hypot(w.x - d.x, w.z - d.z) < 3.2) door = true;
        // a line now and then while working
        if (w.mode === "in" && !w.partner && w.state === "activity") {
          w.talkIn -= dt;
          if (w.talkIn <= 0 && !w.bubble) { w.talkIn = rnd(70, 200); if (w.spot && w.spot.kind === "desk") w.say(C.pick(C.WORK)); }
        }
        // couldn't get over there in time: maybe next time
        if (w.chat && w.chat.lead && w.state !== "talk" && this.time > w.chat.by) this.endChat(w);
        // out of time on the way out (blocked somewhere): just fade away
        if ((w.mode === "leaving" || w.mode === "removing") && w.state !== "vanish" && w.leaveBy && this.time > w.leaveBy) w.state = "vanish";
        this.updateState(w, dt);
        this.updateFade(w, dt);
        if (w.state === "vanish" && w.fade <= 0) { this.removeNow(w); continue; }
      }
      this.separate(dt);
      const people = this.people || (this.people = []);
      people.length = this.walkers.length;
      this.walkers.forEach((w, i) => { const q = people[i] || (people[i] = { x: 0, z: 0 }); q.x = w.x; q.z = w.z; });
      for (const w of this.walkers) this.applyPose(w, dt);
      this.office.update(this.time, { door, people, reduced: reducedMotion(), now: this.clock() });
    }

    updateState(w, dt) {
      if (w.anchored && w.state === "walk" && !(w.anchor)) return; // (getting up first)
      const o = this.office;
      switch (w.state) {
        case "idle":
          w.timer -= dt;
          if (w.timer > 0) { if (Math.random() < dt * 0.2) w.targetYaw = this.viewYaw(w) + rnd(-0.8, 0.8); break; }
          if (w.mode === "in") this.nextTask(w);
          break;
        case "walk": {
          const r = this.followPath(w, dt);
          if (r === "arrived" || r === "lost") {
            const then = w.arrive;
            w.arrive = null; w.path = null;
            if (r === "lost" && w.mode === "in") { if (w.partner) this.endChat(w); w.spot = null; w.state = "idle"; w.timer = rnd(0.5, 1.5); break; }
            if (r === "lost" && w.mode !== "entering" && Math.hypot(w.x - o.doorPoint.x, w.z - o.doorPoint.z) > 2) { w.state = "vanish"; break; }
            w.state = "idle"; w.timer = rnd(1, 3);
            if (then) then();
          }
          break;
        }
        case "door-in": { // from outside, along the hallway and through the doorway
          const next = w.doorPath && w.doorPath.length ? w.doorPath[0] : o.doorPoint;
          if (!this.stepStraight(w, next.x, next.z, dt)) break;
          if (w.doorPath && w.doorPath.length > 1) { w.doorPath.shift(); break; }
          {
            w.goTo(o.insidePoint.x + rnd(-1.5, 1.5), o.insidePoint.z + rnd(-0.5, 1), () => {
              if (w.mode === "entering") { w.mode = "in"; w.inSince = this.time; }
              w.state = "idle"; w.timer = rnd(0.3, 0.8); w.targetYaw = this.viewYaw(w);
            }, true);
          }
          break;
        }
        case "door-out": { // out through the doorway and down the hallway, then gone
          const next = w.doorPath && w.doorPath.length ? w.doorPath[0] : o.outsidePoint;
          if (!this.stepStraight(w, next.x, next.z, dt)) break;
          if (w.doorPath && w.doorPath.length > 1) w.doorPath.shift();
          else w.state = "vanish";
          break;
        }
        case "vanish": // (fading away: see updateFade)
          break;
        case "activity":
          if (!w.partner) w.timer -= dt;
          w.arms = w.partner ? "down" : (w.spot && w.spot.arms) || "down";
          if (w.timer <= 0 || !w.spot) {
            w.arms = "down"; w.clearEmote();
            w.anchor = null; w.spot = null;
            w.state = "idle"; w.timer = 0.6;
          }
          break;
        case "wait":
          if (w.partner) w.targetYaw = Math.atan2(w.partner.x - w.x, w.partner.z - w.z);
          else { w.state = "idle"; w.timer = rnd(0.5, 1.5); }
          break;
        case "talk": {
          const p = w.partner;
          if (!p) { w.state = "idle"; w.timer = 1; break; }
          w.targetYaw = turnToward(Math.atan2(p.x - w.x, p.z - w.z), this.viewYaw(w), 0.3);
          if (p.state === "wait") { p.state = "talk"; }
          if (p.state === "talk") p.targetYaw = turnToward(Math.atan2(w.x - p.x, w.z - p.z), this.viewYaw(p), 0.3);
          if (w.chat && w.chat.lead) this.runChat(w, dt);
          break;
        }
      }
    }

    // Walks straight at (tx, tz) (through the doorway, where there's no floor plan). true = there.
    stepStraight(w, tx, tz, dt) {
      const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
      if (d < 0.12) return true;
      const want = Math.atan2(dx, dz);
      w.moveYaw = w.moveYaw === null ? want : turnToward(w.moveYaw, want, dt * 7);
      w.curSpeed += (w.speed * 0.8 - w.curSpeed) * ease(dt, 4);
      const step = Math.min(d, w.curSpeed * dt);
      w.x += Math.sin(want) * step; w.z += Math.cos(want) * step;
      w.targetYaw = w.moveYaw;
      w.phase += step * Math.PI / (w.inst.rig.stepLength(w.style) * w.sizeScale);
      return false;
    }

    // Keeps Miis from walking through each other.
    separate(dt) {
      const list = this.walkers;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.anchored || b.anchored || a.state.startsWith("door") || b.state.startsWith("door") || a.state === "vanish" || b.state === "vanish") continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const min = a.partner === b ? 0.9 : 1.1;
        if (d > 0.001 && d < min) {
          const push = (min - d) / d * 0.5;
          if (a.state !== "activity" && a.state !== "talk") this.tryMove(a, -dx * push, -dz * push);
          if (b.state !== "activity" && b.state !== "talk") this.tryMove(b, dx * push, dz * push);
        }
      }
    }
    tryMove(w, sx, sz) {
      const nav = this.nav, pad = window.MiiNav.MOVE_PAD;
      if (nav.isBlocked(w.x, w.z, pad)) { w.x += sx; w.z += sz; return true; }
      const ok = (x, z) => !nav.isBlocked(x, z, pad);
      if (ok(w.x + sx, w.z + sz)) { w.x += sx; w.z += sz; return true; }
      for (const a of [0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
        const c = Math.cos(a), s = Math.sin(a), k = c * 0.9;
        const nx = (sx * c - sz * s) * k, nz = (sx * s + sz * c) * k;
        if (ok(w.x + nx, w.z + nz)) { w.x += nx; w.z += nz; return true; }
      }
      return false;
    }
    // Walks along the planned route: "walking", "arrived" or "lost".
    followPath(w, dt) {
      if (!w.path || !w.path.length) return "arrived";
      const nav = this.nav;
      w.skipCheckIn = (w.skipCheckIn || 0) - dt;
      if (w.path.length > 1 && w.skipCheckIn <= 0) {
        w.skipCheckIn = 0.25;
        if (nav.clearLine(w.x, w.z, w.path[1].x, w.path[1].z)) { w.path.shift(); w.bestDist = Infinity; }
      }
      const next = w.path[0], last = w.path.length === 1;
      const d = Math.hypot(next.x - w.x, next.z - w.z);
      if (d < (last ? 0.12 : 0.4) || (last && d < 1.0 && w.stuckTime > 0.5)) {
        w.path.shift(); w.bestDist = Infinity;
        return w.path.length ? "walking" : "arrived";
      }
      this.stepToward(w, next.x, next.z, dt, last);
      if (d < w.bestDist - 0.05) { w.bestDist = d; w.stuckTime = 0; }
      else w.stuckTime = (w.stuckTime || 0) + dt;
      if (w.stuckTime > 1.0) {
        w.repaths = (w.repaths || 0) + 1;
        w.stuckTime = 0; w.bestDist = Infinity;
        if (w.repaths > 4) return "lost";
        const goal = w.path[w.path.length - 1];
        const everyone = this.walkers.filter((o) => o !== w && o !== w.partner).map((o) => ({ x: o.x, z: o.z, r: 0.75 }));
        const path = nav.findPath(w.x, w.z, goal.x, goal.z, w.repaths > 1 ? everyone : this.standingMiis(w));
        if (!path) return "lost";
        w.path = path;
      }
      return "walking";
    }
    stepToward(w, tx, tz, dt, last) {
      const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
      if (d < 0.001) return;
      const want = Math.atan2(dx, dz);
      if (w.moveYaw === null) w.moveYaw = w.yaw;
      w.moveYaw = turnToward(w.moveYaw, want, dt * 7);
      const off = Math.abs(angleDiff(w.moveYaw, want));
      let target = w.speed * clamp(1.15 - off / 1.4, 0.15, 1);
      if (last) target *= clamp(d / 1.1, 0.22, 1);
      w.curSpeed += (target - w.curSpeed) * ease(dt, target > w.curSpeed ? 3.5 : 7);
      const step = Math.min(d, w.curSpeed * dt);
      const dir = last && d < 0.6 ? want : w.moveYaw;
      const bx = w.x, bz = w.z;
      this.tryMove(w, Math.sin(dir) * step, Math.cos(dir) * step);
      const moved = Math.hypot(w.x - bx, w.z - bz);
      if (moved < step * 0.3) w.curSpeed *= 0.7;
      w.targetYaw = w.moveYaw;
      w.phase += moved * Math.PI / (w.inst.rig.stepLength(w.style) * w.sizeScale);
    }

    turnBody(w, goal, dt, rate, maxSpeed) {
      const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        w.yawVel += (rate * rate * angleDiff(w.yaw, goal) - 2 * rate * w.yawVel) * h;
        w.yawVel = clamp(w.yawVel, -maxSpeed, maxSpeed);
        w.yaw += w.yawVel * h;
      }
    }
    updateLook(w, dt) {
      let goal = 0, up = 0;
      const p = w.partner;
      w.lookIn -= dt;
      if (p && (w.state === "talk" || w.state === "wait" || (w.state === "activity" && p.state === "talk"))) {
        goal = angleDiff(w.yaw, Math.atan2(p.x - w.x, p.z - w.z));
      } else {
        if (w.lookIn <= 0) {
          const moving = w.state === "walk";
          const r = Math.random();
          w.lookMode = r < (moving ? 0.1 : 0.25) ? "cam" : r < (moving ? 0.3 : 0.55) ? "around" : "ahead";
          w.lookAround = rnd(-0.7, 0.7);
          w.lookIn = w.lookMode === "ahead" ? rnd(2, 5) : rnd(1, 2.6);
        }
        if (w.lookMode === "cam") { goal = angleDiff(w.yaw, this.viewYaw(w)); up = 0.1; }
        else if (w.lookMode === "around") goal = w.lookAround;
      }
      if (Math.abs(goal) > 1.6) goal = 0;
      goal = clamp(goal, -0.85, 0.85);
      w.lookYaw += (goal - w.lookYaw) * ease(dt, 5);
      w.lookUp += (up - w.lookUp) * ease(dt, 4);
    }

    // Copies the Mii's position and movement onto its 3D model.
    applyPose(w, dt) {
      const holder = w.inst.holder, rig = w.inst.rig, st = w.style;
      const moving = w.state === "walk" || w.state === "door-in" || w.state === "door-out";
      const wanted = w.state === "activity" && !!w.anchor;
      if (wanted) w.lastAnchor = w.anchor;
      w.seatBlend = clamp(w.seatBlend + (wanted ? dt : -dt) * 2.2, 0, 1);
      const anchor = w.seatBlend > 0 ? w.lastAnchor : null;
      const k = anchor ? smooth(w.seatBlend) : 0;
      const yaw = anchor ? anchor.yaw : w.targetYaw;
      this.turnBody(w, yaw, dt, moving ? 13 : anchor ? 8 : 9, moving ? 12 : 8);
      const shuffle = !moving && !anchor ? clamp((Math.abs(w.yawVel) - 1) * 0.15, 0, 0.4) : 0;
      if (shuffle > 0) w.phase += dt * Math.abs(w.yawVel) * 1.6;
      const target = moving ? clamp(w.curSpeed / Math.max(0.3, w.speed * 0.55), 0, 1) : shuffle;
      w.walkAmt += (target - w.walkAmt) * ease(dt, 8);
      if (!moving) { w.curSpeed = 0; w.moveYaw = null; }
      let px = w.x, pz = w.z, py = 0;
      if (anchor) {
        py = (anchor.at.y || 0) * k;
        px = w.x + (anchor.at.x - w.x) * k;
        pz = w.z + (anchor.at.z - w.z) * k;
      }
      holder.rotation.y = w.yaw;
      holder.rotation.z = !rig.hasLegs ? Math.sin(w.phase) * 0.08 * w.walkAmt : 0;
      const hopY = !rig.hasLegs && !rig.mixer ? Math.abs(Math.sin(w.phase)) * 0.22 * w.walkAmt : 0;
      if (reducedMotion()) { w.squash = 0; w.squashVel = 0; }
      else {
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        for (let i = 0; i < steps; i++) { w.squashVel += (420 * (0 - w.squash) - 13 * w.squashVel) * h; w.squash += w.squashVel * h; }
        w.squash = clamp(w.squash, -0.2, 0.15);
      }
      const pop = w.appear < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - w.appear, 3)) : 1;
      const size = w.sizeScale * pop;
      const sy = 1 + w.squash * (1 - k), sxz = 1 / Math.sqrt(sy);
      holder.scale.set(size * sxz, size * sy, size * sxz);
      const sitting = anchor && w.seatBlend > (wanted ? 0.15 : 0.85);
      this.updateLook(w, dt);
      w.blinkIn -= dt;
      if (w.blinkIn <= 0) { w.blinkT = 0.13; w.blinkIn = Math.random() < 0.18 ? 0.3 : rnd(2, 6); }
      if (w.blinkT > 0) w.blinkT -= dt;
      if (M.setEyesClosed) M.setEyesClosed(w.inst, w.blinkT > 0);
      // Walking always uses the normal arm swing. Talking with the hands only while standing
      // still in a chat (not on the way somewhere, even when slowing down at a corner).
      const arms = moving ? "down" : w.arms;
      const talking = !!w.bubble && !moving && w.walkAmt < 0.05 && (w.state === "talk" || w.state === "wait" || (w.state === "idle" && !!w.partner));
      rig.pose({
        t: this.time + (w.id.length % 7) * 0.37, dt, smooth: true,
        walk: w.walkAmt, phase: w.phase, arms, style: st, talking,
        nod: 0, lookYaw: w.lookYaw,
        lookUp: (w.state === "activity" && w.spot && w.spot.lookUp ? w.spot.lookUp : 0) + w.lookUp,
        sit: !!sitting,
      });
      holder.position.set(px, w.lift + py + hopY - (anchor ? 0 : rig.drop * w.sizeScale), pz);
      this.applyFade(w);
    }

    // ---------- fading in and out (down the hallway) ----------
    // Walking out, a Mii fades away over its last steps down the hallway (FADE_DIST, about
    // a second); coming in, it fades in over its first steps (FADE_TIME). Anything else that
    // makes it go (stuck on the way out) fades it where it stands. Reduced motion: instant.
    // (all by distance walked or time passed, so it looks the same at any frame rate)
    updateFade(w, dt) {
      const instant = reducedMotion();
      if (w.state === "vanish") { w.fade = instant ? 0 : Math.max(0, w.fade - dt / FADE_TIME); return; }
      if (w.state === "door-out") {
        if (!instant) {
          let left = 0, x = w.x, z = w.z;
          for (const p of w.doorPath || []) { left += Math.hypot(p.x - x, p.z - z); x = p.x; z = p.z; }
          w.fade = Math.min(w.fade, clamp(left / FADE_DIST, 0, 1));
        }
        return;
      }
      if (w.fade < 1) w.fade = instant ? 1 : Math.min(1, w.fade + dt / FADE_TIME);
    }
    // Shows the fade on the 3D model, its shadow, and its name tag and bubble. The Mii's
    // materials are its own (MiiModel.applyLook copies them), so they're changed in place:
    // see-through only while fading, then put back exactly as they were, so normal drawing,
    // sorting and shadows aren't affected. It casts no shadow while it fades.
    applyFade(w) {
      const f = w.fade >= 0.999 ? 1 : smooth(clamp(w.fade, 0, 1));
      if (w.uiFade !== f) { w.uiFade = f; w.ui.style.opacity = f >= 1 ? "" : f.toFixed(3); }
      if (f === w.fadeShown) return;
      w.fadeShown = f;
      const holder = w.inst.holder;
      if (f >= 1) {
        const sv = w.fadeSaved;
        if (sv) {
          for (const e of sv.meshes) e.o.castShadow = e.cast;
          for (const e of sv.mats) { e.m.transparent = e.transparent; e.m.opacity = e.opacity; e.m.needsUpdate = true; }
          w.fadeSaved = null;
        }
        holder.visible = true;
        return;
      }
      if (!w.fadeSaved) {
        const sv = { meshes: [], mats: [] }, seen = new Set();
        holder.traverse((o) => {
          if (!o.isMesh) return;
          sv.meshes.push({ o, cast: o.castShadow });
          o.castShadow = false;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m || seen.has(m)) continue;
            seen.add(m);
            sv.mats.push({ m, transparent: m.transparent, opacity: m.opacity });
            m.transparent = true; m.needsUpdate = true;
          }
        });
        w.fadeSaved = sv;
      }
      for (const e of w.fadeSaved.mats) e.m.opacity = e.opacity * f;
      holder.visible = f > 0.004;
    }

    // ---------- bubbles and name tags over the Miis ----------
    updateOverlay() {
      const v = tmpV, placed = [];
      const sorted = this.walkers.slice().sort((a, b) => b.z - a.z);
      for (const w of sorted) {
        const s = w.inst.holder.scale.y, pos = w.inst.holder.position;
        v.set(pos.x, pos.y + (MII_HEIGHT + 0.05) * s, pos.z).project(this.camera);
        const visible = v.z < 1 && w.fade > 0.01;
        w.ui.style.display = visible ? "" : "none";
        if (!visible) continue;
        const x = (v.x * 0.5 + 0.5) * this.W, y = (-v.y * 0.5 + 0.5) * this.H;
        const feet = feetV.set(pos.x, Math.max(0, pos.y), pos.z).project(this.camera);
        w.uiName.style.transform = "translate(-50%, " + ((-feet.y * 0.5 + 0.5) * this.H - y + 6) + "px)";
        w.uiName.classList.toggle("show", w.appear > 0.6);
        w.uiName.classList.toggle("hover", this.hover === w);
        if (w.bubble) {
          const key = w.bubble.text;
          if (w.uiBubbleKey !== key || !w.uiBubbleW) { w.uiBubbleKey = key; w.uiBubbleW = w.uiBubble.offsetWidth; w.uiBubbleH = w.uiBubble.offsetHeight; }
          const bw = w.uiBubbleW, bh = w.uiBubbleH;
          const bx = clamp(x - bw / 2, 4, this.W - bw - 4);
          const by0 = y - bh - 12;
          let by = by0;
          for (let tries = 0; tries < 6; tries++) {
            const hit = placed.find((r) => bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h + 6 && by + bh + 6 > r.y);
            if (!hit) break;
            by = hit.y - bh - 8;
          }
          by = Math.max(4, by);
          placed.push({ x: bx, y: by, w: bw, h: bh });
          w.uiBubble.style.left = bx - x + "px";
          w.uiBubble.style.top = by - y + "px";
          w.uiBubble.style.setProperty("--tail", clamp(x - bx, 14, bw - 14) + "px");
        }
        w.ui.style.transform = "translate(" + x + "px," + y + "px)";
      }
    }

    // ---------- clicking a Mii ----------
    pointerRay(e) {
      const r = this.canvas.getBoundingClientRect();
      pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(pointerNdc, this.camera);
      return this.raycaster.ray;
    }
    pickWalker(ray) {
      let best = null, bestDist = Infinity;
      for (const w of this.walkers) {
        if (w.state === "vanish" || w.fade < 0.5 || w.appear < 0.5) continue;
        const s = w.inst.holder.scale.y, pos = w.inst.holder.position;
        pickA.set(pos.x, pos.y + 0.1 * s, pos.z);
        pickB.set(pos.x, pos.y + MII_HEIGHT * s, pos.z);
        const dist2 = ray.distanceSqToSegment(pickA, pickB, pickOnRay, pickOnSeg);
        const radius = (pickOnSeg.y - pos.y > 0.9 * s ? 0.65 : 0.45) * s;
        if (dist2 < radius * radius) {
          const along = pickOnRay.distanceTo(ray.origin);
          if (along < bestDist) { bestDist = along; best = w; }
        }
      }
      return best;
    }
    bindPointer() {
      const c = this.canvas;
      let down = null;
      c.addEventListener("pointerdown", (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
      c.addEventListener("pointerup", (e) => {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
          const w = this.pickWalker(this.pointerRay(e));
          if (w && this.onSelect) {
            this.onSelect(w.id);
            if (!w.anchored && !w.partner && w.state !== "walk" && w.mode === "in") { w.targetYaw = this.viewYaw(w); w.liftVel = 3.5; }
          }
        }
        down = null;
      });
      c.addEventListener("pointermove", (e) => { this.hoverAt = { clientX: e.clientX, clientY: e.clientY }; });
      c.addEventListener("pointerleave", () => { this.hoverAt = null; this.hover = null; c.style.cursor = ""; });
    }

    // ---------- graphics quality (automatic) ----------
    applyQuality() {
      const q = QUALITY[this.quality.rung];
      const dpr = window.devicePixelRatio || 1;
      const pr = q.last ? Math.max(0.6, dpr * q.ss) : Math.min(MAX_PIXEL_RATIO, Math.max(dpr, Math.min(dpr * q.ss, 2)));
      if (this.renderer.getPixelRatio() !== pr) { this.renderer.setPixelRatio(pr); if (this.W) this.renderer.setSize(this.W, this.H, false); }
      if (this.renderer.shadowMap.enabled !== q.shadows) {
        this.renderer.shadowMap.enabled = q.shadows;
        this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
      }
    }
    // which graphics card is drawing, and whether it's really the card (not the processor)
    gpuInfo() {
      let name = "";
      try {
        const gl = this.renderer.getContext();
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch (e) { /* unknown */ }
      const software = /swiftshader|llvmpipe|softpipe|basic render|software/i.test(name);
      return { name, software, fps: this.fps, pixelRatio: this.renderer.getPixelRatio(), shadows: this.renderer.shadowMap.enabled, rung: this.quality.rung };
    }
    // Textures seen at an angle (the floor, desks, the Miis' faces from the side) stay sharp:
    // turn on the best texture filtering the graphics card has, once for each new texture.
    sharpenTextures(real) {
      this.sharpenIn = (this.sharpenIn || 0) - real;
      if (this.sharpenIn > 0) return;
      this.sharpenIn = 1;
      const max = this.renderer.capabilities.getMaxAnisotropy();
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const k of ["map", "gradientMap", "emissiveMap", "alphaMap"]) {
            const t = m[k];
            if (!t || t.userData.sharp || k === "gradientMap") continue; // (the toon gradient must stay blocky)
            t.userData.sharp = true;
            if (t.anisotropy !== max) { t.anisotropy = max; t.needsUpdate = true; }
          }
        }
      });
    }
    // "auto" (adjusts itself), or a fixed "high" / "medium" / "low" (Settings)
    setQualityMode(mode) {
      const fixed = { high: 0, medium: START_RUNG, low: QUALITY.length - 2 };
      this.qualityMode = mode in fixed ? mode : "auto";
      if (this.qualityMode !== "auto") this.quality.rung = fixed[this.qualityMode];
      this.quality.samples = []; this.quality.windowAt = 0; this.quality.settle = true;
      this.applyQuality();
    }
    autoQuality(real) {
      if (this.qualityMode && this.qualityMode !== "auto") return;
      const a = this.quality;
      if (real <= 0 || real >= 1) return; // (the window was hidden)
      a.samples.push(real * 1000);
      a.windowAt += real;
      if (a.windowAt < 2) return;
      const s = a.samples.sort((x, y) => x - y), mid = s[s.length >> 1];
      a.samples = []; a.windowAt = 0;
      if (a.settle) { a.settle = false; return; }
      let rung = a.rung;
      const slowest = QUALITY.length - 1;
      // (the very last step only when it's really slow: under 25 frames a second)
      if (mid > 1000 / 40 && rung < slowest - 1) { rung++; a.quick = 0; a.cool = this.time + 60; }
      else if (mid > 1000 / 25 && rung === slowest - 1) { rung++; a.quick = 0; a.cool = this.time + 60; }
      else if (mid < 1000 / 55 && rung > 0 && this.time > (a.cool || 0)) { if (++a.quick >= 5) { rung--; a.quick = 0; } }
      else a.quick = 0;
      if (rung !== a.rung) { a.rung = rung; a.settle = true; this.applyQuality(); }
    }

    start() {
      let last = performance.now();
      const frame = (now) => {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        const real = Math.min(0.25, (now - last) / 1000);
        last = now;
        // (small steps, so a slow computer still runs at the right speed)
        const steps = Math.max(1, Math.ceil(real / 0.05));
        for (let i = 0; i < steps; i++) this.update(real / steps);
        this.controls.update();
        if (this.hoverAt) {
          const e = this.hoverAt;
          this.hoverAt = null;
          this.hover = this.pickWalker(this.pointerRay(e));
          this.canvas.style.cursor = this.hover ? "pointer" : "";
        }
        this.stepCentering(real);
        this.updateWalls();
        this.sharpenTextures(real);
        this.renderer.render(this.scene, this.camera);
        this.updateOverlay();
        this.autoQuality(real);
        // frames per second, for Settings
        this.fpsFrames++; this.fpsTime += real;
        if (this.fpsTime >= 1) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }
      };
      requestAnimationFrame(frame);
    }
  }

  window.NSCCOfficeHub = { OfficeHub, styleFor };
})();
