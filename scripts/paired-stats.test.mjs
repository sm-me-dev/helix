import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signTestP, pairCells, compareArms, verdict } from "./paired-stats.mjs";

const cell = (task, arm, run, uncachedTokens, pass = true, extra = {}) => ({
  task,
  arm,
  run,
  pass,
  uncachedTokens,
  invalid: null,
  hung: false,
  ...extra,
});

describe("signTestP (exact, two-sided)", () => {
  it("is 1 with no discordant pairs", () => assert.equal(signTestP(0, 0), 1));
  it("matches the binomial table", () => {
    assert.ok(Math.abs(signTestP(0, 5) - 0.0625) < 1e-9); // 2 * (1/32)
    assert.ok(Math.abs(signTestP(1, 5) - 0.375) < 1e-9);
    assert.ok(Math.abs(signTestP(3, 3) - 0.25) < 1e-9); // all three one way: 2 * (1/8)
  });
});

describe("pairCells", () => {
  it("pairs by task and run and drops pairs where either side is invalid or hung", () => {
    const cells = [
      cell("t", "none", 1, 100),
      cell("t", "x", 1, 80),
      cell("t", "none", 2, 100),
      cell("t", "x", 2, 0, false, { hung: true }),
      cell("t", "none", 3, 100, true, { invalid: "rate-limited" }),
      cell("t", "x", 3, 90),
    ];
    const { pairs, dropped } = pairCells(cells, "none", "x");
    assert.equal(pairs.length, 1);
    assert.equal(dropped, 2);
  });
});

describe("compareArms", () => {
  const mk = (ratio, n = 12) => {
    const cells = [];
    for (let i = 1; i <= n; i++) {
      const base = 20000 + i * 300;
      cells.push(cell("t", "none", i, base), cell("t", "x", i, Math.round(base * ratio)));
    }
    return cells;
  };

  it("detects a consistent 20% saving with a CI below zero", () => {
    const r = compareArms(mk(0.8), "none", "x", { seed: 1 });
    assert.ok(r.tokenChangePct < -15 && r.tokenChangePct > -25, String(r.tokenChangePct));
    assert.ok(r.ciHighPct < 0);
    assert.equal(verdict(r), "saves tokens");
  });

  it("does not claim a win when the arm is noise around the baseline", () => {
    const cells = [];
    const noise = [1.3, 0.7, 1.1, 0.9, 1.4, 0.6, 1.0, 0.8, 1.2, 0.85, 1.15, 0.95];
    noise.forEach((m, i) =>
      cells.push(cell("t", "none", i + 1, 20000), cell("t", "x", i + 1, 20000 * m)),
    );
    const r = compareArms(cells, "none", "x", { seed: 1 });
    assert.equal(verdict(r), "no detectable difference");
  });

  it("never reports a token saving when pass rate dropped significantly", () => {
    const cells = [];
    for (let i = 1; i <= 12; i++) {
      cells.push(cell("t", "none", i, 20000, true), cell("t", "x", i, 5000, false));
    }
    const r = compareArms(cells, "none", "x", { seed: 1 });
    assert.equal(r.passLost, 12);
    assert.equal(verdict(r), "loses passes");
  });

  it("is deterministic for a fixed seed", () => {
    const a = compareArms(mk(0.9), "none", "x", { seed: 7 });
    const b = compareArms(mk(0.9), "none", "x", { seed: 7 });
    assert.deepEqual(a, b);
  });

  it("reports too few pairs instead of a verdict", () => {
    const r = compareArms(mk(0.5, 3), "none", "x", { seed: 1 });
    assert.equal(verdict(r), "too few pairs");
  });
});
