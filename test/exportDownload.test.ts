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
