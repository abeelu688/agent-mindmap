import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const watch = process.argv.includes("--watch");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_WASM_SRC = path.join(
  HERE,
  "node_modules",
  "sql.js",
  "dist",
  "sql-wasm.wasm"
);
const SQL_WASM_DST = path.join(HERE, "dist", "sql-wasm.wasm");
const TRANSCRIPT_MD_OUT = path.join(HERE, "media", "transcript-markdown.js");

async function copySqlWasm() {
  try {
    await fs.mkdir(path.dirname(SQL_WASM_DST), { recursive: true });
    await fs.copyFile(SQL_WASM_SRC, SQL_WASM_DST);
    console.log(`copied sql-wasm.wasm → ${SQL_WASM_DST}`);
  } catch (err) {
    console.warn(`[esbuild] failed to copy sql-wasm.wasm: ${err}`);
  }
}

const copySqlWasmPlugin = {
  name: "copy-sql-wasm",
  setup(build) {
    build.onEnd(() => copySqlWasm());
  },
};

const extensionBuild = {
  entryPoints: [path.join(HERE, "src/extension.ts")],
  bundle: true,
  outfile: path.join(HERE, "dist/extension.js"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
  plugins: [copySqlWasmPlugin],
};

const transcriptMarkdownBuild = {
  entryPoints: [path.join(HERE, "src/export/transcriptMarkdownBrowser.ts")],
  bundle: true,
  outfile: TRANSCRIPT_MD_OUT,
  format: "iife",
  platform: "browser",
  target: "es2020",
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context({
      ...extensionBuild,
      plugins: [copySqlWasmPlugin],
    });
    const mdCtx = await esbuild.context(transcriptMarkdownBuild);
    await Promise.all([ctx.watch(), mdCtx.watch()]);
    console.log("watching extension + transcript-markdown...");
    return;
  }
  await fs.mkdir(path.dirname(TRANSCRIPT_MD_OUT), { recursive: true });
  await Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(transcriptMarkdownBuild),
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
