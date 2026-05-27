import * as fs from "fs/promises";
import { getHostById } from "../host/registry";
import {
  countUserQueries,
  sanitizeTopicGraph,
} from "../llm/sanitizeTopicGraph";
import type { SessionRecord } from "./storeTypes";

export async function resolveUserQueryCount(
  record: SessionRecord
): Promise<number> {
  if (record.meta.userQueryCount !== undefined) {
    return record.meta.userQueryCount;
  }
  try {
    const content = await fs.readFile(record.meta.transcriptPath, "utf8");
    const host = getHostById(record.meta.hostId ?? "cursor");
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
  const graph = sanitizeTopicGraph(record.graph, userQueryCount);
  if (
    graph === record.graph &&
    record.meta.userQueryCount === userQueryCount
  ) {
    return record;
  }
  return {
    ...record,
    meta: { ...record.meta, userQueryCount },
    graph,
  };
}

export async function sanitizeRecordsForMerge(
  records: SessionRecord[]
): Promise<SessionRecord[]> {
  return Promise.all(records.map((r) => sanitizeSessionRecord(r)));
}
