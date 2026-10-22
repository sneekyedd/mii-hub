/*
 * electron/localServer.js
 * "Show as tab in browser" (Settings): serves the Mii Hub files to your own web
 * browser from this computer only (127.0.0.1), so the hub can open in a normal tab.
 * (The app's files are packed inside the app, where a browser can't read them.)
 *
 * It uses the same port every time if it can, so the browser keeps the same saved
 * Miis between visits. A browser keeps its own saves, separate from the app's.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 47863;
// only the files the page needs (never anything else on the computer)
const ALLOWED = ["index.html", "css", "js", "fonts", "build"];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

let server = null;
let url = null;

function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""); } catch (e) { res.writeHead(400); res.end(); return; }
  if (!rel) rel = "index.html";
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !ALLOWED.includes(top)) { res.writeHead(404); res.end("Not found"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

// Starts the server (once) and resolves with its address.
function start() {
  if (url) return Promise.resolve(url);
  return new Promise((resolve, reject) => {
    const listen = (port) => {
      server = http.createServer(handle);
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && port !== 0) listen(0); // (the usual port is taken: any free one)
        else reject(err);
      });
      server.listen(port, "127.0.0.1", () => {
        url = "http://127.0.0.1:" + server.address().port + "/";
        resolve(url);
      });
    };
    listen(PORT);
  });
}

function stop() {
  if (server) server.close();
  server = null;
  url = null;
}

module.exports = { start, stop };
