import { FileText, SendHorizonal, Sparkles, Upload } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { repairText } from "../lib/copy";
import { generateProfileHighlightsOnServer, runResumeAiOnServer } from "../lib/apiClient";
import { generateHighlightsLocal } from "../lib/coach";
import { makeId } from "../lib/ids";
import { describeAiFailure } from "../lib/requestError";
import { applyFullResumeSuggestionToDrafts, normalizeResumeSuggestion } from "../lib/resumeSuggestions";
import { loadDraftState, saveDraftState } from "../lib/store";
import { importResumeFile } from "../lib/resumeImport";
import type { CandidateProfile, EvidenceItem, Position } from "../types";
import { AiStatusBadge, EvidenceTrace } from "./shared";
import { buildResumeSections, buildResumeSuggestion, resolveEvidenceType, sectionsToDrafts, type ResumeChatMessage, type ResumeSectionId } from "./sharedConfig";

type ResumeAction = "section" | "full" | "match";

function formatResumeMetaNote(status: ResumeChatMessage["status"], note?: string): string {
  const trimmed = repairText(note ?? "");
  if (status === "success") return trimmed;
  if (status === "fallback") return trimmed ? `已切回本地练习模式：${trimmed}` : "已切回本地练习模式。";
  if (status === "error") return trimmed ? `服务端失败：${trimmed}` : "服务端失败，当前先保留本地练习模式建议。";
  return trimmed;
}

function normalizeResumeStatus(status?: "success" | "fallback" | "error" | "cache"): ResumeChatMessage["status"] {
  if (status === "success" || status === "error") return status;
  return "fallback";
}

function applySectionSave(sectionId: ResumeSectionId, text: string, profile: CandidateProfile, onUpdateEvidence: (items: EvidenceItem[]) => void, onSetHighlights: (highlights: string[]) => void) {
  if (sectionId === "highlights") {
    onSetHighlights(
      text
        .split(/\n+/)
        .map((item) => item.replace(/^[-\d.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 6),
    );
    return;
  }

  if (sectionId === "basic" || sectionId === "extra") {
    return;
  }

  onUpdateEvidence([
    {
      id: makeId("ev-custom"),
      type: resolveEvidenceType(sectionId),
      title: text.split(/\n/)[0] || "简历补充素材",
      detail: text,
      keywords: [],
      impact: "来自简历编辑区的人工补充证据",
    },
    ...profile.evidenceLibrary,
  ]);
}

function ResumeSuggestionText({ text }: { text: string }) {
  const lines = normalizeResumeSuggestion(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return (
    <div className="suggestion-text">
      {lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
    </div>
  );
}

export function ResumeWorkspacePage({
  profile,
  position,
  onUpdateResume,
  onUpdateEvidence,
  onSetHighlights,
  isLoggedIn,
  onRequireLogin,
}: {
  profile: CandidateProfile;
  position?: Position;
  onUpdateResume: (resumeText: string) => void;
  onUpdateEvidence: (items: EvidenceItem[]) => void;
  onSetHighlights: (highlights: string[]) => void;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}) {
  const sections = useMemo(() => buildResumeSections(profile), [profile]);
  const [selectedSectionId, setSelectedSectionId] = useState<ResumeSectionId>("basic");
  const initialDrafts = useMemo(() => sectionsToDrafts(sections), [sections]);
  const [draftOverrides, setDraftOverrides] = useState<Partial<Record<ResumeSectionId, string>>>({});
  const [chatInput, setChatInput] = useState(() => loadDraftState().resumeChatInput ?? "");
  const [fileMessage, setFileMessage] = useState("");
  const [fileParsing, setFileParsing] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ResumeChatMessage[]>([
    {
      id: "resume-chat-1",
      role: "assistant",
      text: "你好，我可以帮你优化简历内容，或按当前岗位做匹配分析。试试点击上方按钮，或直接告诉我你想怎么改。",
    },
  ]);

  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const sectionDrafts = { ...initialDrafts, ...draftOverrides } as Record<ResumeSectionId, string>;
  const selectedDraft = sectionDrafts[selectedSectionId];
  const evidenceKeywords = Array.from(new Set(profile.evidenceLibrary.flatMap((item) => item.keywords ?? []).filter(Boolean))).slice(0, 8);
  const skillKeywords = profile.resume.skills.filter(Boolean).slice(0, 6);

  useEffect(() => {
    saveDraftState({ ...loadDraftState(), resumeChatInput: chatInput });
  }, [chatInput]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isLoggedIn) {
      onRequireLogin();
      event.target.value = "";
      return;
    }
    setFileParsing(true);
    setFileMessage("解析中...");
    try {
      const result = await importResumeFile(file);
      onUpdateResume(result.text);
      setFileMessage(`已导入 ${file.name}${result.warning ? `，${result.warning}` : ""}，正在同步服务端简历快照。`);
    } catch {
      setFileMessage("导入失败，当前支持 txt / markdown / pdf / docx。");
    } finally {
      setFileParsing(false);
      event.target.value = "";
    }
  };

  const buildFullResumeText = () => sections.map((section) => `${section.title}\n${sectionDrafts[section.id]}`).join("\n\n");

  const saveCurrentSection = () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    onUpdateResume(buildFullResumeText());
    applySectionSave(selectedSectionId, selectedDraft, profile, onUpdateEvidence, onSetHighlights);
    setSaveMessage(`已保存「${selectedSection.title}」并同步简历内容。`);
  };

  const generateHighlights = async () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setIsGenerating(true);
    try {
      const response = await generateProfileHighlightsOnServer({
        resumeText: buildFullResumeText(),
        displayName: profile.displayName,
        positionId: position?.id,
      });
      onSetHighlights(response.highlights);
      setDraftOverrides((current) => ({ ...current, highlights: response.highlights.join("\n") }));
      setSelectedSectionId("highlights");
      setSaveMessage(
        response.meta.backendStatus === "success"
          ? "模型已生成亮点总结并同步到后端。"
          : `模型本次未成功返回，已保留本地亮点总结：${repairText(response.meta.fallbackReason) || "请手动核对内容。"}`
      );
    } catch (error) {
      console.error("resume.generateHighlights failed", error);
      const fallback = generateHighlightsLocal(profile);
      onSetHighlights(fallback);
      setDraftOverrides((current) => ({ ...current, highlights: fallback.join("\n") }));
      setSelectedSectionId("highlights");
      setSaveMessage(`服务端失败：${describeAiFailure(error, "后端暂时不可用")}；当前先保留本地亮点总结。`);
    } finally {
      setIsGenerating(false);
    }
  };

  const runAction = async (action: ResumeAction) => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    const baseText = action === "section" ? selectedDraft : action === "full" ? sections.map((section) => `${section.title}\n${sectionDrafts[section.id]}`).join("\n\n") : selectedDraft;
    const title = action === "section" ? `优化「${selectedSection.title}」` : action === "full" ? "优化整份简历" : `按岗位「${repairText(position?.title || "当前岗位")}」做匹配分析`;
    setChatMessages((current) => [
      ...current,
      { id: makeId("resume-user"), role: "user", text: title },
    ]);
    setIsGenerating(true);
    try {
      const response = await runResumeAiOnServer({
        positionId: position?.id,
        action,
        sectionId: selectedSectionId,
        sectionTitle: selectedSection.title,
        currentText: baseText,
        fullResumeText: buildFullResumeText(),
      });
      const status = normalizeResumeStatus(response.meta.backendStatus);
      setChatMessages((current) => [
        ...current,
        {
          id: makeId("resume-ai"),
          role: "assistant",
          text: response.reply,
          sectionId: response.applyTarget === "section" ? selectedSectionId : undefined,
          suggestion: response.suggestion,
          applyTarget: response.applyTarget,
          evidenceTrace: response.evidenceTrace,
          metaNote: formatResumeMetaNote(status, response.meta.fallbackReason),
          status,
        },
      ]);
    } catch (error) {
      console.error("resume.runAction failed", error);
      const reason = describeAiFailure(error, "服务端暂时不可用");
      setChatMessages((current) => [
        ...current,
        {
          id: makeId("resume-ai"),
          role: "assistant",
          text: `服务端失败：${reason}。当前先保留本地练习模式建议，至少不会让你卡住。`,
          sectionId: selectedSectionId,
          suggestion: buildResumeSuggestion(action === "full" ? "整份简历" : selectedSection.title, baseText, profile),
          applyTarget: action === "full" ? "full" : "section",
          metaNote: formatResumeMetaNote("error", reason),
          status: "error",
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setChatMessages((current) => [
      ...current,
      { id: makeId("resume-user"), role: "user", text },
    ]);
    setIsGenerating(true);
    try {
      const response = await runResumeAiOnServer({
        positionId: position?.id,
        action: "section",
        sectionId: selectedSectionId,
        sectionTitle: selectedSection.title,
        currentText: `${selectedDraft}\n${text}`,
        fullResumeText: buildFullResumeText(),
        userMessage: text,
      });
      const status = normalizeResumeStatus(response.meta.backendStatus);
      setChatMessages((current) => [
        ...current,
        {
          id: makeId("resume-ai"),
          role: "assistant",
          text: response.reply,
          sectionId: response.applyTarget === "section" ? selectedSectionId : undefined,
          suggestion: response.suggestion,
          applyTarget: response.applyTarget,
          evidenceTrace: response.evidenceTrace,
          metaNote: formatResumeMetaNote(status, response.meta.fallbackReason),
          status,
        },
      ]);
      setChatInput("");
      saveDraftState({ ...loadDraftState(), resumeChatInput: "" });
    } catch (error) {
      console.error("resume.sendChat failed", error);
      const reason = describeAiFailure(error, "服务端暂时不可用");
      setChatMessages((current) => [
        ...current,
        {
          id: makeId("resume-ai"),
          role: "assistant",
          text: `服务端失败：${reason}。当前先保留本地练习模式建议。`,
          sectionId: selectedSectionId,
          suggestion: buildResumeSuggestion(selectedSection.title, `${selectedDraft}\n${text}`, profile),
          applyTarget: "section",
          metaNote: formatResumeMetaNote("error", reason),
          status: "error",
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const applySuggestion = (message: ResumeChatMessage) => {
    if (!message.suggestion) return;
    if (message.applyTarget === "full") {
      const nextDrafts = applyFullResumeSuggestionToDrafts(message.suggestion, sections, sectionDrafts);
      setDraftOverrides((current) => ({ ...current, ...nextDrafts }));
      return;
    }
    if (!message.sectionId) return;
    const sectionId = message.sectionId;
    setSelectedSectionId(sectionId);
    setDraftOverrides((current) => ({ ...current, [sectionId]: message.suggestion! }));
  };

  return (
    <section className="page page-resume desktop-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">简历</span>
          <h1>我的简历</h1>
          <p>AI 实时优化你的简历，按岗位做匹配分析</p>
        </div>
        <div className="hero-actions">
          <label className={fileParsing ? "button secondary file-button disabled" : "button secondary file-button"}>
            <Upload size={16} />
            {fileParsing ? "解析中..." : "上传简历"}
            <input type="file" accept=".txt,.md,.markdown,.pdf,.docx" aria-label="上传简历文件" onChange={onFile} disabled={fileParsing} />
          </label>
        </div>
      </header>
      {!isLoggedIn ? (
        <div className="login-banner" role="alert">
          <span>登录后可保存简历并同步数据</span>
          <button className="btn-login-sm" type="button" onClick={onRequireLogin}>
            去登录
          </button>
        </div>
      ) : null}
      {fileMessage ? <div className="inline-message success">{fileMessage}</div> : null}

      <div className="resume-layout focused-resume-layout">
        <section className="surface-card resume-editor-column">
          <div className="surface-card-inner">
            <div className="resume-page-headline">
              <span className="subtle-label">简历</span>
              <div className="resume-page-headline-row">
                <div>
                  <h2>我的简历</h2>
                  <p>AI 实时优化你的简历，按岗位做匹配分析</p>
                </div>
              </div>
            </div>

            <div className="resume-status-strip">
              <div className="resume-avatar">{(profile.displayName || profile.resume.name || "候").slice(0, 1)}</div>
              <div className="resume-status-copy">
                <strong>{repairText(profile.displayName || profile.resume.name || "候选人")}</strong>
                <p>
                  {repairText(profile.resume.targetRole || "校招目标岗位")}
                  {position ? ` · 当前岗位：${repairText(position.title)}` : ""}
                </p>
              </div>
            </div>

            <div className="resume-document-toolbar">
              <div className="resume-section-switcher" role="tablist" aria-label="简历模块切换">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={selectedSectionId === section.id ? "resume-section-pill active" : "resume-section-pill"}
                    onClick={() => setSelectedSectionId(section.id)}
                    aria-pressed={selectedSectionId === section.id}
                  >
                    {section.title}
                  </button>
                ))}
              </div>
              <div className="hero-actions">
                {selectedSectionId === "highlights" ? (
                  <button className="button secondary" type="button" onClick={() => void generateHighlights()} disabled={isGenerating}>
                    AI 生成亮点
                  </button>
                ) : null}
                <button className="button primary resume-save-button" type="button" onClick={saveCurrentSection}>
                  保存当前模块
                </button>
              </div>
            </div>

            {saveMessage ? <div className="inline-message success">{saveMessage}</div> : null}

            <div className="resume-document-flow">
              {sections.map((section) => {
                const active = section.id === selectedSectionId;
                const value = sectionDrafts[section.id];
                return (
                  <article key={section.id} className={active ? "resume-document-section active" : "resume-document-section"}>
                    <header className="resume-document-section-head">
                      <div>
                        <span className="subtle-label">{section.label}</span>
                        <h2>{section.title}</h2>
                      </div>
                      <div className="resume-document-section-actions">
                        <button className="button secondary compact-button" type="button" onClick={() => void runAction("section")}>
                          <Sparkles size={14} />
                          让 AI 优化这一段
                        </button>
                        {!active ? (
                          <button className="button secondary compact-button" type="button" onClick={() => setSelectedSectionId(section.id)}>
                            编辑
                          </button>
                        ) : null}
                      </div>
                    </header>

                    {active ? (
                      <textarea
                        className="input textarea tall resume-document-textarea"
                        value={value}
                        aria-label={`${section.title} 编辑`}
                        onChange={(event) => setDraftOverrides((current) => ({ ...current, [section.id]: event.target.value }))}
                      />
                    ) : (
                      <div className="resume-document-preview">
                        {(repairText(value) || "等待补充内容")
                          .split(/\n+/)
                          .filter(Boolean)
                          .slice(0, 6)
                          .map((line, index) => (
                            <p key={`${section.id}-${index}`}>{line}</p>
                          ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="surface-card resume-ai-column chat-ai-column">
          <div className="surface-card-inner resume-chat-shell">
            <div className="resume-chat-header">
              <div>
                <span className="subtle-label">AI 助手</span>
                <h2>正常对话优化</h2>
                <p className="summary-copy">围绕当前模块直接提要求，或用下方快捷意图发起整份优化和岗位匹配分析。</p>
              </div>
            </div>

            <div className="resume-chat-actions compact">
              <button className="button secondary compact-button" type="button" onClick={() => void runAction("section")}>
                <Sparkles size={14} />
                优化当前模块
              </button>
              <button className="button secondary compact-button" type="button" onClick={() => void runAction("full")}>
                <FileText size={14} />
                优化整份
              </button>
              <button className="button secondary compact-button" type="button" onClick={() => void runAction("match")}>
                <Sparkles size={14} />
                匹配分析
              </button>
            </div>

            {profile.evidenceLibrary.length > 0 ? (
              <section className="resume-ai-evidence-strip">
                <div className="evidence-preview-header">
                  <span className="evidence-preview-title">AI 已识别证据</span>
                  <span className="evidence-count">{profile.evidenceLibrary.length} 条</span>
                </div>
                <div className="evidence-tags">
                  {profile.evidenceLibrary.slice(0, 6).map((item) => <span key={item.id} className="evidence-tag">{repairText(item.title)}</span>)}
                </div>
                {evidenceKeywords.length > 0 || skillKeywords.length > 0 ? (
                  <div className="evidence-keywords">
                    <span className="evidence-kw-label">命中关键词：</span>
                    {[...evidenceKeywords, ...skillKeywords.filter((item) => !evidenceKeywords.includes(item))].slice(0, 8).map((item) => (
                      <span key={item} className="evidence-kw-tag">{repairText(item)}</span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="chat-thread resume-chat-thread standard-chat-thread">
              {chatMessages.map((message) => (
                <article key={message.id} className={message.role === "assistant" ? "chat-bubble assistant" : "chat-bubble user"}>
                  <span className="chat-bubble-role">{message.role === "assistant" ? "AI" : "我"}</span>
                  {message.role === "assistant" && message.status ? <AiStatusBadge status={message.status} /> : null}
                  <p>{message.text}</p>
                  {message.metaNote ? <div className="inline-message">{message.metaNote}</div> : null}
                  {message.evidenceTrace?.length ? <EvidenceTrace trace={message.evidenceTrace} /> : null}
                  {message.suggestion ? (
                    <div className="suggestion-box">
                      <ResumeSuggestionText text={message.suggestion} />
                      <button className="button primary" type="button" onClick={() => applySuggestion(message)}>
                        {message.applyTarget === "full" ? "应用到整份编辑区" : "应用到当前区块"}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <form className="chat-composer resume-chat-composer fixed-composer" onSubmit={(event) => void sendChat(event)}>
              <textarea
                value={chatInput}
                aria-label="简历优化需求"
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="例如：把这段项目经历改得更像产品岗，少空话，多结果。"
              />
              <button className="button primary" type="submit" disabled={!chatInput.trim() || isGenerating}>
                <SendHorizonal size={16} />
                {isGenerating ? "生成中..." : "发送"}
              </button>
            </form>
          </div>
        </aside>
      </div>
    </section>
  );
}
