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
  sessionLabel?: string
): MindMapRoot {
  const llmTitle = graph.title?.trim();
  const rootText = llmTitle
    ? truncate(llmTitle, 60)
    : sessionLabel
      ? truncate(sessionLabel, 80)
      : "Agent Session";

  const topicNodes: MindMapNodeData[] = graph.topics.map((topic, idx) => {
    const title = `核心${idx + 1}: ${truncate(topic.title, 60)}`;
    const children: MindMapNodeData[] = [];

    if (topic.summary && topic.summary.trim()) {
      children.push(leaf(`概述：${topic.summary}`));
    }

    for (const item of topic.items) {
      const refs = item.sourceTurnIndices?.length
        ? ` (Q${item.sourceTurnIndices.map((n) => n + 1).join("/Q")})`
        : "";
      children.push(leaf(`${item.text}${refs}`));
    }

    if (!children.length) {
      return leaf(title);
    }
    return branch(title, children);
  });

  return {
    data: { text: rootText, expand: true },
    children: topicNodes.length ? topicNodes : undefined,
  };
}
