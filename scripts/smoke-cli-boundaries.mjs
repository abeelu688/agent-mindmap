#!/usr/bin/env node
/**
 * Smoke test: verify the CLI bundle has no resolved paths pointing into
 * extension/src/ — enforces that CLI depends only on @agent-mindmap/core.
 *
 * Uses esbuild's metafile output to inspect the bundle's resolved inputs.
 * Run after `npm run build:cli`.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const METAFILE = path.join(ROOT, "cli", "dist", "meta.json");
const CLI_BUNDLE = path.join(ROOT, "cli", "dist", "index.js");

function main() {
  // Check bundle exists
  if (!fs.existsSync(CLI_BUNDLE)) {
    console.error("smoke-cli-boundaries: CLI bundle not found. Run `npm run build:cli` first.");
    process.exit(1);
  }

  // Check metafile
  if (!fs.existsSync(METAFILE)) {
    console.error(
      "smoke-cli-boundaries: metafile not found. The build script must enable `metafile: true`."
    );
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(METAFILE, "utf8"));
  const inputs = Object.keys(meta.inputs || {});

  const violations = [];
  for (const inputPath of inputs) {
    const abs = path.resolve(ROOT, inputPath);
    const rel = path.relative(ROOT, abs);

    // Check: no extension/src in resolved inputs
    if (rel.includes("extension/src") || rel.includes("extension\\src")) {
      violations.push({
        input: rel,
        rule: "A2: cli must not depend on extension/src",
      });
    }

    // Check: no vscode in resolved inputs (beyond node_modules)
    if (rel.includes("node_modules/vscode/") || rel.includes("node_modules\\vscode\\")) {
      violations.push({
        input: rel,
        rule: "A1: core (which CLI depends on) must not import vscode",
      });
    }
  }

  if (violations.length === 0) {
    console.log(`smoke-cli-boundaries: OK (${inputs.length} inputs, no extension/ or vscode/ paths)`);
    process.exit(0);
  }

  console.error("smoke-cli-boundaries: FAILED\n");
  for (const v of violations) {
    console.error(`  ${v.input} [${v.rule}]`);
  }
  process.exit(1);
}

main();
