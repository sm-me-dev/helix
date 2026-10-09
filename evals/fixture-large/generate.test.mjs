import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixture, plantRuleBug } from "./generate.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "helix-large-"));
const clean = (...dirs) => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};
// A child spawned inside `node --test` inherits NODE_TEST_CONTEXT and then
// runs in child mode: it exits 0 without running anything. Strip it, and
// assert the test count below so a vacuous pass cannot look green.
const runTests = (dir) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "tests/**/*.test.ts"],
    { cwd: dir, encoding: "utf8", env },
  );
};
const count = (out, label) =>
  Number(new RegExp(`(?:ℹ |# )${label} (\\d+)`).exec(out)?.[1] ?? NaN);

test("same seed gives byte-identical output; a new seed differs", () => {
  const a = tmp();
  const b = tmp();
  const c = tmp();
  try {
    const ra = writeFixture(a, { seed: 1 });
    const rb = writeFixture(b, { seed: 1 });
    const rc = writeFixture(c, { seed: 2 });
    assert.equal(ra.hash, rb.hash);
    assert.notEqual(ra.hash, rc.hash);
  } finally {
    clean(a, b, c);
  }
});

test("is large: hundreds of files, several modules, cross-module deps", () => {
  const d = tmp();
  try {
    const r = writeFixture(d, { seed: 1 });
    assert.ok(r.fileCount >= 300, `fileCount ${r.fileCount}`);
    assert.ok(r.model.modules.length >= 12);
    const withDeps = r.model.modules.filter((m) => m.deps.length > 0);
    assert.ok(withDeps.length >= 10, "most modules depend on another module");
  } finally {
    clean(d);
  }
});

test("pristine fixture is green and its tests run in seconds", () => {
  const d = tmp();
  try {
    writeFixture(d, { seed: 1 });
    const t0 = Date.now();
    const r = runTests(d);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(count(r.stdout, "tests") >= 50, "suite must really run");
    assert.equal(count(r.stdout, "fail"), 0);
    assert.ok(Date.now() - t0 < 30_000, "suite should be fast");
  } finally {
    clean(d);
  }
});

test("a planted rule bug fails its module and dependents, not earlier ones", () => {
  const d = tmp();
  try {
    const r = writeFixture(d, { seed: 1 });
    const target = r.model.modules[3];
    const planted = plantRuleBug(d, r.model, 3, 7);
    assert.ok(planted.file.includes(`src/${target.name}/rules/`));
    const res = runTests(d);
    assert.notEqual(res.status, 0, "bug must break the suite");
    const failing = res.stdout
      .split("\n")
      .filter((l) => /^\s*✖|^not ok/.test(l))
      .join("\n");
    assert.ok(failing.includes(target.name), failing);
    assert.ok(!failing.includes(r.model.modules[0].name), failing);
  } finally {
    clean(d);
  }
});

test("docs list the correct rule constants so a bug is findable by diffing", () => {
  const d = tmp();
  try {
    const r = writeFixture(d, { seed: 1 });
    const m = r.model.modules[2];
    const doc = readFileSync(join(d, "docs", `${m.name}.md`), "utf8");
    for (const rule of m.rules) assert.ok(doc.includes(String(rule.m)));
  } finally {
    clean(d);
  }
});
