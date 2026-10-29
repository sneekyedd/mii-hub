/*
 * version.js
 * Which version of MiiNSCC this is, and what's new in it.
 * Settings → "Check for updates" reads this same file from GitHub and compares.
 *
 * When releasing an update: raise "version" here AND in package.json (the tests check
 * they match), and put a line about it at the top of "notes".
 * (Keep the part between the two markers plain JSON: the update check reads it as JSON.)
 */
window.NSCC_VERSION = /*JSON*/{
  "version": "0.4.0",
  "date": "2026-10-29",
  "notes": [
    "0.4.0: The office now has the real shape of our office, taken from the 3D model of it: the walls, doors, windows and the support columns are where they really are, with a clean, solid floor. Move the camera any way you like: drag to turn it, use the right mouse button (or two fingers) to slide it, and the wheel to zoom; it never loses the office. Center the office looks in from the front door's side. Only the outside walls in the way are lowered; the walls inside the office stay solid (you look into the server room from above).",
    "0.3.1: Miis now fade away smoothly as they walk down the hallway on the way out (and fade in as they walk back in), instead of just disappearing. Every room has a real door that swings open when someone walks through and closes after. The storage room's (D) door is now where it really is: on the workbench wall, facing the main room.",
    "0.3.0: The real office! A223 Information Technology with its rooms: the server room (E), the storage room (D), a conference room (C) and two private offices (A and B), with the desks where they really are. Everyone comes in and goes out through the front door from the hallway. Give someone their own desk or office under Workspace in their panel (the desk numbers show in the office). Miis no longer wave their arms about while walking. And a fresh green look.",
    "0.2.4: Background music (the same looping song as Mii Hub). Turn it on or off in ⚙️ Settings.",
    "0.2.3: The update message is easy to read (in light and dark mode) and shows the exact command to paste to get the update, with a Copy button.",
    "0.2.2: Spin the camera all the way round the office (the wall in the way hides, like a dollhouse). When the view is turned or zoomed, a Center the office button glides it back.",
    "0.2.1: Runs much lighter: starts at your screen's normal sharpness and only adds extra smoothing when your computer has time to spare. Settings shows how smoothly it's running and warns if the browser isn't using the graphics card.",
    "0.2.0: Sharper graphics, a Settings window (check for updates, graphics quality) and an auto-updating launcher (Start MiiNSCC).",
    "0.1.0: The first version of the office board."
  ]
}/*END*/;
