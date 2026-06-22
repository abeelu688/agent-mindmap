/**
 * CLI adapter for core StoreAccess port.
 *
 * Uses the file-system-based store functions from core directly
 * (no SQLite, no vscode.ExtensionContext).
 */
import * as path from "path";
import {
  ensureStore,
  readRecord,
  writeRecord,
  listRecords,
  type StoreAccess,
} from "@agent-mindmap/core";
import type { SessionRecord, MergeRecord } from "@agent-mindmap/shared";

// ────────────────────────────────────────────────────────────────────────────
// File-based store for CLI (no SQLite)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Minimal file-based store that reads/writes JSON directly.
 * Used by CLI where there is no SQLite-backed store.
 */
class CliStore {
  constructor(private storeDir: string) {}

  async getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    return readRecord(this.storeDir, projectSlug, sessionId);
  }

  async listAllRecords(): Promise<SessionRecord[]> {
    return listRecords(this.storeDir);
  }

  async listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    const all = await listRecords(this.storeDir);
    return all.filter((r) => r.meta.projectSlug === projectSlug);
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    await writeRecord(this.storeDir, record);
    return { revision: 1 };
  }

  // Merge records are stored as files too
  async readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    try {
      const fs = await import("fs/promises");
      const filePath = path.join(this.storeDir, "merges", "concept-trie-merge.json");
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as MergeRecord;
    } catch {
      return undefined;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async writeConceptTrieMerge(_merge: MergeRecord): Promise<void> {
    // Will be implemented when needed for project analyze
  }

  async readDeterministicMerge(): Promise<MergeRecord | undefined> {
    try {
      const fs = await import("fs/promises");
      const filePath = path.join(this.storeDir, "merges", "deterministic-merge.json");
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as MergeRecord;
    } catch {
      return undefined;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async writeDeterministicMerge(_merge: MergeRecord): Promise<void> {
    // Will be implemented when needed
  }
}

// ────────────────────────────────────────────────────────────────────────────
// StoreAccess implementation
// ────────────────────────────────────────────────────────────────────────────

export function buildCliStoreAccess(storeDir: string): StoreAccess {
  return {
    async getStore() {
      return new CliStore(storeDir) as unknown as import("@agent-mindmap/shared").Store;
    },
    async getStoreForDir(dir: string) {
      return new CliStore(dir) as unknown as import("@agent-mindmap/shared").Store;
    },
    async ensureStore(dir: string) {
      await ensureStore(dir);
    },
    getStoreDir() {
      return storeDir;
    },
  };
}
