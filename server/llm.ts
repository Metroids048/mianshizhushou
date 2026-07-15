import { createProvider, type AiMessage, type AiProvider } from "./ai/provider";

export type LlmMessage = AiMessage;
export type LlmClient = AiProvider;

export function createLlmClient(apiKey = process.env.DEEPSEEK_API_KEY ?? "", model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat"): LlmClient {
  return createProvider(apiKey, model);
}
