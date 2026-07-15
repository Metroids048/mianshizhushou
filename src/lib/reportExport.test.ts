import { describe, expect, it } from "vitest";
import { buildInterviewReport, createWorkspaceState, evaluateMockTurn } from "./interviewEngine";
import { buildReportJson, buildReportMarkdown } from "./reportExport";

describe("reportExport", () => {
  it("exports markdown and json with match score, questions, answers and next actions", () => {
    const workspace = createWorkspaceState();
    const question = workspace.questions[0];
    const answer = workspace.answers[0];
    const turn = evaluateMockTurn(
      question,
      "背景是校园项目。我的任务是提升转化，动作包括访谈用户和设计提醒，结果是首单转化率从 12% 提升到 19%。",
      answer,
    );
    const readyWorkspace = {
      ...workspace,
      mockTurns: [turn],
      report: buildInterviewReport([turn], workspace.questions, workspace.matchReport),
    };

    const markdown = buildReportMarkdown(readyWorkspace);
    const json = JSON.parse(buildReportJson(readyWorkspace)) as { matchReport: { score: number }; mockTurns: Array<{ answer: string }> };

    expect(markdown).toContain("岗位匹配分");
    expect(markdown).toContain(`${workspace.matchReport.score}/100`);
    expect(markdown).toContain(question.question);
    expect(markdown).toContain(turn.answer);
    expect(markdown).toContain(workspace.report.nextActions[0]);
    expect(json.matchReport.score).toBe(workspace.matchReport.score);
    expect(json.mockTurns[0].answer).toBe(turn.answer);
  });
});
