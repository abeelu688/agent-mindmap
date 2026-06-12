# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agent Mind Map, please report it responsibly.

**Do NOT open a public GitHub issue.**

Instead, please:

1. **Email** the maintainer directly (preferred), or
2. Use GitHub's **private vulnerability reporting** feature: go to the repository → Security → Report a vulnerability

Please include:

- A description of the vulnerability
- Steps to reproduce
- The affected version(s)
- Any potential impact

## Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix / mitigation**: depends on severity; critical issues are prioritized

## Known Security Considerations

### Transcript Privacy

Agent Mind Map reads AI agent chat transcripts from local disk. These transcripts may contain:

- Local file paths
- Code snippets
- Environment variable names

The extension **does not transmit transcripts to any third-party server**. Transcripts are only sent to the configured CLI (`cursor-agent` or `claude`), which forwards them under your existing product subscription terms.

The library (`~/.agent-mindmap/`) only stores summarized `TopicGraph` data and metadata — **not** raw transcripts.

### LLM I/O Dumps

When `agentMindmap.llm.dumpIo` is enabled, full prompts and LLM responses (including transcript content) are written to disk under `agent-mindmap-llm-dumps/`. These directories are gitignored. **Do not commit dump directories to version control.**

### Debug Ingest Endpoint

The `agentDebugLog()` function in `extension/src/debugLog.ts` sends data to an HTTP endpoint only when the `AGENT_MINDMAP_DEBUG_INGEST` environment variable is set. This is **off by default** and intended for local development only.
