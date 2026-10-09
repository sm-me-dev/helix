// End-to-end CLI behaviour: spawn the real binary in a scratch repo.
// These guard defects a green unit suite did not catch (found by running it).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "helix-cli-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "s", scripts: { test: "node --test" } }),
  );
  return dir;
}

function helix(dir, args, extraEnv = {}) {
  // input: "" closes stdin immediately, like CI, a pipe or an agent shell.
  // Hermetic PATH (node only): platform detection must not depend on which
  // agent CLIs happen to be installed on the machine running the tests.
  const env = { ...process.env, PATH: dirname(process.execPath), ...extraEnv };
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    input: "",
    encoding: "utf8",
    timeout: 30_000,
    env,
  });
}

describe("helix cli", () => {
  for (const flag of ["--help", "-h"]) {
    it(`init ${flag} prints usage and writes nothing`, () => {
      const dir = scratch();
      const r = helix(dir, ["init", flag]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /helix init/);
      assert.deepEqual(readdirSync(dir), ["package.json"]);
    });
  }

  it("re-running init with closed stdin never hangs, crashes or overwrites", () => {
    const dir = scratch();
    assert.equal(helix(dir, ["init"]).status, 0);
    const agents = join(dir, "AGENTS.md");
    writeFileSync(agents, "# mine\n");
    const r = helix(dir, ["init"]);
    assert.equal(r.error, undefined, "must not time out");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      readFileSync(agents, "utf8"),
      "# mine\n",
      "differing file must be kept without --force",
    );
    assert.match(r.stdout, /skipped/);
  });

  it("--force still overwrites", () => {
    const dir = scratch();
    helix(dir, ["init"]);
    const agents = join(dir, "AGENTS.md");
    writeFileSync(agents, "# mine\n");
    assert.equal(helix(dir, ["init", "--force"]).status, 0);
    assert.notEqual(readFileSync(agents, "utf8"), "# mine\n");
  });

  it("never writes or touches the user's top-level README.md", () => {
    const dir = scratch();
    writeFileSync(join(dir, "README.md"), "# my project\n");
    assert.equal(helix(dir, ["init", "--force"]).status, 0);
    assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "# my project\n");
    const fresh = scratch();
    helix(fresh, ["init"]);
    assert.ok(!existsSync(join(fresh, "README.md")));
  });

  it("merges OpenCode MCP output into existing config even with --force", () => {
    const dir = scratch();
    const path = join(dir, "opencode.json");
    writeFileSync(
      path,
      JSON.stringify({
        "$schema": "https://opencode.ai/config.json",
        theme: "nord",
        mcp: { internal: { type: "local", command: ["node", "internal.mjs"] } },
      }),
    );
    const r = helix(dir, ["init", "--platform", "opencode", "--force"]);
    assert.equal(r.status, 0, r.stderr);
    const merged = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(merged.theme, "nord");
    assert.deepEqual(merged.mcp.internal, { type: "local", command: ["node", "internal.mjs"] });
    assert.equal(merged.mcp.context7.type, "remote");
  });

  it("unknown command exits 2 with usage", () => {
    const r = helix(scratch(), ["bogus"]);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /helix init/);
  });

  describe("platform selection", () => {
    const written = (dir) => {
      const out = [];
      const walk = (d, rel = "") => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(join(d, e.name), r);
          else out.push(r);
        }
      };
      walk(dir);
      return out.filter((f) => f !== "package.json").sort();
    };

    it("no agent config in the repo: universal pack only, no platform dirs", () => {
      const dir = scratch();
      const r = helix(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(written(dir), [
        ".helix/README.md",
        ".helix/gate.json",
        ".helix/gate.mjs",
        ".helix/map.mjs",
        "AGENTS.md",
      ]);
      assert.match(r.stdout, /no agent config detected/);
    });

    it("emits only for agents whose config already exists in the repo", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      writeFileSync(join(dir, ".cursor/rules/mine.mdc"), "mine\n");
      writeFileSync(join(dir, "GEMINI.md"), "# gemini\n");
      const r = helix(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      const files = written(dir);
      assert.ok(files.includes(".cursor/rules/helix.mdc"), files.join());
      assert.ok(
        !files.some(
          (f) => f.startsWith(".claude/") || f === "CLAUDE.md" || f.startsWith(".codex/"),
        ),
        files.join(),
      );
      assert.match(r.stdout, /platforms: .*cursor.*gemini|platforms: .*gemini.*cursor/);
    });

    it("falls back to agent CLIs on PATH when the repo has no agent config", () => {
      const dir = scratch();
      const bin = mkdtempSync(join(tmpdir(), "helix-bin-"));
      writeFileSync(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
      const r = helix(dir, ["init"], { PATH: `${dirname(process.execPath)}:${bin}` });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dir, ".claude/settings.json")));
      assert.ok(!existsSync(join(dir, ".cursor")));
    });

    it("--platform overrides detection; --platform all emits every default platform", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      writeFileSync(join(dir, ".cursor/rules/mine.mdc"), "mine\n");
      assert.equal(helix(dir, ["init", "--platform", "codex"]).status, 0);
      assert.ok(!existsSync(join(dir, ".cursor/rules/helix.mdc")));
      const all = scratch();
      assert.equal(helix(all, ["init", "--platform", "all"]).status, 0);
      assert.ok(
        existsSync(join(all, ".claude/settings.json")) && existsSync(join(all, ".cursor/mcp.json")),
      );
    });
  });
});
