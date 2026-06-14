export type MindMapLanguageLabels = {
  summaryPrefix: string;
  relatedCode: string;
  corePrefix: string;
  research: string;
  conclusion: string;
  sessionDefault: string;
  noDetails: string;
  conceptTitleAll: string;
  conceptTitleProject: (projectSlug: string) => string;
  uncategorized: (count: number) => string;
};

const EN: MindMapLanguageLabels = {
  summaryPrefix: "Summary: ",
  relatedCode: "Related code",
  corePrefix: "Core",
  research: "Research",
  conclusion: "Conclusion",
  sessionDefault: "Agent Session",
  noDetails: "(No details)",
  conceptTitleAll: "Concept Mind Map · All",
  conceptTitleProject: (projectSlug) => `Concept Mind Map · ${projectSlug}`,
  uncategorized: (count) => `Uncategorized (${count})`,
};

const ZH: MindMapLanguageLabels = {
  summaryPrefix: "概述：",
  relatedCode: "相关代码",
  corePrefix: "核心",
  research: "调研",
  conclusion: "结论",
  sessionDefault: "Agent Session",
  noDetails: "（无细节）",
  conceptTitleAll: "概念导图 · 全部",
  conceptTitleProject: (projectSlug) => `概念导图 · ${projectSlug}`,
  uncategorized: (count) => `未分类（${count}）`,
};

const JA: MindMapLanguageLabels = {
  summaryPrefix: "概要: ",
  relatedCode: "関連コード",
  corePrefix: "核心",
  research: "調査",
  conclusion: "結論",
  sessionDefault: "Agent Session",
  noDetails: "（詳細なし）",
  conceptTitleAll: "概念マップ · すべて",
  conceptTitleProject: (projectSlug) => `概念マップ · ${projectSlug}`,
  uncategorized: (count) => `未分類（${count}）`,
};

const KO: MindMapLanguageLabels = {
  summaryPrefix: "요약: ",
  relatedCode: "관련 코드",
  corePrefix: "핵심",
  research: "조사",
  conclusion: "결론",
  sessionDefault: "Agent Session",
  noDetails: "(세부 정보 없음)",
  conceptTitleAll: "개념 마인드맵 · 전체",
  conceptTitleProject: (projectSlug) => `개념 마인드맵 · ${projectSlug}`,
  uncategorized: (count) => `분류 없음 (${count})`,
};

export function mindMapLabelsForOutputLanguage(outputLanguage?: string): MindMapLanguageLabels {
  const normalized = outputLanguage?.trim().toLowerCase();
  if (normalized === "chinese") {
    return ZH;
  }
  if (normalized === "japanese") {
    return JA;
  }
  if (normalized === "korean") {
    return KO;
  }
  return EN;
}
