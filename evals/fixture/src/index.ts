import { authenticate } from "./auth.ts";
import { planForApiKey, planLimit } from "./billing.ts";
import { gateway } from "./gateway.ts";
import { checkQuota } from "./quota.ts";
import { checkRateLimit } from "./rate-limit.ts";
import { MemoryStore } from "./store/memory-store.ts";
import { dayString } from "./util/time.ts";

export type HandleResult = { status: number; reason: string };

const store = new MemoryStore();

// Full request path: gateway -> auth -> quota -> rate limit.
export function handleRequest(headers: Record<string, string>, nowMs: number): HandleResult {
  const clean = gateway(headers);
  const ctx = authenticate(clean);
  if (ctx.apiKey) {
    const quota = checkQuota(store, ctx, dayString(nowMs));
    if (!quota.allowed) return { status: 429, reason: quota.reason };
  }
  const verdict = checkRateLimit(store, ctx, clean, nowMs);
  if (!verdict.allowed) return { status: 429, reason: verdict.reason };
  const limit = ctx.apiKey ? planLimit(planForApiKey(ctx.apiKey)) : 40;
  return { status: 200, reason: `ok limit=${limit}` };
}

export { MemoryStore };
