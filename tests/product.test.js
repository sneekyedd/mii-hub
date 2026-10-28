// Run with: node tests/product.test.js
// MiiNSCC is only the office board: checks that the page loads only what it
// needs, the old game parts are gone, the Miis only ever make friendly small
// talk (no relationships or arguments), and no server address is in any file.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ---------- the page ----------
const html = read("index.html");
assert.ok(/<title>MiiNSCC<\/title>/.test(html), "page title");
assert.ok(/<h1>MiiNSCC<\/h1>/.test(html), "header name");
assert.ok(!/Mii Hub/i.test(html), "no old name on the page");
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
const allowed = [
  "js/vendor/three.min.js", "js/vendor/GLTFLoader.js", "js/vendor/SkeletonUtils.js", "js/vendor/OrbitControls.js",
  "js/vendor/RoundedBoxGeometry.js", "js/vendor/BufferGeometryUtils.js",
  "js/sampleGlb.js", "js/miiModel.js", "js/nav.js",
  "js/nscc/logic.js", "js/nscc/store.js", "js/nscc/chatter.js", "js/nscc/office.js", "js/nscc/officeHub.js", "js/nscc/app.js",
];
assert.deepStrictEqual(scripts, allowed, "index.html loads exactly the MiiNSCC files");
for (const s of scripts) assert.ok(exists(s), s + " exists");
const styles = Array.from(html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)).map((m) => m[1]);
assert.deepStrictEqual(styles, ["css/style.css"]);
// no controls for going to other places
assert.ok(!/sceneTabs|stageScenes|places|planet/i.test(html), "no place switching on the page");

// every .js file in js/ is one the page loads (nothing unused left behind)
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).split(path.sep).join("/")]));
}
const jsFiles = walk("js").filter((f) => f.endsWith(".js"));
assert.deepStrictEqual(jsFiles.filter((f) => !allowed.includes(f)), [], "no unused scripts");

// ---------- the Mii Hub game parts are gone ----------
for (const gone of ["electron", "server", "music", ".github/workflows", "js/paintball", "js/hub3d.js", "js/world3d.js", "js/planet3d.js",
  "js/chess.js", "js/minigames.js", "js/progress.js", "js/homes.js", "js/life.js", "js/town.js", "js/account.js", "js/weather3d.js",
  "js/patchNotes.js", "js/dialogue.js", "render.yaml", "css/account.css", "css/life.css"]) {
  assert.ok(!exists(gone), gone + " was removed");
}
const pkg = JSON.parse(read("package.json"));
assert.strictEqual(pkg.name, "miinscc");
assert.ok(!pkg.main && !pkg.build && !pkg.dependencies && !pkg.devDependencies, "no Electron app or build config");
assert.ok(!JSON.stringify(pkg).match(/electron/i));

// ---------- only friendly small talk ----------
// (no relationships, crushes, couples, rivals, fights, arguments or moods anywhere in the code)
const ourCode = walk("js/nscc").map((f) => [f, read(f)]).concat([["js/miiModel.js", read("js/miiModel.js")], ["js/nav.js", read("js/nav.js")]]);
const banned = /\b(friendships?|best ?friends?|relationships?|crush(es)?|couples?|dating|romance|love ?interest|rivals?|rivalry|fights?|fighting|argu(e|ing|ment)s?|quarrel|enem(y|ies)|moods?|sad(ness)?|angry|grumpy|jealous|hearts?|breakups?|coins?|wish(es)?|stickers?|paintball|minigames?)\b/i;
for (const [f, src] of ourCode) {
  const hit = src.match(banned);
  assert.ok(!hit, f + " mentions '" + (hit && hit[0]) + "'");
}
global.self = global;
const C = require("../js/nscc/chatter.js");
const lines = C.allLines();
assert.ok(lines.length > 40, "plenty of lines");
assert.ok(C.CONVERSATIONS.length >= 10);
for (const conv of C.CONVERSATIONS) assert.ok(conv.length >= 2 && conv.length <= 4, "chats are short");
for (const l of lines) {
  assert.ok(!banned.test(l), "chatter line: " + l);
  assert.ok(!/\b(hate|stupid|dumb|idiot|shut up|ugly|kiss|date)\b/i.test(l), "work-safe line: " + l);
}
assert.strictEqual(C.fill("Off to {place}!", { place: "Lunch" }), "Off to Lunch!");

// ---------- no server address, IP or secret anywhere ----------
const textFiles = walk(".").filter((f) => !f.startsWith("./.git/") && !f.startsWith(".git/") && !f.includes("node_modules") && /\.(js|html|css|json|md|yml|yaml|txt)$/.test(f) && !f.includes("js/vendor/") && !f.includes("tests/"));
for (const f of textFiles) {
  const src = read(f);
  assert.ok(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(src.replace(/\b0\.\d+\.\d+\.\d+\b/g, "")), f + " has an IP address");
  assert.ok(!/wss?:\/\/|onrender\.com|pb-config/i.test(src), f + " has a server address");
}

console.log("All product tests passed (" + jsFiles.length + " scripts, " + lines.length + " chatter lines).");
