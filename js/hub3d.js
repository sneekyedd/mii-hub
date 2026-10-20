/*
 * hub3d.js
 * The 3D hub: moves the Miis around, makes them talk and hang out,
 * and handles the camera, clicking and dragging. It also runs home visits
 * (the inside of one Mii's apartment) and hands out the Miis' coins.
 */
(function () {
  "use strict";

  const THREE = window.THREE;
  const D = window.Dialogue;
  const M = window.MiiModel;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (k) => k * k * (3 - 2 * k);
  const MII_HEIGHT = 1.8;

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
      this.bubble = { text, time: 0, dur: dur || Math.max(2, text.length * 0.07) };
      this.uiBubble.textContent = text;
      this.uiBubble.classList.remove("show", "shout", "phone-voice");
      void this.uiBubble.offsetWidth; // restart the pop-in animation
      this.uiBubble.classList.add("show");
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

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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

      this.miiGroup = new THREE.Group();
      this.scene.add(this.miiGroup);

      this.raycaster = new THREE.Raycaster();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      this.bindPointer();
    }

    // The Miis you can see right now (only the resident while visiting a home).
    active() { return this.visiting ? (this.visiting.empty ? [] : [this.visiting.walker]) : this.walkers; }

    // ---------- setup ----------
    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(200, rect.width), h = Math.max(200, rect.height);
      this.W = w; this.H = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.fitCamera();
    }

    // Move the camera back far enough that the whole area fits on screen.
    fitCamera() {
      if (!this.world) return;
      const b = this.world.bounds;
      const halfW = (b.maxX - b.minX) / 2 + 2;
      const vfov = (this.camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      // the front of the area is closer than the middle, so we don't need the full width
      // (a home is a small room seen from close by, so it needs the full width)
      const dist = clamp((halfW / Math.tan(hfov / 2)) * (this.world.isHome ? 1.05 : 0.8), 17, 30);
      const ty = this.world.cameraTargetY || 1;
      const dir = new THREE.Vector3(0, this.world.cameraTilt || 0.55, 1).normalize();
      // in a home, the decorating panel covers the left of the view, so look a bit
      // further left (which moves the room to the right on screen)
      const tx = this.world.isHome ? -2.6 : 0;
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
      this.controls.update();
    }

    // Shows a place (already built) and lets Miis find their way around it.
    useWorld(world) {
      this.world = world;
      this.nav = new window.MiiNav.Nav(world.bounds, world.obstacles);
      this.scene.add(world.group);
      this.scene.background = new THREE.Color(world.background);
      this.scene.fog = world.fog ? new THREE.Fog(...world.fog) : null;
      if (world.setResidents) world.setResidents(this.residents);
      this.fitCamera();
    }

    // Shows another place. The Miis that were on screen stay where they were
    // (they live their own lives, see town.js); the ones in the new place appear.
    setScene(id) {
      if (this.visiting) this.leaveHome();
      if (this.world && this.world.id === id) return;
      for (const w of this.walkers.slice()) if (w.leaving) this.finishLeaving(w);
      // (phone calls carry on: they belong to both Miis, not to the place on screen)
      for (const w of this.walkers) { if (!this.calls.has(w.id)) this.endInteraction(w); w.remove(); }
      this.walkers = [];
      this.dragging = null; this.hover = null;
      this.clearWindowMiis();
      if (this.world) {
        this.scene.remove(this.world.group);
        window.World3D.dispose(this.world);
      }
      this.useWorld(window.World3D.build(id, { residents: this.residents.length }));
      if (this.onSceneChange) this.onSceneChange(id);
      this.onChange();
    }

    // ---------- Miis you can see through their windows (in the Apartments) ----------
    clearWindowMiis() {
      for (const m of this.windowMiis.values()) {
        this.scene.remove(m.inst.holder);
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
          this.scene.remove(m.inst.holder); M.disposeObject(m.inst.holder); m = null;
        }
        if (!m) {
          const inst = M.createInstance(r.template, r.look || {});
          inst.holder.rotation.order = "YXZ";
          const s = (0.9 + clamp(r.template.info.height, 0, 127) / 127 * 0.2) * 1.3;
          inst.holder.scale.setScalar(s);
          this.scene.add(inst.holder);
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
        this.scene.remove(m.inst.holder); M.disposeObject(m.inst.holder);
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
          inst.holder.rotation.order = "YXZ";
          inst.holder.scale.setScalar(1.05);
          inst.holder.position.set(spot.x, spot.y, spot.z);
          inst.holder.rotation.set(0, spot.yaw || 0, 0);
          spot.parent.add(inst.holder);
          world.ridersMade.push({ inst, t0: Math.random() * 10 });
        }
      }
      for (const r of world.ridersMade) {
        const t = this.time + r.t0;
        // sitting on the saddle, legs going round (pedalling), hands on the handlebars
        r.inst.rig.pose({ t, dt, arms: "type", sit: true, walk: 0.6, phase: t * 7, legsOut: true });
      }
    }

    // Which floor a Mii's flat is on (4 flats per floor, in order of who moved in first).
    floorOf(id) {
      const i = this.residents.findIndex((r) => r.id === id);
      return i < 0 ? 1 : Math.floor(i / 4);
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
      const before = this.world.capacity;
      const cam = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.scene.remove(this.world.group);
      window.World3D.dispose(this.world);
      this.useWorld(window.World3D.build("apartments", { residents: this.residents.length }));
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
      const c = this.camera.position;
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
      if (this.visiting) w.ui.style.display = "none";
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
      const lines = to === "home"
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
      if (this.dragging) { this.dragging.held = false; this.dragging = null; }
      this.hover = null;
      if (!empty && this.calls.has(record.id)) this.endCall(this.calls.get(record.id), record.id); // you're here: they hang up
      this.mainWorld = this.world;
      this.mainNav = this.nav;
      this.mainCamera = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.scene.remove(this.world.group);
      this.clearWindowMiis();
      this.miiGroup.visible = false;
      for (const w of this.walkers) w.ui.style.display = "none";
      this.useWorld(window.World3D.build("home", { record, floor: this.floorOf(record.id) }));
      this.homeGroup = new THREE.Group();
      this.scene.add(this.homeGroup);
      const v = new Walker(this, record, template, look, this.homeGroup);
      const start = this.world.playerSpot ? this.nav.nearestFree(this.world.playerSpot.x, this.world.playerSpot.z) : this.nav.randomFree();
      v.x = start.x; v.z = start.z;
      v.yaw = v.targetYaw = this.viewYaw(v);
      v.timer = rnd(3, 5);
      this.visiting = { record, walker: v, empty };
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
      const v = this.visiting.walker;
      v.remove();
      this.scene.remove(this.homeGroup);
      this.scene.remove(this.world.group);
      window.World3D.dispose(this.world);
      this.visiting = null;
      this.useWorld(this.mainWorld);
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
      }
      this.miiGroup.visible = true;
      for (const w of this.walkers) w.ui.style.display = "";
      if (this.onLeftHome) this.onLeftHome();
      this.onChange();
    }

    // Rebuilds the room after you change the furniture.
    refreshHome() {
      if (!this.visiting) return;
      const v = this.visiting.walker;
      const cam = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.scene.remove(this.world.group);
      window.World3D.dispose(this.world);
      this.useWorld(window.World3D.build("home", { record: this.visiting.record, floor: this.floorOf(this.visiting.record.id) }));
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
      return this.calls.has(w.id) || w.held || w.leaving || w.state === "interact" || w.state === "approach" || w.state === "waiting" || w.state === "perform" || w.state === "playing";
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
      const feed = (fight ? "{A} and {B} had a fight! 💢" : D.FEED_TEXT[type]).replace("{A}", A.look.name).replace("{B}", B.look.name).replace(/\.$/, "") + " on the phone. 📱";
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
      let feed = D.FEED_TEXT[type].replace("{A}", A.look.name).replace("{B}", B.look.name).replace(/\.$/, "");
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
      let feed = (fight ? "{A} and {B} had a fight! 💢" : D.FEED_TEXT[type]).replace("{A}", A.look.name).replace("{B}", B.look.name);
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
      this.world.update(this.time, this.camera);
      if (this.onTick) this.onTick(dt);
      if (this.world.windowSpot || this.windowMiis.size) this.syncWindowMiis(dt);
      if (this.world.riders) this.syncRiders(dt);
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
      if (last) target *= clamp(d / 0.9, 0.35, 1);
      // speed up gently, slow down a bit faster
      w.curSpeed += (target - w.curSpeed) * Math.min(1, dt * (target > w.curSpeed ? 3.5 : 7));
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

    // Copies the Mii's position and movement onto its 3D model.
    applyPose(w, dt) {
      const holder = w.inst.holder;
      const rig = w.inst.rig;
      const st = w.style;
      const moving = (w.state === "walk" || w.state === "approach") && !w.held;
      const moonwalk = w.state === "perform" && w.performKind === "moonwalk";
      const target = moonwalk ? 0.8 : moving ? clamp(w.curSpeed / Math.max(0.3, w.speed * 0.55), 0, 1) : 0;
      w.walkAmt += (target - w.walkAmt) * Math.min(1, dt * 8);
      if (!moving) { w.curSpeed = 0; w.moveYaw = null; }

      // getting on / off a seat, bed or treadmill
      const wanted = w.state === "activity" && w.anchor && !w.held;
      if (wanted) w.lastAnchor = w.anchor;
      if (w.held) w.seatBlend = 0;
      w.seatBlend = clamp(w.seatBlend + (wanted ? dt : -dt) * 2.2, 0, 1);
      const anchor = w.seatBlend > 0 ? w.lastAnchor : null;
      const k = anchor ? smooth(w.seatBlend) : 0;

      // on a seat or bed the Mii keeps facing the same way (no spinning round on a bench)
      let yaw = w.targetYaw;
      if (anchor) yaw = anchor.kind === "lie" ? (anchor.at.yaw || 0) + Math.PI : anchor.yaw; // lying: head on the pillow
      w.yaw = turnToward(w.yaw, anchor ? yaw : w.targetYaw, dt * (anchor ? 6 : 8));
      if (w.shake) w.yaw += Math.sin(this.time * 20) * 0.04;

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
      holder.rotation.y = w.yaw;
      // a backflip: one full turn while in the air
      if (w.flipT !== undefined && w.flipT !== null) {
        w.flipT += dt / 0.75;
        if (w.flipT >= 1) w.flipT = null;
        else tip -= Math.PI * 2 * smooth(w.flipT);
      }
      holder.rotation.x = tip;
      holder.rotation.z = !rig.hasLegs ? Math.sin(w.phase) * 0.08 * w.walkAmt : 0;
      const pop = w.appear < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - w.appear, 3)) : 1;
      const gone = w.vanish > 0 ? 1 - smooth(w.vanish) : 1;
      holder.scale.setScalar(w.sizeScale * pop * Math.max(0.01, gone));

      if (w.phone) w.phone.visible = w.arms === "phone" && !w.held;
      const sitting = anchor && anchor.kind === "sit" && w.seatBlend > 0.5;
      const lying = anchor && anchor.kind === "lie" && w.seatBlend > 0.5;
      if (M.setEyesClosed) M.setEyesClosed(w.inst, w.sleep || lying); // asleep (or dozing): eyes shut
      rig.pose({
        t: this.time + (w.id.length % 7) * 0.37,
        dt,
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
        lookYaw: w.shake ? Math.sin(this.time * 14) * 0.4 : 0,
        lookUp: w.state === "activity" && w.spot && w.spot.lookUp ? w.spot.lookUp : 0,
        sit: sitting,
        legsOut: sitting && anchor.at.legs === "out",
        lie: lying,
      });
      holder.position.set(px, w.lift + py + hopY - (anchor ? 0 : rig.drop * w.sizeScale), pz);
    }

    // ---------- floating text over each Mii ----------
    updateOverlay() {
      const v = new THREE.Vector3();
      const placed = [];
      // front-most Miis first, so bubbles behind them move up out of the way
      const sorted = this.active().slice().sort((a, b) => b.z - a.z);
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
        const feet = new THREE.Vector3(pos.x, 0, pos.z).project(this.camera);
        w.uiName.style.transform = "translate(-50%, " + ((-feet.y * 0.5 + 0.5) * this.H - y + 6) + "px)";
        w.uiName.classList.toggle("show", this.hover === w || this.dragging === w);

        if (w.bubble) {
          const bw = w.uiBubble.offsetWidth, bh = w.uiBubble.offsetHeight;
          let bx = clamp(x - bw / 2, 4, this.W - bw - 4);
          let by = y - bh - 12 - (w.remote === "phone" ? 24 : 0); // leave room for the "📱 Mia" tag
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
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      return this.raycaster.ray;
    }

    // Finds the Mii under the pointer by treating each Mii as an upright capsule.
    pickWalker(ray) {
      let best = null, bestDist = Infinity;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), onRay = new THREE.Vector3(), onSeg = new THREE.Vector3();
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
        } else if (!down) {
          this.hover = this.pickWalker(this.pointerRay(e));
          c.style.cursor = this.hover ? "grab" : "";
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
          // clicked the scenery: an apartment, maybe?
          if (this.world.pickApartment && this.onApartmentClick) {
            const id = this.world.pickApartment(this.pointerRay(e));
            if (id) this.onApartmentClick(id, e.clientX, e.clientY);
          }
        }
        down = null;
        this.controls.enabled = true;
      };
      c.addEventListener("pointerup", release);
      c.addEventListener("pointercancel", release);
      c.addEventListener("pointerleave", () => { if (!this.dragging) this.hover = null; });
      // right-click a Mii to open its menu
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const w = this.pickWalker(this.pointerRay(e));
        if (w && this.onSelect) this.onSelect(w, e.clientX, e.clientY);
      });
    }

    // ---------- main loop ----------
    start() {
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!this.paused) { // (paused while you play Paintball)
          this.update(dt);
          this.controls.update();
          this.renderer.render(this.scene, this.camera);
          this.updateOverlay();
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
  }

  window.MiiHub3D = { Hub3D, animStyle };
})();
