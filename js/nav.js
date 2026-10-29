/*
 * nav.js
 * Route-finding, so Miis walk AROUND things (trees, desks, the pond...)
 * instead of getting stuck on them or walking on water.
 *
 * The walkable area is split into a grid of small squares. Squares covered
 * by an obstacle are marked "blocked". To get from A to B, we search the grid
 * for the shortest route (the A* algorithm), then straighten the route so
 * Miis walk in smooth lines instead of zig-zagging from square to square.
 *
 * Obstacle shapes (all on the ground, x/z):
 *   { x, z, r }                 circle
 *   { x, z, rx, rz }            oval (like the pond)
 *   { x, z, w, d, rot }         rectangle (like a desk), rot in radians
 *   { x, z, rx, rz, outside }   everything outside an oval (the edge of an island)
 */
(function (root) {
  "use strict";

  const MII_RADIUS = 0.45; // how much room a Mii needs around obstacles when planning a route
  // While walking, a Mii may get a little closer than that (after being bumped,
  // or when cutting a corner) before it counts as "touching" something.
  const MOVE_PAD = 0.28;

  function insideShape(o, x, z, pad) {
    const dx = x - o.x, dz = z - o.z;
    if (o.outside) {
      // everything OUTSIDE this oval is blocked (e.g. the sea around the island)
      const ax = o.rx - pad, az = o.rz - pad;
      return (dx * dx) / (ax * ax) + (dz * dz) / (az * az) > 1;
    }
    if (o.w !== undefined) {
      const c = Math.cos(-(o.rot || 0)), s = Math.sin(-(o.rot || 0));
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < o.w / 2 + pad && Math.abs(lz) < o.d / 2 + pad;
    }
    if (o.rx !== undefined) {
      const ax = o.rx + pad, az = o.rz + pad;
      return (dx * dx) / (ax * ax) + (dz * dz) / (az * az) < 1;
    }
    return dx * dx + dz * dz < (o.r + pad) * (o.r + pad);
  }

  class Nav {
    constructor(bounds, obstacles, cell) {
      this.bounds = bounds;
      this.obstacles = obstacles;
      this.cell = cell || 0.35;
      this.cols = Math.ceil((bounds.maxX - bounds.minX) / this.cell) + 1;
      this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / this.cell) + 1;
      this.blocked = new Uint8Array(this.cols * this.rows);
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const p = this.cellCenter(c, r);
          if (this.isBlocked(p.x, p.z)) this.blocked[r * this.cols + c] = 1;
        }
      }
    }

    // Is this exact spot inside an obstacle (with room for a Mii)?
    isBlocked(x, z, pad) {
      if (pad === undefined) pad = MII_RADIUS;
      const b = this.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
      for (const o of this.obstacles) if (insideShape(o, x, z, pad)) return true;
      // other Miis standing around (only while planning a route, see findPath)
      if (this.others) {
        for (const o of this.others) {
          const dx = x - o.x, dz = z - o.z, rr = o.r + pad;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
      return false;
    }

    cellCenter(c, r) {
      return { x: this.bounds.minX + c * this.cell, z: this.bounds.minZ + r * this.cell };
    }

    cellOf(x, z) {
      const c = Math.round((x - this.bounds.minX) / this.cell);
      const r = Math.round((z - this.bounds.minZ) / this.cell);
      return { c: Math.max(0, Math.min(this.cols - 1, c)), r: Math.max(0, Math.min(this.rows - 1, r)) };
    }

    // The grid square for a spot. (A free spot right next to a wall can land on a blocked
    // square: then a free square next to it, in a straight line from the spot, is used.)
    cellNear(p) {
      const k = this.cellOf(p.x, p.z);
      if (this.free(k.c, k.r)) return k;
      const near = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const q = this.cellCenter(k.c + dc, k.r + dr);
        near.push({ c: k.c + dc, r: k.r + dr, d: Math.hypot(q.x - p.x, q.z - p.z), q });
      }
      near.sort((a, b) => a.d - b.d);
      const ok = near.find((n) => this.free(n.c, n.r) && this.clearLine(p.x, p.z, n.q.x, n.q.z));
      return ok ? { c: ok.c, r: ok.r } : k;
    }

    free(c, r) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c]) return false;
      if (this.others) {
        const p = this.cellCenter(c, r);
        for (const o of this.others) {
          const dx = p.x - o.x, dz = p.z - o.z, rr = o.r + MII_RADIUS;
          if (dx * dx + dz * dz < rr * rr) return false;
        }
      }
      return true;
    }

    // The closest open spot to (x, z) - used if a Mii ends up somewhere it shouldn't be.
    nearestFree(x, z) {
      if (!this.isBlocked(x, z)) return { x, z };
      const start = this.cellOf(x, z);
      const seen = new Uint8Array(this.cols * this.rows);
      const queue = [start];
      seen[start.r * this.cols + start.c] = 1;
      while (queue.length) {
        const { c, r } = queue.shift();
        if (this.free(c, r)) return this.cellCenter(c, r);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const k = nr * this.cols + nc;
          if (!seen[k]) { seen[k] = 1; queue.push({ c: nc, r: nr }); }
        }
      }
      return { x, z };
    }

    randomFree(rand) {
      rand = rand || Math.random;
      for (let i = 0; i < 200; i++) {
        const c = Math.floor(rand() * this.cols), r = Math.floor(rand() * this.rows);
        if (this.free(c, r)) return this.cellCenter(c, r);
      }
      return this.nearestFree(0, 0);
    }

    // Can a Mii walk in a straight line from a to b without touching anything?
    // `others` (optional) = Miis to walk around, as circles { x, z, r }.
    // `pad` (optional) = how much room to leave (default MII_RADIUS).
    clearLine(ax, az, bx, bz, others, pad) {
      if (others) {
        const saved = this.others;
        this.others = others;
        try { return this.clearLine(ax, az, bx, bz, null, pad); } finally { this.others = saved; }
      }
      const d = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(d / (this.cell * 0.5));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (this.isBlocked(ax + (bx - ax) * t, az + (bz - az) * t, pad)) return false;
      }
      return true;
    }

    // Returns a list of points from (sx, sz) to (tx, tz), or null if there's no way there.
    // `others` (optional) = Miis standing in the way, as circles { x, z, r }. We try to
    // walk around them, but if they block every route (a crowd), we ignore them.
    findPath(sx, sz, tx, tz, others) {
      if (others && others.length) {
        // never treat the Miis at the goal as blockers (we might be going to meet them).
        // Miis right next to the start still count: the route starts from the
        // nearest free spot and goes around them, instead of squeezing past.
        const near = (o, x, z) => Math.hypot(o.x - x, o.z - z) < o.r + MII_RADIUS + 0.3;
        this.others = others.filter((o) => !near(o, tx, tz));
        try {
          const path = this.findPathInner(sx, sz, tx, tz);
          if (path) return path;
        } finally {
          this.others = null;
        }
      }
      return this.findPathInner(sx, sz, tx, tz);
    }

    findPathInner(sx, sz, tx, tz) {
      const goalPt = this.nearestFree(tx, tz);
      if (this.clearLine(sx, sz, goalPt.x, goalPt.z)) return [goalPt];

      const startPt = this.nearestFree(sx, sz);
      const s = this.cellNear(startPt);
      const g = this.cellNear(goalPt);
      const cols = this.cols;
      const N = cols * this.rows;
      const gScore = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const startK = s.r * cols + s.c, goalK = g.r * cols + g.c;
      const h = (k) => {
        const c = k % cols, r = (k / cols) | 0;
        const dx = Math.abs(c - g.c), dz = Math.abs(r - g.r);
        return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
      };
      // a small "binary heap" priority queue
      const heap = [];
      const push = (k, f) => {
        heap.push([f, k]);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1, r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top[1];
      };

      gScore[startK] = 0;
      push(startK, h(startK));
      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
      let found = false;
      let guard = 0;
      while (heap.length && guard++ < N * 4) {
        const k = pop();
        if (closed[k]) continue;
        if (k === goalK) { found = true; break; }
        closed[k] = 1;
        const c = k % cols, r = (k / cols) | 0;
        for (const [dc, dr, cost] of dirs) {
          const nc = c + dc, nr = r + dr;
          if (!this.free(nc, nr)) continue;
          // don't cut corners past obstacles
          if (dc && dr && (!this.free(c + dc, r) || !this.free(c, r + dr))) continue;
          const nk = nr * cols + nc;
          const ng = gScore[k] + cost;
          if (ng < gScore[nk]) {
            gScore[nk] = ng;
            came[nk] = k;
            push(nk, ng + h(nk));
          }
        }
      }
      if (!found) return null;

      // walk back from the goal to get the route
      const cells = [];
      for (let k = goalK; k !== -1; k = came[k]) cells.push(this.cellCenter(k % cols, (k / cols) | 0));
      cells.reverse();
      cells[cells.length - 1] = goalPt;

      // straighten: skip any points we can see past
      const path = [];
      let from = { x: sx, z: sz };
      let i = 0;
      while (i < cells.length) {
        let j = cells.length - 1;
        while (j > i && !this.clearLine(from.x, from.z, cells[j].x, cells[j].z)) j--;
        path.push(cells[j]);
        from = cells[j];
        i = j + 1;
      }
      return path;
    }
  }

  root.MiiNav = { Nav, insideShape, MII_RADIUS, MOVE_PAD };
})(typeof self !== "undefined" ? self : this);
