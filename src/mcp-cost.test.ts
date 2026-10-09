import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mcpCostByPlatform, MCP_DEFERRAL } from "./mcp-cost.ts";
import { breakdown } from "./tokens.ts";
import type { HarnessConfig } from "./types";

const cfg: HarnessConfig = {
  crew: [],
  skills: [],
  mcps: ["context7", "graphify"],
  platforms: ["claude-code", "cursor", "codex"],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: false,
};

describe("mcp cost per platform", () => {
  it("reports the same schema total as the breakdown, per platform", () => {
    const rows = mcpCostByPlatform(cfg);
    assert.equal(rows.length, 3);
    for (const r of rows) assert.equal(r.schemaTokens, breakdown(cfg).mcpSchemas);
  });

  it("marks deferral only where vendor docs were checked, with a date and source", () => {
    const rows = mcpCostByPlatform(cfg);
    const claude = rows.find((r) => r.platform === "claude-code");
    assert.equal(claude?.deferral, "deferred");
    assert.ok(claude?.verifiedAt && claude.source?.startsWith("https://code.claude.com"));
    for (const r of rows.filter((x) => x.platform !== "claude-code")) {
      assert.equal(r.deferral, "unverified");
      assert.equal(r.verifiedAt, null);
    }
    for (const [id, d] of Object.entries(MCP_DEFERRAL)) {
      if (d.status === "deferred") assert.ok(d.source && d.verifiedAt, `${id} needs source+date`);
    }
  });
});
