import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.ts";
import { anonymousContext } from "../src/context.ts";

describe("request context", () => {
  it("stamps the user for a known API key", () => {
    const ctx = authenticate({ "x-api-key": "key-test-2" });
    assert.equal(ctx.user, "bob");
    assert.equal(ctx.apiKey, "key-test-2");
  });

  it("stays anonymous without a key", () => {
    assert.deepEqual(authenticate({}), anonymousContext());
  });

  it("stays anonymous for an unknown key", () => {
    const ctx = authenticate({ "x-api-key": "key-nope" });
    assert.equal(ctx.user, null);
  });
});
