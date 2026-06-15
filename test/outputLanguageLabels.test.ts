import { describe, expect, it } from "vitest";
import { mindMapLabelsForOutputLanguage } from "../extension/src/mindmap/outputLanguageLabels";

describe("mindMapLabelsForOutputLanguage", () => {
  it("returns localized structural labels for supported output languages", () => {
    const cases = [
      ["English", "Research", "Related code"],
      ["Chinese", "调研", "相关代码"],
      ["Japanese", "調査", "関連コード"],
      ["Korean", "조사", "관련 코드"],
      ["Portuguese", "Pesquisa", "Código relacionado"],
      ["Spanish", "Investigación", "Código relacionado"],
      ["German", "Recherche", "Zugehöriger Code"],
      ["French", "Recherche", "Code associé"],
      ["Hindi", "अनुसंधान", "संबंधित कोड"],
      ["Indonesian", "Riset", "Kode terkait"],
    ] as const;

    for (const [language, research, relatedCode] of cases) {
      const labels = mindMapLabelsForOutputLanguage(language);
      expect(labels.research).toBe(research);
      expect(labels.relatedCode).toBe(relatedCode);
    }
  });

  it("falls back to English for unknown output languages", () => {
    const labels = mindMapLabelsForOutputLanguage("Unknown");

    expect(labels.research).toBe("Research");
    expect(labels.relatedCode).toBe("Related code");
  });
});
