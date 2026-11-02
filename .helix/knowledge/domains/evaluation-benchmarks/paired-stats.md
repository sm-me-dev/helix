---
id: evaluation-benchmarks.paired-stats
type: reference
domain: evaluation-benchmarks
title: Empirical Evaluation & Paired Stats Methodology
status: verified
sources:
  - path: src/engine/benchmark.ts
  - path: src/engine/experiment.ts
dependencies:
  - execution-engine
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - evaluation
  - benchmarks
  - stats
---

# Empirical Evaluation & Paired Stats Methodology

Helix evaluates coding agent performance using reproducible benchmarks across 10 problem categories and 5 execution strategies.

## Key Invariants

- Token accounting: Empirical counting via `gpt-tokenizer` (`o200k_base`), eliminating arbitrary constants.
- Token math: no hardcoded token constants; countTokens via gpt-tokenizer.
- Paired differences: Compares strategies across identical tasks, isolating token savings and duration speedup.
- Repeatability: Benchmark fixtures are isolated and reproducible across test runs.
