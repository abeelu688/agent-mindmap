import type {
  ConceptContextForMerge,
  SearchHit,
  SegmentEquivalence,
  SessionRecord,
} from "./storeTypes";

const CJK_REGEX = /[㐀-鿿豈-﫿]/;
const CANDIDATE_MULTIPLIER = 5;
const MAX_HITS_PER_SESSION = 3;
const MAX_HITS_PER_CONCEPT = 2;

type WeightedTerm = {
  term: string;
  weight: number;
};

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}

function hasCjk(text: string): boolean {
  return CJK_REGEX.test(text);
}

function ngrams(text: string, n: number): string[] {
  if (text.length < n) {
    return text ? [text] : [];
  }
  const out: string[] = [];
  for (let i = 0; i + n <= text.length; i++) {
    out.push(text.slice(i, i + n));
  }
  return out;
}

function tokenizeQuery(query: string): string[] {
  const lower = normalizeQuery(query);
  if (!lower) {
    return [];
  }
  const out = new Set<string>();
  for (const t of lower.split(/\s+/)) {
    if (!t) continue;
    out.add(t);
    if (hasCjk(t) && t.length >= 2) {
      for (const g of ngrams(t, 2)) out.add(g);
      if (t.length >= 3) {
        for (const g of ngrams(t, 3)) out.add(g);
      }
    }
  }
  return [...out].filter(Boolean);
}

export type ConceptTermEntry = {
  ctx: ConceptContextForMerge;
  terms: string[];
};

export function buildConceptTermIndex(records: SessionRecord[]): ConceptTermEntry[] {
  const out: ConceptTermEntry[] = [];
  for (const record of records) {
    for (const ctx of record.conceptContexts ?? []) {
      const conceptTerms = [ctx.key, ctx.label, ...(ctx.aliases ?? [])];
      out.push({ ctx, terms: conceptTerms.map(normalizeQuery) });
    }
  }
  return out;
}

function weightedTerms(
  query: string,
  conceptTerms: ConceptTermEntry[],
  equivalences: SegmentEquivalence[] = []
): WeightedTerm[] {
  const rawTerms = tokenizeQuery(query);
  const terms = new Map<string, number>();
  const add = (term: string, weight: number): void => {
    const normalized = normalizeQuery(term);
    if (!normalized) {
      return;
    }
    terms.set(normalized, Math.max(terms.get(normalized) ?? 0, weight));
  };

  for (const term of rawTerms) {
    add(term, 1);
  }

  for (const entry of conceptTerms) {
    if (!entry.terms.some((term) => rawTerms.some((q) => term.includes(q)))) {
      continue;
    }
    for (const term of entry.terms) {
      add(term, 0.7);
      for (const token of tokenizeQuery(term)) {
        add(token, 0.55);
      }
    }
  }

  for (const eq of equivalences) {
    const eqTerms = [eq.canonical, ...(eq.aliases ?? [])];
    const normalized = eqTerms.map(normalizeQuery);
    if (!normalized.some((term) => rawTerms.some((q) => term.includes(q) || q.includes(term)))) {
      continue;
    }
    for (const term of eqTerms) {
      add(term, 0.65);
      for (const token of tokenizeQuery(term)) {
        add(token, 0.5);
      }
    }
  }

  return [...terms.entries()].map(([term, weight]) => ({ term, weight }));
}

function scoreText(text: string, terms: WeightedTerm[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const { term, weight } of terms) {
    if (!term) {
      continue;
    }
    if (lower === term) {
      score += 10 * weight;
    } else if (lower.includes(term)) {
      score += Math.max(2, Math.min(8, term.length)) * weight;
    }
  }
  return score;
}

function exactConceptMatch(ctx: ConceptContextForMerge, terms: WeightedTerm[]): boolean {
  const conceptTerms = [ctx.key, ctx.label, ...(ctx.aliases ?? [])].map(normalizeQuery);
  return conceptTerms.some((conceptTerm) => terms.some(({ term }) => conceptTerm === term));
}

function kindRank(kind: SearchHit["kind"]): number {
  if (kind === "evidence") {
    return 3;
  }
  if (kind === "concept") {
    return 2;
  }
  return 1;
}

function phraseBoost(text: string, query: string): number {
  const normalizedText = normalizeQuery(text);
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery || !normalizedText.includes(normalizedQuery)) {
    return 0;
  }
  return Math.min(12, normalizedQuery.length);
}

function queryCoverage(text: string, terms: WeightedTerm[]): number {
  const lower = text.toLowerCase();
  const rawTerms = terms.filter((t) => t.weight >= 1);
  if (!rawTerms.length) {
    return 0;
  }
  const matched = rawTerms.filter(({ term }) => lower.includes(term)).length;
  return matched / rawTerms.length;
}

function rerankHit(
  hit: SearchHit,
  query: string,
  terms: WeightedTerm[],
  newestAnalyzedAt: number
): SearchHit {
  const searchableText = [
    hit.snippet,
    ...hit.evidence,
    hit.conceptKey,
    hit.conceptLabel,
    hit.sessionLabel,
  ]
    .filter(Boolean)
    .join("\n");
  const recencyBoost =
    newestAnalyzedAt > 0 ? Math.max(0, hit.analyzedAt / newestAnalyzedAt) * 1.5 : 0;
  const score =
    hit.score +
    kindRank(hit.kind) * 2 +
    phraseBoost(searchableText, query) +
    queryCoverage(searchableText, terms) * 6 +
    recencyBoost;
  return { ...hit, score };
}

function diversifyHits(hits: SearchHit[], limit: number): SearchHit[] {
  const out: SearchHit[] = [];
  const sessionCounts = new Map<string, number>();
  const conceptCounts = new Map<string, number>();
  const seenEvidence = new Set<string>();

  for (const hit of hits) {
    const sessionCount = sessionCounts.get(hit.sessionId) ?? 0;
    if (sessionCount >= MAX_HITS_PER_SESSION) {
      continue;
    }
    if (hit.conceptKey) {
      const conceptKey = `${hit.sessionId}:${hit.conceptKey}`;
      const conceptCount = conceptCounts.get(conceptKey) ?? 0;
      if (conceptCount >= MAX_HITS_PER_CONCEPT) {
        continue;
      }
      conceptCounts.set(conceptKey, conceptCount + 1);
    }
    if (hit.kind === "evidence") {
      const evidenceKey = `${hit.sessionId}:${hit.conceptKey ?? ""}:${hit.evidenceIndex ?? -1}`;
      if (seenEvidence.has(evidenceKey)) {
        continue;
      }
      seenEvidence.add(evidenceKey);
    }
    sessionCounts.set(hit.sessionId, sessionCount + 1);
    out.push(hit);
    if (out.length >= limit) {
      return out;
    }
  }

  for (const hit of hits) {
    if (out.includes(hit)) {
      continue;
    }
    out.push(hit);
    if (out.length >= limit) {
      return out;
    }
  }
  return out;
}

function buildRecordTokenSet(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (let i = 0; i + 2 <= lower.length; i++) {
    tokens.add(lower.slice(i, i + 2));
  }
  for (let i = 0; i + 3 <= lower.length; i++) {
    tokens.add(lower.slice(i, i + 3));
  }
  for (const word of lower.split(/\s+/)) {
    if (word) {
      tokens.add(word);
    }
  }
  return tokens;
}

export function buildRecordTokenSets(records: SessionRecord[]): Set<string>[] {
  return records.map((record) => {
    const parts = [collectOutlineText(record), record.meta.sessionLabel];
    for (const ctx of record.conceptContexts ?? []) {
      parts.push(ctx.key, ctx.label, ...(ctx.aliases ?? []));
      parts.push(...ctx.domainKeys, ...ctx.parentKeys, ...ctx.childKeys);
      parts.push(...ctx.evidence);
    }
    return buildRecordTokenSet(parts.join("\n"));
  });
}

function queryTermNgrams(term: string): string[] {
  if (term.length >= 3) {
    const out: string[] = [];
    for (let i = 0; i + 3 <= term.length; i++) {
      out.push(term.slice(i, i + 3));
    }
    return out;
  }
  if (term.length === 2) {
    return [term];
  }
  return [];
}

function recordCouldMatch(tokenSet: Set<string>, queryTerms: WeightedTerm[]): boolean {
  for (const { term, weight } of queryTerms) {
    if (weight < 1) {
      continue;
    }
    if (tokenSet.has(term)) {
      return true;
    }
    for (const ng of queryTermNgrams(term)) {
      if (tokenSet.has(ng)) {
        return true;
      }
    }
  }
  return false;
}

function collectOutlineText(record: SessionRecord): string {
  const parts: string[] = [];
  if (record.outline.title) {
    parts.push(record.outline.title);
  }
  if (record.outline.summary) {
    parts.push(record.outline.summary);
  }
  const walk = (nodes: SessionRecord["outline"]["outline"]): void => {
    for (const node of nodes) {
      parts.push(node.title);
      if (node.summary) {
        parts.push(node.summary);
      }
      for (const d of node.details ?? []) {
        parts.push(d.text);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(record.outline.outline);
  return parts.join("\n");
}

export function searchProjectRecords(
  records: SessionRecord[],
  query: string,
  limit: number,
  equivalences: SegmentEquivalence[] = [],
  precomputedConceptTerms?: ConceptTermEntry[],
  precomputedRecordTokens?: Set<string>[]
): SearchHit[] {
  const conceptTerms = precomputedConceptTerms ?? buildConceptTermIndex(records);
  const terms = weightedTerms(query, conceptTerms, equivalences);
  if (!terms.length) {
    return [];
  }
  const hits: SearchHit[] = [];

  for (let recordIdx = 0; recordIdx < records.length; recordIdx++) {
    const record = records[recordIdx];
    if (precomputedRecordTokens && !recordCouldMatch(precomputedRecordTokens[recordIdx], terms)) {
      continue;
    }
    const outlineText = collectOutlineText(record);
    const outlineScore = scoreText(outlineText, terms) + scoreText(record.meta.sessionLabel, terms);

    if (outlineScore > 0) {
      hits.push({
        kind: "session",
        projectSlug: record.meta.projectSlug,
        sessionId: record.meta.sessionId,
        sessionLabel: record.meta.sessionLabel,
        analyzedAt: record.meta.analyzedAt,
        score: outlineScore,
        snippet: truncateSnippet(outlineText || record.meta.sessionLabel),
        evidence: [],
      });
    }

    for (const ctx of record.conceptContexts ?? []) {
      const conceptText = [
        ctx.key,
        ctx.label,
        ...(ctx.aliases ?? []),
        ...ctx.domainKeys,
        ...ctx.parentKeys,
        ...ctx.childKeys,
      ].join("\n");
      const conceptScore = scoreText(conceptText, terms);
      const exactConceptBoost = exactConceptMatch(ctx, terms) ? 6 : 0;

      if (conceptScore > 0 || exactConceptBoost > 0) {
        hits.push({
          kind: "concept",
          projectSlug: record.meta.projectSlug,
          sessionId: record.meta.sessionId,
          sessionLabel: record.meta.sessionLabel,
          analyzedAt: record.meta.analyzedAt,
          conceptKey: ctx.key,
          conceptLabel: ctx.label,
          score: conceptScore + exactConceptBoost + 2,
          snippet: truncateSnippet(ctx.evidence[0] ?? ctx.label),
          evidence: ctx.evidence.slice(0, 5),
        });
      }

      ctx.evidence.forEach((evidence, evidenceIndex) => {
        const evidenceScore = scoreText(evidence, terms);
        if (evidenceScore <= 0 && conceptScore <= 0 && exactConceptBoost <= 0) {
          return;
        }
        hits.push({
          kind: "evidence",
          projectSlug: record.meta.projectSlug,
          sessionId: record.meta.sessionId,
          sessionLabel: record.meta.sessionLabel,
          analyzedAt: record.meta.analyzedAt,
          conceptKey: ctx.key,
          conceptLabel: ctx.label,
          evidenceIndex,
          score: evidenceScore * 1.4 + conceptScore * 0.35 + exactConceptBoost + 4,
          snippet: truncateSnippet(evidence),
          evidence: [evidence],
        });
      });
    }
  }

  const newestAnalyzedAt = records.reduce(
    (max, record) => Math.max(max, record.meta.analyzedAt),
    0
  );
  const candidateLimit = Math.max(limit, limit * CANDIDATE_MULTIPLIER);
  const candidates = hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        kindRank(b.kind) - kindRank(a.kind) ||
        b.sessionId.localeCompare(a.sessionId)
    )
    .slice(0, candidateLimit)
    .map((hit) => rerankHit(hit, query, terms, newestAnalyzedAt))
    .sort(
      (a, b) =>
        b.score - a.score ||
        kindRank(b.kind) - kindRank(a.kind) ||
        b.sessionId.localeCompare(a.sessionId)
    );

  return diversifyHits(candidates, limit);
}

export function collectConceptContexts(records: SessionRecord[]): ConceptContextForMerge[] {
  const out: ConceptContextForMerge[] = [];
  for (const record of records) {
    for (const ctx of record.conceptContexts ?? []) {
      out.push(ctx);
    }
  }
  return out;
}

function truncateSnippet(text: string, max = 240): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

export type ProjectSearchIndex = {
  projectSlug: string;
  revision: number;
  sourceMtimeMs: number;
  records: SessionRecord[];
  conceptTerms: ConceptTermEntry[];
  recordTokens: Set<string>[];
  builtAt: number;
};

export class McpSearchIndexCache {
  private static readonly MAX_ENTRIES = 8;
  private cache = new Map<string, ProjectSearchIndex>();
  private inflight = new Map<string, Promise<ProjectSearchIndex>>();

  get(projectSlug: string): ProjectSearchIndex | undefined {
    const value = this.cache.get(projectSlug);
    if (value) {
      this.cache.delete(projectSlug);
      this.cache.set(projectSlug, value);
    }
    return value;
  }

  set(index: ProjectSearchIndex): void {
    if (this.cache.has(index.projectSlug)) {
      this.cache.delete(index.projectSlug);
    }
    this.cache.set(index.projectSlug, index);
    while (this.cache.size > McpSearchIndexCache.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Dedupe concurrent builds for the same project slug. If a build is already
   * running, callers share its promise instead of triggering another full
   * `listRecordsForProject` scan.
   */
  async build(
    projectSlug: string,
    builder: () => Promise<ProjectSearchIndex>
  ): Promise<ProjectSearchIndex> {
    const cached = this.cache.get(projectSlug);
    if (cached) {
      return cached;
    }
    const existing = this.inflight.get(projectSlug);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const index = await builder();
        this.set(index);
        return index;
      } finally {
        this.inflight.delete(projectSlug);
      }
    })();
    this.inflight.set(projectSlug, promise);
    return promise;
  }

  invalidate(projectSlug?: string): void {
    if (projectSlug) {
      this.cache.delete(projectSlug);
    } else {
      this.cache.clear();
    }
  }
}
