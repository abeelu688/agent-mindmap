import MarkdownIt from "markdown-it";

/** Cursor-style fenced code: ```startLine:endLine:path/to/file */
const CITATION_FENCE_RE = /^(\d+):(\d+):(.+)$/;

export const TRANSCRIPT_MARKDOWN_STYLES = `
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fa; color: #24292f; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
    .card { background: white; border: 1px solid #d0d7de; border-radius: 10px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    h1, h2, h3, h4 { line-height: 1.3; margin: 20px 0 12px; }
    h1 { margin-top: 0; font-size: 1.8rem; border-bottom: 1px solid #d8dee4; padding-bottom: 10px; }
    h2 { font-size: 1.35rem; border-bottom: 1px solid #d8dee4; padding-bottom: 6px; }
    h3 { font-size: 1.1rem; }
    p { line-height: 1.65; margin: 10px 0; }
    blockquote { margin: 10px 0; padding: 0 14px; border-left: 4px solid #d0d7de; color: #57606a; }
  p > code, li > code, td > code, th > code {
    background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 2px 6px; font-size: 0.9em;
  }
    pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 8px; padding: 12px 16px; overflow-x: auto; margin: 12px 0; line-height: 1.45; }
    pre code { background: transparent; border: none; padding: 0; border-radius: 0; font-size: 0.875rem; white-space: pre; }
    .code-citation { margin: 12px 0; border: 1px solid #d0d7de; border-radius: 8px; overflow: hidden; }
    .code-citation-header {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px;
      padding: 8px 12px; background: #f6f8fa; border-bottom: 1px solid #d0d7de;
      font-size: 0.85rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .code-citation-path { color: #24292f; word-break: break-all; }
    .code-citation-lines { color: #57606a; margin-left: auto; white-space: nowrap; }
    .code-citation pre { margin: 0; border: none; border-radius: 0; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 0.95rem; }
    th, td { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; font-weight: 600; }
    ul, ol { margin: 10px 0; padding-left: 24px; line-height: 1.65; }
    li { margin: 4px 0; }
    hr { border: none; border-top: 1px solid #d8dee4; margin: 20px 0; }
    a { color: #0969da; }
`;

export function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function langFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    rc: "ini",
    java: "java",
    cc: "cpp",
    cpp: "cpp",
    c: "c",
    h: "c",
    kt: "kotlin",
    py: "python",
    sh: "shell",
    md: "markdown",
    json: "json",
    xml: "xml",
  };
  return map[ext] ?? (ext || "text");
}

function renderCitationFence(
  md: MarkdownIt,
  start: string,
  end: string,
  filePath: string,
  content: string
): string {
  const lang = langFromPath(filePath);
  const escaped = md.utils.escapeHtml(content);
  return (
    `<div class="code-citation">` +
    `<div class="code-citation-header">` +
    `<span class="code-citation-path">${escHtml(filePath)}</span>` +
    `<span class="code-citation-lines">L${escHtml(start)}\u2013${escHtml(end)}</span>` +
    `</div>` +
    `<pre><code class="language-${escHtml(lang)}">${escaped}</code></pre>` +
    `</div>\n`
  );
}

function isGfmTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function isGfmTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

function renderGfmTableHtml(header: string[], rows: string[][]): string {
  const head =
    "<thead><tr>" +
    header.map((c) => `<th>${escHtml(c)}</th>`).join("") +
    "</tr></thead>";
  const body =
    rows.length > 0
      ? "<tbody>" +
        rows
          .map(
            (row) =>
              "<tr>" + row.map((c) => `<td>${escHtml(c)}</td>`).join("") + "</tr>"
          )
          .join("") +
        "</tbody>"
      : "";
  return `<table>\n${head}\n${body}\n</table>\n`;
}

/** Convert GFM pipe tables to HTML so markdown-it passes them through (html: true). */
export function preprocessGfmTables(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (
      isGfmTableRow(line) &&
      i + 1 < lines.length &&
      isGfmTableSeparator(lines[i + 1]!)
    ) {
      const header = splitTableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isGfmTableRow(lines[i]!)) {
        rows.push(splitTableCells(lines[i]!));
        i += 1;
      }
      out.push(renderGfmTableHtml(header, rows));
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}

export function createTranscriptMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  });

  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, options, env, self) =>
      self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const info = (token.info ?? "").trim();
    const match = info.match(CITATION_FENCE_RE);
    if (match) {
      const body = token.content.endsWith("\n")
        ? token.content.slice(0, -1)
        : token.content;
      return renderCitationFence(md, match[1]!, match[2]!, match[3]!, body);
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return md;
}

let sharedRenderer: MarkdownIt | undefined;

/** Render transcript markdown to an HTML fragment (body inner HTML). */
export function renderTranscriptMarkdownHtml(md: string): string {
  if (!sharedRenderer) {
    sharedRenderer = createTranscriptMarkdownRenderer();
  }
  const normalized = preprocessGfmTables(md.replace(/\r\n/g, "\n"));
  return sharedRenderer.render(normalized);
}
