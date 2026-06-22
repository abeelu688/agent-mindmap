/**
 * @agent-mindmap/core — VS Code-free business logic shared between the
 * extension and the CLI.
 *
 * This package is intentionally empty in P1.1 (scaffold only). Subsequent
 * phase-1 PRs move modules out of `extension/src/` into `core/src/`:
 *
 *   P1.2 — transcript/
 *   P1.3 — host/
 *   P1.4 — store/
 *   P1.5 — pipeline/
 *   P1.6 — llm/
 *   P1.7 — mindmap/
 *   P1.8 — export/
 *   P1.9 — mcp/ (core half)
 *   P1.10 — codeRefQueue.ts
 *   P1.11 — useCases/
 *
 * Re-exports below are added as the corresponding PR lands. See
 * `docs/CLI.md` and `plans/cli-master.md` in the orchestration hub for the
 * full extraction plan.
 */

/** Sentinel so the package isn't an empty module — replaced as modules land. */
export const CORE_PACKAGE_VERSION = "0.2.3";
