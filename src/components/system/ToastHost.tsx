import { useEffect, useState } from "react";
import { subscribeToast, type ToastMessage } from "../../lib/toast";

// 全局提示宿主（上线收口 A2）：订阅 toast 通道，统一展示网络/AI 失败等反馈。
const AUTO_DISMISS_MS = 4200;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToast((toast) => {
      setToasts((current) => [...current, toast].slice(-3));
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, AUTO_DISMISS_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="region" aria-live="polite" aria-label="系统提示">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span>{toast.text}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
