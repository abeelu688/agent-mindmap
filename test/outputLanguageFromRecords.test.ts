import { describe, expect, it } from "vitest";
import { outputLanguageFromRecords } from "../extension/src/llm/outputLanguageFromRecords";
import { buildRecordMeta, buildSessionRecord, sha256Hex } from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";

function record(sessionId: string, outputLanguage?: string) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "proj-a",
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: sessionId,
      outputLanguage,
    }),
    topicGraphToOutline({
      topics: [{ title: "t", conceptPath: ["a"], items: [{ text: "x" }] }],
    })
  );
}

describe("outputLanguageFromRecords", () => {
  it("defaults to English when no session has outputLanguage", () => {
    expect(outputLanguageFromRecords([record("s1"), record("s2")])).toBe("English");
  });

  it("returns undefined when explicitly given no default and no votes", () => {
    expect(
      outputLanguageFromRecords([record("s1"), record("s2")], { defaultLanguage: undefined })
    ).toBeUndefined();
  });

  it("picks the language with the most votes", () => {
    const records = [
      record("s1", "English"),
      record("s2", "Chinese"),
      record("s3", "Chinese"),
    ];
    expect(outputLanguageFromRecords(records)).toBe("Chinese");
  });

  it("breaks ties toward the latest session index", () => {
    const records = [
      record("s1", "English"),
      record("s2", "Chinese"),
      record("s3", "English"),
    ];
    expect(outputLanguageFromRecords(records)).toBe("English");
  });

  it("honors an explicit default when there are no votes", () => {
    expect(outputLanguageFromRecords([record("s1")], { defaultLanguage: "Japanese" })).toBe(
      "Japanese"
    );
  });
});
