---
id: pack-generation.harness-pack
type: architecture
domain: pack-generation
title: Harness Pack Compilation and Multi-Platform Emission
status: verified
sources:
  - path: src/generate.ts
  - path: src/crew.ts
dependencies: []
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - pack
  - compiler
  - generate
---

# Harness Pack Compilation and Multi-Platform Emission

Helix compiles a universal configuration into target platform files (`AGENTS.md`, hooks, gate script, MCP settings).

## Key Invariants

- Deterministic generation: Same `HarnessConfig` and stack produces byte-for-byte identical pack output.
- Subagent crew roles: Scout, Architect, Builder, Reviewer. Roles are isolated and specialized.
- Minimal overhead: System prompts are constrained to <= 300 tokens to preserve the model context window.
