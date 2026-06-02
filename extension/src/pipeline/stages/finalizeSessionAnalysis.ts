import { outlineToTopicGraph } from "../../llm/outlineToTopicGraph";
import { sanitizeSessionOutline } from "../../llm/sanitizeOutline";
import type {
  SessionAnalysis,
  SessionConceptExtract,
  SessionOutline,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  TopicGraph,
} from "../../llm/types";
import { buildConceptContextsFromAnalysis } from "../../llm/buildConceptContexts";
import { buildSessionTree } from "./buildSessionTree";
import type { ConceptContextForMerge } from "../../store/storeTypes";

export type FinalizeSessionAnalysisMeta = {
  sessionId: string;
  projectSlug: string;
  userQueryCount: number;
};

export type FinalizedSessionAnalysis = {
  sessionAnalysis: SessionAnalysis;
  outline: SessionOutline;
  graph: TopicGraph;
  conceptExtract: SessionConceptExtract;
  sessionSynonyms: SessionSynonymRefine;
  treeSnapshot: SessionTreeSnapshot;
  conceptContexts: ConceptContextForMerge[];
};

export function analysisToConceptExtract(
  analysis: SessionAnalysis
): SessionConceptExtract {
  const terms: SessionConceptExtract["terms"] = [];
  for (const node of analysis.nodes) {
    const evidence =
      node.evidence?.length ? node.evidence : [node.label || node.key];
    terms.push({
      key: node.key,
      label: node.label,
      mentions: node.aliases?.length ? node.aliases : [node.label],
      evidence,
      suggestedParentKey: node.parentKeys?.[0],
    });
  }
  return { domains: analysis.domains, terms };
}

export function analysisToSessionSynonyms(
  analysis: SessionAnalysis
): SessionSynonymRefine {
  return {
    segmentEquivalences: analysis.segmentEquivalences ?? [],
    termAliases: analysis.termAliases ?? [],
  };
}

/**
 * S2 DET: validate outline, derive legacy artifacts, build tree snapshot.
 */
export function finalizeSessionAnalysis(
  analysis: SessionAnalysis,
  meta: FinalizeSessionAnalysisMeta
): FinalizedSessionAnalysis {
  const outline = sanitizeSessionOutline(analysis.outline, meta.userQueryCount);
  const conceptExtract = analysisToConceptExtract(analysis);
  const sessionSynonyms = analysisToSessionSynonyms(analysis);
  const treeSnapshot = buildSessionTree(conceptExtract, sessionSynonyms, {
    sessionId: meta.sessionId,
    projectSlug: meta.projectSlug,
  });
  const conceptContexts = buildConceptContextsFromAnalysis(
    { ...analysis, outline },
    meta
  );
  const graph = outlineToTopicGraph(outline);

  return {
    sessionAnalysis: { ...analysis, outline },
    outline,
    graph,
    conceptExtract,
    sessionSynonyms,
    treeSnapshot,
    conceptContexts,
  };
}
