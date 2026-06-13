#!/usr/bin/env node
// Sync the version field from the root package.json to all sub-packages.
//
// The root package.json is the single source of truth for the project version.
// vsce reads `extension/package.json` for the VSIX filename and Marketplace
// metadata, so we mirror the value there (and into webview/) before packaging.
//
// Usage:
//   node scripts/sync-version.mjs           — write mode (sync to subpackages)
//   node scripts/sync-version.mjs --check   — verify mode (exit 1 on drift)

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ROOT_PACKAGE = join(ROOT, "package.json");
const TARGETS = [
  join(ROOT, "extension", "package.json"),
  join(ROOT, "webview", "package.json"),
];

const checkMode = process.argv.includes("--check");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  // Preserve trailing newline (npm convention).
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function relative(absPath) {
  return absPath.startsWith(ROOT) ? absPath.slice(ROOT.length + 1) : absPath;
}

const root = readJson(ROOT_PACKAGE);
const targetVersion = root.version;
if (typeof targetVersion !== "string" || !/^\d+\.\d+\.\d+/.test(targetVersion)) {
  console.error(`Root package.json has no valid semver version: ${targetVersion}`);
  process.exit(1);
}

let drift = 0;
let updated = 0;

for (const path of TARGETS) {
  const pkg = readJson(path);
  const current = pkg.version;
  if (current === targetVersion) {
    console.log(`✓ ${relative(path)} — ${current}`);
    continue;
  }

  if (checkMode) {
    drift++;
    console.log(`✗ ${relative(path)} — has ${current}, root says ${targetVersion}`);
    continue;
  }

  pkg.version = targetVersion;
  writeJson(path, pkg);
  updated++;
  console.log(`→ ${relative(path)} — updated ${current} → ${targetVersion}`);
}

if (checkMode) {
  if (drift > 0) {
    console.log("");
    console.log(`Version drift detected. Run \`npm run version:sync\` to fix.`);
    process.exit(1);
  }
  console.log("");
  console.log(`All package.json files match root version ${targetVersion}.`);
  process.exit(0);
}

console.log("");
if (updated === 0) {
  console.log(`All package.json files already at ${targetVersion}. Nothing to do.`);
} else {
  console.log(`Synced ${updated} package.json file(s) to ${targetVersion}.`);
}
