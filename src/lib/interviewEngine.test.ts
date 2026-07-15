import { describe, expect, it } from "vitest";
import {
  analyzeJob,
  analyzeResume,
  buildInterviewReport,
  createPosition,
  createProfile,
  createMatchReport,
  evaluateMockTurn,
  generateAnswerDrafts,
  generateCueCard,
  generateQuestions,
  prioritizeEvidenceForJob,
  recomputePosition,
} from "./interviewEngine";
import { sampleJob, sampleResume } from "../data/sampleInputs";

describe("interviewEngine", () => {
  it("creates a full preparation chain from resume and JD", () => {
    const resume = analyzeResume(sampleResume);
    const job = analyzeJob(sampleJob);
    const matchReport = createMatchReport(resume, job, sampleResume);
    const questions = generateQuestions(resume, job);
    const answers = generateAnswerDrafts(questions, resume, job);

    expect(resume.evidence.length).toBeGreaterThan(4);
    expect(job.hardSkills).toContain("Excel");
    expect(matchReport.score).toBeGreaterThan(50);
    expect(matchReport.rewriteSuggestions[0].after).toContain("突出");
    expect(questions.length).toBeGreaterThanOrEqual(20);
    expect(answers[0].speakable).toContain("背景");
  });

  it("evaluates mock answers and builds a report", () => {
    const resume = analyzeResume(sampleResume);
    const job = analyzeJob(sampleJob);
    const matchReport = createMatchReport(resume, job, sampleResume);
    const questions = generateQuestions(resume, job);
    const answers = generateAnswerDrafts(questions, resume, job);
    const turn = evaluateMockTurn(
      questions[0],
      "背景是校园二手交易小程序增长项目。我的任务是提升首单转化率，动作包括访谈用户、设计首单优惠和消息提醒，结果是注册用户从 860 增长到 2,350，首单转化率从 12% 提升到 19%。",
      answers[0],
    );
    const report = buildInterviewReport([turn], questions, matchReport);

    expect(turn.score).toBeGreaterThan(70);
    expect(report.overallScore).toBeGreaterThan(50);
    expect(report.nextActions).toHaveLength(4);
  });

  it("prioritizes engineering evidence before operation evidence for frontend roles", () => {
    const resume = analyzeResume(sampleResume);
    const job = analyzeJob("岗位：前端开发实习生\n任职要求：React、TypeScript、HTML、CSS、小程序、组件开发");
    const ranked = prioritizeEvidenceForJob(resume, job, resume.evidence);

    expect(ranked[0].title).not.toContain("运营实习生");
    expect(ranked[0].title).not.toContain("教育背景");
  });

  it("parses realistic inline company and title fields from jd text", () => {
    const job = analyzeJob("公司名称：测试科技有限公司 | 岗位名称：AI 产品运营\n你将负责用户访谈、SQL 分析和增长复盘。");

    expect(job.company).toBe("测试科技有限公司");
    expect(job.title).toBe("AI 产品运营");
  });

  it("uses heuristic extraction when jd omits explicit line-prefixed labels", () => {
    const job = analyzeJob("北极星智能科技招聘产品经理，负责面试产品优化、RAG 召回和数据分析。");

    expect(job.company).toBe("北极星智能科技");
    expect(job.title).toBe("产品经理");
  });

  it("uses confirmed intake fields for position company and title", () => {
    const profile = createProfile("候选人\n目标岗位：AI 产品经理");
    const base = createPosition("北极星智能科技招聘产品经理，负责面试产品优化、RAG 召回和数据分析。", profile);
    const position = createPosition("北极星智能科技招聘产品经理，负责面试产品优化、RAG 召回和数据分析。", profile, {
      intake: {
        ...base.intake,
        confirmedFields: [
          { key: "company", label: "公司", value: "确认科技", source: "confirmed" },
          { key: "role", label: "岗位", value: "确认 AI 产品经理", source: "confirmed" },
        ],
      },
    });

    expect(position.company).toBe("确认科技");
    expect(position.title).toBe("确认 AI 产品经理");

    const recomputed = recomputePosition({ ...position, jobText: "一家创业公司招产品经理，负责增长和面试工具。" }, profile);
    expect(recomputed.company).toBe("确认科技");
    expect(recomputed.title).toBe("确认 AI 产品经理");
  });

  it("marks fallback evidence as synthetic when resume evidence is insufficient", () => {
    const resume = analyzeResume("候选人\n求职方向：AI 产品经理");
    const job = analyzeJob("岗位：AI 产品经理\n公司：测试科技\n要求：数据分析、项目推进");
    const matchReport = createMatchReport(resume, job, "候选人\n求职方向：AI 产品经理");
    const position = {
      id: "pos-test",
      title: job.title,
      company: job.company,
      jobText: "岗位：AI 产品经理\n公司：测试科技\n要求：数据分析、项目推进",
      job,
      matchReport,
      questions: [],
      answers: [],
      mockTurns: [],
      report: buildInterviewReport([], [], matchReport),
      selectedQuestionId: "",
      intake: {
        messages: [],
        rawJdText: "",
        inferredFields: [],
        confirmedFields: [],
        missingFields: [],
        fieldSources: {
          company: "inferred",
          role: "inferred",
          interviewer: "inferred",
          difficulty: "inferred",
          duration: "inferred",
          hasJd: "inferred",
        } as const,
        reviewStatus: "draft" as const,
        suggestedPrompts: [],
        configuredInterview: false,
      },
      materials: [],
      interviewPreferences: {
        interviewerRole: "上级",
        difficulty: "压力面",
        interviewerGender: "女",
        submitMode: "manual",
        style: "gentle",
      } as const,
      analysisContext: { priorityFocus: [], likelyQuestions: [], preparationTips: [], evidenceHighlights: [], materialHighlights: [], updatedAt: new Date().toISOString() },
      status: "planning" as const,
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const card = generateCueCard("请介绍一个最相关的项目。", { displayName: resume.name, resumeText: "候选人\n求职方向：AI 产品经理", resume, evidenceLibrary: resume.evidence, highlights: [] }, position, []);

    expect(card.evidenceIds).toContain("ev-fallback");
    expect(resume.evidence.every((item) => !item.synthetic)).toBe(true);
  });
});
