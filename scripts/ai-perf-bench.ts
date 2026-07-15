/**
 * AI 性能基准测试
 * 对新工具首版核心链路 cue-card / resume-ai 多次采样，输出 min/avg/P95/P99，并按阈值断言达标。
 * 阈值：cue-card P95 ≤ 8000ms，resume-ai P95 ≤ 8000ms；fallback 必须显式标记。
 * 当检测到远端模型凭据时，任何 fallback 都应使本次真实模型基准失败，不能把
 * "响应足够快的本地兜底"误报为在线模型性能达标。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/ai-perf-bench.ts
 * 需要 .env 配置 DEEPSEEK_API_KEY（否则走 fallback，延迟不反映真实模型性能）。
 */
import "dotenv/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server/index";

function extractSseEvent(body: string, eventName: string) {
  const block = body.split("\n\n").find((chunk) => chunk.includes(`event: ${eventName}`) && chunk.includes("data: "));
  if (!block) return null;
  const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function summarize(samples: number[]): { min: number; avg: number; p95: number; p99: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  return {
    min: sorted[0] ?? 0,
    avg: Math.round(sum / sorted.length),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const CUE_CARD_QUESTIONS = [
  "请介绍你在 AI 产品中如何做用户增长？",
  "讲一个你主导的从 0 到 1 的 AI 功能落地项目。",
  "你如何衡量一个 AI 功能的上线效果？",
  "遇到模型效果不达预期时你会怎么推进？",
  "请描述一次你用数据驱动决策的经历。",
];

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "ai-perf-bench-"));
  const dbPath = join(tempDir, "perf.sqlite");
  const app = buildServer({ dbPath });

  const N = Number(process.env.PERF_SAMPLES ?? 5);
  const THRESHOLD_CUE = Number(process.env.PERF_THRESHOLD_CUE ?? 8000);
  const THRESHOLD_RESUME = Number(process.env.PERF_THRESHOLD_RESUME ?? 8000);
  const remoteModelExpected = Boolean(
    process.env.OPENROUTER_API_KEY?.trim()
      || process.env.GITHUB_MODELS_TOKEN?.trim()
      || process.env.GITHUB_TOKEN?.trim()
      || process.env.DEEPSEEK_API_KEY?.trim(),
  );

  try {
    // 注册 + onboarding + 简历 + 建岗位
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { phone: `139${Date.now().toString().slice(-8)}`, password: "PerfTest123", displayName: "性能测试" },
    });
    const token = register.json().tokens?.accessToken as string;
    if (!token) throw new Error("REGISTER_FAILED");
    const authHeader = { authorization: `Bearer ${token}` };

    await app.inject({
      method: "POST",
      url: "/api/onboarding",
      headers: authHeader,
      payload: { displayName: "性能测试", targetRole: "AI 产品经理", city: "北京", experience: "3-5 年", stage: "准备面试" },
    });

    await app.inject({
      method: "POST",
      url: "/api/profile",
      headers: authHeader,
      payload: {
        displayName: "性能测试",
        resumeText: "3 年 AI 产品经验，主导过智能客服、推荐系统和 A/B 实验平台。熟悉 RAG、LLM 应用和数据分析。",
        evidenceLibrary: [],
        highlights: ["AI 产品经验", "数据分析"],
      },
    });

    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: authHeader,
      payload: {
        rawJdText: [
          "公司名称：字节跳动 | 岗位名称：AI 产品经理",
          "负责 AI 面试产品从 0 到 1，包括用户研究、需求分析、产品设计、增长实验和数据验证。",
          "要求：3 年以上产品经验，有 AI 或 SaaS 背景优先，熟悉 RAG、LLM 应用和 A/B 测试。",
        ].join("\n"),
      },
    });
    const positionId = intake.json().positions?.[0]?.id as string;
    if (!positionId) throw new Error("INTAKE_FAILED");
    console.log(`[setup] 注册+建岗完成 positionId=${positionId}，开始 ${N} 次采样\n`);

    // ===== cue-card 采样 =====
    console.log("=== cue-card 采样 ===");
    const cueSamples: number[] = [];
    const cueStatus: string[] = [];
    const cueProviders: string[] = [];
    const cueFallbackReasons: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const t0 = Date.now();
      const res = await app.inject({
        method: "POST",
        url: "/api/copilot/cue-card/stream",
        headers: authHeader,
        payload: { questionText: CUE_CARD_QUESTIONS[i % CUE_CARD_QUESTIONS.length], positionId, source: "live", enableSearch: false },
      });
      const elapsed = Date.now() - t0;
      const card = extractSseEvent(res.body, "card");
      const latencyMs = card?.meta?.latencyMs ?? elapsed;
      const status = card?.meta?.backendStatus ?? "fallback";
      cueSamples.push(latencyMs);
      cueStatus.push(status);
      cueProviders.push(card?.meta?.provider ?? "unknown");
      if (status === "fallback") cueFallbackReasons.push(card?.meta?.fallbackReason ?? "");
      console.log(`  [${i + 1}/${N}] ${latencyMs}ms (端到端 ${elapsed}ms) status=${status}`);
    }

    // ===== resume-ai 采样 =====
    console.log("\n=== resume-ai 采样 ===");
    const resumeSamples: number[] = [];
    const resumeStatus: string[] = [];
    const resumeProviders: string[] = [];
    const resumeFallbackReasons: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const t0 = Date.now();
      const res = await app.inject({
        method: "POST",
        url: "/api/resume/ai",
        headers: authHeader,
        payload: {
          action: "section",
          sectionTitle: "个人总结",
          currentText: "3 年 AI 产品经验，主导过智能客服和推荐系统。",
          fullResumeText: "3 年 AI 产品经验，主导过智能客服、推荐系统和 A/B 实验平台。熟悉 RAG、LLM 应用和数据分析。",
          positionId,
        },
      });
      const elapsed = Date.now() - t0;
      const body = res.json();
      const latencyMs = body.meta?.latencyMs ?? elapsed;
      const status = body.meta?.backendStatus ?? "fallback";
      resumeSamples.push(latencyMs);
      resumeStatus.push(status);
      resumeProviders.push(body.meta?.provider ?? "unknown");
      if (status === "fallback") resumeFallbackReasons.push(body.meta?.fallbackReason ?? "");
      console.log(`  [${i + 1}/${N}] ${latencyMs}ms (端到端 ${elapsed}ms) status=${status}`);
    }

    // ===== 汇总 + 达标判定 =====
    const cueSum = summarize(cueSamples);
    const resumeSum = summarize(resumeSamples);
    const cueFallbackMarked = cueFallbackReasons.every((reason) => reason.trim().length > 0);
    const resumeFallbackMarked = resumeFallbackReasons.every((reason) => reason.trim().length > 0);
    const cueAllExpected = remoteModelExpected ? cueStatus.every((s) => s === "success") : cueStatus.every((s) => s === "fallback");
    const resumeAllExpected = remoteModelExpected ? resumeStatus.every((s) => s === "success") : resumeStatus.every((s) => s === "fallback");
    const cuePass = cueSum.p95 <= THRESHOLD_CUE && cueAllExpected && cueFallbackMarked;
    const resumePass = resumeSum.p95 <= THRESHOLD_RESUME && resumeAllExpected && resumeFallbackMarked;

    const report = {
      samples: N,
      remoteModelExpected,
      thresholds: { cueCard: THRESHOLD_CUE, resumeAi: THRESHOLD_RESUME },
      cueCard: { ...cueSum, statuses: cueStatus, providers: cueProviders, fallbackMarked: cueFallbackMarked, pass: cuePass, threshold: THRESHOLD_CUE },
      resumeAi: { ...resumeSum, statuses: resumeStatus, providers: resumeProviders, fallbackMarked: resumeFallbackMarked, pass: resumePass, threshold: THRESHOLD_RESUME },
      overallPass: cuePass && resumePass,
    };

    console.log("\n========== 性能基准报告 ==========");
    console.log(JSON.stringify(report, null, 2));
    console.log("==================================");
    console.log(`\n总结：cue-card P95=${cueSum.p95}ms (${cuePass ? "PASS" : "FAIL"}, 阈值 ${THRESHOLD_CUE}ms)`);
    console.log(`      resume-ai P95=${resumeSum.p95}ms (${resumePass ? "PASS" : "FAIL"}, 阈值 ${THRESHOLD_RESUME}ms)`);
    console.log(`      总体：${report.overallPass ? "PASS ✅" : "FAIL ❌"}`);

    if (!report.overallPass) {
      console.log("\n注意：未达标。可尝试设置 DEEPSEEK_MODEL=deepseek-chat 切换非 reasoning 快速模型，或调整 PERF_THRESHOLD_* 阈值。");
      process.exitCode = 1;
    }
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("[ai-perf-bench] 失败：", error);
  process.exit(1);
});
