import type { ChatEvent } from "../transcript/types";
import type { AgentHostId } from "../host/types";

export type LlmProviderId = "cursor-cli" | "claude-cli";

export type TopicItem = {
  text: string;
  sourceTurnIndices?: number[];
};

export type Topic = {
  title: string;
  summary?: string;
  /**
   * Optional concept path from broadest to narrowest, e.g.
   * `["frontend", "react", "hooks"]` for a topic titled "React Hooks".
   *
   * Used as cross-session merge metadata: a deterministic merge groups topics
   * by their longest common concept-path prefix into a concept trie. It is
   * NOT rendered in the single-session mind map.
   */
  conceptPath?: string[];
  items: TopicItem[];
};

export type TopicGraph = {
  /** 5-15 字整体主题，LLM 归纳；用作思维导图根节点。 */
  title?: string;
  /** 一句话（≤ 50 字）整体概述，可选。 */
  summary?: string;
  topics: Topic[];
};

export type OutlineDetail = {
  text: string;
  sourceTurnIndices?: number[];
};

export type OutlineNode = {
  title: string;
  summary?: string;
  /** Cross-session merge metadata (not shown in single-session map). */
  conceptPath?: string[];
  children?: OutlineNode[];
  details?: OutlineDetail[];
};

export type SessionOutline = {
  title?: string;
  summary?: string;
  outline: OutlineNode[];
};

export type MergedOutlineSource = {
  sessionIndex: number;
  turnIndex?: number;
};

export type MergedOutlineDetail = {
  text: string;
  sources?: MergedOutlineSource[];
};

export type MergedOutlineNode = {
  title: string;
  summary?: string;
  children?: MergedOutlineNode[];
  details?: MergedOutlineDetail[];
};

export type MergedOutline = {
  title?: string;
  summary?: string;
  outline: MergedOutlineNode[];
};

export type ConceptOntologyNode = {
  key: string;
  label: string;
  aliases?: string[];
  parentKeys?: string[];
  /** S2 DET: direct children (from parentKeys inverse + outline conceptPath). */
  childKeys?: string[];
  confidence?: number;
  evidence?: string[];
};

export type ConceptOntologyMapping = {
  mention: string;
  key: string;
  confidence?: number;
};

export type TopicPathDecision = {
  topicId: string;
  sessionId: string;
  projectSlug: string;
  conceptPath: string[];
  confidence?: number;
  evidence?: string[];
};

export type ReattachMove = {
  from: string;
  toPath: string[];
  confidence?: number;
  evidence?: string[];
};

export type ReattachStepKind = "merge_synonym" | "attach_under";

/** Ordered plan for M2.5; applied one step at a time when building the final trie. */
export type ReattachStep = {
  step: number;
  kind: ReattachStepKind;
  /** Top-level chain segment key (apply); filled by resolver from sourceNodeId. */
  sourceFrom: string;
  /** Target path segments (apply); filled by resolver from targetNodeId(s). */
  targetPath: string[];
  /** Draft-map node id (e.g. N3); preferred in LLM output over bare segment names. */
  sourceNodeId?: string;
  /** merge_synonym: canonical top-root id. */
  targetNodeId?: string;
  /** attach_under: ordered node ids from hub root to source (last id = source). */
  targetNodeIds?: string[];
  action: string;
  result: string;
  confidence?: number;
  evidence?: string[];
};

export type ReattachParseResult = {
  steps: ReattachStep[];
  moves: ReattachMove[];
};

export type SegmentEquivalenceScope = {
  /** Apply only when path segments before the alias match this prefix (upstream). */
  pathPrefix?: string[];
  /** After the alias, path must start with this prefix (downstream). */
  downstreamPrefix?: string[];
  /** First segment after the alias must be one of these keys (downstream disambiguation). */
  downstreamFirst?: string[];
  projectSlugs?: string[];
  evidenceKeywords?: string[];
};

export type SegmentEquivalence = {
  canonical: string;
  aliases: string[];
  scope: SegmentEquivalenceScope;
  confidence?: number;
  rationale?: string;
};

export type OntologyRefineResult = {
  segmentEquivalences: SegmentEquivalence[];
};

export type ConceptOntology = {
  nodes: ConceptOntologyNode[];
  mappings: ConceptOntologyMapping[];
  topicPaths: TopicPathDecision[];
  reattachMoves?: ReattachMove[];
  segmentEquivalences?: SegmentEquivalence[];
};

/** S1: industry domains + professional terms with context evidence. */
export type TermWithContext = {
  key: string;
  label: string;
  mentions: string[];
  evidence: string[];
  suggestedParentKey?: string;
};

export type SessionConceptExtract = {
  domains: string[];
  terms: TermWithContext[];
};

export type SessionTermAlias = {
  canonical: string;
  aliases: string[];
  evidence: string[];
};

/** S2: per-session scoped segment equivalences + term aliases. */
export type SessionSynonymRefine = {
  segmentEquivalences: SegmentEquivalence[];
  termAliases: SessionTermAlias[];
};

/** S3 DET output: canonical nodes + per-term concept paths for organize. */
export type SessionTreeSnapshot = {
  nodes: ConceptOntologyNode[];
  mappings: ConceptOntologyMapping[];
  topicPathDecisions: TopicPathDecision[];
};

export type CodeReference = {
  /** Relative path from project root, e.g. "src/foo/bar.ts". No leading slash. */
  path: string;
  /** Line range, e.g. "42-57" or "88". */
  lines: string;
  /** Brief description of the code's function/purpose, ≤80 chars. */
  description: string;
  /** 0-based turn indices where this file was referenced, for filtering by topic. */
  sourceTurnIndices?: number[];
  /** Background LLM enrichment state. Missing means legacy/done. */
  llmStatus?: "pending" | "done" | "failed";
  /** Last background LLM attempt timestamp. */
  llmUpdatedAt?: number;
  /** Short diagnostic for failed background enrichment. */
  llmError?: string;
};

/** Single LLM response: domain + terms + hierarchy + content outline + session synonyms. */
export type SessionAnalysis = {
  domains: string[];
  nodes: ConceptOntologyNode[];
  mappings?: ConceptOntologyMapping[];
  segmentEquivalences: SegmentEquivalence[];
  termAliases?: SessionTermAlias[];
  outline?: SessionOutline;
  /** Code file references extracted when session involves software code. Absent when not applicable. */
  codeReferences?: CodeReference[];
};

export type PipelineVersions = {
  sessionAnalysis: number;
};

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
