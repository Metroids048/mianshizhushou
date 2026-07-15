import { LockKeyhole } from "lucide-react";
import { navigateTo } from "../../lib/router";

export function AuthGateCard({
  title = "登录后继续",
  detail = "当前页面可以先浏览，真正开始生成、进入面试或保存记录时需要登录。",
  actionLabel = "去登录",
  onLogin,
}: {
  title?: string;
  detail?: string;
  actionLabel?: string;
  onLogin: () => void;
}) {
  return (
    <div className="auth-gate-card" role="status">
      <div className="auth-gate-icon">
        <LockKeyhole size={18} />
      </div>
      <div className="auth-gate-copy">
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button type="button" className="button primary compact-button" onClick={onLogin}>
        {actionLabel}
      </button>
    </div>
  );
}

export function AuthGateModal({
  title = "登录后继续",
  detail = "登录后可继续当前操作，并自动保存你的进度。",
  actionLabel = "去登录",
  returnTo,
  onClose,
}: {
  title?: string;
  detail?: string;
  actionLabel?: string;
  returnTo: string;
  onClose: () => void;
}) {
  const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="dialog-panel compact-dialog auth-gate-modal" role="dialog" aria-modal="true" aria-label="登录后继续" onClick={(event) => event.stopPropagation()}>
        <div className="auth-gate-icon">
          <LockKeyhole size={18} />
        </div>
        <div className="auth-gate-copy">
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
        <div className="drawer-actions stacked">
          <button
            type="button"
            className="button primary"
            onClick={() => {
              onClose();
              navigateTo(loginUrl);
            }}
          >
            {actionLabel}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            先看看
          </button>
        </div>
      </aside>
    </div>
  );
}
