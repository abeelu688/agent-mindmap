import {
  escHtml,
  renderTranscriptMarkdownHtml,
  TRANSCRIPT_MARKDOWN_STYLES,
} from "./renderTranscriptMarkdownHtml";

export { escHtml };

export const TRANSCRIPT_PAGE_STYLES = TRANSCRIPT_MARKDOWN_STYLES;

/** Render export transcript markdown to HTML body (full Markdown). */
export function markdownToTranscriptHtmlBody(md: string): string {
  return renderTranscriptMarkdownHtml(md);
}

export function buildTranscriptPageHtml(
  title: string,
  bodyHtml: string,
  scrollAnchorId?: string
): string {
  const safeTitle = escHtml(title);
  const scrollScript =
    scrollAnchorId && /^[a-zA-Z0-9_-]+$/.test(scrollAnchorId)
      ? `<script>requestAnimationFrame(function(){var el=document.getElementById("${scrollAnchorId}");if(el)el.scrollIntoView({block:"start"});});</script>`
      : "";
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
  ${scrollScript}
</body>
</html>`;
}
