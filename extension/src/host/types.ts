import type { LlmProviderId } from "../llm/types";
import type { ListSessionsContext } from "../transcript/listSessions";
import type { ChatEvent, TranscriptSession } from "../transcript/types";

export type AgentHostId = "cursor" | "claude-code";

export type HostSetting = AgentHostId | "auto";

export interface AgentHost {
  readonly id: AgentHostId;
  readonly displayName: string;
  readonly defaultLlmProvider: LlmProviderId;
  /** Commands to probe for opening a session in the native AI UI (best-effort). */
  readonly jumpCommandCandidates: string[];
  getProjectsRoot(): string;
  /** Encoded directory name for a workspace under {@link getProjectsRoot}. */
  encodeWorkspacePath(fsPath: string): string;
  /** Absolute project directory if it exists on disk. */
  getProjectDir(workspacePath: string): string | undefined;
  /** Directory to scan for session files, or undefined when the project dir is missing. */
  getSessionsScanDir(workspacePath: string): string | undefined;
  listSessions(
    scanDir: string,
    ctx: ListSessionsContext
  ): Promise<TranscriptSession[]>;
  parseTranscript(content: string): ChatEvent[];
  /** Best-effort decode of project slug → filesystem path (lossy). */
  slugToWorkspacePath(slug: string): string;
  inferProjectFromTranscriptPath(filePath: string): {
    projectSlug: string;
    projectPath?: string;
  };
  cliMissingHint(): string;
  emptyTranscriptsHint(scanDir: string): string;
}
