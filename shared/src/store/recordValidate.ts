import {
  outlineToTopicGraph,
  topicGraphToOutline,
  validateSessionOutline,
  validateTopicGraph,
} from "../llmValidate";
import type { SessionRecord } from "../storeTypes";

const SCHEMA_VERSION = 1;

/**
 * Validate a raw JSON-parsed record and backfill the derived `graph` /
 * `outline` pair so callers always see a consistent shape.
 *
 * Mirrors the extension's `sessionStore.ts` `readRecord` behavior:
 *   - reject non-schemaVersion / missing meta identity fields
 *   - accept either `outline` (preferred) or `graph` (legacy v4)
 *   - if only `outline`: validate it; backfill `graph` via `outlineToTopicGraph`
 *   - if only `graph`: validate it; backfill `outline` via `topicGraphToOutline`
 *   - if both: validate both, keep as-is
 *
 * Returns `undefined` if the record is corrupt or fails validation. Callers
 * (the MCP server, the extension's read path) treat that as "no record".
 */
export function validateAndBackfillRecord(parsed: unknown): SessionRecord | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const r = parsed as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) {
    return undefined;
  }
  if (!r.meta || typeof r.meta !== "object") {
    return undefined;
  }
  const meta = r.meta as Record<string, unknown>;
  if (typeof meta.sessionId !== "string" || typeof meta.projectSlug !== "string") {
    return undefined;
  }
  if (!r.outline && !r.graph) {
    return undefined;
  }

  const raw = parsed as SessionRecord;
  try {
    if (raw.outline) {
      raw.outline = validateSessionOutline(raw.outline);
      raw.graph = raw.graph ? validateTopicGraph(raw.graph) : outlineToTopicGraph(raw.outline);
    } else if (raw.graph) {
      raw.graph = validateTopicGraph(raw.graph);
      raw.outline = topicGraphToOutline(raw.graph);
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return raw;
}

/** Structural check used before reading meta identity fields. */
export function looksLikeSessionRecord(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  const r = parsed as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) {
    return false;
  }
  if (!r.meta || typeof r.meta !== "object") {
    return false;
  }
  const meta = r.meta as Record<string, unknown>;
  if (typeof meta.sessionId !== "string" || typeof meta.projectSlug !== "string") {
    return false;
  }
  if (!r.outline && !r.graph) {
    return false;
  }
  return true;
}
