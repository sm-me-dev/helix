---
id: cli-tooling.commands
type: architecture
domain: cli-tooling
title: CLI Command Architecture and Safe Execution
status: verified
sources:
  - path: cli/helix.mjs
  - path: cli/safe-write.ts
dependencies:
  - security-isolation
  - execution-engine
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - cli
  - commands
  - tooling
---

# CLI Command Architecture and Safe Execution

Helix provides a unified command line interface (`helix`) built directly on Node 22+ type stripping without runtime compilation.

## Key Invariants

- Exit codes: 0 on success, 1 on check failure or gate failure, 2 on usage / bad arguments.
- Containment checks: `preflightPack containment checks` ensure all file writes are strictly confined to the target project directory. Symlinks pointing outside are refused.
- Idempotency: `helix init` is idempotent. Repeating `init` never overwrites user modifications without `--force`.
