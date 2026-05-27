import type { ChatEvent } from "../transcript/types";
import type { TopicGraph } from "./types";

export function countUserQueries(events: ChatEvent[]): number {
  return events.filter((e) => e.kind === "user_query").length;
}

/**
 * Drop sourceTurnIndices that are out of range for this transcript. The LLM
 * sometimes copies turn numbers from conversations cited in assistant replies
 * (other sessions) instead of [Q#] indices in the transcript being analyzed.
 */
export function sanitizeTopicGraph(
  graph: TopicGraph,
  userQueryCount: number
): TopicGraph {
  if (userQueryCount <= 0) {
    return stripAllTurnIndices(graph);
  }
  let changed = false;
  const topics = graph.topics.map((topic) => {
    const items = topic.items.map((item) => {
      if (!item.sourceTurnIndices?.length) {
        return item;
      }
      const next = item.sourceTurnIndices.filter((n) => n < userQueryCount);
      if (
        next.length === item.sourceTurnIndices.length &&
        next.every((v, i) => v === item.sourceTurnIndices![i])
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        sourceTurnIndices: next.length ? next : undefined,
      };
    });
    if (items.every((it, i) => it === topic.items[i])) {
      return topic;
    }
    return { ...topic, items };
  });
  if (!changed) {
    return graph;
  }
  return { ...graph, topics };
}

function stripAllTurnIndices(graph: TopicGraph): TopicGraph {
  let changed = false;
  const topics = graph.topics.map((topic) => {
    const items = topic.items.map((item) => {
      if (!item.sourceTurnIndices?.length) {
        return item;
      }
      changed = true;
      const { sourceTurnIndices: _drop, ...rest } = item;
      return rest;
    });
    return { ...topic, items };
  });
  return changed ? { ...graph, topics } : graph;
}
