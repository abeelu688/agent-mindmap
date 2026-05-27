import * as fs from "fs/promises";
import { claudeHost } from "../host/claudeHost";
import { cursorHost } from "../host/cursorHost";
import type { AgentHostId } from "../host/types";
import {
  countUserQueries,
  sanitizeTopicGraph,
} from "../llm/sanitizeTopicGraph";
import { sanitizeSessionOutline } from "../llm/sanitizeOutline";
import { outlineToTopicGraph } from "../llm/outlineToTopicGraph";
import type { SessionRecord } from "./storeTypes";

function hostFor(id?: AgentHostId) {
  return id === "claude-code" ? claudeHost : cursorHost;
}

export async function resolveUserQueryCount(
  record: SessionRecord
): Promise<number> {
  if (record.meta.userQueryCount !== undefined) {
    return record.meta.userQueryCount;
  }
  try {
    const content = await fs.readFile(record.meta.transcriptPath, "utf8");
    const host = hostFor(record.meta.hostId);
    const events = host.parseTranscript(content);
    return countUserQueries(events);
  } catch {
    return 0;
  }
}

export async function sanitizeSessionRecord(
  record: SessionRecord
): Promise<SessionRecord> {
  const userQueryCount = await resolveUserQueryCount(record);
  const outline = sanitizeSessionOutline(record.outline, userQueryCount);
  const graph = sanitizeTopicGraph(
    outlineToTopicGraph(outline),
    userQueryCount
  );
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
  records: SessionRecord[]
): Promise<SessionRecord[]> {
  return Promise.all(records.map((r) => sanitizeSessionRecord(r)));
}
