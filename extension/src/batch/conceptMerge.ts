import { buildConceptMergeForRecords } from "../store/conceptMergeContext";
import { refreshSnapshotForSession, runBatchSnapshotPipeline } from "../pipeline/snapshotHierarchy";
import { filterRealSessionRecords, readSnapshotManifest } from "../store/mergeSnapshot";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import { mindMapLog } from "../webview/MindMapLog";
import { t } from "../l10n/uiTranslate";
import type { LlmProviderOptions, LlmProvider } from "../llm/types";
import type { ConceptMergeLlmOpts } from "../store/conceptMergeContext";
import type { ProjectMergeMode } from "../pipeline/deltaMergePipeline";
import type { MindMapProgress } from "../progress";
import type { SessionRecord } from "../store/storeTypes";
import type { MergeRecord } from "../store/storeTypes";

export function toConceptMergeLlmOpts(
  llmOpts: LlmProviderOptions,
  providerId: string
): ConceptMergeLlmOpts {
  return {
    model: llmOpts.model,
    hostId: llmOpts.hostId,
    providerId,
    timeoutMs: llmOpts.timeoutMs,
  };
}

export async function buildProjectConceptMergeFromCache(
  storeDir: string,
  records: SessionRecord[],
  llmOpts: ConceptMergeLlmOpts,
  projectSlug: string | undefined,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress,
  forceReattach = false
): Promise<MergeRecord> {
  const sanitized = await Promise.all(records.map((r) => sanitizeSessionRecord(r)));
  const { merge } = await buildConceptMergeForRecords(sanitized, {
    storeDir,
    projectSlug,
    llm: llmOpts,
    provider,
    signal,
    progress,
    forceReattach,
    ontologyFlags: forceReattach ? { forceRefine: true } : undefined,
  });
  return merge;
}

export async function buildProjectConceptMergeForBatch(
  storeDir: string,
  allRecords: SessionRecord[],
  batchRecords: SessionRecord[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    batchRefineOntology: boolean;
    batchNo: number;
    processed?: number;
    total?: number;
    forceReattach?: boolean;
    mergeMode: ProjectMergeMode;
    mergeFullReconcileEvery: number;
    forceRefresh?: boolean;
  }
): Promise<MergeRecord> {
  const sanitizedAll = await Promise.all(
    filterRealSessionRecords(allRecords).map((r) => sanitizeSessionRecord(r))
  );
  const sanitizedBatch = await Promise.all(
    filterRealSessionRecords(batchRecords).map((r) => sanitizeSessionRecord(r))
  );
  if (!opts.batchRefineOntology) {
    return buildProjectConceptMergeFromCache(
      storeDir,
      sanitizedAll,
      opts.conceptLlm,
      opts.projectSlug,
      opts.provider,
      opts.signal,
      opts.progress,
      false
    );
  }
  if (opts.processed !== undefined && opts.total !== undefined) {
    opts.progress?.report(
      t(
        "ui.batch.progress.refineOntology",
        "Refining concept synonyms (batch {0}, {1}/{2} sessions)…",
        opts.batchNo,
        opts.processed,
        opts.total
      )
    );
  } else {
    opts.progress?.report(
      t("ui.ontology.refine.heartbeat", "Refining concept segment equivalences…")
    );
  }
  return runBatchSnapshotPipeline(
    {
      storeDir,
      projectSlug: opts.projectSlug,
      allRecords: sanitizedAll,
      batchRecords: sanitizedBatch,
      batchNo: opts.batchNo,
      provider: opts.provider,
      providerId: opts.conceptLlm.providerId,
      model: opts.conceptLlm.model,
      hostId: opts.conceptLlm.hostId,
      outputLanguage: opts.conceptLlm.outputLanguage,
      llmTimeoutMs: opts.conceptLlm.timeoutMs,
      signal: opts.signal,
      forceReattach: opts.forceReattach ?? true,
    },
    opts.progress
  );
}

/**
 * Per-session incremental snapshot update: for each session whose transcript
 * changed in this batch, refresh only its L1 leaf and cascade up the parent
 * chain to the project root. Sessions without an existing leaf in the
 * manifest fall back to a fresh L1 batch via {@link runBatchSnapshotPipeline}.
 *
 * Returns the latest concept-trie {@link MergeRecord} after all updates, or
 * `undefined` when there is nothing to do (no fresh sessions and no first-
 * time merge needed).
 */
export async function refreshSnapshotsForFreshSessions(
  storeDir: string,
  allRecords: SessionRecord[],
  freshSessionIds: string[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    llmTimeoutMs?: number;
  }
): Promise<MergeRecord | undefined> {
  const sanitizedAll = await Promise.all(
    filterRealSessionRecords(allRecords).map((r) => sanitizeSessionRecord(r))
  );

  const manifest = await readSnapshotManifest(storeDir, opts.projectSlug);
  const recordById = new Map(sanitizedAll.map((r) => [r.meta.sessionId, r]));

  // Bootstrap: no manifest yet (first run for this project, or hierarchy
  // was deleted). Fall back to a single full-batch snapshot pipeline so the
  // L1/promote/root chain gets created.
  if (!manifest) {
    if (sanitizedAll.length === 0) {
      return undefined;
    }
    mindMapLog(
      `[refreshSnapshotsForFreshSessions] no manifest, bootstrapping snapshot hierarchy with ${sanitizedAll.length} session(s)`
    );
    return runBatchSnapshotPipeline(
      {
        storeDir,
        projectSlug: opts.projectSlug,
        allRecords: sanitizedAll,
        batchRecords: sanitizedAll,
        batchNo: 1,
        provider: opts.provider,
        providerId: opts.conceptLlm.providerId,
        model: opts.conceptLlm.model,
        hostId: opts.conceptLlm.hostId,
        outputLanguage: opts.conceptLlm.outputLanguage,
        llmTimeoutMs: opts.llmTimeoutMs,
        signal: opts.signal,
        forceReattach: true,
      },
      opts.progress
    );
  }

  const sessionsWithLeaf: string[] = [];
  const sessionsNeedingNewLeaf: string[] = [];
  for (const sid of freshSessionIds) {
    if (!recordById.has(sid)) {
      // Record was filtered out (turn fallback / virtual / failed) — skip.
      continue;
    }
    if (manifest.sessionToLeafId[sid]) {
      sessionsWithLeaf.push(sid);
    } else {
      sessionsNeedingNewLeaf.push(sid);
    }
  }

  // Multiple fresh sessions can belong to the same L1 leaf — refreshing the
  // leaf rebuilds it from ALL its constituent sessions, so we only need to
  // call refreshSnapshotForSession once per unique leaf.
  const leafToRepresentativeSession = new Map<string, string>();
  for (const sid of sessionsWithLeaf) {
    const leafId = manifest.sessionToLeafId[sid]!;
    if (!leafToRepresentativeSession.has(leafId)) {
      leafToRepresentativeSession.set(leafId, sid);
    }
  }
  if (
    leafToRepresentativeSession.size > 0 &&
    leafToRepresentativeSession.size < sessionsWithLeaf.length
  ) {
    mindMapLog(
      `[refreshSnapshotsForFreshSessions] deduped ${sessionsWithLeaf.length} fresh sessions into ${leafToRepresentativeSession.size} leaf refresh(es)`
    );
  }

  if (leafToRepresentativeSession.size === 0 && sessionsNeedingNewLeaf.length === 0) {
    mindMapLog(
      `[refreshSnapshotsForFreshSessions] nothing to refresh (freshSessionIds=${freshSessionIds.length})`
    );
    return undefined;
  }

  let lastMerge: MergeRecord | undefined;
  const baseHierarchyOpts = {
    storeDir,
    projectSlug: opts.projectSlug,
    allRecords: sanitizedAll,
    provider: opts.provider,
    providerId: opts.conceptLlm.providerId,
    model: opts.conceptLlm.model,
    hostId: opts.conceptLlm.hostId,
    outputLanguage: opts.conceptLlm.outputLanguage,
    llmTimeoutMs: opts.llmTimeoutMs,
    signal: opts.signal,
    forceReattach: true as const,
  };

  // 1) Existing-leaf path: one refresh per unique leaf (refreshSnapshotForSession
  // rebuilds the leaf from ALL its sessions, so multiple fresh sessions in the
  // same leaf collapse to a single rebuild).
  for (const [leafId, representativeSid] of leafToRepresentativeSession) {
    if (opts.signal.aborted) {
      return lastMerge;
    }
    opts.progress?.report(
      t("ui.batch.progress.refreshLeaf", "Refreshing snapshot leaf for changed session…")
    );
    mindMapLog(
      `[refreshSnapshotsForFreshSessions] refreshSnapshotForSession leaf=${leafId} representativeSession=${representativeSid.slice(0, 8)}`
    );
    lastMerge = await refreshSnapshotForSession(
      { ...baseHierarchyOpts, sessionId: representativeSid },
      opts.progress
    );
  }

  // 2) New-leaf path: sessions not yet covered by any L1 leaf get added as a
  // fresh batch (the snapshot pipeline creates a new leaf and cascades).
  if (sessionsNeedingNewLeaf.length > 0 && !opts.signal.aborted) {
    const batchRecords = sessionsNeedingNewLeaf
      .map((sid) => recordById.get(sid))
      .filter((r): r is SessionRecord => Boolean(r));
    // Pick the next batch number: max existing L1 number + 1.
    const refreshedManifest = (await readSnapshotManifest(storeDir, opts.projectSlug)) ?? manifest;
    const batchNo = refreshedManifest.nodes.filter((n) => n.level === 1).length + 1;
    mindMapLog(
      `[refreshSnapshotsForFreshSessions] new-leaf batch ${batchNo} with ${batchRecords.length} session(s)`
    );
    lastMerge = await runBatchSnapshotPipeline(
      {
        ...baseHierarchyOpts,
        batchRecords,
        batchNo,
      },
      opts.progress
    );
  }

  return lastMerge;
}
