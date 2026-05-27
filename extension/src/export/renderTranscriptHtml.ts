const TRANSCRIPT_PAGE_STYLES = `
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
`;

function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Render export transcript markdown to HTML body (anchors and headings preserved). */
export function markdownToTranscriptHtmlBody(md: string): string {
  const lines = md.replaceAll("\r", "").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];

  const flushPara = () => {
    if (!para.length) {
      return;
    }
    out.push("<p>" + escHtml(para.join("\n")) + "</p>");
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) {
      return;
    }
    out.push(
      "<blockquote><p>" + escHtml(quote.join("\n")) + "</p></blockquote>"
    );
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const anchor = line.match(/^<a\s+id="([^"]+)"\s*><\/a>$/i);
    if (anchor) {
      flushPara();
      flushQuote();
      out.push('<a id="' + escHtml(anchor[1]!) + '"></a>');
      continue;
    }
    if (!line) {
      flushPara();
      flushQuote();
      continue;
    }
    if (line.startsWith("### ")) {
      flushPara();
      flushQuote();
      out.push("<h3>" + escHtml(line.slice(4)) + "</h3>");
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushQuote();
      out.push("<h2>" + escHtml(line.slice(3)) + "</h2>");
      continue;
    }
    if (line.startsWith("# ")) {
      flushPara();
      flushQuote();
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
  flushPara();
  flushQuote();
  return out.join("\n");
}

export function buildTranscriptPageHtml(
  title: string,
  bodyHtml: string
): string {
  const safeTitle = escHtml(title);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>${TRANSCRIPT_PAGE_STYLES}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}
