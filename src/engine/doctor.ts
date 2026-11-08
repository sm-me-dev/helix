// Helix AI Provider Doctor (Phase 1)
// Two-stage handshake to verify an AI endpoint:
//   1. GET {base_url}/models — verify auth + populate model list
//   2. On 404/405, fallback 1-token POST {base_url}/chat/completions probe
// Returns structured diagnostics: HTTP status, latency, raw error body,
// remediation hint.

import { LLMClientError, type LLMClient } from "./providers/llm-client.ts";
import { sanitizeBaseUrl, type SanitizedBaseUrl } from "./url-sanitizer.ts";
import { buildHeaders } from "./providers/transport.ts";

export type DoctorDiagnostic = {
  stage: "models" | "completions-probe" | "resolved";
  baseUrl: string;
  endpoint: string;
  method: string;
  status?: number;
  latencyMs: number;
  ok: boolean;
  rawBody?: string;
  models?: Array<{ id: string; object?: string; created?: number; ownedBy?: string }>;
  remediationHint?: string;
  error?: string;
};

export type DoctorResult = {
  ok: boolean;
  baseUrl: string;
  sanitized: SanitizedBaseUrl;
  diagnostics: DoctorDiagnostic[];
  models: Array<{ id: string; object?: string; created?: number; ownedBy?: string }>;
  remediationHint?: string;
};

/**
 * Run the two-stage doctor handshake against an LLM client's endpoint.
 * Falls back to a 1-token completions probe when /models returns 404/405.
 */
export async function doctorHandshake(
  client: LLMClient,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorResult> {
  const baseUrl = client.config.baseUrl ?? "";
  const diagnostics: DoctorDiagnostic[] = [];
  const models: Array<{ id: string; object?: string; created?: number; ownedBy?: string }> = [];
  let remediationHint: string | undefined;

  // Sanitize + record the base_url being tested.
  let sanitized: SanitizedBaseUrl;
  try {
    sanitized = sanitizeBaseUrl(baseUrl || undefined);
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      sanitized: { baseUrl: baseUrl ?? "", isLocalhost: false },
      diagnostics: [
        {
          stage: "models",
          baseUrl,
          endpoint: baseUrl ?? "",
          method: "GET",
          status: undefined,
          latencyMs: 0,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          remediationHint: "Provide a valid http(s) base_url via HELIX_AI_BASE_URL or --base-url.",
        },
      ],
      models: [],
      remediationHint: "Fix the base_url before running the doctor handshake.",
    };
  }

  const modelsEndpoint = sanitized.baseUrl.endsWith("/")
    ? `${sanitized.baseUrl}models`
    : `${sanitized.baseUrl}/models`;

  // ── Stage 1: GET {base_url}/models ──
  const modelsDiag = await probeEndpoint(
    "models",
    sanitized.baseUrl,
    modelsEndpoint,
    "GET",
    client,
    fetcher,
  );
  diagnostics.push(modelsDiag);

  if (modelsDiag.ok && modelsDiag.models) {
    models.push(...modelsDiag.models);
    return {
      ok: true,
      baseUrl: sanitized.baseUrl,
      sanitized,
      diagnostics,
      models,
      remediationHint: undefined,
    };
  }

  // ── Stage 2: fallback 1-token POST {base_url}/chat/completions probe ──
  // Only on 404/405 (endpoint not found / method not allowed).
  const shouldFallback = modelsDiag.status === 404 || modelsDiag.status === 405;

  if (shouldFallback) {
    const completionsEndpoint = chatCompletionsUrl(sanitized.baseUrl);
    const t0 = Date.now();
    let status: number | undefined;
    let rawBody: string | undefined;
    let ok = false;
    let error: string | undefined;

    try {
      const headers = buildHeaders(client.config);

      const res = await fetcher(completionsEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: client.config.defaultModel ?? "probe",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      rawBody = await res.text().catch(() => "");
      ok = res.ok;

      if (!ok) {
        error = `HTTP ${res.status}: ${rawBody.slice(0, 500)}`;
      }
    } catch (err) {
      status = undefined;
      error = err instanceof Error ? err.message : String(err);
      ok = false;
    }

    const probeDiag: DoctorDiagnostic = {
      stage: "completions-probe",
      baseUrl: sanitized.baseUrl,
      endpoint: completionsEndpoint,
      method: "POST",
      status,
      latencyMs: Date.now() - t0,
      ok,
      rawBody: rawBody ? rawBody.slice(0, 1000) : undefined,
      error,
    };

    // Build remediation hint based on what we observed.
    if (status === 401 || status === 403) {
      probeDiag.remediationHint =
        "Authentication failed: verify HELIX_AI_API_KEY (or OPENAI_API_KEY) is set correctly.";
      remediationHint = probeDiag.remediationHint;
    } else if (status === 404) {
      probeDiag.remediationHint =
        "chat/completions endpoint not found: verify base_url points at the API root (not a specific endpoint path).";
      remediationHint = probeDiag.remediationHint;
    } else if (status === 405) {
      probeDiag.remediationHint =
        "Method not allowed on chat/completions: this endpoint may not support completions.";
      remediationHint = probeDiag.remediationHint;
    } else if (ok) {
      probeDiag.remediationHint = "Endpoint reachable and accepts completions.";
      remediationHint = probeDiag.remediationHint;
    } else {
      probeDiag.remediationHint =
        "Could not reach the endpoint: check base_url, network, and API key.";
      remediationHint = probeDiag.remediationHint;
    }

    diagnostics.push(probeDiag);
  }

  return {
    ok: models.length > 0 || diagnostics.some((d) => d.ok),
    baseUrl: sanitized.baseUrl,
    sanitized,
    diagnostics,
    models,
    remediationHint,
  };
}

/**
 * Probe a single endpoint via the client's listModels (GET /models) or a raw
 * fetch, capturing status/latency/body.
 */
async function probeEndpoint(
  stage: DoctorDiagnostic["stage"],
  baseUrl: string,
  endpoint: string,
  method: string,
  client: LLMClient,
  fetcher: typeof globalThis.fetch,
): Promise<DoctorDiagnostic> {
  const t0 = Date.now();
  try {
    const res = await fetcher(endpoint, {
      method,
      headers: buildHeaders(client.config),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text().catch(() => "");
    let models: DoctorDiagnostic["models"];
    if (res.ok && stage === "models") {
      try {
        const parsed = JSON.parse(body) as { data?: unknown[] };
        models = (parsed.data ?? [])
          .filter(
            (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
          )
          .map((item) => ({
            id: typeof item.id === "string" ? item.id : String(item.id ?? ""),
            object: typeof item.object === "string" ? item.object : undefined,
            created: typeof item.created === "number" ? item.created : undefined,
            ownedBy: typeof item.owned_by === "string" ? item.owned_by : undefined,
          }))
          .filter((item) => item.id.length > 0);
      } catch {
        models = [];
      }
    }
    return {
      stage,
      baseUrl,
      endpoint,
      method,
      status: res.status,
      latencyMs: Date.now() - t0,
      ok: res.ok,
      models,
      rawBody: body.slice(0, 1000),
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    const status = err instanceof LLMClientError ? err.status : undefined;
    return {
      stage,
      baseUrl,
      endpoint,
      method,
      status,
      latencyMs: Date.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      remediationHint:
        status === 404 || status === 405
          ? "Fallback to completions probe will be attempted."
          : status === 401 || status === 403
            ? "Authentication failed: verify HELIX_AI_API_KEY (or OPENAI_API_KEY) is set correctly."
            : "Check base_url and network connectivity.",
    };
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}
