import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack } from "./generate.ts";
import { PLATFORMS } from "./platforms.ts";
import type { HarnessConfig } from "./types";

// Always-on files form the cached prefix. Churn there (timestamps, random ids,
// absolute paths) busts the cache on every run. Caching lowers cost; it is not
// counted as a token reduction anywhere in this repo.
const cfg = (platforms: HarnessConfig["platforms"]): HarnessConfig => ({
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: ["graph-first", "hook-guards"],
  mcps: ["context7", "graphify"],
  platforms,
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
  stack: {
    language: "typescript",
    packageManager: "npm",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    formatCommand: null,
  },
});

describe("cache-friendly pack layout", () => {
  it("generates byte-identical output on repeated runs, in a stable file order", async () => {
    const all = PLATFORMS.map((p) => p.id);
    const a = generatePack(cfg(all));
    await new Promise((r) => setTimeout(r, 1100));
    const b = generatePack(cfg(all));
    assert.deepEqual(
      a.map((f) => f.path),
      b.map((f) => f.path),
    );
    for (let i = 0; i < a.length; i++) assert.equal(a[i].body, b[i].body, a[i].path);
  });

  it("keeps timestamps, years-of-today and absolute paths out of always-on files", () => {
    const pack = generatePack(cfg(PLATFORMS.map((p) => p.id)));
    const alwaysOn = pack.filter(
      (f) =>
        f.path === "AGENTS.md" ||
        /^(CLAUDE|GEMINI)\.md$/.test(f.path) ||
        f.path.startsWith(".claude/agents/") ||
        f.path.endsWith("SKILL.md") ||
        f.path === ".github/copilot-instructions.md" ||
        f.path.startsWith(".cursor/rules/"),
    );
    assert.ok(alwaysOn.length > 4);
    for (const f of alwaysOn) {
      assert.doesNotMatch(f.body, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${f.path} has a timestamp`);
      assert.doesNotMatch(f.body, /\/home\/|\/Users\/|C:\\\\/, `${f.path} has an absolute path`);
      assert.doesNotMatch(f.body, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/, `${f.path} has a uuid`);
    }
  });
});
