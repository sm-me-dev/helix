// F2: `helix plugin` end to end. Spawns the real CLI in a scratch dir, and, when the real
// `claude` binary is installed, asks the vendor's own validator to accept the output.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  accessSync,
  constants,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeOnlyBin } from "./test-env.mjs";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function helix(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input: "",
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: nodeOnlyBin() },
  });
}

/** Absolute path of `claude` found on the real PATH, or null. Resolved up front so the CLI
 * under test still runs with a hermetic PATH. */
function findClaude() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, "claude");
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

describe("helix plugin", () => {
  it("is listed in --help", () => {
    const r = helix(tmpdir(), ["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /helix plugin/);
  });

  it("writes a marketplace with the helix plugin and exits 0", () => {
    const out = join(mkdtempSync(join(tmpdir(), "helix-plugin-")), "mkt");
    const r = helix(tmpdir(), ["plugin", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    for (const p of [
      ".claude-plugin/marketplace.json",
      "plugins/helix/.claude-plugin/plugin.json",
      "plugins/helix/hooks/hooks.json",
      "plugins/helix/.mcp.json",
      "plugins/helix/agents/scout.md",
    ]) {
      assert.ok(existsSync(join(out, p)), `missing ${p}`);
    }
    JSON.parse(readFileSync(join(out, ".claude-plugin/marketplace.json"), "utf8"));
  });

  it("requires --out (usage error, exit 2, no files written)", () => {
    const dir = mkdtempSync(join(tmpdir(), "helix-plugin-noout-"));
    const r = helix(dir, ["plugin"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--out/);
  });

  it("is idempotent: a second run leaves every file byte-identical", () => {
    const out = join(mkdtempSync(join(tmpdir(), "helix-plugin-")), "mkt");
    assert.equal(helix(tmpdir(), ["plugin", "--out", out]).status, 0);
    const files = [
      ".claude-plugin/marketplace.json",
      "plugins/helix/.claude-plugin/plugin.json",
      "plugins/helix/hooks/hooks.json",
      "plugins/helix/agents/scout.md",
    ];
    const first = files.map((p) => readFileSync(join(out, p), "utf8"));
    assert.equal(helix(tmpdir(), ["plugin", "--out", out]).status, 0);
    assert.deepEqual(
      files.map((p) => readFileSync(join(out, p), "utf8")),
      first,
    );
  });

  it("`init --claude-plugin` writes only what a plugin cannot ship", () => {
    const dir = mkdtempSync(join(tmpdir(), "helix-plugin-init-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "s", scripts: { test: "node --test" } }),
    );
    const r = helix(dir, ["init", "--platform", "claude-code", "--claude-plugin"]);
    assert.equal(r.status ?? 0, 0, r.stderr);
    assert.ok(existsSync(join(dir, "AGENTS.md")));
    assert.ok(existsSync(join(dir, "CLAUDE.md")));
    assert.ok(existsSync(join(dir, ".helix/gate.mjs")));
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    assert.ok(s.permissions.deny.includes("Read(.env)"));
    assert.deepEqual(s.hooks, {});
    assert.ok(!existsSync(join(dir, ".claude/agents")), "agents come from the plugin");
    assert.ok(!existsSync(join(dir, ".claude/skills")), "skills come from the plugin");
    assert.ok(!existsSync(join(dir, ".mcp.json")), "MCP comes from the plugin");
    assert.ok(!existsSync(join(dir, ".helix/hooks")), "hooks come from the plugin");
  });

  const claude = findClaude();
  it(
    "loads with `claude plugin validate` (marketplace and plugin)",
    { skip: claude ? false : "claude not on PATH" },
    () => {
      const out = join(mkdtempSync(join(tmpdir(), "helix-plugin-")), "mkt");
      assert.equal(helix(tmpdir(), ["plugin", "--out", out]).status, 0);
      // Throwaway HOME so the validator cannot read or touch the real ~/.claude.
      const home = mkdtempSync(join(tmpdir(), "helix-claude-home-"));
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
      };
      for (const target of [out, join(out, "plugins/helix")]) {
        const v = spawnSync(claude, ["plugin", "validate", target], {
          encoding: "utf8",
          timeout: 60_000,
          env,
        });
        assert.equal(v.status, 0, `${target}\n${v.stdout}\n${v.stderr}`);
        assert.match(v.stdout + v.stderr, /Validation passed/);
        assert.doesNotMatch(v.stdout + v.stderr, /Validation failed/);
      }
    },
  );
});
