/** Minimal vscode stub for vitest (extension code imports `vscode`). */
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
};

export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};

export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => p }),
};

export const commands = {
  executeCommand: async () => undefined,
};

export const env = {
  language: "en",
  clipboard: { writeText: async () => undefined },
  openExternal: async () => true,
};
