import { ArrowRight, BookOpenCheck, FileText, Plus, Upload } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";
import { importResumeFile } from "../lib/resumeImport";
import type { CandidateProfile, EvidenceItem, InterviewQuestion, WorkspaceState } from "../types";
import { EditorHeader } from "./shared";
import {
  buildResumeSections,
  buildResumeSuggestion,
  DEFAULT_CONFIG,
  resolveEvidenceType,
  sectionsToDrafts,
  type InterviewConfig,
  type ResumeChatMessage,
  type ResumeSectionId,
} from "./sharedConfig";
import { makeId } from "../lib/ids";

export function ContextWorkspace({
  workspace,
  profile,
  onSubmit,
  onMock,
  onUpdateQuestion,
  onAddQuestion,
  onUpdateResume,
  onUpdateEvidence,
  onSetHighlights,
  onLive,
}: {
  workspace: WorkspaceState | null;
  profile: CandidateProfile;
  onSubmit: (jobText: string) => void;
  onMock: (config?: InterviewConfig) => void;
  onUpdateQuestion: (questionId: string, patch: Partial<InterviewQuestion>) => void;
  onAddQuestion: (question: Pick<InterviewQuestion, "question" | "category" | "difficulty">) => void;
  onUpdateResume: (resumeText: string) => void;
  onUpdateEvidence: (items: EvidenceItem[]) => void;
  onSetHighlights: (highlights: string[]) => void;
  onLive: () => void;
}) {
  const [tab, setTab] = useState<"jd" | "questions" | "resume">("jd");
  return (
    <section className="page-section context-workspace">
      <EditorHeader
        icon={FileText}
        title="上下文资料"
        description="这里准备 JD、简历证据和问题库。它们是实时助手的弹药库，不是独立工作台。"
        action={<button className="button primary" onClick={onLive}>回到实时助手</button>}
      />
      <div className="context-tabs" role="tablist" aria-label="上下文资料">
        <button className={tab === "jd" ? "active" : ""} onClick={() => setTab("jd")}>JD 与岗位卡</button>
        <button className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")} disabled={!workspace}>问题库</button>
        <button className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}>简历证据</button>
      </div>
      {tab === "jd" && (
        <ContextJdTab workspace={workspace} profile={profile} onSubmit={onSubmit} onLive={onLive} onMock={onMock} />
      )}
      {tab === "questions" && workspace && (
        <QuestionBankView workspace={workspace} onUpdateQuestion={onUpdateQuestion} onAddQuestion={onAddQuestion} onMock={() => onMock()} onLive={onLive} />
      )}
      {tab === "resume" && (
        <ResumeWorkspace profile={profile} onUpdateResume={onUpdateResume} onUpdateEvidence={onUpdateEvidence} onSetHighlights={onSetHighlights} compact />
      )}
    </section>
  );
}

function ContextJdTab({
  workspace,
  profile,
  onSubmit,
  onLive,
  onMock,
}: {
  workspace: WorkspaceState | null;
  profile: CandidateProfile;
  onSubmit: (jobText: string) => void;
  onLive: () => void;
  onMock: (config?: InterviewConfig) => void;
}) {
  const [draft, setDraft] = useState(workspace?.jobText ?? "");

  return (
    <section className="context-jd-tab">
      <div className="context-jd-main">
        <section className="context-jd-card">
          <header>
            <div>
              <span>JD 分析</span>
              <h2>{workspace?.job.title ?? "待分析岗位"}</h2>
            </div>
            <button className="button secondary" type="button" onClick={() => draft.trim() && onSubmit(draft.trim())} disabled={!draft.trim()}>
              更新分析
            </button>
          </header>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="JD 文本" placeholder="在这里维护岗位 JD，分析结果会同步更新到岗位卡、实时助手和模拟面试。" />
        </section>

        <section className="context-jd-card">
          <header>
            <div>
              <span>关键词与要求</span>
              <h2>当前岗位摘要</h2>
            </div>
          </header>
          {workspace ? (
            <div className="context-jd-columns">
              <article>
                <strong>技能关键词</strong>
                <div className="position-pill-row">
                  {workspace.job.hardSkills.concat(workspace.job.softSkills).slice(0, 10).map((item) => (
                    <span key={item} className="position-pill">
                      {item}
                    </span>
                  ))}
                </div>
              </article>
              <article>
                <strong>岗位要求</strong>
                <ul>
                  {(workspace.job.responsibilities.length ? workspace.job.responsibilities : workspace.job.keywords).slice(0, 6).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
          ) : (
            <p className="context-jd-empty">先在岗位台或这里粘贴 JD，系统才会生成岗位分析。</p>
          )}
        </section>
      </div>

      <aside className="context-jd-side">
        <section className="context-jd-card">
          <span>候选素材</span>
          <strong>{profile.evidenceLibrary.length} 条简历证据</strong>
          <p>JD、简历证据和问题库会在实时助手与模拟面试中按需调用，不再占用主流程页面。</p>
        </section>
        <section className="context-jd-card">
          <span>快速入口</span>
          <div className="side-actions">
            <button className="button primary" type="button" onClick={onLive} disabled={!workspace}>
              进入实时助手
            </button>
            <button className="button secondary" type="button" onClick={() => onMock(DEFAULT_CONFIG)} disabled={!workspace}>
              进入模拟练习
            </button>
          </div>
        </section>
      </aside>
    </section>
  );
}

export function ResumeWorkspace({
  profile,
  onUpdateResume,
  onUpdateEvidence,
  onSetHighlights,
  compact = false,
}: {
  profile: CandidateProfile;
  onUpdateResume: (resumeText: string) => void;
  onUpdateEvidence: (items: EvidenceItem[]) => void;
  onSetHighlights: (highlights: string[]) => void;
  compact?: boolean;
}) {
  const sections = buildResumeSections(profile);
  const [selectedSectionId, setSelectedSectionId] = useState<ResumeSectionId>("highlights");
  const [sectionDrafts, setSectionDrafts] = useState<Record<ResumeSectionId, string>>(() => sectionsToDrafts(sections));
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ResumeChatMessage[]>([{ id: "resume-ai-1", role: "assistant", text: "选择左侧任意简历模块，我可以帮你润色、改成更业务化，或者按当前 JD 生成面试表达。" }]);
  const [fileMessage, setFileMessage] = useState("");
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const evidenceKeywords = Array.from(new Set(profile.evidenceLibrary.flatMap((item) => item.keywords).filter(Boolean))).slice(0, 8);
  const skillKeywords = profile.resume.skills.filter(Boolean).slice(0, 6);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await importResumeFile(file);
      onUpdateResume(result.text);
      setSectionDrafts((current) => ({ ...current, highlights: result.text }));
      setSelectedSectionId("highlights");
      setFileMessage(`已导入 ${file.name}${result.warning ? `，${result.warning}` : ""}`);
    } catch {
      setFileMessage("导入失败：当前支持 TXT、Markdown、PDF、DOCX，也可以复制文本后粘贴。");
    } finally {
      event.target.value = "";
    }
  };

  const optimizeSection = () => {
    const suggestion = buildResumeSuggestion(selectedSection.title, sectionDrafts[selectedSectionId] || selectedSection.content, profile);
    setChatMessages((current) => [...current, { id: makeId("resume-user"), role: "user", text: `优化「${selectedSection.title}」` }, { id: makeId("resume-ai"), role: "assistant", text: "我整理了一版更适合面试和简历筛选的写法，确认后再应用。", sectionId: selectedSectionId, suggestion }]);
  };

  const saveSection = () => {
    const text = sectionDrafts[selectedSectionId].trim();
    if (!text) return;
    if (selectedSectionId === "highlights") {
      onSetHighlights(text.split(/\n+/).map((item) => item.replace(/^[-\d.、\s]+/, "").trim()).filter(Boolean).slice(0, 6));
      return;
    }
    onUpdateEvidence([{ id: makeId("ev-custom"), type: resolveEvidenceType(selectedSectionId), title: selectedSection.title, detail: text, keywords: [], impact: "从简历编辑页手动保存的可复用素材" }, ...profile.evidenceLibrary]);
  };

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    const suggestion = buildResumeSuggestion(selectedSection.title, `${sectionDrafts[selectedSectionId]}\n${text}`, profile);
    setChatMessages((current) => [...current, { id: makeId("resume-user"), role: "user", text }, { id: makeId("resume-ai"), role: "assistant", text: "按你的要求，我生成了可应用到当前模块的版本。", sectionId: selectedSectionId, suggestion }]);
  };

  const applySuggestion = (message: ResumeChatMessage) => {
    if (!message.suggestion || !message.sectionId) return;
    setSelectedSectionId(message.sectionId);
    setSectionDrafts((current) => ({ ...current, [message.sectionId!]: message.suggestion! }));
  };

  return (
    <section className={compact ? "resume-workspace compact" : "resume-workspace"}>
      <aside className="resume-section-nav">
        <header><strong>我的简历</strong><span>AI 帮你打磨每段经历</span></header>
        {sections.map((section) => (
          <button key={section.id} className={selectedSectionId === section.id ? "resume-section-tab active" : "resume-section-tab"} onClick={() => setSelectedSectionId(section.id)}>
            <section.icon size={16} /><span>{section.title}</span>
          </button>
        ))}
        <label className="button secondary file-button"><Upload size={16} />导入已有简历<input type="file" accept=".txt,.md,.markdown,.pdf,.docx" aria-label="导入简历文件" onChange={onFile} /></label>
      </aside>
      <main className="resume-document">
        <div className="resume-profile-card"><div className="resume-avatar">{(profile.displayName || profile.resume.name || "候").slice(0, 1)}</div><div><h1>{profile.displayName || profile.resume.name || "候选人"}</h1><p>{profile.resume.targetRole} · {profile.resume.skills.slice(0, 5).join(" / ")}</p></div></div>
        {profile.evidenceLibrary.length > 0 ? (
          <section className="evidence-preview">
            <div className="evidence-preview-header">
              <span className="evidence-preview-title">AI 已识别的经历证据</span>
              <span className="evidence-count">{profile.evidenceLibrary.length} 条</span>
            </div>
            <div className="evidence-tags">
              {profile.evidenceLibrary.map((item) => <span key={item.id} className="evidence-tag">{item.title}</span>)}
            </div>
            {(evidenceKeywords.length > 0 || skillKeywords.length > 0) ? (
              <div className="evidence-keywords">
                <span className="evidence-kw-label">命中关键词：</span>
                {[...evidenceKeywords, ...skillKeywords.filter((item) => !evidenceKeywords.includes(item))].slice(0, 10).map((item) => (
                  <span key={item} className="evidence-kw-tag">{item}</span>
                ))}
              </div>
            ) : null}
            <p className="evidence-hint">这些内容会作为实时助手和模拟面试的证据底座。如有遗漏，可继续编辑当前模块并保存到简历素材。</p>
          </section>
        ) : null}
        {fileMessage && <div className={fileMessage.startsWith("导入失败") ? "inline-message error" : "inline-message success"}>{fileMessage}</div>}
        <section className="resume-edit-card">
          <header><div><span>{selectedSection.label}</span><h2>{selectedSection.title}</h2></div><div className="resume-card-actions"><button className="button secondary" onClick={optimizeSection}>AI 优化</button><button className="button primary" onClick={saveSection}>保存到简历素材</button></div></header>
          <textarea value={sectionDrafts[selectedSectionId]} onChange={(event) => setSectionDrafts((current) => ({ ...current, [selectedSectionId]: event.target.value }))} aria-label={`${selectedSection.title} 编辑`} />
        </section>
        <div className="resume-parsed-grid">{sections.map((section) => <article key={section.id} className={selectedSectionId === section.id ? "parsed-card active" : "parsed-card"} onClick={() => setSelectedSectionId(section.id)}><span>{section.label}</span><strong>{section.title}</strong><p>{section.content.slice(0, 130) || "等待补充内容"}</p></article>)}</div>
      </main>
      <aside className="resume-ai-panel">
        <header><strong>AI 简历优化</strong><span>当前模块：{selectedSection.title}</span></header>
        <div className="resume-ai-actions"><button onClick={optimizeSection}>润色</button><button onClick={() => setChatMessages((current) => [...current, { id: makeId("resume-ai"), role: "assistant", text: "这是整份简历的优化方向。", sectionId: selectedSectionId, suggestion: buildResumeSuggestion("整份简历", profile.resumeText, profile) }])}>优化整份</button><button onClick={() => setChatMessages((current) => [...current, { id: makeId("resume-ai"), role: "assistant", text: "已生成一版面试自我介绍素材。", sectionId: "highlights", suggestion: `面试自我介绍：我主要匹配 ${profile.resume.targetRole}，优势是${profile.resume.skills.slice(0, 4).join("、")}。可以重点讲 ${profile.evidenceLibrary[0]?.title ?? "最相关项目"}，用目标、动作、结果和复盘收尾。` }])}>自我介绍</button></div>
        <div className="resume-chat-thread">{chatMessages.map((message) => <article key={message.id} className={`resume-chat-message ${message.role}`}><p>{message.text}</p>{message.suggestion && <div className="suggestion-box"><pre>{message.suggestion}</pre><button className="button primary" onClick={() => applySuggestion(message)}>应用到简历</button></div>}</article>)}</div>
        <form className="resume-chat-input" onSubmit={sendChat}><input className="text-input" value={chatInput} onChange={(event) => setChatInput(event.target.value)} aria-label="简历优化需求" placeholder="想怎么优化这份简历？" /><button className="button primary" disabled={!chatInput.trim()}><ArrowRight size={16} /></button></form>
      </aside>
    </section>
  );
}

export function QuestionBankView({ workspace, onUpdateQuestion, onAddQuestion, onMock, onLive }: { workspace: WorkspaceState; onUpdateQuestion: (questionId: string, patch: Partial<InterviewQuestion>) => void; onAddQuestion: (question: Pick<InterviewQuestion, "question" | "category" | "difficulty">) => void; onMock: () => void; onLive: () => void }) {
  const [newQuestion, setNewQuestion] = useState("");
  const [category, setCategory] = useState<InterviewQuestion["category"]>(workspace.questions[0]?.category ?? "项目深挖");
  const categories = Array.from(new Set(workspace.questions.map((question) => question.category)));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!newQuestion.trim()) return;
    onAddQuestion({ question: newQuestion.trim(), category, difficulty: "进阶" });
    setNewQuestion("");
  };
  return (
    <section className="page-section">
      <EditorHeader icon={BookOpenCheck} title="问题库" description="诊断题、手动题、实时助手和模拟面试里的追问都在这里复习和沉淀。" action={<div className="section-action"><button className="button secondary" onClick={onMock}>用这些题模拟</button><button className="button primary" onClick={onLive}>进入实时助手</button></div>} />
      <form className="question-add-row" onSubmit={submit}><select className="status-select" value={category} onChange={(event) => setCategory(event.target.value as InterviewQuestion["category"])}>{categories.map((item) => <option key={item}>{item}</option>)}</select><input className="text-input" value={newQuestion} aria-label="新增问题" onChange={(event) => setNewQuestion(event.target.value)} placeholder="手动添加一个复盘题..." /><button className="button secondary" disabled={!newQuestion.trim()}><Plus size={16} />添加</button></form>
      <div className="question-card-grid">{workspace.questions.map((question) => <article key={question.id} className={question.priority ? "question-card priority" : "question-card"}><header><span>{question.category}</span><label><input type="checkbox" checked={question.priority} onChange={(event) => onUpdateQuestion(question.id, { priority: event.target.checked })} />重点</label></header><textarea className="question-edit" value={question.question} aria-label={`${question.id} 题目`} onChange={(event) => onUpdateQuestion(question.id, { question: event.target.value })} /><p>{question.reason}</p><textarea className="question-notes" value={question.notes} aria-label={`${question.id} 复盘笔记`} onChange={(event) => onUpdateQuestion(question.id, { notes: event.target.value })} placeholder="记录准备要点、题词卡要点、面试后复盘..." /></article>)}</div>
    </section>
  );
}
