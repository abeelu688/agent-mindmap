import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { loadComposerTitles } from "../transcript/composerTitles";
import {
  listCursorSessions,
  type ListSessionsContext,
} from "../transcript/listSessions";
import { parseJsonl } from "../transcript/parseJsonl";
import type { ChatEvent, TranscriptSession } from "../transcript/types";
import { workspaceToSlug, slugToWorkspacePath } from "../paths";
import type { AgentHost } from "./types";

export function getCursorProjectsRoot(): string {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("projectsDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".cursor", "projects");
}

function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export const cursorHost: AgentHost = {
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
    return getCursorProjectsRoot();
  },

  encodeWorkspacePath(fsPath: string): string {
    return workspaceToSlug(fsPath);
  },

  getProjectDir(workspacePath: string): string | undefined {
    return path.join(getCursorProjectsRoot(), workspaceToSlug(workspacePath));
  },

  getSessionsScanDir(workspacePath: string): string | undefined {
    const slug = workspaceToSlug(workspacePath);
    return path.join(getCursorProjectsRoot(), slug, "agent-transcripts");
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
    return "Install cursor-agent CLI: curl https://cursor.com/install -fsS | bash";
  },

  emptyTranscriptsHint(scanDir: string): string {
    return `Agent Mind Map: No agent transcripts in ${scanDir}`;
  },
};
