import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countTokens, TOKENIZER_METHOD } from "./measure.ts";

describe("countTokens", () => {
  it("names its method honestly", () => {
    assert.match(TOKENIZER_METHOD, /o200k_base/);
    assert.match(TOKENIZER_METHOD, /approximation/i);
  });

  it("counts zero for empty input", () => {
    assert.equal(countTokens(""), 0);
  });

  it("counts real tokens, not chars/4", () => {
    // "Hello world" is 2 o200k tokens; chars/4 would say ~2.75 -> 3.
    assert.equal(countTokens("Hello world"), 2);
    const body = "# Helix\n\nAlways-on layer. Skills load on demand.\n";
    assert.ok(countTokens(body) > 0 && countTokens(body) < body.length);
  });

  it("is deterministic", () => {
    const s = "Prefer graphify query / path / explain, then Read the cited range.";
    assert.equal(countTokens(s), countTokens(s));
  });
});
