/**
 * Extension-local adapter for `mergeConceptTrie` from core.
 *
 * Re-exports the core functions. The async record builder injects the
 * extension's `sanitizeSessionRecord` as the sanitize callback.
 * The `prepareRecordsFn` callback injects the extension's
 * `prepareRecordsForFinalTrie` from `./prepareConceptMergeRecords`.
 */
import {
  buildConceptTrieStructure as coreBuildConceptTrieStructure,
  buildConceptTrieMindMap as coreBuildConceptTrieMindMap,
  buildConceptMergeRecord as coreBuildConceptMergeRecord,
  type ConceptMergeOptions,
  type ConceptMergeStats,
  type ConceptTrieStructure,
  type ConceptMergePrepOntology,
  type MindMapRoot,
} from "@agent-mindmap/core";
import { sanitizeSessionRecord } from "./sanitizeRecords";
import { prepareRecordsForFinalTrie } from "@agent-mindmap/core";
import type { MergeRecord, SessionRecord } from "./storeTypes";
import type { ReattachMove, ReattachStep, SessionAnalysis } from "@agent-mindmap/core";

export {
  buildOutlineFromConceptTrie,
  type ConceptTrieNode,
  type ConceptMergeOptions,
  type ConceptMergeStats,
  type ConceptTrieStructure,
  type ConceptMergePrepOntology,
} from "@agent-mindmap/core";

export async function buildConceptMergeRecordAsync(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): Promise<MergeRecord> {
  const sanitized = await Promise.all(records.map((r) => sanitizeSessionRecord(r)));
  return buildConceptMergeRecord(sanitized, options);
}

/** Build concept trie structure with extension's prepareRecordsFn injected. */
export function buildConceptTrieStructure(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): ConceptTrieStructure {
  const opts: ConceptMergeOptions = {
    ...options,
    prepareRecordsFn: options.ontologyForPrep
      ? (
          recs: SessionRecord[],
          ontology: ConceptMergePrepOntology,
          moves: ReattachMove[] | undefined,
          steps: ReattachStep[] | undefined,
          virtualSession: SessionAnalysis | undefined
        ) => prepareRecordsForFinalTrie(recs, ontology, moves, steps, virtualSession)
      : undefined,
  };
  return coreBuildConceptTrieStructure(records, opts);
}

/** Build concept trie mind map with extension's prepareRecordsFn injected. */
export function buildConceptTrieMindMap(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): { mindMap: MindMapRoot; stats: ConceptMergeStats } {
  const opts: ConceptMergeOptions = {
    ...options,
    prepareRecordsFn: options.ontologyForPrep
      ? (
          recs: SessionRecord[],
          ontology: ConceptMergePrepOntology,
          moves: ReattachMove[] | undefined,
          steps: ReattachStep[] | undefined,
          virtualSession: SessionAnalysis | undefined
        ) => prepareRecordsForFinalTrie(recs, ontology, moves, steps, virtualSession)
      : undefined,
  };
  return coreBuildConceptTrieMindMap(records, opts);
}

/** Build concept merge record with extension's prepareRecordsFn injected. */
export function buildConceptMergeRecord(
  records: SessionRecord[],
  options: ConceptMergeOptions = {}
): MergeRecord {
  const opts: ConceptMergeOptions = {
    ...options,
    prepareRecordsFn: options.ontologyForPrep
      ? (
          recs: SessionRecord[],
          ontology: ConceptMergePrepOntology,
          moves: ReattachMove[] | undefined,
          steps: ReattachStep[] | undefined,
          virtualSession: SessionAnalysis | undefined
        ) => prepareRecordsForFinalTrie(recs, ontology, moves, steps, virtualSession)
      : undefined,
  };
  return coreBuildConceptMergeRecord(records, opts);
}
