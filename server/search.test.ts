import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearchTool } from "./search";

describe("search tool", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes a hard-timeout abort signal to provider fetches", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });

    void createSearchTool("bing", "test-key").search("AI 面试最新趋势").catch(() => undefined);
    await Promise.resolve();

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(4000);

    expect(signal?.aborted).toBe(true);
  });
});
