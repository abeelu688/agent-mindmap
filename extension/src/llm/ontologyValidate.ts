import { LlmProviderError } from "./types";
import type {
  ConceptOntology,
  ConceptOntologyMapping,
  ConceptOntologyNode,
  OntologyRefineResult,
  ReattachMove,
  ReattachParseResult,
  ReattachStep,
  ReattachStepKind,
  SegmentEquivalence,
  TopicPathDecision,
} from "./types";
import { reattachStepsToMoves } from "./reattachSteps";
import { parseConceptPath } from "./topicGraphValidate";

const MAX_KEY = 48;
const MAX_LABEL = 80;
const MAX_ALIASES = 12;
const MAX_PARENTS = 6;
const MAX_NODES = 400;
const MAX_MAPPINGS = 1200;
const MAX_TOPIC_PATHS = 4000;
const MAX_MOVES = 800;
const MAX_EQUIVALENCES = 200;
const MAX_EQ_ALIASES = 16;

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown>, key: string, max: number): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) {
    return undefined;
  }
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function pickNumber01(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined;
  }
  if (v < 0 || v > 1) {
    return undefined;
  }
  return v;
}

function parseStringArray(
  value: unknown,
  maxItems: number,
  maxLen: number
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) {
      continue;
    }
    const clipped = t.length > maxLen ? t.slice(0, maxLen - 3) + "..." : t;
    const k = clipped.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(clipped);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out.length ? out : undefined;
}

function parseNode(value: unknown): ConceptOntologyNode | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const key = pickString(obj, "key", MAX_KEY)?.toLowerCase();
  const label = pickString(obj, "label", MAX_LABEL);
  if (!key || !label) {
    return undefined;
  }
  const aliases = parseStringArray(obj.aliases, MAX_ALIASES, MAX_LABEL);
  const parentKeys = parseStringArray(obj.parentKeys, MAX_PARENTS, MAX_KEY)?.map((s) =>
    s.toLowerCase()
  );
  const confidence = pickNumber01(obj, "confidence");
  const evidence = parseStringArray(obj.evidence, 16, 120);
  return { key, label, aliases, parentKeys, confidence, evidence };
}

function parseMapping(value: unknown): ConceptOntologyMapping | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const mention = pickString(obj, "mention", MAX_LABEL);
  const key = pickString(obj, "key", MAX_KEY)?.toLowerCase();
  if (!mention || !key) {
    return undefined;
  }
  const confidence = pickNumber01(obj, "confidence");
  return { mention, key, confidence };
}

function parseTopicPath(value: unknown): TopicPathDecision | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const topicId = pickString(obj, "topicId", 128);
  const sessionId = pickString(obj, "sessionId", 128);
  const projectSlug = pickString(obj, "projectSlug", 200);
  const conceptPath = parseConceptPath(obj.conceptPath);
  if (!topicId || !sessionId || !projectSlug || !conceptPath?.length) {
    return undefined;
  }
  const confidence = pickNumber01(obj, "confidence");
  const evidence = parseStringArray(obj.evidence, 16, 120);
  return { topicId, sessionId, projectSlug, conceptPath, confidence, evidence };
}

function parseScope(value: unknown): SegmentEquivalence["scope"] | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const pathPrefix = parseStringArray(obj.pathPrefix, 8, MAX_KEY)?.map((s) =>
    s.toLowerCase()
  );
  const downstreamPrefix = parseStringArray(obj.downstreamPrefix, 8, MAX_KEY)?.map(
    (s) => s.toLowerCase()
  );
  const downstreamFirst = parseStringArray(obj.downstreamFirst, 8, MAX_KEY)?.map(
    (s) => s.toLowerCase()
  );
  const projectSlugs = parseStringArray(obj.projectSlugs, 16, 200);
  const evidenceKeywords = parseStringArray(obj.evidenceKeywords, 24, 80);
  if (
    !pathPrefix?.length &&
    !downstreamPrefix?.length &&
    !downstreamFirst?.length &&
    !projectSlugs?.length &&
    !evidenceKeywords?.length
  ) {
    return undefined;
  }
  return {
    pathPrefix,
    downstreamPrefix,
    downstreamFirst,
    projectSlugs,
    evidenceKeywords,
  };
}

function parseSegmentEquivalence(value: unknown): SegmentEquivalence | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const canonical = pickString(obj, "canonical", MAX_KEY)?.toLowerCase();
  if (!canonical) {
    return undefined;
  }
  const aliasesRaw = Array.isArray(obj.aliases) ? obj.aliases : [];
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const raw of aliasesRaw) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.replace(/\s+/g, " ").trim();
    const a =
      trimmed.length > MAX_KEY
        ? trimmed.slice(0, MAX_KEY - 3).toLowerCase() + "..."
        : trimmed.toLowerCase();
    if (!a || a === canonical || seen.has(a)) {
      continue;
    }
    seen.add(a);
    aliases.push(a);
    if (aliases.length >= MAX_EQ_ALIASES) {
      break;
    }
  }
  const scope = parseScope(obj.scope);
  if (!scope) {
    return undefined;
  }
  const confidence = pickNumber01(obj, "confidence");
  const rationale = pickString(obj, "rationale", 200);
  return { canonical, aliases, scope, confidence, rationale };
}

export function parseSegmentEquivalences(value: unknown): SegmentEquivalence[] {
  const raw = Array.isArray(value) ? value : [];
  const out: SegmentEquivalence[] = [];
  for (const item of raw) {
    const parsed = parseSegmentEquivalence(item);
    if (parsed) {
      out.push(parsed);
    }
    if (out.length >= MAX_EQUIVALENCES) {
      break;
    }
  }
  return out;
}

function parseMove(value: unknown): ReattachMove | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const from = pickString(obj, "from", 160);
  const toPath = parseConceptPath(obj.toPath);
  if (!from || !toPath?.length) {
    return undefined;
  }
  const confidence = pickNumber01(obj, "confidence");
  const evidence = parseStringArray(obj.evidence, 16, 120);
  return { from, toPath, confidence, evidence };
}

export function validateConceptOntology(value: unknown): ConceptOntology {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected concept ontology object");
  }
  const nodesRaw = Array.isArray(root.nodes) ? root.nodes : [];
  const mappingsRaw = Array.isArray(root.mappings) ? root.mappings : [];
  const topicPathsRaw = Array.isArray(root.topicPaths) ? root.topicPaths : [];
  const movesRaw = Array.isArray(root.reattachMoves) ? root.reattachMoves : [];
  const equivRaw = Array.isArray(root.segmentEquivalences)
    ? root.segmentEquivalences
    : [];

  const nodes: ConceptOntologyNode[] = [];
  const seenKeys = new Set<string>();
  for (const n of nodesRaw) {
    const parsed = parseNode(n);
    if (!parsed) {
      continue;
    }
    if (seenKeys.has(parsed.key)) {
      continue;
    }
    seenKeys.add(parsed.key);
    nodes.push(parsed);
    if (nodes.length >= MAX_NODES) {
      break;
    }
  }
  if (!nodes.length) {
    throw new LlmProviderError("bad-shape", "Ontology returned no usable nodes");
  }

  const mappings: ConceptOntologyMapping[] = [];
  for (const m of mappingsRaw) {
    const parsed = parseMapping(m);
    if (parsed) {
      mappings.push(parsed);
    }
    if (mappings.length >= MAX_MAPPINGS) {
      break;
    }
  }

  const topicPaths: TopicPathDecision[] = [];
  for (const t of topicPathsRaw) {
    const parsed = parseTopicPath(t);
    if (parsed) {
      topicPaths.push(parsed);
    }
    if (topicPaths.length >= MAX_TOPIC_PATHS) {
      break;
    }
  }

  const reattachMoves: ReattachMove[] = [];
  for (const mv of movesRaw) {
    const parsed = parseMove(mv);
    if (parsed) {
      reattachMoves.push(parsed);
    }
    if (reattachMoves.length >= MAX_MOVES) {
      break;
    }
  }

  const segmentEquivalences = parseSegmentEquivalences(equivRaw);

  return {
    nodes,
    mappings,
    topicPaths,
    reattachMoves: reattachMoves.length ? reattachMoves : undefined,
    segmentEquivalences: segmentEquivalences.length
      ? segmentEquivalences
      : undefined,
  };
}

export function validateOntologyRefine(value: unknown): OntologyRefineResult {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected ontology refine object");
  }
  return {
    segmentEquivalences: parseSegmentEquivalences(root.segmentEquivalences),
  };
}

export function validateTopicPaths(value: unknown): { topicPaths: TopicPathDecision[] } {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected object with topicPaths[]");
  }
  const raw = Array.isArray(root.topicPaths) ? root.topicPaths : [];
  const topicPaths: TopicPathDecision[] = [];
  for (const t of raw) {
    const parsed = parseTopicPath(t);
    if (parsed) {
      topicPaths.push(parsed);
    }
    if (topicPaths.length >= MAX_TOPIC_PATHS) {
      break;
    }
  }
  if (!topicPaths.length) {
    throw new LlmProviderError("bad-shape", "No usable topicPaths returned");
  }
  return { topicPaths };
}

function parseReattachMovesList(raw: unknown[]): ReattachMove[] {
  const moves: ReattachMove[] = [];
  for (const mv of raw) {
    const parsed = parseMove(mv);
    if (parsed) {
      moves.push(parsed);
    }
    if (moves.length >= MAX_MOVES) {
      break;
    }
  }
  return moves;
}

function parseReattachStepKind(value: unknown): ReattachStepKind | undefined {
  const s = (
    typeof value === "string" ? value.trim().toLowerCase() : ""
  ).replace(/-/g, "_");
  if (s === "merge_synonym" || s === "mergesynonym" || s === "merge") {
    return "merge_synonym";
  }
  if (s === "attach_under" || s === "attachunder" || s === "attach") {
    return "attach_under";
  }
  return undefined;
}

function parseReattachStep(value: unknown): ReattachStep | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const step = typeof obj.step === "number" ? Math.floor(obj.step) : 0;
  const sourceNodeId = pickString(obj, "sourceNodeId", 12);
  const targetNodeId = pickString(obj, "targetNodeId", 12);
  const targetNodeIds = parseStringArray(obj.targetNodeIds, 12, 12)?.filter(
    (id) => /^N\d+$/i.test(id)
  );
  const sourceFrom =
    pickString(obj, "sourceFrom", 160) ?? pickString(obj, "from", 160);
  const targetPath = parseConceptPath(obj.targetPath ?? obj.toPath);
  let kind = parseReattachStepKind(obj.kind);
  if (!kind && targetPath?.length === 1) {
    kind = "merge_synonym";
  }
  if (!kind && targetPath && targetPath.length >= 2) {
    kind = "attach_under";
  }
  const action =
    pickString(obj, "action", 240) ??
    pickString(obj, "description", 240) ??
    "";
  const result = pickString(obj, "result", 240) ?? "";
  const hasNodeIds =
    Boolean(sourceNodeId) ||
    Boolean(targetNodeId) ||
    Boolean(targetNodeIds?.length);
  if (!kind) {
    return undefined;
  }
  if (!hasNodeIds && (!sourceFrom || !targetPath?.length)) {
    return undefined;
  }
  if (!hasNodeIds && targetPath) {
    if (kind === "merge_synonym" && targetPath.length !== 1) {
      return undefined;
    }
    if (kind === "attach_under" && targetPath.length < 2) {
      return undefined;
    }
  }
  if (hasNodeIds && !sourceNodeId) {
    return undefined;
  }
  const confidence = pickNumber01(obj, "confidence");
  const evidence = parseStringArray(obj.evidence, 16, 120);
  return {
    step: step > 0 ? step : 1,
    kind,
    sourceFrom: sourceFrom ?? "",
    targetPath: targetPath ?? [],
    sourceNodeId,
    targetNodeId,
    targetNodeIds,
    action,
    result,
    confidence,
    evidence,
  };
}

function parseReattachStepsList(raw: unknown[]): ReattachStep[] {
  const steps: ReattachStep[] = [];
  for (const item of raw) {
    const parsed = parseReattachStep(item);
    if (parsed) {
      steps.push(parsed);
    }
    if (steps.length >= MAX_MOVES) {
      break;
    }
  }
  return steps;
}

/** Prefer `steps[]`; fall back to legacy `moves[]`. */
export function tryParseReattachResponse(value: unknown): ReattachParseResult {
  const root = asObject(value);
  if (!root) {
    return { steps: [], moves: [] };
  }
  const stepsRaw = Array.isArray(root.steps) ? root.steps : [];
  const steps = parseReattachStepsList(stepsRaw);
  if (steps.length) {
    return { steps, moves: reattachStepsToMoves(steps) };
  }
  const moves = parseReattachMovesList(
    Array.isArray(root.moves) ? root.moves : []
  );
  return { steps: [], moves };
}

/** Lenient parse for optional trie-reparent stage (empty allowed). */
export function tryParseReattachMoves(value: unknown): ReattachMove[] {
  return tryParseReattachResponse(value).moves;
}

export function validateReattachMoves(value: unknown): ReattachParseResult {
  const parsed = tryParseReattachResponse(value);
  if (!parsed.steps.length && !parsed.moves.length) {
    throw new LlmProviderError(
      "bad-shape",
      "No usable steps[] or moves[] returned"
    );
  }
  return parsed;
}

