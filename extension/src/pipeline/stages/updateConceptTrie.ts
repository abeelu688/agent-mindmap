import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
} from "../../store/mergeConceptTrie";
import { applyReattachMovesToRecords } from "../../llm/applyReattachMoves";
import type { ReattachMove, SegmentEquivalence } from "../../llm/types";
import type { MergeRecord, SessionRecord } from "../../store/storeTypes";
import type { ConceptOntologyRecord } from "../../store/ontologyTypes";
import { applyTopicPathsFromOntology } from "../../store/applyOntology";

export type UpdateConceptTrieOpts = {
  records: SessionRecord[];
  segmentEquivalences?: SegmentEquivalence[];
  reattachMoves?: ReattachMove[];
  ontology?: Pick<
    ConceptOntologyRecord,
    "nodes" | "mappings" | "topicPaths" | "segmentEquivalences" | "reattachMoves"
  >;
  projectSlug?: string;
};

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

function prepareRecordsForTrie(opts: UpdateConceptTrieOpts): SessionRecord[] {
  const enriched = enrichRecordsWithOntology(opts.records, opts.ontology);
  const moves = opts.reattachMoves ?? opts.ontology?.reattachMoves;
  return applyReattachMovesToRecords(enriched, moves);
}

/** M3 DET: build concept trie merge record (root attach via LLM reattachMoves only). */
export function updateConceptTrie(
  opts: UpdateConceptTrieOpts
): MergeRecord {
  const records = prepareRecordsForTrie(opts);
  return buildConceptMergeRecord(records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences,
  });
}

export async function updateConceptTrieAsync(
  opts: UpdateConceptTrieOpts
): Promise<MergeRecord> {
  const records = prepareRecordsForTrie(opts);
  return buildConceptMergeRecordAsync(records, {
    projectSlug: opts.projectSlug,
    segmentEquivalences: opts.segmentEquivalences,
  });
}
