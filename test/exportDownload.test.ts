import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  collectOriginRefs,
  sanitizeSessionFileName,
} from "../extension/src/export/collectOriginRefs";
import { buildTranscriptJumpHref } from "../extension/src/export/exportPackage";
import {
  anchorForTurnIndex,
  renderTranscriptMarkdown,
} from "../extension/src/export/renderTranscriptMarkdown";
import { markdownToTranscriptHtmlBody } from "../extension/src/export/renderTranscriptHtml";
import { buildTopicMindMap } from "../extension/src/mindmap/buildTopicMindMap";
import { validateTopicGraph } from "../extension/src/llm/topicGraphValidate";
import type { SessionMeta } from "../extension/src/mindmap/origin";
import { parseJsonl } from "../extension/src/transcript/parseJsonl";

describe("renderTranscriptMarkdown", () => {
  it("adds anchors and maps turn indices to display Q numbers", () => {
    const fixture = readFileSync(
      join(__dirname, "fixtures/sample.jsonl"),
      "utf8"
    );
    const events = parseJsonl(fixture);
    const rendered = renderTranscriptMarkdown(events, "Sample");

    expect(rendered.markdown).toContain('<a id="q-1"></a>');
    expect(rendered.markdown).toContain("## Q1");
    expect(rendered.turnIndexToDisplayQ.get(0)).toBe(1);
    expect(anchorForTurnIndex(0, rendered.turnIndexToDisplayQ)).toBe("q-1");
  });
});

describe("collectOriginRefs", () => {
  it("dedupes sessions from the mind map tree", () => {
    const meta: SessionMeta = {
      sessionId: "sess-a",
      projectSlug: "proj",
      sessionLabel: "A",
      transcriptPath: "/tmp/A.jsonl",
    };
    const root = buildTopicMindMap(
      validateTopicGraph({
        title: "t",
        topics: [
          {
            title: "Topic",
            items: [{ text: "item", sourceTurnIndices: [0] }],
          },
        ],
      }),
      "A",
      meta
    );
    const refs = collectOriginRefs(root);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sessionId).toBe("sess-a");
  });
});

describe("sanitizeSessionFileName", () => {
  it("replaces unsafe characters", () => {
    expect(sanitizeSessionFileName("abc/def")).toBe("abc_def");
  });

  it("produces safe html file base names", () => {
    const base = sanitizeSessionFileName("abc/def");
    expect(`transcripts/${base}.html`).toBe("transcripts/abc_def.html");
  });
});

describe("markdownToTranscriptHtmlBody", () => {
  it("preserves anchors and headings", () => {
    const md = [
      "# Title",
      "",
      '<a id="q-1"></a>',
      "## Q1",
      "",
      "> question",
      "",
      "### A1",
      "",
      "answer",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain('<a id="q-1"></a>');
    expect(html).toContain("<h2>Q1</h2>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<h3>A1</h3>");
  });

  it("renders inline code", () => {
    const html = markdownToTranscriptHtmlBody(
      "正常开机在 `on late-init` 里会 `trigger zygote-start`："
    );
    expect(html).toContain("<code>on late-init</code>");
    expect(html).toContain("<code>trigger zygote-start</code>");
    expect(html).not.toContain("`on late-init`");
  });

  it("renders GFM tables", () => {
    const md = [
      "| 步骤 | 说明 |",
      "|------|------|",
      "| a | b |",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("步骤");
  });

  it("renders pipe tables without separator row", () => {
    const md = [
      "| 问题 | 答案 |",
      "| **何时启动** | `init` 启动 |",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>何时启动</strong>");
    expect(html).toContain("<code>init</code>");
    expect(html).not.toContain("**何时启动**");
  });

  it("renders tab-separated tables with inline markdown", () => {
    const md = [
      "问题\t答案",
      "**何时启动**\t`init` 在 `logd`/`lmkd` 后 `start servicemanager`",
      "**与 Binder 关系**\t`ioctl(BINDER_SET_CONTEXT_MGR*)` 在内核登记",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>问题</th>");
    expect(html).toContain("<strong>何时启动</strong>");
    expect(html).toContain("<code>init</code>");
    expect(html).toContain("servicemanager");
    expect(html).not.toContain("**何时启动**");
  });

  it("renders fenced code blocks", () => {
    const md = ["```javascript", "const x = 1;", "```"].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("renders Cursor citation fences with file header", () => {
    const md = [
      "```1071:1078:system/core/rootdir/init.rc",
      "on zygote-start && property:ro.crypto.state=unencrypted",
      "    start zygote",
      "```",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain('class="code-citation"');
    expect(html).toContain('class="code-citation-header"');
    expect(html).toContain("system/core/rootdir/init.rc");
    expect(html).toContain("L1071");
    expect(html).toContain("1078");
    expect(html).toContain("<pre>");
    expect(html).toContain("start zygote");
  });

  it("renders bold wrapped in ASCII quotes (Binder summary line)", () => {
    const md =
      'Binder 用字符设备，是因为在 Linux 里**"可打开的文件描述符 + ioctl 控制 + mmap 共享内存 + poll 等待"** 这套 IPC 门面，就是字符设备（misc/binderfs）提供的；';
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<strong>");
    expect(html).toContain("可打开的文件描述符");
    expect(html).not.toContain("**可打开");
    expect(html).not.toContain('**"可打开');
  });

  it("renders bold wrapped in curly quotes", () => {
    const md =
      "在 Linux 里**“可打开的文件描述符 + ioctl 控制 + mmap 共享内存 + poll 等待”** 这套";
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<strong>");
    expect(html).toContain("可打开的文件描述符");
    expect(html).not.toContain("**可打开");
    expect(html).not.toContain("**“可打开");
  });

  it("does not alter quoted bold inside fenced code", () => {
    const md = ["```", '**"literal"**', "```"].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain("<pre>");
    expect(html).toContain("literal");
    expect(html).not.toContain("<strong>");
  });

  it("does not turn tab-indented C struct in citation fence into a table", () => {
    const md = [
      "```6751:6760:kernel-6.1/drivers/android/binder.c",
      "const struct file_operations binder_fops = {",
      "\t.owner = THIS_MODULE,",
      "\t.poll = binder_poll,",
      "\t.unlocked_ioctl = binder_ioctl,",
      "\t.mmap = binder_mmap,",
      "\t.open = binder_open,",
      "};",
      "```",
    ].join("\n");
    const html = markdownToTranscriptHtmlBody(md);
    expect(html).toContain('class="code-citation"');
    expect(html).toContain("binder_fops");
    expect(html).toContain(".owner = THIS_MODULE");
    expect(html).not.toContain("<table>");
    expect(html).not.toContain("<td>.poll = binder_poll");
  });
});

describe("buildTranscriptJumpHref", () => {
  it("points to pre-rendered html with anchor fragment", () => {
    const turnMap = new Map([[0, 1], [1, 2]]);
    expect(
      buildTranscriptJumpHref("transcripts/sess.html", 0, turnMap)
    ).toBe("transcripts/sess.html#q-1");
    expect(
      buildTranscriptJumpHref("transcripts/sess.html", 1, turnMap)
    ).toBe("transcripts/sess.html#q-2");
    expect(
      buildTranscriptJumpHref("transcripts/sess.html", undefined, turnMap)
    ).toBe("transcripts/sess.html");
  });
});
