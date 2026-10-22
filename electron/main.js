/*
 * electron/main.js
 * Runs Mii Hub as a desktop app (its own window and icon) using Electron.
 * The app itself is the same index.html the browser version uses.
 */
const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const updater = require("./updater");
const localServer = require("./localServer");

// Only one Mii Hub window at a time; opening it again just brings it to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    title: "Mii Hub",
    backgroundColor: "#eef3f8",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.once("ready-to-show", () => win.show());
  updater.setup(win); // starts checking for updates a few seconds from now

  // Links open in the normal web browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Dropping a file outside the drop area shouldn't replace the app with that file.
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  // F11 = full screen, Ctrl/Cmd + R = reload, Ctrl/Cmd + Shift + I = developer tools
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (mod && input.key.toLowerCase() === "r") { win.reload(); e.preventDefault(); }
    else if (mod && input.shift && input.key.toLowerCase() === "i") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// The page can ask for the update status, start a check, or open the download page.
ipcMain.handle("update-get-status", () => updater.getStatus());
ipcMain.handle("update-check", () => { updater.check(true); return true; });
ipcMain.handle("update-open-releases", () => shell.openExternal(updater.RELEASES_PAGE));

// Settings → "Show as tab in browser": serve the app to this computer's browser and open it there.
ipcMain.handle("open-in-browser", async () => {
  try {
    const url = await localServer.start();
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Group pictures (📷) go into the Downloads folder. dataUrl is a PNG made by the page.
ipcMain.handle("save-photo", async (_e, dataUrl, fileName) => {
  try {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) throw new Error("not a picture");
    // a plain file name only (no folders), and never overwrite an older picture
    const base = String(fileName || "Mii Hub photo").replace(/\.png$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim().slice(0, 100) || "Mii Hub photo";
    const dir = app.getPath("downloads");
    let name = base + ".png";
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = base + " (" + i + ").png";
    await fs.promises.writeFile(path.join(dir, name), Buffer.from(m[1], "base64"));
    return { ok: true, name, path: path.join(dir, name) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  localServer.stop();
  if (process.platform !== "darwin") app.quit();
});
