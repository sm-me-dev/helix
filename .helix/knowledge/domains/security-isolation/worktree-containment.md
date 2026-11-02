---
id: security-isolation.worktree-containment
type: constraint
domain: security-isolation
title: Ephemeral Worktree Isolation and Secret Exclusion
status: verified
sources:
  - path: src/engine/security.ts
  - path: src/engine/worktree.ts
  - path: cli/safe-write.ts
dependencies: []
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - security
  - worktree
  - isolation
  - containment
---

# Ephemeral Worktree Isolation and Secret Exclusion

Helix guarantees workspace safety and non-destructive execution.

## Key Invariants

- Ephemeral Git worktrees: Agent file modifications take place in isolated worktrees (`.helix/worktrees/`) rather than the active working tree.
- Clean rollback: Failed verification or aborted runs discard the ephemeral worktree cleanly without corrupting user state.
- Path containment: All read/write operations must stay within workspace bounds. Symlinks pointing outside workspace are strictly refused (`preflightPack containment checks`, `refuse symlinks pointing outside`).
- Untrusted content scanning: Excerpts and tool outputs are scanned for prompt injection signatures and neutralized before prompt assembly.
- Forbidden paths protection: Protected paths like `.git/`, `node_modules/`, credentials, and secrets are strictly excluded from tool operations.
