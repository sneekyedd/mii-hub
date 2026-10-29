/*
 * settings.js
 * The ⚙️ Settings window: the version, "Check for updates", and graphics quality.
 *
 * Updates: the newest version lives on GitHub (the miinscc branch). Checking reads its
 * version.js and compares. A page opened from a file can't replace its own files, so the
 * update itself is fetched by the launcher (Start MiiNSCC.bat / start-miinscc.sh) the next
 * time MiiNSCC is opened. (Once it's served by the office server, reopening the page is enough.)
 */
(function (root) {
  "use strict";

  const LATEST_URL = "https://raw.githubusercontent.com/sneekyedd/mii-hub/miinscc/js/nscc/version.js";
  const PREFS_KEY = "miinscc-settings";
  const QUALITY_NAMES = { auto: "Auto", high: "High", medium: "Medium", low: "Low" };

  const here = () => root.NSCC_VERSION || { version: "0.0.0", notes: [] };

  // "1.2.10" vs "1.2.9": compares number by number
  function newer(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }
  // pulls the JSON part out of a version.js file
  function parseVersionFile(text) {
    const m = /\/\*JSON\*\/([\s\S]*?)\/\*END\*\//.exec(String(text));
    if (!m) throw new Error("not a version file");
    return JSON.parse(m[1]);
  }
  async function checkLatest() {
    const res = await fetch(LATEST_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("GitHub said " + res.status);
    const latest = parseVersionFile(await res.text());
    return { latest, current: here(), update: newer(latest.version, here().version) };
  }

  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* private window */ } }

  function init(hub) {
    const prefs = loadPrefs();
    if (hub && hub.setQualityMode) hub.setQualityMode(prefs.quality || "auto");
    const modal = document.getElementById("settingsModal");
    const btn = document.getElementById("settingsBtn");
    const el = (id) => document.getElementById(id);
    if (!modal || !btn) return;

    const showUpdate = (r) => {
      btn.classList.toggle("has-update", !!(r && r.update));
      const out = el("updateResult");
      if (!r) return;
      out.className = "update-result " + (r.update ? "available" : "ok");
      if (r.update) {
        out.innerHTML = "<b>Version " + esc(r.latest.version) + " is available.</b> Close MiiNSCC and open it again with <b>Start MiiNSCC</b> to get it." +
          (r.latest.notes && r.latest.notes.length ? "<ul>" + r.latest.notes.slice(0, 3).map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "");
      } else out.textContent = "✓ You have the newest version.";
    };
    const check = async (quiet) => {
      const out = el("updateResult");
      if (!quiet) { out.className = "update-result"; out.textContent = "Checking…"; }
      try { showUpdate(await checkLatest()); } catch (e) {
        if (!quiet) { out.className = "update-result error"; out.textContent = "Couldn't check right now (no internet?). Try again later."; }
      }
    };

    function render() {
      const v = here();
      el("versionText").textContent = "Version " + v.version + (v.date ? " (" + v.date + ")" : "");
      el("notesList").innerHTML = (v.notes || []).map((n) => "<li>" + esc(n) + "</li>").join("");
      for (const b of modal.querySelectorAll("[data-quality]")) b.setAttribute("aria-pressed", String(b.dataset.quality === (prefs.quality || "auto")));
    }
    // how it's running (updated while Settings is open)
    const perf = () => {
      if (!hub || !hub.gpuInfo) return;
      const g = hub.gpuInfo();
      el("perfText").textContent = "Running at " + (g.fps || "…") + " frames a second · drawing at " + Math.round(g.pixelRatio * 100) + "% sharpness" + (g.shadows ? "" : " · shadows off") + (g.name ? " · " + g.name : "");
      el("perfWarn").hidden = !g.software;
    };
    let perfTimer = null;
    btn.addEventListener("click", () => { render(); perf(); modal.hidden = false; clearInterval(perfTimer); perfTimer = setInterval(() => { if (modal.hidden) clearInterval(perfTimer); else perf(); }, 1000); });
    // not using the graphics card at all: say so once, right away (a dot on ⚙️)
    setTimeout(() => { if (hub && hub.gpuInfo && hub.gpuInfo().software) btn.classList.add("has-update"); }, 3000);
    el("settingsClose").addEventListener("click", () => { modal.hidden = true; });
    modal.addEventListener("pointerdown", (e) => { if (e.target === modal) modal.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) modal.hidden = true; });
    el("checkBtn").addEventListener("click", () => check(false));
    for (const b of modal.querySelectorAll("[data-quality]")) {
      b.addEventListener("click", () => {
        prefs.quality = b.dataset.quality;
        savePrefs(prefs);
        if (hub && hub.setQualityMode) hub.setQualityMode(prefs.quality);
        render();
      });
    }
    // a quiet check when it opens (and every few hours on the TV): a dot on ⚙️ if there's something new
    check(true);
    setInterval(() => check(true), 3 * 3600e3);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  root.NSCCSettings = { init, checkLatest, newer, parseVersionFile, QUALITY_NAMES, LATEST_URL };
})(typeof window !== "undefined" ? window : globalThis);
