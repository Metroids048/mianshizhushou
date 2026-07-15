import { ChevronDown, FileText, FileUp, FolderKanban, Plus, ScrollText, Sparkles } from "lucide-react";
import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { repairText } from "../lib/copy";
import { importResumeFile } from "../lib/resumeImport";
import { makeId, nowIso } from "../lib/ids";
import type { InterviewQuestion, Position, PositionMaterial, WorkspaceState } from "../types";
import { AuthGateCard } from "./auth/AuthGate";

function extractKeywords(text: string, limit = 8): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9+#./-]{1,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  const seen = new Set<string>();
  return matches
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return item.length <= 20;
    })
    .slice(0, limit);
}

function summarize(text: string): string {
  const normalized = repairText(text).replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function createMaterial(input: {
  kind: PositionMaterial["kind"];
  source: PositionMaterial["source"];
  title: string;
  detail: string;
  tags?: string[];
}): PositionMaterial {
  const timestamp = nowIso();
  const detail = repairText(input.detail);
  return {
    id: makeId(`mat-${input.kind}`),
    kind: input.kind,
    source: input.source,
    title: repairText(input.title) || "未命名资料",
    detail,
    summary: summarize(detail),
    keywords: extractKeywords(`${input.title}\n${detail}`),
    tags: input.tags ?? [],
    linkedQuestionIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function materialKindLabel(kind: PositionMaterial["kind"]) {
  if (kind === "project") return "项目";
  if (kind === "upload") return "上传";
  return "记录";
}

export function QuestionsWorkspace({
  workspace,
  position,
  onUpdateMaterials,
  onUpdateQuestion,
  onAddQuestion,
  isLoggedIn,
  onRequireLogin,
  onGoHome,
}: {
  workspace: WorkspaceState | null;
  position: Position | undefined;
  onUpdateMaterials: (materials: PositionMaterial[]) => void;
  onUpdateQuestion: (questionId: string, patch: Partial<InterviewQuestion>) => void;
  onAddQuestion: (question: Pick<InterviewQuestion, "question" | "category" | "difficulty"> & { answer?: string; notes?: string }) => void;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
  onGoHome: () => void;
}) {
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [category, setCategory] = useState("项目深挖");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedQuestionId, setExpandedQuestionId] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadParsing, setUploadParsing] = useState(false);

  const materials = position?.materials ?? [];
  const uploadMaterials = materials.filter((item) => item.kind === "upload");
  const manualPriorityQuestions = (workspace?.questions ?? []).filter((item) => item.source === "manual" || item.priority);
  const otherQuestions = (workspace?.questions ?? []).filter((item) => !(item.source === "manual" || item.priority));

  const grouped = useMemo(() => {
    const questions = [...manualPriorityQuestions, ...otherQuestions];
    return questions.reduce<Record<string, InterviewQuestion[]>>((acc, item) => {
      const key = repairText(item.category) || "未分类";
      acc[key] = [...(acc[key] ?? []), item];
      return acc;
    }, {});
  }, [manualPriorityQuestions, otherQuestions]);

  const groupEntries = Object.entries(grouped);
  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const saveMaterial = (material: PositionMaterial) => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    onUpdateMaterials([material, ...materials]);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isLoggedIn) {
      onRequireLogin();
      event.target.value = "";
      return;
    }
    setUploadParsing(true);
    setUploadMessage("解析中...");
    try {
      const result = await importResumeFile(file);
      saveMaterial(
        createMaterial({
          kind: "upload",
          source: "upload",
          title: file.name.replace(/\.[^.]+$/, ""),
          detail: result.text,
          tags: ["上传资料"],
        }),
      );
      setUploadMessage(`已解析 ${file.name}，并保存为当前岗位的资料卡。`);
    } catch {
      setUploadMessage("上传失败，当前支持 txt / markdown / pdf / docx。");
    } finally {
      setUploadParsing(false);
      event.target.value = "";
    }
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!newQuestion.trim()) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    onAddQuestion({
      question: newQuestion.trim(),
      category,
      difficulty: "进阶",
      answer: newAnswer.trim(),
      notes: newNotes.trim(),
    });
    setNewQuestion("");
    setNewAnswer("");
    setNewNotes("");
  };

  const removeMaterial = (materialId: string) => {
    onUpdateMaterials(materials.filter((item) => item.id !== materialId));
  };

  return (
    <section className="page page-questions desktop-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">问题记录</span>
          <h1>当前岗位的问题与资料沉淀</h1>
          <p>这里以问题/QA 沉淀为主，上传资料作为次级能力保留，用于后续 JD 分析、实时助手和模拟追问。</p>
        </div>
      </header>

      {!position ? (
        <div className="empty-card">
          <div className="empty-card-icon">
            <FolderKanban size={20} />
          </div>
          <div>
            <h2>先在首页创建一个岗位</h2>
            <p>面试资料按岗位归档。创建岗位后，这里会显示项目卡、上传资料和题目记录。</p>
            <button className="button primary" type="button" onClick={onGoHome} style={{ marginTop: 12 }}>去岗位台创建</button>
          </div>
        </div>
      ) : (
        <div className="materials-workbench">
          {!isLoggedIn ? <AuthGateCard onLogin={onRequireLogin} /> : null}
          <section className="surface-card">
            <div className="surface-card-inner">
              <div className="section-row-header">
                <div>
                  <span className="subtle-label">上传资料</span>
                  <h2>文件解析为资料卡</h2>
                  <p>上传资料保留为次级能力，不再提供手动项目资料卡录入。</p>
                </div>
                <label className={uploadParsing ? "button secondary file-button disabled" : "button secondary file-button"}>
                  <FileUp size={16} />
                  {uploadParsing ? "解析中..." : "上传文件"}
                  <input type="file" accept=".txt,.md,.markdown,.pdf,.docx" aria-label="上传面试资料文件" onChange={onFile} disabled={uploadParsing} />
                </label>
              </div>

              {uploadMessage ? <div className="inline-message success">{uploadMessage}</div> : null}

              <div className="material-card-grid">
                {uploadMaterials.length > 0 ? (
                  uploadMaterials.map((item) => <MaterialCard key={item.id} item={item} onRemove={removeMaterial} />)
                ) : (
                  <p className="muted-copy">还没有上传资料。可以上传 `.txt`、`.md`、`.pdf`、`.docx`，解析后会进入当前岗位资料。</p>
                )}
              </div>
            </div>
          </section>

          <section className="surface-card material-question-section">
            <div className="surface-card-inner">
              <div className="section-row-header">
                <div>
                  <span className="subtle-label">记录问题</span>
                  <h2>问题与 QA</h2>
                  <p>这里优先展示你手动保存的问题和高优先级问题，后续可被提词卡、模拟追问和 JD 分析复用。</p>
                </div>
              </div>

              <form className="question-form" onSubmit={submitQuestion}>
                <select className="input" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="问题分类">
                  {["行为面", "项目深挖", "专业技能", "岗位动机", "压力题", "英文题"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <textarea className="input textarea" value={newQuestion} aria-label="新增问题" onChange={(event) => setNewQuestion(event.target.value)} placeholder="输入题目，例如：请详细介绍一段项目经历。" />
                <textarea className="input textarea compact" value={newAnswer} aria-label="问题答案" onChange={(event) => setNewAnswer(event.target.value)} placeholder="参考答案，可选" />
                <textarea className="input textarea compact" value={newNotes} aria-label="问题笔记" onChange={(event) => setNewNotes(event.target.value)} placeholder="笔记 / 追问提醒，可选" />
                <button className="button primary" type="submit" disabled={!newQuestion.trim()}>
                  <Plus size={16} />
                  记录问题
                </button>
              </form>

              {workspace && groupEntries.length > 0 ? (
                <div className="question-groups compact-question-groups">
                  {groupEntries.map(([group, items], groupIndex) => {
                    const defaultCollapsed = groupIndex > 0 && !items.some((item) => item.priority || item.source === "manual");
                    const collapsed = collapsedGroups.has(group) ? !defaultCollapsed : defaultCollapsed;
                    const visibleItems = collapsed ? [] : items;
                    return (
                      <section key={group} className="question-group-block">
                        <button type="button" className="question-group-header" onClick={() => toggleGroup(group)} aria-expanded={!collapsed}>
                          <span>{collapsed ? "▶" : "▼"} {group}（{items.length}题）</span>
                          <small>{items.some((item) => item.priority) ? "含重点题" : "常规题"}</small>
                        </button>
                        {visibleItems.map((item) => {
                          const expanded = expandedQuestionId === item.id;
                          return (
                            <article key={item.id} className={expanded ? "question-bank-row expanded" : "question-bank-row"}>
                              <button type="button" className="question-bank-row-head" onClick={() => setExpandedQuestionId((current) => (current === item.id ? "" : item.id))}>
                                <strong>{repairText(item.question)}</strong>
                                <span className="question-row-meta">
                                  <span>{repairText(item.difficulty)}</span>
                                  {item.priority ? <span>重点</span> : null}
                                  <ChevronDown size={14} />
                                </span>
                              </button>

                              {expanded ? (
                                <div className="question-bank-row-body">
                                  <p>{repairText(item.reason)}</p>
                                  <label className="field-label" htmlFor={`${item.id}-answer`}>
                                    参考答案
                                  </label>
                                  <textarea
                                    id={`${item.id}-answer`}
                                    className="input textarea compact"
                                    value={repairText(item.answer || "")}
                                    aria-label={`${item.id} 答案`}
                                    onChange={(event) => {
                                      if (!isLoggedIn) {
                                        onRequireLogin();
                                        return;
                                      }
                                      onUpdateQuestion(item.id, { answer: event.target.value });
                                    }}
                                  />
                                  <label className="field-label" htmlFor={`${item.id}-notes`}>
                                    笔记 / 追问
                                  </label>
                                  <textarea
                                    id={`${item.id}-notes`}
                                    className="input textarea compact"
                                    value={repairText(item.notes)}
                                    aria-label={`${item.id} 笔记`}
                                    onChange={(event) => {
                                      if (!isLoggedIn) {
                                        onRequireLogin();
                                        return;
                                      }
                                      onUpdateQuestion(item.id, { notes: event.target.value });
                                    }}
                                  />
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-card compact">
                  <div className="empty-card-icon">
                    <ScrollText size={18} />
                  </div>
                  <div>
                    <h2>还没有记录问题</h2>
                    <p>可以从真实面试、模拟追问或手动输入开始沉淀。</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function MaterialCard({ item, onRemove }: { item: PositionMaterial; onRemove: (materialId: string) => void }) {
  const Icon = item.kind === "project" ? FolderKanban : item.kind === "upload" ? FileText : Sparkles;

  return (
    <article className="material-card">
      <header>
        <span className="material-kind">
          <Icon size={14} />
          {materialKindLabel(item.kind)}
        </span>
        <button className="mini-link" type="button" onClick={() => onRemove(item.id)}>
          移除
        </button>
      </header>
      <h3>{repairText(item.title)}</h3>
      <p>{repairText(item.summary)}</p>
      {item.keywords.length > 0 ? (
        <div className="material-keywords">
          {item.keywords.slice(0, 6).map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
