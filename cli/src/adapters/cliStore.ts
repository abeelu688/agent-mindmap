/**
 * CLI adapter for core StoreAccess port.
 *
 * Uses the file-system-based store functions from core directly
 * (no SQLite, no vscode.ExtensionContext).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { ensureStore, readRecord, writeRecord, type StoreAccess } from "@agent-mindmap/core";
import { bootstrapStore, type SqliteStore } from "@agent-mindmap/shared";
import type {
  SessionRecord,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
} from "@agent-mindmap/shared";

// ────────────────────────────────────────────────────────────────────────────
// SQLite store accessor (shared with MCP server)
// ────────────────────────────────────────────────────────────────────────────

const sqliteCache = new Map<string, SqliteStore>();

/**
 * Open (or reuse) the SQLite store at `storeDir`. The MCP server uses the
 * same `bootstrapStore()` path, so revision bumps and project metadata
 * written here are visible to the MCP server's index cache.
 */
async function getSqliteStore(storeDir: string): Promise<SqliteStore> {
  let cached = sqliteCache.get(storeDir);
  if (!cached) {
    const result = await bootstrapStore(storeDir);
    cached = result.store as SqliteStore;
    sqliteCache.set(storeDir, cached);
  }
  return cached;
}

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
    // Prefer SQLite (the extension writes here too, so it has the union of all
    // records). Fall back to the JSON file if SQLite doesn't have it (e.g.
    // the record was written by an older CLI that only wrote JSON).
    const sqlite = await getSqliteStore(this.storeDir);
    const fromSqlite = await sqlite.getRecord(projectSlug, sessionId);
    if (fromSqlite) return fromSqlite;
    return readRecord(this.storeDir, projectSlug, sessionId);
  }

  async listAllRecords(): Promise<SessionRecord[]> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.listAllRecords();
  }

  async listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.listRecordsForProject(projectSlug);
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    await writeRecord(this.storeDir, record);
    // Also write to SQLite so the MCP server (which reads from SQLite) sees
    // the new record. Without this, list_project_sessions returns stale data
    // because the sessions table never gains the row.
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.upsertRecord(record);
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

  /**
   * Delegate to the SQLite store so the MCP server (which uses SQLite) sees
   * the revision bump. The CLI's session records currently live as JSON
   * files (see `writeRecord`), but the revision counter is shared via
   * SQLite so the MCP server's index cache invalidates correctly.
   */
  async bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<import("@agent-mindmap/shared").McpIndexFile> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.bumpProjectRevision(projectSlug, recordCount, opts);
  }

  // ── Missing Store methods (stubs) ────────────────────────────────────────

  async listProjectSummaries(): Promise<import("@agent-mindmap/shared").ProjectSummary[]> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.listProjectSummaries();
  }

  async getProjectRevision(projectSlug: string): Promise<number> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.getProjectRevision(projectSlug);
  }

  async getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    const sqlite = await getSqliteStore(this.storeDir);
    return sqlite.getProjectRecordCount(projectSlug);
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
