#!/usr/bin/env node
// Verify locale bundles in extension/l10n/ all have the same key set as the
// English bundle (bundle.l10n.json). Empty bundles (with only a `_comment`
// placeholder) are exempt — they fall back to English at runtime.
//
// Usage: node scripts/check-l10n-keys.mjs
//
// Exit codes:
//   0 — all bundles consistent (or empty)
//   1 — one or more bundles have key drift

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const L10N_DIR = join(__dirname, "..", "extension", "l10n");

const ENGLISH_FILE = "bundle.l10n.json";
const PLACEHOLDER_KEY = "_comment";

function readBundle(file) {
  const path = join(L10N_DIR, file);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function realKeys(bundle) {
  return Object.keys(bundle).filter((k) => k !== PLACEHOLDER_KEY);
}

function main() {
  const english = readBundle(ENGLISH_FILE);
  const englishKeys = new Set(realKeys(english));

  const files = readdirSync(L10N_DIR)
    .filter((f) => f.startsWith("bundle.l10n.") && f.endsWith(".json"))
    .filter((f) => f !== ENGLISH_FILE);

  let problems = 0;

  for (const file of files) {
    const bundle = readBundle(file);
    const keys = realKeys(bundle);

    if (keys.length === 0) {
      console.log(`✓ ${file} — empty placeholder (falls back to English)`);
      continue;
    }

    const localeKeys = new Set(keys);
    const missing = [...englishKeys].filter((k) => !localeKeys.has(k));
    const extra = [...localeKeys].filter((k) => !englishKeys.has(k));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${file} — ${keys.length} keys, fully synced`);
      continue;
    }

    problems++;
    console.log(`✗ ${file}`);
    if (missing.length > 0) {
      console.log(`  missing ${missing.length} key(s):`);
      for (const k of missing.slice(0, 10)) console.log(`    - ${k}`);
      if (missing.length > 10) console.log(`    … and ${missing.length - 10} more`);
    }
    if (extra.length > 0) {
      console.log(`  extra ${extra.length} key(s) not in English bundle:`);
      for (const k of extra.slice(0, 10)) console.log(`    + ${k}`);
      if (extra.length > 10) console.log(`    … and ${extra.length - 10} more`);
    }
  }

  console.log("");
  console.log(`English bundle: ${englishKeys.size} keys`);
  console.log(`Locale bundles checked: ${files.length}`);
  if (problems > 0) {
    console.log(`Problems: ${problems}`);
    process.exit(1);
  }
  console.log("All bundles consistent.");
}

main();
