import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { InterviewRecord } from "./types";
import { createPosition, createProfile } from "./lib/interviewEngine";

const vadMockState = vi.hoisted(() => ({
  options: [] as Array<{ onSpeechEnd?: () => void }>,
  errored: false,
  start: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
}));

vi.mock("@ricky0123/vad-react", () => ({
  useMicVAD: (options: { onSpeechEnd?: () => void }) => {
    vadMockState.options.push(options);
    return {
      listening: false,
      errored: vadMockState.errored,
      loading: false,
      userSpeaking: false,
      start: vadMockState.start,
      pause: vadMockState.pause,
      toggle: vi.fn(async () => undefined),
    };
  },
}));

let authState: {
  session: { userId: string; phone: string | null; displayName: string } | null;
  loading: boolean;
  isLoggedIn: boolean;
} = {
  session: { userId: "test-user", phone: "13800138000", displayName: "测试用户" },
  loading: false,
  isLoggedIn: true,
};

vi.mock("./lib/auth", () => ({
  useAuth: () => ({
    session: authState.session,
    loading: authState.loading,
    isLoggedIn: authState.isLoggedIn,
    getToken: () => "mock-token",
    setAuth: vi.fn(),
    clearAuth: vi.fn(),
    updateSession: vi.fn(),
  }),
}));

type SpeechRecognitionMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

let lastRecognition: SpeechRecognitionMock | null = null;

function installSpeechRecognitionMock() {
  function MockSpeechRecognition() {
    const instance: SpeechRecognitionMock = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onresult: null,
      onerror: null,
      onend: null,
    };
    instance.stop.mockImplementation(() => instance.onend?.());
    lastRecognition = instance;
    return instance;
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockSpeechRecognition });
}

function emitSpeech(text: string, isFinal: boolean) {
  const result = { isFinal, 0: { transcript: text }, length: 1, item: () => ({ transcript: text }) };
  const results = Object.assign([result], { item: () => result });
  act(() => lastRecognition?.onresult?.({ resultIndex: 0, results }));
}

function mockJsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

function mockStateWithPosition() {
  const profile = createProfile(`测试候选人
AI 产品经理
项目经历
增长提词助手项目：负责用户访谈、RAG 资料库、提词卡生成，首轮转化提升 18%。`);
  const position = createPosition(`岗位：AI 产品经理
公司：腾讯
职责：负责 AI 产品增长、用户研究、数据分析`, profile);
  return {
    profile,
    positions: [position],
    activePositionId: position.id,
    records: [] as InterviewRecord[],
    journeyState: "ready",
  };
}

function mockCueCardStream(questionText = "请介绍一个你做过的增长项目") {
  const card = {
    id: "card-server",
    questionText,
    createdAt: new Date().toISOString(),
    source: "live",
    strategy: "先讲结论，再讲动作和结果。",
    openingLine: "我想用增长提词助手项目回答这个问题。",
    bullets: ["先说明目标用户和场景", "再讲 RAG 资料库和提词卡生成", "最后补充转化提升 18%"],
    evidenceIds: ["project-growth"],
    risks: ["不要编造没有验证过的数据"],
    followUps: ["你怎么验证提词卡质量？"],
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `event: card\ndata: ${JSON.stringify({
            card,
            promptRun: { status: "success", latencyMs: 624 },
            searchCount: 0,
            meta: {
              backendStatus: "success",
              fallbackReason: "",
              evidenceTrace: [{ id: "ev-project", title: "增长提词助手项目", reason: "简历项目证据匹配问题" }],
              latencyMs: 624,
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return Promise.resolve({ ok: true, body: stream } as Response);
}

beforeEach(() => {
  authState = {
    session: { userId: "test-user", phone: "13800138000", displayName: "测试用户" },
    loading: false,
    isLoggedIn: true,
  };
  vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/api/state")) return mockJsonResponse(mockStateWithPosition());
    if (url.includes("/api/audio-bridge/devices")) return mockJsonResponse({ devices: [] });
    if (url.includes("/api/copilot/cue-card/stream")) return mockCueCardStream();
    if (url.includes("/api/profile")) return mockJsonResponse(mockStateWithPosition());
    if (url.includes("/api/positions/intake")) return mockJsonResponse({ ...mockStateWithPosition(), intakeAssistant: { reply: "", missingFields: [], confirmedFields: [], suggestedPrompts: [] } });
    if (url.includes("/api/positions/")) return mockJsonResponse({ position: mockStateWithPosition().positions[0] });
    return mockJsonResponse({});
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  Reflect.deleteProperty(window, "SpeechRecognition");
  lastRecognition = null;
  vadMockState.options = [];
  vadMockState.start.mockClear();
  vadMockState.pause.mockClear();
});

describe("YinpinJiantingApp", () => {
  it("renders only the two-page focused tool navigation", async () => {
    render(<App />);

    const nav = await screen.findByLabelText("工具导航");
    expect(within(nav).getByRole("button", { name: /监听提词台/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /资料库/ })).toBeInTheDocument();
    expect(screen.queryByText("模拟面试")).not.toBeInTheDocument();
    expect(screen.queryByText("面试记录")).not.toBeInTheDocument();
  });

  it("generates a cue card from manual interviewer question with evidence trace", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("监听输入区");
    await user.type(screen.getByPlaceholderText("例如：请介绍一个你做过的项目，以及你具体负责什么？"), "请介绍一个你做过的增长项目");
    await user.click(screen.getByRole("button", { name: /生成提词卡/ }));

    expect(await screen.findByText("我想用增长提词助手项目回答这个问题。")).toBeInTheDocument();
    expect(screen.getByText(/增长提词助手项目：简历项目证据匹配问题/)).toBeInTheDocument();
    expect(screen.getByText(/模型生成 · 624ms/)).toBeInTheDocument();
  });

  it("keeps microphone final text after stopping listening", async () => {
    installSpeechRecognitionMock();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("监听输入区");
    await user.click(screen.getByRole("button", { name: "麦克风" }));
    await user.click(screen.getByRole("button", { name: /开始麦克风监听/ }));
    emitSpeech("请讲一个 AI 产品项目", true);
    await user.click(screen.getByRole("button", { name: /停止听取/ }));

    const textarea = screen.getByPlaceholderText("例如：请介绍一个你做过的项目，以及你具体负责什么？") as HTMLTextAreaElement;
    expect(textarea.value).toContain("请讲一个 AI 产品项目");
  });

  it("shows the minimal login panel when signed out", async () => {
    authState = { session: null, loading: false, isLoggedIn: false };
    render(<App />);

    expect(await screen.findByLabelText("最小登录")).toBeInTheDocument();
    expect(screen.getByText("登录后保存资料库和音频桥设备")).toBeInTheDocument();
  });

  it("saves library inputs through the retained backend interfaces", async () => {
    const fetchMock = vi.spyOn(window, "fetch");
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("工具导航");
    await user.click(within(nav).getByRole("button", { name: /资料库/ }));
    await user.type(screen.getByPlaceholderText("粘贴你的简历正文，保存后会自动抽取证据。"), "我负责 AI 提词工具，首轮转化提升 18%。");
    await user.click(screen.getByRole("button", { name: /保存简历/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/profile"))).toBe(true));
  });
});
