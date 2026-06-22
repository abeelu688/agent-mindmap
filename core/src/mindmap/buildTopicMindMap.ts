import { leafRefs, type SessionMeta, unionChildRefs, withOrigin } from "./origin";
import { mindMapLabelsForOutputLanguage } from "./outputLanguageLabels";
import type { TopicGraph } from "../llm/types";
import type { MindMapNodeData, MindMapRoot } from "../transcript/types";

const MAX_LABEL = 120;

function truncate(text: string, max = MAX_LABEL): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function leaf(text: string): MindMapNodeData {
  return { data: { text: truncate(text) } };
}

function branch(text: string, children: MindMapNodeData[]): MindMapNodeData {
  return {
    data: { text: truncate(text), expand: true },
    children: children.length ? children : undefined,
  };
}

export function buildTopicMindMap(
  graph: TopicGraph,
  sessionLabel?: string,
  sessionMeta?: SessionMeta,
  outputLanguage?: string
): MindMapRoot {
  const labels = mindMapLabelsForOutputLanguage(outputLanguage);
  const llmTitle = graph.title?.trim();
  const rootText = llmTitle
    ? truncate(llmTitle, 60)
    : sessionLabel
      ? truncate(sessionLabel, 80)
      : labels.sessionDefault;

  const topicNodes: MindMapNodeData[] = graph.topics.map((topic, idx) => {
    const title = `${labels.corePrefix}${idx + 1}: ${truncate(topic.title, 60)}`;
    const children: MindMapNodeData[] = [];

    if (topic.summary && topic.summary.trim()) {
      // The "概述" line summarises the whole topic; carry the topic-level
      // branch ref so it still jumps somewhere when clicked.
      const summaryNode = leaf(`${labels.summaryPrefix}${topic.summary}`);
      children.push(sessionMeta ? withOrigin(summaryNode, [{ ...sessionMeta }]) : summaryNode);
    }

    for (const item of topic.items) {
      const refs = item.sourceTurnIndices?.length
        ? ` (Q${item.sourceTurnIndices.map((n) => n + 1).join("/Q")})`
        : "";
      const itemNode = leaf(`${item.text}${refs}`);
      children.push(
        sessionMeta ? withOrigin(itemNode, leafRefs(sessionMeta, item.sourceTurnIndices)) : itemNode
      );
    }

    if (!children.length) {
      const titleLeaf = leaf(title);
      return sessionMeta ? withOrigin(titleLeaf, [{ ...sessionMeta }]) : titleLeaf;
    }
    const node = branch(title, children);
    return sessionMeta ? withOrigin(node, unionChildRefs(children)) : node;
  });

  const root: MindMapNodeData = {
    data: { text: rootText, expand: true },
    children: topicNodes.length ? topicNodes : undefined,
  };

  if (!sessionMeta || !topicNodes.length) {
    return root;
  }
  return withOrigin(root, unionChildRefs(topicNodes));
}
