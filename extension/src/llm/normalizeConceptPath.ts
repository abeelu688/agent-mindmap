import { segmentKeyForMerge } from "./topicGraphValidate";

export const MAX_CONCEPT_PATH_SEGMENTS = 6;

type PathEntry = { key: string; label: string };

/**
 * Deterministic conceptPath cleanup so cross-session trie merges align.
 * - Folds android → runtime → art to android → art
 * - Treats AOSP as an alias of the android domain (not a sibling branch)
 * - Folds mobile → android when mobile is the first segment
 * - Under android: maps androidruntime (incl. hyphen/underscore variants) → art
 * - Inserts art before jni when jni hangs directly under android
 * - Drops consecutive duplicate segments (case-insensitive)
 */
function mapAndroidChildSegment(key: string): string | undefined {
  if (key === "androidruntime") {
    return "art";
  }
  return undefined;
}

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

  // AOSP / mobile are distribution labels, not parallel domains next to android.
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
    if (entry.key === "mobile" && !domainAligned.length) {
      domainAligned.push({ key: "android", label: "android" });
      continue;
    }
    domainAligned.push(entry);
  }

  const afterAndroid: PathEntry[] = [];
  for (let i = 0; i < domainAligned.length; i++) {
    const entry = domainAligned[i];
    if (i > 0 && domainAligned[i - 1].key === "android") {
      const mapped = mapAndroidChildSegment(entry.key);
      if (mapped) {
        afterAndroid.push({ key: mapped, label: mapped });
        continue;
      }
    }
    afterAndroid.push(entry);
  }

  const folded: PathEntry[] = [];
  for (let i = 0; i < afterAndroid.length; i++) {
    const { key, label } = afterAndroid[i];
    if (
      key === "runtime" &&
      i > 0 &&
      afterAndroid[i - 1].key === "android" &&
      i + 1 < afterAndroid.length &&
      afterAndroid[i + 1].key === "art"
    ) {
      continue;
    }
    // Redundant child label when art already names the runtime domain.
    if (key === "runtime" && i > 0 && afterAndroid[i - 1].key === "art") {
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
