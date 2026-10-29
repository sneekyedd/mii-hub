/*
 * js/nscc/logic.js
 * The rules of the MiiNSCC board, as plain functions with no 3D and no browser
 * needed (so they run in Node for the tests, and a server can reuse them later).
 *
 *   - A Mii is "in" the office when its location text is empty, and "out" when
 *     someone typed a location for it ("Lunch", "Client visit"...).
 *   - The board is cleared at 6:00 PM local time: every Mii added before 6 PM
 *     leaves the board then. (A Mii added after 6 PM stays until midnight.)
 *   - The top bar lists only the Miis that are out, with the time they left.
 *   - Workspaces: a Mii can be given its own desk or private office (or "any free desk").
 *     A spot belongs to one Mii at most; a Mii without one takes a free desk that
 *     isn't anyone else's.
 */
(function (root) {
  "use strict";

  const END_OF_DAY_HOUR = 18; // 6:00 PM, local time
  const MAX_LOCATION = 60;    // characters

  // Cleans up what was typed in the location field ("" = in the office).
  function cleanLocation(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_LOCATION);
  }

  // When a Mii added at time `addedAt` (ms) comes off the board:
  // 6:00 PM that day, or midnight if it was added after 6 PM.
  function expiresAt(addedAt) {
    const d = new Date(addedAt);
    const six = new Date(d.getFullYear(), d.getMonth(), d.getDate(), END_OF_DAY_HOUR, 0, 0, 0).getTime();
    if (addedAt < six) return six;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  }

  function isExpired(member, now) {
    return now >= expiresAt(member.addedAt);
  }

  // The next moment the board changes by itself (for a timer), after `now`.
  function nextSweep(members, now) {
    let next = Infinity;
    for (const m of members) {
      const t = expiresAt(m.addedAt);
      if (t > now && t < next) next = t;
    }
    return next;
  }

  function isAfterEndOfDay(now) {
    return new Date(now).getHours() >= END_OF_DAY_HOUR;
  }

  // "2:15 PM" (the same everywhere, whatever the computer's language)
  function formatTime(ts) {
    const d = new Date(ts);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }

  // A board member after someone typed (or cleared) its location at time `now`.
  // Returns a new object; the leave time only changes when the Mii goes from in to out.
  function withLocation(member, text, now) {
    const location = cleanLocation(text);
    const next = Object.assign({}, member, { location });
    if (!location) next.leftAt = null;
    else if (!member.location) next.leftAt = now;     // just left
    else next.leftAt = member.leftAt || now;          // already out, only the place changed
    return next;
  }

  const isOut = (member) => !!cleanLocation(member.location);

  // What the top bar shows: only the Miis that are out, the first to leave first.
  function topBarEntries(members) {
    return members
      .filter(isOut)
      .slice()
      .sort((a, b) => (a.leftAt || 0) - (b.leftAt || 0) || String(a.name).localeCompare(String(b.name)))
      .map((m) => ({ id: m.id, name: m.name, location: cleanLocation(m.location), leftAt: m.leftAt, leftText: m.leftAt ? "Left " + formatTime(m.leftAt) : "" }));
  }

  // What the 3D office should do so it matches the board.
  //   members: the board (from the store)
  //   present: { id: "in" | "entering" | "leaving" } for the Miis drawn in the office now
  //   first:   true on page load (Miis already in go straight to their desks)
  // Returns [{ id, action }] where action is:
  //   "appear" (put it at its desk, no walk), "enter" (walk in through the door),
  //   "return" (it was walking out: turn round and go back to work),
  //   "leave" (walk out of the door; it stays on the board as "out"),
  //   "remove" (walk out and come off the board: the day ended or someone removed it)
  function reconcile(members, present, first) {
    const out = [];
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const m of members) {
      const p = present[m.id];
      if (!isOut(m)) {
        if (!p) out.push({ id: m.id, action: first ? "appear" : "enter" });
        else if (p === "leaving") out.push({ id: m.id, action: "return" });
      } else if (p === "in" || p === "entering") {
        out.push({ id: m.id, action: "leave" });
      }
    }
    for (const id of Object.keys(present)) {
      if (!byId.has(id) && present[id] !== "removing") out.push({ id, action: "remove" });
    }
    return out;
  }

  // Today's date as "2026-10-28" (local time).
  function dayKey(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" : "") + n;
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  // ---------- workspaces (who sits where) ----------
  // assignments: { miiId: spotId } (a Mii missing from it = "any free desk")

  // Who a spot belongs to (a Mii id), or null.
  function ownerOf(assignments, spotId) {
    for (const id of Object.keys(assignments || {})) if (assignments[id] === spotId) return id;
    return null;
  }

  // Gives spot `spotId` to Mii `miiId` (null / "" = back to "any free desk").
  // If the spot was someone else's, the two swap: the other Mii gets this Mii's old
  // spot (or "any free desk" if it didn't have one).
  // Returns { assignments (a new object), swapped: the other Mii's id or null }.
  function assignSpot(assignments, miiId, spotId) {
    const next = Object.assign({}, assignments || {});
    const old = next[miiId] || null;
    if (!spotId) { delete next[miiId]; return { assignments: next, swapped: null }; }
    const other = ownerOf(next, spotId);
    let swapped = null;
    if (other && other !== miiId) {
      if (old) next[other] = old; else delete next[other];
      swapped = other;
    }
    next[miiId] = spotId;
    return { assignments: next, swapped };
  }

  // Which desk a Mii should use right now (a spot id, or null when there's none left).
  //   o.id:          the Mii
  //   o.desks:       the desks in the office, in the order to fill them [{ id, private? }]
  //   o.assignments: { miiId: spotId }
  //   o.taken:       { spotId: miiId } desks other Miis are using right now
  //   o.onBoard:     ids of the Miis on today's board (in or out)
  //   o.prefer:      (optional) a number: try this desk first (so a Mii keeps its desk all day)
  // Its own spot if it has one. Otherwise a free desk that isn't anyone's (private offices
  // are never used by anyone else). If every free desk belongs to someone, one whose owner
  // isn't here today.
  function pickDesk(o) {
    const assignments = o.assignments || {}, taken = o.taken || {};
    const mine = assignments[o.id];
    if (mine && o.desks.some((d) => d.id === mine)) return mine;
    const owners = {};
    for (const id of Object.keys(assignments)) owners[assignments[id]] = id;
    const onBoard = new Set(o.onBoard || []);
    const open = o.desks.filter((d) => !d.private && !(taken[d.id] && taken[d.id] !== o.id));
    const shared = o.desks.filter((d) => !d.private);
    const want = typeof o.prefer === "number" && o.prefer >= 0 && shared.length ? shared[o.prefer % shared.length] : null;
    const pick = (list) => (want && list.includes(want) ? want.id : list.length ? list[0].id : null);
    const free = open.filter((d) => !owners[d.id]);
    if (free.length) return pick(free);
    return pick(open.filter((d) => !onBoard.has(owners[d.id])));
  }

  const api = { END_OF_DAY_HOUR, MAX_LOCATION, cleanLocation, expiresAt, isExpired, nextSweep, isAfterEndOfDay, formatTime, withLocation, isOut, topBarEntries, reconcile, dayKey, ownerOf, assignSpot, pickDesk };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NSCCLogic = api;
})(typeof self !== "undefined" ? self : this);
