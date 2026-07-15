import type { AppDb } from "../../db";
import { makeId, nowIso } from "../../utils";

const USER_POSITION_LIMIT = 3;

function parseQuotaLimit(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Registered-user daily limits for MVP beta (no payment yet).
const FEATURE_LIMITS = {
  cueCard: parseQuotaLimit("QUOTA_USER_CUE_CARD", 5),
  mock: parseQuotaLimit("QUOTA_USER_MOCK", 5),
  resume: parseQuotaLimit("QUOTA_USER_RESUME", 5),
  positionAnalyze: parseQuotaLimit("QUOTA_USER_POSITION_ANALYZE", 5),
} as const;

type QuotaFeature = keyof typeof FEATURE_LIMITS;

const FEATURE_ENDPOINTS: Record<QuotaFeature, string[]> = {
  cueCard: ["cue-card", "cue-card-reconstruct"],
  mock: ["mock-session", "mock-answer", "follow-up"],
  resume: ["resume-ai", "profile-highlights"],
  positionAnalyze: ["position-analyze"],
};

const ENDPOINT_FEATURES: Record<string, QuotaFeature> = Object.fromEntries(
  Object.entries(FEATURE_ENDPOINTS).flatMap(([feature, endpoints]) => endpoints.map((endpoint) => [endpoint, feature])),
) as Record<string, QuotaFeature>;

const USER_DAILY_LIMIT = Object.values(FEATURE_LIMITS).reduce((sum, limit) => sum + limit, 0);

export interface QuotaInfo {
  dailyUsed: number;
  dailyLimit: number;
  positionsUsed: number;
  positionLimit: number;
  remaining: number;
  isGuest: boolean;
  resetAt: string;
  features: Record<QuotaFeature, { used: number; limit: number; remaining: number }>;
}

function assertRegisteredUser(userId: string | undefined): asserts userId is string {
  if (!userId || userId.startsWith("guest_")) {
    throw Object.assign(new Error("UNAUTHORIZED"), { statusCode: 401 });
  }
}

export function createQuotaService(db: AppDb) {
  const memoryLedger: Array<{ userId: string; endpoint: string; createdAt: string }> = [];

  function getDailyResetAt(): string {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString();
  }

  function countDailyUsage(userId: string, endpoints?: string[]): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    if (db.db) {
      const row = endpoints?.length
        ? db.db.prepare(
          `select count(*) as cnt from quota_ledger where user_id = ? and created_at >= ? and endpoint in (${endpoints.map(() => "?").join(",")})`,
        ).get(userId, todayStr, ...endpoints) as { cnt: number } | undefined
        : db.db.prepare(
          "select count(*) as cnt from quota_ledger where user_id = ? and created_at >= ?",
        ).get(userId, todayStr) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    }
    return memoryLedger.filter((item) => (
      item.userId === userId
      && item.createdAt >= todayStr
      && (!endpoints?.length || endpoints.includes(item.endpoint))
    )).length;
  }

  function countUserPositions(userId: string): number {
    const state = db.getState(userId);
    return state.positions.length;
  }

  function recordUsage(userId: string, endpoint: string): void {
    const id = makeId("quota");
    const now = nowIso();
    if (db.db) {
      db.db.prepare(
        "insert into quota_ledger(id, user_id, endpoint, created_at) values (?, ?, ?, ?)",
      ).run(id, userId, endpoint, now);
      return;
    }
    memoryLedger.push({ userId, endpoint, createdAt: now });
  }

  function getQuotaInfo(userId: string, positionsCount?: number): QuotaInfo {
    assertRegisteredUser(userId);
    const dailyUsed = countDailyUsage(userId);
    const positionsUsed = positionsCount ?? countUserPositions(userId);
    const features = Object.fromEntries(
      (Object.keys(FEATURE_ENDPOINTS) as QuotaFeature[]).map((feature) => {
        const used = countDailyUsage(userId, FEATURE_ENDPOINTS[feature]);
        const limit = FEATURE_LIMITS[feature];
        return [feature, { used, limit, remaining: Math.max(0, limit - used) }];
      }),
    ) as QuotaInfo["features"];

    return {
      dailyUsed,
      dailyLimit: USER_DAILY_LIMIT,
      positionsUsed,
      positionLimit: USER_POSITION_LIMIT,
      remaining: Math.max(0, USER_DAILY_LIMIT - dailyUsed),
      isGuest: false,
      resetAt: getDailyResetAt(),
      features,
    };
  }

  return {
    getQuotaInfo,
    recordUsage,
    checkAndRecord(userId: string | undefined, endpoint: string, positionsCount?: number): QuotaInfo {
      assertRegisteredUser(userId);
      const info = getQuotaInfo(userId, positionsCount);
      const feature = ENDPOINT_FEATURES[endpoint];
      const featureQuota = feature ? info.features[feature] : null;
      if (featureQuota && featureQuota.remaining <= 0) {
        throw Object.assign(new Error("QUOTA_EXCEEDED"), {
          statusCode: 429,
          quotaInfo: info,
          quotaFeature: feature,
          quotaFeatureInfo: featureQuota,
        });
      }
      recordUsage(userId, endpoint);
      if (!feature || !featureQuota) {
        return { ...info, dailyUsed: info.dailyUsed + 1, remaining: Math.max(0, info.remaining - 1) };
      }
      return {
        ...info,
        dailyUsed: info.dailyUsed + 1,
        remaining: Math.max(0, info.remaining - 1),
        features: {
          ...info.features,
          [feature]: {
            ...featureQuota,
            used: featureQuota.used + 1,
            remaining: Math.max(0, featureQuota.remaining - 1),
          },
        },
      };
    },
  };
}

export type QuotaService = ReturnType<typeof createQuotaService>;
