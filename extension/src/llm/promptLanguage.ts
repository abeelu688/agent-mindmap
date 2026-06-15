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

const PAYLOAD_BLOCK_MIN_LINES = 3;
const NATIVE_SCRIPT_WEIGHT = 2.5;
const LATIN_WORD_WEIGHT = 1;
const LATIN_ID_WEIGHT = 0.15;
const HEAD_LINE_BOOST = 2;
const TAIL_LINE_BOOST = 3;
const BOUNDARY_LINE_BOOST = 4;
const PAYLOAD_LINE_WEIGHT = 0.05;
const INTENT_LINE_BOOST = 1.5;
const NATIVE_RATIO_THRESHOLD = 0.12;
const NATIVE_MIN_LETTERS = 4;
const NATIVE_RATIO_BONUS = 1.2;
const CONFIDENCE_MIN_SCORE = 2;
const CONFIDENCE_RATIO = 1.25;
const AGENT_INSTRUCTION_LINE_WEIGHT = 0;
const NATIVE_ANCHOR_MIN_LETTERS = 4;
const MIXED_LINE_LATIN_DOWNWEIGHT = 0.2;
const VOTE_CONFIDENCE_CAP = 3;
const EARLY_ANCHOR_MARGIN = 1.5;
const LATE_OVERRIDE_MARGIN = 2;

const LATIN_NATURAL_WORD =
  /\b(?:how|what|why|can|should|is|are|do|does|the|this|that|we|you|fix|help|please|error|with|for|and|or|not|when|where|who|which|have|has|been|from|them|they|all|your|already|create|work|stop|until|attached|reference|implement|plan|file|starting|completed)\b/i;

const AGENT_INSTRUCTION_PATTERNS = [
  /Implement the plan as specified/i,
  /Do NOT edit the plan file/i,
  /To-do'?s from the plan have already been created/i,
  /Mark them as in_progress as you work/i,
  /Don'?t stop until you have completed all the to-dos/i,
  /attached for your reference.*plan|plan.*attached for your reference/i,
];

const AGENT_INSTRUCTION_KEYWORDS = [
  "implement",
  "attached",
  "reference",
  "to-do",
  "in_progress",
  "completed",
  "plan file",
];

type LanguageScores = Record<KnownOutputLanguage, number>;
type PayloadBlock = { start: number; end: number };
type ScriptScoreStats = { nativeLetters: number; latinLetters: number };
type QueryLanguageScore = {
  language: KnownOutputLanguage | undefined;
  margin: number;
  scores: LanguageScores;
  payloadFlags: boolean[];
  blocks: PayloadBlock[];
};

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

function emptyScores(): LanguageScores {
  return {
    Chinese: 0,
    English: 0,
    Japanese: 0,
    Korean: 0,
  };
}

function preprocessQueryText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "\n");
}

function extractLettersOnly(text: string): string {
  return (text.match(/[\p{L}\p{M}]/gu) ?? []).join("");
}

function hasNativeScript(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}

function countNativeLetters(text: string): number {
  return (
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []
  ).length;
}

function isAgentInstructionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (AGENT_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  if (hasNativeScript(trimmed) || trimmed.length <= 60) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  let keywordHits = 0;
  for (const keyword of AGENT_INSTRUCTION_KEYWORDS) {
    if (lower.includes(keyword)) {
      keywordHits += 1;
    }
  }
  return keywordHits >= 2;
}

function isNaturalEnglishLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || hasNativeScript(trimmed)) {
    return false;
  }
  const tokens = trimmed.match(/[A-Za-z]+/g) ?? [];
  if (tokens.length < 3) {
    return false;
  }
  const naturalCount = tokens.filter(
    (token) => LATIN_NATURAL_WORD.test(token) || (!isLatinIdentifier(token) && token.length >= 3)
  ).length;
  return naturalCount >= 2;
}

function isLikelyIdentifierLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (hasNativeScript(trimmed)) {
    return false;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  if (tokens.some((token) => LATIN_NATURAL_WORD.test(token))) {
    return false;
  }
  return tokens.every((token) => {
    const cleaned = token.replace(/[^A-Za-z0-9._$/\\-]/g, "");
    return cleaned.length > 0 && isLatinIdentifier(cleaned);
  });
}

function isLikelyPayloadLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  const lettersOnly = extractLettersOnly(trimmed);
  if (!lettersOnly) {
    return true;
  }

  if (isAgentInstructionLine(trimmed)) {
    return true;
  }

  if (isLikelyIdentifierLine(trimmed)) {
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
  const letters = lettersOnly.length;
  return (
    trimmed.length > 40 && (codePunct / trimmed.length > 0.16 || letters / trimmed.length < 0.18)
  );
}

function findPayloadBlocks(lines: string[]): PayloadBlock[] {
  const blocks: PayloadBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!isLikelyPayloadLine(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && isLikelyPayloadLine(lines[index] ?? "")) {
      index += 1;
    }
    const end = index - 1;
    if (end - start + 1 >= PAYLOAD_BLOCK_MIN_LINES) {
      blocks.push({ start, end });
    }
  }
  return blocks;
}

function isLatinIdentifier(token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9._$/\\-]*$/.test(token)) {
    return false;
  }
  if (/[_.\\/]/.test(token)) {
    return true;
  }
  if (/^[A-Z0-9_]{3,}$/.test(token)) {
    return true;
  }
  if (/^[a-z][a-zA-Z0-9]*$/.test(token) && !/[aeiouAEIOU]/.test(token)) {
    return true;
  }
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(token)) {
    return true;
  }
  return false;
}

function scoreLatinToken(token: string, weight: number): number {
  const letterCount = (token.match(/[A-Za-z]/g) ?? []).length;
  if (letterCount === 0) {
    return 0;
  }
  if (LATIN_NATURAL_WORD.test(token)) {
    return LATIN_WORD_WEIGHT * weight * letterCount;
  }
  if (isLatinIdentifier(token)) {
    return LATIN_ID_WEIGHT * weight * letterCount;
  }
  return LATIN_WORD_WEIGHT * weight * letterCount;
}

function scoreLatinText(
  text: string,
  scores: LanguageScores,
  weight: number,
  latinMultiplier = 1
): number {
  let latinLetters = 0;
  const effectiveWeight = weight * latinMultiplier;
  for (const token of text.match(/[A-Za-z][A-Za-z0-9._$/\\-]*/g) ?? []) {
    const letterCount = (token.match(/[A-Za-z]/g) ?? []).length;
    latinLetters += letterCount;
    scores.English += scoreLatinToken(token, effectiveWeight);
  }
  return latinLetters;
}

function mixedLineLatinMultiplier(line: string): number {
  const nativeLetters = countNativeLetters(line);
  if (nativeLetters === 0) {
    return 1;
  }
  const latinLetters = (line.match(/[A-Za-z]/g) ?? []).length;
  if (latinLetters === 0) {
    return 1;
  }
  if (nativeLetters / (nativeLetters + latinLetters) >= 0.3) {
    return 1;
  }
  return nativeLetters >= 2 ? MIXED_LINE_LATIN_DOWNWEIGHT : 1;
}

function addScriptScores(
  text: string,
  scores: LanguageScores,
  weight: number,
  latinMultiplier = 1
): ScriptScoreStats {
  let nativeLetters = 0;
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) {
      scores.Chinese += NATIVE_SCRIPT_WEIGHT * weight;
      nativeLetters += 1;
    } else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
      scores.Japanese += NATIVE_SCRIPT_WEIGHT * weight;
      nativeLetters += 1;
    } else if (/\p{Script=Hangul}/u.test(ch)) {
      scores.Korean += NATIVE_SCRIPT_WEIGHT * weight;
      nativeLetters += 1;
    }
  }
  const latinLetters = scoreLatinText(text, scores, weight, latinMultiplier);
  return { nativeLetters, latinLetters };
}

function isIntentLine(line: string): boolean {
  const trimmed = line.trim();
  if (/[怎么如何为何为啥是不是有没有哪]/.test(trimmed)) {
    return true;
  }
  if (/[？?]$/.test(trimmed)) {
    return true;
  }
  if (/^(how|what|why|can|should|is|are|do|does)\b/i.test(trimmed)) {
    return true;
  }
  if (/[かな]|ですか|どう|なぜ/.test(trimmed)) {
    return true;
  }
  if (/[까요]|어떻|왜/.test(trimmed)) {
    return true;
  }
  return false;
}

function applyNativeRatioBonus(
  scores: LanguageScores,
  totalNative: number,
  totalLatin: number
): void {
  const totalLetters = totalNative + totalLatin;
  if (
    totalLetters === 0 ||
    totalNative < NATIVE_MIN_LETTERS ||
    totalNative / totalLetters < NATIVE_RATIO_THRESHOLD
  ) {
    return;
  }
  scores.Chinese *= NATIVE_RATIO_BONUS;
  scores.Japanese *= NATIVE_RATIO_BONUS;
  scores.Korean *= NATIVE_RATIO_BONUS;
}

function sortedScoreEntries(scores: LanguageScores): Array<[KnownOutputLanguage, number]> {
  return (Object.entries(scores) as Array<[KnownOutputLanguage, number]>).sort(
    (a, b) => b[1] - a[1]
  );
}

function computeClassificationMargin(scores: LanguageScores): number {
  const entries = sortedScoreEntries(scores);
  const bestScore = entries[0]?.[1] ?? 0;
  const secondScore = entries[1]?.[1] ?? 0;
  if (bestScore < CONFIDENCE_MIN_SCORE || bestScore < secondScore * CONFIDENCE_RATIO) {
    return 0;
  }
  return bestScore / Math.max(secondScore, 1);
}

function pickBestLanguage(scores: LanguageScores): KnownOutputLanguage | undefined {
  const margin = computeClassificationMargin(scores);
  if (margin === 0) {
    return undefined;
  }
  return sortedScoreEntries(scores)[0]?.[0];
}

function applyNativeAnchorWeights(lines: string[], weights: number[]): void {
  if (lines.length < 2) {
    return;
  }
  const firstLine = lines[0] ?? "";
  if (countNativeLetters(firstLine) < NATIVE_ANCHOR_MIN_LETTERS) {
    return;
  }
  const hasAgentFollowup = lines.slice(1).some((line) => isAgentInstructionLine(line));
  if (!hasAgentFollowup) {
    return;
  }
  weights[0] = Math.max(weights[0] ?? 1, BOUNDARY_LINE_BOOST);
}

function scoreUserQueryLanguage(text: string): QueryLanguageScore {
  const preprocessed = preprocessQueryText(text);
  const nonEmptyLines = preprocessed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) {
    return {
      language: undefined,
      margin: 0,
      scores: emptyScores(),
      payloadFlags: [],
      blocks: [],
    };
  }

  const agentInstructionFlags = nonEmptyLines.map((line) => isAgentInstructionLine(line));
  const payloadFlags = nonEmptyLines.map(
    (line, index) => agentInstructionFlags[index] || isLikelyPayloadLine(line)
  );
  const blocks = findPayloadBlocks(nonEmptyLines);

  const inBlock = new Set<number>();
  for (const { start, end } of blocks) {
    for (let index = start; index <= end; index += 1) {
      inBlock.add(index);
    }
  }

  const boundaryLines = new Set<number>();
  for (const { start, end } of blocks) {
    if (start > 0 && !payloadFlags[start - 1]) {
      boundaryLines.add(start - 1);
    }
    if (end < nonEmptyLines.length - 1 && !payloadFlags[end + 1]) {
      boundaryLines.add(end + 1);
    }
  }

  const nonPayloadIndices = payloadFlags
    .map((isPayload, index) => (!isPayload ? index : -1))
    .filter((index) => index >= 0);
  const almostAllPayload =
    nonPayloadIndices.length <= 2 && nonEmptyLines.length >= PAYLOAD_BLOCK_MIN_LINES;

  const tailStart = Math.max(0, nonEmptyLines.length - 3);
  const headEnd = Math.min(1, nonEmptyLines.length - 1);
  const lineWeights = nonEmptyLines.map((line, index) => {
    if (agentInstructionFlags[index]) {
      return AGENT_INSTRUCTION_LINE_WEIGHT;
    }
    if (inBlock.has(index)) {
      return AGENT_INSTRUCTION_LINE_WEIGHT;
    }

    const isPayload = payloadFlags[index] ?? false;
    let weight = 1;
    if (isPayload) {
      weight = PAYLOAD_LINE_WEIGHT;
    } else if (boundaryLines.has(index)) {
      weight = BOUNDARY_LINE_BOOST;
    } else {
      if (index <= headEnd) {
        weight *= HEAD_LINE_BOOST;
      }
      if (index >= tailStart) {
        weight *= TAIL_LINE_BOOST;
      }
    }

    if (almostAllPayload && nonPayloadIndices.includes(index)) {
      const first = nonPayloadIndices[0];
      const last = nonPayloadIndices[nonPayloadIndices.length - 1];
      if (index === first || index === last) {
        weight = Math.max(weight, BOUNDARY_LINE_BOOST);
      }
    }

    if (!isPayload && isIntentLine(line)) {
      weight *= INTENT_LINE_BOOST;
    }
    return weight;
  });

  applyNativeAnchorWeights(nonEmptyLines, lineWeights);

  const scores = emptyScores();
  let totalNative = 0;
  let totalLatin = 0;

  nonEmptyLines.forEach((line, index) => {
    const weight = lineWeights[index] ?? 0;
    if (weight <= 0) {
      return;
    }

    const isPayload = payloadFlags[index] ?? false;
    const capped = line.slice(0, isPayload ? 80 : 180);
    const stats = addScriptScores(capped, scores, weight, mixedLineLatinMultiplier(line));
    totalNative += stats.nativeLetters;
    totalLatin += stats.latinLetters;
  });

  applyNativeRatioBonus(scores, totalNative, totalLatin);
  const language = pickBestLanguage(scores);
  return {
    language,
    margin: computeClassificationMargin(scores),
    scores,
    payloadFlags,
    blocks,
  };
}

function classifyUserQueryLanguage(text: string): KnownOutputLanguage | undefined {
  return scoreUserQueryLanguage(text).language;
}

function computeVoteWeight(
  recencyWeight: number,
  margin: number,
  queryIndex: number,
  firstQueryAnchor?: { language: KnownOutputLanguage; margin: number }
): number {
  let adjustedRecency = recencyWeight;
  if (firstQueryAnchor && queryIndex > 0 && margin > 0 && margin < LATE_OVERRIDE_MARGIN) {
    adjustedRecency *= 0.5;
  }
  const confidenceWeight = margin > 0 ? Math.min(margin, VOTE_CONFIDENCE_CAP) : 1;
  return adjustedRecency * confidenceWeight;
}

export function resolveOutputLanguageForEvents(events: ChatEvent[]): OutputLanguage {
  const override = settingToOutputLanguage(readSetting());
  if (override) {
    return override;
  }

  const userQueries: Array<{ eventIndex: number; text: string }> = [];
  events.forEach((event, eventIndex) => {
    if (event.kind === "user_query") {
      userQueries.push({ eventIndex, text: event.text });
    }
  });

  const totalQueries = userQueries.length;
  const firstScored = userQueries[0] ? scoreUserQueryLanguage(userQueries[0].text) : undefined;
  const firstQueryAnchor =
    firstScored && firstScored.language && firstScored.margin >= EARLY_ANCHOR_MARGIN
      ? { language: firstScored.language, margin: firstScored.margin }
      : undefined;

  const votes = new Map<KnownOutputLanguage, { weight: number; latestIndex: number }>();
  userQueries.forEach(({ eventIndex, text }, queryIndex) => {
    const scored = scoreUserQueryLanguage(text);
    const language = scored.language;
    if (!language) {
      return;
    }
    const recencyWeight = 1 + (queryIndex / Math.max(totalQueries - 1, 1)) * 2;
    const voteWeight = computeVoteWeight(
      recencyWeight,
      scored.margin,
      queryIndex,
      firstQueryAnchor
    );
    const current = votes.get(language) ?? { weight: 0, latestIndex: -1 };
    votes.set(language, {
      weight: current.weight + voteWeight,
      latestIndex: Math.max(current.latestIndex, eventIndex),
    });
  });

  const ranked = [...votes.entries()].sort(
    (a, b) => b[1].weight - a[1].weight || b[1].latestIndex - a[1].latestIndex
  );
  return ranked[0]?.[0] ?? "English";
}

export const __testing = {
  classifyUserQueryLanguage,
  scoreUserQueryLanguage,
  isLikelyPayloadLine,
  isLikelyIdentifierLine,
  isAgentInstructionLine,
  isNaturalEnglishLine,
  preprocessQueryText,
  extractLettersOnly,
  findPayloadBlocks,
  isIntentLine,
  isLatinIdentifier,
  computeVoteWeight,
  computeClassificationMargin,
};
