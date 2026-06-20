import * as fs from "fs/promises";
import * as path from "path";
import { writeJsonAtomic } from "./atomicWrite";
import { MCP_INDEX_SCHEMA_VERSION, STORE_LAYOUT } from "./storeLayout";
import type { McpIndexFile, McpIndexProjectEntry } from "./storeTypes";

export function mcpIndexPath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.mcpIndexFile);
}

export async function readMcpIndex(storeDir: string): Promise<McpIndexFile> {
  try {
    const raw = await fs.readFile(mcpIndexPath(storeDir), "utf8");
    const parsed = JSON.parse(raw) as McpIndexFile;
    if (parsed?.schemaVersion !== MCP_INDEX_SCHEMA_VERSION || !parsed.projects) {
      return emptyMcpIndex();
    }
    return parsed;
  } catch {
    return emptyMcpIndex();
  }
}

export function emptyMcpIndex(): McpIndexFile {
  return {
    schemaVersion: MCP_INDEX_SCHEMA_VERSION,
    updatedAt: Date.now(),
    projects: {},
  };
}

export async function bumpMcpProjectRevision(
  storeDir: string,
  projectSlug: string,
  recordCount: number,
  opts?: { lastAnalyzedAt?: number; projectPath?: string }
): Promise<McpIndexFile> {
  const index = await readMcpIndex(storeDir);
  const prev = index.projects[projectSlug];
  const entry: McpIndexProjectEntry = {
    lastBuiltAt: Date.now(),
    recordCount,
    revision: (prev?.revision ?? 0) + 1,
    lastAnalyzedAt: opts?.lastAnalyzedAt ?? prev?.lastAnalyzedAt,
    projectPath: opts?.projectPath ?? prev?.projectPath,
  };
  index.projects[projectSlug] = entry;
  index.updatedAt = Date.now();
  await writeJsonAtomic(mcpIndexPath(storeDir), index);
  return index;
}

export function projectRevision(index: McpIndexFile, projectSlug: string): number {
  return index.projects[projectSlug]?.revision ?? 0;
}

export function projectRecordCount(index: McpIndexFile, projectSlug: string): number | undefined {
  return index.projects[projectSlug]?.recordCount;
}
