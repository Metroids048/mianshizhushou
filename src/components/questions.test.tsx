import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPosition, createProfile, toWorkspace } from "../lib/interviewEngine";
import type { PositionMaterial } from "../types";
import { QuestionsWorkspace } from "./questions";

const importResumeFileMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/resumeImport", () => ({
  importResumeFile: importResumeFileMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

function buildQuestionWorkspace() {
  const profile = createProfile("测试候选人\nAI 产品经理\n项目经历\n做过题词卡与增长分析");
  const position = createPosition("岗位：AI 产品经理\n公司：腾讯\n负责面试产品和数据分析", profile);
  position.materials = [
    {
      id: "upload-1",
      kind: "upload",
      source: "upload",
      title: "项目复盘文档",
      detail: "详细记录 AI 文本能力项目的复盘过程",
      summary: "项目复盘文档",
      keywords: ["AI", "复盘"],
      tags: ["上传资料"],
      linkedQuestionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  position.questions = [
    {
      id: "manual-q-1",
      category: "项目深挖",
      question: "请介绍你做过的 AI 面试助手项目。",
      reason: "用户手动补充",
      evidenceIds: [],
      difficulty: "进阶",
      source: "manual",
      priority: true,
      notes: "重点追问",
      answer: "",
      cueCardIds: [],
      tags: ["用户保存"],
    },
    {
      id: "diag-q-1",
      category: "岗位动机",
      question: "为什么想做这个岗位？",
      reason: "JD 分析生成",
      evidenceIds: [],
      difficulty: "基础",
      source: "diagnosis",
      priority: false,
      notes: "",
      answer: "",
      cueCardIds: [],
      tags: [],
    },
  ];

  return { profile, position, workspace: toWorkspace(profile, position) };
}

describe("questions workspace", () => {
  it("prioritizes manual questions and keeps upload materials as the only material-entry path", async () => {
    const user = userEvent.setup();
    const { workspace, position } = buildQuestionWorkspace();
    const onUpdateQuestion = vi.fn();

    render(
      <QuestionsWorkspace
        workspace={workspace}
        position={position}
        onUpdateMaterials={vi.fn()}
        onUpdateQuestion={onUpdateQuestion}
        onAddQuestion={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
        onGoHome={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "文件解析为资料卡" })).toBeInTheDocument();
    expect(screen.queryByText("手动项目资料卡")).not.toBeInTheDocument();
    expect(screen.getAllByText("项目复盘文档").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /项目深挖/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /请介绍你做过的 AI 面试助手项目。/ }));
    await user.type(screen.getByLabelText("manual-q-1 答案"), "我负责题词卡、RAG 和模拟面试链路。");
    await user.type(screen.getByLabelText("manual-q-1 笔记"), "补充真实指标。");

    expect(onUpdateQuestion).toHaveBeenCalled();
  });

  it("records manual questions with optional answer and notes", async () => {
    const user = userEvent.setup();
    const { workspace, position } = buildQuestionWorkspace();
    const onAddQuestion = vi.fn();

    render(
      <QuestionsWorkspace
        workspace={workspace}
        position={position}
        onUpdateMaterials={vi.fn()}
        onUpdateQuestion={vi.fn()}
        onAddQuestion={onAddQuestion}
        isLoggedIn
        onRequireLogin={vi.fn()}
        onGoHome={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("问题分类"), "行为面");
    await user.type(screen.getByLabelText("新增问题"), "你在项目中是怎么推进协作的？");
    await user.type(screen.getByLabelText("问题答案"), "我先同步目标，再拆动作和节奏。");
    await user.type(screen.getByLabelText("问题笔记"), "注意补结果指标。");
    await user.click(screen.getByRole("button", { name: "记录问题" }));

    expect(onAddQuestion).toHaveBeenCalledWith({
      question: "你在项目中是怎么推进协作的？",
      category: "行为面",
      difficulty: "进阶",
      answer: "我先同步目标，再拆动作和节奏。",
      notes: "注意补结果指标。",
    });
  });

  it("removes uploaded materials from the current position", async () => {
    const user = userEvent.setup();
    const { workspace, position } = buildQuestionWorkspace();
    const onUpdateMaterials = vi.fn();

    render(
      <QuestionsWorkspace
        workspace={workspace}
        position={position}
        onUpdateMaterials={onUpdateMaterials}
        onUpdateQuestion={vi.fn()}
        onAddQuestion={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
        onGoHome={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "移除" }));

    expect(onUpdateMaterials).toHaveBeenCalledWith([] satisfies PositionMaterial[]);
  });

  it("shows parsing state while uploading material files", async () => {
    const user = userEvent.setup();
    const { workspace, position } = buildQuestionWorkspace();
    let resolveImport: (value: { text: string }) => void = () => {};
    importResumeFileMock.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));

    render(
      <QuestionsWorkspace
        workspace={workspace}
        position={position}
        onUpdateMaterials={vi.fn()}
        onUpdateQuestion={vi.fn()}
        onAddQuestion={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
        onGoHome={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("上传面试资料文件") as HTMLInputElement;
    await user.upload(input, new File(["资料内容"], "material.txt", { type: "text/plain" }));

    expect(screen.getAllByText("解析中...").length).toBeGreaterThan(0);
    expect(input).toBeDisabled();

    resolveImport({ text: "解析后的资料" });
    expect(await screen.findByText("已解析 material.txt，并保存为当前岗位的资料卡。")).toBeInTheDocument();
  });

  it("shows the login gate instead of mutating data for guests", async () => {
    const user = userEvent.setup();
    const { workspace, position } = buildQuestionWorkspace();
    const onRequireLogin = vi.fn();

    render(
      <QuestionsWorkspace
        workspace={workspace}
        position={position}
        onUpdateMaterials={vi.fn()}
        onUpdateQuestion={vi.fn()}
        onAddQuestion={vi.fn()}
        isLoggedIn={false}
        onRequireLogin={onRequireLogin}
        onGoHome={vi.fn()}
      />,
    );

    expect(screen.getByText("登录后继续")).toBeInTheDocument();
    await user.type(screen.getByLabelText("新增问题"), "游客也想记录一个问题");
    await user.click(screen.getByRole("button", { name: "记录问题" }));

    expect(onRequireLogin).toHaveBeenCalled();
  });
});
