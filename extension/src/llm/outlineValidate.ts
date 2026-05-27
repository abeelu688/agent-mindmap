import { parseConceptPath } from "./topicGraphValidate";
import { LlmProviderError } from "./types";
import type {
  MergedOutline,
  MergedOutlineDetail,
  MergedOutlineNode,
  OutlineDetail,
  OutlineNode,
  SessionOutline,
} from "./types";

const MAX_ROOT_TITLE = 80;
const MAX_ROOT_SUMMARY = 120;
const MAX_NODE_TITLE = 80;
const MAX_NODE_SUMMARY = 120;
const MAX_DETAIL_TEXT = 80;
const MAX_DEPTH = 4;
const MAX_CHILDREN_PER_NODE = 12;
const MAX_DETAILS_PER_NODE = 16;

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

function parseSourceTurnIndices(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value
    .filter(
      (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
    )
    .slice(0, 16);
  return out.length ? out : undefined;
}

function parseOutlineDetail(value: unknown): OutlineDetail | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) {
    return undefined;
  }
  const clipped =
    text.length > MAX_DETAIL_TEXT ? text.slice(0, MAX_DETAIL_TEXT - 3) + "..." : text;
  return {
    text: clipped,
    sourceTurnIndices: parseSourceTurnIndices(obj.sourceTurnIndices),
  };
}

function parseOutlineNode(value: unknown, depth: number): OutlineNode | undefined {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) {
    return undefined;
  }
  const clippedTitle =
    title.length > MAX_NODE_TITLE ? title.slice(0, MAX_NODE_TITLE - 3) + "..." : title;
  const summary = pickString(obj, "summary", MAX_NODE_SUMMARY);
  const conceptPath = parseConceptPath(obj.conceptPath);

  const childrenRaw = Array.isArray(obj.children) ? obj.children : [];
  const children: OutlineNode[] = [];
  for (const c of childrenRaw) {
    const child = parseOutlineNode(c, depth + 1);
    if (child) {
      children.push(child);
    }
    if (children.length >= MAX_CHILDREN_PER_NODE) {
      break;
    }
  }

  const detailsRaw = Array.isArray(obj.details) ? obj.details : [];
  const details: OutlineDetail[] = [];
  for (const d of detailsRaw) {
    const detail = parseOutlineDetail(d);
    if (detail) {
      details.push(detail);
    }
    if (details.length >= MAX_DETAILS_PER_NODE) {
      break;
    }
  }

  // Interior nodes must not carry details when they have children.
  const normalizedDetails =
    children.length > 0 ? undefined : details.length ? details : undefined;
  const normalizedChildren = children.length ? children : undefined;

  if (!normalizedChildren && !normalizedDetails) {
    return undefined;
  }

  return {
    title: clippedTitle,
    summary,
    conceptPath,
    children: normalizedChildren,
    details: normalizedDetails,
  };
}

export function validateSessionOutline(value: unknown): SessionOutline {
  if (!value || typeof value !== "object") {
    throw new LlmProviderError("bad-shape", "Expected object with outline[]");
  }
  const root = value as Record<string, unknown>;
  const outlineRaw = root.outline;
  if (!Array.isArray(outlineRaw)) {
    throw new LlmProviderError("bad-shape", "Missing or non-array `outline`");
  }
  const outline: OutlineNode[] = [];
  for (const node of outlineRaw) {
    const parsed = parseOutlineNode(node, 1);
    if (parsed) {
      outline.push(parsed);
    }
    if (outline.length >= MAX_CHILDREN_PER_NODE) {
      break;
    }
  }
  if (!outline.length) {
    throw new LlmProviderError("bad-shape", "No usable outline nodes returned");
  }
  return {
    title: pickString(root, "title", MAX_ROOT_TITLE),
    summary: pickString(root, "summary", MAX_ROOT_SUMMARY),
    outline,
  };
}

function parseMergedDetail(value: unknown): MergedOutlineDetail | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) {
    return undefined;
  }
  const clipped =
    text.length > MAX_DETAIL_TEXT ? text.slice(0, MAX_DETAIL_TEXT - 3) + "..." : text;
  const sourcesRaw = Array.isArray(obj.sources) ? obj.sources : [];
  const sources: MergedOutlineDetail["sources"] = [];
  for (const s of sourcesRaw) {
    if (!s || typeof s !== "object") {
      continue;
    }
    const so = s as Record<string, unknown>;
    if (typeof so.sessionIndex !== "number" || !Number.isInteger(so.sessionIndex)) {
      continue;
    }
    if (so.sessionIndex < 0) {
      continue;
    }
    const turnIndex =
      typeof so.turnIndex === "number" &&
      Number.isInteger(so.turnIndex) &&
      so.turnIndex >= 0
        ? so.turnIndex
        : undefined;
    sources.push({ sessionIndex: so.sessionIndex, turnIndex });
    if (sources.length >= 16) {
      break;
    }
  }
  return {
    text: clipped,
    sources: sources.length ? sources : undefined,
  };
}

function parseMergedOutlineNode(
  value: unknown,
  depth: number
): MergedOutlineNode | undefined {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) {
    return undefined;
  }
  const clippedTitle =
    title.length > MAX_NODE_TITLE ? title.slice(0, MAX_NODE_TITLE - 3) + "..." : title;
  const summary = pickString(obj, "summary", MAX_NODE_SUMMARY);

  const childrenRaw = Array.isArray(obj.children) ? obj.children : [];
  const children: MergedOutlineNode[] = [];
  for (const c of childrenRaw) {
    const child = parseMergedOutlineNode(c, depth + 1);
    if (child) {
      children.push(child);
    }
    if (children.length >= MAX_CHILDREN_PER_NODE) {
      break;
    }
  }

  const detailsRaw = Array.isArray(obj.details) ? obj.details : [];
  const details: MergedOutlineDetail[] = [];
  for (const d of detailsRaw) {
    const detail = parseMergedDetail(d);
    if (detail) {
      details.push(detail);
    }
    if (details.length >= MAX_DETAILS_PER_NODE) {
      break;
    }
  }

  const normalizedDetails =
    children.length > 0 ? undefined : details.length ? details : undefined;
  const normalizedChildren = children.length ? children : undefined;

  if (!normalizedChildren && !normalizedDetails) {
    return undefined;
  }

  return {
    title: clippedTitle,
    summary,
    children: normalizedChildren,
    details: normalizedDetails,
  };
}

export function validateMergedOutline(value: unknown): MergedOutline {
  if (!value || typeof value !== "object") {
    throw new LlmProviderError("bad-shape", "Expected object with outline[]");
  }
  const root = value as Record<string, unknown>;
  const outlineRaw = root.outline;
  if (!Array.isArray(outlineRaw)) {
    throw new LlmProviderError("bad-shape", "Missing or non-array `outline`");
  }
  const outline: MergedOutlineNode[] = [];
  for (const node of outlineRaw) {
    const parsed = parseMergedOutlineNode(node, 1);
    if (parsed) {
      outline.push(parsed);
    }
    if (outline.length >= MAX_CHILDREN_PER_NODE) {
      break;
    }
  }
  if (!outline.length) {
    throw new LlmProviderError("bad-shape", "No usable merged outline nodes returned");
  }
  return {
    title: pickString(root, "title", MAX_ROOT_TITLE),
    summary: pickString(root, "summary", MAX_ROOT_SUMMARY),
    outline,
  };
}

export const __testing = { parseOutlineNode, parseMergedOutlineNode };
