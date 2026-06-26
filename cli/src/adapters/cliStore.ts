/**
 * CLI adapter for core StoreAccess port.
 *
 * Uses the file-system-based store functions from core directly
 * (no SQLite, no vscode.ExtensionContext).
 */
import * as fs from "fs/promises";
import * as path from "path";
import {
  ensureStore,
  readRecord,
  writeRecord,
  listRecords,
  type StoreAccess,
} from "@agent-mindmap/core";
import type {
  SessionRecord,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
} from "@agent-mindmap/shared";

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

  async writeConceptTrieMerge(merge: MergeRecord): Promise<void> {
    const dir = path.join(this.storeDir, "merges");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "concept-trie-merge.json");
    await fs.writeFile(filePath, JSON.stringify(merge, null, 2), "utf-8");
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

  async writeDeterministicMerge(merge: MergeRecord): Promise<void> {
    const dir = path.join(this.storeDir, "merges");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "deterministic-merge.json");
    await fs.writeFile(filePath, JSON.stringify(merge, null, 2), "utf-8");
  }

  // ── Ontology cache ────────────────────────────────────────────────────────

  async readOntologyIndex(): Promise<OntologyIndex | undefined> {
    try {
      const filePath = path.join(this.storeDir, "ontology", "index.json");
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as OntologyIndex;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  async writeOntologyIndex(index: OntologyIndex): Promise<void> {
    const dir = path.join(this.storeDir, "ontology");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "index.json");
    await fs.writeFile(filePath, JSON.stringify(index, null, 2), "utf-8");
  }

  async readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined> {
    try {
      const filePath = path.join(this.storeDir, "ontology", "cache", `${cacheKey}.json`);
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as OntologyRecord;
      if (parsed.schemaVersion !== 1) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  async writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void> {
    const dir = path.join(this.storeDir, "ontology", "cache");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${cacheKey}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
  }

  async clearOntologyCache(): Promise<void> {
    const dir = path.join(this.storeDir, "ontology", "cache");
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      const indexPath = path.join(this.storeDir, "ontology", "index.json");
      await fs.unlink(indexPath);
    } catch {
      // ignore
    }
  }

  async readLatestSegmentEquivalences(
    _projectSlug: string
  ): Promise<import("@agent-mindmap/shared").SegmentEquivalence[]> {
    return [];
  }

  async bumpProjectRevision(
    _projectSlug: string,
    _recordCount: number,
    _opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<void> {
    // No-op for CLI
  }

  // ── Missing Store methods (stubs) ────────────────────────────────────────

  async listProjectSummaries(): Promise<import("@agent-mindmap/shared").ProjectSummary[]> {
    return [];
  }

  async getProjectRevision(_projectSlug: string): Promise<number> {
    return 0;
  }

  async getProjectRecordCount(_projectSlug: string): Promise<number | undefined> {
    return undefined;
  }

  async deleteProjectRecords(_projectSlug: string): Promise<void> {
    // Not implemented for CLI
  }

  async readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return undefined;
  }

  async writeLlmRefinedMerge(_merge: MergeRecord): Promise<void> {
    // Not implemented for CLI
  }

  async readLlmMergeCache(_cacheKey: string): Promise<MergeRecord | undefined> {
    return undefined;
  }

  async writeLlmMergeCache(_cacheKey: string, _merge: MergeRecord): Promise<void> {
    // Not implemented for CLI
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
