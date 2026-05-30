import { LlmProviderError } from "./types";
import type {
  ConceptOntology,
  ConceptOntologyMapping,
  ConceptOntologyNode,
  OntologyRefineResult,
  ReattachMove,
  SegmentEquivalence,
  TopicPathDecision,
} from "./types";
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

export function validateReattachMoves(value: unknown): { moves: ReattachMove[] } {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected object with moves[]");
  }
  const raw = Array.isArray(root.moves) ? root.moves : [];
  const moves = parseReattachMovesList(raw);
  if (!moves.length) {
    throw new LlmProviderError("bad-shape", "No usable moves returned");
  }
  return { moves };
}

/** Lenient parse for optional trie-reparent stage (empty moves allowed). */
export function tryParseReattachMoves(value: unknown): ReattachMove[] {
  const root = asObject(value);
  if (!root) {
    return [];
  }
  const raw = Array.isArray(root.moves) ? root.moves : [];
  return parseReattachMovesList(raw);
}

