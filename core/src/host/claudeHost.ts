import * as fs from "fs/promises";
import * as path from "path";
import { parseClaudeJsonl } from "../transcript/parseClaudeJsonl";
import { listFlatJsonlSessions } from "../transcript/listSessions";
import { decodeClaudeProjectPath, encodeClaudeProjectPath } from "./claudePath";
import type { AgentHost } from "./types";
import type { ListSessionsContext } from "../transcript/listSessions";
import type { ChatEvent, TranscriptSession } from "../transcript/types";

const SUBAGENT_DIR = "subagents";
const TOOL_RESULTS_DIR = "tool-results";

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

async function loadClaudeSessionTitles(projectDir: string): Promise<Map<string, string>> {
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

export function createClaudeHost(
  projectsRoot: string | (() => string),
  cliMissingHint: () => string
): AgentHost {
  const resolveRoot = () => (typeof projectsRoot === "function" ? projectsRoot() : projectsRoot);
  return {
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
      return resolveRoot();
    },

    encodeWorkspacePath(fsPath: string): string {
      return encodeClaudeProjectPath(fsPath);
    },

    getProjectDir(workspacePath: string): string | undefined {
      const encoded = encodeClaudeProjectPath(workspacePath);
      return path.join(resolveRoot(), encoded);
    },

    getSessionsScanDir(workspacePath: string): string | undefined {
      return this.getProjectDir(workspacePath);
    },

    async listSessions(projectDir: string, ctx: ListSessionsContext): Promise<TranscriptSession[]> {
      const titles = await loadClaudeSessionTitles(projectDir);
      return listFlatJsonlSessions(projectDir, {
        ...ctx,
        hostId: "claude-code",
        titles,
        skipDirNames: new Set([SUBAGENT_DIR, TOOL_RESULTS_DIR]),
        skipFilePatterns: [/^agent-.*\.jsonl$/i],
      });
    },

    parseTranscript(content: string): ChatEvent[] {
      return parseClaudeJsonl(content);
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
      return cliMissingHint();
    },

    emptyTranscriptsHint(scanDir: string): string {
      return (
        `Agent Mind Map: No Claude Code transcripts in ${scanDir}. ` +
        "The VS Code extension may keep main chats in memory only — try a CLI session (`claude`) for reliable on-disk history."
      );
    },
  };
}
