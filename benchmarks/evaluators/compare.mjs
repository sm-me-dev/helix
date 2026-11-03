// Helix Benchmark Evaluator & Statistical Comparison Engine
// Computes paired bootstrap statistics, exact sign tests, token ratios,
// and cost-per-successful-task metrics across benchmark execution records.

import { readFileSync, writeFileSync } from "node:fs";
import { analyze, compareArms, signTestP, verdict } from "../../scripts/paired-stats.mjs";

export { analyze, compareArms, signTestP, verdict };

/**
 * Normalizes standard execution records or eval results into paired comparison cells.
 */
export function normalizeRecords(data) {
  if (Array.isArray(data)) {
    // Array of StandardExecutionRecord
    return data.map((r) => ({
      task: r.task_id,
      arm: r.mode === "baseline" ? "none" : r.mode || "helix",
      run: Number(r.run_id.split("-").pop()) || 1,
      pass: Boolean(r.success),
      uncachedTokens: r.input_tokens + r.output_tokens,
      wallSec: r.duration_seconds,
      costUsd: r.estimated_cost_usd,
      toolCalls: r.tool_calls,
      retries: r.retries,
      invalid: r.error && r.error.includes("rate-limit") ? r.error : null,
      hung: Boolean(r.error && r.error.includes("hung")),
    }));
  }
  if (data.results) {
    return data.results;
  }
  return [];
}

/**
 * Computes cost per successful task for each arm.
 */
export function computeCostPerSuccess(cells) {
  const arms = [...new Set(cells.map((c) => c.arm))];
  const summary = {};
  for (const arm of arms) {
    const armCells = cells.filter((c) => c.arm === arm);
    const totalCost = armCells.reduce((sum, c) => sum + (c.costUsd || 0), 0);
    const passes = armCells.filter((c) => c.pass).length;
    summary[arm] = {
      totalCost,
      passes,
      totalRuns: armCells.length,
      costPerSuccess: passes > 0 ? Number((totalCost / passes).toFixed(5)) : null,
    };
  }
  return summary;
}

if (process.argv[1]?.endsWith("compare.mjs")) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);

  if (!file) {
    process.stdout.write(
      "Usage: node benchmarks/evaluators/compare.mjs <results.json> [--baseline none] [--out report.json]\n",
    );
    process.exit(2);
  }

  const raw = JSON.parse(readFileSync(file, "utf8"));
  const cells = normalizeRecords(raw);
  const baseline = opt("--baseline", "none");
  const stats = analyze({ results: cells }, baseline);
  const costStats = computeCostPerSuccess(cells);

  const outPayload = {
    evaluatedAt: new Date().toISOString(),
    baseline,
    stats,
    costStats,
  };

  process.stdout.write("# Benchmark Comparison Summary\n\n");
  for (const s of stats) {
    const p = s.pooled;
    const f = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
    process.stdout.write(
      `- **${s.arm} vs ${baseline}**: ${f(p.tokenChangePct)} tokens (95% CI: ${f(p.ciLowPct)} .. ${f(p.ciHighPct)}), pass ${p.passArm}/${p.pairs} vs ${p.passBaseline}/${p.pairs} (${verdict(p)})\n`,
    );
  }

  if (opt("--out", null)) {
    writeFileSync(opt("--out", ""), JSON.stringify(outPayload, null, 2) + "\n", "utf8");
    process.stdout.write(`\nSaved comparison report to ${opt("--out", "")}\n`);
  }
}
