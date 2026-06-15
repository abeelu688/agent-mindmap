import * as fs from "fs/promises";
import * as path from "path";
import { clearOntologyCache } from "./ontologyStore";
import { deleteSnapshotHierarchy } from "./mergeSnapshot";
import { listRecords, rebuildIndex, STORE_LAYOUT } from "./sessionStore";

/**
 * Remove all persisted analysis artifacts for one project so the next batch
 * run re-analyzes transcripts and rebuilds merge snapshots from scratch.
 */
export async function clearProjectAnalysisCache(
  storeDir: string,
  projectSlug: string
): Promise<{ removedSessionRecords: number }> {
  const projectSessionsDir = path.join(storeDir, STORE_LAYOUT.sessionsDir, projectSlug);
  let removedSessionRecords = 0;
  try {
    const files = await fs.readdir(projectSessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      await fs.unlink(path.join(projectSessionsDir, file));
      removedSessionRecords += 1;
    }
    await fs.rm(projectSessionsDir, { recursive: true, force: true });
  } catch {
    // missing project dir is fine
  }

  await deleteSnapshotHierarchy(storeDir, projectSlug);
  await clearOntologyCache(storeDir);

  const remaining = await listRecords(storeDir);
  await rebuildIndex(storeDir, remaining);

  return { removedSessionRecords };
}
