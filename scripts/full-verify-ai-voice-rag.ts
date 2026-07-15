/**
 * AI + 语音 + RAG 三位一体全面验证
 * 覆盖：在线模型全接口、语音分析引擎、RAG 索引与检索、fallback 对比
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServer } from "../server/index";
import { importResumeFile } from "../src/lib/resumeImport";
import { analyzeSpeech } from "../src/lib/speechAnalysis";
import { isSpeechRecognitionSupported } from "../src/lib/speech";

// ---------- helpers ----------
interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];
function t(name: string, fn: () => { ok: boolean; detail: string }) {
  const r = fn();
  results.push({ name, passed: r.ok, detail: r.detail });
  const icon = r.ok ? "✅" : "❌";
  console.log(`${icon} ${name}: ${r.detail.slice(0, 100)}`);
}
function pass(detail: string) { return { ok: true, detail }; }
function fail(detail: string) { return { ok: false, detail }; }

function extractSseEvent(body: string, eventName: string) {
  const block = body.split("\n\n").find((chunk) => chunk.includes(`event: ${eventName}`) && chunk.includes("data: "));
  if (!block) return null;
  const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6));
}

// ---------- main ----------
async function main() {
  console.log("=".repeat(60));
  console.log("AI + 语音 + RAG 三位一体全面验证");
  console.log("=".repeat(60));

  const tempDir = mkdtempSync(join(tmpdir(), "ai-full-verify-"));
  const dbPath = join(tempDir, "verify.sqlite");

  try {
    // ========== PART 1: 语音分析引擎 ==========
    console.log("\n── 1. 语音分析引擎 ──");

    t("speechAnalysis 正常语速分析", () => {
      const m = analyzeSpeech("我负责用户访谈和数据分析，推动转化率提升。", 15);
      const ok = m.charCount > 5 && m.charsPerMinute > 0 && m.fillerCount >= 0;
      return ok ? pass(`charCount=${m.charCount}, cpm=${m.charsPerMinute}, fillers=${m.fillerCount}`) : fail(JSON.stringify(m));
    });

    t("speechAnalysis 检测口头禅", () => {
      const m = analyzeSpeech("嗯 我负责用户访谈，然后就推动转化率提升到 19%，那个 然后就是实现了增长。", 20);
      const ok = m.fillerCount >= 4;
      return ok ? pass(`口头禅=${m.fillerCount}次, fillers=${m.fillers.join(",")}`) : fail(`口头禅仅${m.fillerCount}次`);
    });

    t("speechAnalysis 0秒时长提示语音作答", () => {
      const m = analyzeSpeech("测试文本", 0);
      return m.comment.includes("语音作答") ? pass(m.comment) : fail(`comment=${m.comment}`);
    });

    t("speechAnalysis 语速偏快检测", () => {
      const longText = "测试内容。".repeat(20);
      const m = analyzeSpeech(longText, 10);
      return m.comment.includes("偏快") || m.charsPerMinute > 300 ? pass(`cpm=${m.charsPerMinute}, comment=${m.comment}`) : fail(`cpm=${m.charsPerMinute}`);
    });

    t("speechAnalysis 语速偏慢检测", () => {
      const m = analyzeSpeech("短文本。", 30);
      return m.comment.includes("偏慢") || m.charsPerMinute < 100 ? pass(`cpm=${m.charsPerMinute}`) : fail(`cpm=${m.charsPerMinute}`);
    });

    t("isSpeechRecognitionSupported 在 Node 环境返回 false", () => {
      const supported = isSpeechRecognitionSupported();
      return supported === false ? pass("false（正确，Node 无浏览器 API）") : fail(`返回 ${supported}`);
    });

    // ========== PART 2: AI 在线模型全接口 ==========
    console.log("\n── 2. AI 在线模型全接口（DeepSeek） ──");

    const app = buildServer({ dbPath });
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { phone: "13900000011", password: "TestPass123", displayName: "验证用户" },
    });
    const token = register.json().tokens?.accessToken as string | undefined;
    const authHeaders = { authorization: `Bearer ${token}` };
    if (!token) throw new Error("FULL_VERIFY_REGISTER_FAILED");

    // 检查模型状态
    const health = await app.inject({ method: "GET", url: "/api/health" });
    const healthBody = health.json();
    t("health 检查模型状态", () => {
      return healthBody.model !== "local-fallback"
        ? pass(`model=${healthBody.model}`)
        : fail("模型未配置，仍为 local-fallback");
    });

    // 2a. Intake with real model
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: authHeaders,
      payload: {
        rawJdText: "公司：字节跳动 | 岗位：AI 产品经理\n负责大模型应用落地、用户研究和数据分析。要求：3年产品经验，熟悉 LLM 和 RAG。",
      },
    });
    const intakeBody = intake.json();
    const positionId = intakeBody.positions[0]?.id;

    t("intake 在线模型返回 suggestedPrompts", () => {
      const ia = intakeBody.intakeAssistant;
      return ia?.suggestedPrompts?.length > 0
        ? pass(`suggestedPrompts=${ia.suggestedPrompts.length}, backendStatus=${ia.backendStatus}`)
        : fail(`backendStatus=${ia?.backendStatus}`);
    });

    // 2b. Profile
    const pdfBytes = readFileSync(resolve("测试用/AI产品经理.pdf"));
    const pdfFile = new (await import("buffer")).File([pdfBytes], "AI产品经理.pdf", { type: "application/pdf" });
    const pdfImport = await importResumeFile(pdfFile);
    await app.inject({
      method: "POST",
      url: "/api/profile",
      headers: authHeaders,
      payload: {
        displayName: "验证候选人",
        resumeText: pdfImport.text,
        evidenceLibrary: [
          { id: "ev-real", type: "项目", title: "AI面试助手", detail: "负责RAG召回和题词卡生成链路。", keywords: ["RAG", "AI"], impact: "MVP闭环" },
        ],
        highlights: ["AI产品经验", "RAG项目"],
      },
    });

    // 2c. CueCard with real model
    const cueCard = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: authHeaders,
      payload: {
        questionText: "请介绍一个你做过的 AI 产品项目，重点说明技术方案和业务结果。",
        positionId,
        source: "live",
        enableSearch: false,
        recentHistory: [],
      },
    });
    const cardEvent = extractSseEvent(cueCard.body, "card");

    t("cue-card 在线模型 backendStatus=success", () => {
      if (!cardEvent) return fail("card 事件不存在");
      const status = cardEvent.meta?.backendStatus;
      return status === "success"
        ? pass(`backendStatus=success, bullets=${cardEvent.card?.bullets?.length}`)
        : fail(`backendStatus=${status}`);
    });

    t("cue-card 提词卡结构化字段完整", () => {
      if (!cardEvent?.card) return fail("card 数据缺失");
      const c = cardEvent.card;
      const hasStrategy = !!c.strategy;
      const hasOpening = !!c.openingLine;
      const hasBullets = Array.isArray(c.bullets) && c.bullets.length >= 2;
      const hasRisks = Array.isArray(c.risks) && c.risks.length >= 1;
      return hasStrategy && hasOpening && hasBullets && hasRisks
        ? pass(`strategy✓ openingLine✓ bullets=${c.bullets.length} risks=${c.risks.length}`)
        : fail(`strategy=${hasStrategy} opening=${hasOpening} bullets=${hasBullets} risks=${hasRisks}`);
    });

    t("cue-card evidenceTrace 证据追踪", () => {
      const trace = cardEvent?.meta?.evidenceTrace;
      return Array.isArray(trace)
        ? pass(`evidenceTrace=${trace.length}条`)
        : fail("evidenceTrace 非数组");
    });

    // 2d. Mock interview with real model
    const session = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: authHeaders,
      payload: { positionId, config: { stage: "上级", difficulty: "压力面", submitMode: "manual" } },
    });
    const sessionBody = session.json();

    t("mock session 在线模型 backendStatus=success", () => {
      const status = sessionBody.meta?.backendStatus;
      return status === "success"
        ? pass(`backendStatus=success, question="${sessionBody.question?.slice(0, 40)}..."`)
        : fail(`backendStatus=${status}`);
    });

    const answer = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionBody.sessionId}/answer`,
      headers: authHeaders,
      payload: {
        positionId,
        answer: "我负责AI面试助手项目，先通过用户访谈明确面试中的真实痛点，然后设计了基于RAG的题词卡生成链路，用FTS5做资料检索，用DeepSeek做结构化生成。最终MVP上线后，用户练习效率提升40%。",
        transcript: [
          { role: "interviewer", text: sessionBody.question },
          { role: "candidate", text: "我负责AI面试助手项目，设计了RAG题词卡生成链路。" },
        ],
      },
    });
    const answerBody = answer.json();

    t("mock answer 在线模型 backendStatus=success", () => {
      const status = answerBody.meta?.backendStatus;
      return status === "success"
        ? pass(`backendStatus=success, decision=${answerBody.decision?.type}`)
        : fail(`backendStatus=${status}`);
    });

    t("mock answer 追问质量", () => {
      const followUp = answerBody.followUp?.question ?? answerBody.followUp;
      return typeof followUp === "string" && followUp.length > 5
        ? pass(`followUp="${followUp.slice(0, 40)}..."`)
        : fail(`followUp=${JSON.stringify(followUp)}`);
    });

    t("mock answer 即时反馈", () => {
      const fb = answerBody.decision?.instantFeedback;
      return fb && fb.length > 3
        ? pass(`instantFeedback="${fb.slice(0, 40)}..."`)
        : fail(`instantFeedback=${fb}`);
    });

    t("mock answer 报告维度完整", () => {
      const dims = answerBody.record?.report?.structuredDimensions;
      return Array.isArray(dims) && dims.length >= 4
        ? pass(`${dims.length}个维度`)
        : fail(`维度=${dims?.length}`);
    });

    // 2e. Resume AI with real model — 3 actions
    const actions = ["section", "full", "match"] as const;
    for (const action of actions) {
      const rai = await app.inject({
        method: "POST",
        url: "/api/resume/ai",
        headers: authHeaders,
        payload: {
          positionId,
          action,
          sectionId: "projects",
          sectionTitle: "项目经历",
          currentText: "做过AI面试助手项目。",
          fullResumeText: "项目经历\n做过AI面试助手项目。\n技能：RAG、LLM、数据分析。",
          userMessage: action === "match" ? "请分析匹配度" : "请优化",
        },
      });
      const raiBody = rai.json();

      t(`resume AI action=${action} 在线模型 backendStatus=success`, () => {
        const status = raiBody.meta?.backendStatus;
        return status === "success"
          ? pass(`backendStatus=success, applyTarget=${raiBody.applyTarget}`)
          : fail(`backendStatus=${status}`);
      });

      t(`resume AI action=${action} suggestion 非空`, () => {
        return raiBody.suggestion?.length > 10
          ? pass(`suggestion=${raiBody.suggestion.slice(0, 50)}...`)
          : fail("suggestion 过短或为空");
      });
    }

    // ========== PART 3: RAG 索引与检索 ==========
    console.log("\n── 3. RAG 索引与检索 ──");

    // 3a. 上传资料后检索
    const docxBytes = readFileSync(resolve("测试用/项目材料/AI文本功能.docx"));
    const docxFile = new (await import("buffer")).File([docxBytes], "AI文本功能.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const docxImport = await importResumeFile(docxFile);

    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/materials`,
      headers: authHeaders,
      payload: {
        materials: [{
          id: "material-rag-verify",
          kind: "project",
          source: "upload",
          title: "AI文本功能项目",
          detail: docxImport.text,
          summary: docxImport.text.slice(0, 120),
          keywords: ["AI", "文本", "NLP", "策略"],
          tags: ["重点项目", "AI"],
          linkedQuestionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      },
    });

    // 3b. Reindex then retrieve
    await app.inject({ method: "POST", url: "/api/rag/reindex", headers: authHeaders });

    // 3c. Search via the SSE cue card which internally uses RAG
    const ragCueCard = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: authHeaders,
      payload: {
        questionText: "请介绍AI文本功能相关的项目经验。",
        positionId,
        source: "live",
        enableSearch: false,
        recentHistory: [],
      },
    });
    const ragCardEvent = extractSseEvent(ragCueCard.body, "card");

    t("RAG 检索结果体现在 evidenceTrace", () => {
      const trace = ragCardEvent?.meta?.evidenceTrace;
      return Array.isArray(trace) && trace.length > 0
        ? pass(`evidenceTrace=${trace.length}条, 含RAG召回结果`)
        : fail(`evidenceTrace=${trace?.length ?? "null"}`);
    });

    t("RAG retrievalCount 在元数据中", () => {
      const count = ragCardEvent?.meta?.retrievalCount;
      return count > 0
        ? pass(`retrievalCount=${count}`)
        : fail(`retrievalCount=${count}`);
    });

    // 3d. 岗位上下文完整性
    const ctx = await app.inject({ method: "GET", url: `/api/positions/${positionId}/context`, headers: authHeaders });
    const ctxBody = ctx.json();

    t("岗位上下文包含 profile/position/questions/evidence", () => {
      const has = ctxBody.profile && ctxBody.position && Array.isArray(ctxBody.questions) && Array.isArray(ctxBody.evidence);
      return has
        ? pass(`questions=${ctxBody.questions.length}, evidence=${ctxBody.evidence.length}`)
        : fail(`keys=${Object.keys(ctxBody).join(",")}`);
    });

    // 3e. 问题库中的题目可用于 RAG 检索
    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/questions`,
      headers: authHeaders,
      payload: {
        questions: [{
          id: "rag-test-q",
          category: "项目深挖",
          question: "NLP文本分类模型的准确率如何评估？",
          reason: "RAG检索验证题",
          evidenceIds: [],
          difficulty: "困难",
          source: "manual",
          priority: true,
          notes: "测试RAG",
          answer: "使用F1-score和混淆矩阵综合评估。",
          cueCardIds: [],
          tags: ["NLP", "测试"],
        }],
      },
    });

    const ragCueCard2 = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: authHeaders,
      payload: {
        questionText: "NLP文本分类模型评估方法",
        positionId,
        source: "questionBank",
        enableSearch: false,
        recentHistory: [],
      },
    });
    const ragCard2 = extractSseEvent(ragCueCard2.body, "card");

    t("问题库题目通过 RAG 被检索到", () => {
      const trace = ragCard2?.meta?.evidenceTrace;
      const retrievalCount = ragCard2?.meta?.retrievalCount ?? 0;
      return retrievalCount > 0
        ? pass(`retrievalCount=${retrievalCount}, RAG检索成功`)
        : fail("RAG未检索到相关题目");
    });

    // ========== PART 4: 在线 vs Fallback 对比 ==========
    console.log("\n── 4. 在线模型 vs Fallback 对比 ──");

    t("在线 cue-card backendStatus=success（非fallback）", () => {
      const status = cardEvent?.meta?.backendStatus;
      return status === "success"
        ? pass("在线模型 success ✅")
        : fail(`在线模型=${status}，需检查key`);
    });

    t("在线 cue-card 有真实 evidenceTrace（非空数组）", () => {
      const trace = cardEvent?.meta?.evidenceTrace;
      return Array.isArray(trace) && trace.length > 0
        ? pass(`真实trace=${trace.length}条`)
        : fail("trace为空，可能降级为fallback");
    });

    t("在线 mock session 有 questionSource 标记", () => {
      const qs = sessionBody.questionSource;
      return qs && qs.length > 0
        ? pass(`questionSource="${qs}"`)
        : fail("questionSource缺失");
    });

    // 对比：fallback 时 meta.fallbackReason 非空，在线时为空
    t("在线模型 fallbackReason 应为空", () => {
      const reason = cardEvent?.meta?.fallbackReason ?? "";
      return reason === ""
        ? pass("fallbackReason 为空（在线模型正确）")
        : fail(`fallbackReason="${reason}"`);
    });

    // ========== PART 5: 记录与持久化（在线模型数据） ==========
    console.log("\n── 5. 在线模型数据持久化 ──");

    const saveRes = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: authHeaders,
      payload: answerBody.record,
    });

    const exportRes = await app.inject({ method: "POST", url: "/api/export", headers: authHeaders });
    const exported = exportRes.json();

    t("在线模型报告可导出", () => {
      return exported.interviewRecords?.length > 0
        ? pass(`records=${exported.interviewRecords.length}`)
        : fail("无记录可导出");
    });

    await app.close();

    const restarted = buildServer({ dbPath });
    const stateAfter = await restarted.inject({ method: "GET", url: "/api/state", headers: authHeaders });
    const recordsAfter = await restarted.inject({ method: "GET", url: "/api/records", headers: authHeaders });

    t("重启后在线模型数据持久化一致", () => {
      const sRecs = stateAfter.json().records?.length ?? 0;
      const rRecs = recordsAfter.json().records?.length ?? 0;
      return sRecs > 0 && rRecs > 0
        ? pass(`state.records=${sRecs}, api.records=${rRecs}`)
        : fail(`state.records=${sRecs}, api.records=${rRecs}`);
    });

    await restarted.close();

    // ========== SUMMARY ==========
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log("\n" + "=".repeat(60));
    console.log(`总计: ${results.length} 项 | ✅ ${passed} 通过 | ❌ ${failed} 失败`);
    console.log("=".repeat(60));

    const failures = results.filter((r) => !r.passed);
    if (failures.length) {
      console.log("\n失败项:");
      failures.forEach((r) => console.log(`  ❌ ${r.name}: ${r.detail}`));
    }

  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main();
