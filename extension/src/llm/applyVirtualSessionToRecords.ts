import { normalizeConceptKey } from "./enrichNodeChildrenFromOutline";
import { resolveConceptPathWithEquivalences } from "./resolveConceptPathWithEquivalences";
import type { ConceptOntologyNode, SegmentEquivalence, SessionAnalysis } from "./types";
import { segmentKeyForMerge } from "./topicGraphValidate";
import type { SessionRecord } from "../store/storeTypes";

function buildCanonicalPathsFromNodes(
  nodes: ConceptOntologyNode[]
): Map<string, string[]> {
  const byKey = new Map<string, ConceptOntologyNode>();
  for (const node of nodes) {
    const k = normalizeConceptKey(node.key);
    if (k) {
      byKey.set(k, node);
    }
  }

  const paths = new Map<string, string[]>();
  for (const node of nodes) {
    const start = normalizeConceptKey(node.key);
    if (!start) {
      continue;
    }
    const path: string[] = [];
    const visited = new Set<string>();
    let current = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      path.unshift(current);
      const n = byKey.get(current);
      const parent = n?.parentKeys?.[0]
        ? normalizeConceptKey(n.parentKeys[0])
        : "";
      if (!parent || parent === current) {
        break;
      }
      current = parent;
    }
    paths.set(start, path);
  }
  return paths;
}

/** Snap one conceptPath onto the virtual session node hierarchy. */
export function snapConceptPathToVirtualSession(
  path: string[],
  virtual: SessionAnalysis,
  equivalences: SegmentEquivalence[] | undefined
): string[] {
  if (!path.length) {
    return path;
  }
  const ctx = { title: path[path.length - 1] ?? "" };
  const resolved = resolveConceptPathWithEquivalences(
    path,
    equivalences ?? virtual.segmentEquivalences,
    ctx
  );
  const virtualPaths = buildCanonicalPathsFromNodes(virtual.nodes ?? []);

  for (let start = 0; start < resolved.length; start++) {
    const key = segmentKeyForMerge(resolved[start] ?? "");
    const canonical = virtualPaths.get(key);
    if (canonical?.length) {
      const suffix = resolved.slice(start + 1);
      return suffix.length ? [...canonical, ...suffix] : [...canonical];
    }
  }
  return resolved;
}

/** Remap real session topic conceptPaths to the M-merge virtual session tree. */
export function snapRecordsToVirtualSession(
  records: SessionRecord[],
  virtual: SessionAnalysis,
  equivalences?: SegmentEquivalence[]
): SessionRecord[] {
  const eq = equivalences ?? virtual.segmentEquivalences;
  return records.map((record) => {
    const topics = record.graph.topics.map((topic) => {
      if (!topic.conceptPath?.length) {
        return topic;
      }
      return {
        ...topic,
        conceptPath: snapConceptPathToVirtualSession(
          topic.conceptPath,
          virtual,
          eq
        ),
      };
    });
    return {
      ...record,
      graph: { topics },
      outline: {
        ...record.outline,
        outline: record.outline.outline,
      },
    };
  });
}
