import { navigateTo } from "./router";
import { notify } from "./toast";

const TOKENS_KEY = "ai-job:tokens:v1";
const GUEST_ID_KEY = "ai-job:guest-id:v1";

// 为未登录访客生成并持久化一个会话级匿名 id，确保不同访客的数据在服务端互相隔离。
export function getGuestSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

type StoredTokens = {
  accessToken: string;
  expiresAt: string;
};

function readTokens(): StoredTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

export function getStoredAccessToken(): string | null {
  const tokens = readTokens();
  if (!tokens) return null;
  if (new Date(tokens.expiresAt) <= new Date()) return null;
  return tokens.accessToken;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = getStoredAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // 未登录时附带访客会话 id，让服务端按访客隔离数据与 RAG 召回。
  if (!token && !headers.has("x-guest-id")) {
    const guestId = getGuestSessionId();
    if (guestId) headers.set("x-guest-id", guestId);
  }
  try {
    const response = await fetch(input, { ...init, headers });
    // 登录态过期（401）：清本地登录态并跳登录页保留原路径，避免静默失效。
    // 仅当本次请求携带了 token 时才跳转，游客访问受保护接口的 401 属预期行为。
    if (response.status === 401 && typeof window !== "undefined" && token) {
      window.localStorage.removeItem(TOKENS_KEY);
      window.localStorage.removeItem("ai-job:session:v1");
      window.dispatchEvent(new Event("ai-job:auth-change"));
      const currentPath = window.location.pathname + window.location.search;
      redirectToLogin(currentPath);
    }
    return response;
  } catch (error) {
    // 网络层失败（断网、超时、CORS）统一提示，避免各处静默失败。
    notify("网络连接失败，请检查网络后重试", "error");
    throw error;
  }
}

export function buildAuthReturnPath(path: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(path)}`;
}

export function redirectToLogin(path: string) {
  navigateTo(buildAuthReturnPath(path));
}
