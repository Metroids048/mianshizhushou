import { useMicVAD } from "@ricky0123/vad-react";
import {
  AlertTriangle,
  BookOpen,
  Database,
  Headphones,
  Loader2,
  LogOut,
  Mic,
  MonitorSpeaker,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  createPositionOnServer,
  fetchStateSnapshot,
  listAudioBridgeDevicesOnServer,
  reconstructCueCard,
  requestAudioBridgePairingCode,
  runResumeAiOnServer,
  streamCueCardFromServer,
  subscribeToAudioBridgeEvents,
  updatePositionMaterialsOnServer,
  updateProfileOnServer,
  upsertPositionIntakeOnServer,
  type AiRunMeta,
  type AudioBridgeDevice,
  type AudioBridgeStreamEvent,
  type LiveCueSessionTurn,
  type ResumeAiResponse,
} from "../../lib/apiClient";
import { useAuth, type AuthSession } from "../../lib/auth";
import { createProfile, generateCueCard } from "../../lib/interviewEngine";
import { makeId, nowIso } from "../../lib/ids";
import { describeAiFailure } from "../../lib/requestError";
import { getSpeechRecognitionSupport, startBrowserAudioDictation, startDictation, type DictationHandle } from "../../lib/speech";
import type { AnswerCueCard, CandidateProfile, EvidenceItem, Position, PositionMaterial } from "../../types";
import { AccountPage } from "../account/AccountPage";
import { ForgotPasswordPage } from "../auth/RecoveryPages";

type ToolPage = "desk" | "library" | "account" | "forgot";
type ListenMode = "manual" | "mic" | "browser" | "bridge";
type GenerationMode = "manual" | "auto";
type CaptureState = "idle" | "listening" | "ready" | "generating" | "error";
type ResumeAction = "section" | "full" | "match";
type VadApi = { start: () => Promise<void>; pause: () => Promise<void>; errored: boolean };

type AuthResponse = {
  user?: {
    id: string;
    phone: string | null;
    email?: string | null;
    emailVerifiedAt?: string | null;
    displayName: string;
    notificationPrefs?: AuthSession["notificationPrefs"];
  };
  tokens?: { accessToken: string; expiresAt: string };
  error?: string;
};

interface RecognizedDraft {
  interimText: string;
  finalText: string;
  editableText: string;
  lastFinalAt: number;
}

interface UserWorkspace {
  resumeText: string;
  projectMaterials: PositionMaterial[];
  targetJd: string;
  evidenceLibrary: EvidenceItem[];
  cueCardHistory: LiveCueSessionTurn[];
  audioDevices: AudioBridgeDevice[];
}

const EMPTY_META: AiRunMeta = {
  backendStatus: "fallback",
  skillId: "copilot_cue_card",
  fallbackReason: "尚未生成服务端提词卡。",
  evidenceTrace: [],
  latencyMs: 0,
};

function currentPageFromLocation(): ToolPage {
  if (typeof window === "undefined") return "desk";
  if (window.location.pathname === "/account") return "account";
  if (window.location.pathname === "/forgot-password") return "forgot";
  return window.location.pathname === "/library" ? "library" : "desk";
}

function normalizePath(page: ToolPage) {
  if (page === "library") return "/library";
  if (page === "account") return "/account";
  if (page === "forgot") return "/forgot-password";
  return "/";
}

function firstPosition(positions: Position[], activePositionId: string): Position | undefined {
  return positions.find((item) => item.id === activePositionId) ?? positions[0];
}

function toWorkspace(profile: CandidateProfile, position: Position | undefined, cueCardHistory: LiveCueSessionTurn[], audioDevices: AudioBridgeDevice[]): UserWorkspace {
  return {
    resumeText: profile.resumeText,
    projectMaterials: position?.materials ?? [],
    targetJd: position?.intake.rawJdText || position?.jobText || "",
    evidenceLibrary: profile.evidenceLibrary,
    cueCardHistory,
    audioDevices,
  };
}

function parseKeywords(text: string): string[] {
  return Array.from(new Set((text.match(/[A-Za-z0-9+#.\u4e00-\u9fa5]{2,}/g) ?? []).slice(0, 12))).slice(0, 8);
}

function materialFromText(text: string): PositionMaterial {
  const title = text.split(/\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 48) || "项目资料";
  return {
    id: makeId("material-project"),
    kind: "project",
    source: "manual",
    title,
    detail: text.trim(),
    summary: text.trim().slice(0, 160),
    keywords: parseKeywords(text),
    tags: ["项目资料"],
    linkedQuestionIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function fallbackProfile(): CandidateProfile {
  return createProfile("");
}

function readableStatus(meta: AiRunMeta | null) {
  if (!meta) return "未生成";
  if (meta.backendStatus === "success") return `模型生成 · ${meta.latencyMs}ms`;
  if (meta.backendStatus === "cache") return "缓存结果";
  return `本地练习 · ${meta.fallbackReason || "模型未配置"}`;
}

function authErrorText(value: unknown) {
  const text = String(value);
  if (text.includes("PHONE_ALREADY_REGISTERED")) return "该手机号已注册，请直接登录。";
  if (text.includes("INVALID_CREDENTIALS")) return "手机号或密码错误。";
  if (text.includes("无效的手机号")) return "请输入有效的手机号。";
  return "登录或注册失败，请稍后重试。";
}

export function YinpinJiantingApp() {
  const auth = useAuth();
  const [page, setPage] = useState<ToolPage>(() => currentPageFromLocation());
  const [profile, setProfile] = useState<CandidateProfile>(() => fallbackProfile());
  const [positions, setPositions] = useState<Position[]>([]);
  const [activePositionId, setActivePositionId] = useState("");
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState("");
  const [draftResume, setDraftResume] = useState("");
  const [draftProject, setDraftProject] = useState("");
  const [draftJd, setDraftJd] = useState("");
  const [retrievalProbe, setRetrievalProbe] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [recognizedDraft, setRecognizedDraft] = useState<RecognizedDraft>({ interimText: "", finalText: "", editableText: "", lastFinalAt: 0 });
  const [listenMode, setListenMode] = useState<ListenMode>("manual");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("manual");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [currentCard, setCurrentCard] = useState<AnswerCueCard | null>(null);
  const [cueMeta, setCueMeta] = useState<AiRunMeta | null>(null);
  const [cueProgress, setCueProgress] = useState<string[]>([]);
  const [liveCueSessionId, setLiveCueSessionId] = useState("");
  const [cueCardHistory, setCueCardHistory] = useState<LiveCueSessionTurn[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioBridgeDevice[]>([]);
  const [bridgePairing, setBridgePairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeDeviceName, setBridgeDeviceName] = useState("");
  const [bridgeAsrLabel, setBridgeAsrLabel] = useState("");
  const [bridgeAudioLevel, setBridgeAudioLevel] = useState<{ rms: number; peak: number; bytesSent: number; at: number } | null>(null);
  const [bridgeAudioFresh, setBridgeAudioFresh] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const [resumeAction, setResumeAction] = useState<ResumeAction>("match");
  const [resumeResult, setResumeResult] = useState<ResumeAiResponse | null>(null);
  const [resumeGenerating, setResumeGenerating] = useState(false);
  const [librarySaving, setLibrarySaving] = useState<"resume" | "project" | "jd" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const dictationRef = useRef<DictationHandle | null>(null);
  const bridgeUnsubscribeRef = useRef<(() => void) | null>(null);
  const bridgeAudioFreshTimerRef = useRef<number | null>(null);
  const cueAbortRef = useRef<AbortController | null>(null);
  const lastGeneratedQuestionRef = useRef("");
  const vadApiRef = useRef<VadApi | null>(null);

  const activePosition = useMemo(() => firstPosition(positions, activePositionId), [positions, activePositionId]);
  const workspace = useMemo(() => toWorkspace(profile, activePosition, cueCardHistory, audioDevices), [profile, activePosition, cueCardHistory, audioDevices]);
  const speechSupport = useMemo(() => getSpeechRecognitionSupport(), []);

  const syncSnapshot = useCallback((snapshot: { profile: CandidateProfile; positions: Position[]; activePositionId: string }) => {
    setProfile(snapshot.profile);
    setPositions(snapshot.positions);
    setActivePositionId(snapshot.activePositionId || snapshot.positions[0]?.id || "");
    const position = firstPosition(snapshot.positions, snapshot.activePositionId);
    setDraftResume(snapshot.profile.resumeText);
    setDraftJd(position?.intake.rawJdText || position?.jobText || "");
  }, []);

  const refreshSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const snapshot = await fetchStateSnapshot();
      syncSnapshot(snapshot);
      if (auth.isLoggedIn) {
        const devices = await listAudioBridgeDevicesOnServer().catch(() => ({ devices: [] }));
        setAudioDevices(devices.devices);
      }
    } catch (error) {
      setSyncMessage(`同步失败：${describeAiFailure(error, "当前先展示本地状态")}`);
    } finally {
      setSnapshotLoading(false);
    }
  }, [auth.isLoggedIn, syncSnapshot]);

  useEffect(() => {
    if (auth.loading) return;
    const timer = window.setTimeout(() => {
      void refreshSnapshot();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth.loading, refreshSnapshot]);

  useEffect(() => () => {
    dictationRef.current?.stop();
    bridgeUnsubscribeRef.current?.();
    if (bridgeAudioFreshTimerRef.current !== null) window.clearTimeout(bridgeAudioFreshTimerRef.current);
    cueAbortRef.current?.abort();
    void vadApiRef.current?.pause().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPop = () => setPage(currentPageFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: ToolPage) => {
    setPage(next);
    window.history.pushState({}, "", normalizePath(next));
  };

  const requireLogin = useCallback(() => {
    if (auth.isLoggedIn) return true;
    setSyncMessage("请先登录，资料、提词卡历史和音频桥设备需要绑定到你的账号。");
    return false;
  }, [auth.isLoggedIn]);

  const submitAuth = async () => {
    if (!/^1[3-9]\d{9}$/.test(authPhone)) {
      setAuthError("请输入有效的手机号。");
      return;
    }
    if (authPassword.length < 8) {
      setAuthError("密码至少 8 位。");
      return;
    }
    setAuthError("");
    try {
      const response = await fetch(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: authPhone,
          password: authPassword,
          ...(authMode === "register" && authName.trim() ? { displayName: authName.trim() } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok || !data.user || !data.tokens) throw new Error(data.error || response.statusText);
      auth.setAuth({ ...data.user, userId: data.user.id }, data.tokens);
      await refreshSnapshot();
    } catch (error) {
      setAuthError(authErrorText(error));
    }
  };

  const ensurePosition = useCallback(async (preferredJd?: string): Promise<Position | null> => {
    if (activePosition) return activePosition;
    if (!requireLogin()) return null;
    const rawJdText = preferredJd?.trim() || draftJd.trim() || "目标岗位 JD 待补充。此岗位仅用于保存项目资料和提词卡历史。";
    const snapshot = await createPositionOnServer(rawJdText);
    syncSnapshot(snapshot);
    return firstPosition(snapshot.positions, snapshot.activePositionId) ?? null;
  }, [activePosition, draftJd, requireLogin, syncSnapshot]);

  const saveResume = async () => {
    if (!requireLogin()) return;
    const parsed = createProfile(draftResume);
    setLibrarySaving("resume");
    try {
      const snapshot = await updateProfileOnServer({
        displayName: auth.session?.displayName || parsed.displayName,
        resumeText: draftResume,
        evidenceLibrary: parsed.evidenceLibrary,
        highlights: parsed.highlights,
      });
      syncSnapshot(snapshot);
      setSyncMessage("简历已保存，并重新沉淀为可引用证据。");
    } catch (error) {
      setSyncMessage(`简历保存失败：${describeAiFailure(error, "请稍后重试")}`);
    } finally {
      setLibrarySaving(null);
    }
  };

  const saveJd = async () => {
    if (!requireLogin()) return;
    if (!draftJd.trim()) {
      setSyncMessage("请先粘贴目标岗位 JD。");
      return;
    }
    setLibrarySaving("jd");
    try {
      const snapshot = await upsertPositionIntakeOnServer({
        positionId: activePosition?.id,
        rawJdText: draftJd,
        inferredFields: [],
        confirmedFields: [],
      });
      syncSnapshot(snapshot);
      setSyncMessage("目标 JD 已保存，并进入资料库检索范围。");
    } catch (error) {
      setSyncMessage(`JD 保存失败：${describeAiFailure(error, "请稍后重试")}`);
    } finally {
      setLibrarySaving(null);
    }
  };

  const saveProject = async () => {
    if (!draftProject.trim()) {
      setSyncMessage("请先粘贴项目资料。");
      return;
    }
    setLibrarySaving("project");
    try {
      const position = await ensurePosition();
      if (!position) return;
      const material = materialFromText(draftProject);
      const response = await updatePositionMaterialsOnServer(position.id, [material, ...position.materials]);
      setPositions((current) => current.map((item) => (item.id === response.position.id ? response.position : item)));
      setActivePositionId(response.position.id);
      setDraftProject("");
      setSyncMessage("项目资料已保存，并重新进入 RAG 资料库。");
    } catch (error) {
      setSyncMessage(`项目资料保存失败：${describeAiFailure(error, "请稍后重试")}`);
    } finally {
      setLibrarySaving(null);
    }
  };

  const generateCueCardFromQuestion = useCallback(
    async (sourceText = questionText || recognizedDraft.editableText, options?: { dedupe?: boolean }) => {
      const text = sourceText.trim();
      if (!text) {
        setSyncMessage("请先输入或识别到面试官问题。");
        return;
      }
      if (!requireLogin()) return;
      if (options?.dedupe && lastGeneratedQuestionRef.current === text) return;
      if (options?.dedupe) lastGeneratedQuestionRef.current = text;
      const positionForCard = activePosition ?? await ensurePosition();
      if (!positionForCard) return;
      cueAbortRef.current?.abort();
      const controller = new AbortController();
      cueAbortRef.current = controller;
      setCaptureState("generating");
      setCueProgress(["识别问题", "检索简历、项目资料和目标 JD"]);
      const localCard = generateCueCard(text, profile, positionForCard, positionForCard.questions, "live");
      setCurrentCard(localCard);
      setCueMeta({ ...EMPTY_META, fallbackReason: "正在连接服务端模型，先展示本地练习提词卡。" });
      try {
        const result = await streamCueCardFromServer(
          {
            questionText: text,
            positionId: positionForCard.id,
            source: "live",
            enableSearch: false,
            sessionId: liveCueSessionId || undefined,
          },
          {
            signal: controller.signal,
            onProgress: (event) => {
              if (event.type === "stage") startTransition(() => setCueProgress((current) => [...current, event.label].slice(-5)));
              if (event.type === "delta") startTransition(() => setCueProgress((current) => [...current, event.text].slice(-5)));
            },
          },
        );
        setCurrentCard(result.card);
        setCueMeta({
          backendStatus: result.backendStatus,
          skillId: "copilot_cue_card",
          fallbackReason: result.fallbackReason,
          evidenceTrace: result.evidenceTrace,
          latencyMs: result.latencyMs,
        });
        if (result.sessionId) setLiveCueSessionId(result.sessionId);
        if (result.history) setCueCardHistory(result.history);
        setCueProgress((current) => [...current, result.backendStatus === "success" ? "模型提词卡已生成" : "已明确切回本地练习模式"].slice(-5));
      } catch (error) {
        if (!controller.signal.aborted) {
          setCueMeta({ ...EMPTY_META, fallbackReason: `服务端失败：${describeAiFailure(error, "当前保留本地练习提词卡")}` });
          setCueProgress((current) => [...current, "服务端失败，已保留本地练习提词卡"].slice(-5));
        }
      } finally {
        if (cueAbortRef.current === controller) cueAbortRef.current = null;
        setCaptureState("ready");
      }
    },
    [activePosition, ensurePosition, liveCueSessionId, profile, questionText, recognizedDraft.editableText, requireLogin],
  );

  useEffect(() => {
    if (generationMode !== "auto") return;
    if (!recognizedDraft.lastFinalAt) return;
    const timer = window.setTimeout(() => {
      const text = recognizedDraft.editableText.trim();
      if (text && text !== lastGeneratedQuestionRef.current) {
        void generateCueCardFromQuestion(text, { dedupe: true });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [generationMode, generateCueCardFromQuestion, recognizedDraft.editableText, recognizedDraft.lastFinalAt]);

  const rewriteCard = async (feedback: string) => {
    if (!currentCard) return;
    if (!requireLogin()) return;
    setCaptureState("generating");
    setCueProgress([`正在改写：${feedback}`]);
    try {
      const result = await reconstructCueCard({
        questionText: currentCard.questionText,
        positionId: activePosition?.id,
        feedback,
        originalCard: currentCard,
      });
      setCurrentCard(result.card);
      setCueMeta({
        backendStatus: result.backendStatus,
        skillId: "copilot_cue_card_reconstruct",
        fallbackReason: result.fallbackReason,
        evidenceTrace: result.evidenceTrace,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      setSyncMessage(`改写失败：${describeAiFailure(error, "请稍后重试")}`);
    } finally {
      setCaptureState("ready");
    }
  };

  const stopDictation = () => {
    dictationRef.current?.stop();
    dictationRef.current = null;
    void vadApiRef.current?.pause().catch(() => undefined);
    setCaptureState("ready");
  };

  const updateFinalText = useCallback((text: string, isFinal: boolean) => {
    setRecognizedDraft((current) => {
      if (!isFinal) return { ...current, interimText: text };
      const finalText = [current.finalText, text].filter(Boolean).join(current.finalText ? " " : "").trim();
      setQuestionText(finalText);
      return { interimText: "", finalText, editableText: finalText, lastFinalAt: Date.now() };
    });
  }, []);

  const startListening = (mode: Exclude<ListenMode, "manual" | "bridge">) => {
    setVoiceError("");
    setListenMode(mode);
    setCaptureState("listening");
    const starter = mode === "browser" ? startBrowserAudioDictation : startDictation;
    const handle = starter({
      lang: "zh-CN",
      onText: updateFinalText,
      onError: (message) => {
        setVoiceError(message);
        setCaptureState("error");
      },
      onEnd: () => setCaptureState((current) => (current === "error" ? "error" : "ready")),
    });
    if (!handle) {
      setVoiceError(mode === "browser" ? "当前浏览器不支持共享浏览器音频，请改用麦克风或系统音频桥。" : "当前浏览器不支持语音识别，请直接输入问题。");
      setCaptureState("error");
      return;
    }
    dictationRef.current = handle;
    if (mode === "mic" && !vadApiRef.current?.errored) void vadApiRef.current?.start().catch(() => undefined);
  };

  const handleBridgeEvent = useCallback((event: AudioBridgeStreamEvent) => {
    if (event.type === "bridge_status") {
      setBridgeConnected(event.connected);
      setBridgeDeviceName(event.connected ? event.deviceName ?? "" : "");
      if (event.asrReady && event.asrProvider) setBridgeAsrLabel(event.asrProvider === "debug" ? "诊断转写模式" : `${event.asrProvider} 已就绪`);
      if (!event.connected) {
        setBridgeAsrLabel("");
        setBridgeAudioLevel(null);
        setBridgeAudioFresh(false);
      }
      if (event.connected) setBridgePairing(null);
      return;
    }
    if (event.type === "ready") {
      setBridgeAsrLabel(event.provider === "debug" ? "诊断转写模式" : `${event.provider} 已就绪`);
      return;
    }
    if (event.type === "bridge_audio") {
      setBridgeAudioLevel({ rms: event.rms, peak: event.peak, bytesSent: event.bytesSent, at: Date.now() });
      setBridgeAudioFresh(true);
      if (bridgeAudioFreshTimerRef.current !== null) window.clearTimeout(bridgeAudioFreshTimerRef.current);
      bridgeAudioFreshTimerRef.current = window.setTimeout(() => setBridgeAudioFresh(false), 5000);
      return;
    }
    if (event.type === "interim") {
      setRecognizedDraft((current) => ({ ...current, interimText: event.text }));
      return;
    }
    if (event.type === "final") {
      updateFinalText(event.text, true);
      return;
    }
    if (event.type === "error") {
      setBridgeError(event.code === "ASR_NOT_CONFIGURED" ? "ASR_NOT_CONFIGURED：音频桥已连接，但服务端实时语音识别未配置。" : event.message);
      if (event.code === "ASR_NOT_CONFIGURED") setBridgeAsrLabel("ASR 未配置");
    }
  }, [updateFinalText]);

  const startBridge = async () => {
    if (!requireLogin()) return;
    setListenMode("bridge");
    setBridgeError("");
    try {
      if (!bridgeUnsubscribeRef.current) bridgeUnsubscribeRef.current = subscribeToAudioBridgeEvents(handleBridgeEvent);
      const result = await requestAudioBridgePairingCode("yinpinjianting");
      setBridgePairing(result);
      const devices = await listAudioBridgeDevicesOnServer().catch(() => ({ devices: [] }));
      setAudioDevices(devices.devices);
    } catch (error) {
      setBridgeError(`音频桥配对失败：${describeAiFailure(error, "请稍后重试")}`);
    }
  };

  const stopBridge = () => {
    bridgeUnsubscribeRef.current?.();
    bridgeUnsubscribeRef.current = null;
    setBridgeConnected(false);
    setBridgeDeviceName("");
    setBridgeAsrLabel("");
    setBridgeAudioLevel(null);
    setBridgeAudioFresh(false);
    setBridgePairing(null);
  };

  const runResumeAi = async () => {
    if (!requireLogin()) return;
    const text = draftResume.trim() || profile.resumeText;
    if (!text.trim()) {
      setSyncMessage("请先保存或粘贴简历。");
      return;
    }
    setResumeGenerating(true);
    try {
      const response = await runResumeAiOnServer({
        positionId: activePosition?.id,
        action: resumeAction,
        sectionId: "summary",
        sectionTitle: resumeAction === "full" ? "整份简历" : resumeAction === "match" ? "匹配目标 JD" : "当前片段",
        currentText: text,
        fullResumeText: text,
      });
      setResumeResult(response);
    } catch (error) {
      setResumeResult({
        reply: `服务端失败：${describeAiFailure(error, "当前无法生成模型建议")}`,
        suggestion: "请先补充真实简历、目标 JD 和项目结果数据，再重新生成建议。",
        evidenceTrace: [],
        applyTarget: "section",
        meta: { ...EMPTY_META, fallbackReason: "简历优化服务端失败，已显示本地提示。" },
      });
    } finally {
      setResumeGenerating(false);
    }
  };

  const runRetrievalProbe = async () => {
    const query = retrievalProbe.trim() || "请根据我的项目资料回答这个问题";
    setQuestionText(query);
    await generateCueCardFromQuestion(query);
    setPage("desk");
    window.history.pushState({}, "", "/");
  };

  const authPanel = !auth.isLoggedIn ? (
    <section className="yp-auth-panel" aria-label="最小登录">
      <div>
        <span className="yp-kicker">最小登录态</span>
        <h2>登录后保存资料库和音频桥设备</h2>
      </div>
      <div className="yp-auth-tabs">
        <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>登录</button>
        <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>注册</button>
      </div>
      <input className="yp-input" value={authPhone} onChange={(event) => setAuthPhone(event.target.value)} placeholder="手机号" />
      <input className="yp-input" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="至少 8 位密码" />
      {authMode === "register" ? <input className="yp-input" value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="昵称，可选" /> : null}
      {authError ? <p className="yp-error">{authError}</p> : null}
      <button className="yp-button primary" type="button" onClick={submitAuth}>{authMode === "register" ? "注册并进入工具" : "登录"}</button>
      {authMode === "login" ? (
        <button className="yp-link-button" type="button" onClick={() => navigate("forgot")}>
          忘记密码？查看处理方式
        </button>
      ) : null}
    </section>
  ) : null;

  return (
    <main className="yp-app">
      {listenMode === "mic" ? (
        <VadController
          apiRef={vadApiRef}
          onSpeechEnd={() => {
            if (generationMode !== "auto") return;
            dictationRef.current?.stop();
            setCaptureState("ready");
          }}
        />
      ) : null}
      <header className="yp-topbar">
        <div>
          <span className="yp-kicker">AI 面试监听提词工具</span>
          <h1>yinpinjianting</h1>
        </div>
        <nav className="yp-nav" aria-label="工具导航">
          <button type="button" className={page === "desk" ? "active" : ""} onClick={() => navigate("desk")}>
            <Headphones size={16} /> 监听提词台
          </button>
          <button type="button" className={page === "library" ? "active" : ""} onClick={() => navigate("library")}>
            <Database size={16} /> 资料库
          </button>
          {auth.isLoggedIn ? (
            <button type="button" className={page === "account" ? "active" : ""} onClick={() => navigate("account")}>
              <UserRound size={16} /> 账号
            </button>
          ) : null}
        </nav>
        <div className="yp-account">
          {auth.isLoggedIn ? <span>{auth.session?.displayName || "已登录"}</span> : <span>未登录</span>}
          {auth.isLoggedIn ? (
            <button type="button" className="yp-icon-button" onClick={auth.clearAuth} aria-label="退出登录">
              <LogOut size={16} />
            </button>
          ) : null}
        </div>
      </header>

      {syncMessage ? <div className="yp-message">{syncMessage}</div> : null}
      {snapshotLoading ? <div className="yp-message"><Loader2 size={14} className="yp-spin" /> 正在同步资料库...</div> : null}

      {page === "desk" ? (
        <section className="yp-desk">
          <section className="yp-panel yp-listen-panel">
            <div className="yp-section-head">
              <span className="yp-kicker">输入来源</span>
              <h2>监听输入区</h2>
            </div>
            <div className="yp-segmented" aria-label="监听模式选择">
              {[
                ["manual", "手动"] as const,
                ["mic", "麦克风"] as const,
                ["browser", "浏览器音频"] as const,
                ["bridge", "系统音频桥"] as const,
              ].map(([mode, label]) => (
                <button key={mode} type="button" className={listenMode === mode ? "active" : ""} onClick={() => setListenMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="yp-segmented compact" aria-label="生成模式">
              <button type="button" className={generationMode === "manual" ? "active" : ""} onClick={() => setGenerationMode("manual")}>手动生成</button>
              <button type="button" className={generationMode === "auto" ? "active" : ""} onClick={() => setGenerationMode("auto")}>自动生成</button>
            </div>
            {listenMode === "mic" && !speechSupport.fullySupported ? (
              <p className="yp-hint">
                {speechSupport.supported
                  ? "当前浏览器的语音识别支持有限，建议使用 Chrome 或 Edge；也可以直接编辑下方文字。"
                  : "当前浏览器不支持语音识别，请直接编辑下方文字，或改用系统音频桥。"}
              </p>
            ) : null}
            <div className="yp-listen-actions">
              {listenMode === "mic" ? (
                captureState === "listening" ? (
                  <button className="yp-button danger" type="button" onClick={stopDictation}><Mic size={16} /> 停止听取</button>
                ) : (
                  <button className="yp-button primary" type="button" onClick={() => startListening("mic")}><Mic size={16} /> 开始麦克风监听</button>
                )
              ) : null}
              {listenMode === "browser" ? (
                captureState === "listening" ? (
                  <button className="yp-button danger" type="button" onClick={stopDictation}><MonitorSpeaker size={16} /> 停止浏览器音频</button>
                ) : (
                  <button className="yp-button primary" type="button" onClick={() => startListening("browser")}><MonitorSpeaker size={16} /> 共享浏览器音频</button>
                )
              ) : null}
              {listenMode === "bridge" ? (
                bridgeConnected || bridgePairing ? (
                  <button className="yp-button secondary" type="button" onClick={stopBridge}><Headphones size={16} /> 停止系统音频桥</button>
                ) : (
                  <button className="yp-button primary" type="button" onClick={startBridge}><Headphones size={16} /> 生成配对码</button>
                )
              ) : null}
            </div>
            {listenMode === "browser" ? <p className="yp-hint">浏览器音频只适合浏览器标签页或共享窗口音频；腾讯会议、飞书桌面端请用系统音频桥。</p> : null}
            {listenMode === "bridge" ? (
              <div className="yp-bridge-box">
                {bridgeConnected ? <p className="yp-success">已连接：{bridgeDeviceName || "音频桥设备"}，正在等待转写事件。</p> : null}
                {bridgePairing ? <p>配对码 <strong>{bridgePairing.pairingCode}</strong>，在桌面桥程序中输入后连接。</p> : null}
                {bridgePairing ? <p className="yp-hint">桌面桥命令：dotnet run --project audio-bridge/AudioBridge.csproj -- --server http://127.0.0.1:8897</p> : null}
                <div className="yp-bridge-checks" aria-label="系统音频桥状态">
                  <span className={bridgeConnected ? "ok" : ""}>桥连接</span>
                  <span className={bridgeAsrLabel && bridgeAsrLabel !== "ASR 未配置" ? "ok" : bridgeAsrLabel === "ASR 未配置" ? "warn" : ""}>
                    {bridgeAsrLabel || "等待 ASR"}
                  </span>
                  <span className={bridgeAudioFresh ? "ok" : ""}>
                    {bridgeAudioLevel ? `系统音频 rms ${(bridgeAudioLevel.rms * 100).toFixed(1)}%` : "等待系统音频"}
                  </span>
                </div>
                {bridgeAudioLevel ? <p className="yp-hint">最近音频：peak {(bridgeAudioLevel.peak * 100).toFixed(1)}%，本秒发送 {Math.round(bridgeAudioLevel.bytesSent / 1024)} KB。</p> : null}
                {bridgeAsrLabel === "诊断转写模式" ? <p className="yp-hint">当前使用 ASR_PROVIDER=debug，只用于验证桥链路，不代表真实会议转写质量。</p> : null}
                {bridgeError ? <p className="yp-error">{bridgeError}</p> : null}
              </div>
            ) : null}
            {voiceError ? <p className="yp-error">{voiceError}</p> : null}
            <div className="yp-transcript">
              <span>{captureState === "listening" ? "正在监听" : recognizedDraft.editableText || questionText ? "已识别，可编辑" : "等待输入"}</span>
              {recognizedDraft.interimText ? <p>{recognizedDraft.interimText}</p> : <p className="muted">interim 文本会显示在这里，停止监听不会清空 final 文本。</p>}
            </div>
            <label className="yp-field">
              <span>当前面试官问题</span>
              <textarea
                className="yp-textarea"
                rows={7}
                value={questionText || recognizedDraft.editableText}
                onChange={(event) => {
                  setQuestionText(event.target.value);
                  setRecognizedDraft((current) => ({ ...current, editableText: event.target.value }));
                }}
                placeholder="例如：请介绍一个你做过的项目，以及你具体负责什么？"
              />
            </label>
            <button className="yp-button primary wide" type="button" onClick={() => generateCueCardFromQuestion()} disabled={captureState === "generating"}>
              <Send size={16} /> {captureState === "generating" ? "生成中..." : "生成提词卡"}
            </button>
          </section>

          <section className="yp-panel yp-card-panel">
            <div className="yp-section-head">
              <span className="yp-kicker">Cue Card</span>
              <h2>提词卡</h2>
            </div>
            {currentCard ? (
              <article className="yp-cue-card">
                <span className="yp-status">{readableStatus(cueMeta)}</span>
                {cueMeta?.backendStatus !== "success" ? (
                  <div className="yp-ai-notice" role="status">
                    当前显示本地练习内容，未连接真实模型。请配置可用的 AI 服务后重试，避免把练习稿当成正式回答。
                  </div>
                ) : null}
                <h3>{currentCard.questionText}</h3>
                <section>
                  <strong>推荐开场</strong>
                  <p>{currentCard.openingLine}</p>
                </section>
                <section>
                  <strong>3 个回答要点</strong>
                  <ol>
                    {currentCard.bullets.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                  </ol>
                </section>
                <section>
                  <strong>可引用项目证据</strong>
                  {cueMeta?.evidenceTrace?.length ? (
                    <ul>
                      {cueMeta.evidenceTrace.map((item) => <li key={item.id}>{item.title}：{item.reason}</li>)}
                    </ul>
                  ) : (
                    <p className="muted">还没有服务端证据 trace。请先补充资料库，或等待模型返回。</p>
                  )}
                </section>
                <section>
                  <strong>风险提醒</strong>
                  <ul>{currentCard.risks.map((item) => <li key={item}>{item}</li>)}</ul>
                </section>
                <section>
                  <strong>可能追问</strong>
                  <ul>{currentCard.followUps.map((item) => <li key={item}>{item}</li>)}</ul>
                </section>
                <div className="yp-rewrite-row">
                  {["更简短", "更有数据感", "更像产品经理", "更适合大厂"].map((label) => (
                    <button key={label} type="button" className="yp-button secondary" onClick={() => rewriteCard(label)}>
                      <Pencil size={14} /> {label}
                    </button>
                  ))}
                </div>
              </article>
            ) : (
              <div className="yp-empty">
                <Sparkles size={22} />
                <h3>先输入一个真实面试问题</h3>
                <p>提词卡会优先引用你的简历、项目资料和目标 JD。</p>
              </div>
            )}
            {cueProgress.length ? <div className="yp-progress">{cueProgress.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div> : null}
          </section>

          <aside className="yp-panel yp-context-panel">
            <div className="yp-section-head">
              <span className="yp-kicker">Workspace</span>
              <h2>资料库状态</h2>
            </div>
            {authPanel}
            <div className="yp-status-list">
              <p><BookOpen size={15} /> 简历：{workspace.resumeText.trim() ? "已导入" : "未导入"}</p>
              <p><Database size={15} /> 项目资料：{workspace.projectMaterials.length} 条</p>
              <p><AlertTriangle size={15} /> 目标 JD：{workspace.targetJd.trim() ? "已设置" : "未设置"}</p>
              <p><Headphones size={15} /> 音频桥设备：{workspace.audioDevices.length} 台</p>
            </div>
            <button type="button" className="yp-button secondary wide" onClick={() => navigate("library")}>管理资料库</button>
            <div className="yp-evidence-list">
              <strong>最近引用的证据</strong>
              {(cueMeta?.evidenceTrace ?? []).slice(0, 4).map((item) => <p key={item.id}>{item.title}</p>)}
              {!cueMeta?.evidenceTrace?.length ? <p className="muted">生成提词卡后显示。</p> : null}
            </div>
          </aside>
        </section>
      ) : page === "library" ? (
        <section className="yp-library">
          <section className="yp-panel yp-library-main">
            <div className="yp-section-head">
              <span className="yp-kicker">Library</span>
              <h2>资料库</h2>
            </div>
            {authPanel}
            <label className="yp-field">
              <span>粘贴简历</span>
              <textarea className="yp-textarea" rows={9} value={draftResume} onChange={(event) => setDraftResume(event.target.value)} placeholder="粘贴你的简历正文，保存后会自动抽取证据。" />
            </label>
            <button className="yp-button primary" type="button" onClick={saveResume} disabled={librarySaving !== null}><RefreshCw size={16} /> {librarySaving === "resume" ? "保存中..." : "保存简历"}</button>
            <label className="yp-field">
              <span>粘贴项目资料</span>
              <textarea className="yp-textarea" rows={8} value={draftProject} onChange={(event) => setDraftProject(event.target.value)} placeholder="粘贴项目背景、你的职责、动作、指标、结果和复盘。" />
            </label>
            <button className="yp-button primary" type="button" onClick={saveProject} disabled={librarySaving !== null}><Database size={16} /> {librarySaving === "project" ? "保存中..." : "保存项目资料"}</button>
            <label className="yp-field">
              <span>粘贴目标岗位 JD</span>
              <textarea className="yp-textarea" rows={7} value={draftJd} onChange={(event) => setDraftJd(event.target.value)} placeholder="粘贴目标岗位 JD 或面试背景。" />
            </label>
            <button className="yp-button primary" type="button" onClick={saveJd} disabled={librarySaving !== null}><BookOpen size={16} /> {librarySaving === "jd" ? "保存中..." : "保存目标 JD"}</button>
          </section>

          <aside className="yp-panel yp-library-side">
            <div className="yp-section-head">
              <span className="yp-kicker">Evidence</span>
              <h2>已解析证据</h2>
            </div>
            <div className="yp-evidence-list tall">
              {workspace.evidenceLibrary.slice(0, 8).map((item) => (
                <article key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <span>{item.impact}</span>
                </article>
              ))}
              {!workspace.evidenceLibrary.length ? <p className="muted">保存简历后会显示证据。</p> : null}
            </div>
            <label className="yp-field">
              <span>测试检索</span>
              <input className="yp-input" value={retrievalProbe} onChange={(event) => setRetrievalProbe(event.target.value)} placeholder="输入一个面试问题测试资料引用" />
            </label>
            <button className="yp-button secondary wide" type="button" onClick={runRetrievalProbe}><Play size={16} /> 用提词卡测试</button>

            <div className="yp-resume-ai">
              <h2>简历优化建议</h2>
              <div className="yp-segmented">
                {[
                  ["section", "优化片段"] as const,
                  ["full", "全量建议"] as const,
                  ["match", "匹配 JD"] as const,
                ].map(([mode, label]) => (
                  <button key={mode} type="button" className={resumeAction === mode ? "active" : ""} onClick={() => setResumeAction(mode)}>{label}</button>
                ))}
              </div>
              <button className="yp-button primary wide" type="button" onClick={runResumeAi} disabled={resumeGenerating}>
                <Sparkles size={16} /> {resumeGenerating ? "生成中..." : "生成优化建议"}
              </button>
              {resumeResult ? (
                <article className="yp-ai-result">
                  <span className="yp-status">{readableStatus(resumeResult.meta)}</span>
                  <p>{resumeResult.reply}</p>
                  <strong>建议</strong>
                  <p>{resumeResult.suggestion}</p>
                  {resumeResult.evidenceTrace.length ? <strong>引用证据</strong> : null}
                  {resumeResult.evidenceTrace.map((item) => <p key={item.id}>{item.title}：{item.reason}</p>)}
                </article>
              ) : null}
            </div>
          </aside>
        </section>
      ) : page === "account" ? (
        <section className="yp-account-page">
          <AccountPage journeyState="ready" showPolicyLinks={false} />
        </section>
      ) : (
        <ForgotPasswordPage />
      )}
    </main>
  );
}

function VadController({ apiRef, onSpeechEnd }: { apiRef: MutableRefObject<VadApi | null>; onSpeechEnd: () => void }) {
  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/onnx/",
    onSpeechEnd,
  });

  useEffect(() => {
    apiRef.current = { start: vad.start, pause: vad.pause, errored: Boolean(vad.errored) };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, vad.errored, vad.pause, vad.start]);

  return null;
}
