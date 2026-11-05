import { LOCALHOST_SYNTHETIC_API_KEY, sanitizeBaseUrl } from "../url-sanitizer.ts";
import type { ProviderClientConfig } from "./llm-client.ts";

/** Validate and normalize endpoint configuration at the client boundary. */
export function normalizeProviderClientConfig(config: ProviderClientConfig): ProviderClientConfig {
  if (!config.baseUrl) return config;
  const sanitized = sanitizeBaseUrl(config.baseUrl);
  return {
    ...config,
    baseUrl: sanitized.baseUrl,
    apiKey: sanitized.isLocalhost && !config.apiKey ? LOCALHOST_SYNTHETIC_API_KEY : config.apiKey,
  };
}
