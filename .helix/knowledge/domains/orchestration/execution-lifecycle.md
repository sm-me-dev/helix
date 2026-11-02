---
id: orchestration.execution-lifecycle
type: architecture
domain: orchestration
title: Agent Execution Lifecycle and Handoff Contracts
status: verified
sources:
  - path: src/engine/orchestrator.ts
    lines: 1-120
  - path: src/engine/runner.ts
dependencies:
  - execution-engine
  - context-optimization
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - orchestration
  - lifecycle
  - handoff
  - multi-agent
---

# Agent Execution Lifecycle and Handoff Contracts

Helix orchestrates multi-agent tasks through a deterministic state machine with strict context boundaries.

## Key Invariants

- Single-agent baseline: Default to a single capable agent unless cross-module complexity, security sensitivity, or independent review is verified.
- Handoff contracts: Multi-agent transitions strictly enforce `HANDOFF_MAX_LINES = 12`. Every handoff card must cite affected files and objective lines without token bloat.
- Ephemeral state: Agent execution state is isolated and tracked by `FileExecutionStateManager`.
- Failure recovery: When mechanical verification fails, the orchestrator routes failure diagnostics back to the implementer or retry loop with bounded attempts.
