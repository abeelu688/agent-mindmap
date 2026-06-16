import * as fs from "fs/promises";
import * as path from "path";
import { workspaceToSlug } from "./paths";
import { STORE_LAYOUT } from "./storeLayout";
import type { MergeRecord, ProjectSummary, SessionRecord } from "./storeTypes";

const SCHEMA_VERSION = 1;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) {
    return false;
  }
  if (!r.meta || typeof r.meta !== "object") {
    return false;
  }
  const meta = r.meta as Record<string, unknown>;
  if (typeof meta.sessionId !== "string" || typeof meta.projectSlug !== "string") {
    return false;
  }
  if (!r.outline || typeof r.outline !== "object") {
    return false;
  }
  const outline = r.outline as Record<string, unknown>;
  if (!Array.isArray(outline.outline)) {
    return false;
  }
  return true;
}

export function recordPath(storeDir: string, projectSlug: string, sessionId: string): string {
  return path.join(storeDir, STORE_LAYOUT.sessionsDir, projectSlug, `${sessionId}.json`);
}

export function conceptTrieMergePath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.conceptTrieFile);
}

export function mergeSnapshotPath(storeDir: string, projectSlug: string): string {
  return path.join(storeDir, STORE_LAYOUT.mergesDir, projectSlug, "merge-snapshot.json");
}

export async function readRecord(
  storeDir: string,
  projectSlug: string,
  sessionId: string
): Promise<SessionRecord | undefined> {
  const parsed = await readJson<unknown>(recordPath(storeDir, projectSlug, sessionId));
  if (!parsed || !isSessionRecord(parsed)) {
    return undefined;
  }
  return parsed;
}

export async function listRecords(storeDir: string): Promise<SessionRecord[]> {
  const sessionsRoot = path.join(storeDir, STORE_LAYOUT.sessionsDir);
  if (!(await pathExists(sessionsRoot))) {
    return [];
  }
  const projectDirs = await fs.readdir(sessionsRoot, { withFileTypes: true });
  const out: SessionRecord[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) {
      continue;
    }
    const slugDir = path.join(sessionsRoot, projectDir.name);
    let files: string[];
    try {
      files = await fs.readdir(slugDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const parsed = await readJson<unknown>(path.join(slugDir, file));
      if (parsed && isSessionRecord(parsed)) {
        out.push(parsed);
      }
    }
  }
  return out;
}

export async function listRecordsForProject(
  storeDir: string,
  projectSlug: string
): Promise<SessionRecord[]> {
  const all = await listRecords(storeDir);
  return all.filter((r) => r.meta.projectSlug === projectSlug);
}

export async function listProjectSummaries(storeDir: string): Promise<ProjectSummary[]> {
  const records = await listRecords(storeDir);
  const bySlug = new Map<string, SessionRecord[]>();
  for (const record of records) {
    const slug = record.meta.projectSlug;
    const arr = bySlug.get(slug) ?? [];
    arr.push(record);
    bySlug.set(slug, arr);
  }
  const summaries: ProjectSummary[] = [];
  for (const [projectSlug, projectRecords] of bySlug) {
    const lastAnalyzedAt = Math.max(...projectRecords.map((r) => r.meta.analyzedAt));
    const projectPath = projectRecords.find((r) => r.meta.projectPath)?.meta.projectPath;
    summaries.push({
      projectSlug,
      projectPath,
      sessionCount: projectRecords.length,
      lastAnalyzedAt,
    });
  }
  summaries.sort((a, b) => b.lastAnalyzedAt - a.lastAnalyzedAt);
  return summaries;
}

export async function readMergeRecord(filePath: string): Promise<MergeRecord | undefined> {
  const parsed = await readJson<MergeRecord>(filePath);
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
    return undefined;
  }
  if (!parsed.mindMap || typeof parsed.mindMap !== "object") {
    return undefined;
  }
  return parsed;
}

export async function readConceptTrieMerge(storeDir: string): Promise<MergeRecord | undefined> {
  return readMergeRecord(conceptTrieMergePath(storeDir));
}

export function resolveProjectSlug(opts: {
  projectPath?: string;
  projectSlug?: string;
}): string | undefined {
  if (opts.projectSlug?.trim()) {
    return opts.projectSlug.trim();
  }
  if (opts.projectPath?.trim()) {
    return workspaceToSlug(opts.projectPath.trim());
  }
  return undefined;
}

export function findProjectSlugByPath(
  summaries: ProjectSummary[],
  projectPath: string
): string | undefined {
  const slug = workspaceToSlug(projectPath);
  const exact = summaries.find((s) => s.projectSlug === slug);
  if (exact) {
    return exact.projectSlug;
  }
  const normalized = path.normalize(projectPath);
  const byPath = summaries.find(
    (s) => s.projectPath && path.normalize(s.projectPath) === normalized
  );
  return byPath?.projectSlug;
}

export const __testing = {
  isSessionRecord,
  pathExists,
  readJson,
};
