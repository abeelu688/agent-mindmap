# Privacy Policy

_Last updated: 2026-06-13_

**Agent Mind Map** is a local-first VS Code extension. It reads AI agent chat
transcripts from your machine and renders them as interactive mind maps. This
document explains exactly what data the extension touches, where it goes, and
what it never does.

## TL;DR

- **No telemetry, analytics, or tracking.** The extension does not collect usage
  data and does not phone home.
- **No third-party servers.** Your transcripts are never uploaded to any server
  operated by this project.
- **All processing is local**, except for the LLM call, which is delegated to a
  CLI you already have installed (`cursor-agent` or `claude`) under your own
  existing subscription.

## What data the extension reads

The extension reads AI agent chat transcripts from local disk only:

| Source          | Location                                                      |
| --------------- | ------------------------------------------------------------- |
| **Cursor**      | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl` |
| **Claude Code** | `~/.claude/projects/<encoded-path>/*.jsonl`                   |

It may also read Cursor's `state.vscdb` to recover conversation titles.

These transcripts may contain local file paths, code snippets, and environment
variable names. The extension treats them as sensitive and never transmits them
to any server controlled by this project.

## Where data goes

1. **To the configured LLM CLI.** To analyze a session, transcript content is
   passed to the headless CLI you selected (`cursor-agent` or `claude`) as a
   subprocess. That CLI forwards the content to its provider **under your own
   existing product subscription and that provider's terms** — Agent Mind Map
   has no separate API key and adds no separate network destination.
2. **To your local library.** Analysis results are persisted under
   `~/.agent-mindmap/` (overridable via `agentMindmap.storeDir`). The library
   stores **summarized concept/outline data and metadata only — not the raw
   transcript**.

The extension does not send data anywhere else.

## What is stored locally

- Summarized `TopicGraph` / outline structures, concept contexts, and merge
  snapshots in `~/.agent-mindmap/`.
- These never include the full raw transcript text.

## Optional features that write more data (off by default)

- **`agentMindmap.llm.dumpIo`** — when enabled, full prompts and LLM responses
  (including transcript content) are written to local `agent-mindmap-llm-dumps/`
  directories for debugging. These are gitignored; do not commit them.
- **`AGENT_MINDMAP_DEBUG_INGEST`** environment variable — a development-only
  debug log sink. It is unset by default; when unset, no debug data is sent
  anywhere. See [`SECURITY.md`](SECURITY.md).

## Your control

- Uninstalling the extension stops all processing.
- Deleting `~/.agent-mindmap/` removes all stored analysis.
- The extension is **read-only** with respect to your chat storage — it never
  writes back to transcript files or the Agent panel.

## Questions

For security concerns, see [`SECURITY.md`](SECURITY.md). For anything else, open
an issue in the repository.
