# Task: Generate Comprehensive Test Suite for Token Budget Subsystem

## Objective

Generate edge-case unit tests for `src/engine/context.ts` specifically targeting `TokenBudgetManager`.

## Scope

1. Verify token counting across `planning`, `implementation`, `review`, and `testing` roles.
2. Verify that exceeding role budgets throws `TokenBudgetExceededError`.
3. Verify that context compaction summaries properly track saved tokens.
4. Target file: `src/engine/context.test.ts`.
