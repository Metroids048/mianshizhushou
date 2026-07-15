import { FileSearch, Sparkles } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { repairText } from "../lib/copy";
import type { CandidateProfile, InterviewRecord, Position, WorkspaceState } from "../types";
import { AuthGateCard } from "./auth/AuthGate";

function compactItems(items: string[], fallback: string): string[] {
  const cleaned = items.map(repairText).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function buildQuestions(workspace: WorkspaceState, position: Position, records: InterviewRecord[]): string[] {
  const fromPriority = workspace.questions
    .filter((item) => item.priority)
    .slice(0, 5)
    .map((item) => repairText(item.question));
  const fromMaterials = position.materials
    .slice(0, 4)
    .map((item) => `结合「${repairText(item.title)}」，请说明你在其中的决策、指标和复盘。`);
  const fromRecords = records
    .flatMap((record) => record.transcript.filter((item) => item.role === "interviewer").map((item) => repairText(item.text)))
    .slice(0, 3);

  return compactItems(
    Array.from(new Set([...fromPriority, ...fromMaterials, ...fromRecords])).slice(0, 8),
    `请结合 ${repairText(workspace.job.title) || "当前岗位"} 介绍一段最匹配的项目经历。`,
  );
}

export function JdWorkspace({
  workspace,
  profile,
  position,
  records,
  onSubmitJd,
  onCreateQuestions,
  isLoggedIn,
  onRequireLogin,
}: {
  workspace: WorkspaceState | null;
  profile: CandidateProfile;
  position?: Position;
  records: InterviewRecord[];
  onSubmitJd: (jobText: string) => void;
  onCreateQuestions: (items: Array<{ question: string; category: string; difficulty: string; notes?: string }>) => void;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}) {
  const [draft, setDraft] = useState(workspace?.jobText ?? "");
  const [savedMessage, setSavedMessage] = useState("");

  const currentRecords = useMemo(
    () => (position ? records.filter((record) => record.positionId === position.id) : []),
    [position, records],
  );

  const analysis = useMemo(() => {
    if (!workspace || !position) return null;
    return {
      likelyQuestions: buildQuestions(workspace, position, currentRecords),
      focus: compactItems(
        [
          ...workspace.job.hardSkills.slice(0, 4).map((item) => `补强 ${repairText(item)} 的项目证据`),
          ...workspace.matchReport.gaps.filter((gap) => gap.type !== "match").slice(0, 3).map((gap) => `${repairText(gap.label)}：${repairText(gap.description)}`),
          ...position.analysisContext.priorityFocus,
        ].slice(0, 8),
        "把回答主动贴回 JD 关键词，并准备可量化项目结果。",
      ),
      context: [
        `JD：${repairText(workspace.job.title) || "当前岗位"}，关键词 ${workspace.job.keywords.slice(0, 6).map(repairText).join(" / ") || "待补充"}`,
        `简历：${profile.evidenceLibrary.slice(0, 3).map((item) => repairText(item.title)).join(" / ") || "暂无结构化证据"}`,
        `面试资料：${position.materials.slice(0, 4).map((item) => repairText(item.title)).join(" / ") || "暂无岗位资料卡"}`,
        `记录问题：${workspace.questions.filter((item) => item.priority).length} 个重点题，${workspace.questions.length} 个总题目`,
        `历史面试记录：${currentRecords.length} 条`,
      ],
      materialHits: compactItems(position.analysisContext.materialHighlights, "暂无资料命中，建议先去「面试资料」补项目卡或上传文件。"),
    };
  }, [workspace, position, profile.evidenceLibrary, currentRecords]);

  const submitJd = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    onSubmitJd(draft.trim());
  };

  const saveLikelyQuestions = () => {
    if (!analysis) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    onCreateQuestions(
      analysis.likelyQuestions.slice(0, 6).map((question) => ({
        question,
        category: question.includes("项目") ? "项目深挖" : "岗位匹配",
        difficulty: "进阶",
        notes: "来自 JD 分析：综合 JD、简历、面试资料、记录问题和历史面试记录生成。",
      })),
    );
    setSavedMessage("已把高频问题记录到当前岗位的面试资料。");
  };

  return (
    <section className="page page-jd desktop-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">JD 分析</span>
          <h1>围绕当前岗位准备重点</h1>
          <p>综合 JD、简历、面试资料、记录问题和历史面试记录，判断可能会问什么，以及该重点准备什么。</p>
        </div>
      </header>

      {workspace && position && analysis ? (
        <div className="jd-prep-layout">
          {!isLoggedIn ? <AuthGateCard onLogin={onRequireLogin} /> : null}
          <section className="surface-card jd-left-column">
            <div className="surface-card-inner">
              <div className="section-row-header">
                <div>
                  <span className="subtle-label">JD 原文</span>
                  <h2>{repairText(position.company)} · {repairText(position.title)}</h2>
                </div>
              </div>
              <form className="drawer-form inline-form" onSubmit={submitJd}>
                <textarea className="input textarea tall" value={draft} aria-label="JD 文本" onChange={(event) => setDraft(event.target.value)} placeholder="粘贴当前岗位 JD，更新后分析会同步刷新。" />
                <div className="drawer-actions">
                  <button className="button primary" type="submit" disabled={!draft.trim()}>
                    更新分析
                  </button>
                </div>
              </form>

              <section className="jd-compact-section">
                <span className="subtle-label">解析摘要</span>
                <div className="jd-context-grid">
                  {analysis.context.map((item, index) => (
                    <article key={`${item}-${index}`}>{item}</article>
                  ))}
                </div>
              </section>
            </div>
          </section>

          <section className="surface-card jd-right-column">
            <div className="surface-card-inner">
              <div className="section-row-header">
                <div>
                  <span className="subtle-label">准备重点</span>
                  <h2>右侧只保留面试可用信息</h2>
                </div>
                <button className="button secondary" type="button" onClick={saveLikelyQuestions}>
                  保存为记录问题
                </button>
              </div>

              {savedMessage ? <div className="inline-message success">{savedMessage}</div> : null}

              <section className="jd-compact-section">
                <span className="subtle-label">优先补强</span>
                <ul className="simple-list">
                  {analysis.focus.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <Sparkles size={16} />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="jd-compact-section">
                <span className="subtle-label">可能问题</span>
                <div className="jd-question-list">
                  {analysis.likelyQuestions.map((item, index) => (
                    <article key={`${item}-${index}`} className="jd-question-item">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{item}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="jd-compact-section">
                <span className="subtle-label">资料命中</span>
                <ul className="simple-list">
                  {analysis.materialHits.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
          </section>
        </div>
      ) : (
        <div className="empty-card compact">
          <div className="empty-card-icon">
            <FileSearch size={18} />
          </div>
          <div>
            <h2>先在首页生成一个岗位卡</h2>
            <p>有了当前岗位后，这里会集中分析可能问题、准备重点、资料命中和简历证据差距。</p>
          </div>
        </div>
      )}
    </section>
  );
}
