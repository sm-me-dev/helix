import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.ts";
import { checkQuota } from "../src/quota.ts";
import { MemoryStore } from "../src/store/memory-store.ts";

describe("daily quota", () => {
  it("allows the first 1000 requests of the day per key", () => {
    const store = new MemoryStore();
    const ctx = authenticate({ "x-api-key": "key-test-1" });
    let verdict = { allowed: false, reason: "quota" as const };
    for (let i = 0; i < 1000; i++) {
      verdict = checkQuota(store, ctx, "2026-10-07");
    }
    assert.equal(verdict.allowed, true);
  });

  it("refuses request 1001 with reason quota", () => {
    const store = new MemoryStore();
    const ctx = authenticate({ "x-api-key": "key-test-1" });
    let verdict = { allowed: true, reason: "ok" as const };
    for (let i = 0; i < 1001; i++) {
      verdict = checkQuota(store, ctx, "2026-10-07");
    }
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, "quota");
  });

  it("does not quota anonymous clients", () => {
    const store = new MemoryStore();
    const ctx = authenticate({});
    const verdict = checkQuota(store, ctx, "2026-10-07");
    assert.equal(verdict.allowed, true);
  });
});
