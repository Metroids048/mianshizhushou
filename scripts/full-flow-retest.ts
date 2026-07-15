import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { File } from "node:buffer";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server/index";
import { LocalFallbackProvider } from "../server/ai/provider";
import { importResumeFile } from "../src/lib/resumeImport";

function cleanupTempDir(tempDir: string) {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[full-flow-retest] temp cleanup skipped: ${String(error)}`);
  }
}

function extractSseEvent(body: string, eventName: string) {
  const block = body
    .split("\n\n")
    .find((chunk) => chunk.includes(`event: ${eventName}`) && chunk.includes("data: "));
  if (!block) return null;
  const dataLine = block
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6));
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "ai-job-full-flow-"));
  const dbPath = join(tempDir, "retest.sqlite");
  const app = buildServer({ dbPath, llmClient: new LocalFallbackProvider() });
  let appClosed = false;
  let restarted: FastifyInstance | null = null;
  let restartedClosed = false;
  let authToken = "";

  const injectAsUser = async (target: FastifyInstance, options: Parameters<FastifyInstance["inject"]>[0]) => {
    const optionObject = options as { headers?: Record<string, string> };
    return target.inject({
      ...optionObject,
      headers: {
        ...(optionObject.headers ?? {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
    });
  };

  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        phone: `139${String(Date.now()).slice(-8)}`,
        password: "Password123",
        displayName: "全链路验收用户",
      },
    });
    if (register.statusCode !== 201) throw new Error(`REGISTER_FAILED:${register.statusCode}:${register.body}`);
    authToken = register.json().tokens.accessToken as string;

    const pdfBytes = readFileSync(resolve("测试用/AI产品经理.pdf"));
    const pdfFile = new File([pdfBytes], "AI产品经理.pdf", { type: "application/pdf" });
    const pdfImport = await importResumeFile(pdfFile);

    const docxBytes = readFileSync(resolve("测试用/项目材料/AI文本功能.docx"));
    const docxFile = new File([docxBytes], "AI文本功能.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const docxImport = await importResumeFile(docxFile);

    const intake = await injectAsUser(app, {
      method: "POST",
      url: "/api/positions/intake",
      payload: {
        rawJdText: [
          "公司名称：测试科技有限公司 | 岗位名称：AI 产品运营",
          "你将负责用户访谈、SQL 分析、增长复盘和 AI 功能落地。",
          "要求：熟悉数据分析、产品协同和项目推进。",
        ].join("\n"),
      },
    });
    const intakeBody = intake.json();
    if (intake.statusCode !== 200 || !Array.isArray(intakeBody.positions) || !intakeBody.positions[0]) {
      throw new Error(`INTAKE_FAILED:${intake.statusCode}:${intake.body}`);
    }
    const position = intakeBody.positions[0];
    const positionId = position.id as string;

    const profile = await injectAsUser(app, {
      method: "POST",
      url: "/api/profile",
      payload: {
        displayName: "测试候选人",
        resumeText: pdfImport.text,
        evidenceLibrary: intakeBody.profile?.evidenceLibrary ?? [],
        highlights: ["熟悉 AI 产品、增长分析与项目推进"],
      },
    });

    const materials = await injectAsUser(app, {
      method: "POST",
      url: `/api/positions/${positionId}/materials`,
      payload: {
        materials: [
          {
            id: "material-docx-1",
            kind: "project",
            source: "upload",
            title: "AI文本功能",
            detail: docxImport.text,
            summary: docxImport.text.slice(0, 120),
            keywords: ["AI", "文本", "策略"],
            tags: ["测试导入"],
            linkedQuestionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });

    const questions = await injectAsUser(app, {
      method: "POST",
      url: `/api/positions/${positionId}/questions`,
      payload: {
        questions: [
          {
            id: "manual-q-1",
            category: "项目深挖",
            question: "请介绍一个你做过的 AI 文本相关项目。",
            reason: "用户手动补充",
            evidenceIds: [],
            difficulty: "中等",
            source: "manual",
            priority: true,
            notes: "重点复盘",
            answer: "",
            cueCardIds: [],
            tags: ["真实资料"],
          },
        ],
      },
    });

    const cueCard = await injectAsUser(app, {
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      payload: {
        questionText: "请介绍一个你做过最有挑战性的 AI 文本功能。",
        positionId,
        source: "live",
        enableSearch: true,
        recentHistory: [],
      },
    });

    const cueCardEvent = extractSseEvent(cueCard.body, "card");

    const mockSession = await injectAsUser(app, {
      method: "POST",
      url: "/api/mock/session",
      payload: {
        positionId,
        config: { stage: "上级", difficulty: "压力面", submitMode: "manual" },
      },
    });
    const mockSessionBody = mockSession.json();

    const mockAnswer = await injectAsUser(app, {
      method: "POST",
      url: `/api/mock/session/${mockSessionBody.sessionId}/answer`,
      payload: {
        positionId,
        answer: "我负责一个 AI 文本能力项目，先通过用户访谈识别痛点，再用 SQL 分析漏斗，推动策略上线后核心转化率提升。",
        transcript: [
          { role: "interviewer", text: mockSessionBody.question },
          { role: "candidate", text: "我负责一个 AI 文本能力项目，推动核心转化率提升。" },
        ],
      },
    });
    const mockAnswerBody = mockAnswer.json();

    const resumeAi = await injectAsUser(app, {
      method: "POST",
      url: "/api/resume/ai",
      payload: {
        positionId,
        action: "full",
        sectionId: "highlights",
        sectionTitle: "亮点摘要",
        currentText: "项目经历\n做过一个 AI 文本功能项目。",
        fullResumeText: "亮点摘要\n原亮点\n\n项目经历\n做过一个 AI 文本功能项目。",
        userMessage: "请优化整份简历",
      },
    });
    const resumeAiBody = resumeAi.json();

    const recordSave = await injectAsUser(app, {
      method: "POST",
      url: "/api/records",
      payload: mockAnswerBody.record,
    });

    const search = await injectAsUser(app, {
      method: "POST",
      url: "/api/search",
      payload: { query: "测试科技 AI 产品运营 面试" },
    });

    const stateBeforeRestart = await injectAsUser(app, { method: "GET", url: "/api/state" });
    const recordsBeforeRestart = await injectAsUser(app, { method: "GET", url: "/api/records" });
    const exportBeforeRestart = await injectAsUser(app, { method: "POST", url: "/api/export" });
    const exportedState = exportBeforeRestart.json();

    await app.close();
    appClosed = true;

    restarted = buildServer({ dbPath, llmClient: new LocalFallbackProvider() });
    const stateAfterRestart = await injectAsUser(restarted, { method: "GET", url: "/api/state" });
    const exportAfterRestart = await injectAsUser(restarted, { method: "POST", url: "/api/export" });
    const importRoundTrip = await injectAsUser(restarted, {
      method: "POST",
      url: "/api/import",
      payload: exportedState,
    });

    const result = {
      imports: {
        pdfChars: pdfImport.text.length,
        docxChars: docxImport.text.length,
      },
      intake: {
        statusCode: intake.statusCode,
        title: position.job.title,
        company: position.job.company,
      },
      profile: {
        statusCode: profile.statusCode,
      },
      materials: {
        statusCode: materials.statusCode,
        count: materials.json().position?.materials?.length ?? 0,
      },
      questions: {
        statusCode: questions.statusCode,
        count: questions.json().position?.questions?.length ?? 0,
      },
      cueCard: {
        statusCode: cueCard.statusCode,
        backendStatus: cueCardEvent?.meta?.backendStatus ?? null,
      },
      mock: {
        sessionStatusCode: mockSession.statusCode,
        answerStatusCode: mockAnswer.statusCode,
        backendStatus: mockAnswerBody.meta?.backendStatus ?? mockAnswerBody.backendStatus,
      },
      resumeAi: {
        statusCode: resumeAi.statusCode,
        applyTarget: resumeAiBody.applyTarget,
        structured: ["亮点摘要", "项目经历", "技能与工具", "待补强"].every((item) => resumeAiBody.suggestion.includes(item)),
      },
      search: {
        statusCode: search.statusCode,
        provider: search.json().results[0]?.provider ?? null,
      },
      records: {
        saveStatusCode: recordSave.statusCode,
        stateBeforeRestart: stateBeforeRestart.json().records.length,
        recordsBeforeRestart: recordsBeforeRestart.json().records.length,
        exportBeforeRestart: exportBeforeRestart.json().interviewRecords.length,
        stateAfterRestart: stateAfterRestart.json().records.length,
        exportAfterRestart: exportAfterRestart.json().interviewRecords.length,
        importRoundTripStatusCode: importRoundTrip.statusCode,
      },
    };

    console.log(JSON.stringify(result, null, 2));
    const failures = [
      result.intake.statusCode === 200 ? "" : `intake=${result.intake.statusCode}`,
      result.profile.statusCode === 200 ? "" : `profile=${result.profile.statusCode}`,
      result.materials.statusCode === 200 && result.materials.count > 0 ? "" : `materials=${result.materials.statusCode}/${result.materials.count}`,
      result.questions.statusCode === 200 && result.questions.count > 0 ? "" : `questions=${result.questions.statusCode}/${result.questions.count}`,
      result.cueCard.statusCode === 200 ? "" : `cueCard=${result.cueCard.statusCode}`,
      result.mock.sessionStatusCode === 200 && result.mock.answerStatusCode === 200 ? "" : `mock=${result.mock.sessionStatusCode}/${result.mock.answerStatusCode}`,
      result.resumeAi.statusCode === 200 && result.resumeAi.structured ? "" : `resumeAi=${result.resumeAi.statusCode}/${result.resumeAi.structured}`,
      result.records.stateBeforeRestart > 0 && result.records.exportBeforeRestart > 0 && result.records.stateAfterRestart > 0 && result.records.exportAfterRestart > 0
        ? ""
        : `records=${JSON.stringify(result.records)}`,
    ].filter(Boolean);
    if (failures.length) {
      throw new Error(`full-flow failed: ${failures.join(", ")}`);
    }
    await restarted.close();
    restartedClosed = true;
  } finally {
    if (restarted && !restartedClosed) {
      await restarted.close().catch(() => undefined);
    }
    if (!appClosed) {
      await app.close().catch(() => undefined);
    }
    cleanupTempDir(tempDir);
  }
}

void main();
