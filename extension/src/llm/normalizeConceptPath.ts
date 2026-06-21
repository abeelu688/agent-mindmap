/**
 * Extension-local re-export of concept-path normalization from @agent-mindmap/shared.
 *
 * Policy: extension code should import from this wrapper rather than directly
 * from @agent-mindmap/shared, so that the extension's API boundary is explicit.
 * If shared's normalization API changes, only this file needs updating.
 */
export { normalizeConceptPath, MAX_CONCEPT_PATH_SEGMENTS } from "@agent-mindmap/shared";
