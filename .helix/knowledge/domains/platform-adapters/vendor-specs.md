---
id: platform-adapters.vendor-specs
type: reference
domain: platform-adapters
title: Vendor Verification & Platform Frontmatter Protocols
status: verified
sources:
  - path: src/adapters/claude.ts
  - path: src/platforms.ts
dependencies:
  - pack-generation
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - platforms
  - claude
  - codex
  - vendor
  - adapters
---

# Vendor Verification & Platform Frontmatter Protocols

Helix compiles universal harness specifications into platform-native configuration packs.

## Key Invariants

- Verification rule: Every platform fact (hook protocol, frontmatter schema, MCP config format) must be verified against vendor documentation.
- Claude Code subagent rules: `plugin agents ignore frontmatter hooks` (verified vendor behavior). Plugin agents receive maxTurns caps but no Bash-for-reviewer hooks.
- OpenCode adapter: Merges MCP server configurations into `opencode.json` non-destructively.
- Deterministic output: `generatePack` is pure and deterministic. Emitted files depend solely on `HarnessConfig` and stack detection.
