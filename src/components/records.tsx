import { type ChangeEvent, useMemo, useState } from "react";
import { Check, Download, Filter, LogOut, RefreshCw, ShieldCheck, Timer, Trash2, Upload, Volume2 } from "lucide-react";
import { exportFromServer, importToServer } from "../lib/apiClient";
import { apiFetch } from "../lib/authClient";
import { repairText } from "../lib/copy";
import { parseImportedState, serializeAppState } from "../lib/store";
import type { AuthSession } from "../lib/auth";
import type { AppState, InterviewRecord, Position } from "../types";
import { AiStatusBadge, EmptyState, MetricCard, MetricGrid } from "./shared";
import { QuotaPanel } from "./account/QuotaPanel";

type RecordsFilterMode = "all" | "live" | "mock";

function formatRecordTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRecordTitle(record: InterviewRecord, positions: Position[]) {
  const position = positions.find((item) => item.id === record.positionId);
  return position ? `${repairText(position.company)} · ${repairText(position.title)}` : repairText(record.title);
}

function getRecordsEmptyCopy(hasAnyRecords: boolean, mode: RecordsFilterMode, positionId: string, positions: Position[]) {
  if (!hasAnyRecords) {
    return {
      title: "还没有面试记录",
      detail: "完成一次实时助手或模拟练习后，这里会自动保存复盘。",
    };
  }
  const position = positions.find((item) => item.id === positionId);
  if (position && mode !== "all") {
    return {
      title: "该岗位暂无该类型记录",
      detail: `${repairText(position.company)} · ${repairText(position.title)} 还没有${mode === "live" ? "实时助手" : "模拟练习"}记录。`,
    };
  }
  if (position) {
    return {
      title: "该岗位暂无记录",
      detail: `${repairText(position.company)} · ${repairText(position.title)} 还没有保存过面试复盘。`,
    };
  }
  return {
    title: "暂无符合条件的记录",
    detail: "当前筛选条件下没有记录，可以切换类型或选择全部岗位。",
  };
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "未绑定手机号";
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function getPracticePriorities(record: InterviewRecord, position?: Position) {
  const nextActions = (record.report.improvementPoints?.length ? record.report.improvementPoints : record.report.nextActions)
    .map((item) => repairText(item).trim())
    .filter(Boolean);
  const matchedQuestions = (position?.questions ?? [])
    .filter((question) => record.questionIds.includes(question.id))
    .slice(0, 3);

  if (matchedQuestions.length > 0) {
    return matchedQuestions.map((question, index) => ({
      rank: index + 1,
      label: repairText(question.category || question.question),
      description: repairText(question.question),
    }));
  }

  return nextActions.slice(0, 3).map((item, index) => ({
    rank: index + 1,
    label: item,
    description: "建议下次练习时优先用一段真实经历和可验证结果来回答。",
  }));
}

export function RecordsView({
  records,
  positions,
  activeRecordId,
  onOpen,
  onMock,
  onOpenQuestions,
  onOpenResume,
  onOpenJd,
  onSaveQuestionNote,
}: {
  records: InterviewRecord[];
  positions: Position[];
  activeRecordId?: string;
  onOpen: (id: string) => void;
  onMock: () => void;
  onOpenQuestions: () => void;
  onOpenResume: () => void;
  onOpenJd: () => void;
  onSaveQuestionNote: (payload: { question: string; notes: string }) => void;
}) {
  const [mode, setMode] = useState<RecordsFilterMode>("all");
  const [positionId, setPositionId] = useState("all");

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        if (mode !== "all" && record.mode !== mode) return false;
        if (positionId !== "all" && record.positionId !== positionId) return false;
        return true;
      }),
    [mode, positionId, records],
  );

  const requestedRecord = activeRecordId ? filtered.find((record) => record.id === activeRecordId) : undefined;
  const activeRecord = activeRecordId ? requestedRecord : filtered[0];
  const recordNotFound = Boolean(activeRecordId) && !records.some((record) => record.id === activeRecordId);
  const activePosition = positions.find((item) => item.id === activeRecord?.positionId);
  const liveRecords = filtered.filter((record) => record.mode === "live");
  const mockRecords = filtered.filter((record) => record.mode === "mock");
  const hasAnyRecords = records.length > 0;
  const emptyCopy = getRecordsEmptyCopy(hasAnyRecords, mode, positionId, positions);

  const renderRecord = (record: InterviewRecord) => (
    <button
      key={record.id}
      type="button"
      className={`records-rail-item ${record.mode} ${activeRecord?.id === record.id ? "selected" : ""}`}
      onClick={() => onOpen(record.id)}
    >
      <strong>{getRecordTitle(record, positions)}</strong>
      <span>{formatRecordTime(record.createdAt)} · {record.transcript.filter((item) => item.role === "interviewer").length} 题</span>
    </button>
  );

  return (
    <section className="page page-records desktop-page records-single-page">
      <aside className="records-rail">
        <div className="records-filter-compact">
          <span>
            <Filter size={14} />
            筛选
          </span>
          <select className="input compact-select" aria-label="按模式筛选" value={mode} onChange={(event) => setMode(event.target.value as RecordsFilterMode)}>
            <option value="all">全部</option>
            <option value="live">实时</option>
            <option value="mock">模拟</option>
          </select>
          <select className="input compact-select" aria-label="按岗位筛选" value={positionId} onChange={(event) => setPositionId(event.target.value)}>
            <option value="all">全部岗位</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {repairText(position.company)} · {repairText(position.title)}
              </option>
            ))}
          </select>
        </div>

        {filtered.length ? (
          <>
            {mode !== "mock" && liveRecords.length ? (
              <section>
                <h2>实时助手记录</h2>
                {liveRecords.map(renderRecord)}
              </section>
            ) : null}
            {mode !== "live" && mockRecords.length ? (
              <section>
                <h2>模拟练习记录</h2>
                {mockRecords.map(renderRecord)}
              </section>
            ) : null}
          </>
        ) : null}
      </aside>

      <section className="records-report-pane">
        {recordNotFound ? (
          <div className="records-empty-shell">
            <EmptyState title="该记录不存在或已被删除" detail="可能已被删除，或被当前筛选条件排除，请换一条记录查看。" />
            <button className="button primary" type="button" onClick={onMock}>
              去模拟练习
            </button>
          </div>
        ) : activeRecord ? (
          <RecordReportContent record={activeRecord} position={activePosition} onMock={onMock} onOpenQuestions={onOpenQuestions} onOpenResume={onOpenResume} onOpenJd={onOpenJd} onSaveQuestionNote={onSaveQuestionNote} />
        ) : (
          <div className="records-empty-shell">
            <EmptyState title={emptyCopy.title} detail={emptyCopy.detail} />
            <button className="button primary" type="button" onClick={onMock}>
              去模拟练习
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

export function RecordReportView({
  record,
  position,
  onMock,
  onOpenQuestions,
  onOpenResume,
  onOpenJd,
  onSaveQuestionNote,
}: {
  record?: InterviewRecord;
  position?: Position;
  onMock: () => void;
  onOpenQuestions: () => void;
  onOpenResume: () => void;
  onOpenJd: () => void;
  onSaveQuestionNote: (payload: { question: string; notes: string }) => void;
}) {
  if (!record) {
    return (
      <section className="page page-record-detail desktop-page">
        <div className="empty-card compact">
          <EmptyState title="还没有可查看的复盘报告" detail="先完成一次实时助手或模拟面试，再回来查看详情。" />
        </div>
      </section>
    );
  }

  return (
    <section className="page page-record-detail desktop-page">
      <RecordReportContent record={record} position={position} onMock={onMock} onOpenQuestions={onOpenQuestions} onOpenResume={onOpenResume} onOpenJd={onOpenJd} onSaveQuestionNote={onSaveQuestionNote} />
    </section>
  );
}

function RecordReportContent({
  record,
  position,
  onMock,
  onOpenQuestions,
  onOpenResume,
  onOpenJd,
  onSaveQuestionNote,
}: {
  record: InterviewRecord;
  position?: Position;
  onMock: () => void;
  onOpenQuestions: () => void;
  onOpenResume: () => void;
  onOpenJd: () => void;
  onSaveQuestionNote: (payload: { question: string; notes: string }) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const pace = record.speechMetrics[0]?.charsPerMinute ?? 0;
  const fillers = record.speechMetrics.reduce((sum, item) => sum + item.fillerCount, 0);
  const interviewerTurns = record.transcript.filter((item) => item.role === "interviewer");
  const answersForTurns = interviewerTurns.map((question) => {
    const questionIndex = record.transcript.indexOf(question);
    const nextInterviewerIndex = record.transcript.findIndex((message, index) => index > questionIndex && message.role === "interviewer");
    const searchEnd = nextInterviewerIndex === -1 ? record.transcript.length : nextInterviewerIndex;
    return record.transcript.slice(questionIndex + 1, searchEnd).find((message) => message.role === "candidate");
  });
  const orderedCueCards = [...record.cueCards].reverse();
  const improvementPoints = record.report.improvementPoints?.length ? record.report.improvementPoints : record.report.nextActions;
  const evidenceCount = new Set(record.cueCards.flatMap((card) => card.evidenceIds)).size;
  const hitRate = record.cueCards.length ? `${Math.round((evidenceCount / Math.max(1, record.cueCards.length)) * 100)}%` : "--";
  const practicePriorities = getPracticePriorities(record, position);

  return (
    <>
      <header className="desktop-page-header record-report-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">{record.mode === "live" ? "实时助手" : "模拟练习"} · {formatRecordTime(record.createdAt)}</span>
          <h1>{position ? `${repairText(position.company)} · ${repairText(position.title)}` : repairText(record.title)}</h1>
        </div>
        <div className="record-report-actions">
          <AiStatusBadge status={record.aiMeta?.backendStatus === "success" || record.report.source === "model" ? "success" : "fallback"} />
          <button className="button secondary compact-button" type="button" onClick={onMock}>
            再练一次
          </button>
        </div>
      </header>

      <MetricGrid
        items={[
          { label: "处理题数", value: String(interviewerTurns.length) },
          { label: "平均语速", value: pace ? `${pace}` : "--" },
          { label: "证据命中率", value: hitRate, tone: "green" },
          { label: "追问次数", value: String(Math.max(0, interviewerTurns.length - 1)) },
        ]}
      />

      <div className="record-report-grid">
        <section className="surface-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">题目回顾</span>
                <h2>本次面试时间轴</h2>
              </div>
            </div>
            <div className="record-timeline">
              {interviewerTurns.length === 0 ? <p className="form-hint">暂无题目记录。</p> : null}
              {interviewerTurns.map((message, index) => (
                <details key={`${message.text}-${index}`} className="timeline-item">
                  <summary>
                    <span>#{index + 1}</span>
                    <strong>{repairText(message.text).slice(0, 28)}</strong>
                    <small>{orderedCueCards[index] ? "提词卡已用" : "未生成卡"}</small>
                  </summary>
                  <p>{repairText(answersForTurns[index]?.text ?? "暂无候选人回答记录。")}</p>
                  {orderedCueCards[index] ? <small>{repairText(orderedCueCards[index].openingLine)}</small> : null}
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="surface-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">改进建议</span>
                <h2>下一步练习重点</h2>
              </div>
            </div>
            <div className="summary-copy">
              <p>{repairText(record.summary)}</p>
              <ul className="simple-list">
                {improvementPoints.slice(0, showMore ? improvementPoints.length : 3).map((item, index) => (
                  <li key={`${item}-${index}`}>
                    <Check size={14} />
                    {repairText(item)}
                  </li>
                ))}
              </ul>
              {improvementPoints.length > 3 ? (
                <button className="button ghost compact-button" type="button" onClick={() => setShowMore((current) => !current)}>
                  {showMore ? "收起改进点" : "展开改进点"}
                </button>
              ) : null}
              <div className="record-next-actions">
                <button
                  className="button secondary compact-button"
                  type="button"
                  onClick={() => {
                    const firstQuestion = interviewerTurns[0]?.text || record.title;
                    const shortNote = improvementPoints.slice(0, 2).map((item) => repairText(item)).join("；") || repairText(record.summary);
                    onSaveQuestionNote({ question: firstQuestion, notes: shortNote });
                    setNoteSaved(true);
                    setTimeout(() => setNoteSaved(false), 3000);
                  }}
                >
                  {noteSaved ? "✓ 已沉淀" : "一键沉淀到问题记录"}
                </button>
                <button className="button secondary compact-button" type="button" onClick={onOpenQuestions}>
                  去问题记录
                </button>
                <button className="button secondary compact-button" type="button" onClick={onOpenResume}>
                  去简历补证据
                </button>
                <button className="button secondary compact-button" type="button" onClick={onOpenJd}>
                  去 JD 分析看差距
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="surface-card record-pace-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">表达指标</span>
                <h2>节奏与填充词</h2>
              </div>
            </div>
            <div className="metrics-grid compact">
              <MetricCard label="平均语速" value={pace ? String(pace) : "--"} suffix="字 / 分钟" detail="根据本次转写文本估算。" icon={Timer} />
              <MetricCard label="口头填充词" value={String(fillers)} suffix="次" detail="统计“嗯”“啊”“那个”等口头填充。" icon={Volume2} />
            </div>
          </div>
        </section>

        <section className="surface-card transcript-panel">
          <button className="transcript-toggle" type="button" onClick={() => setShowTranscript((current) => !current)}>
            {showTranscript ? "收起完整 Transcript" : "查看完整 Transcript ›"}
          </button>
          {showTranscript ? (
            <div className="surface-card-inner">
              <h2>Transcript</h2>
              <div className="record-transcript-list">
                {record.transcript.length === 0 ? <p className="form-hint">暂无 Transcript 记录。</p> : null}
                {record.transcript.map((message, index) => (
                  <article key={`${message.role}-${index}`} className={`record-transcript-item ${message.role}`}>
                    <span>{message.role === "interviewer" ? "面试官" : "候选人"}</span>
                    <p>{repairText(message.text)}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <span className="transcript-label">Transcript</span>
          )}
        </section>

        <section className="surface-card next-step-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">练习闭环</span>
                <h2>下次练习建议</h2>
              </div>
            </div>
            {practicePriorities.length ? (
              <>
                <p className="next-step-desc">根据本次记录，建议优先把下面这些题目或薄弱点再练一轮，先把结论、动作和结果说完整。</p>
                <div className="weak-type-list">
                  {practicePriorities.map((item) => (
                    <article key={`${item.rank}-${item.label}`} className="weak-type-item">
                      <div className="weak-type-info">
                        <span className="weak-rank">#{item.rank}</span>
                        <div>
                          <span className="weak-name">{item.label}</span>
                          <span className="weak-score">{item.description}</span>
                        </div>
                      </div>
                      <button className="button secondary compact-button btn-practice" type="button" onClick={onMock}>去练习</button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="next-step-empty">本次表现不错，继续保持当前节奏，下一轮可以尝试提升证据和数据表达的具体度。</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function AccountModal({
  state,
  session,
  isLoggedIn,
  onClose,
  onLogout,
  onSwitchAccount,
  onUpdateSession,
  onImport,
  onRename,
  onClear,
}: {
  state: AppState;
  session: AuthSession | null;
  isLoggedIn: boolean;
  onClose: () => void;
  onLogout: () => void;
  onSwitchAccount: () => void;
  onUpdateSession: (next: AuthSession | null) => void;
  onImport: (next: AppState) => void;
  onRename: (name: string) => void;
  onClear: () => void;
}) {
  const [message, setMessage] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [email, setEmail] = useState(session?.email ?? "");
  const [password, setPassword] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const exportData = async () => {
    let exported = serializeAppState(state);
    let fromServer = false;
    try {
      exported = JSON.stringify(await exportFromServer(), null, 2);
      fromServer = true;
    } catch {
      // Keep local fallback.
    }
    const blob = new Blob([exported], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "interview-workbench-backup.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage({ tone: fromServer ? "success" : "warn", text: fromServer ? "已从服务端导出全部数据。" : "服务端未连接，已导出本地缓存（可能不是最新）。" });
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseImportedState(await file.text());
      try {
        const result = await importToServer(imported);
        onImport(result.state);
        if (result.status === "partial") {
          setMessage({ tone: "warn", text: result.warnings[0] ? `已导入备份，但有调整：${result.warnings[0]}` : "已导入备份，但部分当前指针已自动修正。" });
        } else {
          setMessage({ tone: "success", text: "已导入备份，且服务端状态同步成功。" });
        }
      } catch {
        setMessage({ tone: "error", text: "导入失败：服务端未完成同步，已取消本地覆盖。" });
      }
    } catch {
      setMessage({ tone: "error", text: "导入失败：不是有效的备份 JSON。" });
    } finally {
      event.target.value = "";
    }
  };

  const saveAccount = async () => {
    if (!isLoggedIn || !session) {
      setMessage({ tone: "warn", text: "请先登录后再修改账户安全信息。" });
      return;
    }
    setSavingAccount(true);
    try {
      const response = await apiFetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: state.profile.displayName.trim() || session.displayName,
          email: email.trim() || undefined,
          password: password.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error ?? "账户信息保存失败，请稍后再试。" });
        return;
      }
      const user = data.user as Partial<AuthSession>;
      onUpdateSession({
        ...session,
        displayName: user.displayName ?? state.profile.displayName,
        email: user.email ?? (email.trim() || null),
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        notificationPrefs: user.notificationPrefs ?? session.notificationPrefs,
      });
      setPassword("");
      setMessage({ tone: "success", text: "账户信息已保存。" });
    } catch {
      setMessage({ tone: "error", text: "网络异常，账户信息暂时没有保存。" });
    } finally {
      setSavingAccount(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteText !== "DELETE") {
      setMessage({ tone: "warn", text: "请输入 DELETE 以确认删除账号。" });
      return;
    }
    setDeletingAccount(true);
    try {
      const response = await apiFetch("/api/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: deleteText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error ?? "删除账号失败，请稍后再试。" });
        return;
      }
      onLogout();
    } catch {
      setMessage({ tone: "error", text: "网络异常，账号暂时没有删除。" });
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-panel narrow" role="dialog" aria-modal="true" aria-label="账户与数据" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="page-eyebrow">账户面板</span>
            <h2>账户与数据</h2>
          </div>
          <button className="button ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="account-primary-actions">
          <div className="account-current-line">
            <ShieldCheck size={16} />
            <span>{isLoggedIn ? `当前账号：${maskPhone(session?.phone)}` : "当前为访客模式"}</span>
          </div>
          {isLoggedIn ? (
            <div className="drawer-actions two-up">
              <button className="button danger" type="button" onClick={onLogout}>
                <LogOut size={16} />
                退出登录
              </button>
              <button className="button secondary" type="button" onClick={onSwitchAccount}>
                <RefreshCw size={16} />
                切换账号
              </button>
            </div>
          ) : (
            <button className="button primary" type="button" onClick={onSwitchAccount}>
              <RefreshCw size={16} />
              登录 / 注册
            </button>
          )}
        </div>

        <label className="field-label" htmlFor="display-name">显示名称</label>
        <input
          id="display-name"
          className="input"
          defaultValue={repairText(state.profile.displayName)}
          onBlur={(event) => onRename(event.target.value.trim() || "候选人")}
        />

        <div className="account-stats">
          <article><span>岗位</span><strong>{state.positions.length}</strong></article>
          <article><span>记录</span><strong>{state.interviewRecords.length}</strong></article>
          <article><span>证据</span><strong>{state.profile.evidenceLibrary.length}</strong></article>
        </div>

        {isLoggedIn ? <QuotaPanel variant="compact" /> : null}

        {isLoggedIn ? (
          <details className="account-more-section">
            <summary>账户安全</summary>
            <label className="field-label" htmlFor="account-email">联系邮箱（选填）</label>
            <input id="account-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
            <label className="field-label" htmlFor="account-password">新密码</label>
            <input id="account-password" className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="不修改可留空，至少 8 位" />
            <p className="form-hint">内测阶段不会发送验证邮件。忘记密码请在此直接设置新密码。</p>
            <div className="drawer-actions stacked">
              <button className="button primary" type="button" onClick={saveAccount} disabled={savingAccount}>
                <ShieldCheck size={16} />
                {savingAccount ? "保存中..." : "保存账户信息"}
              </button>
            </div>
            <div className="danger-zone-inline">
              <p>删除账号会清空登录会话和服务端业务数据。请输入 DELETE 确认。</p>
              <input className="input" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="DELETE" aria-label="删除账号确认文本" />
              <button className="button danger" type="button" onClick={deleteAccount} disabled={deletingAccount}>
                <Trash2 size={16} />
                {deletingAccount ? "删除中..." : "删除账号"}
              </button>
            </div>
          </details>
        ) : null}

        <details className="account-more-section">
          <summary>更多</summary>
          <div className="drawer-actions stacked">
            <button className="button secondary" type="button" onClick={exportData}>
              <Download size={16} />
              导出数据
            </button>
            <label className="button secondary file-button">
              <Upload size={16} />
              导入备份
              <input type="file" accept=".json,application/json" aria-label="导入备份文件" onChange={importData} />
            </label>
            {!isLoggedIn ? (
              <>
                <p className="form-hint">只清本机浏览器缓存，不会删除服务端已保存的岗位和记录。</p>
                <button className="button danger" type="button" onClick={onClear}>
                  <Trash2 size={16} />
                  清除本机缓存
                </button>
              </>
            ) : null}
          </div>
        </details>

        {message ? <div className={message.tone === "error" ? "inline-message error" : message.tone === "warn" ? "inline-message warn" : "inline-message success"}>{message.text}</div> : null}
      </aside>
    </div>
  );
}
