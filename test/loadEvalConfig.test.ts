import { describe, expect, it } from "vitest";
import {
  loadEvalConfig,
  filterSessionIds,
  resolveEvalPaths,
} from "../extension/src/eval/loadEvalConfig";

describe("loadEvalConfig", () => {
  it("loads default config from repo root", async () => {
    const repoRoot = import.meta.dirname;
    const { config, paths } = await loadEvalConfig(repoRoot);
    expect(config.fixtureSet).toBe("aosp14");
    expect(paths.manifestPath).toMatch(/manifest\.json$/);
  });

  it("resolves paths from eval config example", () => {
    const repoRoot = import.meta.dirname;
    const paths = resolveEvalPaths(repoRoot, {
      useFixtureTranscripts: true,
      fixtureSet: "aosp14",
      projectSlug: "home-example-cursor-aosp14",
      projectPath: "/home/example/cursor/aosp14",
      sessionFilter: "all",
      llmProvider: "cursor-cli",
      promptParams: { maxTopics: 12, maxItemsPerTopic: 6 },
      writeReport: true,
      compareBaseline: true,
    });
    expect(paths.manifestPath).toMatch(/aosp14.*manifest\.json$/);
    expect(paths.evalDir).toMatch(/test[/\\]eval$/);
  });
});

describe("filterSessionIds", () => {
  it("returns all ids when sessionFilter is 'all'", () => {
    const config = {
      useFixtureTranscripts: true,
      fixtureSet: "aosp14",
      projectSlug: "p",
      projectPath: "/p",
      sessionFilter: "all" as const,
      llmProvider: "cursor-cli" as const,
      promptParams: { maxTopics: 12, maxItemsPerTopic: 6 },
      writeReport: true,
      compareBaseline: true,
    };
    const result = filterSessionIds(config, ["a", "b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("filters to the intersection when sessionFilter is a list", () => {
    const config = {
      useFixtureTranscripts: true,
      fixtureSet: "aosp14",
      projectSlug: "p",
      projectPath: "/p",
      sessionFilter: ["a"] as string[],
      llmProvider: "cursor-cli" as const,
      promptParams: { maxTopics: 12, maxItemsPerTopic: 6 },
      writeReport: true,
      compareBaseline: true,
    };
    const result = filterSessionIds(config, ["a", "b"]);
    expect(result).toEqual(["a"]);
  });
});
