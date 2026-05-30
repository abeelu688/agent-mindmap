import { segmentKeyForMerge } from "./topicGraphValidate";

export const MAX_CONCEPT_PATH_SEGMENTS = 6;

type PathEntry = { key: string; label: string };

/**
 * Domain-agnostic conceptPath cleanup: trim, drop empty segments, consecutive
 * dedupe (via segmentKeyForMerge), and cap length.
 *
 * Domain-specific segment merging belongs in ontology `segmentEquivalences`
 * and {@link resolveConceptPathWithEquivalences}.
 */
export function normalizeConceptPath(path: string[]): string[] {
  if (!path.length) {
    return [];
  }

  const entries: PathEntry[] = [];
  for (const raw of path) {
    const label = raw.replace(/\s+/g, " ").trim();
    const key = segmentKeyForMerge(label);
    if (!key) {
      continue;
    }
    entries.push({ key, label });
  }
  if (!entries.length) {
    return [];
  }

  const deduped: PathEntry[] = [];
  for (const entry of entries) {
    if (deduped.length && deduped[deduped.length - 1].key === entry.key) {
      continue;
    }
    deduped.push(entry);
  }

  return deduped.slice(0, MAX_CONCEPT_PATH_SEGMENTS).map((e) => e.label);
}
