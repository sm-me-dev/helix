// A test file that no script runs silently never runs (codex-antigravity.test.ts was once missing
// from a hand-written list). Suites are discovered by glob, and this test proves the globs cover
// every test file in the repo and that `npm test` runs both suites without one hiding the other.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.test\.(ts|mjs)$/.test(e.name)) out.push(relative(ROOT, p));
  }
  return out;
}

describe("npm test coverage", () => {
  // evals/fixture* hold the repos agents are graded on; their tests are the task targets (some
  // are red by design) and are run by the eval harness, never by `npm test`.
  const files = walk(ROOT).filter((f) => !/^evals\/fixture\//.test(f));

  it("every .test.ts lives under src/ and is globbed by test:ts", () => {
    assert.match(scripts["test:ts"], /'src\/\*\*\/\*\.test\.ts'/);
    const stray = files.filter((f) => f.endsWith(".test.ts") && !f.startsWith("src/"));
    assert.deepEqual(stray, [], ".test.ts files outside src/ are never run");
  });

  it("every .test.mjs lives under scripts/, cli/ or evals/ and is globbed by test:mjs", () => {
    for (const dir of ["scripts", "cli", "evals"]) {
      assert.ok(scripts["test:mjs"].includes(`'${dir}/**/*.test.mjs'`), `${dir} not globbed`);
    }
    const stray = files.filter((f) => f.endsWith(".test.mjs") && !/^(scripts|cli|evals)\//.test(f));
    assert.deepEqual(stray, [], ".test.mjs files outside the globbed dirs are never run");
  });

  it("`npm test` runs both suites and cannot let one hide the other", () => {
    assert.equal(scripts.test, "node scripts/run-tests.mjs");
    const runner = readFileSync(join(ROOT, "scripts/run-tests.mjs"), "utf8");
    assert.match(runner, /test:mjs/);
    assert.match(runner, /test:ts/);
    assert.doesNotMatch(scripts.test, /&&/);
  });
});
