import { resolveConceptPathWithEquivalences } from "./resolveConceptPathWithEquivalences";
import type { SegmentEquivalence } from "./types";
import type { SessionRecord } from "../store/storeTypes";

/** Apply M2 ontology segmentEquivalences to topic paths (domain-agnostic). */
export function applySegmentEquivalencesToRecords(
  records: SessionRecord[],
  equivalences: SegmentEquivalence[] | undefined
): SessionRecord[] {
  if (!equivalences?.length) {
    return records;
  }

  return records.map((record) => {
    let changed = false;
    const topics = record.graph.topics.map((topic) => {
      if (!topic.conceptPath?.length) {
        return topic;
      }
      const ctx = {
        title: topic.title,
        summary: topic.summary,
        items: topic.items?.map((i) => i.text),
        projectSlug: record.meta.projectSlug,
      };
      const next = resolveConceptPathWithEquivalences(
        topic.conceptPath,
        equivalences,
        ctx
      );
      const prev = topic.conceptPath;
      if (
        next.length === prev.length &&
        next.every((s, i) => s === prev[i])
      ) {
        return topic;
      }
      changed = true;
      return { ...topic, conceptPath: next };
    });
    if (!changed) {
      return record;
    }
    return { ...record, graph: { ...record.graph, topics } };
  });
}
