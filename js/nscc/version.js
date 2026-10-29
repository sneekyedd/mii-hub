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
  "version": "0.2.3",
  "date": "2026-10-29",
  "notes": [
    "0.2.3: The update message is easy to read (in light and dark mode) and shows the exact command to paste to get the update, with a Copy button.",
    "0.2.2: Spin the camera all the way round the office (the wall in the way hides, like a dollhouse). When the view is turned or zoomed, a Center the office button glides it back.",
    "0.2.1: Runs much lighter: starts at your screen's normal sharpness and only adds extra smoothing when your computer has time to spare. Settings shows how smoothly it's running and warns if the browser isn't using the graphics card.",
    "0.2.0: Sharper graphics, a Settings window (check for updates, graphics quality) and an auto-updating launcher (Start MiiNSCC).",
    "0.1.0: The first version of the office board."
  ]
}/*END*/;
