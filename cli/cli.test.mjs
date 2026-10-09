// End-to-end CLI behaviour: spawn the real binary in a scratch repo.
// These guard defects a green unit suite did not catch (found by running it).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "helix-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "s", scripts: { test: "node --test" } }));
  return dir;
}

function helix(dir, args) {
  // input: "" closes stdin immediately, like CI, a pipe or an agent shell.
  return spawnSync(process.execPath, [BIN, ...args], { cwd: dir, input: "", encoding: "utf8", timeout: 30_000 });
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
    assert.equal(readFileSync(agents, "utf8"), "# mine\n", "differing file must be kept without --force");
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

  it("unknown command exits 2 with usage", () => {
    const r = helix(scratch(), ["bogus"]);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /helix init/);
  });
});
