// Runs every test file in this folder (npm test). Exits with 1 if any fails.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error("FAILED: " + f); }
}
console.log(failed ? failed + " test file(s) failed." : "All " + files.length + " test files passed.");
process.exit(failed ? 1 : 0);
