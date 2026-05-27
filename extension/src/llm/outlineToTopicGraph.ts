import { normalizeConceptPath } from "./normalizeConceptPath";
import type { OutlineNode, SessionOutline, Topic, TopicGraph } from "./types";

const MAX_TOPICS = 24;

/**
 * When the LLM omits conceptPath (v5 outline prompt), derive it from the
 * outline branch titles so concept-trie merge can cluster across sessions.
 * Single-segment paths stay undefined so legacy flat topics remain 未分类.
 */
function deriveConceptPathFromOutlinePath(path: string[]): string[] | undefined {
  if (path.length < 2) {
    return undefined;
  }
  const segments = path
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  return segments.length >= 2 ? normalizeConceptPath(segments) : undefined;
}

function collectTopicsFromNode(
  node: OutlineNode,
  path: string[],
  out: Topic[]
): void {
  const nextPath = [...path, node.title];
  if (node.details?.length) {
    const title = nextPath.join(" / ");
    const conceptPath =
      node.conceptPath?.length
        ? node.conceptPath
        : deriveConceptPathFromOutlinePath(nextPath);
    out.push({
      title: title.length > 80 ? title.slice(0, 77) + "..." : title,
      summary: node.summary,
      conceptPath,
      items: node.details.map((d) => ({
        text: d.text,
        sourceTurnIndices: d.sourceTurnIndices,
      })),
    });
    return;
  }
  for (const child of node.children ?? []) {
    collectTopicsFromNode(child, nextPath, out);
  }
}

/**
 * Flatten a hierarchical outline into the legacy TopicGraph shape so
 * deterministic / concept-trie merges keep working without a full rewrite.
 */
export function outlineToTopicGraph(outline: SessionOutline): TopicGraph {
  const topics: Topic[] = [];
  for (const node of outline.outline) {
    collectTopicsFromNode(node, [], topics);
    if (topics.length >= MAX_TOPICS) {
      break;
    }
  }
  return {
    title: outline.title,
    summary: outline.summary,
    topics: topics.length ? topics : [{ title: outline.title ?? "会话", items: [{ text: "（无细节）" }] }],
  };
}

/** Convert legacy TopicGraph (v4 and earlier) into SessionOutline. */
export function topicGraphToOutline(graph: TopicGraph): SessionOutline {
  return {
    title: graph.title,
    summary: graph.summary,
    outline: graph.topics.map((t) => ({
      title: t.title,
      summary: t.summary,
      conceptPath: t.conceptPath,
      details: t.items.map((item) => ({
        text: item.text,
        sourceTurnIndices: item.sourceTurnIndices,
      })),
    })),
  };
}

export function countOutlineDetails(outline: SessionOutline): number {
  let count = 0;
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      count += n.details?.length ?? 0;
      if (n.children?.length) {
        walk(n.children);
      }
    }
  };
  walk(outline.outline);
  return count;
}
