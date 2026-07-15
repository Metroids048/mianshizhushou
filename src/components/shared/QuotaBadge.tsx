import { Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/authClient";

interface QuotaInfo {
  dailyUsed: number;
  dailyLimit: number;
  remaining: number;
  resetAt: string;
  features?: Record<string, { used: number; limit: number; remaining: number }>;
}

export function QuotaBadge() {
  const { isLoggedIn } = useAuth();
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let active = true;
    void apiFetch("/api/quota")
      .then((res) => (res.ok ? res.json() as Promise<QuotaInfo> : null))
      .then((data) => { if (active && data) setQuota(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [isLoggedIn]);

  if (!isLoggedIn || !quota) return null;

  const primary = quota.features?.cueCard ?? { used: quota.dailyUsed, limit: quota.dailyLimit, remaining: quota.remaining };
  const pct = primary.limit > 0 ? primary.remaining / primary.limit : 0;
  const tone = pct > 0.4 ? "ok" : pct > 0.15 ? "warn" : "low";

  return (
    <span className={`quota-badge quota-${tone}`} title={`提词卡今日已用 ${primary.used}/${primary.limit} 次`}>
      <Zap size={12} />
      <span>提词 {primary.remaining}</span>
    </span>
  );
}
