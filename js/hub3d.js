/*
 * hub3d.js
 * The 3D hub: moves the Miis around, makes them talk and hang out,
 * and handles the camera, clicking and dragging. It also runs home visits
 * (the inside of one Mii's apartment) and hands out the Miis' coins.
 * All the places sit on a little planet (planet3d.js): going somewhere else,
 * the camera flies there over the planet (see setScene and startFlight).
 */
(function () {
  "use strict";

  const THREE = window.THREE;
  const D = window.Dialogue;
  const M = window.MiiModel;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (k) => k * k * (3 - 2 * k);
  // how much of the way to go this frame, to get somewhere smoothly at `rate` (the same at any frame rate)
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const MII_HEIGHT = 1.8;
  // "Reduce motion" (in the computer's settings): no camera swoops, squashing and so on
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reducedMotion = () => !!(motionQuery && motionQuery.matches);

  // Turns smoothly from angle a towards angle b.
  function turnToward(a, b, amount) {
    return a + angleDiff(a, b) * Math.min(1, amount);
  }
  // The shortest way to turn from angle a to angle b (-PI..PI).
  function angleDiff(a, b) {
    return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  // How a Mii moves, from its personality. Energetic Miis take big bouncy
  // steps, shy ones look down and keep their arms in, grumpy ones stomp,
  // silly ones waddle, chatty ones talk with their hands...
  function animStyle(p) {
    const e = p.energy / 100, s = p.social / 100, h = p.humor / 100, k = p.kindness / 100, c = p.chatty / 100;
    let idle = "relaxed";
    if (k <= 0.33) idle = "grumpy";
    else if (s <= 0.33) idle = "shy";
    else if (e >= 0.7) idle = "bouncy";
    else if (h >= 0.68) idle = "silly";
    else if (s >= 0.7 && k >= 0.4) idle = "proud";
    return {
      stride: 0.42 + e * 0.3,
      armSwing: 0.45 + e * 0.55 + h * 0.25 - (1 - s) * 0.2,
      armsOut: 0.03 + h * 0.08 + s * 0.04,
      bounce: 0.01 + e * 0.05 + h * 0.03,
      lean: (e - 0.5) * 0.12 + (k < 0.35 ? 0.05 : 0),
      headDown: Math.max(0, (0.45 - s) * 0.35) + (k < 0.35 ? 0.06 : 0),
      wobble: Math.max(0, h - 0.55) * 0.18,
      stomp: Math.max(0, 0.55 - k) * 1.2 + e * 0.2,
      gesture: c,
      waveSize: 0.55 + s * 0.6 + e * 0.25,
      tempo: 0.7 + e * 0.6,
      dance: e >= 0.6 ? "jumpy" : h >= 0.6 ? "silly" : "sway",
      idle,
      fidget: e,
    };
  }

  // ------------------------------------------------------------------
  // One Mii in the hub
  // ------------------------------------------------------------------
  class Walker {
    constructor(hub, record, template, look, group) {
      this.hub = hub;
      this.id = record.id;
      this.record = record;
      this.template = template;
      this.look = look; // { name, favoriteColorName, ...colors }
      this.group = group || hub.miiGroup;
      this.x = 0; this.z = 0;
      this.yaw = 0; this.targetYaw = 0; this.moveYaw = null;
      this.yawVel = 0;        // how fast it's turning (it speeds up and slows down into turns)
      this.lookYaw = 0; this.lookUp = 0; this.lookGoal = 0; this.lookUpGoal = 0; this.lookIn = rnd(1, 4); // the head looking about
      this.blinkIn = rnd(1, 4); this.blinkT = 0;
      this.squash = 0; this.squashVel = 0; // squashing on landing, stretching in the air
      this.lift = 0; this.liftVel = 0;
      this.phase = 0; this.walkAmt = 0; this.curSpeed = 0;
      this.state = "idle";
      this.timer = rnd(0.5, 2);
      this.target = null;
      this.spot = null;
      this.anchor = null;     // the seat/bed/treadmill the Mii is on (or getting on)
      this.seatBlend = 0;     // 0 = standing, 1 = fully sitting/lying
      this.baseSpeed = rnd(1.5, 2.0);
      this.arms = "down";
      this.dance = false; this.laugh = false; this.sleep = false; this.nod = 0; this.shake = 0;
      this.cooldown = rnd(2, 6);
      this.talkIn = rnd(4, 12);
      this.partner = null;
      this.remote = null;     // "phone" when talking to a Mii somewhere else
      this.held = false;
      this.appear = 0;
      this.vanish = 0;        // grows to 1 when the Mii leaves (goes home)
      this.bubble = null; // { text, time, dur }
      this.emote = null;  // { icon, time, dur }

      // the bubble/emote/name tag that float above the Mii's head
      this.ui = document.createElement("div");
      this.ui.className = "mii-ui";
      this.ui.innerHTML = '<div class="bubble"></div><div class="emote"></div><div class="nametag"></div><div class="phone-tag"></div><div class="wish-mark"></div>';
      this.uiBubble = this.ui.children[0];
      this.uiEmote = this.ui.children[1];
      this.uiName = this.ui.children[2];
      this.uiPhone = this.ui.children[3]; // "📱 Mia" while on the phone
      this.uiWish = this.ui.children[4];  // 💭 when the Mii has a wish for you
      this.uiName.textContent = look.name;
      hub.overlay.appendChild(this.ui);

      this.buildModel();
    }

    // personality traits (0-100) saved with the Mii; see dialogue.js
    get personality() { return D.traits(this.record); }
    trait(k) { return this.personality[k]; }

    // how this Mii moves (worked out again when you change its personality)
    get style() {
      const p = this.personality;
      const key = p.energy + "," + p.social + "," + p.chatty + "," + p.humor + "," + p.kindness;
      if (this._styleKey !== key) { this._styleKey = key; this._style = animStyle(p); }
      return this._style;
    }

    buildModel() {
      const old = this.inst;
      this.inst = M.createInstance(this.template, this.look);
      // true facts about this Mii's looks, so compliments are accurate
      const src = this.template.source, info = this.template.info;
      const recolored = !!this.look.shirt;
      this.facts = {
        top: recolored || src.topReliable ? M.colorName(this.look.shirt || src.shirt, "top") : null,
        garment: src.garment || null,
        hair: src.hasHair ? M.colorName(this.look.hair || src.hair, "hair") : null,
        tall: info.height >= 90,
        short: info.height <= 30,
      };
      // taller Miis (by their Mii height setting) are a little bigger
      const s = (0.9 + clamp(info.height, 0, 127) / 127 * 0.2) * 1.3;
      this.sizeScale = s;
      this.inst.holder.scale.setScalar(s);
      this.inst.holder.rotation.order = "YXZ"; // turn first, then tip over (for lying in bed)
      // astronaut helmet for outer space (hidden elsewhere)
      const helmet = new THREE.Group();
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(0.66, 28, 20),
        new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, depthWrite: false })
      );
      glass.position.y = 1.36;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 24), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.86;
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
      tank.position.set(0, 0.7, -0.3);
      tank.castShadow = true;
      helmet.add(glass, collar, tank);
      helmet.visible = !!(this.hub.world && this.hub.world.helmet);
      this.helmet = helmet;
      this.inst.holder.add(helmet);
      // a little phone held up to the right side of the face, for phone calls
      // (Mii arms are too short to reach their big heads, so it sits by the cheek)
      const phone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x30343f, roughness: 0.4 }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.17), new THREE.MeshBasicMaterial({ color: 0x8fd3ff }));
      screen.rotation.y = -Math.PI / 2;
      screen.position.x = -0.016;
      phone.add(body, screen);
      phone.position.set(-0.4, 1.13, 0.02);
      phone.rotation.set(0, 0, -0.25);
      phone.visible = false;
      this.inst.holder.add(phone);
      this.phone = phone;
      this.group.add(this.inst.holder);
      if (old) {
        this.group.remove(old.holder);
        M.disposeObject(old.holder);
      }
    }

    say(text, dur) {
      const partner = this.partner ? this.partner.look.name : "";
      text = text.replace(/\{A\}/g, this.look.name).replace(/\{B\}/g, partner);
      const showing = !!this.bubble && this.uiBubble.classList.contains("show");
      this.bubble = { text, time: 0, dur: dur || Math.max(2, text.length * 0.07) };
      this.uiBubble.textContent = text;
      this.uiBubble.classList.remove("shout", "phone-voice", "bump");
      if (showing) {
        // already talking: the bubble just gives a little bounce for the next line
        void this.uiBubble.offsetWidth; // (restart the bounce)
        this.uiBubble.classList.add("bump");
      } else this.uiBubble.classList.add("show"); // pops in
    }

    showEmote(icon, dur) {
      this.emote = { icon, time: 0, dur: dur || 2 };
      this.uiEmote.textContent = icon;
      this.uiEmote.classList.add("show");
    }

    clearEmote() {
      this.emote = null;
      this.uiEmote.classList.remove("show");
    }

    hop(power) {
      if (this.seatBlend > 0.05) return; // can't jump while sitting down
      // energetic Miis jump higher, calm ones barely leave the ground
      const k = 0.75 + this.trait("energy") / 100 * 0.5;
      if (this.lift <= this.hub.baseLift(this) + 0.05) this.liftVel = (power || 4) * k;
    }

    // energetic Miis walk faster, calm ones stroll
    get speed() { return this.baseSpeed * (0.75 + this.trait("energy") / 100 * 0.6); }

    // Plans a route to (x, z) around obstacles and starts walking.
    goTo(x, z) {
      const path = this.hub.nav.findPath(this.x, this.z, x, z, this.hub.standingMiis(this));
      if (!path) { this.state = "idle"; this.timer = rnd(0.5, 1.5); this.spot = null; return false; }
      this.path = path;
      this.target = path[path.length - 1];
      this.state = "walk";
      this.anchor = null;
      this.resetStuck();
      return true;
    }

    resetStuck() {
      this.stuckTime = 0;
      this.repaths = 0;
      this.bestDist = Infinity;
    }

    // sitting, lying or standing on something (or still getting off it)
    get anchored() { return this.seatBlend > 0.02; }

    // social energy: hanging out uses it up, alone time refills it (kept by the
    // hub, so it stays the same when the Mii goes somewhere else)
    get battery() { return this.hub.batteryOf(this.id); }
    set battery(v) { this.hub.setBattery(this.id, v); }

    remove() {
      this.group.remove(this.inst.holder);
      M.disposeObject(this.inst.holder);
      this.ui.remove();
    }
  }

  // ------------------------------------------------------------------
  // The hub
  // ------------------------------------------------------------------
  // Camera limits for places that don't set their own (world.cameraMaxDistance,
  // world.cameraAzimuth): the Courtyard's apartment block would hide everyone if
  // the camera swung round behind it, and the houses across the road block the
  // view when it's zoomed right out.
  const CAMERA_LIMITS = { apartments: { maxDistance: 30, azimuth: [-1.5, 1.5] } };
  const HIGH_SKY = new THREE.Color(0x4f86d8);  // the sky high above the planet...
  const SPACE_SKY = new THREE.Color(0x151b4d); // ...and higher still
  const tmpV = new THREE.Vector3();
  // (a geometry's numbers aren't needed in memory once they're on the graphics card)
  function releaseArray() { this.array = null; }

  // ------------------------------------------------------------------
  // Graphics quality (⚙️ Settings: Auto / High / Medium / Low)
  // ------------------------------------------------------------------
  // pr:          how sharp the picture is (at most this many pixels per screen pixel)
  // shadows:     the sun casts shadows at all
  // shadowSize:  how big the sun's shadow picture is (at most)
  // shadowEvery: the shadows are redrawn every this many frames (the scenery doesn't
  //              move, so only the Miis' shadows lag a little)
  // soft:        soft shadow edges (a bit slower to draw than plain ones)
  // fx:          how much rain, snow, petals and leaves (see weather3d.js)
  // farSphere:   how round the far-away puffs (clouds, treetops...) are
  // cap:         30 frames a second while the window isn't the one in front
  // detail:      the little extras a place marks as optional (pebbles, desk clutter,
  //              worn grass...: see World3D.kit.optional) are shown
  const QUALITY_LEVELS = {
    high: { name: "high", pr: 2, shadows: true, shadowSize: 2048, shadowEvery: 1, soft: true, fx: 1, farSphere: "sphere", cap: false, detail: true },
    medium: { name: "medium", pr: 1.25, shadows: true, shadowSize: 1024, shadowEvery: 2, soft: false, fx: 0.6, farSphere: "midSphere", cap: true, detail: true },
    low: { name: "low", pr: 0.85, shadows: false, shadowSize: 1024, shadowEvery: 4, soft: false, fx: 0.3, farSphere: "lowSphere", cap: true, detail: false },
  };
  // Auto goes down these rungs one at a time when frames are slow (and back up when they're quick).
  const AUTO_LADDER = [
    QUALITY_LEVELS.high,
    Object.assign({}, QUALITY_LEVELS.high, { pr: 1.5, cap: true }),
    Object.assign({}, QUALITY_LEVELS.medium, { pr: 1.25 }),
    Object.assign({}, QUALITY_LEVELS.medium, { pr: 1 }),
    QUALITY_LEVELS.low,
    Object.assign({}, QUALITY_LEVELS.low, { pr: 0.7 }),
  ];
  const AUTO_SLOW_MS = 1000 / 40;  // a typical frame slower than this: one rung down
  const AUTO_QUICK_MS = 1000 / 55; // quicker than this for a while: try one rung up
  const pickA = new THREE.Vector3(), pickB = new THREE.Vector3(), pickOnRay = new THREE.Vector3(), pickOnSeg = new THREE.Vector3();
  const pointerNdc = new THREE.Vector2();
  const overlayHead = new THREE.Vector3(), overlayFeet = new THREE.Vector3();

  class Hub3D {
    constructor(canvas, overlay) {
      this.canvas = canvas;
      this.overlay = overlay;
      this.walkers = [];
      this.time = 0;
      this.directorIn = 2;
      this.chattiness = 1;
      this.friendships = {};
      this.feed = [];
      this.recent = [];     // recent hang-outs, so doing the same thing over and over earns less
      this.timers = [];
      this.residents = [];  // who lives in which apartment (see setResidents)
      this.batteries = new Map(); // id -> social energy (0..1)
      this.windowMiis = new Map(); // id -> Mii model shown inside its flat's window
      this.onTick = null;         // called every frame (town.js moves Miis between places)
      this.relation = null;       // (A, B) -> what's going on between two Miis (progress.js)
      this.onHangout = null;      // two Miis finished hanging out
      this.onPerform = null;      // you asked a Mii to do something
      this.onPoke = null;         // you clicked a Mii
      this.wishIconFor = null;    // record -> the wish icon to show over its head (or null)
      this.weatherLine = null;    // () -> something to say about the weather
      this.onSceneChange = null;  // you switched places: town.js fills the new one
      this.visiting = null; // { record, walker } while you're inside a Mii's home
      this.onChange = () => {};
      this.onSelect = null;       // right-click a Mii (opens its menu)
      this.onCoins = null;        // a Mii earned coins
      this.onHomeTalk = null;     // what a Mii says to you at home
      this.onApartmentClick = null;
      this.onLeftHome = null;
      this.calls = new Map();     // id -> the phone call that Mii is on (both ends share one call)
      this.callHold = null;       // record -> false if the Mii can't stay on the phone (it set off somewhere)
      this.miiInfo = null;        // id -> { record, template, look } (set by the app; for rare-event guests)
      this.guests = [];           // Miis a rare event brought in for a moment (see addGuest)

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = false; // (redrawn when needed, see beforeRender)
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.fxScale = 1; // how much weather (rain, snow...) to show: set by the graphics quality

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
      this.camera.position.set(0, 14, 22);
      this.controls = new THREE.OrbitControls(this.camera, canvas);
      this.controls.target.set(0, 1, 0);
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.minDistance = 8;
      this.controls.maxDistance = 45;
      // spin all the way around; don't go under the floor or straight overhead
      this.controls.minPolarAngle = 0.25;
      this.controls.maxPolarAngle = 1.42;

      this.miiGroup = new THREE.Group(); // (it moves into the place you're looking at)
      this.scene.add(this.miiGroup);

      // The little planet (planet3d.js): every place is built once, kept, and sits
      // on its own spot. At a place, the planet is turned so that place is right
      // here at the middle of the scene (so everything works in the place's own
      // x/y/z, like before), and only that place is drawn. Going somewhere else, the
      // camera flies over the planet to it (or off to the Moon).
      const P = window.MiiPlanet3D;
      this.planetRoot = new THREE.Group();
      this.planetRoot.name = "planet-root";
      this.planetRoot.matrixAutoUpdate = false;
      this.scene.add(this.planetRoot);
      this.places = new Map(); // id -> { id, frame, anchor (its spot on the planet), world (once built) }
      this.planet = P.create();
      this.planetRoot.add(this.planet.group);
      for (const id of Object.keys(P.SPOTS)) this.planet.setPad(id); // (sized properly once each place is built)
      this.traffic = P.createTraffic(this, this.planet); // Miis on their way somewhere
      this.planetRoot.add(this.traffic.group);
      this.travelers = null; // () -> [{ id, from, to, k, name }] (set by the app, see town.js)
      this.flyOn = true;     // false = jump straight to the next place (Settings)
      this.flight = null;    // the camera's trip to another place (see startFlight)
      this.prebuildIn = 4;   // the other places get built a little later, one at a time
      this.camera.layers.enable(window.World3D.FAR_LAYER);
      this.camera.layers.enable(window.World3D.SMALL_LAYER);

      this.raycaster = new THREE.Raycaster();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      this.bindPointer();
      this.setQuality("auto");
    }

    // The Miis you can see right now (only the resident while visiting a home).
    active() { return this.visiting ? (this.visiting.empty ? [] : [this.visiting.walker]) : this.walkers; }

    // ---------- setup ----------
    // keepView = just fit the new size (e.g. a side panel opened), don't move the camera
    resize(keepView) {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(200, rect.width), h = Math.max(200, rect.height);
      if (keepView && w === this.W && h === this.H) return;
      this.W = w; this.H = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (keepView) return;
      if (this.flight) this.flight.to = this.endState(this.world); // (land with the new size)
      else this.fitCamera();
    }

    // Where the camera goes to see the whole of a place: { dist, ty, dir }.
    fitPose(world) {
      const b = world.bounds;
      const halfW = (b.maxX - b.minX) / 2 + 2;
      const vfov = (this.camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      // the front of the area is closer than the middle, so we don't need the full width
      // (a home is a small room seen from close by, so it needs the full width)
      const dist = clamp((halfW / Math.tan(hfov / 2)) * (world.isHome ? 1.05 : 0.8), 17, 30);
      const ty = world.cameraTargetY || 1;
      const dir = new THREE.Vector3(0, world.cameraTilt || 0.55, 1).normalize();
      return { dist, ty, dir };
    }

    // Move the camera back far enough that the whole area fits on screen.
    fitCamera() {
      if (!this.world || this.flight) return;
      this.endGlide();
      const { dist, ty, dir } = this.fitPose(this.world);
      // (the decorating panel opens beside the view now, so the room stays centered)
      const tx = 0;
      this.camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(tx, ty, 0));
      this.controls.target.set(tx, ty, 0);
      this.controls.minDistance = this.world.isHome ? 6 : 8;
      this.controls.maxDistance = Math.max(this.world.isHome ? 28 : 45, dist * 1.4);
      // a place can keep the camera from zooming out past its scenery (so spinning
      // round never puts buildings between the camera and the Miis)
      const lim = CAMERA_LIMITS[this.world.id] || {};
      const maxD = this.world.cameraMaxDistance || lim.maxDistance;
      if (maxD) this.controls.maxDistance = Math.max(dist, Math.min(this.controls.maxDistance, maxD));
      // ...or keep it from swinging round behind a big building at the back
      const az = this.world.cameraAzimuth || lim.azimuth;
      this.controls.minAzimuthAngle = az ? az[0] : -Infinity;
      this.controls.maxAzimuthAngle = az ? az[1] : Infinity;
      this.zoomGoal = null;
      this.controls.update();
    }

    // ---------- smooth camera moves ----------
    // Glides the camera to `pos`, looking at `target`, over `dur` seconds (swinging round
    // the thing it looks at, rather than cutting straight across). from = { pos, target }
    // to start from somewhere else than where it is now. done() runs once it's there.
    glideCamera(pos, target, dur, from, done) {
      this.endGlide();
      this.zoomGoal = null;
      const f = from || { pos: this.camera.position, target: this.controls.target };
      const s0 = new THREE.Spherical().setFromVector3(tmpV.copy(f.pos).sub(f.target));
      const s1 = new THREE.Spherical().setFromVector3(tmpV.copy(pos).sub(target));
      this.glide = { t0: f.target.clone(), t1: target.clone(), s0, s1, k: 0, dur: reducedMotion() ? 0 : dur || 0, done };
      this.stepGlide(0);
    }
    stepGlide(dt) {
      const g = this.glide;
      g.k = g.dur > 0 ? Math.min(1, g.k + dt / g.dur) : 1;
      const e = easeInOut(g.k);
      const s = this.glideSph || (this.glideSph = new THREE.Spherical());
      s.radius = g.s0.radius + (g.s1.radius - g.s0.radius) * e;
      s.phi = g.s0.phi + (g.s1.phi - g.s0.phi) * e;
      s.theta = g.s0.theta + angleDiff(g.s0.theta, g.s1.theta) * e;
      this.controls.target.lerpVectors(g.t0, g.t1, e);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      if (g.k >= 1) this.endGlide();
    }
    // Finishes a camera glide straight away (lands where it was going).
    endGlide() {
      const g = this.glide;
      if (!g) return;
      this.glide = null;
      this.controls.target.copy(g.t1);
      this.camera.position.setFromSpherical(g.s1).add(g.t1);
      this.camera.lookAt(g.t1);
      if (g.done) g.done();
    }

    // Every frame (when not flying): camera glides, and zooming with the mouse wheel,
    // which eases in and out instead of jumping (dt in real seconds).
    stepCamera(dt) {
      // (the camera's spin slows down the same way at any frame rate)
      this.controls.dampingFactor = 1 - Math.pow(1 - 0.06, Math.min(0.1, dt) * 60);
      if (this.glide) { this.stepGlide(dt); return; }
      if (this.zoomGoal == null) return;
      const c = this.controls, off = tmpV.copy(this.camera.position).sub(c.target);
      const d = off.length();
      const goal = clamp(this.zoomGoal, c.minDistance, c.maxDistance);
      let nd = reducedMotion() ? goal : d + (goal - d) * ease(dt, 11);
      if (Math.abs(goal - nd) < goal * 0.002) { nd = goal; this.zoomGoal = null; }
      if (d > 1e-6) this.camera.position.copy(c.target).addScaledVector(off, nd / d);
    }
    zoomBy(deltaY) {
      const c = this.controls;
      if (!c.enabled || !c.enableZoom || this.flight || this.glide) return;
      const d = this.camera.position.distanceTo(c.target);
      const from = this.zoomGoal == null ? d : this.zoomGoal;
      this.zoomGoal = clamp(from * Math.exp(clamp(deltaY, -250, 250) * 0.0007), c.minDistance, c.maxDistance);
    }

    // The camera eases into where it is now, from a little further out (far > 1) or
    // closer in (far < 1), a little higher up (up < 0) or lower: for going in and out of homes.
    settleCamera(far, up) {
      const t = this.controls.target, end = this.camera.position.clone();
      const s = new THREE.Spherical().setFromVector3(end.clone().sub(t));
      s.radius = clamp(s.radius * far, this.controls.minDistance, this.controls.maxDistance);
      s.phi = clamp(s.phi + up, this.controls.minPolarAngle, this.controls.maxPolarAngle);
      const start = new THREE.Vector3().setFromSpherical(s).add(t);
      this.glideCamera(end, t.clone(), 1.1, { pos: start, target: t.clone() });
    }
    // A soft flash of light when the view changes all at once (into a home and out again...)
    fadeIn() {
      if (reducedMotion() || !this.canvas.parentElement) return;
      const el = this.fadeEl || (this.fadeEl = document.createElement("div"));
      el.className = "scene-fade";
      if (!el.parentNode) this.canvas.after(el);
      void el.offsetWidth; // (start the fade again)
      el.className = "scene-fade go";
    }

    // Glides the camera over to look at a Mii (closer up, the same way round).
    focusWalker(w) {
      if (!w || this.flight) return;
      const t = new THREE.Vector3(w.x, w.lift + MII_HEIGHT * w.sizeScale * 0.5, w.z);
      const off = this.camera.position.clone().sub(this.controls.target);
      const d = clamp(off.length(), this.controls.minDistance, Math.max(this.controls.minDistance, 13));
      this.glideCamera(t.clone().addScaledVector(off.normalize(), d), t, 0.9);
    }
    // Glides back to the view of the whole place.
    resetView() {
      if (!this.world || this.flight) return;
      const { dist, ty, dir } = this.fitPose(this.world);
      const t = new THREE.Vector3(0, ty, 0);
      this.glideCamera(dir.multiplyScalar(dist).add(t), t, 0.9);
    }

    // Shows a place (already built) and lets Miis find their way around it.
    // (Places on the planet stay on their spot; a home is put in the middle of the scene.)
    useWorld(world) {
      this.world = world;
      this.nav = new window.MiiNav.Nav(world.bounds, world.obstacles);
      const e = this.places.get(world.id);
      if (e && e.world === world) { if (world.group.parent !== e.anchor) e.anchor.add(world.group); }
      else this.scene.add(world.group);
      this.scene.background = this.placeBg = new THREE.Color(world.background);
      this.scene.fog = this.placeFog = world.fog ? new THREE.Fog(...world.fog) : null;
      if (world.setResidents) world.setResidents(this.residents);
      if (!this.keepCamera) this.fitCamera();
    }

    // Shows another place. The Miis that were on screen stay where they were
    // (they live their own lives, see town.js); the ones in the new place appear.
    // The camera flies there over the planet (unless that's turned off in Settings).
    setScene(id) {
      if (this.visiting) this.leaveHome();
      this.endGlide();
      if (this.world && this.world.id === id) return;
      const fly = !!(this.flyOn && this.world && this.isPlanetPlace(this.world));
      const from = fly ? this.cameraState() : null;
      const look = fly ? this.lookNow() : null;
      this.stopRare();
      for (const w of this.walkers.slice()) if (w.leaving) this.finishLeaving(w);
      // (phone calls carry on: they belong to both Miis, not to the place on screen)
      for (const w of this.walkers) { if (!this.calls.has(w.id)) this.endInteraction(w); w.remove(); }
      this.walkers = [];
      this.dragging = null; this.hover = null;
      this.clearWindowMiis();
      const world = this.placeWorld(id);
      this.places.get(id).anchor.add(this.miiGroup); // (the Miis there live in the place's own x/y/z)
      this.keepCamera = fly;
      this.useWorld(world);
      this.keepCamera = false;
      if (fly) this.startFlight(from, look);
      else { this.endFlight(true); this.fitCamera(); this.fadeIn(); }
      if (this.onSceneChange) this.onSceneChange(id);
      this.onChange();
    }

    // ---------- the little planet (see planet3d.js) ----------
    // A place's spot on the planet (made the first time it's asked for).
    placeEntry(id) {
      let e = this.places.get(id);
      if (!e) {
        const frame = window.MiiPlanet3D.frameFor(id);
        const anchor = new THREE.Group();
        anchor.name = "place-" + id;
        anchor.matrixAutoUpdate = false;
        anchor.matrix.copy(frame.matrix);
        anchor.visible = false;
        this.planetRoot.add(anchor);
        // (for a place's walls that hide when the camera is behind them: where the camera is, in the place's x/y/z)
        e = { id, frame, anchor, world: null, cam: { position: new THREE.Vector3() } };
        this.places.set(id, e);
      }
      return e;
    }
    isPlanetPlace(world) {
      const e = world && this.places.get(world.id);
      return !!e && e.world === world;
    }
    // A place, built the first time it's needed and then kept.
    placeWorld(id) {
      const e = this.placeEntry(id);
      if (e.world && this.needsBiggerBuilding(e.world)) this.dropPlace(e); // (more Miis moved in meanwhile)
      if (!e.world) {
        const world = window.World3D.build(id, { residents: this.residents.length });
        window.World3D.markFar(world);
        // The big joined-up scenery never changes: once it's on the graphics card, the
        // copy in memory isn't needed any more (every place is kept, so this adds up).
        world.group.traverse((o) => {
          if (!o.isMesh || !(o.userData.near || o.userData.far)) return;
          const g = o.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          if (!g.boundingBox) g.computeBoundingBox();
          for (const name of Object.keys(g.attributes)) g.attributes[name].onUpload(releaseArray);
          if (g.index) g.index.onUpload(releaseArray);
        });
        if (world.setResidents) world.setResidents(this.residents);
        e.anchor.add(world.group);
        e.world = world;
        this.planet.setPad(id, world.padRadius);
      }
      return e.world;
    }
    // Throws a built place away (to build it again).
    dropPlace(e) {
      if (!e.world) return;
      e.anchor.remove(e.world.group);
      window.World3D.dispose(e.world);
      e.world = null;
    }
    // Every apartment taken? The building gets a new floor (if it can still grow).
    needsBiggerBuilding(world) {
      const MH = window.MiiHomes3D;
      return !!(MH && world.capacity && MH.floorsFor(this.residents.length) * MH.APT.cols > world.capacity);
    }
    get flying() { return !!this.flight; }

    // Where the camera is, on the planet: { target, up, z, d (distance), p (down from overhead), a (turned round) }
    cameraState() {
      if (this.flight) {
        // (from where the camera really is, which isn't always right above the path)
        const c = this.flight.cur, off = c.cam.clone().sub(c.target);
        const d = Math.max(0.01, off.length());
        return { target: c.target.clone(), up: c.up.clone(), z: c.z.clone(), d, p: Math.acos(clamp(off.dot(c.up) / d, -1, 1)), a: Math.atan2(off.dot(c.x), off.dot(c.z)) };
      }
      const f = this.places.get(this.world.id).frame;
      const t = this.controls.target, off = this.camera.position.clone().sub(t);
      const d = Math.max(0.01, off.length());
      return { target: t.clone().applyMatrix4(f.matrix), up: f.up.clone(), z: f.z.clone(), d, p: Math.acos(clamp(off.y / d, -1, 1)), a: Math.atan2(off.x, off.z) };
    }
    // Where the camera ends up at a place (like fitCamera), on the planet.
    endState(world) {
      const f = this.places.get(world.id).frame;
      const { dist, ty, dir } = this.fitPose(world);
      return { target: f.pos.clone().addScaledVector(f.up, ty), up: f.up.clone(), z: f.z.clone(), d: dist, p: Math.acos(dir.y), a: 0 };
    }
    // The sky color and lights right now (where a flight starts from).
    lookNow() {
      if (this.flight) return { bg: this.flightBg.clone(), lights: this.planet.lightState(null) };
      const bg = this.scene.background && this.scene.background.isColor ? this.scene.background.clone() : new THREE.Color(this.world.background);
      return { bg, lights: this.planet.lightState(this.world) };
    }

    // Starts the camera's flight from camera state `from` to the place in this.world.
    startFlight(from, look) {
      const f = window.MiiPlanet3D.flightPath(from, this.endState(this.world));
      f.t = 0; f.look = look; f.cur = null;
      this.flight = f;
      // the planet goes back to its own x/y/z, and every place on it can be seen
      this.planetRoot.matrix.identity();
      this.planetRoot.matrixWorldNeedsUpdate = true;
      this.planet.group.visible = true;
      this.camera.layers.disable(window.World3D.FAR_LAYER); // (no far-away scenery round the places)
      this.controls.enabled = false;
      this.flightBg = this.flightBg || new THREE.Color();
      this.flightFog = this.flightFog || new THREE.Fog(0xffffff, 1e5, 2e5); // (no fog up there)
      for (const w of this.walkers) w.ui.style.display = "none";
      this.showWeather(false);
      this.stepFlight(0);
    }

    // Moves the camera along its flight (dt in real seconds).
    stepFlight(dt) {
      const f = this.flight, P = window.MiiPlanet3D;
      f.t = Math.min(1, f.t + dt / f.dur);
      const s = (f.cur = P.samplePath(f, f.t, f.cur));
      const cam = this.camera;
      cam.position.copy(s.cam);
      cam.up.copy(s.up);
      cam.lookAt(s.look);
      cam.near = clamp(s.d * 0.01, 0.1, 3);
      cam.far = Math.max(400, s.d * 3 + 1900);
      cam.updateProjectionMatrix();
      // the sky and the light change from the place we left to the one we're going to
      // (and the sky gets dark way up high, or on the way to the Moon)
      const k = smooth(f.t);
      const space = f.earth ? P.spaceAt(s.cam) : Math.max(P.spaceAt(s.cam), Math.min(1, Math.sin(Math.PI * f.t) * 2.5)); // (out in space on the way to the Moon)
      this.flightBg.copy(f.look.bg).lerp(this.placeBg, k).lerp(HIGH_SKY, Math.min(1, space * 2)).lerp(SPACE_SKY, Math.max(0, space * 2 - 1));
      this.scene.background = this.flightBg;
      this.scene.fog = this.flightFog;
      this.planet.setRig(f.look.lights, this.planet.lightState(this.world), k, s.target, s);
      this.planet.update(space);
      // only places above the horizon get drawn, and far away ones without their little things
      for (const e of this.places.values()) {
        if (!e.world) { e.anchor.visible = false; continue; }
        tmpV.copy(s.cam).sub(e.frame.pos);
        e.anchor.visible = tmpV.dot(e.frame.up) > -6 && tmpV.length() < 1500;
        this.setLittleThings(e, tmpV.length() < 110);
      }
      if (f.t >= 1) this.endFlight();
    }

    // Landed (or no flight at all): shows just the place in this.world, right here.
    // quiet = don't touch the camera
    endFlight(quiet) {
      const was = !!this.flight;
      this.flight = null;
      const e = this.places.get(this.world.id);
      this.planetRoot.matrix.copy(e.frame.inverse);
      this.planetRoot.matrixWorldNeedsUpdate = true;
      for (const p of this.places.values()) { p.anchor.visible = p === e; this.setLittleThings(p, true); }
      this.planet.group.visible = false;
      this.camera.layers.enable(window.World3D.FAR_LAYER);
      this.scene.background = this.placeBg;
      this.scene.fog = this.placeFog;
      this.showWeather(true);
      if (!was) return;
      const cam = this.camera;
      cam.up.set(0, 1, 0);
      cam.near = 0.1; cam.far = 400;
      cam.updateProjectionMatrix();
      this.controls.enabled = true;
      if (!quiet) this.fitCamera();
    }
    // Shows or leaves out a place's little things (cups, books, flower pots...): from far away you can't see them anyway.
    setLittleThings(e, on) {
      if (!e.world || e.little === on) return;
      e.little = on;
      const layer = on ? window.World3D.SMALL_LAYER : 3;
      for (const o of e.world.smallParts || []) o.layers.set(layer);
    }

    // Lands right away (before something that needs you to be at the place).
    finishFlight() {
      if (!this.flight) return;
      this.flight.t = 1;
      this.stepFlight(0);
    }

    // The weather (rain, snow, fireworks: weather3d.js) is only shown at a place.
    showWeather(on) {
      for (const o of this.scene.children) if (o.name === "weather-fx") o.visible = on;
    }

    // While flying: the places you can see keep moving (clouds, ducks...).
    updatePlacesFlying() {
      const c = this.camera.position;
      for (const e of this.places.values()) {
        if (!e.world || !e.anchor.visible) continue;
        e.cam.position.copy(c).applyMatrix4(e.frame.inverse);
        e.world.update(this.time, e.cam);
      }
    }

    // Builds the next place nobody has been to yet (a little while after starting up),
    // so it's there to see on the way.
    prebuildNext() {
      if (this.flight || this.visiting || !this.world) return;
      const next = window.World3D.list.find((l) => !(this.places.get(l.id) || {}).world);
      if (next) this.placeWorld(next.id);
    }

    // ---------- Miis you can see through their windows (in the Apartments) ----------
    clearWindowMiis() {
      for (const m of this.windowMiis.values()) {
        m.inst.holder.removeFromParent();
        M.disposeObject(m.inst.holder);
      }
      this.windowMiis.clear();
    }

    // Puts a model of each Mii who's at home inside its flat, doing whatever it's
    // doing (the building tells us where: world.windowSpot).
    syncWindowMiis(dt) {
      const world = this.world;
      if (this.visiting || !world.windowSpot) { if (this.windowMiis.size) this.clearWindowMiis(); return; }
      const want = new Set();
      for (const r of this.residents) {
        if (!r.home || !r.template) continue;
        const spot = world.windowSpot(r.id);
        if (!spot) continue;
        want.add(r.id);
        let m = this.windowMiis.get(r.id);
        if (m && m.template !== r.template) {
          m.inst.holder.removeFromParent(); M.disposeObject(m.inst.holder); m = null;
        }
        if (!m) {
          const inst = M.createInstance(r.template, r.look || {});
          inst.holder.rotation.order = "YXZ";
          const s = (0.9 + clamp(r.template.info.height, 0, 127) / 127 * 0.2) * 1.3;
          inst.holder.scale.setScalar(s);
          this.places.get(world.id).anchor.add(inst.holder); // (in the building, wherever it is on the planet)
          m = { inst, template: r.template, s, t0: Math.random() * 10 };
          this.windowMiis.set(r.id, m);
        }
        const h = m.inst.holder, rig = m.inst.rig, t = this.time + m.t0;
        const style = r.record ? animStyle(D.traits(r.record)) : null;
        const lie = spot.pose === "lie", sit = spot.pose === "sit", run = spot.pose === "run";
        const onCall = this.calls.has(r.id); // on the phone at home: hand to the ear
        rig.pose({
          t, dt, style, arms: onCall ? "phone" : spot.arms || "down", lookUp: spot.lookUp || 0,
          sit, lie, run, walk: run ? 1 : 0, phase: t * 8.5, legsOut: sit && spot.legs === "out",
          nod: lie ? 0 : 0, talking: onCall,
        });
        if (M.setEyesClosed) M.setEyesClosed(m.inst, lie);
        if (lie) {
          // on its back, head on the pillow
          const len = MII_HEIGHT * m.s * 0.5;
          h.rotation.set(-Math.PI / 2, (spot.yaw || 0) + Math.PI, 0);
          h.position.set(spot.x - Math.sin(spot.yaw || 0) * len, spot.y + (M.lieDepth(m.inst) - 0.03) * m.s, spot.z - Math.cos(spot.yaw || 0) * len);
        } else {
          h.rotation.set(0, (spot.yaw || 0) + (sit || run ? 0 : Math.sin(t * 0.4) * 0.25), 0);
          h.position.set(spot.x, spot.y - (sit || lie ? 0 : rig.drop * m.s), spot.z);
        }
      }
      for (const [id, m] of this.windowMiis) {
        if (want.has(id)) continue;
        m.inst.holder.removeFromParent(); M.disposeObject(m.inst.holder);
        this.windowMiis.delete(id);
      }
    }

    // Random Miis riding past on bikes (world.riders: where to sit them). The app gives
    // this.riderMii() -> { template, look }, a random generic Mii like "Add random Miis" makes.
    syncRiders(dt) {
      const world = this.world;
      if (!world.ridersMade) {
        if (!this.riderMii || !this.riderMii()) return; // (the generic Mii model isn't loaded yet)
        world.ridersMade = [];
        for (const spot of world.riders) {
          const m = this.riderMii();
          if (!m || !m.template) continue;
          const inst = M.createInstance(m.template, m.look || {});
          if (spot.mount) spot.mount(inst); // (the place sits it on the saddle itself)
          else {
            inst.holder.rotation.order = "YXZ";
            inst.holder.scale.setScalar(1.05);
            inst.holder.position.set(spot.x, spot.y, spot.z);
            inst.holder.rotation.set(0, spot.yaw || 0, 0);
            spot.parent.add(inst.holder);
          }
          world.ridersMade.push({ inst, spot, t0: Math.random() * 10 });
        }
      }
      for (const r of world.ridersMade) {
        const t = this.time + r.t0;
        // sitting on the saddle, legs going round (pedalling), hands on the handlebars
        if (r.spot.ride) r.spot.ride(r.inst, t, dt);
        else r.inst.rig.pose({ t, dt, arms: "type", sit: true, walk: 0.6, phase: t * 7, legsOut: true });
      }
    }

    // Which floor a Mii's flat is on (4 flats per floor, in order of who moved in first).
    floorOf(id) {
      const i = this.residents.findIndex((r) => r.id === id);
      return i < 0 ? 1 : Math.floor(i / 4);
    }
    // For the outside of a flat: who's home in the flats right below it (and beside them),
    // floor by floor from the ground up: [{ here, next }] (true = home, false = out, null = empty flat).
    homesBelow(id) {
      const i = this.residents.findIndex((r) => r.id === id);
      if (i < 0) return null;
      const col = i % 4, out = [];
      const at = (k) => (this.residents[k] ? !!this.residents[k].home : null);
      for (let f = 0; f < Math.floor(i / 4); f++) out.push({ here: at(f * 4 + col), next: at(f * 4 + (col ^ 1)) });
      return out;
    }

    batteryOf(id) { return this.batteries.has(id) ? this.batteries.get(id) : 1; }
    setBattery(id, v) { this.batteries.set(id, Math.max(0, Math.min(1, v))); }

    // Where Miis come in and leave from: the gate, the door, the path...
    entrance() {
      const e = this.world.entrance || { x: 0, z: this.world.bounds.maxZ - 0.8 };
      return this.nav.nearestFree(e.x, e.z);
    }

    // Who lives in which apartment: [{ id, name, home }]. Shown in the Apartments place.
    setResidents(list) {
      const before = this.residents.length;
      this.residents = list;
      const w = this.visiting ? this.mainWorld : this.world;
      if (!w || !w.setResidents) return;
      // every apartment taken? The building gets a new floor (if it can still grow)
      const MH = window.MiiHomes3D;
      const canGrow = MH && w.capacity && MH.floorsFor(list.length) * MH.APT.cols > w.capacity;
      if (canGrow) {
        if (this.visiting) this.growLater = true; // done when you come back outside
        else this.growApartments(before > 0);
        return;
      }
      w.setResidents(list);
    }

    // Rebuilds the apartment building with enough floors for everyone.
    // The Miis outside stay where they are.
    // announce = say so in the feed (not when the app is just starting up)
    growApartments(announce) {
      this.finishFlight();
      const before = this.world.capacity;
      const cam = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.stopRare();
      this.dropPlace(this.placeEntry("apartments"));
      this.useWorld(this.placeWorld("apartments"));
      this.camera.position.copy(cam.pos);
      this.controls.target.copy(cam.target);
      this.controls.update();
      for (const w of this.walkers) {
        // routes were planned for the old building: plan again from where they are
        if (w.path) { w.path = null; if (w.state === "walk") { w.state = "idle"; w.timer = 0.3; w.spot = null; } }
        if (w.anchored || w.state === "activity") { w.anchor = null; w.lastAnchor = null; w.seatBlend = 0; w.spot = null; w.state = "idle"; w.timer = 1; }
        if (this.nav.isBlocked(w.x, w.z)) { const p = this.nav.nearestFree(w.x, w.z); w.x = p.x; w.z = p.z; }
      }
      if (announce && this.world.capacity > before) {
        const floors = (this.world.capacity - before) / 4;
        this.addFeed("The apartment building got " + (floors > 1 ? floors + " new floors" : "a new floor") + " for the new neighbors! 🏗️");
        const w = this.walkers[Math.floor(Math.random() * this.walkers.length)];
        if (w) w.say(D.pick(["Whoa, the building got taller!", "A new floor! Hi, neighbors!", "Look, more apartments!"]), 2.6);
      }
    }

    // The direction a Mii at w should face to look at the camera.
    viewYaw(w) {
      // (while flying there: where the camera is, in the place's own x/y/z)
      const c = this.flight ? tmpV.copy(this.camera.position).applyMatrix4(this.places.get(this.world.id).frame.inverse) : this.camera.position;
      return Math.atan2(c.x - w.x, c.z - w.z);
    }

    baseLift(w) {
      if (!this.world || !this.world.floaty) return 0;
      return 0.35 + Math.sin(this.time * 1.3 + w.x * 0.7) * 0.15;
    }

    // A random open spot that no other Mii is standing on.
    randomFloorPoint() {
      for (let i = 0; i < 20; i++) {
        const p = this.nav.randomFree();
        if (!this.active().some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.5)) return p;
      }
      return this.nav.randomFree();
    }

    // Runs fn after a delay (in hub time), unless the Mii has gone.
    later(w, delay, fn) {
      this.timers.push({ at: this.time + delay, w, fn });
    }

    // ---------- adding / removing Miis ----------
    // opts.at = { x, z } to appear somewhere in particular (like a front door)
    addWalker(record, template, look, silent, opts) {
      const w = new Walker(this, record, template, look);
      // pop in at an open spot, then wander off
      const at = opts && opts.at;
      const p = at ? this.nav.nearestFree(at.x, at.z) : this.randomFloorPoint();
      w.x = p.x; w.z = p.z;
      w.yaw = w.targetYaw = this.viewYaw(w);
      w.lift = this.baseLift(w) + (at ? 0 : 1.2);
      w.timer = rnd(1, 2.5);
      w.helmet.visible = !!this.world.helmet;
      this.walkers.push(w);
      if (this.visiting || this.flight) w.ui.style.display = "none"; // (shown once you get there)
      if (!silent) {
        const lines = opts && opts.lines ? opts.lines : ["Hi everyone!", "Hello! I'm {A}!", "I'm here!", "What's this place?"];
        this.later(w, 0.9, () => w.say(D.pick(lines), 2.5));
        this.addFeed(opts && opts.feed ? opts.feed : look.name + " arrived! 👋");
      }
      // still on the phone (you just switched to this place mid-call): pick the call back up
      const call = this.calls.get(record.id);
      if (call) this.joinCall(w, call, false);
      this.onChange();
      return w;
    }

    // Takes a Mii out of the hub. Its friendships are kept unless forget is true.
    removeWalker(id, forget) {
      const w = this.walkers.find((x) => x.id === id);
      if (w) {
        this.endInteraction(w);
        if (this.dragging === w) this.dragging = null;
        if (this.hover === w) this.hover = null;
        w.remove();
        this.walkers = this.walkers.filter((x) => x !== w);
      }
      if (forget) {
        for (const key of Object.keys(this.friendships)) {
          if (key.split("|").includes(id)) delete this.friendships[key];
        }
      }
      this.onChange();
    }

    clearAll() {
      if (this.visiting) this.leaveHome();
      for (const w of this.walkers) w.remove();
      this.walkers = [];
      this.calls.clear();
      this.friendships = {};
      this.feed = [];
      this.onChange();
    }

    // A Mii heads off somewhere else: it says so, walks out (to its own front
    // door if it's going home and you're looking at the apartments), and fades away.
    // quick = go straight away (you're about to visit them)
    leavePlace(id, to, done, quick) {
      const w = this.walkers.find((x) => x.id === id);
      if (!w) { if (done) done(); return; }
      this.endInteraction(w);
      if (this.dragging === w) { this.dragging = null; w.held = false; }
      w.spot = null; w.anchor = null; w.dance = false; w.sleep = false; w.arms = "down";
      w.leaving = true;
      w.leavingTo = to;
      w.onLeft = done;
      const T = window.MiiTown;
      const pl = T ? T.placeInfo(to) : { name: to, icon: "" };
      const lines = to === "away" ? ["Vacation time! ✈️", "See you in a few days, everyone!", "Bon voyage to me!", "I'll bring back souvenirs!"]
        : to === "home"
        ? ["Time to go home!", "See you later!", "Home sweet home, here I come!", "Bye for now!"]
        : ["Off to " + pl.name + "!", "I'm going to " + pl.name + ". Bye!", "See you, everyone!", pl.icon + " Here I go!"];
      w.say(D.pick(lines), 2.2);
      w.showEmote(pl.icon || "👋", 4);
      const door = !quick && to === "home" && this.world.doorFor && this.world.doorFor(id);
      const out = !quick && !door ? this.entrance() : null;
      w.leaveAfter = this.time + (door || out ? 0 : quick ? 1.2 : 1.8);
      w.leaveBy = this.time + 16;
      if (door) w.goTo(door.x, door.z);
      else if (out && Math.hypot(out.x - w.x, out.z - w.z) > 1) w.goTo(out.x, out.z);
      else { w.state = "idle"; w.timer = 99; w.targetYaw = this.viewYaw(w); w.arms = "wave"; }
    }

    sendHome(id, done, quick) { this.leavePlace(id, "home", done, quick); }

    // A Mii arrives in the place you're looking at: through its front door if it
    // just left home (in the Apartments), otherwise at the entrance.
    arrive(record, template, look, from) {
      const door = from === "home" && this.world.doorFor && this.world.doorFor(record.id);
      const T = window.MiiTown;
      const here = T ? T.placeInfo(this.world.id) : { name: this.world.name, icon: "" };
      const w = this.addWalker(record, template, look, false, {
        at: door || this.entrance(),
        lines: from === "home" ? ["Good morning, neighbors!", "Fresh air!", "What did I miss?"] : ["Made it!", "Hi everyone!", "I love " + here.name + "!", "Hello, " + here.name + "!"],
        feed: look.name + " came to " + here.name + ". " + here.icon,
      });
      w.lift = this.baseLift(w);
      w.appear = 0;
      // walk in a few steps
      const b = this.world.bounds;
      w.goTo(clamp(w.x + rnd(-3, 3), b.minX + 1, b.maxX - 1), clamp(w.z - rnd(2, 4), b.minZ + 1, b.maxZ - 1));
      return w;
    }

    finishLeaving(w) {
      const done = w.onLeft;
      w.onLeft = null;
      this.removeWalker(w.id, false);
      const T = window.MiiTown;
      if (w.leavingTo) this.addFeed(w.look.name + (w.leavingTo === "home" ? " went home. 🏠" : " went to " + (T ? T.placeInfo(w.leavingTo).name + ". " + T.placeInfo(w.leavingTo).icon : w.leavingTo + ".")));
      if (done) done();
    }

    // A Mii moves away for good. Everyone reacts depending on how close they were.
    moveAway(id, name) {
      const gone = this.walkers.find((x) => x.id === id);
      const pts = (o) => this.friendships[id < o.id ? id + "|" + o.id : o.id + "|" + id] || 0;
      let heartbroken = [];
      for (const o of this.walkers) {
        if (o === gone || o.leaving || o.state === "playing" || this.calls.has(o.id)) continue; // (not while on the phone)
        const p = pts(o);
        const react = () => {
          if (!this.walkers.includes(o)) return;
          this.endInteraction(o);
          if (o.state === "walk" || o.state === "approach") { o.state = "idle"; o.path = null; }
          o.timer = Math.max(o.timer, 3);
          if (!o.anchored) o.targetYaw = gone ? Math.atan2(gone.x - o.x, gone.z - o.z) : this.viewYaw(o);
          const sweet = o.trait("kindness") >= 60, grumpy = o.trait("kindness") <= 35;
          if (p >= 16) {
            o.say(D.pick(["Noooo! " + name + ", don't go!", "I'll never forget you, " + name + "!", name + "... my best friend... 😭"]), 3.5);
            o.showEmote("😭", 4); o.nod = 0.35; this.later(o, 3.5, () => { o.nod = 0; });
          } else if (p >= 9) {
            o.say(D.pick(["I'm going to miss " + name + " so much...", "It won't be the same without " + name + "."]), 3);
            o.showEmote("😢", 3.5); o.nod = 0.25; this.later(o, 3, () => { o.nod = 0; });
          } else if (p >= 4) {
            o.say(D.pick(["Aww, " + name + " is moving away?", "Bye, " + name + "! Write to me!"]), 2.6);
            o.showEmote("😟", 3);
          } else if (p >= 1) {
            o.say(grumpy ? "Oh. Bye, I guess." : D.pick(["Bye, " + name + "! Good luck!", "Oh, see you, " + name + "!"]), 2.4);
            o.showEmote("👋", 2.5);
          } else if (Math.random() < 0.6) {
            o.say(sweet ? "I wish I'd got to know " + name + "..." : D.pick(["Who's " + name + "?", "Huh? Who?"]), 2.4);
            o.showEmote(sweet ? "😔" : "🤷", 2.5);
          }
        };
        this.later(o, rnd(0.4, 2.4), react);
        if (p >= 16) heartbroken.push(o.look.name);
      }
      if (gone) {
        this.endInteraction(gone);
        gone.spot = null; gone.anchor = null; gone.state = "idle"; gone.timer = 99; gone.path = null;
        gone.targetYaw = this.viewYaw(gone);
        gone.arms = "wave";
        gone.say(D.pick(["Goodbye, everyone!", "I'll miss you all!", "Bye! Thanks for everything!"]), 2.6);
        gone.showEmote("📦", 4);
        gone.leaving = true;
        gone.leaveAfter = this.time + 2.6;
        gone.leaveBy = this.time + 2.6;
        gone.onLeft = null;
      }
      for (const key of Object.keys(this.friendships)) {
        if (key.split("|").includes(id)) delete this.friendships[key];
      }
      this.addFeed(name + " moved away. 📦");
      for (const n of heartbroken) this.addFeed(n + " is heartbroken. 💔");
      this.onChange();
    }

    // ---------- visiting a Mii at home ----------
    // opts.empty: the Mii is out, so you look around its home on your own
    visitHome(record, template, look, opts) {
      const empty = !!(opts && opts.empty);
      if (this.visiting) this.leaveHome();
      this.finishFlight(); // (homes are their own little scene, not on the planet)
      if (this.dragging) { this.dragging.held = false; this.dragging = null; }
      this.hover = null;
      if (!empty && this.calls.has(record.id)) this.endCall(this.calls.get(record.id), record.id); // you're here: they hang up
      this.stopRare(); // (whatever rare thing was going on outside is over)
      this.mainWorld = this.world;
      this.mainNav = this.nav;
      this.mainCamera = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.planetRoot.visible = false; // (the place you were at waits on the planet)
      this.clearWindowMiis();
      this.miiGroup.visible = false;
      for (const w of this.walkers) w.ui.style.display = "none";
      this.useWorld(this.homeWorld(record, opts && opts.room, empty));
      this.homeGroup = new THREE.Group();
      this.scene.add(this.homeGroup);
      const v = new Walker(this, record, template, look, this.homeGroup);
      const start = this.world.playerSpot ? this.nav.nearestFree(this.world.playerSpot.x, this.world.playerSpot.z) : this.nav.randomFree();
      v.x = start.x; v.z = start.z;
      v.yaw = v.targetYaw = this.viewYaw(v);
      v.timer = rnd(3, 5);
      this.visiting = { record, walker: v, empty, room: (opts && opts.room) || "main" };
      this.settleCamera(1.3, -0.12);
      this.fadeIn();
      if (empty) { v.inst.holder.visible = false; v.ui.style.display = "none"; this.onChange(); return; }
      this.later(v, 0.7, () => {
        v.arms = "wave";
        v.say(this.onHomeTalk ? this.onHomeTalk(v, "hello") : "Welcome to my home!", 3);
        v.hop(3);
        this.later(v, 1.8, () => { if (v.arms === "wave") v.arms = "down"; });
      });
      this.onChange();
    }

    leaveHome() {
      if (!this.visiting) return;
      this.stopRare();
      const v = this.visiting.walker;
      v.remove();
      this.scene.remove(this.homeGroup);
      this.scene.remove(this.world.group);
      window.World3D.dispose(this.world);
      this.visiting = null;
      this.useWorld(this.mainWorld);
      this.planetRoot.visible = true;
      this.nav = this.mainNav;
      this.mainWorld = null;
      if (this.growLater) {
        this.growLater = false;
        if (this.world.capacity && this.residents.length > this.world.capacity) this.growApartments(true);
      }
      if (this.mainCamera) {
        this.camera.position.copy(this.mainCamera.pos);
        this.controls.target.copy(this.mainCamera.target);
        this.controls.update();
        this.settleCamera(0.82, 0.05); // (stepping back out)
      }
      this.fadeIn();
      this.miiGroup.visible = true;
      for (const w of this.walkers) w.ui.style.display = "";
      if (this.onLeftHome) this.onLeftHome();
      this.onChange();
    }

    // The inside of a Mii's home: its main room, or one of the extra rooms it bought (rooms3d.js).
    homeWorld(record, room, empty) {
      const extra = room && room !== "main" && window.MiiRooms3D;
      if (extra) return window.World3D.build("room", { record, room, floor: this.floorOf(record.id), empty });
      return window.World3D.build("home", { record, floor: this.floorOf(record.id), empty, homes: this.homesBelow(record.id) });
    }
    // Switches to another room of the home you're visiting.
    setHomeRoom(room) {
      if (!this.visiting || this.visiting.room === room) return;
      this.visiting.room = room;
      this.refreshHome();
    }

    // Rebuilds the room after you change the furniture.
    refreshHome() {
      if (!this.visiting) return;
      const v = this.visiting.walker;
      const cam = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.stopRare();
      this.scene.remove(this.world.group);
      window.World3D.dispose(this.world);
      this.useWorld(this.homeWorld(this.visiting.record, this.visiting.room, this.visiting.empty));
      this.camera.position.copy(cam.pos);
      this.controls.target.copy(cam.target);
      this.controls.update();
      v.spot = null; v.anchor = null; v.lastAnchor = null; v.seatBlend = 0; v.path = null;
      const p = this.nav.nearestFree(v.x, v.z);
      v.x = p.x; v.z = p.z;
      v.state = "idle"; v.timer = 3;
    }

    // You gave the Mii something new for its home: it reacts, then goes to try it.
    homeReact(text, emote, itemId) {
      if (!this.visiting) return;
      const v = this.visiting.walker;
      v.state = "idle"; v.timer = 3; v.path = null;
      v.targetYaw = this.viewYaw(v);
      v.say(text, 3);
      if (emote) v.showEmote(emote, 3);
      if (emote === "😍" || emote === "🤩") v.hop(4);
      const spot = itemId && (this.world.spots || []).find((s) => s.itemId === itemId);
      if (spot) this.later(v, 2.6, () => { if (v.state === "idle") { v.spot = spot; v.goTo(spot.x, spot.z); } });
    }

    // You gave the Mii some food: it eats it, then says what it thinks.
    giveFood(food, text, emote, who) {
      const v = who || (this.visiting && this.visiting.walker);
      if (!v) return;
      this.endInteraction(v);
      v.spot = null; v.anchor = null; v.path = null;
      v.state = "perform"; v.performKind = "eat"; v.timer = 2.8;
      v.targetYaw = this.viewYaw(v);
      v.arms = "eat";
      v.showEmote(food.icon, 2.8);
      v.say(D.pick(["Ooh, " + food.name.toLowerCase() + "!", "For me?", "*munch munch*"]), 1.6);
      this.later(v, 2.8, () => {
        v.arms = "down";
        v.say(text, 3);
        v.showEmote(emote, 2.5);
        if (emote === "😍") v.hop(4.5);
        if (emote === "🤢") { v.shake = 1; this.later(v, 1.2, () => { v.shake = 0; }); }
      });
    }

    // ---------- friendships ----------
    pairKey(a, b) { return a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id; }
    points(a, b) { return this.friendships[this.pairKey(a, b)] || 0; }

    bestFriendOf(w) {
      let best = null, bestPts = 3;
      for (const o of this.walkers) {
        if (o === w) continue;
        const p = this.points(w, o);
        if (p > bestPts) { best = o; bestPts = p; }
      }
      return best;
    }

    addFeed(text) {
      this.feed.unshift({ text, at: Date.now() });
      this.feed = this.feed.slice(0, 30);
      this.onChange();
    }

    // ---------- coins ----------
    // Miis earn coins from MEANINGFUL time together, not just lots of it:
    //  - doing something outside their comfort zone is worth the most
    //    (a shy Mii walking up to a stranger, a grumpy Mii giving a compliment,
    //    a serious Mii telling a joke, a calm Mii dancing...)
    //  - doing the same thing with the same Mii again and again is worth less
    //  - hanging out uses up "social energy", which comes back with time alone,
    //    so cranking up "How chatty?" doesn't make coins pour in
    coinValue(m, other, type, role, pointsBefore, remote) {
      const p = m.personality;
      const below = (v, at) => Math.max(0, (at - v) / 25); // 0 .. 2
      const base = { chat: 1, joke: 1.5, compliment: 1.5, dance: 1.5, highFive: 1, rockPaperScissors: 1, disagree: 1.5, sleepy: 1, spaceBounce: 1 }[type] || 1;
      let stretch = 0;
      if (role === "A") stretch += below(p.social, 50) * 1.2;              // a shy Mii started it
      if (pointsBefore === 0) stretch += below(p.social, 55) * 0.8;        // ...with a stranger!
      if (type === "joke" && role === "A") stretch += below(p.humor, 50);  // a serious Mii telling a joke
      if (type === "compliment" && role === "A") stretch += below(p.kindness, 55) * 1.3; // a grump being nice
      if (type === "dance" || type === "highFive" || type === "spaceBounce") stretch += below(p.energy, 50) * 0.9;
      if (type === "chat" || remote) stretch += below(p.chatty, 50) * 0.6; // a quiet Mii chatting
      if (type === "disagree") stretch += 0.5 + (p.kindness <= 40 ? 0.5 : 0); // making up after an argument
      if (remote === "phone") stretch += below(p.social, 45) * 0.3;
      // how often have they done this lately?
      const now = this.time;
      this.recent = this.recent.filter((r) => now - r.t < 300);
      const pair = this.pairKey(m, other);
      const samePair = this.recent.filter((r) => r.pair === pair).length;
      const sameType = this.recent.filter((r) => r.type === type && (r.a === m.id || r.b === m.id)).length;
      const novelty = 1 / (1 + samePair * 0.6 + sameType * 0.25);
      const energy = 0.2 + 0.8 * clamp(m.battery, 0, 1);
      const value = (base + stretch * 1.6) * novelty * energy * 1.3;
      return Math.floor(value) + (Math.random() < value % 1 ? 1 : 0);
    }

    awardCoins(w, n, why) {
      if (n <= 0) return;
      w.record.coins = (w.record.coins || 0) + n;
      if (w.ghost) { if (this.onCoins) this.onCoins(w, n, why); return; }
      // a little "+2 🪙" floats up from the Mii
      const pos = new THREE.Vector3(w.x, w.lift + MII_HEIGHT * w.sizeScale * 0.9, w.z).project(this.camera);
      if (pos.z < 1) {
        const el = document.createElement("div");
        el.className = "coin-pop" + (n >= 3 ? " big" : "");
        el.textContent = "+" + n + " 🪙";
        el.style.left = (pos.x * 0.5 + 0.5) * this.W + "px";
        el.style.top = (-pos.y * 0.5 + 0.5) * this.H + "px";
        this.overlay.appendChild(el);
        setTimeout(() => el.remove(), 1800);
      }
      if (this.onCoins) this.onCoins(w, n, why);
    }

    // ---------- the "director" decides who should hang out ----------
    runDirector(dt) {
      if (this.visiting) return;
      this.directorIn -= dt * this.chattiness;
      if (this.directorIn > 0) return;
      this.directorIn = rnd(2.5, 6);
      const free = this.walkers.filter((w) => !this.isBusy(w) && w.cooldown <= 0 && w.appear >= 1 && !w.anchored);
      if (free.length < 2) return;
      // outgoing Miis are more likely to start a conversation; tired ones less
      const A = D.weighted(free.map((w) => [w, (1 + w.trait("social") / 20) * (0.25 + w.battery)]));
      const others = free.filter((w) => w !== A);
      others.sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
      const B = Math.random() < 0.6 ? others[0] : others[Math.floor(Math.random() * others.length)];
      this.startInteraction(A, B);
    }

    isBusy(w) {
      return w.photoHold || this.calls.has(w.id) || w.held || w.leaving || w.inShow || w.state === "interact" || w.state === "approach" || w.state === "waiting" || w.state === "perform" || w.state === "playing" || w.state === "photo";
    }

    // You started a mini-game with this Mii: it stops and faces you while you play.
    startGame(w, icon) {
      this.endInteraction(w);
      w.spot = null; w.anchor = null; w.path = null;
      w.dance = false; w.sleep = false; w.arms = "down";
      w.state = "playing";
      w.targetYaw = this.viewYaw(w);
      w.showEmote(icon || "🎮", 99999);
    }

    // The game is over (result: "mii" = the Mii won, "you", "draw", or null if you quit).
    endGame(w, result) {
      if (w.state !== "playing" && result === null) return;
      w.clearEmote();
      w.state = "perform";
      w.performKind = "react";
      w.timer = 2.5;
      if (result === "mii") { w.arms = "cheer"; w.hop(this.world.floaty ? 2 : 4.5); w.showEmote("🏆", 2.5); }
      else if (result === "you") { w.nod = 0.35; w.showEmote("😅", 2.5); }
      else if (result === "draw") { w.showEmote("🤝", 2.5); }
      else { w.timer = 0.5; }
      // playing with you is time well spent
      if (result) this.later(w, 1.2, () => this.awardCoins(w, 3, "game"));
    }

    // Makes a Mii do something on its own (from its menu): dance, nap, wave, catchphrase...
    perform(w, kind) {
      this.endInteraction(w);
      w.spot = null; w.anchor = null; w.path = null;
      w.clearEmote();
      w.state = "perform";
      w.performKind = kind;
      w.targetYaw = this.viewYaw(w);
      w.timer = { dance: 5, nap: 6, wave: 2, catchphrase: 2.5, jump: 1.5, spin: 2.2, flip: 1.6, moonwalk: 3.2, flex: 2.4, bow: 2.2, sing: 5 }[kind] || 2;
      w.performT = 0;
      if (this.onPerform) this.onPerform(w, kind);
      if (kind === "spin") { w.arms = "out"; w.say(D.pick(["Wheeee!", "Spinny spin!", "Look at me go!"]), 1.6); w.showEmote("🌀", 2); }
      if (kind === "flip") { this.later(w, w.anchored ? 0.5 : 0, () => { w.hop(this.world.floaty ? 3.5 : 7.5); w.flipT = 0; }); w.say(D.pick(["Hup!", "Backflip!", "Ta-da!"]), 1.4); }
      if (kind === "moonwalk") { w.say(D.pick(["Hee-hee!", "Smooth...", "Watch this!"]), 1.8); w.showEmote("🕺", 3); }
      if (kind === "flex") { w.arms = "flex"; w.say(D.pick(["Check out these muscles!", "Strong like a mountain!", "Hnnng!"]), 2); w.showEmote("💪", 2.2); }
      if (kind === "bow") { w.bow = true; w.say(D.pick(["Thank you, thank you.", "At your service!", "*bows*"]), 1.8); w.showEmote("🙇", 2); }
      if (kind === "sing") {
        const P = window.MiiProgress;
        const songs = (w.record.songs || []).map((id) => P && P.SONGS.find((s) => s.id === id)).filter(Boolean);
        const song = songs.length ? D.pick(songs) : { lines: ["♪ La la laaa ♪", "♪ Do re mi fa so ♪", "♪ Laaaaa! ♪"] };
        w.arms = "out"; w.showEmote("🎤", 5);
        song.lines.forEach((l, i) => this.later(w, i * 1.6, () => { if (w.performKind === "sing") w.say(l, 1.6); }));
      }
      if (kind === "dance") { w.showEmote("🎵", 5); w.say(D.pick(["Let's dance!", "Watch my moves!", "Dance time!"]), 2); }
      if (kind === "nap") { w.showEmote("💤", 6); w.say("Zzz...", 3); }
      if (kind === "wave") { w.arms = "wave"; w.say(D.pick(D.CLICK_LINES), 1.8); }
      if (kind === "jump") { this.later(w, w.anchored ? 0.5 : 0, () => w.hop(this.world.floaty ? 3 : 6.5)); w.say(D.pick(["Hup!", "Boing!", "Wheee!"]), 1.4); }
      if (kind === "catchphrase") {
        const cp = (w.personality.catchphrase || "").trim();
        w.arms = "cheer";
        w.say(cp || "I don't have a catchphrase yet!", 2.4);
      }
    }

    // A wants to talk to B: A walks over. If B is far away and A is the loud
    // type, A shouts for B to come over instead, and B walks to A.
    startInteraction(A, B) {
      if (this.calls.has(A.id) || this.calls.has(B.id)) return false; // can't chat face to face while on the phone
      const plan = D.buildInteraction(A, B, this.world, this.points(A, B), { ctx: this.relation ? this.relation(A, B) : null });
      A.partner = B; B.partner = A;
      A.plan = plan; A.role = "A"; B.role = "B";
      for (const m of [A, B]) { m.spot = null; m.anchor = null; m.path = null; m.target = null; m.approachTries = 0; m.approachTime = 0; }
      const far = Math.hypot(A.x - B.x, A.z - B.z) > 9;
      const a = A.personality;
      const loud = (a.energy + a.social) / 2 + rnd(-15, 15);
      if (far && loud >= 55) {
        // "HEY MIA! COME HERE!" ... "COMING!"
        A.state = "waiting"; B.state = "waiting";
        A.targetYaw = Math.atan2(B.x - A.x, B.z - A.z);
        A.arms = "shout";
        const name = B.look.name.toUpperCase();
        A.say(D.pick(["HEY " + name + "! COME HERE!", name + "! OVER HERE!", "YOO-HOO, " + name + "!", "HEY, " + name + "! GOT A MINUTE?"]), 2.2);
        A.uiBubble.classList.add("shout");
        B.showEmote("❗", 1.5);
        this.later(B, 1.4, () => {
          if (B.partner !== A) return;
          B.arms = "shout";
          B.say(D.pick(["COMING!", "OKAY! BE RIGHT THERE!", "ON MY WAY!", "WHAT? ...OKAY!"]), 1.8);
          B.uiBubble.classList.add("shout");
        });
        this.later(B, 2.8, () => {
          if (B.partner !== A) return;
          A.arms = "down"; B.arms = "down";
          B.state = "approach"; // B walks over to A this time
        });
        return;
      }
      A.state = "approach";
      B.state = "waiting";
      B.showEmote("❗", 1.2);
    }

    // A Mii on screen talks on the phone with a Mii who's somewhere else.
    // role = "caller" (the one on screen phoned) or "callee" (they got a call)
    startPhone(A, otherRec, role) {
      return role === "callee" ? this.startCall(otherRec, A.record) : this.startCall(A.record, otherRec);
    }

    // Stands in for a Mii who isn't on screen (the other end of a phone call):
    // what it says comes out of the phone of the Mii you can see.
    ghost(rec, onScreen) {
      const hub = this;
      const name = rec.name || (this.residents.find((r) => r.id === rec.id) || {}).name || "?";
      return {
        ghost: true, id: rec.id, record: rec, look: { name },
        x: onScreen.x, z: onScreen.z, lift: 0, sizeScale: 1, state: "phone", cooldown: 0,
        arms: "down", dance: false, laugh: false, sleep: false, nod: 0, shake: 0, emote: null,
        get personality() { return D.traits(rec); },
        trait(k) { return this.personality[k]; },
        get battery() { return hub.batteryOf(rec.id); },
        set battery(v) { hub.setBattery(rec.id, v); },
        say(text, dur) {
          if (onScreen.partner !== this) return;
          onScreen.say("📞 " + name + ": " + text.replace(/\{A\}/g, name), dur);
          onScreen.uiBubble.classList.add("phone-voice");
        },
        showEmote() {}, clearEmote() {}, hop() {},
      };
    }

    // ---------- phone calls ----------
    // A call belongs to BOTH Miis for as long as it lasts, whichever place you're
    // looking at: both are busy, and whichever end is on screen holds the phone
    // and talks (the other end's words come out of its phone). The conversation
    // runs on its own clock (runCall), so switching places mid-call shows the
    // other end still on the phone, at the same point in the chat.
    //   call = { a (caller record), b (callee record), plan, step, stepTimer, before }

    // The Mii on screen for this record (not one that's leaving).
    walkerFor(id) { return this.walkers.find((w) => w.id === id && !w.leaving) || null; }

    // Is this Mii free to pick up (or make) a call?
    canCall(rec) {
      if (!rec || this.calls.has(rec.id)) return false;
      if (this.visiting && this.visiting.record.id === rec.id) return false;
      if (this.callHold && this.callHold(rec) === false) return false; // on its way somewhere
      const w = this.walkers.find((x) => x.id === rec.id);
      if (w && (this.isBusy(w) || w.appear < 1)) return false;
      return true;
    }

    // recA phones recB. Returns false if either of them can't take a call right now.
    startCall(recA, recB) {
      if (!recA || !recB || recA.id === recB.id || !this.canCall(recA) || !this.canCall(recB)) return false;
      const A = this.ghost(recA, { partner: null }), B = this.ghost(recB, { partner: null });
      const ctx = this.relation ? this.relation(A, B) : null;
      if (ctx) ctx.confess = null; // that's done face to face
      const before = this.points(A, B);
      // (they're in different places, so no talk about "the fountain over there")
      const plan = D.buildInteraction(A, B, { id: "phone" }, before, { remote: "phone", ctx });
      const call = { a: recA, b: recB, plan, step: -1, stepTimer: 1.2, before };
      this.calls.set(recA.id, call);
      this.calls.set(recB.id, call);
      for (const rec of [recA, recB]) {
        const w = this.walkerFor(rec.id);
        if (w) this.joinCall(w, call, true);
      }
      this.onChange();
      return true;
    }

    // Puts a Mii you can see on the phone (when the call starts, or when you
    // switch to its place while it's still talking).
    joinCall(w, call, ringing) {
      const callee = call.b.id === w.id;
      const other = callee ? call.a : call.b;
      w.partner = this.ghost(other, w);
      w.remote = "phone";
      w.plan = null; w.role = null; w.endInteractionLater = false;
      w.spot = null; w.anchor = null; w.path = null; w.target = null;
      w.dance = false; w.laugh = false; w.sleep = false; w.nod = 0; w.shake = 0; w.bow = false;
      w.state = "interact";
      w.arms = "phone";
      w.uiPhone.textContent = "📱 " + (callee ? "Call from " : "Calling ") + this.callName(other);
      w.uiPhone.classList.add("show");
      if (ringing && callee) { w.showEmote("📳", 1.4); w.hop(2); }
    }

    callName(rec) {
      const w = this.walkers.find((x) => x.id === rec.id);
      return w ? w.look.name : rec.name || (this.residents.find((r) => r.id === rec.id) || {}).name || "?";
    }

    // Hangs up for both ends. cutBy = the id of the Mii whose end was cut short
    // (picked up, sent off, moved away...), or null when they said goodbye.
    endCall(call, cutBy) {
      if (this.calls.get(call.a.id) === call) this.calls.delete(call.a.id);
      if (this.calls.get(call.b.id) === call) this.calls.delete(call.b.id);
      for (const rec of [call.a, call.b]) {
        const w = this.walkers.find((x) => x.id === rec.id);
        if (!w || w.remote !== "phone") continue;
        this.endInteraction(w);
        // the other end got cut off
        if (cutBy && cutBy !== rec.id && !w.leaving && !w.held) {
          w.say(D.pick(["Hello? Hello?", "Huh, they hung up!", "Oh! The line went dead.", "I'll call back later!"]), 2);
          w.showEmote("📵", 1.8);
        }
      }
      this.onChange();
    }

    tickCalls(dt) {
      if (!this.calls.size) return;
      for (const call of new Set(this.calls.values())) {
        // a Mii who sets off somewhere else (or is gone) hangs up
        const gone = [call.a, call.b].find((rec) => this.callHold && this.callHold(rec) === false);
        if (gone) { this.endCall(call, gone.id); continue; }
        this.runCall(call, dt);
      }
    }

    // One step of a phone call. Whoever is on screen acts it out; the far end's
    // lines come out of the phone of the Mii you can see.
    runCall(call, dt) {
      call.stepTimer -= dt;
      if (call.stepTimer > 0) return;
      const wa = this.walkerFor(call.a.id), wb = this.walkerFor(call.b.id);
      for (const w of [wa, wb]) if (w) { w.arms = "phone"; w.dance = false; w.laugh = false; w.sleep = false; w.nod = 0; w.shake = 0; }
      call.step++;
      const step = call.plan.steps[call.step];
      if (!step) { this.finishCall(call); return; }
      const nameA = this.callName(call.a), nameB = this.callName(call.b);
      const line = step.say ? step.say.replace(/\{A\}/g, nameA).replace(/\{B\}/g, nameB) : null;
      const dur = Math.max(step.dur + 0.4, 1.4);
      const floaty = this.world && this.world.floaty;
      const ends = [[call.a, wa, wb, nameA], [call.b, wb, wa, nameB]];
      const actors = ends.filter((e, i) => step.who === "both" || step.who === (i === 0 ? "A" : "B"));
      for (const [, w, other, name] of actors) {
        if (w) {
          if (line) w.say(line, dur);
          if (step.emote) w.showEmote(step.emote, Math.max(step.dur, 1.5));
          if (step.hop) w.hop(floaty ? 1.8 : 4.5);
          if (step.expr === "laugh") w.laugh = true;
          if (step.expr === "sad") w.nod = 0.35;
          if (step.expr === "angry") w.shake = 1;
          if (step.expr === "surprised") w.hop(floaty ? 1 : 2.5);
        } else if (other && line && !/^\*.*\*$/.test(line) && !actors.some((e) => e[1] === other)) {
          // (you can't hear "*dials*" down the phone)
          other.say("📞 " + name + ": " + line, dur);
          other.uiBubble.classList.add("phone-voice");
        }
      }
      call.stepTimer = step.dur;
    }

    // They said goodbye: friendship, coins and the news feed, then both hang up.
    finishCall(call) {
      const wa = this.walkerFor(call.a.id), wb = this.walkerFor(call.b.id);
      const A = wa || this.ghost(call.a, { partner: null }), B = wb || this.ghost(call.b, { partner: null });
      const type = call.plan.type;
      const key = this.pairKey(A, B);
      const before = this.friendships[key] || 0;
      const after = before + (D.FRIENDSHIP_GAIN[type] || 1);
      this.friendships[key] = after;
      const fight = call.plan.fight, success = call.plan.success;
      const feed = (fight ? "{A} and {B} had a fight! 💢" : call.plan.feed || D.FEED_TEXT[type]).replace("{A}", A.look.name).replace("{B}", B.look.name).replace(/\.$/, "") + " on the phone. 📱";
      this.addFeed(feed);
      const oldLevel = D.levelFor(before), newLevel = D.levelFor(after);
      if (newLevel !== oldLevel) {
        this.addFeed(A.look.name + " and " + B.look.name + " are now " + newLevel.name + "! " + newLevel.emoji);
        for (const w of [wa, wb]) if (w) w.showEmote(newLevel.emoji, 2.5);
      }
      for (const [m, o, role] of [[A, B, "A"], [B, A, "B"]]) {
        const n = this.coinValue(m, o, type, role, before, "phone");
        if (n > 0) this.awardCoins(m, n, type);
        m.battery = clamp(m.battery - (0.22 + (1 - m.trait("social") / 100) * 0.2) * 0.6, 0, 1);
      }
      this.recent.push({ pair: key, type, a: A.id, b: B.id, t: this.time });
      this.endCall(call, null);
      if (this.onHangout) this.onHangout({ a: A.id, b: B.id, kind: type, before, after, visible: !!(wa || wb), where: "phone", fight, success });
    }

    // Two Miis chat somewhere you're not looking (or on the phone between two
    // places you're not looking at). They still become friends and earn coins.
    offscreenHangout(recA, recB, where) {
      if (where === "phone") return this.startCall(recA, recB);
      // (no chatting face to face with someone who's on the phone)
      if (!recA || !recB || this.calls.has(recA.id) || this.calls.has(recB.id)) return false;
      const A = this.ghost(recA, { partner: null }), B = this.ghost(recB, { partner: null });
      const phone = where === "phone";
      const points = this.points(A, B);
      const ctx = this.relation ? this.relation(A, B) : null;
      if (ctx && phone) ctx.confess = null; // that's done face to face
      const plan = D.buildInteraction(A, B, { id: phone ? "phone" : where }, points, { remote: phone ? "phone" : null, ctx });
      const type = plan.type;
      const key = this.pairKey(A, B);
      const after = points + (D.FRIENDSHIP_GAIN[type] || 1);
      this.friendships[key] = after;
      const T = window.MiiTown;
      let feed = (plan.feed || D.FEED_TEXT[type]).replace("{A}", A.look.name).replace("{B}", B.look.name).replace(/\.$/, "");
      feed += phone ? " on the phone. 📱" : " at " + (T ? T.placeInfo(where).name + ". " + T.placeInfo(where).icon : where + ".");
      this.addFeed(feed);
      const oldLevel = D.levelFor(points), newLevel = D.levelFor(after);
      if (newLevel !== oldLevel) this.addFeed(A.look.name + " and " + B.look.name + " are now " + newLevel.name + "! " + newLevel.emoji);
      for (const [m, o, role] of [[A, B, "A"], [B, A, "B"]]) {
        this.awardCoins(m, this.coinValue(m, o, type, role, points, phone ? "phone" : null), type);
        m.battery = m.battery - (0.22 + (1 - m.trait("social") / 100) * 0.2) * (phone ? 0.6 : 1);
      }
      this.recent.push({ pair: key, type, a: A.id, b: B.id, t: this.time });
      if (this.onHangout) this.onHangout({ a: A.id, b: B.id, kind: type, before: points, after, visible: false, where, fight: plan.fight, success: plan.success });
      return true;
    }

    endInteraction(w) {
      // on the phone? Then the call ends for both ends (picked up, sent off, moved away...)
      if (w && !w.ghost && this.calls.has(w.id)) { this.endCall(this.calls.get(w.id), w.id); return; }
      const p = w.partner;
      for (const m of [w, p]) {
        if (!m) continue;
        if (m.remote === "phone" && m.emote && m.emote.icon === "📱") m.clearEmote();
        if (m.uiPhone) m.uiPhone.classList.remove("show");
        m.partner = null; m.plan = null; m.role = null; m.remote = null;
        m.dance = false; m.laugh = false; m.sleep = false; m.nod = 0; m.shake = 0;
        m.arms = "down";
        if (m.state === "interact" || m.state === "approach" || m.state === "waiting") {
          m.state = "idle";
          m.timer = rnd(1, 3);
        }
        m.cooldown = rnd(5, 12) * (1.5 - m.trait("social") / 100); // outgoing Miis are ready to chat again sooner
      }
    }

    finishInteraction(A) {
      const B = A.partner;
      if (!B) return;
      const type = A.plan.type;
      const remote = A.remote;
      const key = this.pairKey(A, B);
      const before = this.friendships[key] || 0;
      const after = before + (D.FRIENDSHIP_GAIN[type] || 1);
      this.friendships[key] = after;
      const fight = A.plan.fight, success = A.plan.success;
      let feed = (fight ? "{A} and {B} had a fight! 💢" : A.plan.feed || D.FEED_TEXT[type]).replace("{A}", A.look.name).replace("{B}", B.look.name);
      if (remote === "phone") feed = feed.replace(/\.$/, "") + " on the phone. 📱";
      this.addFeed(feed);
      const oldLevel = D.levelFor(before), newLevel = D.levelFor(after);
      if (newLevel !== oldLevel) {
        this.addFeed(A.look.name + " and " + B.look.name + " are now " + newLevel.name + "! " + newLevel.emoji);
        A.showEmote(newLevel.emoji, 2.5);
        B.showEmote(newLevel.emoji, 2.5);
        this.spawnHearts(A.ghost ? B : A, B.ghost ? A : B);
      }
      // coins for a meaningful hang-out, then they need a little recharge
      for (const [m, o, role] of [[A, B, "A"], [B, A, "B"]]) {
        const n = this.coinValue(m, o, type, role, before, remote);
        if (n > 0) this.later(m.ghost ? null : m, role === "A" ? 0.3 : 0.6, () => this.awardCoins(m, n, type));
        m.battery = clamp(m.battery - (0.22 + (1 - m.trait("social") / 100) * 0.2) * (remote ? 0.6 : 1), 0, 1);
      }
      this.recent.push({ pair: key, type, a: A.id, b: B.id, t: this.time });
      this.endInteraction(A);
      if (this.onHangout) this.onHangout({ a: A.id, b: B.id, kind: type, before, after, visible: !A.ghost || !B.ghost, where: this.world.id, fight, success });
      if (!remote) {
        // walk apart a little so they don't get stuck together
        for (const m of [A, B]) {
          const dir = m.x < (A.x + B.x) / 2 ? -1 : 1;
          const b = this.world.bounds;
          m.goTo(clamp(m.x + dir * rnd(2, 5), b.minX + 1, b.maxX - 1), clamp(m.z + rnd(-2, 2), b.minZ + 1, b.maxZ - 1));
        }
      }
      this.onChange();
    }

    spawnHearts(A, B) {
      if (this.flight) return; // (you're not there yet)
      const pos = new THREE.Vector3((A.x + B.x) / 2, MII_HEIGHT + 0.6, (A.z + B.z) / 2).project(this.camera);
      const x = (pos.x * 0.5 + 0.5) * this.W, y = (-pos.y * 0.5 + 0.5) * this.H;
      for (let i = 0; i < 8; i++) {
        const h = document.createElement("div");
        h.className = "heart";
        h.textContent = "❤️";
        h.style.left = x + rnd(-30, 30) + "px";
        h.style.top = y + rnd(-10, 10) + "px";
        h.style.animationDelay = rnd(0, 0.4) + "s";
        this.overlay.appendChild(h);
        setTimeout(() => h.remove(), 2200);
      }
    }

    // ---------- per-frame update ----------
    update(dt) {
      this.time += dt;
      if (!this.world) return;
      if (this.flight) this.updatePlacesFlying();
      else this.world.update(this.time, this.camera);
      if (this.onTick) this.onTick(dt);
      if (this.world.windowSpot || this.windowMiis.size) this.syncWindowMiis(dt);
      if (this.world.riders) this.syncRiders(dt);
      // rare events (world.rare): they only run while you're looking at the place
      // (in a home: only while the Mii is in; not while flying there)
      if (this.world.rare && !this.flight && (!this.visiting || !this.visiting.empty)) this.world.rare.update(dt, this.time, this.rareContext());
      this.runDirector(dt);
      this.tickCalls(dt);
      const floaty = this.world.floaty;
      const gravity = floaty ? 3 : 22;
      const list = this.active();

      // things that were scheduled to happen now
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) if (!t.w || this.walkers.includes(t.w) || (this.visiting && this.visiting.walker === t.w)) t.fn();
      }

      for (const w of list) {
        w.appear = Math.min(1, w.appear + dt * 2.5);
        w.cooldown -= dt;
        // alone time recharges social energy (faster for outgoing Miis)
        if (!w.partner) w.battery = Math.min(1, w.battery + dt * 0.008 * (0.6 + w.trait("social") / 100));

        if (w.bubble) { w.bubble.time += dt; if (w.bubble.time > w.bubble.dur) { w.bubble = null; w.uiBubble.classList.remove("show"); } }
        if (w.emote) { w.emote.time += dt; if (w.emote.time > w.emote.dur) w.clearEmote(); }

        // jumping / floating
        if (!w.held) {
          const base = this.baseLift(w);
          if (w.liftVel !== 0 || w.lift > base + 0.01) {
            w.liftVel -= gravity * dt;
            w.lift += w.liftVel * dt;
            if (w.lift <= base && w.liftVel <= 0) {
              w.lift = base;
              this.landed(w);
              // a small bounce when dropped from high up
              w.liftVel = w.liftVel < -6 && !floaty ? -w.liftVel * 0.25 : 0;
            }
          } else {
            w.lift = base;
          }
        }

        // talking to themselves now and then
        if (!this.isBusy(w)) {
          w.talkIn -= dt * this.chattiness;
          if (w.talkIn <= 0 && !w.bubble) {
            const bf = this.bestFriendOf(w);
            if (w.spot && w.state === "activity" && Math.random() < 0.6) w.say(D.pick(w.spot.lines));
            else if (w.battery < 0.25 && Math.random() < 0.5) w.say(D.pick(["I need a little alone time...", "Phew, so much socialising!", "*recharging*"]));
            else if (this.weatherLine && Math.random() < 0.25) w.say(this.weatherLine());
            else w.say(D.soloLine(w, this.world, bf && bf.look.name));
            w.talkIn = rnd(9, 20) * (1.5 - w.trait("chatty") / 100); // chatty Miis talk more
          }
        }

        // going home: once at the door (or out of time), fade away
        if (w.leaving) {
          const there = this.time > w.leaveAfter && (w.state !== "walk" || this.time > w.leaveBy);
          if (there) {
            w.vanish = Math.min(1, w.vanish + dt * 2.2);
            if (w.vanish >= 1) { this.finishLeaving(w); continue; }
          }
        }

        if (!w.held) this.updateState(w, dt);
      }

      this.separate(this.active(), dt);
      for (const w of this.active()) this.applyPose(w, dt);
      if (this.guests.length) this.updateGuests(dt, gravity);
    }

    // ---------- rare events (see world.rare in the places) ----------
    // What a place's rare event can use.
    rareContext() {
      return this.rareCtx || (this.rareCtx = {
        miis: () => this.walkers.filter((w) => !w.held && !w.anchored && !w.leaving && w.vanish <= 0 && !this.calls.has(w.id)),
        // everyone here, also the ones sitting down or busy
        all: () => (this.visiting ? [] : this.walkers).filter((w) => !w.held && !w.leaving && w.vanish <= 0 && !this.calls.has(w.id)),
        say: (w, text, secs) => w.say(text, secs || 2.5),
        event: (id) => { if (this.onRareEvent) this.onRareEvent(id); },
        // a move from the Mii's menu (quiet: without its usual line); kind can also be
        // anything else: the Mii then just stands still for a moment (w.timer seconds)
        perform: (w, kind, quiet) => {
          const cb = this.onPerform;
          this.onPerform = null; // (not a trick you asked for: no daily goal or wish for it)
          this.perform(w, kind);
          this.onPerform = cb;
          if (quiet && w.bubble) { w.bubble = null; w.uiBubble.classList.remove("show"); }
        },
        // the dance moves a Mii knows: dancing, jumping, and the special moves it learned
        moves: (w) => ["dance", "jump"].concat((w.record.moves || []).filter((k) => k !== "sing")),
        // at home: the Mii whose home it is
        host: () => (this.visiting && !this.visiting.empty ? this.visiting.walker : null),
        // someone else who could drop by (not the host): a resident's id, or null
        visitor: () => {
          const host = this.visiting ? this.visiting.record.id : null;
          const ok = this.residents.filter((r) => r.id !== host && this.miiInfo && this.miiInfo(r.id));
          const out = ok.filter((r) => !r.home);
          const list = out.length ? out : ok;
          return list.length ? list[Math.floor(Math.random() * list.length)].id : null;
        },
        guest: (id) => this.addGuest(id),
        dropGuest: (g) => this.removeGuest(g),
        // how two Miis get on: { points, level, fight, rival, couple }
        relation: (a, b) => {
          const pts = this.points(a, b);
          return Object.assign({ points: pts, level: D.levelFor ? D.levelFor(pts).name : "" }, this.relation ? this.relation(a, b) : {});
        },
      });
    }

    // Ends whatever rare event is going on here (you're leaving the place).
    stopRare() {
      if (this.world && this.world.rare && this.world.rare.stop) this.world.rare.stop(this.rareContext());
      for (const g of this.guests.slice()) this.removeGuest(g);
    }

    // Brings in another Mii for a rare event (it isn't one of the walkers: the event moves it).
    addGuest(id) {
      const info = this.miiInfo && this.miiInfo(id);
      if (!info || !info.template) return null;
      const g = new Walker(this, info.record, info.template, info.look || {}, this.visiting ? this.homeGroup : this.miiGroup);
      g.state = "guest";
      g.appear = 1;
      this.guests.push(g);
      return g;
    }
    removeGuest(g) {
      const i = this.guests.indexOf(g);
      if (i < 0) return;
      this.guests.splice(i, 1);
      g.remove();
    }
    updateGuests(dt, gravity) {
      for (const g of this.guests) {
        if (g.bubble) { g.bubble.time += dt; if (g.bubble.time > g.bubble.dur) { g.bubble = null; g.uiBubble.classList.remove("show"); } }
        if (g.emote) { g.emote.time += dt; if (g.emote.time > g.emote.dur) g.clearEmote(); }
        if (g.liftVel !== 0 || g.lift > 0) {
          g.liftVel -= gravity * dt;
          g.lift += g.liftVel * dt;
          if (g.lift <= 0 && g.liftVel <= 0) { g.lift = 0; this.landed(g); g.liftVel = 0; }
        }
        this.applyPose(g, dt);
      }
    }

    // Keeps Miis from walking through each other.
    separate(list, dt) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.held || b.held || a.partner === b || a.anchored || b.anchored) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          const walkingA = a.state === "walk" || a.state === "approach";
          const walkingB = b.state === "walk" || b.state === "approach";
          // walking past someone who's standing still needs a little less room
          // (routes already go around them, see standingMiis)
          const min = walkingA && walkingB ? 1.2 : 1.05;
          if (d > 0.001 && d < min) {
            const push = (min - d) / d * 0.5;
            const nudge = (m, sx, sz) => {
              if (m.state === "activity" || m.state === "interact") return;
              this.tryMove(m, sx, sz);
            };
            if (walkingA && walkingB) {
              // Two Miis walking into each other: both step to their own right
              // (like people passing in a hallway), and the calmer one waits a moment.
              const side = 0.6 * push;
              nudge(a, dz * side, -dx * side);
              nudge(b, -dz * side, dx * side);
              const headOn = a.moveYaw !== null && b.moveYaw !== null && Math.abs(angleDiff(a.moveYaw, b.moveYaw)) > 2.2;
              if (headOn && !a.yieldTime && !b.yieldTime) {
                const waiter = a.trait("energy") <= b.trait("energy") ? a : b;
                waiter.yieldTime = 0.45;
              }
            }
            nudge(a, -dx * push, -dz * push);
            nudge(b, dx * push, dz * push);
            // walking into someone who's standing still: curve around them
            // instead of pushing against them forever
            if (walkingA !== walkingB) {
              const m = walkingA ? a : b, o = walkingA ? b : a;
              if (m.moveYaw !== null) {
                const rx = (o.x - m.x) / d, rz = (o.z - m.z) / d;
                const hx = Math.sin(m.moveYaw), hz = Math.cos(m.moveYaw);
                const into = hx * rx + hz * rz;
                if (into > 0.1) {
                  let tx = hx - rx * into, tz = hz - rz * into;
                  const tl = Math.hypot(tx, tz);
                  if (tl < 0.05) { tx = -rz; tz = rx; } else { tx /= tl; tz /= tl; }
                  const k = m.speed * dt * into * 0.8;
                  this.tryMove(m, tx * k, tz * k);
                }
              }
            }
          }
        }
      }
    }

    updateState(w, dt) {
      // getting up off a seat/bed first (only takes a moment)
      if (w.anchored && !(w.state === "activity" && w.anchor)) {
        if (w.state === "walk" || w.state === "approach") return;
      }
      switch (w.state) {
        case "idle": {
          w.timer -= dt;
          if (w.leaving) break;
          if (w.timer > 0) {
            if (Math.random() < dt * 0.25) w.targetYaw = this.viewYaw(w) + rnd(-0.8, 0.8); // look around, mostly towards the camera
            break;
          }
          if (this.visiting) { this.homeIdle(w); break; }
          const roll = Math.random();
          if (roll < 0.3 && this.world.spots.length) {
            const spot = D.pick(this.world.spots);
            if (!this.walkers.some((o) => o !== w && o.spot === spot)) {
              w.spot = spot;
              if (w.goTo(spot.x, spot.z)) break;
            }
          }
          if (roll < 0.85) {
            const p = this.randomFloorPoint();
            w.goTo(p.x, p.z);
          } else {
            w.timer = rnd(1, 3);
            if (this.world.floaty && Math.random() < 0.5) { w.hop(2.4); w.say(D.pick(["Boing!", "Moon jump!", "Wheee!"]), 1.6); }
            else if (w.trait("energy") >= 70 && Math.random() < 0.4) w.hop(this.world.floaty ? 1.5 : 3.5); // can't keep still!
          }
          break;
        }

        case "walk": {
          const result = this.followPath(w, dt);
          if (result === "lost") {
            // couldn't get there: give up and try something else
            w.spot = null;
            w.toPlayer = false;
            w.state = "idle";
            w.timer = rnd(0.5, 1.5);
          } else if (result === "arrived") {
            if (w.leaving) { w.state = "idle"; w.timer = 99; break; }
            if (w.toPlayer) {
              // came over to say something to you
              w.toPlayer = false;
              w.state = "idle";
              w.timer = rnd(3, 5);
              w.targetYaw = this.viewYaw(w);
              w.arms = "wave";
              w.say(this.onHomeTalk ? this.onHomeTalk(w, "chat") : "Hi!", 3);
              this.later(w, 1.6, () => { if (w.arms === "wave") w.arms = "down"; });
            } else if (w.spot) {
              const spot = w.spot;
              w.state = "activity";
              w.timer = this.visiting ? rnd(8, 16) * (spot.lie ? 1.4 : 1) : rnd(6, 11);
              // seats, beds and treadmills: the Mii gets on
              w.anchor = spot.seat ? { kind: "sit", at: spot.seat } : spot.lie ? { kind: "lie", at: spot.lie } : spot.stand ? { kind: "stand", at: spot.stand } : null;
              if (w.anchor) w.anchor.yaw = spot.seat && spot.seat.yaw !== undefined ? spot.seat.yaw : spot.yaw || 0;
              w.targetYaw = spot.yaw || 0;
              w.showEmote(spot.emoji, w.timer);
              if (Math.random() < 0.6) w.say(D.pick(spot.lines));
            } else {
              w.state = "idle";
              w.timer = rnd(1, 4);
              w.targetYaw = this.viewYaw(w) + rnd(-0.5, 0.5);
            }
          }
          break;
        }

        case "activity":
          w.timer -= dt;
          w.arms = (w.spot && w.spot.arms) || "down";
          w.sleep = !!(w.anchor && w.anchor.kind === "lie");
          if (w.timer <= 0 || !w.spot) {
            w.arms = "down"; w.sleep = false;
            w.clearEmote();
            w.anchor = null; // get up (the Mii waits until it's standing before walking)
            w.spot = null;
            if (this.visiting) { w.state = "idle"; w.timer = rnd(0.5, 2); break; }
            const back = this.randomFloorPoint();
            w.goTo(back.x, back.z);
          }
          break;

        case "approach": {
          const B = w.partner;
          if (!B) { w.state = "idle"; break; }
          B.targetYaw = Math.atan2(w.x - B.x, w.z - B.z);
          w.approachTime = (w.approachTime || 0) + dt;
          const dist = Math.hypot(w.x - B.x, w.z - B.z);
          // can't get there? Give up (they'll find each other another time)
          const giveUp = () => this.endInteraction(w);
          // plan (or re-plan) a route to a free spot next to the other Mii
          w.replanIn = (w.replanIn || 0) - dt;
          if (!w.path || w.replanIn <= 0) {
            const meet = this.meetingPoint(w, B);
            w.path = this.nav.findPath(w.x, w.z, meet.x, meet.z, this.standingMiis(w));
            w.replanIn = 1.5;
            if (!w.path) { giveUp(); break; }
          }
          const result = this.followPath(w, dt);
          if (dist < 2.4 || (result === "arrived" && dist < 3.2)) {
            w.path = null;
            w.state = "interact";
            B.state = "interact";
            // the one who started the chat runs the conversation (that's not always
            // the one who walked over: B walks over when A called them)
            const lead = w.role === "A" ? w : B;
            lead.step = -1;
            lead.stepTimer = 0;
          } else if (result === "arrived" || result === "lost") {
            // ended up somewhere that isn't next to them: try again a few times
            w.path = null;
            w.approachTries = (w.approachTries || 0) + 1;
            if (w.approachTries > 3) giveUp();
          } else if (w.approachTime > 25) {
            giveUp();
          }
          break;
        }

        case "playing": // playing a mini-game with you
          if (!w.anchored) w.targetYaw = this.viewYaw(w);
          break;

        case "photo": // standing still for a group picture (see takePhoto)
          break;

        case "perform": // something you asked for from the Mii's menu
          w.timer -= dt;
          if (w.performKind === "dance") {
            w.dance = true;
            w.arms = "out";
            w.targetYaw += Math.sin(this.time * 5) * 0.08 * w.style.tempo;
            if (w.style.dance !== "sway" && w.lift <= this.baseLift(w) + 0.01) w.hop(this.world.floaty ? 1.4 : 2.4 + w.style.tempo);
          }
          if (w.performKind === "nap") { w.sleep = true; }
          w.performT = (w.performT || 0) + dt;
          if (w.performKind === "spin") { w.yaw += dt * 11; w.targetYaw = w.yaw; }
          if (w.performKind === "moonwalk") {
            // gliding backwards while the legs walk forwards
            const back = w.yaw + Math.PI;
            this.tryMove(w, Math.sin(back) * 0.9 * dt, Math.cos(back) * 0.9 * dt);
            w.phase -= dt * 7;
            w.targetYaw = w.yaw;
          }
          if (w.performKind === "sing") { w.targetYaw = this.viewYaw(w) + Math.sin(w.performT * 2) * 0.3; }
          if (w.timer <= 0) {
            w.dance = false; w.sleep = false; w.arms = "down"; w.nod = 0; w.bow = false;
            w.state = "idle";
            w.timer = rnd(1, 2);
          }
          break;

        case "waiting":
          if (w.partner) w.targetYaw = Math.atan2(w.partner.x - w.x, w.partner.z - w.z);
          break;

        case "interact": {
          const p = w.partner;
          if (p) {
            const face = Math.atan2(p.x - w.x, p.z - w.z);
            if (w.remote === "phone") {
              // on the phone: pacing about a little, mostly facing you
              w.targetYaw = turnToward(face, this.viewYaw(w), 0.7) + Math.sin(this.time * 0.8 + w.x) * 0.4;
            } else {
              // face each other, but turn a bit towards the camera so we can see their faces
              w.targetYaw = turnToward(face, this.viewYaw(w), 0.35);
            }
          }
          if (w.dance) w.targetYaw += Math.sin(this.time * 5) * 0.8;
          // the one who started runs the conversation (the far end of a phone call
          // isn't on screen, so then the Mii you can see runs it for both)
          // (a phone call runs on its own, see runCall, so both ends stay in step)
          if (this.calls.has(w.id)) { /* nothing */ }
          else if (w.role === "A") this.runScript(w, dt);
          else if (p && p.ghost) this.runScript(p, dt);
          if (w.dance && w.style.dance !== "sway" && w.lift <= this.baseLift(w) + 0.01) w.hop(this.world.floaty ? 1.5 : 2.5 + w.style.tempo);
          break;
        }
      }
    }

    // At home, alone: use the furniture, wander, or come and talk to you.
    homeIdle(w) {
      const roll = Math.random();
      const spots = this.world.spots || [];
      if (roll < 0.6 && spots.length) {
        const spot = D.pick(spots);
        w.spot = spot;
        if (w.goTo(spot.x, spot.z)) return;
      }
      if (roll < 0.82 && this.world.playerSpot) {
        w.toPlayer = true;
        const p = this.world.playerSpot;
        if (w.goTo(p.x + rnd(-1, 1), p.z)) return;
        w.toPlayer = false;
      }
      const p = this.randomFloorPoint();
      w.goTo(p.x, p.z);
    }

    // Miis that are standing still (chatting, sitting, idling) - walking Miis plan
    // routes around these. Walking Miis aren't included: they'll have moved on.
    standingMiis(self) {
      const out = [];
      for (const o of this.active()) {
        if (o === self || o === self.partner || o.held) continue;
        if (o.state === "walk" || o.state === "approach") continue;
        out.push({ x: o.x, z: o.z, r: 0.75 });
      }
      return out;
    }

    // Where should A stand to talk to B? Next to B, on whichever side is free.
    meetingPoint(A, B) {
      const sides = A.x < B.x ? [-1, 1] : [1, -1];
      // don't pick a spot where someone else is already standing
      const crowded = (x, z) => this.walkers.some((o) => o !== A && o !== B && Math.hypot(o.x - x, o.z - z) < 1.1);
      for (const sx of sides) {
        for (const [ox, oz] of [[1.8, 0], [1.4, 0.9], [1.4, -0.9], [0.2, 1.8], [0.2, -1.8]]) {
          const x = B.x + sx * ox, z = B.z + oz;
          if (!this.nav.isBlocked(x, z) && !crowded(x, z)) return { x, z };
        }
      }
      return this.nav.nearestFree(B.x + sides[0] * 1.8, B.z);
    }

    // Moves a Mii by (sx, sz) unless that would walk into something. If the
    // way ahead is blocked, it slides along the obstacle instead of stopping.
    tryMove(w, sx, sz) {
      const nav = this.nav, pad = window.MiiNav.MOVE_PAD;
      // already a bit inside something (e.g. pushed there)? then any move is fine: it gets out
      if (nav.isBlocked(w.x, w.z, pad)) { w.x += sx; w.z += sz; return true; }
      const ok = (x, z) => !nav.isBlocked(x, z, pad);
      if (ok(w.x + sx, w.z + sz)) { w.x += sx; w.z += sz; return true; }
      const len = Math.hypot(sx, sz);
      if (len < 1e-6) return false;
      // slide: try turning a little left or right of the way we wanted to go
      for (const a of [0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
        const c = Math.cos(a), s = Math.sin(a);
        const k = Math.cos(a) * 0.9; // sliding is a bit slower
        const nx = (sx * c - sz * s) * k, nz = (sx * s + sz * c) * k;
        if (ok(w.x + nx, w.z + nz)) { w.x += nx; w.z += nz; return true; }
      }
      return false;
    }

    // Walks a Mii along its planned route.
    // Returns "walking", "arrived", or "lost" (stuck and can't find a way).
    followPath(w, dt) {
      if (!w.path || !w.path.length) return "arrived";
      if (w.yieldTime > 0) {
        // letting someone pass
        w.yieldTime = Math.max(0, w.yieldTime - dt);
        w.curSpeed *= Math.max(0, 1 - dt * 8);
        return "walking";
      }
      const nav = this.nav;
      // Smooth corners: if we can already see the point after the next one, head there.
      w.skipCheckIn = (w.skipCheckIn || 0) - dt;
      if (w.path.length > 1 && w.skipCheckIn <= 0) {
        w.skipCheckIn = 0.25;
        if (nav.clearLine(w.x, w.z, w.path[1].x, w.path[1].z)) { w.path.shift(); w.bestDist = Infinity; }
      }
      const next = w.path[0];
      const last = w.path.length === 1;
      const d = Math.hypot(next.x - w.x, next.z - w.z);
      // pass corners loosely (rounds them off), stop exactly at the end
      // (or nearly there but someone's standing right on the spot: close enough)
      if (d < (last ? 0.12 : 0.4) || (last && d < 1.0 && w.stuckTime > 0.5)) {
        w.path.shift();
        w.bestDist = Infinity;
        return w.path.length ? "walking" : "arrived";
      }
      // If another Mii nudged us off our route, the straight line to the next
      // point might now go through something: if so, plan a new route.
      w.lineCheckIn = (w.lineCheckIn || 0) - dt;
      if (w.lineCheckIn <= 0) {
        w.lineCheckIn = 0.25;
        if (!nav.clearLine(w.x, w.z, next.x, next.z, this.standingMiis(w), window.MiiNav.MOVE_PAD)) {
          // re-plan once; if the new route still isn't clear, carry on carefully
          // (sliding along things, and the stuck check below)
          if (!w.justReplanned) {
            w.justReplanned = true;
            const goal = w.path[w.path.length - 1];
            const path = nav.findPath(w.x, w.z, goal.x, goal.z, this.standingMiis(w));
            if (!path) return "lost";
            w.path = path;
            return "walking";
          }
        } else {
          w.justReplanned = false;
        }
      }
      this.stepToward(w, next.x, next.z, dt, last);
      // Hardly moved for a while (wedged between someone and something)?
      // Plan a new route that goes around EVERY Mii nearby, even walking ones.
      w.stallIn = (w.stallIn === undefined ? 0.8 : w.stallIn) - dt;
      if (w.stallIn <= 0) {
        const moved = w.stallFrom ? Math.hypot(w.x - w.stallFrom.x, w.z - w.stallFrom.z) : 1;
        w.stallFrom = { x: w.x, z: w.z };
        w.stallIn = 0.8;
        if (moved < 0.15) {
          const goal = w.path[w.path.length - 1];
          const everyone = this.active().filter((o) => o !== w && o !== w.partner).map((o) => ({ x: o.x, z: o.z, r: 0.75 }));
          const path = nav.findPath(w.x, w.z, goal.x, goal.z, everyone);
          w.stalls = (w.stalls || 0) + 1;
          if (!path || w.stalls > 4) { w.stalls = 0; return "lost"; }
          w.path = path;
          w.bestDist = Infinity;
          return "walking";
        }
        w.stalls = 0;
      }
      // stuck check: if we haven't got any closer for a while, plan a new route
      if (d < w.bestDist - 0.05) { w.bestDist = d; w.stuckTime = 0; }
      else w.stuckTime = (w.stuckTime || 0) + dt;
      if (w.stuckTime > 1.0) {
        w.repaths = (w.repaths || 0) + 1;
        w.stuckTime = 0;
        w.bestDist = Infinity;
        if (w.repaths > 3) return "lost";
        const goal = w.path[w.path.length - 1];
        const path = nav.findPath(w.x, w.z, goal.x, goal.z, this.standingMiis(w));
        if (!path) return "lost";
        w.path = path;
      }
      return "walking";
    }

    // Takes one step towards (tx, tz): speeds up, slows down for sharp turns and
    // at the end, and turns smoothly instead of snapping round.
    stepToward(w, tx, tz, dt, last) {
      const dx = tx - w.x, dz = tz - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001) return;
      const want = Math.atan2(dx, dz);
      if (w.moveYaw === null) w.moveYaw = w.yaw;
      w.moveYaw = turnToward(w.moveYaw, want, dt * 7);
      const off = Math.abs(angleDiff(w.moveYaw, want));
      const top = w.speed * (this.world.floaty ? 0.6 : 1);
      let target = top * clamp(1.15 - off / 1.4, 0.15, 1);
      if (last) target *= clamp(d / 1.1, 0.22, 1); // (slowing down gently at the end)
      // speed up gently, slow down a bit faster
      w.curSpeed += (target - w.curSpeed) * ease(dt, target > w.curSpeed ? 3.5 : 7);
      const step = Math.min(d, w.curSpeed * dt);
      // close to the end: go straight there; otherwise follow our (smoothly turning) heading
      const dir = last && d < 0.6 ? want : w.moveYaw;
      const before = { x: w.x, z: w.z };
      this.tryMove(w, Math.sin(dir) * step, Math.cos(dir) * step);
      const moved = Math.hypot(w.x - before.x, w.z - before.z);
      if (moved < step * 0.3) w.curSpeed *= 0.7; // bumped into something
      w.targetYaw = w.moveYaw;
      // the legs keep time with how far the Mii actually moved (no sliding feet)
      w.phase += moved * Math.PI / (w.inst.rig.stepLength(w.style) * w.sizeScale);
    }

    // Runs a conversation one step at a time (the "A" Mii is in charge).
    runScript(A, dt) {
      const B = A.partner;
      if (!B || !A.plan) { this.endInteraction(A); return; }
      A.stepTimer -= dt;
      if (A.stepTimer > 0) return;
      const remote = A.remote;
      const baseArms = remote === "phone" ? "phone" : "down";
      for (const m of [A, B]) { m.arms = baseArms; m.dance = false; m.laugh = false; m.sleep = false; m.nod = 0; m.shake = 0; }
      A.step++;
      const step = A.plan.steps[A.step];
      if (!step) { this.finishInteraction(A); return; }
      const actors = step.who === "both" ? [A, B] : step.who === "A" ? [A] : [B];
      const floaty = this.world.floaty;
      // {A} is always the Mii who started the chat and {B} the other one,
      // no matter who is speaking (so B says "Hi Joe! I'm Sam!", not the other way round)
      let line = step.say ? step.say.replace(/\{A\}/g, A.look.name).replace(/\{B\}/g, B.look.name) : null;
      for (const m of actors) {
        if (line) m.say(line, Math.max(step.dur + 0.4, 1.4));
        if (step.emote) m.showEmote(step.emote, Math.max(step.dur, 1.5));
        if (step.arms && remote !== "phone") m.arms = step.arms;
        if (step.hop) m.hop(floaty ? 1.8 : 4.5);
        if (step.dance) m.dance = true;
        if (step.sleep) { m.sleep = true; }
        if (step.moonJump) m.hop(floaty ? 3.2 : 6.5);
        // expressions are shown with head movements
        if (step.expr === "laugh") m.laugh = true;
        if (step.expr === "sad") m.nod = 0.35;
        if (step.expr === "angry") m.shake = 1;
        if (step.expr === "surprised") m.hop(floaty ? 1 : 2.5);
      }
      A.stepTimer = step.dur;
    }

    // Landing from a jump (or a drop): a little squash, more the faster it came down.
    landed(w) {
      if (w.liftVel < -1.5) w.squashVel -= Math.min(2.8, -w.liftVel * 0.4);
    }

    // Turns a Mii towards `goal` the way a person would: easing into the turn and out
    // of it again, never faster than maxSpeed (radians a second).
    turnBody(w, goal, dt, rate, maxSpeed) {
      const steps = Math.max(1, Math.ceil(dt * 120)); // (small steps, so it's the same at any frame rate)
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        w.yawVel += (rate * rate * angleDiff(w.yaw, goal) - 2 * rate * w.yawVel) * h;
        w.yawVel = clamp(w.yawVel, -maxSpeed, maxSpeed);
        w.yaw += w.yawVel * h;
      }
    }

    // Where the Mii's head looks, on top of where its body faces: at whoever it's
    // talking to, and now and then at you, or just around.
    updateLook(w, dt, lying) {
      let goal = 0, up = 0;
      const p = w.partner;
      w.lookIn -= dt;
      if (lying || w.sleep || w.held || w.dance || w.state === "photo" || w.state === "perform" || w.state === "guest") {
        w.lookMode = "ahead";
      } else if (p && !p.ghost && (w.state === "interact" || w.state === "waiting" || w.state === "approach")) {
        // whoever they're talking to (with a glance at you now and then)
        if (w.lookIn <= 0) { w.lookMode = Math.random() < 0.25 ? "cam" : "partner"; w.lookIn = w.lookMode === "cam" ? rnd(0.8, 1.6) : rnd(2.5, 5); }
        if (w.lookMode === "cam") { goal = angleDiff(w.yaw, this.viewYaw(w)); up = 0.1; }
        else goal = angleDiff(w.yaw, Math.atan2(p.x - w.x, p.z - w.z));
      } else {
        if (w.lookIn <= 0) {
          const moving = w.state === "walk" || w.state === "approach";
          const r = Math.random();
          w.lookMode = r < (moving ? 0.12 : 0.3) ? "cam" : r < (moving ? 0.3 : 0.6) ? "around" : "ahead";
          w.lookAround = rnd(-0.8, 0.8);
          w.lookIn = w.lookMode === "ahead" ? rnd(2, 5) : rnd(1, 2.6);
        }
        if (w.lookMode === "cam") { goal = angleDiff(w.yaw, this.viewYaw(w)); up = 0.1; }
        else if (w.lookMode === "around") goal = w.lookAround;
      }
      // (a head only turns so far: anything further round, it just looks ahead)
      if (Math.abs(goal) > 1.6) goal = 0;
      goal = clamp(goal, -0.85, 0.85);
      w.lookYaw += (goal - w.lookYaw) * ease(dt, 5);
      w.lookUp += (up - w.lookUp) * ease(dt, 4);
    }

    // Copies the Mii's position and movement onto its 3D model.
    applyPose(w, dt) {
      const holder = w.inst.holder;
      const rig = w.inst.rig;
      const st = w.style;
      const reduce = reducedMotion();
      const moving = (w.state === "walk" || w.state === "approach") && !w.held;
      const moonwalk = w.state === "perform" && w.performKind === "moonwalk";

      // getting on / off a seat, bed or treadmill
      const wanted = w.state === "activity" && w.anchor && !w.held;
      if (wanted) w.lastAnchor = w.anchor;
      if (w.held) w.seatBlend = 0;
      w.seatBlend = clamp(w.seatBlend + (wanted ? dt : -dt) * 2.2, 0, 1);
      const anchor = w.seatBlend > 0 ? w.lastAnchor : null;
      const k = anchor ? smooth(w.seatBlend) : 0;

      // turning: eases into the turn and out of it (on a seat or bed the Mii keeps
      // facing the same way: no spinning round on a bench)
      let yaw = w.targetYaw;
      if (anchor) yaw = anchor.kind === "lie" ? (anchor.at.yaw || 0) + Math.PI : anchor.yaw; // lying: head on the pillow
      this.turnBody(w, yaw, dt, moving ? 13 : anchor ? 8 : 9, moving ? 12 : 8);

      // turning round on the spot: little steps, so the feet don't slide round
      const shuffle = !moving && !anchor && !w.held && w.state !== "perform" ? clamp((Math.abs(w.yawVel) - 1) * 0.15, 0, 0.4) : 0;
      if (shuffle > 0) w.phase += dt * Math.abs(w.yawVel) * 1.6;
      const target = moonwalk ? 0.8 : moving ? clamp(w.curSpeed / Math.max(0.3, w.speed * 0.55), 0, 1) : shuffle;
      w.walkAmt += (target - w.walkAmt) * ease(dt, 8);
      if (!moving) { w.curSpeed = 0; w.moveYaw = null; }

      let px = w.x, pz = w.z, py = 0, tip = 0;
      if (anchor) {
        const at = anchor.at;
        let ax = at.x, az = at.z;
        if (anchor.kind === "lie") {
          // feet at one end of the bed, head on the pillow
          const len = MII_HEIGHT * w.sizeScale * 0.5;
          ax -= Math.sin(at.yaw || 0) * len;
          az -= Math.cos(at.yaw || 0) * len;
          tip = -Math.PI / 2 * k;
          // rest on the mattress (the big head sinks into the pillow a little)
          py = ((at.y || 0) + (M.lieDepth(w.inst) - 0.03) * w.sizeScale) * k + Math.sin(k * Math.PI) * 0.3;
        } else {
          py = (at.y || 0) * k;
        }
        px = w.x + (ax - w.x) * k;
        pz = w.z + (az - w.z) * k;
      }
      const running = anchor && anchor.kind === "stand" && w.spot && w.spot.run && wanted;
      if (running) w.phase += dt * 8.5;

      // models without leg bones (e.g. head-only exports) hop along instead of walking
      const hopY = !rig.hasLegs && !rig.mixer ? Math.abs(Math.sin(w.phase)) * 0.22 * w.walkAmt : 0;
      holder.rotation.y = w.yaw + (w.shake ? Math.sin(this.time * 20) * 0.04 : 0);
      // a backflip: one full turn while in the air
      if (w.flipT !== undefined && w.flipT !== null) {
        w.flipT += dt / 0.75;
        if (w.flipT >= 1) w.flipT = null;
        else tip -= Math.PI * 2 * smooth(w.flipT);
      }
      holder.rotation.x = tip;
      holder.rotation.z = !rig.hasLegs ? Math.sin(w.phase) * 0.08 * w.walkAmt : 0;
      if (w.state === "photo" && w.photo && w.photo.lean) holder.rotation.z -= w.photo.lean * 0.2; // leaning in for a picture

      // squash and stretch: stretching up while flying through the air, squashing on landing
      // (a springy wobble, from the feet up)
      const air = !anchor && !w.held && !reduce && w.lift > this.baseLift(w) + 0.03 ? Math.min(0.07, Math.abs(w.liftVel) * 0.013) : 0;
      if (reduce) { w.squash = 0; w.squashVel = 0; }
      else {
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        for (let i = 0; i < steps; i++) {
          w.squashVel += (420 * (air - w.squash) - 13 * w.squashVel) * h;
          w.squash += w.squashVel * h;
        }
        w.squash = clamp(w.squash, -0.2, 0.15);
      }
      const pop = w.appear < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - w.appear, 3)) : 1;
      const gone = w.vanish > 0 ? 1 - smooth(w.vanish) : 1;
      const size = w.sizeScale * pop * Math.max(0.01, gone);
      const sy = 1 + w.squash * (1 - k), sxz = 1 / Math.sqrt(sy);
      holder.scale.set(size * sxz, size * sy, size * sxz);

      if (w.phone) w.phone.visible = w.arms === "phone" && !w.held;
      // sitting/lying legs and arms blend in while the Mii gets on (and out while it gets off)
      const on = w.seatBlend > (wanted ? 0.15 : 0.85);
      const sitting = anchor && anchor.kind === "sit" && on;
      const lying = anchor && anchor.kind === "lie" && on;
      this.updateLook(w, dt, lying);
      // blinking now and then (sometimes twice), eyes shut when asleep
      w.blinkIn -= dt;
      if (w.blinkIn <= 0) { w.blinkT = 0.13; w.blinkIn = Math.random() < 0.18 ? 0.3 : rnd(2, 6); }
      if (w.blinkT > 0) w.blinkT -= dt;
      if (M.setEyesClosed) M.setEyesClosed(w.inst, w.sleep || lying || (w.blinkT > 0 && !w.held && w.state !== "photo"));
      rig.pose({
        t: this.time + (w.id.length % 7) * 0.37,
        dt,
        smooth: true,
        walk: running ? 1 : w.walkAmt,
        run: running,
        phase: w.phase,
        arms: w.held ? "held" : w.arms,
        held: w.held,
        dance: w.dance,
        laugh: w.laugh,
        style: st,
        talking: !!w.bubble,
        nod: (w.sleep && !lying ? 0.45 + Math.sin(this.time * 2) * 0.05 : 0) + (w.nod || 0) + (w.bow ? 0.35 : 0),
        bow: !!w.bow,
        lookYaw: (w.shake ? Math.sin(this.time * 14) * 0.4 : 0) + w.lookYaw,
        lookUp: (w.state === "activity" && w.spot && w.spot.lookUp ? w.spot.lookUp : 0) + w.lookUp,
        sit: sitting,
        legsOut: sitting && anchor.at.legs === "out",
        lie: lying,
      });
      holder.position.set(px, w.lift + (w.rareLift || 0) + py + hopY - (anchor ? 0 : rig.drop * w.sizeScale), pz);
    }

    // ---------- floating text over each Mii ----------
    updateOverlay() {
      const v = overlayHead, feetV = overlayFeet;
      const placed = [];
      const now = performance.now();
      const odt = Math.min(0.1, (now - (this.overlayAt || now)) / 1000);
      this.overlayAt = now;
      this.overlayFrame = (this.overlayFrame || 0) + 1;
      // front-most Miis first, so bubbles behind them move up out of the way
      const sorted = this.active().concat(this.guests).sort((a, b) => b.z - a.z);
      for (const w of sorted) {
        const s = w.inst.holder.scale.y;
        const lying = w.lastAnchor && w.lastAnchor.kind === "lie" && w.seatBlend > 0.5;
        const pos = w.inst.holder.position;
        v.set(pos.x, (lying ? pos.y + 0.6 : w.lift + (MII_HEIGHT + (this.world.helmet ? 0.25 : 0.05)) * s), pos.z).project(this.camera);
        const visible = v.z < 1;
        const x = (v.x * 0.5 + 0.5) * this.W;
        let y = (-v.y * 0.5 + 0.5) * this.H;
        w.ui.style.display = visible ? "" : "none";
        if (!visible) continue;
        // feet position for the name tag
        const feet = feetV.set(pos.x, 0, pos.z).project(this.camera);
        w.uiName.style.transform = "translate(-50%, " + ((-feet.y * 0.5 + 0.5) * this.H - y + 6) + "px)";
        w.uiName.classList.toggle("show", this.hover === w || this.dragging === w);

        if (w.bubble) {
          // (its size is measured once per line: reading it every frame makes the page lay itself out again and again)
          const key = w.uiBubble.className + "|" + w.bubble.text;
          if (w.uiBubbleKey !== key || !w.uiBubbleW) { w.uiBubbleKey = key; w.uiBubbleW = w.uiBubble.offsetWidth; w.uiBubbleH = w.uiBubble.offsetHeight; }
          const bw = w.uiBubbleW, bh = w.uiBubbleH;
          let bx = clamp(x - bw / 2, 4, this.W - bw - 4);
          const by0 = y - bh - 12 - (w.remote === "phone" ? 24 : 0); // leave room for the "📱 Mia" tag
          let by = by0;
          for (let tries = 0; tries < 6; tries++) {
            const hit = placed.find((r) => bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h + 6 && by + bh + 6 > r.y);
            if (!hit) break;
            by = hit.y - bh - 8;
          }
          by = Math.max(4, by);
          placed.push({ x: bx, y: by, w: bw, h: bh });
          // moving up out of another bubble's way (or back down): it slides there instead of jumping
          const lift = by - by0;
          w.bubbleLift = w.bubbleFrame === this.overlayFrame - 1 && !reducedMotion() ? w.bubbleLift + (lift - w.bubbleLift) * ease(odt, 14) : lift;
          w.bubbleFrame = this.overlayFrame;
          w.uiBubble.style.left = bx - x + "px";
          w.uiBubble.style.top = by0 + w.bubbleLift - y + "px";
          w.uiBubble.style.setProperty("--tail", clamp(x - bx, 14, bw - 14) + "px");
        }
        const wish = this.wishIconFor ? this.wishIconFor(w.record) : null;
        if (w.uiWishIcon !== wish) {
          w.uiWishIcon = wish;
          w.uiWish.textContent = wish ? "💭" + wish : "";
          w.uiWish.classList.toggle("show", !!wish);
        }
        w.ui.style.transform = "translate(" + x + "px," + y + "px)";
      }
    }

    // ---------- clicking & dragging ----------
    pointerRay(e) {
      const r = this.canvas.getBoundingClientRect();
      pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(pointerNdc, this.camera);
      return this.raycaster.ray;
    }

    // Finds the Mii under the pointer by treating each Mii as an upright capsule.
    pickWalker(ray) {
      let best = null, bestDist = Infinity;
      const a = pickA, b = pickB, onRay = pickOnRay, onSeg = pickOnSeg;
      for (const w of this.active()) {
        if (w.vanish > 0) continue;
        const s = w.inst.holder.scale.y;
        const pos = w.inst.holder.position;
        const lying = w.lastAnchor && w.lastAnchor.kind === "lie" && w.seatBlend > 0.5;
        if (lying) {
          // lying down: a capsule along the bed
          const at = w.lastAnchor.at, h = MII_HEIGHT * s;
          a.set(pos.x, pos.y, pos.z);
          b.set(pos.x + Math.sin(at.yaw || 0) * h, pos.y, pos.z + Math.cos(at.yaw || 0) * h);
        } else {
          a.set(pos.x, pos.y + 0.1 * s, pos.z);
          b.set(pos.x, pos.y + MII_HEIGHT * s, pos.z);
        }
        const dist2 = ray.distanceSqToSegment(a, b, onRay, onSeg);
        const radius = (lying ? 0.55 : onSeg.y - pos.y > 0.9 * s ? 0.6 : 0.4) * s;
        if (dist2 < radius * radius) {
          const along = onRay.distanceTo(ray.origin);
          if (along < bestDist) { bestDist = along; best = w; }
        }
      }
      return best;
    }

    groundPoint(ray) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const p = new THREE.Vector3();
      return ray.intersectPlane(plane, p) ? p : null;
    }

    // You clicked a Mii (left button): it jumps and says hi. (Right-click opens its menu.)
    poke(w) {
      if (this.onPoke) this.onPoke(w);
      if (!w.anchored && w.state !== "playing") {
        w.hop(this.world.floaty ? 1.6 : 4);
        w.targetYaw = this.viewYaw(w);
      }
      if (!this.isBusy(w) || w.state === "perform") {
        const line = this.visiting && this.onHomeTalk ? this.onHomeTalk(w, "poke") : D.pick(D.CLICK_LINES);
        w.say(line, 2);
        if (!w.anchored || (w.lastAnchor && w.lastAnchor.kind === "sit")) {
          w.arms = "wave";
          this.later(w, 1.5, () => { if (w.arms === "wave" && !w.partner) w.arms = (w.state === "activity" && w.spot && w.spot.arms) || "down"; });
        }
      }
    }

    bindPointer() {
      const c = this.canvas;
      let down = null;

      c.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // right-click opens the menu instead (see "contextmenu")
        if (this.flight) return;    // (nothing to grab while flying)
        const w = this.pickWalker(this.pointerRay(e));
        down = { x: e.clientX, y: e.clientY, w };
        if (w) {
          this.controls.enabled = false; // don't spin the camera while grabbing a Mii
          c.setPointerCapture(e.pointerId);
        }
      });

      c.addEventListener("pointermove", (e) => {
        if (down && down.w && !this.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 && down.w.state !== "playing") {
          const w = down.w;
          this.endInteraction(w);
          w.spot = null; w.anchor = null; w.seatBlend = 0; w.clearEmote();
          w.sleep = false; w.arms = "down";
          w.state = "idle";
          w.held = true;
          this.dragging = w;
          w.say(D.pick(D.PICKUP_LINES), 1.5);
        }
        if (this.dragging) {
          const w = this.dragging;
          const p = this.groundPoint(this.pointerRay(e));
          if (p) {
            const b = this.world.bounds;
            w.x = clamp(p.x, b.minX, b.maxX);
            w.z = clamp(p.z, b.minZ, b.maxZ + 1);
          }
          w.lift = 1.4 + Math.sin(this.time * 4) * 0.08;
          w.liftVel = 0;
          w.targetYaw = this.viewYaw(w);
        } else if (!down && !this.flight) {
          this.hoverAt = { clientX: e.clientX, clientY: e.clientY }; // (looked at once a frame, see beforeRender)
        }
      });

      const release = (e) => {
        if (this.dragging) {
          const w = this.dragging;
          w.held = false;
          w.liftVel = 0;
          w.timer = rnd(1, 2);
          this.dragging = null;
          if (this.nav.isBlocked(w.x, w.z)) {
            // dropped somewhere a Mii can't stand (in the pond, on a desk...): climb out
            const inWater = (this.world.water || []).some((o) => window.MiiNav.insideShape(o, w.x, w.z, 0));
            const out = this.nav.nearestFree(w.x, w.z);
            w.path = [out];
            w.target = out;
            w.state = "walk";
            w.resetStuck();
            this.later(w, 0.35, () => w.say(inWater ? D.pick(["Splash! I'm soaked!", "Brr, cold water!", "I can't swim!"]) : D.pick(["Whoops!", "Oof, not here!"]), 1.8));
          } else {
            this.later(w, 0.35, () => w.say(D.pick(D.DROP_LINES), 1.6));
          }
        } else if (down && down.w && e.type === "pointerup") {
          this.poke(down.w);
        } else if (down && !down.w && e.type === "pointerup" && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
          // clicked the scenery: something rare going by, or an apartment?
          if (this.world.rare && this.world.rare.pick && this.world.rare.pick(this.pointerRay(e))) { /* handled */ }
          else if (this.world.pickApartment && this.onApartmentClick) {
            const id = this.world.pickApartment(this.pointerRay(e));
            if (id) this.onApartmentClick(id, e.clientX, e.clientY);
          }
        }
        down = null;
        this.controls.enabled = !this.flight;
      };
      c.addEventListener("pointerup", release);
      c.addEventListener("pointercancel", release);
      c.addEventListener("pointerleave", () => { this.hoverAt = null; if (!this.dragging) this.hover = null; });
      // zooming with the wheel eases in (see stepCamera) instead of jumping
      // (caught on the way down to the 3D view, before the camera controls see it)
      if (c.parentElement) c.parentElement.addEventListener("wheel", (e) => {
        if (e.target !== c || !this.controls.enabled || this.flight) return;
        e.preventDefault();
        e.stopPropagation();
        this.zoomBy(e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1));
      }, { capture: true, passive: false });
      // double-click a Mii: the camera glides over to it; double-click the scenery: back to the whole place
      c.addEventListener("dblclick", (e) => {
        if (this.flight || this.dragging) return;
        const w = this.pickWalker(this.pointerRay(e));
        if (w) this.focusWalker(w);
        else this.resetView();
      });
      // right-click a Mii to open its menu
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (this.flight) return;
        const w = this.pickWalker(this.pointerRay(e));
        if (w && this.onSelect) this.onSelect(w, e.clientX, e.clientY);
      });
    }

    // ---------- group photo ----------
    // While you're setting up a group picture, the Miis here stay put (nobody wanders off or
    // leaves for somewhere else) until the picture is taken or you close the picker.
    holdForPhoto(list) {
      this.releasePhotoHold();
      this.photoHeld = list.slice();
      for (const w of this.photoHeld) {
        w.photoHold = true;
        if (w.state === "idle" || w.state === "walk") { w.path = null; w.target = null; w.state = "photo"; w.photo = null; }
      }
    }
    releasePhotoHold() {
      for (const w of this.photoHeld || []) {
        w.photoHold = false;
        if (w.state === "photo" && !w.photo) { w.state = "idle"; w.timer = rnd(1, 2.5); }
      }
      this.photoHeld = null;
    }
    // Lines the Miis up (left to right, in list order) in front of the camera, each in
    // its pose, frames them and takes the picture. poses: id -> { arms, bow, lean, face }
    // (lean / face: -1 = toward the Mii on the left, 1 = toward the one on the right).
    // opts.jump = everyone jumps for the picture.
    // Resolves with { url (PNG data URL), width, height, heads: [{ id, x, y }] (0..1 on the picture) }.
    takePhoto(list, poses, opts) {
      opts = opts || {};
      this.finishFlight();
      this.endGlide();
      const n = list.length;
      const scale = Math.max(...list.map((w) => w.sizeScale || 1));
      const gap = 1.3 * scale;
      // flat directions from the camera: forward, and left-to-right
      const fwd = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const slots = (c) => list.map((w, i) => ({ x: c.x + right.x * (i - (n - 1) / 2) * gap, z: c.z + right.z * (i - (n - 1) / 2) * gap }));
      // how far back the camera goes to fit everyone in
      const height = MII_HEIGHT * scale;
      const vfov = (this.camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      const halfW = ((n - 1) * gap) / 2 + 1.1 * scale;
      const dist = Math.max(halfW / Math.tan(hfov / 2), (height * 0.72) / Math.tan(vfov / 2), 4) * 1.12;
      // somewhere open: in the middle of the view if possible, with nothing (a tree, a lamp...)
      // between the camera and anyone in the picture
      const mid = { x: list.reduce((s, w) => s + w.x, 0) / n, z: list.reduce((s, w) => s + w.z, 0) / n };
      const tries = [{ x: this.controls.target.x, z: this.controls.target.z }, mid];
      for (let i = 0; i < 80; i++) tries.push(this.nav.randomFree());
      const inView = (s) => s.every((p) => this.nav.clearLine(p.x, p.z, p.x - fwd.x * dist * 0.9, p.z - fwd.z * dist * 0.9, null, 0.5));
      let spots = null, fallback = null;
      for (const c of tries) {
        const s = slots(c);
        if (s.some((p) => this.nav.isBlocked(p.x, p.z, 0.45))) continue;
        if (!fallback && this.nav.clearLine(c.x, c.z, c.x - fwd.x * 6, c.z - fwd.z * 6, null, 0.3)) fallback = s;
        if (!inView(s)) continue;
        spots = s;
        break;
      }
      if (!spots) spots = fallback || slots(mid).map((p) => this.nav.nearestFree(p.x, p.z));
      const center = { x: (spots[0].x + spots[n - 1].x) / 2, z: (spots[0].z + spots[n - 1].z) / 2 };

      // the camera: low and close, the whole group in the picture
      const saved = {
        pos: this.camera.position.clone(), target: this.controls.target.clone(),
        min: this.controls.minDistance, max: this.controls.maxDistance,
        minAz: this.controls.minAzimuthAngle, maxAz: this.controls.maxAzimuthAngle, enabled: this.controls.enabled,
        timeScale: this.timeScale,
      };
      this.timeScale = 1; // (normal speed while posing, so the jump is caught at the top)
      const lift = this.baseLift({ x: center.x });
      const target = new THREE.Vector3(center.x, lift + height * 0.5, center.z);
      const el = 0.16;
      Object.assign(this.controls, { minDistance: 0.5, maxDistance: 500, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, enabled: false });
      // (the camera glides down into place while everyone gets ready)
      this.glideCamera(new THREE.Vector3(target.x - fwd.x * dist * Math.cos(el), target.y + dist * Math.sin(el), target.z - fwd.z * dist * Math.cos(el)), target, 0.65);

      // everyone into place, facing the camera
      list.forEach((w, i) => {
        const pose = poses[w.id] || {};
        this.endInteraction(w);
        if (this.dragging === w) this.dragging = null;
        w.held = false; w.spot = null; w.anchor = null; w.lastAnchor = null; w.seatBlend = 0; w.path = null; w.target = null;
        w.dance = false; w.sleep = false; w.laugh = false; w.nod = 0; w.shake = 0;
        w.clearEmote();
        w.x = spots[i].x; w.z = spots[i].z;
        w.state = "photo";
        w.photo = pose;
        w.arms = pose.arms || "down";
        w.bow = !!pose.bow;
        w.yaw = w.targetYaw = this.viewYaw(w) + (pose.face || 0) * 0.65;
        w.yawVel = 0; w.lookYaw = 0; w.squash = 0; w.squashVel = 0; w.walkAmt = 0;
        w.inst.rig.poseKey = null; // (straight into the pose, no blending: the picture is taken soon)
      });
      const release = () => {
        for (const w of list) {
          if (w.state !== "photo") continue;
          w.state = "idle"; w.timer = rnd(1.5, 3); w.photo = null; w.arms = "down"; w.bow = false;
        }
        this.timeScale = saved.timeScale;
        // glide back to where the camera was, then the usual limits apply again
        this.glideCamera(saved.pos, saved.target, 0.8, null, () => {
          Object.assign(this.controls, { minDistance: saved.min, maxDistance: saved.max, minAzimuthAngle: saved.minAz, maxAzimuthAngle: saved.maxAz, enabled: saved.enabled });
          this.controls.update();
        });
      };
      return new Promise((resolve, reject) => {
        // give them a moment to settle (and jump, if they're jumping)
        if (opts.jump) setTimeout(() => list.forEach((w) => w.hop(this.world.floaty ? 2.6 : 5.5)), 750);
        setTimeout(() => {
          try {
            // a sharper picture than the screen: render it bigger for a moment
            this.endGlide(); // (in place, even on a slow computer)
            const pr = this.renderer.getPixelRatio();
            const big = Math.max(pr, Math.min(2.5, 2400 / this.W));
            this.renderer.setPixelRatio(big);
            this.renderer.setSize(this.W, this.H, false);
            // only the Miis in the picture (nobody wandering in front or photobombing)
            const others = this.walkers.filter((w) => !list.includes(w) && w.inst.holder.visible);
            for (const w of others) w.inst.holder.visible = false;
            this.renderer.shadowMap.needsUpdate = true;
            this.renderer.render(this.scene, this.camera);
            for (const w of others) w.inst.holder.visible = true;
            const url = this.canvas.toDataURL("image/png");
            const width = this.canvas.width, height2 = this.canvas.height;
            // where everyone's head and feet are in the picture (for framing, and little stickers on it)
            const at = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(this.camera); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }; };
            const heads = list.map((w) => Object.assign({ id: w.id, feet: at(w.x, w.lift, w.z) }, at(w.x, w.lift + height * 1.02, w.z)));
            this.renderer.setPixelRatio(pr);
            this.renderer.setSize(this.W, this.H, false);
            release();
            resolve({ url, width, height: height2, heads });
          } catch (err) {
            release();
            reject(err);
          }
        }, opts.jump ? 750 + Math.round((this.world.floaty ? 2.6 / 3 : 5.5 / 22) * 1000) : 1000);
      });
    }

    // ---------- graphics quality (see QUALITY_LEVELS at the top) ----------
    // mode: "auto" | "high" | "medium" | "low"
    setQuality(mode) {
      this.qualityMode = QUALITY_LEVELS[mode] ? mode : "auto";
      const auto = this.qualityMode === "auto";
      // (auto: rung = where it is on AUTO_LADDER; a rung that was too slow isn't tried again for a while)
      this.autoQ = auto ? { rung: this.autoQ ? this.autoQ.rung : 0, samples: [], windowAt: 0, quick: 0, notBefore: [], wait: 20 } : null;
      this.applyQuality(auto ? AUTO_LADDER[this.autoQ.rung] : QUALITY_LEVELS[mode]);
    }
    // What Auto settled on right now ("high" / "medium" / "low"), or the chosen level.
    qualityNow() { return this.quality ? this.quality.name : "high"; }
    applyQuality(q) {
      const old = this.quality;
      this.quality = q;
      this.fxScale = q.fx;
      const pr = Math.min(window.devicePixelRatio || 1, q.pr);
      if (this.renderer.getPixelRatio() !== pr) {
        this.renderer.setPixelRatio(pr);
        if (this.W) this.renderer.setSize(this.W, this.H, false);
      }
      const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      if (this.renderer.shadowMap.type !== type) {
        this.renderer.shadowMap.type = type;
        // (soft or plain shadow edges are part of every material's shader)
        this.scene.traverse((o) => {
          if (!o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
        });
      }
      this.qualityWorld = null; // (the place on screen gets the new shadows, see beforeRender)
      this.shadowTick = 0;
      this.renderer.shadowMap.needsUpdate = true;
      if (old && old.name !== q.name && this.onQuality) this.onQuality(q.name);
    }
    // The sun's shadows (and how round the far-away puffs are) for a place, at the current quality.
    // Every light remembers how it was built, so going back up to High restores it.
    qualityFor(root) {
      const q = this.quality, G = window.World3D.kit.G;
      const farGeo = G[q.farSphere]();
      const hiSphere = G.sphere();
      root.traverse((o) => {
        if (o.isLight && o.shadow) {
          const u = o.userData;
          if (u.qCast === undefined) { u.qCast = o.castShadow; u.qSize = o.shadow.mapSize.x; }
          if (!u.qCast) return;
          o.castShadow = q.shadows;
          const size = Math.min(u.qSize, q.shadowSize);
          if (o.shadow.mapSize.x !== size) {
            o.shadow.mapSize.set(size, size);
            if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
          }
        } else if (o.userData.qDetail) {
          o.visible = q.detail !== false; // (optional extras: left out at Low)
        } else if (o.isInstancedMesh && !o.frustumCulled && (o.geometry === hiSphere || o.userData.qSphere)) {
          // far-away scenery made of lots of round puffs: they're tiny on screen anyway
          if (!o.userData.qSphere) o.userData.qSphere = true;
          o.geometry = farGeo;
        }
      });
    }
    // Every frame, just before drawing.
    beforeRender(real) {
      if (this.qualityWorld !== this.world && this.world) {
        this.qualityWorld = this.world;
        this.qualityFor(this.world.group);
        this.qualityFor(this.planet.group);
        this.renderer.shadowMap.needsUpdate = true;
      }
      // the shadows: redrawn every frame at High, less often lower down (always while flying)
      if (this.flight || ++this.shadowTick >= this.quality.shadowEvery) {
        this.shadowTick = 0;
        this.renderer.shadowMap.needsUpdate = true;
      }
      // the Mii under the pointer (looked for once a frame, not on every mouse move)
      if (this.hoverAt) {
        const e = this.hoverAt;
        this.hoverAt = null;
        if (!this.dragging && !this.flight) {
          this.hover = this.pickWalker(this.pointerRay(e));
          this.canvas.style.cursor = this.hover ? "grab" : "";
        }
      }
      if (this.autoQ && (!this.quality.cap || document.hasFocus())) this.autoQuality(real); // (not while held to 30 a second)
    }
    // Auto: every 2 seconds, looks at a typical frame (the middle one, so one slow
    // moment like building a place doesn't count) and moves one rung if needed.
    autoQuality(real) {
      const a = this.autoQ;
      if (real <= 0 || real >= 0.2) return; // (a hiccup, or the window was hidden)
      a.samples.push(real * 1000);
      a.windowAt += real;
      if (a.windowAt < 2) return;
      const s = a.samples.sort((x, y) => x - y), mid = s[s.length >> 1];
      a.samples = []; a.windowAt = 0;
      if (a.settle) { a.settle = false; return; } // (the first moments after a change are uneven)
      let rung = a.rung;
      if (mid > AUTO_SLOW_MS && rung < AUTO_LADDER.length - 1) {
        rung++;
        // (don't try the faster rung again for a while, and longer each time it fails)
        a.notBefore[rung - 1] = this.time + a.wait;
        a.wait = Math.min(600, a.wait * 2);
        a.quick = 0;
      } else if (mid < AUTO_QUICK_MS && rung > 0) {
        if (++a.quick >= 4 && !(this.time < (a.notBefore[rung - 1] || 0))) { rung--; a.quick = 0; }
      } else a.quick = 0;
      if (rung === a.rung) return;
      a.rung = rung;
      a.settle = true;
      this.applyQuality(AUTO_LADDER[rung]);
    }
    // While the window isn't the one in front (Medium/Low/Auto): 30 frames a second is plenty.
    skipFrame(now) {
      if (!this.quality.cap || document.hasFocus()) return false;
      if (now - (this.lastDrawn || 0) < 1000 / 31) return true;
      this.lastDrawn = now;
      return false;
    }

    // ---------- main loop ----------
    // timeScale (Settings: simulation speed) runs the world several steps per frame
    start() {
      let last = performance.now();
      const frame = (now) => {
        // nothing to draw while the window is hidden or minimized (and no catching up after)
        if (document.hidden || this.skipFrame(now)) {
          if (document.hidden) last = now;
          requestAnimationFrame(frame);
          return;
        }
        const real = Math.min(0.25, (now - last) / 1000); // (flights go by the clock, even on a slow computer)
        const dt = Math.min(0.05, real);
        last = now;
        if (!this.paused) { // (paused while you play Paintball)
          const steps = Math.max(1, Math.round(this.timeScale || 1));
          for (let i = 0; i < steps; i++) this.update(dt);
          if (this.flight) this.stepFlight(real);
          else { this.stepCamera(real); this.controls.update(); }
          this.traffic.update(dt);
          this.beforeRender(real);
          this.renderer.render(this.scene, this.camera);
          if (!this.flight) this.updateOverlay();
          // build the places you haven't been to yet, one now and then
          this.prebuildIn -= real;
          if (this.prebuildIn <= 0) { this.prebuildIn = 2.5; this.prebuildNext(); }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
  }

  window.MiiHub3D = { Hub3D, animStyle };
})();
