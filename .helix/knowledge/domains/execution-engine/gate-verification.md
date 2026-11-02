---
id: execution-engine.gate-verification
type: constraint
domain: execution-engine
title: Mechanical Gate Verification Rules
status: verified
sources:
  - path: src/gate.ts
  - path: src/engine/engine.ts
dependencies:
  - security-isolation
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - gate
  - verification
  - zero-token
  - constraints
---

# Mechanical Gate Verification Rules

Verification in Helix is strictly mechanical and deterministic.

## Key Invariants

- Zero model tokens spent on self-evaluation: Agents do not judge their own code quality with LLM calls.
- Mechanical gate: `.helix/gate.mjs` executes secret leak scanning, linter, typecheck, and affected tests.
- Non-negotiable pass requirement: A task is only marked completed if the verification command exits with status 0.
- Secret exclusions: Gate immediately fails if any secret pattern, credentials, private key, or token is committed.
