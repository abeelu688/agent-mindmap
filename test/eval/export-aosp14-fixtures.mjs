#!/usr/bin/env node
/**
 * Copy aosp14 Cursor agent-transcripts into test/fixtures/aosp14/.
 * Usage: node test/eval/export-aosp14-fixtures.mjs [--dry-run] [--force]
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
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const DEFAULT_SOURCE = path.join(
  os.homedir(),
  ".cursor",
  "projects",
  "home-example-cursor-aosp14",
  "agent-transcripts"
);
const DEST_ROOT = path.join(REPO_ROOT, "test/fixtures/aosp14");
const DEST_TRANSCRIPTS = path.join(DEST_ROOT, "transcripts");
const MANIFEST_PATH = path.join(DEST_ROOT, "manifest.json");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

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
  let sourceDir = DEFAULT_SOURCE;
  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      sourceDir = arg.slice("--source=".length);
    }
  }

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
      projectSlug: "home-example-cursor-aosp14",
      projectPath: "/home/example/cursor/aosp14",
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
