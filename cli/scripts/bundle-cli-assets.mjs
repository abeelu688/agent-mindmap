#!/usr/bin/env node
/**
 * Bundle webview assets into the CLI package.
 *
 * Copies the built webview assets (webview.js, webview.css, transcript-markdown.js)
 * from extension/media/ into cli/media/ so the CLI can produce offline HTML packages.
 *
 * This script runs as part of the CLI build pipeline.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(cliDir, "..");
const extensionMediaDir = path.join(rootDir, "extension", "media");
const cliMediaDir = path.join(cliDir, "media");

const REQUIRED_FILES = ["webview.js", "webview.css", "transcript-markdown.js"];

// Ensure extension media exists
if (!fs.existsSync(extensionMediaDir)) {
  console.error(
    "Error: extension/media/ not found. Run `npm run build:webview` first."
  );
  process.exit(1);
}

// Create cli/media/ directory
fs.mkdirSync(cliMediaDir, { recursive: true });

// Copy each required file
let copied = 0;
for (const file of REQUIRED_FILES) {
  const src = path.join(extensionMediaDir, file);
  const dest = path.join(cliMediaDir, file);

  if (!fs.existsSync(src)) {
    console.error(`Error: Required asset not found: ${src}`);
    console.error("Run `npm run build:webview` to generate webview assets.");
    process.exit(1);
  }

  fs.copyFileSync(src, dest);
  const sizeKb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${file} (${sizeKb}KB)`);
  copied++;
}

console.log(`CLI media assets bundled (${copied} files).`);
