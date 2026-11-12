/*
 * The online version Mii Hub speaks to the game server (Paintball and Chess both use it).
 * Bump it together with VERSION in server/paintball-server.js (server/test.js checks they match).
 */
(function (root) {
  "use strict";
  root.MiiOnlineVersion = 7;
})(typeof window !== "undefined" ? window : globalThis);
