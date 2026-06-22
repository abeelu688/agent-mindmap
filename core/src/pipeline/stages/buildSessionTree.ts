import { normalizeConceptPath } from "../../llm/normalizeConceptPath";
import { resolveConceptPathWithEquivalences } from "../../llm/resolveConceptPathWithEquivalences";
import type {
  ConceptOntologyMapping,
  ConceptOntologyNode,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  TopicPathDecision,
} from "../../llm/types";

export type BuildSessionTreeMeta = {
  sessionId: string;
  projectSlug: string;
};

function mergeAliases(
  node: ConceptOntologyNode,
  extra: string[]
): ConceptOntologyNode {
  const set = new Set((node.aliases ?? []).map((a) => a.toLowerCase()));
  for (const a of extra) {
    const lower = a.toLowerCase();
    if (lower !== node.key && !set.has(lower)) {
      set.add(lower);
    }
  }
  const aliases = Array.from(set);
  return aliases.length ? { ...node, aliases } : node;
}

/**
 * S3 DET: build hierarchical concept tree from S1 extract + S2 synonyms.
 */
export function buildSessionTree(
  extract: SessionConceptExtract,
  synonyms: SessionSynonymRefine,
  meta: BuildSessionTreeMeta
): SessionTreeSnapshot {
  const nodesByKey = new Map<string, ConceptOntologyNode>();
  const mappings: ConceptOntologyMapping[] = [];
  const mappingSeen = new Set<string>();

  for (const domain of extract.domains) {
    const key = domain.toLowerCase().trim();
    if (!key || nodesByKey.has(key)) {
      continue;
    }
    nodesByKey.set(key, { key, label: domain, parentKeys: [] });
  }

  for (const term of extract.terms) {
    const key = term.key.toLowerCase();
    const parentKeys: string[] = [];
    const parent =
      term.suggestedParentKey?.toLowerCase() ??
      extract.domains[0]?.toLowerCase();
    if (parent && parent !== key) {
      parentKeys.push(parent);
      if (!nodesByKey.has(parent)) {
        nodesByKey.set(parent, { key: parent, label: parent, parentKeys: [] });
      }
    }

    const mentionAliases = term.mentions.filter(
      (m) => m.toLowerCase() !== key
    );
    const existing = nodesByKey.get(key);
    if (existing) {
      nodesByKey.set(key, mergeAliases(existing, mentionAliases));
    } else {
      nodesByKey.set(key, {
        key,
        label: term.label,
        aliases: mentionAliases.length ? mentionAliases : undefined,
        parentKeys: parentKeys.length ? parentKeys : undefined,
        evidence: term.evidence,
      });
    }

    for (const mention of term.mentions) {
      const mk = `${mention.toLowerCase()}\0${key}`;
      if (mappingSeen.has(mk)) {
        continue;
      }
      mappingSeen.add(mk);
      mappings.push({ mention, key });
    }
  }

  for (const ta of synonyms.termAliases) {
    const node = nodesByKey.get(ta.canonical.toLowerCase());
    if (node) {
      nodesByKey.set(ta.canonical.toLowerCase(), mergeAliases(node, ta.aliases));
    }
    for (const alias of ta.aliases) {
      const mk = `${alias.toLowerCase()}\0${ta.canonical}`;
      if (!mappingSeen.has(mk)) {
        mappingSeen.add(mk);
        mappings.push({ mention: alias, key: ta.canonical.toLowerCase() });
      }
    }
  }

  const topicPathDecisions: TopicPathDecision[] = [];
  for (const term of extract.terms) {
    const segments: string[] = [];
    const domain = extract.domains[0]?.toLowerCase();
    const parent = term.suggestedParentKey?.toLowerCase() ?? domain;
    if (domain && domain !== term.key.toLowerCase()) {
      segments.push(domain);
    }
    if (parent && parent !== term.key.toLowerCase() && !segments.includes(parent)) {
      segments.push(parent);
    }
    segments.push(term.key.toLowerCase());

    let conceptPath = normalizeConceptPath(segments);
    conceptPath = resolveConceptPathWithEquivalences(
      conceptPath,
      synonyms.segmentEquivalences,
      {
        projectSlug: meta.projectSlug,
        items: term.evidence,
      }
    );

    topicPathDecisions.push({
      topicId: `term:${term.key}`,
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
      conceptPath,
      evidence: term.evidence,
    });
  }

  return {
    nodes: Array.from(nodesByKey.values()),
    mappings,
    topicPathDecisions,
  };
}
