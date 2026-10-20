/*
 * Patch notes: every Mii Hub update, newest first.
 * The "Patch notes" button (next to "Check for updates") opens them:
 * "What's new" shows the newest update, then the full history below.
 *
 * When adding an update: put it at the top with v: null (it shows as the
 * version you're running), and give the previous one its real version number.
 */
(function (root) {
  "use strict";

  const NOTES = [
    {
      v: null, date: "2026-10-20", title: "Game reviews, wishes you have to ask about, and secrets",
      notes: [
        "Chess: after every game (vs a Mii or online), 📊 Review the game shows your accuracy and how good each move was, from Book and Best to Blunder, with the better move for your mistakes.",
        "Wishes: the Wishes list is gone. A 💭 by a Mii's name in Residents (and a ❗ over its head) means it wants something: go and talk to it (its menu) to find out what and help.",
        "Something very rare might happen on Café Street or the Moon... but only while you're watching. The sticker book has a new ??? page.",
      ],
    },
    {
      v: "1.2.2", date: "2026-10-20", title: "Sleepy eyes, favorites and more",
      notes: [
        "Miis close their eyes when they're asleep.",
        "Every Mii has exactly one favorite thing in each furniture category (it gets a ❤️ in the shop once they have it).",
        "Look around a Mii's home while they're out: the 🔑 button in Residents, \"Look inside\" in its menu, or click its apartment in the Courtyard.",
        "The cyclists on Café Street are real Miis now.",
        "Miis no longer float above the futon.",
      ],
    },
    {
      v: "1.2.1", date: "2026-10-19", title: "Lots of little fixes",
      notes: [
        "A splash screen with a loading bar while Mii Hub starts.",
        "🎮 Play: Paintball and Chess are now together under one Play button at the top.",
        "Friendships moved into each Mii's menu (it folds up if the list is long). The Friendships panel is gone.",
        "Sticker book: hover over a sticker to see how you got it, or a hint for how to get it.",
        "Town level-ups now give every Mii 10 coins × the new level (up to 100).",
        "Fewer wishes at once (especially with lots of Miis) and far fewer fights.",
        "Clicking a Mii in Residents while you're visiting a home now takes you to that Mii.",
        "Paintball: moving with the AWP scoped only blurs the crosshair (like CS), not the whole view.",
        "Online chess: the board grows to fill the window once your opponent joins.",
        "The ping pong ball goes over the net now, with two floating paddles rallying.",
        "The big flat-screen TV is now even bigger, on the wall, and plays a movie.",
        "Miis no longer sleep underneath the hammock.",
        "Fixed the park path poking through the grass at its ends, and the posts going through the Mii Beach sign.",
        "American spelling everywhere (color, favorite, practicing...).",
      ],
    },
    { v: "1.2.0", date: "2026-10-16", title: "Music!", notes: ["🎵 Background music in the hub that loops smoothly (no jump where it repeats). It plays everywhere except Paintball. Turn it on or off with the 🎵 button at the top."] },
    { v: "1.1.1", date: "2026-10-16", title: "Thicker arms", notes: ["Paintball: your Mii's arms in first person are a little thicker."] },
    {
      v: "1.1.0", date: "2026-10-16", title: "Chess, the Deagle, and a big Mii Hub update",
      notes: [
        "♟️ Chess! Play any Mii from its menu or the new Chess button. Miis start as beginners and get better with every finished game (Master after about 20), but even a Master is beatable.",
        "🌐 Online chess against other people through the same server as Paintball: host or join a game, with an optional password, a clock (bullet to classical), draw offers, resigning and rematches.",
        "🦅 Paintball: the Desert Eagle is now a sidearm in both classes (key 2), working like CS:GO's: one shot per click, 7-round mag, headshots splat up close. 18 new Deagle skins in the Splat Case, like Blaze, Printstream and Golden Koi.",
        "Paintball: both of your Mii's hands now hold the guns in first person.",
        "Crates: a gold ★ only shows up in the spinning reel when you're actually getting one (like CS).",
        "The places are now a drop-down menu at the top, and the side panels (Wishes, Add Miis, Friendships...) fold up when you click their titles.",
        "Click the town level to see what every level has given you, and what's coming next.",
        "The School is now a College (the Miis are all grown-ups!), and the Apartments are now called the Courtyard.",
        "Phone calls are real on both ends: both Miis are on the phone for the whole call, wherever you look, and neither can chat in person until it's over.",
        "Self-portraits now show the Mii who owns them, the Sky blue wallpaper is fixed, and there are 30 new pieces of furniture, wallpapers and floors.",
        "Miis no longer ask for furniture you can't get them (when they already own everything of that kind).",
        "The camera can no longer end up behind buildings on Café Street (and a few other places).",
      ],
    },
    {
      v: "1.0.25", date: "2026-10-15", title: "Paintball: crates, skins and CS-style accuracy",
      notes: [
        "Crates! Earn 🎨 credits by playing (kills, headshots, round wins, finishing and winning matches) and open Splat Cases in the new Crates & Locker screen, with a CS-style spinning reel and sounds.",
        "50 skins inspired by CS: Mil-Spec (blue), Restricted (purple), Classified (pink), Covert (red) and Rare Special (gold) with CS's odds. Gold is always a Butterfly Knife (Fade, Doppler, Marble Fade, Tiger Tooth and more).",
        "Trade up 10 of the same skin for a random skin of the next tier. Equip skins in the Locker; other players see them online.",
        "Moving and shooting now works like CS: running or jumping with the AK almost never hits, and moving with the AWP scoped in misses too (the scope blurs until you stand still).",
        "The Paint AK is redesigned: no canister on top, now a see-through curved magazine full of paintballs.",
        "Fixed the butterfly knife's handles swinging the wrong way and clipping through the blade.",
      ],
    },
    {
      v: "1.0.24", date: "2026-10-15", title: "Patch notes in the app",
      notes: [
        "New Patch notes button next to Check for updates: see what's new in this update and every update before it.",
        "The first time you open Mii Hub after an update, the patch notes pop up so you can see what's new.",
      ],
    },
    {
      v: "1.0.22", date: "2026-10-15", title: "Paintball: loadouts and the AWP",
      notes: [
        "Pick your class before you spawn: Rifler (Paint AK + knife) or Sniper (Paint AWP + knife). Press B any time to change it.",
        "The AWP works like CS:GO's: right click to zoom (twice, then out), one shot to the body or head splats a Mii, a bolt pull after every shot, and no-scopes are very inaccurate.",
        "New AWP model with draw, bolt, reload and inspect animations, plus its own sounds.",
        "The Shipment map is 1.25x bigger so players feel less cramped. The barrel-to-container crouch-jump still works.",
      ],
    },
    {
      v: "1.0.21", date: "2026-10-15", title: "Paintball: looks and feel",
      notes: [
        "Round Mii ball hands, a straighter gun and reworked butterfly knife animations, including a toss-and-catch inspect.",
        "Other players hold their gun like a proper shooter instead of a T-pose.",
        "Brighter map, a soft outline glow on opponents, and two center containers closed to cut long sightlines.",
      ],
    },
    {
      v: "1.0.20", date: "2026-10-15", title: "Paintball online: warmup and voting",
      notes: [
        "Run around freely in warmup until a second player joins.",
        "15-second vote between matches for the next mode and map (ties are picked at random).",
        "Online Rounds mode (first to 7).",
      ],
    },
    { v: "1.0.19", date: "2026-10-15", title: "Server security update", notes: ["The Paintball server's network library was updated with security fixes."] },
    { v: "1.0.18", date: "2026-10-15", title: "Server setting", notes: ["The Paintball server can be set to only listen on its own computer."] },
    { v: "1.0.17", date: "2026-10-15", title: "Privacy", notes: ["Server details are kept out of the public code."] },
    {
      v: "1.0.16", date: "2026-10-15", title: "Paintball online: lobbies",
      notes: [
        "Find Lobby and Host Lobby on one shared server: no port opening needed.",
        "Lobbies can have a password and a player limit.",
      ],
    },
    { v: "1.0.15", date: "2026-10-15", title: "Paintball: host from your computer", notes: ["Try hosting an online game from your own computer."] },
    {
      v: "1.0.14", date: "2026-10-15", title: "Paintball: respawn mode and multiplayer",
      notes: [
        "Respawn mode: first to 20 eliminations, back in 2 seconds after being splatted.",
        "Online multiplayer, and a field of view slider (60–150).",
      ],
    },
    {
      v: "1.0.13", date: "2026-10-15", title: "Paintball!",
      notes: [
        "A first-person paintball mode with CS:GO-style movement, a paint AK and a butterfly knife.",
        "The Shipment map, Mii hands, sounds and a scoreboard.",
        "Play against a Mii whose Paintball skill grows the more you play.",
      ],
    },
    {
      v: "1.0.12", date: "2026-10-15", title: "New places, weather and progression",
      notes: [
        "New places: the Beach, Café Street, School and Concert Stage.",
        "Weather and seasons: rain, storms, snow, petals, falling leaves, fireworks and lanterns.",
        "Wishes, Mii levels, a town level, daily goals, a sticker book, relationships and a daily shop.",
      ],
    },
    {
      v: "1.0.11", date: "2026-10-14", title: "Miis live their own lives",
      notes: [
        "Miis have favorite places, travel around, shout to call each other over and make phone calls.",
        "See-through windows: homes look out on the courtyard and flats show the Mii inside.",
      ],
    },
    { v: "1.0.10", date: "2026-10-14", title: "BBQ fix", notes: ["Miis grill from the open side of the BBQ."] },
    { v: "1.0.9", date: "2026-10-14", title: "BBQ fix", notes: ["The grill lid and bowl look solid from underneath."] },
    { v: "1.0.8", date: "2026-10-14", title: "Apartments", notes: ["Apartments get a new floor when they're full, and a tidy gate."] },
    {
      v: "1.0.7", date: "2026-10-14", title: "Homes and the city",
      notes: [
        "Apartments courtyard and home interiors with furniture. Miis walk home before a visit.",
        "The office looks out on a city, with scenery all the way round every place.",
        "Smoother walking, proper sitting, and coins.",
      ],
    },
    { v: "1.0.6", date: "2026-10-13", title: "Mini-games", notes: ["Mini-games where Miis get better with practice, an IT help desk office and swimming ducks."] },
    { v: "1.0.5", date: "2026-10-13", title: "Mac update fix", notes: ["Update checks on Mac find the right download."] },
    { v: "1.0.4", date: "2026-10-13", title: "Automatic updates", notes: ["The app checks for updates and asks to install them.", "Full-screen scene."] },
    { v: "1.0.3", date: "2026-10-13", title: "Personality and camera", notes: ["Personality menu, a 360° camera, smarter walking and visual fixes."] },
    {
      v: "1.0.1", date: "2026-10-12", title: "Mii Hub is here",
      notes: [
        "Miis walk around and interact in the park, office and space.",
        "Full 3D with your own .glb Mii models, and Tomodachi-style scenery.",
        "Available as a desktop app.",
      ],
    },
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  // currentVersion: what the app is running (labels the newest entry)
  function open(currentVersion) {
    close();
    const label = (n) => "v" + (n.v || currentVersion || "latest");
    const back = el("div", "pn-modal");
    back.id = "patchNotes";
    const card = el("div", "pn-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Patch notes");
    const head = el("div", "pn-head");
    head.append(el("div", "pn-title", "📜 Patch notes"));
    const x = el("button", "pn-close", "✕");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    head.append(x);
    card.append(head);

    const entry = (n, isNew) => {
      const s = el("section", "pn-entry" + (isNew ? " pn-new" : ""));
      const h = el("div", "pn-ver");
      h.append(el("b", null, label(n)), el("span", null, " · " + fmtDate(n.date)));
      s.append(h, el("div", "pn-name", n.title));
      const ul = el("ul");
      for (const t of n.notes) ul.append(el("li", null, t));
      s.append(ul);
      return s;
    };
    const body = el("div", "pn-body");
    body.append(el("h3", "pn-section", "✨ What's new"), entry(NOTES[0], true));
    body.append(el("h3", "pn-section", "All updates"));
    for (const n of NOTES.slice(1)) body.append(entry(n, false));
    card.append(body);
    back.append(card);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(back);
    try { localStorage.setItem("mii-hub-notes-seen", latestKey()); } catch (e) { /* private mode */ }
  }
  function close() {
    const m = document.getElementById("patchNotes");
    if (m) m.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  // has the newest notes been opened yet? (for the "NEW" badge)
  const latestKey = () => NOTES[0].date + "|" + NOTES[0].title;
  function unseen() {
    try { return localStorage.getItem("mii-hub-notes-seen") !== latestKey(); } catch (e) { return false; }
  }

  root.PatchNotes = { NOTES, open, close, unseen };
})(typeof window !== "undefined" ? window : globalThis);
