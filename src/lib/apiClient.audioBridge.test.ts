import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToAudioBridgeEvents } from "./apiClient";
import { apiFetch } from "./authClient";

vi.mock("./authClient", () => ({ apiFetch: vi.fn() }));

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe("subscribeToAudioBridgeEvents", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("parses valid SSE events and ignores malformed frames", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      sseResponse([
        'event: bridge_status\ndata: {"type":"bridge_status","connected":true,"deviceName":"本机"}\n\n',
        "event: final\ndata: not-json\n\n",
        'event: final\ndata: {"type":"final","text":"请介绍你的项目"}\n\n',
      ]),
    );

    const events: unknown[] = [];
    const unsubscribe = subscribeToAudioBridgeEvents((event) => events.push(event));

    await vi.waitFor(() => expect(events).toContainEqual({ type: "final", text: "请介绍你的项目" }));
    expect(events).toContainEqual({ type: "bridge_status", connected: true, deviceName: "本机" });
    unsubscribe();
  });

  it("emits disconnected status when the event stream cannot be opened", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network down"));
    const events: unknown[] = [];

    const unsubscribe = subscribeToAudioBridgeEvents((event) => events.push(event));

    await vi.waitFor(() => expect(events).toEqual([{ type: "bridge_status", connected: false }]));
    unsubscribe();
  });
});
