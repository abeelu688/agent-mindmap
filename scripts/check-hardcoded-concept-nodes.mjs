#!/usr/bin/env node
/**
 * Fail if production extension/src contains hardcoded concept-path segment names
 * used for branching or rewriting. See .cursor/rules/no-hardcoded-concept-nodes.mdc
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(HERE, "..", "extension", "src");

/** Known domain segments that must only appear via ontology/tests, not src logic. */
const FORBIDDEN_SEGMENT_LITERALS = [
  "android",
  "runtime",
  "art",
  "aosp",
  "mobile",
  "jni",
  "androidruntime",
  "android-runtime",
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Files allowed to mention segments in neutral docs only (still checked for branching). */
const EXTRA_SKIP = new Set([
  // l10n strings may mention user-visible labels from transcripts
]);

function listSourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "dist") {
        continue;
      }
      listSourceFiles(full, out);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(name.name))) {
      out.push(full);
    }
  }
  return out;
}

function lineStrippedComment(line) {
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

const BRANCH_PATTERNS = FORBIDDEN_SEGMENT_LITERALS.flatMap((seg) => [
  new RegExp(`\\.key\\s*===\\s*["']${seg}["']`, "i"),
  new RegExp(`\\.key\\s*!==\\s*["']${seg}["']`, "i"),
  new RegExp(`\\bkey\\s*===\\s*["']${seg}["']`, "i"),
  new RegExp(`\\{\\s*key:\\s*["']${seg}["']`, "i"),
  new RegExp(`\\blabel:\\s*["']${seg}["']`, "i"),
  new RegExp(`\\bcanonical:\\s*["']${seg}["']`, "i"),
  new RegExp(`new\\s+Set\\(\\[[^\\]]*["']${seg}["']`, "i"),
]);

const PROMPT_JSON_EXAMPLE = /segmentEquivalences.*canonical.*(?:art|android|runtime)/i;

function scanFile(filePath) {
  const rel = path.relative(path.join(HERE, ".."), filePath);
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const code = lineStrippedComment(lines[i]);
    if (!code.trim()) {
      continue;
    }
    for (const re of BRANCH_PATTERNS) {
      if (re.test(code)) {
        hits.push({ line: i + 1, kind: "branch", snippet: code.trim() });
        break;
      }
    }
    if (rel.includes("prompt") && PROMPT_JSON_EXAMPLE.test(code)) {
      hits.push({
        line: i + 1,
        kind: "prompt-domain-example",
        snippet: code.trim(),
      });
    }
  }
  return hits;
}

function main() {
  const files = listSourceFiles(SRC_ROOT);
  const violations = [];

  for (const file of files) {
    const rel = path.relative(path.join(HERE, ".."), file);
    if (EXTRA_SKIP.has(rel)) {
      continue;
    }
    const hits = scanFile(file);
    if (hits.length) {
      violations.push({ file: rel, hits });
    }
  }

  if (!violations.length) {
    console.log(
      `check-hardcoded-concept-nodes: OK (${files.length} files under extension/src)`
    );
    process.exit(0);
  }

  console.error("check-hardcoded-concept-nodes: FAILED\n");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const h of v.hits) {
      console.error(`    L${h.line} [${h.kind}] ${h.snippet}`);
    }
  }
  console.error(
    "\nUse ontology segmentEquivalences + resolveConceptPathWithEquivalences instead."
  );
  console.error("See .cursor/rules/no-hardcoded-concept-nodes.mdc");
  process.exit(1);
}

main();
