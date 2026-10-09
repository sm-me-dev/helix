import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { CAPABILITIES } from "./adapters/types.ts";
import { generatePack } from "./generate.ts";
import { PLATFORMS, platformMatrixMarkdown } from "./platforms.ts";
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
      mcp: /(mcp\.json|config\.toml)$/,
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
    assert.equal(m[1].trim(), platformMatrixMarkdown());
  });
});
