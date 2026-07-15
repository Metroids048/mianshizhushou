import { ArrowRight, BriefcaseBusiness, MessageCircle, Mic, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { repairText, sanitizeDisplayText } from "../lib/copy";
import { loadDraftState, saveDraftState } from "../lib/store";
import type { Position } from "../types";
import { QuotaBadge } from "./shared";
import { configFromPreferences, DEFAULT_CONFIG, type InterviewConfig } from "./sharedConfig";

export function AuthLandingPage({
  onLogin,
  onRegister,
}: {
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <section className="page page-home desktop-page">
      <div className="home-stage home-stage-product">
        <header className="home-hero home-hero-product">
          <span className="page-eyebrow">面试准备</span>
          <h1>AI 求职台</h1>
          <p>围绕真实 JD、简历和面试记录，完成从准备到复盘的 AI 面试闭环。注册后即可开始内测，每位用户每天各功能 5 次免费 AI 额度。</p>
        </header>
        <div className="home-product-shell">
          <section className="surface-card home-hero-input-card">
            <div className="surface-card-inner">
              <div className="drawer-actions two-up">
                <button type="button" className="button primary" onClick={onRegister}>
                  注册并开始
                </button>
                <button type="button" className="button secondary" onClick={onLogin}>
                  已有账号，登录
                </button>
              </div>
              <p className="muted-copy">登录后可粘贴 JD、生成提词卡、模拟面试并保存记录。</p>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function summarizePositionStatus(position: Position) {
  if (position.mockTurns.length > 0) return "已练习";
  if (position.intake.configuredInterview) return "已配置";
  if (position.intake.reviewStatus === "confirmed") return "待配置";
  return "待完善";
}

function positionSummary(position: Position) {
  if (position.analysisContext.priorityFocus.length > 0) return sanitizeDisplayText(position.analysisContext.priorityFocus[0]);
  if (position.intake.missingFields.length > 0) return `待补：${position.intake.missingFields.map((item) => sanitizeDisplayText(item.label)).join("、")}`;
  return "岗位信息已保存，可继续完善或开始练习。";
}

function OptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setup-option-group">
      <span className="setup-label">{label}</span>
      <div className="setup-option-pills" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "setup-option-pill active" : "setup-option-pill"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HomeDashboard({
  positions,
  activePositionId,
  onSubmitJd,
  onOpenMockList,
  onOpenLive,
  onRequireLogin,
  isLoggedIn,
}: {
  positions: Position[];
  activePositionId: string;
  onSubmitJd: (
    jobText: string,
    options?: {
      positionId?: string;
      confirmedFields?: Array<{ key: string; value: string; source?: string }>;
      messages?: Array<{ role: "assistant" | "user"; text: string }>;
    },
  ) => Promise<string | null> | string | null;
  onOpenMockList: () => void;
  onOpenLive: () => void;
  onRequireLogin: (path: string) => void;
  isLoggedIn: boolean;
}) {
  const activePosition = positions.find((item) => item.id === activePositionId) ?? positions[0];
  const [input, setInput] = useState(() => loadDraftState().homeInput ?? "");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (!isLoggedIn) {
      onRequireLogin("/");
      return;
    }
    setSubmitError("");
    setSubmitStage("正在保存岗位信息...");
    setSubmitting(true);
    const slowTimer = window.setTimeout(() => {
      setSubmitStage("AI 正在分析 JD 和面试背景，稍等几秒。");
    }, 1800);
    try {
      const previousMessages = activePosition?.intake.messages?.map((message) => ({ role: message.role, text: message.text })) ?? [];
      const nextMessages = [...previousMessages, { role: "user" as const, text }];
      const positionId = await onSubmitJd(text, { positionId: activePosition?.id, messages: nextMessages });
      if (!positionId) {
        setSubmitError("岗位没有保存成功。请确认已登录并重试，刚才输入的内容已保留。");
        setSubmitting(false);
        setSubmitStage("");
        return;
      }
      setSubmitStage("岗位已保存，正在更新岗位卡。");
      saveDraftState({ ...loadDraftState(), homeInput: "" });
      setInput("");
    } catch {
      setSubmitError("岗位没有保存成功。可能是登录失效或服务暂时不可用，刚才输入的内容已保留。");
    } finally {
      window.clearTimeout(slowTimer);
      setSubmitting(false);
      setSubmitStage("");
    }
  };

  const updateInput = (value: string) => {
    setInput(value);
    saveDraftState({ ...loadDraftState(), homeInput: value });
  };

  return (
    <section className="page page-home desktop-page">
      <div className="home-stage home-stage-product">
        <header className="home-hero home-hero-product">
          <div className="home-hero-topline">
            <span className="page-eyebrow">面试准备</span>
            <QuotaBadge />
          </div>
          <h1>告诉 AI 你想面试的岗位</h1>
          <p>把真实 JD、岗位要求或你已经知道的面试背景直接贴进来，先把当前岗位坐稳，再继续进入实时助手或模拟面试。</p>
        </header>

        <div className="home-product-shell">
          <section className="surface-card home-hero-input-card">
            <div className="surface-card-inner">
              <form className="home-intake-box home-intake-box-product" onSubmit={submit}>
                <div className="home-dialog-shell">
                  <textarea
                    id="home-intake-product"
                    value={input}
                    aria-label="首页主输入"
                    onChange={(event) => updateInput(event.target.value)}
                    placeholder="例如：岗位：AI 产品运营实习生
公司：某 AI 教育科技创业公司

岗位职责
1. 负责 AI 求职工具的用户增长、社群运营和内容运营，提升新用户激活率和留存率
2. 基于用户反馈和数据表现，协助产品经理优化简历诊断、模拟面试等核心功能
3. 策划校招季专题活动，求职训练营和校园大使合作"
                  />
                  <div className="home-dialog-footer">
                    <div className="home-dialog-footer-spacer" />
                    <div className="home-intake-actions">
                      <button className="button primary capsule-button home-send-button" type="submit" disabled={!input.trim() || submitting}>
                        {submitting ? "处理中..." : "发送"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </form>
              {submitStage ? <p className="inline-message" role="status">{submitStage}</p> : null}
              {submitError ? <p className="inline-message error" role="alert">{submitError}</p> : null}
              {!isLoggedIn ? <p className="home-guest-hint">未登录也可以先整理 JD；点击发送、实时助手或模拟面试时会提示登录，本地不会自动并入任何账号。</p> : null}
            </div>
          </section>

          <section className="surface-card home-current-position-card">
            <div className="surface-card-inner">
              <div className="home-current-position-strip">
                <div className="home-current-position-copy">
                  <span className="subtle-label">当前岗位</span>
                  <h2>{activePosition ? `${sanitizeDisplayText(activePosition.company, "公司待确认") || "公司待确认"} · ${sanitizeDisplayText(activePosition.title, "岗位待确认") || "岗位待确认"}` : "还没有岗位卡"}</h2>
                  <p>{activePosition ? positionSummary(activePosition) : "保存一个岗位后，这里会显示当前岗位摘要和后续入口。"}</p>
                </div>

                <article className="home-mini-status-card">
                  <span>准备状态</span>
                  <strong>{activePosition ? summarizePositionStatus(activePosition) : "等待创建岗位"}</strong>
                </article>
              </div>

              <div className="home-current-position-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => {
                    if (!isLoggedIn) {
                      onRequireLogin("/live");
                      return;
                    }
                    onOpenLive();
                  }}
                >
                  <MessageCircle size={16} />
                  进入实时助手
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    if (!isLoggedIn) {
                      onRequireLogin("/mock");
                      return;
                    }
                    onOpenMockList();
                  }}
                >
                  <Mic size={16} />
                  进入模拟面试
                </button>
              </div>

            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export function PositionDetailPage({
  position,
  onContinueConversation,
  onOpenMockSetup,
  onDelete,
  onBackHome,
}: {
  position: Position;
  onContinueConversation: () => void;
  onOpenMockSetup: () => void;
  onDelete: () => void;
  onBackHome: () => void;
}) {
  return (
    <section className="page desktop-page position-detail-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">岗位详情</span>
          <h1>{repairText(position.company) || "公司待确认"} · {repairText(position.title) || "岗位待确认"}</h1>
          <p>{positionSummary(position)}</p>
        </div>
        <div className="record-report-actions">
          <button className="button secondary compact-button" type="button" onClick={onBackHome}>返回首页</button>
          <button className="button danger compact-button" type="button" onClick={onDelete}>
            <Trash2 size={14} />
            删除岗位
          </button>
        </div>
      </header>

      <div className="position-detail-layout">
        <section className="surface-card position-detail-main">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">左侧</span>
                <h2>JD 与岗位信息</h2>
              </div>
            </div>
            <div className="position-detail-group">
              <strong>岗位状态</strong>
              <p>{summarizePositionStatus(position)}</p>
            </div>
            <div className="position-detail-group">
              <strong>已确认字段</strong>
              <div className="position-detail-tags">
                {position.intake.confirmedFields.length > 0 ? position.intake.confirmedFields.map((field) => (
                  <span key={`${field.key}-${field.value}`} className="pill">{field.label}：{repairText(field.value)}</span>
                )) : <span className="muted-copy">还没有用户确认字段。</span>}
              </div>
            </div>
            <div className="position-detail-group">
              <strong>原始 JD</strong>
              <p className="position-detail-copy">{repairText(position.intake.rawJdText || position.jobText) || "还没有保存 JD 原文。"}</p>
            </div>
            <div className="position-detail-group">
              <strong>准备重点</strong>
              <ul className="simple-list">
                {position.analysisContext.priorityFocus.slice(0, 4).map((item) => (
                  <li key={item}>{repairText(item)}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <aside className="surface-card position-detail-side">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">右侧</span>
                <h2>面试配置与开始练习</h2>
              </div>
            </div>
            <div className="position-detail-group">
              <strong>当前配置</strong>
              <p>{repairText(position.interviewPreferences.interviewerRole)} · {repairText(position.interviewPreferences.difficulty)} · {repairText(position.interviewPreferences.style)}</p>
            </div>
            <div className="position-detail-group">
              <strong>练习进度</strong>
              <p>{position.mockTurns.length > 0 ? `已完成 ${position.mockTurns.length} 轮回答` : "还没有开始模拟练习"}</p>
            </div>
            <div className="position-detail-actions">
              <button className="button primary" type="button" onClick={onOpenMockSetup}>
                <Mic size={16} />
                去模拟配置
              </button>
              <button className="button secondary" type="button" onClick={onContinueConversation}>
                <MessageCircle size={16} />
                继续完善对话
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function PositionConversationPage({
  position,
  onSubmitMessage,
  onOpenMockSetup,
  onOpenDetail,
}: {
  position: Position;
  onSubmitMessage: (
    message: string,
    options: {
      positionId: string;
      confirmedFields: Array<{ key: string; value: string; source?: string }>;
      messages: Array<{ role: "assistant" | "user"; text: string }>;
    },
  ) => Promise<void> | void;
  onOpenMockSetup: () => void;
  onOpenDetail: () => void;
}) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const messages = position.intake.messages;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const nextMessages = [...messages.map((message) => ({ role: message.role, text: message.text })), { role: "user" as const, text }];
      const confirmedFields = position.intake.confirmedFields.map((field) => ({ key: field.key, value: field.value, source: field.source }));
      await onSubmitMessage(text, {
        positionId: position.id,
        confirmedFields,
        messages: nextMessages,
      });
      setInput("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page desktop-page position-conversation-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">岗位完善对话</span>
          <h1>{repairText(position.company) || "公司待确认"} · {repairText(position.title) || "岗位待确认"}</h1>
          <p>对话会自动保存到当前岗位。补齐字段后，你可以直接去模拟配置，或回岗位详情页继续查看。</p>
        </div>
      </header>

      <div className="position-conversation-shell">
        <section className="surface-card position-conversation-main">
          <div className="surface-card-inner">
            <div className="position-conversation-thread">
              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "position-bubble user" : "position-bubble assistant"}>
                  <span>{message.role === "user" ? "我" : "系统"}</span>
                  <p>{repairText(message.text)}</p>
                </article>
              ))}
            </div>

            <form className="position-conversation-input" onSubmit={submit}>
              <textarea
                className="input textarea"
                value={input}
                aria-label="岗位完善输入"
                onChange={(event) => setInput(event.target.value)}
                placeholder="继续补充公司、岗位、面试官、难度、时长或 JD 细节。"
              />
              <div className="cta-row">
                <button className="button primary" type="submit" disabled={!input.trim() || saving}>
                  {saving ? "保存中..." : "继续完善并自动保存"}
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside className="surface-card position-conversation-side">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">当前岗位信息</span>
                <h2>边聊边保存</h2>
              </div>
            </div>
            <div className="position-detail-group">
              <strong>已确认字段</strong>
              <div className="position-detail-tags">
                {position.intake.confirmedFields.length > 0 ? position.intake.confirmedFields.map((field) => (
                  <span key={`${field.key}-${field.value}`} className="pill">{field.label}：{repairText(field.value)}</span>
                )) : <span className="muted-copy">还没有确认字段。</span>}
              </div>
            </div>
            <div className="position-detail-group">
              <strong>待补字段</strong>
              <p>{position.intake.missingFields.length > 0 ? position.intake.missingFields.map((field) => field.label).join("、") : "当前关键信息已基本齐全。"} </p>
            </div>
            <div className="position-detail-actions">
              <button className="button primary" type="button" onClick={onOpenMockSetup}>
                <Mic size={16} />
                去模拟配置
              </button>
              <button className="button secondary" type="button" onClick={onOpenDetail}>
                返回岗位详情
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function MockPositionListPage({
  positions,
  onSelectPosition,
}: {
  positions: Position[];
  onSelectPosition: (positionId: string) => void;
}) {
  return (
    <section className="page desktop-page mock-position-list-page">
      <header className="desktop-page-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">模拟面试</span>
          <h1>先选择一个岗位</h1>
          <p>模拟面试入口先经过岗位选择，再进入配置页，然后进入面试房间。</p>
        </div>
      </header>
      {positions.length > 0 ? (
        <div className="home-position-grid">
          {positions.map((position) => (
            <button key={position.id} type="button" className="home-position-card" onClick={() => onSelectPosition(position.id)}>
              <div className="home-position-head">
                <span className="home-position-icon"><BriefcaseBusiness size={16} /></span>
                <strong>{repairText(position.company) || "公司待确认"}</strong>
              </div>
              <p className="home-position-title">{repairText(position.title) || "岗位待确认"}</p>
              <span className="home-position-status">{position.mockTurns.length > 0 ? "可继续练习" : "进入配置"}</span>
              <p className="home-position-summary">{positionSummary(position)}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-card">
          <div className="empty-card-icon"><Mic size={20} /></div>
          <div>
            <h2>还没有岗位卡</h2>
            <p>先回首页创建岗位，再进入模拟面试。</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function MockSetupPage({
  position,
  initialConfig,
  onStart,
}: {
  position: Position;
  initialConfig?: InterviewConfig;
  onStart: (config: InterviewConfig) => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(initialConfig ?? configFromPreferences(position.interviewPreferences) ?? DEFAULT_CONFIG);

  return (
    <section className="page desktop-page mock-setup-page">
      <div className="mock-setup-container">
        <header className="desktop-page-header">
          <div className="desktop-page-title">
            <span className="page-eyebrow">模拟面试配置</span>
            <h1>{repairText(position.company) || "公司待确认"} · {repairText(position.title) || "岗位待确认"}</h1>
            <p>保留真正有决策价值的配置项，不展示预计题数和时长。</p>
          </div>
        </header>

        <div className="mock-config-page">
          <section className="mock-config-summary">
            <div className="mock-config-company">{repairText(position.company) || "公司待确认"} · {repairText(position.title) || "岗位待确认"}</div>
            <div className="mock-config-hints">
              <span className="mock-config-hints-label">准备重点</span>
              <p className="mock-config-hints-text">{position.analysisContext.priorityFocus.slice(0, 3).join("；") || "暂无重点摘要，进入面试后会根据简历和岗位继续追问。"}</p>
            </div>
          </section>

          <section className="surface-card setup-card mock-config-form-card">
            <div className="surface-card-inner">
              <h2 className="mock-config-form-title">面试参数</h2>

              <OptionGroup
                label="面试官角色"
                value={config.interviewerRole}
                options={[
                  { value: "HR", label: "HR" },
                  { value: "上级", label: "上级" },
                  { value: "业务负责人", label: "业务负责人" },
                  { value: "CTO", label: "CTO" },
                  { value: "CEO", label: "CEO" },
                ]}
                onChange={(interviewerRole) => setConfig((current) => ({ ...current, interviewerRole }))}
              />

              <OptionGroup
                label="难度"
                value={config.difficulty}
                options={[
                  { value: "正常", label: "友好面" },
                  { value: "压力面", label: "压力面" },
                  { value: "地狱面", label: "强压面" },
                ]}
                onChange={(difficulty) => setConfig((current) => ({ ...current, difficulty }))}
              />

              <OptionGroup
                label="风格"
                value={config.style}
                options={[
                  { value: "gentle", label: "温和鼓励" },
                  { value: "strict", label: "专业严格" },
                  { value: "pressure", label: "连续追问" },
                ]}
                onChange={(style) => setConfig((current) => ({ ...current, style }))}
              />

              <details className="mock-config-advanced">
                <summary>更多设置</summary>
                <label className="setup-field">
                  <span className="setup-label">面试官性别</span>
                  <select className="setup-select" value={config.interviewerGender} onChange={(event) => setConfig((current) => ({ ...current, interviewerGender: event.target.value as InterviewConfig["interviewerGender"] }))}>
                    <option value="女">女</option>
                    <option value="男">男</option>
                  </select>
                </label>

                <label className="setup-field">
                  <span className="setup-label">提交方式</span>
                  <select className="setup-select" value={config.submitMode} onChange={(event) => setConfig((current) => ({ ...current, submitMode: event.target.value as InterviewConfig["submitMode"] }))}>
                    <option value="manual">手动确认</option>
                    <option value="auto">自动提交</option>
                  </select>
                </label>
              </details>
            </div>
          </section>
        </div>

        <div className="mock-setup-actions">
          <button className="button primary large-button" type="button" onClick={() => onStart(config)}>
            <Mic size={18} />
            {position.mockTurns.length > 0 ? "保存配置并进入练习" : "进入面试房间"}
          </button>
        </div>
      </div>
    </section>
  );
}
