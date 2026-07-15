import "dotenv/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cleanupTempDir(tempDir: string) {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[ai-success-smoke] temp cleanup skipped: ${String(error)}`);
  }
}

function assertRemoteProvider() {
  const configured = ["OPENROUTER_API_KEY", "GITHUB_MODELS_TOKEN", "GITHUB_TOKEN", "DEEPSEEK_API_KEY"]
    .filter((name) => process.env[name]?.trim());
  if (!configured.length) throw new Error("MISSING_REMOTE_LLM_PROVIDER");
  return configured;
}

async function main() {
  const configuredProviders = assertRemoteProvider();
  process.env.CUE_CARD_BUDGET_MS = process.env.CUE_CARD_BUDGET_MS?.trim() || "20000";
  const { buildServer } = await import("../server/index");

  const tempDir = mkdtempSync(join(tmpdir(), "ai-success-smoke-"));
  const dbPath = join(tempDir, "smoke.sqlite");
  const app = buildServer({ dbPath });
  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        phone: `137${String(Date.now()).slice(-8)}`,
        password: "Password123",
        displayName: "AI 成功链路验收用户",
      },
    });
    if (register.statusCode !== 201) throw new Error(`REGISTER_FAILED:${register.statusCode}`);
    const token = register.json().tokens.accessToken as string;
    const authHeaders = { authorization: `Bearer ${token}` };

    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: authHeaders,
      payload: {
        rawJdText: "公司：测试科技\n岗位：AI 产品经理\n负责面试产品、用户研究、数据分析和 AI 功能落地。",
      },
    });
    if (intake.statusCode !== 200) throw new Error(`INTAKE_FAILED:${intake.statusCode}`);
    const positionId = intake.json().positions[0]?.id as string;

    const profile = await app.inject({
      method: "POST",
      url: "/api/profile",
      headers: authHeaders,
      payload: {
        displayName: "测试候选人",
        resumeText: "测试候选人\nAI 产品经理\n做过面试助手、增长分析、项目推进。",
        evidenceLibrary: [
          {
            id: "ev-real-1",
            type: "项目",
            title: "面试助手项目",
            detail: "负责题词卡、RAG 召回和模拟面试链路设计。",
            keywords: ["RAG", "题词卡", "AI"],
            impact: "完成 MVP 闭环并支持真实资料导入。",
          },
        ],
        highlights: ["做过 AI 面试助手 MVP"],
      },
    });
    if (profile.statusCode !== 200) throw new Error(`PROFILE_FAILED:${profile.statusCode}`);

    const cueCard = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: authHeaders,
      payload: {
        questionText: "请介绍一个你做过的 AI 产品项目。",
        positionId,
        source: "live",
        enableSearch: false,
        recentHistory: [],
      },
    });
    const cueCardMatch = cueCard.body.match(/event: card\s+data: (.+)/);
    const cueCardPayload = cueCardMatch ? JSON.parse(cueCardMatch[1]) : null;

    const session = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: authHeaders,
      payload: { positionId, config: { stage: "上级", difficulty: "压力面", submitMode: "manual" } },
    });
    if (session.statusCode !== 200) throw new Error(`MOCK_SESSION_FAILED:${session.statusCode}`);
    const sessionBody = session.json();

    const answer = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionBody.sessionId}/answer`,
      headers: authHeaders,
      payload: {
        positionId,
        answer: "我负责面试助手项目，先明确用户在真实面试中的提词需求，再设计 RAG 召回和题词卡生成链路，最后用真实资料回归验证可用性。",
        transcript: [
          { role: "interviewer", text: sessionBody.question },
          { role: "candidate", text: "我负责面试助手项目，做了 RAG 召回和题词卡链路。" },
        ],
      },
    });
    if (answer.statusCode !== 200) throw new Error(`MOCK_ANSWER_FAILED:${answer.statusCode}`);
    const answerBody = answer.json();

    const resumeAi = await app.inject({
      method: "POST",
      url: "/api/resume/ai",
      headers: authHeaders,
      payload: {
        positionId,
        action: "section",
        sectionId: "projects",
        sectionTitle: "项目经历",
        currentText: "做过一个 AI 面试助手项目。",
        fullResumeText: "项目经历\n做过一个 AI 面试助手项目。",
        userMessage: "请优化这一段项目经历",
      },
    });
    if (resumeAi.statusCode !== 200) throw new Error(`RESUME_AI_FAILED:${resumeAi.statusCode}`);
    const resumeAiBody = resumeAi.json();

    const result = {
      configuredProviders,
      cueCard: { status: cueCardPayload?.meta?.backendStatus ?? null, provider: cueCardPayload?.meta?.provider ?? null },
      mockAnswer: { status: answerBody.meta?.backendStatus ?? answerBody.backendStatus ?? null, provider: answerBody.meta?.provider ?? null },
      resumeAi: { status: resumeAiBody.meta?.backendStatus ?? null, provider: resumeAiBody.meta?.provider ?? null },
    };

    if (result.cueCard.status !== "success" || result.mockAnswer.status !== "success" || result.resumeAi.status !== "success") {
      throw new Error(`SUCCESS_SMOKE_FAILED:${JSON.stringify(result)}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
    cleanupTempDir(tempDir);
  }
}

void main();
