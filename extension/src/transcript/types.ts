export type ChatEvent =
  | { kind: "user_query"; text: string; lineIndex: number }
  | { kind: "tool"; name: string; label: string; lineIndex: number }
  | { kind: "assistant_summary"; text: string; preview: string; lineIndex: number };

export type TranscriptSession = {
  id: string;
  filePath: string;
  mtimeMs: number;
  label: string;
  /** Cursor project slug owning this transcript, when known. */
  projectSlug?: string;
  /** Original workspace filesystem path, when known. */
  projectPath?: string;
};

/**
 * Reverse pointer from a mind-map node back to a specific spot in a
 * transcript. Used by the click-to-jump flow: a node can carry many refs,
 * one per (session, turnIndex) pair it summarises.
 *
 * `turnIndex` is omitted for branch / root nodes that aggregate multiple
 * turns of a session — those are interpreted as "整段会话".
 */
export type NodeOriginRef = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  turnIndex?: number;
};

export type NodeOrigin = {
  refs: NodeOriginRef[];
};

export type MindMapNodeData = {
  data: {
    text: string;
    expand?: boolean;
    /**
     * Optional reverse pointer(s) back to the originating transcript(s).
     * simple-mind-map ignores unknown fields on `data`, so this rides along
     * untouched and is read by the webview's `node_click` handler.
     */
    origin?: NodeOrigin;
  };
  children?: MindMapNodeData[];
};

export type MindMapRoot = MindMapNodeData;

export type BuildOptions = {
  includeToolCalls: boolean;
  maxConclusionItems: number;
};
