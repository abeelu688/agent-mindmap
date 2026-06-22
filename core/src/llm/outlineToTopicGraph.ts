/**
 * Core `outlineToTopicGraph` — locale-free wrapper over `@agent-mindmap/shared`.
 *
 * The shared package provides `outlineToTopicGraph(outline, translate)` where
 * `translate` supplies localized placeholder strings. This module re-exports
 * the shared version with English defaults, plus the pure `topicGraphToOutline`
 * and `countOutlineDetails` helpers.
 *
 * The extension's `extension/src/llm/outlineToTopicGraph.ts` stays as a
 * locale-injecting wrapper that calls the shared function with `uiTranslate`
 * strings.
 */
import {
  outlineToTopicGraph as sharedOutlineToTopicGraph,
  topicGraphToOutline as sharedTopicGraphToOutline,
  countOutlineDetails as sharedCountOutlineDetails,
  type OutlineTranslation,
} from "@agent-mindmap/shared";
import type { SessionOutline, TopicGraph } from "./types";

const englishDefaults: OutlineTranslation = {
  sessionDefaultTitle: "Agent Session",
  noDetailsText: "(No details)",
};

/** Convert `SessionOutline` → `TopicGraph` with English-default labels. */
export function outlineToTopicGraph(outline: SessionOutline): TopicGraph {
  return sharedOutlineToTopicGraph(outline, englishDefaults);
}

export const topicGraphToOutline = sharedTopicGraphToOutline;
export const countOutlineDetails = sharedCountOutlineDetails;
export type { OutlineTranslation };
