#!/usr/bin/env node
/*
 * tools/measure-office.js
 * Measures the office's 3D model (models/office-a223.stl) so the office in js/nscc/office.js
 * can be built from it. Plain Node, nothing to install:
 *
 *   node tools/measure-office.js                      (measures models/office-a223.stl)
 *   node tools/measure-office.js my-model.stl --svg plan.svg --at 60
 *
 * It prints, in the model's own units (inches; z is up):
 *   - the size of the model, the floor height and the wall height
 *   - every flat, upright wall face it found (where it is, how long, how high): these are
 *     the walls, door and window edges. js/nscc/office.js has them in PLAN.
 *   - small closed shapes in a slice through the room (columns, pilasters, door bits)
 *   - "shards": slanted triangles that stick out of the walls (mistakes in the model that the
 *     office leaves out)
 *   - holes in the floor (the office has a solid floor everywhere)
 * With --svg it also draws a slice through the model, seen from above, at the height --at.
 *
 * The model is never loaded by the page: the office is rebuilt from these numbers with
 * clean shapes. tests/office.test.js uses this file to check that the office's walls are
 * where the model's walls are.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// ---------- reading an STL file (binary or text) ----------
// Returns a Float64Array: 9 numbers (3 corners x, y, z) per triangle.
function parseSTL(buf) {
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (buf.length === 84 + n * 50 && n > 0) {
    const out = new Float64Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
    }
    return out;
  }
  const text = buf.toString("utf8");
  const nums = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(+m[1], +m[2], +m[3]);
  return Float64Array.from(nums);
}
function load(file) { return parseSTL(fs.readFileSync(file)); }

function triInfo(T, i) {
  const a = [T[i * 9], T[i * 9 + 1], T[i * 9 + 2]], b = [T[i * 9 + 3], T[i * 9 + 4], T[i * 9 + 5]], c = [T[i * 9 + 6], T[i * 9 + 7], T[i * 9 + 8]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  return { a, b, c, area: len / 2, n: len ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0] };
}

function bounds(T) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], T[i + k]); hi[k] = Math.max(hi[k], T[i + k]); }
  return { lo, hi };
}

// Flat areas facing up, by height: the biggest one is the floor, the highest big one the wall tops.
function levels(T) {
  const by = new Map();
  for (let i = 0; i < T.length / 9; i++) {
    const t = triInfo(T, i);
    if (t.n[2] < 0.99) continue;
    const z = Math.round((t.a[2] + t.b[2] + t.c[2]) / 3);
    by.set(z, (by.get(z) || 0) + t.area);
  }
  const list = [...by].sort((p, q) => q[1] - p[1]);
  const floor = list[0][0];
  const ceiling = Math.max(...list.filter(([, a]) => a > list[0][1] * 0.03).map(([z]) => z));
  return { floor, ceiling, list };
}

// Upright faces that face straight along x or y (walls and their edges), grouped by where they are.
// axis "x" = the face is at a fixed x (a wall running front to back); u = along the wall.
function wallFaces(T, minArea) {
  const groups = new Map();
  for (let i = 0; i < T.length / 9; i++) {
    const t = triInfo(T, i);
    if (t.area < 1) continue;
    for (const ax of [0, 1]) {
      if (Math.abs(Math.abs(t.n[ax]) - 1) > 0.001) continue;
      const at = Math.round(((t.a[ax] + t.b[ax] + t.c[ax]) / 3) * 10) / 10;
      const key = ax + (t.n[ax] > 0 ? "+" : "-") + at;
      if (!groups.has(key)) groups.set(key, { axis: ax ? "y" : "x", facing: t.n[ax] > 0 ? 1 : -1, at, u0: Infinity, u1: -Infinity, z0: Infinity, z1: -Infinity, area: 0 });
      const g = groups.get(key), u = 1 - ax;
      for (const p of [t.a, t.b, t.c]) { g.u0 = Math.min(g.u0, p[u]); g.u1 = Math.max(g.u1, p[u]); g.z0 = Math.min(g.z0, p[2]); g.z1 = Math.max(g.z1, p[2]); }
      g.area += t.area;
    }
  }
  return [...groups.values()].filter((g) => g.area >= (minArea || 300)).sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : p.at - q.at));
}

// Is there a wall face at x = at (axis "x") or y = at (axis "y"), covering u0..u1, near full height?
function hasFace(faces, axis, at, u0, u1, tol) {
  tol = tol === undefined ? 1.5 : tol;
  return faces.some((f) => f.axis === axis && Math.abs(f.at - at) <= tol && f.u0 <= u0 + tol && f.u1 >= u1 - tol);
}

// A slice through the model at height z: line pieces [[x1, y1, x2, y2], ...]
function slice(T, z) {
  const segs = [];
  for (let i = 0; i < T.length; i += 9) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = i + k * 3, b = i + ((k + 1) % 3) * 3;
      const za = T[a + 2] - z, zb = T[b + 2] - z;
      if (za * zb < 0) { const s = za / (za - zb); pts.push(T[a] + (T[b] - T[a]) * s, T[a + 1] + (T[b + 1] - T[a + 1]) * s); }
    }
    if (pts.length === 4) segs.push(pts);
  }
  return segs;
}

// Joins the slice's pieces into shapes (pieces that touch), and gives each shape's box.
function shapes(segs, tol) {
  tol = tol || 0.05;
  const key = (x, y) => Math.round(x / tol) + "," + Math.round(y / tol);
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      if (at.has(k)) parent[find(i)] = find(at.get(k)); else at.set(k, i);
    }
  });
  const boxes = new Map();
  segs.forEach((s, i) => {
    const r = find(i);
    if (!boxes.has(r)) boxes.set(r, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, pieces: 0 });
    const b = boxes.get(r);
    b.x0 = Math.min(b.x0, s[0], s[2]); b.x1 = Math.max(b.x1, s[0], s[2]);
    b.y0 = Math.min(b.y0, s[1], s[3]); b.y1 = Math.max(b.y1, s[1], s[3]);
    b.pieces++;
  });
  return [...boxes.values()];
}

// Small closed shapes standing on their own at height z (columns, posts...).
function columns(T, z, maxSize) {
  maxSize = maxSize || 30;
  return shapes(slice(T, z)).filter((b) => b.x1 - b.x0 > 4 && b.y1 - b.y0 > 4 && b.x1 - b.x0 < maxSize && b.y1 - b.y0 < maxSize);
}

// Slanted, big triangles: not flat, not upright along x or y (pieces sticking out of the walls).
function shards(T, minArea) {
  const out = [];
  for (let i = 0; i < T.length / 9; i++) {
    const t = triInfo(T, i);
    if (t.area < (minArea || 150)) continue;
    const n = t.n.map(Math.abs);
    if (n[2] > 0.999 || n[0] > 0.999 || n[1] > 0.999) continue;
    out.push({ area: Math.round(t.area), corners: [t.a, t.b, t.c].map((p) => p.map((v) => Math.round(v))) });
  }
  return out.sort((p, q) => q.area - p.area);
}

// Holes in the floor: squares (size `cell`) inside area {x0, x1, y0, y1} not covered by any
// upward face at floor height.
function floorHoles(T, floorZ, area, cell) {
  cell = cell || 6;
  const cols = Math.ceil((area.x1 - area.x0) / cell), rows = Math.ceil((area.y1 - area.y0) / cell);
  const cover = new Uint8Array(cols * rows);
  for (let i = 0; i < T.length / 9; i++) {
    const t = triInfo(T, i);
    if (t.n[2] < 0.99 || Math.abs((t.a[2] + t.b[2] + t.c[2]) / 3 - floorZ) > 1.5) continue;
    const xs = [t.a[0], t.b[0], t.c[0]], ys = [t.a[1], t.b[1], t.c[1]];
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - area.x0) / cell)), c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - area.x0) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - area.y0) / cell)), r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - area.y0) / cell));
    const d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
    if (Math.abs(d) < 1e-9) continue;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const px = area.x0 + (c + 0.5) * cell, py = area.y0 + (r + 0.5) * cell;
      const l1 = ((ys[1] - ys[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (py - ys[2])) / d;
      const l2 = ((ys[2] - ys[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (py - ys[2])) / d;
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) cover[r * cols + c] = 1;
    }
  }
  const holes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!cover[r * cols + c]) holes.push({ x: area.x0 + (c + 0.5) * cell, y: area.y0 + (r + 0.5) * cell });
  return { holes, cells: cols * rows, cell };
}

function svg(T, z, file) {
  const segs = slice(T, z), b = bounds(T), pad = 10;
  const w = b.hi[0] - b.lo[0] + pad * 2, h = b.hi[1] - b.lo[1] + pad * 2;
  const X = (x) => (x - b.lo[0] + pad).toFixed(1), Y = (y) => (b.hi[1] - y + pad).toFixed(1);
  const lines = segs.map((s) => `<line x1="${X(s[0])}" y1="${Y(s[1])}" x2="${X(s[2])}" y2="${Y(s[3])}"/>`).join("\n");
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 1.5}" height="${h * 1.5}"><rect width="100%" height="100%" fill="#fff"/><g stroke="#000" stroke-width="1">\n${lines}\n</g></svg>\n`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && !/^\d/.test(a)) || path.join(__dirname, "..", "models", "office-a223.stl");
  const T = load(file);
  const b = bounds(T), lv = levels(T);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  console.log(`${path.basename(file)}: ${T.length / 9} triangles`);
  console.log(`size: x ${f1(b.lo[0])}..${f1(b.hi[0])}  y ${f1(b.lo[1])}..${f1(b.hi[1])}  z ${f1(b.lo[2])}..${f1(b.hi[2])}`);
  console.log(`floor (top) at z = ${lv.floor}, wall tops at z = ${lv.ceiling}  (room height ${lv.ceiling - lv.floor})`);
  console.log("\nupright wall faces (at = where the face is; u = from..to along it; z = bottom..top):");
  for (const g of wallFaces(T)) console.log(`  ${g.axis} = ${f1(g.at).padStart(7)} facing ${g.facing > 0 ? "+" : "-"}${g.axis}   u ${f1(g.u0).padStart(7)}..${f1(g.u1).padStart(7)}   z ${f1(g.z0).padStart(5)}..${f1(g.z1).padStart(5)}`);
  const mid = (lv.floor + lv.ceiling) / 2;
  console.log(`\nsmall closed shapes in a slice at z = ${mid} (columns, posts, door parts):`);
  for (const c of columns(T, mid)) console.log(`  x ${f1(c.x0)}..${f1(c.x1)}  y ${f1(c.y0)}..${f1(c.y1)}  (${f1(c.x1 - c.x0)} x ${f1(c.y1 - c.y0)})`);
  const sh = shards(T);
  console.log(`\nslanted pieces (shards) bigger than 1 sq ft: ${sh.length}`);
  for (const s of sh.slice(0, 12)) console.log(`  ${s.area} sq in: ${s.corners.map((p) => "(" + p.join(", ") + ")").join(" ")}`);
  const fh = floorHoles(T, lv.floor, { x0: b.lo[0], x1: b.hi[0], y0: b.lo[1], y1: b.hi[1] });
  console.log(`\nfloor: ${fh.holes.length} of ${fh.cells} squares (${fh.cell} in) have no floor at z = ${lv.floor} (holes, or outside the rooms)`);
  const at = args.indexOf("--svg");
  if (at >= 0 && args[at + 1]) {
    const zi = args.indexOf("--at");
    const z = zi >= 0 ? +args[zi + 1] : mid;
    svg(T, z, args[at + 1]);
    console.log(`\nslice at z = ${z} drawn to ${args[at + 1]}`);
  }
}

module.exports = { parseSTL, load, bounds, levels, wallFaces, hasFace, slice, shapes, columns, shards, floorHoles };
