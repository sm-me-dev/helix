# Changelog

All notable changes to **Helix** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.1] - 2026-11-02

### Added

- **Cross-Platform Distribution & Zero-Clone Installation Architecture (Phase 10.1)**:
  - **Scoped Public npm Package (`@sm-me-dev/helix`)**: Built via automated transpilation (`scripts/build.mjs`) into standard ES modules in `dist/` avoiding type-stripping errors inside `node_modules`.
  - **Self-Contained Standalone Application Bundles (`scripts/build-bundles.mjs`)**: Portable bundles with embedded Node.js 22 LTS runtime across 5 targets (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64`) requiring zero host Node installation.
  - **Universal Unix Installer (`scripts/install.sh`)**: Architecture-detecting, checksum-verifying curl installer for Linux and macOS.
  - **PowerShell Installer (`scripts/install.ps1`)**: Windows installer with SHA-256 verification and user PATH configuration.
  - **Package Manager Integrations**:
    - Homebrew Formula: `Formula/helix.rb` supporting macOS Apple Silicon/Intel and Linux.
    - Debian / Ubuntu (`.deb`): `scripts/build-deb.sh` producing compliant packages for `amd64` and `arm64`.
    - Fedora / RHEL (`.rpm`): `scripts/build-rpm.sh` producing compliant packages for `x86_64`.
    - Windows: WinGet singleton manifest (`manifests/winget/sm-me-dev.Helix.yaml`) and Scoop bucket manifest (`manifests/scoop/helix.json`).
  - **Lifecycle Management Commands**:
    - `helix update`: Automatic detection of installation channel (npm, brew, apt, rpm, standalone, git-link) with channel-specific upgrade commands.
    - `helix uninstall`: Safe uninstallation preserving user project data, Git worktrees, and repository configs.
  - **Release Pipeline Overhaul (`.github/workflows/release.yml`)**: Automated multi-platform bundle builds, deb/rpm generation, SHA-256 digest signing, artifact verification, and GitHub Release deployment.
  - **Dedicated Distribution Documentation**: Added `docs/UPDATING.md`, `docs/UNINSTALLING.md`, and `docs/PLATFORM_SUPPORT.md`.

### Removed

- Removed legacy agent prompts (`docs/ANTIGRAVITY-AUDIT-PROMPT.md`, `docs/NEXT-PROMPT.md`).
- Removed IDE tool configuration directory (`.serena/`).

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
