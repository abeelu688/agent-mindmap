import type { OutputLanguage } from "./promptLanguage";
import type { SessionRecord } from "../store/storeTypes";

export type OutputLanguageFromRecordsOptions = {
  /** When omitted, falls back to `"English"`. Pass `undefined` explicitly for no default. */
  defaultLanguage?: OutputLanguage;
};

/**
 * Pick the dominant session output language by vote count; ties break toward the latest session.
 */
export function outputLanguageFromRecords(
  records: SessionRecord[],
  options?: OutputLanguageFromRecordsOptions
): OutputLanguage | undefined {
  const votes = new Map<string, { count: number; latestIndex: number }>();
  records.forEach((record, index) => {
    const language = record.meta.outputLanguage;
    if (!language) {
      return;
    }
    const current = votes.get(language) ?? { count: 0, latestIndex: -1 };
    votes.set(language, { count: current.count + 1, latestIndex: index });
  });
  const ranked = [...votes.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].latestIndex - a[1].latestIndex
  );
  const winner = ranked[0]?.[0];
  if (winner) {
    return winner;
  }
  if (options && "defaultLanguage" in options) {
    return options.defaultLanguage;
  }
  return "English";
}
