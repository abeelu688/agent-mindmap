import {
  outlineToTopicGraph as sharedOutlineToTopicGraph,
  topicGraphToOutline as sharedTopicGraphToOutline,
  countOutlineDetails as sharedCountOutlineDetails,
  type OutlineTranslation,
} from "@agent-mindmap/shared";
import { uiTranslate } from "../l10n/uiTranslate";
import type { SessionOutline, TopicGraph } from "@agent-mindmap/core";

/**
 * Extension-local wrapper that injects the localized placeholder strings
 * into the shared `outlineToTopicGraph`. Callers in the extension keep
 * using the same signature; the shared version (no translation) is what
 * the MCP server and `SqliteStore` use.
 */
export function outlineToTopicGraph(outline: SessionOutline): TopicGraph {
  const translate: OutlineTranslation = {
    sessionDefaultTitle: uiTranslate("mindmap.turn.sessionDefault", "Agent Session"),
    noDetailsText: uiTranslate("mindmap.concept.noDetails", "(No details)"),
  };
  return sharedOutlineToTopicGraph(outline, translate);
}

export const topicGraphToOutline = sharedTopicGraphToOutline;
export const countOutlineDetails = sharedCountOutlineDetails;
