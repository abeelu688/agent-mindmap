import * as fs from "fs/promises";
import * as path from "path";
import { STORE_LAYOUT } from "../storeLayout";
import {
  readConceptTrieMerge,
  readMergeRecord,
  readOntologyIndex,
  readOntologyRecord,
} from "../storeReader";
import { looksLikeSessionRecord, validateAndBackfillRecord } from "./recordValidate";
import type { SqliteStore } from "./sqliteStore";
import type { SessionRecord } from "../storeTypes";

/**
 * One-shot JSON → SQLite migration (P2.2).
 *
 * Reads the legacy on-disk JSON layout under `storeDir` and writes it into an
 * already-open {@link SqliteStore}. The original JSON files are NOT deleted —
 * they are kept for one release so downgrade is safe (TEAM_MODE.md §Migration 1).
 *
 * Idempotency: the set of files to import is snapshotted at the start. Session
 * records that already exist in the DB with the same `analyzedAt` +
 * `transcriptSha256` are skipped (no revision bump), so re-running migration on
 * an unchanged file set is a no-op. kv writes (concept-trie, ontology) are
 * upserts and naturally idempotent.
 *
 * Concurrent-write safety: only files present at snapshot time are imported.
 * JSON files written by the extension during the import window are excluded
 * from this run and picked up on a re-run (which is safe because of the
 * skip-if-identical rule). The extension's write-pause/queue during import is
 * handled at the wiring layer (P2.3), not here.
 *
 * Not in scope (per P2.2): wiring this into extension activation. The module
 * is pure I/O over a storeDir + an open SqliteStore, so it is testable in
 * isolation.
 */
export interface MigrationResult {
  /** Number of session records imported (excluding skipped duplicates). */
  sessionCount: number;
  /** Number of session records skipped because they were already current. */
  skippedSessionCount: number;
  projectSlugs: string[];
  migratedConceptTrie: boolean;
  migratedDeterministicMerge: boolean;
  migratedLlmRefinedMerge: boolean;
  llmMergeCacheCount: number;
  migratedOntologyIndex: boolean;
  ontologyRecordCount: number;
  /** Snapshotted JSON file paths (relative to storeDir, sorted) — for verification. */
  snapshotFiles: string[];
}

interface FileSnapshot {
  sessions: string[];
  conceptTrie: boolean;
  deterministic: boolean;
  llmRefined: boolean;
  llmMergeCacheKeys: string[];
  ontologyIndex: boolean;
  ontologyCacheKeys: string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Enumerate the legacy JSON files to import, in a deterministic order. */
async function snapshotJsonFiles(storeDir: string): Promise<FileSnapshot> {
  const sessionsRoot = path.join(storeDir, STORE_LAYOUT.sessionsDir);
  const sessions: string[] = [];
  if (await pathExists(sessionsRoot)) {
    let projectDirs: string[] = [];
    try {
      projectDirs = await fs.readdir(sessionsRoot);
    } catch {
      projectDirs = [];
    }
    for (const projectSlug of projectDirs.sort()) {
      const slugDir = path.join(sessionsRoot, projectSlug);
      let stat;
      try {
        stat = await fs.stat(slugDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) {
        continue;
      }
      let files: string[] = [];
      try {
        files = await fs.readdir(slugDir);
      } catch {
        continue;
      }
      for (const file of files.sort()) {
        if (file.endsWith(".json")) {
          sessions.push(path.join(STORE_LAYOUT.sessionsDir, projectSlug, file));
        }
      }
    }
  }

  const conceptTriePath = path.join(storeDir, STORE_LAYOUT.conceptTrieFile);
  const deterministicPath = path.join(storeDir, STORE_LAYOUT.deterministicFile);
  const llmRefinedPath = path.join(storeDir, STORE_LAYOUT.llmRefinedFile);
  const llmMergeCacheRoot = path.join(storeDir, STORE_LAYOUT.mergeCacheDir);
  const ontologyIndexPath = path.join(storeDir, STORE_LAYOUT.ontologyIndexFile);
  const ontologyCacheRoot = path.join(storeDir, STORE_LAYOUT.ontologyCacheDir);

  const llmMergeCacheKeys: string[] = [];
  if (await pathExists(llmMergeCacheRoot)) {
    try {
      const entries = await fs.readdir(llmMergeCacheRoot);
      for (const entry of entries.sort()) {
        if (entry.endsWith(".json")) {
          llmMergeCacheKeys.push(entry.slice(0, -".json".length));
        }
      }
    } catch {
      // ignore unreadable cache dir
    }
  }

  const ontologyCacheKeys: string[] = [];
  if (await pathExists(ontologyCacheRoot)) {
    try {
      const entries = await fs.readdir(ontologyCacheRoot);
      for (const entry of entries.sort()) {
        if (entry.endsWith(".json")) {
          ontologyCacheKeys.push(entry.slice(0, -".json".length));
        }
      }
    } catch {
      // ignore unreadable cache dir
    }
  }

  return {
    sessions,
    conceptTrie: await pathExists(conceptTriePath),
    deterministic: await pathExists(deterministicPath),
    llmRefined: await pathExists(llmRefinedPath),
    llmMergeCacheKeys,
    ontologyIndex: await pathExists(ontologyIndexPath),
    ontologyCacheKeys,
  };
}

function recordsEqualEnough(existing: SessionRecord | undefined, incoming: SessionRecord): boolean {
  if (!existing) {
    return false;
  }
  return (
    existing.meta.analyzedAt === incoming.meta.analyzedAt &&
    (existing.meta.transcriptSha256 ?? null) === (incoming.meta.transcriptSha256 ?? null)
  );
}

/**
 * Run the migration. `sqlite` must already be open (its schema applied).
 * Returns a summary describing what was imported.
 */
export async function migrateJsonToSqlite(
  storeDir: string,
  sqlite: SqliteStore
): Promise<MigrationResult> {
  const snapshot = await snapshotJsonFiles(storeDir);

  let sessionCount = 0;
  let skippedSessionCount = 0;
  const projectSlugs = new Set<string>();

  for (const relPath of snapshot.sessions) {
    const abs = path.join(storeDir, relPath);
    const parsed = await readJsonFile<unknown>(abs);
    if (!parsed || !looksLikeSessionRecord(parsed)) {
      continue;
    }
    const record = validateAndBackfillRecord(parsed);
    if (!record) {
      continue;
    }
    projectSlugs.add(record.meta.projectSlug);

    const existing = await sqlite.getRecord(record.meta.projectSlug, record.meta.sessionId);
    if (recordsEqualEnough(existing, record)) {
      skippedSessionCount++;
      continue;
    }
    await sqlite.upsertRecord(record);
    sessionCount++;
  }

  let migratedConceptTrie = false;
  if (snapshot.conceptTrie) {
    const trie = await readConceptTrieMerge(storeDir);
    if (trie) {
      await sqlite.writeConceptTrieMerge(trie);
      migratedConceptTrie = true;
    }
  }

  let migratedDeterministicMerge = false;
  if (snapshot.deterministic) {
    const det = await readMergeRecord(path.join(storeDir, STORE_LAYOUT.deterministicFile));
    if (det) {
      await sqlite.writeDeterministicMerge(det);
      migratedDeterministicMerge = true;
    }
  }

  let migratedLlmRefinedMerge = false;
  if (snapshot.llmRefined) {
    const refined = await readMergeRecord(path.join(storeDir, STORE_LAYOUT.llmRefinedFile));
    if (refined) {
      await sqlite.writeLlmRefinedMerge(refined);
      migratedLlmRefinedMerge = true;
    }
  }

  let llmMergeCacheCount = 0;
  for (const cacheKey of snapshot.llmMergeCacheKeys) {
    const cached = await readMergeRecord(
      path.join(storeDir, STORE_LAYOUT.mergeCacheDir, `${cacheKey}.json`)
    );
    if (cached) {
      await sqlite.writeLlmMergeCache(cacheKey, cached);
      llmMergeCacheCount++;
    }
  }

  let migratedOntologyIndex = false;
  let ontologyRecordCount = 0;
  if (snapshot.ontologyIndex) {
    const index = await readOntologyIndex(storeDir);
    if (index) {
      await sqlite.writeOntologyIndex(index);
      migratedOntologyIndex = true;
      // Import every cache record referenced by the index (deterministic order).
      for (const entry of [...index.entries].sort((a, b) =>
        a.cacheKey < b.cacheKey ? -1 : a.cacheKey > b.cacheKey ? 1 : 0
      )) {
        const rec = await readOntologyRecord(storeDir, entry.cacheKey);
        if (rec) {
          await sqlite.writeOntologyRecord(entry.cacheKey, rec);
          ontologyRecordCount++;
        }
      }
    }
  }

  const snapshotFiles = [
    ...snapshot.sessions,
    ...(snapshot.conceptTrie ? [STORE_LAYOUT.conceptTrieFile] : []),
    ...(snapshot.deterministic ? [STORE_LAYOUT.deterministicFile] : []),
    ...(snapshot.llmRefined ? [STORE_LAYOUT.llmRefinedFile] : []),
    ...snapshot.llmMergeCacheKeys.map((k) => path.join(STORE_LAYOUT.mergeCacheDir, `${k}.json`)),
    ...(snapshot.ontologyIndex ? [STORE_LAYOUT.ontologyIndexFile] : []),
    ...snapshot.ontologyCacheKeys.map((k) => path.join(STORE_LAYOUT.ontologyCacheDir, `${k}.json`)),
  ].sort();

  return {
    sessionCount,
    skippedSessionCount,
    projectSlugs: [...projectSlugs].sort(),
    migratedConceptTrie,
    migratedDeterministicMerge,
    migratedLlmRefinedMerge,
    llmMergeCacheCount,
    migratedOntologyIndex,
    ontologyRecordCount,
    snapshotFiles,
  };
}
