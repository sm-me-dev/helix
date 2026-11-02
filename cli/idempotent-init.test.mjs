// `helix init` must be idempotent: the files it writes must not change what it detects.
// Regression: init counted its own output toward the 20-file Graphify threshold, so a second
// run on a small repo flipped graph-first on and rewrote the pack.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

/** PATH dir with `node` and a stub `graphify` that "indexes" by writing GRAPH_REPORT.md. */
function stubBin() {
  const bin = mkdtempSync(join(tmpdir(), "helix-idem-bin-"));
  symlinkSync(process.execPath, join(bin, "node"));
  const stub = join(bin, "graphify");
  writeFileSync(
    stub,
    // Absolute tool paths: the hermetic PATH holds only `node` and this stub.
    '#!/bin/sh\nif [ "$1" = update ]; then /bin/mkdir -p graphify-out; /bin/echo "# report" > graphify-out/GRAPH_REPORT.md; fi\nexit 0\n',
  );
  chmodSync(stub, 0o755);
  return bin;
}

function smallRepo() {
  const dir = mkdtempSync(join(tmpdir(), "helix-idem-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "s", scripts: { test: "x" } }));
  mkdirSync(join(dir, "src"));
  for (let i = 0; i < 12; i++)
    writeFileSync(join(dir, "src", `m${i}.js`), `export const v${i} = ${i};\n`);
  return dir;
}

describe("helix init is idempotent", () => {
  it("a second run on a small repo writes nothing new", () => {
    const dir = smallRepo();
    const env = { ...process.env, PATH: stubBin() };
    const run = () =>
      spawnSync(process.execPath, [BIN, "init", "--platform", "claude-code,cursor,codex"], {
        cwd: dir,
        input: "",
        encoding: "utf8",
        timeout: 30_000,
        env,
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /graph-first: off/, "13 source files are under the threshold");
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /graph-first: off/, "init's own files must not count as source");
    assert.match(second.stdout, /done: 0 written/, second.stdout);
  });
});
