import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
import * as vscode from "vscode";
import type { MindMapProgress } from "../progress";
import { createHeartbeat } from "../progress";
import {
  buildOntologyPrompt,
  ONTOLOGY_PROMPT_VERSION,
} from "../llm/promptOntology";
import {
  buildOntologyRefinePrompt,
  buildRefineInputFromRecords,
  ONTOLOGY_REFINE_PROMPT_VERSION,
} from "../llm/promptOntologyRefine";
import {
  buildTopicPathsPrompt,
  TOPIC_PATHS_PROMPT_VERSION,
  type OntologyLite,
} from "../llm/promptTopicPaths";
import {
  REATTACH_PROMPT_VERSION,
  buildReattachPrompt,
  type ReattachCandidate,
} from "../llm/promptReattach";
import type {
  ConceptOntologyRecord,
  TopicConceptPathDecision,
} from "./ontologyTypes";
import type { SessionRecord } from "./storeTypes";
import {
  ensureStore,
  ontologyCachePath,
  sha256Hex,
  ontologyIndexPath,
} from "./sessionStore";
import { PROMPT_VERSION as OUTLINE_PROMPT_VERSION } from "../llm/promptOutline";
import {
  validateConceptOntology,
  validateOntologyRefine,
  validateTopicPaths,
} from "../llm/ontologyValidate";
import type { PromptLanguage } from "../llm/promptLanguage";

function format(message: string, args: Array<string | number | boolean>): string {
  return message.replace(/\{(\d+)\}/g, (_m, rawIdx) => {
    const idx = Number(rawIdx);
    const v = args[idx];
    return v === undefined ? "" : String(v);
  });
}

function safeT(
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string {
  const l10n = (vscode as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message, args });
  }
  return format(message, args);
}

export type OntologyIndex = {
  schemaVersion: 1;
  updatedAt: number;
  entries: {
    cacheKey: string;
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
  }[];
};

export type EnsureOntologyMemoryFlags = {
  /** Re-run refine even when cache is complete; do not return early on cache hit. */
  forceRefine?: boolean;
  /** Reuse nodes/mappings from the latest subset ontology cache in index.json. */
  incrementalFromIndex?: boolean;
  /** Skip extract and topicPaths; only run refine (final pass). */
  refineOnly?: boolean;
};

function sessionIdsSubsetOf(subset: string[], superset: string[]): boolean {
  const set = new Set(superset);
  return subset.every((id) => set.has(id));
}

export async function readOntologyIndex(
  storeDir: string
): Promise<OntologyIndex | undefined> {
  const parsed = await readJson<OntologyIndex>(ontologyIndexPath(storeDir));
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    return undefined;
  }
  return parsed;
}

/**
 * Latest ontology cache for the same project whose sessions are a subset of
 * the current selection (for incremental nodes/mappings reuse).
 */
export async function findReusableOntologyBase(
  storeDir: string,
  records: SessionRecord[]
): Promise<ConceptOntologyRecord | undefined> {
  if (!records.length) {
    return undefined;
  }
  const currentSessionIds = records.map((r) => r.meta.sessionId);
  const projectSlugs = new Set(records.map((r) => r.meta.projectSlug));
  const index = await readOntologyIndex(storeDir);
  if (!index?.entries.length) {
    return undefined;
  }
  const candidates = index.entries
    .filter(
      (e) =>
        e.sessionIds.length > 0 &&
        e.projectSlugs.some((s) => projectSlugs.has(s)) &&
        sessionIdsSubsetOf(e.sessionIds, currentSessionIds)
    )
    .sort((a, b) => b.builtAt - a.builtAt);
  for (const entry of candidates) {
    const cached = await readOntologyRecord(storeDir, entry.cacheKey);
    if (cached?.nodes?.length && cached.mappings) {
      return cached;
    }
  }
  return undefined;
}

function filterTopicPathsForSessions(
  topicPaths: TopicConceptPathDecision[],
  sessionIds: Set<string>
): TopicConceptPathDecision[] {
  return topicPaths.filter((p) => sessionIds.has(p.sessionId));
}

function sessionIdsWithTopicPaths(
  topicPaths: TopicConceptPathDecision[]
): Set<string> {
  return new Set(topicPaths.map((p) => p.sessionId));
}

function projectSlugsFor(records: SessionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.meta.projectSlug))).sort();
}

export function computeOntologyCacheKey(
  records: SessionRecord[],
  opts: { model?: string; hostId?: AgentHostId; promptLanguage?: PromptLanguage },
  providerId: string
): string {
  const sorted = [...records].sort((a, b) =>
    a.meta.sessionId.localeCompare(b.meta.sessionId)
  );
  const payload = JSON.stringify({
    sessionIds: sorted.map((r) => r.meta.sessionId),
    transcriptShas: sorted.map((r) => r.meta.transcriptSha256),
    provider: providerId,
    model: opts.model?.trim() || "",
    hostId: opts.hostId ?? sorted[0]?.meta.hostId ?? "cursor",
    promptLanguage: opts.promptLanguage ?? "zh",
    promptVersions: {
      ontology: ONTOLOGY_PROMPT_VERSION,
      topicPaths: TOPIC_PATHS_PROMPT_VERSION,
      reattach: REATTACH_PROMPT_VERSION,
      refine: ONTOLOGY_REFINE_PROMPT_VERSION,
      outlineSchema: OUTLINE_PROMPT_VERSION,
    },
  });
  return sha256Hex(payload);
}

function toOntologyLite(record: ConceptOntologyRecord): OntologyLite {
  return {
    nodes: record.nodes.map((n) => ({
      key: n.key,
      label: n.label,
      aliases: n.aliases,
      parentKeys: n.parentKeys,
    })),
    mappings: record.mappings.map((m) => ({ mention: m.mention, key: m.key })),
    segmentEquivalences: record.segmentEquivalences,
  };
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await import("fs/promises").then((m) => m.readFile(filePath, "utf8"));
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function readOntologyRecord(
  storeDir: string,
  cacheKey: string
): Promise<ConceptOntologyRecord | undefined> {
  const file = ontologyCachePath(storeDir, cacheKey);
  const parsed = await readJson<unknown>(file);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as ConceptOntologyRecord;
  if (obj.schemaVersion !== 1 || !obj.nodes || !obj.mappings) {
    return undefined;
  }
  return obj;
}

async function writeOntologyIndex(
  storeDir: string,
  entry: OntologyIndex["entries"][number]
): Promise<void> {
  const indexFile = ontologyIndexPath(storeDir);
  const parsed = (await readJson<OntologyIndex>(indexFile)) ?? {
    schemaVersion: 1,
    updatedAt: Date.now(),
    entries: [],
  };
  const next: OntologyIndex = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    entries: [
      entry,
      ...parsed.entries.filter((e) => e.cacheKey !== entry.cacheKey),
    ].slice(0, 200),
  };
  await writeJsonAtomic(indexFile, next);
}

/** Remove all cached ontology records (forces rebuild on next Concept merge). */
export async function clearOntologyCache(storeDir: string): Promise<number> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const cacheDir = path.join(storeDir, "ontology", "cache");
  let removed = 0;
  try {
    const files = await fs.readdir(cacheDir);
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      await fs.unlink(path.join(cacheDir, file));
      removed += 1;
    }
  } catch {
    // ignore
  }
  const indexFile = ontologyIndexPath(storeDir);
  try {
    await fs.unlink(indexFile);
  } catch {
    // ignore
  }
  return removed;
}

async function runOntologyRefine(
  records: SessionRecord[],
  base: Pick<
    ConceptOntologyRecord,
    "nodes" | "mappings" | "topicPaths" | "reattachMoves"
  >,
  opts: { model?: string; hostId?: AgentHostId; promptLanguage?: PromptLanguage },
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<ConceptOntologyRecord["segmentEquivalences"]> {
  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const input = buildRefineInputFromRecords(records, base, base.topicPaths);
  const prompt = buildOntologyRefinePrompt(
    input,
    hostId,
    opts.promptLanguage ?? "zh"
  );
  const heartbeat = createHeartbeat(
    progress,
    safeT(
      "ui.ontology.refine.heartbeat",
      "Refining concept segment equivalences…"
    )
  );
  try {
    const res = await provider.summarize(
      {
        events: [],
        prompt,
        model: opts.model,
        maxTopics: 8,
        maxItemsPerTopic: 8,
        responseSchema: "ontology-refine",
        onAttempt: (attempt, maxAttempts) => {
          if (attempt > 1) {
            progress?.report(
              safeT("ui.llm.attempt", "LLM attempt {0}/{1}…", attempt, maxAttempts)
            );
          }
        },
      },
      signal
    );
    const refined = validateOntologyRefine(res);
    return refined.segmentEquivalences;
  } finally {
    heartbeat.stop();
  }
}

export function isCompleteOntologyRecord(record: ConceptOntologyRecord): boolean {
  return (
    record.nodes.length > 0 &&
    record.topicPaths.length > 0 &&
    record.meta.promptVersions.refine === ONTOLOGY_REFINE_PROMPT_VERSION &&
    record.segmentEquivalences !== undefined
  );
}

async function inferTopicPathsForRecords(
  records: SessionRecord[],
  nodes: ConceptOntologyRecord["nodes"],
  mappings: ConceptOntologyRecord["mappings"],
  existingPaths: TopicConceptPathDecision[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    promptLanguage?: PromptLanguage;
  },
  hostId: AgentHostId,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<TopicConceptPathDecision[]> {
  const covered = sessionIdsWithTopicPaths(existingPaths);
  const toInfer = records.filter((r) => !covered.has(r.meta.sessionId));
  if (!toInfer.length) {
    return existingPaths;
  }

  const lite: OntologyLite = {
    nodes: nodes.map((n) => ({
      key: n.key,
      label: n.label,
      aliases: n.aliases,
      parentKeys: n.parentKeys,
    })),
    mappings: mappings.map((m) => ({ mention: m.mention, key: m.key })),
  };

  const topicPaths = [...existingPaths];
  const total = toInfer.length;
  let index = 0;
  for (const rec of toInfer) {
    index += 1;
    progress?.report(
      safeT(
        "ui.ontology.topicPaths.step",
        "Inferring topic paths ({0}/{1})…",
        index,
        total
      )
    );
    const { prompt } = buildTopicPathsPrompt(
      rec,
      lite,
      hostId,
      opts.promptLanguage ?? "zh"
    );
    const heartbeat = createHeartbeat(
      progress,
      safeT(
        "ui.ontology.topicPaths.step",
        "Inferring topic paths ({0}/{1})…",
        index,
        total
      )
    );
    let res: Awaited<ReturnType<LlmProvider["summarize"]>>;
    try {
      res = await provider.summarize(
        {
          events: [],
          prompt,
          model: opts.model,
          maxTopics: 8,
          maxItemsPerTopic: 8,
          responseSchema: "topic-paths",
          onAttempt: (attempt, maxAttempts) => {
            if (attempt > 1) {
              progress?.report(
                safeT("ui.llm.attempt", "LLM attempt {0}/{1}…", attempt, maxAttempts)
              );
            }
          },
        },
        signal
      );
    } finally {
      heartbeat.stop();
    }
    const parsed = validateTopicPaths(res as any);
    const validatedPaths = validateConceptOntology({
      nodes,
      mappings,
      topicPaths: parsed.topicPaths,
    } as any).topicPaths;
    for (const p of validatedPaths) {
      topicPaths.push(p);
    }
  }
  return topicPaths;
}

async function writeOntologyRecord(
  storeDir: string,
  cacheKey: string,
  records: SessionRecord[],
  hostId: AgentHostId,
  opts: {
    model?: string;
    hostId?: AgentHostId;
  },
  provider: LlmProvider,
  payload: Pick<
    ConceptOntologyRecord,
    "nodes" | "mappings" | "topicPaths" | "reattachMoves" | "segmentEquivalences"
  >
): Promise<ConceptOntologyRecord> {
  const record: ConceptOntologyRecord = {
    schemaVersion: 1,
    meta: {
      builtAt: Date.now(),
      cacheKey,
      sessionIds: records.map((r) => r.meta.sessionId),
      projectSlugs: projectSlugsFor(records),
      llm: { provider: provider.id, model: opts.model?.trim() || undefined },
      promptVersions: {
        ontology: ONTOLOGY_PROMPT_VERSION,
        topicPaths: TOPIC_PATHS_PROMPT_VERSION,
        reattach: REATTACH_PROMPT_VERSION,
        refine: ONTOLOGY_REFINE_PROMPT_VERSION,
        outlineSchema: OUTLINE_PROMPT_VERSION,
      },
      hostId,
    },
    nodes: payload.nodes,
    mappings: payload.mappings,
    topicPaths: payload.topicPaths,
    reattachMoves: payload.reattachMoves,
    segmentEquivalences: payload.segmentEquivalences,
  };
  await writeJsonAtomic(ontologyCachePath(storeDir, cacheKey), record);
  await writeOntologyIndex(storeDir, {
    cacheKey,
    builtAt: record.meta.builtAt,
    sessionIds: record.meta.sessionIds,
    projectSlugs: record.meta.projectSlugs,
  });
  return record;
}

/**
 * Build (or reuse) a cross-session concept ontology + per-topic conceptPath memory.
 */
export async function ensureOntologyMemory(
  records: SessionRecord[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    title?: string;
    promptLanguage?: PromptLanguage;
  },
  provider: LlmProvider,
  storeDir: string,
  signal: AbortSignal,
  progress?: MindMapProgress,
  flags: EnsureOntologyMemoryFlags = {}
): Promise<ConceptOntologyRecord> {
  await ensureStore(storeDir);
  progress?.report(
    safeT("ui.ontology.cache.check", "Checking concept ontology cache…")
  );
  const cacheKey = computeOntologyCacheKey(records, opts, provider.id);
  const cached = await readOntologyRecord(storeDir, cacheKey);
  if (
    cached &&
    isCompleteOntologyRecord(cached) &&
    !flags.forceRefine &&
    !flags.refineOnly
  ) {
    progress?.report(safeT("ui.ontology.cache.hit", "Concept ontology cache hit…"));
    return cached;
  }

  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const currentSessionIds = new Set(records.map((r) => r.meta.sessionId));

  const reusableBase = flags.incrementalFromIndex
    ? await findReusableOntologyBase(storeDir, records)
    : undefined;

  let nodes = cached?.nodes ?? reusableBase?.nodes;
  let mappings = cached?.mappings ?? reusableBase?.mappings;
  let reattachMoves = cached?.reattachMoves ?? reusableBase?.reattachMoves;
  let topicPaths = filterTopicPathsForSessions(
    cached?.topicPaths ?? reusableBase?.topicPaths ?? [],
    currentSessionIds
  );

  if (flags.refineOnly) {
    if (!nodes?.length || !mappings) {
      throw new Error(
        "ontology refine-only requires existing nodes/mappings in cache"
      );
    }
    const segmentEquivalences = await runOntologyRefine(
      records,
      { nodes, mappings, topicPaths, reattachMoves },
      opts,
      provider,
      signal,
      progress
    );
    return writeOntologyRecord(
      storeDir,
      cacheKey,
      records,
      hostId,
      opts,
      provider,
      {
        nodes,
        mappings,
        topicPaths,
        reattachMoves,
        segmentEquivalences,
      }
    );
  }

  if (!nodes?.length || !mappings) {
    progress?.report(safeT("ui.ontology.extract", "Extracting concept ontology…"));
    const heartbeat = createHeartbeat(
      progress,
      safeT("ui.ontology.extract.heartbeat", "Extracting concept ontology…")
    );
    let ontologyResult: Awaited<ReturnType<LlmProvider["summarize"]>>;
    try {
      const ontologyPrompt = buildOntologyPrompt(
        records,
        hostId,
        opts.promptLanguage ?? "zh"
      );
      ontologyResult = await provider.summarize(
        {
          events: [],
          prompt: ontologyPrompt,
          model: opts.model,
          maxTopics: 8,
          maxItemsPerTopic: 8,
          responseSchema: "concept-ontology",
          onAttempt: (attempt, maxAttempts) => {
            if (attempt > 1) {
              progress?.report(
                safeT("ui.llm.attempt", "LLM attempt {0}/{1}…", attempt, maxAttempts)
              );
            }
          },
        },
        signal
      );
    } finally {
      heartbeat.stop();
    }
    const validated = validateConceptOntology(ontologyResult as any);
    nodes = validated.nodes;
    mappings = validated.mappings;
    reattachMoves = validated.reattachMoves;
    if (!flags.incrementalFromIndex || !reusableBase) {
      topicPaths = [];
    }
  }

  topicPaths = await inferTopicPathsForRecords(
    records,
    nodes!,
    mappings!,
    topicPaths,
    opts,
    hostId,
    provider,
    signal,
    progress
  );

  let segmentEquivalences: ConceptOntologyRecord["segmentEquivalences"];
  if (flags.forceRefine || cached?.segmentEquivalences === undefined) {
    segmentEquivalences = await runOntologyRefine(
      records,
      { nodes: nodes!, mappings: mappings!, topicPaths, reattachMoves },
      opts,
      provider,
      signal,
      progress
    );
  } else {
    segmentEquivalences = cached!.segmentEquivalences;
  }

  return writeOntologyRecord(
    storeDir,
    cacheKey,
    records,
    hostId,
    opts,
    provider,
    {
      nodes: nodes!,
      mappings: mappings!,
      topicPaths,
      reattachMoves,
      segmentEquivalences,
    }
  );
}

/**
 * Optional: ask LLM to produce reattach moves for suspicious root branches.
 */
export async function suggestReattachMoves(
  candidates: ReattachCandidate[],
  ontology: ConceptOntologyRecord,
  opts: { model?: string; hostId?: AgentHostId; promptLanguage?: PromptLanguage },
  provider: LlmProvider,
  signal: AbortSignal
): Promise<ConceptOntologyRecord["reattachMoves"]> {
  const hostId = opts.hostId ?? ontology.meta.hostId ?? "cursor";
  const lite = toOntologyLite(ontology);
  const prompt = buildReattachPrompt(
    candidates,
    lite,
    hostId,
    opts.promptLanguage ?? "zh"
  );
  const res = await provider.summarize(
    {
      events: [],
      prompt,
      model: opts.model,
      maxTopics: 8,
      maxItemsPerTopic: 8,
      responseSchema: "reattach-moves",
    },
    signal
  );
  const parsed = res as any;
  const moves = Array.isArray(parsed?.moves) ? parsed.moves : [];
  const validated = validateConceptOntology({
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths: [],
    reattachMoves: moves,
  } as any);
  return validated.reattachMoves;
}
