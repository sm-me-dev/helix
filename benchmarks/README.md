# Helix Benchmark Suite

This directory contains the reproducible benchmark suite, task definitions, schemas, runners, and chart generators designed to measure whether Helix actually improves software development workflows compared with using an unharnessed AI coding agent.

## Core Philosophy

- **Zero Fabricated Claims:** Every number comes directly from committed JSON results in this repository.
- **Fair Experimental Controls:** Baseline and Helix arms execute the identical model, prompt, commit snapshot, tool set, and acceptance criteria in isolated environments.
- **Honest Trade-Off Reporting:** We document where Helix helps (-12.7% uncached tokens with `helix-min`), where it has no detectable difference (`helix-nosub`), and where it costs tokens (+28.7% with `helix-graph` on medium fixtures).

---

## Benchmark Directory Structure

```text
benchmarks/
├── README.md               Benchmark overview and execution guide (this file)
├── tasks/                  YAML task definitions across 7 development categories
│   ├── task-a-repo-understanding.yml
│   ├── task-b-bug-fixing.yml
│   ├── task-c-feature-implementation.yml
│   ├── task-d-refactoring.yml
│   ├── task-e-complex-workflow.yml
│   ├── task-f-knowledge-retention.yml
│   └── task-g-multi-agent.yml
├── schemas/
│   └── execution-record.schema.json    JSON schema for standard run records
├── runners/
│   └── run.mjs             Unified benchmark execution runner
├── evaluators/
│   └── compare.mjs         Statistical pairing, bootstrap CI, and sign tests
├── scripts/
│   └── generate-charts.mjs Reproducible Mermaid chart and dashboard generator
├── charts/
│   └── benchmark-dashboard.md  Rendered visual evidence dashboard
└── results/                Committed benchmark execution records
```

---

## The 7 Benchmark Task Categories

| Category                         | Task ID                         | Target Activity                                               | Acceptance Verification                         |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| **A. Repository Understanding**  | `task-a-repo-understanding`     | Trace rate limiter execution path without loading whole files | Clean diff, correct topology cited              |
| **B. Bug Fixing**                | `task-b-bug-fixing`             | Fix off-by-one anonymous ceiling bug in rate limiter          | Context, rate-limit, and billing tests pass     |
| **C. Feature Implementation**    | `task-c-feature-implementation` | Implement tiered daily quota policy with header injection     | Quota and billing test suite passes             |
| **D. Refactoring & Maintenance** | `task-d-refactoring`            | Consolidate procedural limiter functions into LimiterService  | Legacy exports preserved, zero regressions      |
| **E. Complex Workflows**         | `task-e-complex-workflow`       | Multi-module cryptographic token contract migration           | Dependency-order build and crypto tests pass    |
| **F. Knowledge Retention**       | `task-f-knowledge-retention`    | Persistent APKS domain boundary and naming enforcement        | Sub-15ms retrieval, zero discovery token waste  |
| **G. Multi-Agent Workflows**     | `task-g-multi-agent`            | Disjoint concurrent subtasks vs reviewer verification         | Clean diff, merge conflict rate 0%, tests green |

---

## Running Benchmarks

### 1. List Available Benchmark Tasks

```sh
node benchmarks/runners/run.mjs --list
# or via CLI:
helix bench --list
```

### 2. Run a Quick Smoke Test

```sh
node benchmarks/runners/run.mjs --smoke
```

### 3. Run In-Engine Strategy Benchmark

```sh
# Run baseline vs reviewer across bugfix category:
helix bench --strategy baseline,reviewer --category bugfix --runs 3

# Export standardized JSON records (Section 4 schema):
helix bench --strategy baseline,reviewer --runs 1 --standard-json --out benchmarks/results/latest.json
```

### 4. Run Head-to-Head Agent Tasks (Real Models)

```sh
# Plan dry-run without spending tokens:
node evals/run.mjs --agent opencode --arms none,helix-min --runs 3 --dry-run

# Run full paired evaluation:
node evals/run.mjs --agent opencode --arms none,helix-min,helix-nosub,helix-graph --runs 6 --fixture large
```

### 5. Compute Paired Statistics

```sh
node scripts/paired-stats.mjs evals/results/2026-10-13T06-42-42-opencode.json --out evals/results/paired-stats.json
```

### 6. Generate Visual Charts and Dashboard

```sh
node benchmarks/scripts/generate-charts.mjs
node scripts/render-evidence.mjs
```

---

## Statistical Methodology

Comparisons use **paired bootstrap estimation** (10,000 resamples, fixed seed) on log ratios of uncached tokens and **exact two-sided sign tests** on discordant pass/fail pairs. A verdict of "no detectable difference" is strictly assigned whenever the 95% confidence interval spans zero.
