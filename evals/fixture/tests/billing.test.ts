import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planForApiKey, planLimit } from "../src/billing.ts";

describe("billing plans", () => {
  it("maps keys to plans with limits", () => {
    assert.equal(planForApiKey("key-test-2"), "team");
    assert.equal(planLimit("team"), 400);
    assert.equal(planForApiKey("key-test-1"), "free");
    assert.equal(planLimit("free"), 40);
  });
});
