// Counter store contract. One atomic check-and-increment: the quota
// policy forbids read-then-write.
export type CounterStore = {
  increment(key: string, windowMs: number, nowMs: number): number;
  checkAndIncrement(key: string, limit: number): { allowed: boolean; count: number };
};
