import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOATED_AGENTS_MD } from "../../../fixtures/baseline/bloated-agents-md.ts";
import {
  TYPICAL_MCP_SCHEMAS,
  TYPICAL_MCP_TOOL_COUNT,
} from "../../../fixtures/baseline/fifteen-mcp-schemas.ts";
import { agentsMd } from "./generate.ts";
import { countTokens } from "./measure.ts";
import { breakdown, formatTokens, savingsRatio } from "./tokens.ts";
import type { HarnessConfig } from "./types.ts";

const MINIMAL: HarnessConfig = {
  crew: [],
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
  it("computes every part from generated output, not constants", () => {
    const b = breakdown(MINIMAL);
    assert.equal(b.agentsMd, countTokens(agentsMd(MINIMAL)));
    assert.equal(b.skillIndex, 0);
    assert.equal(b.mcpSchemas, 0);
    assert.equal(b.crewIndex, 0);
    assert.equal(b.alwaysOn, b.agentsMd);
    assert.match(b.method, /o200k_base/);
  });

  it("derives the naive baseline from committed fixtures", () => {
    const b = breakdown(MINIMAL);
    assert.ok(b.naiveAlwaysOn >= countTokens(BLOATED_AGENTS_MD) + countTokens(TYPICAL_MCP_SCHEMAS));
    const tools = JSON.parse(TYPICAL_MCP_SCHEMAS) as { server: string; name: string }[];
    assert.equal(tools.length, TYPICAL_MCP_TOOL_COUNT);
    assert.ok(TYPICAL_MCP_TOOL_COUNT > 100, "composite should carry 100+ tools");
    assert.equal(new Set(tools.map((t) => t.server)).size, 15);
    assert.ok(b.naiveAlwaysOn > b.alwaysOn);
    assert.ok(
      b.estimates.some((e) => e.includes("fixtures/baseline")),
      "fixture provenance must be disclosed",
    );
  });

  it("uses the real captured playwright tool names in the composite", async () => {
    const { readFile } = await import("node:fs/promises");
    const captured = JSON.parse(
      await readFile("fixtures/captures/playwright.tools.json", "utf8"),
    ) as { tools: { name: string }[] };
    const tools = JSON.parse(TYPICAL_MCP_SCHEMAS) as { server: string; name: string }[];
    const composite = tools
      .filter((t) => t.server === "playwright-real")
      .map((t) => t.name)
      .sort();
    const real = captured.tools.map((t) => t.name).sort();
    assert.deepEqual(composite, real);
  });

  it("flags catalog estimates instead of hiding them", () => {
    const b = breakdown({ ...MINIMAL, mcps: ["github"], lsps: ["typescript"] });
    assert.ok(b.estimates.some((e) => e.includes("github")));
    assert.ok(b.estimates.some((e) => e.includes("LSP")));
    assert.ok(b.checks.some((c) => c.id === "mcp-measured" && !c.pass));
  });

  it("derives leanScore from passing checks only", () => {
    const b = breakdown(MINIMAL);
    assert.equal(b.checks.length, 5);
    const passed = b.checks.filter((c) => c.pass).length;
    assert.equal(b.leanScore, Math.round((100 * passed) / b.checks.length));
    assert.ok(b.checks.some((c) => c.id === "no-duplicates" && c.pass));
  });

  it("fails the MCP-count check past five servers", () => {
    const base = breakdown({
      ...MINIMAL,
      mcps: ["graphify", "context7", "playwright", "github"],
    });
    const sprawling = breakdown({
      ...MINIMAL,
      mcps: ["graphify", "context7", "playwright", "github", "serena", "chrome-devtools"],
    });
    assert.ok(base.checks.find((c) => c.id === "mcp-count")?.pass);
    assert.ok(!sprawling.checks.find((c) => c.id === "mcp-count")?.pass);
    assert.ok(sprawling.leanScore < base.leanScore);
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
