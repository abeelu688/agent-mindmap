import { applySegmentEquivalencesToRecords } from "../llm/applySegmentEquivalencesToRecords";
import { snapRecordsToVirtualSession } from "../llm/applyVirtualSessionToRecords";
import {
  applyReattachMovesSequentially,
  applyReattachStepsToRecords,
} from "../llm/reattachSteps";
import type { SessionAnalysis } from "../llm/types";
import { buildTrieReparentInput } from "../llm/trieReparentInput";
import type { ReattachMove, ReattachStep } from "../llm/types";
import { segmentKeyForMerge } from "../llm/topicGraphValidate";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "../pipeline/mergeSynonymPolicy";
import { applyTopicPathsFromOntology } from "./applyOntology";
import type { ConceptOntologyRecord } from "./ontologyTypes";
import type { SessionRecord } from "./storeTypes";
import { mindMapLog } from "../webview/MindMapLog";

export type ConceptMergePrepOntology = Pick<
  ConceptOntologyRecord,
  | "nodes"
  | "mappings"
  | "topicPaths"
  | "segmentEquivalences"
  | "reattachMoves"
  | "reattachSteps"
>;

/** Current records' session ids are covered by a (possibly larger) ontology build. */
export function recordsSubsetOfOntologySessions(
  records: SessionRecord[],
  ontology: ConceptOntologyRecord
): boolean {
  if (!records.length) {
    return false;
  }
  const ontologyIds = new Set(ontology.meta.sessionIds);
  return records.every((r) => ontologyIds.has(r.meta.sessionId));
}

export function ontologySliceForPrep(
  ontology: ConceptOntologyRecord,
  records: SessionRecord[]
): ConceptMergePrepOntology {
  const sessionIds = new Set(records.map((r) => r.meta.sessionId));
  return {
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths: ontology.topicPaths.filter((p) =>
      sessionIds.has(p.sessionId)
    ),
    segmentEquivalences: ontology.segmentEquivalences,
    reattachMoves: ontology.reattachMoves,
    reattachSteps: ontology.reattachSteps,
  };
}

/** Distinct normalized first-segment keys across all topic conceptPaths. */
export function collectDistinctTopSegmentKeys(records: SessionRecord[]): string[] {
  const roots = new Set<string>();
  for (const record of records) {
    for (const topic of record.graph.topics) {
      const key = segmentKeyForMerge(topic.conceptPath?.[0] ?? "");
      if (key) {
        roots.add(key);
      }
    }
  }
  return [...roots];
}

/** Top-level segment labels that should have been rewritten by reattach steps. */
export function collectStaleReattachTopRoots(
  records: SessionRecord[],
  steps: ReattachStep[] | undefined
): string[] {
  if (!steps?.length) {
    return [];
  }
  const staleFromKeys = new Set<string>();
  for (const step of steps) {
    const key = segmentKeyForMerge(step.sourceFrom);
    if (key) {
      staleFromKeys.add(key);
    }
  }
  if (!staleFromKeys.size) {
    return [];
  }
  const found = new Set<string>();
  for (const record of records) {
    for (const topic of record.graph.topics) {
      const path = topic.conceptPath;
      if (!path?.length) {
        continue;
      }
      const firstKey = segmentKeyForMerge(path[0]);
      if (firstKey && staleFromKeys.has(firstKey)) {
        found.add(path[0].trim());
      }
    }
  }
  return [...found].sort();
}

export function warnIfStaleReattachTopRoots(
  records: SessionRecord[],
  steps: ReattachStep[] | undefined
): void {
  const stale = collectStaleReattachTopRoots(records, steps);
  if (!stale.length) {
    return;
  }
  mindMapLog(
    `[agent-mindmap] reattach: topics still use pre-reattach top segments: ${stale.join(", ")}`
  );
}

/** Apply ontology topicPaths only (no reattach). Used before M-merge draft trie. */
export function enrichRecordsWithTopicPaths(
  records: SessionRecord[],
  ontology: ConceptMergePrepOntology | undefined
): SessionRecord[] {
  if (!ontology?.topicPaths?.length) {
    return records;
  }
  const full: ConceptOntologyRecord = {
    schemaVersion: 1,
    meta: {
      builtAt: Date.now(),
      cacheKey: "",
      sessionIds: records.map((r) => r.meta.sessionId),
      projectSlugs: Array.from(new Set(records.map((r) => r.meta.projectSlug))),
      llm: { provider: "pipeline" },
      promptVersions: {
        ontology: 0,
        topicPaths: 0,
        reattach: 0,
        refine: 0,
        outlineSchema: 0,
      },
    },
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths: ontology.topicPaths,
    segmentEquivalences: ontology.segmentEquivalences,
  };
  return applyTopicPathsFromOntology(records, full);
}

/** Topic paths, then virtual session snap or legacy reattach — entry before concept trie build. */
export function prepareRecordsForFinalTrie(
  records: SessionRecord[],
  ontology: ConceptMergePrepOntology | undefined,
  reattachMoves?: ReattachMove[],
  reattachSteps?: ReattachStep[],
  virtualSessionAnalysis?: SessionAnalysis
): SessionRecord[] {
  const afterTopicPaths = enrichRecordsWithTopicPaths(records, ontology);
  if (virtualSessionAnalysis) {
    const snapped = snapRecordsToVirtualSession(
      afterTopicPaths,
      virtualSessionAnalysis,
      ontology?.segmentEquivalences
    );
    const equivalences = ontology?.segmentEquivalences;
    if (MERGE_APPLY_SEGMENT_EQUIVALENCES && equivalences?.length) {
      return applySegmentEquivalencesToRecords(snapped, equivalences);
    }
    return snapped;
  }
  const moves = reattachMoves ?? ontology?.reattachMoves;
  const steps = reattachSteps ?? ontology?.reattachSteps;
  const reparentInput = buildTrieReparentInput(afterTopicPaths, {
    segmentEquivalences: ontology?.segmentEquivalences,
    ontologyNodes: ontology?.nodes,
  });
  const afterReattach = steps?.length
    ? applyReattachStepsToRecords(
        afterTopicPaths,
        steps,
        reparentInput.chains,
        0.55,
        reparentInput.nodeCatalog
      )
    : applyReattachMovesSequentially(
        afterTopicPaths,
        moves,
        reparentInput.chains
      );

  warnIfStaleReattachTopRoots(afterReattach, steps);

  const equivalences = ontology?.segmentEquivalences;
  if (MERGE_APPLY_SEGMENT_EQUIVALENCES && equivalences?.length) {
    return applySegmentEquivalencesToRecords(afterReattach, equivalences);
  }
  return afterReattach;
}
