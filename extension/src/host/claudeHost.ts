import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { parseJsonl } from "../transcript/parseJsonl";
import {
  listFlatJsonlSessions,
  type ListSessionsContext,
} from "../transcript/listSessions";
import type { ChatEvent, TranscriptSession } from "../transcript/types";
import { decodeClaudeProjectPath, encodeClaudeProjectPath } from "./claudePath";
import type { AgentHost } from "./types";

const SUBAGENT_DIR = "subagents";
const TOOL_RESULTS_DIR = "tool-results";

export function getClaudeProjectsRoot(): string {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("claudeProjectsDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".claude", "projects");
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

type SessionsIndexEntry = {
  sessionId?: string;
  id?: string;
  title?: string;
  summary?: string;
  lastMessageAt?: string;
};

type SessionsIndex = {
  sessions?: SessionsIndexEntry[];
  entries?: SessionsIndexEntry[];
};

async function loadClaudeSessionTitles(
  projectDir: string
): Promise<Map<string, string>> {
  const indexPath = path.join(projectDir, "sessions-index.json");
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as SessionsIndex;
    const rows = parsed.sessions ?? parsed.entries ?? [];
    const out = new Map<string, string>();
    for (const row of rows) {
      const id = row.sessionId ?? row.id;
      if (!id) {
        continue;
      }
      const title = row.title?.trim() || row.summary?.trim();
      if (title) {
        out.set(id, title);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export const claudeHost: AgentHost = {
  id: "claude-code",
  displayName: "Claude Code",
  defaultLlmProvider: "claude-cli",
  jumpCommandCandidates: [
    "claude-vscode.openSession",
    "claude-code.openSession",
    "anthropic.claude-code.openSession",
    "claude.openSession",
  ],

  getProjectsRoot(): string {
    return getClaudeProjectsRoot();
  },

  encodeWorkspacePath(fsPath: string): string {
    return encodeClaudeProjectPath(fsPath);
  },

  getProjectDir(workspacePath: string): string | undefined {
    const encoded = encodeClaudeProjectPath(workspacePath);
    return path.join(getClaudeProjectsRoot(), encoded);
  },

  getSessionsScanDir(workspacePath: string): string | undefined {
    return this.getProjectDir(workspacePath);
  },

  async listSessions(
    projectDir: string,
    ctx: ListSessionsContext
  ): Promise<TranscriptSession[]> {
    const titles = await loadClaudeSessionTitles(projectDir);
    const sessions = await listFlatJsonlSessions(projectDir, {
      ...ctx,
      hostId: "claude-code",
      titles,
      skipDirNames: new Set([SUBAGENT_DIR, TOOL_RESULTS_DIR]),
      skipFilePatterns: [/^agent-.*\.jsonl$/i],
    });
    return sessions;
  },

  parseTranscript(content: string): ChatEvent[] {
    return parseJsonl(content);
  },

  slugToWorkspacePath(slug: string): string {
    return decodeClaudeProjectPath(slug);
  },

  inferProjectFromTranscriptPath(filePath: string): {
    projectSlug: string;
    projectPath?: string;
  } {
    const projectSlug = path.basename(path.dirname(filePath));
    return {
      projectSlug,
      projectPath: decodeClaudeProjectPath(projectSlug),
    };
  },

  cliMissingHint(): string {
    return "Install Claude Code CLI: https://code.claude.com/docs/en/headless";
  },

  emptyTranscriptsHint(scanDir: string): string {
    return (
      `Agent Mind Map: No Claude Code transcripts in ${scanDir}. ` +
      "The VS Code extension may keep main chats in memory only — try a CLI session (`claude`) for reliable on-disk history."
    );
  },
};
