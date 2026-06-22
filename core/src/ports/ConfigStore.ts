/**
 * Minimal config accessor — decouples from `vscode.workspace.getConfiguration`.
 *
 * The extension implements this against VS Code settings; the CLI reads from
 * JSON config files + env vars. Key names are 1:1 with `agentMindmap.*` settings
 * (e.g. `"team.serverUrl"`, `"host"`, `"llm.promptLanguage"`).
 */
export interface ConfigStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
