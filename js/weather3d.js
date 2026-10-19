/*
 * weather3d.js
 * Weather, seasons and festivals for the 3D hub: rain, storms with lightning,
 * snow, windy days with blowing leaves, cherry petals in spring, falling
 * leaves in autumn, butterflies in summer... and festivals with fireworks,
 * floating paper lanterns, spooky ghosts, shooting stars and fairy lights.
 *
 * How to use it (from hub3d.js / app.js):
 *
 *   const fx = Weather3D.create(hub);  // once
 *   fx.setWorld(hub.world);            // after every place change
 *   fx.set({ weather: "rain", season: "autumn", festival: null, night: false });
 *   fx.update(dt, t);                  // every frame
 *   fx.dispose();                      // removes everything
 *
 *   weather:  "sunny" | "cloudy" | "rain" | "storm" | "snow" | "windy"
 *   season:   "spring" | "summer" | "autumn" | "winter"
 *   festival: null | "fireworks" | "lanterns" | "cherry" | "spooky" | "starfall" | "snowfest"
 *   night:    true / false
 *   (fx.set only changes the fields you pass, so fx.set({ night: true }) is fine.)
 *
 * How it works:
 *   - Almost everything (raindrops, snowflakes, petals, sparks, lanterns, ghosts...)
 *     is a "sprite": a little flat picture that always faces the camera. All the
 *     pictures are painted once onto one canvas (the "atlas"), and all the sprites
 *     are drawn in just TWO goes: one for normal sprites and one for glowing ones
 *     (glowing sprites add their light, so fireworks and stars shine).
 *   - The "mood" (darker on rainy days, blue at night, purple for spooky...) is
 *     made by turning the place's lights down and tinting them, and by tinting the
 *     sky, the background and the fog. We remember the original values so we can
 *     put everything back exactly as it was.
 *   - Everything we add lives in our own group (fx.group) in the scene, never
 *     inside the place itself (places get thrown away when you leave them).
 */
(function (root) {
  "use strict";

  const THREE = root.THREE;
  if (!THREE) return; // (not in a browser, e.g. the tests)

  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Places with a roof: no rain or snow inside (only far away, outside the walls).
  const INDOOR = { office: true, school: true, home: true };
  // Places with no weather at all (festivals can still happen there).
  const NO_WEATHER = { space: true };

  // ------------------------------------------------------------------
  // The pictures (one 512x512 canvas cut into 4x4 squares of 128 pixels)
  // ------------------------------------------------------------------
  const TILE = {
    RAIN: 0, DOT: 1, FLAKE: 2, PETAL: 3, MAPLE: 4, LEAF: 5, SPARKLE: 6, GLOW: 7,
    BUTTERFLY: 8, SPLASH: 9, LANTERN: 10, PUMPKIN: 11, BAT: 12, GHOST: 13, BOLT: 14, STAR: 15,
  };

  function makeAtlas() {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S * 4;
    const ctx = c.getContext("2d");
    // draw(ctx) paints one picture centerd on (0, 0), about 120 pixels across
    const tile = (n, draw) => {
      ctx.save();
      ctx.translate((n % 4) * S + S / 2, Math.floor(n / 4) * S + S / 2);
      draw(ctx);
      ctx.restore();
    };
    const radial = (r0, r1, stops) => {
      const g = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);
      stops.forEach((s) => g.addColorStop(s[0], s[1]));
      return g;
    };

    // a raindrop streak (falls straight down, bright at the bottom)
    tile(TILE.RAIN, (x) => {
      const g = x.createLinearGradient(0, -58, 0, 58);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.7, "rgba(255,255,255,0.8)");
      g.addColorStop(1, "rgba(255,255,255,1)");
      x.strokeStyle = g; x.lineWidth = 9; x.lineCap = "round";
      x.beginPath(); x.moveTo(0, -56); x.lineTo(0, 54); x.stroke();
    });
    // a soft round snowball
    tile(TILE.DOT, (x) => {
      x.fillStyle = radial(0, 60, [[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,1)"], [1, "rgba(255,255,255,0)"]]);
      x.beginPath(); x.arc(0, 0, 60, 0, TAU); x.fill();
    });
    // a six-armed snowflake
    tile(TILE.FLAKE, (x) => {
      x.strokeStyle = "#fff"; x.lineWidth = 10; x.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        x.save(); x.rotate((i * TAU) / 6);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -52);
        x.moveTo(0, -30); x.lineTo(-16, -44); x.moveTo(0, -30); x.lineTo(16, -44);
        x.stroke(); x.restore();
      }
      x.fillStyle = "#fff"; x.beginPath(); x.arc(0, 0, 12, 0, TAU); x.fill();
    });
    // a cherry blossom petal (with the little notch at the top)
    tile(TILE.PETAL, (x) => {
      x.fillStyle = radial(4, 60, [[0, "#ffffff"], [1, "#e9e9e9"]]);
      x.beginPath();
      x.moveTo(0, 56);
      x.bezierCurveTo(-58, 20, -50, -50, -14, -54);
      x.lineTo(0, -38);
      x.lineTo(14, -54);
      x.bezierCurveTo(50, -50, 58, 20, 0, 56);
      x.fill();
    });
    // a maple leaf
    tile(TILE.MAPLE, (x) => {
      x.fillStyle = "#fff";
      x.beginPath();
      const pts = [[0, -58], [12, -30], [34, -40], [28, -14], [56, -10], [34, 8], [42, 28], [14, 22], [4, 44], [-4, 44], [-14, 22], [-42, 28], [-34, 8], [-56, -10], [-28, -14], [-34, -40], [-12, -30]];
      pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
      x.closePath(); x.fill();
      x.strokeStyle = "rgba(0,0,0,0.22)"; x.lineWidth = 4;
      x.beginPath(); x.moveTo(0, 58); x.lineTo(0, -40); x.moveTo(0, 10); x.lineTo(30, -20); x.moveTo(0, 10); x.lineTo(-30, -20); x.stroke();
    });
    // a plain oval leaf
    tile(TILE.LEAF, (x) => {
      x.fillStyle = "#fff";
      x.beginPath(); x.moveTo(0, -58); x.quadraticCurveTo(44, -10, 0, 50); x.quadraticCurveTo(-44, -10, 0, -58); x.fill();
      x.strokeStyle = "rgba(0,0,0,0.22)"; x.lineWidth = 4;
      x.beginPath(); x.moveTo(0, 58); x.lineTo(0, -44); x.stroke();
    });
    // a four-pointed twinkle
    tile(TILE.SPARKLE, (x) => {
      x.fillStyle = radial(0, 34, [[0, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]);
      x.beginPath(); x.arc(0, 0, 34, 0, TAU); x.fill();
      x.fillStyle = "#fff";
      x.beginPath();
      x.moveTo(0, -60); x.quadraticCurveTo(5, -5, 60, 0); x.quadraticCurveTo(5, 5, 0, 60);
      x.quadraticCurveTo(-5, 5, -60, 0); x.quadraticCurveTo(-5, -5, 0, -60); x.fill();
    });
    // a soft glow (for halos and firework sparks)
    tile(TILE.GLOW, (x) => {
      x.fillStyle = radial(0, 62, [[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,255,255,0.85)"], [0.45, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]);
      x.beginPath(); x.arc(0, 0, 62, 0, TAU); x.fill();
    });
    // a butterfly (white, so we can color it in)
    tile(TILE.BUTTERFLY, (x) => {
      x.fillStyle = "#fff"; x.strokeStyle = "rgba(0,0,0,0.35)"; x.lineWidth = 4;
      for (const s of [-1, 1]) {
        x.beginPath(); x.ellipse(s * 26, -16, 26, 30, s * 0.4, 0, TAU); x.fill(); x.stroke();
        x.beginPath(); x.ellipse(s * 20, 22, 18, 20, -s * 0.3, 0, TAU); x.fill(); x.stroke();
      }
      x.fillStyle = "rgba(0,0,0,0.25)";
      for (const s of [-1, 1]) { x.beginPath(); x.arc(s * 30, -18, 8, 0, TAU); x.fill(); }
      x.fillStyle = "#3a2a2a"; x.beginPath(); x.ellipse(0, 4, 6, 34, 0, 0, TAU); x.fill();
      x.strokeStyle = "#3a2a2a"; x.lineWidth = 3;
      x.beginPath(); x.moveTo(-2, -28); x.lineTo(-12, -50); x.moveTo(2, -28); x.lineTo(12, -50); x.stroke();
    });
    // a splash ring on the ground, with two little drops
    tile(TILE.SPLASH, (x) => {
      x.strokeStyle = "#fff"; x.lineWidth = 7;
      x.beginPath(); x.ellipse(0, 26, 50, 16, 0, 0, TAU); x.stroke();
      x.fillStyle = "#fff";
      x.beginPath(); x.arc(-22, -6, 7, 0, TAU); x.arc(18, -16, 6, 0, TAU); x.fill();
    });
    // a glowing paper lantern
    tile(TILE.LANTERN, (x) => {
      x.fillStyle = radial(0, 60, [[0, "rgba(255,220,140,0.55)"], [1, "rgba(255,200,120,0)"]]);
      x.beginPath(); x.arc(0, 0, 60, 0, TAU); x.fill();
      x.fillStyle = radial(4, 46, [[0, "#fff6c8"], [0.55, "#ffc56b"], [1, "#ff7a45"]]);
      x.beginPath(); x.ellipse(0, 2, 36, 42, 0, 0, TAU); x.fill();
      x.strokeStyle = "rgba(200,70,40,0.45)"; x.lineWidth = 3;
      for (const k of [-0.5, 0, 0.5]) { x.beginPath(); x.ellipse(0, 2, 36 * Math.abs(k) + 0.1, 42, 0, 0, TAU); x.stroke(); }
      x.fillStyle = "#8a4b2a";
      x.fillRect(-18, -46, 36, 9); x.fillRect(-18, 41, 36, 9);
      x.fillStyle = "#ffd25a"; x.fillRect(-3, 50, 6, 10);
    });
    // a jack-o'-lantern
    tile(TILE.PUMPKIN, (x) => {
      x.fillStyle = radial(0, 62, [[0, "rgba(255,160,40,0.5)"], [1, "rgba(255,120,0,0)"]]);
      x.beginPath(); x.arc(0, 4, 62, 0, TAU); x.fill();
      x.fillStyle = "#3f8a2e"; x.fillRect(-6, -50, 12, 18);
      x.fillStyle = "#ff8a1e";
      x.beginPath(); x.ellipse(-20, 6, 28, 38, 0, 0, TAU); x.ellipse(20, 6, 28, 38, 0, 0, TAU); x.fill();
      x.fillStyle = "#ff9d33"; x.beginPath(); x.ellipse(0, 6, 22, 40, 0, 0, TAU); x.fill();
      x.fillStyle = "#ffe36b";
      x.beginPath(); x.moveTo(-26, -6); x.lineTo(-10, -6); x.lineTo(-18, -22); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(26, -6); x.lineTo(10, -6); x.lineTo(18, -22); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-30, 12);
      [[-22, 22], [-14, 16], [-6, 26], [2, 16], [10, 26], [18, 16], [26, 22], [30, 12]].forEach((p) => x.lineTo(p[0], p[1]));
      x.quadraticCurveTo(0, 46, -30, 12); x.fill();
    });
    // a little bat
    tile(TILE.BAT, (x) => {
      x.fillStyle = "#3b2350";
      x.beginPath(); x.moveTo(0, -6);
      x.quadraticCurveTo(-30, -36, -60, -12); x.quadraticCurveTo(-50, -4, -46, 6);
      x.quadraticCurveTo(-36, -2, -30, 10); x.quadraticCurveTo(-20, 2, -14, 16); x.lineTo(0, 10);
      x.lineTo(14, 16); x.quadraticCurveTo(20, 2, 30, 10); x.quadraticCurveTo(36, -2, 46, 6);
      x.quadraticCurveTo(50, -4, 60, -12); x.quadraticCurveTo(30, -36, 0, -6); x.fill();
      x.beginPath(); x.arc(0, 0, 16, 0, TAU); x.fill();
      x.beginPath(); x.moveTo(-12, -8); x.lineTo(-8, -26); x.lineTo(-2, -12); x.moveTo(12, -8); x.lineTo(8, -26); x.lineTo(2, -12); x.fill();
      x.fillStyle = "#fff"; x.beginPath(); x.arc(-6, -2, 4, 0, TAU); x.arc(6, -2, 4, 0, TAU); x.fill();
    });
    // a friendly ghost
    tile(TILE.GHOST, (x) => {
      x.fillStyle = "#ffffff";
      x.beginPath(); x.moveTo(-40, 48); x.lineTo(-40, -12); x.arc(0, -12, 40, Math.PI, 0); x.lineTo(40, 48);
      for (let i = 0; i < 4; i++) x.quadraticCurveTo(30 - i * 20, 34, 20 - i * 20, 48);
      x.fill();
      x.fillStyle = "#2b2b3a";
      x.beginPath(); x.ellipse(-14, -14, 6, 9, 0, 0, TAU); x.ellipse(14, -14, 6, 9, 0, 0, TAU); x.fill();
      x.beginPath(); x.ellipse(0, 8, 7, 9, 0, 0, TAU); x.fill();
      x.fillStyle = "rgba(255,140,170,0.6)";
      x.beginPath(); x.arc(-26, 0, 7, 0, TAU); x.arc(26, 0, 7, 0, TAU); x.fill();
    });
    // a lightning bolt
    tile(TILE.BOLT, (x) => {
      x.shadowColor = "rgba(220,220,255,1)"; x.shadowBlur = 14;
      x.strokeStyle = "#fffbe0"; x.lineWidth = 7; x.lineJoin = "round";
      x.beginPath(); x.moveTo(6, -62); x.lineTo(-10, -20); x.lineTo(10, -14); x.lineTo(-8, 22); x.lineTo(10, 26); x.lineTo(-6, 62); x.stroke();
      x.lineWidth = 4; x.beginPath(); x.moveTo(-10, -20); x.lineTo(-30, 4); x.moveTo(-8, 22); x.lineTo(-26, 40); x.stroke();
    });
    // a chubby five-pointed star
    tile(TILE.STAR, (x) => {
      x.fillStyle = radial(0, 60, [[0, "rgba(255,255,255,0.5)"], [1, "rgba(255,255,255,0)"]]);
      x.beginPath(); x.arc(0, 0, 60, 0, TAU); x.fill();
      x.fillStyle = "#fff"; x.strokeStyle = "#fff"; x.lineWidth = 10; x.lineJoin = "round";
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 18 : 40;
        i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath(); x.fill(); x.stroke();
    });

    const tex = new THREE.CanvasTexture(c);
    // "premultiplied" = colors are stored already faded by their see-through-ness,
    // which stops dark fringes around the pictures when they're drawn small
    tex.premultiplyAlpha = true;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------
  // A "pool" of sprites drawn in one go (a THREE.Points with our own shader).
  // Each sprite has: a position, a color (+ see-through-ness), a size,
  // a turn (rot), which picture (tile) and a squash (for flapping/tumbling).
  // ------------------------------------------------------------------
  const VERT = [
    "uniform float uScale;",   // turns world size into pixels
    "uniform float uMaxPx;",   // never bigger than this many pixels
    "attribute vec4 aColor;",
    "attribute vec4 aInfo;",   // size, rot, tile, squash
    "varying vec4 vColor;",
    "varying vec3 vInfo;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mv;",
    "  gl_PointSize = min(aInfo.x * uScale / max(0.1, -mv.z), uMaxPx);",
    "  if (aInfo.x <= 0.0 || aColor.a <= 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }",
    "  vColor = aColor;",
    "  vInfo = aInfo.yzw;",
    "}",
  ].join("\n");
  const FRAG = [
    "uniform sampler2D uMap;",
    "varying vec4 vColor;",
    "varying vec3 vInfo;",
    "void main() {",
    "  vec2 p = gl_PointCoord - 0.5;",
    "  p.y = -p.y;",
    "  float c = cos(vInfo.x), s = sin(vInfo.x);",
    "  p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);", // turn the picture
    "  p.x /= max(vInfo.z, 0.06);",                        // squash it sideways
    "  if (abs(p.x) > 0.5 || abs(p.y) > 0.5) discard;",
    "  float t = floor(vInfo.y + 0.5);",
    "  vec2 cell = vec2(mod(t, 4.0), 3.0 - floor(t / 4.0));",
    "  vec4 tex = texture2D(uMap, (cell + p + 0.5) * 0.25);", // (colors already times alpha)
    "  gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a) * vColor.a;",
    "  if (gl_FragColor.a < 0.01) discard;",
    "}",
  ].join("\n");

  class Pool {
    // counts = { count, retiring }: how many of each kind are alive (shared by both pools)
    constructor(n, tex, additive, counts) {
      this.n = n;
      this.count = counts.count;
      this.retiringCount = counts.retiring;
      this.alive = 0;
      this.cursor = 0;
      this.pos = new Float32Array(n * 3);
      this.col = new Float32Array(n * 4);
      this.info = new Float32Array(n * 4);
      this.vel = new Float32Array(n * 3);
      this.home = new Float32Array(n * 3);
      this.age = new Float32Array(n);
      this.life = new Float32Array(n);
      this.kind = new Uint8Array(n);
      this.phase = new Float32Array(n);
      this.spin = new Float32Array(n);
      this.base = new Float32Array(n);   // the normal size
      this.alpha = new Float32Array(n);  // the normal see-through-ness
      this.aux = new Float32Array(n);    // anything extra a kind needs (timers...)
      this.link = new Int32Array(n).fill(-1);
      this.gen = new Uint32Array(n);     // goes up every time a slot is reused
      this.retiring = new Uint8Array(n);
      const geo = new THREE.BufferGeometry();
      this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
      this.infoAttr = new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", this.posAttr);
      geo.setAttribute("aColor", this.colAttr);
      geo.setAttribute("aInfo", this.infoAttr);
      this.uniforms = { uMap: { value: tex }, uScale: { value: 800 }, uMaxPx: { value: 200 } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false; // (the sprites are all over the place)
      this.points.renderOrder = additive ? 11 : 10;
      this.points.visible = false;
    }

    // Finds a free slot. Returns its number, or -1 when the pool is full.
    spawn(kind) {
      if (this.alive >= this.n) return -1;
      let i = this.cursor;
      for (let k = 0; k < this.n; k++) {
        if (this.kind[i] === 0) break;
        i = i + 1 === this.n ? 0 : i + 1;
      }
      if (this.kind[i] !== 0) return -1;
      this.cursor = i + 1 === this.n ? 0 : i + 1;
      this.kind[i] = kind;
      this.alive++;
      this.count[kind]++;
      this.age[i] = 0; this.life[i] = 1e9; this.retiring[i] = 0; this.aux[i] = 0;
      this.phase[i] = Math.random() * TAU; this.spin[i] = 0; this.alpha[i] = 1; this.base[i] = 1;
      this.link[i] = -1;
      this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
      this.info[i * 4 + 1] = 0; this.info[i * 4 + 3] = 1;
      this.col[i * 4] = this.col[i * 4 + 1] = this.col[i * 4 + 2] = 1; this.col[i * 4 + 3] = 0;
      return i;
    }

    kill(i) {
      const k = this.kind[i];
      if (!k) return;
      this.count[k]--;
      if (this.retiring[i]) this.retiringCount[k]--;
      this.kind[i] = 0;
      this.retiring[i] = 0;
      this.gen[i]++;
      this.info[i * 4] = 0;
      this.col[i * 4 + 3] = 0;
      this.alive--;
    }

    // Removes every sprite of the given kind (or all of them).
    clear(kind) {
      for (let i = 0; i < this.n; i++) if (this.kind[i] && (!kind || this.kind[i] === kind)) this.kill(i);
    }

    setPos(i, x, y, z) { this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; }
    setVel(i, x, y, z) { this.vel[i * 3] = x; this.vel[i * 3 + 1] = y; this.vel[i * 3 + 2] = z; }
    setHome(i, x, y, z) { this.home[i * 3] = x; this.home[i * 3 + 1] = y; this.home[i * 3 + 2] = z; }
    setColor(i, c, a) { this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.alpha[i] = a === undefined ? 1 : a; }
    setLook(i, tile, size) { this.info[i * 4 + 2] = tile; this.base[i] = size; this.info[i * 4] = size; }

    // Sends the new positions/colors to the graphics card (only the used part).
    upload() {
      this.points.visible = this.alive > 0;
      if (!this.alive) return;
      let hi = this.n - 1;
      while (hi > 0 && !this.kind[hi]) hi--;
      const used = hi + 1;
      this.points.geometry.setDrawRange(0, used);
      this.posAttr.updateRange.count = used * 3;
      this.colAttr.updateRange.count = used * 4;
      this.infoAttr.updateRange.count = used * 4;
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.infoAttr.needsUpdate = true;
    }

    dispose() {
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
  }

  // The kinds of sprite. (0 = an empty slot)
  const K = {
    // normal sprites
    RAIN: 1, SPLASH: 2, SNOW: 3, PETAL: 4, LEAF: 5, BLOWN: 6, GUST: 7, BUTTERFLY: 8,
    LANTERN: 9, HANG: 10, PUMPKIN: 11, BAT: 12, GHOST: 13,
    // glowing sprites
    SHELL: 14, SPARK: 15, TRAIL: 16, SHOOT: 17, TWINKLE: 18, SPARKLE: 19, HALO: 20, BOLT: 21, STAR: 22,
  };
  // The kinds that fill the air around the place (we keep "this many" of them).
  const FIELD_KINDS = [K.RAIN, K.SNOW, K.PETAL, K.LEAF, K.BLOWN, K.GUST, K.BUTTERFLY, K.LANTERN, K.PUMPKIN, K.BAT, K.GHOST, K.SPARKLE];

  // Colors (0..1) that sprites can be
  const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  const PAL = {
    rain: hex(0xd6e6ff),
    rainIndoor: hex(0x7890b8),
    snow: hex(0xffffff),
    petals: [hex(0xffb7d0), hex(0xffd3e2), hex(0xff9fc2), hex(0xfff0f5)],
    autumn: [hex(0xff8a3d), hex(0xe8532f), hex(0xffc23d), hex(0xc8642b), hex(0xd8402a)],
    summerLeaves: [hex(0x7fd65a), hex(0x9be36b), hex(0x5fc24a)],
    winterBits: [hex(0xffffff), hex(0xeaf4ff)],
    butterflies: [hex(0xffe066), hex(0xff9ccf), hex(0x9fd8ff), hex(0xffffff), hex(0xc7a6ff)],
    fireworks: [hex(0xff5fa2), hex(0xffd84a), hex(0x5fe0ff), hex(0x9dff6a), hex(0xc58bff), hex(0xff8a4a), hex(0xffffff)],
    fairy: [hex(0xff5f6e), hex(0x6dff8a), hex(0xffe066), hex(0x6fb8ff), hex(0xff8ae0)],
    spookyLights: [hex(0xff9a2e), hex(0xb26bff)],
    cherryLanterns: [hex(0xffc4d8), hex(0xffffff), hex(0xffa6c6)],
    paperLanterns: [hex(0xffffff), hex(0xffe0c0), hex(0xffc8a8)],
    sparkle: [hex(0xffffff), hex(0xbfe8ff), hex(0xffe9a8), hex(0xffc6ec)],
    white: hex(0xffffff),
    warm: hex(0xffb75a),
    gold: hex(0xffcf6a),
  };

  // ------------------------------------------------------------------
  // The mood: how dark / which tint for each weather, season and festival.
  // sky = { top, mid, bot } colors the sky is mixed towards, amt = how much.
  // light = how bright the place's lights are (1 = normal), tint = their color.
  // fog = how near the fog comes (smaller = mistier).
  // ------------------------------------------------------------------
  const WEATHER_MOOD = {
    sunny: { amt: 0, light: 1, tint: 0xffffff, fog: 1 },
    windy: { top: 0xbfdcf2, mid: 0xe6f2fa, bot: 0xd2e6f2, amt: 0.2, light: 1, tint: 0xffffff, fog: 0.95 },
    cloudy: { top: 0x9fb0c4, mid: 0xcfd8e2, bot: 0xb3bfcc, amt: 0.72, light: 0.6, tint: 0xdfe7f2, fog: 0.8 },
    rain: { top: 0x6f7f95, mid: 0xa3aebc, bot: 0x8592a3, amt: 0.85, light: 0.4, tint: 0xc4d2e6, fog: 0.55 },
    storm: { top: 0x3c4456, mid: 0x6b7484, bot: 0x4f5869, amt: 0.92, light: 0.27, tint: 0xb0bcd8, fog: 0.42 },
    snow: { top: 0xc4d0de, mid: 0xeef3f8, bot: 0xe2e9f1, amt: 0.78, light: 0.66, tint: 0xdce6fa, fog: 0.5 },
  };
  // (spring and summer keep the place's own colors; autumn is warmer, winter cooler)
  const SEASON_TINT = { spring: 0xffffff, summer: 0xffffff, autumn: 0xfff0e2, winter: 0xeef4ff };
  const NIGHT_MOOD = { top: 0x0b1035, mid: 0x2a3270, bot: 0x1b2252, amt: 0.9, light: 0.25, tint: 0x7890f0 };
  const DUSK_MOOD = { top: 0x46348a, mid: 0xffa585, bot: 0xd982a8, amt: 0.62, light: 0.55, tint: 0xffcfbf };
  const FESTIVAL_MOOD = {
    cherry: { top: 0xffbad6, mid: 0xffe2ee, bot: 0xffcfe2, amt: 0.38, light: 1, tint: 0xfff0f6 },
    spooky: { top: 0x2a0f4a, mid: 0x8a4a9a, bot: 0xff8a3c, amt: 0.6, light: 0.5, tint: 0xd0a8ff },
    snowfest: { top: 0xcfe0ff, mid: 0xeef4ff, bot: 0xe0e9ff, amt: 0.12, light: 1, tint: 0xf2f6ff },
    lanterns: { amt: 0, light: 1, tint: 0xffe6cc },
  };
  // festivals that want a dusky sky when it isn't night yet
  const DUSKY = { fireworks: true, lanterns: true, starfall: true };

  // ------------------------------------------------------------------
  // Weather3D.create(hub)
  // ------------------------------------------------------------------
  function create(hub) {
    const atlas = makeAtlas();
    const count = new Int32Array(32);         // how many of each kind are alive
    const retiringCount = new Int32Array(32); // ...and how many of those are fading away
    const over = new Int32Array(32);          // ...and how many too many there are
    const counts = { count, retiring: retiringCount };
    const N = new Pool(2600, atlas, false, counts); // normal sprites
    const G = new Pool(3400, atlas, true, counts);  // glowing sprites

    const group = new THREE.Group();
    group.name = "weather-fx";
    group.add(N.points, G.points);
    hub.scene.add(group);

    const state = { weather: "sunny", season: "spring", festival: null, night: false };
    let world = null;

    // where the weather happens (a box around the place); see updateField
    const F = { x0: -30, x1: 30, z0: -30, z1: 20, y0: 0, y1: 20, ground: 0, indoor: false, nowx: false, ex0: 0, ex1: 0, ez0: 0, ez1: 0, bx0: 0, bx1: 0, bz0: 0, bz1: 0, cx: 0, cz: 0 };
    const want = new Int32Array(32); // how many of each "field" kind we want
    let wind = 0;                    // sideways push (units per second, +x)
    let rainSpeed = 18;
    let splashChance = 0.3;

    // timers for things that happen now and then
    const timers = { firework: 1, shooting: 0.5, lightning: 3, gust: 0 };

    // ---------- the mood (lights, sky, background, fog) ----------
    const saved = { lights: [], domes: [], bg: null, bgObj: null, fog: null };
    const target = { light: 1, tint: new THREE.Color(1, 1, 1), fog: 1, sky: [new THREE.Color(), new THREE.Color(), new THREE.Color()], bg: new THREE.Color(), fogColor: new THREE.Color() };
    const cur = { light: 1, tint: new THREE.Color(1, 1, 1), fog: 1, sky: [new THREE.Color(), new THREE.Color(), new THREE.Color()], bg: new THREE.Color(), fogColor: new THREE.Color() };
    const flash = { amt: 0, color: new THREE.Color(1, 1, 1) };
    const tmpC = new THREE.Color();
    const tmpC2 = new THREE.Color();

    // Remembers the place's lights, sky, background and fog as they are now.
    function remember() {
      saved.lights = []; saved.domes = [];
      world.group.traverse((o) => {
        // (lamps and other small lights are left alone, they look cozy at night)
        if (o.isHemisphereLight || o.isAmbientLight || o.isDirectionalLight) {
          saved.lights.push({ light: o, intensity: o.intensity, color: o.color.clone(), ground: o.groundColor ? o.groundColor.clone() : null });
        }
        const u = o.isMesh && o.material && o.material.uniforms;
        if (u && u.top && u.middle && u.bottom && u.top.value && u.top.value.isColor) {
          saved.domes.push({ u, top: u.top.value.clone(), mid: u.middle.value.clone(), bot: u.bottom.value.clone() });
        }
      });
      const bg = hub.scene.background;
      saved.bgObj = bg && bg.isColor ? bg : null; // (the hub makes a new one for every place)
      saved.bg = saved.bgObj ? bg.clone() : null;
      const fog = hub.scene.fog;
      saved.fog = fog ? { fog, color: fog.color.clone(), near: fog.near, far: fog.far } : null;
    }

    // Puts the place back exactly as it was.
    function restore() {
      for (const s of saved.lights) {
        s.light.intensity = s.intensity;
        s.light.color.copy(s.color);
        if (s.ground) s.light.groundColor.copy(s.ground);
      }
      for (const d of saved.domes) { d.u.top.value.copy(d.top); d.u.middle.value.copy(d.mid); d.u.bottom.value.copy(d.bot); }
      if (saved.bg && hub.scene.background === saved.bgObj) saved.bgObj.copy(saved.bg);
      if (saved.fog && hub.scene.fog === saved.fog.fog) {
        saved.fog.fog.color.copy(saved.fog.color);
        saved.fog.fog.near = saved.fog.near;
        saved.fog.fog.far = saved.fog.far;
      }
    }

    // mixes color c towards layer color h (a hex number) by amt
    function mixHex(c, h, amt) { if (amt > 0 && h !== undefined) c.lerp(tmpC2.setHex(h), amt); }
    function layer(m, amt) {
      if (!m || !(amt > 0)) return;
      const sky = target.sky;
      mixHex(sky[0], m.top, amt); mixHex(sky[1], m.mid, amt); mixHex(sky[2], m.bot, amt);
      mixHex(target.bg, m.mid, amt); mixHex(target.fogColor, m.mid, amt);
    }

    // Works out what the mood should be for the current state and place.
    function computeMood() {
      const id = world ? world.id : "";
      const indoor = !!INDOOR[id];
      const space = !!NO_WEATHER[id];
      const d0 = saved.domes[0];
      // start from the place's own colors
      target.sky[0].copy(d0 ? d0.top : (saved.bg || tmpC.set(0xcdeeff)));
      target.sky[1].copy(d0 ? d0.mid : (saved.bg || tmpC.set(0xcdeeff)));
      target.sky[2].copy(d0 ? d0.bot : (saved.bg || tmpC.set(0xcdeeff)));
      target.bg.copy(saved.bg || target.sky[1]);
      target.fogColor.copy(saved.fog ? saved.fog.color : target.bg);
      let light = 1, fog = 1;
      target.tint.setRGB(1, 1, 1);
      const mul = (h) => target.tint.multiply(tmpC.setHex(h));

      if (!space) {
        const w = WEATHER_MOOD[state.weather] || WEATHER_MOOD.sunny;
        layer(w, w.amt);
        light *= w.light; mul(w.tint); fog *= w.fog;
        mul(SEASON_TINT[state.season] || 0xffffff);
        if (state.night) { layer(NIGHT_MOOD, NIGHT_MOOD.amt); light *= NIGHT_MOOD.light; mul(NIGHT_MOOD.tint); }
        else if (DUSKY[state.festival]) { layer(DUSK_MOOD, DUSK_MOOD.amt * (1 - w.amt * 0.5)); light *= DUSK_MOOD.light; mul(DUSK_MOOD.tint); }
      }
      const f = FESTIVAL_MOOD[state.festival];
      if (f && (!space || state.festival === "spooky")) {
        layer(f, f.amt * (state.night ? 0.6 : 1));
        light *= f.light; mul(f.tint);
      }
      if (indoor) {
        // indoors the room lights stay on, so only a gentle change
        light = 1 - (1 - light) * 0.45;
        target.tint.lerp(tmpC.setRGB(1, 1, 1), 0.55);
      }
      target.light = Math.max(0.12, light); // (never pitch black)
      target.fog = fog;
      moodAge = 0;
    }

    function snapMood() {
      cur.light = target.light; cur.fog = target.fog; cur.tint.copy(target.tint);
      for (let i = 0; i < 3; i++) cur.sky[i].copy(target.sky[i]);
      cur.bg.copy(target.bg); cur.fogColor.copy(target.fogColor);
    }

    let moodAge = 0; // seconds since the mood last changed
    function applyMood(dt) {
      // change smoothly, and after a few seconds land exactly on the new mood
      moodAge += dt || 0;
      const k = dt === undefined || moodAge > 4 ? 1 : 1 - Math.exp(-dt * 1.6);
      cur.light += (target.light - cur.light) * k;
      cur.fog += (target.fog - cur.fog) * k;
      cur.tint.lerp(target.tint, k);
      for (let i = 0; i < 3; i++) cur.sky[i].lerp(target.sky[i], k);
      cur.bg.lerp(target.bg, k);
      cur.fogColor.lerp(target.fogColor, k);

      const fa = flash.amt;
      const scale = cur.light + fa * 0.55;
      tmpC.copy(cur.tint).lerp(flash.color, Math.min(1, fa * 0.7));
      for (const s of saved.lights) {
        s.light.intensity = s.intensity * scale;
        s.light.color.copy(s.color).multiply(tmpC);
        if (s.ground) s.light.groundColor.copy(s.ground).multiply(tmpC);
      }
      const fl = Math.min(1, fa * 0.45);
      for (const d of saved.domes) {
        d.u.top.value.copy(cur.sky[0]).lerp(flash.color, fl);
        d.u.middle.value.copy(cur.sky[1]).lerp(flash.color, fl);
        d.u.bottom.value.copy(cur.sky[2]).lerp(flash.color, fl);
      }
      if (saved.bg && hub.scene.background === saved.bgObj) saved.bgObj.copy(cur.bg).lerp(flash.color, fl);
      if (saved.fog && hub.scene.fog === saved.fog.fog) {
        saved.fog.fog.color.copy(cur.fogColor).lerp(flash.color, fl * 0.6);
        saved.fog.fog.near = saved.fog.near * cur.fog;
        saved.fog.fog.far = saved.fog.far * (0.35 + 0.65 * cur.fog);
      }
    }

    // ---------- where things happen ----------
    function updateField() {
      const b = world.bounds;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const hw = (b.maxX - b.minX) / 2, hd = (b.maxZ - b.minZ) / 2;
      F.cx = cx; F.cz = cz;
      F.indoor = !!INDOOR[world.id];
      F.nowx = !!NO_WEATHER[world.id];
      F.bx0 = b.minX; F.bx1 = b.maxX; F.bz0 = b.minZ; F.bz1 = b.maxZ;
      const ty = (hub.controls && hub.controls.target ? hub.controls.target.y : world.cameraTargetY || 1);
      if (F.indoor) {
        // the area behind and beside the room (where the windows are), never
        // inside it (+ its walls), and not in front of it (that's where we look from)
        F.ex0 = b.minX - 6; F.ex1 = b.maxX + 6; F.ez0 = b.minZ - 6; F.ez1 = b.maxZ + 6;
        F.x0 = cx - hw - 12; F.x1 = cx + hw + 12;
        F.z0 = F.ez0 - 12; F.z1 = F.ez1;
        F.y0 = ty - 14; F.y1 = ty + 16; F.ground = F.y0;
      } else {
        F.x0 = cx - Math.max(26, hw + 14); F.x1 = cx + Math.max(26, hw + 14);
        F.z0 = cz - hd - 18; F.z1 = cz + hd + 10;
        F.y0 = 0; F.y1 = ty + 18; F.ground = 0;
      }
    }

    // Puts sprite i of pool P somewhere in the air around the place.
    // high = true: at the top (it's falling in); false: anywhere (filling up).
    function placeInField(P, i, high) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 6; tries++) {
        x = rnd(F.x0, F.x1); z = rnd(F.z0, F.z1);
        if (!F.indoor || x < F.ex0 || x > F.ex1 || z < F.ez0 || z > F.ez1) break;
        if (tries === 5) { z = rnd(F.z0, F.ez0); x = rnd(F.x0, F.x1); } // (behind the room)
      }
      P.setPos(i, x, high ? F.y1 + rnd(0, 3) : rnd(F.y0, F.y1), z);
    }
    // a spot inside the walking area (shrunk by m)
    function inArea(m) {
      return [rnd(F.bx0 + m, F.bx1 - m), rnd(F.bz0 + m, F.bz1 - m)];
    }

    // ---------- the camera: so sky things appear where you can see them ----------
    const camPos = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), tmpV = new THREE.Vector3();
    const bufSize = new THREE.Vector2();
    function readCamera() {
      const cam = hub.camera;
      cam.updateMatrixWorld();
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const e = cam.matrixWorld.elements;
      camPos.set(e[12], e[13], e[14]);
      camRight.set(e[0], e[1], e[2]);
      camUp.set(e[4], e[5], e[6]);
      hub.renderer.getDrawingBufferSize(bufSize);
      const scale = bufSize.y / (2 * Math.tan((cam.fov * Math.PI) / 360));
      N.uniforms.uScale.value = G.uniforms.uScale.value = scale;
      N.uniforms.uMaxPx.value = Math.max(48, bufSize.y * 0.14); // (so things right by the camera don't fill the screen)
      G.uniforms.uMaxPx.value = Math.max(64, bufSize.y * 0.35);
    }
    // A point in the sky that shows on screen at (nx, ny) (-1..1), dist away.
    // If that's under the ground (the camera looks down a lot), it comes closer,
    // so it stays at least minY high. Returns how far away it ended up.
    function skyPoint(nx, ny, dist, out, minY) {
      out.set(nx, ny, 0.5).unproject(hub.camera).sub(camPos).normalize();
      if (out.y < 0) dist = Math.min(dist, Math.max(25, (camPos.y - minY) / -out.y));
      out.multiplyScalar(dist).add(camPos);
      if (out.y < minY) out.y = minY;
      return dist;
    }

    // ---------- clouds (one InstancedMesh of puffy clouds) ----------
    let clouds = null;
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0x9a9a9a, emissive: 0x808080, fog: false });
    const cloudColor = new THREE.Color(1, 1, 1);
    const cloudWant = new THREE.Color(1, 1, 1);
    function makeClouds() {
      const parts = [];
      const puff = (x, y, z, s, sy) => {
        const g = new THREE.SphereGeometry(1, 14, 10);
        g.scale(s, s * (sy || 1), s);
        g.translate(x, y, z);
        parts.push(g);
      };
      puff(0, 0, 0, 1.3); puff(1.3, -0.25, 0.2, 0.95); puff(-1.25, -0.3, 0, 0.9); puff(0.4, 0.65, 0, 0.85); puff(-0.5, 0.45, 0.35, 0.75);
      puff(0, -0.55, 0, 1.9, 0.35);
      const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      const n = 16;
      clouds = new THREE.InstancedMesh(geo, cloudMat, n);
      clouds.frustumCulled = false;
      const o = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const a = ((i + Math.random() * 0.6) / n) * TAU;
        const d = rnd(85, 140);
        const s = rnd(8, 14);
        o.position.set(Math.cos(a) * d, rnd(28, 42), Math.sin(a) * d);
        o.scale.set(s, s * rnd(0.7, 0.95), s * rnd(0.8, 1));
        o.rotation.set(0, -a + Math.PI / 2, 0);
        o.updateMatrix();
        clouds.setMatrixAt(i, o.matrix);
      }
      clouds.visible = false;
      group.add(clouds);
    }
    makeClouds();
    let cloudsShown = 0; // fades 0..1 (by scaling the ring)

    // ---------- festival decorations (poles with strings of lights / lanterns) ----------
    let deco = null;   // { group, kind }
    let decoKey = "";  // which place + festival the decorations were made for
    function clearDeco() {
      N.clear(K.HANG); G.clear(K.TWINKLE); // (their halos go by themselves)
      if (deco) {
        group.remove(deco.group);
        deco.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        deco = null;
      }
    }
    // A string of lights along the back half of the place, on poles.
    function buildDeco(kind) {
      clearDeco();
      if (!world || F.indoor || F.nowx || !kind) return;
      const g = new THREE.Group();
      const b = world.bounds;
      const rx = (b.maxX - b.minX) / 2 + 0.3, rz = (b.maxZ - b.minZ) / 2 + 0.3;
      const cx = F.cx, cz = F.cz;
      const H = 5.4, SAG = 1.1;
      const poles = [];
      const nPoles = 7;
      for (let i = 0; i < nPoles; i++) {
        const a = Math.PI + (i / (nPoles - 1)) * Math.PI; // left, round the back, to the right
        poles.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
      }
      // the poles: one InstancedMesh
      const poleGeo = THREE.BufferGeometryUtils.mergeBufferGeometries([
        new THREE.CylinderGeometry(0.07, 0.09, H, 8).translate(0, H / 2, 0),
        new THREE.SphereGeometry(0.17, 10, 8).translate(0, H + 0.1, 0),
      ], false);
      const poleMat = new THREE.MeshLambertMaterial({ color: kind === "spooky" ? 0x5a3a6e : 0xfff1e0 });
      const pm = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
      const o = new THREE.Object3D();
      poles.forEach((p, i) => { o.position.set(p[0], 0, p[1]); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); });
      g.add(pm);
      // the strings: one LineSegments; the lights: sprites
      const pts = [];
      const SEG = 14;
      const lantern = kind === "cherry" || kind === "lanterns";
      const per = lantern ? 5 : 10;
      for (let s = 0; s < poles.length - 1; s++) {
        const [ax, az] = poles[s], [bx, bz] = poles[s + 1];
        const at = (u) => [ax + (bx - ax) * u, H - Math.sin(u * Math.PI) * SAG, az + (bz - az) * u];
        for (let k = 0; k < SEG; k++) { pts.push(...at(k / SEG), ...at((k + 1) / SEG)); }
        for (let k = 1; k <= per; k++) {
          const p = at(k / (per + 1));
          if (lantern) {
            const i = N.spawn(K.HANG);
            if (i < 0) continue;
            N.setPos(i, p[0], p[1] - 0.45, p[2]); N.setHome(i, p[0], p[1] - 0.45, p[2]);
            N.setLook(i, TILE.LANTERN, 0.75);
            N.setColor(i, kind === "cherry" ? pick(PAL.cherryLanterns) : pick(PAL.paperLanterns), 1);
            const h = G.spawn(K.HALO);
            if (h >= 0) { G.link[h] = i; G.aux[h] = N.gen[i]; G.setLook(h, TILE.GLOW, 1.6); G.setColor(h, PAL.warm, 0.5); G.setPos(h, p[0], p[1] - 0.45, p[2]); }
          } else {
            const i = G.spawn(K.TWINKLE);
            if (i < 0) continue;
            G.setPos(i, p[0], p[1] - 0.12, p[2]);
            G.setLook(i, TILE.GLOW, 0.85);
            const c = kind === "spooky" ? PAL.spookyLights[k % 2] : PAL.fairy[(k + s) % PAL.fairy.length];
            G.setColor(i, c, 1);
            G.spin[i] = rnd(1.5, 3.5); // twinkle speed
          }
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: kind === "spooky" ? 0x2a1a3a : 0x6b5a4a })));
      deco = { group: g, kind };
      group.add(g);
    }

    // ---------- night-time stars over the place ----------
    let starsOn = false;
    function setStars(on) {
      if (on === starsOn) return;
      starsOn = on;
      G.clear(K.STAR);
      if (!on) return;
      for (let s = 0; s < 260; s++) {
        const i = G.spawn(K.STAR);
        if (i < 0) break;
        const a = Math.random() * TAU, el = rnd(0.12, 1.35), r = 170;
        G.setPos(i, F.cx + Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, F.cz + Math.sin(a) * Math.cos(el) * r);
        G.setLook(i, Math.random() < 0.15 ? TILE.SPARKLE : TILE.GLOW, rnd(1.0, 2.2));
        G.setColor(i, pick(PAL.sparkle), rnd(0.5, 1));
        G.spin[i] = rnd(0.8, 3);
      }
    }

    // ---------- what to show for the current state ----------
    function plan() {
      want.fill(0);
      if (!world) return;
      const w = state.weather, s = state.season, fest = state.festival;
      const sky = !F.nowx; // weather can happen here
      wind = 0.6; rainSpeed = 18; splashChance = 0.3;
      if (sky) {
        if (w === "rain") { want[K.RAIN] = 1100; wind = 1.2; }
        if (w === "storm") { want[K.RAIN] = 1800; wind = 4.5; rainSpeed = 24; splashChance = 0.45; }
        if (w === "snow") { want[K.SNOW] = 1300; wind = 0.8; }
        if (w === "windy") {
          want[K.BLOWN] = 150; want[K.GUST] = 22; wind = 7;
        }
        // the seasons
        const calm = w !== "storm" && w !== "snow" && w !== "rain";
        if (s === "spring" && w !== "snow") want[K.PETAL] = w === "storm" || w === "rain" ? 80 : 260;
        if (s === "autumn" && w !== "snow") want[K.LEAF] = w === "rain" || w === "storm" ? 60 : 130;
        if (s === "summer" && w === "sunny" && !F.indoor) want[K.BUTTERFLY] = state.night ? 0 : 12;
        if (s === "winter" && w === "cloudy") want[K.SNOW] = 160; // a few flurries
        if (calm && s === "summer" && state.night && !F.indoor) want[K.SPARKLE] = 40; // fireflies!
      }
      // festivals
      if (fest === "cherry" && sky) { want[K.PETAL] = Math.max(want[K.PETAL], 480); }
      if (fest === "lanterns") want[K.LANTERN] = 70;
      if (fest === "spooky") {
        want[K.PUMPKIN] = 9; want[K.GHOST] = 7;
        if (!F.indoor) want[K.BAT] = 14;
      }
      if (fest === "snowfest") {
        want[K.SPARKLE] = 90;
        if (sky && want[K.SNOW] < 350) want[K.SNOW] = 350;
      }
      // clouds for gray weather
      cloudWant.setHex(w === "storm" ? 0x8a93a3 : w === "rain" ? 0xc2cad6 : w === "snow" ? 0xf2f6fa : 0xf4f7fa);
      // decorations and stars
      const decoKind = fest === "cherry" || fest === "lanterns" || fest === "snowfest" || fest === "spooky" ? fest : null;
      const key = world.id + "|" + decoKind;
      if (key !== decoKey) { decoKey = key; buildDeco(decoKind); }
      const clear = w === "sunny" || w === "windy";
      setStars(!F.nowx && !F.indoor && ((state.night && clear) || (fest === "starfall" && (state.night || clear))));
    }
    function wantClouds() {
      const w = state.weather;
      return !F.nowx && (w === "cloudy" || w === "rain" || w === "storm" || w === "snow");
    }

    // ---------- making new sprites ----------
    function spawnField(kind, filling) {
      const fall = kind === K.RAIN || kind === K.SNOW || kind === K.PETAL || kind === K.LEAF;
      if (fall) {
        const i = N.spawn(kind);
        if (i < 0) return;
        placeInField(N, i, !filling);
        if (kind === K.RAIN) {
          // (seen through a window, against a pale sky, rain needs to be a bit darker)
          N.setLook(i, TILE.RAIN, rnd(0.8, 1.15) * (F.indoor ? 1.3 : 1));
          N.setColor(i, F.indoor ? PAL.rainIndoor : PAL.rain, state.weather === "storm" || F.indoor ? 0.85 : 0.6);
          N.setVel(i, wind, -rainSpeed * rnd(0.9, 1.1), 0);
          N.info[i * 4 + 1] = -Math.atan2(wind, rainSpeed);
        } else if (kind === K.SNOW) {
          N.setLook(i, Math.random() < 0.3 ? TILE.FLAKE : TILE.DOT, rnd(0.22, 0.42) * (F.indoor ? 1.6 : 1));
          N.setColor(i, PAL.snow, rnd(0.8, 1));
          N.setVel(i, wind * 0.5, -rnd(1.1, 2.0), 0);
          N.spin[i] = rnd(-1.5, 1.5);
        } else if (kind === K.PETAL) {
          N.setLook(i, TILE.PETAL, rnd(0.32, 0.48));
          N.setColor(i, pick(PAL.petals), 1);
          N.setVel(i, wind * 0.7 + rnd(-0.3, 0.3), -rnd(0.7, 1.3), rnd(-0.3, 0.3));
          N.spin[i] = rnd(-2.5, 2.5);
        } else {
          N.setLook(i, Math.random() < 0.6 ? TILE.MAPLE : TILE.LEAF, rnd(0.4, 0.6));
          N.setColor(i, pick(PAL.autumn), 1);
          N.setVel(i, wind * 0.6 + rnd(-0.3, 0.3), -rnd(1.0, 1.6), rnd(-0.3, 0.3));
          N.spin[i] = rnd(-2, 2);
        }
        return;
      }
      if (kind === K.BLOWN) {
        const i = N.spawn(kind);
        if (i < 0) return;
        const s = state.season;
        placeInField(N, i, false);
        N.pos[i * 3 + 1] = rnd(0.3, 8);
        if (!filling) N.pos[i * 3] = F.x0;
        if (s === "spring") { N.setLook(i, TILE.PETAL, rnd(0.28, 0.4)); N.setColor(i, pick(PAL.petals), 1); }
        else if (s === "autumn") { N.setLook(i, Math.random() < 0.6 ? TILE.MAPLE : TILE.LEAF, rnd(0.4, 0.55)); N.setColor(i, pick(PAL.autumn), 1); }
        else if (s === "winter") { N.setLook(i, TILE.DOT, rnd(0.15, 0.3)); N.setColor(i, pick(PAL.winterBits), 0.9); }
        else { N.setLook(i, TILE.LEAF, rnd(0.35, 0.5)); N.setColor(i, pick(PAL.summerLeaves), 1); }
        N.setVel(i, wind * rnd(0.8, 1.4), 0, rnd(-0.5, 0.5));
        N.spin[i] = rnd(3, 7) * (Math.random() < 0.5 ? -1 : 1);
        return;
      }
      if (kind === K.GUST) {
        // a faint white "whoosh" line
        const i = N.spawn(kind);
        if (i < 0) return;
        placeInField(N, i, false);
        N.pos[i * 3 + 1] = rnd(0.8, 7);
        N.setLook(i, TILE.RAIN, rnd(2.2, 3.4));
        N.setColor(i, PAL.white, 0.55);
        N.info[i * 4 + 1] = -Math.PI / 2;
        N.info[i * 4 + 3] = 0.6;
        N.setVel(i, wind * 2.2, 0, 0);
        N.life[i] = rnd(0.8, 1.4);
        return;
      }
      if (kind === K.BUTTERFLY) {
        const i = N.spawn(kind);
        if (i < 0) return;
        const [x, z] = inArea(1);
        N.setPos(i, x, rnd(0.8, 2.6), z); N.setHome(i, 0, rnd(0.8, 2.6), 0);
        N.setLook(i, TILE.BUTTERFLY, rnd(0.7, 0.85));
        N.setColor(i, pick(PAL.butterflies), 1);
        N.aux[i] = Math.random() * TAU; // which way it's flying
        return;
      }
      if (kind === K.LANTERN) {
        const i = N.spawn(kind);
        if (i < 0) return;
        let x, z;
        if (F.indoor) { placeInField(N, i, false); x = N.pos[i * 3]; z = N.pos[i * 3 + 2]; }
        else if (Math.random() < 0.55) [x, z] = inArea(0); // from the place itself
        else { x = rnd(F.x0, F.x1); z = rnd(F.z0, F.bz0); } // from far behind
        const y = filling ? rnd(0.5, F.y1 + 6) : (F.indoor ? F.y0 + 10 : 0.6);
        N.setPos(i, x, y, z);
        N.setLook(i, TILE.LANTERN, rnd(0.8, 1.1));
        N.setColor(i, pick(PAL.paperLanterns), 1);
        N.setVel(i, wind * 0.15, rnd(0.55, 0.95), 0);
        const h = G.spawn(K.HALO);
        if (h >= 0) { G.link[h] = i; G.aux[h] = N.gen[i]; G.setLook(h, TILE.GLOW, 2.4); G.setColor(h, PAL.warm, state.night ? 0.55 : 0.3); G.setPos(h, x, y, z); }
        return;
      }
      if (kind === K.PUMPKIN || kind === K.GHOST) {
        const i = N.spawn(kind);
        if (i < 0) return;
        let x, z;
        if (kind === K.PUMPKIN) {
          // around the edge of the area
          const a = Math.PI * rnd(0.85, 2.15); // (round the back and sides, not right in front of the camera)
          x = F.cx + Math.cos(a) * ((F.bx1 - F.bx0) / 2 - 0.5);
          z = F.cz + Math.sin(a) * ((F.bz1 - F.bz0) / 2 - 0.5);
        } else [x, z] = inArea(1);
        const y = kind === K.PUMPKIN ? rnd(1.6, 3.2) : rnd(1.8, 3.6);
        N.setPos(i, x, y, z); N.setHome(i, x, y, z);
        if (kind === K.PUMPKIN) {
          N.setLook(i, TILE.PUMPKIN, rnd(1.0, 1.3)); N.setColor(i, PAL.white, 1);
          const h = G.spawn(K.HALO);
          if (h >= 0) { G.link[h] = i; G.aux[h] = N.gen[i]; G.setLook(h, TILE.GLOW, 2.6); G.setColor(h, hex(0xff8a20), 0.45); G.setPos(h, x, y, z); }
        } else {
          N.setLook(i, TILE.GHOST, rnd(1.2, 1.6)); N.setColor(i, PAL.white, 0.85);
          N.aux[i] = Math.random() * TAU;
        }
        return;
      }
      if (kind === K.BAT) {
        const i = N.spawn(kind);
        if (i < 0) return;
        const [x, z] = inArea(2);
        N.setHome(i, x, rnd(5, 10), z);
        N.setLook(i, TILE.BAT, rnd(0.7, 1.0)); N.setColor(i, PAL.white, 1);
        N.aux[i] = rnd(3, 8);                                     // circle size
        N.spin[i] = rnd(0.8, 1.5) * (Math.random() < 0.5 ? -1 : 1); // how fast it circles
        N.setPos(i, x, N.home[i * 3 + 1], z);
        return;
      }
      if (kind === K.SPARKLE) {
        const i = G.spawn(kind);
        if (i < 0) return;
        let x, z;
        if (F.indoor || state.festival !== "snowfest") [x, z] = inArea(0.5);
        else { x = rnd(F.x0 * 0.7, F.x1 * 0.7); z = rnd(F.z0 * 0.7, F.bz1); }
        G.setPos(i, x, rnd(0.4, 5), z);
        const firefly = state.festival !== "snowfest";
        G.setLook(i, firefly ? TILE.GLOW : (Math.random() < 0.5 ? TILE.SPARKLE : TILE.STAR), firefly ? 0.35 : rnd(0.3, 0.5));
        G.setColor(i, firefly ? hex(0xd8ff7a) : pick(PAL.fairy), 1);
        G.setVel(i, rnd(-0.2, 0.2), rnd(0.1, 0.4), rnd(-0.2, 0.2));
        G.life[i] = rnd(3, 6);
        G.spin[i] = rnd(2, 5);
      }
    }

    // ---------- fireworks ----------
    const burstPos = new THREE.Vector3();
    function launchFirework() {
      // far away (over the sea in the park), so they're never behind the trees
      // (at least 9 high, so the sparks don't fall into the sea)
      const dist = skyPoint(rnd(-0.75, 0.75), rnd(0.25, 0.72), F.indoor ? rnd(55, 80) : rnd(75, 105), burstPos, 9);
      const i = G.spawn(K.SHELL);
      if (i < 0) return;
      const big = dist / 50; // further away = bigger, so they look the same size on screen
      const rise = rnd(10, 14) * big;
      G.setPos(i, burstPos.x, burstPos.y - rise, burstPos.z);
      G.setHome(i, burstPos.x, burstPos.y, burstPos.z);
      G.setVel(i, rnd(-0.6, 0.6), rise / 0.9, 0);
      G.aux[i] = 0;
      G.setLook(i, TILE.GLOW, 0.7 * big);
      G.spin[i] = big; // (remembered for the burst)
      G.setColor(i, PAL.gold, 1);
    }
    const bdir = new THREE.Vector3();
    function burst(x, y, z, big) {
      const shape = pick(["peony", "peony", "two", "ring", "heart", "willow", "star"]);
      const c1 = shape === "willow" ? PAL.gold : pick(PAL.fireworks);
      let c2 = pick(PAL.fireworks);
      if (c2 === c1) c2 = PAL.white;
      const n = shape === "heart" ? 64 : shape === "ring" ? 56 : 80;
      const speed = (shape === "willow" ? 10 : rnd(12, 15)) * big;
      // ring: a tilted circle; heart & star: drawn flat, facing the camera
      const tilt = rnd(-0.6, 0.6);
      for (let k = 0; k < n; k++) {
        const i = G.spawn(K.SPARK);
        if (i < 0) break;
        let col = c1, sp = speed;
        if (shape === "peony" || shape === "willow" || shape === "two") {
          // an even-ish ball of directions
          const u = (k + 0.5) / n, a = k * 2.39996;
          const r = Math.sqrt(1 - (2 * u - 1) * (2 * u - 1));
          bdir.set(Math.cos(a) * r, 2 * u - 1, Math.sin(a) * r);
          if (shape === "two" && k % 2) { col = c2; sp *= 0.6; }
        } else if (shape === "ring") {
          const a = (k / n) * TAU;
          bdir.copy(camRight).multiplyScalar(Math.cos(a)).addScaledVector(camUp, Math.sin(a) * Math.cos(tilt));
          bdir.y += Math.sin(a) * Math.sin(tilt);
          if (k % 4 === 0) col = c2;
        } else if (shape === "heart") {
          const a = (k / n) * TAU;
          const hx = 16 * Math.pow(Math.sin(a), 3);
          const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
          bdir.copy(camRight).multiplyScalar(hx / 16).addScaledVector(camUp, hy / 16);
          col = hex(0xff6fae);
        } else {
          // a five-pointed star outline
          const a = (k / n) * TAU, pts = 5;
          const m = (a * pts) / TAU, f = m - Math.floor(m);
          const r = 0.45 + 0.55 * Math.abs(1 - 2 * f);
          bdir.copy(camRight).multiplyScalar(Math.sin(a) * r).addScaledVector(camUp, Math.cos(a) * r);
          col = PAL.fireworks[1];
        }
        G.setPos(i, x, y, z);
        G.setVel(i, bdir.x * sp, bdir.y * sp, bdir.z * sp);
        G.setLook(i, TILE.GLOW, (shape === "willow" ? 0.9 : 1.25) * big);
        G.setColor(i, col, 1);
        G.life[i] = shape === "willow" ? rnd(2.2, 2.8) : rnd(1.3, 1.8);
        G.spin[i] = shape === "willow" ? big : -big; // (how big; willow (+): droopy and golden)
        G.aux[i] = Math.random() * 0.05;      // trail timer
      }
      // a little flash of light in the sky's color
      flash.amt = Math.max(flash.amt, state.night ? 0.32 : 0.15);
      flash.color.setRGB(c1[0] * 0.6 + 0.4, c1[1] * 0.6 + 0.4, c1[2] * 0.6 + 0.4);
    }
    // a fading dot left behind by a spark, rocket or shooting star (color r, g, b)
    function trail(x, y, z, r, g, b, size, life, alpha) {
      const i = G.spawn(K.TRAIL);
      if (i < 0) return;
      G.setPos(i, x, y, z);
      G.setLook(i, TILE.GLOW, size);
      G.col[i * 4] = r; G.col[i * 4 + 1] = g; G.col[i * 4 + 2] = b;
      G.alpha[i] = alpha;
      G.life[i] = life;
    }

    // ---------- shooting stars ----------
    function launchShootingStar() {
      // far away, high up on the screen, flying across it and a little bit down
      const dist = skyPoint(rnd(-0.95, 0.5), rnd(0.45, 0.95), rnd(80, 150), burstPos, 12), big = dist / 80;
      const i = G.spawn(K.SHOOT);
      if (i < 0) return;
      G.setPos(i, burstPos.x, burstPos.y, burstPos.z);
      const dx = rnd(0.75, 1), dy = -rnd(0.15, 0.4), sp = rnd(40, 55) * big;
      bdir.copy(camRight).multiplyScalar(Math.random() < 0.25 ? -dx : dx).addScaledVector(camUp, dy).normalize().multiplyScalar(sp);
      G.setVel(i, bdir.x, bdir.y, bdir.z);
      G.setLook(i, TILE.STAR, 2.6 * big);
      G.setColor(i, Math.random() < 0.7 ? PAL.white : pick(PAL.sparkle), 1);
      G.life[i] = rnd(0.9, 1.3);
      G.spin[i] = rnd(-4, 4);
    }

    // ---------- lightning ----------
    function lightning() {
      flash.amt = 1.3;
      flash.color.setHex(0xe9e6ff);
      timers.flicker = 0.12; // a second, smaller flash just after
      const dist = skyPoint(rnd(-0.8, 0.8), rnd(0.35, 0.8), rnd(70, 95), burstPos, 10);
      const i = G.spawn(K.BOLT);
      if (i >= 0) {
        G.setPos(i, burstPos.x, burstPos.y, burstPos.z);
        G.setLook(i, TILE.BOLT, rnd(14, 22) * dist / 80);
        G.setColor(i, PAL.white, 1);
        G.life[i] = 0.35;
        G.info[i * 4 + 1] = rnd(-0.25, 0.25);
      }
    }

    // ---------- every frame ----------
    function stepNormal(dt, t) {
      const P = N, n = P.n, pos = P.pos, vel = P.vel, info = P.info, col = P.col;
      for (let i = 0; i < n; i++) {
        const k = P.kind[i];
        if (!k) continue;
        P.age[i] += dt;
        const age = P.age[i];
        // fade in when born, fade out at the end of its life
        if (over[k] > 0 && !P.retiring[i] && P.life[i] > age + 1) { P.retiring[i] = 1; retiringCount[k]++; over[k]--; P.life[i] = age + 0.9; }
        const left = P.life[i] - age;
        if (left <= 0) { P.kill(i); continue; }
        let fade = Math.min(1, age * 2.5, left * 1.6);
        const j = i * 3;
        const ph = P.phase[i];
        switch (k) {
          case K.RAIN:
          case K.SNOW:
          case K.PETAL:
          case K.LEAF: {
            let vx = vel[j] + (wind * (k === K.RAIN ? 1 : 0.7) - vel[j]) * Math.min(1, dt * 0.8);
            vel[j] = vx;
            if (k !== K.RAIN) {
              // drifting from side to side
              const sway = k === K.SNOW ? 0.5 : 1.1;
              vx += Math.sin(t * 1.3 + ph) * sway;
              pos[j + 2] += Math.cos(t * 1.1 + ph * 1.7) * sway * 0.5 * dt;
              info[i * 4 + 1] += P.spin[i] * dt;
              if (k !== K.SNOW) info[i * 4 + 3] = 0.25 + 0.75 * Math.abs(Math.cos(t * 2.2 + ph)); // tumbling
            } else {
              info[i * 4 + 1] = -Math.atan2(vx, -vel[j + 1]);
            }
            pos[j] += vx * dt;
            pos[j + 1] += vel[j + 1] * dt;
            if (pos[j] > F.x1) pos[j] -= F.x1 - F.x0;
            else if (pos[j] < F.x0) pos[j] += F.x1 - F.x0;
            const ground = F.ground + (k === K.RAIN ? 0 : 0.05);
            if (pos[j + 1] < ground) {
              if (k === K.RAIN && !F.indoor && Math.random() < splashChance &&
                  pos[j] > F.bx0 - 8 && pos[j] < F.bx1 + 8 && pos[j + 2] > F.bz0 - 8 && pos[j + 2] < F.bz1 + 8) splash(pos[j], pos[j + 2]);
              if (P.retiring[i]) { P.kill(i); continue; }
              placeInField(P, i, true);
              P.age[i] = 0.4; // (no fade-in needed, it comes from above)
            }
            break;
          }
          case K.SPLASH: {
            const u = age / P.life[i];
            info[i * 4] = P.base[i] * (0.4 + u * 0.8);
            fade = 1 - u;
            break;
          }
          case K.BLOWN: {
            pos[j] += vel[j] * dt;
            pos[j + 1] += Math.sin(t * 2.3 + ph) * 1.2 * dt;
            pos[j + 2] += vel[j + 2] * dt;
            info[i * 4 + 1] += P.spin[i] * dt;
            info[i * 4 + 3] = 0.3 + 0.7 * Math.abs(Math.cos(t * 3 + ph));
            if (pos[j] > F.x1) {
              if (P.retiring[i]) { P.kill(i); continue; }
              pos[j] = F.x0; pos[j + 1] = rnd(0.3, 8);
            }
            if (pos[j + 1] < 0.1) pos[j + 1] = 0.1;
            break;
          }
          case K.GUST:
            pos[j] += vel[j] * dt;
            fade = Math.sin(Math.min(1, age / P.life[i]) * Math.PI);
            break;
          case K.BUTTERFLY: {
            // flutter about, turning now and then, staying in the area
            let a = P.aux[i] + Math.sin(t * 0.9 + ph) * 1.6 * dt;
            const x = pos[j], z = pos[j + 2];
            if (x < F.bx0 + 1 || x > F.bx1 - 1 || z < F.bz0 + 1 || z > F.bz1 - 1) {
              const back = Math.atan2(F.cz - z, F.cx - x);
              a += Math.sin(back - a) * 2.5 * dt;
            }
            P.aux[i] = a;
            pos[j] += Math.cos(a) * 1.4 * dt;
            pos[j + 2] += Math.sin(a) * 1.4 * dt;
            pos[j + 1] = P.home[j + 1] + Math.sin(t * 2.1 + ph) * 0.35;
            info[i * 4 + 3] = 0.2 + 0.8 * Math.abs(Math.sin(t * 13 + ph)); // flap!
            info[i * 4 + 1] = Math.sin(t * 3 + ph) * 0.25;
            break;
          }
          case K.LANTERN:
            pos[j] += (vel[j] + Math.sin(t * 0.7 + ph) * 0.25) * dt;
            pos[j + 1] += vel[j + 1] * dt;
            pos[j + 2] += Math.cos(t * 0.6 + ph) * 0.2 * dt;
            info[i * 4 + 1] = Math.sin(t * 1.1 + ph) * 0.12;
            if (pos[j + 1] > F.y1 + 14 && left > 2) P.life[i] = age + 2; // float away and fade
            break;
          case K.HANG:
            // swinging gently on its string
            info[i * 4 + 1] = Math.sin(t * 1.4 + ph) * 0.12;
            pos[j] = P.home[j] + Math.sin(t * 1.4 + ph) * 0.04;
            break;
          case K.PUMPKIN:
            pos[j + 1] = P.home[j + 1] + Math.sin(t * 1.5 + ph) * 0.25;
            info[i * 4 + 1] = Math.sin(t * 1.1 + ph) * 0.15;
            break;
          case K.GHOST: {
            // drift about slowly, see-through and wobbly
            let a = P.aux[i] + Math.sin(t * 0.5 + ph) * 0.8 * dt;
            const x = pos[j], z = pos[j + 2];
            if (x < F.bx0 + 1 || x > F.bx1 - 1 || z < F.bz0 + 1 || z > F.bz1 - 1) {
              const back = Math.atan2(F.cz - z, F.cx - x);
              a += Math.sin(back - a) * 2 * dt;
            }
            P.aux[i] = a;
            pos[j] += Math.cos(a) * 0.9 * dt;
            pos[j + 2] += Math.sin(a) * 0.9 * dt;
            pos[j + 1] = P.home[j + 1] + Math.sin(t * 1.3 + ph) * 0.4;
            info[i * 4 + 1] = Math.sin(t * 1.7 + ph) * 0.18;
            info[i * 4 + 3] = 1 + Math.sin(t * 2.6 + ph) * 0.06;
            fade *= 0.75 + 0.25 * Math.sin(t * 1.9 + ph);
            break;
          }
          case K.BAT: {
            const a = t * P.spin[i] + ph, r = P.aux[i];
            pos[j] = P.home[j] + Math.cos(a) * r;
            pos[j + 2] = P.home[j + 2] + Math.sin(a) * r * 0.6;
            pos[j + 1] = P.home[j + 1] + Math.sin(a * 2.3) * 0.8;
            info[i * 4 + 3] = 0.35 + 0.65 * Math.abs(Math.sin(t * 11 + ph)); // flap
            break;
          }
        }
        col[i * 4 + 3] = P.alpha[i] * fade;
      }
    }

    function stepGlow(dt, t) {
      const P = G, n = P.n, pos = P.pos, vel = P.vel, info = P.info, col = P.col;
      for (let i = 0; i < n; i++) {
        const k = P.kind[i];
        if (!k) continue;
        P.age[i] += dt;
        const age = P.age[i];
        if (over[k] > 0 && !P.retiring[i] && P.life[i] > age + 1) { P.retiring[i] = 1; retiringCount[k]++; over[k]--; P.life[i] = age + 0.9; }
        const left = P.life[i] - age;
        if (left <= 0) { P.kill(i); continue; }
        let fade = Math.min(1, age * 2.5, left * 1.6);
        const j = i * 3;
        const ph = P.phase[i];
        switch (k) {
          case K.SHELL: {
            const big = P.spin[i];
            vel[j + 1] -= 9 * big * dt;
            pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
            P.aux[i] -= dt;
            if (P.aux[i] <= 0) {
              // a golden trail (fainter as it slows down, so it doesn't pile up at the top)
              P.aux[i] = 0.035;
              trail(pos[j], pos[j + 1], pos[j + 2], PAL.gold[0], PAL.gold[1], PAL.gold[2], 0.35 * big, 0.4, clamp(vel[j + 1] / (14 * big), 0, 0.6));
            }
            if (vel[j + 1] <= 2 * big || pos[j + 1] >= P.home[j + 1]) { burst(pos[j], pos[j + 1], pos[j + 2], big); P.kill(i); continue; }
            break;
          }
          case K.SPARK: {
            const willow = P.spin[i] > 0, big = willow ? P.spin[i] : -P.spin[i];
            const drag = Math.exp(-dt * (willow ? 2.2 : 1.7));
            vel[j] *= drag; vel[j + 1] = vel[j + 1] * drag - (willow ? 4.5 : 2.6) * big * dt; vel[j + 2] *= drag;
            pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
            const u = age / P.life[i];
            info[i * 4] = P.base[i] * (1 - u * 0.5) * Math.min(1, 0.3 + age * 4); // (start small and faint:
            fade = (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3) * Math.min(1, 0.25 + age * 5); //  no big white blob)
            if (u > 0.55 && !willow) fade *= 0.6 + 0.4 * Math.sin(t * 40 + ph); // crackle at the end
            P.aux[i] -= dt;
            if (P.aux[i] <= 0 && age > 0.08) {
              P.aux[i] = willow ? 0.035 : 0.05;
              if (willow) trail(pos[j], pos[j + 1], pos[j + 2], PAL.gold[0], PAL.gold[1], PAL.gold[2], P.base[i] * 0.7, 0.9, 0.6 * fade);
              else trail(pos[j], pos[j + 1], pos[j + 2], col[i * 4], col[i * 4 + 1], col[i * 4 + 2], P.base[i] * 0.7, 0.4, 0.45 * fade);
            }
            break;
          }
          case K.TRAIL: {
            const u = age / P.life[i];
            info[i * 4] = P.base[i] * (1 - u * 0.7);
            pos[j + 1] -= 0.6 * dt;
            fade = 1 - u;
            break;
          }
          case K.SHOOT: {
            pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
            info[i * 4 + 1] += P.spin[i] * dt;
            // a smooth tail: drop a dot every 1/80 of a second (even when the frame rate is low)
            P.aux[i] -= dt;
            while (P.aux[i] <= 0) {
              const back = -P.aux[i];
              trail(pos[j] - vel[j] * back, pos[j + 1] - vel[j + 1] * back, pos[j + 2] - vel[j + 2] * back,
                col[i * 4], col[i * 4 + 1], col[i * 4 + 2], P.base[i] * 0.6, 0.6, 0.8 * fade);
              P.aux[i] += 0.0125;
            }
            break;
          }
          case K.TWINKLE:
          case K.STAR:
            info[i * 4] = P.base[i] * (0.7 + 0.3 * Math.sin(t * P.spin[i] + ph));
            fade *= 0.75 + 0.25 * Math.sin(t * P.spin[i] * 1.3 + ph);
            break;
          case K.SPARKLE:
            pos[j] += (vel[j] + Math.sin(t + ph) * 0.3) * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
            fade *= 0.5 + 0.5 * Math.sin(t * P.spin[i] + ph);
            info[i * 4 + 1] += dt;
            break;
          case K.HALO: {
            // follows its lantern / pumpkin (and goes when it goes)
            const m = P.link[i];
            if (m < 0 || N.gen[m] !== P.aux[i] || !N.kind[m]) { P.kill(i); continue; }
            pos[j] = N.pos[m * 3]; pos[j + 1] = N.pos[m * 3 + 1]; pos[j + 2] = N.pos[m * 3 + 2];
            fade = (N.col[m * 4 + 3] / Math.max(0.01, N.alpha[m])) * (0.85 + 0.15 * Math.sin(t * 7 + ph));
            break;
          }
          case K.BOLT:
            fade = Math.random() < 0.8 ? 1 : 0.3; // flicker
            break;
        }
        col[i * 4 + 3] = P.alpha[i] * fade;
      }
    }

    function splash(x, z) {
      const i = N.spawn(K.SPLASH);
      if (i < 0) return;
      N.setPos(i, x, F.ground + 0.08, z);
      N.setLook(i, TILE.SPLASH, rnd(0.45, 0.65));
      N.setColor(i, PAL.rain, 0.7);
      N.life[i] = 0.3;
    }

    function update(dt, t) {
      if (!world || disposed) return;
      dt = Math.min(dt || 0, 0.1);
      updateField();
      readCamera();

      // timers for things that come and go
      const fest = state.festival;
      if (fest === "fireworks") {
        timers.firework -= dt;
        if (timers.firework <= 0) {
          launchFirework();
          if (Math.random() < 0.3) launchFirework();
          timers.firework = rnd(0.7, 1.8);
        }
      }
      if (fest === "starfall") {
        timers.shooting -= dt;
        if (timers.shooting <= 0) { launchShootingStar(); timers.shooting = rnd(0.2, 0.7); }
      }
      if (state.weather === "storm" && !F.nowx) {
        timers.lightning -= dt;
        if (timers.lightning <= 0) { lightning(); timers.lightning = rnd(3, 8); }
      }
      if (timers.flicker > 0) {
        timers.flicker -= dt;
        if (timers.flicker <= 0) flash.amt = Math.max(flash.amt, 0.9);
      }
      flash.amt = Math.max(0, flash.amt - dt * (flash.amt > 0.5 ? 6 : 2.5));

      // keep "this many" of each kind of falling / floating thing
      for (const k of FIELD_KINDS) {
        const live = count[k] - retiringCount[k];
        over[k] = live - want[k];
        if (live < want[k]) {
          // fill up quickly at first, then keep topping up
          const filling = count[k] < want[k] * 0.5;
          let n = Math.min(want[k] - live, Math.ceil(Math.max(4, want[k] * (filling ? 2 : 0.6)) * dt));
          if (k === K.GUST) n = Math.random() < dt * 10 ? 1 : 0;
          if (k === K.LANTERN && !filling) n = Math.random() < dt * 4 ? 1 : 0;
          if (k === K.SPARKLE && !filling) n = Math.random() < dt * 12 ? 1 : 0;
          for (let s = 0; s < n; s++) spawnField(k, filling);
        }
      }

      stepNormal(dt, t || 0);
      stepGlow(dt, t || 0);
      N.upload(); G.upload();

      // clouds drift round slowly, and grow in or shrink away
      const cw = wantClouds() ? 1 : 0;
      cloudsShown += (cw - cloudsShown) * Math.min(1, dt * 1.5);
      clouds.visible = cloudsShown > 0.02;
      if (clouds.visible) {
        clouds.position.set(F.cx, 0, F.cz);
        clouds.rotation.y = (t || 0) * 0.004;
        clouds.scale.setScalar(0.3 + 0.7 * cloudsShown);
        cloudColor.lerp(cloudWant, Math.min(1, dt * 2));
        // half lit by the place's lights, half glowing by itself (so clouds stay soft and gray, not green)
        cloudMat.color.copy(cloudColor).multiplyScalar(0.55);
        cloudMat.emissive.copy(cloudColor).multiplyScalar(0.45 * (0.4 + 0.6 * cur.light));
      }

      applyMood(dt);
    }

    // ---------- the public bits ----------
    function setWorld(w) {
      if (disposed) return;
      if (world) restore(); // (the old place might come back later, e.g. after a home visit)
      world = w || null;
      N.clear(); G.clear();
      count.fill(0); retiringCount.fill(0);
      starsOn = false;
      clearDeco();
      decoKey = "";
      cloudsShown = 0;
      if (!world) return;
      remember();
      updateField();
      // Indoors, rain and fireworks are outside, behind the window glass: draw them
      // before the glass (or the glass would hide them). Outdoors, draw them last.
      N.points.renderOrder = F.indoor ? -2 : 10;
      G.points.renderOrder = F.indoor ? -1 : 11;
      readCamera();
      plan();
      computeMood();
      snapMood();
      applyMood();
      // fill the air straight away, so it doesn't look empty for a moment
      for (const k of FIELD_KINDS) for (let s = count[k]; s < want[k]; s++) spawnField(k, true);
      cloudsShown = wantClouds() ? 1 : 0;
    }

    function set(s) {
      if (disposed || !s) return;
      const before = state.weather + "|" + state.season;
      Object.assign(state, s);
      if (!state.weather) state.weather = "sunny";
      if (!world) return;
      plan();
      computeMood();
      // new season while windy: swap the blown leaves/petals for the new kind
      if (before !== state.weather + "|" + state.season && state.weather === "windy") N.clear(K.BLOWN);
    }

    let disposed = false;
    function dispose() {
      if (disposed) return;
      if (world) restore();
      clearDeco();
      disposed = true;
      hub.scene.remove(group);
      N.dispose(); G.dispose();
      clouds.geometry.dispose(); cloudMat.dispose();
      atlas.dispose();
      world = null;
    }

    return {
      group,
      setWorld,
      set,
      update,
      dispose,
      get state() { return Object.assign({}, state); },
      // (for testing) how many sprites are alive
      stats() { return { normal: N.alive, glow: G.alive }; },
    };
  }

  root.Weather3D = { create };
})(typeof self !== "undefined" ? self : this);
