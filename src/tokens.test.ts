import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { breakdown, formatTokens, savingsRatio } from "./tokens.ts";
import type { HarnessConfig } from "./types.ts";

const MINIMAL: HarnessConfig = {
  crew: ["conductor"],
  skills: [],
  mcps: [],
  lsps: [],
  platforms: [],
  graphFirst: false,
  progressiveDisclosure: false,
  defaultSingleAgent: false,
  hooksEnabled: false,
};

describe("breakdown", () => {
  it("sums the always-on parts for a minimal config", () => {
    const b = breakdown(MINIMAL);
    // Bloated AGENTS.md (no progressive disclosure) + conductor index only.
    assert.equal(b.agentsMd, 6400);
    assert.equal(b.crewIndex, 70);
    assert.equal(b.skillIndex, 0);
    assert.equal(b.mcpSchemas, 0);
    assert.equal(b.alwaysOn, 6470);
    assert.equal(b.leanScore, 48);
  });

  it("clamps the lean score to 99 when every bonus applies", () => {
    const b = breakdown({
      ...MINIMAL,
      crew: ["conductor", "scout", "architect", "builder", "prover", "auditor"],
      graphFirst: true,
      progressiveDisclosure: true,
      defaultSingleAgent: true,
      hooksEnabled: true,
    });
    // 48 + 18 + 16 + 10 + 8 + 8 = 108 -> clamped.
    assert.equal(b.leanScore, 99);
  });

  it("penalizes MCP sprawl beyond four", () => {
    const base = breakdown({
      ...MINIMAL,
      mcps: ["graphify", "context7", "playwright", "github"],
    });
    const sprawling = breakdown({
      ...MINIMAL,
      mcps: ["graphify", "context7", "playwright", "github", "serena", "chrome-devtools"],
    });
    assert.equal(sprawling.leanScore, base.leanScore - 16);
  });

  it("keeps the naive baseline independent of lean crew choices", () => {
    const lean = breakdown({
      ...MINIMAL,
      crew: ["conductor", "scout", "architect", "builder", "prover", "auditor"],
      graphFirst: true,
      progressiveDisclosure: true,
    });
    // Bloated doc + full naive schemas regardless of the lean config.
    assert.equal(lean.naiveAlwaysOn, 6400 + 8600 + 4200 + 2400 + lean.lspSchemas);
    assert.ok(lean.naiveAlwaysOn > lean.alwaysOn);
  });
});

describe("formatTokens", () => {
  it("formats sub-thousand counts plainly and thousands with one decimal", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(420), "420");
    assert.equal(formatTokens(1000), "1.0k");
    assert.equal(formatTokens(19420), "19.4k");
    assert.equal(formatTokens(93800), "93.8k");
  });
});

describe("savingsRatio", () => {
  it("exceeds 1 for the minimal config", () => {
    assert.ok(savingsRatio(MINIMAL) > 1);
  });
});
