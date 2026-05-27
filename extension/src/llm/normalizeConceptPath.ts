import { canonicalizeConceptSegment } from "./topicGraphValidate";

export const MAX_CONCEPT_PATH_SEGMENTS = 6;

type PathEntry = { key: string; label: string };

/**
 * Deterministic conceptPath cleanup so cross-session trie merges align.
 * - Folds android → runtime → art to android → art
 * - Drops consecutive duplicate segments (case-insensitive)
 */
export function normalizeConceptPath(path: string[]): string[] {
  if (!path.length) {
    return [];
  }

  const entries: PathEntry[] = [];
  for (const raw of path) {
    const label = raw.replace(/\s+/g, " ").trim();
    const key = canonicalizeConceptSegment(label);
    if (!key) {
      continue;
    }
    entries.push({ key, label });
  }
  if (!entries.length) {
    return [];
  }

  const folded: PathEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const { key, label } = entries[i];
    if (
      key === "runtime" &&
      i > 0 &&
      entries[i - 1].key === "android" &&
      i + 1 < entries.length &&
      entries[i + 1].key === "art"
    ) {
      continue;
    }
    folded.push({ key, label });
  }

  const deduped: PathEntry[] = [];
  for (const entry of folded) {
    if (deduped.length && deduped[deduped.length - 1].key === entry.key) {
      continue;
    }
    deduped.push(entry);
  }

  return deduped.slice(0, MAX_CONCEPT_PATH_SEGMENTS).map((e) => e.label);
}
