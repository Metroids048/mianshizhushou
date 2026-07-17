import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiMessage, AiProvider } from "./ai/provider";
import { LocalFallbackProvider } from "./ai/provider";
import { resetAudioBridgeState } from "./audioBridge";
import { createDb } from "./db";
import { createAuthService } from "./domains/auth/auth.service";
import { buildServer, resolveListenOptions } from "./index";
import { createRagRuntime } from "./rag";
import { resetRateLimits } from "./security";
import { createInitialAppState } from "../src/lib/interviewEngine";

const tempDirs: string[] = [];
const apps: FastifyInstance[] = [];
const originalMailOutboxPath = process.env.MAIL_OUTBOX_PATH;
const originalMailOutboxLogPath = process.env.MAIL_OUTBOX_LOG_PATH;
const originalAsrProvider = process.env.ASR_PROVIDER;
const originalXfyunAppId = process.env.XFYUN_RTASR_APP_ID;
const originalXfyunApiKey = process.env.XFYUN_RTASR_API_KEY;
const originalJwtSecret = process.env.JWT_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

function testDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-job-server-"));
  tempDirs.push(dir);
  process.env.MAIL_OUTBOX_PATH = join(dir, "mail-outbox.json");
  process.env.MAIL_OUTBOX_LOG_PATH = join(dir, "mail-outbox.log");
  return join(dir, "test.sqlite");
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  if (originalMailOutboxPath === undefined) delete process.env.MAIL_OUTBOX_PATH;
  else process.env.MAIL_OUTBOX_PATH = originalMailOutboxPath;
  if (originalMailOutboxLogPath === undefined) delete process.env.MAIL_OUTBOX_LOG_PATH;
  else process.env.MAIL_OUTBOX_LOG_PATH = originalMailOutboxLogPath;
  if (originalAsrProvider === undefined) delete process.env.ASR_PROVIDER;
  else process.env.ASR_PROVIDER = originalAsrProvider;
  if (originalXfyunAppId === undefined) delete process.env.XFYUN_RTASR_APP_ID;
  else process.env.XFYUN_RTASR_APP_ID = originalXfyunAppId;
  if (originalXfyunApiKey === undefined) delete process.env.XFYUN_RTASR_API_KEY;
  else process.env.XFYUN_RTASR_API_KEY = originalXfyunApiKey;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  resetRateLimits();
  resetAudioBridgeState();
});

function testApp(dbPath = testDbPath()): FastifyInstance {
  const app = buildServer({ dbPath, llmClient: new LocalFallbackProvider() });
  apps.push(app);
  return app;
}

function readSseEvent<T>(body: string, event: string): T {
  const match = body.match(new RegExp(`event: ${event}\\ndata: ([^\\n]+)`));
  if (!match) throw new Error(`Missing SSE event: ${event}`);
  return JSON.parse(match[1]) as T;
}

class CapturingProvider implements AiProvider {
  model = "capturing-provider";
  calls: Array<{ messages: AiMessage[]; signal?: AbortSignal }> = [];

  async chatJson<T>(messages: AiMessage[], fallback: T, options?: { signal?: AbortSignal }): Promise<{ data: T; status: "fallback"; raw: string }> {
    this.calls.push({ messages, signal: options?.signal });
    return { data: fallback, status: "fallback", raw: "captured" };
  }
}

async function registerAndLogin(app: FastifyInstance, phone: string, displayName?: string): Promise<{ token: string; userId: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: displayName ? { phone, password: "Password123", displayName } : { phone, password: "Password123" },
  });
  const body = response.json();
  return {
    token: body.tokens.accessToken as string,
    userId: body.user.id as string,
  };
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function closeTestApp(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function readWebSocketEvents(url: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events: Array<Record<string, unknown>> = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("ASR websocket test timed out"));
    }, 1500);
    ws.on("message", (raw) => {
      events.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(events);
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function readWebSocketOutcome(url: string): Promise<{ code: number; reason: string; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: Array<Record<string, unknown>> = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("websocket test timed out"));
    }, 1500);
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    ws.on("close", (code, reasonBuf) => {
      clearTimeout(timeout);
      resolve({ code, reason: reasonBuf?.toString() ?? "", messages });
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function readSseEventsUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const deadline = Date.now() + 2500;

  while (Date.now() < deadline) {
    const timeout = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
      setTimeout(() => reject(new Error("sse read timeout")), Math.max(1, deadline - Date.now()));
    });
    const { value, done } = await Promise.race([reader.read(), timeout]);
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataText = block.match(/^data:\s*(.+)$/m)?.[1];
        if (!dataText) continue;
        const event = JSON.parse(dataText) as Record<string, unknown>;
        events.push(event);
        if (predicate(event)) return events;
      }
    }
    if (done) break;
  }
  throw new Error(`SSE predicate not reached: ${JSON.stringify(events)}`);
}

describe("local backend API", () => {
  it("ASR websocket reports ASR_NOT_CONFIGURED when XFYUN keys are absent", async () => {
    delete process.env.XFYUN_RTASR_APP_ID;
    delete process.env.XFYUN_RTASR_API_KEY;
    process.env.ASR_PROVIDER = "xfyun";
    const app = testApp();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");

    const events = await readWebSocketEvents(`ws://127.0.0.1:${address.port}/api/asr/xfyun/stream`);

    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "ASR_NOT_CONFIGURED" }));
  });

  it("uses platform port and all-interface host in production listen options", () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldPort = process.env.PORT;
    const oldServerPort = process.env.SERVER_PORT;
    const oldHost = process.env.HOST;
    process.env.NODE_ENV = "production";
    process.env.PORT = "9456";
    process.env.SERVER_PORT = "8787";
    delete process.env.HOST;

    try {
      expect(resolveListenOptions()).toEqual({ host: "0.0.0.0", port: 9456 });
    } finally {
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNodeEnv;
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldServerPort === undefined) delete process.env.SERVER_PORT;
      else process.env.SERVER_PORT = oldServerPort;
      if (oldHost === undefined) delete process.env.HOST;
      else process.env.HOST = oldHost;
    }
  });

  it("keeps local env files out of the Docker build context", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("!.env.example");
  });

  it("analyzes a JD and returns persisted position context", async () => {
    const app = testApp();
    const { token } = await registerAndLogin(app, "13800138140", "岗位分析用户");
    const response = await app.inject({
      method: "POST",
      url: "/api/positions/analyze",
      headers: bearer(token),
      payload: { jobText: "公司：测试科技\n岗位：AI 产品运营\n负责用户访谈、SQL 数据分析和增长复盘。" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.positions[0].questions.length).toBeGreaterThan(0);
    expect(body.activePositionId).toBeTruthy();
  });

  it("streams cue-card stages and a final card with local fallback when AI is not configured", async () => {
    const app = testApp();
    const { token } = await registerAndLogin(app, "13800138141", "提词卡用户");
    const response = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: bearer(token),
      payload: { questionText: "请介绍一个最能证明你适合岗位的项目", source: "live", enableSearch: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: stage");
    expect(response.body).toContain("event: delta");
    expect(response.body).toContain("event: card");
    expect(response.body).toContain("openingLine");
  });

  it("uses one budgeted model call for cue-card generation even when search is enabled", async () => {
    const provider = new CapturingProvider();
    const app = buildServer({ dbPath: testDbPath(), llmClient: provider });
    apps.push(app);
    const { token } = await registerAndLogin(app, "13800138142", "搜索提词用户");

    const response = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: bearer(token),
      payload: { questionText: "请结合最新行业趋势介绍你的增长项目", source: "live", enableSearch: true },
    });

    expect(response.statusCode).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(provider.calls[0].messages.at(-1)?.content).toContain("searchResults");
  });

  it("persists live cue-card history by session id", async () => {
    const app = testApp();
    const { token } = await registerAndLogin(app, "13800138130", "实时助手用户");
    const first = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: { authorization: `Bearer ${token}` },
      payload: { questionText: "请介绍一个增长项目", source: "live", enableSearch: false },
    });
    const firstCard = readSseEvent<{ sessionId: string; history: unknown[] }>(first.body, "card");

    const second = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: firstCard.sessionId, questionText: "这个项目最大的难点是什么", source: "live", enableSearch: false },
    });
    const secondCard = readSseEvent<{ sessionId: string; history: Array<{ questionText: string; card: unknown; meta: unknown }> }>(second.body, "card");

    expect(firstCard.sessionId).toBeTruthy();
    expect(secondCard.sessionId).toBe(firstCard.sessionId);
    expect(secondCard.history).toHaveLength(2);
    expect(secondCard.history.map((item) => item.questionText)).toEqual(["请介绍一个增长项目", "这个项目最大的难点是什么"]);
    expect(secondCard.history[0].card).toBeTruthy();
    expect(secondCard.history[0].meta).toBeTruthy();
  });

  it("does not cache fallback cue-card results as model success", async () => {
    const provider = new CapturingProvider();
    const app = buildServer({ dbPath: testDbPath(), llmClient: provider });
    apps.push(app);
    const { token } = await registerAndLogin(app, "13800138131", "缓存回归用户");

    const payload = { questionText: "请介绍一个增长项目", source: "live", enableSearch: false };
    const first = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: bearer(token),
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: bearer(token),
      payload,
    });
    const firstCard = readSseEvent<{ promptRun: { status: string }; meta: { backendStatus: string } }>(first.body, "card");
    const secondCard = readSseEvent<{ promptRun: { status: string }; meta: { backendStatus: string } }>(second.body, "card");

    expect(firstCard.promptRun.status).toBe("fallback");
    expect(secondCard.promptRun.status).toBe("fallback");
    expect(secondCard.meta.backendStatus).toBe("fallback");
    expect(provider.calls).toHaveLength(2);
  });

  it("deletes live cue-card sessions with position artifacts", async () => {
    const db = createDb(testDbPath());
    db.saveLiveCueSession({
      id: "live-session-delete",
      positionId: "position-delete",
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, "user-delete");

    db.deletePositionArtifacts("position-delete", "user-delete", "user:user-delete");

    expect(db.getLiveCueSession("live-session-delete", "user-delete")).toBeUndefined();
    db.db?.close();
  });

  it("keeps search explicit when provider credentials are missing", async () => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "Final Round AI interview copilot" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].provider).toBe("disabled");
  });

  it("drives mock answers through the backend session and returns local practice metadata", async () => {
    const app = testApp();
    const { token } = await registerAndLogin(app, "13800138100", "Mock 用户");
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { stage: "上级", difficulty: "压力面", submitMode: "manual" } },
    });
    const session = sessionResponse.json();

    const answerResponse = await app.inject({
      method: "POST",
      url: `/api/mock/session/${session.sessionId}/answer`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answer: "我负责过一个校园增长项目，先做用户访谈，再用 SQL 分析转化漏斗，最后把首单转化率从 12% 提升到 19%。",
        transcript: [
          { role: "interviewer", text: session.question },
          { role: "candidate", text: "我负责过一个校园增长项目，首单转化率从 12% 提升到 19%。" },
        ],
      },
    });

    expect(answerResponse.statusCode).toBe(200);
    const body = answerResponse.json();
    expect(body.backendStatus).toBe("fallback");
    expect(body.decision.type).toMatch(/followup|next/);
    expect(body.conversationHistory.length).toBeGreaterThanOrEqual(3);
    expect(body.record.report.structuredDimensions.length).toBeGreaterThan(0);
    expect(body.record.questionResults[0].answer).toContain("12%");
  });

  it("keeps mock records consistent across state, records, export and service restart in file fallback mode", async () => {
    const dbPath = testDbPath();
    const app = testApp(dbPath);
    const { token } = await registerAndLogin(app, "13800138101", "持久化用户");

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { stage: "上级", difficulty: "压力面", submitMode: "manual" } },
    });
    const session = sessionResponse.json();

    const answerResponse = await app.inject({
      method: "POST",
      url: `/api/mock/session/${session.sessionId}/answer`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answer: "我负责一个增长项目，通过漏斗分析和补贴实验，把首单转化率从 12% 提升到 19%。",
        transcript: [
          { role: "interviewer", text: session.question },
          { role: "candidate", text: "我负责一个增长项目，通过漏斗分析和补贴实验，把首单转化率从 12% 提升到 19%。" },
        ],
      },
    });

    expect(answerResponse.statusCode).toBe(200);
    const recordId = answerResponse.json().record.id as string;

    const authHeaders = { authorization: `Bearer ${token}` };
    const stateResponse = await app.inject({ method: "GET", url: "/api/state", headers: authHeaders });
    const recordsResponse = await app.inject({ method: "GET", url: "/api/records", headers: authHeaders });
    const exportResponse = await app.inject({ method: "POST", url: "/api/export", headers: authHeaders });

    expect(stateResponse.json().records).toHaveLength(1);
    expect(recordsResponse.json().records).toHaveLength(1);
    expect(exportResponse.json().interviewRecords).toHaveLength(1);
    expect(stateResponse.json().records[0].id).toBe(recordId);
    expect(recordsResponse.json().records[0].id).toBe(recordId);
    expect(exportResponse.json().interviewRecords[0].id).toBe(recordId);

    await closeTestApp(app);

    const restarted = testApp(dbPath);
    const restartedState = await restarted.inject({ method: "GET", url: "/api/state", headers: authHeaders });
    const restartedExport = await restarted.inject({ method: "POST", url: "/api/export", headers: authHeaders });

    expect(restartedState.json().records).toHaveLength(1);
    expect(restartedExport.json().interviewRecords).toHaveLength(1);
    expect(restartedState.json().records[0].id).toBe(recordId);
    expect(restartedExport.json().interviewRecords[0].id).toBe(recordId);

  });

  it("returns a safe blank state for guests without exposing persisted user data", async () => {
    const app = testApp();
    const { token } = await registerAndLogin(app, "13800138104", "游客隔离用户");

    await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { rawJdText: "公司：测试科技\n岗位：产品经理\n负责增长分析与面试准备。" },
    });

    const guestState = await app.inject({ method: "GET", url: "/api/state" });
    expect(guestState.statusCode).toBe(200);
    expect(guestState.json().journeyState).toBe("guest");
    expect(Array.isArray(guestState.json().records)).toBe(true);
    expect(guestState.json().records).toHaveLength(0);

    const userState = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(userState.json().positions.length).toBeGreaterThan(0);
  });

  it("isolates records and mock sessions between different authenticated users", async () => {
    const app = testApp();
    const userA = await registerAndLogin(app, "13800138105", "用户A");
    const userB = await registerAndLogin(app, "13800138106", "用户B");

    const intakeA = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { rawJdText: "公司：A公司\n岗位：产品经理\n负责增长。" },
    });
    const positionIdA = intakeA.json().positions[0].id as string;

    const mockA = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { positionId: positionIdA, config: { stage: "上级", difficulty: "正常", submitMode: "manual" } },
    });
    const sessionIdA = mockA.json().sessionId as string;

    const answerA = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionIdA}/answer`,
      headers: { authorization: `Bearer ${userA.token}` },
      payload: {
        positionId: positionIdA,
        answer: "我负责增长项目，通过漏斗分析把转化率从 12% 提升到 19%。",
        transcript: [
          { role: "interviewer", text: mockA.json().question as string },
          { role: "candidate", text: "我负责增长项目，通过漏斗分析把转化率从 12% 提升到 19%。" },
        ],
      },
    });
    expect(answerA.statusCode).toBe(200);
    const recordIdA = answerA.json().record.id as string;

    const recordsA = await app.inject({ method: "GET", url: "/api/records", headers: { authorization: `Bearer ${userA.token}` } });
    const recordsB = await app.inject({ method: "GET", url: "/api/records", headers: { authorization: `Bearer ${userB.token}` } });
    expect(recordsA.json().records).toHaveLength(1);
    expect(recordsB.json().records).toHaveLength(0);

    const recordB = await app.inject({
      method: "GET",
      url: `/api/records/${recordIdA}`,
      headers: { authorization: `Bearer ${userB.token}` },
    });
    expect(recordB.statusCode).toBe(404);

    const sessionB = await app.inject({
      method: "GET",
      url: `/api/positions/${positionIdA}/mock-session`,
      headers: { authorization: `Bearer ${userB.token}` },
    });
    expect(sessionB.statusCode).toBe(404);
  });

  it("rejects guest intake and AI endpoints without authentication", async () => {
    const app = testApp();

    const guestIntake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { "x-guest-id": "guest-one" },
      payload: { rawJdText: "公司：访客一公司\n岗位：数据分析\n负责报表。" },
    });
    expect(guestIntake.statusCode).toBe(401);

    const guestCueCard = await app.inject({
      method: "POST",
      url: "/api/copilot/cue-card/stream",
      headers: { "x-guest-id": "guest-one" },
      payload: { questionText: "请介绍项目", source: "live", enableSearch: false },
    });
    expect(guestCueCard.statusCode).toBe(401);

    const guestQuota = await app.inject({ method: "GET", url: "/api/quota", headers: { "x-guest-id": "guest-one" } });
    expect(guestQuota.statusCode).toBe(401);
  });

  it("uses a server-issued cookie for guests without x-guest-id instead of a shared data bucket", async () => {
    const app = testApp();

    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      payload: { rawJdText: "公司：无痕访客公司\n岗位：产品经理\n负责访谈和复盘。" },
    });
    expect(intake.statusCode).toBe(401);

    const freshAnonymous = await app.inject({ method: "GET", url: "/api/state" });
    expect(freshAnonymous.statusCode).toBe(200);
    expect((freshAnonymous.json().positions as Array<{ id: string }>)).toHaveLength(0);
  });

  it("keeps profile RAG documents scoped per owner", () => {
    const db = createDb(testDbPath());
    try {
      let ownerKey = "user:A";
      const rag = createRagRuntime(db, () => ownerKey, () => ownerKey);

      const profileA = createInitialAppState().profile;
      profileA.displayName = "Alice";
      profileA.highlights = ["用户增长 RAG 项目"];
      rag.reindexProfile(profileA);
      expect(
        db.db
          ?.prepare("select content from document_chunks where owner_key = ?")
          .all("user:A")
          .some((item) => String((item as { content?: string }).content ?? "").includes("用户增长")),
      ).toBe(true);

      ownerKey = "user:B";
      const profileB = createInitialAppState().profile;
      profileB.displayName = "Bob";
      profileB.highlights = ["推荐系统 项目"];
      rag.reindexProfile(profileB);

      ownerKey = "user:A";
      expect(
        db.db
          ?.prepare("select content from document_chunks where owner_key = ?")
          .all("user:A")
          .some((item) => String((item as { content?: string }).content ?? "").includes("推荐系统")),
      ).toBe(false);
      ownerKey = "user:B";
      expect(
        db.db
          ?.prepare("select content from document_chunks where owner_key = ?")
          .all("user:B")
          .some((item) => String((item as { content?: string }).content ?? "").includes("推荐系统")),
      ).toBe(true);
    } finally {
      db.db?.close();
    }
  });

  it("indexes materials and questions into RAG, and resume AI returns evidence trace", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138143", "RAG 用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: bearer(token),
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const positionId = intake.json().positions[0].id as string;

    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/materials`,
      headers: bearer(token),
      payload: {
        materials: [
          {
            id: "material-1",
            kind: "project",
            source: "manual",
            title: "RAG 面试助手项目",
            detail: "我负责把本地项目资料、简历和 JD 做 FTS 检索召回，用于实时提词卡。",
            summary: "项目资料：RAG + 实时助手",
            keywords: ["RAG", "FTS5", "提词卡"],
            tags: ["重点项目"],
            linkedQuestionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });

    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/questions`,
      headers: bearer(token),
      payload: {
        questions: [
          {
            id: "question-1",
            category: "项目深挖",
            question: "你怎么做 RAG 召回排序？",
            reason: "用户手动保存问题",
            evidenceIds: [],
            difficulty: "中等",
            source: "manual",
            priority: true,
            notes: "重点题",
            cueCardIds: [],
            tags: ["用户保存"],
          },
        ],
      },
    });

    const resumeAi = await app.inject({
      method: "POST",
      url: "/api/resume/ai",
      headers: bearer(token),
      payload: {
        positionId,
        action: "match",
        sectionId: "projects",
        sectionTitle: "项目经历",
        currentText: "做过一个实时面试助手。",
        fullResumeText: "项目经历\n做过一个实时面试助手。",
        userMessage: "请按岗位做匹配分析",
      },
    });

    expect(resumeAi.statusCode).toBe(200);
    const body = resumeAi.json();
    expect(body.suggestion).toContain("项目经历");
    expect(Array.isArray(body.evidenceTrace)).toBe(true);
    expect(body.meta.backendStatus).toBe("fallback");
    await app.close();
  });

  it("returns structured import results and warnings when active pointers are invalid", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138102", "导入用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const snapshot = intake.json();
    const stateToImport = {
      profile: snapshot.profile,
      positions: snapshot.positions,
      activePositionId: "missing-position",
      interviewRecords: [],
      activeRecordId: "missing-record",
      aiMode: true,
      journeyState: "ready" as const,
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: { authorization: `Bearer ${token}` },
      payload: stateToImport,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("partial");
    expect(body.state.activePositionId).toBe(snapshot.positions[0].id);
    expect(body.warnings.length).toBeGreaterThan(0);
    await app.close();
  });

  it("rejects invalid import payloads with a 400 response", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138103", "错误导入用户");
    const response = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: { authorization: `Bearer ${token}` },
      payload: { foo: "bar" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_IMPORT");
    await app.close();
  });

  it("returns structured full-resume fallback blocks that the frontend can map back into sections", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138144", "整份简历用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: bearer(token),
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const positionId = intake.json().positions[0].id as string;

    const resumeAi = await app.inject({
      method: "POST",
      url: "/api/resume/ai",
      headers: bearer(token),
      payload: {
        positionId,
        action: "full",
        sectionId: "highlights",
        sectionTitle: "亮点摘要",
        currentText: "项目经历\n做过一个实时面试助手。",
        fullResumeText: "亮点摘要\n原亮点\n\n项目经历\n做过一个实时面试助手。",
        userMessage: "请优化整份简历",
      },
    });

    expect(resumeAi.statusCode).toBe(200);
    const body = resumeAi.json();
    expect(body.applyTarget).toBe("full");
    expect(body.suggestion).toContain("亮点摘要");
    expect(body.suggestion).toContain("项目经历");
    expect(body.suggestion).toContain("技能与工具");
    expect(body.suggestion).toContain("待补强");
    expect(body.meta.backendStatus).toBe("fallback");
    await app.close();
  });

  it("persists interview preferences on the current position", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138107", "偏好设置用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const positionId = intake.json().positions[0].id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/preferences`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        interviewerRole: "业务负责人",
        difficulty: "压力面",
        interviewerGender: "男",
        submitMode: "auto",
        style: "pressure",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.position.interviewPreferences).toMatchObject({
      interviewerRole: "业务负责人",
      difficulty: "压力面",
      interviewerGender: "男",
      submitMode: "auto",
      style: "pressure",
    });
    expect(body.position.intake.configuredInterview).toBe(true);
    await app.close();
  });

  it("returns the latest active mock session, completes it, and stops restoring it afterward", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138108", "恢复会话用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const positionId = intake.json().positions[0].id as string;

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: { authorization: `Bearer ${token}` },
      payload: { positionId, config: { stage: "上级", difficulty: "压力面", submitMode: "manual" } },
    });
    const sessionId = sessionResponse.json().sessionId as string;

    const latest = await app.inject({
      method: "GET",
      url: `/api/positions/${positionId}/mock-session`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().session.id).toBe(sessionId);
    expect(latest.json().session.completedAt).toBeUndefined();

    const complete = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionId}/complete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().ok).toBe(true);

    const afterComplete = await app.inject({
      method: "GET",
      url: `/api/positions/${positionId}/mock-session`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterComplete.statusCode).toBe(404);
    expect(afterComplete.json().error).toBe("MOCK_SESSION_NOT_FOUND");
    await app.close();
  });

  it("deletes a position and cascades its records, materials, questions and mock sessions", async () => {
    const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
    const { token } = await registerAndLogin(app, "13800138109", "删除岗位用户");
    const intake = await app.inject({
      method: "POST",
      url: "/api/positions/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { rawJdText: "公司：北极星科技\n岗位：AI 产品经理\n负责面试产品、RAG、增长分析。" },
    });
    const snapshot = intake.json();
    const positionId = snapshot.positions[0].id as string;

    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/materials`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        materials: [
          {
            id: "material-1",
            kind: "upload",
            source: "upload",
            title: "项目资料",
            detail: "一份真实项目资料",
            summary: "一份真实项目资料",
            keywords: ["项目"],
            tags: ["上传资料"],
            linkedQuestionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });

    await app.inject({
      method: "POST",
      url: `/api/positions/${positionId}/questions`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        questions: [
          {
            id: "question-1",
            category: "项目深挖",
            question: "你怎么做 RAG 召回？",
            reason: "用户手动保存问题",
            evidenceIds: [],
            difficulty: "中等",
            source: "manual",
            priority: true,
            notes: "重点题",
            answer: "",
            cueCardIds: [],
            tags: ["用户保存"],
          },
        ],
      },
    });

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/mock/session",
      headers: { authorization: `Bearer ${token}` },
      payload: { positionId, config: { stage: "上级", difficulty: "正常", submitMode: "manual" } },
    });
    const sessionBody = sessionResponse.json();

    const answerResponse = await app.inject({
      method: "POST",
      url: `/api/mock/session/${sessionBody.sessionId}/answer`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        positionId,
        answer: "我负责一套面试助手项目，做了 RAG 检索和回归验证。",
        transcript: [
          { role: "interviewer", text: sessionBody.question },
          { role: "candidate", text: "我负责一套面试助手项目，做了 RAG 检索和回归验证。" },
        ],
      },
    });
    expect(answerResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/positions/${positionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const state = deleteResponse.json();
    expect(state.positions.some((position: { id: string }) => position.id === positionId)).toBe(false);
    expect(state.records.some((record: { positionId: string }) => record.positionId === positionId)).toBe(false);

    const records = await app.inject({ method: "GET", url: "/api/records", headers: { authorization: `Bearer ${token}` } });
    expect(records.json().records.some((record: { positionId: string }) => record.positionId === positionId)).toBe(false);

    const context = await app.inject({ method: "GET", url: `/api/positions/${positionId}/context`, headers: { authorization: `Bearer ${token}` } });
    expect(context.statusCode).toBe(404);

    const latestMockSession = await app.inject({ method: "GET", url: `/api/positions/${positionId}/mock-session`, headers: { authorization: `Bearer ${token}` } });
    expect(latestMockSession.statusCode).toBe(404);
    await app.close();
  });

  describe("auth API", () => {
    it("registers a new user with phone and password", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138001", password: "Password123", displayName: "测试用户" },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.user.phone).toBe("13800138001");
      expect(body.user.displayName).toBe("测试用户");
      expect(body.tokens.accessToken).toBeTruthy();
      await app.close();
    });

    it("registers without requiring consent", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138002", password: "Password123" },
      });

      expect(response.statusCode).toBe(201);
      await app.close();
    });

    it("reports the same 30-day expiry that the JWT uses", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const before = Date.now();
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138003", password: "Password123" },
      });

      expect(response.statusCode).toBe(201);
      const expiresAt = new Date(response.json().tokens.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(expiresAt - before).toBeLessThan(31 * 24 * 60 * 60 * 1000);
      await app.close();
    });

    it("treats an empty JWT_SECRET placeholder as unconfigured in local mode", async () => {
      process.env.JWT_SECRET = "";
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138023", password: "Password123" },
      });

      expect(response.statusCode).toBe(201);
      const token = response.json().tokens.accessToken as string;
      expect(token).toBeTruthy();

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(session.statusCode).toBe(200);
      await app.close();
    });

    it("treats a whitespace JWT_SECRET as unconfigured in local mode", async () => {
      process.env.JWT_SECRET = "   ";
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138024", password: "Password123" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().tokens.accessToken).toBeTruthy();
      await app.close();
    });

    it("rejects production startup when JWT_SECRET is empty", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "";

      expect(() => createAuthService({} as never, {} as never)).toThrow(/JWT_SECRET/);
    });

    it("uses a configured JWT_SECRET for registration, login, and session validation", async () => {
      process.env.JWT_SECRET = "test-secret-with-enough-entropy";
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const register = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138025", password: "Password123" },
      });
      expect(register.statusCode).toBe(201);

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { phone: "13800138025", password: "Password123" },
      });
      expect(login.statusCode).toBe(200);
      const token = login.json().tokens.accessToken as string;

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json().phone).toBe("13800138025");
      await app.close();
    });

    it("rejects duplicate phone registration", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138003", password: "Password123" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138003", password: "Password123" },
      });

      expect(response.statusCode).toBe(409);
      await app.close();
    });

    it("logs in with phone and password", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138004", password: "Password123" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { phone: "13800138004", password: "Password123" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.phone).toBe("13800138004");
      expect(body.tokens.accessToken).toBeTruthy();
      await app.close();
    });

    it("rejects login with wrong password", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138005", password: "Password123" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { phone: "13800138005", password: "WrongPassword123" },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("returns session for valid token", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138006", password: "Password123", displayName: "会话测试" },
      });
      const token = reg.json().tokens.accessToken;

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.userId).toBeTruthy();
      expect(body.displayName).toBe("会话测试");
      await app.close();
    });

    it("rejects session with invalid token", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: "Bearer invalid-token" },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("logout invalidates session", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138007", password: "Password123" },
      });
      const token = reg.json().tokens.accessToken;

      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { authorization: `Bearer ${token}` },
      });

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(session.statusCode).toBe(401);
      await app.close();
    });

    it("merges guest data after registration", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138008", password: "Password123", displayName: "合并测试" },
      });
      const token = reg.json().tokens.accessToken;

      const merge = await app.inject({
        method: "POST",
        url: "/api/auth/merge-guest",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          profile: { displayName: "游客", resumeText: "简历内容", resume: {}, evidenceLibrary: [], highlights: [] },
          positions: [{ id: "guest-pos-1", title: "测试岗", company: "测试公司", jobText: "测试JD" }],
          records: [{ id: "guest-rec-1", positionId: "guest-pos-1", mode: "mock", title: "测试记录" }],
        },
      });

      expect(merge.statusCode).toBe(200);
      expect(merge.json().mergedPositions).toBe(1);
      expect(merge.json().mergedRecords).toBe(1);

      const state = await app.inject({
        method: "GET",
        url: "/api/state",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = state.json();
      expect(body.positions.some((p: { id: string }) => p.id === "guest-pos-1")).toBe(true);

      await app.close();
    });

    it("returns quota info for authenticated users only", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });

      const guestQuota = await app.inject({ method: "GET", url: "/api/quota" });
      expect(guestQuota.statusCode).toBe(401);

      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138009", password: "Password123" },
      });
      const token = reg.json().tokens.accessToken;

      const userQuota = await app.inject({
        method: "GET",
        url: "/api/quota",
        headers: bearer(token),
      });
      expect(userQuota.statusCode).toBe(200);
      expect(userQuota.json().isGuest).toBe(false);
      expect(userQuota.json().dailyLimit).toBe(20);
      expect(userQuota.json().features.cueCard.limit).toBe(5);
      expect(userQuota.json().features.resume.limit).toBe(5);
      expect(userQuota.json().features.positionAnalyze.limit).toBe(5);

      await app.close();
    });

    it("limits AI quota by feature group without blocking other AI flows", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const { token } = await registerAndLogin(app, "13800138010", "额度用户");

      const quota = await app.inject({
        method: "GET",
        url: "/api/quota",
        headers: { authorization: `Bearer ${token}` },
      });
      const cueLimit = quota.json().features.cueCard.limit as number;

      for (let index = 0; index < cueLimit; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/copilot/cue-card/stream",
          headers: { authorization: `Bearer ${token}` },
          payload: { questionText: `请介绍一个增长项目 ${index}`, source: "live", enableSearch: false },
        });
        expect(response.statusCode).toBe(200);
      }

      const exhaustedCueCard = await app.inject({
        method: "POST",
        url: "/api/copilot/cue-card/stream",
        headers: { authorization: `Bearer ${token}` },
        payload: { questionText: "请再介绍一个增长项目", source: "live", enableSearch: false },
      });
      expect(exhaustedCueCard.statusCode).toBe(429);
      expect(exhaustedCueCard.json().error).toBe("QUOTA_EXCEEDED");
      expect(exhaustedCueCard.json().quota.feature).toBe("cueCard");

      const mockSession = await app.inject({
        method: "POST",
        url: "/api/mock/session",
        headers: { authorization: `Bearer ${token}` },
        payload: { config: { submitMode: "manual" } },
      });
      expect(mockSession.statusCode).toBe(200);
      expect(mockSession.json().backendStatus).toBe("fallback");

      await app.close();
    });

    it("sends verification email, verifies token, and exposes updated session state", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138020", password: "Password123" },
      });
      expect(reg.statusCode).toBe(201);
      const token = reg.json().tokens.accessToken as string;

      const profileUpdate = await app.inject({
        method: "POST",
        url: "/api/account/profile",
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "verify@example.com" },
      });
      expect(profileUpdate.statusCode).toBe(200);

      const outbox = await app.inject({
        method: "GET",
        url: "/api/mail/outbox",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(outbox.statusCode).toBe(200);
      const verifyMail = outbox.json().items.find((item: { template: string }) => item.template === "verifyEmail");
      expect(verifyMail).toBeTruthy();
      const verifyUrl = String(verifyMail.variables.verifyUrl);
      const verifyToken = new URL(verifyUrl).searchParams.get("token");
      expect(verifyToken).toBeTruthy();

      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/auth/email/verify",
        payload: { token: verifyToken },
      });
      expect(verifyRes.statusCode).toBe(200);

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json().emailVerifiedAt).toBeTruthy();
      await app.close();
    });

    it("only exposes the current user's outbox items", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const regA = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138031", password: "Password123" },
      });
      const regB = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138032", password: "Password123" },
      });
      const tokenA = regA.json().tokens.accessToken as string;
      const tokenB = regB.json().tokens.accessToken as string;

      await app.inject({
        method: "POST",
        url: "/api/account/profile",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { email: "owner-a@example.com" },
      });
      await app.inject({
        method: "POST",
        url: "/api/account/profile",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { email: "owner-b@example.com" },
      });

      const outboxA = await app.inject({
        method: "GET",
        url: "/api/mail/outbox",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const outboxB = await app.inject({
        method: "GET",
        url: "/api/mail/outbox",
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect(outboxA.statusCode).toBe(200);
      expect(outboxB.statusCode).toBe(200);
      expect(outboxA.json().items).toHaveLength(1);
      expect(outboxB.json().items).toHaveLength(1);
      expect(outboxA.json().items[0].to).toBe("owner-a@example.com");
      expect(outboxB.json().items[0].to).toBe("owner-b@example.com");

      await app.close();
    });

    it("sends password reset email and resets password successfully", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138021", password: "OldPassword123" },
      });
      const authToken = reg.json().tokens.accessToken as string;

      const profileUpdate = await app.inject({
        method: "POST",
        url: "/api/account/profile",
        headers: { authorization: `Bearer ${authToken}` },
        payload: { email: "reset@example.com" },
      });
      expect(profileUpdate.statusCode).toBe(200);

      const initialOutbox = await app.inject({
        method: "GET",
        url: "/api/mail/outbox",
        headers: { authorization: `Bearer ${authToken}` },
      });
      const verifyMail = initialOutbox.json().items.find((item: { template: string }) => item.template === "verifyEmail");
      const verifyToken = new URL(String(verifyMail.variables.verifyUrl)).searchParams.get("token");
      await app.inject({
        method: "POST",
        url: "/api/auth/email/verify",
        payload: { token: verifyToken },
      });

      const forgot = await app.inject({
        method: "POST",
        url: "/api/auth/password/forgot",
        payload: { email: "reset@example.com" },
      });
      expect(forgot.statusCode).toBe(200);

      const outbox = await app.inject({
        method: "GET",
        url: "/api/mail/outbox",
        headers: { authorization: `Bearer ${authToken}` },
      });
      const resetMail = outbox.json().items.find((item: { template: string }) => item.template === "resetPassword");
      expect(resetMail).toBeTruthy();
      const resetToken = new URL(String(resetMail.variables.resetUrl)).searchParams.get("token");
      expect(resetToken).toBeTruthy();

      const reset = await app.inject({
        method: "POST",
        url: "/api/auth/password/reset",
        payload: { token: resetToken, password: "NewPassword456" },
      });
      expect(reset.statusCode).toBe(200);

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { phone: "13800138021", password: "NewPassword456" },
      });
      expect(login.statusCode).toBe(200);
      await app.close();
    });

    it("warns when JWT_SECRET is not configured", async () => {
      const oldJwtSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      vi.resetModules();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const [{ buildServer: isolatedBuildServer }, { LocalFallbackProvider: IsolatedFallbackProvider }] = await Promise.all([
        import("./index"),
        import("./ai/provider"),
      ]);

      const app = isolatedBuildServer({ dbPath: testDbPath(), llmClient: new IsolatedFallbackProvider() });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("JWT_SECRET"));

      await app.close();
      warn.mockRestore();
      if (oldJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldJwtSecret;
    });

    it("deletes account with DELETE confirmation and invalidates session", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138022", password: "Password123" },
      });
      const token = reg.json().tokens.accessToken as string;

      const deletion = await app.inject({
        method: "DELETE",
        url: "/api/user",
        headers: { authorization: `Bearer ${token}` },
        payload: { confirmationText: "DELETE" },
      });
      expect(deletion.statusCode).toBe(200);

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(session.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("onboarding", () => {
    it("onboarding sets journeyState to ready and creates default position", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138010", password: "Password123", displayName: "测试用户" },
      });
      const token = reg.json().tokens.accessToken;

      const onboardRes = await app.inject({
        method: "POST",
        url: "/api/onboarding",
        headers: { authorization: `Bearer ${token}` },
        payload: { targetRole: "AI 产品经理", city: "北京", experience: "3-5 年", stage: "准备面试" },
      });
      expect(onboardRes.statusCode).toBe(200);
      const body = onboardRes.json();
      expect(body.ok).toBe(true);
      expect(body.position).toBeTruthy();
      expect(body.position.title).toBe("AI 产品经理");
      expect(body.nextStep).toMatch(/intake_jd|import_resume|start_mock/);

      const state = await app.inject({
        method: "GET",
        url: "/api/state",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(state.json().journeyState).toBe("ready");
      expect(state.json().positions.length).toBe(1);

      await app.close();
    });
    it("record save keeps ready journey state", async () => {
      const app = buildServer({ dbPath: testDbPath(), llmClient: new LocalFallbackProvider() });
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { phone: "13800138012", password: "Password123" },
      });
      const token = reg.json().tokens.accessToken;

      await app.inject({
        method: "POST",
        url: "/api/onboarding",
        headers: { authorization: `Bearer ${token}` },
        payload: { targetRole: "测试岗位" },
      });

      const state = await app.inject({
        method: "GET",
        url: "/api/state",
        headers: { authorization: `Bearer ${token}` },
      });
      const positionId = state.json().positions[0].id;

      const recordRes = await app.inject({
        method: "POST",
        url: "/api/records",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          id: "test-record-1",
          positionId,
          mode: "mock",
          title: "首次模拟面试",
          transcript: [{ role: "interviewer", text: "请做自我介绍" }, { role: "candidate", text: "我是测试候选人" }],
          cueCards: [],
          questionIds: [],
          speechMetrics: [],
          report: {
            overallScore: 75,
            dimensions: { completeness: 70, relevance: 80, evidenceStrength: 60, structure: 75, riskControl: 70 },
            summary: "测试报告",
            nextActions: ["复习项目深挖题"],
            source: "local",
          },
          summary: "测试记录",
          createdAt: new Date().toISOString(),
        },
      });
      expect(recordRes.statusCode).toBe(200);

      const finalState = await app.inject({
        method: "GET",
        url: "/api/state",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalState.json().journeyState).toBe("ready");

      await app.close();
    });
  });

  describe("audio bridge", () => {
    it("requires auth to issue a pairing code", async () => {
      const app = testApp();
      const response = await app.inject({ method: "POST", url: "/api/audio-bridge/pair", payload: {} });
      expect(response.statusCode).toBe(401);
    });

    it("issues a 6-digit pairing code that a device can claim for a token", async () => {
      const app = testApp();
      const { token } = await registerAndLogin(app, "13800138201", "音频桥用户");

      const pairRes = await app.inject({
        method: "POST",
        url: "/api/audio-bridge/pair",
        headers: bearer(token),
        payload: { deviceName: "我的电脑" },
      });
      expect(pairRes.statusCode).toBe(200);
      const { pairingCode, expiresAt } = pairRes.json();
      expect(pairingCode).toMatch(/^\d{6}$/);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

      const claimRes = await app.inject({
        method: "POST",
        url: "/api/audio-bridge/claim",
        payload: { pairingCode, deviceName: "我的电脑" },
      });
      expect(claimRes.statusCode).toBe(200);
      const { deviceToken } = claimRes.json();
      expect(typeof deviceToken).toBe("string");
      expect(deviceToken.length).toBeGreaterThan(10);

      const devicesRes = await app.inject({
        method: "GET",
        url: "/api/audio-bridge/devices",
        headers: bearer(token),
      });
      expect(devicesRes.statusCode).toBe(200);
      expect(devicesRes.json().devices).toHaveLength(1);
      expect(devicesRes.json().devices[0].deviceName).toBe("我的电脑");
    });

    it("rejects claiming an invalid or already-used pairing code", async () => {
      const app = testApp();
      const { token } = await registerAndLogin(app, "13800138202", "音频桥用户2");

      const badClaim = await app.inject({
        method: "POST",
        url: "/api/audio-bridge/claim",
        payload: { pairingCode: "000000" },
      });
      expect(badClaim.statusCode).toBe(404);

      const pairRes = await app.inject({
        method: "POST",
        url: "/api/audio-bridge/pair",
        headers: bearer(token),
        payload: {},
      });
      const { pairingCode } = pairRes.json();

      const firstClaim = await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode } });
      expect(firstClaim.statusCode).toBe(200);

      const secondClaim = await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode } });
      expect(secondClaim.statusCode).toBe(404);
    });

    it("expires unused pairing codes after ten minutes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const app = testApp();
        const { token } = await registerAndLogin(app, "13800138207", "过期配对用户");

        const pairRes = await app.inject({ method: "POST", url: "/api/audio-bridge/pair", headers: bearer(token), payload: {} });
        const { pairingCode } = pairRes.json();

        vi.setSystemTime(new Date("2026-01-01T00:10:01.000Z"));
        const claimRes = await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode } });

        expect(claimRes.statusCode).toBe(404);
      } finally {
        vi.useRealTimers();
      }
    });

    it("scopes the device list to its owner and lets the owner revoke a device", async () => {
      const app = testApp();
      const { token: ownerToken } = await registerAndLogin(app, "13800138203", "设备主人");
      const { token: otherToken } = await registerAndLogin(app, "13800138204", "别的用户");

      const pairRes = await app.inject({ method: "POST", url: "/api/audio-bridge/pair", headers: bearer(ownerToken), payload: {} });
      const { pairingCode } = pairRes.json();
      await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode } });

      const otherDevices = await app.inject({ method: "GET", url: "/api/audio-bridge/devices", headers: bearer(otherToken) });
      expect(otherDevices.json().devices).toHaveLength(0);

      const ownerDevices = await app.inject({ method: "GET", url: "/api/audio-bridge/devices", headers: bearer(ownerToken) });
      expect(ownerDevices.json().devices).toHaveLength(1);
      const deviceId = ownerDevices.json().devices[0].id;

      const revokeByOther = await app.inject({ method: "DELETE", url: `/api/audio-bridge/devices/${deviceId}`, headers: bearer(otherToken) });
      expect(revokeByOther.statusCode).toBe(200);
      const stillThere = await app.inject({ method: "GET", url: "/api/audio-bridge/devices", headers: bearer(ownerToken) });
      expect(stillThere.json().devices).toHaveLength(1);

      const revokeByOwner = await app.inject({ method: "DELETE", url: `/api/audio-bridge/devices/${deviceId}`, headers: bearer(ownerToken) });
      expect(revokeByOwner.statusCode).toBe(200);
      const afterRevoke = await app.inject({ method: "GET", url: "/api/audio-bridge/devices", headers: bearer(ownerToken) });
      expect(afterRevoke.json().devices).toHaveLength(0);
    });

    it("requires auth to subscribe to the SSE event stream and sends an initial disconnected status", async () => {
      const app = testApp();
      const unauthorized = await app.inject({ method: "GET", url: "/api/audio-bridge/events" });
      expect(unauthorized.statusCode).toBe(401);

      const { token } = await registerAndLogin(app, "13800138205", "订阅用户");
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");

      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/audio-bridge/events`, {
        headers: bearer(token),
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const chunk = Buffer.from(value ?? new Uint8Array()).toString("utf8");
      controller.abort();
      expect(chunk).toContain("event: bridge_status");
      const status = readSseEvent<{ type: string; connected: boolean }>(chunk, "bridge_status");
      expect(status.connected).toBe(false);
    });

    it("closes the ingest websocket with ASR_NOT_CONFIGURED when device is valid but ASR keys are missing", async () => {
      delete process.env.XFYUN_RTASR_APP_ID;
      delete process.env.XFYUN_RTASR_API_KEY;
      process.env.ASR_PROVIDER = "xfyun";
      const app = testApp();
      const { token } = await registerAndLogin(app, "13800138206", "摄取用户");
      const pairRes = await app.inject({ method: "POST", url: "/api/audio-bridge/pair", headers: bearer(token), payload: {} });
      const claimRes = await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode: pairRes.json().pairingCode } });
      const deviceToken = claimRes.json().deviceToken as string;

      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");

      const outcome = await readWebSocketOutcome(`ws://127.0.0.1:${address.port}/api/audio-bridge/stream?token=${deviceToken}`);
      expect(outcome.code).toBe(1011);
      expect(outcome.reason).toBe("ASR_NOT_CONFIGURED");
    });

    it("streams bridge audio diagnostics and debug ASR final text to the browser event stream", async () => {
      process.env.ASR_PROVIDER = "debug";
      process.env.ASR_DEBUG_TEXT = "请介绍一个你做过的 AI 产品项目";
      const app = testApp();
      const { token } = await registerAndLogin(app, "13800138208", "桥链路闭环用户");
      const pairRes = await app.inject({ method: "POST", url: "/api/audio-bridge/pair", headers: bearer(token), payload: { deviceName: "本机桥" } });
      const claimRes = await app.inject({ method: "POST", url: "/api/audio-bridge/claim", payload: { pairingCode: pairRes.json().pairingCode, deviceName: "本机桥" } });
      const deviceToken = claimRes.json().deviceToken as string;

      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");

      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/audio-bridge/events`, {
        headers: bearer(token),
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();

      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/audio-bridge/stream?token=${deviceToken}`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      ws.send(JSON.stringify({ type: "audio_level", rms: 0.12, peak: 0.42, bytesSent: 32000, sampleRate: 48000, channels: 2 }));
      ws.send(Buffer.alloc(32_000, 1));

      const events = await readSseEventsUntil(reader, (event) => event.type === "final");
      controller.abort();
      ws.close();

      expect(events).toContainEqual(expect.objectContaining({ type: "bridge_status", connected: true, deviceName: "本机桥" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "ready", provider: "debug" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "bridge_audio", rms: 0.12, peak: 0.42 }));
      expect(events).toContainEqual(expect.objectContaining({ type: "final", text: "请介绍一个你做过的 AI 产品项目" }));
    });

    it("rejects the ingest websocket connection when the device token is missing or invalid", async () => {
      const app = testApp();
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");

      const missingToken = await readWebSocketOutcome(`ws://127.0.0.1:${address.port}/api/audio-bridge/stream`);
      expect(missingToken.code).toBe(4401);
      expect(missingToken.reason).toBe("MISSING_DEVICE_TOKEN");

      const invalidToken = await readWebSocketOutcome(`ws://127.0.0.1:${address.port}/api/audio-bridge/stream?token=not-a-real-token`);
      expect(invalidToken.code).toBe(4401);
      expect(invalidToken.reason).toBe("DEVICE_TOKEN_INVALID");
    });

    it("creates a deterministic position for library materials without invoking intake AI", async () => {
      const app = testApp();
      const { token } = await registerAndLogin(app, "13800138209", "资料库用户");

      const created = await app.inject({
        method: "POST",
        url: "/api/positions",
        headers: bearer(token),
        payload: { jobText: "目标岗位 JD 待补充。此岗位仅用于保存项目资料和提词卡历史。" },
      });

      expect(created.statusCode).toBe(200);
      const positionId = created.json().activePositionId as string;
      expect(positionId).toBeTruthy();

      const material = await app.inject({
        method: "POST",
        url: `/api/positions/${positionId}/materials`,
        headers: bearer(token),
        payload: {
          materials: [{
            id: "library-material",
            kind: "project",
            source: "manual",
            title: "项目资料",
            detail: "我负责资料库。",
            summary: "资料库项目",
            keywords: ["资料库"],
            tags: [],
            linkedQuestionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
        },
      });
      expect(material.statusCode).toBe(200);
    });
  });
});
