import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBenchmarkTasks, runBenchmark } from "../benchmarks/runners/run.mjs";
import { normalizeRecords, computeCostPerSuccess } from "../benchmarks/evaluators/compare.mjs";
import {
  generateCompletionChart,
  generateTokenChart,
  generateDurationChart,
  generateAllCharts,
} from "../benchmarks/scripts/generate-charts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("Benchmark Schema & Infrastructure Tests (Phase 12)", () => {
  it("validates that execution-record.schema.json exists and defines required fields", () => {
    const schemaPath = join(ROOT, "benchmarks", "schemas", "execution-record.schema.json");
    assert.ok(existsSync(schemaPath), "Schema file must exist");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    assert.equal(schema.type, "object");
    const required = schema.required;
    assert.ok(required.includes("run_id"));
    assert.ok(required.includes("task_id"));
    assert.ok(required.includes("mode"));
    assert.ok(required.includes("model"));
    assert.ok(required.includes("success"));
    assert.ok(required.includes("input_tokens"));
    assert.ok(required.includes("output_tokens"));
    assert.ok(required.includes("total_tokens"));
    assert.ok(required.includes("duration_seconds"));
  });

  it("loads all 7 task definitions in benchmarks/tasks", () => {
    const tasks = loadBenchmarkTasks();
    assert.equal(tasks.length, 7, "Must load all 7 task definitions");
    const categories = new Set(tasks.map((t) => t.category));
    assert.ok(categories.has("repository-understanding"));
    assert.ok(categories.has("bug-fixing"));
    assert.ok(categories.has("feature-implementation"));
    assert.ok(categories.has("refactoring-maintenance"));
    assert.ok(categories.has("complex-workflows"));
    assert.ok(categories.has("knowledge-retention"));
    assert.ok(categories.has("multi-agent-workflows"));
  });

  it("executes simulated benchmark runner and outputs compliant standard records", async () => {
    const { records } = await runBenchmark({
      mode: "helix",
      runs: 1,
      category: "bug-fixing",
      model: "mock-runner",
    });
    assert.ok(records.length > 0);
    const r = records[0];
    assert.equal(r.mode, "helix");
    assert.equal(r.task_id, "bench-bugfix-limiter");
    assert.equal(typeof r.success, "boolean");
    assert.equal(typeof r.total_tokens, "number");
    assert.equal(typeof r.duration_seconds, "number");
  });

  it("normalizes records and preserves failed runs with error details", () => {
    const mockRecords = [
      {
        run_id: "task-1-helix-1",
        task_id: "task-1",
        mode: "helix",
        success: true,
        input_tokens: 100,
        output_tokens: 50,
        duration_seconds: 1.2,
        estimated_cost_usd: 0.001,
        tool_calls: 3,
        retries: 0,
        error: null,
      },
      {
        run_id: "task-1-helix-2",
        task_id: "task-1",
        mode: "helix",
        success: false,
        input_tokens: 150,
        output_tokens: 30,
        duration_seconds: 2.0,
        estimated_cost_usd: 0.0015,
        tool_calls: 5,
        retries: 2,
        error: "Validation failed: test suite failed",
      },
    ];

    const normalized = normalizeRecords(mockRecords);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].pass, true);
    assert.equal(normalized[1].pass, false);
    assert.equal(normalized[1].retries, 2);

    const costSummary = computeCostPerSuccess(normalized);
    assert.equal(costSummary.helix.passes, 1);
    assert.equal(costSummary.helix.totalRuns, 2);
    assert.equal(costSummary.helix.totalCost, 0.0025);
    assert.equal(costSummary.helix.costPerSuccess, 0.0025);
  });

  it("generates valid Mermaid charts from paired stats data", () => {
    const mockStats = [
      {
        arm: "helix-min",
        pooled: {
          pairs: 16,
          passBaseline: 16,
          passArm: 16,
          tokenChangePct: -12.7,
          ciLowPct: -23.9,
          ciHighPct: -0.3,
          wallRatioMedian: 1.2,
        },
      },
    ];

    const compChart = generateCompletionChart(mockStats);
    assert.ok(compChart.includes("```mermaid"));
    assert.ok(compChart.includes("xychart-beta"));
    assert.ok(compChart.includes("helix-min"));

    const tokChart = generateTokenChart(mockStats);
    assert.ok(tokChart.includes("xychart-beta"));
    assert.ok(tokChart.includes("-12.7"));

    const durChart = generateDurationChart(mockStats);
    assert.ok(durChart.includes("1.20"));

    const fullDashboard = generateAllCharts({
      meta: { agent: "opencode", fixture: "large", date: "2026-10-13" },
      stats: mockStats,
    });
    assert.ok(fullDashboard.includes("# Helix Visual Benchmark Evidence Dashboard"));
    assert.ok(fullDashboard.includes("## 1. Task Completion & Reliability"));
    assert.ok(fullDashboard.includes("## 2. Token Consumption & Efficiency"));
  });
});
