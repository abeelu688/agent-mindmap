/**
 * Extension-local adapter for `mergeDeterministic` from core.
 *
 * Re-exports the core function. The `buildDeterministicMergeRecordAsync`
 * adapter injects the extension's `sanitizeSessionRecord` (which uses
 * host-specific transcript parsing) as the sanitize callback.
 */
import {
  buildDeterministicMergeRecord as coreBuildDeterministicMergeRecord,
  type DeterministicMergeOptions,
} from "@agent-mindmap/core";
import { sanitizeSessionRecord } from "./sanitizeRecords";
import type { MergeRecord, SessionRecord } from "./storeTypes";

export {
  buildDeterministicMergeMindMap,
  type DeterministicMergeOptions,
} from "@agent-mindmap/core";

export async function buildDeterministicMergeRecordAsync(
  records: SessionRecord[],
  options: DeterministicMergeOptions = {}
): Promise<MergeRecord> {
  const sanitized = await Promise.all(records.map((r) => sanitizeSessionRecord(r)));
  return coreBuildDeterministicMergeRecord(sanitized, options);
}

export function buildDeterministicMergeRecord(
  records: SessionRecord[],
  options: DeterministicMergeOptions = {}
): MergeRecord {
  return coreBuildDeterministicMergeRecord(records, options);
}
