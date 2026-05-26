import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, "../extension/media"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "webview.js",
        assetFileNames: "webview.[ext]",
      },
    },
  },
});
