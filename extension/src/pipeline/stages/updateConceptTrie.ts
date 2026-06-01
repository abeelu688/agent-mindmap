import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
} from "../../store/mergeConceptTrie";
import { applySegmentEquivalencesToRecords } from "../../llm/applySegmentEquivalencesToRecords";
import {
  applyReattachMovesSequentially,
  applyReattachStepsToRecords,
} from "../../llm/reattachSteps";
import { buildTrieReparentInput } from "../../llm/trieReparentInput";
import type { ReattachMove, ReattachStep, SegmentEquivalence } from "../../llm/types";
import type { MergeRecord, SessionRecord } from "../../store/storeTypes";
import type { ConceptOntologyRecord } from "../../store/ontologyTypes";
import { applyTopicPathsFromOntology } from "../../store/applyOntology";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "../mergeSynonymPolicy";

export type UpdateConceptTrieOpts = {
  records: SessionRecord[];
  segmentEquivalences?: SegmentEquivalence[];
  reattachMoves?: ReattachMove[];
  reattachSteps?: ReattachStep[];
  ontology?: Pick<
    ConceptOntologyRecord,
    | "nodes"
    | "mappings"
    | "topicPaths"
    | "segmentEquivalences"
    | "reattachMoves"
    | "reattachSteps"
  >;
  projectSlug?: string;
};

/** Same record prep as M3 before reattach (topicPaths from ontology, no moves yet). */
export function prepareRecordsBeforeReattach(
  records: SessionRecord[],
  ontology: UpdateConceptTrieOpts["ontology"]
): SessionRecord[] {
  return enrichRecordsWithOntology(records, ontology);
}

function enrichRecordsWithOntology(
  records: SessionRecord[],
  ontology: UpdateConceptTrieOpts["ontology"]
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

/** Topic paths (if any) then LLM reattach moves — single entry for M3 and cache rebuild. */
export function prepareRecordsForFinalTrie(
  records: SessionRecord[],
  ontology: UpdateConceptTrieOpts["ontology"],
  reattachMoves?: ReattachMove[],
  reattachSteps?: ReattachStep[]
): SessionRecord[] {
  const afterTopicPaths = prepareRecordsBeforeReattach(records, ontology);
  const moves = reattachMoves ?? ontology?.reattachMoves;
  const steps = reattachSteps;
  const chains = buildTrieReparentInput(afterTopicPaths, {
    segmentEquivalences: ontology?.segmentEquivalences,
    ontologyNodes: ontology?.nodes,
  }).chains;
  const afterReattach = steps?.length
    ? applyReattachStepsToRecords(afterTopicPaths, steps, chains)
    : applyReattachMovesSequentially(afterTopicPaths, moves, chains);
  const equivalences = ontology?.segmentEquivalences;
  return applySegmentEquivalencesToRecords(afterReattach, equivalences);
}

function prepareRecordsForTrie(opts: UpdateConceptTrieOpts): SessionRecord[] {
  return prepareRecordsForFinalTrie(
    opts.records,
    opts.ontology,
    opts.reattachMoves,
    opts.reattachSteps
  );
}

/**
 * M3 DET: apply reattachMoves to topic conceptPaths, then build the **final**
 * concept trie mind map shown in UI / written to concept-trie.json.
 * The LLM reparent step (M2.5) reads the **origin** trie (equiv only, no moves).
 */
export function updateConceptTrie(
  opts: UpdateConceptTrieOpts
): MergeRecord {
  const records = prepareRecordsForTrie(opts);
  return buildConceptMergeRecord(records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
  });
}

export async function updateConceptTrieAsync(
  opts: UpdateConceptTrieOpts
): Promise<MergeRecord> {
  const records = prepareRecordsForTrie(opts);
  return buildConceptMergeRecordAsync(records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences,
    applySegmentEquivalences: MERGE_APPLY_SEGMENT_EQUIVALENCES,
  });
}
