/**
 * `analyzeSession` use case — analyze a single agent chat session.
 *
 * Orchestrates: read transcript → check cache → run LLM pipeline → write to
 * library → enqueue code refs → background merge rebuild.
 *
 * Returns an `AnalysisHandle` where:
 * - `result` is the `LoadedSession` (available after foreground work).
 * - `completed()` resolves when ALL background work (code-ref queue drain,
 *   deterministic/concept merge rebuild) finishes.
 *
 * The extension adapter passes a no-op `completed()` awaiter (fire-and-forget)
 * so the panel stays open while the queue drains in the background. The CLI
 * adapter awaits `completed()` before returning so the persisted artifact is
 * the post-drain version.
 */
import * as fs from "fs/promises";
import * as path from "path";
import {
  readSessionFile,
  sanitizeSessionOutline,
  buildOutlineMindMap,
  buildTurnMindMap,
  countUserQueries,
  currentPipelineVersions,
  PIPELINE_VERSION,
  resolveOutputLanguageForEvents,
  isRecordFresh,
  recordFreshnessToken,
  buildRecordMeta,
  buildSessionRecord,
  enqueueCodeRefUpdate,
  drainCodeRefQueue,
  LlmProviderError,
  ensureStore,
} from "../index";
import type { Logger } from "../ports/Logger";
import type { ProgressReporter } from "../ports/ProgressReporter";
import type { ConfigStore } from "../ports/ConfigStore";
import type { StoreAccess } from "../ports/StoreAccess";
import type { HostAccess } from "../ports/HostAccess";
import type { MindMapSink } from "../ports/MindMapSink";
import type { CodeRefQueueDeps } from "../ports/CodeRefQueueDeps";
import type { LlmDumpDeps } from "../ports/LlmDumpDeps";
import type { AgentHost, AgentHostId } from "../host/types";
import type {
  TranscriptSession,
  ChatEvent,
  BuildOptions,
  SessionMeta,
  LlmProviderId,
  LlmProviderOptions,
  LlmProvider,
  OutputLanguage,
  SessionAnalysis,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  SessionOutline,
  CodeReference,
} from "../index";
import type { ConceptContextForMerge } from "../store/storeTypes";
import type { AnalysisHandle, LoadedSession, LoadSessionOptions } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Deps interface
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pipeline function type — the extension provides the actual implementation
 * (which calls `runSessionPipeline` from extension/src/pipeline/). The CLI
 * will provide its own once pipeline modules are moved to core.
 */
export type RunSessionPipelineFn = (
  opts: {
    events: ChatEvent[];
    sessionId: string;
    projectSlug: string;
    projectPath?: string;
    prompt: {
      maxDomains: number;
      maxTerms: number;
      maxEvidencePerTerm: number;
      maxBranches: number;
      maxDetailsPerNode: number;
    };
    modelHint?: string;
    cacheDir?: string;
    cache: boolean;
    hostId?: AgentHostId;
    storeDir?: string;
    outputLanguage?: OutputLanguage;
  },
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
) => Promise<SessionPipelineResult>;

/**
 * Result of `runSessionPipeline`. Declared here because the actual type is in
 * extension/src/pipeline/sessionPipeline.ts which hasn't moved to core yet.
 */
export type SessionPipelineResult = {
  sessionAnalysis: SessionAnalysis;
  outline: SessionOutline;
  pipelineVersions: ReturnType<typeof currentPipelineVersions>;
  initialCodeReferences?: CodeReference[];
  conceptExtract: SessionConceptExtract;
  sessionSynonyms: SessionSynonymRefine;
  treeSnapshot: SessionTreeSnapshot;
  conceptContexts: ConceptContextForMerge[];
};

/**
 * Background merge rebuild function — the extension provides the actual
 * implementation which calls `buildDeterministicMergeRecordAsync`,
 * `resolveAndBuildConceptMergeAsync`, `runBatchSnapshotPipeline`, etc.
 */
export type RunBackgroundMergeFn = (opts: {
  storeDir: string;
  projectSlug: string;
  sessionId: string;
  record: import("../store/storeTypes").SessionRecord;
  events: ChatEvent[];
  settings: Settings;
  host: AgentHost;
  signal: AbortSignal;
}) => Promise<void>;

/**
 * Sanitize a session record — the extension injects the host's parseTranscript.
 */
export type SanitizeSessionRecordFn = (
  record: import("../store/storeTypes").SessionRecord
) => Promise<import("../store/storeTypes").SessionRecord>;

export type AnalyzeSessionDeps = {
  logger: Logger;
  progress: ProgressReporter;
  configStore: ConfigStore;
  storeAccess: StoreAccess;
  hostAccess: HostAccess;
  mindMapSink: MindMapSink;
  codeRefDeps: CodeRefQueueDeps;
  llmDumpDeps: LlmDumpDeps;
  /** The session pipeline runner (provided by extension adapter). */
  runSessionPipeline: RunSessionPipelineFn;
  /** Background merge rebuild (provided by extension adapter). */
  runBackgroundMerge: RunBackgroundMergeFn;
  /** Sanitize a record (injects host's parseTranscript). */
  sanitizeSessionRecord: SanitizeSessionRecordFn;
  /** Get the LLM provider from settings. */
  getProvider: (opts: LlmProviderOptions) => LlmProvider;
  /** LLM IO dump callback (optional). */
  dumpLlmReplay?: (opts: unknown) => void;
  /** Show CLI install guide (optional, extension-specific). */
  showCliInstallGuide?: (hostId: string, opts: { modal: boolean }) => Promise<void>;
  /** Clear pending mind map for a session (optional). */
  clearPendingMindMapIfForSession?: (projectSlug: string, sessionId: string) => void;
  signal?: AbortSignal;
};

// ────────────────────────────────────────────────────────────────────────────
// Settings type + resolver
// ────────────────────────────────────────────────────────────────────────────

export type Settings = {
  llm: LlmProviderOptions;
  cache: boolean;
  library: {
    enabled: boolean;
    autoRebuildDeterministic: boolean;
  };
  turnOptions: BuildOptions;
};

function resolveLlmProviderId(setting: string, hostDefault: LlmProviderId): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

/**
 * Read settings from the ConfigStore port instead of vscode.workspace.getConfiguration.
 */
export function readSettingsFromConfig(config: ConfigStore, host: AgentHost): Settings {
  const providerSetting = config.get<string>("llm.provider") ?? "auto";
  const provider = resolveLlmProviderId(providerSetting, host.defaultLlmProvider);

  return {
    llm: {
      provider,
      cliPath: (config.get<string>("llm.cliPath") ?? "").trim(),
      model: (config.get<string>("llm.model") ?? "").trim(),
      timeoutMs: Math.max(1000, config.get<number>("llm.timeoutMs") ?? 300000),
      maxAttempts: Math.max(1, Math.min(10, config.get<number>("llm.maxAttempts") ?? 1)),
      retryBackoffMs: Math.max(
        0,
        Math.min(30000, config.get<number>("llm.retryBackoffMs") ?? 1000)
      ),
      maxTopics: Math.max(1, config.get<number>("maxTopics") ?? 6),
      maxItemsPerTopic: Math.max(1, config.get<number>("maxItemsPerTopic") ?? 6),
      hostId: host.id,
    },
    cache: config.get<boolean>("cacheLlmResult") ?? true,
    library: {
      enabled: config.get<boolean>("library.enabled") ?? true,
      autoRebuildDeterministic: config.get<boolean>("merge.autoRebuildDeterministic") ?? true,
    },
    turnOptions: {
      includeToolCalls: config.get<boolean>("includeToolCalls") ?? true,
      maxConclusionItems: config.get<number>("maxConclusionItems") ?? 8,
    },
  };
}

function getCacheDir(config: ConfigStore, storeDir: string): string {
  const override = (config.get<string>("llm.cacheDir") ?? "").trim();
  if (override) {
    return override;
  }
  return path.join(storeDir, "llm-cache");
}

function needsCodeRefRetry(refs: { llmStatus?: string }[] | undefined): boolean {
  return Boolean(refs?.some((ref) => ref.llmStatus === "pending" || ref.llmStatus === "failed"));
}

// ────────────────────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────────────────────

async function tryStatMtime(filePath: string, fallback: number): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return fallback;
  }
}

function resolveSessionContext(
  session: TranscriptSession,
  host: AgentHost
): { projectSlug: string; projectPath?: string } {
  if (session.projectSlug) {
    return { projectSlug: session.projectSlug, projectPath: session.projectPath };
  }
  return host.inferProjectFromTranscriptPath(session.filePath);
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

// ────────────────────────────────────────────────────────────────────────────
// Main use case
// ────────────────────────────────────────────────────────────────────────────

/**
 * Analyze a single agent chat session.
 *
 * Returns an `AnalysisHandle` where `result` is the `LoadedSession` and
 * `completed()` resolves when all background work finishes.
 */
export async function analyzeSession(
  session: TranscriptSession,
  deps: AnalyzeSessionDeps,
  options: LoadSessionOptions = {},
  hostArg?: AgentHost
): Promise<AnalysisHandle<LoadedSession>> {
  const host = hostArg ?? (await deps.hostAccess.getActiveHost());
  const progress = deps.progress;
  const signal = deps.signal ?? new AbortController().signal;

  progress.report("Reading transcript…");
  const content = await readSessionFile(session.filePath);
  const events = host.parseTranscript(content);
  deps.logger.info(`[analyzeSession] session=${session.id} events=${events.length}`);

  const settings = readSettingsFromConfig(deps.configStore, host);
  const useLlmCache = settings.cache && !options.forceRefresh;
  const outputLanguage = resolveOutputLanguageForEvents(events);
  const transcriptFreshnessToken = String(events.length);
  const transcriptMtimeMs = await tryStatMtime(session.filePath, session.mtimeMs);
  const ctx = resolveSessionContext(session, host);
  const projectPath = ctx.projectPath ?? host.slugToWorkspacePath(ctx.projectSlug);
  const sessionMeta: SessionMeta = {
    sessionId: session.id,
    projectSlug: ctx.projectSlug,
    projectPath,
    sessionLabel: session.label,
    transcriptPath: session.filePath,
  };
  const storeDir = deps.storeAccess.getStoreDir();
  const cacheDir = getCacheDir(deps.configStore, storeDir);

  // ── Library cache check ────────────────────────────────────────────────
  if (settings.library.enabled && !options.forceRefresh) {
    progress.report("Checking library cache…");
    try {
      const store = await deps.storeAccess.getStore();
      const existing = await store.getRecord(ctx.projectSlug, session.id);

      if (existing) {
        const recToken = recordFreshnessToken(existing);
        deps.logger.info(
          `[analyzeSession] freshness check session=${session.id.slice(0, 8)} ` +
            `tokenMatch=${recToken === transcriptFreshnessToken}`
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
          outputLanguage,
        })
      ) {
        // ── Cache hit ─────────────────────────────────────────────────────
        const userQueryCount = countUserQueries(events);
        progress.report("Cache hit, generating mind map…");
        const outline = sanitizeSessionOutline(existing.outline, userQueryCount);

        const retryCodeRefs = needsCodeRefRetry(existing.sessionAnalysis?.codeReferences);
        const backgroundWork: Promise<void>[] = [];

        if (retryCodeRefs) {
          const provider = deps.getProvider(settings.llm);
          enqueueCodeRefUpdate({
            sessionId: existing.meta.sessionId,
            projectSlug: existing.meta.projectSlug,
            projectPath: existing.meta.projectPath,
            sessionLabel: existing.meta.sessionLabel,
            transcriptPath: existing.meta.transcriptPath,
            events,
            outline: existing.outline,
            provider,
            model: settings.llm.model || undefined,
            cacheDir,
            cache: useLlmCache,
            timeoutMs: settings.llm.timeoutMs,
            storeDir,
            outputLanguage,
          });
          backgroundWork.push(drainCodeRefQueue());
        } else {
          deps.clearPendingMindMapIfForSession?.(
            existing.meta.projectSlug,
            existing.meta.sessionId
          );
        }

        const loadedSession: LoadedSession = {
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
            projectPath,
            outputLanguage
          ),
          source: "topic",
          fromLibrary: true,
        };

        return {
          result: loadedSession,
          completed: () => Promise.all(backgroundWork).then(() => {}),
        };
      }

      deps.logger.info(`[analyzeSession] MISS library cache session=${session.id.slice(0, 8)}`);
    } catch (err) {
      deps.logger.error("Library read failed", err);
    }
  }

  // ── Run LLM pipeline ───────────────────────────────────────────────────
  const provider = deps.getProvider(settings.llm);
  let pipelineResult: SessionPipelineResult;
  const backgroundWork: Promise<void>[] = [];

  try {
    deps.logger.info(
      `[analyzeSession] Calling LLM for session ${session.id}: provider=${provider.id}`
    );
    pipelineResult = await deps.runSessionPipeline(
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
        cacheDir,
        cache: useLlmCache,
        hostId: host.id,
        storeDir,
        outputLanguage,
      },
      provider,
      signal,
      progress
    );
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    const llmErrorCode = err instanceof LlmProviderError ? err.code : undefined;
    const cliMissing = err instanceof LlmProviderError && err.code === "cli-missing";

    if (!options.quietLlmErrors) {
      if (cliMissing) {
        deps.showCliInstallGuide?.(host.id, { modal: false });
      } else {
        deps.mindMapSink.showInfo(
          `LLM summarization failed (${describeError(err)}). Falling back to chronological view.`
        );
      }
    }
    deps.logger.warn(`LLM failure, using turn fallback`, { error: String(err) });

    const loadedSession: LoadedSession = {
      session: { ...session, hostId: host.id },
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label,
        sessionMeta,
        outputLanguage
      ),
      source: "turn",
      llmErrorCode,
    };
    return { result: loadedSession, completed: () => Promise.resolve() };
  }

  // ── Write to library ───────────────────────────────────────────────────
  const userQueryCount = countUserQueries(events);
  const outline = sanitizeSessionOutline(pipelineResult.outline, userQueryCount);

  if (pipelineResult.initialCodeReferences?.length) {
    pipelineResult.sessionAnalysis.codeReferences = pipelineResult.initialCodeReferences;
  }

  progress.report("Rendering mind map…");

  if (settings.library.enabled) {
    progress.report("Writing to library…");
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
        outputLanguage,
      });
      const record = buildSessionRecord(meta, outline, {
        sessionAnalysis: pipelineResult.sessionAnalysis,
        conceptExtract: pipelineResult.conceptExtract,
        sessionSynonyms: pipelineResult.sessionSynonyms,
        treeSnapshot: pipelineResult.treeSnapshot,
        conceptContexts: pipelineResult.conceptContexts,
      });

      await ensureStore(storeDir);
      const store = await deps.storeAccess.getStoreForDir(storeDir);
      await store.upsertRecord(record);

      // Enqueue code refs
      if (pipelineResult.initialCodeReferences?.length) {
        enqueueCodeRefUpdate({
          sessionId: session.id,
          projectSlug: ctx.projectSlug,
          projectPath,
          sessionLabel: session.label,
          transcriptPath: session.filePath,
          events,
          outline,
          provider,
          model: settings.llm.model || undefined,
          cacheDir,
          cache: useLlmCache,
          timeoutMs: settings.llm.timeoutMs,
          storeDir,
          outputLanguage,
        });
        backgroundWork.push(drainCodeRefQueue());
      }

      // Background deterministic + concept merge rebuild
      if (settings.library.autoRebuildDeterministic && !options.skipAutoMerge) {
        backgroundWork.push(
          deps.runBackgroundMerge({
            storeDir,
            projectSlug: ctx.projectSlug,
            sessionId: session.id,
            record,
            events,
            settings,
            host,
            signal,
          })
        );
      }
    } catch (err) {
      deps.logger.error("Library write failed", err);
    }
  }

  const loadedSession: LoadedSession = {
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
      projectPath,
      outputLanguage
    ),
    source: "topic",
  };

  return {
    result: loadedSession,
    completed: () => Promise.all(backgroundWork).then(() => {}),
  };
}
