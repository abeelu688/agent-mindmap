import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { SqliteStore } from "@agent-mindmap/shared";
import { getStoreDir } from "../paths";
import { getActiveHost } from "../host";
import { checkRepoPrerequisites, normalizeRepoUriToSlug } from "../host/slugDerivation";
import { t } from "../l10n/uiTranslate";
import { mindMapLog } from "../webview/MindMapLog";

/** kv flag marking a store that has been re-keyed from workspace → repo slugs. */
export const REKEY_FLAG_KEY = "rekeyed-to-repo";

export type RekeyResult =
  | { kind: "ok"; foldersRekeyed: number; backupPath: string }
  | { kind: "aborted"; reason: string }
  | { kind: "noop"; reason: string };

type FolderSlugPair = { folder: string; workspaceSlug: string; repoSlug: string };

/**
 * Run the one-way workspace→repo re-key migration (TEAM_MODE.md §Q5 rule 11).
 *
 * Steps:
 *   1. Prerequisite gate (rule 10) — every workspace folder must be a git repo
 *      with `origin` at the repo root. Any failure aborts re-key (no backup,
 *      no writes).
 *   2. Backup `store.db` → `store.db.pre-rekey-<timestamp>` (overwrites any
 *      previous backup). WAL is checkpointed first so the main file holds all
 *      committed data. Backup failure aborts.
 *   3. Per-folder transactional PK rewrite: `SessionRecord.projectSlug` from
 *      the workspace slug (host-encoded path) to the repo slug (normalized
 *      git origin URI). `CodeReference.path` is NOT rewritten — repo mode
 *      requires folder == repo root, so the path bases are identical. One
 *      SQLite transaction per folder; an injected failure rolls back only that
 *      folder (re-running re-key completes the remaining folders).
 *   4. Write the `rekeyed-to-repo` meta flag so `workspace` mode is no longer
 *      offered for this store.
 *
 * Idempotent: a folder with no sessions under its workspace slug is a no-op
 * for that folder's transaction. Re-running on an already-re-keyed store
 * rewrites zero sessions and refreshes the backup.
 */
export async function runRekeyMigration(): Promise<RekeyResult> {
  const storeDir = getStoreDir();
  const dbPath = path.join(storeDir, "store.db");

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return { kind: "noop", reason: "no workspace folders open" };
  }

  // 1) Prerequisite gate — hard-error if any folder fails.
  const pairs: FolderSlugPair[] = [];
  const host = await getActiveHost();
  for (const folder of folders) {
    const fsPath = folder.uri.fsPath;
    const res = await checkRepoPrerequisites(fsPath);
    if (!res.ok) {
      return {
        kind: "aborted",
        reason: t(
          "ui.warning.rekeyPrereqFailed",
          "Agent Mind Map: re-key aborted. Folder {0} failed repo prerequisites: {1}.",
          fsPath,
          res.reason
        ),
      };
    }
    pairs.push({
      folder: fsPath,
      workspaceSlug: host.encodeWorkspacePath(fsPath),
      repoSlug: normalizeRepoUriToSlug(res.uri),
    });
  }

  // 2) Open a fresh SqliteStore against the standard dbPath. We bypass the
  //    memoized getStore() so re-key's connection lifecycle is independent
  //    (close after re-key frees the handle; the memoized store stays usable
  //    for normal reads). Multiple @vscode/sqlite3 connections to the same
  //    file are fine — WAL + busy_timeout serialize them.
  let dbExists = true;
  try {
    await fs.access(dbPath);
  } catch {
    dbExists = false;
  }
  if (!dbExists) {
    return { kind: "noop", reason: "no store.db to re-key" };
  }

  const store = new SqliteStore(dbPath);
  try {
    // Already-re-keyed store: skip the migration entirely. The flag is the
    // single source of truth for one-way enforcement.
    if (await store.readMetaFlag(REKEY_FLAG_KEY)) {
      return { kind: "noop", reason: "store already re-keyed to repo mode" };
    }

    // 3) Checkpoint WAL → main file, then backup.
    try {
      await store.checkpoint();
    } catch (err) {
      mindMapLog(
        `[rekey] wal checkpoint failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const backupPath = path.join(storeDir, `store.db.pre-rekey-${Date.now()}`);
    try {
      await fs.copyFile(dbPath, backupPath);
    } catch (err) {
      return {
        kind: "aborted",
        reason: t(
          "ui.warning.rekeyBackupFailed",
          "Agent Mind Map: re-key aborted — could not write backup: {0}",
          err instanceof Error ? err.message : String(err)
        ),
      };
    }

    // 4) Per-folder transactional re-key.
    let foldersRekeyed = 0;
    for (const { workspaceSlug, repoSlug } of pairs) {
      if (workspaceSlug === repoSlug) {
        // Path-derived slug happens to equal the repo-URI slug (rare). The
        // rekeyProjectSlug no-op short-circuits this; don't count as rekeyed.
        continue;
      }
      await store.rekeyProjectSlug(workspaceSlug, repoSlug);
      foldersRekeyed++;
    }

    // 5) Mark re-keyed.
    await store.writeMetaFlag(REKEY_FLAG_KEY, true);

    return { kind: "ok", foldersRekeyed, backupPath };
  } finally {
    await store.close();
  }
}

/**
 * Read the `rekeyed-to-repo` flag for the current store dir. `false` when the
 * store is missing, the flag is absent, or the value is not `true`.
 */
export async function isStoreRekeyedToRepo(): Promise<boolean> {
  const storeDir = getStoreDir();
  const dbPath = path.join(storeDir, "store.db");
  try {
    await fs.access(dbPath);
  } catch {
    return false;
  }
  const store = new SqliteStore(dbPath);
  try {
    return await store.readMetaFlag(REKEY_FLAG_KEY);
  } catch (err) {
    mindMapLog(
      `[rekey] isStoreRekeyedToRepo read failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  } finally {
    await store.close();
  }
}

export const __testing = {
  REKEY_FLAG_KEY,
};
