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
const MAX_HITS_PER_CODE = 2;
/** Reverse-boost factor: a codeRef hit distributes this fraction of its score
 * across the concepts it links to via sourceTurnIndices. Tunable against eval. */
const CODE_TO_CONCEPT_BOOST = 0.3;

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
  if (kind === "code") {
    // A code-path/description match is precise (filename hit or LLM-generated
    // purpose summary); rank alongside evidence, above concept.
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
  newestAnalyzedAt: number,
  verbose = false
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
  const kindRankScore = kindRank(hit.kind) * 2;
  const phraseScore = phraseBoost(searchableText, query);
  const coverageScore = queryCoverage(searchableText, terms) * 6;
  const score = hit.score + kindRankScore + phraseScore + coverageScore + recencyBoost;
  const out: SearchHit = { ...hit, score };
  if (verbose) {
    out.scoreBreakdown = {
      base: hit.score,
      kindRank: kindRankScore,
      phraseBoost: phraseScore,
      coverage: coverageScore,
      recency: recencyBoost,
      total: score,
    };
  }
  return out;
}

function diversifyHits(hits: SearchHit[], limit: number): SearchHit[] {
  const out: SearchHit[] = [];
  const sessionCounts = new Map<string, number>();
  const conceptCounts = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  const seenEvidence = new Set<string>();

  /**
   * Try to admit a hit under the per-session / per-concept / per-code caps.
   * `sessionCap` lets the fallback pass relax the per-session limit (the
   * primary pass uses MAX_HITS_PER_SESSION; the fallback uses Infinity so we
   * can fill remaining slots once first-pass diversity is satisfied).
   * Per-concept and per-code caps always apply — they exist to keep one
   * concept/code-cluster from flooding results, which matters in the fallback
   * too.
   */
  const tryAdmit = (hit: SearchHit, sessionCap: number): boolean => {
    const sessionCount = sessionCounts.get(hit.sessionId) ?? 0;
    if (sessionCount >= sessionCap) {
      return false;
    }
    if (hit.conceptKey) {
      const conceptKey = `${hit.sessionId}:${hit.conceptKey}`;
      const conceptCount = conceptCounts.get(conceptKey) ?? 0;
      if (conceptCount >= MAX_HITS_PER_CONCEPT) {
        return false;
      }
      conceptCounts.set(conceptKey, conceptCount + 1);
    }
    if (hit.kind === "code") {
      const codeCount = codeCounts.get(hit.sessionId) ?? 0;
      if (codeCount >= MAX_HITS_PER_CODE) {
        return false;
      }
      codeCounts.set(hit.sessionId, codeCount + 1);
    }
    if (hit.kind === "evidence") {
      const evidenceKey = `${hit.sessionId}:${hit.conceptKey ?? ""}:${hit.evidenceIndex ?? -1}`;
      if (seenEvidence.has(evidenceKey)) {
        return false;
      }
      seenEvidence.add(evidenceKey);
    }
    sessionCounts.set(hit.sessionId, sessionCount + 1);
    out.push(hit);
    return true;
  };

  for (const hit of hits) {
    if (out.length >= limit) break;
    tryAdmit(hit, MAX_HITS_PER_SESSION);
  }
  // Fallback: relax the per-session cap to fill remaining slots once the
  // primary diversity pass is satisfied. Per-concept and per-code caps still
  // apply (via tryAdmit), so a single concept or code cluster still cannot
  // dominate.
  if (out.length < limit) {
    for (const hit of hits) {
      if (out.length >= limit) break;
      if (out.includes(hit)) continue;
      tryAdmit(hit, Number.POSITIVE_INFINITY);
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

/**
 * Split a file path into whole-word tokens for precise path matching.
 * `src/auth/jwt.ts` → `src`, `auth`, `jwt`, `ts`. Whole words only — no ngrams,
 * because path characters (`/`, `.`, `_`, `-`) produce noisy 2-grams like
 * `sr` or `ut` that match unrelated text.
 */
function pathTokens(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const tokens = new Set<string>();
  for (const part of lower.split(/[/._-]+/)) {
    if (part) {
      tokens.add(part);
    }
  }
  return [...tokens];
}

/** Score a code reference's description + path against weighted query terms. */
function scoreCodeRef(
  description: string,
  filePath: string,
  terms: WeightedTerm[]
): { descriptionScore: number; pathScore: number } {
  const descriptionScore = scoreText(description, terms);
  const lowerPath = filePath.toLowerCase();
  let pathScore = 0;
  for (const { term, weight } of terms) {
    if (!term) continue;
    // Whole-token match on path segments (e.g. query "jwt" matches segment "jwt").
    const segments = lowerPath.split(/[/._-]+/);
    if (segments.includes(term)) {
      pathScore += 8 * weight;
    } else if (lowerPath.includes(term)) {
      // Substring fall-through (e.g. query "auth" matches "auth-helper.ts").
      pathScore += Math.max(2, Math.min(6, term.length)) * weight;
    }
  }
  return { descriptionScore, pathScore };
}

export function buildRecordTokenSets(records: SessionRecord[]): Set<string>[] {
  return records.map((record) => {
    const parts = [collectOutlineText(record), record.meta.sessionLabel];
    for (const ctx of record.conceptContexts ?? []) {
      parts.push(ctx.key, ctx.label, ...(ctx.aliases ?? []));
      parts.push(...ctx.domainKeys, ...ctx.parentKeys, ...ctx.childKeys);
      parts.push(...ctx.evidence);
    }
    // codeReferences: description feeds ngram tokens (semantic), path feeds
    // whole-word tokens (precise filename match). Without this, a record whose
    // only matching signal is in a codeRef description fails the pre-filter.
    for (const ref of record.sessionAnalysis?.codeReferences ?? []) {
      parts.push(ref.description);
      parts.push(ref.path);
    }
    const tokens = buildRecordTokenSet(parts.join("\n"));
    // Add path whole-word tokens separately (buildRecordTokenSet would ngram
    // the path and produce noise like "sr" / "ut").
    for (const ref of record.sessionAnalysis?.codeReferences ?? []) {
      for (const tok of pathTokens(ref.path)) {
        tokens.add(tok);
      }
    }
    return tokens;
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

/**
 * Build a map from turn index → set of concept keys whose outline node has a
 * `detail.sourceTurnIndices` entry pointing at that turn. Used by the codeRef
 * reverse-boost: when a codeRef (linked to turns via its own sourceTurnIndices)
 * matches the query, the concepts owning those turns get a share of the score.
 *
 * conceptPath is the source of concept keys; if a node has no conceptPath it
 * contributes nothing (we can't link it back to a concept).
 */
function buildTurnToConceptKeys(record: SessionRecord): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const walk = (nodes: SessionRecord["outline"]["outline"]): void => {
    for (const node of nodes) {
      const conceptKey = node.conceptPath?.[node.conceptPath.length - 1];
      if (conceptKey) {
        for (const detail of node.details ?? []) {
          for (const turn of detail.sourceTurnIndices ?? []) {
            let set = out.get(turn);
            if (!set) {
              set = new Set<string>();
              out.set(turn, set);
            }
            set.add(conceptKey);
          }
        }
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(record.outline.outline);
  return out;
}

export function searchProjectRecords(
  records: SessionRecord[],
  query: string,
  limit: number,
  equivalences: SegmentEquivalence[] = [],
  precomputedConceptTerms?: ConceptTermEntry[],
  precomputedRecordTokens?: Set<string>[],
  verbose = false
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

    // Track this record's concept hits by key so codeRef reverse-boost can
    // add score to the owning concept after the code branch runs.
    const conceptHitsByKey = new Map<string, SearchHit>();
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
        const hit: SearchHit = {
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
        };
        hits.push(hit);
        conceptHitsByKey.set(ctx.key, hit);
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

    // codeReferences: score each as a "code" hit. A codeRef is sparse (only
    // sessions that touched code have it) and its description is an independent
    // LLM-generated semantic view of the diff, so it often matches queries that
    // outline/concept/evidence text misses.
    const codeRefs = record.sessionAnalysis?.codeReferences ?? [];
    if (codeRefs.length) {
      const turnToConceptKeys = buildTurnToConceptKeys(record);
      for (const ref of codeRefs) {
        const { descriptionScore, pathScore } = scoreCodeRef(ref.description, ref.path, terms);
        if (descriptionScore <= 0 && pathScore <= 0) {
          continue;
        }
        const codeScore = descriptionScore * 1.2 + pathScore + 3;
        hits.push({
          kind: "code",
          projectSlug: record.meta.projectSlug,
          sessionId: record.meta.sessionId,
          sessionLabel: record.meta.sessionLabel,
          analyzedAt: record.meta.analyzedAt,
          codePath: ref.path,
          codeLines: ref.lines,
          codeDescription: ref.description,
          codeSourceTurnIndices: ref.sourceTurnIndices,
          codeMarkCode: ref.markCode,
          score: codeScore,
          snippet: truncateSnippet(`${ref.path}:${ref.lines} — ${ref.description}`),
          evidence: [ref.description],
        });

        // Reverse concept boost: distribute a fraction of the codeRef score
        // across concepts linked via sourceTurnIndices → outline details.
        // If a linked concept produced no hit of its own (its text did not
        // match the query), synthesize a low-base concept hit so the codeRef's
        // semantic link still surfaces the concept — otherwise codeRef →
        // concept attribution is lost whenever the concept text is silent.
        const linkedKeys = new Set<string>();
        for (const turn of ref.sourceTurnIndices ?? []) {
          const keys = turnToConceptKeys.get(turn);
          if (keys) {
            for (const k of keys) linkedKeys.add(k);
          }
        }
        if (linkedKeys.size > 0) {
          const boost = (codeScore * CODE_TO_CONCEPT_BOOST) / linkedKeys.size;
          for (const key of linkedKeys) {
            let conceptHit = conceptHitsByKey.get(key);
            if (!conceptHit) {
              const ctx = record.conceptContexts?.find((c) => c.key === key);
              if (!ctx) continue;
              conceptHit = {
                kind: "concept",
                projectSlug: record.meta.projectSlug,
                sessionId: record.meta.sessionId,
                sessionLabel: record.meta.sessionLabel,
                analyzedAt: record.meta.analyzedAt,
                conceptKey: ctx.key,
                conceptLabel: ctx.label,
                // Small base so the synthesized hit ranks below direct concept
                // matches but is eligible for the boost and diversify caps.
                score: 1,
                snippet: truncateSnippet(ctx.evidence[0] ?? ctx.label),
                evidence: ctx.evidence.slice(0, 5),
              };
              hits.push(conceptHit);
              conceptHitsByKey.set(key, conceptHit);
            }
            conceptHit.score += boost;
          }
        }
      }
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
    .map((hit) => rerankHit(hit, query, terms, newestAnalyzedAt, verbose))
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

  size(): number {
    return this.cache.size;
  }
}
