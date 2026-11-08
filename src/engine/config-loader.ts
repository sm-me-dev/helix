// Helix Five-Layer AI Provider Configuration Loader (Phase 1)
// Precedence (highest → lowest):
//   1. Runtime session overrides from TUI/Web (/model, /provider)
//   2. CLI flags (--provider/--base-url/--api-key/--model)
//   3. Env HELIX_AI_BASE_URL/HELIX_AI_API_KEY (fallback OPENAI_BASE_URL/OPENAI_API_KEY;
//      deprecated OPENAI_API_BASE → HELIX_AI_BASE_URL with warning)
//   4. Workspace .helix/config.toml (Trusted Workspaces guard for custom base_url /
//      shell hook / MCP server — requires explicit confirmation)
//   5. Global ~/.config/helix/providers.toml (named provider profiles,
//      api_key_env/base_url_env indirection, default_headers)

import { parse as parseToml } from "toml";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sanitizeBaseUrl,
  SanitizedUrlError,
  type SanitizedBaseUrl,
  LOCALHOST_SYNTHETIC_API_KEY,
} from "./url-sanitizer.ts";
import type { ProviderId } from "./types.ts";

// ══════════════════════════════════════════════════════════════════════════════
// Layer input types
// ══════════════════════════════════════════════════════════════════════════════

export type RuntimeSessionOverrides = {
  provider?: ProviderId;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type CliFlags = {
  provider?: ProviderId;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type GlobalProviderProfile = {
  provider?: ProviderId;
  base_url?: string;
  base_url_env?: string;
  api_key?: string;
  api_key_env?: string;
  default_headers?: Record<string, string>;
  model?: string;
};

export type GlobalProvidersToml = {
  providers?: Record<string, GlobalProviderProfile>;
  default_provider?: string;
};

export type GlobalProviderProfileSummary = {
  name: string;
  provider: ProviderId;
  base_url?: string;
  model?: string;
  default_header_names: string[];
  has_api_key: boolean;
  is_default: boolean;
};

export type WorkspaceConfigToml = {
  provider?: ProviderId;
  model?: string;
  base_url?: string;
  api_key?: string;
  shell_hook?: string;
  mcp_servers?: Record<string, unknown>;
  // Trust-sensitive raw keys present in the file
  _hasCustomBaseUrl?: boolean;
  _hasShellHook?: boolean;
  _hasMcpServers?: boolean;
};

export type TrustCheck = {
  required: boolean;
  reason?: string;
};

export type AiConfigSource = "runtime" | "cli" | "env" | "workspace" | "global" | "default";

export type ResolvedAiConfig = {
  providerId: ProviderId;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  source: AiConfigSource; // which layer ultimately provided the winning value
};

export type AiConfigLoadResult = {
  config: ResolvedAiConfig;
  trustRequired: boolean;
  trustReason?: string;
  warnings: string[];
  layerTrace: Array<{
    layer: number;
    name: string;
    applied: boolean;
    values: Record<string, unknown>;
  }>;
};

// Default provider when nothing is configured anywhere.
const DEFAULT_PROVIDER: ProviderId = "anthropic";
const DEFAULT_MODEL: string = "claude-3-5-sonnet-20241022";

// ══════════════════════════════════════════════════════════════════════════════
// Pure merge: highest precedence wins. Exported for unit testing without
// touching the filesystem or environment.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Merge candidate partial configs in precedence order (later = higher priority).
 * Returns the winning value per field plus the source layer that provided it.
 */
function mergeLayers<C extends Record<string, unknown>>(
  layers: Array<{ name: string; priority: number; values: C }>,
): { merged: C; sources: Record<string, string> } {
  // Apply lowest precedence first so each higher-priority layer overwrites it.
  const ordered = [...layers].sort((a, b) => b.priority - a.priority);
  const merged: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const layer of ordered) {
    for (const [key, value] of Object.entries(layer.values)) {
      if (value !== undefined && value !== null && value !== "") {
        merged[key] = value;
        sources[key] = layer.name;
      }
    }
  }
  return { merged: merged as C, sources };
}

// ══════════════════════════════════════════════════════════════════════════════
// Layer readers
// ══════════════════════════════════════════════════════════════════════════════

function readLayer5Global(homedir: string = os.homedir()): {
  config: GlobalProvidersToml;
  warnings: string[];
} {
  const warnings: string[] = [];
  const filePath = path.join(homedir, ".config", "helix", "providers.toml");
  if (!fs.existsSync(filePath)) {
    return { config: {}, warnings };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseToml(raw) as GlobalProvidersToml;
    return { config: parsed, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse global providers.toml ${filePath}: ${msg}`);
    return { config: {}, warnings };
  }
}

/** Read profile metadata for local UI clients without returning credentials or header values. */
export function listGlobalProviderProfiles(
  options: {
    homedir?: string;
    env?: Record<string, string | undefined>;
  } = {},
): GlobalProviderProfileSummary[] {
  const home = options.homedir ?? os.homedir();
  const env = options.env ?? process.env;
  const { config } = readLayer5Global(home);
  return Object.entries(config.providers ?? {}).map(([name, profile]) => ({
    name,
    provider: profile.provider ?? "generic",
    base_url: redactProfileBaseUrl(
      profile.base_url ?? (profile.base_url_env ? env[profile.base_url_env] : undefined),
    ),
    model: profile.model,
    default_header_names: Object.keys(profile.default_headers ?? {}),
    has_api_key: Boolean(profile.api_key || (profile.api_key_env && env[profile.api_key_env])),
    is_default: config.default_provider === name,
  }));
}

function redactProfileBaseUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** Resolve a saved profile for daemon-side verification without exposing it over HTTP. */
export function getGlobalProviderProfile(
  name: string,
  options: { homedir?: string } = {},
): GlobalProviderProfile | undefined {
  const { config } = readLayer5Global(options.homedir ?? os.homedir());
  return config.providers?.[name];
}

function readLayer4Workspace(workspaceRoot: string): {
  config: WorkspaceConfigToml;
  trustCheck: TrustCheck;
  warnings: string[];
} {
  const warnings: string[] = [];
  const trustCheck: TrustCheck = { required: false };
  const filePath = path.join(workspaceRoot, ".helix", "config.toml");
  if (!fs.existsSync(filePath)) {
    return { config: {}, trustCheck, warnings };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseToml(raw) as WorkspaceConfigToml;

    // Trusted Workspaces guard: sensitive keys require explicit confirmation.
    const hasCustomBaseUrl =
      typeof parsed.base_url === "string" && parsed.base_url.trim().length > 0;
    const hasShellHook =
      typeof parsed.shell_hook === "string" && parsed.shell_hook.trim().length > 0;
    const hasMcpServers =
      parsed.mcp_servers !== undefined &&
      typeof parsed.mcp_servers === "object" &&
      Object.keys(parsed.mcp_servers).length > 0;

    parsed._hasCustomBaseUrl = hasCustomBaseUrl;
    parsed._hasShellHook = hasShellHook;
    parsed._hasMcpServers = hasMcpServers;

    if (hasCustomBaseUrl || hasShellHook || hasMcpServers) {
      trustCheck.required = true;
      trustCheck.reason =
        "Workspace .helix/config.toml defines custom base_url, shell_hook, or mcp_servers; " +
        "explicit user confirmation required before loading (credential-exfiltration guard).";
    }

    return { config: parsed, trustCheck, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse workspace config.toml ${filePath}: ${msg}`);
    return { config: {}, trustCheck, warnings };
  }
}

function readLayer3Env(env: Record<string, string | undefined> = process.env): {
  config: Partial<ResolvedAiConfig>;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Deprecated alias: OPENAI_API_BASE → HELIX_AI_BASE_URL (with warning).
  const openaiApiBase = env.OPENAI_API_BASE;
  if (openaiApiBase && openaiApiBase.trim().length > 0) {
    if (!env.HELIX_AI_BASE_URL || env.HELIX_AI_BASE_URL.trim().length === 0) {
      warnings.push(
        "Deprecated OPENAI_API_BASE detected; treating as HELIX_AI_BASE_URL. Set HELIX_AI_BASE_URL instead.",
      );
    }
  }

  const customProviderSelected = Boolean(env.HELIX_AI_PROVIDER?.trim());
  const explicitBaseUrl = env.HELIX_AI_BASE_URL ?? env.OPENAI_BASE_URL;
  if (
    customProviderSelected &&
    explicitBaseUrl !== undefined &&
    explicitBaseUrl.trim().length === 0
  ) {
    throw new SanitizedUrlError(
      "HELIX_AI_BASE_URL/OPENAI_BASE_URL is empty or whitespace-only for a custom provider; refusing to fall back to OpenAI (token-leak guard)",
      "EMPTY_BASE_URL",
    );
  }

  const baseUrl =
    env.HELIX_AI_BASE_URL?.trim() ||
    env.OPENAI_BASE_URL?.trim() ||
    (openaiApiBase && openaiApiBase.trim().length > 0 ? openaiApiBase.trim() : undefined) ||
    undefined;

  const apiKey = env.HELIX_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;

  const provider = env.HELIX_AI_PROVIDER?.trim() as ProviderId | undefined;
  const model = env.HELIX_AI_MODEL?.trim() || undefined;

  return {
    config: {
      ...(provider ? { providerId: provider } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(model ? { model } : {}),
    },
    warnings,
  };
}

function applyUrlSanitization(config: Partial<ResolvedAiConfig>): {
  config: Partial<ResolvedAiConfig>;
  warnings: string[];
  localhostSyntheticKeyApplied: boolean;
} {
  const warnings: string[] = [];
  let localhostSyntheticKeyApplied = false;

  if (config.baseUrl) {
    try {
      const sanitized: SanitizedBaseUrl = sanitizeBaseUrl(config.baseUrl);
      config.baseUrl = sanitized.baseUrl;

      // Localhost synthetic token: inject when no API key configured.
      if (sanitized.isLocalhost && !config.apiKey) {
        config.apiKey = LOCALHOST_SYNTHETIC_API_KEY;
        localhostSyntheticKeyApplied = true;
        warnings.push(
          `Localhost base_url detected with no API key; injected synthetic key "${LOCALHOST_SYNTHETIC_API_KEY}".`,
        );
      }
    } catch (err) {
      if (err instanceof SanitizedUrlError) {
        // Re-throw validation errors so callers can surface them clearly.
        throw err;
      }
      warnings.push(
        `URL sanitization warning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { config, warnings, localhostSyntheticKeyApplied };
}

// ══════════════════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════════════════

export type LoadAiConfigOptions = {
  workspaceRoot?: string;
  runtime?: RuntimeSessionOverrides;
  cli?: CliFlags;
  env?: Record<string, string | undefined>;
  homedir?: string;
  /** Set to true to bypass the Trusted Workspaces confirmation requirement. */
  trustConfirmed?: boolean;
};

/**
 * Load AI provider configuration across all five layers.
 *
 * Throws SanitizedUrlError if a base_url from any layer fails sanitization
 * (e.g. empty env var when a custom provider is selected).
 *
 * Returns trustRequired = true when the workspace config defines sensitive
 * keys and trustConfirmed is false — callers must obtain confirmation before
 * using the returned config.
 */
export function loadAiConfig(options: LoadAiConfigOptions = {}): AiConfigLoadResult {
  const {
    workspaceRoot = process.cwd(),
    runtime = {},
    cli = {},
    env = process.env,
    homedir = os.homedir(),
    trustConfirmed = false,
  } = options;

  const warnings: string[] = [];
  const layerTrace: Array<{
    layer: number;
    name: string;
    applied: boolean;
    values: Record<string, unknown>;
  }> = [];

  // ── Layer 5: global providers.toml (lowest precedence) ──
  const { config: globalConfig, warnings: gWarnings } = readLayer5Global(homedir);
  warnings.push(...gWarnings);
  const globalValues: Record<string, unknown> = {};
  if (globalConfig.default_provider) globalValues.providerId = globalConfig.default_provider;
  if (globalConfig.providers) {
    const defaultProfileName = globalConfig.default_provider;
    const profile =
      defaultProfileName && globalConfig.providers[defaultProfileName]
        ? globalConfig.providers[defaultProfileName]
        : undefined;
    if (profile) {
      globalValues.providerId = profile.provider ?? "generic";
      if (profile.base_url) globalValues.baseUrl = profile.base_url;
      if (profile.api_key) globalValues.apiKey = profile.api_key;
      if (profile.model) globalValues.model = profile.model;
      if (profile.default_headers) globalValues.defaultHeaders = profile.default_headers;
      // Env indirection: api_key_env / base_url_env
      if (profile.api_key_env && env[profile.api_key_env]) {
        globalValues.apiKey = env[profile.api_key_env];
      }
      if (profile.base_url_env && env[profile.base_url_env]) {
        globalValues.baseUrl = env[profile.base_url_env];
      }
    }
  }
  layerTrace.push({
    layer: 5,
    name: "global ~/.config/helix/providers.toml",
    applied: true,
    values: globalValues,
  });

  // ── Layer 4: workspace .helix/config.toml ──
  const {
    config: workspaceConfig,
    trustCheck,
    warnings: wWarnings,
  } = readLayer4Workspace(workspaceRoot);
  warnings.push(...wWarnings);

  let workspaceApplied = false;
  const workspaceValues: Record<string, unknown> = {};
  if (trustCheck.required && !trustConfirmed) {
    // Do not apply workspace config; flag trust requirement.
    layerTrace.push({
      layer: 4,
      name: "workspace .helix/config.toml",
      applied: false,
      values: {},
    });
  } else {
    workspaceApplied = true;
    if (workspaceConfig.provider) workspaceValues.providerId = workspaceConfig.provider;
    if (workspaceConfig.model) workspaceValues.model = workspaceConfig.model;
    if (workspaceConfig.base_url) workspaceValues.baseUrl = workspaceConfig.base_url;
    if (workspaceConfig.api_key) workspaceValues.apiKey = workspaceConfig.api_key;
    layerTrace.push({
      layer: 4,
      name: "workspace .helix/config.toml",
      applied: true,
      values: workspaceValues,
    });
  }

  // ── Layer 3: env vars ──
  const { config: envConfig, warnings: eWarnings } = readLayer3Env(env);
  warnings.push(...eWarnings);
  const envValues: Record<string, unknown> = {};
  if (envConfig.providerId) envValues.providerId = envConfig.providerId;
  if (envConfig.baseUrl) envValues.baseUrl = envConfig.baseUrl;
  if (envConfig.apiKey) envValues.apiKey = envConfig.apiKey;
  if (envConfig.model) envValues.model = envConfig.model;
  layerTrace.push({ layer: 3, name: "environment variables", applied: true, values: envValues });

  // ── Layer 2: CLI flags ──
  const cliValues: Record<string, unknown> = {};
  if (cli.provider) cliValues.providerId = cli.provider;
  if (cli.model) cliValues.model = cli.model;
  if (cli.baseUrl) cliValues.baseUrl = cli.baseUrl;
  if (cli.apiKey) cliValues.apiKey = cli.apiKey;
  layerTrace.push({ layer: 2, name: "CLI flags", applied: true, values: cliValues });

  // ── Layer 1: runtime session overrides (highest precedence) ──
  const runtimeValues: Record<string, unknown> = {};
  if (runtime.provider) runtimeValues.providerId = runtime.provider;
  if (runtime.model) runtimeValues.model = runtime.model;
  if (runtime.baseUrl) runtimeValues.baseUrl = runtime.baseUrl;
  if (runtime.apiKey) runtimeValues.apiKey = runtime.apiKey;
  layerTrace.push({
    layer: 1,
    name: "runtime session overrides",
    applied: true,
    values: runtimeValues,
  });

  // ── Merge: priority 1 = highest. Layer order for merge (lowest first). ──
  const { merged, sources } = mergeLayers([
    { name: "global", priority: 5, values: globalValues },
    { name: "workspace", priority: 4, values: workspaceApplied ? workspaceValues : {} },
    { name: "env", priority: 3, values: envValues },
    { name: "cli", priority: 2, values: cliValues },
    { name: "runtime", priority: 1, values: runtimeValues },
  ]);

  // ── Apply defaults ──
  if (!merged.providerId) merged.providerId = DEFAULT_PROVIDER;
  if (!merged.model) merged.model = DEFAULT_MODEL;
  if (!sources.providerId) sources.providerId = "default";
  if (!sources.model) sources.model = "default";

  // ── URL sanitization (applied to the merged base_url) ──
  const { config: sanitizedConfig, warnings: sWarnings } = applyUrlSanitization(
    merged as Partial<ResolvedAiConfig>,
  );
  warnings.push(...sWarnings);

  const sourceForField = (field: keyof ResolvedAiConfig): AiConfigSource => {
    const s = sources[field];
    switch (s) {
      case "runtime":
        return "runtime";
      case "cli":
        return "cli";
      case "env":
        return "env";
      case "workspace":
        return "workspace";
      case "global":
        return "global";
      default:
        return "default";
    }
  };

  const config: ResolvedAiConfig = {
    providerId: sanitizedConfig.providerId as ProviderId,
    model: sanitizedConfig.model as string | undefined,
    baseUrl: sanitizedConfig.baseUrl as string | undefined,
    apiKey: sanitizedConfig.apiKey as string | undefined,
    defaultHeaders: sanitizedConfig.defaultHeaders as Record<string, string> | undefined,
    source: sourceForField("baseUrl") ?? sourceForField("providerId"),
  };

  return {
    config,
    trustRequired: trustCheckRequired(workspaceConfig, trustConfirmed),
    trustReason: trustCheck.required ? trustCheck.reason : undefined,
    warnings,
    layerTrace,
  };
}

function trustCheckRequired(
  workspaceConfig: WorkspaceConfigToml,
  trustConfirmed: boolean,
): boolean {
  if (trustConfirmed) return false;
  return Boolean(
    workspaceConfig._hasCustomBaseUrl ||
    workspaceConfig._hasShellHook ||
    workspaceConfig._hasMcpServers,
  );
}

/**
 * Convenience: resolve a base_url through the sanitizer standalone (for tests
 * and for doctor handshakes). Throws SanitizedUrlError on invalid input.
 */
export function resolveAndSanitizeBaseUrl(raw: string | undefined | null): SanitizedBaseUrl {
  return sanitizeBaseUrl(raw);
}

/** Persist a named provider profile to the user's global TOML configuration. */
export function saveGlobalProviderProfile(
  name: string,
  profile: GlobalProviderProfile,
  options: { homedir?: string; makeDefault?: boolean } = {},
): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name))
    throw new Error("Provider profile name must use letters, numbers, _ or -");
  const home = options.homedir ?? os.homedir();
  const directory = path.join(home, ".config", "helix");
  const filePath = path.join(directory, "providers.toml");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  let current: GlobalProvidersToml = {};
  if (fs.existsSync(filePath)) {
    current = parseToml(fs.readFileSync(filePath, "utf8")) as GlobalProvidersToml;
  }
  const providers = {
    ...(current.providers ?? {}),
    [name]: { ...(current.providers?.[name] ?? {}), ...profile },
  };
  const lines: string[] = [];
  const defaultProvider = options.makeDefault ? name : current.default_provider;
  if (defaultProvider) lines.push(`default_provider = ${JSON.stringify(defaultProvider)}`, "");
  for (const [providerName, entry] of Object.entries(providers)) {
    lines.push(`[providers.${providerName}]`);
    for (const key of [
      "provider",
      "base_url",
      "base_url_env",
      "api_key",
      "api_key_env",
      "model",
    ] as const) {
      const value = entry[key];
      if (value !== undefined) lines.push(`${key} = ${JSON.stringify(value)}`);
    }
    const headers = entry.default_headers;
    if (headers && Object.keys(headers).length > 0) {
      lines.push("", `[providers.${providerName}.default_headers]`);
      for (const [key, value] of Object.entries(headers))
        lines.push(`${JSON.stringify(key)} = ${JSON.stringify(value)}`);
    }
    lines.push("");
  }
  fs.writeFileSync(filePath, `${lines.join("\n").trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

export { LOCALHOST_SYNTHETIC_API_KEY };
