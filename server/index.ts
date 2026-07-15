import "dotenv/config";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, createReadStream } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDb, toApiSnapshot } from "./db";
import { createLlmClient } from "./llm";
import type { LlmClient } from "./llm";
import { AiOrchestrator } from "./orchestrator";
import { createSearchTool } from "./search";
import type { AnswerCueCard, AppState, BackendState, InterviewRecord, LiveCueSessionRecord, Position } from "./types";
import { createAuthService } from "./domains/auth/auth.service";
import { registerAuthRoutes } from "./domains/auth/auth.routes";
import { createQuotaService } from "./domains/quota/quota.service";
import type { SessionInfo } from "./domains/auth/types";
import { makeId, nowIso } from "./utils";
import { createInitialAppState, createPosition } from "../src/lib/interviewEngine";
import { createMailService } from "./mail/service";
import { applyRateLimit, ensureGuestId, ownerOf, requireAuth, setCorsHeaders } from "./security";
import { registerXfyunAsrRoute } from "./asr";
import { registerAudioBridgeIngestRoute, registerAudioBridgePairingRoutes } from "./audioBridge";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionInfo;
    guestOwnerId?: string;
  }
}

const CueCardBody = z.object({
  questionText: z.string().min(1),
  positionId: z.string().optional(),
  source: z.enum(["live", "mock", "questionBank", "manual"]).optional(),
  enableSearch: z.boolean().optional(),
  recentHistory: z.array(z.object({ role: z.enum(["interviewer", "candidate"]), text: z.string() })).optional(),
  sessionId: z.string().optional(),
});

const ReconstructCueCardBody = z.object({
  questionText: z.string().min(1),
  positionId: z.string().optional(),
  feedback: z.string().min(1),
  originalCard: z.record(z.string(), z.unknown()),
});

const AnalyzePositionBody = z.object({
  jobText: z.string().min(1),
  positionId: z.string().optional(),
});

const AnalyzeProfileBody = z.object({
  resumeText: z.string(),
});

const FollowUpBody = z.object({
  positionId: z.string().optional(),
  transcript: z.array(z.object({ role: z.enum(["interviewer", "candidate"]), text: z.string() })),
});

const MockAnswerBody = z.object({
  positionId: z.string().optional(),
  questionId: z.string().optional(),
  answer: z.string().min(1),
  transcript: z.array(z.object({ role: z.enum(["interviewer", "candidate"]), text: z.string() })),
});

const SearchBody = z.object({
  query: z.string().min(1),
});

const IntakeFieldBody = z.object({
  key: z.enum(["company", "role", "interviewer", "difficulty", "duration", "hasJd"]),
  value: z.string(),
  source: z.enum(["raw", "inferred", "confirmed"]).optional(),
});

const IntakeBody = z.object({
  positionId: z.string().optional(),
  rawJdText: z.string().min(1),
  inferredFields: z.array(IntakeFieldBody).optional(),
  confirmedFields: z.array(IntakeFieldBody).optional(),
  messages: z.array(z.object({ role: z.enum(["assistant", "user"]), text: z.string() })).optional(),
});

const CreatePositionBody = z.object({
  jobText: z.string().trim().min(1),
});

const ProfileBody = z.object({
  displayName: z.string().optional(),
  resumeText: z.string(),
      evidenceLibrary: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          title: z.string(),
          detail: z.string(),
          keywords: z.array(z.string()),
          impact: z.string(),
          synthetic: z.boolean().optional(),
        }),
      ),
  highlights: z.array(z.string()),
});

const MaterialsBody = z.object({
  materials: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["project", "upload", "note"]),
      source: z.enum(["manual", "upload", "derived"]),
      title: z.string(),
      detail: z.string(),
      summary: z.string(),
      keywords: z.array(z.string()),
      tags: z.array(z.string()),
      linkedQuestionIds: z.array(z.string()),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

const QuestionsBody = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      question: z.string(),
      reason: z.string(),
      evidenceIds: z.array(z.string()),
      difficulty: z.string(),
      source: z.enum(["diagnosis", "manual", "mock", "material", "cueCard"]),
      priority: z.boolean(),
      notes: z.string(),
      answer: z.string().optional(),
      lastReviewedAt: z.string().optional(),
      cueCardIds: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});

const PreferencesBody = z.object({
  interviewerRole: z.enum(["HR", "上级", "CEO", "CTO", "业务负责人"]),
  difficulty: z.enum(["正常", "压力面", "地狱面"]),
  interviewerGender: z.enum(["女", "男"]),
  submitMode: z.enum(["manual", "auto"]),
  style: z.enum(["gentle", "strict", "pressure"]),
});

const ResumeAiBody = z.object({
  positionId: z.string().optional(),
  action: z.enum(["section", "full", "match"]),
  sectionId: z.string().optional(),
  sectionTitle: z.string().optional(),
  currentText: z.string(),
  fullResumeText: z.string(),
  userMessage: z.string().optional(),
});

const ProfileHighlightsBody = z.object({
  resumeText: z.string(),
  displayName: z.string().optional(),
  positionId: z.string().optional(),
});

const SERVER_DIR = resolve(fileURLToPath(import.meta.url), "..");
const DIST_DIR = resolve(SERVER_DIR, "..", "dist");
const DIST_INDEX = resolve(DIST_DIR, "index.html");

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

export function buildServer(options: { dbPath?: string; llmClient?: LlmClient } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = createDb(options.dbPath);
  const orchestrator = new AiOrchestrator(db, options.llmClient ?? createLlmClient(), createSearchTool());
  const mailer = createMailService();
  const auth = createAuthService(db, mailer);
  const quota = createQuotaService(db);
  const corsOrigin = process.env.APP_CORS_ORIGIN ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:5273";

  app.addHook("onRequest", async (_request, reply) => {
    setCorsHeaders(reply);
  });

  app.options("/*", async () => ({ ok: true }));

  app.register(async (realtimeApp) => {
    await realtimeApp.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });
    registerXfyunAsrRoute(realtimeApp);
    registerAudioBridgeIngestRoute(realtimeApp, db);
  });

  // Auth middleware: attach session if token present (optional — guests proceed without)
  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        request.session = auth.validateSession(header.slice(7));
      } catch {
        // Invalid/expired token — continue as guest
      }
    }
    // 未登录访客优先按前端 guest id 隔离；本地存储不可用时由服务端 cookie 兜底。
    if (!request.session) {
      request.guestOwnerId = ensureGuestId(request, reply);
    }
    orchestrator.setUserId(ownerOf(request));
  });

  // Register auth routes
  registerAuthRoutes(app, auth);

  // Audio bridge pairing + device management + transcript SSE (needs request.session from auth hook above)
  registerAudioBridgePairingRoutes(app, db);

  app.get("/api/mail/outbox", async (request, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    const session = requireAuth(request);
    return { items: mailer.listOutbox().filter((item) => item.userId === session.userId) };
  });

  // Merge guest data into authenticated user account
  app.post("/api/auth/merge-guest", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    const body = request.body as Partial<BackendState>;
    const userState = db.getState(request.session.userId);
    const guestPositions = Array.isArray(body?.positions) ? body.positions : [];
    const guestRecords = Array.isArray(body?.records) ? body.records : [];

    const existingIds = new Set(userState.positions.map((p) => p.id));
    const newPositions = guestPositions.filter((p) => !existingIds.has(p.id));

    const existingRecordIds = new Set(userState.records.map((r) => r.id));
    const newRecords = guestRecords.filter((r) => !existingRecordIds.has(r.id));

    const merged: BackendState = {
      profile: body?.profile ?? userState.profile,
      positions: [...userState.positions, ...newPositions],
      records: [...userState.records, ...newRecords],
      journeyState: userState.journeyState ?? "ready",
    };
    db.saveState(merged, request.session.userId);
    return { ok: true, mergedPositions: newPositions.length, mergedRecords: newRecords.length };
  });

  // Quota helper: call before AI-heavy endpoints (registered users only)
  const requireQuota = (request: Parameters<typeof requireAuth>[0], endpoint: string) => {
    const session = requireAuth(request);
    orchestrator.setUserId(session.userId);
    const state = db.getState(session.userId);
    return quota.checkAndRecord(session.userId, endpoint, state.positions.length);
  };

  // Quota info endpoint
  app.get("/api/quota", async (request) => {
    const session = requireAuth(request);
    const state = db.getState(session.userId);
    return quota.getQuotaInfo(session.userId, state.positions.length);
  });

  // Onboarding
  app.post("/api/onboarding", async (request) => {
    if (!request.session) return { ok: true, note: "guest", profile: createInitialAppState().profile, nextStep: "intake_jd" as const };
    const body = request.body as Record<string, unknown>;
    const userId = request.session.userId;
    const state = db.getState(userId);
    const targetRole = (body.targetRole as string) || state.profile.resume.targetRole || "待定岗位";
    const profile = {
      ...state.profile,
      displayName: (body.displayName as string) || state.profile.displayName || "候选人",
      resumeText: (body.resumeText as string) || state.profile.resumeText || "",
    };
    // Generate a default position from targetRole if no positions exist
    let position: Position | undefined;
    if (state.positions.length === 0) {
      const defaultJd = `目标岗位：${targetRole}\n城市：${body.city || "待定"}\n经验：${body.experience || "待定"}\n阶段：${body.stage || "准备面试"}`;
      position = createPosition(defaultJd, profile);
    }
    const nextState: BackendState = {
      ...state,
      profile,
      positions: position ? [position, ...state.positions] : state.positions,
      journeyState: "ready",
    };
    db.saveState(nextState, userId);
    if (db.db) {
      db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
        .run(makeId("audit"), userId, "onboarding", JSON.stringify(body), nowIso());
    }
    const nextStep = profile.resumeText.trim() ? "intake_jd" as const : "import_resume" as const;
    return { ok: true, profile, position, nextStep };
  });

  // Feedback
  app.post("/api/feedback", async (request) => {
    const body = request.body as { category?: string; content?: string; contact?: string };
    const id = makeId("fb");
    const now = nowIso();
    if (db.db) {
      db.db.prepare("insert into feedback_tickets(id, user_id, category, content, contact, created_at) values (?, ?, ?, ?, ?, ?)")
        .run(id, request.session?.userId ?? null, body.category ?? "other", body.content ?? "", body.contact ?? null, now);
    }
    if (db.db) {
      db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
        .run(makeId("audit"), request.session?.userId ?? null, "feedback", id, now);
    }
    const supportEmail = process.env.SUPPORT_EMAIL?.trim();
    if (supportEmail) {
      await mailer.sendEmail({
        to: supportEmail,
        subject: "收到新的用户反馈",
        template: "feedbackNotice",
        userId: request.session?.userId ?? null,
        variables: {
          ticketId: id,
          category: body.category ?? "other",
          content: body.content ?? "",
          contact: body.contact ?? "",
        },
      });
    }
    return { ok: true, ticketId: id };
  });

  // Data export
  app.post("/api/data/export", async (request) => {
    const userId = requireAuth(request).userId;
    const state = db.getState(userId);
    const exportData = {
      profile: state.profile,
      positions: state.positions,
      records: state.records,
      exportedAt: nowIso(),
    };
    if (db.db) {
      db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
        .run(makeId("audit"), userId ?? null, "export", `positions:${state.positions.length},records:${state.records.length}`, nowIso());
    }
    return exportData;
  });

  // Data deletion request
  app.post("/api/data/delete-request", async (request) => {
    const userId = requireAuth(request).userId;
    // Soft delete: clear user state
    const empty: BackendState = { profile: createInitialAppState().profile, positions: [], records: [], journeyState: "guest" };
    db.saveState(empty, userId);
    if (db.db) {
      db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
        .run(makeId("audit"), userId, "delete_request", "user data cleared", nowIso());
    }
    return { ok: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    const typedError = error as Error & {
      statusCode?: number;
      quotaInfo?: unknown;
      quotaFeature?: string;
      quotaFeatureInfo?: unknown;
    };
    const statusCode = typedError.statusCode ?? 500;
    if (statusCode === 429 && typedError.message === "QUOTA_EXCEEDED") {
      return reply.code(429).send({
        error: "QUOTA_EXCEEDED",
        message: "今日该功能的免费 AI 额度已用完，明天 0 点重置。",
        quota: {
          feature: typedError.quotaFeature,
          info: typedError.quotaFeatureInfo,
          summary: typedError.quotaInfo,
        },
      });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: (error as Error).message });
    }
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(error) });
  });

  app.get("/api/health", async () => ({
    ok: true,
    searchProvider: orchestrator.searchProvider,
    model: orchestrator.model,
    db: db.db ? "sqlite" : "file",
    auth: "required",
  }));

  app.get("/api/state", async (request) => {
    const state = db.getState(ownerOf(request));
    return toApiSnapshot(state);
  });

  app.post("/api/positions/intake", async (request) => {
    requireAuth(request);
    const body = IntakeBody.parse(request.body);
    const result = await orchestrator.upsertPositionIntake({
      positionId: body.positionId,
      rawJdText: body.rawJdText,
      confirmedFields: body.confirmedFields,
      messages: body.messages,
    });
    return {
      ...toApiSnapshot(result.state, result.activePositionId),
      intakeAssistant: result.intakeAssistant,
    };
  });

  // Creating a library container must be immediate; JD intelligence remains on /intake.
  app.post("/api/positions", async (request) => {
    const session = requireAuth(request);
    const body = CreatePositionBody.parse(request.body);
    const state = db.getState(session.userId);
    const position = createPosition(body.jobText, state.profile);
    const nextState: BackendState = {
      ...state,
      positions: [...state.positions, position],
    };
    db.saveState(nextState, session.userId);
    return toApiSnapshot(nextState, position.id);
  });

  app.post("/api/profile", async (request) => {
    requireAuth(request);
    const body = ProfileBody.parse(request.body);
    return toApiSnapshot(
      orchestrator.updateProfile({
        displayName: body.displayName,
        resumeText: body.resumeText,
        evidenceLibrary: body.evidenceLibrary,
        highlights: body.highlights,
      }),
    );
  });

  app.post("/api/profile/analyze", async (request) => {
    requireAuth(request);
    const body = AnalyzeProfileBody.parse(request.body);
    return toApiSnapshot(orchestrator.analyzeProfile(body.resumeText));
  });

  app.post("/api/positions/analyze", async (request) => {
    const session = requireAuth(request);
    applyRateLimit(`positions-analyze:${session.userId}`, 30, 60 * 60 * 1000);
    requireQuota(request, "position-analyze");
    const body = AnalyzePositionBody.parse(request.body);
    return toApiSnapshot(await orchestrator.analyzePosition(body.jobText, body.positionId), body.positionId);
  });

  app.get<{ Params: { id: string } }>("/api/positions/:id/context", async (request, reply) => {
    const state = db.getState(ownerOf(request));
    const position = state.positions.find((item) => item.id === request.params.id);
    if (!position) return reply.code(404).send({ error: "POSITION_NOT_FOUND" });
    return {
      profile: state.profile,
      position,
      questions: position.questions,
      evidence: state.profile.evidenceLibrary,
    };
  });

  app.post<{ Params: { id: string } }>("/api/positions/:id/materials", async (request, reply) => {
    const body = MaterialsBody.parse(request.body);
    try {
      const position = orchestrator.updatePositionMaterials(request.params.id, body.materials);
      return { position };
    } catch (error) {
      if (String(error).includes("POSITION_NOT_FOUND")) {
        return reply.code(404).send({ error: "POSITION_NOT_FOUND" });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/positions/:id/questions", async (request, reply) => {
    const body = QuestionsBody.parse(request.body);
    try {
      const position = orchestrator.updatePositionQuestions(request.params.id, body.questions);
      return { position };
    } catch (error) {
      if (String(error).includes("POSITION_NOT_FOUND")) {
        return reply.code(404).send({ error: "POSITION_NOT_FOUND" });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/positions/:id/preferences", async (request, reply) => {
    const body = PreferencesBody.parse(request.body);
    try {
      const position = orchestrator.updatePositionPreferences(request.params.id, body);
      return { position };
    } catch (error) {
      if (String(error).includes("POSITION_NOT_FOUND")) {
        return reply.code(404).send({ error: "POSITION_NOT_FOUND" });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/positions/:id/mock-session", async (request, reply) => {
    requireAuth(request);
    const session = orchestrator.getLatestActiveMockSession(request.params.id);
    if (!session) {
      return reply.code(404).send({ error: "MOCK_SESSION_NOT_FOUND" });
    }
    return { session };
  });

  app.delete<{ Params: { id: string } }>("/api/positions/:id", async (request, reply) => {
    requireAuth(request);
    try {
      const state = orchestrator.removePosition(request.params.id);
      return toApiSnapshot(state);
    } catch (error) {
      if (String(error).includes("POSITION_NOT_FOUND")) {
        return reply.code(404).send({ error: "POSITION_NOT_FOUND" });
      }
      throw error;
    }
  });

  app.post("/api/copilot/cue-card/stream", async (request, reply) => {
    requireAuth(request);
    const quotaInfo = requireQuota(request, "cue-card");
    const parsed = CueCardBody.safeParse(request.body);
    if (!parsed.success) {
      reply.raw.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": corsOrigin,
      });
      reply.raw.end(JSON.stringify({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      }));
      return;
    }
    const body = parsed.data;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": corsOrigin,
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send("stage", { label: "识别问题", status: "done" });
      send("stage", { label: "检索 JD、简历和问题库", status: "running" });
      send("delta", { text: "已进入本地资料召回..." });
      if (body.enableSearch) send("stage", { label: "联网搜索公司与岗位信息", status: "running" });
      const result = await orchestrator.createCueCard(body);
      const now = nowIso();
      const sessionId = body.sessionId || makeId("live-cue-session");
      const existingSession = body.sessionId ? db.getLiveCueSession(body.sessionId, ownerOf(request)) : undefined;
      const session: LiveCueSessionRecord = {
        id: sessionId,
        positionId: body.positionId ?? existingSession?.positionId ?? "default",
        history: [
          ...(existingSession?.history ?? []),
          {
            id: makeId("live-cue-turn"),
            questionText: body.questionText,
            card: result.card,
            meta: result.meta,
            createdAt: now,
          },
        ],
        createdAt: existingSession?.createdAt ?? now,
        updatedAt: now,
      };
      db.saveLiveCueSession(session, ownerOf(request));
      send("stage", {
        label: body.enableSearch ? "搜索完成，生成提词卡" : "生成提词卡",
        status: result.promptRun.status,
        searchCount: result.searchResults.length,
      });
      send("delta", { text: result.meta.backendStatus === "success" ? "模型已返回结构化提词卡。" : "模型未就绪，保留本地练习模式结果。" });
      send("card", { ...result, sessionId: session.id, history: session.history });
      send("done", { ok: true, quotaUsed: quotaInfo.dailyUsed, quotaRemaining: quotaInfo.remaining });
    } catch (error) {
      send("error", { message: String(error) });
    } finally {
      reply.raw.end();
    }
  });

  app.post("/api/copilot/cue-card/reconstruct", async (request, reply) => {
    requireAuth(request);
    const body = ReconstructCueCardBody.parse(request.body);
    const quotaInfoRc = requireQuota(request, "cue-card-reconstruct");
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": corsOrigin,
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send("stage", { label: "解析反馈", status: "done" });
      send("stage", { label: "重构提词卡", status: "running" });
      const result = await orchestrator.reconstructCueCard({
        questionText: body.questionText,
        positionId: body.positionId,
        feedback: body.feedback,
        originalCard: body.originalCard as unknown as AnswerCueCard,
      });
      send("stage", { label: "重构提词卡", status: result.promptRun.status });
      send("card", result);
      send("done", { ok: true, quotaUsed: quotaInfoRc.dailyUsed, quotaRemaining: quotaInfoRc.remaining });
    } catch (error) {
      send("error", { message: String(error) });
    } finally {
      reply.raw.end();
    }
  });

  app.post("/api/copilot/follow-up", async (request) => {
    requireAuth(request);
    requireQuota(request, "follow-up");
    const body = FollowUpBody.parse(request.body);
    const result = await orchestrator.createFollowUp(body.transcript, body.positionId);
    return { question: result.question, backendStatus: result.meta.backendStatus, meta: result.meta };
  });

  app.post("/api/mock/session", async (request) => {
    requireAuth(request);
    requireQuota(request, "mock-session");
    const body = z.object({ positionId: z.string().optional(), config: z.record(z.string(), z.unknown()).optional() }).parse(request.body ?? {});
    const result = await orchestrator.createMockSession(body.positionId, body.config);
    return {
      sessionId: result.sessionId,
      question: result.question,
      backendStatus: result.meta.backendStatus,
      questionSource: result.questionSource,
      meta: result.meta,
      conversationHistory: result.conversationHistory,
    };
  });

  app.post<{ Params: { id: string } }>("/api/mock/session/:id/answer", async (request, reply) => {
    requireAuth(request);
    requireQuota(request, "mock-answer");
    const parsed = MockAnswerBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    const body = parsed.data;
    const result = await orchestrator.answerMockSession(request.params.id, body.positionId, body.questionId, body.answer, body.transcript);
    return {
      record: result.record,
      followUp: result.followUp,
      decision: result.decision,
      backendStatus: result.meta.backendStatus,
      meta: result.meta,
      conversationHistory: result.conversationHistory,
    };
  });

  app.post<{ Params: { id: string } }>("/api/mock/session/:id/complete", async (request) => {
    orchestrator.completeMockSession(request.params.id);
    return { ok: true };
  });

  app.post("/api/records", async (request) => {
    requireAuth(request);
    const record = request.body as InterviewRecord;
    orchestrator.saveInterviewRecord(record);
    return { record, records: db.listRecords(ownerOf(request)) };
  });

  app.post("/api/resume/ai", async (request) => {
    requireAuth(request);
    requireQuota(request, "resume-ai");
    const body = ResumeAiBody.parse(request.body);
    return orchestrator.runResumeAi(body);
  });

  app.post("/api/profile/highlights", async (request) => {
    requireAuth(request);
    requireQuota(request, "profile-highlights");
    const body = ProfileHighlightsBody.parse(request.body);
    return orchestrator.generateProfileHighlights(body);
  });

  app.post("/api/rag/reindex", async (request) => {
    requireAuth(request);
    const state = db.getState(request.session?.userId);
    state.positions.forEach((position) => {
      orchestrator.updatePositionMaterials(position.id, position.materials);
      orchestrator.updatePositionQuestions(position.id, position.questions);
    });
    orchestrator.updateProfile({
      displayName: state.profile.displayName,
      resumeText: state.profile.resumeText,
      evidenceLibrary: state.profile.evidenceLibrary,
      highlights: state.profile.highlights,
    });
    state.records.forEach((record) => orchestrator.saveInterviewRecord(record));
    return { ok: true };
  });

  app.get("/api/records", async (request) => {
    return { records: db.listRecords(ownerOf(request)) };
  });

  app.get<{ Params: { id: string } }>("/api/records/:id", async (request, reply) => {
    const session = requireAuth(request);
    const record = db.getRecord(request.params.id, session.userId);
    if (!record) return reply.code(404).send({ error: "RECORD_NOT_FOUND" });
    return { record };
  });

  app.post("/api/search", async (request) => {
    const body = SearchBody.parse(request.body);
    const results = await orchestrator.search(body.query);
    return { results };
  });

  app.post("/api/export", async (request) => {
    const state = db.getState(ownerOf(request));
    return toClientAppState(state, {
      activePositionId: state.positions[0]?.id,
    });
  });

  app.post("/api/import", async (request, reply) => {
    const session = requireAuth(request);
    const body = request.body as Partial<AppState>;
    if (!body.profile || !Array.isArray(body.positions)) {
      return reply.code(400).send({ error: "INVALID_IMPORT" });
    }
    const state: BackendState = {
      profile: body.profile,
      positions: body.positions,
      records: Array.isArray(body.interviewRecords) ? body.interviewRecords : [],
      journeyState: "ready",
    };
    db.saveState(state, session.userId);
    state.records.forEach((record) => db.saveRecord(record, session.userId));
    const nextState = toClientAppState(state, {
      activePositionId: body.activePositionId,
      activeRecordId: body.activeRecordId,
    });
    const warnings: string[] = [];
    if (body.activePositionId && nextState.activePositionId !== body.activePositionId) {
      warnings.push("备份中的当前岗位引用无效，已自动切换到首个岗位。");
    }
    if (body.activeRecordId && nextState.activeRecordId !== body.activeRecordId) {
      warnings.push("备份中的当前记录引用无效，已自动切换到首条记录。");
    }
    return {
      state: nextState,
      status: warnings.length ? "partial" : "success",
      warnings,
    };
  });

  app.addHook("onClose", async () => {
    db.db?.close();
  });

  if (existsSync(DIST_INDEX)) {
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      const pathname = request.url === "/" ? "/index.html" : request.url;
      const assetPath = resolve(DIST_DIR, `.${pathname}`);
      const safePath = assetPath.startsWith(DIST_DIR) && existsSync(assetPath) ? assetPath : DIST_INDEX;
      reply.header("Content-Type", contentTypeFor(safePath));
      return reply.send(createReadStream(safePath));
    });
  }

  return app;
}

function toClientAppState(
  state: BackendState,
  options?: {
    activePositionId?: string;
    activeRecordId?: string;
  },
): AppState {
  const activePositionId =
    state.positions.some((item) => item.id === options?.activePositionId) ? options?.activePositionId ?? "" : state.positions[0]?.id ?? "";
  const activeRecordId =
    state.records.some((item) => item.id === options?.activeRecordId) ? options?.activeRecordId ?? "" : state.records[0]?.id ?? "";
  return {
    profile: state.profile,
    positions: state.positions,
    activePositionId,
    interviewRecords: state.records,
    activeRecordId,
    aiMode: true,
    journeyState: state.journeyState ?? "guest",
  };
}

export function resolveListenOptions(): { host: string; port: number } {
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8897);
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  return { host, port };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { host, port } = resolveListenOptions();
  const app = buildServer();
  app.listen({ host, port }).then(() => {
    console.log(`yinpinjianting server listening on http://${host}:${port}`);
  });
}
