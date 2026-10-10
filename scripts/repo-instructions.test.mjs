// Standalone Helix repo (post Step-B split): the root AGENTS.md IS the Helix
// contributor rules (~417 tokens), so no per-agent override files are needed and
// the Grok sandbox contract is gone. Sources + verifiedAt: docs/DECISIONS.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("repo instruction file (standalone repo)", () => {
  it("root AGENTS.md carries the Helix rules, not the Grok sandbox contract", () => {
    assert.ok(existsSync(join(ROOT, "AGENTS.md")), "AGENTS.md missing");
    const body = read("AGENTS.md");
    assert.match(body, /Helix contributor rules/);
    assert.doesNotMatch(body, /App Builder Workspace/);
    assert.ok(body.split("\n").length <= 60, "instruction file must stay lean");
  });

  it("no Step-A override files linger (nothing left to override)", () => {
    for (const f of ["CLAUDE.md", "AGENTS.override.md", "AGENTS.project.md"]) {
      assert.ok(!existsSync(join(ROOT, f)), `${f} is a pre-split leftover and must go`);
    }
  });
});
