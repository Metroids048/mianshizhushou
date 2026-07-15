export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const DEFAULT_MODEL = "deepseek-chat";

interface ChatOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// Calls the local proxy (see vite.config.ts) which adds the DeepSeek key
// server-side. Throws on any non-2xx / empty response so callers can fall back.
export async function llmChat(messages: LlmMessage[], options: ChatOptions = {}): Promise<string> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      temperature: options.temperature ?? 0.4,
      messages,
      stream: false,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LLM_REQUEST_FAILED_${response.status}:${detail.slice(0, 160)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM_EMPTY_RESPONSE");
  return content;
}

// Extracts the first JSON object/array from a model reply, tolerating
// ```json fences and surrounding prose.
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const objectStart = body.indexOf("{");
  const arrayStart = body.indexOf("[");

  let start: number;
  let closing: string;
  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    start = arrayStart;
    closing = "]";
  } else if (objectStart !== -1) {
    start = objectStart;
    closing = "}";
  } else {
    throw new Error("LLM_JSON_NOT_FOUND");
  }

  const end = body.lastIndexOf(closing);
  if (end <= start) throw new Error("LLM_JSON_NOT_FOUND");
  return JSON.parse(body.slice(start, end + 1));
}
