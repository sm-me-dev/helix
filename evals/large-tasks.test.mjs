// Phase D: large-fixture navigation tasks + held-out set. The held-out tasks
// must never be used to tune AGENTS.md or prompts; the runner excludes them
// unless --include-heldout is passed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseYaml } from "./yaml.mjs";

const readDir = async (sub) => {
  const dir = new URL(`./${sub}/`, import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yml")).sort();
  const tasks = [];
  for (const f of files) {
    tasks.push({ file: f, ...parseYaml(await readFile(new URL(`./${sub}/${f}`, import.meta.url), "utf8")) });
  }
  return { files, tasks };
};

describe("large fixture tasks", () => {
  it("has three tuning tasks with navigation setups", async () => {
    const { files, tasks } = await readDir("tasks-large");
    assert.deepEqual(files, ["call-chain.yml", "cross-module.yml", "trace-bug.yml"]);
    for (const t of tasks) {
      assert.ok(t.id && t.title && t.prompt && t.pass, `${t.file} needs id/title/prompt/pass`);
      assert.equal(t.fixture, "large", `${t.file} must target the large fixture`);
      assert.equal(typeof t.timeoutSec, "number");
      assert.equal(t.requireDiff, true);
      assert.ok(!t.heldout, `${t.file} is a tuning task, not held out`);
      for (const k of ["seed", "module", "rule"]) {
        assert.equal(typeof t.setup?.[k], "number", `${t.file} setup.${k} must be numeric`);
      }
      assert.match(t.pass, /service\.test\.ts/);
    }
  });

  it("has a held-out set that tuning tasks never overlap", async () => {
    const tuning = await readDir("tasks-large");
    const held = await readDir("tasks-heldout");
    assert.deepEqual(held.files, ["heldout-bug.yml", "heldout-trace.yml"]);
    const tuningIds = new Set(tuning.tasks.map((t) => t.id));
    for (const t of held.tasks) {
      assert.equal(t.heldout, true, `${t.file} must be marked heldout`);
      assert.equal(t.fixture, "large");
      assert.ok(!tuningIds.has(t.id), `held-out id ${t.id} collides with a tuning task`);
      for (const k of ["seed", "module", "rule"]) {
        assert.equal(typeof t.setup?.[k], "number", `${t.file} setup.${k} must be numeric`);
      }
    }
  });

  it("planted bugs fail the task pass command from green (navigation property)", async () => {
    const { tasks } = await readDir("tasks-large");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const { writeFixture, plantRuleBug } = await import("./fixture-large/generate.mjs");
    const run = (dir, cmd) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const parts = cmd.split(" -- ");
      void parts;
      const args = cmd.split(" ").slice(1);
      return spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env });
    };
    for (const t of tasks) {
      const dir = mkdtempSync(join(tmpdir(), "helix-large-task-"));
      try {
        const { model } = writeFixture(dir, { seed: t.setup.seed });
        const args = t.pass.split(" ").slice(1);
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const pristine = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env });
        assert.equal(pristine.status, 0, `${t.id}: pristine fixture must be green`);
        plantRuleBug(dir, model, t.setup.module, t.setup.rule);
        const planted = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env });
        assert.notEqual(planted.status, 0, `${t.id}: planted bug must fail the pass command`);
        void run;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
