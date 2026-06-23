import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
} from "../../store/mergeConceptTrie";
import {
  enrichRecordsWithTopicPaths,
  prepareRecordsForFinalTrie,
  type ConceptMergePrepOntology as PrepOntology,
} from "@agent-mindmap/core";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "@agent-mindmap/core";
import type {
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
} from "@agent-mindmap/core";
import type { MergeRecord, SessionRecord } from "../../store/storeTypes";

export type { ConceptMergePrepOntology } from "@agent-mindmap/core";
export {
  collectDistinctTopSegmentKeys,
  collectStaleReattachTopRoots,
  ontologySliceForPrep,
  prepareRecordsForFinalTrie,
  recordsSubsetOfOntologySessions,
  warnIfStaleReattachTopRoots,
} from "@agent-mindmap/core";

export type UpdateConceptTrieOpts = {
  records: SessionRecord[];
  segmentEquivalences?: SegmentEquivalence[];
  reattachMoves?: ReattachMove[];
  reattachSteps?: ReattachStep[];
  /** M-merge virtual combined session (preferred over reattach when set). */
  virtualSessionAnalysis?: SessionAnalysis;
  ontology?: PrepOntology;
  projectSlug?: string;
};

/** Same record prep as M3 before reattach (topicPaths from ontology, no moves yet). */
export function prepareRecordsBeforeReattach(
  records: SessionRecord[],
  ontology: UpdateConceptTrieOpts["ontology"]
): SessionRecord[] {
  return enrichRecordsWithTopicPaths(records, ontology);
}

/**
 * M3 DET: apply reattachMoves to topic conceptPaths, then build the **final**
 * concept trie mind map shown in UI / written to concept-trie.json.
 * The LLM reparent step (M2.5) reads the **origin** trie (equiv only, no moves).
 */
export function updateConceptTrie(opts: UpdateConceptTrieOpts): MergeRecord {
  return buildConceptMergeRecord(opts.records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences ?? opts.ontology?.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
    ontologyForPrep: opts.ontology,
    reattachMoves: opts.reattachMoves,
    reattachSteps: opts.reattachSteps,
    virtualSessionAnalysis: opts.virtualSessionAnalysis,
  });
}

export async function updateConceptTrieAsync(opts: UpdateConceptTrieOpts): Promise<MergeRecord> {
  return buildConceptMergeRecordAsync(opts.records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences ?? opts.ontology?.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
    ontologyForPrep: opts.ontology,
    reattachMoves: opts.reattachMoves,
    reattachSteps: opts.reattachSteps,
    virtualSessionAnalysis: opts.virtualSessionAnalysis,
  });
}
