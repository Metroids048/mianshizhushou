import { useState, type ChangeEvent } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { apiFetch } from "../../lib/authClient";
import { importResumeFile } from "../../lib/resumeImport";
import { navigateTo } from "../../lib/router";
import type { OnboardingPayload, Position } from "../../types";
import { Seo } from "../system/Seo";

interface Step {
  key: string;
  title: string;
  field: string;
  placeholder?: string;
  options?: string[];
}

const STEPS: Step[] = [
  { key: "targetRole", title: "目标岗位", field: "targetRole", placeholder: "例如：产品经理、前端工程师..." },
  { key: "city", title: "目标城市", field: "city", placeholder: "例如：北京、上海、远程...", options: ["北京", "上海", "深圳", "杭州", "广州", "成都", "远程"] },
  { key: "experience", title: "工作经验", field: "experience", options: ["应届生", "1-3 年", "3-5 年", "5-10 年", "10 年以上"] },
  { key: "stage", title: "求职阶段", field: "stage", options: ["正在投递", "准备面试", "已有 Offer", "观望中"] },
  { key: "resume", title: "简历导入", field: "resumeText", placeholder: "粘贴简历文字或点击下方上传（支持 .docx / .pdf）" },
];

interface OnboardingResponse {
  ok: boolean;
  profile: Record<string, unknown>;
  position?: Position;
  nextStep: "intake_jd" | "import_resume" | "start_mock";
}

export function OnboardingPage({
  onComplete,
}: {
  onComplete?: (position?: Position) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [nextStep, setNextStep] = useState<"intake_jd" | "import_resume" | "start_mock">("intake_jd");

  const step = STEPS[stepIndex];
  if (!step) return null;

  const setValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleResumeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importResumeFile(file);
      setValue("resumeText", imported.text);
      setSubmitError("");
    } catch {
      setSubmitError("简历解析失败，请尝试直接粘贴文字。");
    } finally {
      event.target.value = "";
    }
  };

  const next = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      void submitOnboarding();
    }
  };

  const prev = () => {
    if (stepIndex > 0) setStepIndex((prev) => prev - 1);
  };

  const submitOnboarding = async () => {
    const payload: OnboardingPayload = {
      targetRole: values.targetRole || undefined,
      city: values.city || undefined,
      experience: values.experience || undefined,
      stage: values.stage || undefined,
      resumeText: values.resumeText || undefined,
      entryPath: "onboarding",
    };
    try {
      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as OnboardingResponse;
      if (data.nextStep) setNextStep(data.nextStep);
      onComplete?.(data.position);
    } catch {
      setSubmitError("引导信息提交失败，请检查网络后重试。");
      return;
    }
    setSubmitError("");
    setDone(true);
  };

  const handleSkip = async () => {
    // Submit minimal onboarding
    try {
      await apiFetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryPath: "skip" }),
      });
    } catch {
      // Best effort
    }
    onComplete?.();
    setDone(true);
  };

  const nextStepHint: Record<string, string> = {
    intake_jd: "下一步建议：粘贴目标岗位 JD，系统会为你分析岗位要求并生成面试题。",
    import_resume: "下一步建议：导入简历，让 AI 帮你提炼证据库并匹配岗位。",
    start_mock: "下一步建议：直接进入模拟面试，体验 AI 面试官。",
  };

  if (done) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card onboarding-done">
          <div className="onboarding-done-icon">
            <Check size={32} />
          </div>
          <h2 className="onboarding-done-title">准备就绪</h2>
          <p className="onboarding-done-text">
            {nextStepHint[nextStep] || "现在可以创建你的第一个岗位，开始面试练习。"}
          </p>
          <button type="button" className="onboarding-done-btn" onClick={() => navigateTo(nextStep === "import_resume" ? "/resume" : nextStep === "start_mock" ? "/mock" : "/", { replace: true })}>
            {nextStep === "import_resume" ? "去导入简历" : nextStep === "start_mock" ? "开始模拟面试" : "进入岗位台"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const selectedOptions = step.options || [];
  const currentValue = values[step.field] || "";

  return (
    <div className="onboarding-page">
      <Seo title="欢迎使用 | AI 求职台" description="用 1 分钟完成首次设置，快速进入你的面试准备主线。" />
      <div className="onboarding-card">
        <p className="onboarding-kicker">首次进入</p>
        <div className="onboarding-progress">
          {STEPS.map((_, index) => (
            <div key={index} className={`onboarding-dot ${index <= stepIndex ? "active" : ""}`} />
          ))}
        </div>

        <h1 className="onboarding-step-title">{step.title}</h1>
        <p className="onboarding-step-copy">
          {step.key === "targetRole" ? "先告诉我们你的目标方向，后面的 JD 分析和题目生成会更贴近你的求职目标。" :
            step.key === "resume" ? "粘贴简历后，我们会优先帮你抽取证据素材、问题库和提词卡上下文。" :
              "这些信息会帮助系统为你生成更贴近真实场景的模拟面试。"}
        </p>

        {selectedOptions.length > 0 ? (
          <div className="onboarding-options">
            {selectedOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`onboarding-option ${currentValue === opt ? "selected" : ""}`}
                onClick={() => setValue(step.field, currentValue === opt ? "" : opt)}
              >
                {opt}
                {currentValue === opt && <Check size={14} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="onboarding-input-wrap">
            <textarea
              className="onboarding-textarea"
              placeholder={step.placeholder || ""}
              rows={step.key === "resume" ? 8 : 2}
              value={currentValue}
              onChange={(e) => setValue(step.field, e.target.value)}
            />
            {step.key === "resume" ? (
              <label className="onboarding-upload-btn">
                上传简历文件（.pdf / .docx / .txt）
                <input type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={handleResumeUpload} />
              </label>
            ) : null}
          </div>
        )}

        <div className="onboarding-actions">
          {stepIndex > 0 && (
            <button type="button" className="onboarding-btn secondary" onClick={prev}>
              <ArrowLeft size={16} />
              上一步
            </button>
          )}
          <button type="button" className="onboarding-btn primary" onClick={next}>
            {stepIndex < STEPS.length - 1 ? "下一步" : "开始使用"}
            <ArrowRight size={16} />
          </button>
        </div>

        {submitError ? <p className="auth-error" style={{ marginTop: 12, textAlign: "center" }}>{submitError}</p> : null}

        <button type="button" className="onboarding-skip" onClick={handleSkip}>
          跳过引导，直接开始
        </button>
      </div>
    </div>
  );
}
