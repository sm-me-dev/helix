# Helix Documentation

Welcome to the documentation for **Helix**, an AI coding harness engineered to maximize coding-agent results while strictly controlling token consumption, execution latency, and coordination overhead.

Helix operates on a **dual-modality architecture**:

1. **File Pack Generation**: Generates deterministic, minimal configuration packs (`AGENTS.md`, `.helix/`, vendor configs) for any major AI coding agent.
2. **Autonomous Execution Harness**: Executes coding tasks with single-agent simplicity by default, ephemeral Git worktrees, progressive context management, least-privilege security guards, and zero-token mechanical gates.

---

## Documentation Map

```text
docs/
├── index.md                 Master documentation hub (this file)
├── QUICKSTART.md            Zero to first verified task in 5 minutes
├── INSTALL.md               System requirements, installation, and upgrades
├── CLI.md                   Complete CLI command and flag reference
├── CONFIGURATION.md         Configuration files, environment variables, and pricing
├── ARCHITECTURE.md          Core architecture, the 13 components, and lifecycle
├── TROUBLESHOOTING.md       Diagnostic workflows, failure recovery, and FAQ
├── DISTRIBUTION.md          Release pipelines, npm, binaries, and package managers
├── DECISIONS.md             Architectural Decision Records (ADRs)
└── EVIDENCE.md              Empirical benchmarks and token efficiency evidence
```

---

## 1. Getting Started

- **[Installation Guide](docs/INSTALL.md)**: System prerequisites (Node 22.6+, Git), PATH link setup, and verifying your environment.
- **[Developer Quickstart](docs/QUICKSTART.md)**: Step-by-step walkthrough to configure an LLM provider and execute your first task with `helix run`.
- **[Configuration Reference](docs/CONFIGURATION.md)**: Details on `.helix/config.json`, environment variables (`HELIX_*`), and CLI flag precedence.

---

## 2. Using Helix

- **[CLI Reference](docs/CLI.md)**: Comprehensive reference for all commands:
  - `helix init`: Inspect your stack and generate agent configuration packs.
  - `helix run`: Execute coding tasks with worktree isolation and mechanical gates.
  - `helix bench`: Repeatable benchmark suite comparing pass rates and token costs across 5 strategies.
  - `helix doctor`: Diagnose pack health, schema validity, and budget compliance.
  - `helix gate`: Run zero-token mechanical validation (secrets, lint, typecheck, tests).
  - `helix measure`: Audit real token counts using byte-pair encoding (BPE).
  - `helix report`: Analyze real session transcripts for token waste and retries.
  - `helix ui`: Local web dashboard for visualizing tasks and benchmarks.
- **[Troubleshooting & FAQ](docs/TROUBLESHOOTING.md)**: Common failure modes, exit codes, and answers to frequently asked questions.

---

## 3. Architecture & Core Concepts

- **[Architecture Deep Dive](docs/ARCHITECTURE.md)**: Detailed breakdown of the 13 core engine components:
  - Task Definition & Heuristic Planner (`src/engine/task.ts`)
  - Layered Context Manager & Token Budgets (`src/engine/context.ts`)
  - Multi-Tier Repository Retriever (`src/engine/retrieval.ts`)
  - Sandboxed Tools & Security Guard (`src/engine/tools.ts`, `src/engine/security.ts`)
  - Ephemeral Git Worktree Manager (`src/engine/worktree.ts`)
  - Mechanical Validation Engine (`src/engine/validator.ts`)
  - Multi-Agent Orchestrator & 12-Line Handoff Cards (`src/engine/orchestrator.ts`)
  - Model Provider & Token Cost Accounting (`src/engine/provider.ts`)
  - Repeatable Benchmark Framework (`src/engine/benchmark.ts`)
- **[Empirical Evidence & Benchmark Data](docs/EVIDENCE.md)**: Head-to-head evaluation results proving why single-agent execution is token-optimal and when independent review is justified.
- **[Architectural Decision Records](docs/DECISIONS.md)**: Immutable record of design choices, rejected alternatives, and verified platform facts.

---

## 4. Development & Release

- **[Distribution & Packaging](docs/DISTRIBUTION.md)**: Standalone binary releases, npm publishing, Homebrew formula, and supply-chain security.
- **[Contributing Guide](CONTRIBUTING.md)**: Development environment setup, quality gates, conventional commits, and pull request expectations.
- **[Security Policy](SECURITY.md)**: Vulnerability disclosure and confidential reporting procedures.
