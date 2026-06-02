import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
} from "../../store/mergeConceptTrie";
import type { ReattachMove, ReattachStep, SegmentEquivalence } from "../../llm/types";
import type { MergeRecord, SessionRecord } from "../../store/storeTypes";
import {
  enrichRecordsWithTopicPaths,
  prepareRecordsForFinalTrie,
  type ConceptMergePrepOntology as PrepOntology,
} from "../../store/prepareConceptMergeRecords";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "../mergeSynonymPolicy";

export type { ConceptMergePrepOntology } from "../../store/prepareConceptMergeRecords";
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
    segmentEquivalences:
      opts.segmentEquivalences ?? opts.ontology?.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
    ontologyForPrep: opts.ontology,
    reattachMoves: opts.reattachMoves,
    reattachSteps: opts.reattachSteps,
  });
}

export async function updateConceptTrieAsync(
  opts: UpdateConceptTrieOpts
): Promise<MergeRecord> {
  return buildConceptMergeRecordAsync(opts.records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences:
      opts.segmentEquivalences ?? opts.ontology?.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
    ontologyForPrep: opts.ontology,
    reattachMoves: opts.reattachMoves,
    reattachSteps: opts.reattachSteps,
  });
}
