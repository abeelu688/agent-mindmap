import * as vscode from "vscode";
import type { ChatEvent } from "../transcript/types";

/**
 * Legacy setting value. Production analysis prompts are English; this setting
 * now acts as an optional output-language override.
 */
export type PromptLanguage = "zh" | "en";

export type OutputLanguage = string;
type KnownOutputLanguage = "Chinese" | "English" | "Japanese" | "Korean";

type PromptLanguageSetting = "auto" | PromptLanguage;

function readSetting(): PromptLanguageSetting {
  const raw = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("llm.promptLanguage", "auto");
  if (raw === "zh" || raw === "en") {
    return raw;
  }
  return "auto";
}

export function resolvePromptLanguage(): PromptLanguage {
  const setting = readSetting();
  if (setting !== "auto") {
    return setting;
  }
  return "en";
}

function settingToOutputLanguage(setting: PromptLanguageSetting): KnownOutputLanguage | undefined {
  if (setting === "zh") {
    return "Chinese";
  }
  if (setting === "en") {
    return "English";
  }
  return undefined;
}

type LanguageScores = Record<KnownOutputLanguage, number>;

function emptyScores(): LanguageScores {
  return {
    Chinese: 0,
    English: 0,
    Japanese: 0,
    Korean: 0,
  };
}

function isLikelyPayloadLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > 240) {
    return true;
  }
  if (/^\s*(at\s+\S+|[\w.$/\\-]+:\d+:\d+|Caused by:|Traceback\b)/.test(trimmed)) {
    return true;
  }
  if (/^\s*\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(trimmed)) {
    return true;
  }
  if (/https?:\/\/|[A-Za-z]:\\|\/[\w.-]+\/[\w./-]+/.test(trimmed)) {
    return true;
  }
  const codePunct = (trimmed.match(/[{}[\]();=<>|`]/g) ?? []).length;
  const letters = (trimmed.match(/[\p{L}]/gu) ?? []).length;
  return (
    trimmed.length > 40 && (codePunct / trimmed.length > 0.16 || letters / trimmed.length < 0.18)
  );
}

function addScriptScores(text: string, scores: LanguageScores, weight: number): void {
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) {
      scores.Chinese += weight;
    } else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
      scores.Japanese += weight;
    } else if (/\p{Script=Hangul}/u.test(ch)) {
      scores.Korean += weight;
    } else if (/[A-Za-z]/.test(ch)) {
      scores.English += weight;
    }
  }
}

function classifyUserQueryLanguage(text: string): KnownOutputLanguage | undefined {
  const lines = text.split(/\r?\n/);
  const scores = emptyScores();
  const nonEmptyLines = lines.map((l) => l.trim()).filter(Boolean);
  const tailStart = Math.max(0, nonEmptyLines.length - 3);

  nonEmptyLines.forEach((line, idx) => {
    const payload = isLikelyPayloadLine(line);
    const capped = line.slice(0, payload ? 80 : 180);
    const weight = (payload ? 0.05 : 1) * (idx >= tailStart ? 3 : 1);
    addScriptScores(capped, scores, weight);
  });

  const entries = (Object.entries(scores) as Array<[KnownOutputLanguage, number]>).sort(
    (a, b) => b[1] - a[1]
  );
  const [bestLang, bestScore] = entries[0] ?? ["English", 0];
  const secondScore = entries[1]?.[1] ?? 0;
  if (bestScore < 2 || bestScore < secondScore * 1.25) {
    return undefined;
  }
  return bestLang;
}

export function resolveOutputLanguageForEvents(events: ChatEvent[]): OutputLanguage {
  const override = settingToOutputLanguage(readSetting());
  if (override) {
    return override;
  }

  const votes = new Map<KnownOutputLanguage, { count: number; latestIndex: number }>();
  events.forEach((event, index) => {
    if (event.kind !== "user_query") {
      return;
    }
    const language = classifyUserQueryLanguage(event.text);
    if (!language) {
      return;
    }
    const current = votes.get(language) ?? { count: 0, latestIndex: -1 };
    votes.set(language, { count: current.count + 1, latestIndex: index });
  });

  const ranked = [...votes.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].latestIndex - a[1].latestIndex
  );
  return ranked[0]?.[0] ?? "English";
}

export const __testing = {
  classifyUserQueryLanguage,
  isLikelyPayloadLine,
};
