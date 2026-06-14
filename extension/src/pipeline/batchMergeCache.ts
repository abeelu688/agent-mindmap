import { isCompleteOntologyRecord, readOntologyRecord } from "../store/ontologyStore";
import { conceptTrieMergePath, readMergeRecord, recordFreshnessToken } from "../store/sessionStore";
import { mindMapLog } from "../webview/MindMapLog";
import { computeBatchMergeCacheKey } from "./mergePipeline";
import type { AgentHostId } from "../host/types";
import type { OutputLanguage } from "../llm/promptLanguage";
import type { MergeRecord, SessionRecord } from "../store/storeTypes";

export type BatchMergeCacheLookup =
  | { hit: true; merge: MergeRecord }
  | { hit: false; reason: string };

export type TryReuseBatchMergeOpts = {
  storeDir: string;
  projectSlug: string;
  /** All real (non-virtual) session records currently in the project. */
  allRecords: SessionRecord[];
  llm: {
    providerId: string;
    model?: string;
    hostId?: AgentHostId;
    outputLanguage?: OutputLanguage;
  };
};

/**
 * Check whether the existing concept-trie merge record can be reused for the
 * given session set, avoiding the expensive M-merge LLM + multi-level snapshot
 * rebuild when nothing has changed.
 *
 * Hit conditions (all must hold):
 * 1. The ontology cache for the same key (sessionIds + transcriptShas + provider
 *    + model + prompt versions) exists, is complete, and contains a virtual
 *    `mergeSessionAnalysis`.
 * 2. The previously-written `merges/concept-trie.json` exists.
 * 3. That merge record's `meta.sessionIds` exactly match the current session
 *    ids (set equality — order doesn't matter).
 *
 * Cache misses are silent — callers should fall through to the regular merge
 * pipeline.
 */
export async function tryReuseBatchMerge(
  opts: TryReuseBatchMergeOpts
): Promise<BatchMergeCacheLookup> {
  // Debug: dump the inputs that go into the cache key — this is the single
  // most useful thing for diagnosing "why didn't it hit?". Pinpoint each
  // session's transcriptSha256 so the user can compare with on-disk records.
  const sortedRecords = [...opts.allRecords].sort((a, b) =>
    a.meta.sessionId.localeCompare(b.meta.sessionId)
  );
  const recordSummary = sortedRecords.map((r) => ({
    sid: r.meta.sessionId.slice(0, 8),
    token: recordFreshnessToken(r),
    host: r.meta.hostId,
    llm: r.meta.llm,
  }));
  mindMapLog(
    `[tryReuseBatchMerge] inputs: count=${opts.allRecords.length} provider=${opts.llm.providerId} model=${opts.llm.model || "(default)"} hostId=${opts.llm.hostId || "(none)"} outputLanguage=${opts.llm.outputLanguage || "(record/default)"} records=${JSON.stringify(recordSummary)}`
  );

  if (opts.allRecords.length === 0) {
    mindMapLog(`[tryReuseBatchMerge] MISS: no records`);
    return { hit: false, reason: "no records" };
  }

  const cacheKey = computeBatchMergeCacheKey(opts.allRecords, opts.llm);
  mindMapLog(`[tryReuseBatchMerge] computed cacheKey=${cacheKey}`);

  const ontology = await readOntologyRecord(opts.storeDir, cacheKey);
  if (!ontology) {
    mindMapLog(`[tryReuseBatchMerge] MISS: ontology cache file not found at key=${cacheKey}`);
    return { hit: false, reason: "ontology cache key not found" };
  }
  mindMapLog(
    `[tryReuseBatchMerge] ontology found: builtAt=${ontology.meta.builtAt} sessionIds=${JSON.stringify(ontology.meta.sessionIds.map((s) => s.slice(0, 8)))} promptVersions=${JSON.stringify(ontology.meta.promptVersions)} llm=${JSON.stringify(ontology.meta.llm)} hasMergeAnalysis=${Boolean(ontology.mergeSessionAnalysis)}`
  );

  if (!isCompleteOntologyRecord(ontology)) {
    mindMapLog(
      `[tryReuseBatchMerge] MISS: ontology incomplete (nodes=${ontology.nodes?.length ?? 0} topicPaths=${ontology.topicPaths?.length ?? 0} segEq=${ontology.segmentEquivalences?.length ?? "missing"} promptVersions=${JSON.stringify(ontology.meta.promptVersions)})`
    );
    return { hit: false, reason: "ontology cache incomplete" };
  }
  if (!ontology.mergeSessionAnalysis) {
    mindMapLog(`[tryReuseBatchMerge] MISS: ontology missing mergeSessionAnalysis`);
    return { hit: false, reason: "ontology missing mergeSessionAnalysis" };
  }

  const mergePath = conceptTrieMergePath(opts.storeDir);
  const merge = await readMergeRecord(mergePath);
  if (!merge) {
    mindMapLog(`[tryReuseBatchMerge] MISS: concept-trie.json not found at ${mergePath}`);
    return { hit: false, reason: "concept-trie.json not found" };
  }
  mindMapLog(
    `[tryReuseBatchMerge] concept-trie found: builtAt=${merge.meta.builtAt} sessionIds=${JSON.stringify(merge.meta.sessionIds.map((s) => s.slice(0, 8)))}`
  );

  const expected = new Set(opts.allRecords.map((r) => r.meta.sessionId));
  const stored = new Set(merge.meta.sessionIds);
  if (expected.size !== stored.size) {
    mindMapLog(
      `[tryReuseBatchMerge] MISS: sessionIds size mismatch expected=${expected.size} stored=${stored.size}`
    );
    return {
      hit: false,
      reason: `sessionIds size mismatch (expected ${expected.size}, stored ${stored.size})`,
    };
  }
  for (const id of expected) {
    if (!stored.has(id)) {
      mindMapLog(`[tryReuseBatchMerge] MISS: sessionId not in stored merge: ${id.slice(0, 8)}…`);
      return {
        hit: false,
        reason: `sessionId not in stored merge: ${id.slice(0, 8)}…`,
      };
    }
  }

  mindMapLog(
    `[tryReuseBatchMerge] HIT: returning cached merge with ${merge.meta.sessionIds.length} sessions`
  );
  return { hit: true, merge };
}
