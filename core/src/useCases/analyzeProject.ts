/**
 * `analyzeProject` use case — batch analyze all sessions in a project.
 *
 * Orchestrates: mode selection → scan sessions → batch analysis with
 * per-batch merge → final root refresh → code-ref queue drain.
 *
 * Returns an `AnalysisHandle` where:
 * - `result` is the `AnalyzeProjectResult`.
 * - `completed()` resolves when all background work (code-ref queue drain)
 *   finishes.
 *
 * The complex `onBatchDone` callback that drives per-batch concept merge
 * is captured within this use case. Surface-layer interactions are delegated
 * through ports (Logger, ProgressReporter, MindMapSink, Prompter).
 */
import {
  computeStableBatchPartition,
  computeBatchGroups,
  ensureStore,
  drainCodeRefQueue,
  purgeCodeRefQueueForProject,
  LlmProviderError,
} from "../index";
import { analyzeSession, readSettingsFromConfig, type AnalyzeSessionDeps } from "./analyzeSession";
import type { ProgressReporter } from "../ports/ProgressReporter";
import type { Prompter, QuickPickItem } from "../ports/Prompter";
import type { AgentHost, AgentHostId } from "../host/types";
import type { TranscriptSession, LlmProvider, LlmProviderId, OutputLanguage } from "../index";
import type { SessionRecord, SnapshotManifest } from "../store/storeTypes";
import type {
  AnalysisHandle,
  AnalyzeProjectResult,
  AnalyzeProjectBatchInfo,
  AnalyzeProjectOptions,
} from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Deps interface
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merge mode — full on batch 1, delta for batch 2+.
 * Matches the concrete type in extension/src/pipeline/deltaMergePipeline.ts.
 */
export type ProjectMergeMode = "full" | "delta";

/**
 * Per-batch merge function — the extension provides the actual implementation
 * which calls `buildProjectConceptMergeForBatch`, `refreshSnapshotsForFreshSessions`,
 * `runBatchSnapshotPipeline`, etc.
 */
export type RunBatchMergeFn = (opts: {
  storeDir: string;
  projectSlug: string;
  allRecords: SessionRecord[];
  batchRecords: SessionRecord[];
  batchNo: number;
  provider: LlmProvider;
  conceptLlm: {
    providerId: LlmProviderId;
    model?: string;
    hostId?: AgentHostId;
    outputLanguage?: OutputLanguage;
    timeoutMs?: number;
  };
  forceRefresh: boolean;
  forceReattach: boolean;
  batchRefineOntology: boolean;
  mergeMode: ProjectMergeMode;
  mergeFullReconcileEvery: number;
  leafAction?: string;
  leafId?: string;
  freshlyAnalyzedSessionIds: string[];
  signal: AbortSignal;
  progress: ProgressReporter;
}) => Promise<MergeRecord | undefined>;

/**
 * Final root refresh function.
 */
export type RunFinalRootRefreshFn = (opts: {
  storeDir: string;
  projectSlug: string;
  allRecords: SessionRecord[];
  provider: LlmProvider;
  conceptLlm: {
    providerId: LlmProviderId;
    model?: string;
    hostId?: AgentHostId;
    outputLanguage?: OutputLanguage;
  };
  signal: AbortSignal;
  progress: ProgressReporter;
}) => Promise<MergeRecord | undefined>;

/**
 * Clear project analysis cache.
 */
export type ClearProjectCacheFn = (storeDir: string, projectSlug: string) => Promise<void>;

/**
 * Resolve project records for merge (overlay in-memory cache with store).
 */
export type ResolveProjectRecordsFn = (
  storeDir: string,
  projectSlug: string,
  overlayById: Map<string, SessionRecord>
) => Promise<SessionRecord[]>;

/**
 * Read the snapshot manifest.
 */
export type ReadSnapshotManifestFn = (
  storeDir: string,
  projectSlug: string
) => Promise<SnapshotManifest | undefined>;

/**
 * Refresh MCP index for a project (optional, extension-specific).
 */
export type RefreshMcpIndexFn = (projectSlug: string) => Promise<void>;

/**
 * Merge record type — imported from shared but declared here for convenience.
 */
type MergeRecord = import("@agent-mindmap/shared").MergeRecord;

export type AnalyzeProjectDeps = AnalyzeSessionDeps & {
  prompter: Prompter;
  /** Per-batch concept merge. */
  runBatchMerge: RunBatchMergeFn;
  /** Final root refresh. */
  runFinalRootRefresh: RunFinalRootRefreshFn;
  /** Clear project analysis cache. */
  clearProjectCache: ClearProjectCacheFn;
  /** Resolve project records for merge. */
  resolveProjectRecords: ResolveProjectRecordsFn;
  /** Read snapshot manifest. */
  readSnapshotManifest: ReadSnapshotManifestFn;
  /** Sanitize a session record. */
  sanitizeSessionRecord: (record: SessionRecord) => Promise<SessionRecord>;
  /** Refresh MCP index (optional). */
  refreshMcpIndex?: RefreshMcpIndexFn;
};

// ────────────────────────────────────────────────────────────────────────────
// Mode selection
// ────────────────────────────────────────────────────────────────────────────

type AnalysisMode = { forceRefresh: boolean };

type ModePickItem = QuickPickItem & { forceRefresh: boolean };

async function pickAnalysisMode(prompter: Prompter): Promise<AnalysisMode | undefined> {
  const items: ModePickItem[] = [
    {
      label: "Skip cached sessions",
      description: "Only analyze transcripts missing or stale in the library",
      forceRefresh: false,
    },
    {
      label: "Force re-analyze all",
      description:
        "Clear this project's library, merge snapshots, and ontology cache, then re-run the LLM for every session",
      forceRefresh: true,
    },
  ];

  const picked = await prompter.showQuickPick(items, {
    placeHolder: "Batch analyze agent sessions in current project",
  });

  if (!picked || Array.isArray(picked)) {
    return undefined;
  }

  return { forceRefresh: (picked as ModePickItem).forceRefresh };
}

// ────────────────────────────────────────────────────────────────────────────
// Batch processing
// ────────────────────────────────────────────────────────────────────────────

function isCancellation(err: unknown): boolean {
  return err instanceof LlmProviderError && err.code === "cancelled";
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

async function runProjectSessionBatches(
  sessions: TranscriptSession[],
  projectSlug: string,
  host: AgentHost,
  deps: AnalyzeProjectDeps,
  options: AnalyzeProjectOptions & {
    batchSize?: number;
    onBatchDone?: (info: AnalyzeProjectBatchInfo) => Promise<void> | void;
  } = {}
): Promise<AnalyzeProjectResult> {
  const loadOne = analyzeSession;
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

  progress.report(`${total} session(s) total, starting batch analysis…`);

  // ── Stable batch partition ────────────────────────────────────────────
  const useStablePartition =
    !forceRefresh && options.snapshotManifest && options.snapshotManifest.nodes.length > 0;

  const partition = useStablePartition
    ? computeStableBatchPartition(sessions, options.snapshotManifest, { groupSize: batchSize })
    : undefined;

  const sessionLeafMap = new Map<string, { leafId: string; action: string }>();
  if (partition) {
    const groups = computeBatchGroups(partition);
    for (const g of groups) {
      sessionLeafMap.set(g.sessionId, { leafId: g.leafId, action: g.action });
    }
  }

  const analysisSessions = partition?.analysisOrder ?? sessions;

  const leafSessionCounts = new Map<string, { total: number; processed: number }>();
  const leafSessionIds = new Map<string, string[]>();
  const leafFreshlyAnalyzed = new Map<string, string[]>();

  if (partition) {
    for (const leaf of [
      ...partition.stableLeaves,
      ...partition.rebuildLeaves,
      ...partition.newLeaves,
    ]) {
      leafSessionCounts.set(leaf.leafId, { total: leaf.sessionIds.length, processed: 0 });
      leafSessionIds.set(leaf.leafId, []);
      leafFreshlyAnalyzed.set(leaf.leafId, []);
    }
  }

  let batchNo = 0;
  let legacyBatchSessionIds: string[] = [];
  let legacyFreshlyAnalyzedSessionIds: string[] = [];

  for (let i = 0; i < analysisSessions.length; i++) {
    const session = analysisSessions[i]!;
    const leafInfo = sessionLeafMap.get(session.id);

    progress.report(`${session.label}: Start analyzing`);
    try {
      const handle = await loadOne(
        session,
        { ...deps, signal: deps.signal ?? new AbortController().signal },
        { forceRefresh, skipAutoMerge, quietLlmErrors: true },
        host
      );
      const loaded = handle.result;
      analyzed += 1;
      if (loaded.fromLibrary) {
        skippedFresh += 1;
      } else if (loaded.source === "turn") {
        turnFallbacks += 1;
        if (loaded.llmErrorCode === "cli-missing") {
          cliMissingCount += 1;
        } else if (loaded.llmErrorCode === "bad-json") {
          jsonParseFailures += 1;
        }
      } else {
        // source === "topic" and not from library → real LLM analysis ran
        if (leafInfo) {
          leafFreshlyAnalyzed.get(leafInfo.leafId)?.push(session.id);
        } else {
          legacyFreshlyAnalyzedSessionIds.push(session.id);
        }
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
      deps.logger.warn(`Batch analyze failed for ${session.id}`, { error: String(err) });
    }

    // ── Batch boundary detection ──────────────────────────────────────
    if (leafInfo && partition) {
      const counts = leafSessionCounts.get(leafInfo.leafId);
      if (counts) {
        counts.processed += 1;
        leafSessionIds.get(leafInfo.leafId)?.push(session.id);

        if (counts.processed === counts.total && onBatchDone) {
          batchNo += 1;
          const processed = analyzed + failed;
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
            batchSessionIds: leafSessionIds.get(leafInfo.leafId) ?? [],
            freshlyAnalyzedSessionIds: leafFreshlyAnalyzed.get(leafInfo.leafId) ?? [],
            leafId: leafInfo.leafId,
            leafAction: leafInfo.action as AnalyzeProjectBatchInfo["leafAction"],
          });
          leafSessionIds.set(leafInfo.leafId, []);
          leafFreshlyAnalyzed.set(leafInfo.leafId, []);
        }
      }
    } else if (onBatchDone) {
      legacyBatchSessionIds.push(session.id);
      const processed = analyzed + failed;
      const completedBatch = processed > 0 && processed % batchSize === 0;
      const finishedAll = processed === total;
      if (completedBatch || finishedAll) {
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
          batchSessionIds: legacyBatchSessionIds,
          freshlyAnalyzedSessionIds: legacyFreshlyAnalyzedSessionIds,
        });
        legacyBatchSessionIds = [];
        legacyFreshlyAnalyzedSessionIds = [];
      }
    }
  }

  if (total > 0) {
    progress.report(
      `Batch finished: ${total} total, ${analyzed} succeeded, ${skippedFresh} cached, ${failed} failed`
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

// ────────────────────────────────────────────────────────────────────────────
// Main use case
// ────────────────────────────────────────────────────────────────────────────

/**
 * Analyze all sessions in the current project.
 *
 * Returns an `AnalysisHandle` where `result` is the `AnalyzeProjectResult`
 * and `completed()` resolves when all background work finishes.
 */
export async function analyzeProject(
  deps: AnalyzeProjectDeps,
  options: AnalyzeProjectOptions = {}
): Promise<AnalysisHandle<AnalyzeProjectResult>> {
  // options is reserved for future CLI flags (forceRefresh, etc.)
  void options;
  const host = await deps.hostAccess.getActiveHost();
  const slug = deps.hostAccess.getWorkspaceSlug(host);
  if (!slug) {
    deps.mindMapSink.showInfo("Open a workspace folder first.");
    return {
      result: {
        projectSlug: "",
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        cliMissingCount: 0,
        jsonParseFailures: 0,
        failed: 0,
        failures: [],
      },
      completed: () => Promise.resolve(),
    };
  }

  // ── Mode selection ─────────────────────────────────────────────────────
  const mode = await pickAnalysisMode(deps.prompter);
  if (!mode) {
    return {
      result: {
        projectSlug: slug,
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        cliMissingCount: 0,
        jsonParseFailures: 0,
        failed: 0,
        failures: [],
      },
      completed: () => Promise.resolve(),
    };
  }

  // ── Scan sessions ──────────────────────────────────────────────────────
  const workspacePath = deps.hostAccess.getWorkspacePath();
  if (!workspacePath) {
    deps.mindMapSink.showInfo("Open a workspace folder first.");
    return {
      result: {
        projectSlug: slug,
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        cliMissingCount: 0,
        jsonParseFailures: 0,
        failed: 0,
        failures: [],
      },
      completed: () => Promise.resolve(),
    };
  }

  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    deps.mindMapSink.showInfo("Open a workspace folder first.");
    return {
      result: {
        projectSlug: slug,
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        cliMissingCount: 0,
        jsonParseFailures: 0,
        failed: 0,
        failures: [],
      },
      completed: () => Promise.resolve(),
    };
  }

  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });

  if (sessions.length === 0) {
    deps.mindMapSink.showInfo(`No agent transcripts found on disk for current project (${slug}).`);
    return {
      result: {
        projectSlug: slug,
        total: 0,
        analyzed: 0,
        skippedFresh: 0,
        turnFallbacks: 0,
        cliMissingCount: 0,
        jsonParseFailures: 0,
        failed: 0,
        failures: [],
      },
      completed: () => Promise.resolve(),
    };
  }

  const storeDir = deps.storeAccess.getStoreDir();
  await ensureStore(storeDir);

  // ── Force refresh: clear caches ────────────────────────────────────────
  if (mode.forceRefresh) {
    purgeCodeRefQueueForProject(slug);
    await deps.clearProjectCache(storeDir, slug);
  }

  // ── Read config ────────────────────────────────────────────────────────
  const projectRecordsById = new Map<string, SessionRecord>();
  const batchRefineOntology = deps.configStore.get<boolean>("library.batchRefineOntology") ?? true;
  const batchFinalRefine = deps.configStore.get<boolean>("library.batchFinalRefine") ?? true;
  const mergeMode = (deps.configStore.get<string>("library.mergeMode") ??
    "delta") as ProjectMergeMode;
  const mergeFullReconcileEvery =
    deps.configStore.get<number>("library.mergeFullReconcileEvery") ?? 4;
  const autoRefreshMcp = deps.configStore.get<boolean>("mcp.autoRefreshOnAnalyze") ?? false;

  const settings = readSettingsFromConfig(deps.configStore, host);
  const provider = deps.getProvider(settings.llm);
  const conceptLlm = {
    providerId: provider.id as LlmProviderId,
    model: settings.llm.model || undefined,
    hostId: host.id,
    outputLanguage: undefined as OutputLanguage | undefined,
  };

  // ── Bootstrap record cache ─────────────────────────────────────────────
  for (const session of sessions) {
    try {
      const store = await deps.storeAccess.getStore();
      const rec = await store.getRecord(slug, session.id);
      if (rec) {
        const sanitized = await deps.sanitizeSessionRecord(rec);
        projectRecordsById.set(session.id, sanitized);
      }
    } catch {
      // Record may not exist yet
    }
  }

  // ── Read snapshot manifest ─────────────────────────────────────────────
  let snapshotManifest: SnapshotManifest | undefined;
  if (!mode.forceRefresh) {
    try {
      snapshotManifest = await deps.readSnapshotManifest(storeDir, slug);
    } catch {
      // Missing manifest is fine — will fall back to legacy chunking
    }
  }

  const backgroundWork: Promise<void>[] = [];

  // ── Run batch analysis with per-batch merge ────────────────────────────
  const result = await runProjectSessionBatches(sessions, slug, host, deps, {
    forceRefresh: mode.forceRefresh,
    skipAutoMerge: true,
    batchSize: 5,
    snapshotManifest,
    onBatchDone: async (info: AnalyzeProjectBatchInfo) => {
      const signal = deps.signal ?? new AbortController().signal;
      if (signal.aborted) {
        return;
      }

      deps.logger.info(
        `[onBatchDone] batchNo=${info.batchNo} processed=${info.processed}/${info.total} ` +
          `analyzed=${info.analyzed} fresh=${info.freshlyAnalyzedSessionIds.length} ` +
          `leafId=${info.leafId ?? "(none)"} leafAction=${info.leafAction ?? "(none)"}`
      );

      // Refresh in-memory record cache for every session in this batch
      for (const sessionId of info.batchSessionIds) {
        if (signal.aborted) {
          return;
        }
        try {
          const store = await deps.storeAccess.getStore();
          const rec = await store.getRecord(slug, sessionId);
          if (rec) {
            const sanitized = await deps.sanitizeSessionRecord(rec);
            projectRecordsById.set(sessionId, sanitized);
          }
        } catch {
          // Record may not exist
        }
      }
      if (signal.aborted) {
        return;
      }

      const allRecordsForMerge = await deps.resolveProjectRecords(
        storeDir,
        slug,
        projectRecordsById
      );

      // Per-batch merge
      let conceptMerge: MergeRecord | undefined;
      try {
        conceptMerge = await deps.runBatchMerge({
          storeDir,
          projectSlug: slug,
          allRecords: allRecordsForMerge,
          batchRecords: info.batchSessionIds
            .map((sid) => projectRecordsById.get(sid))
            .filter(Boolean) as SessionRecord[],
          batchNo: info.batchNo,
          provider,
          conceptLlm,
          forceRefresh: mode.forceRefresh,
          forceReattach: mode.forceRefresh,
          batchRefineOntology,
          mergeMode,
          mergeFullReconcileEvery,
          leafAction: info.leafAction,
          leafId: info.leafId,
          freshlyAnalyzedSessionIds: info.freshlyAnalyzedSessionIds,
          signal,
          progress: deps.progress,
        });
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        deps.logger.error(
          `Batch ${info.batchNo} concept merge failed: ${detail || "(unknown)"}`,
          err
        );
        deps.mindMapSink.showInfo(
          `Batch ${info.batchNo} concept merge failed: ${detail || "(unknown)"}`
        );
        return;
      }

      // Apply merge to mind map
      if (conceptMerge) {
        deps.mindMapSink.refreshMindMap(storeDir, slug, conceptMerge.mindMap);
      }
    },
  });

  // ── Final root refresh ─────────────────────────────────────────────────
  if (
    projectRecordsById.size > 0 &&
    !deps.signal?.aborted &&
    batchRefineOntology &&
    batchFinalRefine &&
    !(result.skippedFresh === result.analyzed && result.failed === 0 && !mode.forceRefresh)
  ) {
    const batchRecords = await deps.resolveProjectRecords(storeDir, slug, projectRecordsById);
    deps.progress.report("Final concept synonym refine…");
    try {
      const finalMerge = await deps.runFinalRootRefresh({
        storeDir,
        projectSlug: slug,
        allRecords: batchRecords,
        provider,
        conceptLlm,
        signal: deps.signal ?? new AbortController().signal,
        progress: deps.progress,
      });
      if (finalMerge) {
        deps.mindMapSink.refreshMindMap(storeDir, slug, finalMerge.mindMap);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      deps.logger.error("Final root refresh failed", err);
      deps.mindMapSink.showInfo(`Final concept map refresh failed: ${detail}`);
    }
  }

  // ── Auto-refresh MCP ───────────────────────────────────────────────────
  if (autoRefreshMcp && projectRecordsById.size > 0 && deps.refreshMcpIndex) {
    await deps.refreshMcpIndex(slug);
  }

  // ── Drain code-ref queue ───────────────────────────────────────────────
  backgroundWork.push(drainCodeRefQueue());

  return {
    result,
    completed: () => Promise.all(backgroundWork).then(() => {}),
  };
}
