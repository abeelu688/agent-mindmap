import type { ChatEvent } from "../transcript/types";
import type {
  AgentHostId,
  LlmProviderId,
  MergedOutline,
  ConceptOntology,
  SessionConceptExtract,
  SessionSynonymRefine,
  SessionAnalysis,
  TopicGraph,
  SessionOutline,
  TopicPathDecision,
  ReattachParseResult,
  OntologyRefineResult,
  CodeReference,
  PipelineVersions,
  ReattachMove,
  ReattachStep,
  ReattachStepKind,
  SegmentEquivalence,
  SegmentEquivalenceScope,
  TermWithContext,
  SessionTermAlias,
  Topic,
  TopicItem,
  MergedOutlineSource,
  MergedOutlineDetail,
  MergedOutlineNode,
  ConceptOntologyNode,
  ConceptOntologyMapping,
  SessionTreeSnapshot,
} from "@agent-mindmap/shared";

// Re-export the payload types that live in shared/ so existing extension
// imports (`from "../llm/types"`) keep working. Provider-runtime types stay
// here — they are not part of the persisted SessionRecord and don't need to
// be shared with the MCP server.
export type {
  AgentHostId,
  LlmProviderId,
  TopicItem,
  Topic,
  TopicGraph,
  MergedOutlineSource,
  MergedOutlineDetail,
  MergedOutlineNode,
  MergedOutline,
  ConceptOntologyNode,
  ConceptOntologyMapping,
  TopicPathDecision,
  ReattachMove,
  ReattachStepKind,
  ReattachStep,
  ReattachParseResult,
  SegmentEquivalenceScope,
  SegmentEquivalence,
  OntologyRefineResult,
  ConceptOntology,
  TermWithContext,
  SessionConceptExtract,
  SessionTermAlias,
  SessionSynonymRefine,
  SessionTreeSnapshot,
  CodeReference,
  SessionAnalysis,
  PipelineVersions,
};

// Re-export the duplicated outline types from shared so extension imports
// resolve to the same canonical definition.
export type { OutlineDetail, OutlineNode, SessionOutline } from "@agent-mindmap/shared";

export type LlmResponseSchema =
  | "session-outline"
  | "session-analysis"
  | "session-concept-extract"
  | "session-synonym-refine"
  | "session-outline-by-tree"
  | "topic-graph"
  | "merged-outline"
  | "concept-ontology"
  | "topic-paths"
  | "reattach-moves"
  | "ontology-refine"
  | "code-ref-descriptions";

export type LlmDumpMeta = {
  stageId: string;
  sessionId?: string;
  projectSlug?: string;
  /** Chunk position when a stage splits its LLM input across multiple calls. */
  chunkIndex?: number;
  chunkCount?: number;
};

export type SummarizeInput = {
  events: ChatEvent[];
  prompt: string;
  model?: string;
  maxTopics: number;
  maxItemsPerTopic: number;
  /** Which JSON schema to validate CLI output against. */
  responseSchema?: LlmResponseSchema;
  /** Called before each CLI attempt (1-based). */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  /** Workspace LLM IO dump (live CLI only). */
  dumpMeta?: LlmDumpMeta;
  /** Override provider default timeout for this call (ms). */
  timeoutMs?: number;
};

export type LlmProviderOptions = {
  provider: LlmProviderId;
  cliPath: string;
  model: string;
  timeoutMs: number;
  /** Maximum number of attempts (≥ 1). Retries skip non-retryable errors. */
  maxAttempts: number;
  /**
   * Base backoff in ms between retries. Effective wait is
   * `base * 2^(attempt-1) + jitter` capped at 10s.
   */
  retryBackoffMs: number;
  maxTopics: number;
  maxItemsPerTopic: number;
  hostId?: AgentHostId;
};

export type LlmSummarizeResult =
  | TopicGraph
  | SessionOutline
  | MergedOutline
  | ConceptOntology
  | SessionConceptExtract
  | SessionSynonymRefine
  | SessionAnalysis
  | { topicPaths: TopicPathDecision[] }
  | ReattachParseResult
  | OntologyRefineResult;

export type LlmProvider = {
  readonly id: string;
  summarize(input: SummarizeInput, signal: AbortSignal): Promise<LlmSummarizeResult>;
};

export type LlmErrorCode =
  | "cli-missing"
  | "cli-failed"
  | "timeout"
  | "cancelled"
  | "bad-json"
  | "bad-shape"
  | "empty";

export class LlmProviderError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly cause?: unknown,
    /** Partial CLI stdout/stderr when the subprocess ran but failed. */
    public readonly cliCapture?: { stdout: string; stderr: string }
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
