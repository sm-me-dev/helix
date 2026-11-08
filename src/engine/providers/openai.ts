// Helix OpenAI Provider (Phase 1)
// Official OpenAI API endpoint. Distinct from OpenAICompatibleProvider:
//   - defaults to https://api.openai.com/v1
//   - supports openai_store context-store flags
//   - supports reasoning_effort / encrypted reasoning payloads

import {
  getModels,
  postChatCompletion,
  streamChatCompletion,
  type ProviderClientConfig,
  type ProviderCapabilities,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  type LLMChunk,
} from "./transport.ts";
import { LLMClientError } from "./llm-client.ts";
import { normalizeProviderClientConfig } from "./client-config.ts";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const OPENAI_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalls: true,
  supportsSystemPrompt: true,
  toleratesMissingFinishReason: false,
  supportsStoreFlag: true,
  supportsReasoningEffort: true,
  encryptedReasoningPayloads: true,
};

export class OpenAIProvider implements LLMClient {
  readonly providerId: string = "openai";
  readonly capabilities: ProviderCapabilities;
  readonly config: ProviderClientConfig;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: ProviderClientConfig, fetch: typeof globalThis.fetch = globalThis.fetch) {
    this.config = normalizeProviderClientConfig({
      ...config,
      baseUrl: config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
    });
    this.capabilities = OPENAI_CAPABILITIES;
    this.fetch = fetch;
  }

  /** The full chat/completions endpoint for OpenAI. */
  get endpoint(): string {
    return chatCompletionsUrl(this.config.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return postChatCompletion(this.fetch, this.endpoint, request, this.config, this.providerId);
  }

  async stream(request: LLMRequest, onChunk: (chunk: LLMChunk) => void): Promise<LLMResponse> {
    return streamChatCompletion(
      this.fetch,
      this.endpoint,
      request,
      this.config,
      this.providerId,
      onChunk,
      false,
    );
  }

  async listModels(): Promise<
    Array<{ id: string; object?: string; created?: number; ownedBy?: string }>
  > {
    return getModels(
      this.fetch,
      this.config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      this.config,
      this.providerId,
    );
  }

  async health(): Promise<{ ok: boolean; status?: number; latencyMs?: number; body?: string }> {
    const t0 = Date.now();
    try {
      await this.listModels();
      return { ok: true, status: 200, latencyMs: Date.now() - t0 };
    } catch (err) {
      const status = err instanceof LLMClientError ? err.status : undefined;
      return {
        ok: false,
        status,
        latencyMs: Date.now() - t0,
        body: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}
