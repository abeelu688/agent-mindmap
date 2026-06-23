#!/usr/bin/env node
/**
 * Enforce package boundary rules A1–A8 from plans/cli-refactor-cleanup-master.md.
 *
 * Checks:
 *   A1. core/src/** must not import from "vscode" or extension/cli/webview/mcp-server
 *   A2. cli/src/** must not import from extension/src
 *   A6. No upward imports (cli→core is fine, core→cli is not; extension→core is fine, core→extension is not)
 *   A7. Type-only imports cannot bypass these rules
 *   A9. No deep imports into @agent-mindmap/core/ (must use barrel)
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

// ── Rule definitions ──────────────────────────────────────────────────────────

/** Each rule: { name, glob (under ROOT), pattern (RegExp), message } */
const RULES = [
  // A1 — core/ is VS Code-free
  {
    name: "A1:core-no-vscode",
    glob: "core/src",
    pattern: /(?:from\s+["']vscode["']|require\s*\(\s*["']vscode["']\s*\))/,
    message: 'core/ must not import from "vscode" (rule A1)',
  },
  {
    name: "A1:core-no-extension",
    glob: "core/src",
    pattern: /(?:from\s+["'][^"']*(?:extension\/src|\/extension\/src)[^"']*["']|import\s*\(\s*["'][^"']*(?:extension\/src|\/extension\/src)[^"']*["']\s*\))/,
    message: "core/ must not import from extension/src (rule A1)",
  },
  {
    name: "A1:core-no-cli",
    glob: "core/src",
    pattern: /(?:from\s+["'][^"']*(?:cli\/src|\/cli\/src)[^"']*["']|import\s*\(\s*["'][^"']*(?:cli\/src|\/cli\/src)[^"']*["']\s*\))/,
    message: "core/ must not import from cli/src (rule A1)",
  },
  {
    name: "A1:core-no-webview",
    glob: "core/src",
    pattern: /(?:from\s+["'][^"']*(?:webview\/src|\/webview\/src)[^"']*["']|import\s*\(\s*["'][^"']*(?:webview\/src|\/webview\/src)[^"']*["']\s*\))/,
    message: "core/ must not import from webview/src (rule A1)",
  },
  {
    name: "A1:core-no-mcp-server",
    glob: "core/src",
    pattern: /(?:from\s+["'][^"']*(?:mcp-server\/src|\/mcp-server\/src)[^"']*["']|import\s*\(\s*["'][^"']*(?:mcp-server\/src|\/mcp-server\/src)[^"']*["']\s*\))/,
    message: "core/ must not import from mcp-server/src (rule A1)",
  },

  // A2 — cli/ imports business logic only from @agent-mindmap/core
  {
    name: "A2:cli-no-extension",
    glob: "cli/src",
    pattern: /(?:from\s+["'][^"']*(?:extension\/src|\/extension\/src)[^"']*["']|import\s*\(\s*["'][^"']*(?:extension\/src|\/extension\/src)[^"']*["']\s*\))/,
    message: "cli/ must not import from extension/src (rule A2)",
  },

  // A6 — no upward imports (extension→core is fine, but not the reverse)
  // Already covered by A1:core-no-extension above.
  // Also: cli→core is fine (via @agent-mindmap/core), but cli must not go to extension.
  // Already covered by A2:cli-no-extension above.

  // A9 — no deep imports into @agent-mindmap/core/
  {
    name: "A9:no-deep-core-import",
    glob: "", // check all source dirs
    pattern: /from\s+["']@agent-mindmap\/core\/[^"']*["']/,
    message:
      'Deep import into @agent-mindmap/core/ is forbidden — import from "@agent-mindmap/core" (rule A9)',
  },
];

// ── File traversal ────────────────────────────────────────────────────────────

function listSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
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

function lineWithoutStringLiterals(line) {
  // Strip comments (simple — doesn't handle /* */ blocks across lines)
  const commentIdx = line.indexOf("//");
  const code = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  return code;
}

function fileMatchesGlob(filePath, glob) {
  if (!glob) return true;
  const rel = path.relative(ROOT, filePath);
  return rel.startsWith(glob + "/") || rel.startsWith(glob + path.sep);
}

// ── Scanner ───────────────────────────────────────────────────────────────────

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const violations = [];

  for (const rule of RULES) {
    if (!fileMatchesGlob(filePath, rule.glob)) {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const code = lineWithoutStringLiterals(lines[i]);
      if (!code.trim()) continue;
      if (rule.pattern.test(code)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: rule.name,
          message: rule.message,
          snippet: code.trim(),
        });
      }
    }
  }
  return violations;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Scan all relevant source directories
  const sourceDirs = [
    path.join(ROOT, "core", "src"),
    path.join(ROOT, "cli", "src"),
    path.join(ROOT, "extension", "src"),
    path.join(ROOT, "mcp-server", "src"),
    path.join(ROOT, "shared", "src"),
  ];

  const allFiles = sourceDirs.flatMap((dir) => listSourceFiles(dir));
  const allViolations = [];

  for (const file of allFiles) {
    const violations = scanFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log(
      `check-package-boundaries: OK (${allFiles.length} source files scanned)`
    );
    process.exit(0);
  }

  console.error("check-package-boundaries: FAILED\n");
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`);
    console.error(`    ${v.snippet}`);
    console.error(`    → ${v.message}\n`);
  }
  console.error(
    "See plans/cli-refactor-cleanup-master.md § Architecture rules A1–A10"
  );
  process.exit(1);
}

main();
