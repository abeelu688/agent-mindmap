import * as fs from "fs/promises";
import * as path from "path";
import { writeJsonAtomic } from "../atomicWrite";
import {
  bumpMcpProjectRevision,
  projectRecordCount,
  projectRevision,
  readMcpIndex,
} from "../mcpIndex";
import { STORE_LAYOUT } from "../storeLayout";
import {
  listProjectSummaries as listProjectSummariesFromFs,
  listRecords as listAllRecordsFromFs,
  listRecordsForProject as listRecordsForProjectFromFs,
  readConceptTrieMerge as readConceptTrieMergeFromFs,
  readLatestProjectSegmentEquivalences as readLatestSegmentEquivalencesFromFs,
  readMergeRecord as readMergeRecordFromFs,
  readOntologyIndex as readOntologyIndexFromFs,
  readOntologyRecord as readOntologyRecordFromFs,
  readRecord as readRecordFromFs,
} from "../storeReader";
import type {
  McpIndexFile,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
  ProjectSummary,
  SegmentEquivalence,
  SessionRecord,
} from "../storeTypes";
import type { Store } from "./store";

/**
 * File-based `Store` backed by the on-disk JSON layout under `storeDir`.
 *
 * Thin wrapper over the existing `storeReader` / `mcpIndex` helpers. Same
 * semantics, same paths — just exposed through the `Store` interface so
 * callers (MCP server, future SqliteStore migration, future RemoteStore) can
 * be coded against one shape.
 */
export class JsonFsStore implements Store {
  constructor(private readonly storeDir: string) {}

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    return listProjectSummariesFromFs(this.storeDir);
  }

  async getProjectRevision(projectSlug: string): Promise<number> {
    const index = await readMcpIndex(this.storeDir);
    return projectRevision(index, projectSlug);
  }

  async getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    const index = await readMcpIndex(this.storeDir);
    return projectRecordCount(index, projectSlug);
  }

  async getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    return readRecordFromFs(this.storeDir, projectSlug, sessionId);
  }

  async listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    return listRecordsForProjectFromFs(this.storeDir, projectSlug);
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    const { projectSlug, sessionId } = record.meta;
    const file = path.join(
      this.storeDir,
      STORE_LAYOUT.sessionsDir,
      projectSlug,
      `${sessionId}.json`
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, record);

    const records = await listRecordsForProjectFromFs(this.storeDir, projectSlug);
    const lastAnalyzedAt = records.length
      ? Math.max(...records.map((r) => r.meta.analyzedAt))
      : undefined;
    const projectPath = record.meta.projectPath;
    const index = await bumpMcpProjectRevision(this.storeDir, projectSlug, records.length, {
      lastAnalyzedAt,
      projectPath,
    });
    return { revision: projectRevision(index, projectSlug) };
  }

  async readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    return readConceptTrieMergeFromFs(this.storeDir);
  }

  async readDeterministicMerge(): Promise<MergeRecord | undefined> {
    return readMergeRecordFromFs(path.join(this.storeDir, STORE_LAYOUT.deterministicFile));
  }

  async readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return readMergeRecordFromFs(path.join(this.storeDir, STORE_LAYOUT.llmRefinedFile));
  }

  async readLlmMergeCache(cacheKey: string): Promise<MergeRecord | undefined> {
    return readMergeRecordFromFs(
      path.join(this.storeDir, STORE_LAYOUT.mergeCacheDir, `${cacheKey}.json`)
    );
  }

  async readOntologyIndex(): Promise<OntologyIndex | undefined> {
    return readOntologyIndexFromFs(this.storeDir);
  }

  async readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined> {
    return readOntologyRecordFromFs(this.storeDir, cacheKey);
  }

  async readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    return readLatestSegmentEquivalencesFromFs(this.storeDir, projectSlug);
  }

  async listAllRecords(): Promise<SessionRecord[]> {
    return listAllRecordsFromFs(this.storeDir);
  }

  async deleteProjectRecords(projectSlug: string): Promise<void> {
    const projectDir = path.join(this.storeDir, STORE_LAYOUT.sessionsDir, projectSlug);
    await fs.rm(projectDir, { recursive: true, force: true });
    // The `.mcp-index.json` entry for this project is now stale (record_count
    // too high). We deliberately do NOT bump here — mirroring pre-P2.3
    // `clearProjectAnalysisCache` behavior, which deleted files + rebuilt
    // `index.json` without touching `.mcp-index.json`. The caller's subsequent
    // re-analysis writes new records, which bump the revision naturally. If
    // no re-analysis follows, the MCP cache shows stale data until a manual
    // refresh — same as today.
  }

  async writeConceptTrieMerge(merge: MergeRecord): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.conceptTrieFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, merge);
  }

  async writeDeterministicMerge(merge: MergeRecord): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.deterministicFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, merge);
  }

  async writeLlmRefinedMerge(merge: MergeRecord): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.llmRefinedFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, merge);
  }

  async writeLlmMergeCache(cacheKey: string, merge: MergeRecord): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.mergeCacheDir, `${cacheKey}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, merge);
  }

  async writeOntologyIndex(index: OntologyIndex): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.ontologyIndexFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, index);
  }

  async writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void> {
    const file = path.join(this.storeDir, STORE_LAYOUT.ontologyCacheDir, `${cacheKey}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, record);
  }

  async clearOntologyCache(): Promise<void> {
    const cacheDir = path.join(this.storeDir, STORE_LAYOUT.ontologyCacheDir);
    try {
      const entries = await fs.readdir(cacheDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) {
          continue;
        }
        await fs.unlink(path.join(cacheDir, entry));
      }
    } catch {
      // missing cache dir is fine
    }
    await fs.unlink(path.join(this.storeDir, STORE_LAYOUT.ontologyIndexFile)).catch(() => {
      // missing index is fine
    });
  }

  async bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    return bumpMcpProjectRevision(this.storeDir, projectSlug, recordCount, opts);
  }
}
