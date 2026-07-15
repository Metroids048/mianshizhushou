import { afterEach, describe, expect, it, vi } from "vitest";
import { startDictation } from "./speech";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.OPEN;
  binaryType = "";
  sent: unknown[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  fail() {
    this.onerror?.();
  }
}

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: {
    resultIndex: number;
    results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
  }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }

  start() {}
  stop() {
    this.onend?.();
  }
  abort() {}

  emit(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal, length: 1 }] });
  }
}

function installServerAudio() {
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: class {
      sampleRate = 48000;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
      }
      close() {
        return Promise.resolve();
      }
    },
  });
}

describe("startDictation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    FakeWebSocket.instances = [];
    FakeRecognition.last = null;
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  });

  it("uses server ASR and reports final text without clearing it on stop", async () => {
    installServerAudio();
    const onText = vi.fn();
    const onEnd = vi.fn();

    const handle = startDictation({ onText, onError: vi.fn(), onEnd });
    FakeWebSocket.instances[0].emit({ type: "ready", provider: "xfyun" });
    await vi.waitFor(() => expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    FakeWebSocket.instances[0].emit({ type: "final", text: "请介绍你的 AI 项目" });
    handle?.stop();

    expect(onText).toHaveBeenCalledWith("请介绍你的 AI 项目", true);
    expect(onEnd).toHaveBeenCalled();
  });

  it("falls back to Web Speech when server ASR connection fails", async () => {
    installServerAudio();
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeRecognition });
    const onText = vi.fn();

    startDictation({ onText, onError: vi.fn(), onEnd: vi.fn() });
    FakeWebSocket.instances[0].fail();
    await vi.waitFor(() => expect(FakeRecognition.last).toBeTruthy());
    FakeRecognition.last?.emit("最终识别文本", true);

    expect(onText).toHaveBeenCalledWith("最终识别文本", true);
  });
});
