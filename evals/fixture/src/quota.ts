import type { RequestContext } from "./context.ts";
import type { CounterStore } from "./store.ts";
import type { LimitVerdict } from "./rate-limit.ts";

// Daily quota for API-key clients (see docs/QUOTA.md). STUB (task 2):
// currently lets everything through.
export function checkQuota(
  _store: CounterStore,
  _ctx: RequestContext,
  _day: string,
): LimitVerdict {
  return { allowed: true, reason: "ok" };
}
