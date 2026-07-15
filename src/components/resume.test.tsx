import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProfile } from "../lib/interviewEngine";
import { applyFullResumeSuggestionToDrafts } from "../lib/resumeSuggestions";
import { ResumeWorkspacePage } from "./resume";

const importResumeFileMock = vi.hoisted(() => vi.fn());
const runResumeAiOnServerMock = vi.hoisted(() => vi.fn());
const generateProfileHighlightsOnServerMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/resumeImport", () => ({
  importResumeFile: importResumeFileMock,
}));

vi.mock("../lib/apiClient", () => ({
  runResumeAiOnServer: runResumeAiOnServerMock,
  generateProfileHighlightsOnServer: generateProfileHighlightsOnServerMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("resume full apply", () => {
  it("maps structured full-resume suggestions back into matching sections", () => {
    const drafts = {
      basic: "张三",
      education: "本科",
      work: "原工作",
      projects: "原项目",
      highlights: "原亮点",
      skills: "SQL",
      extra: "原补充",
    };

    const next = applyFullResumeSuggestionToDrafts(
      [
        "亮点总结",
        "1. 负责增长策略和数据闭环。",
        "项目经历",
        "主导校园增长项目，首单转化率从 12% 提升到 19%。",
        "技能",
        "SQL、A/B 实验、增长漏斗分析。",
      ].join("\n"),
      [
        { id: "highlights", title: "亮点总结" },
        { id: "projects", title: "项目经历" },
        { id: "skills", title: "技能" },
      ],
      drafts,
    );

    expect(next.highlights).toContain("增长策略");
    expect(next.projects).toContain("首单转化率");
    expect(next.skills).toContain("A/B 实验");
  });

  it("falls back to highlights only when the full-resume suggestion is not section-structured", () => {
    const drafts = {
      basic: "张三",
      education: "本科",
      work: "原工作",
      projects: "原项目",
      highlights: "原亮点",
      skills: "SQL",
      extra: "原补充",
    };

    const next = applyFullResumeSuggestionToDrafts(
      "整份简历建议：先写结论，再补动作和结果。",
      [
        { id: "highlights", title: "亮点总结" },
        { id: "projects", title: "项目经历" },
      ],
      drafts,
    );

    expect(next.highlights).toContain("先写结论");
    expect(next.projects).toBe(drafts.projects);
  });

  it("shows evidence preview on the main resume workspace", () => {
    const profile = createProfile(
      [
        "测试候选人",
        "AI 产品经理",
        "项目经历",
        "校园增长项目",
        "- 负责增长策略和数据闭环，首单转化率从 12% 提升到 19%。",
        "技能",
        "SQL、A/B 实验、增长漏斗分析。",
      ].join("\n"),
    );

    render(
      <ResumeWorkspacePage
        profile={profile}
        onUpdateResume={vi.fn()}
        onUpdateEvidence={vi.fn()}
        onSetHighlights={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
      />,
    );

    expect(screen.getByText("AI 已识别证据")).toBeInTheDocument();
    expect(screen.getByText(`${profile.evidenceLibrary.length} 条`)).toBeInTheDocument();
    expect(screen.getByText("命中关键词：")).toBeInTheDocument();
  });

  it("shows parsing state while uploading a resume file", async () => {
    const user = userEvent.setup();
    const profile = createProfile("测试候选人\nAI 产品经理");
    let resolveImport: (value: { text: string }) => void = () => {};
    importResumeFileMock.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));

    render(
      <ResumeWorkspacePage
        profile={profile}
        onUpdateResume={vi.fn()}
        onUpdateEvidence={vi.fn()}
        onSetHighlights={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("上传简历文件") as HTMLInputElement;
    await user.upload(input, new File(["简历内容"], "resume.txt", { type: "text/plain" }));

    expect(screen.getAllByText("解析中...").length).toBeGreaterThan(0);
    expect(input).toBeDisabled();

    resolveImport({ text: "解析后的简历" });
    expect(await screen.findByText(/已导入 resume.txt/)).toBeInTheDocument();
  });

  it("renders AI suggestions without a raw preformatted code block", async () => {
    const user = userEvent.setup();
    const profile = createProfile("测试候选人\nAI 产品经理\n项目经历\n负责增长项目");
    runResumeAiOnServerMock.mockResolvedValue({
      reply: "可以这样改。",
      suggestion: "1. 先写结论\n2. 补充动作和结果",
      evidenceTrace: [],
      applyTarget: "section",
      meta: { backendStatus: "success", fallbackReason: "", evidenceTrace: [], latencyMs: 100 },
    });

    render(
      <ResumeWorkspacePage
        profile={profile}
        onUpdateResume={vi.fn()}
        onUpdateEvidence={vi.fn()}
        onSetHighlights={vi.fn()}
        isLoggedIn
        onRequireLogin={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "优化当前模块" }));

    expect(await screen.findByText("可以这样改。")).toBeInTheDocument();
    expect(screen.getByText("1. 先写结论")).toBeInTheDocument();
    expect(document.querySelector(".suggestion-box pre")).toBeNull();
  });
});
