import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getHostById } from "../host/registry";
import type { MindMapRoot, NodeOriginRef } from "../transcript/types";
import { readMindMapUiConfig } from "../ui/mindMapUiConfig";
import type { MindMapUiOptions } from "../ui/mindMapUiTypes";
import { collectOriginRefs, sanitizeSessionFileName } from "./collectOriginRefs";
import {
  anchorForTurnIndex,
  renderTranscriptMarkdown,
} from "./renderTranscriptMarkdown";
import {
  buildTranscriptPageHtml,
  markdownToTranscriptHtmlBody,
  TRANSCRIPT_PAGE_STYLES,
} from "./renderTranscriptHtml";

function hostForTranscriptPath(
  transcriptPath: string
): import("../host/types").AgentHost {
  if (transcriptPath.includes(`${path.sep}agent-transcripts${path.sep}`)) {
    return getHostById("cursor");
  }
  return getHostById("claude-code");
}

/** Build offline jump href to a pre-rendered transcript HTML page. */
export function buildTranscriptJumpHref(
  htmlRelPath: string,
  turnIndex: number | undefined,
  turnIndexToDisplayQ: Map<number, number>
): string {
  const fragment = anchorForTurnIndex(turnIndex, turnIndexToDisplayQ);
  if (fragment) {
    return `${htmlRelPath}#${fragment}`;
  }
  return htmlRelPath;
}

function cloneWithJumpHrefs(
  root: MindMapRoot,
  sessionHtmlPath: Map<string, string>,
  turnMaps: Map<string, Map<number, number>>
): MindMapRoot {
  const rewriteRef = (ref: NodeOriginRef): NodeOriginRef => {
    const htmlRel = sessionHtmlPath.get(ref.sessionId);
    if (!htmlRel) {
      return ref;
    }
    const turnMap = turnMaps.get(ref.sessionId) ?? new Map();
    const jumpHref = buildTranscriptJumpHref(
      htmlRel,
      ref.turnIndex,
      turnMap
    );
    return { ...ref, jumpHref };
  };

  const walk = (node: MindMapRoot): MindMapRoot => {
    const origin = node.data.origin;
    const nextOrigin = origin?.refs?.length
      ? { refs: origin.refs.map(rewriteRef) }
      : origin;
    return {
      data: {
        ...node.data,
        ...(nextOrigin ? { origin: nextOrigin } : {}),
      },
      children: node.children?.map(walk),
    };
  };

  return walk(root);
}

function buildIndexHtml(data: MindMapRoot, ui: MindMapUiOptions): string {
  const payload = JSON.stringify({ data, ui });
  const preset = ui.preset === "auto" ? "light" : ui.preset;
  const bodyBg = preset === "light" ? "#f6f6f6" : "#252526";
  const bodyColor = preset === "light" ? "#444446" : "#cccccc";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="./assets/webview.css" />
  <title>Agent Mind Map</title>
  <style>
    html, body { background: ${bodyBg}; color: ${bodyColor}; }
  </style>
</head>
<body>
  <div id="app"><div id="mindMapContainer"></div></div>
  <script>window.__AGENT_MINDMAP_EXPORT__ = ${payload};</script>
  <script src="./assets/webview.js"></script>
</body>
</html>`;
}

function buildTranscriptViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Transcript Viewer</title>
  <style>${TRANSCRIPT_PAGE_STYLES}
    .error { color: #d1242f; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div id="app">Loading...</div>
    </div>
  </div>
  <script src="assets/transcript-markdown.js"></script>
  <script>
    function escHtml(s) {
      return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function resolveFileFromUrl(url) {
      let file = url.searchParams.get("file");
      if (file) return file;

      const hash = (url.hash || "").replace(/^#/, "");
      if (hash) {
        const params = new URLSearchParams(hash);
        const fromHash = params.get("file") ?? params.get("f");
        if (fromHash) return fromHash;

        const idx = hash.indexOf("file=") >= 0 ? hash.indexOf("file=") : hash.indexOf("f=");
        if (idx >= 0) {
          const part = hash.slice(idx);
          const m = part.match(/^(?:file|f)=([^&]+)/);
          if (m) return m[1];
        }
      }
      return null;
    }

    function scrollToAnchor(rawHash) {
      if (!rawHash) return;
      let anchorId = null;
      if (rawHash.includes("=")) {
        const params = new URLSearchParams(rawHash);
        anchorId = params.get("anchor") ?? params.get("a");
      } else {
        anchorId = rawHash;
      }
      if (anchorId) {
        const el = document.getElementById(anchorId);
        if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }

    (async function () {
      const app = document.getElementById("app");
      const url = new URL(window.location.href);
      const file = resolveFileFromUrl(url);
      if (!file) {
        app.innerHTML = '<p class="error">Missing query param: file</p>' +
          '<p>Current URL: <code>' + escHtml(window.location.href) + '</code></p>';
        return;
      }
      if (typeof window.renderTranscriptMarkdown !== "function") {
        app.innerHTML = '<p class="error">Missing assets/transcript-markdown.js</p>';
        return;
      }
      try {
        const mdPath = decodeURIComponent(file);
        const res = await fetch(mdPath);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const md = await res.text();
        app.innerHTML = window.renderTranscriptMarkdown(md);
        const rawHash = (url.hash || "").replace(/^#/, "");
        if (rawHash) {
          if (/^q-\\d+$/.test(rawHash)) {
            scrollToAnchor(rawHash);
          } else if (rawHash.includes("=")) {
            const params = new URLSearchParams(rawHash);
            const anchorId = params.get("anchor") ?? params.get("a");
            if (anchorId) scrollToAnchor(anchorId);
          }
        }
      } catch (err) {
        app.innerHTML = '<p class="error">Failed to load markdown: ' + escHtml(String(err)) + '</p>' +
          '<p>Tip: open pre-rendered <code>transcripts/*.html</code> from the mind map, or use Markdown files in an editor.</p>';
      }
    })();
  </script>
</body>
</html>`;
}

const README_ZH = `# Agent Mind Map 离线包

## 打开思维导图

任选其一（无需安装 Node 或运行 \`npx serve\`）：

- **双击** \`index.html\`（推荐 Chrome / Edge）
- **Windows：** 双击 \`open.cmd\`
- **macOS / Linux：** 在终端执行 \`sh open.sh\`

从扩展导出后，也可在提示框中选择 **在浏览器中打开**。

## 跳转到对话

点击思维导图节点，会在新标签页打开 \`transcripts/*.html\` 中预渲染的对话网页，并定位到对应问题（\`#q-N\` 锚点）。

若需用编辑器查看原始 Markdown，可打开 \`transcripts/*.md\`。

## 隐私

本目录包含完整 Agent 对话记录，请勿将敏感内容提交到公共仓库。
`;

const OPEN_SH = `#!/usr/bin/env sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
INDEX="$DIR/index.html"
if [ ! -f "$INDEX" ]; then
  echo "Missing index.html in $DIR" >&2
  exit 1
fi
if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$INDEX"
elif command -v open >/dev/null 2>&1; then
  exec open "$INDEX"
else
  echo "Open this file in your browser: $INDEX" >&2
  exit 1
fi
`;

const OPEN_CMD = `@echo off
set "INDEX=%~dp0index.html"
if not exist "%INDEX%" (
  echo Missing index.html in %~dp0
  exit /b 1
)
start "" "%INDEX%"
`;

export type ExportPackageOptions = {
  outDir: string;
  mindMap: MindMapRoot;
  extensionUri: vscode.Uri;
  title?: string;
};

export type ExportPackageResult = {
  transcriptCount: number;
  outDir: string;
};

export async function exportMindMapPackage(
  options: ExportPackageOptions
): Promise<ExportPackageResult> {
  const { outDir, mindMap, extensionUri } = options;
  const assetsDir = path.join(outDir, "assets");
  const transcriptsDir = path.join(outDir, "transcripts");

  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(transcriptsDir, { recursive: true });

  const mediaDir = path.join(extensionUri.fsPath, "media");
  for (const file of ["webview.js", "webview.css", "transcript-markdown.js"]) {
    await fs.copyFile(path.join(mediaDir, file), path.join(assetsDir, file));
  }

  const sessionRefs = collectOriginRefs(mindMap);
  const sessionHtmlPath = new Map<string, string>();
  const turnMaps = new Map<string, Map<number, number>>();
  const failures: string[] = [];

  for (const ref of sessionRefs) {
    const baseName = sanitizeSessionFileName(ref.sessionId);
    const mdRel = `transcripts/${baseName}.md`;
    const htmlRel = `transcripts/${baseName}.html`;
    const mdAbs = path.join(outDir, mdRel);
    const htmlAbs = path.join(outDir, htmlRel);

    try {
      const content = await fs.readFile(ref.transcriptPath, "utf8");
      const host = hostForTranscriptPath(ref.transcriptPath);
      const events = host.parseTranscript(content);
      const rendered = renderTranscriptMarkdown(events, ref.sessionLabel);
      await fs.writeFile(mdAbs, rendered.markdown, "utf8");
      const bodyHtml = markdownToTranscriptHtmlBody(rendered.markdown);
      await fs.writeFile(
        htmlAbs,
        buildTranscriptPageHtml(ref.sessionLabel, bodyHtml),
        "utf8"
      );
      sessionHtmlPath.set(ref.sessionId, htmlRel);
      turnMaps.set(ref.sessionId, rendered.turnIndexToDisplayQ);
    } catch (err) {
      failures.push(
        `${ref.sessionLabel}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (sessionRefs.length > 0 && sessionHtmlPath.size === 0) {
    throw new Error(
      failures.length
        ? `无法导出任何对话记录：\n${failures.join("\n")}`
        : "无法导出任何对话记录。"
    );
  }

  if (failures.length) {
    void vscode.window.showWarningMessage(
      `Agent Mind Map: 部分对话导出失败（${failures.length}/${sessionRefs.length}）`
    );
  }

  const exportData = cloneWithJumpHrefs(mindMap, sessionHtmlPath, turnMaps);
  const ui = readMindMapUiConfig();
  const uiForExport: MindMapUiOptions = {
    ...ui,
    preset: ui.preset === "auto" ? "light" : ui.preset,
  };

  await fs.writeFile(
    path.join(outDir, "mindmap.json"),
    JSON.stringify(exportData, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outDir, "index.html"),
    buildIndexHtml(exportData, uiForExport),
    "utf8"
  );
  await fs.writeFile(
    path.join(outDir, "transcript-viewer.html"),
    buildTranscriptViewerHtml(),
    "utf8"
  );
  await fs.writeFile(path.join(outDir, "README.md"), README_ZH, "utf8");
  await fs.writeFile(path.join(outDir, "open.sh"), OPEN_SH, {
    mode: 0o755,
  });
  await fs.writeFile(path.join(outDir, "open.cmd"), OPEN_CMD, "utf8");

  return {
    transcriptCount: sessionHtmlPath.size,
    outDir,
  };
}
