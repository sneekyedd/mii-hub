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

  const api = { END_OF_DAY_HOUR, MAX_LOCATION, cleanLocation, expiresAt, isExpired, nextSweep, isAfterEndOfDay, formatTime, withLocation, isOut, topBarEntries, reconcile, dayKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NSCCLogic = api;
})(typeof self !== "undefined" ? self : this);
