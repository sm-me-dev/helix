// Every *.test.ts under src/ must be named in the `test` script of package.json,
// or it silently never runs (src/lib/harness/codex-antigravity.test.ts was missing).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".test.ts")) out.push(relative(ROOT, p));
  }
  return out;
}

describe("npm test coverage", () => {
  it("lists every src/**/*.test.ts", () => {
    const script = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.test;
    const missing = walk(join(ROOT, "src")).filter((f) => !script.includes(f));
    assert.deepEqual(missing, [], "test files not run by `npm test`");
  });
});
