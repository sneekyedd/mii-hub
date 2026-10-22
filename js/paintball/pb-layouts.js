/*
 * paintball/pb-layouts.js
 * The Paintball maps: which ones there are, and the floor plans of the ones
 * made for each hub place. Plain data + a few helpers, no THREE / no DOM, so the
 * same file works in the game (window.PBLayouts) and in Node (the tests).
 *
 *   MAPS      every map you can play: { id, name, setting, layout, desc }
 *             "Shipment" (the container yard) dressed up as each hub place,
 *             plus one map of its own for each place.
 *   SETTINGS  the hub places a map can be in (pb-map.js builds how they look)
 *   build(layoutId)   -> { pieces, boxes, cyls, bounds, spawns, ceiling }
 *                        the colliders the game uses (same units as pb-map.js:
 *                        1 = 1 m before the game makes everything 1.25x bigger)
 *   pickVoteMaps(current, rnd) -> two different map ids to vote on
 *   randomOther(shown, rnd)    -> a map that isn't one of the shown ones ("Random")
 *
 * Pieces are { t: "box", k, x, z, w, d, h, y, rot } or { t: "cyl", k, x, z, r, h, y }.
 * k says what it is (pb-map.js draws it), the numbers are exactly what you bump
 * into and what paintballs splat on. Every map is built from one half that is
 * turned 180° around the middle for the other team, so both sides are the same.
 */
(function (root) {
  "use strict";

  const PI = Math.PI;
  // The playable area (the same as Shipment's)
  const BOUNDS = { minX: -15.9, maxX: 15.9, minZ: -17.0, maxZ: 17.0 };

  const SETTINGS = [
    { id: "park", name: "Park", icon: "🌳" },
    { id: "cafe", name: "Café Street", icon: "☕" },
    { id: "beach", name: "Beach", icon: "🏖️" },
    { id: "moon", name: "Moon", icon: "🌙" },
    { id: "office", name: "Office", icon: "🏢" },
  ];

  const MAPS = [
    { id: "shipment_park", name: "Shipment Park", setting: "park", layout: "shipment", desc: "The container yard, on the island park." },
    { id: "shipment_cafe", name: "Shipment Café", setting: "cafe", layout: "shipment", desc: "Containers delivered to Café Street." },
    { id: "shipment_beach", name: "Shipment Beach", setting: "beach", layout: "shipment", desc: "Containers washed up on the beach." },
    { id: "shipment_moon", name: "Shipment Moon", setting: "moon", layout: "shipment", desc: "Space cargo at the moon base." },
    { id: "shipment_office", name: "Shipment Office", setting: "office", layout: "shipment", desc: "The office's very big delivery." },
    { id: "picnic", name: "Picnic Park", setting: "park", layout: "park", desc: "Hedges, a play tower and the big tree." },
    { id: "market", name: "Market Square", setting: "cafe", layout: "cafe", desc: "Stalls, a van and the fountain." },
    { id: "boardwalk", name: "Boardwalk", setting: "beach", layout: "beach", desc: "Boats, beach huts and the lifeguard tower." },
    { id: "moonbase", name: "Moon Base", setting: "moon", layout: "moon", desc: "Habitats, rovers and the lander." },
    { id: "openoffice", name: "Open Office", setting: "office", layout: "office", desc: "Desks, shelves and the server racks." },
  ];
  const DEFAULT_MAP = "shipment_park";
  const mapById = (id) => MAPS.find((m) => m.id === id) || null;

  // ---------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------
  const WOOD = { picnic: 1, bench: 1, tower: 1, shed: 1, logs: 1, stall: 1, crates: 1, kiosk: 1, boat: 1, hut: 1, lifeguard: 1, surf: 1, desk: 1, shelf: 1, sofa: 1, partition: 1, table: 1 };
  function box(k, x, z, w, d, h, o) {
    o = o || {};
    return { t: "box", k, x, z, w, d, h, y: o.y || 0, rot: o.rot || 0, m: o.m || (WOOD[k] ? "wood" : "metal") };
  }
  function cyl(k, x, z, r, h, o) {
    o = o || {};
    return { t: "cyl", k, x, z, r, h, y: o.y || 0, m: o.m || (WOOD[k] ? "wood" : "metal") };
  }
  // a few things made of more than one piece
  const tree = (x, z, s) => { s = s || 1; return [cyl("trunk", x, z, 0.32 * s, 2.7 * s), cyl("canopy", x, z, 1.7 * s, 1.7 * s, { y: 2.7 * s })]; };
  const palm = (x, z) => [cyl("palm", x, z, 0.3, 4.2)];
  const umbrella = (x, z, table) => [
    table ? cyl("table", x, z, 0.5, 0.75) : cyl("pole", x, z, 0.06, 2.1),
    cyl("parasol", x, z, 1.25, 0.3, { y: 2.1 }),
  ].concat(table ? [cyl("pole", x, z, 0.06, 1.35, { y: 0.75 })] : []);
  // a market stall: the counter, and its roof hanging out over the front (+z when not turned).
  // A crate at one end (side -1 or 1) to climb onto the roof from.
  const stall = (x, z, rot, side) => {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const roof = at(0, 0.3), cr = at(side * 2.15, 0.1);
    return [
      box("stall", x, z, 2.8, 1.2, 1.05, { rot }),
      box("awning", roof[0], roof[1], 3.2, 2.0, 0.22, { y: 2.35, rot }),
      box("crates", cr[0], cr[1], 1.0, 1.0, 1.1, { rot }),
    ];
  };

  // ---------------------------------------------------------------------
  // The floor plans (half of each: the other half is the same turned around)
  // Team A comes in at the +z end, team B at the -z end.
  // ---------------------------------------------------------------------
  const LAYOUTS = {
    // ---- Picnic Park: hedges, a play tower, the big tree in the middle ----
    park: {
      center: [cyl("planter", 0, 0, 2.2, 0.8), cyl("trunk", 0, 0, 0.5, 2.6, { y: 0.8 }), cyl("canopy", 0, 0, 2.6, 1.9, { y: 3.4 })],
      half: [
        box("tower", -10.6, 10.2, 2.6, 2.6, 2.0),
        box("rock", -8.45, 11.3, 1.5, 1.3, 1.0),
        box("hedge", -2.2, 8.8, 6.0, 1.1, 1.9),
        box("hedge", 8.8, 8.2, 5.0, 1.1, 1.9),
        box("hedge", -4.6, 4.2, 1.1, 4.0, 1.9),
        box("hedge", 12.7, 2.8, 1.1, 5.0, 1.9),
        box("hedge", 2.0, 5.6, 5.4, 1.0, 1.7),
        box("shed", 11.9, 13.3, 3.0, 2.2, 2.5),
        box("logs", 9.75, 13.4, 1.2, 2.0, 1.2),
        box("picnic", 3.8, 12.4, 2.2, 1.5, 0.8),
        box("picnic", -13.4, 3.6, 2.2, 1.5, 0.8, { rot: PI / 2 }),
        box("bush", -14.3, 8.0, 1.4, 1.4, 1.15),
        box("bush", 9.0, -0.6, 1.5, 1.5, 1.15),
        box("rock", 7.4, 3.4, 2.0, 1.6, 1.4),
        box("bench", 6.4, 12.6, 1.9, 0.6, 0.5),
        ...tree(13.4, -6.2), ...tree(-6.6, 13.6, 0.9), ...tree(-8.6, 4.2, 0.85),
      ],
      spawns: [[-12.6, 15.4], [-3.0, 15.6], [3.6, 15.6], [8.2, 15.7]],
    },
    // ---- Market Square: stalls, a food truck, the fountain ----
    cafe: {
      center: [cyl("fountain", 0, 0, 2.3, 0.75), cyl("column", 0, 0, 0.55, 2.05, { y: 0.75 })],
      half: [
        ...stall(-6.0, 8.6, 0, -1),
        ...stall(9.0, 3.6, -PI / 2, 1),
        box("kiosk", 3.0, 9.4, 2.2, 2.2, 2.7),
        box("van", -11.4, 3.4, 2.2, 4.8, 2.4),
        box("crates", -9.65, 5.4, 1.1, 1.1, 1.1),
        box("hedgebox", 9.4, 8.8, 4.4, 1.2, 1.6),
        box("hedgebox", -3.2, 5.6, 5.2, 1.2, 1.6),
        box("shelter", 13.4, 1.0, 0.4, 3.6, 2.2),
        box("shelterroof", 13.0, 1.0, 1.4, 3.8, 0.18, { y: 2.2 }),
        box("planter", -7.2, 4.6, 1.3, 1.3, 1.3),
        box("planter", 4.6, 2.6, 1.3, 1.3, 1.3),
        ...umbrella(11.4, 12.8, true), ...umbrella(-2.6, 12.8, true), ...umbrella(-13.4, 12.6, true),
        cyl("lamp", -6.6, 13.2, 0.12, 3.6), cyl("lamp", 13.8, 7.0, 0.12, 3.6), cyl("clock", -12.0, 9.6, 0.14, 3.4),
        box("crates", 7.6, 13.4, 1.1, 1.1, 1.1), box("crates", 7.6, 13.4, 0.9, 0.9, 0.9, { y: 1.1, rot: 0.25 }),
      ],
      spawns: [[-10.4, 15.6], [-4.6, 15.6], [2.4, 15.6], [13.6, 15.4]],
    },
    // ---- Boardwalk: boats, beach huts, the lifeguard tower in the middle ----
    beach: {
      center: [box("lifeguard", 0, 0, 2.4, 2.4, 2.3)],
      half: [
        box("buoys", 0, 1.95, 1.2, 1.1, 1.15),
        box("hut", 10.8, 10.4, 2.6, 2.6, 2.7),
        box("crates", 8.9, 11.3, 1.1, 1.1, 1.2),
        box("cabins", -5.6, 9.4, 4.8, 1.6, 2.4),
        box("bar", -12.8, 6.6, 2.2, 5.0, 2.5),
        box("crates", -11.15, 8.6, 1.1, 1.1, 1.1),
        box("boat", 5.8, 6.0, 1.8, 4.4, 1.0, { rot: 0.35 }),
        box("boat", -6.4, 2.6, 1.6, 3.8, 0.9, { rot: 1.3 }),
        ...umbrella(2.4, 12.4), box("lounger", 3.8, 12.4, 0.8, 1.9, 0.34),
        ...umbrella(-11.6, 13.2), box("lounger", -10.2, 13.2, 0.8, 1.9, 0.34),
        cyl("castle", -1.4, 5.8, 1.1, 1.5),
        box("icecream", 6.8, 14.2, 2.0, 1.2, 1.5),
        box("surf", 13.6, 3.6, 0.6, 2.6, 1.9),
        box("rock", 10.6, -1.6, 2.2, 1.8, 1.6),
        box("rock", 2.6, 8.2, 1.6, 1.4, 1.2),
        ...palm(-14.4, 1.6), ...palm(14.4, 14.6),
      ],
      spawns: [[-7.6, 15.6], [-1.6, 15.6], [3.2, 15.6], [12.6, 15.4]],
    },
    // ---- Moon Base: habitats, a rover, the lander on its pad ----
    moon: {
      center: [cyl("pad", 0, 0, 3.4, 0.2), box("lander", 0, 0, 2.4, 2.4, 2.1, { y: 0.2 })],
      half: [
        box("crate", 0, 1.95, 1.1, 1.1, 1.1, { y: 0.2 }),
        box("hab", -9.4, 8.4, 2.8, 6.0, 2.7),
        box("crate", -7.45, 11.0, 1.1, 1.1, 1.1),
        box("hab", 7.0, 11.0, 6.0, 2.8, 2.7),
        box("crate", 3.45, 11.6, 1.1, 1.1, 1.1),
        box("rover", 5.6, 5.4, 2.0, 3.0, 1.3, { rot: 0.4 }),
        box("solar", 12.6, 3.0, 1.4, 4.2, 1.1),
        box("cargo", -4.4, 5.6, 4.0, 1.6, 2.0),
        box("rock", -13.0, 1.4, 2.4, 2.0, 1.8),
        box("rock", 1.6, 5.4, 1.8, 1.6, 1.5),
        box("rock", -13.6, 9.8, 1.8, 1.6, 1.6),
        box("rock", -8.8, 1.6, 1.8, 1.6, 1.6),
        cyl("tank", 13.0, 8.6, 0.8, 2.2),
        cyl("crystal", -3.0, 12.6, 0.8, 1.8),
        box("crate", 0.6, 14.0, 1.1, 1.1, 1.1, { rot: 0.3 }),
        cyl("antenna", -13.8, 14.2, 0.14, 4.8),
      ],
      spawns: [[-11.4, 15.4], [-5.0, 15.6], [3.0, 15.7], [12.4, 15.4]],
    },
    // ---- Open Office: desks, shelves, the server racks in the middle ----
    office: {
      ceiling: 6.0,
      center: [box("rack", -1.3, 0, 0.9, 4.0, 2.2), box("rack", 1.3, 0, 0.9, 4.0, 2.2)],
      half: [
        box("meeting", -9.4, 0.6, 4.8, 3.2, 2.4),
        box("desk", -8.0, 8.4, 3.4, 1.6, 0.78), box("screens", -8.0, 8.4, 3.2, 0.12, 0.46, { y: 0.78 }),
        box("desk", 7.4, 5.6, 3.4, 1.6, 0.78, { rot: PI / 2 }), box("screens", 7.4, 5.6, 3.2, 0.12, 0.46, { y: 0.78, rot: PI / 2 }),
        box("partition", -3.2, 6.2, 4.4, 0.16, 1.7),
        box("partition", 3.4, 8.8, 4.4, 0.16, 1.7),
        box("partition", 10.6, 10.8, 0.16, 4.0, 1.7),
        box("shelf", -14.5, 7.4, 0.8, 3.6, 2.4),
        box("boxes", -14.5, 5.05, 1.0, 1.0, 1.0),
        box("shelf", 1.0, 13.6, 3.2, 0.8, 2.4),
        box("boxes", 3.15, 13.4, 1.0, 1.0, 1.0),
        box("cabinet", -4.8, 11.2, 1.8, 0.7, 1.3),
        box("cabinet", 13.9, 4.0, 0.7, 1.8, 1.3),
        box("cabinet", -5.4, 2.4, 0.7, 1.8, 1.3),
        cyl("plant", 12.8, 1.4, 0.5, 1.7), cyl("plant", -7.4, 14.2, 0.5, 1.7),
        box("sofa", 4.0, 3.2, 2.2, 0.9, 0.85),
        box("printer", -12.6, 12.4, 1.1, 0.8, 1.1),
        cyl("cooler", 8.4, 13.8, 0.3, 1.25),
        box("boxes", 13.0, 6.4, 1.0, 1.0, 1.0), box("boxes", 13.0, 6.4, 0.9, 0.9, 0.9, { y: 1.0, rot: 0.2 }),
      ],
      spawns: [[-10.6, 15.5], [-3.2, 15.6], [5.6, 15.6], [12.8, 15.4]],
    },
  };

  // the same piece on the other team's side (turned 180° around the middle)
  function mirror(p) {
    const q = Object.assign({}, p, { x: -p.x, z: -p.z });
    if (p.t === "box") q.rot = (p.rot || 0) + PI;
    return q;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // Everything the game needs to know about a floor plan
  function build(layoutId) {
    const L = LAYOUTS[layoutId];
    if (!L) return null;
    const pieces = L.center.concat(L.half, L.half.map(mirror));
    const boxes = [], cyls = [];
    for (const p of pieces) {
      if (p.t === "box") boxes.push({ x: r3(p.x), z: r3(p.z), hw: p.w / 2, hd: p.d / 2, rot: p.rot || 0, y0: p.y, y1: r3(p.y + p.h), mat: p.m });
      else cyls.push({ x: r3(p.x), z: r3(p.z), r: p.r, y0: p.y, y1: r3(p.y + p.h), mat: p.m });
    }
    const sp = (x, z) => ({ x, z, yaw: Math.atan2(x, z) }); // facing the middle
    const spawns = { a: L.spawns.map((s) => sp(s[0], s[1])), b: L.spawns.map((s) => sp(-s[0], -s[1])) };
    return { pieces, boxes, cyls, spawns, bounds: Object.assign({}, BOUNDS), ceiling: L.ceiling || 0 };
  }

  // ---------------------------------------------------------------------
  // Voting between matches (online): two maps + "Random"
  // ---------------------------------------------------------------------
  const RANDOM = { id: "random", name: "Random", desc: "Any other map, picked by chance." };
  function pickVoteMaps(current, rnd) {
    rnd = rnd || Math.random;
    let pool = MAPS.map((m) => m.id).filter((id) => id !== current);
    const a = pool[Math.floor(rnd() * pool.length)];
    pool = pool.filter((id) => id !== a);
    // the second one is from another place if possible, so the choice is a real one
    const other = pool.filter((id) => mapById(id).setting !== mapById(a).setting);
    const list = other.length ? other : pool;
    const b = list[Math.floor(rnd() * list.length)];
    return [a, b];
  }
  function randomOther(shown, rnd) {
    rnd = rnd || Math.random;
    const pool = MAPS.map((m) => m.id).filter((id) => !shown.includes(id));
    return pool[Math.floor(rnd() * pool.length)];
  }

  const api = { BOUNDS, SETTINGS, MAPS, LAYOUTS, DEFAULT_MAP, RANDOM, mapById, build, mirror, pickVoteMaps, randomOther };
  root.PBLayouts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
