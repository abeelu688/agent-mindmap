# Architecture

> **Audience**: contributors who want to understand how the codebase fits together before sending their first PR.
>
> For a code-level review of every pipeline stage, see [`PIPELINES_AND_REVIEW.md`](PIPELINES_AND_REVIEW.md).

---

## TL;DR

Agent Mind Map is a **read-only viewer** for AI agent chat transcripts (Cursor, Claude Code), rendered as an interactive mind map.

```
                       ┌─────────────────────┐
                       │   Transcript .jsonl │   on disk, owned by Cursor / Claude
                       └──────────┬──────────┘
                                  │ parsed
                          ┌───────▼───────┐
                          │   ChatEvent[] │
                          └───────┬───────┘
                                  │ runs Session Pipeline (S1 LLM + S2 DET)
                          ┌───────▼───────┐
                          │ SessionRecord │   persisted to ~/.agent-mindmap/
                          └───────┬───────┘
                                  │ buildOutlineMindMap
                          ┌───────▼───────┐
                          │  MindMapRoot  │   webview renders via mind-elixir
                          └───────────────┘
```

Two clean separations:

| Layer         | Process              | Lives in         | Talks to                 |
| ------------- | -------------------- | ---------------- | ------------------------ |
| **Extension** | VS Code Node.js host | `extension/src/` | LLM CLI subprocess, disk |
| **Webview**   | Browser iframe       | `webview/src/`   | mind-elixir, the user    |

The two communicate through `MindMapPanel.postMessage()` only — **no direct imports across the boundary**. This makes the webview easy to bundle for offline export ([`extension/src/export/`](../extension/src/export/)).

---

## Repo Layout (Bird's-Eye)

```
agent-mindmap/
├── extension/src/        ← Node.js side (the VS Code extension)
│   ├── extension.ts            (~232 lines: lifecycle + command registration only)
│   ├── commands/               (one file per VS Code command)
│   ├── batch/                  (project-wide batch analysis state + concept merge)
│   ├── pipeline/               (S1→S2 session pipeline + batch snapshot pipeline)
│   ├── store/                  (SessionRecord, atomic write, merge snapshots)
│   ├── llm/                    (CLI dispatch, prompts, JSON parsing/validation)
│   ├── host/                   (Cursor / Claude Code adapter abstraction)
│   ├── mindmap/                (data → mind-elixir node converters)
│   ├── transcript/             (JSONL parsing, session listing, Cursor state.vscdb)
│   ├── webview/                (MindMapPanel: hosts the iframe, message bus)
│   ├── export/                 (offline HTML package builder)
│   ├── ui/                     (theme + layout direction settings)
│   ├── l10n/                   (uiTranslate.ts: t() and uiTranslate())
│   ├── errors.ts               (AgentMindmapError + helpers)
│   ├── log.ts                  (agentLog.debug/info/warn/error)
│   ├── notify.ts               (notify() — auto-classifies error level)
│   ├── llmOptions.ts           (readLlmOptions / ensureModelSelected)
│   └── progressHelpers.ts      (withCancellableProgress)
│
├── webview/src/          ← Browser side (loaded into the iframe)
│   ├── main.ts                 (boots mind-elixir, listens for postMessage)
│   ├── toMindElixir.ts         (data model → mind-elixir node tree)
│   ├── theme.ts                (preset + theme file overrides)
│   ├── sideLayout.ts           (left/right/side-by-side layout)
│   ├── exportBootstrap.ts      (offline export entry point)
│   └── offlineJump.ts          (jump-to-transcript in offline mode)
│
├── test/                 ← Vitest + node test runner. Files mirror sources.
├── docs/                 ← This file, PIPELINES_AND_REVIEW, RELEASE, MAINTAINING
└── scripts/              ← Build helpers, lint scripts, eval pipeline
```

Where to start reading depends on what you're trying to do:

- **Debug an LLM failure** → [`extension/src/llm/headlessCli.ts`](../extension/src/llm/headlessCli.ts) (CLI dispatch + retry loop)
- **Add a new command** → [`extension/src/commands/`](../extension/src/commands/) (each command is one file)
- **Add a new transcript host** → [`extension/src/host/`](../extension/src/host/) (see CONTRIBUTING.md)
- **Change the rendered mind map** → [`webview/src/toMindElixir.ts`](../webview/src/toMindElixir.ts) and [`extension/src/mindmap/`](../extension/src/mindmap/)
- **Add a new translation** → [`extension/l10n/`](../extension/l10n/) + [CONTRIBUTING.md → Adding a new language](../CONTRIBUTING.md#adding-a-new-ui-language)

---

## Two Rendering Modes

The single most important branch in the codebase:

| Mode      | Trigger                                                 | Renderer                                                                 |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Topic** | LLM analysis succeeded → `SessionRecord.outline` exists | [`buildOutlineMindMap`](../extension/src/mindmap/buildOutlineMindMap.ts) |
| **Turn**  | LLM unavailable, cancelled, or returned bad JSON        | [`buildTurnMindMap`](../extension/src/mindmap/buildMindMapData.ts)       |

**Topic** is the default and the interesting view. It's what users want — "what was this chat _about_". **Turn** is a graceful fallback: instead of failing, render the chronological Q&A so the user gets _something_.

`Turn` results are **not persisted to the library** — only Topic results are. This means a failed LLM call doesn't pollute the cross-session merge.

---

## Data Flow: Single Session

This is the path when you run **Open Latest Session**:

```
extension.ts: commandOpenLatest()
    └─ commands/openLatest.ts
        └─ sessionLoader.loadLatestSession()
            └─ host.listSessions() ──→ Cursor: scan ~/.cursor/projects/<slug>/...
            │                          Claude: scan ~/.claude/projects/<encoded>/
            │                          → newest TranscriptSession
            │
            └─ sessionLoader.loadSession()
                ├─ parseJsonl() ──→ ChatEvent[]
                ├─ readRecord() ──→ cached SessionRecord? → if isRecordFresh, reuse
                │
                ├─ pipeline/sessionPipeline.runSessionPipeline()
                │   ├─ S1: stages/analyzeSession   (LLM, one big call)
                │   └─ S2: stages/finalizeSessionAnalysis  (DET — ontology + paths)
                │
                ├─ buildOutlineMindMap() ──→ MindMapRoot
                ├─ writeRecord() ──→ ~/.agent-mindmap/sessions/<slug>/<id>.json
                └─ panel.setMindMapData(MindMapRoot)
```

Every disk write goes through [`writeJsonAtomic`](../extension/src/store/atomicWrite.ts) — no half-written files.

Every LLM call goes through [`HeadlessCliProvider.summarize`](../extension/src/llm/headlessCli.ts), which handles binary detection, retry-with-backoff, AbortSignal cancellation, JSON repair, and schema validation.

---

## Data Flow: Batch Analysis

This is the path when you run **Analyze All Sessions (Current Project)** — the most complex flow.

```
extension.ts: commandAnalyzeAndMergeCurrentProject()
    └─ commands/analyzeProject.ts
        └─ host.listSessions() → all sessions
        │
        └─ for each batch of 5 sessions:
            │
            ├─ runProjectSessionBatches()
            │   └─ for each session:
            │       └─ loadSession()  (same as single-session pipeline above)
            │
            └─ onBatchDone()  (called between batches)
                └─ batch/conceptMerge.buildProjectConceptMergeForBatch()
                    └─ runBatchSnapshotPipeline()    ← LLM if first batch / forceRefresh
                        ├─ M1: collectMergeTerms     (DET)
                        ├─ M2: mergeSynonyms         (LLM, optional)
                        ├─ M3: mergeTrieReparent     (LLM, the big merge call)
                        └─ buildMergedOutlineMindMap → MindMapRoot
```

The "batch 1 = full merge, batch 2+ = snapshot delta" rule is enforced by [`pipeline/snapshotHierarchy.ts`](../extension/src/pipeline/snapshotHierarchy.ts). See [`PIPELINES_AND_REVIEW.md`](PIPELINES_AND_REVIEW.md) for the cross-batch state machine.

State that lives between batches is in [`batch/batchStatus.ts`](../extension/src/batch/batchStatus.ts) — `pendingMindMap`, `lastBatchStatus` — so the batch loop and the webview can stay in sync without leaking state into `extension.ts`.

---

## Library: The Persistent Store

`~/.agent-mindmap/` (or `agentMindmap.storeDir`) is the cross-project, cross-session library:

```
<storeDir>/
├── schema.json                          marker { schemaVersion, kind }
├── index.json                           compact projection of all records
├── sessions/<slug>/<sessionId>.json     SessionRecord (one per analyzed session)
├── merges/
│   ├── deterministic.json               cross-project DET merge (no LLM)
│   ├── concept-trie.json                concept trie merge (all projects)
│   ├── llm-refined.json                 most recent LLM-refined merge
│   └── cache/<sha>.json                 LLM merge results keyed by selection set
└── ontology/
    ├── index.json                       cache index for concept ontology
    └── cache/<sha>.json                 ontology + topicPaths + segmentEquivalences
```

**Freshness check** ([`isRecordFresh`](../extension/src/store/sessionStore.ts)) gates every reuse: a record is fresh only if `transcriptFreshnessToken` + `promptParams` + `pipelineVersions` + `llm.provider` + `llm.model` + `hostId` all match. If any drift, the session is re-analyzed.

**Bumping `PIPELINE_VERSION`** ([`pipeline/pipelineVersions.ts`](../extension/src/pipeline/pipelineVersions.ts)) is the canonical way to invalidate caches when prompt schemas change.

---

## Host Abstraction

[`host/types.ts`](../extension/src/host/types.ts) defines `AgentHost`:

```ts
type AgentHost = {
  id: AgentHostId;                                      // "cursor" | "claude-code"
  displayName: string;
  defaultLlmProvider: LlmProviderId;                    // "cursor-cli" | "claude-cli"
  getSessionsScanDir(workspacePath): string;            // where transcripts live
  listSessions(scanDir, opts): Promise<TranscriptSession[]>;
  emptyTranscriptsHint(scanDir): string;
  ...
};
```

To add a new host (Windsurf, etc.):

1. Implement `AgentHost` in `host/<newhost>.ts`
2. Register in `host/registry.ts`
3. Add the id to `AgentHostId` in `host/types.ts`
4. Add transcript JSONL parsing if the format differs (see `transcript/parseClaudeJsonl.ts` vs `parseJsonl.ts`)
5. Add a CLI provider in `llm/<newhost>CliProvider.ts` if its headless CLI differs

---

## LLM Layer

[`HeadlessCliProvider`](../extension/src/llm/headlessCli.ts) is the **single point** through which every LLM call must pass. It owns:

- Binary auto-detection across `cliPath` + default candidates
- Argv buffering (rejects > 96 KiB prompts)
- Subprocess spawn with timeout + AbortSignal
- Retry loop with exponential backoff + jitter (caps at 10s)
- JSON repair (trailing commas, smart quotes, unbalanced braces)
- Schema-based validation per `LlmResponseSchema`

Adding a new prompt stage = three steps:

1. Write `llm/promptXxx.ts` exporting `buildXxxPrompt()`
2. Add the schema name to `LlmResponseSchema` in `llm/types.ts`
3. Add `parseXxxFromStdout()` and a case in `parseBySchema()` in `headlessCli.ts`

Bump `PIPELINE_VERSION` if the JSON output shape changes.

### Errors

`LlmProviderError` carries an `LlmErrorCode`:

| Code          | Retryable? | What it means                                |
| ------------- | ---------- | -------------------------------------------- |
| `cli-missing` | no         | Binary not found on PATH                     |
| `cli-failed`  | yes        | Subprocess exited non-zero                   |
| `timeout`     | yes        | Hit `agentMindmap.llm.timeoutMs`             |
| `cancelled`   | no         | User cancelled via the progress notification |
| `bad-json`    | yes        | Output couldn't parse even after repair      |
| `bad-shape`   | yes        | Parsed but failed schema validation          |
| `empty`       | no         | Empty output                                 |

These are also mapped into [`AgentMindmapError`](../extension/src/errors.ts) so command-level error handlers can route them through the unified `notify()`.

---

## i18n Layers

Three independent dimensions:

| Layer             | Setting                           | What it controls                                 |
| ----------------- | --------------------------------- | ------------------------------------------------ |
| **UI**            | `agentMindmap.ui.locale`          | Notifications, progress messages, command labels |
| **Prompt**        | `agentMindmap.llm.promptLanguage` | Language used inside the LLM prompt template     |
| **Documentation** | (file naming)                     | `README.md` vs `README.zh-cn.md`, etc.           |

UI strings go through `t(key, englishMessage, ...args)` ([`l10n/uiTranslate.ts`](../extension/src/l10n/uiTranslate.ts)). When adding a user-visible string, add the key to **both** `bundle.l10n.json` (English) and `bundle.l10n.zh-cn.json`. Other locales fall back to English when the bundle is empty.

LLM prompts are being migrated to a `TEXTS: Record<PromptLanguage, ...>` pattern — see [`llm/promptOutline.ts`](../extension/src/llm/promptOutline.ts) for the reference implementation. Only active production prompt paths should be migrated; deprecated prompt files should not be wired back into the pipeline.

---

## Webview Boundary

The webview ([`webview/src/`](../webview/src/)) is bundled by Vite into `extension/media/webview.js` + CSS. The extension never imports webview code directly; communication is via `MindMapPanel.postMessage()` and `MindMapPanel.onMessage()` events.

What lives where:

| Concern                                                  | Side                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mind-elixir setup, theme application, layout             | webview                                                                                    |
| Click → which session/turn does this node trace back to? | extension (via `onNodeClicked` event)                                                      |
| Loading state, batch progress                            | extension (sends to webview, webview displays)                                             |
| Theme file parsing                                       | extension (reads disk, sends merged theme)                                                 |
| Offline export rendering                                 | both (extension generates the bundle, webview boots in offline mode via `exportBootstrap`) |

This boundary is also why the webview has its own `tsconfig.json` and lint config — it lives in a different runtime.

---

## What This Doc Doesn't Cover

- **Cross-batch ontology evolution** (segment equivalences, prefix rules) → see [`PIPELINES_AND_REVIEW.md`](PIPELINES_AND_REVIEW.md)
- **Concept trie merge math** → see comments in [`store/mergeConceptTrie.ts`](../extension/src/store/mergeConceptTrie.ts)
- **Click-to-jump origin tracking** → see [`mindmap/origin.ts`](../extension/src/mindmap/origin.ts) and [`jumpToOrigin.ts`](../extension/src/jumpToOrigin.ts)
- **The eval pipeline** for prompt-quality regression testing → see [`extension/src/eval/`](../extension/src/eval/) and [`scripts/build-eval-run.mjs`](../scripts/build-eval-run.mjs)

If you find yourself spelunking through the merge code, the snapshot pipeline, or the ontology refine logic, **stop and read [`PIPELINES_AND_REVIEW.md`](PIPELINES_AND_REVIEW.md)** before changing anything — that doc has the contracts and gotchas written down.
