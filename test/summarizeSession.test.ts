import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { summarizeSession } from "../extension/src/llm/summarizeSession";
import {
  LlmProviderError,
  type LlmProvider,
  type SummarizeInput,
  type TopicGraph,
} from "../extension/src/llm/types";
import type { ChatEvent } from "../extension/src/transcript/types";

const events: ChatEvent[] = [
  { kind: "user_query", text: "How does binder work?", lineIndex: 0 },
  {
    kind: "tool",
    name: "Grep",
    label: "Grep: binder_transaction",
    lineIndex: 1,
  },
  {
    kind: "assistant_summary",
    text: "## Conclusion\n\nThe code lives in tr.code",
    preview: "The code lives in tr.code",
    lineIndex: 2,
  },
];

const goodGraph: TopicGraph = {
  topics: [
    {
      title: "Binder",
      items: [{ text: "tr.code" }],
    },
  ],
};

class FakeProvider implements LlmProvider {
  public readonly id = "fake";
  public calls = 0;
  constructor(
    private readonly impl: (
      input: SummarizeInput
    ) => Promise<TopicGraph> | TopicGraph
  ) {}
  async summarize(input: SummarizeInput): Promise<TopicGraph> {
    this.calls += 1;
    return this.impl(input);
  }
}

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "agent-mindmap-test-"));
});

afterEach(() => {
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("summarizeSession", () => {
  it("returns provider output on happy path", async () => {
    const provider = new FakeProvider(() => goodGraph);
    const out = await summarizeSession(
      events,
      {
        prompt: { maxTopics: 6, maxItemsPerTopic: 6 },
        cacheDir,
        cache: false,
      },
      provider,
      new AbortController().signal
    );
    expect(out.topics[0].title).toBe("Binder");
    expect(provider.calls).toBe(1);
  });

  it("includes the assembled prompt with [Q1]/[A1] markers", async () => {
    let receivedPrompt = "";
    const provider = new FakeProvider((input) => {
      receivedPrompt = input.prompt;
      return goodGraph;
    });
    await summarizeSession(
      events,
      {
        prompt: { maxTopics: 6, maxItemsPerTopic: 6 },
        cache: false,
      },
      provider,
      new AbortController().signal
    );
    expect(receivedPrompt).toContain("[Q1]");
    expect(receivedPrompt).toContain("[A1]");
    expect(receivedPrompt).toContain("How does binder work?");
  });

  it("propagates provider errors (e.g. bad JSON)", async () => {
    const provider = new FakeProvider(() => {
      throw new LlmProviderError("bad-json", "expected JSON");
    });
    await expect(
      summarizeSession(
        events,
        { prompt: { maxTopics: 6, maxItemsPerTopic: 6 }, cache: false },
        provider,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "bad-json" });
  });

  it("does not call provider on cache hit", async () => {
    const provider = new FakeProvider(() => goodGraph);
    const opts = {
      prompt: { maxTopics: 6, maxItemsPerTopic: 6 },
      cacheDir,
      cache: true,
    };
    await summarizeSession(events, opts, provider, new AbortController().signal);
    expect(provider.calls).toBe(1);
    await summarizeSession(events, opts, provider, new AbortController().signal);
    expect(provider.calls).toBe(1); // second call served from disk
  });

  it("misses cache when prompt options change", async () => {
    const provider = new FakeProvider(() => goodGraph);
    await summarizeSession(
      events,
      {
        prompt: { maxTopics: 6, maxItemsPerTopic: 6 },
        cacheDir,
        cache: true,
      },
      provider,
      new AbortController().signal
    );
    await summarizeSession(
      events,
      {
        prompt: { maxTopics: 4, maxItemsPerTopic: 6 },
        cacheDir,
        cache: true,
      },
      provider,
      new AbortController().signal
    );
    expect(provider.calls).toBe(2);
  });

  it("throws empty when events are empty", async () => {
    const provider = new FakeProvider(() => goodGraph);
    await expect(
      summarizeSession(
        [],
        { prompt: { maxTopics: 6, maxItemsPerTopic: 6 }, cache: false },
        provider,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "empty" });
  });
});
