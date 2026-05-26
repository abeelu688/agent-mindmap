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

export type MindMapNodeData = {
  data: {
    text: string;
    expand?: boolean;
  };
  children?: MindMapNodeData[];
};

export type MindMapRoot = MindMapNodeData;

export type BuildOptions = {
  includeToolCalls: boolean;
  maxConclusionItems: number;
};
