import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
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
import type { ConceptOntologyRecord } from "./ontologyTypes";
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

type OntologyIndex = {
  schemaVersion: 1;
  updatedAt: number;
  entries: {
    cacheKey: string;
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
  }[];
};

function projectSlugsFor(records: SessionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.meta.projectSlug))).sort();
}

export function computeOntologyCacheKey(
  records: SessionRecord[],
  opts: { model?: string; hostId?: AgentHostId },
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
  opts: { model?: string; hostId?: AgentHostId },
  provider: LlmProvider,
  signal: AbortSignal
): Promise<ConceptOntologyRecord["segmentEquivalences"]> {
  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const input = buildRefineInputFromRecords(records, base, base.topicPaths);
  const prompt = buildOntologyRefinePrompt(input, hostId);
  const res = await provider.summarize(
    {
      events: [],
      prompt,
      model: opts.model,
      maxTopics: 8,
      maxItemsPerTopic: 8,
      responseSchema: "ontology-refine",
    },
    signal
  );
  const refined = validateOntologyRefine(res);
  return refined.segmentEquivalences;
}

function isCompleteOntologyRecord(record: ConceptOntologyRecord): boolean {
  return (
    record.nodes.length > 0 &&
    record.topicPaths.length > 0 &&
    record.meta.promptVersions.refine === ONTOLOGY_REFINE_PROMPT_VERSION &&
    record.segmentEquivalences !== undefined
  );
}

/**
 * Build (or reuse) a cross-session concept ontology + per-topic conceptPath memory.
 */
export async function ensureOntologyMemory(
  records: SessionRecord[],
  opts: { model?: string; hostId?: AgentHostId; title?: string },
  provider: LlmProvider,
  storeDir: string,
  signal: AbortSignal
): Promise<ConceptOntologyRecord> {
  await ensureStore(storeDir);
  const cacheKey = computeOntologyCacheKey(records, opts, provider.id);
  const cached = await readOntologyRecord(storeDir, cacheKey);
  if (cached && isCompleteOntologyRecord(cached)) {
    return cached;
  }

  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";

  let nodes = cached?.nodes;
  let mappings = cached?.mappings;
  let topicPaths = cached?.topicPaths ?? [];
  let reattachMoves = cached?.reattachMoves;

  if (!nodes || !mappings) {
    const ontologyPrompt = buildOntologyPrompt(records, hostId);
    const ontologyResult = await provider.summarize(
      {
        events: [],
        prompt: ontologyPrompt,
        model: opts.model,
        maxTopics: 8,
        maxItemsPerTopic: 8,
        responseSchema: "concept-ontology",
      },
      signal
    );
    const validated = validateConceptOntology(ontologyResult as any);
    nodes = validated.nodes;
    mappings = validated.mappings;
    reattachMoves = validated.reattachMoves;
    topicPaths = [];
  }

  const lite: OntologyLite = {
    nodes: nodes!.map((n) => ({
      key: n.key,
      label: n.label,
      aliases: n.aliases,
      parentKeys: n.parentKeys,
    })),
    mappings: mappings!.map((m) => ({ mention: m.mention, key: m.key })),
    segmentEquivalences: cached?.segmentEquivalences,
  };

  if (!topicPaths.length) {
    for (const rec of records) {
      const { prompt } = buildTopicPathsPrompt(rec, lite, hostId);
      const res = await provider.summarize(
        {
          events: [],
          prompt,
          model: opts.model,
          maxTopics: 8,
          maxItemsPerTopic: 8,
          responseSchema: "topic-paths",
        },
        signal
      );
      const parsed = validateTopicPaths(res as any);
      const validatedPaths = validateConceptOntology({
        nodes: nodes!,
        mappings: mappings!,
        topicPaths: parsed.topicPaths,
      } as any).topicPaths;
      for (const p of validatedPaths) {
        topicPaths.push(p);
      }
    }
  }

  let segmentEquivalences = cached?.segmentEquivalences;
  if (segmentEquivalences === undefined) {
    segmentEquivalences = await runOntologyRefine(
      records,
      { nodes: nodes!, mappings: mappings!, topicPaths, reattachMoves },
      opts,
      provider,
      signal
    );
  }

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
    nodes: nodes!,
    mappings: mappings!,
    topicPaths,
    reattachMoves,
    segmentEquivalences,
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
 * Optional: ask LLM to produce reattach moves for suspicious root branches.
 */
export async function suggestReattachMoves(
  candidates: ReattachCandidate[],
  ontology: ConceptOntologyRecord,
  opts: { model?: string; hostId?: AgentHostId },
  provider: LlmProvider,
  signal: AbortSignal
): Promise<ConceptOntologyRecord["reattachMoves"]> {
  const hostId = opts.hostId ?? ontology.meta.hostId ?? "cursor";
  const lite = toOntologyLite(ontology);
  const prompt = buildReattachPrompt(candidates, lite, hostId);
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
