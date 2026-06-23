import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
  type ConceptMergePrepOntology as PrepOntology,
} from "../../store/mergeConceptTrie";
import { enrichRecordsWithTopicPaths } from "../../store/prepareConceptMergeRecords";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "../mergeSynonymPolicy";
import type {
  ReattachMove,
  ReattachStep,
  SegmentEquivalence,
  SessionAnalysis,
} from "../../llm/barrel";
import type { MergeRecord, SessionRecord } from "@agent-mindmap/shared";

export type { ConceptMergePrepOntology } from "../../store/mergeConceptTrie";
export {
  collectDistinctTopSegmentKeys,
  collectStaleReattachTopRoots,
  ontologySliceForPrep,
  prepareRecordsForFinalTrie,
  recordsSubsetOfOntologySessions,
  warnIfStaleReattachTopRoots,
} from "../../store/prepareConceptMergeRecords";

export type UpdateConceptTrieOpts = {
  records: SessionRecord[];
  segmentEquivalences?: SegmentEquivalence[];
  reattachMoves?: ReattachMove[];
  reattachSteps?: ReattachStep[];
  /** M-merge virtual combined session (preferred over reattach when set). */
  virtualSessionAnalysis?: SessionAnalysis;
  ontology?: PrepOntology;
  projectSlug?: string;
  /** Sanitize callback — extension injects host-specific transcript parser. */
  sanitizeRecord?: (record: SessionRecord) => Promise<SessionRecord>;
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
  const sanitizeFn = opts.sanitizeRecord ?? ((r: SessionRecord) => Promise.resolve(r));
  return buildConceptMergeRecordAsync(opts.records, sanitizeFn, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences ?? opts.ontology?.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
    ontologyForPrep: opts.ontology,
    reattachMoves: opts.reattachMoves,
    reattachSteps: opts.reattachSteps,
    virtualSessionAnalysis: opts.virtualSessionAnalysis,
  });
}
