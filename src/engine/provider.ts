import { countTokens } from "../measure.ts";
import { spawn } from "node:child_process";
import { redactSecrets } from "./security.ts";
import type { CostEstimate, ModelProvider, ProviderId, TokenUsage } from "./types.ts";

export type TaskCognitiveRole =
  | "MASTER_ORCHESTRATOR"
  | "FAST_DISPOSABLE_SCOUT"
  | "PARALLEL_IMPLEMENTER"
  | "ADVERSARIAL_AUDITOR"
  | "HYPOTHESIS_DEBATE_PEER";

export type HeadlessProvider = "claude" | "codex" | "opencode" | "copilot";
export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelRoute {
  readonly harness: HeadlessProvider;
  readonly modelId: string;
  readonly effort: ReasoningEffort;
  readonly maxTurns: number;
  readonly readOnlyToolsOnly: boolean;
  readonly adversarialCounterpart?: HeadlessProvider;
  readonly source: string;
  readonly verifiedAt: string;
}

export type ModelRoutingPolicy = Readonly<Record<TaskCognitiveRole, ModelRoute>>;

const ANTHROPIC_MODEL_SOURCE = "https://platform.claude.com/docs/en/models/overview";
const OPENAI_MODEL_SOURCE = "https://developers.openai.com/api/docs/models/all";
const OPENCODE_MODEL_SOURCE = "https://dev.opencode.ai/v2/docs/console/models";

export const DEFAULT_HELIX_V2_ROUTING: ModelRoutingPolicy = {
  MASTER_ORCHESTRATOR: {
    harness: "claude",
    modelId: "claude-opus-5-5",
    effort: "high",
    maxTurns: 30,
    readOnlyToolsOnly: false,
    adversarialCounterpart: "codex",
    source: ANTHROPIC_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  },
  FAST_DISPOSABLE_SCOUT: {
    harness: "claude",
    modelId: "claude-haiku-5-5",
    effort: "low",
    maxTurns: 8,
    readOnlyToolsOnly: true,
    source: ANTHROPIC_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  },
  PARALLEL_IMPLEMENTER: {
    harness: "claude",
    modelId: "claude-sonnet-5-5",
    effort: "medium",
    maxTurns: 20,
    readOnlyToolsOnly: false,
    adversarialCounterpart: "codex",
    source: ANTHROPIC_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  },
  ADVERSARIAL_AUDITOR: {
    harness: "codex",
    modelId: "gpt-6.1-sol",
    effort: "high",
    maxTurns: 6,
    readOnlyToolsOnly: true,
    adversarialCounterpart: "claude",
    source: OPENAI_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  },
  HYPOTHESIS_DEBATE_PEER: {
    harness: "opencode",
    modelId: "gemini-3.1-pro",
    effort: "high",
    maxTurns: 10,
    readOnlyToolsOnly: true,
    source: OPENCODE_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  },
};

export interface ProviderSelection {
  readonly harness: HeadlessProvider;
  readonly modelId?: string;
  readonly baseUrl?: string;
  readonly token?: string;
}

export function resolveOrthogonalAuditor(
  generatorProvider: ProviderSelection | HeadlessProvider | string,
): ModelRoute {
  const generator =
    typeof generatorProvider === "string"
      ? { harness: normalizeHarness(generatorProvider), modelId: generatorProvider }
      : generatorProvider;
  const model = (generator.modelId ?? "").toLowerCase();
  const modelIsOpenAi = /^(gpt-|o\d|openai\/)/.test(model);
  const modelIsClaude = /^(claude-|anthropic\/)/.test(model);
  const generatorIsClaude = modelIsClaude || (!modelIsOpenAi && generator.harness === "claude");
  if (generatorIsClaude) {
    return { ...DEFAULT_HELIX_V2_ROUTING.ADVERSARIAL_AUDITOR };
  }
  return {
    ...DEFAULT_HELIX_V2_ROUTING.ADVERSARIAL_AUDITOR,
    harness: "claude",
    modelId: "claude-fable-5-1",
    adversarialCounterpart: "codex",
    source: ANTHROPIC_MODEL_SOURCE,
    verifiedAt: "2026-11-05",
  };
}

function normalizeHarness(value: string): HeadlessProvider {
  const lowered = value.toLowerCase();
  if (lowered === "claude" || lowered.includes("anthropic")) return "claude";
  if (lowered === "codex" || lowered.includes("openai")) return "codex";
  if (lowered === "copilot") return "copilot";
  return "opencode";
}

export type HeadlessApiFormat =
  "anthropic-messages" | "openai-chat-completions" | "openai-responses";

export interface HeadlessApiConfiguration {
  readonly endpoint: string;
  readonly format: HeadlessApiFormat;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface HeadlessInvocationRequest {
  readonly mode?: "cli" | "api";
  readonly modelId: string;
  readonly effort?: ReasoningEffort;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly workdir?: string;
  readonly timeoutMs?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxTurns?: number;
  readonly readOnlyToolsOnly?: boolean;
  readonly cliExecutable?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly api?: HeadlessApiConfiguration;
}

export interface HeadlessInvocationResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly tokens: TokenUsage;
  readonly error?: string;
}

export const HEADLESS_PROVIDER_CATALOG: Readonly<
  Partial<
    Record<
      HeadlessProvider,
      {
        readonly command: string;
        readonly source: string;
        readonly verifiedAt: string;
      }
    >
  >
> = {
  claude: {
    command: "claude -p",
    source: "https://code.claude.com/docs/en/headless",
    verifiedAt: "2026-11-05",
  },
  codex: {
    command: "codex exec",
    source: "https://learn.chatgpt.com/docs/codex/cli",
    verifiedAt: "2026-11-05",
  },
  opencode: {
    command: "opencode run",
    source: "https://dev.opencode.ai/v2/docs/cli/commands/",
    verifiedAt: "2026-11-05",
  },
};

type SpawnCommand = { command: string; args: string[]; stdin: string };

function combinedPrompt(request: HeadlessInvocationRequest): string {
  return request.systemPrompt
    ? `${request.systemPrompt}\n\n## User task\n${request.prompt}`
    : request.prompt;
}

function emptyTokenUsage(inputTokens = 0, outputTokens = 0): TokenUsage {
  return { inputTokens, outputTokens, cacheReadTokens: 0, totalTokens: inputTokens + outputTokens };
}

function safeFailureText(text: string): string {
  return redactProviderOutput(text).slice(0, 4000);
}

function redactProviderOutput(text: string): string {
  let output = redactSecrets(text).text;
  const canary = process.env.ADMIN_TEST_KEY;
  if (canary) output = output.split(canary).join("[REDACTED_CANARY]");
  return output.replace(/\bADMIN_TEST_KEY\s*[:=]\s*[^\s,;]+/g, "ADMIN_TEST_KEY=[REDACTED_CANARY]");
}

function makeCliCommand(
  provider: HeadlessProvider,
  request: HeadlessInvocationRequest,
  prompt: string,
): SpawnCommand {
  const executable = request.cliExecutable ?? provider;
  if (provider === "claude") {
    const args = ["-p", "--output-format", "text"];
    if (request.modelId) args.push("--model", request.modelId);
    if (request.effort) args.push("--effort", request.effort);
    if (request.readOnlyToolsOnly) args.push("--permission-mode", "plan");
    return { command: executable, args, stdin: prompt };
  }
  if (provider === "codex") {
    const args = ["exec", "--model", request.modelId];
    if (request.readOnlyToolsOnly) args.push("--sandbox", "read-only");
    args.push(prompt);
    return { command: executable, args, stdin: "" };
  }
  if (provider === "opencode") {
    if (request.readOnlyToolsOnly) {
      throw new Error(
        "OpenCode CLI read-only execution is not configured; use an API endpoint without tools.",
      );
    }
    return { command: executable, args: ["run", "--model", request.modelId, prompt], stdin: "" };
  }
  throw new Error("Copilot headless CLI invocation is not verified; configure an API endpoint.");
}

function invokeCli(
  provider: HeadlessProvider,
  request: HeadlessInvocationRequest,
  prompt: string,
  inputTokens: number,
): Promise<HeadlessInvocationResult> {
  const started = Date.now();
  const command = makeCliCommand(provider, request, prompt);
  const timeoutMs = Math.max(1, request.timeoutMs ?? 120_000);
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: request.workdir,
      env: { ...process.env, ...request.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (exitCode: number, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cleanOut = safeFailureText(stdout);
      const cleanErr = safeFailureText(stderr);
      const outputTokens = countTokens(cleanOut);
      resolve({
        exitCode: error ? 1 : exitCode,
        stdout: cleanOut,
        stderr: cleanErr,
        durationMs: Date.now() - started,
        tokens: emptyTokenUsage(inputTokens, outputTokens),
        error,
      });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
      finish(124, `Headless invocation timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length + stderr.length > 10_000_000) {
        child.kill("SIGKILL");
        finish(1, "Headless invocation exceeded the 10 MB output limit");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stdout.length + stderr.length > 10_000_000) {
        child.kill("SIGKILL");
        finish(1, "Headless invocation exceeded the 10 MB output limit");
      }
    });
    child.on("error", (error: Error) => finish(1, error.message));
    child.on("close", (code: number | null) => {
      const outputTokens = countTokens(stdout);
      if (outputTokens > (request.maxOutputTokens ?? 10_000)) {
        finish(1, `Headless output exceeded the ${request.maxOutputTokens ?? 10_000}-token budget`);
        return;
      }
      finish(code ?? 1, code === 0 ? undefined : `Headless CLI exited with code ${code ?? 1}`);
    });
    if (command.stdin.length > 0) child.stdin.end(command.stdin);
    else child.stdin.end();
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function tokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const fragments = value.flatMap((entry: unknown) => {
    const record = asRecord(entry);
    return record &&
      (record.type === "text" || record.type === "output_text") &&
      typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return fragments.length ? fragments.join("\n") : undefined;
}

function apiOutputText(format: HeadlessApiFormat, payload: Record<string, unknown>): string {
  if (format === "anthropic-messages") return textFromUnknown(payload.content) ?? "";
  if (format === "openai-chat-completions") {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    return textFromUnknown(message?.content) ?? "";
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .map((entry: unknown) => {
      const record = asRecord(entry);
      return textFromUnknown(record?.content) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function apiUsage(
  format: HeadlessApiFormat,
  payload: Record<string, unknown>,
): TokenUsage | undefined {
  const usage = asRecord(payload.usage);
  if (!usage) return undefined;
  const input = tokenNumber(
    format === "openai-chat-completions" ? usage.prompt_tokens : usage.input_tokens,
  );
  const output = tokenNumber(
    format === "openai-chat-completions" ? usage.completion_tokens : usage.output_tokens,
  );
  if (input === undefined || output === undefined) return undefined;
  const cache = tokenNumber(usage.cache_read_input_tokens) ?? tokenNumber(usage.cached_tokens) ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cache,
    totalTokens: input + output,
  };
}

function validateApiEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp)
    throw new Error("API endpoint must use HTTPS (HTTP is allowed only on loopback)");
  if (url.username || url.password)
    throw new Error("API endpoint must not embed credentials in its URL");
  return url;
}

async function invokeApi(
  provider: HeadlessProvider,
  request: HeadlessInvocationRequest,
  prompt: string,
  inputTokens: number,
): Promise<HeadlessInvocationResult> {
  const started = Date.now();
  const api = request.api;
  if (!api) throw new Error("API mode requires an explicit endpoint and request format");
  const endpoint = validateApiEndpoint(api.endpoint);
  const maxOutputTokens = Math.max(1, request.maxOutputTokens ?? 10_000);
  const body: Record<string, unknown> = { model: request.modelId };
  const headers: Record<string, string> = { "content-type": "application/json", ...api.headers };
  if (api.format === "anthropic-messages") {
    body.max_tokens = maxOutputTokens;
    body.messages = [{ role: "user", content: request.prompt }];
    if (request.systemPrompt) body.system = request.systemPrompt;
    headers["anthropic-version"] ??= "2023-06-01";
    if (api.apiKey) headers["x-api-key"] ??= api.apiKey;
  } else if (api.format === "openai-chat-completions") {
    body.messages = [
      ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
      { role: "user", content: request.prompt },
    ];
    body.max_tokens = maxOutputTokens;
    if (request.effort) body.reasoning_effort = request.effort;
    if (api.apiKey) headers.authorization ??= `Bearer ${api.apiKey}`;
  } else {
    body.input = request.prompt;
    body.max_output_tokens = maxOutputTokens;
    if (request.systemPrompt) body.instructions = request.systemPrompt;
    if (request.effort) body.reasoning = { effort: request.effort };
    if (api.apiKey) headers.authorization ??= `Bearer ${api.apiKey}`;
  }
  if (provider === "copilot" && !api.endpoint)
    throw new Error("Copilot requires a configured API endpoint");

  const controller = new AbortController();
  const timeoutMs = Math.max(1, request.timeoutMs ?? 120_000);
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (raw.length > 10_000_000) throw new Error("API response exceeded the 10 MB output limit");
    if (!response.ok) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: safeFailureText(raw || `HTTP ${response.status}`),
        durationMs: Date.now() - started,
        tokens: emptyTokenUsage(inputTokens, 0),
        error: `API request failed with HTTP ${response.status}`,
      };
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("API response was not valid JSON");
    }
    const payload = asRecord(decoded);
    if (!payload) throw new Error("API response must be a JSON object");
    const stdout = redactProviderOutput(apiOutputText(api.format, payload));
    const usage =
      apiUsage(api.format, payload) ?? emptyTokenUsage(inputTokens, countTokens(stdout));
    if (usage.outputTokens > maxOutputTokens || countTokens(stdout) > maxOutputTokens) {
      throw new Error(`API output exceeded the ${maxOutputTokens}-token budget`);
    }
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: Date.now() - started,
      tokens: usage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = controller.signal.aborted;
    return {
      exitCode: isTimeout ? 124 : 1,
      stdout: "",
      stderr: safeFailureText(message),
      durationMs: Date.now() - started,
      tokens: emptyTokenUsage(inputTokens, 0),
      error: isTimeout ? `API invocation timed out after ${timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeProviderHeadlessAgent(
  provider: HeadlessProvider,
  request: HeadlessInvocationRequest,
): Promise<HeadlessInvocationResult> {
  const prompt = combinedPrompt(request);
  const inputTokens = countTokens(prompt);
  const maxInputTokens = Math.max(1, request.maxInputTokens ?? 200_000);
  if (inputTokens > maxInputTokens) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 0,
      tokens: emptyTokenUsage(inputTokens, 0),
      error: `Input exceeded the ${maxInputTokens}-token budget`,
    };
  }
  const mode = request.mode ?? (request.api ? "api" : "cli");
  try {
    if (mode === "api") return await invokeApi(provider, request, prompt, inputTokens);
    const result = await invokeCli(provider, request, prompt, inputTokens);
    if (result.tokens.outputTokens > (request.maxOutputTokens ?? 10_000)) {
      return {
        ...result,
        exitCode: 1,
        error: `CLI output exceeded the ${request.maxOutputTokens ?? 10_000}-token budget`,
      };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: safeFailureText(message),
      durationMs: 0,
      tokens: emptyTokenUsage(inputTokens, 0),
      error: message,
    };
  }
}

export type ModelPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachePerMillionUsd: number;
};

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic
  "claude-3-5-sonnet-20241022": {
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
    cachePerMillionUsd: 0.3,
  },
  "claude-3-7-sonnet": {
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
    cachePerMillionUsd: 0.3,
  },
  "claude-3-5-haiku": {
    inputPerMillionUsd: 0.8,
    outputPerMillionUsd: 4.0,
    cachePerMillionUsd: 0.08,
  },
  "claude-3-opus": { inputPerMillionUsd: 15.0, outputPerMillionUsd: 75.0, cachePerMillionUsd: 1.5 },

  // OpenAI
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10.0, cachePerMillionUsd: 1.25 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6, cachePerMillionUsd: 0.075 },
  o1: { inputPerMillionUsd: 15.0, outputPerMillionUsd: 60.0, cachePerMillionUsd: 7.5 },
  "o3-mini": { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4, cachePerMillionUsd: 0.55 },

  // Google Gemini
  "gemini-2.5-pro": {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5.0,
    cachePerMillionUsd: 0.3125,
  },
  "gemini-2.5-flash": {
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3,
    cachePerMillionUsd: 0.01875,
  },
  "gemini-1.5-pro": {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5.0,
    cachePerMillionUsd: 0.3125,
  },
  "gemini-1.5-flash": {
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3,
    cachePerMillionUsd: 0.01875,
  },
};

export const DEFAULT_MODEL_FOR_PROVIDER: Record<ProviderId, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  local: "gpt-4o-mini",
  generic: "gpt-4o",
};

export class DefaultModelProvider implements ModelProvider {
  readonly providerId: ProviderId;
  private readonly customPricing: Map<string, ModelPricing>;

  constructor(
    providerId: ProviderId = "anthropic",
    customPricing: Record<string, ModelPricing> = {},
  ) {
    this.providerId = providerId;
    this.customPricing = new Map(Object.entries(customPricing));
  }

  countTokens(text: string): number {
    return countTokens(text);
  }

  calculateCost(modelId: string, usage: TokenUsage): CostEstimate {
    const pricing = this.customPricing.get(modelId) ||
      MODEL_PRICING_TABLE[modelId] ||
      MODEL_PRICING_TABLE[DEFAULT_MODEL_FOR_PROVIDER[this.providerId]] || {
        inputPerMillionUsd: 3.0,
        outputPerMillionUsd: 15.0,
        cachePerMillionUsd: 0.3,
      };

    const inputUsd = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
    const outputUsd = (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
    const cacheUsd = (usage.cacheReadTokens / 1_000_000) * pricing.cachePerMillionUsd;
    const estimatedTotalUsd = inputUsd + outputUsd + cacheUsd;

    return {
      currency: "USD",
      estimatedTotalUsd: Number(estimatedTotalUsd.toFixed(6)),
      breakdown: {
        inputUsd: Number(inputUsd.toFixed(6)),
        outputUsd: Number(outputUsd.toFixed(6)),
        cacheUsd: Number(cacheUsd.toFixed(6)),
      },
    };
  }
}

export function createModelProvider(
  providerId: ProviderId = "anthropic",
  customPricing: Record<string, ModelPricing> = {},
): ModelProvider {
  return new DefaultModelProvider(providerId, customPricing);
}
