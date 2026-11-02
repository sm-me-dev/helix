// End-to-end CLI tests for `helix knowledge` subcommands
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "helix-cli-k-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "scratch-project",
      description: "Scratch test workspace",
      scripts: { test: "node --test" },
    }),
  );
  return dir;
}

function runHelix(dir, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    input: "",
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("helix knowledge CLI", () => {
  it("shows usage with --help and exits 0", () => {
    const dir = scratch();
    const res = runHelix(dir, ["knowledge", "--help"]);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes("helix knowledge — Adaptive Project Knowledge System"));
    assert.ok(res.stdout.includes("discover"));
    assert.ok(res.stdout.includes("index"));
    assert.ok(res.stdout.includes("retrieve"));
  });

  it("runs project discovery and saves canonical knowledge", () => {
    const dir = scratch();
    const res = runHelix(dir, ["knowledge", "discover", "--save"]);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes("Project Discovery: scratch-project"));
    assert.ok(res.stdout.includes("Discovered knowledge saved to .helix/knowledge/"));
  });

  it("reports status in human and JSON format", () => {
    const dir = scratch();
    runHelix(dir, ["knowledge", "discover", "--save"]);

    const resHuman = runHelix(dir, ["knowledge", "status"]);
    assert.equal(resHuman.status, 0);
    assert.ok(resHuman.stdout.includes("Helix Adaptive Project Knowledge System (APKS)"));

    const resJson = runHelix(dir, ["knowledge", "status", "--json"]);
    assert.equal(resJson.status, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.equal(parsed.hasOverview, true);
    assert.ok(parsed.domainsCount >= 0);
  });

  it("builds and rebuilds SQLite FTS5 index", () => {
    const dir = scratch();
    runHelix(dir, ["knowledge", "discover", "--save"]);

    const res = runHelix(dir, ["knowledge", "index", "--rebuild"]);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes("SQLite FTS5 Indexing Complete"));
    assert.ok(res.stdout.includes("Full Rebuild"));
  });

  it("validates knowledge base and audits health", () => {
    const dir = scratch();
    runHelix(dir, ["knowledge", "discover", "--save"]);

    const resVal = runHelix(dir, ["knowledge", "validate"]);
    assert.equal(resVal.status, 0);
    assert.ok(resVal.stdout.includes("Knowledge Validation: PASSED"));

    const resAudit = runHelix(dir, ["knowledge", "audit"]);
    assert.equal(resAudit.status, 0);
    assert.ok(resAudit.stdout.includes("Helix APKS Health Audit"));
    assert.ok(resAudit.stdout.includes("Freshness:"));
  });

  it("performs search and dynamic retrieval", () => {
    const dir = scratch();
    runHelix(dir, ["knowledge", "discover", "--save"]);
    runHelix(dir, ["knowledge", "index"]);

    const resSearch = runHelix(dir, ["knowledge", "search", "project"]);
    assert.equal(resSearch.status, 0);
    assert.ok(resSearch.stdout.includes('Search Results for "project"'));

    const resRet = runHelix(dir, [
      "knowledge",
      "retrieve",
      "implement new task feature",
      "--targets",
      "package.json",
    ]);
    assert.equal(resRet.status, 0);
    assert.ok(resRet.stdout.includes("Dynamic APKS Context Retrieval"));
    assert.ok(resRet.stdout.includes("Token Budget:"));
  });
});
