/**
 * @deprecated This module is superseded by core use cases (analyzeSession, analyzeProject, listSessions).
 * It is kept temporarily for reference only. No active code imports from this file.
 *
 * The orchestration logic that lived here has been extracted to:
 * - `@agent-mindmap/core` useCases/analyzeSession — single-session analysis with completed() pattern
 * - `@agent-mindmap/core` useCases/analyzeProject — batch project analysis with completed() pattern
 * - `@agent-mindmap/core` useCases/listSessions — session discovery
 * - `extension/src/adapters/coreUseCaseDeps.ts` — VS Code adapter wiring
 */
