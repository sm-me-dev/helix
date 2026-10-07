import type { CounterStore } from "../store.ts";

// In-memory counters. Window math is minute-granular; good enough for evals.
export class MemoryStore implements CounterStore {
  private counts = new Map<string, { n: number; resetAt: number }>();

  increment(key: string, windowMs: number, nowMs: number): number {
    const cur = this.counts.get(key);
    if (!cur || nowMs >= cur.resetAt) {
      this.counts.set(key, { n: 1, resetAt: nowMs + windowMs });
      return 1;
    }
    cur.n += 1;
    return cur.n;
  }

  checkAndIncrement(key: string, limit: number): { allowed: boolean; count: number } {
    const cur = this.counts.get(key);
    const count = (cur?.n ?? 0) + 1;
    this.counts.set(key, { n: count, resetAt: cur?.resetAt ?? Number.MAX_SAFE_INTEGER });
    return { allowed: count <= limit, count };
  }
}
