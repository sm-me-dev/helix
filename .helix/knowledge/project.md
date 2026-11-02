---
project_name: helix
project_type: Node.js/TypeScript
discovered_at: 2026-11-02
domain_count: 9
---

# Project Overview: helix

An AI coding harness that earns its tokens through bounded context, ephemeral worktrees, and zero-token mechanical gates

## Primary Technologies

- Languages: javascript, typescript, typescript/javascript
- Manifests: evals/fixture/package.json, package.json
- Entry Points: src/generate.ts, cli/helix.mjs, src/engine/index.ts

## Discovered Domains

### CLI & Developer Tooling (`cli-tooling`)

Command-line interface commands (init, doctor, measure, gate, run, bench, knowledge)

- Source paths: cli/cli.test.mjs, cli/e2e-workflows.test.mjs, cli/helix.mjs, cli/idempotent-init.test.mjs (and 18 more)
- Dependencies: execution-engine, pack-generation

### Platform Adapters (`platform-adapters`)

Target harness adapters for Anthropic Claude, OpenAI Codex, OpenCode, and Antigravity

- Source paths: src/adapters/antigravity.ts, src/adapters/claude.ts, src/adapters/codex.ts, src/adapters/copilot.ts (and 8 more)
- Dependencies: pack-generation

### File Pack Generation (`pack-generation`)

Harness pack compiler emitting platform files, gate scripts, and repo outlines

- Source paths: src/crew.ts, src/generate.test.ts, src/generate.ts, src/mcps.ts (and 1 more)
- Dependencies: None

### Evaluation & Benchmarks (`evaluation-benchmarks`)

Repeatable benchmarking, paired stats evaluation, and comparative performance analysis

- Source paths: src/engine/benchmark.test.ts, src/engine/benchmark.ts, src/engine/experiment.ts
- Dependencies: execution-engine

### Core Execution Engine (`execution-engine`)

Deterministic task execution lifecycle, single-agent baseline, and gate verification loops

- Source paths: src/engine/config.ts, src/engine/engine.test.ts, src/engine/engine.ts, src/engine/index.ts (and 7 more)
- Dependencies: security-isolation, context-optimization

### Context & Token Optimization (`context-optimization`)

Progressive context disclosure, token budgeting, excerpt citations, and prompt compression

- Source paths: src/engine/context.test.ts, src/engine/context.ts, src/engine/retrieval.ts
- Dependencies: None

### Agent Orchestration (`orchestration`)

Multi-agent task routing, lifecycle coordination, handoff protocols, and execution state

- Source paths: src/engine/orchestrator.test.ts, src/engine/orchestrator.ts, src/engine/runner.ts
- Dependencies: execution-engine, context-optimization

### Security & Tool Isolation (`security-isolation`)

Workspace isolation, path containment, ephemeral worktrees, and prompt injection defense

- Source paths: src/engine/security.test.ts, src/engine/security.ts, src/engine/tools.ts, src/engine/worktree.ts
- Dependencies: None

### Adaptive Project Knowledge System (APKS) (`knowledge-system`)

Persistent structured knowledge, FTS5 SQLite index, dynamic retrieval, and adaptive maintenance

- Source paths: src/knowledge/benchmark.ts, src/knowledge/context-adapter.ts, src/knowledge/discovery.ts, src/knowledge/export.ts (and 6 more)
- Dependencies: context-optimization, security-isolation

## Domain Interaction Map

```text
cli-tooling --> execution-engine, pack-generation
platform-adapters --> pack-generation
pack-generation (standalone)
evaluation-benchmarks --> execution-engine
execution-engine --> security-isolation, context-optimization
context-optimization (standalone)
orchestration --> execution-engine, context-optimization
security-isolation (standalone)
knowledge-system --> context-optimization, security-isolation
```
