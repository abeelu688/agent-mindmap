import { LlmProviderError } from "./types";
import { validateSessionOutline } from "./outlineValidate";
import type {
  CodeReference,
  SessionAnalysis,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTermAlias,
  TermWithContext,
} from "./types";
import {
  parseSegmentEquivalences,
  validateConceptOntology,
  validateOntologyRefine,
} from "./ontologyValidate";

const MAX_DOMAINS = 16;
const MAX_TERMS = 80;
const MAX_MENTIONS = 16;
const MAX_EVIDENCE = 12;
const MAX_KEY = 48;
const MAX_LABEL = 80;
const MAX_TERM_ALIASES = 40;

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

function parseStringArray(
  value: unknown,
  maxItems: number,
  maxLen: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
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
  return out;
}

function parseTerm(value: unknown): TermWithContext | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const key = pickString(obj, "key", MAX_KEY)?.toLowerCase();
  const label = pickString(obj, "label", MAX_LABEL);
  if (!key || !label) {
    return undefined;
  }
  const mentions = parseStringArray(obj.mentions, MAX_MENTIONS, MAX_LABEL);
  const evidence = parseStringArray(obj.evidence, MAX_EVIDENCE, 120);
  if (!evidence.length) {
    return undefined;
  }
  const suggestedParentKey = pickString(obj, "suggestedParentKey", MAX_KEY)?.toLowerCase();
  return {
    key,
    label,
    mentions: mentions.length ? mentions : [label],
    evidence,
    suggestedParentKey,
  };
}

function parseTermAlias(value: unknown): SessionTermAlias | undefined {
  const obj = asObject(value);
  if (!obj) {
    return undefined;
  }
  const canonical = pickString(obj, "canonical", MAX_KEY)?.toLowerCase();
  if (!canonical) {
    return undefined;
  }
  const aliases = parseStringArray(obj.aliases, MAX_MENTIONS, MAX_LABEL).map((s) =>
    s.toLowerCase()
  );
  const evidence = parseStringArray(obj.evidence, MAX_EVIDENCE, 120);
  if (!aliases.length) {
    return undefined;
  }
  return { canonical, aliases, evidence };
}

export function validateSessionConceptExtract(value: unknown): SessionConceptExtract {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected session concept extract object");
  }
  const domains = parseStringArray(root.domains, MAX_DOMAINS, MAX_KEY).map((s) =>
    s.toLowerCase()
  );
  const termsRaw = Array.isArray(root.terms) ? root.terms : [];
  const terms: TermWithContext[] = [];
  const seenKeys = new Set<string>();
  for (const raw of termsRaw) {
    const parsed = parseTerm(raw);
    if (!parsed || seenKeys.has(parsed.key)) {
      continue;
    }
    seenKeys.add(parsed.key);
    terms.push(parsed);
    if (terms.length >= MAX_TERMS) {
      break;
    }
  }
  if (!terms.length) {
    throw new LlmProviderError("bad-shape", "Extract returned no usable terms");
  }
  return { domains, terms };
}

export function validateSessionSynonymRefine(value: unknown): SessionSynonymRefine {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected session synonym refine object");
  }
  const segmentEquivalences = parseSegmentEquivalences(root.segmentEquivalences);
  const aliasesRaw = Array.isArray(root.termAliases) ? root.termAliases : [];
  const termAliases: SessionTermAlias[] = [];
  for (const raw of aliasesRaw) {
    const parsed = parseTermAlias(raw);
    if (parsed) {
      termAliases.push(parsed);
    }
    if (termAliases.length >= MAX_TERM_ALIASES) {
      break;
    }
  }
  return { segmentEquivalences, termAliases };
}

const MAX_CODE_REF_PATH = 200;
const MAX_CODE_REF_LINES = 40;
const MAX_CODE_REF_DESC = 80;
const MAX_CODE_REFS = 50;

function parseCodeReferences(raw: unknown): CodeReference[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CodeReference[] = [];
  for (const item of raw) {
    const obj = asObject(item);
    if (!obj) {
      continue;
    }
    let path = pickString(obj, "path", MAX_CODE_REF_PATH);
    if (!path) {
      continue;
    }
    path = path.replace(/^\/+/, "");
    if (!path) {
      continue;
    }
    const lines = pickString(obj, "lines", MAX_CODE_REF_LINES);
    if (!lines) {
      continue;
    }
    const description = pickString(obj, "description", MAX_CODE_REF_DESC);
    if (!description) {
      continue;
    }
    out.push({ path, lines, description });
    if (out.length >= MAX_CODE_REFS) {
      break;
    }
  }
  return out;
}

export function validateSessionAnalysis(value: unknown): SessionAnalysis {
  const root = asObject(value);
  if (!root) {
    throw new LlmProviderError("bad-shape", "Expected session analysis object");
  }
  const domains = parseStringArray(root.domains, MAX_DOMAINS, MAX_KEY).map((s) =>
    s.toLowerCase()
  );
  const ontologyPartial = validateConceptOntology({
    nodes: root.nodes,
    mappings: root.mappings ?? [],
    topicPaths: [],
  });
  for (const node of ontologyPartial.nodes) {
    if (!node.evidence?.length) {
      throw new LlmProviderError(
        "bad-shape",
        `Node "${node.key}" missing evidence (required for merge context)`
      );
    }
  }
  const outline = validateSessionOutline(root.outline);
  const equivRaw = Array.isArray(root.segmentEquivalences)
    ? root.segmentEquivalences
    : [];
  const segmentEquivalences = parseSegmentEquivalences(equivRaw);
  const equivWithCanonical = equivRaw.filter((item) => {
    const obj = asObject(item);
    return obj && pickString(obj, "canonical", MAX_KEY);
  }).length;
  if (equivWithCanonical !== segmentEquivalences.length) {
    throw new LlmProviderError(
      "bad-shape",
      "Invalid segment equivalence (missing scope or aliases)"
    );
  }
  const aliasesRaw = Array.isArray(root.termAliases) ? root.termAliases : [];
  const termAliases: SessionTermAlias[] = [];
  for (const raw of aliasesRaw) {
    const parsed = parseTermAlias(raw);
    if (parsed) {
      termAliases.push(parsed);
    }
    if (termAliases.length >= MAX_TERM_ALIASES) {
      break;
    }
  }
  const codeReferences = parseCodeReferences(root.codeReferences);
  return {
    domains,
    nodes: ontologyPartial.nodes,
    mappings: ontologyPartial.mappings.length
      ? ontologyPartial.mappings
      : undefined,
    segmentEquivalences,
    termAliases: termAliases.length ? termAliases : undefined,
    outline,
    codeReferences: codeReferences.length ? codeReferences : undefined,
  };
}

export { validateOntologyRefine };