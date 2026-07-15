import type { QuotaInfo } from "./QuotaPanel";

const QUOTA_FEATURE_LABELS: Array<{ key: keyof NonNullable<QuotaInfo["features"]>; label: string }> = [
  { key: "cueCard", label: "提词卡" },
  { key: "mock", label: "模拟面试" },
  { key: "resume", label: "简历 AI" },
  { key: "positionAnalyze", label: "岗位分析" },
];

export function getQuotaSummary(quota: QuotaInfo) {
  const featureItems = QUOTA_FEATURE_LABELS
    .map((item) => {
      const value = quota.features?.[item.key];
      return value ? { label: item.label, remaining: value.remaining, limit: value.limit } : null;
    })
    .filter((item): item is { label: string; remaining: number; limit: number } => Boolean(item));

  if (featureItems.length === 0) {
    return {
      remaining: quota.remaining,
      limit: quota.dailyLimit,
      label: "今日 AI 剩余",
    };
  }

  return featureItems.reduce((current, next) => {
    const currentRatio = current.limit > 0 ? current.remaining / current.limit : 0;
    const nextRatio = next.limit > 0 ? next.remaining / next.limit : 0;
    return nextRatio < currentRatio ? next : current;
  });
}

export { QUOTA_FEATURE_LABELS };
