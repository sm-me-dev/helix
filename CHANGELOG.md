# Changelog

All notable changes to **Helix** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-11-02

### Added

- **Core Execution Engine Subsystem (`src/engine/`)**:
  - `HelixExecutionEngine`: Single-agent execution loop with worktree isolation, mechanical gate validation, and bounded retry loop (ceiling 2).
  - `TaskDefinition` & `DefaultTaskPlanner`: Zero-token heuristic classification (`trivial`, `standard`, `complex`, `securitySensitive`).
  - `GitWorktreeManager`: Ephemeral Git worktree provisioning (`.helix-work/worktrees/<taskId>`) and clean unified diff extraction.
  - `DefaultValidationEngine`: Zero-token mechanical verification gate (`.helix/gate.mjs`) executing secret scans, linting, typechecks, and tests with diagnostic noise stripping (≤400 tokens).
  - `FileExecutionStateManager`: Discrete workflow state machine with immutable event journaling.
- **Context Management & Token Optimization**:
  - `DefaultContextManager`: Progressive layered context assembly (system prompt ≤300t, handoff ≤350t, interfaces ≤500t, cited excerpts ≤1400t; total prompt ≤2950t).
  - `DefaultRepositoryRetriever`: Multi-tier retrieval supporting semantic Graphify knowledge graph, structural outline fallback, and line-clamped excerpts.
  - `ContextCompactor`: Automatic multi-turn conversation compaction preserving critical technical vectors.
  - `TokenBudgetManager`: Role-specific and total task token ceilings with pre/post-invocation enforcement.
  - `DefaultToolExecutor`: In-memory file read caching, whole-file read clamping (>200 lines), and head+tail output truncation.
- **Security Boundaries & Sandboxing**:
  - `SecurityGuard`: Role-based least-privilege enforcement (`ROLE_DEFAULT_PERMISSIONS`), guarded bash for Reviewers, and read-only planners/scouts.
  - `SecretScanner`: High-fidelity detection and redaction of AWS, GitHub, Slack, OpenAI, Anthropic, Gemini credentials, and private keys.
  - `UntrustedContentHandler`: `<untrusted_content>` framing, delimiter escaping, and prompt injection neutralization.
  - `WorkspaceLockManager`: Process-safe concurrency locks preventing overlapping agent sessions in identical workspaces.
- **Multi-Agent Orchestration (Optional)**:
  - `DefaultAgentOrchestrator`: Topological DAG scheduler with concurrent execution of independent subtasks.
  - 12-Line Handoff Contract (`HANDOFF_MAX_LINES = 12`) eliminating context bloat across role boundaries.
  - Independent Adversarial Code Review pass operating on clean diffs and task criteria.
- **Evaluation Framework & Benchmarks**:
  - `RepeatableBenchmarkSuite`: Automated benchmark harness across 10 task categories and 5 execution strategies (`helix bench`).
  - Strict separation of agent claims vs verified mechanical validation and pre-existing regression tracking.
- **Unified Developer CLI**:
  - `helix run [task]`: Primary developer execution workflow supporting prompt strings, markdown task specs, structured JSON tasks, and stdin piping.
  - `helix bench`: Benchmark suite command with strategy filtering, category filtering, and structured JSON output.
  - `helix --version`: Native version inquiry (`helix 0.9.0`).
- **Documentation & Distribution**:
  - Restructured `README.md` with concise front-door architecture and verified platform matrix.
  - New documentation hub (`docs/index.md`), `docs/CONFIGURATION.md`, `docs/TROUBLESHOOTING.md`, and `docs/DISTRIBUTION.md`.
  - Automated GitHub Actions release pipelines (`release.yml`, `publish-npm.yml`, `ci.yml`).

### Changed

- Fixed benchmark markdown findings interpolation when filtering execution strategies.
- Upgraded `docs/ARCHITECTURE.md` to document the dual-modality architecture and all 13 engine components.
- Resolved upstream dependency peer conflict with `typescript-eslint` by aligning TypeScript devDependency with installed `~5.9.3` runtime.
