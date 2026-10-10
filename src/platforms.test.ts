import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { CAPABILITIES } from "./adapters/types.ts";
import { generatePack } from "./generate.ts";
import { PLATFORM_BY_ID, PLATFORMS, platformMatrixMarkdown } from "./platforms.ts";
import type { HarnessConfig, PlatformId } from "./types";

const cfg = (platform: PlatformId): HarnessConfig => ({
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: ["graph-first", "hook-guards"],
  mcps: ["context7", "graphify"],
  platforms: [platform],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
});

describe("platform capability matrix", () => {
  it("claims nothing without a verification date and a vendor source", () => {
    for (const a of Object.values(ADAPTER_BY_ID)) {
      const claimed = CAPABILITIES.filter((c) => a.capabilities[c] !== "unverified");
      if (claimed.length > 0) {
        assert.ok(a.verifiedAt, `${a.id} claims ${claimed.join(",")} without verifiedAt`);
        assert.ok(a.sources.length > 0, `${a.id} claims ${claimed.join(",")} without a source`);
      }
      if (!a.verifiedAt) {
        assert.deepEqual(claimed, [], `${a.id} is unverified but claims capabilities`);
      }
    }
  });

  it("keeps the boolean flags consistent with the matrix", () => {
    for (const a of Object.values(ADAPTER_BY_ID)) {
      assert.equal(a.supportsSkills, a.capabilities.skills !== "unverified", a.id);
      assert.equal(a.supportsSubagents, a.capabilities.subagents !== "unverified", a.id);
    }
  });

  it("emits files only for capabilities marked emitted", () => {
    const probes: Record<string, RegExp> = {
      skills: /SKILL\.md$/,
      subagents: /(^|\/)agents\/[^/]+\.md$/,
      hooks: /(^\.helix\/hooks\/|\.claude\/settings\.json$)/,
      mcp: /(mcp\.json|config\.toml|opencode\.json)$/,
    };
    for (const p of PLATFORMS) {
      const paths = generatePack(cfg(p.id)).map((f) => f.path);
      for (const [cap, re] of Object.entries(probes)) {
        if (p.capabilities[cap as keyof typeof p.capabilities] !== "emitted") {
          assert.deepEqual(
            paths.filter((x) => re.test(x)),
            [],
            `${p.id} emits ${cap} files but ${cap} is not "emitted"`,
          );
        }
      }
    }
  });

  it("keeps README's platform matrix identical to the catalog", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const m = readme.match(/<!-- matrix:start -->\n([\s\S]*?)\n<!-- matrix:end -->/);
    assert.ok(m, "README needs matrix:start/end markers");
    // Prettier realigns markdown tables on commit; compare cells, not padding.
    const norm = (t: string) =>
      t
        .trim()
        .split("\n")
        .map((row) =>
          row
            .split("|")
            .map((c) => c.trim().replace(/^-+$/, "---"))
            .join("|"),
        );
    assert.deepEqual(norm(m[1]), norm(platformMatrixMarkdown()));
  });

  it("emits native Cursor and OpenCode agents, skills, and valid MCP shapes", () => {
    const cursor = generatePack(cfg("cursor"));
    const cursorPaths = cursor.map((file) => file.path);
    assert.ok(cursorPaths.includes(".cursor/agents/scout.md"));
    assert.ok(cursorPaths.includes(".cursor/skills/graph-first/SKILL.md"));
    assert.match(
      cursor.find((file) => file.path === ".cursor/agents/reviewer.md")?.body ?? "",
      /readonly: true/,
    );
    assert.match(
      cursor.find((file) => file.path === ".cursor/agents/builder.md")?.body ?? "",
      /readonly: false/,
    );

    const opencode = generatePack(cfg("opencode"));
    const openCodePaths = opencode.map((file) => file.path);
    assert.ok(openCodePaths.includes(".opencode/agents/scout.md"));
    assert.ok(openCodePaths.includes(".opencode/skills/graph-first/SKILL.md"));
    assert.match(
      opencode.find((file) => file.path === ".opencode/agents/scout.md")?.body ?? "",
      /mode: subagent[\s\S]*edit: deny/,
    );

    const mcpFile = opencode.find((file) => file.path === "opencode.json");
    assert.ok(mcpFile);
    const parsed = JSON.parse(mcpFile.body) as {
      $schema: string;
      mcp: Record<string, { type: string; command?: string[]; url?: string; enabled?: boolean }>;
    };
    assert.equal(parsed["$schema"], "https://opencode.ai/config.json");
    assert.deepEqual(parsed.mcp.graphify.command?.slice(0, 3), [
      "uvx",
      "--from",
      "graphifyy[mcp]==0.9.82",
    ]);
    assert.equal(parsed.mcp.context7.type, "remote");
    assert.equal(parsed.mcp.context7.enabled, true);
  });

  it("gemini note cites Google's own announcement, not only press (verified 2026-10-10)", () => {
    const note = PLATFORM_BY_ID.gemini.notes;
    assert.match(note, /github\.com\/google-gemini\/gemini-cli\/discussions\/28017/);
    assert.match(note, /2026-06-18/);
    assert.doesNotMatch(note, /not checked against a Google primary page/);
  });
});
