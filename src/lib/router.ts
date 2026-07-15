export type AppRoute =
  | { name: "home"; path: "/" }
  | { name: "positionDetail"; path: `/positions/${string}`; positionId: string }
  | { name: "positionConversation"; path: `/positions/${string}/conversation`; positionId: string }
  | { name: "live"; path: "/live" }
  | { name: "audioBridge"; path: "/audio-bridge" }
  | { name: "mock"; path: "/mock" }
  | { name: "mockPositionList"; path: "/mock/positions" }
  | { name: "mockSetup"; path: `/mock/setup/${string}`; positionId: string }
  | { name: "mockRoom"; path: `/mock/room/${string}`; positionId: string }
  | { name: "jd"; path: "/jd" }
  | { name: "questions"; path: "/questions" }
  | { name: "resume"; path: "/resume" }
  | { name: "records"; path: "/records" }
  | { name: "recordDetail"; path: `/records/${string}`; recordId: string }
  | { name: "authLogin"; path: "/auth/login"; returnTo?: string }
  | { name: "authRegister"; path: "/auth/register"; returnTo?: string }
  | { name: "forgotPassword"; path: "/forgot-password" }
  | { name: "resetPassword"; path: "/reset-password"; token?: string }
  | { name: "verifyEmail"; path: "/verify-email"; token?: string }
  | { name: "onboarding"; path: "/onboarding" }
  | { name: "account"; path: "/account" }
  | { name: "legalTerms"; path: "/terms-of-service" }
  | { name: "legalPrivacy"; path: "/privacy-policy" }
  | { name: "about"; path: "/about" }
  | { name: "help"; path: "/help" }
  | { name: "notFound"; path: "/404" }
  | { name: "serverError"; path: "/500" };

export function parseRoute(pathname: string): AppRoute {
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (pathname.startsWith("/positions/") && pathname.endsWith("/conversation")) {
    const positionId = decodeURIComponent(pathname.slice("/positions/".length, -"/conversation".length));
    return { name: "positionConversation", path: `/positions/${positionId}/conversation`, positionId };
  }
  if (pathname.startsWith("/positions/")) {
    const positionId = decodeURIComponent(pathname.slice("/positions/".length));
    return { name: "positionDetail", path: `/positions/${positionId}`, positionId };
  }
  if (pathname === "/live") return { name: "live", path: "/live" };
  if (pathname === "/audio-bridge") return { name: "audioBridge", path: "/audio-bridge" };
  if (pathname === "/mock") return { name: "mock", path: "/mock" };
  if (pathname === "/mock/positions") return { name: "mockPositionList", path: "/mock/positions" };
  if (pathname.startsWith("/mock/setup/")) {
    const positionId = decodeURIComponent(pathname.slice("/mock/setup/".length));
    return { name: "mockSetup", path: `/mock/setup/${positionId}`, positionId };
  }
  if (pathname.startsWith("/mock/room/")) {
    const positionId = decodeURIComponent(pathname.slice("/mock/room/".length));
    return { name: "mockRoom", path: `/mock/room/${positionId}`, positionId };
  }
  if (pathname === "/jd") return { name: "jd", path: "/jd" };
  if (pathname === "/questions") return { name: "questions", path: "/questions" };
  if (pathname === "/resume") return { name: "resume", path: "/resume" };
  if (pathname === "/records") return { name: "records", path: "/records" };
  if (pathname === "/auth/login") return { name: "authLogin", path: "/auth/login", returnTo: search.get("returnTo") ?? undefined };
  if (pathname === "/auth/register") return { name: "authRegister", path: "/auth/register", returnTo: search.get("returnTo") ?? undefined };
  if (pathname === "/forgot-password") return { name: "forgotPassword", path: "/forgot-password" };
  if (pathname === "/reset-password") return { name: "resetPassword", path: "/reset-password", token: search.get("token") ?? undefined };
  if (pathname === "/verify-email") return { name: "verifyEmail", path: "/verify-email", token: search.get("token") ?? undefined };
  if (pathname === "/onboarding") return { name: "onboarding", path: "/onboarding" };
  if (pathname === "/account") return { name: "account", path: "/account" };
  if (pathname === "/terms-of-service") return { name: "legalTerms", path: "/terms-of-service" };
  if (pathname === "/privacy-policy") return { name: "legalPrivacy", path: "/privacy-policy" };
  if (pathname === "/about") return { name: "about", path: "/about" };
  if (pathname === "/help") return { name: "help", path: "/help" };
  if (pathname === "/404") return { name: "notFound", path: "/404" };
  if (pathname === "/500") return { name: "serverError", path: "/500" };
  if (pathname.startsWith("/records/")) {
    const recordId = decodeURIComponent(pathname.slice("/records/".length));
    return { name: "recordDetail", path: `/records/${recordId}`, recordId };
  }
  return pathname === "/" ? { name: "home", path: "/" } : { name: "notFound", path: "/404" };
}

export function navigateTo(path: string, options?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
