import * as path from "path";
import * as vscode from "vscode";
import { getProvider } from "./llm";
import { summarizeSession } from "./llm/summarizeSession";
import {
  LlmProviderError,
  type LlmProviderOptions,
} from "./llm/types";
import { buildTopicMindMap } from "./mindmap/buildTopicMindMap";
import { buildTurnMindMap } from "./mindmap/buildMindMapData";
import { getTranscriptsDir } from "./paths";
import { listSessions, readSessionFile } from "./transcript/listSessions";
import { parseJsonl } from "./transcript/parseJsonl";
import type { MindMapRoot, TranscriptSession } from "./transcript/types";

export type LoadedSession = {
  session: TranscriptSession;
  mindMap: MindMapRoot;
  /** Which renderer produced `mindMap`. */
  source: "topic" | "turn";
};

export type LoadDeps = {
  context: vscode.ExtensionContext;
  signal?: AbortSignal;
};

type Settings = {
  llm: LlmProviderOptions;
  cache: boolean;
  turnOptions: { includeToolCalls: boolean; maxConclusionItems: number };
};

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "cursor-cli");
  const provider: LlmProviderOptions["provider"] =
    providerSetting === "cursor-cli" ? "cursor-cli" : "cursor-cli";

  return {
    llm: {
      provider,
      cliPath: config.get<string>("llm.cliPath", "").trim(),
      model: config.get<string>("llm.model", "").trim(),
      timeoutMs: Math.max(
        1000,
        config.get<number>("llm.timeoutMs", 30000) ?? 30000
      ),
      maxTopics: Math.max(1, config.get<number>("maxTopics", 6) ?? 6),
      maxItemsPerTopic: Math.max(
        1,
        config.get<number>("maxItemsPerTopic", 6) ?? 6
      ),
    },
    cache: config.get<boolean>("cacheLlmResult", true) ?? true,
    turnOptions: {
      includeToolCalls: config.get<boolean>("includeToolCalls", true) ?? true,
      maxConclusionItems:
        config.get<number>("maxConclusionItems", 8) ?? 8,
    },
  };
}

function getCacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "llm-cache");
}

function describeError(err: unknown): string {
  if (err instanceof LlmProviderError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isCancellation(err: unknown): boolean {
  return err instanceof LlmProviderError && err.code === "cancelled";
}

export async function loadLatestSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const dir = getTranscriptsDir();
  if (!dir) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const sessions = await listSessions(dir);
  if (!sessions.length) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: No agent transcripts in ${dir}`
    );
    return undefined;
  }

  return loadSession(sessions[0], deps);
}

export async function pickSession(
  deps: LoadDeps
): Promise<LoadedSession | undefined> {
  const dir = getTranscriptsDir();
  if (!dir) {
    vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder first."
    );
    return undefined;
  }

  const sessions = await listSessions(dir);
  if (!sessions.length) {
    vscode.window.showWarningMessage(
      `Agent Mind Map: No agent transcripts in ${dir}`
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.label,
      description: s.id,
      session: s,
    })),
    { placeHolder: "Select an agent chat session" }
  );

  if (!picked) {
    return undefined;
  }

  return loadSession(picked.session, deps);
}

export async function loadSession(
  session: TranscriptSession,
  deps: LoadDeps
): Promise<LoadedSession> {
  const content = await readSessionFile(session.filePath);
  const events = parseJsonl(content);
  const settings = readSettings();
  const signal = deps.signal ?? new AbortController().signal;

  try {
    const provider = getProvider(settings.llm);
    const graph = await summarizeSession(
      events,
      {
        prompt: {
          maxTopics: settings.llm.maxTopics,
          maxItemsPerTopic: settings.llm.maxItemsPerTopic,
        },
        modelHint: settings.llm.model || undefined,
        cacheDir: getCacheDir(deps.context),
        cache: settings.cache,
      },
      provider,
      signal
    );
    return {
      session,
      mindMap: buildTopicMindMap(graph, session.label),
      source: "topic",
    };
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    const detail = describeError(err);
    const cliMissing =
      err instanceof LlmProviderError && err.code === "cli-missing";
    const action = cliMissing
      ? "Install cursor-agent CLI: curl https://cursor.com/install -fsS | bash"
      : "Falling back to chronological view.";
    vscode.window.showWarningMessage(
      `Agent Mind Map: LLM summarization failed (${detail}). ${action}`
    );
    console.warn("[agent-mindmap] LLM failure, using turn fallback:", err);
    return {
      session,
      mindMap: buildTurnMindMap(
        events,
        settings.turnOptions,
        session.label
      ),
      source: "turn",
    };
  }
}

export { listSessions, getTranscriptsDir };
