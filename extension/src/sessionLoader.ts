import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getActiveHost, getWorkspacePath, getWorkspaceSlug } from "./host";
import type { AgentHost } from "./host/types";
import { getProvider } from "./llm";
import { PROMPT_VERSION } from "./llm/promptOutline";
import { sanitizeSessionOutline } from "./llm/sanitizeOutline";
import { summarizeSession } from "./llm/summarizeSession";
import { countUserQueries } from "./llm/sanitizeTopicGraph";
import {
  LlmProviderError,
  type LlmProviderId,
  type LlmProviderOptions,
  type SessionOutline,
} from "./llm/types";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { buildTurnMindMap } from "./mindmap/buildMindMapData";
import type { SessionMeta } from "./mindmap/origin";
import { getStoreDir } from "./paths";
import { buildDeterministicMergeRecordAsync } from "./store/mergeDeterministic";
import { buildConceptMergeRecordAsync } from "./store/mergeConceptTrie";
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
import type { MindMapProgress } from "./progress";
import { readSessionFile } from "./transcript/listSessions";
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
  progress?: MindMapProgress;
};

type Settings = {
  llm: LlmProviderOptions;
  cache: boolean;
  library: {
    enabled: boolean;
    autoRebuildDeterministic: boolean;
  };
  turnOptions: { includeToolCalls: boolean; maxConclusionItems: number };
};

function resolveLlmProviderId(
  setting: string,
  hostDefault: LlmProviderId
): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

async function readSettings(host: AgentHost): Promise<Settings> {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "auto");
  const provider = resolveLlmProviderId(
    providerSetting,
    host.defaultLlmProvider
  );

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
      hostId: host.id,
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

async function listWorkspaceSessions(
  host: AgentHost
): Promise<{ scanDir: string; sessions: TranscriptSession[] } | undefined> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const slug = getWorkspaceSlug(host);
  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });
  return { scanDir, sessions };
}

export async function loadLatestSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const host = await getActiveHost(deps.context);
  const listed = await listWorkspaceSessions(host);
  if (!listed) {
    return undefined;
  }
  const { scanDir, sessions } = listed;
  if (!sessions.length) {
    vscode.window.showWarningMessage(host.emptyTranscriptsHint(scanDir));
    return undefined;
  }

  return loadSession(sessions[0], deps, {}, host);
}

export async function pickSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const host = await getActiveHost(deps.context);
  const listed = await listWorkspaceSessions(host);
  if (!listed) {
    return undefined;
  }
  const { scanDir, sessions } = listed;
  if (!sessions.length) {
    vscode.window.showWarningMessage(host.emptyTranscriptsHint(scanDir));
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.label,
      description: `${s.id.slice(0, 8)}…`,
      detail: s.id,
      session: s,
    })),
    {
      placeHolder: `Select a ${host.displayName} chat session`,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  if (!picked) {
    return undefined;
  }

  return loadSession(picked.session, deps, {}, host);
}

function resolveSessionContext(
  session: TranscriptSession,
  host: AgentHost
): {
  projectSlug: string;
  projectPath?: string;
} {
  if (session.projectSlug) {
    return {
      projectSlug: session.projectSlug,
      projectPath: session.projectPath,
    };
  }
  return host.inferProjectFromTranscriptPath(session.filePath);
}

export type LoadSessionOptions = {
  /** Force re-analysis even if the library has a fresh record. */
  forceRefresh?: boolean;
};

export async function loadSession(
  session: TranscriptSession,
  deps: LoadDeps,
  options: LoadSessionOptions = {},
  hostArg?: AgentHost
): Promise<LoadedSession> {
  const host = hostArg ?? (await getActiveHost(deps.context));
  const progress = deps.progress;
  progress?.report("正在读取对话记录…");
  const content = await readSessionFile(session.filePath);
  const events = host.parseTranscript(content);
  const settings = await readSettings(host);
  const signal = deps.signal ?? new AbortController().signal;
  const transcriptSha256 = sha256Hex(content);
  const transcriptMtimeMs = await tryStatMtime(session.filePath, session.mtimeMs);
  const ctx = resolveSessionContext(session, host);
  const projectPath =
    ctx.projectPath ?? host.slugToWorkspacePath(ctx.projectSlug);
  const sessionMeta: SessionMeta = {
    sessionId: session.id,
    projectSlug: ctx.projectSlug,
    projectPath,
    sessionLabel: session.label,
    transcriptPath: session.filePath,
  };

  if (settings.library.enabled && !options.forceRefresh) {
    progress?.report("正在检查分析库缓存…");
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
          hostId: host.id,
        })
      ) {
        const userQueryCount = countUserQueries(events);
        progress?.report("命中缓存，正在生成思维导图…");
        const outline = sanitizeSessionOutline(
          existing.outline,
          userQueryCount
        );
        return {
          session: {
            ...session,
            hostId: host.id,
            projectSlug: ctx.projectSlug,
            projectPath,
          },
          mindMap: buildOutlineMindMap(outline, session.label, sessionMeta),
          source: "topic",
          fromLibrary: true,
        };
      }
    } catch (err) {
      console.warn("[agent-mindmap] library read failed:", err);
    }
  }

  let outline: SessionOutline | undefined;
  try {
    const provider = getProvider(settings.llm);
    outline = await summarizeSession(
      events,
      {
        prompt: {
          maxBranches: settings.llm.maxTopics,
          maxDetailsPerNode: settings.llm.maxItemsPerTopic,
        },
        modelHint: settings.llm.model || undefined,
        cacheDir: getCacheDir(deps.context),
        cache: settings.cache,
        hostId: host.id,
      },
      provider,
      signal,
      progress
    );
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    const detail = describeError(err);
    const cliMissing =
      err instanceof LlmProviderError && err.code === "cli-missing";
    const action = cliMissing
      ? host.cliMissingHint()
      : "Falling back to chronological view.";
    vscode.window.showWarningMessage(
      `Agent Mind Map: LLM summarization failed (${detail}). ${action}`
    );
    console.warn("[agent-mindmap] LLM failure, using turn fallback:", err);
    return {
      session: { ...session, hostId: host.id },
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label,
        sessionMeta
      ),
      source: "turn",
    };
  }

  const userQueryCount = countUserQueries(events);
  outline = sanitizeSessionOutline(outline, userQueryCount);
  progress?.report("正在渲染思维导图…");

  if (settings.library.enabled) {
    progress?.report("正在写入分析库…");
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
        hostId: host.id,
        userQueryCount,
      });
      const record = buildSessionRecord(meta, outline);
      const storeDir = getStoreDir();
      await writeRecord(storeDir, record);

      if (settings.library.autoRebuildDeterministic) {
        void (async () => {
          try {
            const all = await listRecords(storeDir);
            await rebuildIndex(storeDir, all);
            const merge = await buildDeterministicMergeRecordAsync(all);
            await writeMergeRecord(deterministicMergePath(storeDir), merge);
            const concept = await buildConceptMergeRecordAsync(all);
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
    session: {
      ...session,
      hostId: host.id,
      projectSlug: ctx.projectSlug,
      projectPath,
    },
    mindMap: buildOutlineMindMap(outline, session.label, sessionMeta),
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

export async function getTranscriptsDir(
  context?: vscode.ExtensionContext
): Promise<string | undefined> {
  const host = await getActiveHost(context);
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    return undefined;
  }
  return host.getSessionsScanDir(workspacePath);
}
