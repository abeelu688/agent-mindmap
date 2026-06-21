/**
 * Extension-local re-export of topic-graph validation from @agent-mindmap/shared.
 *
 * Policy: extension code should import from this wrapper rather than directly
 * from @agent-mindmap/shared, so that the extension's API boundary is explicit.
 * If shared's validation API changes, only this file needs updating.
 */
export {
  validateTopicGraph,
  parseConceptPath,
  canonicalizeConceptSegment,
  segmentKeyForMerge,
  __testing,
} from "@agent-mindmap/shared";
