import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack, packAsText } from "./generate.ts";
import type { HarnessConfig } from "./types.ts";

const BASE: HarnessConfig = {
  crew: ["conductor", "scout"],
  skills: ["graph-first"],
  mcps: ["graphify"],
  lsps: ["typescript"],
  platforms: ["codex"],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

describe("generatePack", () => {
  it("always emits README.md and AGENTS.md first", () => {
    const paths = generatePack(BASE).map((f) => f.path);
    assert.deepEqual(paths.slice(0, 2), ["README.md", "AGENTS.md"]);
  });

  it("emits hooks only when enabled", () => {
    const on = generatePack(BASE).map((f) => f.path);
    assert.ok(on.includes(".helix/hooks/prefer-graph.mjs"));
    assert.ok(on.includes(".helix/hooks/format-lint.mjs"));
    const off = generatePack({ ...BASE, hooksEnabled: false }).map((f) => f.path);
    assert.ok(!off.some((p) => p.startsWith(".helix/hooks/")));
  });

  it("scopes platform files to the enabled platforms", () => {
    const codex = generatePack(BASE).map((f) => f.path);
    assert.ok(codex.includes(".mcp.json"));
    assert.ok(!codex.some((p) => p.startsWith(".claude/")));
    const claude = generatePack({ ...BASE, platforms: ["claude-code"] }).map((f) => f.path);
    assert.ok(claude.includes("CLAUDE.md"));
    assert.ok(claude.includes(".claude/agents/conductor.md"));
    assert.ok(claude.includes(".claude/settings.json"));
  });

  it("dedupes shared skill and mcp paths across platform families", () => {
    const paths = generatePack({
      ...BASE,
      platforms: ["codex", "opencode", "devin"],
    }).map((f) => f.path);
    const count = (p: string) => paths.filter((x) => x === p).length;
    assert.equal(count("skills/graph-first/SKILL.md"), 1);
    assert.equal(count(".mcp.json"), 1);
  });

  it("names the enabled LSPs in the pack README", () => {
    const readme = generatePack(BASE).find((f) => f.path === "README.md");
    assert.ok(readme?.body.includes("- LSP —"));
    assert.ok(readme?.body.includes("vtsls"));
  });

  it("throws a named error on unknown ids instead of a TypeError", () => {
    assert.throws(
      () => generatePack({ ...BASE, crew: ["nope" as never] }),
      /unknown crew role id: nope/,
    );
    assert.throws(
      () => generatePack({ ...BASE, platforms: ["nope" as never] }),
      /unknown platform id: nope/,
    );
  });
});

describe("packAsText", () => {
  it("joins files with path separators", () => {
    const text = packAsText(generatePack(BASE));
    assert.ok(text.includes("===== AGENTS.md ====="));
    assert.ok(text.includes("===== README.md ====="));
  });
});
