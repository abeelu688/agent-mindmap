import { describe, expect, it } from "vitest";
import {
  findBestTurnIndex,
  isMetaSearchUserQuery,
  parseQTagsFromNodeLabel,
} from "../extension/src/jumpToOriginCore";

describe("isMetaSearchUserQuery", () => {
  it("detects cursor transcript search prompts", () => {
    expect(
      isMetaSearchUserQuery(
        "Search through my recent agent transcripts to find conversations about: JIT是什么"
      )
    ).toBe(true);
  });

  it("allows normal technical questions", () => {
    expect(isMetaSearchUserQuery("JIT是什么")).toBe(false);
  });
});

describe("parseQTagsFromNodeLabel", () => {
  it("parses single and combined Q tags", () => {
    expect(parseQTagsFromNodeLabel("JIT 全称 (Q1/Q3)")).toEqual([0, 2]);
    expect(parseQTagsFromNodeLabel("foo (Q3)")).toEqual([2]);
  });
});

describe("findBestTurnIndex", () => {
  const queries = [
    "我之前用art的Instrumentation钩子",
    "所有 Java 方法强制走 解释器",
    "DeoptimizeEverything 我调用的这个",
    "解释器执行，就是按照dex文件",
    "执行method的流程，整理一下",
    "JIT是什么",
    "OAT全称是什么",
  ];

  it("matches JIT leaf text to JIT是什么 turn", () => {
    expect(
      findBestTurnIndex(queries, "JIT 全称 Just-In-Time compilation，运行时编译 (Q1/Q3)")
    ).toBe(5);
  });

  it("matches dex interpreter question", () => {
    expect(
      findBestTurnIndex(queries, "解释器执行 DEX CodeItem 指令 (Q4)")
    ).toBe(3);
  });
});
