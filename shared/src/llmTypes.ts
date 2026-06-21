/**
 * LLM payload types that are persisted as part of `SessionRecord` (or
 * referenced transitively). These live in `shared/` so both the extension
 * and the MCP server agree on the shape of a stored record.
 *
 * Provider-runtime types (LlmProvider, LlmProviderError, SummarizeInput, ...)
 * stay in the extension — they are not part of the persisted payload and do
 * not need to be shared with the MCP server.
 */

export type AgentHostId = "cursor" | "claude-code";

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
  /**
   * Verbatim code snippet (effective lines) captured from the raw transcript
   * write-op (`Write.contents` / `StrReplace.new_string`) BEFORE the
   * whitespace-collapse the LLM prompt applies to its own input. Used by the
   * MCP server / extension for on-read staleness verification (Q4). Each entry
   * is a trimmed, effective line (length >= 3, contains at least one Unicode
   * letter or digit). Empty array or missing → staleness is `unknown`.
   */
  markCode?: string[];
};

/**
 * On-read staleness verdict for a `CodeReference` (Q4 §Decided design item 3).
 * Computed at response time by the MCP server (and the extension's mind-map
 * builder for the webview); NOT persisted to the store.
 *
 * - `fresh`: local path resolves AND file exists AND every effective
 *   `markCode` line is a substring of the file content.
 * - `stale`: local path resolves AND (file missing OR at least one effective
 *   `markCode` line is not a substring).
 * - `unknown`: local path does not resolve (slug missing from paths map) OR
 *   `markCode` is empty/missing (cannot judge).
 */
export type Staleness = "fresh" | "stale" | "unknown";

/** Single LLM response: domain + terms + hierarchy + content outline + session synonyms. */
export type SessionAnalysis = {
  domains: string[];
  nodes: ConceptOntologyNode[];
  mappings?: ConceptOntologyMapping[];
  segmentEquivalences: SegmentEquivalence[];
  termAliases?: SessionTermAlias[];
  outline?: import("./storeTypes").SessionOutline;
  /** Code file references extracted when session involves software code. Absent when not applicable. */
  codeReferences?: CodeReference[];
};

export type PipelineVersions = {
  sessionAnalysis: number;
};
