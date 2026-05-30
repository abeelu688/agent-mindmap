import type { ConceptOntologyRecord } from "../../store/ontologyTypes";
import type { SessionRecord } from "../../store/storeTypes";
import type {
  ConceptOntologyMapping,
  ConceptOntologyNode,
  TopicPathDecision,
} from "../../llm/types";
import { buildTopicContextIndex } from "../../llm/segmentContext";
import type { TopicConceptPathDecision } from "../../store/ontologyTypes";

export type CollectedMergeTerms = {
  nodes: ConceptOntologyNode[];
  mappings: ConceptOntologyMapping[];
  topicPaths: TopicConceptPathDecision[];
  contextIndex: ReturnType<typeof buildTopicContextIndex>;
};

function mergeNodes(
  target: Map<string, ConceptOntologyNode>,
  incoming: ConceptOntologyNode[]
): void {
  for (const node of incoming) {
    const existing = target.get(node.key);
    if (!existing) {
      target.set(node.key, { ...node });
      continue;
    }
    const aliasSet = new Set([
      ...(existing.aliases ?? []).map((a) => a.toLowerCase()),
      ...(node.aliases ?? []).map((a) => a.toLowerCase()),
    ]);
    const parentSet = new Set([
      ...(existing.parentKeys ?? []),
      ...(node.parentKeys ?? []),
    ]);
    const evidenceSet = new Set([
      ...(existing.evidence ?? []),
      ...(node.evidence ?? []),
    ]);
    target.set(node.key, {
      ...existing,
      label: existing.label || node.label,
      aliases: aliasSet.size ? Array.from(aliasSet) : undefined,
      parentKeys: parentSet.size ? Array.from(parentSet) : undefined,
      evidence: evidenceSet.size ? Array.from(evidenceSet) : undefined,
    });
  }
}

function treeDecisionToOntology(
  tp: TopicPathDecision,
  record: SessionRecord
): TopicConceptPathDecision {
  return {
    topicId: tp.topicId,
    sessionId: tp.sessionId,
    projectSlug: tp.projectSlug,
    conceptPath: tp.conceptPath,
    evidence: tp.evidence,
  };
}

/**
 * M1 DET: aggregate terms with context from session records (+ optional global base).
 */
export function collectMergeTerms(
  records: SessionRecord[],
  baseOntology?: ConceptOntologyRecord
): CollectedMergeTerms {
  const nodesMap = new Map<string, ConceptOntologyNode>();
  const mappings: ConceptOntologyMapping[] = [];
  const mappingSeen = new Set<string>();
  const topicPaths: TopicConceptPathDecision[] = [];
  const topicPathSeen = new Set<string>();

  if (baseOntology) {
    mergeNodes(nodesMap, baseOntology.nodes);
    for (const m of baseOntology.mappings) {
      const mk = `${m.mention.toLowerCase()}\0${m.key}`;
      if (!mappingSeen.has(mk)) {
        mappingSeen.add(mk);
        mappings.push(m);
      }
    }
    for (const tp of baseOntology.topicPaths) {
      const pk = `${tp.sessionId}:${tp.topicId}`;
      if (!topicPathSeen.has(pk)) {
        topicPathSeen.add(pk);
        topicPaths.push(tp);
      }
    }
  }

  for (const record of records) {
    if (record.treeSnapshot) {
      mergeNodes(nodesMap, record.treeSnapshot.nodes);
      for (const m of record.treeSnapshot.mappings) {
        const mk = `${m.mention.toLowerCase()}\0${m.key}`;
        if (!mappingSeen.has(mk)) {
          mappingSeen.add(mk);
          mappings.push(m);
        }
      }
      for (const tp of record.treeSnapshot.topicPathDecisions) {
        const pk = `${tp.sessionId}:${tp.topicId}`;
        if (!topicPathSeen.has(pk)) {
          topicPathSeen.add(pk);
          topicPaths.push(treeDecisionToOntology(tp, record));
        }
      }
    } else if (record.conceptExtract) {
      const snapshot = {
        nodes: record.conceptExtract.terms.map((t) => ({
          key: t.key,
          label: t.label,
          aliases: t.mentions.filter((m) => m.toLowerCase() !== t.key),
          parentKeys: t.suggestedParentKey ? [t.suggestedParentKey] : undefined,
          evidence: t.evidence,
        })),
        mappings: record.conceptExtract.terms.flatMap((t) =>
          t.mentions.map((mention) => ({ mention, key: t.key }))
        ),
        topicPathDecisions: record.conceptExtract.terms.map((t) => ({
          topicId: `term:${t.key}`,
          sessionId: record.meta.sessionId,
          projectSlug: record.meta.projectSlug,
          conceptPath: [
            ...(record.conceptExtract!.domains[0]
              ? [record.conceptExtract!.domains[0].toLowerCase()]
              : []),
            t.key.toLowerCase(),
          ],
          evidence: t.evidence,
        })),
      };
      mergeNodes(nodesMap, snapshot.nodes);
      for (const m of snapshot.mappings) {
        const mk = `${m.mention.toLowerCase()}\0${m.key}`;
        if (!mappingSeen.has(mk)) {
          mappingSeen.add(mk);
          mappings.push(m);
        }
      }
      for (const tp of snapshot.topicPathDecisions) {
        const pk = `${tp.sessionId}:${tp.topicId}`;
        if (!topicPathSeen.has(pk)) {
          topicPathSeen.add(pk);
          topicPaths.push(treeDecisionToOntology(tp, record));
        }
      }
    }

    for (const topic of record.graph.topics) {
      if (!topic.conceptPath?.length) {
        continue;
      }
      const topicId = `${record.meta.sessionId}:${topic.title}`;
      const pk = `${record.meta.sessionId}:${topicId}`;
      if (topicPathSeen.has(pk)) {
        continue;
      }
      topicPathSeen.add(pk);
      topicPaths.push({
        topicId,
        sessionId: record.meta.sessionId,
        projectSlug: record.meta.projectSlug,
        conceptPath: topic.conceptPath,
        evidence: topic.items.map((i) => i.text).slice(0, 6),
      });
    }
  }

  for (const domain of records.flatMap((r) => r.conceptExtract?.domains ?? [])) {
    const key = domain.toLowerCase();
    if (!nodesMap.has(key)) {
      nodesMap.set(key, { key, label: domain, parentKeys: [] });
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    mappings,
    topicPaths,
    contextIndex: buildTopicContextIndex(records),
  };
}
