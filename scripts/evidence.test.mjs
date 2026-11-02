import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderPaired, renderedDoc } from "./render-evidence.mjs";

const stats = [
  {
    arm: "helix-min",
    pooled: {
      armA: "none",
      armB: "helix-min",
      pairs: 24,
      dropped: 0,
      tokenChangePct: -12.3,
      ciLowPct: -20.1,
      ciHighPct: -4.2,
      passBaseline: 24,
      passArm: 24,
      passLost: 0,
      passGained: 0,
      passSignP: 1,
    },
    perTask: [
      {
        task: "deep-bug",
        pairs: 6,
        tokenChangePct: -9.9,
        ciLowPct: -25,
        ciHighPct: 8,
        passLost: 0,
        passGained: 0,
      },
    ],
  },
];

describe("renderPaired", () => {
  it("prints every figure straight from the stats and states the verdict", () => {
    const md = renderPaired(stats, { date: "2026-10-13", agent: "opencode", fixture: "large" });
    assert.match(md, /-12\.3%/);
    assert.match(md, /-20\.1%/);
    assert.match(md, /-4\.2%/);
    assert.match(md, /saves tokens/);
    assert.match(md, /```mermaid/);
    assert.match(md, /helix-min/);
  });

  it("says plainly when nothing has been run", () => {
    assert.match(renderPaired(null, {}), /No paired run has been recorded/);
  });

  it("never prints a verdict of 'saves tokens' for an interval that crosses zero", () => {
    const crossing = structuredClone(stats);
    crossing[0].pooled.ciHighPct = 3.1;
    assert.doesNotMatch(renderPaired(crossing, {}), /saves tokens/);
    assert.match(renderPaired(crossing, {}), /no detectable difference/);
  });
});

describe("docs/EVIDENCE.md", () => {
  it("is exactly what the renderer produces from the committed result files", () => {
    assert.equal(
      readFileSync(new URL("../docs/EVIDENCE.md", import.meta.url), "utf8"),
      renderedDoc(),
    );
  });
});
