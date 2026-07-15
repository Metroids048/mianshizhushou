import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createPosition, createProfile } from "../lib/interviewEngine";
import type { InterviewConfig } from "./sharedConfig";
import { HomeDashboard, MockPositionListPage, MockSetupPage, PositionConversationPage, PositionDetailPage } from "./positions";

function buildPosition() {
  const profile = createProfile("测试候选人\nAI 产品经理\n项目经历\n负责增长分析与面试产品优化");
  return createPosition("岗位：AI 产品经理\n公司：腾讯\n面试官：业务负责人\n时长：45 分钟\n负责增长与数据分析", profile);
}

describe("positions pages", () => {
  it("keeps the home first screen focused on input and primary actions", () => {
    const position = buildPosition();

    render(
      <HomeDashboard
        positions={[position]}
        activePositionId={position.id}
        onSubmitJd={vi.fn()}
        onOpenMockList={vi.fn()}
        onOpenLive={vi.fn()}
        onRequireLogin={vi.fn()}
        isLoggedIn
      />,
    );

    expect(screen.getByRole("heading", { name: "告诉 AI 你想面试的岗位" })).toBeInTheDocument();
    expect(screen.getByLabelText("首页主输入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /上传 JD/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "已保存岗位" })).not.toBeInTheDocument();
    expect(screen.getAllByText("当前岗位").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "进入实时助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入模拟面试" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "最近岗位" })).not.toBeInTheDocument();
  });

  it("does not mark a newly created position as practiced before real turns exist", () => {
    const position = buildPosition();

    render(
      <HomeDashboard
        positions={[position]}
        activePositionId={position.id}
        onSubmitJd={vi.fn()}
        onOpenMockList={vi.fn()}
        onOpenLive={vi.fn()}
        onRequireLogin={vi.fn()}
        isLoggedIn
      />,
    );

    expect(screen.getAllByText("待配置").length).toBeGreaterThan(0);
    expect(screen.queryByText("已练习")).not.toBeInTheDocument();
  });

  it("does not show the removed repeated home prompt pills", () => {
    render(
      <HomeDashboard
        positions={[]}
        activePositionId=""
        onSubmitJd={vi.fn()}
        onOpenMockList={vi.fn()}
        onOpenLive={vi.fn()}
        onRequireLogin={vi.fn()}
        isLoggedIn
      />,
    );

    expect(screen.queryByLabelText("首页新手引导")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "先放一整段 JD 或面试背景" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /我有一场 AI 产品运营实习面试/ })).not.toBeInTheDocument();
  });

  it("drives position detail actions with the full detail page instead of a drawer", async () => {
    const user = userEvent.setup();
    const position = buildPosition();
    const onContinueConversation = vi.fn();
    const onOpenMockSetup = vi.fn();
    const onDelete = vi.fn();
    const onBackHome = vi.fn();

    render(
      <PositionDetailPage
        position={position}
        onContinueConversation={onContinueConversation}
        onOpenMockSetup={onOpenMockSetup}
        onDelete={onDelete}
        onBackHome={onBackHome}
      />,
    );

    expect(screen.getByRole("heading", { name: "腾讯 · AI 产品经理" })).toBeInTheDocument();
    expect(screen.getByText("JD 与岗位信息")).toBeInTheDocument();
    expect(screen.getByText("面试配置与开始练习")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "继续完善对话" }));
    await user.click(screen.getByRole("button", { name: "去模拟配置" }));
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    await user.click(screen.getByRole("button", { name: "删除岗位" }));

    expect(onContinueConversation).toHaveBeenCalledTimes(1);
    expect(onOpenMockSetup).toHaveBeenCalledTimes(1);
    expect(onBackHome).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("auto-saves conversation inputs against the current position and offers both exits", async () => {
    const user = userEvent.setup();
    const position = buildPosition();
    const onSubmitMessage = vi.fn();
    const onOpenMockSetup = vi.fn();
    const onOpenDetail = vi.fn();

    render(
      <PositionConversationPage
        position={position}
        onSubmitMessage={onSubmitMessage}
        onOpenMockSetup={onOpenMockSetup}
        onOpenDetail={onOpenDetail}
      />,
    );

    await user.type(screen.getByLabelText("岗位完善输入"), "补充：这是业务负责人二面");
    await user.click(screen.getByRole("button", { name: "继续完善并自动保存" }));

    expect(onSubmitMessage).toHaveBeenCalledWith(
      "补充：这是业务负责人二面",
      expect.objectContaining({
        positionId: position.id,
        confirmedFields: position.intake.confirmedFields.map((field) => ({ key: field.key, value: field.value, source: field.source })),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", text: "补充：这是业务负责人二面" }),
        ]),
      }),
    );

    await user.click(screen.getByRole("button", { name: "去模拟配置" }));
    await user.click(screen.getByRole("button", { name: "返回岗位详情" }));

    expect(onOpenMockSetup).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("uses the mock position list as the first step and shows an empty state when no positions exist", () => {
    render(<MockPositionListPage positions={[]} onSelectPosition={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "先选择一个岗位" })).toBeInTheDocument();
    expect(screen.getByText("还没有岗位卡")).toBeInTheDocument();
  });

  it("keeps only the meaningful mock setup fields and starts with saved config", async () => {
    const user = userEvent.setup();
    const position = buildPosition();
    const onStart = vi.fn();

    position.mockTurns = [{ questionId: "q-1", answer: "已有练习", score: 80, feedback: "ok" }];

    render(<MockSetupPage position={position} onStart={onStart} />);

    expect(screen.getByRole("heading", { name: "腾讯 · AI 产品经理" })).toBeInTheDocument();
    expect(screen.queryByLabelText("题数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("计时")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "面试官角色" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "难度" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "风格" })).toBeInTheDocument();
    expect(screen.getByText("更多设置").closest("details")).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "CTO" }));
    await user.click(screen.getByRole("button", { name: "强压面" }));
    await user.click(screen.getByRole("button", { name: "连续追问" }));
    await user.click(screen.getByText("更多设置"));
    expect(screen.getByLabelText("面试官性别")).toBeInTheDocument();
    expect(screen.getByLabelText("提交方式")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("面试官性别"), "男");
    await user.selectOptions(screen.getByLabelText("提交方式"), "auto");
    await user.click(screen.getByRole("button", { name: "保存配置并进入练习" }));

    expect(onStart).toHaveBeenCalledWith({
      interviewerRole: "CTO",
      difficulty: "地狱面",
      style: "pressure",
      interviewerGender: "男",
      submitMode: "auto",
    } satisfies InterviewConfig);
  });
});
