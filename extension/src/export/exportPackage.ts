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

function hostForTranscriptPath(
  transcriptPath: string
): import("../host/types").AgentHost {
  if (transcriptPath.includes(`${path.sep}agent-transcripts${path.sep}`)) {
    return getHostById("cursor");
  }
  return getHostById("claude-code");
}

function buildJumpHref(
  mdRelPath: string,
  turnIndex: number | undefined,
  turnIndexToDisplayQ: Map<number, number>
): string {
  const fragment = anchorForTurnIndex(turnIndex, turnIndexToDisplayQ);
  const encoded = encodeURIComponent(mdRelPath);
  // Put file path into hash to survive browser/server query-stripping.
  // Use short keys to avoid any tooling that mishandles hash tokens.
  if (fragment) {
    return `transcript-viewer.html#f=${encoded}&a=${encodeURIComponent(fragment)}`;
  }
  return `transcript-viewer.html#f=${encoded}`;
}

function cloneWithJumpHrefs(
  root: MindMapRoot,
  sessionMdPath: Map<string, string>,
  turnMaps: Map<string, Map<number, number>>
): MindMapRoot {
  const rewriteRef = (ref: NodeOriginRef): NodeOriginRef => {
    const mdRel = sessionMdPath.get(ref.sessionId);
    if (!mdRel) {
      return ref;
    }
    const turnMap = turnMaps.get(ref.sessionId) ?? new Map();
    const jumpHref = buildJumpHref(mdRel, ref.turnIndex, turnMap);
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
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fa; color: #24292f; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
    .card { background: white; border: 1px solid #d0d7de; border-radius: 10px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    h1, h2, h3 { line-height: 1.3; margin: 20px 0 12px; }
    h1 { margin-top: 0; font-size: 1.8rem; border-bottom: 1px solid #d8dee4; padding-bottom: 10px; }
    h2 { font-size: 1.35rem; border-bottom: 1px solid #d8dee4; padding-bottom: 6px; }
    h3 { font-size: 1.1rem; }
    p { line-height: 1.65; margin: 10px 0; white-space: pre-wrap; }
    blockquote { margin: 10px 0; padding: 0 14px; border-left: 4px solid #d0d7de; color: #57606a; }
    code { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 2px 6px; }
    .error { color: #d1242f; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div id="app">Loading...</div>
    </div>
  </div>
  <script>
    function escHtml(s) {
      return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function renderMarkdown(md) {
      const lines = md.replaceAll("\\r", "").split("\\n");
      const out = [];
      let para = [];
      let quote = [];

      const flushPara = () => {
        if (!para.length) return;
        out.push("<p>" + escHtml(para.join("\\n")) + "</p>");
        para = [];
      };
      const flushQuote = () => {
        if (!quote.length) return;
        out.push("<blockquote><p>" + escHtml(quote.join("\\n")) + "</p></blockquote>");
        quote = [];
      };

      for (const raw of lines) {
        const line = raw.trimEnd();
        const anchor = line.match(/^<a\\s+id="([^"]+)"\\s*><\\/a>$/i);
        if (anchor) {
          flushPara(); flushQuote();
          out.push('<a id="' + escHtml(anchor[1]) + '"></a>');
          continue;
        }
        if (!line) {
          flushPara(); flushQuote();
          continue;
        }
        if (line.startsWith("### ")) {
          flushPara(); flushQuote();
          out.push("<h3>" + escHtml(line.slice(4)) + "</h3>");
          continue;
        }
        if (line.startsWith("## ")) {
          flushPara(); flushQuote();
          out.push("<h2>" + escHtml(line.slice(3)) + "</h2>");
          continue;
        }
        if (line.startsWith("# ")) {
          flushPara(); flushQuote();
          out.push("<h1>" + escHtml(line.slice(2)) + "</h1>");
          continue;
        }
        if (line.startsWith("> ")) {
          flushPara();
          quote.push(line.slice(2));
          continue;
        }
        flushQuote();
        para.push(line);
      }
      flushPara(); flushQuote();
      return out.join("\\n");
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

    (async function () {
      const app = document.getElementById("app");
      const url = new URL(window.location.href);
      const file = resolveFileFromUrl(url);
      if (!file) {
        app.innerHTML = '<p class="error">Missing query param: file</p>' +
          '<p>Current URL: <code>' + escHtml(window.location.href) + '</code></p>';
        return;
      }
      try {
        const mdPath = decodeURIComponent(file);
        const res = await fetch(mdPath);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const md = await res.text();
        app.innerHTML = renderMarkdown(md);
        const rawHash = (window.location.hash || "").replace(/^#/, "");
        if (rawHash) {
          // New scheme: hash contains file=...&anchor=q-6
          // Old scheme: hash is q-6
          let anchorId = null;
          if (rawHash.includes("=")) {
            const params = new URLSearchParams(rawHash);
            anchorId = params.get("anchor") ?? params.get("a");
          } else {
            anchorId = rawHash;
          }
          if (anchorId) {
            const el = document.getElementById(anchorId);
            if (el)
              el.scrollIntoView({ block: "start", behavior: "smooth" });
          }
        }
      } catch (err) {
        app.innerHTML = '<p class="error">Failed to load markdown: ' + escHtml(String(err)) + '</p>' +
          '<p>Tip: run <code>npx serve .</code> in this folder and open via http://localhost</p>';
      }
    })();
  </script>
</body>
</html>`;
}

const README_ZH = `# Agent Mind Map 离线包

## 打开思维导图

**推荐：** 在本目录运行本地服务器后访问（跳转也更可靠）：

\`\`\`bash
npx serve .
\`\`\`

然后在浏览器打开提示的地址（通常是 http://localhost:3000），点击 \`index.html\`。

**直接双击 \`index.html\`：** 新版导出包已兼容 Chrome 本地打开。若仍为空白页，请用上面的 \`npx serve\` 方式。

## 跳转到对话

点击思维导图节点，会打开内置的 Transcript Viewer，以渲染后的网页形式展示 Markdown，并定位到对应问题（\`#q-N\` 锚点）。

若浏览器阻止本地文件跳转，可以：

- 用 VS Code / Cursor 打开 \`transcripts/*.md\`，在文件中搜索 \`## Q\` 标题
- 使用 \`npx serve .\` 通过 http:// 访问（推荐）

## 隐私

本目录包含完整 Agent 对话记录，请勿将敏感内容提交到公共仓库。
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
  for (const file of ["webview.js", "webview.css"]) {
    await fs.copyFile(path.join(mediaDir, file), path.join(assetsDir, file));
  }

  const sessionRefs = collectOriginRefs(mindMap);
  const sessionMdPath = new Map<string, string>();
  const turnMaps = new Map<string, Map<number, number>>();
  const failures: string[] = [];

  for (const ref of sessionRefs) {
    const baseName = sanitizeSessionFileName(ref.sessionId);
    const mdRel = `transcripts/${baseName}.md`;
    const mdAbs = path.join(outDir, mdRel);

    try {
      const content = await fs.readFile(ref.transcriptPath, "utf8");
      const host = hostForTranscriptPath(ref.transcriptPath);
      const events = host.parseTranscript(content);
      const rendered = renderTranscriptMarkdown(events, ref.sessionLabel);
      await fs.writeFile(mdAbs, rendered.markdown, "utf8");
      sessionMdPath.set(ref.sessionId, mdRel);
      turnMaps.set(ref.sessionId, rendered.turnIndexToDisplayQ);
    } catch (err) {
      failures.push(
        `${ref.sessionLabel}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (sessionRefs.length > 0 && sessionMdPath.size === 0) {
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

  const exportData = cloneWithJumpHrefs(mindMap, sessionMdPath, turnMaps);
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

  return {
    transcriptCount: sessionMdPath.size,
    outDir,
  };
}
