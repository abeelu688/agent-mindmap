import { normalizeConceptPath } from "./normalizeConceptPath";
import { LlmProviderError, type TopicGraph } from "./types";

const MAX_ROOT_TITLE = 80;
const MAX_ROOT_SUMMARY = 120;
const MAX_CONCEPT_PATH_SEGMENTS = 6;
const MAX_CONCEPT_SEGMENT_LEN = 24;

function parseConceptPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }
    const truncated =
      trimmed.length > MAX_CONCEPT_SEGMENT_LEN
        ? trimmed.slice(0, MAX_CONCEPT_SEGMENT_LEN - 3) + "..."
        : trimmed;
    const key = truncated.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(truncated);
    if (out.length >= MAX_CONCEPT_PATH_SEGMENTS) {
      break;
    }
  }
  return out.length ? normalizeConceptPath(out) : undefined;
}

export function canonicalizeConceptSegment(segment: string): string {
  return segment.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
  maxLen: number
): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const trimmed = v.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 3) + "..." : trimmed;
}

export function validateTopicGraph(value: unknown): TopicGraph {
  if (!value || typeof value !== "object") {
    throw new LlmProviderError("bad-shape", "Expected object with topics[]");
  }
  const root = value as Record<string, unknown>;
  const topics = root.topics;
  if (!Array.isArray(topics)) {
    throw new LlmProviderError("bad-shape", "Missing or non-array `topics`");
  }
  const result: TopicGraph = {
    title: pickString(root, "title", MAX_ROOT_TITLE),
    summary: pickString(root, "summary", MAX_ROOT_SUMMARY),
    topics: [],
  };
  for (const t of topics) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const obj = t as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) {
      continue;
    }
    const summary =
      typeof obj.summary === "string" ? obj.summary.trim() || undefined : undefined;
    const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
    const items = [] as TopicGraph["topics"][number]["items"];
    for (const it of itemsRaw) {
      if (!it || typeof it !== "object") {
        continue;
      }
      const text =
        typeof (it as Record<string, unknown>).text === "string"
          ? ((it as Record<string, unknown>).text as string).trim()
          : "";
      if (!text) {
        continue;
      }
      const sourceTurnIndicesRaw = (it as Record<string, unknown>)
        .sourceTurnIndices;
      let sourceTurnIndices: number[] | undefined;
      if (Array.isArray(sourceTurnIndicesRaw)) {
        sourceTurnIndices = sourceTurnIndicesRaw
          .filter(
            (n): n is number =>
              typeof n === "number" && Number.isInteger(n) && n >= 0
          )
          .slice(0, 16);
        if (!sourceTurnIndices.length) {
          sourceTurnIndices = undefined;
        }
      }
      items.push({ text, sourceTurnIndices });
    }
    if (!items.length) {
      continue;
    }
    const conceptPath = parseConceptPath(obj.conceptPath);
    result.topics.push({ title, summary, conceptPath, items });
  }
  if (!result.topics.length) {
    throw new LlmProviderError("bad-shape", "No usable topics returned");
  }
  return result;
}

export const __testing = { parseConceptPath };
