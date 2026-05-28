import MarkdownIt from "markdown-it";

/** Cursor-style fenced code: ```startLine:endLine:path/to/file */
const CITATION_FENCE_RE = /^(\d+):(\d+):(.+)$/;

export const TRANSCRIPT_MARKDOWN_STYLES = `
    :root { color-scheme: light; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fa; color: #24292f; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
    .card { background: white; border: 1px solid #d0d7de; border-radius: 10px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    h1, h2, h3, h4 { line-height: 1.3; margin: 20px 0 12px; }
    h1 { margin-top: 0; font-size: 1.8rem; border-bottom: 1px solid #d8dee4; padding-bottom: 10px; }
    h2 { font-size: 1.35rem; border-bottom: 1px solid #d8dee4; padding-bottom: 6px; }
    h3 { font-size: 1.1rem; }
    p { line-height: 1.65; margin: 10px 0; }
    blockquote {
      margin: 10px 0; padding: 8px 14px; border-left: 4px solid #d0d7de;
      background: #f6f8fa; color: #24292f;
    }
    :not(pre) > code {
      color: #0550ae;
      background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 2px 6px; font-size: 0.9em;
    }
    pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 8px; padding: 12px 16px; overflow-x: auto; margin: 12px 0; line-height: 1.45; }
    pre code { color: #0550ae; background: transparent; border: none; padding: 0; border-radius: 0; font-size: 0.875rem; white-space: pre; }
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

function splitTabCells(line: string): string[] {
  return line.split("\t").map((c) => c.trim());
}

function isTabTableRow(line: string): boolean {
  if (!line.includes("\t")) {
    return false;
  }
  const cells = splitTabCells(line);
  if (cells.length < 2) {
    return false;
  }
  let nonEmpty = 0;
  for (const c of cells) {
    if (c.length > 0) {
      nonEmpty += 1;
    }
  }
  // Tab-indented source lines often split as ["", ".foo = bar"] — not a table.
  return nonEmpty >= 2;
}

function isStrictPipeTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function isLoosePipeTableRow(line: string): boolean {
  if (isStrictPipeTableRow(line)) {
    return true;
  }
  const t = line.trim();
  if (!t.includes("|")) {
    return false;
  }
  const cells = t.split("|").map((c) => c.trim());
  return cells.length >= 2 && cells.every((c) => c.length > 0);
}

function splitTableCells(line: string): string[] {
  const t = line.trim();
  if (t.startsWith("|") && t.endsWith("|")) {
    return splitPipeCells(line);
  }
  return t.split("|").map((c) => c.trim());
}

function isGfmTableRow(line: string): boolean {
  return isStrictPipeTableRow(line);
}

function isGfmTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function splitPipeCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

function renderCellInline(md: MarkdownIt, cell: string): string {
  return md.renderInline(cell.trim(), {});
}

function renderTableHtml(
  md: MarkdownIt,
  header: string[],
  rows: string[][]
): string {
  const head =
    "<thead><tr>" +
    header.map((c) => `<th>${renderCellInline(md, c)}</th>`).join("") +
    "</tr></thead>";
  const body =
    rows.length > 0
      ? "<tbody>" +
        rows
          .map(
            (row) =>
              "<tr>" +
              row.map((c) => `<td>${renderCellInline(md, c)}</td>`).join("") +
              "</tr>"
          )
          .join("") +
        "</tbody>"
      : "";
  return `<table>\n${head}\n${body}\n</table>\n`;
}

type TableBlock = { header: string[]; rows: string[][]; end: number };

function readGfmPipeTable(
  lines: string[],
  start: number
): TableBlock | undefined {
  if (!isGfmTableRow(lines[start]!)) {
    return undefined;
  }
  if (
    start + 1 >= lines.length ||
    !isGfmTableSeparator(lines[start + 1]!)
  ) {
    return undefined;
  }
  const header = splitTableCells(lines[start]!);
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && isGfmTableRow(lines[i]!)) {
    rows.push(splitPipeCells(lines[i]!));
    i += 1;
  }
  return { header, rows, end: i };
}

function readPipeTableNoSeparator(
  lines: string[],
  start: number
): TableBlock | undefined {
  if (!isLoosePipeTableRow(lines[start]!)) {
    return undefined;
  }
  if (
    start + 1 < lines.length &&
    isGfmTableSeparator(lines[start + 1]!)
  ) {
    return undefined;
  }
  const header = splitTableCells(lines[start]!);
  const rows: string[][] = [];
  let i = start + 1;
  while (i < lines.length && isLoosePipeTableRow(lines[i]!)) {
    const cells = splitTableCells(lines[i]!);
    if (cells.length !== header.length) {
      break;
    }
    rows.push(cells);
    i += 1;
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { header, rows, end: i };
}

function readTabTable(lines: string[], start: number): TableBlock | undefined {
  if (!isTabTableRow(lines[start]!)) {
    return undefined;
  }
  const header = splitTabCells(lines[start]!);
  const rows: string[][] = [];
  let i = start + 1;
  while (i < lines.length && isTabTableRow(lines[i]!)) {
    const cells = splitTabCells(lines[i]!);
    if (cells.length !== header.length) {
      break;
    }
    rows.push(cells);
    i += 1;
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { header, rows, end: i };
}

/** Opening/closing quote chars that break CommonMark `**` emphasis when adjacent. */
const QUOTE_CHAR_CLASS = `"'\\u201c\\u201d\\u2018\\u2019`;

/** `**"…"**` / `**"…"**` → `<strong>…</strong>` (markdown-it leaves these as literal `**`). */
const QUOTED_BOLD_RE = new RegExp(
  `\\*\\*([${QUOTE_CHAR_CLASS}][^*\\n]*[${QUOTE_CHAR_CLASS}])\\*\\*`,
  "g"
);

/**
 * Fix bold markers wrapped in quotes that CommonMark does not parse as emphasis.
 * Skips fenced code blocks so literals inside ``` are untouched.
 */
export function preprocessQuotedBold(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(line.replace(QUOTED_BOLD_RE, "<strong>$1</strong>"));
  }
  return out.join("\n");
}

/** Convert pipe / tab tables to HTML (markdown-it html:true passes them through). */
export function preprocessTables(md: string, renderer: MarkdownIt): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    const block =
      readGfmPipeTable(lines, i) ??
      readPipeTableNoSeparator(lines, i) ??
      readTabTable(lines, i);
    if (block) {
      out.push(renderTableHtml(renderer, block.header, block.rows));
      i = block.end;
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}

/** @deprecated Use preprocessTables */
export function preprocessGfmTables(md: string): string {
  const mdInst = createTranscriptMarkdownRenderer();
  return preprocessTables(md, mdInst);
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
  const normalized = preprocessTables(
    preprocessQuotedBold(md.replace(/\r\n/g, "\n")),
    sharedRenderer
  );
  return sharedRenderer.render(normalized);
}
