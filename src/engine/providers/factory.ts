import type { ResolvedAiConfig } from "../config-loader.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import { OpenAIProvider } from "./openai.ts";
import type { LLMClient } from "./llm-client.ts";

/** Construct the correct native-fetch client for a resolved provider config. */
export function createLLMClient(
  config: ResolvedAiConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): LLMClient {
  const clientConfig = {
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultHeaders: config.defaultHeaders,
    defaultModel: config.model,
  };

  if (config.providerId === "openai" && !config.baseUrl) {
    return new OpenAIProvider(clientConfig, fetcher);
  }
  return new OpenAICompatibleProvider(clientConfig, fetcher);
}
