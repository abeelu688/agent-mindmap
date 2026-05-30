import type { AgentHostId } from "../../host/types";
import { outlineToTopicGraph } from "../../llm/outlineToTopicGraph";
import { sanitizeSessionOutline } from "../../llm/sanitizeOutline";
import { countUserQueries } from "../../llm/sanitizeTopicGraph";
import type { LlmProvider, SegmentEquivalence, SessionTreeSnapshot } from "../../llm/types";
import type { MindMapProgress } from "../../progress";
import { readSessionFile } from "../../transcript/listSessions";
import { getHostById } from "../../host/registry";
import type { SessionRecord } from "../../store/storeTypes";
import { writeRecord } from "../../store/sessionStore";
import { organizeByTree } from "./organizeByTree";
import { resolveConceptPathWithEquivalences } from "../../llm/resolveConceptPathWithEquivalences";
import { normalizeConceptPath } from "../../llm/normalizeConceptPath";
import type { CollectedMergeTerms } from "./collectMergeTerms";
import { logPipelineStageTiming } from "../pipelineTiming";

export type ReorganizeSessionsOpts = {
  storeDir: string;
  records: SessionRecord[];
  affectedSessionIds: string[];
  collected: CollectedMergeTerms;
  segmentEquivalences: SegmentEquivalence[];
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  prompt: { maxBranches: number; maxDetailsPerNode: number };
  maxConcurrent?: number;
  /** Parent merge pipeline run id for Output timing lines. */
  timingRunId?: string;
};

function mergedTreeForSession(
  record: SessionRecord,
  collected: CollectedMergeTerms,
  segmentEquivalences: SegmentEquivalence[]
): SessionTreeSnapshot {
  const base = record.treeSnapshot ?? {
    nodes: collected.nodes,
    mappings: collected.mappings,
    topicPathDecisions: collected.topicPaths
      .filter((tp) => tp.sessionId === record.meta.sessionId)
      .map((tp) => ({
        topicId: tp.topicId,
        sessionId: tp.sessionId,
        projectSlug: tp.projectSlug,
        conceptPath: tp.conceptPath,
        evidence: tp.evidence,
      })),
  };

  const topicPathDecisions = base.topicPathDecisions.map((tp) => ({
    ...tp,
    conceptPath: normalizeConceptPath(
      resolveConceptPathWithEquivalences(
        tp.conceptPath,
        segmentEquivalences,
        {
          projectSlug: tp.projectSlug,
          items: tp.evidence,
        }
      )
    ),
  }));

  return {
    nodes: collected.nodes.length ? collected.nodes : base.nodes,
    mappings: collected.mappings.length ? collected.mappings : base.mappings,
    topicPathDecisions,
  };
}

async function reorganizeOneSession(
  record: SessionRecord,
  opts: ReorganizeSessionsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionRecord> {
  const host = getHostById(record.meta.hostId ?? opts.hostId ?? "cursor");
  const content = await readSessionFile(record.meta.transcriptPath);
  const events = host.parseTranscript(content);
  const tree = mergedTreeForSession(
    record,
    opts.collected,
    opts.segmentEquivalences
  );

  const s4Timing: { cacheHit?: boolean } = {};
  const organizeStarted = performance.now();
  const outline = await organizeByTree(
    {
      events,
      tree,
      prompt: opts.prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId ?? record.meta.hostId,
      timingOut: s4Timing,
      timingRunId: opts.timingRunId,
    },
    provider,
    signal,
    progress
  );
  logPipelineStageTiming(
    "merge",
    `M4 S4 organize`,
    performance.now() - organizeStarted,
    {
      runId: opts.timingRunId,
      sessionId: record.meta.sessionId,
      cacheHit: s4Timing.cacheHit,
      kind: "llm",
      storeDir: opts.storeDir,
    }
  );

  const userQueryCount = countUserQueries(events);
  const sanitized = sanitizeSessionOutline(outline, userQueryCount);
  const graph = outlineToTopicGraph(sanitized);

  const updated: SessionRecord = {
    ...record,
    outline: sanitized,
    graph,
    treeSnapshot: tree,
    conceptExtract: record.conceptExtract,
    sessionSynonyms: record.sessionSynonyms,
  };

  await writeRecord(opts.storeDir, updated);
  return updated;
}

/**
 * M4: full rerun organize for affected sessions using merged tree + equivalences.
 */
export async function reorganizeSessions(
  opts: ReorganizeSessionsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionRecord[]> {
  const byId = new Map(opts.records.map((r) => [r.meta.sessionId, r]));
  const targets = opts.affectedSessionIds
    .map((id) => byId.get(id))
    .filter((r): r is SessionRecord => !!r);

  const maxConcurrent = Math.max(1, opts.maxConcurrent ?? 1);
  const out: SessionRecord[] = [];

  for (let i = 0; i < targets.length; i += maxConcurrent) {
    const batch = targets.slice(i, i + maxConcurrent);
    const results = await Promise.all(
      batch.map((record, idx) => {
        progress?.report(
          `Reorganizing session ${i + idx + 1}/${targets.length}…`
        );
        return reorganizeOneSession(record, opts, provider, signal, progress);
      })
    );
    out.push(...results);
  }

  return out;
}
