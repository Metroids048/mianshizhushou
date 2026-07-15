import type {
  AnswerCueCard,
  AppState,
  CandidateProfile,
  InterviewQuestion,
  InterviewRecord,
  ConversationMessage,
  MockMessage,
  MockDecision,
  Position,
  SpeechMetrics,
  InterviewAiMeta,
  LifecycleTask,
  OnboardingPayload,
  UserJourneyState,
} from "../src/types";

export type { AnswerCueCard, AppState, CandidateProfile, ConversationMessage, InterviewAiMeta, InterviewQuestion, InterviewRecord, LifecycleTask, MockDecision, MockMessage, OnboardingPayload, Position, SpeechMetrics, UserJourneyState };

export interface TranscriptTurn {
  id: string;
  recordId: string;
  role: "interviewer" | "candidate";
  text: string;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
  provider: "tavily" | "bing" | "serpapi" | "disabled" | "local";
  createdAt: string;
}

export interface PromptRun {
  id: string;
  skillId: string;
  promptId: string;
  model: string;
  provider: string;
  inputSummary: string;
  outputJson: string;
  status: "success" | "fallback" | "error" | "cache";
  latencyMs: number;
  retrievalCount: number;
  searchUsed: boolean;
  fallbackReason: string;
  createdAt: string;
}

export interface CueCardRequest {
  questionText: string;
  positionId?: string;
  source?: AnswerCueCard["source"];
  enableSearch?: boolean;
  recentHistory?: MockMessage[];
  sessionId?: string;
}

export interface EvidenceTraceItem {
  id: string;
  title: string;
  reason: string;
  synthetic?: boolean;
}

export interface AiRunMeta {
  backendStatus: "success" | "fallback" | "error" | "cache";
  skillId: string;
  fallbackReason: string;
  promptId: string;
  provider: string;
  evidenceTrace: EvidenceTraceItem[];
  latencyMs: number;
  retrievalCount: number;
  searchUsed: boolean;
}

export type RagSourceType = "resume" | "jd" | "material" | "question" | "record";

export interface RagDocument {
  id: string;
  positionId?: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceSubType?: string;
  ownerKey: string;
  title: string;
  summary: string;
  content: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  positionId?: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceSubType?: string;
  ownerKey: string;
  title: string;
  content: string;
  chunkIndex: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalRun {
  id: string;
  query: string;
  positionId?: string;
  ownerKey: string;
  chunkIds: string[];
  latencyMs: number;
  createdAt: string;
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
  evidenceTrace: EvidenceTraceItem[];
  applyTarget: "section" | "full";
  meta: AiRunMeta;
}

export interface IntakeAssistantResponse {
  reply: string;
  missingFields: Array<{ key: Position["intake"]["missingFields"][number]["key"]; label: string }>;
  confirmedFields: Position["intake"]["confirmedFields"];
  suggestedPrompts: string[];
  meta: AiRunMeta;
}

export interface MockSessionRecord {
  id: string;
  positionId: string;
  config?: Record<string, unknown>;
  conversationHistory: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  aiMeta?: InterviewAiMeta;
}

export interface LiveCueSessionTurn {
  id: string;
  questionText: string;
  card: AnswerCueCard;
  meta: AiRunMeta;
  createdAt: string;
}

export interface LiveCueSessionRecord {
  id: string;
  positionId: string;
  history: LiveCueSessionTurn[];
  createdAt: string;
  updatedAt: string;
}

export interface BackendState {
  profile: CandidateProfile;
  positions: Position[];
  records: InterviewRecord[];
  journeyState: UserJourneyState;
}

export interface ApiStateSnapshot extends BackendState {
  activePositionId: string;
}

export interface OnboardingResponse {
  ok: boolean;
  profile: CandidateProfile;
  position?: Position;
  nextStep: "intake_jd" | "import_resume" | "start_mock";
}
