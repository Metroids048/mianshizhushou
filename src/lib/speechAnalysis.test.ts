import { describe, expect, it } from "vitest";
import { analyzeSpeech } from "./speechAnalysis";

describe("speechAnalysis", () => {
  it("calculates pace and filler words", () => {
    const result = analyzeSpeech("嗯 我负责用户访谈，然后就推动转化率提升到 19%", 30);

    expect(result.charCount).toBeGreaterThan(10);
    expect(result.charsPerMinute).toBeGreaterThan(0);
    expect(result.fillerCount).toBeGreaterThanOrEqual(2);
    expect(result.comment).toContain("口头禅");
  });

  it("detects fast speech pace above 320 cpm", () => {
    // 约 55 字 / 8 秒 ≈ 412 cpm > 320，应提示语速偏快
    const text = "我负责过AI产品的从零到一建设包括用户研究需求分析产品设计增长实验和数据验证最终把首次练习完成率提升了三十二个百分点";
    const result = analyzeSpeech(text, 8);

    expect(result.charsPerMinute).toBeGreaterThan(320);
    expect(result.comment).toContain("偏快");
  });

  it("detects slow speech pace below 150 cpm", () => {
    // 少字 / 长时长 → 低 cpm，应提示语速偏慢
    const result = analyzeSpeech("我做过一个项目", 30);

    expect(result.charsPerMinute).toBeLessThan(150);
    expect(result.charsPerMinute).toBeGreaterThan(0);
    expect(result.comment).toContain("偏慢");
  });

  it("prompts voice input when duration is zero", () => {
    const result = analyzeSpeech("一段回答文本", 0);

    expect(result.charsPerMinute).toBe(0);
    expect(result.comment).toContain("语音作答");
  });

  it("counts multiple filler words and warns when above threshold", () => {
    const result = analyzeSpeech("嗯 啊 嗯 那个然后就就是说", 20);

    expect(result.fillerCount).toBeGreaterThanOrEqual(4);
    expect(result.comment).toContain("口头禅偏多");
    expect(result.fillers.length).toBeGreaterThan(0);
  });

  it("reports no filler words for clean speech", () => {
    const result = analyzeSpeech("我负责过AI面试产品的用户增长", 20);

    expect(result.fillerCount).toBe(0);
    expect(result.fillers).toEqual([]);
    expect(result.comment).not.toContain("口头禅");
  });

  it("handles very long transcript without breaking", () => {
    const long = "我负责产品".repeat(100);
    const result = analyzeSpeech(long, 60);

    expect(result.charCount).toBeGreaterThan(400);
    expect(result.charsPerMinute).toBeGreaterThan(0);
  });
});
