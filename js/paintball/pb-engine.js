/*
 * paintball/pb-engine.js
 * The rules of Paintball (no drawing here): how players move, how the gun and
 * the butterfly knife work, hit boxes, and the Mii opponent's brain.
 *
 * Movement and shooting copy Counter-Strike: Global Offensive:
 *   - Source-engine movement: ground friction + acceleration, air strafing,
 *     walking (Shift) and crouching (Ctrl/C) speeds, the same jump height.
 *   - AK-47 numbers: 600 shots a minute, 36 damage, x4 for a headshot (one
 *     shot kills), 30-round magazine, 2.43 s reload, and the CS:GO accuracy
 *     model: standing still your first shots go where you aim, running makes
 *     you very inaccurate, and holding the trigger follows the AK's famous
 *     "up, then left, then right" spray pattern.
 *   - Knife: light slash (left click) and heavy stab (right click), with big
 *     backstab damage, and you run faster with it out.
 *
 * Units: 1 = one meter. CS:GO works in inches ("units"), so U converts them.
 * This file is only loaded when you start Paintball (see app.js).
 */
(function (root) {
  "use strict";

  const U = 0.0254;            // one CS unit in meters
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------------
  // Numbers (from CS:GO, converted to meters)
  // ---------------------------------------------------------------------
  const CFG = {
    speedAK: 215 * U,          // 5.46 m/s with the AK out
    speedKnife: 250 * U,       // 6.35 m/s with the knife out
    accelerate: 5.5,           // sv_accelerate
    airAccelerate: 12,         // sv_airaccelerate
    friction: 5.2,             // sv_friction
    stopSpeed: 80 * U,         // sv_stopspeed
    airCap: 30 * U,            // the most speed you can add in the air in one go (air strafing)
    gravity: 800 * U,          // sv_gravity
    jump: Math.sqrt(2 * 800 * U * 1.72), // jump impulse: a 1.72 m jump (higher than CS, because the map is 1.25x bigger: you can still crouch-jump from a barrel onto a container)
    walk: 0.52,                // Shift
    duck: 0.34,                // crouched
    duckRate: 6,               // how fast you crouch / stand up (per second)
    radius: 0.41,              // a player is 32 units wide
    standH: 2.05,              // a Mii is a bit taller than a CS player (big head!)
    duckH: 1.5,
    eyeStand: 1.55,
    eyeDuck: 1.12,
    step: 0.46,                // 18 units: you walk up steps this high
    footstepSpeed: 0.53,       // above this fraction of top speed you make footstep sounds
  };

  const AK = {
    id: "ak", name: "Paint AK", speed: 215,
    damage: 36, rangeMod: 0.98, cycle: 0.1, mag: 30, reserve: 90, reload: 2.43, deploy: 1.0,
    spread: 0.0006, stand: 0.00641, crouch: 0.00481, move: 0.17506, air: 0.13536, land: 0.03,
    fire: 0.0078, recoverStand: 0.368, recoverCrouch: 0.305,
  };
  // The AWP (CS:GO numbers): one shot to the head/chest/stomach, a bolt to work
  // between shots, hopeless without the scope, pin-point with it (standing still).
  const AWP = {
    id: "awp", name: "Paint AWP", speed: 200,
    damage: 115, rangeMod: 0.99, cycle: 1.455, mag: 10, reserve: 30, reload: 3.67, deploy: 1.1,
    spread: 0.0002, stand: 0.08, crouch: 0.06, move: 0.17, air: 0.4, land: 0.12,
    fire: 0.05, recoverStand: 0.25, recoverCrouch: 0.2,
    // scoped: zoom 1 and 2 (CS field of view 40 and 10), slower and far more accurate
    scoped: { stand: 0.002, crouch: 0.0015, speed: 100 },
    zoomFov: [90, 40, 10],
    kick: 3.2, // degrees the shot throws your aim up
  };
  // The Desert Eagle (CS:GO numbers): a sidearm in both classes. One click, one shot
  // (semi-automatic). The first shot is dead on when you're still and give it a moment;
  // spamming it or moving throws it everywhere. One headshot splats a Mii up close.
  const DEAGLE = {
    id: "deagle", name: "Paint Deagle", speed: 230, semi: true, pistol: true,
    damage: 63, rangeMod: 0.81, cycle: 0.225, mag: 7, reserve: 35, reload: 2.2, deploy: 1.0,
    spread: 0.002, stand: 0.0074, crouch: 0.0049, move: 0.34, air: 0.4, land: 0.1,
    fire: 0.065, recoverStand: 0.81, recoverCrouch: 0.6,
    kick: 2.6,
  };
  const WEAPONS = { ak: AK, awp: AWP, deagle: DEAGLE };
  const KNIFE = {
    deploy: 1.0,
    slash: { first: 40, next: 25, back: 90, range: 1.35, miss: 0.4, hit: 0.5 },
    stab: { damage: 65, back: 180, range: 1.05, miss: 1.0, hit: 1.1 },
  };
  const ZONE_MULT = { head: 4, chest: 1, arm: 1, stomach: 1.25, leg: 0.75 };
  // the classes you can pick before spawning
  const LOADOUTS = {
    ak: { id: "ak", name: "Rifler", primary: "ak", secondary: "deagle", desc: "Paint AK + Deagle + Butterfly Knife" },
    awp: { id: "awp", name: "Sniper", primary: "awp", secondary: "deagle", desc: "Paint AWP + Deagle + Butterfly Knife" },
  };

  // The AK spray pattern: where bullet N goes, in degrees away from where you
  // aimed (x = right, y = up). Up for the first ~9, then left, right, left...
  const PATTERN = [
    [0, 0], [0.05, 0.25], [-0.1, 0.9], [0.15, 1.9], [0.35, 3.0], [0.2, 4.2], [-0.1, 5.3], [-0.55, 6.3],
    [-1.25, 7.1], [-2.2, 7.7], [-3.2, 8.1], [-3.9, 8.4], [-4.3, 8.6], [-3.6, 8.7], [-2.4, 8.7],
    [-1.0, 8.8], [0.4, 9.0], [1.6, 9.1], [2.6, 9.1], [3.3, 9.2], [3.0, 9.4], [2.0, 9.5], [0.8, 9.6],
    [-0.4, 9.6], [-1.2, 9.7], [-0.6, 9.9], [0.6, 10.0], [1.6, 10.0], [2.4, 10.1], [2.9, 10.1],
  ];

  // ---------------------------------------------------------------------
  // The world: boxes and drums you bump into and paintballs splat on
  // (boxes can be turned: rot is the same as object.rotation.y)
  // ---------------------------------------------------------------------
  class World {
    constructor(map) {
      this.boxes = map.boxes.map((b) => Object.assign({}, b, { c: Math.cos(b.rot || 0), s: Math.sin(b.rot || 0) }));
      this.cyls = map.cyls.slice();
      this.bounds = map.bounds;
    }
    // world x/z -> the box's own x/z
    local(b, x, z) {
      const dx = x - b.x, dz = z - b.z;
      return [dx * b.c - dz * b.s, dx * b.s + dz * b.c];
    }
    worldDir(b, lx, lz) { return [lx * b.c + lz * b.s, -lx * b.s + lz * b.c]; }

    circleHitsBox(b, x, z, r) {
      const [lx, lz] = this.local(b, x, z);
      const dx = lx - clamp(lx, -b.hw, b.hw), dz = lz - clamp(lz, -b.hd, b.hd);
      return dx * dx + dz * dz < r * r;
    }

    // the highest floor (box or drum top) under a circle, no higher than `limit`
    groundAt(x, z, r, limit) {
      let g = 0;
      for (const b of this.boxes) if (b.y1 <= limit && b.y1 > g && this.circleHitsBox(b, x, z, r)) g = b.y1;
      for (const c of this.cyls) {
        if (c.y1 > limit || c.y1 <= g) continue;
        const dx = x - c.x, dz = z - c.z, rr = r + c.r;
        if (dx * dx + dz * dz < rr * rr) g = c.y1;
      }
      return g;
    }
    // the lowest ceiling above `from` over a circle
    ceilingAt(x, z, r, from) {
      let h = Infinity;
      for (const b of this.boxes) if (b.y0 >= from - 0.02 && b.y0 < h && this.circleHitsBox(b, x, z, r)) h = b.y0;
      for (const c of this.cyls) {
        if (c.y0 < from - 0.02 || c.y0 >= h) continue;
        const dx = x - c.x, dz = z - c.z, rr = r + c.r;
        if (dx * dx + dz * dz < rr * rr) h = c.y0;
      }
      return h;
    }

    // push a standing circle (feet at y, height h) out of everything it overlaps
    // that's taller than `lift` above its feet. Changes pos and slides vel along walls.
    pushOut(pos, vel, r, h, lift) {
      let hit = false;
      for (let it = 0; it < 3; it++) {
        let moved = false;
        for (const b of this.boxes) {
          if (b.y1 <= pos.y + lift || b.y0 >= pos.y + h - 0.01) continue;
          const [lx, lz] = this.local(b, pos.x, pos.z);
          if (Math.abs(lx) > b.hw + r || Math.abs(lz) > b.hd + r) continue;
          const px = clamp(lx, -b.hw, b.hw), pz = clamp(lz, -b.hd, b.hd);
          let dx = lx - px, dz = lz - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let nx, nz, pen;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d; nz = dz / d; pen = r - d;
          } else {
            // the center is inside: leave by the nearest side
            const ox = b.hw - Math.abs(lx), oz = b.hd - Math.abs(lz);
            if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; pen = ox + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = oz + r; }
          }
          const [wx, wz] = this.worldDir(b, nx, nz);
          pos.x += wx * pen; pos.z += wz * pen;
          const vn = vel.x * wx + vel.z * wz;
          if (vn < 0) { vel.x -= wx * vn; vel.z -= wz * vn; }
          moved = hit = true;
        }
        for (const c of this.cyls) {
          if (c.y1 <= pos.y + lift || c.y0 >= pos.y + h - 0.01) continue;
          const dx = pos.x - c.x, dz = pos.z - c.z, rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 1e-5;
          const nx = dx / d, nz = dz / d;
          pos.x += nx * (rr - d); pos.z += nz * (rr - d);
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; }
          moved = hit = true;
        }
        if (!moved) break;
      }
      const B = this.bounds;
      if (pos.x < B.minX + r) { pos.x = B.minX + r; vel.x = Math.max(0, vel.x); }
      if (pos.x > B.maxX - r) { pos.x = B.maxX - r; vel.x = Math.min(0, vel.x); }
      if (pos.z < B.minZ + r) { pos.z = B.minZ + r; vel.z = Math.max(0, vel.z); }
      if (pos.z > B.maxZ - r) { pos.z = B.maxZ - r; vel.z = Math.min(0, vel.z); }
      return hit;
    }

    // Ray against the world. o, d = {x,y,z} (d normalised). Returns { t, nx, ny, nz, mat } or null.
    ray(o, d, maxT) {
      let best = maxT, hit = null;
      // the ground
      if (d.y < -1e-6) {
        const t = -o.y / d.y;
        if (t > 0 && t < best) { best = t; hit = { t, nx: 0, ny: 1, nz: 0, mat: "ground" }; }
      }
      for (const b of this.boxes) {
        const [lx, lz] = this.local(b, o.x, o.z);
        const dlx = d.x * b.c - d.z * b.s, dlz = d.x * b.s + d.z * b.c;
        let t0 = -Infinity, t1 = Infinity, axis = -1, sign = 0;
        const slabs = [[lx, dlx, -b.hw, b.hw], [o.y, d.y, b.y0, b.y1], [lz, dlz, -b.hd, b.hd]];
        let miss = false;
        for (let i = 0; i < 3; i++) {
          const [p, v, lo, hi] = slabs[i];
          if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) { miss = true; break; } continue; }
          let ta = (lo - p) / v, tb = (hi - p) / v, sg = -1;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
          if (ta > t0) { t0 = ta; axis = i; sign = sg; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) { miss = true; break; }
        }
        if (miss || t1 < 0 || t0 < 0 || t0 >= best) continue;
        best = t0;
        let nx = 0, ny = 0, nz = 0;
        if (axis === 1) ny = sign;
        else {
          const [wx, wz] = this.worldDir(b, axis === 0 ? sign : 0, axis === 2 ? sign : 0);
          nx = wx; nz = wz;
        }
        hit = { t: t0, nx, ny, nz, mat: b.mat || "metal" };
      }
      for (const c of this.cyls) {
        const ox = o.x - c.x, oz = o.z - c.z;
        const a = d.x * d.x + d.z * d.z;
        let t = -1, nx = 0, ny = 0, nz = 0;
        if (a > 1e-9) {
          const bq = ox * d.x + oz * d.z, cq = ox * ox + oz * oz - c.r * c.r;
          const h = bq * bq - a * cq;
          if (h >= 0) {
            const ts = (-bq - Math.sqrt(h)) / a;
            const y = o.y + d.y * ts;
            if (ts > 0 && y >= c.y0 && y <= c.y1) { t = ts; nx = (ox + d.x * ts) / c.r; nz = (oz + d.z * ts) / c.r; }
          }
        }
        if (d.y < -1e-6) { // the lid
          const ts = (c.y1 - o.y) / d.y;
          if (ts > 0 && (t < 0 || ts < t)) {
            const px = ox + d.x * ts, pz = oz + d.z * ts;
            if (px * px + pz * pz <= c.r * c.r) { t = ts; nx = 0; ny = 1; nz = 0; }
          }
        }
        if (t > 0 && t < best) { best = t; hit = { t, nx, ny, nz, mat: c.mat || "metal" }; }
      }
      return hit;
    }

    // can a straight line from a to b get through? (for the bot's eyes)
    clear(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) return true;
      const h = this.ray(a, { x: dx / len, y: dy / len, z: dz / len }, len);
      return !h || h.t >= len - 0.02;
    }
  }

  // ---------------------------------------------------------------------
  // Movement (Source engine style), shared by you and the Mii
  // ---------------------------------------------------------------------
  class Mover {
    constructor(world) {
      this.world = world;
      this.pos = { x: 0, y: 0, z: 0 }; // feet
      this.vel = { x: 0, y: 0, z: 0 };
      this.onGround = true;
      this.duck = 0;          // 0 = standing, 1 = fully crouched
      this.stamina = 0;       // landing/jumping slows you down for a moment (no bunny-hopping forever)
      this.events = [];       // "jump", "land" (with speed), "step" (when footsteps should sound)
      this.stepDist = 0;
      this.eyeSmooth = 0;     // smooths the camera when you walk up a step
    }
    height() { return lerp(CFG.standH, CFG.duckH, this.duck); }
    eye() { return lerp(CFG.eyeStand, CFG.eyeDuck, this.duck) + this.eyeSmooth; }
    speed2d() { return Math.hypot(this.vel.x, this.vel.z); }
    place(x, z) {
      this.pos.x = x; this.pos.z = z; this.pos.y = 0;
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.onGround = true; this.duck = 0; this.stamina = 0; this.eyeSmooth = 0;
    }

    /*
     * input = { fwd: -1..1, side: -1..1 (right +), yaw, walk, duck, jump (pressed this tick), maxSpeed, frozen }
     */
    step(dt, inp) {
      const W = this.world, p = this.pos, v = this.vel;
      this.events.length = 0;

      // ---- crouching ----
      const wantDuck = inp.duck ? 1 : 0;
      if (wantDuck !== this.duck) {
        const before = this.height();
        let nd = this.duck + Math.sign(wantDuck - this.duck) * CFG.duckRate * dt;
        nd = clamp(nd, 0, 1);
        if (nd < this.duck) {
          // standing up: is there room above?
          const hNew = lerp(CFG.standH, CFG.duckH, nd);
          const lift = this.onGround ? 0 : before - hNew; // in the air you stand up by lowering your feet
          const ceil = W.ceilingAt(p.x, p.z, CFG.radius * 0.95, p.y + before - 0.01);
          if (p.y + lift + hNew > ceil) nd = this.duck;
        }
        const hNew = lerp(CFG.standH, CFG.duckH, nd);
        if (!this.onGround) {
          // in the air, crouching pulls your legs up (a crouch-jump goes higher)
          p.y += before - hNew;
          if (p.y < 0) p.y = 0;
        }
        this.duck = nd;
      }

      // ---- what direction the keys point ----
      const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
      const fwd = inp.fwd || 0, side = inp.side || 0;
      let wx = -sy * fwd + cy * side;
      let wz = -cy * fwd - sy * side;
      const wl = Math.hypot(wx, wz);
      let wishSpeed = 0;
      if (wl > 1e-4 && !inp.frozen) {
        wx /= wl; wz /= wl;
        wishSpeed = inp.maxSpeed * Math.min(1, wl);
        if (inp.walk) wishSpeed *= CFG.walk;
        wishSpeed *= lerp(1, CFG.duck, this.duck);
      } else { wx = wz = 0; }

      // ---- jumping ----
      if (inp.jump && this.onGround && !inp.frozen) {
        v.y = CFG.jump * (1 - this.stamina);
        this.onGround = false;
        this.stamina = Math.min(0.3, this.stamina + 0.08);
        this.events.push({ type: "jump" });
      }

      if (this.onGround) {
        // friction
        const spd = Math.hypot(v.x, v.z);
        if (spd > 1e-4) {
          const control = Math.max(spd, CFG.stopSpeed);
          const ns = Math.max(0, spd - control * CFG.friction * dt);
          v.x *= ns / spd; v.z *= ns / spd;
        }
        // accelerate
        if (wishSpeed > 0) {
          const cur = v.x * wx + v.z * wz;
          const add = wishSpeed - cur;
          if (add > 0) {
            const acc = Math.min(add, CFG.accelerate * dt * wishSpeed);
            v.x += acc * wx; v.z += acc * wz;
          }
        }
        // still tired from the last jump
        if (this.stamina > 0) {
          const k = Math.pow(1 - this.stamina * 0.9, dt * 8);
          v.x *= k; v.z *= k;
        }
      } else if (wishSpeed > 0) {
        // air strafing: you can only add a little speed, but in any direction
        const ws = Math.min(wishSpeed, CFG.airCap);
        const cur = v.x * wx + v.z * wz;
        const add = ws - cur;
        if (add > 0) {
          const acc = Math.min(add, CFG.airAccelerate * wishSpeed * dt);
          v.x += acc * wx; v.z += acc * wz;
        }
      }
      this.stamina = Math.max(0, this.stamina - dt * 0.45);

      // ---- move sideways, bump into things ----
      const h = this.height();
      const ox = p.x, oz = p.z;
      p.x += v.x * dt; p.z += v.z * dt;
      W.pushOut(p, v, CFG.radius, h, this.onGround ? CFG.step : 0.02);

      // ---- up and down ----
      const wasGround = this.onGround;
      const prevY = p.y;
      if (!this.onGround) v.y -= CFG.gravity * dt;
      p.y += v.y * dt;
      const limit = Math.max(prevY, p.y) + (wasGround ? CFG.step : 0.02);
      const g = W.groundAt(p.x, p.z, CFG.radius * 0.9, limit);
      if (v.y <= 0 && p.y <= g + (wasGround ? CFG.step : 0)) {
        if (!wasGround) {
          this.events.push({ type: "land", speed: -v.y });
          const hard = clamp(-v.y / CFG.jump, 0, 1.5);
          v.x *= 1 - 0.12 * hard; v.z *= 1 - 0.12 * hard;
        }
        if (wasGround && g > prevY + 0.01) this.eyeSmooth -= g - prevY; // stepped up: smooth the camera
        p.y = g; v.y = 0; this.onGround = true;
      } else {
        this.onGround = false;
      }
      // bumping your head
      const ceil = W.ceilingAt(p.x, p.z, CFG.radius * 0.9, prevY + h);
      if (p.y + h > ceil) { p.y = Math.max(0, ceil - h); if (v.y > 0) v.y = 0; }

      this.eyeSmooth *= Math.exp(-dt * 14);

      // footsteps (only when running: walking with Shift is silent, like CS)
      if (this.onGround) {
        const moved = Math.hypot(p.x - ox, p.z - oz);
        const loud = this.speed2d() > inp.maxSpeed * CFG.footstepSpeed;
        this.stepDist += moved;
        if (this.stepDist > 1.55) { this.stepDist = 0; this.events.push({ type: "step", loud }); }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Aiming math
  // ---------------------------------------------------------------------
  // yaw 0 looks toward -Z; pitch up is positive
  function forward(yaw, pitch, out) {
    const cp = Math.cos(pitch);
    out = out || { x: 0, y: 0, z: 0 };
    out.x = -Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * cp;
    return out;
  }
  function anglesTo(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ---------------------------------------------------------------------
  // Hit boxes
  // ---------------------------------------------------------------------
  // Ray vs sphere: distance or -1
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const h = b * b - cc;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t > 0 ? t : -1;
  }
  // Ray vs capsule (a line from pa to pb, fattened by r): distance or -1
  function rayCapsule(o, d, pa, pb, r) {
    const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
    const oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
    const baba = bax * bax + bay * bay + baz * baz;
    const bard = bax * d.x + bay * d.y + baz * d.z;
    const baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = d.x * oax + d.y * oay + d.z * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const a = baba - bard * bard;
    let b = baba * rdoa - baoa * bard;
    let c = baba * oaoa - baoa * baoa - r * r * baba;
    let h = b * b - a * c;
    if (h >= 0 && Math.abs(a) > 1e-9) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (y > 0 && y < baba) return t > 0 ? t : -1;
      // the rounded ends
      const end = y <= 0 ? pa : pb;
      const ocx = o.x - end.x, ocy = o.y - end.y, ocz = o.z - end.z;
      b = d.x * ocx + d.y * ocy + d.z * ocz;
      c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      h = b * b - c;
      if (h > 0) { const t2 = -b - Math.sqrt(h); return t2 > 0 ? t2 : -1; }
      return -1;
    }
    // parallel to the capsule: just test the two ends
    const t1 = raySphere(o, d, pa, r), t2 = raySphere(o, d, pb, r);
    if (t1 < 0) return t2;
    if (t2 < 0) return t1;
    return Math.min(t1, t2);
  }
  // boxes = [{ zone, a, b?, r }] (sphere when there's no b). Returns { t, zone, box } or null.
  function rayHitboxes(o, d, boxes, maxT) {
    let best = null;
    for (const hb of boxes) {
      const t = hb.b ? rayCapsule(o, d, hb.a, hb.b, hb.r) : raySphere(o, d, hb.a, hb.r);
      if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, zone: hb.zone, box: hb };
    }
    return best;
  }

  // Hit boxes for someone we only know by position (you, in first person): the
  // same shape as a Mii (big head!), worked out from the eye height.
  function bodyBoxes(feet, eyeY, yaw, out) {
    const e = feet.y + eyeY;
    const fx = -Math.sin(yaw) * 0.03, fz = -Math.cos(yaw) * 0.03;
    const P = (dy, dx, dz) => ({ x: feet.x + (dx || 0), y: dy, z: feet.z + (dz || 0) });
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // to the right
    const legTop = Math.max(feet.y + 0.12, e - 1.0);
    out = out || [];
    out.length = 0;
    out.push({ zone: "head", a: P(e + 0.07, fx, fz), r: 0.4 });
    out.push({ zone: "chest", a: P(e - 0.64), b: P(e - 0.42), r: 0.21 });
    out.push({ zone: "stomach", a: P(Math.max(legTop, e - 0.94)), b: P(e - 0.64), r: 0.21 });
    out.push({ zone: "arm", a: P(e - 0.47, rx * 0.25, rz * 0.25), b: P(e - 0.6, rx * 0.25 + fx * 10, rz * 0.25 + fz * 10), r: 0.09 });
    out.push({ zone: "arm", a: P(e - 0.47, -rx * 0.25, -rz * 0.25), b: P(e - 0.6, -rx * 0.12 + fx * 14, -rz * 0.12 + fz * 14), r: 0.09 });
    out.push({ zone: "leg", a: P(feet.y + 0.08, rx * 0.1, rz * 0.1), b: P(legTop, rx * 0.1, rz * 0.1), r: 0.11 });
    out.push({ zone: "leg", a: P(feet.y + 0.08, -rx * 0.1, -rz * 0.1), b: P(legTop, -rx * 0.1, -rz * 0.1), r: 0.11 });
    return out;
  }

  // ---------------------------------------------------------------------
  // Weapons: the state of one player's AK and knife
  // ---------------------------------------------------------------------
  class Arms {
    constructor(primary) { this.reset(primary); }
    reset(primary) {
      this.primary = WEAPONS[primary] && primary !== "deagle" ? primary : (this.primary || "ak");
      this.secondary = "deagle";
      this.weapon = this.primary; this.last = "knife"; this.lastGun = this.primary;
      // each gun keeps its own ammo
      this.mags = {};
      for (const id of [this.primary, this.secondary]) this.mags[id] = { ammo: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      this.zoom = 0; this.resumeZoom = 0; // AWP scope: 0 = not scoped, 1, 2
      this.ready = 0;            // time when you can attack again
      this.reloadEnd = 0;        // time the reload finishes (0 = not reloading)
      this.firePenalty = 0; this.landPenalty = 0;
      this.recoilIdx = 0; this.recX = 0; this.recY = 0; this.recTX = 0; this.recTY = 0; this.lastShot = -9;
      this.lastSlash = -9; this.slashAlt = 0;
    }
    reloading(now) { return this.reloadEnd > 0 && now < this.reloadEnd; }
    // the gun in your hands (with the knife out: the last gun you held)
    gunId() { return this.weapon !== "knife" && WEAPONS[this.weapon] ? this.weapon : (this.lastGun || this.primary); }
    gun() { return WEAPONS[this.gunId()]; }
    get ammo() { const m = this.mags && this.mags[this.gunId()]; return m ? m.ammo : 0; }
    set ammo(v) { const m = this.mags && this.mags[this.gunId()]; if (m) m.ammo = v; }
    get reserve() { const m = this.mags && this.mags[this.gunId()]; return m ? m.reserve : 0; }
    set reserve(v) { const m = this.mags && this.mags[this.gunId()]; if (m) m.reserve = v; }
    // how fast you can run with what's in your hands
    maxSpeed() {
      if (this.weapon === "knife") return CFG.speedKnife;
      const W = this.gun();
      return (this.zoom > 0 && W.scoped ? W.scoped.speed : W.speed) * U;
    }
  }

  // How far off a shot can go right now (radians), CS:GO style
  function inaccuracy(m, arms) { const p = inaccuracyParts(m, arms); return p.base + p.move; }
  // base: standing/crouching + shooting + landing (shots bunch up near the middle, like CS)
  // move: running and being in the air (spread evenly over the whole circle, so moving shots really miss)
  function inaccuracyParts(m, arms) {
    const W = arms.gun();
    const sc = arms.zoom > 0 && W.scoped ? W.scoped : null;
    let v = m.duck > 0.5 ? (sc ? sc.crouch : W.crouch) : (sc ? sc.stand : W.stand);
    // moving faster than a third of your current top speed throws you off (like CS, the top speed
    // is the one you have right now: scoped in with the AWP that's only 100, so walking scoped is
    // already as bad as running)
    let mv = 0;
    const max = arms.maxSpeed(), acc = max * 0.34, spd = m.speed2d();
    if (spd > acc) mv += W.move * Math.pow(clamp((spd - acc) / (max * 0.95 - acc), 0, 1), 0.6);
    // in the air: very inaccurate, on top of any running
    if (!m.onGround) mv += W.air;
    return { base: v + arms.firePenalty + arms.landPenalty, move: mv };
  }

  // per tick: spread and recoil settle down
  function updateArms(arms, m, dt, now) {
    const W = arms.gun();
    const rec = m.duck > 0.5 ? W.recoverCrouch : W.recoverStand;
    arms.firePenalty *= Math.exp(-dt * 2.3026 / rec);
    arms.landPenalty *= Math.exp(-dt * 2.3026 / 0.3);
    if (now - arms.lastShot < Math.min(W.cycle, 0.12) + 0.02) {
      const k = 1 - Math.exp(-dt * 45);
      arms.recX += (arms.recTX - arms.recX) * k;
      arms.recY += (arms.recTY - arms.recY) * k;
    } else {
      // let go of the trigger: the gun settles back down
      const mag = Math.hypot(arms.recX, arms.recY);
      if (mag > 1e-4) {
        const nm = Math.max(0, mag * Math.exp(-dt * 7) - dt * 9);
        arms.recX *= nm / mag; arms.recY *= nm / mag;
      }
      arms.recoilIdx = Math.max(0, arms.recoilIdx - dt * 16);
      arms.recTX = arms.recX; arms.recTY = arms.recY;
    }
    if (arms.reloadEnd && now >= arms.reloadEnd) {
      const take = Math.min(W.mag - arms.ammo, arms.reserve);
      arms.ammo += take; arms.reserve -= take;
      arms.reloadEnd = 0;
      return "reloaded";
    }
    return null;
  }

  // Work out where a shot goes (direction), and kick the gun up for the next one.
  function shotDirection(f, now, rand) {
    rand = rand || Math.random;
    const a = f.arms;
    const parts = inaccuracyParts(f.mover, a);
    const yaw = f.yaw - a.recX * DEG, pitch = f.pitch + a.recY * DEG;
    const fw = forward(yaw, pitch);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const ux = Math.sin(yaw) * sp, uy = cp, uz = Math.cos(yaw) * sp;
    const r1 = rand() * parts.base, a1 = rand() * Math.PI * 2;
    const W = a.gun();
    const r2 = rand() * W.spread, a2 = rand() * Math.PI * 2;
    const r3 = Math.sqrt(rand()) * parts.move, a3 = rand() * Math.PI * 2;
    const ox = Math.cos(a1) * r1 + Math.cos(a2) * r2 + Math.cos(a3) * r3, oy = Math.sin(a1) * r1 + Math.sin(a2) * r2 + Math.sin(a3) * r3;
    const d = { x: fw.x + rx * ox + ux * oy, y: fw.y + uy * oy, z: fw.z + rz * ox + uz * oy };
    const l = Math.hypot(d.x, d.y, d.z);
    d.x /= l; d.y /= l; d.z /= l;
    if (W.kick) {
      // a big single kick (it settles long before the bolt is back)
      a.recTX = a.recX + (rand() - 0.5) * 0.8;
      a.recTY = a.recY + W.kick;
    } else {
      // recoil for the next bullet: the spray pattern
      const k = Math.min(PATTERN.length - 1, Math.floor(a.recoilIdx));
      const jit = 0.12 + k * 0.012;
      a.recTX = PATTERN[k][0] + (rand() - 0.5) * jit;
      a.recTY = PATTERN[k][1] + (rand() - 0.5) * jit * 0.5;
    }
    a.recoilIdx += 1;
    a.firePenalty += W.fire;
    a.lastShot = now;
    return d;
  }

  function damageFor(zone, dist, weapon) {
    const W = WEAPONS[weapon] || AK;
    const range = Math.pow(W.rangeMod, dist / U / 500);
    return Math.round(W.damage * (ZONE_MULT[zone] || 1) * range);
  }

  // =====================================================================
  // The Mii's brain
  // =====================================================================
  /*
   * The bot gets the same controls as you (move keys, mouse, trigger), and the
   * same gun rules. Skill (0..1) changes how fast it reacts, how well it aims,
   * whether it stops before shooting (counter-strafing), how well it controls
   * the spray and how often it goes for the head.
   */
  class BotBrain {
    constructor(game, f, skill, traits) {
      this.g = game; this.f = f;
      this.setSkill(skill, traits);
      this.nav = null;
      this.resetRound();
    }
    setSkill(s, traits) {
      s = clamp(s, 0, 1);
      const t = traits || {};
      this.s = s;
      this.reaction = 0.85 - 0.6 * s;                 // seconds before the first shot after spotting you
      this.turnK = 5 + 15 * s;                        // how snappy the aim is
      this.aimErr0 = 0.25 + 1.2 * (1 - s);            // meters of aim error when it first sees you
      this.settle = 0.9 + 4.4 * s;                    // how fast that error shrinks
      this.wobble = 0.04 + 0.35 * Math.pow(1 - s, 1.5); // shaky hands that never quite settle
      this.headPref = 0.1 + 0.6 * s;
      this.comp = 0.15 + 0.8 * s;                     // spray control
      this.stopFirst = 0.2 + 0.8 * s;                 // counter-strafes before shooting
      this.strafe = 0.2 + 0.7 * s;                    // dodges between bursts
      // personality (0-100): energetic, outgoing Miis push forward; quiet ones play it careful
      const e = (t.energy !== undefined ? t.energy : 50) / 100, so = (t.social !== undefined ? t.social : 50) / 100;
      this.aggro = clamp(0.25 + e * 0.45 + so * 0.2, 0.15, 0.9);
    }
    resetRound() {
      this.state = "hunt";
      this.path = null; this.goal = null; this.repath = 0;
      this.seen = false; this.seenAt = -9; this.lastSeen = null; this.reactAt = 0;
      this.heard = null; this.heardAt = -9;
      this.aimZone = "head"; this.err = { x: 0, y: 0, z: 0 };
      this.burst = 0; this.pause = 0; this.strafeDir = 0; this.strafeT = 0;
      this.crouchSpray = false; this.stuck = 0; this.lastPos = null; this.look = null; this.thinkT = 0;
      this.walk = false; this.jumpNext = false; this.runAndGun = false;
    }

    hear(pos, now, loud) {
      if (!pos) return;
      const spread = loud ? 1.2 : 2.5;
      this.heard = { x: pos.x + (Math.random() - 0.5) * spread, y: pos.y, z: pos.z + (Math.random() - 0.5) * spread };
      this.heardAt = now;
    }

    // returns the controls for this tick: { fwd, side, yaw (absolute), walk, duck, jump, fire, reload }
    tick(dt, now, target) {
      const f = this.f, g = this.g, m = f.mover;
      const out = { fwd: 0, side: 0, walk: false, duck: false, jump: false, fire: false, reload: false };
      const eye = { x: m.pos.x, y: m.pos.y + m.eye(), z: m.pos.z };

      // ---- can I see them? (checked 20 times a second) ----
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = 0.05;
        const vis = target.alive && this.canSee(eye, target, now);
        if (vis && !this.seen) {
          // just spotted: reaction time (slower when they're off to the side)
          const a = anglesTo(eye, target.center);
          const off = Math.abs(wrapAngle(a.yaw - f.yaw)) + Math.abs(a.pitch - f.pitch);
          this.reactAt = now + this.reaction * (0.85 + Math.random() * 0.3) + Math.min(0.35, off * 0.18);
          this.aimZone = Math.random() < this.headPref ? "head" : "chest";
          const e = this.aimErr0 * (0.6 + Math.random() * 0.8);
          const ang = Math.random() * Math.PI * 2;
          this.err = { x: Math.cos(ang) * e, y: Math.sin(ang) * e * 0.7, z: (Math.random() - 0.5) * e };
          this.burst = 0; this.pause = 0;
          this.runAndGun = Math.random() > this.stopFirst;
          this.crouchSpray = Math.random() < 0.25 + 0.2 * this.s;
        }
        this.seen = vis;
        if (vis) { this.seenAt = now; this.lastSeen = { x: target.feet.x, y: target.feet.y, z: target.feet.z }; }
      }

      const dist = Math.hypot(target.feet.x - m.pos.x, target.feet.z - m.pos.z);
      this.dist = dist;
      let wantYaw = f.yaw, wantPitch = f.pitch;

      if (this.seen) {
        // ---------------- fight ----------------
        this.state = "fight";
        this.err.x *= Math.exp(-dt * this.settle); this.err.y *= Math.exp(-dt * this.settle); this.err.z *= Math.exp(-dt * this.settle);
        const tp = this.aimZone === "head" ? target.head : target.chest;
        const wob = this.wobble, tt = now * 1.7;
        const aim = {
          x: tp.x + this.err.x + Math.sin(tt * 1.3 + 1) * wob,
          y: tp.y + this.err.y + Math.sin(tt * 1.7 + 2) * wob * 0.8,
          z: tp.z + this.err.z + Math.sin(tt * 1.1 + 4) * wob,
        };
        const a = anglesTo(eye, aim);
        // pull the gun down against the recoil
        wantYaw = a.yaw + f.arms.recX * DEG * this.comp;
        wantPitch = a.pitch - f.arms.recY * DEG * this.comp;

        const arms = f.arms;
        if (arms.weapon !== "ak") out.switchTo = "ak";
        const spd = m.speed2d();
        const slowEnough = spd < CFG.speedAK * 0.34 || this.runAndGun;
        // aiming close enough?
        const tr = this.aimZone === "head" ? 0.4 : 0.3;
        const tol = Math.atan2(tr * (1.1 + (1 - this.s) * 1.6), Math.max(1, dist));
        const yawErr = Math.abs(wrapAngle(wantYaw - f.yaw)), pitchErr = Math.abs(wantPitch - f.pitch);
        const onTarget = yawErr < tol && pitchErr < tol * 1.2;

        if (this.pause > 0) {
          // between bursts: dodge left/right (ADAD), then stop again
          this.pause -= dt;
          if (this.strafeT > 0) { this.strafeT -= dt; out.side = this.strafeDir; }
          else out.side = 0;
        } else if (now >= this.reactAt && onTarget && (slowEnough || arms.ammo === 0)) {
          if (arms.ammo === 0) out.reload = true;
          else {
            out.fire = true;
            if (this.crouchSpray && dist < 9) out.duck = true;
          }
        } else if (!slowEnough && !this.runAndGun) {
          // counter-strafe: tap the opposite way to stop dead
          const vx = m.vel.x, vz = m.vel.z;
          const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
          const vf = -(vx * sy + vz * cy), vs = vx * cy - vz * sy;
          if (Math.abs(vf) > 0.6) out.fwd = -Math.sign(vf);
          if (Math.abs(vs) > 0.6) out.side = -Math.sign(vs);
        } else if (now < this.reactAt && Math.random() < 0.02 && this.aggro > 0.5) {
          out.side = Math.random() < 0.5 ? -1 : 1;
        }
        // out of bullets with them in front: back off while reloading
        if (arms.reloading(now) && dist < 14) { out.fwd = -1; out.side = this.strafeDir || 1; }
        this.path = null;
      } else {
        // ---------------- hunt ----------------
        if (f.arms.ammo < 12 && f.arms.reserve > 0 && now - this.seenAt > 1.2 && !f.arms.reloading(now)) out.reload = true;
        let goal = null;
        if (this.lastSeen && now - this.seenAt < 7) { goal = this.lastSeen; this.state = "chase"; }
        if (this.heard && now - this.heardAt < 5 && (!goal || this.heardAt > this.seenAt)) { goal = this.heard; this.state = "investigate"; }
        if (!goal) {
          this.state = "hunt";
          if (!this.goal || this.reached(this.goal, 1.2)) this.goal = this.pickRoam(target);
          goal = this.goal;
        }
        this.moveTo(goal, dt, now, out);
        // look where you're going, or toward where they probably are
        const lookAt = goal && Math.hypot(goal.x - m.pos.x, goal.z - m.pos.z) < 12 ? { x: goal.x, y: goal.y + CFG.eyeStand * 0.95, z: goal.z } : this.look;
        if (lookAt) { const a = anglesTo(eye, lookAt); wantYaw = a.yaw; wantPitch = clamp(a.pitch, -0.3, 0.3); }
        // sneak when it's close to where you are (careful Miis)
        out.walk = this.state !== "hunt" && this.s > 0.45 && this.aggro < 0.6 && goal && Math.hypot(goal.x - m.pos.x, goal.z - m.pos.z) < 7;
        if (out.reload) out.walk = false;
        if (f.arms.weapon !== "ak") out.switchTo = "ak";
      }

      // ---- turn toward where it wants to look (smooth, like a hand on a mouse) ----
      const k = 1 - Math.exp(-dt * (this.seen ? this.turnK : 6));
      const maxTurn = (this.seen ? 9 + 16 * this.s : 6) * dt;
      f.yaw += clamp(wrapAngle(wantYaw - f.yaw) * k, -maxTurn, maxTurn);
      f.pitch += clamp((wantPitch - f.pitch) * k, -maxTurn, maxTurn);
      f.pitch = clamp(f.pitch, -1.5, 1.5);
      out.yaw = f.yaw;
      return out;
    }

    // the game tells us when our gun actually fired: count the burst
    onShot() {
      const dist = this.dist || 10;
      this.burst++;
      const maxBurst = dist > 17 ? 1 + (Math.random() < 0.4 ? 1 : 0) : dist > 8 ? 3 + Math.floor(Math.random() * 3) : 6 + Math.floor(Math.random() * 7 * (0.5 + this.s));
      if (this.burst >= maxBurst) {
        this.burst = 0;
        this.pause = dist > 17 ? 0.32 + Math.random() * 0.2 : 0.22 + Math.random() * 0.2;
        if (Math.random() < this.strafe) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = this.pause * 0.7; }
        // a better shot pulls their aim back together
        this.err.x *= 0.5; this.err.y *= 0.5;
        if (Math.random() < this.headPref * 0.6) this.aimZone = "head";
      }
    }

    canSee(eye, target, now) {
      const W = this.g.world;
      const pts = [target.head, target.chest];
      // not seen behind the back unless it's on alert
      const alert = now - this.seenAt < 2.5 || now - this.heardAt < 2.5;
      const a = anglesTo(eye, target.center);
      const off = Math.abs(wrapAngle(a.yaw - this.f.yaw));
      if (!alert && off > 1.15) return false;
      if (!alert && off > 0.9 && Math.random() < 0.6) return false;
      for (const p of pts) if (W.clear(eye, p)) return true;
      return false;
    }

    reached(p, r) { const m = this.f.mover; return Math.hypot(p.x - m.pos.x, p.z - m.pos.z) < r; }

    pickRoam(target) {
      // wander toward the middle and toward your half of the map
      const B = this.g.world.bounds;
      for (let i = 0; i < 20; i++) {
        const tx = target.feet.x * 0.5 + (Math.random() - 0.5) * (B.maxX - B.minX) * 0.7;
        const tz = target.feet.z * 0.5 + (Math.random() - 0.5) * (B.maxZ - B.minZ) * 0.7;
        if (this.nav && !this.nav.isBlocked(tx, tz)) return { x: tx, y: 0, z: tz };
      }
      return { x: 0, y: 0, z: 0 };
    }

    moveTo(goal, dt, now, out) {
      const m = this.f.mover;
      if (!this.nav) return;
      this.repath -= dt;
      if (!this.path || this.repath <= 0 || !this.pathGoal || Math.hypot(this.pathGoal.x - goal.x, this.pathGoal.z - goal.z) > 1.5) {
        const s = this.nav.nearestFree(m.pos.x, m.pos.z), t = this.nav.nearestFree(goal.x, goal.z);
        this.path = this.nav.findPath(s.x, s.z, t.x, t.z) || [];
        this.pathGoal = { x: goal.x, z: goal.z };
        this.repath = 1.2;
      }
      while (this.path.length && Math.hypot(this.path[0].x - m.pos.x, this.path[0].z - m.pos.z) < 0.45) this.path.shift();
      const next = this.path[0];
      if (!next) return;
      // steer: turn the wanted direction into forward/side keys for our current yaw
      const dx = next.x - m.pos.x, dz = next.z - m.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const sy = Math.sin(this.f.yaw), cy = Math.cos(this.f.yaw);
      out.fwd = (-(dx * sy + dz * cy)) / l;
      out.side = (dx * cy - dz * sy) / l;
      this.look = { x: m.pos.x + dx / l * 6, y: m.pos.y + CFG.eyeStand, z: m.pos.z + dz / l * 6 };
      // stuck on something? hop
      if (this.lastPos && Math.hypot(this.lastPos.x - m.pos.x, this.lastPos.z - m.pos.z) < 0.4 * dt) this.stuck += dt; else this.stuck = 0;
      this.lastPos = { x: m.pos.x, z: m.pos.z };
      if (this.stuck > 0.5) { out.jump = true; this.stuck = 0; this.repath = 0; }
    }
  }

  root.PBEngine = {
    U, DEG, CFG, AK, AWP, DEAGLE, WEAPONS, LOADOUTS, KNIFE, PATTERN, ZONE_MULT,
    World, Mover, Arms, BotBrain,
    forward, anglesTo, wrapAngle, clamp, lerp,
    raySphere, rayCapsule, rayHitboxes, bodyBoxes,
    inaccuracy, inaccuracyParts, updateArms, shotDirection, damageFor,
  };
})(typeof window !== "undefined" ? window : globalThis);
