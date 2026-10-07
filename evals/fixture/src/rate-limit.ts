import type { RequestContext } from "./context.ts";
import type { CounterStore } from "./store.ts";

export type LimitVerdict = { allowed: boolean; reason: "ok" | "rate" | "quota" };

// BUG (task 1): branches on the X-Client-Class header, which the gateway
// strips. Authenticated requests therefore fall into the anonymous bucket.
// The fix reads ctx.limiterClass instead of the header.
export function checkRateLimit(
  store: CounterStore,
  ctx: RequestContext,
  headers: Record<string, string>,
  nowMs: number,
): LimitVerdict {
  const cls = headers["x-client-class"] === "auth" ? "auth" : "public";
  const limit = cls === "auth" ? 80 : 40;
  const key = cls === "auth" ? `rate:${ctx.apiKey ?? "anon"}` : "rate:anon";
  const count = store.increment(key, 60_000, nowMs);
  return count > limit ? { allowed: false, reason: "rate" } : { allowed: true, reason: "ok" };
}
