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
  "version": "0.2.0",
  "date": "2026-10-29",
  "notes": [
    "0.2.0: Sharper graphics, a Settings window (check for updates, graphics quality) and an auto-updating launcher (Start MiiNSCC).",
    "0.1.0: The first version of the office board."
  ]
}/*END*/;
