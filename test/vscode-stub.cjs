/** CJS stub for bundled extension tests (`npm test` / test-run.js). */
module.exports = {
  workspace: {
    getConfiguration: () => ({
      get: (_key, defaultValue) => defaultValue,
    }),
  },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
  commands: { executeCommand: async () => undefined },
};
