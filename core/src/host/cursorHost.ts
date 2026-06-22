import * as path from "path";
import { workspaceToSlug, slugToWorkspacePath } from "@agent-mindmap/shared";
import { loadComposerTitles } from "../transcript/composerTitles";
import { listCursorSessions } from "../transcript/listSessions";
import { parseJsonl } from "../transcript/parseJsonl";
import type { AgentHost } from "./types";
import type { ListSessionsContext } from "../transcript/listSessions";
import type { ChatEvent, TranscriptSession } from "../transcript/types";

export function createCursorHost(
  projectsRoot: string | (() => string),
  cliMissingHint: () => string
): AgentHost {
  const resolveRoot = () => (typeof projectsRoot === "function" ? projectsRoot() : projectsRoot);
  return {
    id: "cursor",
    displayName: "Cursor",
    defaultLlmProvider: "cursor-cli",
    jumpCommandCandidates: [
      "glass.openAgentById",
      "cursor.openAgentById",
      "composer.openComposerWithSession",
      "composer.openComposer",
      "workbench.action.openAgentsView",
      "workbench.action.toggleAgents",
    ],

    getProjectsRoot(): string {
      return resolveRoot();
    },

    encodeWorkspacePath(fsPath: string): string {
      return workspaceToSlug(fsPath);
    },

    getProjectDir(workspacePath: string): string | undefined {
      return path.join(resolveRoot(), workspaceToSlug(workspacePath));
    },

    getSessionsScanDir(workspacePath: string): string | undefined {
      const slug = workspaceToSlug(workspacePath);
      return path.join(resolveRoot(), slug, "agent-transcripts");
    },

    async listSessions(
      transcriptsDir: string,
      ctx: ListSessionsContext
    ): Promise<TranscriptSession[]> {
      const titles = await loadComposerTitles();
      return listCursorSessions(transcriptsDir, {
        ...ctx,
        hostId: "cursor",
        titles,
      });
    },

    parseTranscript(content: string): ChatEvent[] {
      return parseJsonl(content);
    },

    slugToWorkspacePath(slug: string): string {
      return slugToWorkspacePath(slug);
    },

    inferProjectFromTranscriptPath(filePath: string): {
      projectSlug: string;
      projectPath?: string;
    } {
      const transcriptsParent = path.dirname(path.dirname(filePath));
      const slugDir = path.dirname(transcriptsParent);
      const projectSlug = path.basename(slugDir);
      return {
        projectSlug,
        projectPath: slugToWorkspacePath(projectSlug),
      };
    },

    cliMissingHint(): string {
      return cliMissingHint();
    },

    emptyTranscriptsHint(scanDir: string): string {
      return `Agent Mind Map: No agent transcripts in ${scanDir}`;
    },
  };
}
