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
  isRecordPipelineFresh,
  recordFreshnessToken,
  buildRecordMeta,
  buildSessionRecord,
  enqueueCodeRefUpdate,
  drainCodeRefQueue,
  LlmProviderError,
  ensureStore,
  computeTurnHashes,
  listVirtualSessions,
  buildStoredTurnHashes,
  detectTurnDelta,
  sliceEventsByTurns,
  buildContextPrimerFromRecords,
  nextVirtualSessionIndex,
  virtualSessionId,
  readMergedSessionRecord,
  type VirtualSessionContextPrimer,
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
      maxTurnsPerChunk?: number;
    };
    modelHint?: string;
    cacheDir?: string;
    cache: boolean;
    hostId?: AgentHostId;
    storeDir?: string;
    outputLanguage?: OutputLanguage;
    /** If set, S1 runs as virtual session analysis (delta turns of a parent). */
    virtualSession?: {
      contextPrimer: VirtualSessionContextPrimer;
      startTurnIndex: number;
    };
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
  /**
   * Refresh MCP server's project index after a write (optional).
   * Called when the session record is actually written to the store
   * (not on cache-hit early returns) so the MCP server's in-memory
   * index cache invalidates and subsequent searches see the new session.
   */
  refreshMcpIndex?: (projectSlug: string) => Promise<void>;
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
      maxAttempts: Math.max(1, Math.min(10, config.get<number>("llm.maxAttempts") ?? 2)),
      retryBackoffMs: Math.max(
        0,
        Math.min(30000, config.get<number>("llm.retryBackoffMs") ?? 1000)
      ),
      maxTopics: Math.max(1, config.get<number>("maxTopics") ?? 6),
      maxItemsPerTopic: Math.max(1, config.get<number>("maxItemsPerTopic") ?? 6),
      maxTurnsPerChunk: Math.max(0, config.get<number>("llm.maxTurnsPerChunk") ?? 12) || undefined,
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

  // ── Empty transcript — skip LLM, go straight to turn fallback ──────────
  if (events.length === 0) {
    deps.logger.info(
      `[analyzeSession] session=${session.id.slice(0, 8)} has 0 events, skipping LLM`
    );
    const outputLanguage = resolveOutputLanguageForEvents(events);
    const ctx = resolveSessionContext(session, host);
    const projectPath = ctx.projectPath ?? host.slugToWorkspacePath(ctx.projectSlug);
    const sessionMeta: SessionMeta = {
      sessionId: session.id,
      projectSlug: ctx.projectSlug,
      projectPath,
      sessionLabel: session.label,
      transcriptPath: session.filePath,
    };
    const settings = readSettingsFromConfig(deps.configStore, host);
    const loadedSession: LoadedSession = {
      session: { ...session, hostId: host.id, projectSlug: ctx.projectSlug, projectPath },
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label,
        sessionMeta,
        outputLanguage
      ),
      source: "turn",
      llmErrorCode: "empty",
    };
    return { result: loadedSession, completed: () => Promise.resolve() };
  }

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
  const currentTurnHashes = computeTurnHashes(events);

  // ── Virtual session delta detection ─────────────────────────────────────
  // If the original session has `meta.turnHashes` and the pipeline hasn't
  // changed, we can analyze just the new turns (delta) as a new virtual
  // session instead of re-analyzing the whole transcript. See
  // `plans/virtual-session-incremental-analysis.md` (D1=A, D2=B, D3=A+B).
  type VirtualSessionPlan = {
    startTurnIndex: number;
    endTurnIndex: number;
    contextPrimer: VirtualSessionContextPrimer;
    virtualIndex: number;
    newEvents: ChatEvent[];
  };
  let virtualSessionPlan: VirtualSessionPlan | null = null;

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
        // Use merged view (original + virtual sessions) so the user sees the
        // full outline even when the original record only covers turns [0, K).
        const merged =
          (await readMergedSessionRecord(store, ctx.projectSlug, session.id)) ?? existing;
        const userQueryCount = countUserQueries(events);
        progress.report("Cache hit, generating mind map…");
        const outline = sanitizeSessionOutline(merged.outline, userQueryCount);

        const retryCodeRefs = needsCodeRefRetry(merged.sessionAnalysis?.codeReferences);
        const backgroundWork: Promise<void>[] = [];

        if (retryCodeRefs) {
          const provider = deps.getProvider(settings.llm);
          enqueueCodeRefUpdate({
            sessionId: merged.meta.sessionId,
            projectSlug: merged.meta.projectSlug,
            projectPath: merged.meta.projectPath,
            sessionLabel: merged.meta.sessionLabel,
            transcriptPath: merged.meta.transcriptPath,
            events,
            outline: merged.outline,
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
          deps.clearPendingMindMapIfForSession?.(merged.meta.projectSlug, merged.meta.sessionId);
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
            merged.sessionAnalysis?.codeReferences,
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

  // ── Virtual session delta detection (fallback when isRecordFresh fails) ─
  // isRecordFresh returns false when transcriptFreshnessToken (event count)
  // mismatches. If the original session has turnHashes and the pipeline is
  // otherwise fresh, we can analyze just the new turns as a virtual session.
  if (settings.library.enabled && !options.forceRefresh && !virtualSessionPlan) {
    try {
      const store = await deps.storeAccess.getStore();
      const existing = await store.getRecord(ctx.projectSlug, session.id);
      if (existing?.meta.turnHashes?.length) {
        const pipelineFresh = isRecordPipelineFresh(existing, {
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
        });
        if (pipelineFresh) {
          const priorVirtuals = await listVirtualSessions(store, ctx.projectSlug, session.id);
          const storedHashes = buildStoredTurnHashes(existing, priorVirtuals);
          if (storedHashes) {
            const delta = detectTurnDelta(storedHashes, currentTurnHashes);
            if (delta.kind === "fresh") {
              // Token mismatched (e.g. metadata-only events added) but turn
              // content is unchanged. Treat as cache hit - return merged view
              // (original + any prior virtual sessions).
              deps.logger.info(
                `[analyzeSession] virtual delta=fresh session=${session.id.slice(0, 8)}`
              );
              const merged =
                (await readMergedSessionRecord(store, ctx.projectSlug, session.id)) ?? existing;
              const userQueryCount = countUserQueries(events);
              const outline = sanitizeSessionOutline(merged.outline, userQueryCount);
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
                  merged.sessionAnalysis?.codeReferences,
                  projectPath,
                  outputLanguage
                ),
                source: "topic",
                fromLibrary: true,
              };
              return {
                result: loadedSession,
                completed: () => Promise.resolve(),
              };
            } else if (delta.kind === "append") {
              const newEvents = sliceEventsByTurns(
                events,
                delta.startTurnIndex,
                currentTurnHashes.length
              );
              if (newEvents.length > 0) {
                deps.logger.info(
                  `[analyzeSession] virtual delta=append session=${session.id.slice(0, 8)} ` +
                    `startTurn=${delta.startTurnIndex} newTurns=${currentTurnHashes.length - delta.startTurnIndex}`
                );
                virtualSessionPlan = {
                  startTurnIndex: delta.startTurnIndex,
                  endTurnIndex: currentTurnHashes.length,
                  contextPrimer: buildContextPrimerFromRecords(existing, priorVirtuals),
                  virtualIndex: nextVirtualSessionIndex(priorVirtuals),
                  newEvents,
                };
              }
            }
            // "edit" falls through to full re-analysis
          }
        }
      }
    } catch (err) {
      deps.logger.error("Virtual session detection failed", err);
    }
  }

  // ── Run LLM pipeline ───────────────────────────────────────────────────
  const provider = deps.getProvider(settings.llm);
  let pipelineResult: SessionPipelineResult;
  const backgroundWork: Promise<void>[] = [];

  try {
    deps.logger.info(
      `[analyzeSession] Calling LLM for session ${session.id}: provider=${provider.id}` +
        (virtualSessionPlan ? ` (virtual #${virtualSessionPlan.virtualIndex})` : "")
    );
    pipelineResult = await deps.runSessionPipeline(
      {
        events: virtualSessionPlan?.newEvents ?? events,
        sessionId: session.id,
        projectSlug: ctx.projectSlug,
        projectPath,
        prompt: {
          maxDomains: Math.min(10, settings.llm.maxTopics),
          maxTerms: Math.max(6, settings.llm.maxTopics * 2),
          maxEvidencePerTerm: 4,
          maxBranches: settings.llm.maxTopics,
          maxDetailsPerNode: settings.llm.maxItemsPerTopic,
          maxTurnsPerChunk: settings.llm.maxTurnsPerChunk,
        },
        modelHint: settings.llm.model || undefined,
        cacheDir,
        cache: useLlmCache,
        hostId: host.id,
        storeDir,
        outputLanguage,
        virtualSession: virtualSessionPlan
          ? {
              contextPrimer: virtualSessionPlan.contextPrimer,
              startTurnIndex: virtualSessionPlan.startTurnIndex,
            }
          : undefined,
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
    deps.logger.warn(`LLM failure, using turn fallback`, {
      error: String(err),
      code: llmErrorCode,
      cliCapture:
        err instanceof LlmProviderError && err.cliCapture
          ? {
              stdout: err.cliCapture.stdout.slice(0, 2000),
              stderr: err.cliCapture.stderr.slice(0, 2000),
            }
          : undefined,
    });

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
      const isVirtual = virtualSessionPlan !== null;
      const recordSessionId = isVirtual
        ? virtualSessionId(session.id, virtualSessionPlan!.virtualIndex)
        : session.id;
      const meta = buildRecordMeta({
        sessionId: recordSessionId,
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
        // Virtual-session metadata (D2 = B). Original sessions set `turnHashes`
        // so future runs can detect deltas; virtual sessions additionally set
        // parentSessionId / virtualSessionIndex / turn range.
        turnHashes: isVirtual
          ? currentTurnHashes.slice(
              virtualSessionPlan!.startTurnIndex,
              virtualSessionPlan!.endTurnIndex
            )
          : currentTurnHashes,
        ...(isVirtual
          ? {
              parentSessionId: session.id,
              virtualSessionIndex: virtualSessionPlan!.virtualIndex,
              startTurnIndex: virtualSessionPlan!.startTurnIndex,
              endTurnIndex: virtualSessionPlan!.endTurnIndex,
            }
          : {}),
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

      // Enqueue code refs (use the events the LLM actually saw)
      if (pipelineResult.initialCodeReferences?.length) {
        enqueueCodeRefUpdate({
          sessionId: recordSessionId,
          projectSlug: ctx.projectSlug,
          projectPath,
          sessionLabel: session.label,
          transcriptPath: session.filePath,
          events: virtualSessionPlan?.newEvents ?? events,
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

      // Background deterministic + concept merge rebuild. For virtual
      // sessions, the original session's leaf is frozen; the new virtual
      // session enters batch merge as a normal new record (D4 = C).
      if (settings.library.autoRebuildDeterministic && !options.skipAutoMerge) {
        backgroundWork.push(
          deps.runBackgroundMerge({
            storeDir,
            projectSlug: ctx.projectSlug,
            sessionId: recordSessionId,
            record,
            events: virtualSessionPlan?.newEvents ?? events,
            settings,
            host,
            signal,
          })
        );
      }

      // Invalidate MCP server's in-memory index cache now that a new record
      // is in the store. Bounded to the write branch (cache hits above return
      // without writing, so they must not bump the revision either).
      if (deps.refreshMcpIndex) {
        backgroundWork.push(deps.refreshMcpIndex(ctx.projectSlug));
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
