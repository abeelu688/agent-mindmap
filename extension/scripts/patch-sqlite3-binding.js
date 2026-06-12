const fs = require("fs");
const path = require("path");

// Patch @vscode/sqlite3/lib/sqlite3-binding.js to support cross-platform prebuilds.
// The original file hardcodes require('../build/Release/vscode-sqlite3.node')
// which only works for the platform where npm install was run.
// We replace it with a loader that tries prebuild paths for all platforms.

const bindingPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@vscode",
  "sqlite3",
  "lib",
  "sqlite3-binding.js"
);

const PATCHED_HEADER = "/* agent-mindmap-cross-platform-patch */";

if (!fs.existsSync(bindingPath)) {
  // @vscode/sqlite3 not installed (e.g. npm ci with --ignore-scripts)
  process.exit(0);
}

const content = fs.readFileSync(bindingPath, "utf8");

if (content.includes(PATCHED_HEADER)) {
  // Already patched
  process.exit(0);
}

const patched = `${PATCHED_HEADER}
const path = require('path');
const fs = require('fs');

function tryLoad(p) {
  if (fs.existsSync(p)) {
    return require(p);
  }
  return null;
}

const napiVersions = [6];
const platform = process.platform;
const arch = process.arch;
const libc = platform === "linux" && fs.existsSync("/etc/alpine-release") ? "musl" : "glibc";

let binding = null;

for (const napi of napiVersions) {
  const prebuildDir = path.join(__dirname, "binding", \`napi-v\${napi}-\${platform}-\${libc}-\${arch}\`);
  const prebuildPath = path.join(prebuildDir, "node_sqlite3.node");
  binding = tryLoad(prebuildPath);
  if (binding) break;
}

if (!binding) {
  try {
    binding = require("../build/Release/vscode-sqlite3.node");
  } catch (_) {}
}

module.exports = exports = binding;
`;

fs.writeFileSync(bindingPath, patched, "utf8");
console.log("[agent-mindmap] Patched @vscode/sqlite3 binding loader for cross-platform support");
