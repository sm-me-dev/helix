// Helix Core Execution Engine Test Suite (Phase 03)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DefaultContextManager, DEFAULT_CONTEXT_BUDGET } from "./context.ts";
import { HelixExecutionEngine } from "./engine.ts";
import { MockAgentRunner } from "./runner.ts";
import { FileExecutionStateManager } from "./state.ts";
import { DefaultTaskPlanner, normalizeTaskDefinition } from "./task.ts";
import { DefaultToolExecutor, ToolSecurityError } from "./tools.ts";
import type { TaskDefinition, ValidationReport } from "./types.ts";
import { DefaultValidationEngine } from "./validator.ts";
import { GitWorktreeManager } from "./worktree.ts";

function createTempDir(prefix = "helix-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Phase 03: Helix Core Execution Engine", () => {
  describe("1. Task Input Validation & Representation", () => {
    it("normalizes and validates a valid task definition with defaults", () => {
      const tmp = createTempDir();
      try {
        const raw = {
          prompt: "Fix the rate limiter in api.ts",
          workspaceRoot: tmp,
        };
        const task = normalizeTaskDefinition(raw);
        assert.ok(task.id.startsWith("task-"));
        assert.equal(task.title, "Fix the rate limiter in api.ts");
        assert.equal(task.workspaceRoot, path.resolve(tmp));
        assert.equal(task.constraints.maxRetries, 2);
        assert.equal(task.constraints.timeoutSec, 600);
        assert.equal(task.constraints.requireDiff, true);
        assert.ok(task.constraints.forbiddenPaths.includes("secrets/"));
        assert.ok(task.constraints.forbiddenPaths.includes(".env*"));
      } finally {
        cleanupDir(tmp);
      }
    });

    it("clamps maxRetries to hard ceiling of 2", () => {
      const tmp = createTempDir();
      try {
        const task = normalizeTaskDefinition({
          prompt: "Test prompt",
          workspaceRoot: tmp,
          constraints: { maxRetries: 10 },
        });
        assert.equal(task.constraints.maxRetries, 2);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("rejects invalid inputs with descriptive error", () => {
      assert.throws(() => normalizeTaskDefinition(null), /non-null object/);
      assert.throws(() => normalizeTaskDefinition({}), /Prompt must be a non-empty string/);
      assert.throws(
        () =>
          normalizeTaskDefinition({
            prompt: "Do something",
            workspaceRoot: "/non/existent/path/xyz",
          }),
        /Workspace root does not exist on disk/,
      );
    });
  });

  describe("2. Task Planner", () => {
    it("creates a single-agent plan for standard tasks", async () => {
      const tmp = createTempDir();
      try {
        const planner = new DefaultTaskPlanner();
        const task = normalizeTaskDefinition({
          prompt: "Update config loader",
          workspaceRoot: tmp,
          targetFiles: ["src/config.ts"],
        });
        const plan = await planner.plan(task);
        assert.equal(plan.tier, "trivial");
        assert.equal(plan.steps.length, 1);
        assert.equal(plan.steps[0].role, "single-agent");
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("3. Execution State Management", () => {
    it("records events and persists state snapshot to disk", async () => {
      const tmp = createTempDir();
      try {
        const stateManager = new FileExecutionStateManager("task-123", "trivial", {
          storageDir: tmp,
        });

        await stateManager.recordEvent({
          taskId: "task-123",
          type: "task_started",
          workflowState: "classified",
          payload: { action: "init" },
        });

        await stateManager.recordEvent({
          taskId: "task-123",
          type: "agent_launched",
          workflowState: "implemented",
          payload: { step: 1 },
        });

        const snapshot = stateManager.getSnapshot();
        assert.equal(snapshot.taskId, "task-123");
        assert.equal(snapshot.workflowState, "implemented");
        assert.equal(snapshot.events.length, 2);

        // Test loading from disk
        const loadedManager = new FileExecutionStateManager("task-123", "trivial", {
          storageDir: tmp,
        });
        const loaded = await loadedManager.load("task-123");
        assert.ok(loaded);
        assert.equal(loaded.taskId, "task-123");
        assert.equal(loaded.events.length, 2);
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("4. Tool Execution Interface & Security Confinement", () => {
    it("executes benign shell command with output bounding", async () => {
      const tmp = createTempDir();
      try {
        const tools = new DefaultToolExecutor();
        const res = await tools.executeCommand("echo 'Hello Helix'", {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 5000,
        });
        assert.equal(res.exitCode, 0);
        assert.equal(res.output.trim(), "Hello Helix");
        assert.equal(res.truncated, false);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("prevents reading outside the workspace root", async () => {
      const tmp = createTempDir();
      try {
        const tools = new DefaultToolExecutor();
        await assert.rejects(
          async () => {
            await tools.readFile("../../../etc/passwd", undefined, undefined, {
              workspaceRoot: tmp,
              environmentVariables: {},
              forbiddenPaths: [],
              maxOutputBytes: 1024,
              timeoutMs: 5000,
            });
          },
          (err) => err instanceof ToolSecurityError,
        );
      } finally {
        cleanupDir(tmp);
      }
    });

    it("prevents access to forbidden secrets and .env files", async () => {
      const tmp = createTempDir();
      try {
        const tools = new DefaultToolExecutor();
        await assert.rejects(
          async () => {
            await tools.writeFile(".env.production", "SECRET=123", {
              workspaceRoot: tmp,
              environmentVariables: {},
              forbiddenPaths: [".env*"],
              maxOutputBytes: 1024,
              timeoutMs: 5000,
            });
          },
          (err) => err instanceof ToolSecurityError,
        );
      } finally {
        cleanupDir(tmp);
      }
    });

    it("handles command timeout cleanly", async () => {
      const tmp = createTempDir();
      try {
        const tools = new DefaultToolExecutor();
        const res = await tools.executeCommand("sleep 3", {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 100, // 100ms timeout
        });
        assert.equal(res.exitCode, 124);
        assert.equal(res.error, "ETIMEDOUT");
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("5. Context Manager & Token Optimization", () => {
    it("assembles context within token budget", async () => {
      const tmp = createTempDir();
      try {
        const contextMgr = new DefaultContextManager(DEFAULT_CONTEXT_BUDGET);
        const task = normalizeTaskDefinition({
          prompt: "Fix bug in calculation",
          workspaceRoot: tmp,
          targetFiles: ["calc.ts"],
        });
        const planner = new DefaultTaskPlanner();
        const plan = await planner.plan(task);

        const ctx = await contextMgr.assembleContext(task, plan);
        assert.ok(ctx.tokenCount <= DEFAULT_CONTEXT_BUDGET.totalPromptMaxTokens);
        assert.ok(ctx.systemPrompt.includes("Helix Single-Agent Execution"));
        assert.ok(ctx.taskPrompt.includes("Fix bug in calculation"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("6. Validation Engine & Diagnostics", () => {
    it("extracts minimal failing assertions stripping noise", () => {
      const validator = new DefaultValidationEngine();
      const report: ValidationReport = {
        passed: false,
        durationMs: 120,
        failingStage: "tests",
        checks: [
          {
            stage: "lint",
            passed: true,
            command: "eslint .",
            exitCode: 0,
            durationMs: 50,
            stdout: "All files pass linting\nChecked 100 files",
            stderr: "",
          },
          {
            stage: "tests",
            passed: false,
            command: "npm test",
            exitCode: 1,
            durationMs: 70,
            stdout: "",
            stderr: "AssertionError: expected true to equal false\n  at test/calc.test.ts:42:10",
            failuresOnly:
              "AssertionError: expected true to equal false\n  at test/calc.test.ts:42:10",
          },
        ],
      };

      const diagnostics = validator.extractDiagnostics(report, 400);
      assert.ok(diagnostics.includes("TESTS"));
      assert.ok(diagnostics.includes("AssertionError"));
      assert.ok(!diagnostics.includes("All files pass linting")); // passing stage excluded
    });
  });

  describe("7. Helix Execution Engine: End-to-End Single-Agent Pipeline", () => {
    it("executes a task successfully end-to-end with mock agent runner", async () => {
      const tmp = createTempDir();
      try {
        // Setup mock target file in workspace
        const targetFile = "app.ts";
        fs.writeFileSync(path.join(tmp, targetFile), "export const version = 1;\n");

        const runner = new MockAgentRunner("opencode", [
          {
            exitCode: 0,
            stdout: "Updated version to 2.",
            fileEdits: {
              [targetFile]: "export const version = 2;\n",
            },
          },
        ]);

        const worktreeManager = new GitWorktreeManager();
        const engine = new HelixExecutionEngine({
          runner,
          worktreeManager,
        });

        const taskInput: TaskDefinition = normalizeTaskDefinition({
          id: "task-success-e2e",
          prompt: "Bump version to 2 in app.ts",
          workspaceRoot: tmp,
          targetFiles: [targetFile],
          passCommand: "true", // zero-token pass
        });

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "succeeded");
        assert.equal(result.finalWorkflowState, "completed");
        assert.ok(result.affectedFiles.includes(targetFile));
        assert.ok(result.diff.includes("+export const version = 2;"));
        assert.equal(result.validation.passed, true);
        assert.ok(result.metrics.wallClockDurationMs >= 0);
        assert.equal(result.metrics.retriesAttempted, 0);

        // Verify state snapshot
        const state = await engine.getState("task-success-e2e");
        assert.ok(state);
        assert.equal(state.workflowState, "completed");
      } finally {
        cleanupDir(tmp);
      }
    });

    it("handles invalid task input gracefully", async () => {
      const engine = new HelixExecutionEngine();
      // @ts-expect-error Testing invalid input at runtime
      const result = await engine.execute({ prompt: "", workspaceRoot: "/non/existent" });

      assert.equal(result.status, "failed");
      assert.equal(result.finalWorkflowState, "blocked");
      assert.equal(result.error?.code, "INVALID_TASK_INPUT");
    });

    it("handles agent failure and recovers on bounded retry", async () => {
      const tmp = createTempDir();
      try {
        const targetFile = "calc.ts";
        fs.writeFileSync(
          path.join(tmp, targetFile),
          "export function add(a: number, b: number) { return 0; }\n",
        );

        // Mock runner: first call fails, second call fixes file
        let callIndex = 0;
        const runner = new MockAgentRunner("opencode", () => {
          callIndex++;
          if (callIndex === 1) {
            return {
              exitCode: 1,
              stderr: "SyntaxError: Unexpected identifier in calc.ts",
            };
          }
          return {
            exitCode: 0,
            stdout: "Fixed add function.",
            fileEdits: {
              [targetFile]: "export function add(a: number, b: number) { return a + b; }\n",
            },
          };
        });

        const engine = new HelixExecutionEngine({ runner });

        const taskInput = normalizeTaskDefinition({
          id: "task-retry-recovery",
          prompt: "Fix add function in calc.ts",
          workspaceRoot: tmp,
          targetFiles: [targetFile],
          passCommand: "true",
        });

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "succeeded");
        assert.equal(result.metrics.retriesAttempted, 1);
        assert.equal(callIndex, 2);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("fails cleanly when agent failure retries are exhausted", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [
          { exitCode: 1, stderr: "Fatal compiler failure 1" },
          { exitCode: 1, stderr: "Fatal compiler failure 2" },
          { exitCode: 1, stderr: "Fatal compiler failure 3" },
        ]);

        const engine = new HelixExecutionEngine({ runner });

        const taskInput = normalizeTaskDefinition({
          id: "task-retries-exhausted",
          prompt: "Refactor core",
          workspaceRoot: tmp,
          constraints: { maxRetries: 2 },
          passCommand: "true",
        });

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "failed");
        assert.equal(result.finalWorkflowState, "blocked");
        assert.equal(result.error?.code, "EXECUTION_FAILED");
        assert.equal(result.metrics.retriesAttempted, 2);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("handles mechanical validation gate failure with retry diagnostic feedback", async () => {
      const tmp = createTempDir();
      try {
        const targetFile = "lib.ts";
        fs.writeFileSync(path.join(tmp, targetFile), "initial\n");

        let turn = 0;
        const runner = new MockAgentRunner("opencode", (session) => {
          turn++;
          // On turn 2, check that diagnostic error feedback was supplied in session prompt!
          if (turn === 2) {
            const userMsg = session.messages.find((m) => m.role === "user")?.content || "";
            assert.ok(userMsg.includes("Prior Verification Failure"));
            return {
              exitCode: 0,
              fileEdits: { [targetFile]: "passed\n" },
            };
          }
          return {
            exitCode: 0,
            fileEdits: { [targetFile]: "failed\n" },
          };
        });

        // Custom validator that fails on 'failed\n', passes on 'passed\n'
        let valCalls = 0;
        const customValidator = {
          async validate(worktreePath: string): Promise<ValidationReport> {
            valCalls++;
            const content = fs.readFileSync(path.join(worktreePath, targetFile), "utf8");
            const passed = content.trim() === "passed";
            return {
              passed,
              durationMs: 10,
              failingStage: passed ? undefined : "tests",
              checks: [
                {
                  stage: "tests" as const,
                  passed,
                  command: "npm test",
                  exitCode: passed ? 0 : 1,
                  durationMs: 10,
                  stdout: "",
                  stderr: passed ? "" : "Test failure: content mismatch",
                  failuresOnly: passed ? undefined : "Test failure: content mismatch",
                },
              ],
            };
          },
          extractDiagnostics(report: ValidationReport): string {
            return report.checks[0]?.failuresOnly || "Verification failed";
          },
        };

        const engine = new HelixExecutionEngine({
          runner,
          validator: customValidator,
        });

        const taskInput = normalizeTaskDefinition({
          id: "task-validation-diagnostic-feedback",
          prompt: "Write correct content into lib.ts",
          workspaceRoot: tmp,
          targetFiles: [targetFile],
        });

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "succeeded");
        assert.equal(valCalls, 2);
        assert.equal(result.metrics.retriesAttempted, 1);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("handles execution abort / interruption cleanly", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", async () => {
          // Delay to allow abort call
          await new Promise((r) => setTimeout(r, 200));
          return { exitCode: 0, stdout: "Done" };
        });

        const engine = new HelixExecutionEngine({ runner });

        const taskInput = normalizeTaskDefinition({
          id: "task-abort-test",
          prompt: "Long running task",
          workspaceRoot: tmp,
          passCommand: "true",
        });

        // Trigger abort asynchronously
        setTimeout(() => {
          engine.abort("task-abort-test", "User requested cancel").catch(() => {});
        }, 50);

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "cancelled");
        assert.equal(result.finalWorkflowState, "blocked");
        assert.equal(result.error?.code, "TASK_CANCELLED");
      } finally {
        cleanupDir(tmp);
      }
    });

    it("handles repeated execution cleanly and deterministically", async () => {
      const tmp = createTempDir();
      try {
        const targetFile = "repeat.ts";
        fs.writeFileSync(path.join(tmp, targetFile), "v1\n");

        const runner = new MockAgentRunner("opencode", [
          { exitCode: 0, fileEdits: { [targetFile]: "v2\n" } },
          { exitCode: 0, fileEdits: { [targetFile]: "v3\n" } },
        ]);

        const engine = new HelixExecutionEngine({ runner });

        const taskInput = normalizeTaskDefinition({
          id: "task-repeated-run",
          prompt: "Edit repeat.ts",
          workspaceRoot: tmp,
          targetFiles: [targetFile],
          passCommand: "true",
        });

        // First run
        const res1 = await engine.execute(taskInput, { isolatedWorktree: false });
        assert.equal(res1.status, "succeeded");

        // Second run with same ID
        const res2 = await engine.execute(taskInput, { isolatedWorktree: false });
        assert.equal(res2.status, "succeeded");
      } finally {
        cleanupDir(tmp);
      }
    });

    it("verifies informational questions modify zero files", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [
          { exitCode: 0, stdout: "The answer is 42." },
        ]);

        const engine = new HelixExecutionEngine({ runner });

        const taskInput = normalizeTaskDefinition({
          id: "task-question-only",
          prompt: "What is the answer?",
          workspaceRoot: tmp,
          isQuestion: true,
        });

        const result = await engine.execute(taskInput, { isolatedWorktree: false });

        assert.equal(result.status, "succeeded");
        assert.equal(result.diff, "");
        assert.equal(result.affectedFiles.length, 0);
        assert.equal(result.summary, "The answer is 42.");
      } finally {
        cleanupDir(tmp);
      }
    });
  });
});
