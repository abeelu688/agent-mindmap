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
  listRecordsForProject as listRecordsForProjectFromFs,
  readConceptTrieMerge as readConceptTrieMergeFromFs,
  readLatestProjectSegmentEquivalences as readLatestSegmentEquivalencesFromFs,
  readRecord as readRecordFromFs,
} from "../storeReader";
import type {
  McpIndexFile,
  MergeRecord,
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

  async readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    return readLatestSegmentEquivalencesFromFs(this.storeDir, projectSlug);
  }

  async bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    return bumpMcpProjectRevision(this.storeDir, projectSlug, recordCount, opts);
  }
}
