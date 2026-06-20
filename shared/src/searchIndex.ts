import type { ConceptContextForMerge, SearchHit, SessionRecord } from "./storeTypes";

const CJK_REGEX = /[㐀-鿿豈-﫿]/;

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

function weightedTerms(query: string, records: SessionRecord[]): WeightedTerm[] {
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

  for (const record of records) {
    for (const ctx of record.conceptContexts ?? []) {
      const conceptTerms = [ctx.key, ctx.label, ...(ctx.aliases ?? [])];
      const searchableConcept = conceptTerms.map(normalizeQuery);
      if (!searchableConcept.some((term) => rawTerms.some((q) => term.includes(q)))) {
        continue;
      }
      for (const term of conceptTerms) {
        add(term, 0.7);
        for (const token of tokenizeQuery(term)) {
          add(token, 0.55);
        }
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
  limit: number
): SearchHit[] {
  const terms = weightedTerms(query, records);
  if (!terms.length) {
    return [];
  }
  const hits: SearchHit[] = [];

  for (const record of records) {
    const outlineText = collectOutlineText(record);
    const outlineScore = scoreText(outlineText, terms) + scoreText(record.meta.sessionLabel, terms);

    if (outlineScore > 0) {
      hits.push({
        kind: "session",
        projectSlug: record.meta.projectSlug,
        sessionId: record.meta.sessionId,
        sessionLabel: record.meta.sessionLabel,
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

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      kindRank(b.kind) - kindRank(a.kind) ||
      b.sessionId.localeCompare(a.sessionId)
  );
  return hits.slice(0, limit);
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
  builtAt: number;
};

export class McpSearchIndexCache {
  private cache = new Map<string, ProjectSearchIndex>();

  get(projectSlug: string): ProjectSearchIndex | undefined {
    return this.cache.get(projectSlug);
  }

  set(index: ProjectSearchIndex): void {
    this.cache.set(index.projectSlug, index);
  }

  invalidate(projectSlug?: string): void {
    if (projectSlug) {
      this.cache.delete(projectSlug);
    } else {
      this.cache.clear();
    }
  }
}
