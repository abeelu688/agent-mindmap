import { describe, expect, it } from "vitest";
import {
  renderTranscriptMarkdownHtml,
  escHtml,
} from "../extension/src/export/renderTranscriptMarkdownHtml";

describe("sanitizeTranscriptHtml (via renderTranscriptMarkdownHtml)", () => {
  it("strips <script> tags", () => {
    const md = 'Hello <script>alert("xss")</script> world';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("strips self-closing <script> tags", () => {
    const md = 'Text <script src="evil.js"/> more';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("<script");
  });

  it("strips <iframe> tags", () => {
    const md = '<iframe src="https://evil.com"></iframe>';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("<iframe");
  });

  it("strips <object> and <embed> tags", () => {
    const md = '<object data="x"><embed src="y"></object>';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<embed");
  });

  it("strips <form> tags", () => {
    const md = '<form action="https://evil.com"><input type="submit"/></form>';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("<form");
  });

  it("strips on* event handler attributes", () => {
    const md = '<img src="x" onerror="alert(1)">';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("onerror");
  });

  it("blocks javascript: protocol in links", () => {
    const md = "[click me](javascript:alert(1))";
    const html = renderTranscriptMarkdownHtml(md);
    // markdown-it already doesn't render javascript: links as <a> tags,
    // and the sanitizer ensures any raw <a href="javascript:..."> is neutralized
    expect(html).not.toMatch(/<a[^>]+href\s*=\s*"[^"]*javascript:/i);
  });

  it("blocks data: protocol in links", () => {
    const md = "[click](data:text/html,<script>alert(1)</script>)";
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toMatch(/<a[^>]+href\s*=\s*"[^"]*data:/i);
  });

  it("blocks javascript: in raw HTML anchor tags", () => {
    const md = '<a href="javascript:alert(1)">click</a>';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toMatch(/href\s*=\s*"[^"]*javascript:/i);
  });

  it("allows http/https/mailto links", () => {
    const md = "[site](https://example.com) [mail](mailto:a@b.com)";
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).toContain("https://example.com");
    expect(html).toContain("mailto:a@b.com");
  });

  it("allows normal markdown content unaffected", () => {
    const md = "# Hello\n\nThis is **bold** and *italic* text.\n\n- item 1\n- item 2";
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<li>");
  });

  it("strips dangerous CSS in style attributes", () => {
    const md = '<div style="background: expression(alert(1))">test</div>';
    const html = renderTranscriptMarkdownHtml(md);
    expect(html).not.toContain("expression(");
  });
});

describe("escHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escHtml('<script>"a&b"</script>')).toBe(
      "&lt;script&gt;&quot;a&amp;b&quot;&lt;/script&gt;"
    );
  });
});
