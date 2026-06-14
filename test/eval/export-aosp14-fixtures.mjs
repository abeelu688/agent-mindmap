#!/usr/bin/env node
/**
 * Copy Cursor agent-transcripts into test/fixtures/aosp14/.
 * Usage:
 *   node test/eval/export-aosp14-fixtures.mjs --source=<agent-transcripts-dir> \
 *     [--project-slug=home-example-cursor-aosp14] \
 *     [--project-path=/home/example/cursor/aosp14] \
 *     [--dry-run] [--force]
 */
import { createHash } from "crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const DEST_ROOT = path.join(REPO_ROOT, "test/fixtures/aosp14");
const DEST_TRANSCRIPTS = path.join(DEST_ROOT, "transcripts");
const MANIFEST_PATH = path.join(DEST_ROOT, "manifest.json");

const DEFAULT_PROJECT_SLUG = "home-example-cursor-aosp14";
const DEFAULT_PROJECT_PATH = "/home/example/cursor/aosp14";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const dryRun = args.has("--dry-run");
const force = args.has("--force");

function readArg(prefix) {
  for (const arg of rawArgs) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function usageAndExit(code = 1) {
  console.error(
    "Usage: node test/eval/export-aosp14-fixtures.mjs --source=<agent-transcripts-dir> " +
      "[--project-slug=<slug>] [--project-path=<path>] [--dry-run] [--force]"
  );
  process.exit(code);
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function listSessionJsonl(sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sessionId = entry.name;
    const src = path.join(sourceDir, sessionId, `${sessionId}.jsonl`);
    try {
      const st = await stat(src);
      if (!st.isFile()) {
        continue;
      }
      sessions.push({ sessionId, src, bytes: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // skip
    }
  }
  sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return sessions;
}

async function main() {
  const sourceDir = readArg("--source=");
  if (!sourceDir) {
    console.error("Missing required --source=<agent-transcripts-dir>");
    usageAndExit(1);
  }

  const projectSlug = readArg("--project-slug=") ?? DEFAULT_PROJECT_SLUG;
  const projectPath = readArg("--project-path=") ?? DEFAULT_PROJECT_PATH;

  let sourceStat;
  try {
    sourceStat = await stat(sourceDir);
  } catch {
    console.error(`Source not found: ${sourceDir}`);
    process.exit(1);
  }
  if (!sourceStat.isDirectory()) {
    console.error(`Source is not a directory: ${sourceDir}`);
    process.exit(1);
  }

  const sessions = await listSessionJsonl(sourceDir);
  if (!sessions.length) {
    console.error(`No session jsonl under ${sourceDir}`);
    process.exit(1);
  }

  console.log(`Source: ${sourceDir}`);
  console.log(`Dest:   ${DEST_TRANSCRIPTS}`);
  console.log(`Sessions: ${sessions.length}`);
  if (dryRun) {
    console.log("(dry-run — no files written)");
  }

  const manifestSessions = [];

  for (const { sessionId, src, bytes, mtimeMs } of sessions) {
    const content = await readFile(src);
    const sha256 = sha256Hex(content);
    const destDir = path.join(DEST_TRANSCRIPTS, sessionId);
    const destFile = path.join(destDir, `${sessionId}.jsonl`);

    manifestSessions.push({
      sessionId,
      sha256,
      bytes: bytes ?? content.length,
      mtimeMs,
      relativePath: path.posix.join("transcripts", sessionId, `${sessionId}.jsonl`),
    });

    if (dryRun) {
      console.log(`  ${sessionId} (${content.length} bytes)`);
      continue;
    }

    if (!force) {
      try {
        const existing = await readFile(destFile);
        if (sha256Hex(existing) === sha256) {
          continue;
        }
      } catch {
        // copy
      }
    }

    await mkdir(destDir, { recursive: true });
    await copyFile(src, destFile);
    console.log(`  copied ${sessionId}`);
  }

  if (!dryRun) {
    const manifest = {
      fixtureSet: "aosp14",
      projectSlug,
      projectPath,
      exportedAt: new Date().toISOString(),
      sourceDir,
      sessionCount: manifestSessions.length,
      sessions: manifestSessions,
    };
    await mkdir(DEST_ROOT, { recursive: true });
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Wrote ${MANIFEST_PATH}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
