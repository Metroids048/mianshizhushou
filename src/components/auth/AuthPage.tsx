import { useState } from "react";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { navigateTo } from "../../lib/router";
import { Seo } from "../system/Seo";

type Mode = "login" | "register";

type AuthResponse = {
  user: {
    id: string;
    phone: string | null;
    email?: string | null;
    emailVerifiedAt?: string | null;
    displayName: string;
    notificationPrefs?: {
      marketing?: boolean;
      product?: boolean;
      security?: boolean;
    };
  };
  tokens: {
    accessToken: string;
    expiresAt: string;
  };
  error?: string;
};

export function AuthPage({ mode: initialMode, returnTo }: { mode: Mode; returnTo?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuth();
  const resolvedReturnTo = returnTo || "/";

  const submit = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError("请输入有效的手机号");
      return;
    }
    if (!password || password.length < 8) {
      setError("请输入至少 8 位密码");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body: Record<string, string> = { phone, password };
      if (mode === "register" && displayName.trim()) {
        body.displayName = displayName.trim();
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AuthResponse> & { error?: string };

      if (!res.ok) {
        if (data.error === "PHONE_ALREADY_REGISTERED") {
          setError("该手机号已注册，请直接登录");
        } else if (data.error === "INVALID_CREDENTIALS") {
          setError("手机号或密码错误");
        } else {
          setError(data.error || "操作失败");
        }
        return;
      }

      if (!data.user || !data.tokens) {
        setError("登录结果不完整，请稍后再试");
        return;
      }

      setAuth({ ...data.user, userId: data.user.id }, data.tokens);

      navigateTo(resolvedReturnTo, { replace: true });
    } catch {
      setError("网络错误，请检查连接");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
  };

  return (
    <div className="auth-page">
      <Seo
        title={mode === "register" ? "注册 | AI 求职台" : "登录 | AI 求职台"}
        description={mode === "register" ? "创建 AI 求职台账号，继续你的面试准备。" : "登录 AI 求职台，同步你的岗位、简历和练习记录。"}
      />
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-logo" aria-hidden="true">
            <BriefcaseBusiness size={24} />
          </span>
          <h1 className="auth-title">AI 求职台</h1>
          <p className="auth-subtitle">
            {mode === "register" ? "注册后继续保存你的岗位、简历和练习进度" : "登录后继续你的面试准备与记录同步"}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>

        <div className="auth-form">
          <label className="auth-field">
            <span className="auth-label">手机号</span>
            <input
              className="auth-input"
              type="tel"
              maxLength={11}
              placeholder="请输入手机号"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError("");
              }}
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">密码</span>
            <input
              className="auth-input"
              type="password"
              placeholder="至少 8 位"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
            />
          </label>

          {mode === "register" ? (
            <label className="auth-field">
              <span className="auth-label">
                昵称 <span className="auth-optional">(选填)</span>
              </span>
              <input
                className="auth-input"
                type="text"
                maxLength={32}
                placeholder="你的称呼"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}

          <button
            type="button"
            className="auth-submit"
            disabled={loading}
            onClick={submit}
          >
            {loading ? "处理中..." : mode === "register" ? "注册并开始使用" : "登录"}
            {!loading ? <ArrowRight size={16} /> : null}
          </button>

          {mode === "register" ? (
            <p className="auth-consent-text">
              注册即表示你已阅读并同意
              <button type="button" className="auth-link" onClick={() => navigateTo("/terms-of-service")}>
                《用户协议》
              </button>
              和
              <button type="button" className="auth-link" onClick={() => navigateTo("/privacy-policy")}>
                《隐私政策》
              </button>
            </p>
          ) : null}

          <p className="auth-footer-text">
            登录后继续原来的浏览进度
            <button type="button" className="auth-link" onClick={() => navigateTo(resolvedReturnTo, { replace: true })}>
              先回当前页面
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
