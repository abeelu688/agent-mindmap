/**
 * Extension adapter for updateConceptTrie — injects the extension's
 * sanitizeSessionRecord (which uses host-specific transcript parsing).
 */
import {
  updateConceptTrie as coreUpdateConceptTrie,
  updateConceptTrieAsync as coreUpdateConceptTrieAsync,
  prepareRecordsBeforeReattach,
  type UpdateConceptTrieOpts,
  type ConceptMergePrepOntology,
} from "@agent-mindmap/core";
import { sanitizeSessionRecord } from "../../store/sanitizeRecords";
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

export type { UpdateConceptTrieOpts };

export { prepareRecordsBeforeReattach };

/**
 * M3 DET: apply reattachMoves to topic conceptPaths, then build the **final**
 * concept trie mind map shown in UI / written to concept-trie.json.
 * Injects the extension's sanitizeSessionRecord.
 */
export function updateConceptTrie(opts: UpdateConceptTrieOpts): MergeRecord {
  return coreUpdateConceptTrie(opts);
}

export async function updateConceptTrieAsync(opts: UpdateConceptTrieOpts): Promise<MergeRecord> {
  return coreUpdateConceptTrieAsync({
    ...opts,
    sanitizeRecord: sanitizeSessionRecord,
  });
}
