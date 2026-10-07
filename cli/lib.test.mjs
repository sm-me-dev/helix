import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultConfig,
  detectStack,
  diffLines,
  doctorPack,
  graphFreshness,
  mcpSummary,
  measureReport,
  packJson,
  reconstructConfig,
} from "./lib.ts";
import { generatePack } from "../src/lib/harness/generate.ts";

describe("detectStack", () => {
  it("detects a TypeScript npm repo with test and lint scripts", () => {
    const d = detectStack({
      names: new Set(["package.json", "tsconfig.json", "package-lock.json", "Makefile"]),
      packageJson: { scripts: { test: "vitest run", lint: "eslint ." } },
      makefile: null,
      justfile: null,
    });
    assert.equal(d.language, "typescript");
    assert.equal(d.packageManager, "npm");
    assert.equal(d.testCommand, "npm test");
    assert.equal(d.lintCommand, "npm run lint");
  });

  it("falls back to Makefile and justfile targets", () => {
    const d = detectStack({
      names: new Set(["Makefile", "go.mod"]),
      packageJson: null,
      makefile: "test:\n\tgo test ./...\n",
      justfile: null,
    });
    assert.equal(d.language, "go");
    assert.equal(d.testCommand, "make test");
  });

  it("lists existing agent files for the overwrite prompt", () => {
    const d = detectStack({
      names: new Set(["AGENTS.md", ".mcp.json"]),
      packageJson: null,
      makefile: null,
      justfile: null,
    });
    assert.deepEqual(d.existingAgentFiles, ["AGENTS.md", ".mcp.json"]);
  });
});

describe("diffLines", () => {
  it("reports identical files", () => {
    assert.equal(diffLines("a\nb\n", "a\nb\n"), "identical");
  });

  it("shows changed hunks with context", () => {
    const out = diffLines("1\n2\n3\n4\n", "1\n2\nX\n4\n");
    assert.match(out, /- 3/);
    assert.match(out, /\+ X/);
  });
});

describe("doctorPack", () => {
  it("passes a helix-generated pack", () => {
    const files = new Map(generatePack(defaultConfig(["claude-code", "codex"])).map((f) => [f.path, f.body]));
    const failures = doctorPack(files).filter((f) => f.check !== "mcp-measured");
    assert.deepEqual(failures, []);
  });

  it("fails broken configs with actionable messages", () => {
    const failures = doctorPack(
      new Map([
        [".mcp.json", "{not json"],
        [".vscode/mcp.json", JSON.stringify({ mcpServers: {} })],
      ]),
    );
    assert.ok(failures.some((f) => f.check === "config:.mcp.json"));
    assert.ok(failures.some((f) => f.check === "config:.vscode/mcp.json"));
    assert.ok(failures.some((f) => f.check === "agents-md"));
  });
});

describe("reconstructConfig", () => {
  it("detects enabled platforms from emitted files", () => {
    const files = new Map(generatePack(defaultConfig(["codex"])).map((f) => [f.path, f.body]));
    const cfg = reconstructConfig(files);
    assert.ok(cfg.platforms.includes("codex"));
    assert.ok(!cfg.platforms.includes("cursor"));
  });
});

describe("mcpSummary and graphFreshness", () => {
  it("reports per-server tokens with freshness", () => {
    const lines = mcpSummary(defaultConfig(["claude-code"]));
    assert.ok(lines.some((l) => l.startsWith("graphify:") && /measured|estimate/.test(l)));
  });

  it("flags a stale graph index", () => {
    const stale = graphFreshness(
      () => "Built from commit: `aaaaaaa`",
      () => "bbbbbbb",
    );
    assert.equal(stale.length, 1);
    const fresh = graphFreshness(
      () => "Built from commit: `aaaaaaa`",
      () => "aaaaaaa",
    );
    assert.deepEqual(fresh, []);
    const missing = graphFreshness(() => null, () => "aaaaaaa");
    assert.equal(missing.length, 1);
  });
});
describe("measureReport and packJson", () => {
  it("prints computed numbers with the method", () => {
    const out = measureReport(defaultConfig(["claude-code"]));
    assert.match(out, /always-on/);
    assert.match(out, /o200k_base/);
  });

  it("emits scriptable JSON for one platform", () => {
    const parsed = JSON.parse(packJson(defaultConfig(["codex"])));
    assert.ok(parsed.files.some((f) => f.path === ".codex/config.toml"));
  });
});
