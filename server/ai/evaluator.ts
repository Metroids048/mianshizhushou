/**
 * 模型输出自评估引擎 (Model Output Self-Evaluator)
 *
 * 在任何 AI 模型产出后，用同一模型二次评估输出质量。
 * 评估维度：结构完整性、证据接地性、Guardrail 合规、内容相关性。
 *
 * 设计原则（映射 Prompt Spec §3.1 模板）：
 * - 不依赖外部知识
 * - 输出 JSON schema
 * - 失败时 fallback 为规则评分
 */
import type { AiMessage, AiProvider } from "./provider";

// ---------- 评估维度 ----------
export interface EvalDimensions {
  structureCompleteness: number;  // 0-100 结构完整度
  evidenceGrounding: number;      // 0-100 证据接地性（evidenceIds 是否真实存在）
  guardrailCompliance: number;    // 0-100 guardrail 合规度（是否编造/越界）
  contentRelevance: number;       // 0-100 内容与输入相关性
}

export interface EvalResult {
  overallScore: number;           // 0-100 综合分
  dimensions: EvalDimensions;
  issues: string[];               // 发现的问题
  suggestedAction: "pass" | "warn" | "fallback";
  grounded: boolean;              // evidence 是否可追溯
  rawEval: string;                // 模型原始评估输出
  latencyMs: number;
  backendStatus: "success" | "fallback" | "error";
}

export interface EvalInput {
  skillName: string;              // e.g. "cue-card", "mock-decision", "resume-ai"
  modelOutput: Record<string, unknown>; // 模型实际产出
  expectedSchema: string[];       // 期望的字段列表
  evidenceIds: string[];           // 输出中引用的证据 ID
  availableEvidenceIds: string[];  // 系统中真实存在的证据 ID
  guardrailChecks: string[];       // guardrail 规则（可读文本）
  inputSummary: string;            // 输入上下文摘要
}

// ---------- 本地规则评分（fallback） ----------
function ruleBasedEval(input: EvalInput): EvalDimensions {
  const output = input.modelOutput;

  // 结构完整性
  const presentFields = input.expectedSchema.filter((f) => output[f] !== undefined && output[f] !== null && output[f] !== "");
  const structureScore = Math.round((presentFields.length / Math.max(input.expectedSchema.length, 1)) * 100);

  // 证据接地性
  const claimedIds = input.evidenceIds.length;
  const realIds = input.availableEvidenceIds;
  const groundedIds = claimedIds ? input.evidenceIds.filter((id) => realIds.includes(id)).length : 0;
  const evidenceScore = claimedIds > 0
    ? Math.round((groundedIds / claimedIds) * 100)
    : (input.skillName === "cue-card" ? 60 : 80); // 无证据时根据 skill 类型给基础分

  // Guardrail 合规 — 检查是否含编造标志
  const guardrailScore = checkGuardrails(output, input.guardrailChecks);

  // 内容相关性 — 检查输出是否与输入相关
  const relevanceScore = checkRelevance(output, input.inputSummary);

  return {
    structureCompleteness: clamp(structureScore),
    evidenceGrounding: clamp(evidenceScore),
    guardrailCompliance: clamp(guardrailScore),
    contentRelevance: clamp(relevanceScore),
  };
}

function checkGuardrails(output: Record<string, unknown>, checks: string[]): number {
  if (!checks.length) return 90;
  let passed = 0;
  const outputStr = JSON.stringify(output).toLowerCase();

  for (const check of checks) {
    const lower = check.toLowerCase();
    // 简单的规则匹配：检查输出是否违反了 guardrail
    if (lower.includes("不编造") || lower.includes("不伪造")) {
      // 检查输出中是否有典型的编造标志
      const fabricationMarkers = ["我们团队", "我负责", "我们公司"];
      const hasMarkers = fabricationMarkers.some((m) => outputStr.includes(m));
      if (!hasMarkers || outputStr.length < 20) passed++;
    } else {
      passed++; // 无法自动检查的规则默认通过
    }
  }
  return Math.round((passed / checks.length) * 100);
}

function checkRelevance(output: Record<string, unknown>, inputSummary: string): number {
  if (!inputSummary) return 70;
  const outputStr = JSON.stringify(output).toLowerCase();
  const inputWords = inputSummary.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (!inputWords.length) return 70;
  const matchCount = inputWords.filter((w) => outputStr.includes(w)).length;
  return Math.round((matchCount / inputWords.length) * 100);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------- 模型评估 ----------
const EVAL_SYSTEM_PROMPT = `你是「AI 求职台」输出质量评估器。请评估以下 AI 模型输出。

评估规则：
1. 结构完整性：输出是否包含所有期望字段，字段值是否非空/有效
2. 证据接地性：引用的 evidenceIds 是否可能在真实系统中存在（检查 ID 格式）
3. Guardrail 合规：输出是否编造数据、夸大、把推测写成事实
4. 内容相关性：输出是否与输入上下文相关

评分标准：0-100
- 90-100: 优秀，无问题
- 70-89: 良好，有小问题可接受
- 50-69: 一般，需要优化
- 0-49: 差，建议 fallback

对于每个发现的 issue，说明它违反了哪条 guardrail。
只返回 JSON，不要解释。`;

interface ModelEvalJson {
  structureCompleteness: number;
  evidenceGrounding: number;
  guardrailCompliance: number;
  contentRelevance: number;
  issues: string[];
  overallScore: number;
  grounded: boolean;
  suggestedAction: "pass" | "warn" | "fallback";
}

export async function evaluateWithModel(
  provider: AiProvider,
  input: EvalInput,
): Promise<EvalResult> {
  const started = Date.now();

  // 先做本地规则评估作为 fallback
  const localDims = ruleBasedEval(input);
  const localOverall = Math.round(
    (localDims.structureCompleteness * 0.25 +
      localDims.evidenceGrounding * 0.35 +
      localDims.guardrailCompliance * 0.25 +
      localDims.contentRelevance * 0.15)
  );

  const localFallback: EvalResult = {
    overallScore: isNaN(localOverall) ? 50 : localOverall,
    dimensions: localDims,
    issues: input.expectedSchema.filter((f) => !(input.modelOutput[f]))
      .map((f) => `缺少期望字段: ${f}`),
    suggestedAction: localOverall >= 70 ? "pass" : localOverall >= 50 ? "warn" : "fallback",
    grounded: localDims.evidenceGrounding >= 50,
    rawEval: "RULE_BASED_FALLBACK",
    latencyMs: Date.now() - started,
    backendStatus: "fallback",
  };

  if (provider.model === "local-fallback") {
    return localFallback;
  }

  try {
    const userMessage = JSON.stringify({
      skill: input.skillName,
      modelOutput: input.modelOutput,
      expectedSchema: input.expectedSchema,
      evidenceIdsClaimed: input.evidenceIds,
      guardrailChecks: input.guardrailChecks,
      inputContext: input.inputSummary.slice(0, 600),
    });

    const messages: AiMessage[] = [
      { role: "system", content: EVAL_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const result = await provider.chatJson<ModelEvalJson>(
      messages,
      {
        structureCompleteness: localDims.structureCompleteness,
        evidenceGrounding: localDims.evidenceGrounding,
        guardrailCompliance: localDims.guardrailCompliance,
        contentRelevance: localDims.contentRelevance,
        issues: localFallback.issues,
        overallScore: localOverall,
        grounded: localFallback.grounded,
        suggestedAction: localFallback.suggestedAction,
      },
      { temperature: 0.1, schemaHint: JSON.stringify({ structureCompleteness: 0, evidenceGrounding: 0, guardrailCompliance: 0, contentRelevance: 0, issues: [], overallScore: 0, grounded: false, suggestedAction: "warn" }) },
    );

    const dims: EvalDimensions = {
      structureCompleteness: clamp(result.data.structureCompleteness ?? localDims.structureCompleteness),
      evidenceGrounding: clamp(result.data.evidenceGrounding ?? localDims.evidenceGrounding),
      guardrailCompliance: clamp(result.data.guardrailCompliance ?? localDims.guardrailCompliance),
      contentRelevance: clamp(result.data.contentRelevance ?? localDims.contentRelevance),
    };

    const weightedScore = (dims.structureCompleteness * 0.25 + dims.evidenceGrounding * 0.35 + dims.guardrailCompliance * 0.25 + dims.contentRelevance * 0.15);
    const overall = clamp((result.data.overallScore ?? 0) > 0 ? result.data.overallScore : weightedScore);

    return {
      overallScore: overall,
      dimensions: dims,
      issues: Array.isArray(result.data.issues) ? result.data.issues : localFallback.issues,
      suggestedAction: validAction(result.data.suggestedAction) ?? (overall >= 70 ? "pass" : overall >= 50 ? "warn" : "fallback"),
      grounded: result.data.grounded ?? dims.evidenceGrounding >= 50,
      rawEval: result.raw,
      latencyMs: Date.now() - started,
      backendStatus: result.status,
    };
  } catch {
    return localFallback;
  }
}

function validAction(a: string): "pass" | "warn" | "fallback" | null {
  if (a === "pass" || a === "warn" || a === "fallback") return a;
  return null;
}

export function quickEval(input: EvalInput): EvalDimensions {
  return ruleBasedEval(input);
}
