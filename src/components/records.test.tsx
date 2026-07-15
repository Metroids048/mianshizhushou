import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createPosition, createProfile } from "../lib/interviewEngine";
import type { InterviewRecord, Position } from "../types";
import { RecordsView } from "./records";

function buildRecordsFixture(): { position: Position; records: InterviewRecord[] } {
  const profile = createProfile("测试候选人\nAI 产品经理\n项目经历\n负责题词卡、RAG、模拟面试链路");
  const position = createPosition("岗位：AI 产品经理\n公司：腾讯\n负责面试产品和增长分析", profile);
  const record: InterviewRecord = {
    id: "record-1",
    positionId: position.id,
    mode: "mock",
    title: "腾讯 · AI 产品经理",
    createdAt: new Date().toISOString(),
    transcript: [
      { role: "interviewer", text: "请介绍你做过的 AI 面试助手项目。" },
      { role: "candidate", text: "我负责题词卡、RAG 召回与回归验证。" },
      { role: "interviewer", text: "你怎么验证这套方案有效？" },
      { role: "candidate", text: "我看生成稳定性与真实资料命中率。" },
    ],
    cueCards: [
      {
        id: "card-1",
        questionText: "请介绍你做过的 AI 面试助手项目。",
        createdAt: new Date().toISOString(),
        source: "mock",
        strategy: "先给结论，再讲动作和结果",
        openingLine: "我做过一套 AI 面试助手。",
        bullets: ["背景", "动作", "结果"],
        evidenceIds: ["ev-1"],
        risks: ["不要空讲 AI"],
        followUps: ["怎么验证效果？"],
      },
    ],
    questionIds: ["q-1"],
    speechMetrics: [
      {
        charCount: 48,
        durationSec: 22,
        charsPerMinute: 131,
        fillerCount: 1,
        fillers: ["嗯"],
        comment: "节奏基本稳定",
      },
    ],
    report: {
      overallScore: 84,
      dimensions: {
        completeness: 82,
        relevance: 86,
        evidenceStrength: 83,
        structure: 85,
        riskControl: 80,
      },
      summary: "回答结构清晰，但还可以再补指标。",
      nextActions: ["补充可验证的数据结果", "把复盘结论前置"],
      improvementPoints: ["补充可验证的数据结果", "把复盘结论前置", "强调个人贡献边界"],
      source: "local",
    },
    summary: "回答结构清晰，但还可以再补指标。",
  };

  return { position, records: [record] };
}

describe("records view", () => {
  it("filters records, opens transcript on demand, and only saves a short question note back to questions", async () => {
    const user = userEvent.setup();
    const { position, records } = buildRecordsFixture();
    const onSaveQuestionNote = vi.fn();
    const onOpen = vi.fn();

    render(
      <RecordsView
        records={records}
        positions={[position]}
        activeRecordId={records[0].id}
        onOpen={onOpen}
        onMock={vi.fn()}
        onOpenQuestions={vi.fn()}
        onOpenResume={vi.fn()}
        onOpenJd={vi.fn()}
        onSaveQuestionNote={onSaveQuestionNote}
      />,
    );

    expect(screen.getByRole("heading", { name: "模拟练习记录" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("按模式筛选"), "mock");
    await user.selectOptions(screen.getByLabelText("按岗位筛选"), position.id);
    await user.click(screen.getByRole("button", { name: /腾讯 · AI 产品经理/ }));

    expect(onOpen).toHaveBeenCalledWith(records[0].id);

    await user.click(screen.getByRole("button", { name: "查看完整 Transcript ›" }));
    expect(screen.getAllByText("我负责题词卡、RAG 召回与回归验证。").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "下次练习建议" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "一键沉淀到问题记录" }));

    expect(onSaveQuestionNote).toHaveBeenCalledWith({
      question: "请介绍你做过的 AI 面试助手项目。",
      notes: "补充可验证的数据结果；把复盘结论前置",
    });
  });

  it("supports re-practice and cross-page follow-up actions from the report page", async () => {
    const user = userEvent.setup();
    const { position, records } = buildRecordsFixture();
    const onMock = vi.fn();
    const onOpenQuestions = vi.fn();
    const onOpenResume = vi.fn();
    const onOpenJd = vi.fn();

    render(
      <RecordsView
        records={records}
        positions={[position]}
        activeRecordId={records[0].id}
        onOpen={vi.fn()}
        onMock={onMock}
        onOpenQuestions={onOpenQuestions}
        onOpenResume={onOpenResume}
        onOpenJd={onOpenJd}
        onSaveQuestionNote={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "再练一次" }));
    await user.click(screen.getByRole("button", { name: "去问题记录" }));
    await user.click(screen.getByRole("button", { name: "去简历补证据" }));
    await user.click(screen.getByRole("button", { name: "去 JD 分析看差距" }));

    expect(onMock).toHaveBeenCalledTimes(1);
    expect(onOpenQuestions).toHaveBeenCalledTimes(1);
    expect(onOpenResume).toHaveBeenCalledTimes(1);
    expect(onOpenJd).toHaveBeenCalledTimes(1);
  });

  it("shows filter-empty copy when current filters have no matching records", async () => {
    const user = userEvent.setup();
    const { position, records } = buildRecordsFixture();

    render(
      <RecordsView
        records={records}
        positions={[position]}
        activeRecordId={records[0].id}
        onOpen={vi.fn()}
        onMock={vi.fn()}
        onOpenQuestions={vi.fn()}
        onOpenResume={vi.fn()}
        onOpenJd={vi.fn()}
        onSaveQuestionNote={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("按模式筛选"), "live");
    expect(screen.getByText("暂无符合条件的记录")).toBeInTheDocument();
    expect(screen.getByText("当前筛选条件下没有记录，可以切换类型或选择全部岗位。")).toBeInTheDocument();
    expect(screen.getAllByText("暂无符合条件的记录")).toHaveLength(1);
  });
});
