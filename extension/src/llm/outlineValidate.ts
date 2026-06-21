/**
 * Extension-local re-export of outline validation from @agent-mindmap/shared.
 *
 * Policy: extension code should import from this wrapper rather than directly
 * from @agent-mindmap/shared, so that the extension's API boundary is explicit.
 * If shared's validation API changes, only this file needs updating.
 */
export { validateSessionOutline, validateMergedOutline, __testing } from "@agent-mindmap/shared";
