/*
 * electron/preload.js
 * Lets the Mii Hub page talk to the desktop app safely: it can show the
 * version number and ask for an update check.
 * (Not used in the browser version.)
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miiHubDesktop", {
  getStatus: () => ipcRenderer.invoke("update-get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  openReleases: () => ipcRenderer.invoke("update-open-releases"),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_e, status) => callback(status)),
  // Settings: open the hub in the normal web browser too
  openInBrowser: () => ipcRenderer.invoke("open-in-browser"),
  // 📷 group pictures: saved in the Downloads folder
  savePhoto: (dataUrl, fileName) => ipcRenderer.invoke("save-photo", dataUrl, fileName),
});
