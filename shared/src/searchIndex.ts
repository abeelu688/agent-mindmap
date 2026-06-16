import type { ConceptContextForMerge, SearchHit, SessionRecord } from "./storeTypes";

const CJK_REGEX = /[㐀-鿿豈-﫿]/;

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
  // Whitespace-separated tokens (good for English/numbers).
  for (const t of lower.split(/\s+/)) {
    if (!t) continue;
    out.add(t);
    // For CJK chunks inside a token, also push 2-grams + 3-grams so we can
    // match any of them inside the haystack.
    if (hasCjk(t) && t.length >= 2) {
      for (const g of ngrams(t, 2)) out.add(g);
      if (t.length >= 3) {
        for (const g of ngrams(t, 3)) out.add(g);
      }
    }
  }
  return [...out].filter(Boolean);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) {
      continue;
    }
    if (lower === term) {
      score += 10;
    } else if (lower.includes(term)) {
      // Longer terms are more specific → weight more.
      score += Math.max(2, Math.min(8, term.length));
    }
  }
  return score;
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
  const terms = tokenizeQuery(query);
  if (!terms.length) {
    return [];
  }
  const hits: SearchHit[] = [];

  for (const record of records) {
    const outlineText = collectOutlineText(record);
    const outlineScore = scoreText(outlineText, terms) + scoreText(record.meta.sessionLabel, terms);

    if (outlineScore > 0) {
      hits.push({
        projectSlug: record.meta.projectSlug,
        sessionId: record.meta.sessionId,
        sessionLabel: record.meta.sessionLabel,
        score: outlineScore,
        snippet: truncateSnippet(outlineText || record.meta.sessionLabel),
        evidence: [],
      });
    }

    for (const ctx of record.conceptContexts ?? []) {
      const ctxText = [
        ctx.key,
        ctx.label,
        ...(ctx.aliases ?? []),
        ...ctx.domainKeys,
        ...ctx.evidence,
      ].join("\n");
      const ctxScore = scoreText(ctxText, terms);
      // Aliases/key matches deserve a small extra boost.
      const aliasBoost =
        (ctx.aliases ?? []).some((a) => terms.includes(a.toLowerCase())) ||
        terms.includes(ctx.key.toLowerCase()) ||
        terms.includes(ctx.label.toLowerCase())
          ? 4
          : 0;
      if (ctxScore <= 0 && aliasBoost <= 0) {
        continue;
      }
      hits.push({
        projectSlug: record.meta.projectSlug,
        sessionId: record.meta.sessionId,
        sessionLabel: record.meta.sessionLabel,
        conceptKey: ctx.key,
        conceptLabel: ctx.label,
        score: ctxScore + 2 + aliasBoost,
        snippet: truncateSnippet(ctx.evidence[0] ?? ctx.label),
        evidence: ctx.evidence.slice(0, 5),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || b.sessionId.localeCompare(a.sessionId));
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
