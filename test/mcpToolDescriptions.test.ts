import { describe, expect, it } from "vitest";
import {
  resolveAllToolDescriptions,
  resolveToolDescription,
  TOOL_DESCRIPTIONS,
  TOOL_EXAMPLES,
  type ToolId,
} from "../mcp-server/src/toolDescriptions";
import type { McpLocale } from "../mcp-server/src/mcpLocale";

const ALL_TOOL_IDS = Object.keys(TOOL_DESCRIPTIONS) as ToolId[];

describe("resolveToolDescription", () => {
  it("renders English-only examples for locale 'en'", () => {
    const desc = resolveToolDescription("search_project_history", "en");
    expect(desc).toMatch(/Search past session history/);
    expect(desc).toMatch(/Use when/);
    expect(desc).toMatch(/Do NOT use/);
    expect(desc).toContain("EN ");
    expect(desc).not.toMatch(/ZH-CN /);
  });

  it("appends localized examples for 'zh-cn'", () => {
    const desc = resolveToolDescription("search_project_history", "zh-cn");
    expect(desc).toContain("EN ");
    expect(desc).toContain("ZH-CN ");
    // English body remains the same.
    expect(desc).toMatch(/Search past session history/);
  });

  it("falls back to English-only when locale has no examples entry", () => {
    // Hijack a tool to drop its zh-cn examples; the renderer must not throw.
    const original = TOOL_EXAMPLES.search_project_history["zh-cn"];
    delete (TOOL_EXAMPLES.search_project_history as Record<string, string[] | undefined>)["zh-cn"];
    try {
      const desc = resolveToolDescription("search_project_history", "zh-cn");
      expect(desc).toContain("EN ");
      expect(desc).not.toContain("ZH-CN ");
    } finally {
      if (original) {
        (TOOL_EXAMPLES.search_project_history as Record<string, string[] | undefined>)["zh-cn"] =
          original;
      }
    }
  });

  it("every tool id has English examples", () => {
    for (const id of ALL_TOOL_IDS) {
      expect(TOOL_EXAMPLES[id].en, `tool ${id} missing EN examples`).toBeDefined();
      expect(TOOL_EXAMPLES[id].en!.length).toBeGreaterThan(0);
    }
  });

  it("every tool description contains the three-part structure markers", () => {
    const all = resolveAllToolDescriptions("en");
    for (const id of ALL_TOOL_IDS) {
      const desc = all[id];
      expect(desc, `tool ${id} description`).toMatch(/Use when/);
      expect(desc, `tool ${id} description`).toMatch(/Do NOT use/);
    }
  });

  it("every tool description inlines examples (no leftover {examples} placeholder)", () => {
    const all = resolveAllToolDescriptions("zh-cn");
    for (const id of ALL_TOOL_IDS) {
      expect(all[id], `tool ${id}`).not.toContain("{examples}");
    }
  });

  it("every supported locale has example entries for every tool", () => {
    const locales: McpLocale[] = ["en", "zh-cn", "ja", "ko", "pt-br", "es", "de", "fr", "hi", "id"];
    for (const id of ALL_TOOL_IDS) {
      for (const loc of locales) {
        expect(TOOL_EXAMPLES[id][loc], `tool ${id} locale ${loc}`).toBeDefined();
      }
    }
  });

  it("server_info description is not in TOOL_DESCRIPTIONS (it's inlined in index.ts)", () => {
    // server_info uses a custom description with the recommended call flow,
    // not the three-part template. Ensure it's not accidentally registered.
    expect(TOOL_DESCRIPTIONS).not.toHaveProperty("server_info");
  });
});
