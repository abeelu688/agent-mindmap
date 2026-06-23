import * as path from "path";
import * as fs from "fs/promises";
import { deleteSnapshotHierarchy } from "./mergeSnapshot";
import { STORE_LAYOUT } from "./sessionStore";
import type { Store } from "@agent-mindmap/shared";

/**
 * Remove all persisted analysis artifacts for one project so the next batch
 * run re-analyzes transcripts and rebuilds merge snapshots from scratch.
 *
 * The Store instance is provided by the caller (extension via getStoreForDir,
 * CLI via buildCliStoreAccess) — this keeps the function VS Code-free.
 */
export async function clearProjectAnalysisCache(
  storeDir: string,
  projectSlug: string,
  store: Store
): Promise<{ removedSessionRecords: number }> {
  // Count existing records before deletion so we can report how many were
  // removed (SQLite's deleteProjectRecords does not return a count).
  const existing = await store.listRecordsForProject(projectSlug);
  const removedSessionRecords = existing.length;

  // Delete any residual on-disk JSON files from the pre-P2.3 era (downgrade
  // safety + the bootstrap fallback path). The authoritative deletion is the
  // Store call below.
  const projectSessionsDir = path.join(storeDir, STORE_LAYOUT.sessionsDir, projectSlug);
  await fs.rm(projectSessionsDir, { recursive: true, force: true }).catch(() => {
    // missing project dir is fine
  });

  await store.deleteProjectRecords(projectSlug);
  await deleteSnapshotHierarchy(storeDir, projectSlug);
  await store.clearOntologyCache();

  return { removedSessionRecords };
}
