import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getProvider } from "./llm";
import { PROMPT_VERSION } from "./llm/prompt";
import { summarizeSession } from "./llm/summarizeSession";
import {
  LlmProviderError,
  type LlmProviderOptions,
  type TopicGraph,
} from "./llm/types";
import { buildTopicMindMap } from "./mindmap/buildTopicMindMap";
import { buildTurnMindMap } from "./mindmap/buildMindMapData";
import {
  getStoreDir,
  getTranscriptsDir,
  getWorkspacePath,
  getWorkspaceSlug,
  slugToWorkspacePath,
} from "./paths";
import { buildDeterministicMergeRecord } from "./store/mergeDeterministic";
import { buildConceptMergeRecord } from "./store/mergeConceptTrie";
import {
  buildRecordMeta,
  buildSessionRecord,
  conceptTrieMergePath,
  deterministicMergePath,
  isRecordFresh,
  listRecords,
  readRecord,
  rebuildIndex,
  sha256Hex,
  writeMergeRecord,
  writeRecord,
} from "./store/sessionStore";
import { listSessions, readSessionFile } from "./transcript/listSessions";
import { parseJsonl } from "./transcript/parseJsonl";
import type { MindMapRoot, TranscriptSession } from "./transcript/types";

export type LoadedSession = {
  session: TranscriptSession;
  mindMap: MindMapRoot;
  /** Which renderer produced `mindMap`. */
  source: "topic" | "turn";
  /** True when the topic graph came from the on-disk library (no LLM call). */
  fromLibrary?: boolean;
};

export type LoadDeps = {
  context: vscode.ExtensionContext;
  signal?: AbortSignal;
};

type Settings = {
  llm: LlmProviderOptions;
  /** Legacy globalStorage hash cache (still useful as 2nd-tier). */
  cache: boolean;
  /** Library (`storeDir`) layer — primary persistence + cross-agent store. */
  library: {
    enabled: boolean;
    autoRebuildDeterministic: boolean;
  };
  turnOptions: { includeToolCalls: boolean; maxConclusionItems: number };
};

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "cursor-cli");
  const provider: LlmProviderOptions["provider"] =
    providerSetting === "cursor-cli" ? "cursor-cli" : "cursor-cli";

  return {
    llm: {
      provider,
      cliPath: config.get<string>("llm.cliPath", "").trim(),
      model: config.get<string>("llm.model", "").trim(),
      timeoutMs: Math.max(
        1000,
        config.get<number>("llm.timeoutMs", 90000) ?? 90000
      ),
      maxAttempts: Math.max(
        1,
        Math.min(10, config.get<number>("llm.maxAttempts", 3) ?? 3)
      ),
      retryBackoffMs: Math.max(
        0,
        Math.min(30000, config.get<number>("llm.retryBackoffMs", 1000) ?? 1000)
      ),
      maxTopics: Math.max(1, config.get<number>("maxTopics", 6) ?? 6),
      maxItemsPerTopic: Math.max(
        1,
        config.get<number>("maxItemsPerTopic", 6) ?? 6
      ),
    },
    cache: config.get<boolean>("cacheLlmResult", true) ?? true,
    library: {
      enabled: config.get<boolean>("library.enabled", true) ?? true,
      autoRebuildDeterministic:
        config.get<boolean>("merge.autoRebuildDeterministic", true) ?? true,
    },
    turnOptions: {
      includeToolCalls: config.get<boolean>("includeToolCalls", true) ?? true,
      maxConclusionItems:
        config.get<number>("maxConclusionItems", 8) ?? 8,
    },
  };
}

function getCacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "llm-cache");
}

function describeError(err: unknown): string {
  if (err instanceof LlmProviderError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isCancellation(err: unknown): boolean {
  return err instanceof LlmProviderError && err.code === "cancelled";
}

export async function loadLatestSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const dir = getTranscriptsDir();
  if (!dir) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const slug = getWorkspaceSlug();
  const projectPath = getWorkspacePath();
  const sessions = await listSessions(dir, {
    projectSlug: slug,
    projectPath,
  });
  if (!sessions.length) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: No agent transcripts in ${dir}`
    );
    return undefined;
  }

  return loadSession(sessions[0], deps);
}

export async function pickSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const dir = getTranscriptsDir();
  if (!dir) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const slug = getWorkspaceSlug();
  const projectPath = getWorkspacePath();
  const sessions = await listSessions(dir, {
    projectSlug: slug,
    projectPath,
  });
  if (!sessions.length) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: No agent transcripts in ${dir}`
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.label,
      description: s.id,
      session: s,
    })),
    { placeHolder: "Select an agent chat session" }
  );

  if (!picked) {
    return undefined;
  }

  return loadSession(picked.session, deps);
}

function resolveSessionContext(session: TranscriptSession): {
  projectSlug: string;
  projectPath?: string;
} {
  if (session.projectSlug) {
    return {
      projectSlug: session.projectSlug,
      projectPath: session.projectPath,
    };
  }
  // Best-effort fallback: derive slug from transcript path
  // `<...>/<slug>/agent-transcripts/<id>/<id>.jsonl` → grandgrandparent name
  const transcriptsParent = path.dirname(path.dirname(session.filePath));
  const slugDir = path.dirname(transcriptsParent);
  return {
    projectSlug: path.basename(slugDir),
    projectPath: session.projectPath,
  };
}

export type LoadSessionOptions = {
  /** Force re-analysis even if the library has a fresh record. */
  forceRefresh?: boolean;
};

export async function loadSession(
  session: TranscriptSession,
  deps: LoadDeps,
  options: LoadSessionOptions = {}
): Promise<LoadedSession> {
  const content = await readSessionFile(session.filePath);
  const events = parseJsonl(content);
  const settings = readSettings();
  const signal = deps.signal ?? new AbortController().signal;
  const transcriptSha256 = sha256Hex(content);
  const transcriptMtimeMs = await tryStatMtime(session.filePath, session.mtimeMs);
  const ctx = resolveSessionContext(session);
  const projectPath =
    ctx.projectPath ?? slugToWorkspacePath(ctx.projectSlug);

  // 1) Library hit — skip LLM entirely.
  if (settings.library.enabled && !options.forceRefresh) {
    try {
      const existing = await readRecord(
        getStoreDir(),
        ctx.projectSlug,
        session.id
      );
      if (
        existing &&
        isRecordFresh(existing, {
          transcriptSha256,
          promptParams: {
            maxTopics: settings.llm.maxTopics,
            maxItemsPerTopic: settings.llm.maxItemsPerTopic,
          },
          promptVersion: PROMPT_VERSION,
          llm: {
            provider: settings.llm.provider,
            model: settings.llm.model || undefined,
          },
        })
      ) {
        return {
          session: { ...session, projectSlug: ctx.projectSlug, projectPath },
          mindMap: buildTopicMindMap(existing.graph, session.label),
          source: "topic",
          fromLibrary: true,
        };
      }
    } catch (err) {
      // Library read failures are non-fatal — fall through to LLM.
      console.warn("[agent-mindmap] library read failed:", err);
    }
  }

  // 2) LLM call (with 2nd-tier hash cache in globalStorage).
  let graph: TopicGraph | undefined;
  try {
    const provider = getProvider(settings.llm);
    graph = await summarizeSession(
      events,
      {
        prompt: {
          maxTopics: settings.llm.maxTopics,
          maxItemsPerTopic: settings.llm.maxItemsPerTopic,
        },
        modelHint: settings.llm.model || undefined,
        cacheDir: getCacheDir(deps.context),
        cache: settings.cache,
      },
      provider,
      signal
    );
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    const detail = describeError(err);
    const cliMissing =
      err instanceof LlmProviderError && err.code === "cli-missing";
    const action = cliMissing
      ? "Install cursor-agent CLI: curl https://cursor.com/install -fsS | bash"
      : "Falling back to chronological view.";
    vscode.window.showWarningMessage(
      `Agent Mind Map: LLM summarization failed (${detail}). ${action}`
    );
    console.warn("[agent-mindmap] LLM failure, using turn fallback:", err);
    return {
      session,
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label
      ),
      source: "turn",
    };
  }

  // 3) Persist to library on success.
  if (settings.library.enabled) {
    try {
      const meta = buildRecordMeta({
        sessionId: session.id,
        projectSlug: ctx.projectSlug,
        projectPath,
        transcriptPath: session.filePath,
        transcriptMtimeMs,
        transcriptSha256,
        llm: {
          provider: settings.llm.provider,
          model: settings.llm.model || undefined,
        },
        promptParams: {
          maxTopics: settings.llm.maxTopics,
          maxItemsPerTopic: settings.llm.maxItemsPerTopic,
        },
        promptVersion: PROMPT_VERSION,
        sessionLabel: session.label,
      });
      const record = buildSessionRecord(meta, graph);
      const storeDir = getStoreDir();
      await writeRecord(storeDir, record);

      if (settings.library.autoRebuildDeterministic) {
        // Rebuild index, deterministic merge, and concept-trie merge in the
        // background. Failures here are non-fatal and never block the view.
        void (async () => {
          try {
            const all = await listRecords(storeDir);
            await rebuildIndex(storeDir, all);
            const merge = buildDeterministicMergeRecord(all);
            await writeMergeRecord(deterministicMergePath(storeDir), merge);
            const concept = buildConceptMergeRecord(all);
            await writeMergeRecord(conceptTrieMergePath(storeDir), concept);
          } catch (err) {
            console.warn(
              "[agent-mindmap] background merge rebuild failed:",
              err
            );
          }
        })();
      }
    } catch (err) {
      console.warn("[agent-mindmap] library write failed:", err);
    }
  }

  return {
    session: { ...session, projectSlug: ctx.projectSlug, projectPath },
    mindMap: buildTopicMindMap(graph, session.label),
    source: "topic",
  };
}

async function tryStatMtime(filePath: string, fallback: number): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return fallback;
  }
}

export { listSessions, getTranscriptsDir };
