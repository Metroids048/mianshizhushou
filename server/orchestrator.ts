import {
  buildInterviewReport,
  createPosition,
  createProfile,
  evaluateMockTurn,
  generateCueCard,
  generateFollowUpFromTranscript,
  recomputePosition,
  saveQuestionFromCueCard,
} from "../src/lib/interviewEngine";
import { normalizeText } from "../src/lib/text";
import { DATA_REPAIR_NEEDED, hasCorruptedText, sanitizeDisplayText } from "../src/lib/copy";
import type {
  AiRunMeta,
  AnswerCueCard,
  BackendState,
  CandidateProfile,
  ConversationMessage,
  CueCardRequest,
  EvidenceTraceItem,
  InterviewQuestion,
  InterviewRecord,
  MockDecision,
  MockMessage,
  Position,
  PromptRun,
  ResumeAiRequest,
  ResumeAiResponse,
  SearchResult,
  IntakeAssistantResponse,
} from "./types";
import type { AppDb } from "./db";
import { upsertPosition } from "./db";
import type { LlmClient } from "./llm";
import { prompts, getPersonaSuffix } from "./prompts/registry";
import type { PersonaKey } from "./prompts/registry";
import { skills } from "./skills/registry";
import { createRagRuntime, type RetrievedChunk } from "./rag";
import type { SearchTool } from "./search";
import { makeId, nowIso } from "./utils";

interface CueCardJson {
  strategy?: string;
  openingLine?: string;
  bullets?: string[];
  evidenceIds?: string[];
  risks?: string[];
  followUps?: string[];
}

interface InterviewQuestionJson {
  question?: string;
  category?: string;
  difficulty?: string;
  reason?: string;
}

interface ReportJson {
  overallScore?: number;
  dimensions?: Array<{ name?: string; score?: number; comment?: string }>;
  strengthPoints?: string[];
  improvementPoints?: string[];
  suggestedNextPractice?: string;
  summary?: string;
}

interface ResumeAiJson {
  reply?: string;
  suggestion?: string;
  applyTarget?: "section" | "full";
  evidenceIds?: string[];
}

interface JdAnalysisJson {
  summary?: string;
  overlapEvidence?: string[];
  risks?: string[];
  preparationAdvice?: string[];
  questions?: string[];
}

interface IntakeFollowUpJson {
  reply?: string;
  confirmedFields?: Array<{ key?: string; label?: string; value?: string }>;
  missingFields?: Array<{ key?: string; label?: string }>;
  suggestedPrompts?: string[];
  confidence?: number;
}

interface SearchSummaryJson {
  facts?: string[];
  risks?: string[];
  sources?: string[];
}

interface ResumeHighlightsJson {
  highlights?: string[];
  evidenceIds?: string[];
}

const LOCAL_FALLBACK_REASON = "模型未配置、响应失败或 JSON 不符合结构，已切回本地练习模式。";
const SEARCH_FALLBACK_REASON = "联网搜索未接通，本次仅使用本地资料与已有证据。";
const CUE_CARD_BUDGET_MS = Number(process.env.CUE_CARD_BUDGET_MS) > 0 ? Number(process.env.CUE_CARD_BUDGET_MS) : 8000;

export class AiOrchestrator {
  private readonly rag: ReturnType<typeof createRagRuntime>;
  private currentUserId: string | undefined;

  constructor(
    private readonly db: AppDb,
    private readonly llm: LlmClient,
    private readonly searchTool: SearchTool,
  ) {
    this.rag = createRagRuntime(this.db, () => this.ownerKey(), () => this.currentUserId);
  }

  setUserId(userId: string | undefined) {
    this.currentUserId = userId;
  }

  private loadState(): BackendState {
    return this.db.getState(this.currentUserId);
  }

  private persistState(state: BackendState): void {
    this.db.saveState(state, this.currentUserId);
  }

  private ownerKey(): string {
    return this.currentUserId ? `user:${this.currentUserId}` : "guest:preview";
  }

  get model(): string {
    return this.llm.model;
  }

  get searchProvider(): SearchResult["provider"] {
    return this.searchTool.provider;
  }

  getProfileContext(): BackendState["profile"] {
    return this.loadState().profile;
  }

  getJdContext(positionId?: string): Position {
    const state = this.loadState();
    const found = state.positions.find((position) => position.id === positionId) ?? state.positions[0];
    if (found) return found;
    const fallback = createPosition("", state.profile);
    const next = upsertPosition(state, fallback);
    this.persistState(next);
    this.rag.reindexPosition(fallback);
    return fallback;
  }

  getQuestionBankContext(positionId?: string): InterviewQuestion[] {
    return this.getJdContext(positionId).questions;
  }

  async upsertPositionIntake(input: {
    positionId?: string;
    rawJdText: string;
    confirmedFields?: Array<{ key: string; value: string; source?: string }>;
    messages?: Array<{ role: "assistant" | "user"; text: string }>;
  }): Promise<{ state: BackendState; activePositionId: string; intakeAssistant: IntakeAssistantResponse }> {
    const state = this.loadState();
    const base = input.positionId ? state.positions.find((position) => position.id === input.positionId) : undefined;
    const messages = input.messages?.map((message, index) => ({
      id: makeId(`intake-${message.role}`),
      role: message.role,
      text: message.text,
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
    const confirmedFields =
      input.confirmedFields?.map((field) => ({
        key: field.key as Position["intake"]["confirmedFields"][number]["key"],
        label: resolveIntakeFieldLabel(field.key),
        value: field.value,
        source: "confirmed" as const,
      })) ?? [];

    const nextPosition = base
      ? recomputePosition(
          {
            ...base,
            jobText: input.rawJdText,
            intake: {
              ...base.intake,
              rawJdText: input.rawJdText,
              confirmedFields,
              messages: messages?.length ? messages : base.intake.messages,
            },
          },
          state.profile,
        )
      : createPosition(input.rawJdText, state.profile, {
          intake: {
            messages:
              messages?.length
                ? messages
                : [
                    {
                      id: makeId("intake-assistant"),
                      role: "assistant",
                      text: "已收到真实 JD intake，接下来请继续确认缺失字段。",
                      createdAt: nowIso(),
                    },
                  ],
            rawJdText: input.rawJdText,
            inferredFields: [],
            confirmedFields,
            missingFields: [],
            fieldSources: {
              company: "inferred",
              role: "inferred",
              interviewer: "inferred",
              difficulty: "inferred",
              duration: "inferred",
              hasJd: "inferred",
            },
            reviewStatus: "draft",
            suggestedPrompts: [],
            configuredInterview: false,
          },
        });

    const intakeAssistant = await this.createIntakeAssistant(nextPosition, messages ?? base?.intake.messages ?? []);
    const assistantMessage = {
      id: makeId("intake-assistant"),
      role: "assistant" as const,
      text: intakeAssistant.reply,
      createdAt: nowIso(),
    };
    const baseMessages = messages?.length ? messages : nextPosition.intake.messages;
    const mergedMessages = dedupeIntakeMessages([
      ...baseMessages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })),
      assistantMessage,
    ]);
    const mergedConfirmedFields = mergeConfirmedFields([
      ...nextPosition.intake.confirmedFields,
      ...intakeAssistant.confirmedFields,
    ]);
    const finalizedPosition = recomputePosition(
      {
        ...nextPosition,
        intake: {
          ...nextPosition.intake,
          messages: mergedMessages,
          confirmedFields: mergedConfirmedFields,
          suggestedPrompts: intakeAssistant.suggestedPrompts,
        },
      },
      state.profile,
    );

    const next = upsertPosition(state, finalizedPosition);
    this.persistState(next);
    this.db.deleteCachedCueCardsByPosition(finalizedPosition.id);
    this.rag.reindexPosition(finalizedPosition);
    void this.preWarmCueCards(finalizedPosition.id).catch(() => undefined);
    return { state: next, activePositionId: finalizedPosition.id, intakeAssistant };
  }

  updateProfile(input: { displayName?: string; resumeText: string; evidenceLibrary: CandidateProfile["evidenceLibrary"]; highlights: string[] }): BackendState {
    const state = this.loadState();
    const baseProfile = createProfile(input.resumeText);
    const profile: CandidateProfile = {
      ...baseProfile,
      displayName: input.displayName?.trim() || state.profile.displayName || baseProfile.displayName,
      evidenceLibrary: input.evidenceLibrary,
      highlights: input.highlights,
    };
    const positions = state.positions.map((position) => recomputePosition(position, profile));
    const next = { ...state, profile, positions };
    this.persistState(next);
    this.rag.reindexProfile(profile);
    positions.forEach((position) => {
      this.db.deleteCachedCueCardsByPosition(position.id);
      this.rag.reindexPosition(position);
    });
    return next;
  }

  updatePositionMaterials(positionId: string, materials: Position["materials"]): Position {
    const state = this.loadState();
    const current = state.positions.find((position) => position.id === positionId);
    if (!current) throw new Error("POSITION_NOT_FOUND");
    const nextPosition = recomputePosition({ ...current, materials }, state.profile);
    const next = upsertPosition(state, nextPosition);
    this.persistState(next);
    this.db.deleteCachedCueCardsByPosition(positionId);
    this.rag.reindexMaterials(positionId, materials);
    return nextPosition;
  }

  updatePositionQuestions(positionId: string, questions: Position["questions"]): Position {
    const state = this.loadState();
    const current = state.positions.find((position) => position.id === positionId);
    if (!current) throw new Error("POSITION_NOT_FOUND");
    const nextPosition = recomputePosition({ ...current, questions }, state.profile);
    const next = upsertPosition(state, nextPosition);
    this.persistState(next);
    this.db.deleteCachedCueCardsByPosition(positionId);
    this.rag.reindexQuestions(positionId, questions);
    return nextPosition;
  }

  updatePositionPreferences(positionId: string, preferences: Position["interviewPreferences"]): Position {
    const state = this.loadState();
    const current = state.positions.find((position) => position.id === positionId);
    if (!current) throw new Error("POSITION_NOT_FOUND");
    const nextPosition = recomputePosition(
      {
        ...current,
        interviewPreferences: preferences,
        intake: {
          ...current.intake,
          configuredInterview: true,
        },
      },
      state.profile,
    );
    const next = upsertPosition(state, nextPosition);
    this.persistState(next);
    return nextPosition;
  }

  removePosition(positionId: string): BackendState {
    const state = this.loadState();
    const positions = state.positions.filter((position) => position.id !== positionId);
    const records = state.records.filter((record) => record.positionId !== positionId);
    this.db.deletePositionArtifacts(positionId, this.currentUserId, this.ownerKey());
    const next: BackendState = {
      ...state,
      positions,
      records,
    };
    this.persistState(next);
    return next;
  }

  getLatestActiveMockSession(positionId: string) {
    return this.db.getLatestActiveMockSession(positionId, this.currentUserId);
  }

  completeMockSession(sessionId: string): void {
    const current = this.db.getMockSession(sessionId, this.currentUserId);
    if (!current) return;
    this.db.saveMockSession({
      ...current,
      completedAt: nowIso(),
      updatedAt: nowIso(),
    }, this.currentUserId);
  }

  analyzeProfile(resumeText: string): BackendState {
    const state = this.loadState();
    const profile = createProfile(resumeText);
    const positions = state.positions.map((position) => recomputePosition(position, profile));
    const next = { ...state, profile, positions };
    this.persistState(next);
    this.rag.reindexProfile(profile);
    positions.forEach((position) => this.rag.reindexPosition(position));
    return next;
  }

  async analyzePosition(jobText: string, positionId?: string): Promise<BackendState> {
    const state = this.loadState();
    const base = positionId ? state.positions.find((position) => position.id === positionId) : undefined;
    const draftPosition = base ? recomputePosition({ ...base, jobText }, state.profile) : createPosition(jobText, state.profile);
    const analysis = await this.createJdAnalysis(draftPosition, state.profile);
    const nextPosition = {
      ...draftPosition,
      matchReport: {
        ...draftPosition.matchReport,
        summary: analysis.summary || draftPosition.matchReport.summary,
        gaps: mergeGaps(draftPosition.matchReport.gaps, analysis.risks),
      },
      analysisContext: {
        ...draftPosition.analysisContext,
        evidenceHighlights: analysis.overlapEvidence.length ? analysis.overlapEvidence : draftPosition.analysisContext.evidenceHighlights,
        preparationTips: analysis.preparationAdvice.length ? analysis.preparationAdvice : draftPosition.analysisContext.preparationTips,
        likelyQuestions: analysis.questions.length ? analysis.questions : draftPosition.analysisContext.likelyQuestions,
        updatedAt: nowIso(),
      },
    };
    const next = upsertPosition(state, nextPosition);
    this.persistState(next);
    this.db.deleteCachedCueCardsByPosition(nextPosition.id);
    this.rag.reindexPosition(nextPosition);
    return next;
  }

  async searchCompanyAndRole(position: Position): Promise<SearchResult[]> {
    const query = `${position.company} ${position.title} 面试 岗位 职责`;
    return this.search(query);
  }

  async search(query: string): Promise<SearchResult[]> {
    const results = await this.searchTool.search(query);
    results.forEach((result) => this.db.saveSearchResult(result));
    return results;
  }

  async generateProfileHighlights(input: { resumeText: string; displayName?: string; positionId?: string }): Promise<{ highlights: string[]; meta: AiRunMeta }> {
    const started = Date.now();
    const state = this.loadState();
    const baseProfile = createProfile(input.resumeText);
    const profile: CandidateProfile = {
      ...baseProfile,
      displayName: input.displayName?.trim() || state.profile.displayName || baseProfile.displayName,
      evidenceLibrary: baseProfile.evidenceLibrary,
      highlights: state.profile.highlights,
    };
    const position = input.positionId ? this.getJdContext(input.positionId) : state.positions[0];
    const retrieval = this.rag.retrieve([input.resumeText, position?.title, position?.company].filter(Boolean).join("\n"), { positionId: position?.id });
    const prompt = prompts.resumeHighlights;
    const skillId = skills.resumeOptimizer.id;
    const fallback = buildResumeHighlightsFallback(profile);
    const result = await this.llm.chatJson<ResumeHighlightsJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            resumeText: input.resumeText,
            displayName: profile.displayName,
            position: position ? pickPositionContext(position) : null,
            profileEvidence: profile.evidenceLibrary.slice(0, 10),
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.3, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const highlights = normalizeList(result.data.highlights, fallback.highlights ?? []).slice(0, 5);
    const rawEvidenceIds = normalizeList(result.data.evidenceIds, fallback.evidenceIds ?? []).slice(0, 5);
    const evidenceIds = filterValidEvidenceIds(rawEvidenceIds, profile.evidenceLibrary, fallback.evidenceIds ?? []);
    const evidenceTrace = buildMergedEvidenceTrace(evidenceIds, profile.evidenceLibrary, retrieval.items);
    const meta: AiRunMeta = {
      backendStatus: result.status,
      skillId,
      fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
      promptId: prompt.id,
      provider: this.llm.model,
      evidenceTrace,
      latencyMs: Date.now() - started,
      retrievalCount: retrieval.items.length,
      searchUsed: false,
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[highlights] ${position?.title ?? "profile"}`,
        outputJson: JSON.stringify({ highlights, evidenceIds }),
        status: result.status,
        latencyMs: meta.latencyMs,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: meta.fallbackReason,
      }),
      this.currentUserId,
    );
    return { highlights, meta };
  }

  private async createIntakeAssistant(
    position: Position,
    messages: Array<{ role: "assistant" | "user"; text: string } | { id: string; role: "assistant" | "user"; text: string; createdAt: string }>,
  ): Promise<IntakeAssistantResponse> {
    const started = Date.now();
    const prompt = prompts.jdIntakeFollowUp;
    const skillId = skills.jdIntakeNormalizer.id;
    const fallback = buildIntakeAssistantFallback(position);
    const result = await this.llm.chatJson<IntakeFollowUpJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            rawJdText: position.intake.rawJdText,
            inferredFields: position.intake.inferredFields,
            confirmedFields: position.intake.confirmedFields,
            missingFields: position.intake.missingFields,
            reviewStatus: position.intake.reviewStatus,
            messages: messages.map((message) => ({ role: message.role, text: message.text })).slice(-8),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.25, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const missingFields = normalizeMissingFields(result.data.missingFields, position.intake.missingFields);
    const confirmedFields = normalizeConfirmedFields(result.data.confirmedFields);
    const suggestedPrompts = normalizeList(result.data.suggestedPrompts, fallback.suggestedPrompts ?? []).slice(0, 3);
    const reply = result.data.reply?.trim() || fallback.reply || "我先保留你的原文，并继续帮你补齐缺失字段。";
    const meta: AiRunMeta = {
      backendStatus: result.status,
      skillId,
      fallbackReason: result.status === "success" ? "" : "当前只保留原文与缺失字段提示，intake 追问已降级为本地模式。",
      promptId: prompt.id,
      provider: this.llm.model,
      evidenceTrace: [],
      latencyMs: Date.now() - started,
      retrievalCount: 0,
      searchUsed: false,
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[intake] ${position.title || "岗位待确认"} / ${position.company || "公司待确认"}`,
        outputJson: JSON.stringify({ reply, confirmedFields, missingFields, suggestedPrompts }),
        status: result.status,
        latencyMs: meta.latencyMs,
        retrievalCount: 0,
        searchUsed: false,
        fallbackReason: meta.fallbackReason,
      }),
      this.currentUserId,
    );
    return { reply, confirmedFields, missingFields, suggestedPrompts, meta };
  }

  private async summarizeSearchResults(position: Position, questionText: string, searchResults: SearchResult[]) {
    if (searchResults.length === 0) {
      return { facts: [] as string[], risks: [] as string[], promptRun: null as PromptRun | null };
    }
    const started = Date.now();
    const prompt = prompts.searchSummary;
    const skillId = skills.companyRoleResearcher.id;
    const fallback: SearchSummaryJson = {
      facts: searchResults.map((item) => `${item.title}：${item.snippet}`).slice(0, 4),
      risks: searchResults.some((item) => item.provider === "disabled" || item.provider === "local") ? [SEARCH_FALLBACK_REASON] : [],
      sources: searchResults.map((item) => item.url || item.title).slice(0, 4),
    };
    const result = await this.llm.chatJson<SearchSummaryJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            company: position.company,
            role: position.title,
            questionText,
            searchResults,
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.25, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const facts = normalizeList(result.data.facts, fallback.facts ?? []).slice(0, 4);
    const risks = normalizeList(result.data.risks, fallback.risks ?? []).slice(0, 3);
    const promptRun = buildPromptRun({
      skillId,
      promptId: prompt.id,
      model: this.llm.model,
      provider: this.llm.model,
      inputSummary: `[search] ${position.company} ${position.title} ${questionText.slice(0, 40)}`,
      outputJson: JSON.stringify({ facts, risks, sources: normalizeList(result.data.sources, fallback.sources ?? []).slice(0, 4) }),
      status: result.status,
      latencyMs: Date.now() - started,
      retrievalCount: 0,
      searchUsed: true,
      fallbackReason: result.status === "success" ? "" : SEARCH_FALLBACK_REASON,
    });
    this.db.savePromptRun(promptRun, this.currentUserId);
    return { facts, risks, promptRun };
  }

  async createCueCard(request: CueCardRequest): Promise<{ card: AnswerCueCard; searchResults: SearchResult[]; promptRun: PromptRun; meta: AiRunMeta }> {
    const started = Date.now();
    const state = this.loadState();
    const position = this.getJdContext(request.positionId);
    const skillId = skills.liveCueCardCoach.id;
    const cacheKey = `${position.id}::${normalizeText(request.questionText).toLowerCase().slice(0, 120)}`;
    const cached = this.db.getCachedCueCard(cacheKey);
    if (cached) {
      const cleanCached = sanitizeAnswerCueCard(cached);
      const evidenceTrace = buildEvidenceTrace(cleanCached.evidenceIds, state.profile.evidenceLibrary);
      const promptRun = buildPromptRun({
        skillId,
        promptId: prompts.cueCard.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[cache] ${position.title}: ${request.questionText.slice(0, 80)}`,
        outputJson: JSON.stringify(cleanCached),
        status: "cache",
        latencyMs: Date.now() - started,
        retrievalCount: evidenceTrace.length,
        searchUsed: false,
        fallbackReason: "",
      });
      this.db.savePromptRun(promptRun, this.currentUserId);
      return {
        card: cleanCached,
        searchResults: [],
        promptRun,
        meta: {
          backendStatus: "cache",
          skillId,
          fallbackReason: "",
          promptId: prompts.cueCard.id,
          provider: this.llm.model,
          evidenceTrace,
          latencyMs: promptRun.latencyMs,
          retrievalCount: evidenceTrace.length,
          searchUsed: false,
        },
      };
    }

    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(new Error("CUE_CARD_TIMEOUT")), CUE_CARD_BUDGET_MS);
    try {
      const local = generateCueCard(request.questionText, state.profile, position, position.questions, request.source ?? "live");
      const retrieval = this.rag.retrieve(request.questionText, { positionId: position.id });
      const shouldSearch = shouldUseSearch(request.questionText, request.enableSearch);
      const searchResults = shouldSearch ? await this.safeSearch(position, request.questionText) : [];
      const searchFacts = searchResults.map((item) => `${item.title}：${item.snippet}`).slice(0, 4);
      const searchRisks = searchResults.some((item) => item.provider === "disabled" || item.provider === "local") ? [SEARCH_FALLBACK_REASON] : [];
      const prompt = prompts.cueCard;
      const fallback: CueCardJson = {
        strategy: local.strategy,
        openingLine: local.openingLine,
        bullets: local.bullets,
        evidenceIds: local.evidenceIds,
        risks: local.risks,
        followUps: local.followUps,
      };
      const result = await this.llm.chatJson<CueCardJson>(
        [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: JSON.stringify({
              questionText: request.questionText,
              jd: pickPositionContext(position),
              matchReport: position.matchReport,
              profileEvidence: state.profile.evidenceLibrary.slice(0, 8),
              questionBank: position.questions.slice(0, 10),
              retrievedContext: retrieval.items.map(toRetrievedContext),
              recentHistory: request.recentHistory ?? [],
              searchResults,
              searchFacts,
              searchRisks,
              outputSchema: prompt.outputSchema,
              guardrails: prompt.guardrails,
            }),
          },
        ],
        fallback,
        {
          temperature: 0.35,
          schemaHint: JSON.stringify(prompt.outputSchema),
          signal: budget.signal,
          // Real-time turns have one eight-second budget. Let the provider chain advance
          // instead of spending it retrying or repairing a single slow provider.
          maxRetries: 0,
          skipJsonRepair: true,
        },
      );

      const cueCardEvidenceFallback = mergeEvidenceIds(local.evidenceIds, retrieval.items, state.profile.evidenceLibrary);
      const rawEvidenceIds = normalizeList(result.data.evidenceIds, cueCardEvidenceFallback).slice(0, 4);
      const evidenceIds = filterValidEvidenceIds(rawEvidenceIds, state.profile.evidenceLibrary, cueCardEvidenceFallback);
      const sanitized = sanitizeCueCardPayload(result.data, local);
      const card: AnswerCueCard = {
        ...local,
        questionText: sanitizeDisplayText(local.questionText),
        strategy: sanitized.strategy,
        openingLine: sanitized.openingLine,
        bullets: sanitized.bullets,
        evidenceIds,
        risks: sanitized.risks,
        followUps: sanitized.followUps,
      };
      this.saveCueCard(card);
      if (result.status === "success") this.db.saveCachedCueCard(cacheKey, card, position.id);
      const evidenceTrace = buildMergedEvidenceTrace(card.evidenceIds, state.profile.evidenceLibrary, retrieval.items);
      const promptRun = buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `${position.title}: ${request.questionText.slice(0, 80)}`,
        outputJson: JSON.stringify({ ...result.data, ...sanitized, evidenceIds }),
        status: result.status,
        latencyMs: Date.now() - started,
        retrievalCount: retrieval.items.length,
        searchUsed: shouldSearch && searchResults.length > 0,
        fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
      });
      this.db.savePromptRun(promptRun, this.currentUserId);
      return {
        card,
        searchResults,
        promptRun,
        meta: {
          backendStatus: result.status,
          skillId,
          fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
          promptId: prompt.id,
          provider: this.llm.model,
          evidenceTrace,
          latencyMs: promptRun.latencyMs,
          retrievalCount: retrieval.items.length,
          searchUsed: shouldSearch && searchResults.length > 0,
        },
      };
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  async reconstructCueCard(request: CueCardRequest & { feedback: string; originalCard: AnswerCueCard }): Promise<{ card: AnswerCueCard; promptRun: PromptRun; meta: AiRunMeta }> {
    const started = Date.now();
    const state = this.loadState();
    const position = this.getJdContext(request.positionId);
    const prompt = prompts.cueCardReconstruct;
    const skillId = skills.cueCardRewriter.id;
    const retrieval = this.rag.retrieve(`${request.questionText}\n${request.feedback}`, { positionId: position.id });
    const fallback: CueCardJson = {
      strategy: request.originalCard.strategy,
      openingLine: request.originalCard.openingLine,
      bullets: request.originalCard.bullets,
      evidenceIds: request.originalCard.evidenceIds,
      risks: request.originalCard.risks,
      followUps: request.originalCard.followUps,
    };

    const result = await this.llm.chatJson<CueCardJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            questionText: request.questionText,
            originalCard: request.originalCard,
            feedback: request.feedback,
            jd: pickPositionContext(position),
            matchReport: position.matchReport,
            profileEvidence: state.profile.evidenceLibrary.slice(0, 8),
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.4, schemaHint: JSON.stringify(prompt.outputSchema) },
    );

    const sanitized = sanitizeCueCardPayload(result.data, request.originalCard);
    const rawEvidenceIds = normalizeList(result.data.evidenceIds, request.originalCard.evidenceIds).slice(0, 4);
    const card: AnswerCueCard = {
      ...request.originalCard,
      strategy: sanitized.strategy,
      openingLine: sanitized.openingLine,
      bullets: sanitized.bullets,
      evidenceIds: filterValidEvidenceIds(rawEvidenceIds, state.profile.evidenceLibrary, request.originalCard.evidenceIds),
      risks: sanitized.risks,
      followUps: sanitized.followUps,
    };
    this.saveCueCard(card);
    const cacheKey = `${position.id}::${normalizeText(request.questionText).toLowerCase().slice(0, 120)}`;
    if (result.status === "success") this.db.saveCachedCueCard(cacheKey, card, position.id);
    const evidenceTrace = buildMergedEvidenceTrace(card.evidenceIds, state.profile.evidenceLibrary, retrieval.items);
    const promptRun = buildPromptRun({
      skillId,
      promptId: prompt.id,
      model: this.llm.model,
      provider: this.llm.model,
      inputSummary: `[reconstruct] ${position.title}: ${request.feedback.slice(0, 40)}`,
      outputJson: JSON.stringify({ ...result.data, ...sanitized, evidenceIds: card.evidenceIds }),
      status: result.status,
      latencyMs: Date.now() - started,
      retrievalCount: retrieval.items.length,
      searchUsed: false,
      fallbackReason: result.status === "success" ? "" : "重构失败，已保留原卡内容。",
    });
    this.db.savePromptRun(promptRun, this.currentUserId);
    return {
      card,
      promptRun,
      meta: {
        backendStatus: result.status,
        skillId,
        fallbackReason: result.status === "success" ? "" : "重构失败，已保留原卡内容。",
        promptId: prompt.id,
        provider: this.llm.model,
        evidenceTrace,
        latencyMs: promptRun.latencyMs,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
      },
    };
  }

  async runResumeAi(request: ResumeAiRequest): Promise<ResumeAiResponse> {
    const started = Date.now();
    const state = this.loadState();
    const position = request.positionId ? this.getJdContext(request.positionId) : state.positions[0];
    const retrievalQuery = [request.currentText, request.userMessage, position?.title, position?.company].filter(Boolean).join("\n");
    const retrieval = this.rag.retrieve(retrievalQuery, { positionId: position?.id });
    const prompt = prompts.resumeChat;
    const skillId = skills.resumeOptimizer.id;
    const fallback = buildResumeFallback(request, position);
    const result = await this.llm.chatJson<ResumeAiJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            action: request.action,
            sectionId: request.sectionId,
            sectionTitle: request.sectionTitle,
            currentText: request.currentText,
            fullResumeText: request.fullResumeText,
            userMessage: request.userMessage ?? "",
            position: position ? pickPositionContext(position) : null,
            profileEvidence: state.profile.evidenceLibrary.slice(0, 10),
            highlights: state.profile.highlights,
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.35, schemaHint: JSON.stringify(prompt.outputSchema) },
    );

    const suggestion = result.data.suggestion?.trim() || fallback.suggestion;
    const resumeEvidenceFallback = mergeEvidenceIds([], retrieval.items, state.profile.evidenceLibrary);
    const rawEvidenceIds = normalizeList(result.data.evidenceIds, resumeEvidenceFallback);
    const evidenceIds = filterValidEvidenceIds(rawEvidenceIds, state.profile.evidenceLibrary, resumeEvidenceFallback);
    const evidenceTrace = buildMergedEvidenceTrace(evidenceIds, state.profile.evidenceLibrary, retrieval.items);
    const meta: AiRunMeta = {
      backendStatus: result.status,
      skillId,
      fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
      promptId: prompt.id,
      provider: this.llm.model,
      evidenceTrace,
      latencyMs: Date.now() - started,
      retrievalCount: retrieval.items.length,
      searchUsed: false,
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[resume:${request.action}] ${request.sectionTitle ?? request.sectionId ?? "resume"}`,
        outputJson: JSON.stringify(result.data),
        status: result.status,
        latencyMs: meta.latencyMs,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: meta.fallbackReason,
      }),
      this.currentUserId,
    );
    return {
      reply: result.data.reply?.trim() || fallback.reply || "",
      suggestion: suggestion || fallback.suggestion || "",
      evidenceTrace,
      applyTarget: result.data.applyTarget === "full" ? "full" : (fallback.applyTarget ?? "section"),
      meta,
    };
  }

  saveCueCard(card: AnswerCueCard): void {
    this.db.saveCueCard(card);
  }

  async preWarmCueCards(positionId: string): Promise<void> {
    const state = this.loadState();
    const position = state.positions.find((p) => p.id === positionId);
    if (!position) return;
    const topQuestions = position.questions.filter((q) => q.priority).slice(0, 5);
    for (const q of topQuestions) {
      const cacheKey = `${position.id}::${normalizeText(q.question).toLowerCase().slice(0, 120)}`;
      try {
        if (this.db.getCachedCueCard(cacheKey)) continue;
        await this.createCueCard({ questionText: q.question, positionId: position.id, source: "questionBank", enableSearch: false });
      } catch {
        // ignore warmup errors
      }
    }
  }

  saveQuestion(card: AnswerCueCard): InterviewQuestion {
    const state = this.loadState();
    const position = this.getJdContext();
    const question = saveQuestionFromCueCard(card);
    const nextPosition: Position = { ...position, questions: [question, ...position.questions], updatedAt: nowIso() };
    this.persistState(upsertPosition(state, nextPosition));
    this.rag.reindexQuestions(nextPosition.id, nextPosition.questions);
    return question;
  }

  async createFollowUp(transcript: MockMessage[], positionId?: string): Promise<{ question: string; meta: AiRunMeta }> {
    const started = Date.now();
    const state = this.loadState();
    const position = this.getJdContext(positionId);
    const retrieval = this.rag.retrieve(transcript.map((item) => item.text).join("\n"), { positionId: position.id });
    const fallback = { question: generateFollowUpFromTranscript(transcript, state.profile, position), reason: "local fallback" };
    const prompt = prompts.followUp;
    const skillId = skills.followupDecider.id;
    const result = await this.llm.chatJson<InterviewQuestionJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            jd: pickPositionContext(position),
            profileEvidence: state.profile.evidenceLibrary.slice(0, 8),
            questionBank: position.questions.slice(0, 8),
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.45, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[followup] ${position.title}: ${transcript.at(-1)?.text?.slice(0, 60) ?? ""}`,
        outputJson: JSON.stringify(result.data),
        status: result.status,
        latencyMs: Date.now() - started,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: result.status === "success" ? "" : "模型未配置、响应失败或 JSON 不符合结构，已使用本地追问规则。",
      }),
      this.currentUserId,
    );
    return {
      question: result.data.question || fallback.question,
      meta: {
        backendStatus: result.status,
        skillId,
        fallbackReason: result.status === "success" ? "" : "模型未配置、响应失败或 JSON 不符合结构，已使用本地追问规则。",
        promptId: prompt.id,
        provider: this.llm.model,
        evidenceTrace: buildMergedEvidenceTrace(position.questions.flatMap((question) => question.evidenceIds).slice(0, 4), state.profile.evidenceLibrary, retrieval.items),
        latencyMs: Date.now() - started,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
      },
    };
  }

  async createMockSession(positionId?: string, config?: Record<string, unknown>): Promise<{ sessionId: string; question: string; meta: AiRunMeta; questionSource: string; conversationHistory: ConversationMessage[] }> {
    const started = Date.now();
    const state = this.loadState();
    const position = this.getJdContext(positionId);
    const existingSession = this.db.getLatestActiveMockSession(position.id, this.currentUserId);
    if (existingSession?.conversationHistory?.length) {
      const latestQuestion = [...existingSession.conversationHistory].reverse().find((item) => item.role === "interviewer");
      return {
        sessionId: existingSession.id,
        question: latestQuestion?.text || "继续上次模拟面试",
        questionSource: "resume",
        conversationHistory: existingSession.conversationHistory,
        meta: {
          backendStatus: "cache",
          skillId: skills.mockInterviewer.id,
          fallbackReason: "检测到未完成的模拟面试，已回到上次进度继续练习。",
          promptId: prompts.mockInterviewer.id,
          provider: this.llm.model,
          evidenceTrace: [],
          latencyMs: Date.now() - started,
          retrievalCount: 0,
          searchUsed: false,
        },
      };
    }
    const retrieval = this.rag.retrieve(`${position.title}\n${position.company}\n首题`, { positionId: position.id });
    const localCandidate =
      position.questions.find((question) => question.priority && question.evidenceIds.some((id) => state.profile.evidenceLibrary.some((item) => item.id === id && item.type !== "教育"))) ??
      position.questions.find((question) => question.priority) ??
      position.questions[0];
    const localQuestion = localCandidate?.question ?? "请介绍一段最相关的项目经历。";
    const prompt = prompts.mockInterviewer;
    const skillId = skills.mockInterviewer.id;
    const persona = parsePersona(config?.style ?? config?.persona);
    const systemWithPersona = prompt.system + getPersonaSuffix(persona);
    const result = await this.llm.chatJson<InterviewQuestionJson>(
      [
        { role: "system", content: systemWithPersona },
        {
          role: "user",
          content: JSON.stringify({
            jd: { ...pickPositionContext(position), responsibilities: position.job.responsibilities },
            matchReport: position.matchReport,
            profileEvidence: state.profile.evidenceLibrary.slice(0, 8),
            questionBank: position.questions.slice(0, 10),
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      { question: localQuestion, category: "项目深挖", difficulty: "进阶" },
      { temperature: 0.42, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const sessionId = makeId("mock-session");
    const question = result.data.question || localQuestion;
    const conversationHistory: ConversationMessage[] = [toConversationMessage({ role: "interviewer", text: question }, result.status === "success" ? "model" : "local")];
    const meta: AiRunMeta = {
      backendStatus: result.status,
      skillId,
      fallbackReason: result.status === "success" ? "" : "模型未配置、响应失败或 JSON 不符合结构，已使用本地题库。",
      promptId: prompt.id,
      provider: this.llm.model,
      evidenceTrace: buildMergedEvidenceTrace(localCandidate?.evidenceIds ?? [], state.profile.evidenceLibrary, retrieval.items),
      latencyMs: Date.now() - started,
      retrievalCount: retrieval.items.length,
      searchUsed: false,
    };
    this.db.saveMockSession({
      id: sessionId,
      positionId: position.id,
      config,
      conversationHistory,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: undefined,
      aiMeta: { ...toInterviewAiMeta(meta, this.llm.model), decisionType: "next", internalNote: result.status === "success" ? result.data.reason : "local first question" },
    }, this.currentUserId);
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[mock-start] ${position.title}`,
        outputJson: JSON.stringify(result.data),
        status: result.status,
        latencyMs: meta.latencyMs,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: meta.fallbackReason,
      }),
      this.currentUserId,
    );
    return {
      sessionId,
      question,
      questionSource: result.status === "success" ? "model" : localCandidate ? `${localCandidate.category} · 本地题库` : "local",
      conversationHistory,
      meta,
    };
  }

  async answerMockSession(sessionId: string | undefined, positionId: string | undefined, questionId: string | undefined, answer: string, transcript: MockMessage[]): Promise<{ record: InterviewRecord; followUp: string; decision: MockDecision; meta: AiRunMeta; conversationHistory: ConversationMessage[] }> {
    const started = Date.now();
    const state = this.loadState();
    const position = this.getJdContext(positionId);
    const question = position.questions.find((item) => item.id === questionId) ?? position.questions[0];
    const draft = position.answers.find((item) => item.questionId === question.id);
    const turn = evaluateMockTurn(question, answer, draft);
    const turns = [...position.mockTurns, turn];
    const prompt = prompts.mockDecision;
    const skillId = skills.followupDecider.id;
    const currentSession = sessionId ? this.db.getMockSession(sessionId, this.currentUserId) : undefined;
    const history = normalizeConversationHistory(currentSession?.conversationHistory, transcript);
    const withAnswer = [...history, toConversationMessage({ role: "candidate", text: answer }, "user")];
    const retrieval = this.rag.retrieve(`${question.question}\n${answer}\n${transcript.map((item) => item.text).join("\n")}`, { positionId: position.id });
    const persona = parsePersona(currentSession?.config?.style ?? currentSession?.config?.persona);
    const systemWithPersona = prompt.system + getPersonaSuffix(persona);
    const fallbackDecision: MockDecision = {
      type: needsFollowUp(answer) ? "followup" : "next",
      question: generateFollowUpFromTranscript(transcript, state.profile, position),
      instantFeedback: turn.feedback,
      internalNote: "local fallback based on answer structure, metrics and evidence match",
    };
    const result = await this.llm.chatJson<MockDecision>(
      [
        { role: "system", content: systemWithPersona },
        {
          role: "user",
          content: JSON.stringify({
            position: {
              title: position.title,
              company: position.company,
              jdSummary: position.matchReport.summary,
              hardSkills: position.job.hardSkills,
              softSkills: position.job.softSkills,
              risks: position.matchReport.gaps.filter((gap) => gap.type !== "match").map((gap) => gap.description),
            },
            profile: {
              summary: state.profile.resume.summary,
              evidence: state.profile.evidenceLibrary.slice(0, 8),
            },
            config: currentSession?.config ?? {},
            conversationHistory: withAnswer,
            userAnswer: answer,
            localEvaluation: turn,
            questionBank: position.questions.slice(0, 8),
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallbackDecision,
      { temperature: 0.45, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const decision = normalizeDecision(result.data, fallbackDecision);
    const nextHistory = [...withAnswer, toConversationMessage({ role: "interviewer", text: decision.question }, result.status === "success" ? "model" : "local")];
    const meta: AiRunMeta = {
      backendStatus: result.status,
      skillId,
      fallbackReason: result.status === "success" ? "" : "模型未配置、响应失败或 JSON 不符合结构，已使用本地追问规则。",
      promptId: prompt.id,
      provider: this.llm.model,
      evidenceTrace: buildMergedEvidenceTrace(question.evidenceIds, state.profile.evidenceLibrary, retrieval.items),
      latencyMs: Date.now() - started,
      retrievalCount: retrieval.items.length,
      searchUsed: false,
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[mock-answer] ${position.title}: ${answer.slice(0, 60)}`,
        outputJson: JSON.stringify(decision),
        status: result.status,
        latencyMs: meta.latencyMs,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: meta.fallbackReason,
      }),
      this.currentUserId,
    );
    const report = buildInterviewReport(turns, position.questions, position.matchReport);
    // 本地报告立即返回；LLM 报告可在记录保存时异步增强
    const structuredReport = {
      ...report,
      structuredDimensions: Object.entries(report.dimensions).map(([name, score]) => ({ name: dimensionLabel(name), score: score as number, comment: "本地规则基于回答完整度、相关性、证据和结构估算。" })),
      suggestedNextPractice: report.nextActions[0] ?? "继续练习高优先级问题。",
      source: "local" as const,
    };
    const record: InterviewRecord = {
      id: makeId("record"),
      positionId: position.id,
      mode: "mock",
      title: `${position.title} 模拟面试`,
      createdAt: nowIso(),
      transcript,
      cueCards: [],
      questionIds: [question.id],
      speechMetrics: [],
      report: structuredReport as unknown as typeof structuredReport & { source: string },
      summary: decision.instantFeedback || `模拟面试记录已保存，综合分 ${structuredReport.overallScore}/100。`,
      questionResults: [
        {
          questionId: question.id,
          questionText: question.question,
          answer,
          score: turn.score,
          feedback: turn.feedback,
          evidenceIds: question.evidenceIds,
          cueCardIds: [],
          followUp: decision.question,
        },
      ],
      conversationHistory: nextHistory,
      aiMeta: { ...toInterviewAiMeta(meta, this.llm.model), decisionType: decision.type, internalNote: decision.internalNote },
    };
    const nextState = upsertPosition(this.loadState(), { ...position, mockTurns: turns, report, updatedAt: nowIso() });
    this.db.saveRecord(record, this.currentUserId);
    this.persistState({
      ...nextState,
      records: [record, ...nextState.records.filter((item) => item.id !== record.id)],
    });
    this.rag.reindexRecord(record);
    this.db.saveMockSession({
      id: currentSession?.id ?? sessionId ?? makeId("mock-session"),
      positionId: position.id,
      config: currentSession?.config,
      conversationHistory: nextHistory,
      createdAt: currentSession?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      completedAt: undefined,
      aiMeta: record.aiMeta,
    }, this.currentUserId);
    return { record, followUp: decision.question, decision, meta, conversationHistory: nextHistory };
  }

  saveInterviewRecord(record: InterviewRecord): void {
    const state = this.loadState();
    this.db.saveRecord(record, this.currentUserId);
    this.persistState({
      ...state,
      records: [record, ...state.records.filter((item) => item.id !== record.id)],
    });
    this.rag.reindexRecord(record);
  }

  async createReportForRecord(record: InterviewRecord, positionId?: string): Promise<InterviewRecord> {
    const position = this.getJdContext(positionId || record.positionId);
    const turns = position.mockTurns.length ? position.mockTurns : [];
    const report = await this.createReportForTurns(turns, position, record.transcript);
    return {
      ...record,
      report,
      summary: report.summary,
      aiMeta: {
        ...(record.aiMeta ?? { backendStatus: "fallback", fallbackReason: "", model: this.llm.model, latencyMs: 0 }),
        model: this.llm.model,
      },
    };
  }

  private async createJdAnalysis(position: Position, profile: CandidateProfile): Promise<{ summary: string; overlapEvidence: string[]; risks: string[]; preparationAdvice: string[]; questions: string[] }> {
    const retrieval = this.rag.retrieve(`${position.title}\n${position.company}\n${position.jobText}`, { positionId: position.id });
    const prompt = prompts.jdDiagnosis;
    const skillId = skills.jdMatchDiagnosis.id;
    const fallback = {
      summary: position.matchReport.summary,
      overlapEvidence: profile.evidenceLibrary.slice(0, 3).map((item) => item.title),
      risks: position.matchReport.gaps.filter((item) => item.type !== "match").map((item) => item.description).slice(0, 4),
      preparationAdvice: position.analysisContext.preparationTips.slice(0, 4),
      questions: position.questions.slice(0, 4).map((item) => item.question),
    };
    const result = await this.llm.chatJson<JdAnalysisJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            jd: { ...pickPositionContext(position), responsibilities: position.job.responsibilities },
            matchReport: position.matchReport,
            profileEvidence: profile.evidenceLibrary,
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.3, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const normalized = {
      summary: result.data.summary?.trim() || fallback.summary,
      overlapEvidence: normalizeList(result.data.overlapEvidence, fallback.overlapEvidence).slice(0, 5),
      risks: normalizeList(result.data.risks, fallback.risks).slice(0, 5),
      preparationAdvice: normalizeList(result.data.preparationAdvice, fallback.preparationAdvice).slice(0, 5),
      questions: normalizeList(result.data.questions, fallback.questions).slice(0, 5),
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[jd-analysis] ${position.company} ${position.title}`,
        outputJson: JSON.stringify(normalized),
        status: result.status,
        latencyMs: 0,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
      }),
      this.currentUserId,
    );
    return normalized;
  }

  private async createReportForTurns(turns: Array<ReturnType<typeof evaluateMockTurn>>, position: Position, transcript: MockMessage[]) {
    const local = buildInterviewReport(turns, position.questions, position.matchReport);
    const retrieval = this.rag.retrieve(transcript.map((item) => item.text).join("\n"), { positionId: position.id });
    const fallback: ReportJson = {
      overallScore: local.overallScore,
      dimensions: Object.entries(local.dimensions).map(([name, score]) => ({ name: dimensionLabel(name), score, comment: "本地规则基于回答完整度、相关性、证据和结构估算。" })),
      strengthPoints: local.nextActions.slice(0, 1),
      improvementPoints: local.nextActions.slice(1, 3),
      suggestedNextPractice: local.nextActions[0] ?? "继续练习高优先级问题。",
      summary: local.summary,
    };
    const prompt = prompts.report;
    const skillId = skills.reportScorer.id;
    const started = Date.now();
    const result = await this.llm.chatJson<ReportJson>(
      [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content: JSON.stringify({
            jd: pickPositionContext(position),
            matchReport: position.matchReport,
            transcript,
            turns,
            retrievedContext: retrieval.items.map(toRetrievedContext),
            outputSchema: prompt.outputSchema,
            guardrails: prompt.guardrails,
          }),
        },
      ],
      fallback,
      { temperature: 0.35, schemaHint: JSON.stringify(prompt.outputSchema) },
    );
    const dimensions = Array.isArray(result.data.dimensions) ? result.data.dimensions : fallback.dimensions!;
    const reportSource: "model" | "local" = result.status === "success" ? "model" : "local";
    const report = {
      ...local,
      overallScore: clampScore(result.data.overallScore ?? local.overallScore),
      structuredDimensions: dimensions.map((item) => ({ name: item.name || "综合表现", score: clampScore(item.score ?? 60), comment: item.comment || "待补充评价。" })).slice(0, 6),
      strengthPoints: normalizeList(result.data.strengthPoints, fallback.strengthPoints!).slice(0, 5),
      improvementPoints: normalizeList(result.data.improvementPoints, fallback.improvementPoints!).slice(0, 5),
      suggestedNextPractice: result.data.suggestedNextPractice || fallback.suggestedNextPractice,
      summary: result.data.summary || local.summary,
      source: reportSource,
    };
    this.db.savePromptRun(
      buildPromptRun({
        skillId,
        promptId: prompt.id,
        model: this.llm.model,
        provider: this.llm.model,
        inputSummary: `[report] ${position.title}: ${transcript[0]?.text?.slice(0, 40) ?? "mock"}`,
        outputJson: JSON.stringify(report),
        status: result.status,
        latencyMs: Date.now() - started,
        retrievalCount: retrieval.items.length,
        searchUsed: false,
        fallbackReason: result.status === "success" ? "" : LOCAL_FALLBACK_REASON,
      }),
      this.currentUserId,
    );
    return report;
  }

  private async safeSearch(position: Position, questionText: string): Promise<SearchResult[]> {
    try {
      const searchQuery = `${position.company} ${position.title} ${questionText}`.trim();
      return await this.search(searchQuery);
    } catch {
      return [
        {
          id: makeId("search-timeout"),
          query: `${position.company} ${position.title} ${questionText}`.trim(),
          title: "搜索未接通",
          url: "",
          snippet: "联网搜索超时或未接通，本次仅使用本地资料回答。",
          provider: this.searchProvider === "disabled" ? "disabled" : "local",
          createdAt: nowIso(),
        },
      ];
    }
  }
}

function normalizeList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : fallback;
}

function sanitizeCueCardPayload(value: CueCardJson, fallback: Pick<AnswerCueCard, "strategy" | "openingLine" | "bullets" | "risks" | "followUps">) {
  const sanitizeText = (text: string, defaultValue: string) => {
    const trimmed = sanitizeDisplayText(text.trim(), defaultValue);
    if (!trimmed) return defaultValue;
    if (hasCorruptedText(trimmed)) return DATA_REPAIR_NEEDED;
    if (/(虚构|编造|假设一个|杜撰|想象一个)/.test(trimmed)) {
      return "如果真实证据不足，请明确说明边界，并补充你已经做过的事实、动作或复盘。";
    }
    return trimmed;
  };

  const sanitizeList = (items: string[], defaults: string[]) =>
    items
      .map((item, index) => sanitizeText(item, defaults[index] ?? defaults[0] ?? "请只引用真实经历与可验证结果。"))
      .filter(Boolean)
      .slice(0, defaults.length > 0 ? Math.max(defaults.length, 1) : 4);

  return {
    strategy: sanitizeText(value.strategy || fallback.strategy, fallback.strategy),
    openingLine: sanitizeText(value.openingLine || fallback.openingLine, fallback.openingLine),
    bullets: sanitizeList(normalizeList(value.bullets, fallback.bullets), fallback.bullets).slice(0, 5),
    risks: sanitizeList(normalizeList(value.risks, fallback.risks), fallback.risks).slice(0, 4),
    followUps: sanitizeList(normalizeList(value.followUps, fallback.followUps), fallback.followUps).slice(0, 4),
  };
}

function sanitizeAnswerCueCard(card: AnswerCueCard): AnswerCueCard {
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

function buildEvidenceTrace(evidenceIds: string[], evidence: Array<{ id: string; title: string; detail: string; impact: string }>): EvidenceTraceItem[] {
  return Array.from(new Set(evidenceIds))
    .map((id) => {
      const matched = evidence.find((item) => item.id === id);
      if (matched) {
        if ([matched.title, matched.detail, matched.impact].some(hasCorruptedText)) {
          return {
            id,
            title: DATA_REPAIR_NEEDED,
            detail: "该证据内容已损坏，无法可靠还原原文。",
            impact: "需重新补充真实项目、动作和可验证结果",
            synthetic: true,
          };
        }
        return matched;
      }
      if (id === "ev-fallback") {
        return {
          id,
          title: "练习推断（待补真实证据）",
          detail: "当前没有命中可直接复用的真实证据，请先补充真实经历、动作和结果。",
          impact: "练习模式推断，需补充真实项目、动作和可验证结果",
          synthetic: true,
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => ({
      id: item!.id,
      title: sanitizeDisplayText(item!.title),
      reason: sanitizeDisplayText(item!.impact || item!.detail),
      synthetic: Boolean((item as CandidateProfile["evidenceLibrary"][number] & { synthetic?: boolean }).synthetic),
    }));
}

function buildMergedEvidenceTrace(evidenceIds: string[], evidence: CandidateProfile["evidenceLibrary"], retrieved: RetrievedChunk[]): EvidenceTraceItem[] {
  const direct = buildEvidenceTrace(evidenceIds, evidence);
  const extra = retrieved
    .filter((item) => item.sourceType !== "resume")
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: sanitizeDisplayText(item.title),
      reason: sanitizeDisplayText(item.content.slice(0, 80)),
      synthetic: item.sourceType === "resume" ? undefined : false,
    }));
  return [...direct, ...extra].slice(0, 5);
}

function filterValidEvidenceIds(evidenceIds: string[], evidence: CandidateProfile["evidenceLibrary"], fallback: string[]): string[] {
  const validIds = new Set(evidence.map((item) => item.id));
  const filtered = evidenceIds.filter((id) => validIds.has(id) || id === "ev-fallback");
  return filtered.length > 0 ? filtered : fallback;
}

function mergeEvidenceIds(fallbackIds: string[], retrieved: RetrievedChunk[], evidence: CandidateProfile["evidenceLibrary"]): string[] {
  const matchedEvidence = retrieved
    .flatMap((item) =>
      evidence
        .filter((entry) => item.content.includes(entry.title) || entry.keywords.some((keyword) => keyword && item.content.includes(keyword)))
        .map((entry) => entry.id),
    )
    .slice(0, 4);
  return Array.from(new Set([...fallbackIds, ...matchedEvidence]));
}

function toConversationMessage(message: MockMessage, source: ConversationMessage["source"]): ConversationMessage {
  return { id: makeId("msg"), role: message.role, text: message.text, source, createdAt: nowIso() };
}

function normalizeConversationHistory(history: ConversationMessage[] | undefined, transcript: MockMessage[]): ConversationMessage[] {
  if (history?.length) return history;
  return transcript.map((message) => toConversationMessage(message, message.role === "candidate" ? "user" : "local"));
}

function normalizeDecision(value: MockDecision, fallback: MockDecision): MockDecision {
  const type = value.type === "next" || value.type === "followup" ? value.type : fallback.type;
  return {
    type,
    question: value.question?.trim() || fallback.question,
    instantFeedback: value.instantFeedback?.trim() || fallback.instantFeedback,
    internalNote: value.internalNote?.trim() || fallback.internalNote,
  };
}

function needsFollowUp(answer: string): boolean {
  return answer.trim().length < 120 || !/\d/.test(answer) || !/(我|本人|自己|负责|主导|协助)/.test(answer);
}

function toInterviewAiMeta(meta: AiRunMeta, model: string) {
  return {
    backendStatus: normalizeInterviewBackendStatus(meta.backendStatus),
    fallbackReason: meta.fallbackReason,
    model,
    latencyMs: meta.latencyMs,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 60)));
}

function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    completeness: "回答完整度",
    relevance: "岗位相关性",
    evidenceStrength: "证据强度",
    structure: "表达结构",
    riskControl: "风险控制",
  };
  return labels[key] ?? key;
}

function parsePersona(value: unknown): PersonaKey | undefined {
  return value === "gentle" || value === "strict" || value === "pressure" ? value : undefined;
}

function normalizeInterviewBackendStatus(status: AiRunMeta["backendStatus"]): "success" | "fallback" | "error" {
  return status === "cache" ? "fallback" : status;
}

function resolveIntakeFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    company: "目标公司",
    role: "岗位名称",
    interviewer: "面试官类型",
    difficulty: "面试难度",
    duration: "面试时长",
    hasJd: "完整 JD",
  };
  return labels[key] ?? key;
}

function shouldUseSearch(questionText: string, requested?: boolean): boolean {
  if (!requested) return false;
  return /(最新|近期|动态|新闻|趋势|版本|今年|现在|最近|公司|行业|政策|发布)/.test(questionText);
}

function pickPositionContext(position: Position) {
  return {
    title: position.title,
    company: position.company,
    hardSkills: position.job.hardSkills,
    softSkills: position.job.softSkills,
    keywords: position.job.keywords,
  };
}

function toRetrievedContext(item: RetrievedChunk) {
  return {
    id: item.id,
    title: item.title,
    sourceType: item.sourceType,
    snippet: item.content.slice(0, 220),
  };
}

function mergeGaps(existing: Position["matchReport"]["gaps"], risks: string[]): Position["matchReport"]["gaps"] {
  const next = [...existing];
  risks.forEach((risk) => {
    if (next.some((item) => item.description === risk)) return;
    next.push({ label: "资料缺口", type: "risk", description: risk });
  });
  return next.slice(0, 8);
}

function buildResumeFallback(request: ResumeAiRequest, position?: Position): ResumeAiJson {
  const target = request.action === "full" ? "整份简历" : request.sectionTitle || "当前区块";
  const matchHint = position ? `当前岗位重点是 ${position.job.hardSkills.slice(0, 4).join("、") || "核心能力证据"}。` : "先把经历写具体，再补结果。";
  const normalizedCurrentText = request.currentText.replace(/\s+/g, " ").trim();
  if (request.action === "full") {
    return {
      reply: "我先给你一版可直接回写到各简历区块的本地练习稿，重点是把空泛表述改成可验证的岗位证据。",
      suggestion: [
        "亮点摘要",
        "- 用一句话先讲清你最贴近岗位的核心优势，例如：具备面试产品、增长分析与项目落地的复合经历。",
        "",
        "项目经历",
        `- 按 STAR 重写最相关项目：${normalizedCurrentText.slice(0, 140) || "补一段最能证明岗位相关性的项目经历"}。`,
        `- 明确动作、方法和结果，优先补齐 ${position?.job.hardSkills.slice(0, 3).join("、") || "关键技能"} 的使用细节。`,
        "",
        "技能与工具",
        `- 聚焦当前岗位关键词：${position?.job.hardSkills.slice(0, 6).join("、") || "数据分析、项目推进、业务沟通"}。`,
        "- 每个技能尽量对应真实场景，避免只罗列名词。",
        "",
        "待补强",
        `- ${matchHint}`,
        "- 若缺量化结果，补 1 到 2 个指标或业务影响，避免只写参与过程。",
      ].join("\n"),
      applyTarget: "full",
      evidenceIds: [],
    };
  }

  return {
    reply:
      request.action === "match"
        ? `我先按当前岗位做了一轮匹配检查。${matchHint} 下面这版建议会优先强化你已经有的证据，避免写成空泛套话。`
        : `我先按你当前这部分内容做了本地练习模式下的改写建议，重点是压缩空话、补动作和结果。`,
    suggestion: [
      `${target}优化版：`,
      "1. 先用一句结论说明你的核心职责或结果。",
      `2. 再补真实动作：${request.currentText.replace(/\s+/g, " ").trim().slice(0, 180) || "补一段最相关经历"}`,
      `3. 最后补结果和复盘：${matchHint}`,
    ].join("\n"),
    applyTarget: "section",
    evidenceIds: [],
  };
}

function dedupeIntakeMessages(messages: Array<{ id: string; role: "assistant" | "user"; text: string; createdAt: string }>) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.role}::${message.text.trim()}`;
    if (!message.text.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMissingFields(
  fields: Array<{ key?: string; label?: string }> | undefined,
  fallback: Position["intake"]["missingFields"],
): Position["intake"]["missingFields"] {
  if (!Array.isArray(fields) || fields.length === 0) return fallback;
  return fields
    .map((field) => {
      const key = field.key;
      if (!key || !fallback.some((item) => item.key === key)) return null;
      return { key: key as Position["intake"]["missingFields"][number]["key"], label: field.label?.trim() || resolveIntakeFieldLabel(key) };
    })
    .filter((item): item is Position["intake"]["missingFields"][number] => Boolean(item));
}

function normalizeConfirmedFields(
  fields: Array<{ key?: string; label?: string; value?: string }> | undefined,
): Position["intake"]["confirmedFields"] {
  if (!Array.isArray(fields) || fields.length === 0) return [];
  const allowedKeys = new Set(["company", "role", "interviewer", "difficulty", "duration", "hasJd"]);
  const normalized: Position["intake"]["confirmedFields"] = [];
  fields.forEach((field) => {
    const key = field.key;
    const value = field.value?.trim();
    if (!key || !allowedKeys.has(key) || !value) return;
    normalized.push({
      key: key as Position["intake"]["confirmedFields"][number]["key"],
      label: resolveIntakeFieldLabel(key),
      value,
      source: "confirmed",
    });
  });
  return mergeConfirmedFields(normalized);
}

function mergeConfirmedFields(fields: Position["intake"]["confirmedFields"]): Position["intake"]["confirmedFields"] {
  const latest = new Map<Position["intake"]["confirmedFields"][number]["key"], Position["intake"]["confirmedFields"][number]>();
  fields.forEach((field) => {
    if (field.value.trim()) latest.set(field.key, { ...field, label: resolveIntakeFieldLabel(field.key), source: "confirmed" });
  });
  return Array.from(latest.values());
}

function buildIntakeAssistantFallback(position: Position): IntakeFollowUpJson {
  const missing = position.intake.missingFields;
  return {
    reply:
      missing.length === 0
        ? "当前 intake 关键信息已经基本齐了。你可以直接保存岗位，或者再补一轮更细的面试背景信息。"
        : `我先保留你的原文。当前还缺 ${missing.map((item) => item.label).join("、")}，继续补这些字段后，岗位卡和后续提词卡会更稳定。`,
    missingFields: missing.map((item) => ({ key: item.key, label: item.label })),
    confirmedFields: [],
    suggestedPrompts:
      missing.length === 0
        ? ["这是最终确认版岗位信息，请帮我检查是否还缺关键信息", "我想直接进入模拟面试，先用当前 intake 配置", "继续用当前岗位生成题库和提词卡"]
        : missing.slice(0, 3).map((item) => `补充一下${item.label}：`),
    confidence: missing.length === 0 ? 0.92 : 0.55,
  };
}

function buildResumeHighlightsFallback(profile: CandidateProfile): ResumeHighlightsJson {
  return {
    highlights: profile.highlights.length ? profile.highlights.slice(0, 5) : buildLocalHighlights(profile),
    evidenceIds: profile.evidenceLibrary.slice(0, 4).map((item) => item.id),
  };
}

function buildLocalHighlights(profile: CandidateProfile): string[] {
  const highlights: string[] = [];
  profile.evidenceLibrary.slice(0, 4).forEach((item) => {
    if (item.impact.includes("可量化") || /\d/.test(item.impact)) {
      highlights.push(`${item.title}：${item.impact}`);
      return;
    }
    highlights.push(`${item.title}：${item.detail.slice(0, 36)}`);
  });
  if (profile.resume.metrics.length > 0) highlights.push(`关键量化成果：${profile.resume.metrics.slice(0, 3).join("、")}`);
  if (profile.resume.skills.length > 0) highlights.push(`核心技能组合：${profile.resume.skills.slice(0, 5).join("、")}`);
  return Array.from(new Set(highlights.map((item) => item.trim()).filter(Boolean))).slice(0, 5);
}

function buildPromptRun(input: {
  skillId: string;
  promptId: string;
  model: string;
  provider: string;
  inputSummary: string;
  outputJson: string;
  status: PromptRun["status"];
  latencyMs: number;
  retrievalCount: number;
  searchUsed: boolean;
  fallbackReason: string;
}): PromptRun {
  return {
    id: makeId("prompt"),
    skillId: input.skillId,
    promptId: input.promptId,
    model: input.model,
    provider: input.provider,
    inputSummary: input.inputSummary,
    outputJson: input.outputJson,
    status: input.status,
    latencyMs: input.latencyMs,
    retrievalCount: input.retrievalCount,
    searchUsed: input.searchUsed,
    fallbackReason: input.fallbackReason,
    createdAt: nowIso(),
  };
}
