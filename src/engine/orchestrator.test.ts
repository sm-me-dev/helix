// Helix Multi-Agent Orchestrator Test Suite (Phase 04)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DefaultAgentOrchestrator } from "./orchestrator.ts";
import { BudgetedTeammateRunner, MockAgentRunner } from "./runner.ts";
import { normalizeTaskDefinition } from "./task.ts";
import type { TaskDefinition, ExecutionEvent } from "./types.ts";
import { runComparativeExperiment } from "./experiment.ts";
import { HelixTeamRuntime, type TeamTaskNode } from "./state.ts";
import { ProgressiveToolRuntime, createConsultPeerHandler } from "./tools.ts";
import { assembleBootstrapSystemPrompt } from "./context.ts";

function createTempDir(prefix = "helix-orchestrator-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Phase 04: Multi-Agent Orchestration Subsystem", () => {
  describe("1. Task Decomposition & Agent Assignment", () => {
    it("decomposes task into single-agent baseline", async () => {
      const tmp = createTempDir();
      try {
        const orchestrator = new DefaultAgentOrchestrator();
        const task = normalizeTaskDefinition({
          prompt: "Fix typo in readme",
          workspaceRoot: tmp,
        });

        const plan = await orchestrator.decomposeTask(task, "single-agent");
        assert.equal(plan.steps.length, 1);
        assert.equal(plan.steps[0].role, "single-agent");
        assert.deepEqual(plan.steps[0].dependencies, []);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("decomposes task into planner and implementer chain", async () => {
      const tmp = createTempDir();
      try {
        const orchestrator = new DefaultAgentOrchestrator();
        const task = normalizeTaskDefinition({
          prompt: "Refactor database connection pool",
          workspaceRoot: tmp,
          targetFiles: ["src/db.ts"],
        });

        const plan = await orchestrator.decomposeTask(task, "single-agent-with-planning");
        assert.equal(plan.steps.length, 2);
        assert.equal(plan.steps[0].role, "planner");
        assert.equal(plan.steps[1].role, "implementer");
        assert.deepEqual(plan.steps[1].dependencies, ["step-planner"]);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("decomposes task into multiple modular implementers", async () => {
      const tmp = createTempDir();
      try {
        const orchestrator = new DefaultAgentOrchestrator();
        const task = normalizeTaskDefinition({
          prompt: "Update API schemas and database models",
          workspaceRoot: tmp,
          targetFiles: ["src/api/schema.ts", "src/models/user.ts"],
        });

        const plan = await orchestrator.decomposeTask(task, "multiple-implementers");
        assert.equal(plan.steps.length, 3);
        assert.equal(plan.steps[0].role, "planner");
        assert.equal(plan.steps[1].role, "implementer");
        assert.equal(plan.steps[2].role, "implementer");
        assert.deepEqual(plan.steps[1].dependencies, ["step-planner"]);
        assert.deepEqual(plan.steps[2].dependencies, ["step-implementer-0"]);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("decomposes task into parallel implementation with integration and reviewer", async () => {
      const tmp = createTempDir();
      try {
        const orchestrator = new DefaultAgentOrchestrator();
        const task = normalizeTaskDefinition({
          prompt: "Parallel refactor of frontend and backend modules",
          workspaceRoot: tmp,
          targetFiles: ["src/frontend.ts", "src/backend.ts"],
        });

        const plan = await orchestrator.decomposeTask(task, "parallel-implementation");
        assert.equal(plan.steps.length, 5); // Planner, Implementer 0, Implementer 1, Integrator, Reviewer
        assert.equal(plan.steps[0].role, "planner");
        assert.equal(plan.steps[1].role, "implementer");
        assert.equal(plan.steps[2].role, "implementer");
        assert.equal(plan.steps[3].role, "single-agent"); // Integrator
        assert.equal(plan.steps[4].role, "reviewer");

        // Implementers are independent and depend only on planner
        assert.deepEqual(plan.steps[1].dependencies, ["step-planner"]);
        assert.deepEqual(plan.steps[2].dependencies, ["step-planner"]);
        // Integrator depends on both parallel implementers
        assert.deepEqual(plan.steps[3].dependencies, [
          "step-parallel-implementer-0",
          "step-parallel-implementer-1",
        ]);
        // Reviewer depends on integrator
        assert.deepEqual(plan.steps[4].dependencies, ["step-integrator"]);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("enforces independent review when security sensitive flag is true", async () => {
      const tmp = createTempDir();
      try {
        const orchestrator = new DefaultAgentOrchestrator();
        const task = normalizeTaskDefinition({
          prompt: "Rotate authentication tokens and secrets hashing",
          workspaceRoot: tmp,
          securitySensitive: true,
        });

        const plan = await orchestrator.decomposeTask(task, "chain");
        assert.equal(plan.independentReviewRequired, true);
        const reviewerStep = plan.steps.find((s) => s.role === "reviewer");
        assert.ok(reviewerStep, "Reviewer step must be present in chain");
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("2. 12-Line Handoff Contract", () => {
    it("creates a valid 12-line handoff card adhering strictly to HANDOFF_MAX_LINES", () => {
      const orchestrator = new DefaultAgentOrchestrator();
      const card = orchestrator.createHandoff({
        goal: "Refactor cache eviction algorithm",
        constraints: "Preserve LRU interface; no memory leak",
        file: "src/cache.ts",
        done: "npm test succeeds with 0 failures",
        outOfScope: "Redis remote adapter",
      });

      assert.ok(card.lineCount <= 12, `Line count was ${card.lineCount}, expected <= 12`);
      assert.ok(card.serializedText.includes("goal: Refactor cache eviction algorithm"));
      assert.ok(card.serializedText.includes("file: src/cache.ts"));
      assert.ok(card.serializedText.includes("done: npm test succeeds with 0 failures"));
    });

    it("compacts files array if input would otherwise exceed 12 lines", () => {
      const orchestrator = new DefaultAgentOrchestrator();
      const card = orchestrator.createHandoff({
        goal: "Broad codebase lint sweep",
        constraints: "Zero errors",
        files: [
          "src/f1.ts",
          "src/f2.ts",
          "src/f3.ts",
          "src/f4.ts",
          "src/f5.ts",
          "src/f6.ts",
          "src/f7.ts",
          "src/f8.ts",
          "src/f9.ts",
          "src/f10.ts",
          "src/f11.ts",
        ],
        done: "Gate clean",
      });

      assert.ok(card.lineCount <= 12, `Compacted line count ${card.lineCount} must not exceed 12`);
    });

    it("sanitizes multi-line inputs into single lines to prevent line count explosion", () => {
      const orchestrator = new DefaultAgentOrchestrator();
      const card = orchestrator.createHandoff({
        goal: "Line 1\nLine 2\nLine 3",
        constraints: "Constraint 1\nConstraint 2",
        file: "src/api.ts",
        done: "Done 1\nDone 2",
      });

      assert.ok(card.lineCount <= 12);
      assert.ok(card.goal.includes("Line 1 Line 2 Line 3"));
    });
  });

  describe("3. Independent Review Verification", () => {
    it("accepts a compliant diff when reviewer outputs PASS", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [
          {
            exitCode: 0,
            stdout:
              "VERDICT: PASS\nSUMMARY: Diff verified against acceptance criteria with zero issues.",
          },
        ]);
        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Add helper function",
          workspaceRoot: tmp,
        });

        const diff =
          "--- a/src/lib.ts\n+++ b/src/lib.ts\n@@ -1 +1,2 @@\n+export function helper() { return 1; }";
        const review = await orchestrator.reviewChanges(task, diff);

        assert.equal(review.verdict, "PASS");
        assert.equal(review.evidence.length, 0);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("rejects diff and extracts file:line evidence when reviewer outputs FAIL", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [
          {
            exitCode: 0,
            stdout:
              "VERDICT: FAIL\nSUMMARY: Missing validation checks.\nEVIDENCE:\nfile: src/auth.ts:42: Password not hashed before storage",
          },
        ]);
        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Implement user authentication",
          workspaceRoot: tmp,
        });

        const diff =
          "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -40,3 +40,3 @@\n+user.password = rawPassword;";
        const review = await orchestrator.reviewChanges(task, diff);

        assert.equal(review.verdict, "FAIL");
        assert.equal(review.evidence.length, 1);
        assert.equal(review.evidence[0].file, "src/auth.ts");
        assert.equal(review.evidence[0].line, 42);
        assert.ok(review.evidence[0].issue.includes("Password not hashed"));
      } finally {
        cleanupDir(tmp);
      }
    });

    it("immediately fails review if diff touches forbidden path patterns", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [{ exitCode: 0, stdout: "VERDICT: PASS" }]);
        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Update configs",
          workspaceRoot: tmp,
        });

        const diff = "--- /dev/null\n+++ b/.env.production\n@@ -0,0 +1 @@\n+SECRET_API_KEY=exposed";
        const review = await orchestrator.reviewChanges(task, diff);

        assert.equal(review.verdict, "FAIL");
        assert.ok(review.summary.includes("forbidden path"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("4. Conflict Detection and Change Integration", () => {
    it("detects conflict when two parallel subtasks modify the same file", () => {
      const orchestrator = new DefaultAgentOrchestrator();
      const outcomes = [
        {
          stepId: "step-1",
          role: "implementer" as const,
          status: "completed" as const,
          worktreePath: "/tmp/wt1",
          diff: "+change A",
          affectedFiles: ["src/shared.ts", "src/moduleA.ts"],
          stdout: "OK",
          stderr: "",
          durationMs: 100,
        },
        {
          stepId: "step-2",
          role: "implementer" as const,
          status: "completed" as const,
          worktreePath: "/tmp/wt2",
          diff: "+change B",
          affectedFiles: ["src/shared.ts", "src/moduleB.ts"],
          stdout: "OK",
          stderr: "",
          durationMs: 120,
        },
      ];

      const conflictResult = orchestrator.detectConflicts(outcomes);
      assert.equal(conflictResult.hasConflicts, true);
      assert.equal(conflictResult.conflicts.length, 1);
      assert.equal(conflictResult.conflicts[0].file, "src/shared.ts");
      assert.equal(conflictResult.conflicts[0].conflictType, "overlapping_files");
    });

    it("reports zero conflicts when parallel subtasks modify disjoint files", () => {
      const orchestrator = new DefaultAgentOrchestrator();
      const outcomes = [
        {
          stepId: "step-1",
          role: "implementer" as const,
          status: "completed" as const,
          worktreePath: "/tmp/wt1",
          diff: "+change A",
          affectedFiles: ["src/moduleA.ts"],
          stdout: "OK",
          stderr: "",
          durationMs: 100,
        },
        {
          stepId: "step-2",
          role: "implementer" as const,
          status: "completed" as const,
          worktreePath: "/tmp/wt2",
          diff: "+change B",
          affectedFiles: ["src/moduleB.ts"],
          stdout: "OK",
          stderr: "",
          durationMs: 120,
        },
      ];

      const conflictResult = orchestrator.detectConflicts(outcomes);
      assert.equal(conflictResult.hasConflicts, false);
      assert.equal(conflictResult.conflicts.length, 0);
    });
  });

  describe("5. Execution Cancellation & Failure Recovery", () => {
    it("aborts active orchestration runs cleanly", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { exitCode: 0, stdout: "Completed after delay" };
        });

        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Long running multi-agent workflow",
          workspaceRoot: tmp,
        });

        const plan = await orchestrator.decomposeTask(task, "single-agent-with-planning");
        const execPromise = orchestrator.orchestrateChain(task, plan, { isolatedWorktree: false });

        // Trigger abort while running
        setTimeout(() => {
          orchestrator.abort(task.id, "Test cancellation");
        }, 30);

        const result = await execPromise;
        assert.equal(result.status, "cancelled");
        assert.ok(result.summary.includes("cancelled") || result.summary.includes("aborted"));
      } finally {
        cleanupDir(tmp);
      }
    });

    it("recovers gracefully when a subtask fails by failing execution without crash", async () => {
      const tmp = createTempDir();
      try {
        const runner = new MockAgentRunner("opencode", [
          { exitCode: 1, stderr: "Syntax error in generated code" },
        ]);

        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Task that encounters failure",
          workspaceRoot: tmp,
        });

        const plan = await orchestrator.decomposeTask(task, "single-agent-with-planning");
        const result = await orchestrator.orchestrateChain(task, plan, { isolatedWorktree: false });

        assert.equal(result.status, "failed");
        assert.ok(result.error);
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("6. Dependency-Aware DAG & Parallel Execution", () => {
    it("executes independent subtasks in parallel across isolated workdirs", async () => {
      const tmp = createTempDir();
      try {
        const events: ExecutionEvent[] = [];
        const runner = new MockAgentRunner("opencode", (session) => {
          if (session.role === "planner") {
            return { exitCode: 0, stdout: "Decomposition ready" };
          }
          if (session.role === "reviewer") {
            return { exitCode: 0, stdout: "VERDICT: PASS" };
          }
          return {
            exitCode: 0,
            stdout: "Implementer finished",
            fileEdits: { "src/res.ts": "export const a = 1;\n" },
          };
        });

        const orchestrator = new DefaultAgentOrchestrator({ runner });
        const task = normalizeTaskDefinition({
          prompt: "Parallel build test",
          workspaceRoot: tmp,
          targetFiles: ["src/a.ts", "src/b.ts"],
        });

        const plan = await orchestrator.decomposeTask(task, "parallel-implementation");
        const result = await orchestrator.orchestrateParallel(task, plan, {
          isolatedWorktree: false,
          onEvent: (e) => events.push(e),
        });

        assert.equal(result.status, "succeeded");
        const stepStartedEvents = events.filter((e) => e.type === "step_started");
        assert.ok(stepStartedEvents.length >= 3, "Multiple steps must have executed");
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("7. 5-Arm Comparative Experiment Benchmark", () => {
    it("executes all 5 arms and generates empirical comparison table", async () => {
      const tmp = createTempDir();
      try {
        const benchmarkTasks: TaskDefinition[] = [
          normalizeTaskDefinition({
            id: "bench-task-1",
            prompt: "Refactor moduleA and moduleB with updated helper signature",
            workspaceRoot: tmp,
            targetFiles: ["src/moduleA.ts", "src/moduleB.ts"],
          }),
        ];

        const report = await runComparativeExperiment(benchmarkTasks);

        // Verify all 5 arms were evaluated
        assert.ok(report.arms["single-agent"]);
        assert.ok(report.arms["single-agent-with-planning"]);
        assert.ok(report.arms["multiple-implementers"]);
        assert.ok(report.arms["implementer-plus-reviewer"]);
        assert.ok(report.arms["parallel-implementation"]);

        // Validate table content
        assert.ok(report.comparisonTable.includes("1. Single-Agent Execution (Baseline)"));
        assert.ok(report.comparisonTable.includes("2. Single Agent with Planning"));
        assert.ok(report.comparisonTable.includes("3. Multiple Implementers"));
        assert.ok(report.comparisonTable.includes("4. Implementer + Independent Reviewer"));
        assert.ok(report.comparisonTable.includes("5. Parallel Implementation + Integration"));

        // Single-agent baseline must have lowest token consumption
        const baseline = report.arms["single-agent"];
        const reviewerArm = report.arms["implementer-plus-reviewer"];
        assert.ok(baseline.meanTotalTokens > 0);
        assert.ok(reviewerArm.meanTotalTokens >= baseline.meanTotalTokens);

        // All arms must have valid pass rates
        for (const arm of Object.values(report.arms)) {
          assert.ok(arm.passRate >= 0 && arm.passRate <= 100);
          assert.ok(arm.meanDurationMs >= 0);
        }

        // Conclusion must be populated with findings
        assert.ok(report.conclusion.includes("Empirical Findings"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });
});

describe("Phase 4 peer team runtime", () => {
  function teamTask(taskId: string, ownedPaths: string[], dependsOn: string[] = []): TeamTaskNode {
    return {
      taskId,
      title: taskId,
      description: taskId,
      ownedPaths,
      dependsOn,
      status: "pending",
      planApprovedByLead: false,
    };
  }

  it("serializes claims, blocks overlapping paths and uncompleted dependencies", () => {
    const root = createTempDir();
    try {
      const team = new HelixTeamRuntime({
        workspaceRoot: root,
        teamId: "claims",
        tasks: [
          teamTask("first", ["src/shared/**"]),
          teamTask("overlap", ["src/shared/file.ts"]),
          teamTask("parent", ["lib/**"]),
          teamTask("child", ["test/**"], ["parent"]),
        ],
      });
      assert.equal(team.claimTask("first", "agent-a").status, "awaiting_plan_approval");
      assert.throws(() => team.claimTask("overlap", "agent-b"), /overlaps active task/);
      assert.throws(() => team.claimTask("child", "agent-c"), /uncompleted dependency/);
    } finally {
      cleanupDir(root);
    }
  });

  it("blocks teammate writes until the lead approves its submitted plan", async () => {
    const root = createTempDir();
    try {
      const team = new HelixTeamRuntime({
        workspaceRoot: root,
        teamId: "write-gate",
        tasks: [teamTask("implementation", ["src/**"])],
      });
      team.claimTask("implementation", "builder");
      const { state } = assembleBootstrapSystemPrompt({
        workspaceRoot: root,
        sessionId: "teammate-write",
        maxContextTokens: 1000,
      });
      const runtime = new ProgressiveToolRuntime({
        workspaceRoot: root,
        state,
        teamRuntime: team,
        teammateId: "builder",
      });
      runtime.toolSearch("write file");
      const blocked = await runtime.invoke("Write", {
        filePath: "src/new.ts",
        content: "export const value = 1;",
      });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content, /WriteGate blocked/);
      team.submitPlan(
        "builder",
        "implementation",
        "Own src/**; export the function without changing callers.",
      );
      assert.throws(
        () =>
          team.approve_teammate_plan("builder", {
            teammate_id: "builder",
            task_id: "implementation",
            approved: true,
          }),
        /Only the lead agent/,
      );
      const { state: leadState } = assembleBootstrapSystemPrompt({
        workspaceRoot: root,
        sessionId: "lead-approval",
        maxContextTokens: 1000,
      });
      const leadRuntime = new ProgressiveToolRuntime({
        workspaceRoot: root,
        state: leadState,
        teamRuntime: team,
        teammateId: "lead",
      });
      leadRuntime.toolSearch("approve teammate plan");
      const approval = await leadRuntime.invoke("approve_teammate_plan", {
        teammate_id: "builder",
        task_id: "implementation",
        approved: true,
      });
      assert.notEqual(approval.isError, true, approval.content);
      const written = await runtime.invoke("Write", {
        filePath: "src/new.ts",
        content: "export const value = 1;",
      });
      assert.equal(written.isError, false, written.content);
      assert.equal(
        fs.readFileSync(path.join(root, "src/new.ts"), "utf8"),
        "export const value = 1;",
      );
    } finally {
      cleanupDir(root);
    }
  });

  it("mounts raw on-disk slices and routes peer consultation to an orthogonal harness", async () => {
    const root = createTempDir();
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "src/peer.ts"),
        "const first = 1;\nconst raw = 'preserve me';\nreturn raw;\n",
        "utf8",
      );
      let observedRoute = "";
      let observedPrompt = "";
      const consult = createConsultPeerHandler({
        workspaceRoot: root,
        generatorProvider: "claude",
        resolveApi: () => ({
          endpoint: "https://peer.example.test/review",
          format: "openai-chat-completions",
        }),
        invoke: async (route, prompt) => {
          observedRoute = `${route.harness}/${route.modelId}`;
          observedPrompt = prompt;
          return "Check whether the return path preserves the original value.";
        },
      });
      const result = await consult({
        question: "Review this change",
        proposedApproach: "Keep the local variable",
        fileSlices: [{ filePath: "src/peer.ts", startLine: 2, endLine: 3 }],
      });
      assert.match(observedRoute, /^codex\//);
      assert.ok(observedPrompt.includes("const raw = 'preserve me';\nreturn raw;"));
      assert.ok(!observedPrompt.includes("const first = 1;"));
      assert.match(result.content, /gpt-6\.1-sol/);
    } finally {
      cleanupDir(root);
    }
  });

  it("runs heterogeneous hypothesis investigators and gives them competing findings", async () => {
    const root = createTempDir();
    try {
      const team = new HelixTeamRuntime({ workspaceRoot: root, teamId: "hypotheses" });
      const calls: Array<{ provider: string; peers: number }> = [];
      const proof = await team.spawnHypothesisTeam({
        bugDescription: "A request path fails intermittently",
        candidateHypotheses: ["stale cache", "racy update", "bad parse"],
        targetFiles: ["src/bug.ts"],
        investigate: async ({ hypothesis, provider, competingFindings }) => {
          calls.push({ provider, peers: competingFindings.length });
          return {
            evidence: ["src/bug.ts:8"],
            disproved: hypothesis !== "racy update" && competingFindings.length > 0,
          };
        },
      });
      assert.equal(new Set(calls.slice(0, 3).map((call) => call.provider)).size, 3);
      assert.ok(calls.slice(3).every((call) => call.peers === 2));
      assert.equal(proof.hypothesis, "racy update");
      assert.deepEqual(proof.evidence, ["src/bug.ts:8"]);
    } finally {
      cleanupDir(root);
    }
  });

  it("ranks multiple cited hypothesis survivors and applies peer falsifications", async () => {
    const root = createTempDir();
    try {
      const team = new HelixTeamRuntime({ workspaceRoot: root, teamId: "hypothesis-ranking" });
      const proof = await team.spawnHypothesisTeam({
        bugDescription: "A retry is lost",
        candidateHypotheses: ["lost write", "stale read", "bad parse"],
        targetFiles: ["src/retry.ts"],
        investigate: async ({ hypothesis, competingFindings }) => {
          if (competingFindings.length === 0) return { evidence: ["src/retry.ts:1"] };
          if (hypothesis === "lost write") {
            return {
              evidence: ["src/retry.ts:11", "src/retry.ts:12"],
              falsifiedHypotheses: ["stale read"],
            };
          }
          if (hypothesis === "bad parse") {
            return { evidence: ["src/retry.ts:21", "src/retry.ts:22", "src/retry.ts:23"] };
          }
          return { evidence: ["src/retry.ts:31"] };
        },
      });
      assert.equal(proof.hypothesis, "bad parse");
      assert.deepEqual(proof.evidence, ["src/retry.ts:21", "src/retry.ts:22", "src/retry.ts:23"]);
      assert.deepEqual(proof.falsifiedHypotheses, ["stale read"]);
    } finally {
      cleanupDir(root);
    }
  });

  it("caps peer team membership and applies per-teammate turn and token budgets", async () => {
    const delegate = new MockAgentRunner("opencode", [
      { stdout: "brief result", tokens: { input: 10, output: 5 } },
    ]);
    assert.throws(
      () =>
        new BudgetedTeammateRunner(delegate, {
          a: { tokenBudget: 100, turnBudget: 2 },
          b: { tokenBudget: 100, turnBudget: 2 },
          c: { tokenBudget: 100, turnBudget: 2 },
          d: { tokenBudget: 100, turnBudget: 2 },
          e: { tokenBudget: 100, turnBudget: 2 },
        }),
      /at most four/,
    );
    const runner = new BudgetedTeammateRunner(delegate, {
      builder: { tokenBudget: 100, turnBudget: 3 },
    });
    const session = {
      sessionId: "budgeted",
      taskId: "budgeted-task",
      role: "implementer" as const,
      platform: "opencode" as const,
      workdir: process.cwd(),
      systemPrompt: "",
      messages: [],
      timeoutSec: 30,
      teammateId: "builder",
      teamId: "team-a",
    };
    assert.equal((await runner.run(session)).exitCode, 0);
    assert.equal(delegate.calls[0]?.maxTurns, 3);
    assert.equal(delegate.calls[0]?.maxTokenBudget, 100);
    const exhausted = await runner.run(session);
    assert.equal(exhausted.exitCode, 1);
    assert.match(exhausted.stderr, /turn budget/);
  });
});
