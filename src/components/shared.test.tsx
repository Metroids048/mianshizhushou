import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiRunMeta } from "../lib/apiClient";
import type { AnswerCueCard } from "../types";
import { CueCardPanel } from "./shared";

describe("CueCardPanel", () => {
  it("shows core points first and renders evidence only once", () => {
    const card: AnswerCueCard = {
      id: "cue-1",
      questionText: "请介绍一个增长项目",
      createdAt: new Date().toISOString(),
      source: "live",
      strategy: "STAR",
      openingLine: "我会先说结论。",
      bullets: ["负责新用户激活", "用数据定位流失点"],
      evidenceIds: ["ev-1"],
      risks: ["不要编造指标"],
      followUps: ["如果数据不好怎么办"],
    };
    const meta: AiRunMeta = {
      backendStatus: "success",
      skillId: "cue",
      fallbackReason: "",
      promptId: "prompt",
      provider: "test",
      evidenceTrace: [{ id: "ev-1", title: "增长项目证据", reason: "匹配增长问题" }],
      latencyMs: 120,
      retrievalCount: 1,
      searchUsed: false,
    };

    render(<CueCardPanel card={card} meta={meta} onSaveQuestion={vi.fn()} />);

    const labels = screen.getAllByText(/核心要点|开场句|回答框架|证据命中|注意|追问预测/).map((item) => item.textContent);
    expect(labels).toEqual(["核心要点", "开场句", "回答框架", "证据命中", "注意", "追问预测"]);
    expect(screen.queryByText(/证据 ·/)).not.toBeInTheDocument();
    expect(within(screen.getByText("证据命中").closest("section") as HTMLElement).getByText("增长项目证据")).toBeInTheDocument();
  });
});
