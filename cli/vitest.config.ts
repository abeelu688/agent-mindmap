import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@agent-mindmap/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@agent-mindmap/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
