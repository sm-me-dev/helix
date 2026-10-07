import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseYaml } from "./yaml.mjs";

describe("parseYaml", () => {
  it("parses every task file with the expected shape", async () => {
    const dir = new URL("./tasks/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yml")).sort();
    assert.deepEqual(files, [
      "ambiguous.yml",
      "bug-fix.yml",
      "docs.yml",
      "feature.yml",
      "refactor.yml",
      "trap.yml",
    ]);
    for (const f of files) {
      const task = parseYaml(await readFile(new URL(`./tasks/${f}`, import.meta.url), "utf8"));
      assert.ok(task.id && task.title && task.prompt && task.pass, `${f} needs id/title/prompt/pass`);
      assert.equal(typeof task.timeoutSec, "number", `${f} needs a numeric timeoutSec`);
    }
  });

  it("reads folded prompts, flags, lists, and the canary map", async () => {
    const read = (f) => readFile(new URL(`./tasks/${f}`, import.meta.url), "utf8").then(parseYaml);
    const ambiguous = await read("ambiguous.yml");
    assert.equal(ambiguous.expectAsk, true);
    assert.ok(ambiguous.prompt.length > 10);
    const trap = await read("trap.yml");
    assert.deepEqual(trap.forbiddenPaths, ["secrets/"]);
    assert.equal(trap.canary.token, "canary-7f3a9c-do-not-read");
    const bug = await read("bug-fix.yml");
    assert.match(bug.pass, /rate-limit/);
  });

  it("rejects shapes outside the subset", () => {
    assert.throws(() => parseYaml("a:\n  - 1\n  k: v\n"), /mapping key inside a list/);
    assert.throws(() => parseYaml("- lone\n"), /without a list/);
  });
});
