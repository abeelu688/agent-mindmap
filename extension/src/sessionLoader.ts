import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getActiveHost, getWorkspacePath, getWorkspaceSlug } from "./host";
import type { AgentHost } from "./host/types";
import { getProvider } from "./llm";
import { showCliInstallGuide } from "./llm/cliInstallGuide";
import { sanitizeSessionOutline } from "./llm/sanitizeOutline";
import { dumpLlmReplay } from "./llm/llmIoDump";
import { agentDebugLog } from "./debugLog";
import { mindMapLog } from "./webview/MindMapLog";
import { agentLog } from "./log";
import { notify, notifyWarning, notifyError } from "./notify";
import { buildSessionAnalysisPrompt } from "./llm/promptSessionAnalysis";
import { runSessionPipeline } from "./pipeline/sessionPipeline";
import {
  currentPipelineVersions,
  PIPELINE_VERSION,
} from "./pipeline/pipelineVersions";
import { countUserQueries } from "./llm/sanitizeTopicGraph";
import {
  LlmProviderError,
  type LlmErrorCode,
  type LlmProviderId,
  type LlmProviderOptions,
  type SessionOutline,
} from "./llm/types";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { buildTurnMindMap } from "./mindmap/buildMindMapData";
import type { SessionMeta } from "./mindmap/origin";
import { getStoreDir } from "./paths";
import { buildDeterministicMergeRecordAsync } from "./store/mergeDeterministic";
import { resolveAndBuildConceptMergeAsync } from "./store/conceptMergeContext";
import {
  runBatchSnapshotPipeline,
  refreshSnapshotForSession,
} from "./pipeline/snapshotHierarchy";
import { readSnapshotManifest } from "./store/mergeSnapshot";
import {
  buildRecordMeta,
  buildSessionRecord,
  conceptTrieMergePath,
  deterministicMergePath,
  isRecordFresh,
  listRecords,
  readRecord,
  rebuildIndex,
  recordFreshnessToken,
  writeMergeRecord,
  writeRecord,
} from "./store/sessionStore";
import { createBatchItemProgress, type MindMapProgress } from "./progress";
import { format, t } from "./l10n/uiTranslate";
import { readSessionFile } from "./transcript/listSessions";
import type { MindMapRoot, TranscriptSession } from "./transcript/types";

export type LoadedSession = {
  session: TranscriptSession;
  mindMap: MindMapRoot;
  /** Which renderer produced `mindMap`. */
  source: "topic" | "turn";
  /** True when the topic graph came from the on-disk library (no LLM call). */
  fromLibrary?: boolean;
  /** Set when source is turn after an LLM failure. */
  llmErrorCode?: LlmErrorCode;
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

/** Guard against concurrent background merge rebuilds. */
let pendingMergeRebuild: Promise<void> | undefined;

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
        config.get<number>("llm.timeoutMs", 300000) ?? 300000
      ),
      maxAttempts: Math.max(
        1,
        Math.min(10, config.get<number>("llm.maxAttempts", 1) ?? 1)
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
      labels: {
        research: t("mindmap.turn.research", "Research"),
        conclusion: t("mindmap.turn.conclusion", "Conclusion"),
        sessionDefault: t("mindmap.turn.sessionDefault", "Agent Session"),
      },
    },
  };
}

function getCacheDir(context: vscode.ExtensionContext): string {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const override = config.get<string>("llm.cacheDir", "").trim();
  if (override) {
    return override;
  }
  // Default: keep cache under storeDir so deleting ~/.agent-mindmap clears it.
  return path.join(getStoreDir(), "llm-cache");
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
    notifyWarning(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    notifyWarning(
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
    notifyWarning(host.emptyTranscriptsHint(scanDir));
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
    notifyWarning(host.emptyTranscriptsHint(scanDir));
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
      placeHolder: t(
        "ui.pickSession.placeholder",
        "Select a {0} chat session",
        host.displayName
      ),
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
  /** Skip background deterministic/concept merge rebuild after writeRecord. */
  skipAutoMerge?: boolean;
  /** Suppress per-session LLM failure toasts (batch shows one summary). */
  quietLlmErrors?: boolean;
};

export type AnalyzeProjectOptions = {
  forceRefresh?: boolean;
  /** Default true for batch analyze. */
  skipAutoMerge?: boolean;
  /** Test hook: override per-session loader. */
  loadSessionFn?: typeof loadSession;
  batchSize?: number;
  onBatchDone?: (info: AnalyzeProjectBatchInfo) => Promise<void> | void;
};

export type AnalyzeProjectResult = {
  projectSlug: string;
  total: number;
  analyzed: number;
  skippedFresh: number;
  /** Sessions that fell back to chronological turn view (no library write). */
  turnFallbacks: number;
  /** Turn fallbacks caused by missing CLI binary. */
  cliMissingCount: number;
  /** Turn fallbacks caused by unparseable LLM JSON. */
  jsonParseFailures: number;
  failed: number;
  failures: { sessionId: string; label: string; message: string }[];
};

export type AnalyzeProjectBatchInfo = AnalyzeProjectResult & {
  /** 1-based batch number. */
  batchNo: number;
  /** Number of sessions processed so far (analyzed + failed). */
  processed: number;
  /** Session ids processed in this batch (success or failure). */
  batchSessionIds: string[];
  /**
   * Subset of `batchSessionIds` that were actually re-analyzed by the LLM in
   * this batch (i.e. NOT a library cache hit). When empty, the batch is a
   * pure cache hit and the caller can skip merge work entirely.
   */
  freshlyAnalyzedSessionIds: string[];
};

export async function loadSession(
  session: TranscriptSession,
  deps: LoadDeps,
  options: LoadSessionOptions = {},
  hostArg?: AgentHost
): Promise<LoadedSession> {
  const host = hostArg ?? (await getActiveHost(deps.context));
  const progress = deps.progress;
  progress?.report(t("ui.progress.readTranscript", "Reading transcript…"));
  const content = await readSessionFile(session.filePath);
  const events = host.parseTranscript(content);
  mindMapLog(`[loadSession] session=${session.id} filePath=${session.filePath} contentLen=${content.length} events=${events.length}`);
  const settings = await readSettings(host);
  const signal = deps.signal ?? new AbortController().signal;
  // Freshness token: count of parsed user/assistant/tool events. Stable
  // against metadata-only appends (mode, ai-title, file-history-snapshot…)
  // that Claude Code writes on session resume; only changes when real
  // conversation turns are added.
  const transcriptFreshnessToken = String(events.length);
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
    progress?.report(
      t("ui.progress.checkLibraryCache", "Checking library cache…")
    );
    try {
      const existing = await readRecord(
        getStoreDir(),
        ctx.projectSlug,
        session.id
      );
      // Debug: surface freshness inputs so we can diagnose "why did this
      // session re-analyze even though I didn't change anything?"
      if (existing) {
        const recToken = recordFreshnessToken(existing);
        const tokenMatch = recToken === transcriptFreshnessToken;
        mindMapLog(
          `[loadSession] freshness check session=${session.id.slice(0, 8)} ` +
          `recordToken=${recToken.slice(0, 16)} currentToken=${transcriptFreshnessToken} ` +
          `tokenMatch=${tokenMatch} ` +
          `recordModel=${existing.meta.llm.model || "(default)"} currentModel=${settings.llm.model || "(default)"} ` +
          `recordProvider=${existing.meta.llm.provider} currentProvider=${settings.llm.provider} ` +
          `recordHost=${existing.meta.hostId || "(none)"} currentHost=${host.id} ` +
          `recordPipeline=${JSON.stringify(existing.meta.pipelineVersions || existing.meta.promptVersion)} ` +
          `currentPipeline=${JSON.stringify(currentPipelineVersions())}`
        );
      } else {
        mindMapLog(
          `[loadSession] freshness check session=${session.id.slice(0, 8)} no existing record in library`
        );
      }
      if (
        existing &&
        isRecordFresh(existing, {
          transcriptFreshnessToken,
          promptParams: {
            maxTopics: settings.llm.maxTopics,
            maxItemsPerTopic: settings.llm.maxItemsPerTopic,
          },
          promptVersion: PIPELINE_VERSION,
          pipelineVersions: currentPipelineVersions(),
          llm: {
            provider: settings.llm.provider,
            model: settings.llm.model || undefined,
          },
          hostId: host.id,
        })
      ) {
        const userQueryCount = countUserQueries(events);
        progress?.report(
          t("ui.progress.cacheHitRender", "Cache hit, generating mind map…")
        );
        const outline = sanitizeSessionOutline(
          existing.outline,
          userQueryCount
        );
        const analysisPrompt = buildSessionAnalysisPrompt(
          events,
          {
            maxDomains: Math.min(10, settings.llm.maxTopics),
            maxNodes: Math.max(6, settings.llm.maxTopics * 2),
            maxBranches: settings.llm.maxTopics,
            maxDetailsPerNode: settings.llm.maxItemsPerTopic,
          },
          host.id,
          projectPath
        );
        agentDebugLog(
          "sessionLoader.ts:loadSession",
          "library cache hit",
          {
            sessionId: session.id,
            projectSlug: ctx.projectSlug,
          },
          "F"
        );
        mindMapLog(
          `[loadSession] HIT library cache, no LLM call session=${session.id.slice(0, 8)}`
        );
        void dumpLlmReplay({
          stageId: "session-analysis",
          responseSchema: "session-analysis",
          providerId: settings.llm.provider,
          model: settings.llm.model || undefined,
          prompt: analysisPrompt,
          parsed:
            existing.sessionAnalysis ??
            ({ outline: existing.outline } as const),
          source: "library-cache",
          sessionId: session.id,
          projectSlug: ctx.projectSlug,
        });
        return {
          session: {
            ...session,
            hostId: host.id,
            projectSlug: ctx.projectSlug,
            projectPath,
          },
          mindMap: buildOutlineMindMap(
            outline,
            session.label,
            sessionMeta,
            existing.sessionAnalysis?.codeReferences,
            projectPath
          ),
          source: "topic",
          fromLibrary: true,
        };
      }
      if (existing) {
        mindMapLog(
          `[loadSession] MISS library cache session=${session.id.slice(0, 8)} → will call LLM`
        );
      }
    } catch (err) {
      agentLog.error("Library read failed", err);
    }
  }

  let pipelineResult;
  try {
    const provider = getProvider(settings.llm);
    mindMapLog(`[loadSession] Calling LLM for session ${session.id}: provider=${provider.id}, model=${settings.llm.model || "(default)"}, hostId=${host.id}`);
    pipelineResult = await runSessionPipeline(
      {
        events,
        sessionId: session.id,
        projectSlug: ctx.projectSlug,
        projectPath,
        prompt: {
          maxDomains: Math.min(10, settings.llm.maxTopics),
          maxTerms: Math.max(6, settings.llm.maxTopics * 2),
          maxEvidencePerTerm: 4,
          maxBranches: settings.llm.maxTopics,
          maxDetailsPerNode: settings.llm.maxItemsPerTopic,
        },
        modelHint: settings.llm.model || undefined,
        cacheDir: getCacheDir(deps.context),
        cache: settings.cache,
        hostId: host.id,
        storeDir: getStoreDir(),
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
    const llmErrorCode =
      err instanceof LlmProviderError ? err.code : undefined;
    if (!options.quietLlmErrors) {
      if (cliMissing) {
        void showCliInstallGuide(host.id, { modal: false });
      } else {
        notifyWarning(
          t(
            "ui.llm.failed.message",
            "Agent Mind Map: LLM summarization failed ({0}). {1}",
            detail,
            t("ui.llm.failed.fallback", "Falling back to chronological view.")
          )
        );
      }
    }
    agentLog.warn("LLM failure, using turn fallback", { error: String(err) });
    mindMapLog(`[loadSession] LLM failed for session ${session.id}, falling back to turn view. Error: ${err instanceof Error ? err.message : String(err)}`);
    return {
      session: { ...session, hostId: host.id },
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label,
        sessionMeta
      ),
      source: "turn",
      llmErrorCode,
    };
  }

  const userQueryCount = countUserQueries(events);
  let outline = sanitizeSessionOutline(pipelineResult.outline, userQueryCount);

  // Await background codeReferences extraction before rendering and persisting
  const codeRefs = await pipelineResult.codeRefsPromise;
  if (codeRefs?.length) {
    pipelineResult.sessionAnalysis.codeReferences = codeRefs;
  }

  progress?.report(t("ui.progress.renderMindMap", "Rendering mind map…"));

  if (settings.library.enabled) {
    progress?.report(t("ui.progress.writeLibrary", "Writing to library…"));
    try {
      const meta = buildRecordMeta({
        sessionId: session.id,
        projectSlug: ctx.projectSlug,
        projectPath,
        transcriptPath: session.filePath,
        transcriptMtimeMs,
        transcriptFreshnessToken,
        llm: {
          provider: settings.llm.provider,
          model: settings.llm.model || undefined,
        },
        promptParams: {
          maxTopics: settings.llm.maxTopics,
          maxItemsPerTopic: settings.llm.maxItemsPerTopic,
        },
        promptVersion: PIPELINE_VERSION,
        pipelineVersions: pipelineResult.pipelineVersions,
        sessionLabel: session.label,
        hostId: host.id,
        userQueryCount,
      });
      const record = buildSessionRecord(meta, outline, {
        sessionAnalysis: pipelineResult.sessionAnalysis,
        conceptExtract: pipelineResult.conceptExtract,
        sessionSynonyms: pipelineResult.sessionSynonyms,
        treeSnapshot: pipelineResult.treeSnapshot,
        conceptContexts: pipelineResult.conceptContexts,
      });
      const storeDir = getStoreDir();
      await writeRecord(storeDir, record);

      if (
        settings.library.autoRebuildDeterministic &&
        !options.skipAutoMerge
      ) {
        const runMerge = async () => {
          try {
            const all = await listRecords(storeDir);
            await rebuildIndex(storeDir, all);
            const merge = await buildDeterministicMergeRecordAsync(all);
            await writeMergeRecord(deterministicMergePath(storeDir), merge);
            const provider = getProvider(settings.llm);
            const config = vscode.workspace.getConfiguration("agentMindmap");
            const incrementalOntology =
              (config.get<boolean>("library.batchRefineOntology", true) ??
                true) &&
              (config.get<boolean>(
                "library.incrementalOntologyOnSessionAdd",
                true
              ) ?? true);
            const conceptLlm = {
              providerId: provider.id,
              model: settings.llm.model,
              hostId: host.id,
            };
            const projectSlug = ctx.projectSlug;
            const projectRecords = all.filter(
              (r) => r.meta.projectSlug === projectSlug
            );
            const records = projectRecords.length ? projectRecords : all;
            const hierarchyBase = {
              storeDir,
              projectSlug,
              allRecords: records,
              provider,
              providerId: provider.id,
              model: settings.llm.model,
              hostId: host.id,
              signal: AbortSignal.timeout(10 * 60 * 1000),
            };
            const concept = incrementalOntology
              ? await (async () => {
                  const manifest = await readSnapshotManifest(
                    storeDir,
                    projectSlug
                  );
                  if (manifest?.sessionToLeafId[record.meta.sessionId]) {
                    return (
                      await refreshSnapshotForSession({
                        ...hierarchyBase,
                        sessionId: record.meta.sessionId,
                      })
                    ).merge;
                  }
                  const batchNo =
                    (manifest?.nodes.filter((n) => n.level === 1).length ??
                      0) + 1;
                  return (
                    await runBatchSnapshotPipeline({
                      ...hierarchyBase,
                      batchRecords: [record],
                      batchNo,
                    })
                  ).merge;
                })()
              : await resolveAndBuildConceptMergeAsync(
                  storeDir,
                  all,
                  {},
                  conceptLlm
                );
            await writeMergeRecord(conceptTrieMergePath(storeDir), concept);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            agentLog.error("Background merge rebuild failed", err);
            notifyError(
              `Agent Mind Map: Background concept merge failed: ${detail}`,
              err
            );
          }
        };
        // Deduplicate: if a previous merge is still running, chain after it
        pendingMergeRebuild = pendingMergeRebuild
          ? pendingMergeRebuild.then(runMerge)
          : runMerge();
      }
    } catch (err) {
      agentLog.error("Library write failed", err);
    }
  }

  return {
    session: {
      ...session,
      hostId: host.id,
      projectSlug: ctx.projectSlug,
      projectPath,
    },
    mindMap: buildOutlineMindMap(
      outline,
      session.label,
      sessionMeta,
      pipelineResult.sessionAnalysis?.codeReferences,
      projectPath
    ),
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

export async function runProjectSessionBatch(
  sessions: TranscriptSession[],
  projectSlug: string,
  host: AgentHost,
  deps: LoadDeps,
  options: AnalyzeProjectOptions = {}
): Promise<AnalyzeProjectResult> {
  const loadOne = options.loadSessionFn ?? loadSession;
  const forceRefresh = options.forceRefresh ?? false;
  const skipAutoMerge = options.skipAutoMerge ?? true;
  const progress = deps.progress;
  const total = sessions.length;
  let analyzed = 0;
  let skippedFresh = 0;
  let turnFallbacks = 0;
  let cliMissingCount = 0;
  let jsonParseFailures = 0;
  let failed = 0;
  const failures: AnalyzeProjectResult["failures"] = [];

  progress?.report(
    t(
      "ui.batch.progress.start",
      "{0} session(s) total, starting batch analysis…",
      total
    )
  );

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    const { progress: itemProgress, reportComplete } = createBatchItemProgress(
      progress,
      i,
      total,
      session.label
    );
    itemProgress.report(t("ui.batch.item.start", "Start analyzing"));
    try {
      const loaded = await loadOne(
        session,
        { ...deps, progress: itemProgress },
        { forceRefresh, skipAutoMerge, quietLlmErrors: true },
        host
      );
      analyzed += 1;
      if (loaded.fromLibrary) {
        skippedFresh += 1;
        reportComplete(t("ui.batch.item.cacheHit", "Cache hit"));
      } else if (loaded.source === "turn") {
        turnFallbacks += 1;
        if (loaded.llmErrorCode === "cli-missing") {
          cliMissingCount += 1;
        } else if (loaded.llmErrorCode === "bad-json") {
          jsonParseFailures += 1;
        }
        reportComplete(
          t("ui.batch.item.fallbackTurnView", "Fell back to chronological view")
        );
      } else {
        reportComplete(t("ui.batch.item.done", "Analysis completed"));
      }
    } catch (err) {
      if (isCancellation(err)) {
        throw err;
      }
      failed += 1;
      failures.push({
        sessionId: session.id,
        label: session.label,
        message: describeError(err),
      });
      reportComplete(t("ui.batch.item.failed", "Analysis failed"));
      agentLog.warn(`Batch analyze failed for ${session.id}`, { error: String(err) });
    }
  }

  if (total > 0) {
    progress?.report(
      t(
        "ui.batch.progress.finished",
        "Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed",
        total,
        analyzed,
        skippedFresh,
        failed
      )
    );
  }

  return {
    projectSlug,
    total,
    analyzed,
    skippedFresh,
    turnFallbacks,
    cliMissingCount,
    jsonParseFailures,
    failed,
    failures,
  };
}

export async function runProjectSessionBatches(
  sessions: TranscriptSession[],
  projectSlug: string,
  host: AgentHost,
  deps: LoadDeps,
  options: AnalyzeProjectOptions & {
    batchSize?: number;
    onBatchDone?: (info: AnalyzeProjectBatchInfo) => Promise<void> | void;
  } = {}
): Promise<AnalyzeProjectResult> {
  const loadOne = options.loadSessionFn ?? loadSession;
  const forceRefresh = options.forceRefresh ?? false;
  const skipAutoMerge = options.skipAutoMerge ?? true;
  const progress = deps.progress;
  const total = sessions.length;
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 5));
  const onBatchDone = options.onBatchDone;

  let analyzed = 0;
  let skippedFresh = 0;
  let turnFallbacks = 0;
  let cliMissingCount = 0;
  let jsonParseFailures = 0;
  let failed = 0;
  const failures: AnalyzeProjectResult["failures"] = [];

  progress?.report(
    t(
      "ui.batch.progress.start",
      "{0} session(s) total, starting batch analysis…",
      total
    )
  );

  let batchNo = 0;
  let batchSessionIds: string[] = [];
  let freshlyAnalyzedSessionIds: string[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    batchSessionIds.push(session.id);
    const { progress: itemProgress, reportComplete } = createBatchItemProgress(
      progress,
      i,
      total,
      session.label
    );
    itemProgress.report(t("ui.batch.item.start", "Start analyzing"));
    try {
      const loaded = await loadOne(
        session,
        { ...deps, progress: itemProgress },
        { forceRefresh, skipAutoMerge, quietLlmErrors: true },
        host
      );
      analyzed += 1;
      if (loaded.fromLibrary) {
        skippedFresh += 1;
        reportComplete(t("ui.batch.item.cacheHit", "Cache hit"));
      } else if (loaded.source === "turn") {
        turnFallbacks += 1;
        if (loaded.llmErrorCode === "cli-missing") {
          cliMissingCount += 1;
        } else if (loaded.llmErrorCode === "bad-json") {
          jsonParseFailures += 1;
        }
        reportComplete(
          t("ui.batch.item.fallbackTurnView", "Fell back to chronological view")
        );
      } else {
        // source === "topic" and not from library → real LLM analysis ran
        freshlyAnalyzedSessionIds.push(session.id);
        reportComplete(t("ui.batch.item.done", "Analysis completed"));
      }
    } catch (err) {
      if (isCancellation(err)) {
        throw err;
      }
      failed += 1;
      failures.push({
        sessionId: session.id,
        label: session.label,
        message: describeError(err),
      });
      reportComplete(t("ui.batch.item.failed", "Analysis failed"));
      agentLog.warn(`Batch analyze failed for ${session.id}`, { error: String(err) });
    }

    const processed = analyzed + failed;
    const completedBatch = processed > 0 && processed % batchSize === 0;
    const finishedAll = processed === total;
    if ((completedBatch || finishedAll) && onBatchDone) {
      batchNo += 1;
      await onBatchDone({
        projectSlug,
        total,
        analyzed,
        skippedFresh,
        turnFallbacks,
        cliMissingCount,
        jsonParseFailures,
        failed,
        failures,
        batchNo,
        processed,
        batchSessionIds,
        freshlyAnalyzedSessionIds,
      });
      batchSessionIds = [];
      freshlyAnalyzedSessionIds = [];
    }
  }

  if (total > 0) {
    progress?.report(
      t(
        "ui.batch.progress.finished",
        "Batch finished: {0} total, {1} succeeded, {2} cached, {3} failed",
        total,
        analyzed,
        skippedFresh,
        failed
      )
    );
  }

  return {
    projectSlug,
    total,
    analyzed,
    skippedFresh,
    turnFallbacks,
    cliMissingCount,
    jsonParseFailures,
    failed,
    failures,
  };
}

export async function analyzeProjectSessions(
  deps: LoadDeps,
  options: AnalyzeProjectOptions = {}
): Promise<AnalyzeProjectResult | undefined> {
  const host = await getActiveHost(deps.context);
  const listed = await listWorkspaceSessions(host);
  if (!listed) {
    return undefined;
  }
  const { scanDir, sessions } = listed;
  const slug = getWorkspaceSlug(host);
  if (!slug) {
    vscode.window.showWarningMessage(
      t(
        "ui.warning.openWorkspaceFolderFirst",
        "Agent Mind Map: Open a workspace folder first."
      )
    );
    return undefined;
  }
  if (!sessions.length) {
    notifyWarning(host.emptyTranscriptsHint(scanDir));
    return undefined;
  }

  if (options.onBatchDone || options.batchSize !== undefined) {
    return runProjectSessionBatches(sessions, slug, host, deps, options);
  }
  return runProjectSessionBatch(sessions, slug, host, deps, options);
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
