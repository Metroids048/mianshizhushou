import { WorkspaceState } from "../types";

type ReportFormat = "markdown" | "json";

const dimensionLabels: Array<[keyof WorkspaceState["report"]["dimensions"], string]> = [
  ["completeness", "完整度"],
  ["relevance", "岗位相关性"],
  ["evidenceStrength", "证据强度"],
  ["structure", "表达结构"],
  ["riskControl", "风险控制"],
];

export function buildReportMarkdown(workspace: WorkspaceState): string {
  const answeredQuestions = workspace.mockTurns
    .map((turn) => {
      const question = workspace.questions.find((item) => item.id === turn.questionId);
      if (!question) return undefined;
      return { question, turn };
    })
    .filter(Boolean);

  const questionLines = workspace.questions
    .slice(0, 10)
    .map((question, index) => `${index + 1}. [${question.category}/${question.difficulty}] ${question.question}`)
    .join("\n");

  const turnLines =
    answeredQuestions.length > 0
      ? answeredQuestions
          .map((item, index) => {
            if (!item) return "";
            return [
              `### ${index + 1}. ${item.question.question}`,
              `得分：${item.turn.score}/100`,
              `回答：${item.turn.answer}`,
              `反馈：${item.turn.feedback}`,
            ].join("\n\n");
          })
          .join("\n\n")
      : "尚未完成模拟作答。";

  const dimensionLines = dimensionLabels
    .map(([key, label]) => `- ${label}: ${workspace.report.dimensions[key]}/100`)
    .join("\n");

  const nextActionLines = workspace.report.nextActions.map((item) => `- ${item}`).join("\n");

  return [
    `# ${workspace.job.company} ${workspace.job.title} 求职准备报告`,
    "",
    "## 匹配诊断",
    `- 岗位匹配分：${workspace.matchReport.score}/100`,
    `- ATS 覆盖：${workspace.matchReport.atsScore}/100`,
    `- 关键词覆盖：${workspace.matchReport.keywordCoverage}/100`,
    `- 诊断摘要：${workspace.matchReport.summary}`,
    "",
    "## 高概率问题",
    questionLines,
    "",
    "## 模拟面试记录",
    turnLines,
    "",
    "## 复盘评分",
    `综合分：${workspace.report.overallScore}/100`,
    dimensionLines,
    "",
    "## 下一轮训练清单",
    nextActionLines,
  ].join("\n");
}

export function buildReportJson(workspace: WorkspaceState): string {
  return JSON.stringify(
    {
      target: {
        company: workspace.job.company,
        title: workspace.job.title,
      },
      matchReport: workspace.matchReport,
      questions: workspace.questions,
      mockTurns: workspace.mockTurns,
      report: workspace.report,
    },
    null,
    2,
  );
}

export function downloadWorkspaceReport(workspace: WorkspaceState, format: ReportFormat) {
  const isMarkdown = format === "markdown";
  const content = isMarkdown ? buildReportMarkdown(workspace) : buildReportJson(workspace);
  const extension = isMarkdown ? "md" : "json";
  const mimeType = isMarkdown ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
  const safeTitle = `${workspace.job.company}-${workspace.job.title}`.replace(/[\\/:*?"<>|]/g, "-");
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${safeTitle || "interview-report"}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
