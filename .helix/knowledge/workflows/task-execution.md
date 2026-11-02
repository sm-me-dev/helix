---
id: workflows.task-execution
type: workflow
domain: execution-engine
title: Repeatable Task Execution Workflow
status: verified
sources:
  - path: src/engine/engine.ts
  - path: cli/run.ts
dependencies:
  - security-isolation
  - context-optimization
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - workflow
  - execution
  - runner
---

# Repeatable Task Execution Workflow

## Procedure

1. Preflight: Verify workspace cleanliness, detect target files, check security exclusions.
2. Context Assembly: Dynamically retrieve project knowledge and relevant source interfaces within configured token budget.
3. Execution: Run task in an isolated ephemeral worktree using single-agent baseline or multi-agent delegation.
4. Mechanical Verification Gate: Execute `node .helix/gate.mjs`. If checks fail, feed diagnostics into retry loop.
5. Merge & Cleanup: On gate pass, merge changes into target branch and clean up worktree.
