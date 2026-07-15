import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { nowIso } from "./utils";
import type { SessionInfo } from "./domains/auth/types";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const GUEST_COOKIE_NAME = "ai_job_guest_id";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export function createOneTimeToken(): { plainToken: string; tokenHash: string } {
  const plainToken = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(plainToken).digest("hex");
  return { plainToken, tokenHash };
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requireAuth(request: FastifyRequest): SessionInfo {
  if (!request.session) {
    throw Object.assign(new Error("UNAUTHORIZED"), { statusCode: 401 });
  }
  return request.session;
}

export function requireVerifiedEmail(request: FastifyRequest): SessionInfo {
  const session = requireAuth(request);
  if (!session.email || !session.emailVerifiedAt) {
    throw Object.assign(new Error("EMAIL_VERIFICATION_REQUIRED"), { statusCode: 403 });
  }
  return session;
}

export function applyRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    throw Object.assign(new Error("RATE_LIMITED"), { statusCode: 429 });
  }
  current.count += 1;
  rateLimitStore.set(key, current);
}

export function resetRateLimits(): void {
  rateLimitStore.clear();
}

export function clientIp(request: FastifyRequest): string {
  return request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
}

export function setCorsHeaders(reply: FastifyReply): void {
  const allowedOrigin = process.env.APP_CORS_ORIGIN ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:5173";
  reply.header("Access-Control-Allow-Origin", allowedOrigin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-guest-id");
  reply.header("Access-Control-Allow-Credentials", "true");
}

// 解析访客会话 id：仅允许安全字符，限长，转成带前缀的 owner id，避免与真实用户 id 冲突。
export function resolveGuestId(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-guest-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const cookieValue = readCookie(request, GUEST_COOKIE_NAME);
  const safe = sanitizeGuestId(value || cookieValue || "");
  return safe ? `guest_${safe}` : undefined;
}

export function ensureGuestId(request: FastifyRequest, reply: FastifyReply): string {
  const resolved = resolveGuestId(request);
  if (resolved) return resolved;
  const plain = randomBytes(18).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${GUEST_COOKIE_NAME}=${plain}; Path=/; Max-Age=${GUEST_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
  );
  return `guest_${plain}`;
}

// 当前请求的数据归属 id：已登录用户优先，否则用访客会话 id。
export function ownerOf(request: FastifyRequest): string | undefined {
  return request.session?.userId ?? request.guestOwnerId;
}

export function auditDetail(detail: Record<string, unknown>): string {
  return JSON.stringify({ ...detail, recordedAt: nowIso() });
}

function sanitizeGuestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  const cookies = Array.isArray(raw) ? raw.join(";") : raw;
  const prefix = `${name}=`;
  return cookies
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}
