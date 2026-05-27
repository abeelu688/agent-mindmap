import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@ext": path.resolve(__dirname, "extension/src"),
      vscode: path.resolve(__dirname, "test/mocks/vscode.ts"),
    },
  },
});
