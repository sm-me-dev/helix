import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.ts";
import { checkRateLimit } from "../src/rate-limit.ts";
import { MemoryStore } from "../src/store/memory-store.ts";

describe("rate limiter", () => {
  it("lets an authenticated API-key client past the anonymous ceiling", () => {
    const store = new MemoryStore();
    const ctx = authenticate({ "x-api-key": "key-test-1" });
    assert.equal(ctx.user, "alice");
    let verdict = { allowed: true, reason: "ok" as const };
    for (let i = 0; i < 41; i++) {
      verdict = checkRateLimit(store, ctx, {}, 1_000_000);
    }
    assert.equal(verdict.allowed, true);
  });

  it("still caps anonymous clients at 40/min", () => {
    const store = new MemoryStore();
    const ctx = authenticate({});
    let verdict = { allowed: true, reason: "ok" as const };
    for (let i = 0; i < 41; i++) {
      verdict = checkRateLimit(store, ctx, {}, 1_000_000);
    }
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, "rate");
  });
});
