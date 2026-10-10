// Regression guard for test hermeticity (audit F0).
//
// Test files that build throwaway git repos must not depend on the developer's global
// git config (commit signing, hooks, a global excludes file, default branch name) or on
// NODE_ENV. This file runs them under a deliberately hostile ambient environment and
// requires them to pass. It was added after src/lib/harness/gate.test.ts failed under it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Ambient environment that breaks any test relying on the machine's git setup. */
function hostileEnv(): Record<string, string> {
  const base = mkdtempSync(join(tmpdir(), "helix-hostile-"));
  const hooks = join(base, "hooks");
  const home = join(base, "home");
  mkdirSync(hooks);
  mkdirSync(home);
  for (const name of ["pre-commit", "commit-msg"]) {
    writeFileSync(join(hooks, name), "#!/bin/sh\necho hostile-hook >&2\nexit 1\n");
    chmodSync(join(hooks, name), 0o755);
  }
  const excludes = join(base, "excludes");
  writeFileSync(excludes, "*.lock\n.env\n");
  const gitconfig = join(home, ".gitconfig");
  writeFileSync(
    gitconfig,
    [
      "[commit]",
      "\tgpgsign = true",
      "[gpg]",
      "\tprogram = /bin/false",
      "[init]",
      "\tdefaultBranch = trunk",
      "[core]",
      `\thooksPath = ${hooks}`,
      `\texcludesFile = ${excludes}`,
      "",
    ].join("\n"),
  );
  // PATH holds node plus system dirs only, so no yarn/pnpm/bun/claude/opencode leak in.
  const bin = join(base, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  return {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    NODE_ENV: "production",
  };
}

const FILES: Array<{ file: string; args: string[] }> = [
  { file: "src/lib/harness/gate.test.ts", args: ["--experimental-strip-types"] },
  { file: "src/lib/harness/codex-antigravity.test.ts", args: ["--experimental-strip-types"] },
  { file: "cli/e2e-workflows.test.mjs", args: [] },
];

describe("git-building tests are hermetic", () => {
  for (const { file, args } of FILES) {
    it(`${file} passes under a hostile global git config and NODE_ENV=production`, () => {
      const r = spawnSync(process.execPath, [...args, "--test", file], {
        cwd: ROOT,
        env: hostileEnv(),
        encoding: "utf8",
        timeout: 120_000,
      });
      const tail = `${r.stdout}\n${r.stderr}`.split("\n").slice(-40).join("\n");
      assert.equal(r.status, 0, `${file} is not hermetic:\n${tail}`);
    });
  }
});
