import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./auth";

const TOKENS_KEY = "ai-job:tokens:v1";
const SESSION_KEY = "ai-job:session:v1";

function AuthProbe() {
  const auth = useAuth();
  return <span>{auth.isLoggedIn ? "logged-in" : "logged-out"}</span>;
}

function seedSession() {
  localStorage.setItem(TOKENS_KEY, JSON.stringify({ accessToken: "test-token", expiresAt: "2099-01-01T00:00:00.000Z" }));
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: "user-1", phone: "13800000000", displayName: "测试用户" }));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useAuth", () => {
  it("keeps the cached session during a transient backend failure", async () => {
    seedSession();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthProbe />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("logged-in")).toBeInTheDocument();
    expect(localStorage.getItem(TOKENS_KEY)).not.toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("clears the cached session only after an explicit unauthorized response", async () => {
    seedSession();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(<AuthProbe />);

    await waitFor(() => expect(screen.getByText("logged-out")).toBeInTheDocument());
    expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
