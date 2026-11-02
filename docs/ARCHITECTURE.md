# Helix Architecture

Helix is an AI coding harness engineered to maximize coding-agent results while strictly controlling token consumption, execution latency, and coordination overhead.

Helix operates on a **dual-modality architecture**:

1. **File Pack Generation Subsystem**: Emits deterministic, minimal instruction packs (`AGENTS.md`, `.helix/`, platform configs) tailored per agent platform.
2. **Autonomous Execution Engine Subsystem**: Executes coding tasks with single-agent simplicity by default, ephemeral Git worktrees, progressive context management, least-privilege security guards, and zero-token mechanical gates.

```text
                                  ┌─────────────────────────────┐
                                  │      Developer / CLI        │
                                  │   helix init · run · bench  │
                                  └──────────────┬──────────────┘
                                                 │
                   ┌─────────────────────────────┴─────────────────────────────┐
                   ▼                                                           ▼
    ┌─────────────────────────────┐                             ┌─────────────────────────────┐
    │     Pack Generator Subsystem│                             │  Execution Engine Subsystem │
    │   (src/generate.ts, src/)   │                             │        (src/engine/)        │
    ├─────────────────────────────┤                             ├─────────────────────────────┤
    │ Pure data catalogs:         │                             │ 1. Task Definition & Planner│
    │  - Crew roles (crew.ts)     │                             │ 2. Context & Token Manager  │
    │  - MCP schemas (mcps.ts)    │                             │ 3. Git Worktree Manager     │
    │  - Platform adapters (src/) │                             │ 4. Tool Execution & Security│
    │  - Practices & skills       │                             │ 5. Agent Orchestrator (DAG) │
    │ Emits:                      │                             │ 6. Validation Engine (Gate) │
    │  - Minimal AGENTS.md (≤300t)│                             │ 7. State Manager (Event Log)│
    │  - Zero-token .helix/gate   │                             │ 8. Model Provider & Pricing │
    │  - Tool/hook definitions    │                             │ 9. Benchmark & Evals Suite  │
    └─────────────────────────────┘                             └─────────────────────────────┘
                   │                                                           │
                   ▼                                                           ▼
       Target Project File Pack                                     Verified Code Deliverables
    (.helix/, AGENTS.md, configs)                                (Ephemeral Worktree -> Main Branch)
```

---

## 1. Core Engineering Principles

1. **Single-Agent by Default**: Helix does not assume more agents produce better code. Standard tasks execute in a single session. Orchestration and independent review engage only when complexity, security sensitivity, or task parallelism justify the cost.
2. **Mechanical Verification Over Agent Claims**: An agent claiming "all tests pass" is never accepted as evidence of success. Success is determined strictly by programmatic execution of `.helix/gate.mjs` (secrets, lint, typecheck, tests).
3. **Strict Token Ceilings & Zero Arbitrary Constants**: Context is bounded hierarchically: System prompt (≤300t), handoff card (≤350t), interface signatures (≤500t), cited line excerpts (≤1400t). All token calculations use real byte-pair encoding (`gpt-tokenizer` `o200k_base`).
4. **Workspace Concurrency & Isolation**: Agents execute in isolated ephemeral Git worktrees (`.helix-work/worktrees/<taskId>`) with PID-based workspace locking to eliminate workspace corruption.
5. **Least-Privilege Tool Boundaries**: Roles are assigned strict, non-escalatable permissions. Reviewers cannot execute arbitrary shell commands; scouts and planners are strictly read-only.

---

## 2. Subsystem Boundaries

### 2.1 Pack Generator (`src/` & `src/adapters/`)

- **Responsibility**: Generates deterministic platform configuration packs for Claude Code, OpenCode, Codex, Cursor, Gemini, Copilot, and other agent platforms.
- **Pure Function**: `generatePack(config)` takes configuration and returns an in-memory file map without performing disk I/O.
- **Platform Adapters**: Each adapter in `src/adapters/` handles vendor-specific hook protocols, configuration formats, and subagent schemas. Facts carry verified documentation URLs and dates.

### 2.2 Core Execution Engine (`src/engine/`)

The engine implements 13 modular, decoupled components:

- **Task Interface & Planner** (`task.ts`): Normalizes task prompts, validates constraints, and statically classifies workflow tier (`trivial`, `standard`, `complex`, `securitySensitive`).
- **Context Manager & Token Budgets** (`context.ts`): Assembles progressive context layers, enforces per-role token ceilings, and compacts conversational history into structured technical vector cards.
- **Repository Retriever** (`retrieval.ts`): Multi-tier retrieval combining semantic knowledge graphs (`graphify`), structural outlines, and narrow line excerpting (clamped to ≤60 lines).
- **Tool Sandbox & Security Guard** (`tools.ts`, `security.ts`): Role-based permission checks, path traversal jail, secret redaction, and prompt injection neutralization.
- **Ephemeral Git Worktree Manager** (`worktree.ts`): Provisions isolated scratch branches and worktrees; cleanly extracts unified diffs and untracked files.
- **Validation Engine** (`validator.ts`): Executes mechanical gates, extracts failing diagnostics (stripping passing noise), and feeds bounded feedback (≤400 tokens) to the retry loop.
- **Multi-Agent Orchestrator** (`orchestrator.ts`): Optional topological DAG scheduler, 12-line handoff cards (`HANDOFF_MAX_LINES = 12`), independent adversarial code review, and conflict detection.
- **Execution State Manager** (`state.ts`): Maintains event journal and atomic state snapshots (`.helix-work/state.json`).
- **Model Provider & Cost Accounting** (`provider.ts`): Real-time token counting and verified pricing tables for Anthropic, OpenAI, and Google Gemini models.
- **Configuration Resolver** (`config.ts`): Resolves hierarchical engine settings across CLI flags, `.helix/config.json`, environment variables, and defaults.
- **Benchmark & Evaluation Framework** (`benchmark.ts`, `experiment.ts`): Standardized 10-category evaluation suite comparing single-agent vs multi-agent execution strategies.

### 2.3 CLI Interface (`cli/`)

- `helix run [task]` (`cli/run.ts`): Primary developer command for executing coding tasks with worktree isolation and gate validation.
- `helix bench` (`cli/helix.mjs` & `src/engine/benchmark.ts`): Repeatable benchmark suite comparing pass rates, regressions, and token costs.
- `helix init` / `doctor` / `measure` / `gate` / `export` (`cli/lib.ts`): Pack generation, diagnostic health checks, static token auditing, and gate execution.
- `helix link` (`cli/link.ts`): Path shim installer for developer environments.
- `helix ui` (`cli/ui.ts`): Local web dashboard visualizing task state and benchmark results.

---

## 3. Failure Recovery & Process Lifecycle

Helix implements structured failure handling across all execution phases:

- **Subprocess Timeouts**: Subprocesses are spawned in dedicated POSIX process groups (`detached: true`). When `timeoutSec` expires, `SIGKILL` is sent to the process group, terminating hanging processes.
- **Signal Trapping**: Interruption signals (`SIGINT`, `SIGTERM`) trigger graceful cancellation: active agent processes are halted, ephemeral worktrees are deleted, workspace locks are released, and state is preserved.
- **Bounded Retry Loop**: Hard ceiling of 2 retries (ADR-006). Only failing test lines, compiler errors, or lint failures are fed back to the agent context.
- **Worktree Teardown Guarantees**: Cleanup routines are wrapped in `finally` blocks, ensuring worktrees and locks are purged even after uncaught exceptions.

---

## 4. Extension Points

- **Adding an Agent Platform**: Add an adapter in `src/adapters/` with verified vendor documentation citations, golden-file test fixtures, and registration in `src/platforms.ts`.
- **Adding an LLM Provider**: Register provider pricing and model identifiers in `src/engine/provider.ts`.
- **Adding a Benchmark Category**: Register task definitions and validation criteria in `src/engine/benchmark.ts`.
- **Custom Verification Gates**: Extend `.helix/gate.mjs` with stack-specific test commands or security checks.
