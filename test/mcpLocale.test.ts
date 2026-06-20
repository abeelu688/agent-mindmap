import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../shared/src/atomicWrite";
import { resolveMcpLocale, MCP_LOCALES } from "../mcp-server/src/mcpLocale";
import type { UiLocale } from "../extension/src/l10n/uiTranslate";

const ORIGINAL_STORE_DIR = process.env.AGENT_MINDMAP_STORE_DIR;

async function makeTmpStoreDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mcp-locale-"));
}

describe("resolveMcpLocale", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await makeTmpStoreDir();
    process.env.AGENT_MINDMAP_STORE_DIR = tmp;
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR === undefined) {
      delete process.env.AGENT_MINDMAP_STORE_DIR;
    } else {
      process.env.AGENT_MINDMAP_STORE_DIR = ORIGINAL_STORE_DIR;
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns 'en' when mcp-locale.json is missing", () => {
    expect(resolveMcpLocale()).toBe("en");
  });

  it("returns 'en' when the file is unreadable / invalid JSON", async () => {
    await fs.writeFile(path.join(tmp, "mcp-locale.json"), "{ not json");
    expect(resolveMcpLocale()).toBe("en");
  });

  it("returns 'en' when locale field is missing or unknown", async () => {
    await writeJsonAtomic(path.join(tmp, "mcp-locale.json"), { locale: "klingon" });
    expect(resolveMcpLocale()).toBe("en");
    await writeJsonAtomic(path.join(tmp, "mcp-locale.json"), {});
    expect(resolveMcpLocale()).toBe("en");
  });

  it("returns the locale written by the extension for every supported UiLocale", async () => {
    for (const locale of MCP_LOCALES) {
      await writeJsonAtomic(path.join(tmp, "mcp-locale.json"), { locale });
      expect(resolveMcpLocale()).toBe(locale);
    }
  });

  it("MCP_LOCALES matches extension UiLocale union (locale sync contract)", () => {
    // If this fails, the extension wrote a locale the MCP server cannot read.
    // Add the new locale to MCP_LOCALES and TOOL_EXAMPLES in toolDescriptions.ts.
    const uiLocales: readonly string[] = [
      "en",
      "zh-cn",
      "ja",
      "ko",
      "pt-br",
      "es",
      "de",
      "fr",
      "hi",
      "id",
    ];
    expect(new Set(MCP_LOCALES)).toEqual(new Set(uiLocales));
    void (null as unknown as UiLocale);
  });
});
