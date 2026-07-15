import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/authClient";
import { AccountPage } from "./AccountPage";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    session: {
      userId: "user-quota",
      phone: "13800138000",
      email: "quota@example.com",
      emailVerifiedAt: null,
      displayName: "额度用户",
      notificationPrefs: { marketing: true, product: true, security: true },
    },
    isLoggedIn: true,
    clearAuth: vi.fn(),
    updateSession: vi.fn(),
  }),
}));

vi.mock("../../lib/authClient", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../../lib/router", () => ({
  navigateTo: vi.fn(),
}));

describe("AccountPage quota display", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("shows feature quota instead of the legacy total quota when feature buckets are available", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        dailyUsed: 3,
        dailyLimit: 3,
        remaining: 0,
        isGuest: false,
        features: {
          cueCard: { used: 1, limit: 5, remaining: 4 },
          mock: { used: 0, limit: 5, remaining: 5 },
          resume: { used: 0, limit: 5, remaining: 5 },
          positionAnalyze: { used: 0, limit: 5, remaining: 5 },
        },
      }),
    } as Response);

    render(<AccountPage journeyState="ready" />);

    const quotaCard = await screen.findByRole("heading", { name: "使用额度" });
    const card = quotaCard.closest(".account-card");
    expect(card).not.toBeNull();
    const scope = within(card as HTMLElement);

    await waitFor(() => expect(scope.getByText("提词卡剩余 / 5 次/天")).toBeInTheDocument());
    expect(scope.queryByText(/兼容总额度/)).not.toBeInTheDocument();
    expect(scope.getByText("提词卡")).toBeInTheDocument();
    expect(scope.getByText("模拟面试")).toBeInTheDocument();
    expect(scope.getByText("简历 AI")).toBeInTheDocument();
    expect(scope.getByText("岗位分析")).toBeInTheDocument();
  });
});
