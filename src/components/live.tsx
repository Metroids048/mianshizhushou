import { ArrowRight, Check, ChevronDown, Headphones, Mic, Play, Timer } from "lucide-react";
import { useMicVAD } from "@ricky0123/vad-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiRunMeta, AudioBridgeStreamEvent, CueCardProgressEvent, LiveCueSessionTurn } from "../lib/apiClient";
import { answerMockSessionOnServer, createMockSessionOnServer, requestAudioBridgePairingCode, streamCueCardFromServer, subscribeToAudioBridgeEvents } from "../lib/apiClient";
import { sanitizeDisplayText, repairText } from "../lib/copy";
import { evaluateMockTurn, generateCueCard, generateFollowUpFromTranscript } from "../lib/interviewEngine";
import { describeAiFailure } from "../lib/requestError";
import { analyzeSpeech } from "../lib/speechAnalysis";
import { type DictationHandle, getSpeechRecognitionSupport, isSpeechRecognitionSupported, startDictation } from "../lib/speech";
import type { AnswerCueCard, CandidateProfile, ConversationMessage, InterviewRecord, MockMessage, MockTurn, Position, WorkspaceState } from "../types";
import { AiProgressPanel, AiStatusBadge, CueCardPanel, QuestionCard } from "./shared";
import {
  DEFAULT_CONFIG,
  type AiProgressItem,
  type InterviewConfig,
  type PersonaKey,
  type RecognizedDraft,
  type RealtimeSubmitMode,
  type SpeechCaptureState,
} from "./sharedConfig";
import { formatDuration } from "../lib/ids";
import { AuthGateCard } from "./auth/AuthGate";

const CUE_CARD_SKILL_ID = "live_cue_card_coach";
const MOCK_DRAFT_KEY_PREFIX = "campus-interview-ai-workbench:mockDraft:v1:";

interface PersistedMockDraft {
  answerDraft: RecognizedDraft;
  cueCards: AnswerCueCard[];
}

function loadMockDraft(positionId: string): PersistedMockDraft | null {
  try {
    const raw = window.sessionStorage.getItem(MOCK_DRAFT_KEY_PREFIX + positionId);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedMockDraft;
  } catch {
    return null;
  }
}

function saveMockDraft(positionId: string, draft: PersistedMockDraft): void {
  try {
    window.sessionStorage.setItem(MOCK_DRAFT_KEY_PREFIX + positionId, JSON.stringify(draft));
  } catch {
    // sessionStorage 不可用（隐私模式等）时静默跳过，草稿仅是不再持久化
  }
}

function clearMockDraft(positionId: string): void {
  try {
    window.sessionStorage.removeItem(MOCK_DRAFT_KEY_PREFIX + positionId);
  } catch {
    // ignore
  }
}

function formatMetaLabel(meta: AiRunMeta | null): string {
  if (!meta) return "等待生成";
  if (meta.backendStatus === "success") return `模型在线 · ${meta.latencyMs}ms`;
  return meta.fallbackReason ? `本地练习 · ${repairText(meta.fallbackReason)}` : "本地练习";
}

function formatQuestionSourceLabel(value: string): string {
  const normalized = repairText(value).trim().toLowerCase();
  if (!normalized) return "题库排序";
  if (normalized === "model") return "模型出题";
  if (normalized === "local") return "本地练习";
  return repairText(value);
}

function getQuestionNumber(transcript: MockMessage[]): number {
  const interviewerTurns = transcript.filter((item) => item.role === "interviewer").length;
  return Math.max(1, interviewerTurns);
}

function progressItemFromEvent(event: CueCardProgressEvent): AiProgressItem | null {
  if (event.type === "stage") {
    return {
      id: `stage-${Date.now()}-${event.label}`,
      label: event.label,
      status: event.status === "success" || event.status === "fallback" ? event.status : event.status === "done" ? "done" : "running",
    };
  }
  if (event.type === "delta") {
    return {
      id: `delta-${Date.now()}-${event.text.slice(0, 12)}`,
      label: event.text,
      status: "running",
    };
  }
  return null;
}

function normalizeCard(card: AnswerCueCard): AnswerCueCard {
  return {
    ...card,
    questionText: sanitizeDisplayText(card.questionText),
    strategy: sanitizeDisplayText(card.strategy),
    openingLine: sanitizeDisplayText(card.openingLine),
    bullets: card.bullets.map((item) => sanitizeDisplayText(item)),
    risks: card.risks.map((item) => sanitizeDisplayText(item)),
    followUps: card.followUps.map((item) => sanitizeDisplayText(item)),
  };
}

function stripMarkdown(text: string): string {
  return repairText(text).replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function ContextKeywordStrip({ position }: { position: Position }) {
  const keywords = [...position.job.hardSkills, ...position.job.softSkills, ...position.job.keywords].filter(Boolean).slice(0, 10);
  if (keywords.length === 0) return null;

  return (
    <details className="keyword-strip">
      <summary>
        <span>JD 关键词</span>
        <ChevronDown size={14} />
      </summary>
      <div className="pill-row">
        {keywords.map((item) => (
          <span key={item} className="pill">
            {repairText(item)}
          </span>
        ))}
      </div>
    </details>
  );
}

function CueCardSkeleton() {
  return (
    <section className="cue-card cue-card-skeleton" aria-busy="true" aria-label="提词卡生成中">
      <header className="cue-card-head">
        <div className="skeleton-line wide" />
        <AiStatusBadge status="generating" />
      </header>
      <div className="cue-section-grid">
        {[100, 85, 70, 60, 90, 50].map((width, index) => (
          <section key={width} className={index < 2 ? "cue-section cue-section-wide" : "cue-section"}>
            <div className="skeleton-line" style={{ width: `${width}%` }} />
          </section>
        ))}
      </div>
    </section>
  );
}

function PersonaBadge({ persona }: { persona: PersonaKey }) {
  const labels: Record<PersonaKey, string> = {
    gentle: "温和鼓励型",
    strict: "专业严格型",
    pressure: "压力测试型",
  };

  return <span className="status-chip warn">{labels[persona]}</span>;
}

function liveTurnLabel(index: number, total: number): string {
  if (total <= 1) return "当前问";
  if (index === total - 1) return "当前问";
  if (index === total - 2) return "上一问";
  return `第 ${index + 1} 问`;
}

export function MockSetupModal({
  config,
  onClose,
  onStart,
}: {
  config: InterviewConfig;
  onClose: () => void;
  onStart: (next: InterviewConfig) => void;
}) {
  const [draft, setDraft] = useState<InterviewConfig>(config);

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="dialog-panel" role="dialog" aria-modal="true" aria-label="开始模拟面试" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="page-eyebrow">进入前配置</span>
            <h2>开始模拟面试</h2>
          </div>
        </header>

        <div className="setup-form">
          <div className="setup-static-note">
            <strong>本轮共 8 题，建议每题控制在 90 秒内回答。</strong>
            <p>每题反馈为本地规则速评，结束后完整报告优先由模型生成。</p>
          </div>
          <label>
            <span>风格</span>
            <select className="input" value={draft.style} aria-label="风格" onChange={(event) => setDraft((current) => ({ ...current, style: event.target.value as PersonaKey }))}>
              <option value="gentle">温和鼓励型</option>
              <option value="strict">专业严格型</option>
              <option value="pressure">压力测试型</option>
            </select>
          </label>
          <label>
            <span>面试官</span>
            <select className="input" value={draft.interviewerRole} aria-label="面试官" onChange={(event) => setDraft((current) => ({ ...current, interviewerRole: event.target.value as InterviewConfig["interviewerRole"] }))}>
              <option value="上级">上级</option>
              <option value="HR">HR 面</option>
              <option value="CTO">技术面</option>
              <option value="CEO">业务面</option>
              <option value="业务负责人">业务负责人</option>
            </select>
          </label>
          <label>
            <span>提交方式</span>
            <select className="input" value={draft.submitMode} aria-label="提交方式" onChange={(event) => setDraft((current) => ({ ...current, submitMode: event.target.value as InterviewConfig["submitMode"] }))}>
              <option value="manual">手动确认</option>
              <option value="auto">自动提交</option>
            </select>
          </label>
        </div>

        <div className="drawer-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="button" onClick={() => onStart(draft)}>
            <Play size={16} />
            开始
          </button>
        </div>
      </aside>
    </div>
  );
}

export function LiveAssistantDashboard({
  workspace,
  profile,
  position,
  onSaveRecord,
  onSaveQuestion,
  isLoggedIn,
  onRequireLogin,
}: {
  workspace: WorkspaceState | null;
  profile: CandidateProfile;
  position: Position;
  onSaveRecord: (payload: { mode: "live"; title: string; transcript: MockMessage[]; cueCards: AnswerCueCard[]; speechMetrics?: ReturnType<typeof analyzeSpeech>[] }) => void;
  onSaveQuestion: (card: AnswerCueCard) => void;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}) {
  return (
    <section className="page page-live desktop-page">
      {!isLoggedIn ? <AuthGateCard onLogin={onRequireLogin} /> : null}
      <LiveAssistantView profile={profile} position={position} onSaveRecord={onSaveRecord} onSaveQuestion={onSaveQuestion} isLoggedIn={isLoggedIn} onRequireLogin={onRequireLogin} />
      {workspace ? <ContextKeywordStrip position={position} /> : null}
    </section>
  );
}

export function LiveAssistantView({
  profile,
  position,
  onSaveRecord,
  onSaveQuestion,
  isLoggedIn,
  onRequireLogin,
}: {
  profile: CandidateProfile;
  position: Position;
  onSaveRecord: (payload: { mode: "live"; title: string; transcript: MockMessage[]; cueCards: AnswerCueCard[]; speechMetrics?: ReturnType<typeof analyzeSpeech>[] }) => void;
  onSaveQuestion: (card: AnswerCueCard) => void;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}) {
  const [recognizedDraft, setRecognizedDraft] = useState<RecognizedDraft>({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 });
  const [captureState, setCaptureState] = useState<SpeechCaptureState>("idle");
  const [submitMode, setSubmitMode] = useState<RealtimeSubmitMode>("manual");
  const [lastGeneratedAt, setLastGeneratedAt] = useState(0);
  const [transcript, setTranscript] = useState<MockMessage[]>([]);
  const [cueCards, setCueCards] = useState<AnswerCueCard[]>([]);
  const [liveCueSessionId, setLiveCueSessionId] = useState("");
  const [liveCueHistory, setLiveCueHistory] = useState<LiveCueSessionTurn[]>([]);
  const [cueMeta, setCueMeta] = useState<AiRunMeta | null>(null);
  const [backendHint, setBackendHint] = useState("");
  const [cueProgress, setCueProgress] = useState<AiProgressItem[]>([]);
  const [listening, setListening] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [inputSource, setInputSource] = useState<"mic" | "bridge">("mic");
  const [bridgePairing, setBridgePairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [bridgePairingLoading, setBridgePairingLoading] = useState(false);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeDeviceName, setBridgeDeviceName] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [bridgeRemainingSec, setBridgeRemainingSec] = useState(0);
  const dictationRef = useRef<DictationHandle | null>(null);
  const cueAbortRef = useRef<AbortController | null>(null);
  const autoGeneratedQuestionRef = useRef("");
  const bridgeUnsubscribeRef = useRef<(() => void) | null>(null);
  const sttSupported = isSpeechRecognitionSupported();
  const speechSupport = getSpeechRecognitionSupport();
  const questionNumber = getQuestionNumber(transcript) + (recognizedDraft.editableText.trim() ? 1 : 0);
  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/onnx/",
    onSpeechEnd: () => {
      if (submitMode !== "auto" || !dictationRef.current) return;
      setCaptureState("finalizing");
      dictationRef.current.stop();
      setListening(false);
    },
  });
  const pauseVadRef = useRef(vad.pause);

  useEffect(() => {
    pauseVadRef.current = vad.pause;
  }, [vad.pause]);

  useEffect(() => () => {
    dictationRef.current?.stop();
    void pauseVadRef.current().catch(() => undefined);
    cueAbortRef.current?.abort();
    bridgeUnsubscribeRef.current?.();
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    if (listening && startedAt) {
      timer = window.setInterval(() => {
        setDurationSec(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
      }, 1000);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [listening, startedAt]);

  useEffect(() => {
    if (!bridgePairing) return;
    const expiresAt = new Date(bridgePairing.expiresAt).getTime();
    const tick = () => setBridgeRemainingSec(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [bridgePairing]);

  const generate = useCallback(
    (sourceText = recognizedDraft.editableText, options?: { dedupe?: boolean }) => {
      if (!sourceText.trim()) return;
      if (!isLoggedIn) {
        onRequireLogin();
        return;
      }
      const question = sourceText.trim();
      if (options?.dedupe && autoGeneratedQuestionRef.current === question) return;
      if (options?.dedupe) autoGeneratedQuestionRef.current = question;
      cueAbortRef.current?.abort();
      const controller = new AbortController();
      cueAbortRef.current = controller;
      const localCard = normalizeCard(generateCueCard(question, profile, position, position.questions, "live"));
      setLastGeneratedAt(Date.now());
      setCaptureState("generating");
      setCueCards((current) => [localCard, ...current.filter((item) => item.id !== localCard.id)]);
      setTranscript((current) => [...current, { role: "interviewer", text: question }]);
      setRecognizedDraft({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 });
      setCueMeta({ backendStatus: "fallback", skillId: CUE_CARD_SKILL_ID, fallbackReason: "正在连接后端模型，先展示本地练习提词卡。", evidenceTrace: [], latencyMs: 0 });
      setBackendHint("本地练习模式已先生成提词卡，正在尝试服务端模型。");
      setCueProgress([{ id: `start-${Date.now()}`, label: "连接后端模型", status: "running" }]);

      void streamCueCardFromServer({
        questionText: question,
        positionId: position.id,
        source: "live",
        enableSearch: true,
        recentHistory: transcript.slice(-4),
        sessionId: liveCueSessionId || undefined,
      }, {
        signal: controller.signal,
        onProgress: (event) => {
          const item = progressItemFromEvent(event);
          if (!item) return;
          startTransition(() => {
            setCueProgress((current) => [...current, item].slice(-5));
            setBackendHint(item.label);
          });
        },
      })
        .then((result) => {
          startTransition(() => {
            setCueCards((current) => [normalizeCard(result.card), ...current.filter((item) => item.id !== localCard.id)]);
            if (result.sessionId) setLiveCueSessionId(result.sessionId);
            if (result.history?.length) {
              setLiveCueHistory(result.history.map((turn) => ({ ...turn, questionText: sanitizeDisplayText(turn.questionText), card: normalizeCard(turn.card) })));
            }
            setCueMeta({
              backendStatus: result.backendStatus,
              skillId: CUE_CARD_SKILL_ID,
              fallbackReason: repairText(result.fallbackReason),
              evidenceTrace: result.evidenceTrace.map((item) => ({ ...item, title: sanitizeDisplayText(item.title), reason: sanitizeDisplayText(item.reason) })),
              latencyMs: result.latencyMs,
            });
            setBackendHint(result.backendStatus === "success" ? `模型生成 · ${result.latencyMs}ms` : `本地练习 · ${repairText(result.fallbackReason)}`);
            const doneItem: AiProgressItem = { id: `done-${Date.now()}`, label: result.backendStatus === "success" ? "模型提词卡已生成" : "已切回本地练习结果", status: result.backendStatus };
            setCueProgress((current) => [...current, doneItem].slice(-5));
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            startTransition(() => {
              setCueMeta((current) => current ? { ...current, fallbackReason: "已取消服务端生成，当前保留本地练习提词卡。" } : current);
              setBackendHint("已取消服务端生成，当前保留本地练习提词卡。");
              const cancelItem: AiProgressItem = { id: `cancel-${Date.now()}`, label: "已取消服务端生成", status: "fallback" };
              setCueProgress((current) => [...current, cancelItem].slice(-5));
            });
            return;
          }
          const reason = describeAiFailure(error, "服务端暂时不可用");
          console.error("live.generate cue card failed", error);
          startTransition(() => {
            setCueMeta({
              backendStatus: "fallback",
              skillId: CUE_CARD_SKILL_ID,
              fallbackReason: `服务端失败：${reason}。当前保留本地练习提词卡。`,
              evidenceTrace: [],
              latencyMs: 0,
            });
            setBackendHint(`服务端失败：${reason}；当前继续使用本地练习卡。`);
            const errorItem: AiProgressItem = { id: `error-${Date.now()}`, label: reason, status: "error" };
            setCueProgress((current) => [...current, errorItem].slice(-5));
          });
        })
        .finally(() => {
          if (cueAbortRef.current === controller) cueAbortRef.current = null;
          startTransition(() => setCaptureState("ready"));
        });
    },
    [isLoggedIn, liveCueSessionId, onRequireLogin, position, profile, recognizedDraft.editableText, transcript],
  );

  useEffect(() => {
    if (submitMode !== "auto") return;
    if (!recognizedDraft.lastFinalAt || recognizedDraft.lastFinalAt <= lastGeneratedAt) return;
    const timer = window.setTimeout(() => {
      if (recognizedDraft.editableText.trim() && recognizedDraft.lastFinalAt > lastGeneratedAt) generate(recognizedDraft.editableText, { dedupe: true });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [generate, lastGeneratedAt, recognizedDraft.editableText, recognizedDraft.lastFinalAt, submitMode]);

  const toggleDictation = () => {
    if (listening) {
      setCaptureState("finalizing");
      dictationRef.current?.stop();
      void vad.pause().catch(() => undefined);
      setListening(false);
      return;
    }

    if (!sttSupported) {
      setVoiceError("当前浏览器不支持语音识别，请直接输入面试官问题。");
      setCaptureState("error");
      return;
    }

    setVoiceError("");
    setStartedAt(Date.now());
    setListening(true);
    setCaptureState("listening");
    dictationRef.current = startDictation({
      lang: "zh-CN",
      onText: (text, isFinal) => {
        setRecognizedDraft((current) => {
          if (!isFinal) return { ...current, interimText: text };
          const finalText = [current.finalText, text].filter(Boolean).join(current.finalText ? " " : "").trim();
          return { interimText: "", finalText, editableText: finalText, lastFinalAt: Date.now() };
        });
        if (isFinal) setCaptureState("ready");
      },
      onError: (message) => {
        setVoiceError(message);
        setListening(false);
        setStartedAt(null);
        void vad.pause().catch(() => undefined);
        setCaptureState("error");
      },
      onEnd: () => {
        setListening(false);
        void vad.pause().catch(() => undefined);
        setCaptureState((current) => (current === "error" ? "error" : "ready"));
      },
    });
    if (!dictationRef.current) {
      setVoiceError("麦克风启动失败，请重试或直接输入文字。");
      setListening(false);
      setStartedAt(null);
      setCaptureState("error");
      return;
    }
    if (!vad.errored) void vad.start().catch(() => undefined);
  };

  const stopBridgeSubscription = useCallback(() => {
    bridgeUnsubscribeRef.current?.();
    bridgeUnsubscribeRef.current = null;
    setBridgeConnected(false);
    setBridgeDeviceName("");
    setBridgePairing(null);
  }, []);

  const handleBridgeEvent = useCallback((event: AudioBridgeStreamEvent) => {
    if (event.type === "bridge_status") {
      setBridgeConnected(event.connected);
      setBridgeDeviceName(event.connected ? event.deviceName ?? "" : "");
      if (event.connected) {
        setBridgePairing(null);
        setBridgeError("");
      }
      return;
    }
    if (event.type === "interim") {
      setRecognizedDraft((current) => ({ ...current, interimText: repairText(event.text) }));
      return;
    }
    if (event.type === "final") {
      setRecognizedDraft((current) => {
        const finalText = [current.finalText, repairText(event.text)].filter(Boolean).join(current.finalText ? " " : "").trim();
        return { interimText: "", finalText, editableText: finalText, lastFinalAt: Date.now() };
      });
      return;
    }
    if (event.type === "error") {
      setBridgeError(event.code === "ASR_NOT_CONFIGURED" ? "服务端尚未配置语音识别，暂时无法使用系统音频听取。" : repairText(event.message || "系统音频听取出现异常。"));
      return;
    }
  }, []);

  const startBridgePairing = () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setBridgeError("");
    setBridgePairingLoading(true);
    void requestAudioBridgePairingCode()
      .then((result) => {
        setBridgePairing(result);
        if (!bridgeUnsubscribeRef.current) {
          bridgeUnsubscribeRef.current = subscribeToAudioBridgeEvents(handleBridgeEvent);
        }
      })
      .catch((error) => {
        console.error("audio-bridge.pair failed", error);
        setBridgeError(describeAiFailure(error, "获取配对码失败，请重试"));
      })
      .finally(() => setBridgePairingLoading(false));
  };

  const selectInputSource = (next: "mic" | "bridge") => {
    if (next === inputSource) return;
    if (next === "mic") {
      stopBridgeSubscription();
    } else if (listening) {
      setCaptureState("finalizing");
      dictationRef.current?.stop();
      void vad.pause().catch(() => undefined);
      setListening(false);
    }
    setInputSource(next);
  };

  const clearDraft = () => {
    cueAbortRef.current?.abort();
    setRecognizedDraft({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 });
    setCaptureState("idle");
    setBackendHint("");
    setCueMeta(null);
    setCueProgress([]);
    autoGeneratedQuestionRef.current = "";
  };

  const save = () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    const speechMetrics = transcript.length > 0 ? [analyzeSpeech(transcript.map((item) => item.text).join(" "), Math.max(durationSec, 30))] : [];
    onSaveRecord({ mode: "live", title: `${repairText(position.title)} 实时助手`, transcript, cueCards, speechMetrics });
    setShowFinishConfirm(false);
  };

  return (
    <>
      <section className="desktop-topbar live-topbar live-statusbar">
        <div className="desktop-topbar-main">
          <span className={`live-dot ${cueMeta?.backendStatus === "success" ? "active" : ""}`} />
          <strong>{repairText(position.company)} · {repairText(position.title)}</strong>
          <div className="quiet-toggle-group status-toggle" aria-label="生成模式">
            <button type="button" className={submitMode === "manual" ? "quiet-toggle active" : "quiet-toggle"} onClick={() => setSubmitMode("manual")}>
              手动确认
            </button>
            <button type="button" className={submitMode === "auto" ? "quiet-toggle active" : "quiet-toggle"} onClick={() => setSubmitMode("auto")}>
              自动生成
            </button>
          </div>
        </div>
        <div className="desktop-topbar-meta">
          <span>第 {questionNumber} 题</span>
          <span><Timer size={14} /> {formatDuration(durationSec)}</span>
          <span>{formatMetaLabel(cueMeta)}</span>
          <button className="button secondary compact-button" type="button" onClick={() => setShowFinishConfirm(true)} disabled={cueCards.length === 0 && transcript.length === 0}>
            结束
          </button>
        </div>
      </section>

      <div className="cockpit-layout">
        <section className="surface-card voice-capture-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">问题输入</span>
                <h2>面试官问题</h2>
              </div>
              <div className="quiet-toggle-group" aria-label="输入来源">
                <button type="button" className={inputSource === "mic" ? "quiet-toggle active" : "quiet-toggle"} onClick={() => selectInputSource("mic")}>
                  麦克风
                </button>
                <button type="button" className={inputSource === "bridge" ? "quiet-toggle active" : "quiet-toggle"} onClick={() => selectInputSource("bridge")}>
                  系统音频
                </button>
              </div>
            </div>

            {inputSource === "mic" ? (
              <>
                {speechSupport.supported && !speechSupport.fullySupported ? (
                  <div className="speech-compat-warning" role="alert">
                    <span aria-hidden="true">!</span>
                    <span>当前浏览器对语音识别的支持有限，建议使用 Chrome 或 Edge 获得更稳定体验。你仍可使用文字输入模式继续练习。</span>
                  </div>
                ) : null}

                <button className={listening ? "button danger voice-main-button recording" : "button primary voice-main-button"} type="button" onClick={toggleDictation}>
                  <Mic size={18} />
                  {listening ? "停止听取" : "开始听取"}
                </button>

                {voiceError ? <div className="inline-message error">{repairText(voiceError)}</div> : null}
                {!sttSupported ? <p className="form-hint">当前浏览器不支持语音识别，已自动降级为文本输入。</p> : null}
                {vad.errored ? <p className="form-hint">语音活动检测加载失败，已切换为手动停止模式。</p> : null}
              </>
            ) : (
              <>
                <p className="form-hint">通过 Windows 桌面端音频桥，直接听取腾讯会议、飞书等应用播放的面试官声音，无需对着麦克风说话。</p>

                {bridgeConnected ? (
                  <div className="inline-message success">
                    <Headphones size={14} /> 已连接：{bridgeDeviceName || "音频桥设备"}，正在听取系统音频。
                  </div>
                ) : bridgePairing ? (
                  <div className="inline-message warn">
                    配对码：<strong style={{ fontSize: "1.2em", letterSpacing: "0.2em" }}>{bridgePairing.pairingCode}</strong>
                    <br />
                    请在音频桥桌面程序中输入此配对码。{bridgeRemainingSec > 0 ? `${bridgeRemainingSec}秒后过期` : "配对码已过期，请重新生成"}
                  </div>
                ) : (
                  <button className="button primary voice-main-button" type="button" onClick={startBridgePairing} disabled={bridgePairingLoading}>
                    <Headphones size={18} />
                    {bridgePairingLoading ? "正在生成配对码..." : "生成配对码"}
                  </button>
                )}

                {bridgeError ? <div className="inline-message error">{bridgeError}</div> : null}
                {(bridgePairing || bridgeConnected) ? (
                  <button className="button secondary" type="button" onClick={stopBridgeSubscription}>
                    停止系统音频听取
                  </button>
                ) : null}
              </>
            )}

            <div className="recognized-box live-recognition-box">
              <span>
                {recognizedDraft.finalText || recognizedDraft.editableText
                  ? "已识别，可继续编辑"
                  : inputSource === "bridge"
                    ? bridgeConnected ? "正在听取系统音频" : "等待音频桥连接"
                    : listening ? "正在听取问题" : "等待输入问题"}
              </span>
              {recognizedDraft.interimText ? <p className="recognized-interim">{recognizedDraft.interimText}</p> : <p className="recognized-placeholder">正在等待语音或文本输入。</p>}
            </div>

            <label className="field-label" htmlFor="live-question-input">问题文本</label>
            <textarea
              id="live-question-input"
              className="input textarea"
              value={recognizedDraft.editableText}
              aria-label="实时问题输入"
              onChange={(event) => setRecognizedDraft((current) => ({ ...current, editableText: event.target.value }))}
              placeholder="例如：请介绍一个你做过最有挑战性的产品功能。"
            />

            <div className="cta-row">
              <button className="button secondary" type="button" onClick={clearDraft} disabled={!recognizedDraft.editableText && !recognizedDraft.interimText}>
                清空 / 重录
              </button>
              <button className="button primary" type="button" onClick={() => generate()} disabled={!recognizedDraft.editableText.trim() || captureState === "generating"}>
                {captureState === "generating" ? "正在生成..." : "生成提词卡"}
                <ArrowRight size={16} />
              </button>
            </div>

            <AiProgressPanel items={cueProgress} onCancel={captureState === "generating" ? () => cueAbortRef.current?.abort() : undefined} />
            {backendHint ? <div className={cueMeta?.backendStatus === "success" ? "inline-message success" : "inline-message warn"}>{backendHint}</div> : null}
          </div>
        </section>

        <section className="surface-card cue-stack-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">提词卡</span>
                <h2>当前回答框架</h2>
              </div>
            </div>
            {captureState === "generating" && cueCards.length === 0 ? <CueCardSkeleton /> : <CueCardPanel card={cueCards[0]} meta={cueMeta} onSaveQuestion={(card) => {
              if (!isLoggedIn) {
                onRequireLogin();
                return;
              }
              onSaveQuestion(card);
            }} />}
            {liveCueHistory.length > 0 ? (
              <details className="live-cue-history">
                <summary>多轮对话历史（{liveCueHistory.length}）</summary>
                <div className="live-cue-history-list">
                  {liveCueHistory.map((turn, index) => (
                    <article key={turn.id} className="live-cue-history-item">
                      <span>{liveTurnLabel(index, liveCueHistory.length)} · {sanitizeDisplayText(turn.questionText)}</span>
                      <CueCardPanel card={turn.card} meta={turn.meta} onSaveQuestion={(card) => {
                        if (!isLoggedIn) {
                          onRequireLogin();
                          return;
                        }
                        onSaveQuestion(card);
                      }} />
                    </article>
                  ))}
                </div>
              </details>
            ) : cueCards.slice(1, 3).map((card, index) => (
              <article key={card.id} className="cue-history-card">
                <span>#{index + 1} · 已处理</span>
                <strong>{repairText(card.questionText)}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>

      {showFinishConfirm ? (
        <div className="drawer-backdrop" role="presentation" onClick={() => setShowFinishConfirm(false)}>
          <aside className="dialog-panel compact-dialog" role="dialog" aria-modal="true" aria-label="结束实时助手" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <span className="page-eyebrow">结束</span>
                <h2>保存本次实时助手记录？</h2>
              </div>
            </header>
            <p className="dialog-copy">停止听取不会清空已识别文本；结束后会把当前 transcript 和题词卡保存到面试记录。</p>
            <div className="drawer-actions">
              <button className="button secondary" type="button" onClick={() => setShowFinishConfirm(false)}>
                继续
              </button>
              <button className="button primary" type="button" onClick={save}>
                保存并结束
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function InterviewRoomView({
  workspace,
  profile,
  position,
  onSaveRecord,
  onSaveQuestion,
  config,
  isLoggedIn,
  onRequireLogin,
}: {
  workspace: WorkspaceState;
  profile: CandidateProfile;
  position: Position;
  onSaveRecord: (payload: {
    mode: "mock";
    title: string;
    transcript: MockMessage[];
    cueCards: AnswerCueCard[];
    serverRecordId?: string;
    turn?: MockTurn;
    speechMetrics?: ReturnType<typeof analyzeSpeech>[];
    report?: InterviewRecord["report"];
    conversationHistory?: ConversationMessage[];
    aiMeta?: InterviewRecord["aiMeta"];
  }) => void;
  onSaveQuestion: (card: AnswerCueCard) => void;
  config: InterviewConfig;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}) {
  const questionPlan = useMemo(() => {
    const priority = workspace.questions.filter((question) => question.priority);
    const rest = workspace.questions.filter((question) => !question.priority);
    return [...priority, ...rest].slice(0, 8);
  }, [workspace.questions]);

  const [interviewConfig, setInterviewConfig] = useState<InterviewConfig>(config ?? DEFAULT_CONFIG);
  const [setupOpen, setSetupOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answerDraft, setAnswerDraft] = useState<RecognizedDraft>(
    () => loadMockDraft(position.id)?.answerDraft ?? { interimText: "", finalText: "", editableText: "", lastFinalAt: 0 },
  );
  const [transcript, setTranscript] = useState<MockMessage[]>([{ role: "interviewer", text: questionPlan[0]?.question ?? "请先介绍一段和当前岗位最相关的经历。" }]);
  const [cueCards, setCueCards] = useState<AnswerCueCard[]>(() => loadMockDraft(position.id)?.cueCards ?? []);
  const [cueMeta, setCueMeta] = useState<AiRunMeta | null>(null);
  const [cueProgress, setCueProgress] = useState<AiProgressItem[]>([]);
  const [cueCardLoading, setCueCardLoading] = useState(false);
  const [backendHint, setBackendHint] = useState("正在创建模拟面试房间，服务端不可用时会自动进入本地练习模式。");
  const [sessionBackendStatus, setSessionBackendStatus] = useState<"success" | "fallback" | "cache" | "error">("fallback");
  const [questionSourceLabel, setQuestionSourceLabel] = useState("");
  const [instantFeedback, setInstantFeedback] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [latestServerRecord, setLatestServerRecord] = useState<InterviewRecord | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmittedAt, setLastSubmittedAt] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const dictationRef = useRef<DictationHandle | null>(null);
  const cueAbortRef = useRef<AbortController | null>(null);
  const questionPlanLengthRef = useRef(questionPlan.length);
  useEffect(() => {
    questionPlanLengthRef.current = questionPlan.length;
  }, [questionPlan.length]);
  const sttSupported = isSpeechRecognitionSupported();
  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/onnx/",
    onSpeechEnd: () => {
      if (interviewConfig.submitMode !== "auto" || !dictationRef.current) return;
      dictationRef.current.stop();
      setListening(false);
    },
  });
  const pauseVadRef = useRef(vad.pause);

  useEffect(() => {
    pauseVadRef.current = vad.pause;
  }, [vad.pause]);

  const currentQuestion = questionPlan[questionIndex] ?? workspace.questions[0];
  const currentAnswer = workspace.answers.find((item) => item.questionId === currentQuestion?.id);
  const currentPrompt = transcript.filter((message) => message.role === "interviewer").at(-1)?.text ?? currentQuestion?.question ?? "";
  const totalQuestions = Math.max(1, questionPlan.length);
  const progressPercent = `${Math.min(100, Math.round(((questionIndex + 1) / totalQuestions) * 100))}%`;
  const answer = answerDraft.editableText;

  useEffect(() => {
    const hasContent = answerDraft.editableText.trim().length > 0 || answerDraft.finalText.trim().length > 0 || cueCards.length > 0;
    if (!hasContent) {
      clearMockDraft(position.id);
      return;
    }
    saveMockDraft(position.id, { answerDraft, cueCards });
  }, [answerDraft, cueCards, position.id]);

  useEffect(() => () => {
    dictationRef.current?.stop();
    void pauseVadRef.current().catch(() => undefined);
    cueAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (setupOpen) return;
    let active = true;
    void createMockSessionOnServer(position.id, interviewConfig as unknown as Record<string, unknown>)
      .then((result) => {
        if (!active) return;
        setSessionId(result.sessionId);
        const restoredTranscript = (result.conversationHistory ?? []).map((item) => ({
          role: item.role,
          text: stripMarkdown(item.text),
        })) as MockMessage[];
        setTranscript(restoredTranscript.length > 0 ? restoredTranscript : [{ role: "interviewer", text: stripMarkdown(result.question) }]);
        setConversationHistory(result.conversationHistory ?? []);
        const answeredCount = restoredTranscript.filter((message) => message.role === "candidate").length;
        setQuestionIndex(Math.min(answeredCount, questionPlanLengthRef.current - 1));
        setQuestionSourceLabel(formatQuestionSourceLabel(result.questionSource ?? (result.backendStatus === "success" ? "model" : "local")));
        setSessionBackendStatus(result.backendStatus ?? "fallback");
        setBackendHint(
          result.backendStatus === "cache"
            ? "已恢复上次未完成的模拟面试。"
            : result.backendStatus === "success"
              ? "模型面试官已接入"
              : `本地练习模式${result.meta?.fallbackReason ? ` · ${repairText(result.meta.fallbackReason)}` : ""}`,
        );
        startedAtRef.current = Date.now();
      })
      .catch((error) => {
        const reason = describeAiFailure(error, "服务端暂时不可用");
        console.error("mock.createSession failed", error);
        if (!active) return;
        setSessionId((current) => current || "local-fallback");
        setSessionBackendStatus("error");
        setBackendHint(`服务端失败：${reason}；当前为本地练习模式，回答将仅保存在本地。`);
        startedAtRef.current = Date.now();
      });
    return () => {
      active = false;
    };
  }, [interviewConfig, position.id, setupOpen]);

  useEffect(() => {
    if (setupOpen || !startedAtRef.current) return;
    const timer = window.setInterval(() => {
      setDurationSec(Math.max(0, Math.round((Date.now() - (startedAtRef.current ?? Date.now())) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [setupOpen]);

  const toggleDictation = () => {
    if (listening) {
      dictationRef.current?.stop();
      void vad.pause().catch(() => undefined);
      setListening(false);
      return;
    }
    if (!sttSupported) {
      setVoiceError("当前浏览器不支持语音识别，可以直接输入作答内容。");
      return;
    }
    setVoiceError("");
    setListening(true);
    dictationRef.current = startDictation({
      lang: "zh-CN",
      onText: (text, isFinal) => {
        setAnswerDraft((current) => {
          if (!isFinal) return { ...current, interimText: text };
          const finalText = [current.finalText, text].filter(Boolean).join(current.finalText ? " " : "").trim();
          return { interimText: "", finalText, editableText: finalText, lastFinalAt: Date.now() };
        });
      },
      onError: (message) => {
        setVoiceError(message);
        setListening(false);
        void vad.pause().catch(() => undefined);
      },
      onEnd: () => {
        setListening(false);
        void vad.pause().catch(() => undefined);
      },
    });
    if (!dictationRef.current) {
      setVoiceError("麦克风启动失败，请重试或直接输入文字。");
      setListening(false);
      return;
    }
    if (!vad.errored) void vad.start().catch(() => undefined);
  };

  const showCueCard = () => {
    if (!currentPrompt.trim()) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    const localCard = normalizeCard(generateCueCard(currentPrompt, profile, position, workspace.questions, "mock"));
    cueAbortRef.current?.abort();
    const controller = new AbortController();
    cueAbortRef.current = controller;
    setCueCards((current) => [localCard, ...current.filter((item) => item.id !== localCard.id)]);
    setCueMeta({ backendStatus: "fallback", skillId: CUE_CARD_SKILL_ID, fallbackReason: "正在连接后端模型，先展示本地练习提词卡。", evidenceTrace: [], latencyMs: 0 });
    setBackendHint("本地规则已先生成提词卡。");
    setCueProgress([{ id: `mock-start-${Date.now()}`, label: "连接后端模型", status: "running" }]);
    setCueCardLoading(true);

    void streamCueCardFromServer({
      questionText: currentPrompt,
      positionId: position.id,
      source: "mock",
      enableSearch: false,
      recentHistory: transcript.slice(-4),
    }, {
      signal: controller.signal,
      onProgress: (event) => {
        const item = progressItemFromEvent(event);
        if (!item) return;
        startTransition(() => {
          setCueProgress((current) => [...current, item].slice(-5));
          setBackendHint(item.label);
        });
      },
    })
      .then((result) => {
        startTransition(() => {
          setCueCards((current) => [normalizeCard(result.card), ...current.filter((item) => item.id !== localCard.id)]);
          setCueMeta({
            backendStatus: result.backendStatus,
            skillId: CUE_CARD_SKILL_ID,
            fallbackReason: repairText(result.fallbackReason),
            evidenceTrace: result.evidenceTrace.map((item) => ({ ...item, title: sanitizeDisplayText(item.title), reason: sanitizeDisplayText(item.reason) })),
            latencyMs: result.latencyMs,
          });
          setBackendHint(result.backendStatus === "success" ? `模型生成 · ${result.latencyMs}ms` : `本地练习 · ${repairText(result.fallbackReason)}`);
          const doneItem: AiProgressItem = { id: `mock-done-${Date.now()}`, label: result.backendStatus === "success" ? "模型提词卡已生成" : "已切回本地练习结果", status: result.backendStatus };
          setCueProgress((current) => [...current, doneItem].slice(-5));
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          startTransition(() => {
            setBackendHint("已取消服务端生成，当前保留本地练习提词卡。");
            const cancelItem: AiProgressItem = { id: `mock-cancel-${Date.now()}`, label: "已取消服务端生成", status: "fallback" };
            setCueProgress((current) => [...current, cancelItem].slice(-5));
          });
          return;
        }
        const reason = describeAiFailure(error, "服务端暂时不可用");
        console.error("mock.showCueCard failed", error);
        startTransition(() => {
          setCueMeta({
            backendStatus: "fallback",
            skillId: CUE_CARD_SKILL_ID,
            fallbackReason: `服务端失败：${reason}。当前保留本地练习提词卡。`,
            evidenceTrace: [],
            latencyMs: 0,
          });
          setBackendHint(`服务端失败：${reason}；当前继续使用本地练习卡。`);
          const errorItem: AiProgressItem = { id: `mock-error-${Date.now()}`, label: reason, status: "error" };
          setCueProgress((current) => [...current, errorItem].slice(-5));
        });
      })
      .finally(() => {
        if (cueAbortRef.current === controller) cueAbortRef.current = null;
        setCueCardLoading(false);
      });
  };

  const submitAnswer = useCallback(() => {
    if (!answer.trim() || !currentQuestion || submitting || !sessionId) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setSubmitting(true);
    setLastSubmittedAt(Date.now());
    setBackendHint("模型面试官思考中...");
    const history: MockMessage[] = [...transcript, { role: "candidate", text: answer.trim() }];
    setTranscript(history);
    setAnswerDraft({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 });

    void answerMockSessionOnServer({
      sessionId,
      positionId: position.id,
      questionId: currentQuestion.id,
      answer: answer.trim(),
      transcript: history,
    })
      .then((result) => {
        const followUp = stripMarkdown(result.followUp || questionPlan[questionIndex + 1]?.question || generateFollowUpFromTranscript(history, profile, position));
        setTranscript([...history, { role: "interviewer", text: followUp }]);
        setConversationHistory(result.conversationHistory ?? []);
        setLatestServerRecord(result.record);
        setInstantFeedback(repairText(result.decision?.instantFeedback ?? ""));
        setQuestionSourceLabel(result.backendStatus === "success" ? (result.decision?.type === "next" ? "模型下一题" : "模型追问") : "本地追问");
        setSessionBackendStatus(result.backendStatus ?? "fallback");
        setBackendHint(result.backendStatus === "success" ? "模型面试官已根据回答继续追问" : `本地练习模式${result.meta?.fallbackReason ? ` · ${repairText(result.meta.fallbackReason)}` : ""}`);
      })
      .catch((error) => {
        const reason = describeAiFailure(error, "服务端暂时不可用");
        console.error("mock.submitAnswer failed", error);
        const followUp = stripMarkdown(questionPlan[questionIndex + 1]?.question ?? generateFollowUpFromTranscript(history, profile, position));
        setTranscript([...history, { role: "interviewer", text: followUp }]);
        setSessionBackendStatus("error");
        setBackendHint(`服务端失败：${reason}；当前继续使用本地追问。`);
      })
      .finally(() => {
        setQuestionIndex((current) => Math.min(current + 1, questionPlan.length - 1));
        setSubmitting(false);
      });
  }, [answer, currentQuestion, isLoggedIn, onRequireLogin, position, profile, questionIndex, questionPlan, sessionId, submitting, transcript]);

  useEffect(() => {
    if (interviewConfig.submitMode !== "auto") return;
    if (!answerDraft.lastFinalAt || answerDraft.lastFinalAt <= lastSubmittedAt) return;
    const timer = window.setTimeout(() => {
      if (answerDraft.editableText.trim()) submitAnswer();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [answerDraft.editableText, answerDraft.lastFinalAt, interviewConfig.submitMode, lastSubmittedAt, submitAnswer]);

  const finish = () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    const finalTranscript = answer.trim() ? [...transcript, { role: "candidate" as const, text: answer.trim() }] : transcript;
    const finalAnswer = answer.trim() || finalTranscript.filter((message) => message.role === "candidate").at(-1)?.text || "";
    const speechMetrics = analyzeSpeech(finalAnswer, Math.max(durationSec, Math.round(finalAnswer.length / 3), 20));
    const turn = currentQuestion ? evaluateMockTurn(currentQuestion, finalAnswer || "未完成回答", currentAnswer) : undefined;
    const fullTurn = turn ? { ...turn, transcript: finalTranscript, speechMetrics } : undefined;

    onSaveRecord({
      mode: "mock",
      title: `${repairText(workspace.job.title)} 模拟面试`,
      transcript: finalTranscript,
      cueCards,
      serverRecordId: latestServerRecord?.id,
      turn: fullTurn,
      speechMetrics: [speechMetrics],
      report: latestServerRecord?.report,
      conversationHistory: latestServerRecord?.conversationHistory ?? conversationHistory,
      aiMeta: latestServerRecord?.aiMeta,
    });
    clearMockDraft(position.id);
    setFinishConfirmOpen(false);
  };

  if (setupOpen) {
    return <MockSetupModal config={interviewConfig} onClose={() => setSetupOpen(false)} onStart={(next) => {
      if (!isLoggedIn) {
        onRequireLogin();
        return;
      }
      setInterviewConfig(next);
      setSetupOpen(false);
    }} />;
  }

  return (
    <>
      <section className="page page-mock desktop-page">
        {!isLoggedIn ? <AuthGateCard onLogin={onRequireLogin} /> : null}
        <section className="desktop-topbar mock-topbar mock-statusbar">
          <div className="desktop-topbar-main">
            <strong>{repairText(position.company)} · {repairText(position.title)}</strong>
            <span>第 {Math.min(questionIndex + 1, totalQuestions)} / {totalQuestions} 题</span>
            <PersonaBadge persona={interviewConfig.style} />
          </div>
          <div className="desktop-topbar-meta">
            <span><Timer size={14} /> {formatDuration(durationSec)}</span>
            <button className="button secondary compact-button" type="button" onClick={() => setFinishConfirmOpen(true)}>
              结束
            </button>
          </div>
        </section>

        <div className="mock-progress-bar-line">
          <span style={{ width: progressPercent }} />
        </div>

        <div className="mock-room-layout">
          <div className="mock-main-column">
            <QuestionCard
              category={repairText(currentQuestion?.category ?? "综合题")}
              question={stripMarkdown(currentPrompt || currentQuestion?.question || "请介绍一段最相关的经历。")}
              intent={repairText(currentQuestion?.reason || "考察表达结构、岗位相关性和证据完整度。")}
              evidence={currentQuestion?.evidenceIds?.[0] ? `关联证据：${currentQuestion.evidenceIds[0]}` : "关联证据：请主动引用简历中的项目结果。"}
            />

            <section className="surface-card mock-dialog-card">
              <div className="surface-card-inner">
                <div className="section-row-header">
                  <div>
                    <span className="subtle-label">{repairText(interviewConfig.interviewerRole)} · {repairText(interviewConfig.difficulty)}</span>
                    <h1>模拟面试对话</h1>
                  </div>
                </div>
                <div className="mock-chat-thread" aria-label="模拟面试对话记录">
                  {transcript.map((message, index) => (
                    <article key={`${message.role}-${index}-${message.text.slice(0, 12)}`} className={message.role === "candidate" ? "mock-message candidate" : "mock-message interviewer"}>
                      <span>{message.role === "candidate" ? "我" : repairText(interviewConfig.interviewerRole)}</span>
                      <p>{stripMarkdown(message.text)}</p>
                    </article>
                  ))}
                  {answer.trim() ? (
                    <article className="mock-message candidate draft">
                      <span>我 · 草稿</span>
                      <p>{answer.trim()}</p>
                    </article>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="surface-card">
              <div className="surface-card-inner">
                <label className="field-label" htmlFor="mock-answer-textarea">你的回答</label>
                <textarea
                  id="mock-answer-textarea"
                  className="input textarea tall"
                  value={answer}
                  aria-label="模拟面试回答"
                  onChange={(event) => setAnswerDraft((current) => ({ ...current, editableText: event.target.value }))}
                  placeholder="先给结论，再补动作、证据和结果。"
                />
                {answerDraft.interimText ? <p className="recognized-interim">{answerDraft.interimText}</p> : null}
                {voiceError ? <div className="inline-message error">{repairText(voiceError)}</div> : null}
                {!sttSupported ? <p className="form-hint">当前浏览器不支持语音识别，已自动降级为文本输入。</p> : null}
                {vad.errored ? <p className="form-hint">语音活动检测加载失败，已切换为手动停止模式。</p> : null}
                {instantFeedback ? <div className="inline-message success">{instantFeedback}</div> : null}
                {questionSourceLabel ? <p className="form-hint">题目来源：{questionSourceLabel}</p> : null}
                {backendHint ? <div className={sessionBackendStatus === "success" ? "inline-message success" : "inline-message warn"}>{backendHint}</div> : null}
                <AiProgressPanel items={cueProgress} onCancel={cueCardLoading ? () => cueAbortRef.current?.abort() : undefined} />
              </div>
            </section>

            <footer className="voice-dock simplified-voice-dock">
              <button
                className={listening ? "button danger voice-main-button" : "button primary voice-main-button"}
                type="button"
                onClick={() => {
                  if (!listening && answer.trim()) {
                    submitAnswer();
                    return;
                  }
                  toggleDictation();
                }}
              >
                {answer.trim() && !listening ? <Check size={18} /> : <Mic size={18} />}
                {listening ? "停止" : answer.trim() ? "提交当前回答" : "语音作答"}
              </button>
              <div className="voice-dock-group">
                <button className="button secondary" type="button" onClick={() => setAnswerDraft({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 })}>
                  跳过
                </button>
                <button className="button danger" type="button" onClick={() => setFinishConfirmOpen(true)}>
                  结束
                </button>
              </div>
            </footer>
          </div>

          <aside className="mock-side-column">
            <section className="surface-card">
              <div className="surface-card-inner">
                <div className="section-row-header">
                  <div>
                    <span className="subtle-label">提词卡</span>
                    <h2>当前回答框架</h2>
                  </div>
                  <button className="button secondary" type="button" onClick={showCueCard}>
                    生成提词卡
                  </button>
                </div>
                {cueCardLoading && cueCards.length === 0 ? <CueCardSkeleton /> : <CueCardPanel card={cueCards[0]} meta={cueMeta} onSaveQuestion={(card) => {
                  if (!isLoggedIn) {
                    onRequireLogin();
                    return;
                  }
                  onSaveQuestion(card);
                }} />}
              </div>
            </section>
          </aside>
        </div>
      </section>

      {finishConfirmOpen ? (
        <div className="drawer-backdrop" role="presentation" onClick={() => setFinishConfirmOpen(false)}>
          <aside className="dialog-panel compact-dialog" role="dialog" aria-modal="true" aria-label="结束模拟面试" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <span className="page-eyebrow">结束</span>
                <h2>保存本次模拟面试报告？</h2>
              </div>
            </header>
            <p className="dialog-copy">结束后会保存 transcript、题词卡、评分与追问结果，并进入面试记录。</p>
            <div className="drawer-actions">
              <button className="button secondary" type="button" onClick={() => setFinishConfirmOpen(false)}>
                继续作答
              </button>
              <button className="button primary" type="button" onClick={finish} disabled={submitting}>
                <Check size={16} />
                保存并结束
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
