import { canonicalizeConceptSegment } from "./topicGraphValidate";

export const MAX_CONCEPT_PATH_SEGMENTS = 6;

type PathEntry = { key: string; label: string };

/**
 * Deterministic conceptPath cleanup so cross-session trie merges align.
 * - Folds android → runtime → art to android → art
 * - Treats AOSP as an alias of the android domain (not a sibling branch)
 * - Inserts art before jni when jni hangs directly under android
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

  // AOSP is a source tree / distribution label, not a parallel domain next to android.
  const domainAligned: PathEntry[] = [];
  for (const entry of entries) {
    if (entry.key === "aosp") {
      if (
        !domainAligned.length ||
        domainAligned[domainAligned.length - 1].key !== "android"
      ) {
        domainAligned.push({ key: "android", label: "android" });
      }
      continue;
    }
    domainAligned.push(entry);
  }

  const folded: PathEntry[] = [];
  for (let i = 0; i < domainAligned.length; i++) {
    const { key, label } = domainAligned[i];
    if (
      key === "runtime" &&
      i > 0 &&
      domainAligned[i - 1].key === "android" &&
      i + 1 < domainAligned.length &&
      domainAligned[i + 1].key === "art"
    ) {
      continue;
    }
    folded.push({ key, label });
  }

  const withArtForJni: PathEntry[] = [];
  for (const entry of folded) {
    if (
      entry.key === "jni" &&
      withArtForJni.length &&
      withArtForJni[withArtForJni.length - 1].key === "android"
    ) {
      withArtForJni.push({ key: "art", label: "art" });
    }
    withArtForJni.push(entry);
  }

  const deduped: PathEntry[] = [];
  for (const entry of withArtForJni) {
    if (deduped.length && deduped[deduped.length - 1].key === entry.key) {
      continue;
    }
    deduped.push(entry);
  }

  return deduped.slice(0, MAX_CONCEPT_PATH_SEGMENTS).map((e) => e.label);
}
