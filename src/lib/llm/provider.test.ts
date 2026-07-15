import { describe, expect, it } from "vitest";
import { extractJson } from "./provider";

describe("extractJson", () => {
  it("parses a fenced json object", () => {
    const text = "下面是结果：\n```json\n{\"score\": 88, \"feedback\": \"不错\"}\n```\n";
    expect(extractJson(text)).toEqual({ score: 88, feedback: "不错" });
  });

  it("parses a raw json object surrounded by prose", () => {
    expect(extractJson('结果 {"a": 1, "b": [2, 3]} 完毕')).toEqual({ a: 1, b: [2, 3] });
  });

  it("parses a json array", () => {
    expect(extractJson('[{"x": 1}]')).toEqual([{ x: 1 }]);
  });

  it("throws when no json is present", () => {
    expect(() => extractJson("没有可解析的内容")).toThrow();
  });
});
