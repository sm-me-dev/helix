// Edge gateway. Strips headers it does not recognize — including the
// X-Client-Class header the old limiter trusted. This is load-bearing
// context for the LED-style bug: anything downstream must read the
// RequestContext, not headers.
const KNOWN_HEADERS = new Set(["x-api-key", "content-type", "authorization"]);

export function gateway(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (KNOWN_HEADERS.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  }
  return out;
}
