import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("repo hygiene (Phase 0 #9)", () => {
  it("engines.node covers OpenTUI's Node FFI floor (26.4)", () => {
    const m = String(pkg.engines?.node ?? "").match(/>=\s*(\d+)\.(\d+)/);
    assert.ok(m, "engines.node must declare a >= floor");
    const floor = Number(m[1]) * 100 + Number(m[2]);
    assert.ok(floor >= 2604, `engines.node ${pkg.engines.node} below OpenTUI floor 26.4`);
  });

  it("typescript is a devDependency, not a runtime dependency", () => {
    assert.ok(
      !(pkg.dependencies ?? {}).typescript,
      "typescript must not ship as a runtime dependency",
    );
    assert.ok((pkg.devDependencies ?? {}).typescript, "typescript must stay in devDependencies");
  });

  it("CI pins every third-party action to a SHA", () => {
    const dir = join(root, ".github", "workflows");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const body = readFileSync(join(dir, f), "utf8");
      for (const m of body.matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = m[1];
        if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
        assert.ok(
          /@[0-9a-f]{40}/.test(ref),
          `${f}: ${ref} floats on a tag — pin to a SHA (Dependabot keeps it fresh)`,
        );
      }
    }
  });

  // The old hook ended in `|| echo "... skipped"`, so a real lint-staged failure also
  // printed the message and exited 0: the pre-commit gate could never block a commit.
  describe("pre-commit hook", () => {
    const hook = join(root, ".husky", "pre-commit");
    const runHook = (binBody) => {
      const dir = mkdtempSync(join(tmpdir(), "helix-precommit-"));
      if (binBody !== null) {
        const bin = join(dir, "node_modules", ".bin");
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, "lint-staged"), binBody);
        chmodSync(join(bin, "lint-staged"), 0o755);
      }
      return spawnSync("sh", [hook], { cwd: dir, encoding: "utf8" });
    };

    it("blocks the commit when lint-staged fails", () => {
      const r = runHook("#!/bin/sh\necho lint errors >&2\nexit 1\n");
      assert.notEqual(r.status, 0, "a failing lint-staged must fail the hook");
    });

    it("passes when lint-staged passes", () => {
      assert.equal(runHook("#!/bin/sh\nexit 0\n").status, 0);
    });

    it("skips with a notice only when lint-staged is not installed", () => {
      const r = runHook(null);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /not installed/);
    });
  });

  it("CI runs ShellCheck only if the scanned directory has shell scripts", () => {
    const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
    if (!/action-shellcheck/.test(ci)) return;
    const m = ci.match(/scandir:\s*(\S+)/);
    const dir = join(root, m ? m[1] : ".");
    const hasShell = readdirSync(dir).some((f) => /\.(sh|bash)$/.test(f));
    assert.ok(hasShell, `ci.yml runs ShellCheck on ${dir} but it contains no shell scripts`);
  });
});
