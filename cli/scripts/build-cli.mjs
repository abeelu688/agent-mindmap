#!/usr/bin/env node
/**
 * Build the CLI bundle using esbuild.
 *
 * Produces a single CJS bundle with shebang, suitable for `npm install -g`.
 */
import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(__dirname, "..");

// Ensure core is built first (needed for type resolution)
const coreDist = path.resolve(cliDir, "..", "core", "dist");
if (!fs.existsSync(path.join(coreDist, "index.js"))) {
  console.error("Error: @agent-mindmap/core is not built. Run `npm run build:core` first.");
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(cliDir, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(cliDir, "dist", "index.js"),
  banner: {
    js: '#!/usr/bin/env node\n// @agent-mindmap/cli — built with esbuild',
  },
  external: [
    // Native modules that can't be bundled
    "@vscode/sqlite3",
    "better-sqlite3",
    // Large packages that should stay external
    "@modelcontextprotocol/sdk",
  ],
  alias: {
    "@agent-mindmap/core": path.join(coreDist, "index.js"),
    "@agent-mindmap/shared": path.resolve(cliDir, "..", "shared", "dist", "index.js"),
  },
  logLevel: "info",
  sourcemap: true,
  minify: false,
});

if (result.errors.length > 0) {
  process.exit(1);
}

console.log("CLI bundle built successfully.");

// ── Bundle webview assets into cli/media/ ──────────────────────────────────
import("./bundle-cli-assets.mjs");
