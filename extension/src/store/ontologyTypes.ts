import type { AgentHostId } from "../host/types";
import type { SegmentEquivalence } from "../llm/types";

/**
 * A persistent, cross-session concept memory used to reduce future LLM calls.
 *
 * This is intentionally decoupled from SessionRecord so we can evolve the
 * ontology schema without rewriting every session file.
 */
export type ConceptOntologyRecord = {
  schemaVersion: 1;
  meta: {
    builtAt: number;
    /** Hash key of the selection/prompt/provider inputs. */
    cacheKey: string;
    /** Session ids participating in the build input. */
    sessionIds: string[];
    /** Distinct project slugs covered. */
    projectSlugs: string[];
    /** LLM details used to produce this record. */
    llm: { provider: string; model?: string };
    /** Prompt schema versions folded into cacheKey (for debugging). */
    promptVersions: {
      ontology: number;
      topicPaths: number;
      reattach: number;
      refine: number;
      outlineSchema: number;
      sessionAnalysis?: number;
      /** @deprecated legacy session pipeline */
      extract?: number;
      /** @deprecated legacy session pipeline */
      sessionSynonyms?: number;
      /** @deprecated legacy session pipeline */
      organize?: number;
    };
    hostId?: AgentHostId;
  };
  /**
   * Canonical concepts + lightweight relationships. Treat as a DAG:
   * - nodes are unique by `key`
   * - edges are stored as parentKeys on each node
   */
  nodes: ConceptNode[];
  /**
   * Mention/alias map. Consumers should canonicalize mentions before lookup.
   * (We keep it explicit for transparency + debugging.)
   */
  mappings: ConceptMapping[];
  /**
   * Per-topic conceptPath decisions (the most important \"memory\" to reduce LLM
   * pressure). These can be applied to SessionRecords on-demand.
   */
  topicPaths: TopicConceptPathDecision[];
  /**
   * Optional patch-style tree reattachments (for post-merge structural fixes).
   */
  reattachMoves?: ReattachMove[];
  /**
   * Contextual segment aliases produced by the refine pass (e.g. reactjs → react
   * under frontend + React evidence).
   */
  segmentEquivalences?: SegmentEquivalence[];
};

export type ConceptNode = {
  /** Canonical key used for merging across sessions (lowercase). */
  key: string;
  /** Human-friendly label (can be non-English). */
  label: string;
  aliases?: string[];
  parentKeys?: string[];
  confidence?: number;
  evidence?: string[];
};

export type ConceptMapping = {
  mention: string;
  key: string;
  confidence?: number;
};

export type TopicConceptPathDecision = {
  /** Stable identifier for the topic/leaf being classified. */
  topicId: string;
  sessionId: string;
  projectSlug: string;
  /** The inferred/normalized concept path. */
  conceptPath: string[];
  confidence?: number;
  evidence?: string[];
};

export type ReattachMove = {
  /** Identifier of the node to be moved (implementation-specific). */
  from: string;
  /** Destination conceptPath (domain/subsystem/...). */
  toPath: string[];
  confidence?: number;
  evidence?: string[];
};

