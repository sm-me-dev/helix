// Helix URL Sanitizer (Phase 1)
// Applied to every `base_url` before client construction to prevent malformed
// endpoints, accidental suffix pastes, empty-env fallbacks, and token leaks.

function stripInvisibleUnicode(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        (codePoint >= 0x200b && codePoint <= 0x200d) ||
        codePoint === 0xfeff ||
        (codePoint >= 0x2060 && codePoint <= 0x2064) ||
        (codePoint >= 0x206a && codePoint <= 0x206f) ||
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
      );
    })
    .join("");
}

/** Chat-completion-style suffixes accidentally pasted into base_url. */
const PASTED_SUFFIXES = ["/chat/completions", "/responses", "/embeddings", "/models"];

/** Loopback hostnames (case-insensitive, with or without port). */
const LOCALHOST_PATTERN = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0.0|\[::1\])(?::\d+)?$/i;

export type SanitizedBaseUrl = {
  baseUrl: string;
  isLocalhost: boolean;
};

/**
 * Sanitize a base_url before client construction.
 *
 * Rules:
 *  - Trim whitespace and strip invisible Unicode.
 *  - rstrip trailing "/".
 *  - Strip accidentally pasted API suffixes (/chat/completions, /responses,
 *    /embeddings, /models).
 *  - Detect loopback hosts for the localhost synthetic-token rule.
 *
 * Throws SanitizedUrlError when the input is empty/whitespace-only or not an
 * absolute http(s) URL — callers must not silently fall back to OpenAI.
 */
export class SanitizedUrlError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SanitizedUrlError";
    this.code = code;
  }
}

export function sanitizeBaseUrl(raw: string | undefined | null): SanitizedBaseUrl {
  if (raw === undefined || raw === null) {
    throw new SanitizedUrlError("base_url is required but was not provided", "MISSING_BASE_URL");
  }

  let value = stripInvisibleUnicode(raw).trim();

  // Empty / whitespace-only guard: never silently fall back to OpenAI.
  if (value.length === 0) {
    throw new SanitizedUrlError(
      "base_url is empty or whitespace-only; refusing to fall back to OpenAI (token-leak guard)",
      "EMPTY_BASE_URL",
    );
  }

  // Remove trailing slashes before matching a pasted endpoint path.
  value = value.replace(/\/+$/, "");

  // Strip accidentally pasted suffixes (case-insensitive match on the path tail).
  for (const suffix of PASTED_SUFFIXES) {
    if (value.toLowerCase().endsWith(suffix.toLowerCase())) {
      value = value.slice(0, value.length - suffix.length);
    }
  }

  // rstrip trailing "/" (but keep the scheme://host part intact).
  value = value.replace(/\/+$/, "");

  // Must be an absolute http(s) URL after sanitization.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SanitizedUrlError(
      `base_url is not an absolute http(s) URL: ${value}`,
      "INVALID_BASE_URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SanitizedUrlError(
      `base_url must use http or https protocol, got: ${parsed.protocol}`,
      "INVALID_PROTOCOL",
    );
  }

  const isLocalhost = LOCALHOST_PATTERN.test(parsed.hostname);

  return { baseUrl: value, isLocalhost };
}

/**
 * Return the synthetic API key to inject for localhost endpoints when no key
 * is configured. Callers apply this only when isLocalhost && !apiKey.
 */
export const LOCALHOST_SYNTHETIC_API_KEY = "sk-helix-local";

export function isLocalhostBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return LOCALHOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}
