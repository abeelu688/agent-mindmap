import {
  collectChildEdgesFromParentKeys,
  enrichAnalysisNodesFromOutline,
  normalizeConceptKey,
} from "./enrichNodeChildrenFromOutline";
import type { ConceptOntologyNode, SessionAnalysis } from "./types";
import type { ConceptContextForMerge, SessionRecord } from "../store/storeTypes";

export type BuildConceptContextsMeta = {
  sessionId: string;
  projectSlug: string;
};

function resolveDomainKeys(
  key: string,
  nodesByKey: Map<string, ConceptOntologyNode>,
  domainSet: Set<string>
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let current = normalizeConceptKey(key);

  while (current && !visited.has(current)) {
    visited.add(current);
    if (domainSet.has(current)) {
      path.unshift(current);
      break;
    }
    const node = nodesByKey.get(current);
    const parent = node?.parentKeys?.[0]
      ? normalizeConceptKey(node.parentKeys[0])
      : "";
    if (!parent || parent === current) {
      break;
    }
    path.unshift(current);
    current = parent;
  }

  if (!path.length && domainSet.has(normalizeConceptKey(key))) {
    return [normalizeConceptKey(key)];
  }

  const domains = path.filter((s) => domainSet.has(s));
  if (domains.length) {
    return domains;
  }
  const firstDomain = [...domainSet][0];
  return firstDomain ? [firstDomain] : [];
}

function unionChildKeys(
  ...lists: (string[] | undefined)[]
): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const k of list ?? []) {
      const nk = normalizeConceptKey(k);
      if (nk) {
        set.add(nk);
      }
    }
  }
  return [...set].sort();
}

/**
 * S2 DET: build per-node merge context for Part II (uses enriched node.childKeys).
 */
export function buildConceptContextsFromAnalysis(
  analysis: SessionAnalysis,
  meta: BuildConceptContextsMeta
): ConceptContextForMerge[] {
  const domainSet = new Set(
    (analysis.domains ?? []).map((d) => normalizeConceptKey(d)).filter(Boolean)
  );
  const nodesByKey = new Map<string, ConceptOntologyNode>();
  for (const node of analysis.nodes ?? []) {
    const k = normalizeConceptKey(node.key);
    if (!k) {
      continue;
    }
    nodesByKey.set(k, node);
  }

  const childKeysByParent = collectChildEdgesFromParentKeys(
    analysis.nodes ?? []
  );

  const contexts: ConceptContextForMerge[] = [];
  for (const node of nodesByKey.values()) {
    const key = normalizeConceptKey(node.key);
    const parentKeys = (node.parentKeys ?? [])
      .map(normalizeConceptKey)
      .filter((p) => p && p !== key);
    const fromInverse = childKeysByParent.get(key);
    const childKeys = unionChildKeys(
      node.childKeys,
      fromInverse ? [...fromInverse] : []
    );
    const evidence =
      node.evidence?.length ? node.evidence : [node.label || key];
    contexts.push({
      key,
      label: node.label || key,
      aliases: node.aliases?.map((a) => a.toLowerCase()),
      domainKeys: resolveDomainKeys(key, nodesByKey, domainSet),
      parentKeys,
      childKeys,
      evidence,
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
    });
  }

  return contexts.sort((a, b) => a.key.localeCompare(b.key));
}

/** Aggregate concept contexts from records (persisted or backfill from sessionAnalysis). */
export function collectConceptContextsForMerge(
  records: SessionRecord[]
): ConceptContextForMerge[] {
  const out: ConceptContextForMerge[] = [];
  for (const record of records) {
    if (record.conceptContexts?.length) {
      out.push(...record.conceptContexts);
      continue;
    }
    if (record.sessionAnalysis) {
      const enriched = enrichAnalysisNodesFromOutline({
        ...record.sessionAnalysis,
        outline: record.outline,
      });
      out.push(
        ...buildConceptContextsFromAnalysis(enriched, {
          sessionId: record.meta.sessionId,
          projectSlug: record.meta.projectSlug,
        })
      );
    }
  }
  return out.slice(0, 200);
}
