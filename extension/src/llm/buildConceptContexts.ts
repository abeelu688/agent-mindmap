import type { ConceptOntologyNode, SessionAnalysis } from "./types";
import type { ConceptContextForMerge, SessionRecord } from "../store/storeTypes";

export type BuildConceptContextsMeta = {
  sessionId: string;
  projectSlug: string;
};

function normalizeKey(key: string): string {
  return key.toLowerCase().trim();
}

function resolveDomainKeys(
  key: string,
  nodesByKey: Map<string, ConceptOntologyNode>,
  domainSet: Set<string>
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let current = normalizeKey(key);

  while (current && !visited.has(current)) {
    visited.add(current);
    if (domainSet.has(current)) {
      path.unshift(current);
      break;
    }
    const node = nodesByKey.get(current);
    const parent = node?.parentKeys?.[0]
      ? normalizeKey(node.parentKeys[0])
      : "";
    if (!parent || parent === current) {
      break;
    }
    path.unshift(current);
    current = parent;
  }

  if (!path.length && domainSet.has(normalizeKey(key))) {
    return [normalizeKey(key)];
  }

  const domains = path.filter((s) => domainSet.has(s));
  if (domains.length) {
    return domains;
  }
  const firstDomain = [...domainSet][0];
  return firstDomain ? [firstDomain] : [];
}

/**
 * S2 DET: derive childKeys from parentKeys and build per-node merge context for Part II.
 */
export function buildConceptContextsFromAnalysis(
  analysis: SessionAnalysis,
  meta: BuildConceptContextsMeta
): ConceptContextForMerge[] {
  const domainSet = new Set(
    (analysis.domains ?? []).map((d) => normalizeKey(d)).filter(Boolean)
  );
  const nodesByKey = new Map<string, ConceptOntologyNode>();
  for (const node of analysis.nodes ?? []) {
    const k = normalizeKey(node.key);
    if (!k) {
      continue;
    }
    nodesByKey.set(k, node);
  }

  const childKeysByParent = new Map<string, Set<string>>();
  for (const node of nodesByKey.values()) {
    const childKey = normalizeKey(node.key);
    for (const p of node.parentKeys ?? []) {
      const pk = normalizeKey(p);
      if (!pk || pk === childKey) {
        continue;
      }
      let set = childKeysByParent.get(pk);
      if (!set) {
        set = new Set();
        childKeysByParent.set(pk, set);
      }
      set.add(childKey);
    }
  }

  const contexts: ConceptContextForMerge[] = [];
  for (const node of nodesByKey.values()) {
    const key = normalizeKey(node.key);
    const parentKeys = (node.parentKeys ?? [])
      .map(normalizeKey)
      .filter((p) => p && p !== key);
    const childSet = childKeysByParent.get(key);
    const childKeys = childSet ? [...childSet].sort() : [];
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
      out.push(
        ...buildConceptContextsFromAnalysis(record.sessionAnalysis, {
          sessionId: record.meta.sessionId,
          projectSlug: record.meta.projectSlug,
        })
      );
    }
  }
  return out.slice(0, 200);
}
