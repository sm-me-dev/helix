// Helix OpenAI-Compatible Provider (Phase 1)
// For any OpenAI-compatible/custom AI server: Ollama, vLLM, LiteLLM,
// OpenRouter, DeepSeek, Groq, local inference, etc.
//
// Behavior contract:
//   - custom base_url defaults to chat_completions (appends /chat/completions)
//   - disables openai_store context-store flags (store: false)
//   - disables encrypted reasoning payloads (no reasoning_effort)
//   - tolerates missing finish_reason at stream EOF

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

const COMPATIBLE_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalls: true,
  supportsSystemPrompt: true,
  toleratesMissingFinishReason: true,
  supportsStoreFlag: false, // openai_store disabled for compatible providers
  supportsReasoningEffort: false, // encrypted reasoning payloads disabled
  encryptedReasoningPayloads: false,
};

/**
 * Derive the chat/completions endpoint from a base_url. Strips a trailing
 * slash and appends /chat/completions.
 */
function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

export class OpenAICompatibleProvider implements LLMClient {
  readonly providerId: string;
  readonly capabilities: ProviderCapabilities;
  readonly config: ProviderClientConfig;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: ProviderClientConfig, fetch: typeof globalThis.fetch = globalThis.fetch) {
    this.providerId = config.providerId;
    this.config = normalizeProviderClientConfig(config);
    this.capabilities = COMPATIBLE_CAPABILITIES;
    this.fetch = fetch;
  }

  /** The full chat/completions endpoint for this provider. */
  get endpoint(): string {
    if (!this.config.baseUrl) {
      throw new LLMClientError("OpenAICompatibleProvider requires a baseUrl", {
        status: 400,
        code: "MISSING_BASE_URL",
        provider: this.providerId,
      });
    }
    return chatCompletionsUrl(this.config.baseUrl);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { store: _store, reasoningEffort: _reasoningEffort, ...compatibleRequest } = request;
    const compatRequest: LLMRequest = compatibleRequest;
    return postChatCompletion(
      this.fetch,
      this.endpoint,
      compatRequest,
      this.config,
      this.providerId,
    );
  }

  async stream(request: LLMRequest, onChunk: (chunk: LLMChunk) => void): Promise<LLMResponse> {
    const { store: _store, reasoningEffort: _reasoningEffort, ...compatibleRequest } = request;
    const compatRequest: LLMRequest = compatibleRequest;
    return streamChatCompletion(
      this.fetch,
      this.endpoint,
      compatRequest,
      this.config,
      this.providerId,
      onChunk,
      true,
    );
  }

  async listModels(): Promise<
    Array<{ id: string; object?: string; created?: number; ownedBy?: string }>
  > {
    return getModels(this.fetch, this.config.baseUrl ?? "", this.config, this.providerId);
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
