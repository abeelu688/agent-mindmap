import { resolveConceptPathWithEquivalences } from "@agent-mindmap/core";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES } from "@agent-mindmap/core";
import { topicIdForTopic } from "@agent-mindmap/core";
import type { ConceptOntologyRecord } from "./ontologyTypes";
import type { SessionRecord } from "./storeTypes";

export type ApplyTopicPathsOpts = {
  applyEquivalences?: boolean;
};

export function applyTopicPathsFromOntology(
  records: SessionRecord[],
  ontology: ConceptOntologyRecord,
  opts?: ApplyTopicPathsOpts
): SessionRecord[] {
  const applyEquivalences = opts?.applyEquivalences ?? MERGE_APPLY_SEGMENT_EQUIVALENCES;
  const byKey = new Map<string, string[]>();
  for (const d of ontology.topicPaths) {
    const k = `${d.sessionId}:${d.topicId}`;
    byKey.set(k, d.conceptPath);
  }

  return records.map((r) => {
    let changed = false;
    const nextTopics = r.graph.topics.map((t) => {
      const tid = topicIdForTopic(r.meta.sessionId, t);
      const path = byKey.get(`${r.meta.sessionId}:${tid}`);
      if (!path?.length) {
        return t;
      }
      const same =
        t.conceptPath?.length === path.length && t.conceptPath.every((seg, i) => seg === path[i]);
      if (same) {
        return t;
      }
      changed = true;
      return {
        ...t,
        conceptPath: applyEquivalences
          ? resolveConceptPathWithEquivalences(path, ontology.segmentEquivalences, {
              title: t.title,
              items: t.items?.map((i) => i.text),
              projectSlug: r.meta.projectSlug,
            })
          : path,
      };
    });
    if (!changed) {
      return r;
    }
    return { ...r, graph: { ...r.graph, topics: nextTopics } };
  });
}
