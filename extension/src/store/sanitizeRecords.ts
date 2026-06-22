/**
 * Extension-local adapter for `sanitizeRecords` from core.
 *
 * Injects the active host's `parseTranscript` method as the callback
 * so core remains VS Code-free.
 */
import {
  sanitizeSessionRecord as coreSanitize,
  sanitizeRecordsForMerge as coreSanitizeAll,
  resolveUserQueryCount as coreResolveUserQueryCount,
  type TranscriptParser,
} from "@agent-mindmap/core";
import { getActiveHost } from "../host";
import type { SessionRecord } from "./storeTypes";

export type { TranscriptParser } from "@agent-mindmap/core";

function parserForHost(record: SessionRecord): TranscriptParser {
  const host = getActiveHost(record.meta.hostId);
  return (content: string) => host.parseTranscript(content);
}

export async function resolveUserQueryCount(record: SessionRecord): Promise<number> {
  return coreResolveUserQueryCount(record, parserForHost(record));
}

export async function sanitizeSessionRecord(record: SessionRecord): Promise<SessionRecord> {
  return coreSanitize(record, parserForHost(record));
}

export async function sanitizeRecordsForMerge(records: SessionRecord[]): Promise<SessionRecord[]> {
  return Promise.all(records.map((r) => coreSanitize(r, parserForHost(r))));
}
