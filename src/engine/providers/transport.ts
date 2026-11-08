// Helix LLM HTTP Transport (Phase 1)
// Shared fetch-based transport for OpenAI-compatible and OpenAI providers.
// Handles auth headers, default headers, timeouts, SSE streaming, and error
// normalization. Pure transport — no UI, no process.stdout coupling.

import {
  LLMClientError,
  type LLMChunk,
  type LLMRequest,
  type LLMResponse,
  type LLMUsage,
  type ProviderClientConfig,
} from "./llm-client.ts";
import { toWireMessages } from "./trace-sanitizer.ts";

export type {
  LLMChunk,
  LLMRequest,
  LLMResponse,
  ProviderCapabilities,
  ProviderClientConfig,
  LLMClient,
} from "./llm-client.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const SSE_EVENT_PREFIX = "data: ";
const SSE_DONE = "[DONE]";

type Fetch = typeof globalThis.fetch;

/**
 * Build request headers for an OpenAI-compatible endpoint.
 */
export function buildHeaders(config: {
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  contentType?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.defaultHeaders) {
    Object.assign(headers, config.defaultHeaders);
  }
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  headers["Content-Type"] = config.contentType ?? "application/json";
  if (config.extraHeaders) {
    Object.assign(headers, config.extraHeaders);
  }
  return headers;
}

/**
 * Create an AbortController with a timeout, or return the existing signal.
 */
export function withTimeout(
  ms: number,
  signal?: AbortSignal,
): { controller: AbortController; signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const abort = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  return {
    controller,
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

/**
 * Parse a non-streaming JSON response, normalizing errors.
 */
export async function parseJsonResponse(res: Response, provider: string): Promise<unknown> {
  let body: unknown;
  const text = await res.text().catch(() => "");
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const errBody = body as Record<string, unknown> | null;
    const errorObj =
      errBody && typeof errBody === "object" && "error" in errBody
        ? (errBody as Record<string, unknown>).error
        : null;
    const message =
      errorObj && typeof errorObj === "object" && "message" in errorObj
        ? String((errorObj as Record<string, unknown>).message)
        : text || `HTTP ${res.status}`;
    throw new LLMClientError(message, {
      status: res.status,
      code: `HTTP_${res.status}`,
      provider,
    });
  }
  return body;
}

/**
 * Send a non-streaming chat completion request.
 */
export async function postChatCompletion(
  fetch: Fetch,
  url: string,
  request: LLMRequest,
  config: ProviderClientConfig,
  provider: string,
): Promise<LLMResponse> {
  const { signal, cleanup } = withTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = buildHeaders({
    apiKey: config.apiKey,
    defaultHeaders: config.defaultHeaders,
    extraHeaders: request.extraHeaders,
  });

  const body: Record<string, unknown> = {
    model: request.model,
    messages: toWireMessages(request.messages),
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.frequencyPenalty !== undefined) body.frequency_penalty = request.frequencyPenalty;
  if (request.presencePenalty !== undefined) body.presence_penalty = request.presencePenalty;
  if (request.stop !== undefined) body.stop = request.stop;
  if (request.tools?.length) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.store !== undefined) body.store = request.store;
  if (request.reasoningEffort !== undefined) body.reasoning_effort = request.reasoningEffort;
  if (request.extraBody) Object.assign(body, request.extraBody);

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    const parsed = (await parseJsonResponse(res, provider)) as Record<string, unknown>;
    return normalizeResponse(parsed, request.model);
  } catch (err) {
    if (err instanceof LLMClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMClientError(
        `Request timed out after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        {
          status: 504,
          code: "TIMEOUT",
          provider,
        },
      );
    }
    throw new LLMClientError(err instanceof Error ? err.message : String(err), {
      code: "REQUEST_FAILED",
      provider,
    });
  } finally {
    cleanup();
  }
}

/**
 * Stream a chat completion request via SSE, invoking onChunk for each event.
 */
export async function streamChatCompletion(
  fetch: Fetch,
  url: string,
  request: LLMRequest,
  config: ProviderClientConfig,
  provider: string,
  onChunk: (chunk: LLMChunk) => void,
  toleratesMissingFinishReason = false,
): Promise<LLMResponse> {
  const { signal, cleanup } = withTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = buildHeaders({
    apiKey: config.apiKey,
    defaultHeaders: config.defaultHeaders,
    extraHeaders: request.extraHeaders,
  });
  headers["Accept"] = "text/event-stream";
  headers["Cache-Control"] = "no-cache";

  const body: Record<string, unknown> = {
    model: request.model,
    messages: toWireMessages(request.messages),
    stream: true,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.frequencyPenalty !== undefined) body.frequency_penalty = request.frequencyPenalty;
  if (request.presencePenalty !== undefined) body.presence_penalty = request.presencePenalty;
  if (request.stop !== undefined) body.stop = request.stop;
  if (request.tools?.length) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.store !== undefined) body.store = request.store;
  if (request.reasoningEffort !== undefined) body.reasoning_effort = request.reasoningEffort;
  if (request.extraBody) Object.assign(body, request.extraBody);

  let accumulatedContent = "";
  let finishReason: string | null = null;
  const toolCalls: NonNullable<LLMResponse["toolCalls"]> = [];
  let usage: LLMUsage | undefined;

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMClientError(text || `HTTP ${res.status}`, {
        status: res.status,
        code: `HTTP_${res.status}`,
        provider,
      });
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new LLMClientError("Response body is unreadable", {
        status: 500,
        code: "NO_READABLE_BODY",
        provider,
      });
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith(SSE_EVENT_PREFIX)) continue;
          const data = trimmed.slice(SSE_EVENT_PREFIX.length).trim();
          if (data === SSE_DONE || data.length === 0) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // skip malformed SSE lines
          }

          const event = parsed as Record<string, unknown>;
          const choices = (event.choices as unknown[]) ?? [];
          const choice = choices[0] as Record<string, unknown> | undefined;
          if (!choice) continue;

          const delta = (choice.delta as Record<string, unknown> | undefined) ?? {};
          const deltaContent = typeof delta.content === "string" ? delta.content : "";
          if (deltaContent) {
            accumulatedContent += deltaContent;
            onChunk({ content: deltaContent, done: false });
          }

          const fr = choice.finish_reason;
          if (fr !== undefined && fr !== null) {
            finishReason = String(fr);
          }

          if (event.usage) {
            usage = normalizeUsage(event.usage as Record<string, unknown>);
          }

          const choiceToolCalls = (delta.tool_calls as unknown[]) ?? [];
          for (const rawTc of choiceToolCalls) {
            if (typeof rawTc !== "object" || rawTc === null) continue;
            const tc = rawTc as Record<string, unknown>;
            const index = typeof tc.index === "number" ? tc.index : toolCalls.length;
            const fn = (tc.function as Record<string, unknown> | undefined) ?? {};
            toolCalls[index] = {
              index,
              id: typeof tc.id === "string" ? tc.id : `call_${index}`,
              type: "function",
              function: {
                name: typeof fn.name === "string" ? fn.name : "",
                arguments: typeof fn.arguments === "string" ? fn.arguments : "",
              },
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Tolerate missing finish_reason at stream EOF (OpenAI-compatible rule).
    if (finishReason === null && toleratesMissingFinishReason) {
      finishReason = "stop";
    }

    onChunk({ content: "", done: true, finishReason, usage });

    return {
      id: undefined,
      model: request.model,
      content: accumulatedContent,
      usage,
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      raw: undefined,
    };
  } catch (err) {
    if (err instanceof LLMClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMClientError(
        `Stream timed out after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        {
          status: 504,
          code: "TIMEOUT",
          provider,
        },
      );
    }
    throw new LLMClientError(err instanceof Error ? err.message : String(err), {
      code: "STREAM_FAILED",
      provider,
    });
  } finally {
    cleanup();
  }
}

/**
 * GET models list for doctor handshake.
 */
export async function getModels(
  fetch: Fetch,
  baseUrl: string,
  config: ProviderClientConfig,
  provider: string,
): Promise<Array<{ id: string; object?: string; created?: number; ownedBy?: string }>> {
  const { signal, cleanup } = withTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = buildHeaders({
    apiKey: config.apiKey,
    defaultHeaders: config.defaultHeaders,
  });

  const modelsUrl = baseUrl.endsWith("/") ? `${baseUrl}models` : `${baseUrl}/models`;

  try {
    const res = await fetch(modelsUrl, { headers, signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMClientError(text || `HTTP ${res.status}`, {
        status: res.status,
        code: `HTTP_${res.status}`,
        provider,
      });
    }
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const data = (parsed.data as unknown[]) ?? [];
    return data
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : String(item.id ?? ""),
        object: typeof item.object === "string" ? item.object : undefined,
        created: typeof item.created === "number" ? item.created : undefined,
        ownedBy: typeof item.owned_by === "string" ? item.owned_by : undefined,
      }))
      .filter((m) => m.id.length > 0);
  } catch (err) {
    if (err instanceof LLMClientError) throw err;
    throw new LLMClientError(err instanceof Error ? err.message : String(err), {
      code: "MODELS_LIST_FAILED",
      provider,
    });
  } finally {
    cleanup();
  }
}

/** Normalize a provider response object into LLMResponse. */
function normalizeResponse(parsed: Record<string, unknown>, model: string): LLMResponse {
  const choices = (parsed.choices as unknown[]) ?? [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = (choice?.message as Record<string, unknown> | undefined) ?? {};
  const content = typeof message.content === "string" ? message.content : "";

  const finishReason = choice?.finish_reason ? String(choice.finish_reason) : undefined;

  const usage = parsed.usage ? normalizeUsage(parsed.usage as Record<string, unknown>) : undefined;

  const toolCalls: LLMResponse["toolCalls"] = [];
  const choiceToolCalls = (message.tool_calls as unknown[]) ?? [];
  for (const rawTc of choiceToolCalls) {
    if (typeof rawTc !== "object" || rawTc === null) continue;
    const tc = rawTc as Record<string, unknown>;
    const fn = (tc.function as Record<string, unknown> | undefined) ?? {};
    toolCalls.push({
      index: typeof tc.index === "number" ? tc.index : toolCalls.length,
      id: typeof tc.id === "string" ? tc.id : `call_${toolCalls.length}`,
      type: "function",
      function: {
        name: typeof fn.name === "string" ? fn.name : "",
        arguments: typeof fn.arguments === "string" ? fn.arguments : "",
      },
    });
  }

  return {
    id: typeof parsed.id === "string" ? parsed.id : undefined,
    model,
    content,
    finishReason,
    usage,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    raw: parsed,
  };
}

/** Normalize a usage object from a provider. */
function normalizeUsage(parsed: Record<string, unknown>): LLMUsage {
  const inputTokens = typeof parsed.prompt_tokens === "number" ? parsed.prompt_tokens : 0;
  const outputTokens = typeof parsed.completion_tokens === "number" ? parsed.completion_tokens : 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens:
      typeof parsed.cache_read_tokens === "number" ? parsed.cache_read_tokens : undefined,
  };
}

export { DEFAULT_TIMEOUT_MS };
