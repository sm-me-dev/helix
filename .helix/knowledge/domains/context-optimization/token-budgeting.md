---
id: context-optimization.token-budgeting
type: architecture
domain: context-optimization
title: Progressive Context Disclosure & Token Ceilings
status: verified
sources:
  - path: src/engine/context.ts
  - path: src/tokens.ts
dependencies:
  - execution-engine
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - context
  - tokens
  - budget
  - compaction
---

# Progressive Context Disclosure & Token Ceilings

Helix prevents context poisoning and token runaway through layered token ceilings.

## Key Invariants

- System instructions cap: `systemInstructionsMaxTokens <= 300`.
- Task prompt budget: `taskPromptMaxTokens <= 600`.
- Total prompt ceiling: `totalPromptMaxTokens <= 2950`.
- Role ceilings (`RoleTokenBudgets`): Planner (15k), Implementer (40k), Reviewer (10k), Tester (15k), Total (80k).
- Exact BPE token counting: All token calculations must use `gpt-tokenizer` (`o200k_base`) via `src/measure.ts`. No hardcoded constants.
- Context compaction: Summarizes completed steps while preserving objective, modified files, decisions, and remaining work.
