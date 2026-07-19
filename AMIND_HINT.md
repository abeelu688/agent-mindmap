# AMIND_HINT

`agent-mindmap` MCP indexes past AI agent sessions (Cursor / Claude Code
transcripts) for this project - a memory of prior conversations, **not** a
view of current files or live code.

## When to consult

Before non-trivial work: planning, debugging, implementation, code review,
refactoring, onboarding. Skip trivial fixes (typos, one-line tweaks,
auto-generated updates).

## How to consult

1. `list_projects` -> `get_project_briefing` to orient.
2. `search_project_history` (keyword/semantic) or `retrieve_project_memory`
   (synthesized recall) with specific keywords.
3. `get_session_outline` for session detail; `get_concept_detail` for a
   concept's aliases + cross-session evidence.

| Question                                      | Tool                                                |
| --------------------------------------------- | --------------------------------------------------- |
| "What have we been working on?"               | `get_project_briefing`                              |
| "Did we ever do X?" / "How did we handle Y?"  | `search_project_history`, `retrieve_project_memory` |
| "What did we decide about X?" (synthesis)     | `retrieve_project_memory`                           |
| "Show me session Z's outline"                 | `get_session_outline`                               |
| "Tell me about concept X" (aliases, evidence) | `get_concept_detail`                                |
| "What sessions exist?"                        | `list_project_sessions`                             |

Use specific keywords (`virtual session incremental analysis`, not `analysis`);
combine domain + feature; include decision words (`decided`, `rejected`, `why`).

## Notes

- Verify file paths / function names / flags against current code - memory is
  a snapshot, not authoritative for current state.
- Cite session ids in design notes / PRs / commit messages so the next session
  can follow the trail.
