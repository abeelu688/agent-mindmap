import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { isChineseUiLanguage, t, uiTranslate } from "../extension/src/l10n/uiTranslate";

function mockLocaleSetting(value: string) {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: (key: string, defaultValue?: unknown) => (key === "ui.locale" ? value : defaultValue),
  } as ReturnType<typeof vscode.workspace.getConfiguration>);
}

describe("uiTranslate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Chinese when ui.locale is zh-cn even if editor is en", () => {
    mockLocaleSetting("zh-cn");
    vi.spyOn(vscode.env, "language", "get").mockReturnValue("en");
    expect(isChineseUiLanguage()).toBe(true);
    const msg = uiTranslate(
      "ui.cliInstall.summary.cursor",
      "Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library."
    );
    expect(msg).toContain("未找到 cursor-agent CLI");
  });

  it("returns English when ui.locale is en even if editor is zh-cn", () => {
    mockLocaleSetting("en");
    vi.spyOn(vscode.env, "language", "get").mockReturnValue("zh-cn");
    expect(isChineseUiLanguage()).toBe(false);
    const msg = uiTranslate(
      "ui.cliInstall.summary.cursor",
      "Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library."
    );
    expect(msg).toContain("not found");
  });

  it("follows editor language when ui.locale is auto", () => {
    mockLocaleSetting("auto");
    vi.spyOn(vscode.env, "language", "get").mockReturnValue("zh-cn");
    expect(isChineseUiLanguage()).toBe(true);
    vi.spyOn(vscode.env, "language", "get").mockReturnValue("en");
    expect(isChineseUiLanguage()).toBe(false);
  });

  it("formats placeholders in Chinese", () => {
    mockLocaleSetting("zh-cn");
    const msg = uiTranslate(
      "ui.cliInstall.step.verify",
      "2. Verify in a terminal: {0}",
      "agent --version"
    );
    expect(msg).toContain("agent --version");
    expect(msg).toMatch(/验证|终端/);
  });

  it("t() matches uiTranslate() when ui.locale is zh-cn", () => {
    mockLocaleSetting("zh-cn");
    vi.spyOn(vscode.env, "language", "get").mockReturnValue("en");
    const key = "ui.cliInstall.summary.cursor";
    const en =
      "Agent Mind Map: cursor-agent CLI not found — sessions cannot be saved to the library.";
    expect(t(key, en)).toBe(uiTranslate(key, en));
    expect(t(key, en)).toContain("未找到 cursor-agent CLI");
  });

  it("t() returns Chinese webview menu labels when ui.locale is zh-cn", () => {
    mockLocaleSetting("zh-cn");
    expect(t("webview.menu.section.theme", "Theme")).toBe("主题");
    expect(t("webview.batch.refresh", "Refresh")).toBe("刷新");
  });
});
