// Helix LLM Client Interface & Types (Phase 1)
// Unified contract for all AI providers. Implementations must not read
// process.stdout or write UI — they are pure request/response clients.

export type LLMMessageRole = "system" | "user" | "assistant" | "tool";

export type LLMMessage = {
  role: LLMMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type LLMTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type LLMRequest = {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: LLMTool[];
  toolChoice?: "none" | "auto" | "required";
  // OpenAI-compatible extensions
  store?: boolean; // maps to openai_store context-store flag
  reasoningEffort?: "low" | "medium" | "high";
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
};

export type LLMUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
};

export type LLMChunk = {
  content: string;
  toolCalls?: Array<{
    index: number;
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  finishReason?: string | null;
  done: boolean;
  usage?: LLMUsage;
};

export type LLMResponse = {
  id?: string;
  model: string;
  content: string;
  usage?: LLMUsage;
  finishReason?: string | null;
  toolCalls?: Array<{
    index: number;
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  raw?: Record<string, unknown>;
};

/**
 * Capabilities a provider declares so the engine can adapt its behavior
 * (e.g. whether to expect finish_reason at stream EOF, whether store flags
 * are supported, whether reasoning payloads are encrypted).
 */
export type ProviderCapabilities = {
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
  supportsSystemPrompt: boolean;
  toleratesMissingFinishReason: boolean;
  supportsStoreFlag: boolean;
  supportsReasoningEffort: boolean;
  encryptedReasoningPayloads: boolean;
};

/**
 * Provider-specific configuration resolved by config-loader.
 */
export type ProviderClientConfig = {
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  defaultModel?: string;
  timeoutMs?: number;
};

/**
 * Errors thrown by LLM clients.
 */
export class LLMClientError extends Error {
  public readonly status?: number;
  public readonly code: string;
  public readonly provider: string;
  constructor(
    message: string,
    { status, code, provider }: { status?: number; code: string; provider: string },
  ) {
    super(message);
    this.name = "LLMClientError";
    this.status = status;
    this.code = code;
    this.provider = provider;
  }
}

/**
 * Interface every LLM client must implement.
 */
export interface LLMClient {
  readonly providerId: string;
  readonly capabilities: ProviderCapabilities;
  readonly config: ProviderClientConfig;

  /** Complete a non-streaming chat request. */
  complete(request: LLMRequest): Promise<LLMResponse>;
  /** Stream a chat request, yielding chunks. */
  stream(request: LLMRequest, onChunk: (chunk: LLMChunk) => void): Promise<LLMResponse>;
  /** List available models (used by `helix doctor` handshake). */
  listModels?(): Promise<
    Array<{ id: string; object?: string; created?: number; ownedBy?: string }>
  >;
  /** Health-check the endpoint (used by `helix doctor`). */
  health?(): Promise<{ ok: boolean; status?: number; latencyMs?: number; body?: string }>;
}
