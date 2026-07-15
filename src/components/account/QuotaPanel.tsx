import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/authClient";
import { getQuotaSummary, QUOTA_FEATURE_LABELS } from "./quotaSummary";

export interface QuotaInfo {
  dailyUsed: number;
  dailyLimit: number;
  remaining: number;
  isGuest: boolean;
  features?: Record<"cueCard" | "mock" | "resume" | "positionAnalyze", { used: number; limit: number; remaining: number }>;
}

export function QuotaPanel({ variant = "card" }: { variant?: "card" | "compact" }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch("/api/quota")
      .then((res) => (res.ok ? res.json() as Promise<QuotaInfo> : null))
      .then((data) => { if (active && data) setQuota(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!quota) return null;

  const quotaSummary = getQuotaSummary(quota);

  if (variant === "compact") {
    return (
      <div className="account-quota-compact">
        <span className="subtle-label">今日免费额度</span>
        <div className="account-quota-grid">
          {QUOTA_FEATURE_LABELS.map((item) => {
            const value = quota.features?.[item.key];
            if (!value) return null;
            return (
              <div className="account-quota-feature" key={item.key}>
                <span>{item.label}</span>
                <strong>{value.remaining}</strong>
                <small>剩余 / {value.limit}</small>
              </div>
            );
          })}
        </div>
        <p className="account-card-hint">每日 0 点重置，当前为内测免费额度。</p>
      </div>
    );
  }

  return (
    <div className="account-card">
      <h2 className="account-card-title">使用额度</h2>
      {quotaSummary ? (
        <div className="account-quota-big">
          <span className="account-quota-num">{quotaSummary.remaining}</span>
          <span className="account-quota-label">
            {quota.features ? `${quotaSummary.label}剩余 / ${quotaSummary.limit} 次/天` : `${quotaSummary.label} / ${quotaSummary.limit} 次/天`}
          </span>
        </div>
      ) : null}
      {quota.features ? (
        <div className="account-quota-grid">
          {QUOTA_FEATURE_LABELS.map((item) => {
            const value = quota.features?.[item.key];
            if (!value) return null;
            return (
              <div className="account-quota-feature" key={item.key}>
                <span>{item.label}</span>
                <strong>{value.remaining}</strong>
                <small>剩余 / {value.limit}</small>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="account-card-hint">每日 0 点重置，当前为内测免费额度。</p>
    </div>
  );
}
