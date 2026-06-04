import * as fs from "fs/promises";
import * as path from "path";
import { writeJsonAtomic } from "./atomicWrite";
import { MERGE_SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptMergeSessionAnalysis";
import { REATTACH_PROMPT_VERSION } from "../llm/promptReattach";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import type {
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
  SessionOutline,
  SessionTreeSnapshot,
  Topic,
} from "../llm/types";
import {
  outlineToTopicGraph,
  topicGraphToOutline,
} from "../llm/outlineToTopicGraph";
import { segmentKeyForMerge } from "../llm/topicGraphValidate";
import type { ConceptOntologyRecord } from "./ontologyTypes";
import {
  buildConceptTrieStructure,
  type ConceptTrieNode,
} from "./mergeConceptTrie";
import type { TopicConceptPathDecision } from "./ontologyTypes";
import {
  prepareRecordsForFinalTrie,
  type ConceptMergePrepOntology,
  collectDistinctTopSegmentKeys,
} from "./prepareConceptMergeRecords";
import {
  buildRecordMeta,
  buildSessionRecord,
  STORE_LAYOUT,
} from "./sessionStore";
import type {
  ConceptContextForMerge,
  MergeRecord,
  MergeSnapshot,
  MergeSnapshotMeta,
  SessionRecord,
  SnapshotManifest,
  SnapshotNode,
} from "./storeTypes";
import type { FinalizedSessionAnalysis } from "../pipeline/stages/finalizeSessionAnalysis";

/** Virtual session id for delta M-merge (one record = stabilized project map). */
export const MERGE_SNAPSHOT_SESSION_ID = "__project_merge_snapshot__";

export const DEFAULT_SNAPSHOT_GROUP_SIZE = 5;

/** Virtual session id for a hierarchy snapshot node in M-merge input. */
export function snapshotVirtualSessionId(snapshotId: string): string {
  return `__snapshot_${snapshotId}__`;
}

const SNAPSHOT_CONTEXT_CAP = 120;
const HUB_CHILDREN_PER_CHAIN = 8;

export function isMergeSnapshotSessionId(sessionId: string): boolean {
  return sessionId === MERGE_SNAPSHOT_SESSION_ID || sessionId.startsWith("__");
}

/** Exclude virtual snapshot records from batch maps and session lists. */
export function filterRealSessionRecords(
  records: SessionRecord[]
): SessionRecord[] {
  return records.filter((r) => !isMergeSnapshotSessionId(r.meta.sessionId));
}

export function mergeSnapshotPath(
  storeDir: string,
  projectSlug: string
): string {
  return path.join(
    storeDir,
    STORE_LAYOUT.mergesDir,
    projectSlug,
    "merge-snapshot.json"
  );
}

export function snapshotManifestPath(
  storeDir: string,
  projectSlug: string
): string {
  return path.join(
    storeDir,
    STORE_LAYOUT.mergesDir,
    projectSlug,
    "snapshot-manifest.json"
  );
}

export function projectSnapshotsDir(
  storeDir: string,
  projectSlug: string
): string {
  return path.join(storeDir, STORE_LAYOUT.mergesDir, projectSlug, "snapshots");
}

export function snapshotFilePath(
  storeDir: string,
  projectSlug: string,
  relativePath: string
): string {
  return path.join(storeDir, STORE_LAYOUT.mergesDir, projectSlug, relativePath);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[agent-mindmap] failed to read ${filePath}:`, err);
    }
    return undefined;
  }
}

function isMergeSnapshot(parsed: unknown): parsed is MergeSnapshot {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  const s = parsed as MergeSnapshot;
  return (
    s.schemaVersion === 1 &&
    Boolean(s.meta?.projectSlug) &&
    Array.isArray(s.meta.sessionIds) &&
    Boolean(s.treeSnapshot?.nodes) &&
    Array.isArray(s.conceptContexts)
  );
}

export async function readMergeSnapshot(
  storeDir: string,
  projectSlug: string
): Promise<MergeSnapshot | undefined> {
  const parsed = await readJson<unknown>(
    mergeSnapshotPath(storeDir, projectSlug)
  );
  return isMergeSnapshot(parsed) ? parsed : undefined;
}

export async function writeMergeSnapshot(
  storeDir: string,
  snapshot: MergeSnapshot
): Promise<void> {
  await writeJsonAtomic(
    mergeSnapshotPath(storeDir, snapshot.meta.projectSlug),
    snapshot
  );
}

export async function deleteMergeSnapshot(
  storeDir: string,
  projectSlug: string
): Promise<void> {
  try {
    await fs.unlink(mergeSnapshotPath(storeDir, projectSlug));
  } catch {
    // missing file is fine
  }
}

function isSnapshotManifest(parsed: unknown): parsed is SnapshotManifest {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  const m = parsed as SnapshotManifest;
  return (
    m.schemaVersion === 2 &&
    Boolean(m.projectSlug) &&
    Array.isArray(m.nodes) &&
    Array.isArray(m.topLevelIds)
  );
}

export function createEmptySnapshotManifest(
  projectSlug: string,
  groupSize: number = DEFAULT_SNAPSHOT_GROUP_SIZE
): SnapshotManifest {
  return {
    schemaVersion: 2,
    projectSlug,
    groupSize,
    nodes: [],
    topLevelIds: [],
    sessionToLeafId: {},
  };
}

export async function readSnapshotManifest(
  storeDir: string,
  projectSlug: string
): Promise<SnapshotManifest | undefined> {
  const parsed = await readJson<unknown>(
    snapshotManifestPath(storeDir, projectSlug)
  );
  return isSnapshotManifest(parsed) ? parsed : undefined;
}

export async function writeSnapshotManifest(
  storeDir: string,
  manifest: SnapshotManifest
): Promise<void> {
  await writeJsonAtomic(
    snapshotManifestPath(storeDir, manifest.projectSlug),
    manifest
  );
}

export async function readSnapshotById(
  storeDir: string,
  projectSlug: string,
  node: SnapshotNode
): Promise<MergeSnapshot | undefined> {
  const parsed = await readJson<unknown>(
    snapshotFilePath(storeDir, projectSlug, node.path)
  );
  return isMergeSnapshot(parsed) ? parsed : undefined;
}

export async function writeSnapshotByPath(
  storeDir: string,
  projectSlug: string,
  relativePath: string,
  snapshot: MergeSnapshot
): Promise<void> {
  await writeJsonAtomic(
    snapshotFilePath(storeDir, projectSlug, relativePath),
    snapshot
  );
}

export function findLeafNodeForSession(
  manifest: SnapshotManifest,
  sessionId: string
): SnapshotNode | undefined {
  const leafId = manifest.sessionToLeafId[sessionId];
  if (!leafId) {
    return undefined;
  }
  return manifest.nodes.find((n) => n.id === leafId);
}

export function findParentNode(
  manifest: SnapshotManifest,
  childId: string
): SnapshotNode | undefined {
  return manifest.nodes.find((n) => n.childIds.includes(childId));
}

/** Delete manifest, snapshots dir, and root merge-snapshot.json. */
export async function deleteSnapshotHierarchy(
  storeDir: string,
  projectSlug: string
): Promise<void> {
  await deleteMergeSnapshot(storeDir, projectSlug);
  try {
    await fs.unlink(snapshotManifestPath(storeDir, projectSlug));
  } catch {
    // missing is fine
  }
  try {
    await fs.rm(projectSnapshotsDir(storeDir, projectSlug), {
      recursive: true,
      force: true,
    });
  } catch {
    // missing is fine
  }
}

export type BuildMergeSnapshotMetaExtras = {
  sessionIds?: string[];
  snapshotId?: string;
  level?: number;
  childSnapshotIds?: string[];
};

function resolveSnapshotSessionIds(
  allRecords: SessionRecord[],
  extras?: BuildMergeSnapshotMetaExtras
): string[] {
  if (extras?.sessionIds?.length) {
    return [...extras.sessionIds].sort();
  }
  return filterRealSessionRecords(allRecords)
    .map((r) => r.meta.sessionId)
    .sort();
}

function collectHubContextsFromTrie(
  root: ConceptTrieNode,
  projectSlug: string,
  cap: number
): ConceptContextForMerge[] {
  const out: ConceptContextForMerge[] = [];
  const sortedTop = [...root.children.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label)
  );

  const pushNode = (node: ConceptTrieNode, depth: number): void => {
    if (out.length >= cap) {
      return;
    }
    const childKeys = [...node.children.keys()].slice(0, HUB_CHILDREN_PER_CHAIN);
    const parentKey =
      depth === 0
        ? ""
        : segmentKeyForMerge(node.key);
    out.push({
      key: node.key,
      label: node.label,
      domainKeys: depth === 0 ? [node.key] : [],
      parentKeys: parentKey && depth > 0 ? [] : [],
      childKeys,
      evidence: [
        `Stable project map hub (${node.occurrences} occurrences, ${node.topics.length} topics)`,
      ],
      sessionId: MERGE_SNAPSHOT_SESSION_ID,
      projectSlug,
    });
    if (depth === 0) {
      const sortedChildren = [...node.children.values()].sort(
        (a, b) =>
          b.occurrences - a.occurrences || a.label.localeCompare(b.label)
      );
      for (const child of sortedChildren.slice(0, HUB_CHILDREN_PER_CHAIN)) {
        pushNode(child, depth + 1);
      }
    }
  };

  for (const top of sortedTop) {
    pushNode(top, 0);
    if (out.length >= cap) {
      break;
    }
  }
  return out.slice(0, cap);
}

function topicPathDecisionsFromPrepared(
  prepared: SessionRecord[],
  projectSlug: string
): TopicConceptPathDecision[] {
  const out: TopicConceptPathDecision[] = [];
  for (const record of prepared) {
    if (record.meta.projectSlug !== projectSlug) {
      continue;
    }
    for (const topic of record.graph.topics) {
      if (!topic.conceptPath?.length) {
        continue;
      }
      out.push({
        topicId: `${record.meta.sessionId}:${segmentKeyForMerge(topic.title)}`,
        sessionId: record.meta.sessionId,
        projectSlug,
        conceptPath: [...topic.conceptPath],
        confidence: 1,
      });
    }
  }
  return out;
}

function aggregateTopicsForSnapshot(
  prepared: SessionRecord[],
  projectSlug: string
): Topic[] {
  const topics: Topic[] = [];
  for (const record of prepared) {
    if (record.meta.projectSlug !== projectSlug) {
      continue;
    }
    for (const topic of record.graph.topics) {
      if (!topic.conceptPath?.length) {
        continue;
      }
      topics.push({
        title: topic.title,
        summary: topic.summary,
        conceptPath: [...topic.conceptPath],
        items: topic.items?.slice(0, 2),
      });
    }
  }
  return topics;
}

function buildSnapshotAnalysis(
  treeSnapshot: SessionTreeSnapshot,
  outline: SessionOutline,
  segmentEquivalences: SegmentEquivalence[]
): SessionAnalysis {
  return {
    domains: [],
    nodes: treeSnapshot.nodes,
    mappings: treeSnapshot.mappings,
    segmentEquivalences,
    outline,
  };
}

/**
 * DET: materialize MergeSnapshot from M-merge virtual combined session.
 */
export function buildMergeSnapshotFromVirtualSession(
  allRecords: SessionRecord[],
  virtual: FinalizedSessionAnalysis,
  projectSlug: string,
  segmentEquivalences: SegmentEquivalence[],
  metaExtras?: BuildMergeSnapshotMetaExtras
): MergeSnapshot {
  const realRecords = filterRealSessionRecords(allRecords);
  const prep = prepareRecordsForFinalTrie(
    realRecords,
    { segmentEquivalences, nodes: virtual.sessionAnalysis.nodes },
    undefined,
    undefined,
    virtual.sessionAnalysis
  );
  const preparedTopicPaths = topicPathDecisionsFromPrepared(prep, projectSlug);
  const sessionIds = resolveSnapshotSessionIds(allRecords, metaExtras);

  const meta: MergeSnapshotMeta = {
    builtAt: Date.now(),
    projectSlug,
    sessionIds,
    snapshotId: metaExtras?.snapshotId,
    level: metaExtras?.level,
    childSnapshotIds: metaExtras?.childSnapshotIds,
    hostId: realRecords[0]?.meta.hostId,
    promptVersions: {
      sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
      mergeSessionAnalysis: MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
    },
  };

  return {
    schemaVersion: 1,
    meta,
    treeSnapshot: {
      ...virtual.treeSnapshot,
      topicPathDecisions: preparedTopicPaths.map((tp) => ({
        topicId: tp.topicId,
        sessionId: tp.sessionId,
        projectSlug: tp.projectSlug,
        conceptPath: tp.conceptPath,
        confidence: tp.confidence,
        evidence: tp.evidence,
      })),
    },
    sessionAnalysis: virtual.sessionAnalysis,
    conceptContexts: virtual.conceptContexts,
    segmentEquivalences,
    topicPaths: preparedTopicPaths,
  };
}

/**
 * DET: materialize MergeSnapshot after a successful full-library merge.
 */
export function buildMergeSnapshotFromOntology(
  allRecords: SessionRecord[],
  ontology: ConceptOntologyRecord,
  _merge: MergeRecord,
  projectSlug: string
): MergeSnapshot {
  const realRecords = filterRealSessionRecords(allRecords);
  const prep: ConceptMergePrepOntology = {
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths: ontology.topicPaths,
    segmentEquivalences: ontology.segmentEquivalences,
    reattachMoves: ontology.reattachMoves,
    reattachSteps: ontology.reattachSteps,
  };
  const prepared = prepareRecordsForFinalTrie(
    realRecords,
    prep,
    ontology.reattachMoves,
    ontology.reattachSteps
  );
  const trie = buildConceptTrieStructure(prepared, {
    projectSlug,
    segmentEquivalences: ontology.segmentEquivalences,
  });

  const topics = aggregateTopicsForSnapshot(prepared, projectSlug);
  const graph = { topics };
  const outline = topicGraphToOutline(graph);
  const preparedTopicPaths = topicPathDecisionsFromPrepared(prepared, projectSlug);
  const treeSnapshot: SessionTreeSnapshot = {
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPathDecisions: preparedTopicPaths.map((tp) => ({
      topicId: tp.topicId,
      sessionId: tp.sessionId,
      projectSlug: tp.projectSlug,
      conceptPath: tp.conceptPath,
      confidence: tp.confidence,
      evidence: tp.evidence,
    })),
  };
  const segmentEquivalences = ontology.segmentEquivalences ?? [];
  const hubContexts = collectHubContextsFromTrie(
    trie.root,
    projectSlug,
    SNAPSHOT_CONTEXT_CAP
  );
  const sessionIds = realRecords.map((r) => r.meta.sessionId).sort();

  const meta: MergeSnapshotMeta = {
    builtAt: Date.now(),
    projectSlug,
    sessionIds,
    hostId: realRecords[0]?.meta.hostId,
    promptVersions: {
      sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
      mergeSessionAnalysis: MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
      reattach: REATTACH_PROMPT_VERSION,
    },
  };

  return {
    schemaVersion: 1,
    meta,
    treeSnapshot,
    sessionAnalysis: buildSnapshotAnalysis(
      treeSnapshot,
      outline,
      segmentEquivalences
    ),
    conceptContexts: hubContexts,
    segmentEquivalences,
    reattachSteps: ontology.reattachSteps,
    reattachMoves: ontology.reattachMoves,
    topicPaths: preparedTopicPaths,
  };
}

/** Convert persisted snapshot into a virtual SessionRecord for M-merge LLM input. */
export function snapshotToSessionRecord(
  snapshot: MergeSnapshot,
  virtualSessionId?: string
): SessionRecord {
  const topics = aggregateTopicsFromSnapshot(snapshot);
  const graph = { topics };
  const outline = topicGraphToOutline(graph);
  const sessionId =
    virtualSessionId ??
    (snapshot.meta.snapshotId
      ? snapshotVirtualSessionId(snapshot.meta.snapshotId)
      : MERGE_SNAPSHOT_SESSION_ID);
  const meta = buildRecordMeta({
    sessionId,
    projectSlug: snapshot.meta.projectSlug,
    transcriptPath: "",
    transcriptMtimeMs: 0,
    transcriptSha256: "merge-snapshot",
    llm: { provider: "snapshot" },
    promptParams: { maxTopics: 8, maxItemsPerTopic: 8 },
    sessionLabel: snapshot.meta.snapshotId
      ? `Snapshot ${snapshot.meta.snapshotId}`
      : "Project merge snapshot",
    hostId: snapshot.meta.hostId,
  });

  return buildSessionRecord(meta, outline, {
    sessionAnalysis: snapshot.sessionAnalysis,
    treeSnapshot: snapshot.treeSnapshot,
    conceptContexts: snapshot.conceptContexts,
  });
}

function aggregateTopicsFromSnapshot(snapshot: MergeSnapshot): Topic[] {
  const fromOutline = outlineToTopicGraph(
    snapshot.sessionAnalysis.outline
  ).topics.filter((t) => t.conceptPath?.length);
  if (fromOutline.length > 0) {
    return fromOutline;
  }
  const byPath = new Map<string, Topic>();
  for (const tp of snapshot.topicPaths) {
    if (!tp.conceptPath?.length) {
      continue;
    }
    const pk = tp.conceptPath.map((s) => segmentKeyForMerge(s)).join("/");
    if (!byPath.has(pk)) {
      byPath.set(pk, {
        title: tp.conceptPath[tp.conceptPath.length - 1] ?? "topic",
        conceptPath: [...tp.conceptPath],
      });
    }
  }
  if (byPath.size > 0) {
    return [...byPath.values()];
  }
  return [];
}

/** Top-level segment keys on a record set (for debug / tests). */
export function topRootsFromRecords(records: SessionRecord[]): string[] {
  return collectDistinctTopSegmentKeys(records);
}

/** True when the new batch adds top-level segments absent from the stable snapshot trie. */
export function batchIntroducesNewTopRoots(
  snapshot: MergeSnapshot,
  batchRecords: SessionRecord[]
): boolean {
  const snapRoots = new Set(
    topRootsFromRecords([snapshotToSessionRecord(snapshot)])
  );
  const batchRoots = topRootsFromRecords(batchRecords);
  if (!snapRoots.size) {
    return batchRoots.length > 0;
  }
  return batchRoots.some((root) => !snapRoots.has(root));
}

export function appendReattachSteps(
  existing: ReattachStep[],
  delta: ReattachStep[]
): ReattachStep[] {
  if (!delta.length) {
    return existing;
  }
  const maxStep = existing.reduce(
    (m, s) => Math.max(m, typeof s.step === "number" ? s.step : 0),
    0
  );
  return [
    ...existing,
    ...delta.map((s, i) => ({
      ...s,
      step: maxStep + i + 1,
    })),
  ];
}
