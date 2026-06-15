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

const PT: MindMapLanguageLabels = {
  summaryPrefix: "Resumo: ",
  relatedCode: "Código relacionado",
  corePrefix: "Núcleo",
  research: "Pesquisa",
  conclusion: "Conclusão",
  sessionDefault: "Sessão do agente",
  noDetails: "(Sem detalhes)",
  conceptTitleAll: "Mapa mental de conceitos · Tudo",
  conceptTitleProject: (projectSlug) => `Mapa mental de conceitos · ${projectSlug}`,
  uncategorized: (count) => `Sem categoria (${count})`,
};

const ES: MindMapLanguageLabels = {
  summaryPrefix: "Resumen: ",
  relatedCode: "Código relacionado",
  corePrefix: "Núcleo",
  research: "Investigación",
  conclusion: "Conclusión",
  sessionDefault: "Sesión del agente",
  noDetails: "(Sin detalles)",
  conceptTitleAll: "Mapa mental de conceptos · Todo",
  conceptTitleProject: (projectSlug) => `Mapa mental de conceptos · ${projectSlug}`,
  uncategorized: (count) => `Sin categoría (${count})`,
};

const DE: MindMapLanguageLabels = {
  summaryPrefix: "Zusammenfassung: ",
  relatedCode: "Zugehöriger Code",
  corePrefix: "Kern",
  research: "Recherche",
  conclusion: "Fazit",
  sessionDefault: "Agent-Sitzung",
  noDetails: "(Keine Details)",
  conceptTitleAll: "Konzept-Mindmap · Alle",
  conceptTitleProject: (projectSlug) => `Konzept-Mindmap · ${projectSlug}`,
  uncategorized: (count) => `Nicht kategorisiert (${count})`,
};

const FR: MindMapLanguageLabels = {
  summaryPrefix: "Résumé : ",
  relatedCode: "Code associé",
  corePrefix: "Cœur",
  research: "Recherche",
  conclusion: "Conclusion",
  sessionDefault: "Session agent",
  noDetails: "(Aucun détail)",
  conceptTitleAll: "Carte mentale des concepts · Tout",
  conceptTitleProject: (projectSlug) => `Carte mentale des concepts · ${projectSlug}`,
  uncategorized: (count) => `Non classé (${count})`,
};

const HI: MindMapLanguageLabels = {
  summaryPrefix: "सारांश: ",
  relatedCode: "संबंधित कोड",
  corePrefix: "मुख्य",
  research: "अनुसंधान",
  conclusion: "निष्कर्ष",
  sessionDefault: "एजेंट सेशन",
  noDetails: "(कोई विवरण नहीं)",
  conceptTitleAll: "कॉन्सेप्ट माइंड मैप · सभी",
  conceptTitleProject: (projectSlug) => `कॉन्सेप्ट माइंड मैप · ${projectSlug}`,
  uncategorized: (count) => `अवर्गीकृत (${count})`,
};

const ID: MindMapLanguageLabels = {
  summaryPrefix: "Ringkasan: ",
  relatedCode: "Kode terkait",
  corePrefix: "Inti",
  research: "Riset",
  conclusion: "Kesimpulan",
  sessionDefault: "Sesi Agent",
  noDetails: "(Tidak ada detail)",
  conceptTitleAll: "Mind Map Konsep · Semua",
  conceptTitleProject: (projectSlug) => `Mind Map Konsep · ${projectSlug}`,
  uncategorized: (count) => `Tanpa kategori (${count})`,
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
  if (normalized === "portuguese") {
    return PT;
  }
  if (normalized === "spanish") {
    return ES;
  }
  if (normalized === "german") {
    return DE;
  }
  if (normalized === "french") {
    return FR;
  }
  if (normalized === "hindi") {
    return HI;
  }
  if (normalized === "indonesian") {
    return ID;
  }
  return EN;
}
