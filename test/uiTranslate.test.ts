import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  isChineseUiLanguage,
  uiTranslate,
} from "../extension/src/l10n/uiTranslate";

function mockLocaleSetting(value: string) {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: (key: string, defaultValue?: unknown) =>
      key === "ui.locale" ? value : defaultValue,
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
});
