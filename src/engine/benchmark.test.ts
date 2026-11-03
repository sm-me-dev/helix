// Helix Repeatable Benchmark Suite Test Suite (Phase 07)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_STRATEGIES,
  BENCHMARK_TASKS,
  RepeatableBenchmarkSuite,
  STRATEGY_METADATA,
} from "./benchmark.ts";

describe("Phase 07: Repeatable Benchmark Suite & Evaluation Framework", () => {
  describe("1. Benchmark Catalog Schema & Category Coverage", () => {
    it("covers all 10 mandatory benchmark categories", () => {
      const suite = new RepeatableBenchmarkSuite();
      const tasks = suite.getTasks();

      const coveredCategories = new Set(tasks.map((t) => t.category));
      for (const cat of BENCHMARK_CATEGORIES) {
        assert.ok(
          coveredCategories.has(cat),
          `Missing task for mandatory benchmark category: ${cat}`,
        );
      }
      assert.equal(BENCHMARK_CATEGORIES.length, 10);
    });

    it("validates that all benchmark tasks possess complete specifications", () => {
      for (const task of BENCHMARK_TASKS) {
        assert.ok(task.id.startsWith("bench-"), `Task ID ${task.id} must start with bench-`);
        assert.ok(task.title.length > 5, `Task ${task.id} missing title`);
        assert.ok(task.prompt.length > 20, `Task ${task.id} missing prompt`);
        assert.ok(["trivial", "standard", "complex"].includes(task.tier));
        assert.ok(Array.isArray(task.targetFiles));
        assert.ok(Array.isArray(task.preExistingTests));
        assert.ok(typeof task.requireDiff === "boolean");
        assert.ok(task.passCriteria.expectedModifiedFiles !== undefined);
      }
    });

    it("filters tasks correctly by category", () => {
      const suite = new RepeatableBenchmarkSuite();
      const bugTasks = suite.getTasksByCategory("bug-fixing");
      assert.ok(bugTasks.length >= 1);
      assert.ok(bugTasks.every((t) => t.category === "bug-fixing"));

      const parallelTasks = suite.getTasksByCategory("independent-subtasks");
      assert.ok(parallelTasks.length >= 1);
      assert.ok(parallelTasks[0].subtasks && parallelTasks[0].subtasks.length >= 2);
    });
  });

  describe("2. Strategy Execution & Evaluation Metrics", () => {
    it("executes single-agent baseline and collects complete 4-dimensional metrics", async () => {
      const suite = new RepeatableBenchmarkSuite();
      const task = suite.getTask("bench-bugfix-limiter")!;
      assert.ok(task);

      const result = await suite.runTask(task, "single-agent", 1);

      // 1. Quality
      assert.ok(typeof result.quality.verifiedPass === "boolean");
      assert.ok(typeof result.quality.claimedPass === "boolean");
      assert.ok(typeof result.quality.regressionDetected === "boolean");
      assert.ok(Array.isArray(result.quality.regressions));

      // 2. Tokens
      assert.ok(result.tokens.totalTokens > 0);
      assert.ok(result.tokens.inputTokens > 0);
      assert.ok(result.tokens.outputTokens > 0);
      assert.ok(result.tokens.estimatedCostUsd >= 0);

      // 3. Latency
      assert.ok(result.latency.wallClockMs > 0);
      assert.ok(result.latency.agentMs > 0);

      // 4. Reliability
      assert.ok(typeof result.reliability.success === "boolean");
      assert.equal(result.reliability.canaryLeaked, false);
      assert.equal(result.reliability.forbiddenPathAccessed, false);
    });

    it("executes all 5 required execution strategies on a task", async () => {
      const suite = new RepeatableBenchmarkSuite();
      const task = suite.getTask("bench-feature-quota-tier")!;

      for (const strat of BENCHMARK_STRATEGIES) {
        const result = await suite.runTask(task, strat, 1);
        assert.equal(result.strategy, strat);
        assert.ok(result.tokens.totalTokens > 0);
        assert.ok(result.latency.wallClockMs > 0);
      }
    });
  });

  describe("3. Separation of Claimed Success vs Verified Success & Regression Tracking", () => {
    it("distinguishes between claimed pass and verified mechanical validation", async () => {
      const suite = new RepeatableBenchmarkSuite();
      // On sequential dependencies without planning, single agent claims pass but fails verification
      const seqTask = suite.getTask("bench-sequential-pipeline")!;
      const result = await suite.runTask(seqTask, "single-agent", 1);

      assert.equal(result.quality.claimedPass, true, "Agent output claimed pass");
      assert.equal(result.quality.verifiedPass, false, "Mechanical gate caught regression");
      assert.equal(result.quality.regressionDetected, true);
      assert.ok(result.quality.regressions.length > 0);
    });

    it("verifies independent reviewer eliminates regressions on complex tasks", async () => {
      const suite = new RepeatableBenchmarkSuite();
      const seqTask = suite.getTask("bench-sequential-pipeline")!;
      const result = await suite.runTask(seqTask, "implementer-plus-reviewer", 1);

      assert.equal(result.quality.verifiedPass, true);
      assert.equal(result.quality.regressionDetected, false);
      assert.equal(result.reliability.success, true);
    });
  });

  describe("4. Benchmark Suite Aggregation & Mandatory Comparison Table", () => {
    it("runs multi-task suite and computes valid strategy comparison matrix", async () => {
      const suite = new RepeatableBenchmarkSuite();
      // Run across representative subset of categories for fast gate verification
      const report = await suite.runSuite({
        categories: ["bug-fixing", "independent-subtasks", "sequential-dependencies"],
        strategies: [...BENCHMARK_STRATEGIES],
        runsPerTask: 1,
      });

      // Verify all 5 strategies are present
      for (const strat of BENCHMARK_STRATEGIES) {
        const s = report.strategies[strat];
        assert.ok(s, `Missing strategy aggregate: ${strat}`);
        assert.equal(s.strategyName, STRATEGY_METADATA[strat].name);
        assert.ok(s.totalRuns >= 3);
        assert.ok(s.qualityScore >= 0 && s.qualityScore <= 100);
        assert.ok(s.regressionRate >= 0 && s.regressionRate <= 100);
        assert.ok(s.meanTotalTokens > 0);
        assert.ok(s.meanDurationMs > 0);
      }

      // Verify mandatory table format
      assert.ok(
        report.comparisonTable.includes("| Strategy | Quality (Pass Rate) | Tokens (Total) |"),
      );
      assert.ok(report.comparisonTable.includes("Single agent (Baseline)"));
      assert.ok(report.comparisonTable.includes("Implementer + reviewer"));
      assert.ok(report.comparisonTable.includes("Parallel implementation"));

      // Verify findings
      assert.ok(report.findings.length >= 4);

      // Verify Markdown rendering
      const md = suite.formatMarkdownReport(report);
      assert.ok(md.includes("# Helix Benchmark Evaluation Report (Phase 07)"));
      assert.ok(md.includes("## Head-to-Head Strategy Comparison Matrix"));
    });

    it("saves benchmark report to JSON artifact cleanly", () => {
      const suite = new RepeatableBenchmarkSuite();
      const tmpFile = path.join(os.tmpdir(), `helix-bench-test-${Date.now()}.json`);
      try {
        const report = {
          timestamp: new Date().toISOString(),
          environment: {
            model: "test-model",
            platform: "test-platform",
            nodeVersion: process.version,
            totalTasks: 1,
            categoriesCovered: 1,
            strategiesEvaluated: 1,
          },
          strategies: {} as any,
          results: [],
          comparisonTable: "| Test |",
          findings: ["Test finding"],
        };

        const savedPath = suite.saveReport(report as any, tmpFile);
        assert.equal(savedPath, tmpFile);
        assert.ok(fs.existsSync(tmpFile));
        const loaded = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
        assert.equal(loaded.environment.model, "test-model");
      } finally {
        try {
          fs.rmSync(tmpFile, { force: true });
        } catch {
          // Ignore
        }
      }
    });

    it("resolves strategy and category aliases correctly", async () => {
      const { resolveBenchmarkStrategy, resolveBenchmarkCategory } = await import("./benchmark.ts");
      assert.equal(resolveBenchmarkStrategy("baseline"), "single-agent");
      assert.equal(resolveBenchmarkStrategy("baseline-raw"), "single-agent");
      assert.equal(resolveBenchmarkStrategy("reviewer"), "implementer-plus-reviewer");
      assert.equal(resolveBenchmarkStrategy("unknown-strat"), null);

      assert.equal(resolveBenchmarkCategory("bugfix"), "bug-fixing");
      assert.equal(resolveBenchmarkCategory("bugfix-investigation"), "bug-fixing");
      assert.equal(resolveBenchmarkCategory("feature"), "feature-implementation");
      assert.equal(resolveBenchmarkCategory("unknown-cat"), null);
    });

    it("converts benchmark results to Section 4 standard execution records", async () => {
      const suite = new RepeatableBenchmarkSuite();
      const report = await suite.runSuite({
        strategies: ["single-agent"],
        categories: ["bug-fixing"],
        runsPerTask: 1,
      });

      const records = suite.toStandardRecords(report, "test-sha-123");
      assert.equal(records.length, 1);
      const r = records[0];
      assert.equal(r.task_id, "bench-bugfix-limiter");
      assert.equal(r.mode, "baseline");
      assert.equal(r.repository_commit, "test-sha-123");
      assert.equal(typeof r.success, "boolean");
      assert.equal(typeof r.input_tokens, "number");
      assert.equal(typeof r.output_tokens, "number");
      assert.equal(typeof r.total_tokens, "number");
      assert.equal(typeof r.duration_seconds, "number");
      assert.equal(typeof r.tool_calls, "number");
      assert.equal(r.error, null);
    });
  });
});
