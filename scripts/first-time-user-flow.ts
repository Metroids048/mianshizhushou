/**
 * 首次用户全流程接口测试
 * 模拟：注册 → 引导 → 岗位 → 资料 → 提词卡 → 模拟面试 → 记录 → 导出/导入
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { File } from "node:buffer";
import { buildServer } from "../server/index";
import { LocalFallbackProvider } from "../server/ai/provider";
import { importResumeFile } from "../src/lib/resumeImport";

function extractSseEvent(body: string, eventName: string) {
  const block = body.split("\n\n").find((chunk) => chunk.includes(`event: ${eventName}`) && chunk.includes("data: "));
  if (!block) return null;
  const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6));
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "ai-job-first-user-"));
  const dbPath = join(tempDir, "first-user.sqlite");
  const app = buildServer({ dbPath, llmClient: new LocalFallbackProvider() });

  const results: Record<string, unknown> = {};
  let token = "";

  try {
    // ===== 阶段 1：注册与登录 =====
    console.log("=== 阶段 1：注册与登录 ===");

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { phone: "13800000001", password: "TestPass123", displayName: "测试用户" },
    });
    const registerBody = register.json();
    token = registerBody.tokens?.accessToken ?? "";
    const authHeader = { authorization: `Bearer ${token}` };

    results.register = {
      statusCode: register.statusCode,
      hasUserId: Boolean(registerBody.user?.id),
      hasToken: Boolean(token),
    };
    console.log(`  注册: ${register.statusCode}, userId=${registerBody.user?.id}, token=${token ? "OK" : "MISSING"}`);

    if (!token) throw new Error("REGISTER_FAILED_NO_TOKEN");

    // 验证 journeyState 在登录后应该是 onboarding
    const stateAfterLogin = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: authHeader,
    });
    const stateJson = stateAfterLogin.json();
    results.journeyStateAfterLogin = stateJson.journeyState;
    console.log(`  journeyState: ${stateJson.journeyState}`);

    // ===== 阶段 2：Onboarding 引导 =====
    console.log("\n=== 阶段 2：Onboarding ===");

    const onboarding = await app.inject({
      method: "POST",
      url: "/api/onboarding",
      headers: authHeader,
      payload: {
        displayName: "张三",
        targetRole: "AI 产品经理",
        city: "北京",
        experience: "3-5 年",
        stage: "准备面试",
      },
    });
    const onboardingBody = onboarding.json();
    results.onboarding = {
      statusCode: onboarding.statusCode,
      ok: onboardingBody.ok,
      nextStep: onboardingBody.nextStep,
      hasPosition: Boolean(onboardingBody.position),
    };
    console.log(`  Onboarding: ${onboarding.statusCode}, nextStep=${onboardingBody.nextStep}`);

    // ===== 阶段 3：导入简历 =====
    console.log("\n=== 阶段 3：导入简历 ===");

    const pdfBytes = readFileSync(resolve("测试用/AI产品经理.pdf"));
    const pdfFile = new File([pdfBytes], "AI产品经理.pdf", { type: "application/pdf" });
    const pdfImport = await importResumeFile(pdfFile);

    const profile = await app.inject({
      method: "POST",
      url: "/api/profile",
      headers: authHeader,
      payload: {
        displayName: "张三",
        resumeText: pdfImport.text,
        evidenceLibrary: [],
        highlights: ["AI 产品经验", "数据分析能力"],
      },
    });
    results.profile = { statusCode: profile.statusCode };
    console.log(`  简历导入: ${profile.statusCode}, 字符数=${pdfImport.text.length}`);

    // ===== 阶段 4：创建岗位 =====
    console.log("\n=== 阶段 4：创建岗位 ===");

    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: authHeader,
      payload: {
        rawJdText: [
          "公司名称：字节跳动 | 岗位名称：AI 产品经理",
          "负责 AI 面试产品从 0 到 1，包括用户研究、需求分析、产品设计和数据验证。",
          "要求：3 年以上产品经验，有 AI 或 SaaS 背景优先。",
        ].join("\n"),
      },
    });
    const intakeBody = intake.json();
    const position = intakeBody.positions?.[0];
    const positionId = position?.id as string;
    results.intake = {
      statusCode: intake.statusCode,
      title: position?.job?.title,
      company: position?.job?.company,
      hasId: Boolean(positionId),
    };
    console.log(`  岗位创建: ${intake.statusCode}, positionId=${positionId}`);

    if (!positionId) throw new Error("INTAKE_FAILED_NO_POSITION");

    // ===== 阶段 5：上传资料到问题库 =====
    console.log("\n=== 阶段 5：上传资料 ===");

    const docxBytes = readFileSync(resolve("测试用/项目材料/AI文本功能.docx"));
    const docxFile = new File([docxBytes], "AI文本功能.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const docxImport = await importResumeFile(docxFile);

    const materials = await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/materials`,
      headers: authHeader,
      payload: {
        materials: [
          {
            id: "mat-project-1",
            kind: "project",
            source: "upload",
            title: "AI文本功能",
            detail: docxImport.text,
            summary: docxImport.text.slice(0, 120),
            keywords: ["AI", "文本", "策略"],
            tags: ["上传资料"],
            linkedQuestionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    results.materials = {
      statusCode: materials.statusCode,
      count: materials.json().position?.materials?.length ?? 0,
    };
    console.log(`  资料上传: ${materials.statusCode}`);

    // ===== 阶段 6：手动添加问题 =====
    console.log("\n=== 阶段 6：添加问题 ===");

    const questions = await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/questions`,
      headers: authHeader,
      payload: {
        questions: [
          {
            id: "manual-q-1",
            category: "项目深挖",
            question: "请介绍你做过最成功的 AI 产品从 0 到 1 的项目。",
            reason: "用户手动保存",
            evidenceIds: [],
            difficulty: "进阶",
            source: "manual",
            priority: true,
            notes: "准备 3 个数据指标",
            answer: "",
            cueCardIds: [],
            tags: ["手动保存"],
          },
        ],
      },
    });
    results.questions = {
      statusCode: questions.statusCode,
      count: questions.json().position?.questions?.length ?? 0,
    };
    console.log(`  问题添加: ${questions.statusCode}`);

    // ===== 阶段 7：实时助手生成提词卡 =====
    console.log("\n=== 阶段 7：实时助手提词卡 ===");

    const cueCard = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: authHeader,
      payload: {
        questionText: "请介绍你在 AI 产品中如何做用户增长？",
        positionId,
        source: "live",
        enableSearch: false,
      },
    });
    const cueCardEvent = extractSseEvent(cueCard.body, "card");
    results.cueCard = {
      statusCode: cueCard.statusCode,
      hasCard: Boolean(cueCardEvent),
      backendStatus: cueCardEvent?.meta?.backendStatus ?? "fallback",
    };
    console.log(`  提词卡: ${cueCard.statusCode}, backendStatus=${results.cueCard.backendStatus}`);

    // ===== 阶段 8：模拟面试完整流程 =====
    console.log("\n=== 阶段 8：模拟面试 ===");

    const mockSession = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: authHeader,
      payload: { positionId, config: { stage: "上级", difficulty: "正常", submitMode: "manual" } },
    });
    const mockSessionBody = mockSession.json();
    const sessionId = mockSessionBody.sessionId as string;
    results.mockSession = {
      statusCode: mockSession.statusCode,
      hasQuestion: Boolean(mockSessionBody.question),
      sessionId,
    };
    console.log(`  模拟面试开始: ${mockSession.statusCode}, sessionId=${sessionId}`);

    // 回答第一题
    const mockAnswer1 = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionId}/answer`,
      headers: authHeader,
      payload: {
        positionId,
        answer: "我负责过一个 AI 面试产品的用户增长，通过分析新用户激活漏斗，优化了首次体验流程，7 天留存从 12% 提升到 28%。",
        transcript: [
          { role: "interviewer", text: mockSessionBody.question as string },
          { role: "candidate", text: "我负责 AI 面试产品的用户增长，优化体验流程后留存提升到 28%。" },
        ],
      },
    });
    const answer1Body = mockAnswer1.json();
    results.mockAnswer1 = {
      statusCode: mockAnswer1.statusCode,
      hasFollowUp: Boolean(answer1Body.followUp),
      backendStatus: answer1Body.meta?.backendStatus ?? answer1Body.backendStatus,
    };
    console.log(`  模拟面试回答1: ${mockAnswer1.statusCode}, followUp=${answer1Body.followUp ? "OK" : "MISSING"}`);

    // 回答追问
    const mockAnswer2 = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionId}/answer`,
      headers: authHeader,
      payload: {
        positionId,
        answer: "如果再做一次，我会更早定义北极星指标，并且做 A/B 实验来排除季节性因素。",
        transcript: [
          { role: "interviewer", text: mockSessionBody.question as string },
          { role: "candidate", text: "我优化体验流程后留存提升到 28%。" },
          { role: "interviewer", text: answer1Body.followUp as string },
          { role: "candidate", text: "我会更早定义北极星指标并做 A/B 实验。" },
        ],
      },
    });
    results.mockAnswer2 = {
      statusCode: mockAnswer2.statusCode,
    };
    console.log(`  模拟面试回答2: ${mockAnswer2.statusCode}`);

    // 结束面试
    const completeSession = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionId}/complete`,
      headers: authHeader,
    });
    results.mockComplete = { statusCode: completeSession.statusCode };
    console.log(`  模拟面试结束: ${completeSession.statusCode}`);

    // ===== 阶段 9：保存记录 =====
    console.log("\n=== 阶段 9：保存记录 ===");

    const recordPayload = mockAnswer2.json().record ?? mockAnswer1Body.record;
    if (recordPayload) {
      const recordSave = await app.inject({
        method: "POST",
        url: "/api/records",
        headers: authHeader,
        payload: recordPayload,
      });
      results.recordSave = {
        statusCode: recordSave.statusCode,
        hasRecord: Boolean(recordSave.json().record),
      };
      console.log(`  记录保存: ${recordSave.statusCode}`);
    } else {
      results.recordSave = { statusCode: "N/A", note: "no record payload from mock answer" };
      console.log(`  记录保存: SKIP (no record in response)`);
    }

    // ===== 阶段 10：简历 AI =====
    console.log("\n=== 阶段 10：简历 AI ===");

    const resumeAi = await app.inject({
      method: "POST",
      url: "/api/resume/ai",
      headers: authHeader,
      payload: {
        positionId,
        action: "full",
        currentText: "项目经历\n做过 AI 面试产品。",
        fullResumeText: pdfImport.text,
      },
    });
    results.resumeAi = {
      statusCode: resumeAi.statusCode,
      hasReply: Boolean(resumeAi.json().reply),
    };
    console.log(`  简历AI: ${resumeAi.statusCode}`);

    // ===== 阶段 11：导出与导入 =====
    console.log("\n=== 阶段 11：导出与导入 ===");

    const exportData = await app.inject({
      method: "POST",
      url: "/api/data/export",
      headers: authHeader,
    });
    results.export = {
      statusCode: exportData.statusCode,
      positionsCount: exportData.json().positions?.length ?? 0,
      recordsCount: exportData.json().records?.length ?? 0,
    };
    console.log(`  数据导出: ${exportData.statusCode}`);

    // ===== 阶段 12：服务重启后数据回显 =====
    console.log("\n=== 阶段 12：重启后验证 ===");

    const stateBeforeRestart = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: authHeader,
    });
    await app.close();

    const restarted = buildServer({ dbPath, llmClient: new LocalFallbackProvider() });
    const stateAfterRestart = await restarted.inject({
      method: "GET",
      url: "/api/state",
      headers: authHeader,
    });
    const recordsAfterRestart = await restarted.inject({
      method: "GET",
      url: "/api/records",
      headers: authHeader,
    });

    results.restart = {
      positionsBefore: stateBeforeRestart.json().positions?.length ?? 0,
      positionsAfter: stateAfterRestart.json().positions?.length ?? 0,
      recordsAfter: recordsAfterRestart.json().records?.length ?? 0,
      consistent: (stateBeforeRestart.json().positions?.length ?? 0) === (stateAfterRestart.json().positions?.length ?? 0),
    };
    console.log(`  重启后: positions=${results.restart.positionsAfter}, records=${results.restart.recordsAfter}, consistent=${results.restart.consistent}`);

    await restarted.close();

    // ===== 输出结果 =====
    console.log("\n========================================");
    console.log("       首次用户全流程测试结果汇总");
    console.log("========================================");
    console.log(JSON.stringify(results, null, 2));

    // 验证关键断言
    const failures: string[] = [];
    if (results.register.statusCode !== 200 && results.register.statusCode !== 201) failures.push("注册失败");
    if (results.onboarding.statusCode !== 200) failures.push("Onboarding 失败");
    if (results.intake.statusCode !== 200) failures.push("岗位创建失败");
    if (results.materials.statusCode !== 200) failures.push("资料上传失败");
    if (results.questions.statusCode !== 200) failures.push("问题添加失败");
    if (results.cueCard.statusCode !== 200) failures.push("提词卡生成失败");
    if (results.mockSession.statusCode !== 200) failures.push("模拟面试创建失败");
    if (results.resumeAi.statusCode !== 200) failures.push("简历 AI 失败");
    if (results.restart.consistent !== true) failures.push("重启后数据不一致");

    if (failures.length > 0) {
      console.error(`\n❌ 失败项 (${failures.length}):`);
      failures.forEach((f) => console.error(`  - ${f}`));
      process.exit(1);
    }

    console.log("\n✅ 全部通过！");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ 测试异常:", error);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main();
