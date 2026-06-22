import * as fs from "fs/promises";
import { countUserQueries, sanitizeTopicGraph } from "../llm/sanitizeTopicGraph";
import { sanitizeSessionOutline } from "../llm/sanitizeOutline";
import { outlineToTopicGraph } from "../llm/outlineToTopicGraph";
import type { ChatEvent } from "../transcript/types";
import type { SessionRecord } from "./storeTypes";

/** Transcript parser callback — decouples core from host-specific parsing. */
export type TranscriptParser = (content: string) => ChatEvent[];

export async function resolveUserQueryCount(
  record: SessionRecord,
  parseTranscript: TranscriptParser
): Promise<number> {
  if (record.meta.userQueryCount !== undefined) {
    return record.meta.userQueryCount;
  }
  try {
    const content = await fs.readFile(record.meta.transcriptPath, "utf8");
    const events = parseTranscript(content);
    return countUserQueries(events);
  } catch {
    return 0;
  }
}

export async function sanitizeSessionRecord(
  record: SessionRecord,
  parseTranscript: TranscriptParser
): Promise<SessionRecord> {
  const userQueryCount = await resolveUserQueryCount(record, parseTranscript);
  const outline = sanitizeSessionOutline(record.outline, userQueryCount);
  const graph = sanitizeTopicGraph(outlineToTopicGraph(outline), userQueryCount);
  if (
    outline === record.outline &&
    graph === record.graph &&
    record.meta.userQueryCount === userQueryCount
  ) {
    return record;
  }
  return {
    ...record,
    meta: { ...record.meta, userQueryCount },
    outline,
    graph,
  };
}

export async function sanitizeRecordsForMerge(
  records: SessionRecord[],
  parseTranscript: TranscriptParser
): Promise<SessionRecord[]> {
  return Promise.all(records.map((r) => sanitizeSessionRecord(r, parseTranscript)));
}
