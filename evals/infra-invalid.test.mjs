// 2026-10-11 F6 matrix: 2 of 4 "helix" failures were provider 429s (FreeUsageLimitError),
// 2 were 900s hangs with an empty log. The runner scored all four as agent failures.
// Rate limits are infrastructure (invalid cell, excluded from the pass rate); hangs are
// reported separately because they may be caused by the arm and must not be hidden.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRun, summarize } from "./run.mjs";

const RATE =
  '{"type":"error","error":{"type":"provider.quota","message":"Rate limit exceeded.","status":429}}';

const cell = (over) => ({
  task: "t",
  arm: "helix",
  run: 1,
  pass: true,
  wallSec: 10,
  tokens: 1000,
  uncachedTokens: 100,
  invalid: null,
  hung: false,
  ...over,
});

describe("classifyRun", () => {
  it("flags provider rate limits as invalid, even after partial progress", () => {
    assert.deepEqual(classifyRun({ fullLog: RATE, timedOut: false, tokens: 154135 }), {
      invalid: "rate-limited",
      hung: false,
    });
    assert.deepEqual(classifyRun({ fullLog: "FreeUsageLimitError", timedOut: false, tokens: 0 }), {
      invalid: "rate-limited",
      hung: false,
    });
  });
  it("flags a timeout with no tokens as hung, not invalid", () => {
    assert.deepEqual(classifyRun({ fullLog: "\n", timedOut: true, tokens: 0 }), {
      invalid: null,
      hung: true,
    });
    assert.deepEqual(classifyRun({ fullLog: "\n", timedOut: true, tokens: null }), {
      invalid: null,
      hung: true,
    });
  });
  it("leaves a normal run and a slow-but-working timeout alone", () => {
    assert.deepEqual(classifyRun({ fullLog: "ok", timedOut: false, tokens: 5000 }), {
      invalid: null,
      hung: false,
    });
    assert.deepEqual(classifyRun({ fullLog: "ok", timedOut: true, tokens: 5000 }), {
      invalid: null,
      hung: false,
    });
  });
});

describe("summarize with invalid and hung cells", () => {
  const rows = summarize([
    cell({ run: 1 }),
    cell({ run: 2 }),
    cell({ run: 3, pass: false, invalid: "rate-limited" }),
    cell({ run: 4, pass: false, hung: true, tokens: 0, uncachedTokens: 0, wallSec: 900 }),
  ]);
  const row = rows[0];
  it("excludes invalid cells from runs and pass rate", () => {
    assert.equal(row.invalid, 1);
    assert.equal(row.runs, 3);
    assert.equal(row.passed, 2);
  });
  it("keeps hung runs as failures and counts them", () => {
    assert.equal(row.hung, 1);
  });
  it("does not average zero-token hung or invalid runs into token means", () => {
    assert.equal(row.avgUncached, 100);
    assert.deepEqual(row.rawUncached, [100, 100]);
  });
});
