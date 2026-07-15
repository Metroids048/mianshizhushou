export type StageId =
  | "home"
  | "live"
  | "mock"
  | "jd"
  | "questions"
  | "resume"
  | "records"
  | "recordReport";

export type UserJourneyState = "guest" | "onboarding" | "ready" | "preparing" | "interviewing" | "reviewing" | "returning";

export type ApplicationStatus = "planning" | "applied" | "interviewing" | "offer" | "closed";
export type PositionProgressStatus = "draft" | "saved" | "configured" | "practiced";

export type QuestionCategory = string;
export type QuestionDifficulty = string;
export type EvidenceType = string;
export type MaterialKind = "project" | "upload" | "note";
export type MaterialSource = "manual" | "upload" | "derived";
export type InterviewStyle = "gentle" | "strict" | "pressure";
export type InterviewerRole = "HR" | "上级" | "CEO" | "CTO" | "业务负责人";
export type InterviewDifficulty = "正常" | "压力面" | "地狱面";
export type InterviewSubmitMode = "manual" | "auto";

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  detail: string;
  keywords: string[];
  impact: string;
  synthetic?: boolean;
}

export type PositionIntakeFieldKey = "company" | "role" | "interviewer" | "difficulty" | "duration" | "hasJd";
export type PositionIntakeFieldSource = "raw" | "inferred" | "confirmed";

export interface PositionIntakeFieldDefinition {
  key: PositionIntakeFieldKey;
  label: string;
}

export interface PositionIntakeFieldValue {
  key: PositionIntakeFieldKey;
  label: string;
  value: string;
  source: PositionIntakeFieldSource;
}

export interface PositionIntakeMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
}

export interface PositionIntakeState {
  messages: PositionIntakeMessage[];
  rawJdText: string;
  inferredFields: PositionIntakeFieldValue[];
  confirmedFields: PositionIntakeFieldValue[];
  missingFields: PositionIntakeFieldDefinition[];
  fieldSources: Record<PositionIntakeFieldKey, PositionIntakeFieldSource>;
  reviewStatus: "empty" | "draft" | "review" | "confirmed";
  suggestedPrompts: string[];
  configuredInterview: boolean;
}

export interface PositionMaterial {
  id: string;
  kind: MaterialKind;
  source: MaterialSource;
  title: string;
  detail: string;
  summary: string;
  keywords: string[];
  tags: string[];
  linkedQuestionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PositionAnalysisContext {
  priorityFocus: string[];
  likelyQuestions: string[];
  preparationTips: string[];
  evidenceHighlights: string[];
  materialHighlights: string[];
  updatedAt: string;
}

export interface ResumeAnalysis {
  name: string;
  targetRole: string;
  summary: string;
  evidence: EvidenceItem[];
  skills: string[];
  metrics: string[];
  risks: string[];
}

export interface JobAnalysis {
  title: string;
  company: string;
  responsibilities: string[];
  hardSkills: string[];
  softSkills: string[];
  hiddenSignals: string[];
  keywords: string[];
}

export interface GapItem {
  label: string;
  type: "match" | "gap" | "risk";
  description: string;
}

export interface RewriteSuggestion {
  before: string;
  after: string;
  reason: string;
}

export interface MatchReport {
  score: number;
  summary: string;
  keywordCoverage: number;
  atsScore: number;
  gaps: GapItem[];
  rewriteSuggestions: RewriteSuggestion[];
}

export interface InterviewQuestion {
  id: string;
  category: QuestionCategory;
  question: string;
  reason: string;
  evidenceIds: string[];
  difficulty: QuestionDifficulty;
  source: "diagnosis" | "manual" | "mock" | "material" | "cueCard";
  priority: boolean;
  notes: string;
  answer?: string;
  lastReviewedAt?: string;
  cueCardIds?: string[];
  tags?: string[];
}

export interface AnswerDraft {
  questionId: string;
  speakable: string;
  concise: string;
  followUp: string;
  evidenceIds: string[];
  caution: string;
}

export interface SpeechMetrics {
  charCount: number;
  durationSec: number;
  charsPerMinute: number;
  fillerCount: number;
  fillers: string[];
  comment: string;
}

export interface MockMessage {
  role: "interviewer" | "candidate";
  text: string;
}

export interface ConversationMessage extends MockMessage {
  id: string;
  createdAt: string;
  source?: "model" | "local" | "user";
}

export interface MockDecision {
  type: "followup" | "next";
  question: string;
  instantFeedback: string;
  internalNote: string;
}

export interface InterviewAiMeta {
  backendStatus: "success" | "fallback" | "error";
  fallbackReason: string;
  model: string;
  latencyMs: number;
  decisionType?: MockDecision["type"];
  internalNote?: string;
}

export interface MockTurn {
  questionId: string;
  answer: string;
  score: number;
  feedback: string;
  transcript?: MockMessage[];
  speechMetrics?: SpeechMetrics;
}

export interface InterviewQuestionResult {
  questionId: string;
  questionText: string;
  answer: string;
  score?: number;
  feedback?: string;
  evidenceIds: string[];
  cueCardIds: string[];
  followUp?: string;
}

export interface AnswerCueCard {
  id: string;
  questionText: string;
  createdAt: string;
  source: "live" | "mock" | "questionBank" | "manual";
  strategy: string;
  openingLine: string;
  bullets: string[];
  evidenceIds: string[];
  risks: string[];
  followUps: string[];
}

export interface InterviewRecord {
  id: string;
  positionId: string;
  mode: "live" | "mock";
  title: string;
  createdAt: string;
  transcript: MockMessage[];
  cueCards: AnswerCueCard[];
  questionIds: string[];
  speechMetrics: SpeechMetrics[];
  report: InterviewReport;
  summary: string;
  questionResults?: InterviewQuestionResult[];
  conversationHistory?: ConversationMessage[];
  aiMeta?: InterviewAiMeta;
}

export interface ReportDimension {
  name: string;
  score: number;
  comment: string;
}

export interface InterviewReport {
  overallScore: number;
  dimensions: {
    completeness: number;
    relevance: number;
    evidenceStrength: number;
    structure: number;
    riskControl: number;
  };
  summary: string;
  nextActions: string[];
  structuredDimensions?: ReportDimension[];
  strengthPoints?: string[];
  improvementPoints?: string[];
  suggestedNextPractice?: string;
  source?: "model" | "local";
  followUpTasks?: LifecycleTask[];
}

export interface LifecycleTask {
  id: string;
  type: "mock_session" | "cue_card" | "review_questions" | "resume_optimize" | "daily_login" | "import_resume" | "intake_jd";
  source: "record" | "cueCard" | "resume" | "system" | "manual";
  sourceId: string;
  title: string;
  status: "pending" | "completed";
  createdAt: string;
  completedAt?: string;
}

export interface OnboardingPayload {
  displayName?: string;
  targetRole?: string;
  city?: string;
  experience?: string;
  stage?: string;
  resumeText?: string;
  entryPath?: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: string;
  description: string;
  features: string[];
  recommended?: boolean;
}

export interface WorkspaceState {
  resumeText: string;
  jobText: string;
  resume: ResumeAnalysis;
  job: JobAnalysis;
  matchReport: MatchReport;
  questions: InterviewQuestion[];
  answers: AnswerDraft[];
  mockTurns: MockTurn[];
  report: InterviewReport;
  selectedQuestionId: string;
}

export interface InterviewPreferences {
  interviewerRole: InterviewerRole;
  difficulty: InterviewDifficulty;
  interviewerGender: "女" | "男";
  submitMode: InterviewSubmitMode;
  style: InterviewStyle;
}

export interface CandidateProfile {
  displayName: string;
  resumeText: string;
  resume: ResumeAnalysis;
  evidenceLibrary: EvidenceItem[];
  highlights: string[];
}

export interface Position {
  id: string;
  title: string;
  company: string;
  jobText: string;
  job: JobAnalysis;
  matchReport: MatchReport;
  questions: InterviewQuestion[];
  answers: AnswerDraft[];
  mockTurns: MockTurn[];
  report: InterviewReport;
  selectedQuestionId: string;
  intake: PositionIntakeState;
  materials: PositionMaterial[];
  interviewPreferences: InterviewPreferences;
  analysisContext: PositionAnalysisContext;
  status: ApplicationStatus;
  progressStatus?: PositionProgressStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  profile: CandidateProfile;
  positions: Position[];
  activePositionId: string;
  interviewRecords: InterviewRecord[];
  activeRecordId: string;
  aiMode: boolean;
  journeyState: UserJourneyState;
}
