import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELIX_BIN = path.resolve(__dirname, "helix.mjs");

function runHelix(args, options = {}) {
  return spawnSync(process.execPath, [HELIX_BIN, ...args], {
    encoding: "utf8",
    cwd: options.cwd || process.cwd(),
    input: options.input,
    env: { ...process.env, ...options.env },
  });
}

describe("helix run CLI command", () => {
  it("prints usage and exits 0 on --help", () => {
    const res = runHelix(["run", "--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage: helix run/);
    assert.match(res.stdout, /--strategy/);
    assert.match(res.stdout, /--dry/);
    assert.match(res.stdout, /--simulation/);
    assert.match(res.stdout, /--tmux/);
  });

  it("prints usage and exits 0 on -h", () => {
    const res = runHelix(["run", "-h"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage: helix run/);
  });

  it("exits 2 when missing task prompt or file", () => {
    const res = runHelix(["run"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Missing task prompt or task file/);
  });

  it("exits 2 on invalid strategy", () => {
    const res = runHelix(["run", "Do something", "--strategy", "invalid-arm"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Invalid strategy/);
  });

  it("executes single-agent task dry-run successfully", () => {
    const res = runHelix(["run", "Fix typo in documentation", "--dry"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Helix AI Coding Harness/);
    assert.match(res.stdout, /Strategy:\s+single/);
    assert.match(res.stdout, /Status:.*SUCCEEDED/);
    assert.match(res.stdout, /Dry run completed/);
  });

  it("executes dry-run with --json and outputs valid JSON", () => {
    const res = runHelix(["run", "Refactor helper module", "--dry", "--json"]);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.status, "succeeded");
    assert.equal(typeof parsed.taskId, "string");
    assert.equal(parsed.finalWorkflowState, "discovered");
    assert.equal(parsed.validation.passed, true);
    assert.ok(parsed.metrics.wallClockDurationMs >= 0);
  });

  it("executes multi-agent chain dry run", () => {
    const res = runHelix([
      "run",
      "Complex feature spanning modules",
      "--strategy",
      "chain",
      "--dry",
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Strategy:\s+chain/);
    assert.match(res.stdout, /SUCCEEDED/);
    assert.match(res.stdout, /multi-agent task planned/);
  });

  it("executes multi-agent parallel dry run", () => {
    const res = runHelix([
      "run",
      "Parallel tasks across packages",
      "--strategy",
      "parallel",
      "--dry",
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Strategy:\s+parallel/);
    assert.match(res.stdout, /SUCCEEDED/);
  });

  it("reads structured JSON task specification file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-run-test-"));
    try {
      const taskFile = path.join(tmpDir, "sample-task.json");
      fs.writeFileSync(
        taskFile,
        JSON.stringify({
          id: "custom-task-01",
          title: "Custom Task Title",
          prompt: "Implement custom feature in src/core.ts",
          targetFiles: ["src/core.ts"],
          constraints: {
            timeoutSec: 120,
            maxRetries: 1,
          },
        }),
        "utf8",
      );

      const res = runHelix(["run", taskFile, "--dry", "--json"], { cwd: tmpDir });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.taskId, "custom-task-01");
      assert.equal(parsed.status, "succeeded");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads markdown task file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-run-test-md-"));
    try {
      const taskFile = path.join(tmpDir, "task-spec.md");
      fs.writeFileSync(
        taskFile,
        "# Task Objective\n\nFix memory leak in websocket listener.",
        "utf8",
      );

      const res = runHelix(["run", taskFile, "--dry"], { cwd: tmpDir });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /SUCCEEDED/);
      assert.match(res.stdout, /Dry run completed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes output to custom path with --out", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-run-out-"));
    try {
      const outReport = path.join(tmpDir, "custom-report.json");
      const res = runHelix(["run", "Dry task for out flag", "--dry", "--out", outReport], {
        cwd: tmpDir,
      });
      assert.equal(res.status, 0);
      assert.ok(fs.existsSync(outReport));
      const parsed = JSON.parse(fs.readFileSync(outReport, "utf8"));
      assert.equal(parsed.status, "succeeded");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts prompt piped from stdin", () => {
    const res = runHelix(["run", "--dry", "--json"], {
      input: "Fix typo via piped stdin",
    });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.status, "succeeded");
  });
});
