import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { writeJsonAtomic } from "./atomicWrite";
import {
  validateSessionOutline,
  validateTopicGraph,
} from "../llm/cursorCliProvider";
import {
  outlineToTopicGraph,
  topicGraphToOutline,
} from "../llm/outlineToTopicGraph";
import type {
  PipelineVersions,
  SessionAnalysis,
  SessionConceptExtract,
  SessionOutline,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  TopicGraph,
} from "../llm/types";
import {
  currentPipelineVersions,
  pipelineVersionsMatch,
  PIPELINE_VERSION,
} from "../pipeline/pipelineVersions";
import type {
  ConceptContextForMerge,
  MergeRecord,
  SessionIndex,
  SessionIndexEntry,
  SessionRecord,
  SessionRecordMeta,
} from "./storeTypes";

const SCHEMA_VERSION = 1 as const;

export const STORE_LAYOUT = {
  schemaFile: "schema.json",
  indexFile: "index.json",
  sessionsDir: "sessions",
  mergesDir: "merges",
  mergeCacheDir: "merges/cache",
  deterministicFile: "merges/deterministic.json",
  conceptTrieFile: "merges/concept-trie.json",
  llmRefinedFile: "merges/llm-refined.json",
  ontologyDir: "ontology",
  ontologyIndexFile: "ontology/index.json",
  ontologyCacheDir: "ontology/cache",
} as const;

export function sha256Hex(data: string | Buffer): string {
  const h = createHash("sha256");
  h.update(data);
  return h.digest("hex");
}

export function recordPath(
  storeDir: string,
  projectSlug: string,
  sessionId: string
): string {
  return path.join(
    storeDir,
    STORE_LAYOUT.sessionsDir,
    projectSlug,
    `${sessionId}.json`
  );
}

export function indexPath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.indexFile);
}

export function deterministicMergePath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.deterministicFile);
}

export function conceptTrieMergePath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.conceptTrieFile);
}

export function llmRefinedMergePath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.llmRefinedFile);
}

export function llmMergeCachePath(storeDir: string, key: string): string {
  return path.join(storeDir, STORE_LAYOUT.mergeCacheDir, `${key}.json`);
}

export function ontologyIndexPath(storeDir: string): string {
  return path.join(storeDir, STORE_LAYOUT.ontologyIndexFile);
}

export function ontologyCachePath(storeDir: string, key: string): string {
  return path.join(storeDir, STORE_LAYOUT.ontologyCacheDir, `${key}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

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

/** Write the layout schema marker so external tools can recognise the dir. */
export async function ensureStore(storeDir: string): Promise<void> {
  await ensureDir(storeDir);
  await ensureDir(path.join(storeDir, STORE_LAYOUT.sessionsDir));
  await ensureDir(path.join(storeDir, STORE_LAYOUT.mergesDir));
  await ensureDir(path.join(storeDir, STORE_LAYOUT.mergeCacheDir));
  await ensureDir(path.join(storeDir, STORE_LAYOUT.ontologyDir));
  await ensureDir(path.join(storeDir, STORE_LAYOUT.ontologyCacheDir));
  const schemaFile = path.join(storeDir, STORE_LAYOUT.schemaFile);
  if (!(await pathExists(schemaFile))) {
    await writeJsonAtomic(schemaFile, {
      schemaVersion: SCHEMA_VERSION,
      kind: "agent-mindmap-store",
    });
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
  if (
    typeof meta.sessionId !== "string" ||
    typeof meta.projectSlug !== "string" ||
    typeof meta.transcriptPath !== "string" ||
    typeof meta.transcriptSha256 !== "string"
  ) {
    return false;
  }
  if (!r.outline && !r.graph) {
    return false;
  }
  return true;
}

function ensureRecordGraph(record: SessionRecord): SessionRecord {
  if (record.outline) {
    return { ...record, graph: outlineToTopicGraph(record.outline) };
  }
  return record;
}

export async function readRecord(
  storeDir: string,
  projectSlug: string,
  sessionId: string
): Promise<SessionRecord | undefined> {
  const file = recordPath(storeDir, projectSlug, sessionId);
  const parsed = await readJson<unknown>(file);
  if (!parsed) {
    return undefined;
  }
  if (!isSessionRecord(parsed)) {
    return undefined;
  }
  try {
    const raw = parsed as SessionRecord;
    if (raw.outline) {
      raw.outline = validateSessionOutline(raw.outline);
      raw.graph = raw.graph
        ? validateTopicGraph(raw.graph)
        : outlineToTopicGraph(raw.outline);
    } else if (raw.graph) {
      raw.graph = validateTopicGraph(raw.graph);
      raw.outline = topicGraphToOutline(raw.graph);
    } else {
      return undefined;
    }
    return ensureRecordGraph(raw);
  } catch {
    return undefined;
  }
}

export async function writeRecord(
  storeDir: string,
  record: SessionRecord
): Promise<void> {
  await ensureStore(storeDir);
  const file = recordPath(
    storeDir,
    record.meta.projectSlug,
    record.meta.sessionId
  );
  await writeJsonAtomic(file, record);
}

export function buildRecordMeta(
  base: Omit<SessionRecordMeta, "analyzedAt"> & { analyzedAt?: number }
): SessionRecordMeta {
  return {
    ...base,
    analyzedAt: base.analyzedAt ?? Date.now(),
  };
}

export function buildSessionRecord(
  meta: SessionRecordMeta,
  outline: SessionOutline,
  pipeline?: {
    sessionAnalysis?: SessionAnalysis;
    conceptExtract?: SessionConceptExtract;
    sessionSynonyms?: SessionSynonymRefine;
    treeSnapshot?: SessionTreeSnapshot;
    conceptContexts?: ConceptContextForMerge[];
  }
): SessionRecord {
  const graph = outlineToTopicGraph(outline);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta,
    outline,
    graph,
    sessionAnalysis: pipeline?.sessionAnalysis,
    conceptExtract: pipeline?.conceptExtract,
    sessionSynonyms: pipeline?.sessionSynonyms,
    treeSnapshot: pipeline?.treeSnapshot,
    conceptContexts: pipeline?.conceptContexts,
  };
}

/**
 * Walk `<storeDir>/sessions/*` and yield every parseable SessionRecord.
 * Bad files are skipped silently — they'll be overwritten on next analysis.
 */
export async function listRecords(
  storeDir: string
): Promise<SessionRecord[]> {
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
      const full = path.join(slugDir, file);
      const parsed = await readJson<unknown>(full);
      if (!parsed || !isSessionRecord(parsed)) {
        continue;
      }
      try {
        const raw = parsed as SessionRecord;
        if (raw.outline) {
          raw.outline = validateSessionOutline(raw.outline);
          raw.graph = raw.graph
            ? validateTopicGraph(raw.graph)
            : outlineToTopicGraph(raw.outline);
        } else if (raw.graph) {
          raw.graph = validateTopicGraph(raw.graph);
          raw.outline = topicGraphToOutline(raw.graph);
        } else {
          continue;
        }
        out.push(ensureRecordGraph(raw));
      } catch {
        continue;
      }
    }
  }
  return out;
}

function toIndexEntry(record: SessionRecord): SessionIndexEntry {
  return {
    sessionId: record.meta.sessionId,
    projectSlug: record.meta.projectSlug,
    projectPath: record.meta.projectPath,
    sessionLabel: record.meta.sessionLabel,
    analyzedAt: record.meta.analyzedAt,
    transcriptMtimeMs: record.meta.transcriptMtimeMs,
    topicCount: record.outline.outline.length,
    rootTitle: record.outline.title ?? record.graph.title,
  };
}

export async function readIndex(
  storeDir: string
): Promise<SessionIndex | undefined> {
  const file = indexPath(storeDir);
  const parsed = await readJson<SessionIndex>(file);
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
    return undefined;
  }
  if (!Array.isArray(parsed.entries)) {
    return undefined;
  }
  return parsed;
}

export async function rebuildIndex(
  storeDir: string,
  records?: SessionRecord[]
): Promise<SessionIndex> {
  const all = records ?? (await listRecords(storeDir));
  all.sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const index: SessionIndex = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
    entries: all.map(toIndexEntry),
  };
  await writeJsonAtomic(indexPath(storeDir), index);
  return index;
}

/**
 * Decide whether a stored record is fresh enough to skip re-analysis.
 *
 * Re-analyze when transcript content, prompt parameters, prompt schema
 * version, or model change. `transcriptSha256` is the authoritative key;
 * `transcriptMtimeMs` is only a cheap pre-check and we never trust it alone.
 */
export function isRecordFresh(
  record: SessionRecord,
  current: {
    transcriptSha256: string;
    promptParams: { maxTopics: number; maxItemsPerTopic: number };
    promptVersion: number;
    pipelineVersions?: PipelineVersions;
    llm: { provider: string; model?: string };
    hostId?: string;
  }
): boolean {
  if (record.meta.transcriptSha256 !== current.transcriptSha256) {
    return false;
  }
  if (
    record.meta.promptParams.maxTopics !== current.promptParams.maxTopics ||
    record.meta.promptParams.maxItemsPerTopic !==
      current.promptParams.maxItemsPerTopic
  ) {
    return false;
  }
  const expectedPipeline =
    current.pipelineVersions ?? currentPipelineVersions();
  if (record.meta.pipelineVersions) {
    if (!pipelineVersionsMatch(record.meta.pipelineVersions, expectedPipeline)) {
      return false;
    }
    if (expectedPipeline.sessionAnalysis !== undefined && !record.sessionAnalysis) {
      return false;
    }
  } else {
    const recVersion = record.meta.promptVersion ?? 1;
    if (recVersion !== current.promptVersion) {
      return false;
    }
  }
  if (record.meta.llm.provider !== current.llm.provider) {
    return false;
  }
  const recHost = record.meta.hostId ?? "cursor";
  const curHost = current.hostId ?? "cursor";
  if (recHost !== curHost) {
    return false;
  }
  // Empty / undefined model are treated as equivalent (CLI default).
  const recModel = record.meta.llm.model?.trim() || "";
  const curModel = current.llm.model?.trim() || "";
  if (recModel !== curModel) {
    return false;
  }
  return true;
}

export async function writeMergeRecord(
  filePath: string,
  record: MergeRecord
): Promise<void> {
  await writeJsonAtomic(filePath, record);
}

export async function readMergeRecord(
  filePath: string
): Promise<MergeRecord | undefined> {
  const parsed = await readJson<MergeRecord>(filePath);
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
    return undefined;
  }
  if (!parsed.mindMap || typeof parsed.mindMap !== "object") {
    return undefined;
  }
  return parsed;
}

export { PIPELINE_VERSION, currentPipelineVersions };

export const __testing = {
  isSessionRecord,
  toIndexEntry,
  writeJsonAtomic,
  readJson,
  pathExists,
};

export { writeJsonAtomic } from "./atomicWrite";
