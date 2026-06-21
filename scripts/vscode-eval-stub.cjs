/** Minimal CJS stub for the eval CLI runner (esbuild --alias:vscode). */
module.exports = {
  workspace: {
    getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }),
  },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
  commands: { executeCommand: async () => undefined },
  env: {
    language: "en",
    clipboard: { writeText: async () => undefined },
    openExternal: async () => true,
  },
};
