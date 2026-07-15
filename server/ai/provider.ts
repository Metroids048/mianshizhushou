import { safeJsonParse } from "../utils";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProvider {
  model: string;
  chatJson<T>(
    messages: AiMessage[],
    fallback: T,
    options?: AiRequestOptions,
  ): Promise<{ data: T; status: "success" | "fallback"; raw: string }>;
}

export interface AiRequestOptions {
  temperature?: number;
  signal?: AbortSignal;
  schemaHint?: string;
  maxRetries?: number;
  skipJsonRepair?: boolean;
}

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OPENROUTER_MODELS = ["openrouter/free"];
const DEFAULT_GITHUB_MODELS = ["openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324", "meta/Meta-Llama-3.1-8B-Instruct"];
const DEFAULT_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) > 0 ? Number(process.env.DEEPSEEK_TIMEOUT_MS) : 45000;
const DEFAULT_MAX_RETRIES = Number.isFinite(Number(process.env.DEEPSEEK_MAX_RETRIES)) ? Math.max(0, Number(process.env.DEEPSEEK_MAX_RETRIES)) : 1;

export function createProvider(apiKey = process.env.DEEPSEEK_API_KEY ?? "", model = process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL): AiProvider {
  const providers: AiProvider[] = [];

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (openRouterKey) {
    resolveModelPool(process.env.OPENROUTER_MODEL_POOL, DEFAULT_OPENROUTER_MODELS).forEach((modelId) => {
      providers.push(new OpenRouterProvider(openRouterKey, modelId));
    });
  }

  const githubModelsToken = (process.env.GITHUB_MODELS_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();
  if (githubModelsToken) {
    resolveModelPool(process.env.GITHUB_MODELS_MODEL_POOL, DEFAULT_GITHUB_MODELS).forEach((modelId) => {
      providers.push(new GitHubModelsProvider(githubModelsToken, modelId));
    });
  }

  if (apiKey.trim()) {
    providers.push(new DeepSeekProvider(apiKey, model));
  } else {
    console.warn("[ai] DEEPSEEK_API_KEY 未读取到，DeepSeek 兜底将跳过。");
  }

  if (!openRouterKey && !githubModelsToken && !apiKey.trim()) {
    console.warn("[ai] 未读取到 OPENROUTER_API_KEY / GITHUB_MODELS_TOKEN / DEEPSEEK_API_KEY，当前将使用本地 fallback provider。");
  }
  providers.push(new LocalFallbackProvider());
  return providers.length === 1 ? providers[0] : new FallbackChainProvider(providers);
}

export class LocalFallbackProvider implements AiProvider {
  model = "local-fallback";

  async chatJson<T>(_messages: AiMessage[], fallback: T): Promise<{ data: T; status: "fallback"; raw: string }> {
    return { data: fallback, status: "fallback", raw: "LLM_NOT_CONFIGURED" };
  }
}

class FallbackChainProvider implements AiProvider {
  private currentModel: string;

  constructor(private readonly providers: AiProvider[]) {
    this.currentModel = providers[0]?.model ?? "local-fallback";
  }

  get model(): string {
    return this.currentModel;
  }

  async chatJson<T>(
    messages: AiMessage[],
    fallback: T,
    options?: AiRequestOptions,
  ): Promise<{ data: T; status: "success" | "fallback"; raw: string }> {
    let lastRaw = "";
    for (const provider of this.providers) {
      this.currentModel = provider.model;
      const result = await provider.chatJson(messages, fallback, options);
      this.currentModel = provider.model;
      lastRaw = result.raw;
      if (result.status === "success" || provider instanceof LocalFallbackProvider) return result;
    }
    return { data: fallback, status: "fallback", raw: lastRaw || "LLM_FALLBACK_CHAIN_EXHAUSTED" };
  }
}

class RemoteJsonProvider implements AiProvider {
  private lastCallFailed = false;
  private currentDisplayModel: string;

  constructor(
    private readonly apiKey: string,
    private readonly upstreamModel: string,
    private readonly endpoint: string,
    private readonly timeoutLabel: string,
    private readonly providerLabel = "",
    private readonly extraHeaders: Record<string, string> = {},
  ) {
    this.currentDisplayModel = providerLabel ? `${providerLabel}:${upstreamModel}` : upstreamModel;
  }

  get model(): string {
    return this.currentDisplayModel;
  }

  async chatJson<T>(
    messages: AiMessage[],
    fallback: T,
    options?: AiRequestOptions,
  ): Promise<{ data: T; status: "success" | "fallback"; raw: string }> {
    const first = await this.call(messages, options);
    const parsed = extractStructuredJson<T>(first, options?.schemaHint);
    if (parsed) return { data: parsed, status: "success", raw: first };
    if (this.lastCallFailed || options?.skipJsonRepair) return { data: fallback, status: "fallback", raw: first };

    const repair = await this.call(
      [
        ...messages,
        { role: "assistant", content: first || "EMPTY_RESPONSE" },
        {
          role: "user",
          content: [
            "上一次输出不是合法 JSON。",
            "请只返回一个合法 JSON，不要解释，不要使用 markdown 代码块。",
            options?.schemaHint ? `Schema hint: ${options.schemaHint}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { ...options, temperature: 0 },
    );
    const repaired = extractStructuredJson<T>(repair, options?.schemaHint);
    return repaired ? { data: repaired, status: "success", raw: repair } : { data: fallback, status: "fallback", raw: repair || first };
  }

  private async call(messages: AiMessage[], options?: AiRequestOptions): Promise<string> {
    const maxAttempts = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES) + 1;
    let lastError = "";
    this.lastCallFailed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // 外部主动取消（如客户端断开）不重试，直接退出。
      if (options?.signal?.aborted) return "ABORTED";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(this.timeoutLabel)), DEFAULT_TIMEOUT_MS);
      const onExternalAbort = () => controller.abort(options?.signal?.reason);
      options?.signal?.addEventListener("abort", onExternalAbort, { once: true });
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...this.extraHeaders,
          },
          body: JSON.stringify({
            model: this.upstreamModel,
            temperature: options?.temperature ?? 0.35,
            stream: false,
            ...(options?.schemaHint ? { response_format: { type: "json_object" } } : {}),
            messages,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const json = (await response.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
          this.lastCallFailed = false;
          if (json.model) {
            this.currentDisplayModel = this.providerLabel ? `${this.providerLabel}:${json.model}` : json.model;
          }
          return json.choices?.[0]?.message?.content ?? "";
        }
        // 5xx 可重试；4xx 是请求本身问题，不重试。
        lastError = await response.text().catch(() => `HTTP_${response.status}`);
        this.lastCallFailed = true;
        if (response.status < 500 || attempt === maxAttempts - 1) return lastError;
      } catch (error) {
        // 外部取消：立即返回，不重试。
        if (options?.signal?.aborted) return "ABORTED";
        lastError = String(error);
        this.lastCallFailed = true;
        if (attempt === maxAttempts - 1) return lastError;
      } finally {
        clearTimeout(timeout);
        options?.signal?.removeEventListener("abort", onExternalAbort);
      }
      // 指数退避后重试。
      await sleep(400 * 2 ** attempt);
    }
    return lastError;
  }
}

export class OpenRouterProvider extends RemoteJsonProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, OPENROUTER_ENDPOINT, "OPENROUTER_TIMEOUT", "openrouter", {
      "HTTP-Referer": process.env.APP_BASE_URL ?? "http://127.0.0.1:5173",
      "X-OpenRouter-Title": "AI Job Interview Workbench",
    });
  }
}

export class GitHubModelsProvider extends RemoteJsonProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, GITHUB_MODELS_ENDPOINT, "GITHUB_MODELS_TIMEOUT", "github", {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    });
  }
}

export class DeepSeekProvider extends RemoteJsonProvider {
  constructor(apiKey: string, model = DEFAULT_DEEPSEEK_MODEL) {
    super(apiKey, model, DEEPSEEK_ENDPOINT, "DEEPSEEK_TIMEOUT");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveModelPool(value: string | undefined, fallback: string[]): string[] {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed?.length ? parsed : fallback;
}

function extractStructuredJson<T>(text: string, schemaHint?: string): T | null {
  const direct = extractJson<T>(text);
  if (direct && isValidBusinessJson(direct, schemaHint)) return direct;
  const lenient = extractLenientJson<T>(text);
  return lenient && isValidBusinessJson(lenient, schemaHint) ? lenient : null;
}

function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const objectStart = body.indexOf("{");
  const arrayStart = body.indexOf("[");
  const start = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart) ? arrayStart : objectStart;
  if (start < 0) return null;
  const closing = body[start] === "[" ? "]" : "}";
  const end = body.lastIndexOf(closing);
  if (end <= start) return null;
  return safeJsonParse<T>(body.slice(start, end + 1));
}

function extractLenientJson<T>(text: string): T | null {
  const body = text
    .replace(/^[\s\S]*?({|\[)/, "$1")
    .replace(/(```|'''|~~~)/g, "")
    .trim();
  if (!body) return null;

  const candidates = [body, trimAfterBalanced(body, "{", "}"), trimAfterBalanced(body, "[", "]")].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const parsed = safeJsonParse<T>(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function trimAfterBalanced(text: string, opening: "{" | "[", closing: "}" | "]"): string | null {
  const start = text.indexOf(opening);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function isValidBusinessJson<T>(value: T, schemaHint?: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const record = value as Record<string, unknown>;
  if ("error" in record) return false;
  if ("message" in record && !schemaHint) return false;
  if (!schemaHint) return true;
  const schema = safeJsonParse<Record<string, unknown>>(schemaHint);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return true;
  const requiredKeys = Object.keys(schema);
  if (requiredKeys.length === 0) return true;
  return requiredKeys.every((key) => key in record);
}
