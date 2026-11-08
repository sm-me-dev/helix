# Changelog

All notable changes to **Helix** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-07

### Helix v2 — Progressive Execution Harness

- **Progressive Disclosure Master Loop**: bounded bootstrap instructions and a compact Tier 0 domain route catalog; `load_skill` and `tool_search` reveal domain context and tool schemas only when needed. `VisibilityGate` keeps undiscovered tools unavailable, while `WriteGate` confines team writes to approved paths. Context compaction archives older tool output to per-session `NOTES.md` files.
- **Quarantine-Gated Three-Tier Knowledge System**: deterministic Tier 0 routes, read-only Tier 1 canonical skills and references, and mutable Tier 2 episodic memory in `.helix/knowledge/helix-memory.db`. SQLite WAL/FTS5 and `sqlite-vec` retrieval are fused with reciprocal rank fusion; AST rules are structurally checked and promoted only through offline `helix knowledge compact`.
- **Four Execution Topologies**: a single-threaded master loop, bounded read-only scout, deterministic validation followed by an optional context-firewalled cross-model auditor, and a file-locked peer team DAG with approved ownership, sanitized peer inboxes, and hypothesis investigation.
- **Five-Layer AI Provider Configuration**: runtime overrides, CLI flags, environment variables, trusted workspace TOML, global provider profiles, then defaults. URL sanitization and keyless localhost support make compatible local servers straightforward to configure.
- **Synchronized Local Clients**: `helix serve` exposes the daemon and SSE event stream; `helix tui` and `helix web` attach to the same sessions, events, prompts, and approvals.
- **Workflow and Release Surface**: the v2 workflow models `INIT`, `DISCOVER`, `EXECUTE`, `VERIFY`, and `COMPLETE`, with explicit blocked retries and supported short paths. The release updates CLI and distribution manifests for the v2 package.
- **Measurement and Evidence**: static token-cost reports and paired evaluation evidence are generated from committed data with their methods and measurement dates.

## [0.1.0] - 2026-11-03

### Initial Public Release

- **Cross-Platform Zero-Clone Distribution Architecture**:
  - **Scoped Public npm Package (`@sm-me-dev/helix`)**: Built via automated transpilation (`scripts/build.mjs`) into standard ES modules in `dist/` without type-stripping errors.
  - **Self-Contained Standalone Application Bundles (`scripts/build-bundles.mjs`)**: Portable bundles with embedded Node.js 22 LTS runtime across 5 targets (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64`) requiring zero host Node installation.
  - **Universal Installers (`scripts/install.sh`, `scripts/install.ps1`)**: Automated architecture detection, SHA-256 verification, and user-local installation served directly from GitHub Pages (`https://sm-me-dev.github.io/helix/`).
  - **Package Manager Integrations**: Homebrew Formula (`Formula/helix.rb`), Debian/Ubuntu APT repository (`scripts/build-deb.sh`, `scripts/apt/`), Fedora/RHEL RPM packages (`scripts/build-rpm.sh`), WinGet (`manifests/winget/`), and Scoop (`manifests/scoop/`).
  - **Lifecycle Management**: Built-in `helix update` (auto-detects channel: npm, brew, apt, rpm, standalone, git-link) and `helix uninstall`.

- **Adaptive Project Knowledge System (APKS)**:
  - **SQLite FTS5 Full-Text Indexing & Repository (`src/knowledge/`)**: Full-text and metadata indexing for codebases with BM25-backed ranking, incremental change tracking, and zero external binary dependencies.
  - **Automated Project Discovery (`src/knowledge/discovery.ts`)**: Auto-generates structured canonical documentation in `.helix/knowledge/` (domains, architecture decisions, workflows, project profile).
  - **Context Optimization & Retrieval (`src/knowledge/retriever.ts`, `src/knowledge/context-adapter.ts`)**: Adaptive knowledge injection adhering to strict token ceilings (≤600 tokens by default) with relevant snippets, decisions, and domain rules.
  - **Knowledge Validation & Health Auditing (`src/knowledge/maintenance.ts`)**: Health scoring (0–100), broken internal link detection, stale entry detection, and auto-repair.
  - **CLI Command Suite (`helix knowledge`)**: Subcommands for `init`, `index`, `search`, `status`, `validate`, and `export`.
  - **Continuous Retrieval Benchmark (`src/knowledge/benchmark.ts`)**: Synthetic and query-based retrieval accuracy benchmarking.

- **Core Execution Engine & Sandboxing**:
  - `HelixExecutionEngine`: Single-agent execution loop with worktree isolation, mechanical gate validation, and bounded retry loop (ceiling 2).
  - `TaskDefinition` & `DefaultTaskPlanner`: Zero-token heuristic classification (`trivial`, `standard`, `complex`, `securitySensitive`).
  - `GitWorktreeManager`: Ephemeral Git worktree provisioning (`.helix-work/worktrees/<taskId>`) and clean unified diff extraction.
  - `DefaultValidationEngine`: Zero-token mechanical verification gate (`.helix/gate.mjs`) executing secret scans, linting, typechecks, and tests with diagnostic noise stripping (≤400 tokens).
  - `FileExecutionStateManager`: Discrete workflow state machine with immutable event journaling.
  - `SecurityGuard`: Role-based least-privilege enforcement (`ROLE_DEFAULT_PERMISSIONS`), guarded bash for Reviewers, secret scanning and redaction, untrusted content framing, and path-jail isolation.

- **Context Management & Token Optimization**:
  - `DefaultContextManager`: Progressive layered context assembly (system prompt ≤300t, handoff ≤350t, interfaces ≤500t, cited excerpts ≤1400t; total prompt ≤2950t).
  - `DefaultRepositoryRetriever`: Multi-tier retrieval supporting semantic Graphify knowledge graph, structural outline fallback, and line-clamped excerpts.
  - `ContextCompactor`: Automatic multi-turn conversation compaction preserving critical technical vectors.
  - `TokenBudgetManager`: Role-specific and total task token ceilings with pre/post-invocation enforcement.
  - `DefaultToolExecutor`: In-memory file read caching, whole-file read clamping (>200 lines), and head+tail output truncation.

- **Multi-Agent Orchestration (Optional)**:
  - `DefaultAgentOrchestrator`: Topological DAG scheduler with concurrent execution of independent subtasks.
  - 12-Line Handoff Contract (`HANDOFF_MAX_LINES = 12`) eliminating context bloat across role boundaries.
  - Independent Adversarial Code Review pass operating on clean diffs and task criteria.

- **Evaluation Framework & Benchmarks**:
  - `RepeatableBenchmarkSuite`: Automated benchmark harness across 10 task categories and 5 execution strategies (`helix bench`).
  - Strict separation of agent claims vs verified mechanical validation and pre-existing regression tracking.

- **Developer CLI & Documentation Hub**:
  - `helix run [task]`, `helix gate`, `helix bench`, `helix knowledge`, `helix update`, `helix uninstall`.
  - Master documentation hub (`docs/index.md`), `docs/INSTALL.md`, `docs/UPDATING.md`, `docs/UNINSTALLING.md`, `docs/PLATFORM_SUPPORT.md`, `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, `docs/CLI.md`, `docs/TROUBLESHOOTING.md`.
