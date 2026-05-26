import * as vscode from "vscode";
import { buildMindMapData } from "./mindmap/buildMindMapData";
import { getTranscriptsDir } from "./paths";
import { listSessions, readSessionFile } from "./transcript/listSessions";
import { parseJsonl } from "./transcript/parseJsonl";
import type { MindMapRoot, TranscriptSession } from "./transcript/types";

export type LoadedSession = {
  session: TranscriptSession;
  mindMap: MindMapRoot;
};

function getBuildOptions() {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  return {
    includeToolCalls: config.get<boolean>("includeToolCalls", true),
    maxConclusionItems: config.get<number>("maxConclusionItems", 8),
  };
}

export async function loadLatestSession(): Promise<LoadedSession | undefined> {
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

  return loadSession(sessions[0]);
}

export async function pickSession(): Promise<LoadedSession | undefined> {
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

  return loadSession(picked.session);
}

export async function loadSession(
  session: TranscriptSession
): Promise<LoadedSession> {
  const content = await readSessionFile(session.filePath);
  const events = parseJsonl(content);
  const mindMap = buildMindMapData(
    events,
    getBuildOptions(),
    session.label
  );
  return { session, mindMap };
}

export { listSessions, getTranscriptsDir };
