/**
 * Extension adapter for ontologyStore — resolves Store via getStoreForDir
 * and injects uiTranslate for localization.
 *
 * Functions that previously took storeDir: string now resolve the Store
 * automatically. This preserves the extension-facing API.
 */
import {
  computeOntologyCacheKey as coreComputeOntologyCacheKey,
  findReusableOntologyBase as coreFindReusableOntologyBase,
  isCompleteOntologyRecord,
  readOntologyIndex as coreReadOntologyIndex,
  readOntologyRecord as coreReadOntologyRecord,
  writeOntologyRecord as coreWriteOntologyRecord,
  clearOntologyCache as coreClearOntologyCache,
  ensureOntologyMemory as coreEnsureOntologyMemory,
  type OntologyIndex,
  type EnsureOntologyMemoryFlags,
} from "@agent-mindmap/core";
import { t as safeT } from "../l10n/uiTranslate";
import { getStoreForDir } from "./storeClient";
import type { SessionRecord } from "./storeTypes";
import type { OntologyRecord } from "@agent-mindmap/shared";
import type { LlmProvider, AgentHostId, OutputLanguage, PromptLanguage } from "@agent-mindmap/core";
import type { MindMapProgress } from "../progress";

export type { OntologyIndex, EnsureOntologyMemoryFlags };
export { computeOntologyCacheKey } from "@agent-mindmap/core";
export { isCompleteOntologyRecord };
export type { OntologyRecord } from "@agent-mindmap/shared";

export async function readOntologyIndex(storeDir: string): Promise<OntologyIndex | undefined> {
  const store = await getStoreForDir(storeDir);
  return coreReadOntologyIndex(store);
}

export async function findReusableOntologyBase(
  storeDir: string,
  records: SessionRecord[]
): Promise<OntologyRecord | undefined> {
  const store = await getStoreForDir(storeDir);
  return coreFindReusableOntologyBase(store, records);
}

export async function readOntologyRecord(
  storeDir: string,
  cacheKey: string
): Promise<OntologyRecord | undefined> {
  const store = await getStoreForDir(storeDir);
  return coreReadOntologyRecord(store, cacheKey);
}

export async function clearOntologyCache(storeDir: string): Promise<void> {
  const store = await getStoreForDir(storeDir);
  return coreClearOntologyCache(store);
}

export async function writeOntologyRecord(
  storeDir: string,
  cacheKey: string,
  records: SessionRecord[],
  hostId: AgentHostId,
  opts: { model?: string; hostId?: AgentHostId },
  provider: LlmProvider,
  payload: Pick<
    OntologyRecord,
    | "nodes"
    | "mappings"
    | "topicPaths"
    | "reattachMoves"
    | "reattachSteps"
    | "segmentEquivalences"
    | "mergeSessionAnalysis"
  >
): Promise<OntologyRecord> {
  const store = await getStoreForDir(storeDir);
  return coreWriteOntologyRecord(store, cacheKey, records, hostId, opts, provider, payload);
}

/**
 * Build (or reuse) a cross-session concept ontology + per-topic conceptPath memory.
 * Extension adapter that resolves Store and injects uiTranslate.
 */
export async function ensureOntologyMemory(
  records: SessionRecord[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    title?: string;
    promptLanguage?: PromptLanguage;
  },
  provider: LlmProvider,
  storeDir: string,
  signal: AbortSignal,
  progress?: MindMapProgress,
  flags: EnsureOntologyMemoryFlags = {}
): Promise<OntologyRecord> {
  const store = await getStoreForDir(storeDir);
  const localeResolver = { t: safeT };
  return coreEnsureOntologyMemory(records, opts, provider, store, signal, progress, localeResolver, flags);
}
