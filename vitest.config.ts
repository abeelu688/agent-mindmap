import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        external: ["@vscode/sqlite3"],
      },
    },
  },
  resolve: {
    alias: {
      "@ext": path.resolve(__dirname, "extension/src"),
      "@agent-mindmap/shared": path.resolve(__dirname, "shared/src/index.ts"),
      "@agent-mindmap/core": path.resolve(__dirname, "core/src/index.ts"),
      "@vscode/sqlite3": path.resolve(__dirname, "extension/node_modules/@vscode/sqlite3"),
      vscode: path.resolve(__dirname, "test/mocks/vscode.ts"),
    },
  },
});
