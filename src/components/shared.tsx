import { useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { AiRunMeta } from "../lib/apiClient";
import { apiFetch } from "../lib/authClient";
import { prioritizeEvidenceForJob } from "../lib/interviewEngine";
import { notify } from "../lib/toast";
import type { AnswerCueCard, CandidateProfile, Position } from "../types";
import type { AiProgressItem, AiStatusKind } from "./sharedConfig";
import { QuotaBadge } from "./shared/QuotaBadge";

export function ContextStack({ profile, position }: { profile: CandidateProfile; position: Position }) {
  const evidence = prioritizeEvidenceForJob(profile.resume, position.job, profile.evidenceLibrary);
  const displayedEvidence = evidence.slice(0, 3);

  return (
    <div className="context-stack">
      <article>
        <span>当前岗位</span>
        <strong>{position.title}</strong>
        <p>
          {position.company} · 匹配度 {position.matchReport.score}/100
        </p>
      </article>
      {displayedEvidence.map((item) => (
        <article key={item.id}>
          <span>{item.type}</span>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

export function CueCardPanel({ card, meta, onSaveQuestion }: { card?: AnswerCueCard; meta?: AiRunMeta | null; onSaveQuestion: (card: AnswerCueCard) => void }) {
  if (!card) {
    return (
      <Panel title="提词卡" className="cue-panel">
        <EmptyState title="等待问题" detail="输入问题、语音转写或点击生成后，这里会给出开场句、核心点、证据和风险提醒。" />
      </Panel>
    );
  }

  const status = meta?.backendStatus ?? "fallback";
  const evidence = meta?.evidenceTrace?.length
    ? meta.evidenceTrace.map((item) => item.title)
    : card.evidenceIds.length
      ? card.evidenceIds
      : ["暂无显式证据命中，回答时请主动补充真实项目数据。"];
  const modelLabel = status === "success" ? "模型生成" : `本地练习 · ${meta?.fallbackReason || "请仅引用你能确认的真实经历与数据"}`;

  return (
    <Panel title="提词卡" className="cue-panel">
      <article className="cue-card">
        <header className="cue-card-head">
          <div>
            <span className="cue-card-kicker">{card.source === "live" ? "实时问题" : "模拟问题"}</span>
            <h2>{card.questionText}</h2>
          </div>
          <AiStatusBadge status={status === "success" ? "success" : "fallback"} />
        </header>
        {meta?.fallbackReason ? <div className="inline-message">{meta.fallbackReason}</div> : null}
        {status !== "success" ? <div className="inline-message warn">当前为练习模式结果，请只引用你能确认的真实经历与数据。</div> : null}
        <div className="cue-section-grid cue-section-grid--stacked">
          <section className="cue-section">
            <span className="cue-section-label">核心要点</span>
            <ol className="cue-points">{card.bullets.slice(0, 3).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
          </section>
          <section className="cue-opener">
            <span className="cue-section-label">开场句</span>
            <p className="cue-opener-text">{card.openingLine || "先用一句话给出结论，再展开关键动作和结果。"}</p>
          </section>
          <section className="cue-section cue-section-strategy">
            <span className="cue-section-label">回答框架</span>
            <strong>{card.strategy || "STAR 法：背景、动作、结果、复盘"}</strong>
          </section>
          {meta?.evidenceTrace?.length ? <EvidenceTrace trace={meta.evidenceTrace} /> : (
            <section className="cue-section cue-evidence">
              <span className="cue-section-label">证据命中</span>
              <ul className="cue-evidence-list">{evidence.slice(0, 4).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
            </section>
          )}
          {card.risks.length ? (
            <section className="cue-risks">
              <span className="cue-section-label cue-section-label--warn">注意</span>
              {card.risks.map((item, index) => <p key={`${item}-${index}`} className="cue-risk-item">{item}</p>)}
            </section>
          ) : null}
          {card.followUps.length ? (
            <section className="cue-followups">
              <span className="cue-section-label">追问预测</span>
              <ul>{card.followUps.map((item, index) => <li key={`${item}-${index}`} className="cue-followup-item">{item}</li>)}</ul>
            </section>
          ) : null}
        </div>

        <footer className="cue-card-actions">
          <span className="cue-meta">{modelLabel}{meta?.latencyMs ? ` · ${meta.latencyMs}ms` : ""}</span>
          <CueCardRating card={card} meta={meta} />
          <button className="button secondary compact-button" type="button" onClick={() => onSaveQuestion(card)}>
            记录到面试资料
          </button>
        </footer>
      </article>
    </Panel>
  );
}

function CueCardRating({ card, meta }: { card: AnswerCueCard; meta?: AiRunMeta | null }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const rate = (value: "up" | "down") => {
    if (rating) return;
    setRating(value);
    // 采集用户对提词卡的认可度，作为 AI 输出质量评估的上游信号（复用 /api/feedback）。
    void apiFetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "cue-card-rating",
        content: JSON.stringify({
          rating: value,
          skill: meta?.skillId ?? "cueCard",
          promptId: meta?.promptId ?? "",
          backendStatus: meta?.backendStatus ?? "fallback",
          question: card.questionText,
        }),
      }),
    }).catch(() => undefined);
    notify(value === "up" ? "感谢反馈，已记录这张卡片有帮助" : "感谢反馈，我们会持续改进", "success");
  };
  return (
    <span className="cue-rating-bar">
      <span className="cue-rating-label">有帮助？</span>
      <span className="cue-rating-actions">
        <button type="button" className={`cue-rating-button${rating === "up" ? " active" : ""}`} aria-label="有帮助" aria-pressed={rating === "up"} disabled={rating !== null} onClick={() => rate("up")}>
          <ThumbsUp size={14} />
        </button>
        <button type="button" className={`cue-rating-button${rating === "down" ? " active" : ""}`} aria-label="没帮助" aria-pressed={rating === "down"} disabled={rating !== null} onClick={() => rate("down")}>
          <ThumbsDown size={14} />
        </button>
      </span>
    </span>
  );
}

export function AiStatusBadge({ status }: { status: AiStatusKind }) {
  const label = status === "success" ? "模型生成" : status === "generating" ? "生成中..." : status === "error" ? "请求失败" : "本地练习";
  return (
    <span className={`ai-status-badge ${status}`} aria-label={`AI 状态：${label}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

export function AiProgressPanel({ items, onCancel }: { items: AiProgressItem[]; onCancel?: () => void }) {
  if (!items.length) return null;
  const latest = items.at(-1);
  return (
    <div className="ai-progress-panel" aria-live="polite">
      <div className="ai-progress-head">
        <span>{latest?.label ?? "AI 正在处理"}</span>
        {onCancel ? (
          <button className="text-button" type="button" onClick={onCancel}>
            取消
          </button>
        ) : null}
      </div>
      <div className="ai-progress-steps">
        {items.slice(-4).map((item) => (
          <div className={`ai-progress-step ${item.status ?? "running"}`} key={item.id}>
            <span aria-hidden="true" />
            <p>{item.label}</p>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EvidenceTrace({ trace }: { trace: Array<{ id: string; title: string; reason: string; synthetic?: boolean }> }) {
  return (
    <section className="evidence-trace">
      <strong>证据命中</strong>
      <div className="trace-list">
        {trace.map((item) => (
          <article key={item.id}>
            <span>{item.synthetic ? `${item.title} · 练习推断` : item.title}</span>
            <p>{item.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MetricCard({ label, value, suffix, detail, icon: Icon }: { label: string; value: string; suffix?: string; detail?: string; icon?: LucideIcon }) {
  return (
    <article className="metric-card">
      {Icon ? <Icon size={16} /> : null}
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        {suffix ? <small>{suffix}</small> : null}
      </div>
      {detail ? <p>{detail}</p> : null}
    </article>
  );
}

export function MetricGrid({ items }: { items: Array<{ label: string; value: string; tone?: "green" | "default" }> }) {
  return (
    <div className="metrics-grid compact">
      {items.map((item) => (
        <article key={item.label} className={item.tone === "green" ? "metric-card metric-green" : "metric-card"}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </article>
      ))}
    </div>
  );
}

export function QuestionCard({ category, question, intent, evidence }: { category: string; question: string; intent: string; evidence?: string }) {
  return (
    <article className="question-card">
      <span className="question-card-tag">{category}</span>
      <h2>{question}</h2>
      <p>{intent}</p>
      {evidence ? <small>{evidence}</small> : null}
    </article>
  );
}

export function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`.trim()}>
      <header>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function EditorHeader({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div className="header-icon">
        <Icon size={20} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

export { QuotaBadge };
