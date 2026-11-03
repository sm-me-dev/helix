#!/usr/bin/env node
// Unified Helix Benchmark Runner
// Orchestrates baseline vs Helix comparative evaluations with isolated workspaces,
// deterministic grading, token/cost accounting, and standardized output schemas.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../../evals/yaml.mjs";
import { RepeatableBenchmarkSuite, toStandardExecutionRecord } from "../../src/engine/benchmark.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TASKS_DIR = join(ROOT, "benchmarks", "tasks");

export function loadBenchmarkTasks() {
  const tasks = [];
  if (!existsSync(TASKS_DIR)) return tasks;
  for (const f of readdirSync(TASKS_DIR)) {
    if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
    const content = readFileSync(join(TASKS_DIR, f), "utf8");
    const parsed = parseYaml(content);
    if (parsed && parsed.id) {
      tasks.push(parsed);
    }
  }
  return tasks;
}

export async function runBenchmark(opts = {}) {
  const mode = opts.mode || "helix";
  const runs = Number(opts.runs) || 1;
  const taskFilter = opts.task;
  const categoryFilter = opts.category;
  const model = opts.model || "opencode/mock-agent-v1";

  const suite = new RepeatableBenchmarkSuite();
  const strategy = mode === "baseline" ? "single-agent" : "implementer-plus-reviewer";

  const report = await suite.runSuite({
    strategies: [strategy],
    taskIds: taskFilter ? [taskFilter] : undefined,
    categories: categoryFilter ? [categoryFilter] : undefined,
    runsPerTask: runs,
    model,
  });

  const commitSha = opts.commitSha || "96453c8";
  const records = report.results.map((r) => {
    const rec = toStandardExecutionRecord(r, commitSha);
    rec.mode = mode === "baseline" ? "baseline" : "helix";
    return rec;
  });

  return { report, records };
}

function printUsage() {
  process.stdout.write(`Usage: node benchmarks/runners/run.mjs [options]

Options:
  --list               List available benchmark tasks and categories
  --mode <arm>         Execution mode: 'baseline' (unharnessed) or 'helix' (default: helix)
  --task <id>          Run a specific benchmark task by ID
  --category <cat>     Filter tasks by category
  --runs <n>           Number of runs per task (default: 1)
  --model <name>       Model identifier (default: opencode/mock-agent-v1)
  --out <path>         Save execution records to JSON file
  --standard           Output Section 4 standard execution records
  --smoke              Execute a fast verification smoke test
  --help, -h           Show this help text
`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  if (args.includes("--list")) {
    const tasks = loadBenchmarkTasks();
    process.stdout.write(`# Helix Benchmark Suite (${tasks.length} Tasks across 7 Categories)\n\n`);
    for (const t of tasks) {
      process.stdout.write(
        `- **${t.id}** [${t.category}] (${t.difficulty || "medium"} difficulty)\n`,
      );
      process.stdout.write(
        `  ${t.title} — ${String(t.description || "")
          .trim()
          .slice(0, 100)}...\n`,
      );
      process.stdout.write(`  Verification: \`${t.verificationCommand || "npm test"}\`\n\n`);
    }
    return;
  }

  if (args.includes("--smoke")) {
    process.stdout.write("Running benchmark runner smoke test...\n");
    const { records } = await runBenchmark({
      mode: "helix",
      runs: 1,
      category: "bug-fixing",
      model: "mock-runner-smoke",
    });
    if (records.length > 0 && records[0].success) {
      process.stdout.write(
        `✔ Benchmark smoke test passed: ${records.length} run executed successfully.\n`,
      );
      process.exit(0);
    } else {
      process.stderr.write("✖ Benchmark smoke test failed.\n");
      process.exit(1);
    }
  }

  const mode = opt("--mode", "helix");
  const runs = Number(opt("--runs", 1));
  const task = opt("--task", null);
  const category = opt("--category", null);
  const model = opt("--model", "opencode/mock-agent-v1");
  const outPath = opt("--out", null);
  const standard = args.includes("--standard");

  const { report, records } = await runBenchmark({
    mode,
    runs,
    task,
    category,
    model,
  });

  if (outPath) {
    const payload = standard ? records : report;
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    process.stdout.write(`Saved ${records.length} execution records to ${outPath}\n`);
  }

  if (standard) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
  } else {
    process.stdout.write(new RepeatableBenchmarkSuite().formatMarkdownReport(report) + "\n");
  }
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  await main();
}
