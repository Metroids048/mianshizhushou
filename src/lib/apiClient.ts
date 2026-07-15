import type { AnswerCueCard, AppState, CandidateProfile, ConversationMessage, InterviewRecord, MockDecision, MockMessage, Position, PositionIntakeFieldSource, PositionIntakeFieldKey, PositionMaterial } from "../types";
import { apiFetch } from "./authClient";

export interface AiRunMeta {
  backendStatus: "success" | "fallback" | "error" | "cache";
  skillId: string;
  fallbackReason: string;
  promptId?: string;
  provider?: string;
  evidenceTrace: Array<{ id: string; title: string; reason: string; synthetic?: boolean }>;
  latencyMs: number;
  retrievalCount?: number;
  searchUsed?: boolean;
}

export interface CueCardStreamResult {
  card: AnswerCueCard;
  stages: string[];
  backendStatus: "success" | "fallback";
  searchCount: number;
  fallbackReason: string;
  evidenceTrace: AiRunMeta["evidenceTrace"];
  latencyMs: number;
  sessionId?: string;
  history?: LiveCueSessionTurn[];
}

export interface LiveCueSessionTurn {
  id: string;
  questionText: string;
  card: AnswerCueCard;
  meta: AiRunMeta;
  createdAt: string;
}

export type CueCardProgressEvent =
  | { type: "stage"; label: string; status?: string }
  | { type: "delta"; text: string }
  | { type: "done"; label?: string };

export interface CueCardStreamOptions {
  signal?: AbortSignal;
  onProgress?: (event: CueCardProgressEvent) => void;
}

export interface MockSessionResult {
  sessionId: string;
  question: string;
  backendStatus?: "success" | "fallback" | "cache";
  questionSource?: string;
  meta?: AiRunMeta;
  conversationHistory?: ConversationMessage[];
}

export interface MockAnswerInput {
  sessionId?: string;
  positionId?: string;
  questionId?: string;
  answer: string;
  transcript: MockMessage[];
}

export interface MockAnswerResult {
  record: InterviewRecord;
  followUp: string;
  decision?: MockDecision;
  backendStatus?: "success" | "fallback";
  meta?: AiRunMeta;
  conversationHistory?: ConversationMessage[];
}

export interface StoredMockSession {
  id: string;
  positionId: string;
  config?: Record<string, unknown>;
  conversationHistory: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ResumeAiRequest {
  positionId?: string;
  action: "section" | "full" | "match";
  sectionId?: string;
  sectionTitle?: string;
  currentText: string;
  fullResumeText: string;
  userMessage?: string;
}

export interface ResumeAiResponse {
  reply: string;
  suggestion: string;
  evidenceTrace: AiRunMeta["evidenceTrace"];
  applyTarget: "section" | "full";
  meta: AiRunMeta;
}

export interface ImportServerResult {
  state: AppState;
  status: "success" | "partial";
  warnings: string[];
}

export interface IntakeSubmitPayload {
  positionId?: string;
  rawJdText: string;
  inferredFields: Array<{ key: PositionIntakeFieldKey; value: string; source: PositionIntakeFieldSource }>;
  confirmedFields: Array<{ key: PositionIntakeFieldKey; value: string; source: PositionIntakeFieldSource }>;
  messages?: Array<{ role: "assistant" | "user"; text: string }>;
}

export interface IntakeAssistantPayload {
  reply: string;
  missingFields: Array<{ key: PositionIntakeFieldKey; label: string }>;
  confirmedFields: Array<{ key: PositionIntakeFieldKey; label: string; value: string; source: PositionIntakeFieldSource }>;
  suggestedPrompts: string[];
  meta: AiRunMeta;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text().catch(() => response.statusText));
  return (await response.json()) as T;
}

export async function analyzePositionOnServer(jobText: string, positionId?: string): Promise<{ profile: AppState["profile"]; positions: AppState["positions"]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/positions/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobText, positionId }),
  });
  return readJson(response);
}

export async function analyzeProfileOnServer(resumeText: string): Promise<{ profile: AppState["profile"]; positions: AppState["positions"]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/profile/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText }),
  });
  return readJson(response);
}

export async function fetchStateSnapshot(): Promise<{ profile: AppState["profile"]; positions: AppState["positions"]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/state");
  return readJson(response);
}

export async function upsertPositionIntakeOnServer(
  input: IntakeSubmitPayload,
): Promise<{ profile: CandidateProfile; positions: Position[]; activePositionId: string; records: InterviewRecord[]; intakeAssistant: IntakeAssistantPayload }> {
  const response = await apiFetch("/api/positions/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function createPositionOnServer(jobText: string): Promise<{ profile: CandidateProfile; positions: Position[]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/positions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobText }),
  });
  return readJson(response);
}

export async function updateProfileOnServer(input: {
  displayName?: string;
  resumeText: string;
  evidenceLibrary: CandidateProfile["evidenceLibrary"];
  highlights: string[];
}): Promise<{ profile: CandidateProfile; positions: Position[]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function updatePositionMaterialsOnServer(positionId: string, materials: PositionMaterial[]): Promise<{ position: Position }> {
  const response = await apiFetch(`/api/positions/${encodeURIComponent(positionId)}/materials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materials }),
  });
  return readJson(response);
}

export async function updatePositionQuestionsOnServer(positionId: string, questions: Position["questions"]): Promise<{ position: Position }> {
  const response = await apiFetch(`/api/positions/${encodeURIComponent(positionId)}/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions }),
  });
  return readJson(response);
}

export async function updatePositionPreferencesOnServer(
  positionId: string,
  preferences: Position["interviewPreferences"],
): Promise<{ position: Position }> {
  const response = await apiFetch(`/api/positions/${encodeURIComponent(positionId)}/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  return readJson(response);
}

export async function deletePositionOnServer(
  positionId: string,
): Promise<{ profile: CandidateProfile; positions: Position[]; activePositionId: string; records: InterviewRecord[] }> {
  const response = await apiFetch(`/api/positions/${encodeURIComponent(positionId)}`, {
    method: "DELETE",
  });
  return readJson(response);
}

export async function getLatestMockSessionOnServer(positionId: string): Promise<{ session: StoredMockSession }> {
  const response = await apiFetch(`/api/positions/${encodeURIComponent(positionId)}/mock-session`);
  return readJson(response);
}

export async function streamCueCardFromServer(input: {
  questionText: string;
  positionId?: string;
  source?: AnswerCueCard["source"];
  enableSearch?: boolean;
  recentHistory?: MockMessage[];
  sessionId?: string;
}, options: CueCardStreamOptions = {}): Promise<CueCardStreamResult> {
  const response = await apiFetch("/api/copilot/cue-card/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await response.text().catch(() => response.statusText || "CUE_CARD_STREAM_FAILED"));
  if (!response.body) throw new Error("CUE_CARD_STREAM_FAILED");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stages: string[] = [];
  let card: AnswerCueCard | null = null;
  let backendStatus: CueCardStreamResult["backendStatus"] = "fallback";
  let searchCount = 0;
  let fallbackReason = "后端未返回模型状态，当前按本地练习模式处理。";
  let evidenceTrace: CueCardStreamResult["evidenceTrace"] = [];
  let latencyMs = 0;
  let sessionId = "";
  let history: LiveCueSessionTurn[] = [];

  const consumeBlock = (block: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataText = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !dataText) return;

    const data = JSON.parse(dataText) as {
      label?: string;
      status?: CueCardStreamResult["backendStatus"];
      searchCount?: number;
      card?: AnswerCueCard;
      promptRun?: { status?: CueCardStreamResult["backendStatus"]; latencyMs?: number };
      meta?: AiRunMeta;
      sessionId?: string;
      history?: LiveCueSessionTurn[];
    };

    if (event === "stage" && data.label) {
      stages.push(data.label);
      options.onProgress?.({ type: "stage", label: data.label, status: data.status });
      if (data.searchCount !== undefined) searchCount = data.searchCount;
      if (data.status === "success" || data.status === "fallback") backendStatus = data.status;
    }

    if (event === "delta" && typeof dataText === "string") {
      const delta = JSON.parse(dataText) as { text?: string };
      if (delta.text) options.onProgress?.({ type: "delta", text: delta.text });
    }

    if (event === "card" && data.card) {
      card = data.card;
      backendStatus =
        data.meta?.backendStatus === "success"
          ? "success"
          : data.meta?.backendStatus === "cache"
            ? "fallback"
            : data.meta?.backendStatus === "error"
              ? "fallback"
              : data.promptRun?.status === "success"
                ? "success"
                : backendStatus;
      searchCount = data.searchCount ?? searchCount;
      fallbackReason = data.meta?.fallbackReason ?? fallbackReason;
      evidenceTrace = data.meta?.evidenceTrace ?? evidenceTrace;
      latencyMs = data.meta?.latencyMs ?? data.promptRun?.latencyMs ?? latencyMs;
      sessionId = data.sessionId ?? sessionId;
      history = data.history ?? history;
    }

    if (event === "done") options.onProgress?.({ type: "done" });
    if (event === "error") throw new Error(dataText);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() ?? "";
      blocks.forEach(consumeBlock);
    }
    if (done) break;
  }

  if (buffer.trim()) consumeBlock(buffer);
  if (!card) throw new Error("CUE_CARD_EMPTY");
  return { card, stages, backendStatus, searchCount, fallbackReason, evidenceTrace, latencyMs, sessionId: sessionId || undefined, history };
}

export async function saveRecordOnServer(record: InterviewRecord): Promise<{ record: InterviewRecord; records: InterviewRecord[] }> {
  const response = await apiFetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  return readJson(response);
}

export async function createMockSessionOnServer(positionId?: string, config?: Record<string, unknown>): Promise<MockSessionResult> {
  const response = await apiFetch("/api/mock/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positionId, config }),
  });
  return readJson(response);
}

export async function answerMockSessionOnServer(input: MockAnswerInput): Promise<MockAnswerResult> {
  const sessionId = input.sessionId?.trim() || "current";
  const response = await apiFetch(`/api/mock/session/${encodeURIComponent(sessionId)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      positionId: input.positionId,
      questionId: input.questionId,
      answer: input.answer,
      transcript: input.transcript,
    }),
  });
  return readJson(response);
}

export async function completeMockSessionOnServer(sessionId: string): Promise<{ ok: true }> {
  const response = await apiFetch(`/api/mock/session/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
  });
  return readJson(response);
}

export async function exportFromServer(): Promise<AppState> {
  const response = await apiFetch("/api/export", { method: "POST" });
  return readJson(response);
}

export async function importToServer(state: AppState): Promise<ImportServerResult> {
  const response = await apiFetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  return readJson(response);
}

export async function followUpFromServer(transcript: MockMessage[], positionId?: string): Promise<string> {
  const response = await apiFetch("/api/copilot/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, positionId }),
  });
  const data = await readJson<{ question: string }>(response);
  return data.question;
}

export async function runResumeAiOnServer(input: ResumeAiRequest): Promise<ResumeAiResponse> {
  const response = await apiFetch("/api/resume/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function generateProfileHighlightsOnServer(input: {
  resumeText: string;
  displayName?: string;
  positionId?: string;
}): Promise<{ highlights: string[]; meta: AiRunMeta }> {
  const response = await apiFetch("/api/profile/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function reconstructCueCard(input: {
  questionText: string;
  positionId?: string;
  feedback: string;
  originalCard: AnswerCueCard;
}, options: CueCardStreamOptions = {}): Promise<CueCardStreamResult> {
  const response = await apiFetch("/api/copilot/cue-card/reconstruct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await response.text().catch(() => response.statusText || "RECONSTRUCT_STREAM_FAILED"));
  if (!response.body) throw new Error("RECONSTRUCT_STREAM_FAILED");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stages: string[] = [];
  let card: AnswerCueCard | null = null;
  let backendStatus: CueCardStreamResult["backendStatus"] = "fallback";
  let fallbackReason = "后端未返回重构结果。";
  let evidenceTrace: CueCardStreamResult["evidenceTrace"] = [];
  let latencyMs = 0;

  const consumeBlock = (block: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataText = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !dataText) return;

    const data = JSON.parse(dataText) as {
      label?: string;
      card?: AnswerCueCard;
      meta?: AiRunMeta;
    };

    if (event === "stage" && data.label) {
      stages.push(data.label);
      options.onProgress?.({ type: "stage", label: data.label });
    }
    if (event === "card" && data.card) {
      card = data.card;
      backendStatus =
        data.meta?.backendStatus === "success"
          ? "success"
          : data.meta?.backendStatus === "cache" || data.meta?.backendStatus === "error"
            ? "fallback"
            : backendStatus;
      fallbackReason = data.meta?.fallbackReason ?? fallbackReason;
      evidenceTrace = data.meta?.evidenceTrace ?? evidenceTrace;
      latencyMs = data.meta?.latencyMs ?? latencyMs;
    }
    if (event === "done") options.onProgress?.({ type: "done" });
    if (event === "error") throw new Error(dataText);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() ?? "";
      blocks.forEach(consumeBlock);
    }
    if (done) break;
  }

  if (buffer.trim()) consumeBlock(buffer);
  if (!card) throw new Error("RECONSTRUCT_EMPTY");
  return { card, stages, backendStatus, searchCount: 0, fallbackReason, evidenceTrace, latencyMs };
}

export interface AudioBridgePairingResult {
  pairingCode: string;
  expiresAt: string;
}

export async function requestAudioBridgePairingCode(deviceName?: string): Promise<AudioBridgePairingResult> {
  const response = await apiFetch("/api/audio-bridge/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deviceName ? { deviceName } : {}),
  });
  return readJson(response);
}

export interface AudioBridgeDevice {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

export async function listAudioBridgeDevicesOnServer(): Promise<{ devices: AudioBridgeDevice[] }> {
  const response = await apiFetch("/api/audio-bridge/devices");
  return readJson(response);
}

export async function revokeAudioBridgeDeviceOnServer(id: string): Promise<{ ok: true }> {
  const response = await apiFetch(`/api/audio-bridge/devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return readJson(response);
}

export type AudioBridgeStreamEvent =
  | { type: "ready"; provider: string }
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" }
  | { type: "bridge_status"; connected: boolean; deviceName?: string; asrProvider?: string; asrReady?: boolean }
  | { type: "bridge_audio"; rms: number; peak: number; bytesSent: number; sampleRate?: number; channels?: number };

// 长连接订阅：与 streamCueCardFromServer 共用 SSE 分块解析逻辑，但流不会自然结束，
// 靠返回的取消函数主动中断（而不是等 done 事件）。
export function subscribeToAudioBridgeEvents(onEvent: (event: AudioBridgeStreamEvent) => void): () => void {
  const controller = new AbortController();
  let cancelled = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const consumeBlock = (block: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataText = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !dataText) return;
    try {
      onEvent(JSON.parse(dataText) as AudioBridgeStreamEvent);
    } catch {
      // 忽略格式异常的单条事件，不中断整条订阅
    }
  };

  const scheduleReconnect = () => {
    if (cancelled) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = async () => {
    try {
      const response = await apiFetch("/api/audio-bridge/events", { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("AUDIO_BRIDGE_EVENTS_FAILED");
      reconnectAttempt = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() ?? "";
          blocks.forEach(consumeBlock);
        }
        if (done) break;
      }
    } catch {
      if (!cancelled) onEvent({ type: "bridge_status", connected: false });
    }
    if (!cancelled) scheduleReconnect();
  };

  void connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    controller.abort();
  };
}
