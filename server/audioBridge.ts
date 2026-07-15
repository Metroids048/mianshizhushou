import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDb } from "./db";
import type { AsrEvent } from "./asr";
import { createAsrRelay } from "./asr";
import { createOneTimeToken, hashOpaqueToken, requireAuth } from "./security";
import { makeId, nowIso, safeJsonParse } from "./utils";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_LENGTH = 6;

type PairingEntry = { userId: string; deviceName: string; expiresAt: number };
type BridgeStatusEvent = { type: "bridge_status"; connected: boolean; deviceName?: string; asrProvider?: string; asrReady?: boolean };
type BridgeAudioEvent = { type: "bridge_audio"; rms: number; peak: number; bytesSent: number; sampleRate?: number; channels?: number };
type BridgeStreamEvent = AsrEvent | BridgeStatusEvent | BridgeAudioEvent;

// 配对码是登录会话临时发放的一次性凭证，用完或过期即失效，无需落库；
// 设备令牌是配对成功后长期持有的重连凭证，必须落库才能在服务重启后仍被识别。
const pairingCodes = new Map<string, PairingEntry>();
const eventSubscribers = new Map<string, Set<(event: BridgeStreamEvent) => void>>();

function generatePairingCode(): string {
  return randomInt(0, 10 ** PAIRING_CODE_LENGTH).toString().padStart(PAIRING_CODE_LENGTH, "0");
}

function pruneExpiredPairingCodes(): void {
  const now = Date.now();
  for (const [code, entry] of pairingCodes) {
    if (entry.expiresAt <= now) pairingCodes.delete(code);
  }
}

function subscribe(userId: string, handler: (event: BridgeStreamEvent) => void): () => void {
  const set = eventSubscribers.get(userId) ?? new Set();
  set.add(handler);
  eventSubscribers.set(userId, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) eventSubscribers.delete(userId);
  };
}

function publish(userId: string, event: BridgeStreamEvent): void {
  eventSubscribers.get(userId)?.forEach((handler) => handler(event));
}

const PairStartBody = z.object({
  deviceName: z.string().trim().max(80).optional(),
});

const PairClaimBody = z.object({
  pairingCode: z.string().trim().min(1),
  deviceName: z.string().trim().max(80).optional(),
});

// 配对签发 + 设备管理：走普通 HTTP 鉴权路由，跟其它 REST 接口注册在一起即可。
export function registerAudioBridgePairingRoutes(app: FastifyInstance, db: AppDb): void {
  app.post("/api/audio-bridge/pair", async (request, reply) => {
    const session = requireAuth(request);
    const body = PairStartBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR" });

    pruneExpiredPairingCodes();
    let code = generatePairingCode();
    while (pairingCodes.has(code)) code = generatePairingCode();
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
    pairingCodes.set(code, { userId: session.userId, deviceName: body.data.deviceName?.trim() || "音频桥设备", expiresAt });
    return { pairingCode: code, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.post("/api/audio-bridge/claim", async (request, reply) => {
    const body = PairClaimBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR" });

    pruneExpiredPairingCodes();
    const entry = pairingCodes.get(body.data.pairingCode.trim());
    if (!entry) return reply.code(404).send({ error: "PAIRING_CODE_INVALID" });
    pairingCodes.delete(body.data.pairingCode.trim());

    const { plainToken, tokenHash } = createOneTimeToken();
    const now = nowIso();
    db.insertAudioBridgeDevice({
      id: makeId("audio-bridge-device"),
      userId: entry.userId,
      deviceName: body.data.deviceName?.trim() || entry.deviceName,
      tokenHash,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });
    return { deviceToken: plainToken };
  });

  app.get("/api/audio-bridge/devices", async (request) => {
    const session = requireAuth(request);
    const devices = db.listAudioBridgeDevices(session.userId);
    return { devices: devices.map((device) => ({ id: device.id, deviceName: device.deviceName, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt })) };
  });

  app.delete<{ Params: { id: string } }>("/api/audio-bridge/devices/:id", async (request) => {
    const session = requireAuth(request);
    db.revokeAudioBridgeDevice(request.params.id, session.userId, nowIso());
    return { ok: true };
  });

  // 浏览器订阅音频桥转写事件：与 cue-card 的 SSE 流复用同一套事件推送写法。
  app.get("/api/audio-bridge/events", async (request, reply) => {
    const session = requireAuth(request);
    const corsOrigin = process.env.APP_CORS_ORIGIN ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:5173";
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": corsOrigin,
    });
    const send = (event: BridgeStreamEvent) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "bridge_status", connected: false });
    const unsubscribe = subscribe(session.userId, send);
    request.raw.on("close", unsubscribe);
  });
}

function resolveDeviceToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const query = request.query as Record<string, string | undefined> | undefined;
  return query?.token?.trim() || null;
}

// 音频桥摄取：桌面程序用长期设备令牌连过来，推的是二进制 PCM 帧；
// 识别结果不回这个连接，而是转发给该用户名下正在监听 /events 的浏览器标签页。
export function registerAudioBridgeIngestRoute(app: FastifyInstance, db: AppDb): void {
  app.get("/api/audio-bridge/stream", { websocket: true }, (socket, request) => {
    const token = resolveDeviceToken(request);
    if (!token) {
      socket.close(4401, "MISSING_DEVICE_TOKEN");
      return;
    }
    const device = db.getAudioBridgeDeviceByTokenHash(hashOpaqueToken(token));
    if (!device) {
      socket.close(4401, "DEVICE_TOKEN_INVALID");
      return;
    }
    db.touchAudioBridgeDevice(device.id, nowIso());

    publish(device.userId, { type: "bridge_status", connected: true, deviceName: device.deviceName, asrReady: false });

    const relay = createAsrRelay((event) => {
      if (event.type === "ready") {
        publish(device.userId, { type: "bridge_status", connected: true, deviceName: device.deviceName, asrProvider: event.provider, asrReady: true });
      }
      publish(device.userId, event);
    });
    if (!relay) {
      publish(device.userId, {
        type: "error",
        code: "ASR_NOT_CONFIGURED",
        message: "实时语音识别未配置，系统音频桥已连接但无法转写。",
      });
      socket.close(1011, "ASR_NOT_CONFIGURED");
      return;
    }

    socket.on("message", (message, isBinary) => {
      if (!isBinary) {
        const control = safeJsonParse<{ type?: string; end?: boolean; rms?: number; peak?: number; bytesSent?: number; sampleRate?: number; channels?: number }>(message.toString());
        if (control?.end) relay.feedEnd();
        if (control?.type === "audio_level") {
          publish(device.userId, {
            type: "bridge_audio",
            rms: Number(control.rms) || 0,
            peak: Number(control.peak) || 0,
            bytesSent: Number(control.bytesSent) || 0,
            sampleRate: Number(control.sampleRate) || undefined,
            channels: Number(control.channels) || undefined,
          });
        }
        return;
      }
      relay.feedAudio(message as Buffer);
    });

    socket.on("close", () => {
      relay.close();
      publish(device.userId, { type: "bridge_status", connected: false, deviceName: device.deviceName });
    });
  });
}

export function resetAudioBridgeState(): void {
  pairingCodes.clear();
  eventSubscribers.clear();
}
