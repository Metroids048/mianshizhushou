import { AppState, InterviewQuestion, InterviewRecord, MockTurn, UserJourneyState, WorkspaceState } from "../types";
import { repairAppState } from "./copy";
import { buildInterviewReport, createInitialAppState, createPosition, createProfile, normalizePosition } from "./interviewEngine";

const SNAPSHOT_KEY = "campus-interview-ai-workbench:serverSnapshotCache:v1";
const DRAFTS_KEY = "campus-interview-ai-workbench:drafts:v1";
const UI_PREFS_KEY = "campus-interview-ai-workbench:uiPrefs:v1";
const LEGACY_KEY = "campus-interview-ai-workbench:v1";
const GUEST_ID_KEY = "ai-job:guest-id:v1";
const UI_PREFS_VERSION = 2;

export interface UiPrefs {
  desktopSidebarExpanded: boolean;
  desktopSidebarTouched: boolean;
  layoutVersion?: number;
}

export interface DraftState {
  homeInput?: string;
  resumeChatInput?: string;
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  return Boolean(
    candidate.profile &&
      typeof candidate.profile === "object" &&
      Array.isArray(candidate.positions) &&
      typeof candidate.activePositionId === "string",
  );
}

function normalizeRecord(record: InterviewRecord): InterviewRecord {
  return {
    ...record,
    mode: record.mode ?? "mock",
    cueCards: Array.isArray(record.cueCards) ? record.cueCards : [],
    transcript: Array.isArray(record.transcript) ? record.transcript : [],
    questionIds: Array.isArray(record.questionIds) ? record.questionIds : [],
    speechMetrics: Array.isArray(record.speechMetrics) ? record.speechMetrics : [],
    questionResults: Array.isArray(record.questionResults)
      ? record.questionResults.map((item) => ({
          ...item,
          evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : [],
          cueCardIds: Array.isArray(item.cueCardIds) ? item.cueCardIds : [],
        }))
      : undefined,
    report: {
      ...record.report,
      source: record.report?.source ?? "local",
      structuredDimensions: Array.isArray(record.report?.structuredDimensions) ? record.report.structuredDimensions : undefined,
      strengthPoints: Array.isArray(record.report?.strengthPoints) ? record.report.strengthPoints : undefined,
      improvementPoints: Array.isArray(record.report?.improvementPoints) ? record.report.improvementPoints : undefined,
    },
    conversationHistory: Array.isArray(record.conversationHistory) ? record.conversationHistory : undefined,
  };
}

function normalizeQuestion(question: InterviewQuestion): InterviewQuestion {
  return {
    ...question,
    source: question.source ?? "diagnosis",
    priority: Boolean(question.priority),
    notes: typeof question.notes === "string" ? question.notes : "",
    cueCardIds: Array.isArray(question.cueCardIds) ? question.cueCardIds : [],
  };
}

const JOURNEY_STATES: readonly UserJourneyState[] = ["guest", "onboarding", "ready", "preparing", "interviewing", "reviewing", "returning"];

function isValidJourneyState(value: unknown): value is UserJourneyState {
  return typeof value === "string" && (JOURNEY_STATES as readonly string[]).includes(value);
}

function deriveJourneyState(state: AppState): UserJourneyState {
  if (state.positions.length === 0 && state.interviewRecords.length === 0) return "ready";
  if (state.interviewRecords.length > 0) return "reviewing";
  return "preparing";
}

function normalizeImportedState(state: AppState): AppState {
  const profile = {
    ...state.profile,
    evidenceLibrary: Array.isArray(state.profile.evidenceLibrary) ? state.profile.evidenceLibrary : state.profile.resume.evidence,
    highlights: Array.isArray(state.profile.highlights) ? state.profile.highlights : [],
  };
  const positions = state.positions.map((position) =>
    normalizePosition(
      {
        ...position,
        questions: position.questions.map(normalizeQuestion),
        notes: typeof position.notes === "string" ? position.notes : "",
        status: position.status ?? "planning",
        createdAt: position.createdAt ?? new Date().toISOString(),
        updatedAt: position.updatedAt ?? new Date().toISOString(),
      },
      profile,
    ),
  );
  return repairAppState({
    ...state,
    profile,
    positions,
    interviewRecords: Array.isArray(state.interviewRecords) ? state.interviewRecords.map(normalizeRecord) : [],
    activeRecordId:
      Array.isArray(state.interviewRecords) && state.interviewRecords.some((record) => record.id === state.activeRecordId)
        ? state.activeRecordId
        : "",
    activePositionId: positions.some((position) => position.id === state.activePositionId)
      ? state.activePositionId
      : positions[0]?.id ?? "",
    aiMode: Boolean(state.aiMode),
    journeyState: isValidJourneyState(state.journeyState) ? state.journeyState : deriveJourneyState(state),
  });
}

function migrateLegacy(value: unknown): AppState | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as Partial<WorkspaceState>;
  if (typeof legacy.resumeText !== "string") return null;
  const profile = createProfile(legacy.resumeText);
  const turns = Array.isArray(legacy.mockTurns) ? (legacy.mockTurns as MockTurn[]) : [];
  const position = createPosition(typeof legacy.jobText === "string" ? legacy.jobText : "", profile, { mockTurns: turns });
  const report = buildInterviewReport(position.mockTurns, position.questions, position.matchReport);
  const withReport = { ...position, report };
  return { profile, positions: [withReport], activePositionId: withReport.id, interviewRecords: [], activeRecordId: "", aiMode: false, journeyState: "guest" as UserJourneyState };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadServerSnapshotCache(): AppState {
  const cached = readJson<unknown>(SNAPSHOT_KEY);
  if (cached && isAppState(cached)) return normalizeImportedState(cached);

  const legacy = readJson<unknown>(LEGACY_KEY);
  if (legacy) {
    const migrated = migrateLegacy(legacy);
    if (migrated) return migrated;
  }

  return createInitialAppState();
}

export function saveServerSnapshotCache(state: AppState): void {
  // 缓存保留条件包含面试记录：游客只做模拟练习但未建岗位/填简历时，记录也不应被清空。
  const hasContent = state.profile.resumeText.trim().length > 0 || state.positions.length > 0 || state.interviewRecords.length > 0;
  if (!hasContent) {
    window.localStorage.removeItem(SNAPSHOT_KEY);
    return;
  }
  writeJson(SNAPSHOT_KEY, state);
}

export function clearCachedWorkspace(): void {
  window.localStorage.removeItem(SNAPSHOT_KEY);
  window.localStorage.removeItem(DRAFTS_KEY);
  window.localStorage.removeItem(UI_PREFS_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
  window.localStorage.removeItem(GUEST_ID_KEY);
}

export function clearIdentityLocalCache(): void {
  window.localStorage.removeItem(SNAPSHOT_KEY);
  window.localStorage.removeItem(DRAFTS_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
  window.localStorage.removeItem(GUEST_ID_KEY);
}

export function loadUiPrefs(): UiPrefs {
  const stored = readJson<Partial<UiPrefs>>(UI_PREFS_KEY);
  if (!stored || stored.layoutVersion !== UI_PREFS_VERSION) {
    return {
      desktopSidebarExpanded: true,
      desktopSidebarTouched: false,
      layoutVersion: UI_PREFS_VERSION,
    };
  }
  const touched = stored?.desktopSidebarTouched === true;
  return {
    desktopSidebarExpanded: touched ? stored?.desktopSidebarExpanded ?? true : true,
    desktopSidebarTouched: touched,
    layoutVersion: UI_PREFS_VERSION,
  };
}

export function saveUiPrefs(next: UiPrefs): void {
  writeJson(UI_PREFS_KEY, { ...next, layoutVersion: UI_PREFS_VERSION });
}

export function loadDraftState(): DraftState {
  const stored = readJson<Partial<DraftState>>(DRAFTS_KEY);
  return {
    homeInput: stored?.homeInput ?? "",
    resumeChatInput: stored?.resumeChatInput ?? "",
  };
}

export function saveDraftState(next: DraftState): void {
  writeJson(DRAFTS_KEY, next);
}

export function serializeAppState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function parseImportedState(json: string): AppState {
  const parsed = JSON.parse(json) as unknown;
  if (!isAppState(parsed)) throw new Error("INVALID_BACKUP");
  return normalizeImportedState(parsed);
}

export const APP_STORAGE_KEY = SNAPSHOT_KEY;

export interface CloudSyncAdapter {
  push(state: AppState): Promise<void>;
  pull(): Promise<AppState | null>;
}

export const localOnlyCloudSync: CloudSyncAdapter = {
  async push() {
    throw new Error("CLOUD_SYNC_NOT_CONFIGURED");
  },
  async pull() {
    throw new Error("CLOUD_SYNC_NOT_CONFIGURED");
  },
};
