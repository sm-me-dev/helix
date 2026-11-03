import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildJsonReadyCharts,
  calculateTokenEfficiency,
  collectHarnessUtilization,
  computeResourceSaturation,
  inspectWorktreeConcurrency,
  loadRunHistory,
  renderAsciiBar,
  renderAsciiTokenEfficiencyChart,
  renderAsciiUtilizationDashboard,
  TOKENIZER_METHOD,
} from "./utilization.ts";

describe("Telemetry & Harness Utilization (Phase 12 Extension)", () => {
  describe("Token Efficiency Calculations", () => {
    it("calculates token efficiency percentage and net savings delta", () => {
      const res = calculateTokenEfficiency(1000, 3000);
      assert.equal(res.efficiencyPct, 75.0);
      assert.equal(res.netSavingsDelta, 2000);
    });

    it("handles zero tokens cleanly without NaN or throwing", () => {
      const res = calculateTokenEfficiency(0, 0);
      assert.equal(res.efficiencyPct, 0);
      assert.equal(res.netSavingsDelta, 0);
    });

    it("handles zero savings with non-zero uncached tokens", () => {
      const res = calculateTokenEfficiency(1500, 0);
      assert.equal(res.efficiencyPct, 0);
      assert.equal(res.netSavingsDelta, -1500);
    });
  });

  describe("Worktree Concurrency & Queue Depth", () => {
    it("calculates active worktree concurrency and utilization percentage", () => {
      const tmpDir = path.join(os.tmpdir(), `helix-test-worktrees-${Date.now()}`);
      fs.mkdirSync(path.join(tmpDir, "worktree-task-1"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "worktree-task-2"), { recursive: true });

      try {
        const metrics = inspectWorktreeConcurrency(tmpDir, 4, 1);
        assert.equal(metrics.activeWorktrees, 2);
        assert.equal(metrics.maxConcurrentWorktrees, 4);
        assert.equal(metrics.queueDepth, 1);
        assert.equal(metrics.concurrencyUtilizationPct, 50.0);
        assert.equal(metrics.worktreePaths.length, 2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles non-existent worktree directory gracefully", () => {
      const metrics = inspectWorktreeConcurrency("/tmp/nonexistent-helix-worktrees", 4);
      assert.equal(metrics.activeWorktrees, 0);
      assert.equal(metrics.concurrencyUtilizationPct, 0);
    });
  });

  describe("Resource Saturation & Thresholds", () => {
    it("reports nominal status when concurrency and memory are below warning threshold", () => {
      const concurrency = {
        activeWorktrees: 1,
        maxConcurrentWorktrees: 8,
        queueDepth: 0,
        concurrencyUtilizationPct: 12.5,
        worktreePaths: [],
      };
      const sat = computeResourceSaturation(concurrency, 70, 85);
      assert.equal(sat.status, "nominal");
      assert.equal(sat.alerts.length, 0);
    });

    it("detects elevated status when concurrency exceeds warning threshold", () => {
      const concurrency = {
        activeWorktrees: 6,
        maxConcurrentWorktrees: 8,
        queueDepth: 2,
        concurrencyUtilizationPct: 75.0,
        worktreePaths: [],
      };
      const sat = computeResourceSaturation(concurrency, 70, 85);
      assert.equal(sat.status, "elevated");
      assert.ok(sat.alerts.some((a) => a.includes("warning threshold")));
    });

    it("detects saturated status when concurrency exceeds critical threshold", () => {
      const concurrency = {
        activeWorktrees: 8,
        maxConcurrentWorktrees: 8,
        queueDepth: 5,
        concurrencyUtilizationPct: 100.0,
        worktreePaths: [],
      };
      const sat = computeResourceSaturation(concurrency, 70, 85);
      assert.equal(sat.status, "saturated");
      assert.ok(sat.alerts.some((a) => a.includes("critical threshold")));
    });
  });

  describe("ASCII Chart Generators", () => {
    it("renders ASCII bar charts with correct filled and empty blocks", () => {
      const half = renderAsciiBar(50, 10);
      assert.equal(half, "[■■■■■□□□□□]");

      const full = renderAsciiBar(100, 10);
      assert.equal(full, "[■■■■■■■■■■]");

      const empty = renderAsciiBar(0, 10);
      assert.equal(empty, "[□□□□□□□□□□]");
    });

    it("renders ASCII token efficiency chart across historical tasks", () => {
      const points = [
        {
          timestamp: new Date().toISOString(),
          taskId: "test-task-1",
          uncachedTokens: 500,
          savedTokens: 1500,
          gateRuns: 1,
          efficiencyPct: 75.0,
          netSavingsDelta: 1000,
        },
      ];
      const chart = renderAsciiTokenEfficiencyChart(points, 10);
      assert.ok(chart.includes("test-task-1"));
      assert.ok(chart.includes("75.0%"));
      assert.ok(chart.includes("+1,500 saved"));
    });

    it("renders complete ASCII dashboard snapshot", () => {
      const snapshot = collectHarnessUtilization({ syntheticHistoryIfEmpty: true });
      const dashboard = renderAsciiUtilizationDashboard(snapshot);
      assert.ok(dashboard.includes("HELIX HARNESS UTILIZATION DASHBOARD"));
      assert.ok(dashboard.includes("System Status:"));
      assert.ok(dashboard.includes("Concurrency & Ephemeral Worktree Execution"));
      assert.ok(dashboard.includes("Token Efficiency"));
    });
  });

  describe("JSON-Ready Charts Structure", () => {
    it("constructs compliant JSON charts with series and labels", () => {
      const points = [
        {
          timestamp: new Date().toISOString(),
          taskId: "task-01",
          uncachedTokens: 800,
          savedTokens: 1600,
          gateRuns: 1,
          efficiencyPct: 66.7,
          netSavingsDelta: 800,
        },
      ];
      const concurrency = {
        activeWorktrees: 1,
        maxConcurrentWorktrees: 4,
        queueDepth: 0,
        concurrencyUtilizationPct: 25.0,
        worktreePaths: ["/tmp/wt1"],
      };
      const saturation = computeResourceSaturation(concurrency, 70, 85);
      const charts = buildJsonReadyCharts(points, concurrency, saturation);

      assert.deepEqual(charts.tokenEfficiencyTimeline.labels, ["task-01"]);
      assert.deepEqual(charts.tokenEfficiencyTimeline.uncachedTokens, [800]);
      assert.deepEqual(charts.tokenEfficiencyTimeline.savedTokens, [1600]);
      assert.deepEqual(charts.tokenEfficiencyTimeline.efficiencyPct, [66.7]);
      assert.equal(charts.concurrencyGauge.active, 1);
      assert.equal(charts.concurrencyGauge.max, 4);
      assert.equal(charts.concurrencyGauge.utilizationPct, 25.0);
      assert.equal(charts.saturationStatus.status, "nominal");
    });
  });

  describe("Report History Loader", () => {
    it("loads run reports from disk and extracts gate savings", () => {
      const tmpReports = path.join(os.tmpdir(), `helix-test-reports-${Date.now()}`);
      fs.mkdirSync(tmpReports, { recursive: true });

      try {
        fs.writeFileSync(
          path.join(tmpReports, "run-test-task.json"),
          JSON.stringify({
            gateRuns: 2,
            tokens: { inputTokens: 500, totalTokens: 600 },
            optimization: { contextReuseTokens: 200 },
          }),
        );

        const history = loadRunHistory(tmpReports);
        assert.equal(history.length, 1);
        assert.equal(history[0].taskId, "test-task");
        assert.equal(history[0].uncachedTokens, 500);
        assert.equal(history[0].savedTokens, 3000); // 2 * 1400 + 200
        assert.equal(history[0].gateRuns, 2);
      } finally {
        fs.rmSync(tmpReports, { recursive: true, force: true });
      }
    });

    it("verifies tokenizer method description matches frontier approximation", () => {
      assert.match(TOKENIZER_METHOD, /o200k_base BPE via gpt-tokenizer/);
    });
  });
});
