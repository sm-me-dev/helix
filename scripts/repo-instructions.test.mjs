// F1 Step A: agents working ON this repo must not load the Grok sandbox contract
// (root AGENTS.md, 4,904 tokens) when a per-agent override exists.
// Claude Code reads AGENTS.md only if no CLAUDE.md exists; Codex prefers AGENTS.override.md.
// Sources + verifiedAt: docs/DECISIONS.md (2026-10-10, F1).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("repo instruction overrides (F1 step A)", () => {
  it("root CLAUDE.md imports AGENTS.project.md and the import resolves", () => {
    assert.ok(existsSync(join(ROOT, "CLAUDE.md")), "CLAUDE.md missing");
    const imports = [...read("CLAUDE.md").matchAll(/^@(\S+)$/gm)].map((m) => m[1]);
    assert.ok(imports.includes("AGENTS.project.md"), "CLAUDE.md must contain @AGENTS.project.md");
    for (const i of imports) assert.ok(existsSync(join(ROOT, i)), `import does not resolve: ${i}`);
  });

  it("CLAUDE.md stays tiny (it is always-on)", () => {
    assert.ok(existsSync(join(ROOT, "CLAUDE.md")), "CLAUDE.md missing");
    assert.ok(read("CLAUDE.md").split("\n").length <= 10);
  });

  it("AGENTS.override.md is byte-identical to AGENTS.project.md (Codex does not follow imports)", () => {
    assert.ok(existsSync(join(ROOT, "AGENTS.override.md")), "AGENTS.override.md missing");
    assert.equal(read("AGENTS.override.md"), read("AGENTS.project.md"));
  });

  it("root AGENTS.md is untouched (matches HEAD)", () => {
    const head = execFileSync("git", ["show", "HEAD:AGENTS.md"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(read("AGENTS.md"), head);
  });
});
