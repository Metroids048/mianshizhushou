import { afterEach, describe, expect, it, vi } from "vitest";

// A4：验证 DeepSeek 调用的超时与重试行为。
// 通过 resetModules + 动态 import，让每个用例按各自的环境变量重新求值模块顶层常量。
async function loadProvider(env: { timeoutMs?: string; maxRetries?: string }) {
  if (env.timeoutMs !== undefined) process.env.DEEPSEEK_TIMEOUT_MS = env.timeoutMs;
  if (env.maxRetries !== undefined) process.env.DEEPSEEK_MAX_RETRIES = env.maxRetries;
  vi.resetModules();
  return import("./provider");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function chatPayload(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("DeepSeekProvider 超时与重试", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_TIMEOUT_MS;
    delete process.env.DEEPSEEK_MAX_RETRIES;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL_POOL;
    delete process.env.GITHUB_MODELS_TOKEN;
    delete process.env.GITHUB_MODELS_MODEL_POOL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
  });

  it("瞬时网络错误后重试一次并成功", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "1" });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return jsonResponse(chatPayload('{"ok":true}'));
      }),
    );

    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "hi" }], { ok: false });

    expect(calls).toBe(2);
    expect(result.status).toBe("success");
    expect((result.data as { ok: boolean }).ok).toBe(true);
  });

  it("重试耗尽后降级到 fallback", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const fallback = { ok: false, source: "local" };
    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "hi" }], fallback);

    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(fallback);
  });

  it("请求超时后中止并降级", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "30", maxRetries: "0" });
    // fetch 永不自行返回，只在 abort 信号触发时 reject，从而走超时分支。
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
        });
      }),
    );

    const fallback = { ok: false };
    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "hi" }], fallback);

    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(fallback);
  });

  it("结构化输出请求启用 DeepSeek JSON mode", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    const fetchMock = vi.fn(async () => jsonResponse(chatPayload('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    await provider.chatJson([{ role: "user", content: "只返回 JSON" }], { ok: false }, { schemaHint: '{"ok":"boolean"}' });

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, { body?: string }]>;
    const init = calls[0]?.[1];
    const body = JSON.parse(init?.body ?? "{}") as { response_format?: { type?: string } };
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("实时请求跳过同一 provider 的重试和 JSON 修复，留出时间给降级链", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "1" });
    const fetchMock = vi.fn(async () => jsonResponse(chatPayload("not-json")));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "hi" }], { ok: false }, {
      schemaHint: '{"ok":"boolean"}',
      maxRetries: 0,
      skipJsonRepair: true,
    });

    expect(result.status).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("上游错误 JSON 不会被当成模型 success", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(chatPayload('{"error":{"message":"Prompt must contain json"}}'))));

    const fallback = { strategy: "本地策略", openingLine: "本地开场", bullets: [], evidenceIds: [], risks: [], followUps: [] };
    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "只返回 JSON" }], fallback, {
      schemaHint: JSON.stringify({ strategy: "string", openingLine: "string", bullets: ["string"], evidenceIds: ["string"], risks: ["string"], followUps: ["string"] }),
    });

    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(fallback);
  });

  it("缺少 schema 字段的 JSON 不会被当成 success", async () => {
    const { DeepSeekProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(chatPayload('{"strategy":"只有策略"}'))));

    const fallback = { strategy: "本地策略", openingLine: "本地开场" };
    const provider = new DeepSeekProvider("test-key", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "只返回 JSON" }], fallback, {
      schemaHint: JSON.stringify({ strategy: "string", openingLine: "string" }),
    });

    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(fallback);
  });

  it("未配置 DEEPSEEK_API_KEY 时输出明确启动日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { createProvider, LocalFallbackProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });

    const provider = createProvider("", "deepseek-chat");

    expect(provider).toBeInstanceOf(LocalFallbackProvider);
    expect(warn).toHaveBeenCalled();
  });

  it("按 OpenRouter -> GitHub Models -> DeepSeek -> local fallback 顺序自动降级", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    process.env.OPENROUTER_MODEL_POOL = "openrouter/free";
    process.env.GITHUB_MODELS_TOKEN = "github-test-token";
    process.env.GITHUB_MODELS_MODEL_POOL = "openai/gpt-4.1-mini";
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const { createProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("openrouter.ai")) return new Response("rate limited", { status: 429 });
        if (url.includes("models.github.ai")) return new Response("quota exhausted", { status: 429 });
        return jsonResponse({ model: "deepseek-chat", choices: [{ message: { content: '{"ok":true}' } }] });
      }),
    );

    const provider = createProvider();
    const result = await provider.chatJson([{ role: "user", content: "hi" }], { ok: false });

    expect(result.status).toBe("success");
    expect(result.data).toEqual({ ok: true });
    expect(provider.model).toBe("deepseek-chat");
    expect(urls).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
      "https://models.github.ai/inference/chat/completions",
      "https://api.deepseek.com/chat/completions",
    ]);
  });

  it("OpenRouter 展示名前缀不传给上游 model 字段", async () => {
    const { OpenRouterProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    const fetchMock = vi.fn(async () => jsonResponse({ model: "meta-llama/llama-3.3-8b-instruct:free", choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("test-key", "openrouter/free");
    const result = await provider.chatJson([{ role: "user", content: "只返回 JSON" }], { ok: false });

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, { body?: string }]>;
    const body = JSON.parse(calls[0]?.[1]?.body ?? "{}") as { model?: string };
    expect(body.model).toBe("openrouter/free");
    expect(provider.model).toBe("openrouter:meta-llama/llama-3.3-8b-instruct:free");
    expect(result.status).toBe("success");
  });

  it("4xx 不重试同一 provider，但会尝试下一个 provider", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    process.env.OPENROUTER_MODEL_POOL = "openrouter/free";
    process.env.GITHUB_MODELS_TOKEN = "github-test-token";
    process.env.GITHUB_MODELS_MODEL_POOL = "openai/gpt-4.1-mini";
    const { createProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "1" });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("openrouter.ai")) return new Response("bad request", { status: 400 });
        return jsonResponse({ model: "openai/gpt-4.1-mini", choices: [{ message: { content: '{"ok":true}' } }] });
      }),
    );

    const provider = createProvider("", "deepseek-chat");
    const result = await provider.chatJson([{ role: "user", content: "hi" }], { ok: false });

    expect(result.status).toBe("success");
    expect(provider.model).toBe("github:openai/gpt-4.1-mini");
    expect(urls).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
      "https://models.github.ai/inference/chat/completions",
    ]);
  });

  it("全部远程 provider 失败后明确使用 local fallback", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    process.env.OPENROUTER_MODEL_POOL = "openrouter/free";
    process.env.GITHUB_MODELS_TOKEN = "github-test-token";
    process.env.GITHUB_MODELS_MODEL_POOL = "openai/gpt-4.1-mini";
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const { createProvider } = await loadProvider({ timeoutMs: "2000", maxRetries: "0" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));

    const fallback = { ok: false, source: "local" };
    const provider = createProvider();
    const result = await provider.chatJson([{ role: "user", content: "hi" }], fallback);

    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(fallback);
    expect(provider.model).toBe("local-fallback");
    expect(result.raw).toBe("LLM_NOT_CONFIGURED");
  });
});
