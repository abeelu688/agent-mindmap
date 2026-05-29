import { describe, expect, it } from "vitest";
import {
  buildCliInstallGuide,
  CLAUDE_CLI_DOCS_URL,
  CURSOR_CLI_DOCS_URL,
  CURSOR_INSTALL_UNIX,
  CURSOR_INSTALL_WIN32,
} from "../extension/src/llm/cliInstallGuide";

const identityT = (
  _key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string => {
  return message.replace(/\{(\d+)\}/g, (_m, rawIdx) => {
    const idx = Number(rawIdx);
    const v = args[idx];
    return v === undefined ? "" : String(v);
  });
};

describe("buildCliInstallGuide", () => {
  it("includes Windows PowerShell install for cursor on win32", () => {
    const guide = buildCliInstallGuide("cursor", "win32", identityT);
    expect(guide.installCommand).toBe(CURSOR_INSTALL_WIN32);
    expect(guide.verifyCommand).toBe("agent --version");
    expect(guide.docsUrl).toBe(CURSOR_CLI_DOCS_URL);
    expect(guide.detail).toContain(CURSOR_INSTALL_WIN32);
    expect(guide.settingsKey).toBe("agentMindmap.llm.cliPath");
  });

  it("includes curl install for cursor on linux", () => {
    const guide = buildCliInstallGuide("cursor", "linux", identityT);
    expect(guide.installCommand).toBe(CURSOR_INSTALL_UNIX);
    expect(guide.detail).toContain(CURSOR_INSTALL_UNIX);
  });

  it("points claude-code to headless docs without install command", () => {
    const guide = buildCliInstallGuide("claude-code", "win32", identityT);
    expect(guide.installCommand).toBeUndefined();
    expect(guide.verifyCommand).toBe("claude --version");
    expect(guide.docsUrl).toBe(CLAUDE_CLI_DOCS_URL);
    expect(guide.detail).toContain(CLAUDE_CLI_DOCS_URL);
  });
});
