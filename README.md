# Helix

Helix is an AI coding harness engineered to maximize coding-agent results while strictly controlling token consumption, execution latency, and coordination overhead.

[Installation](docs/INSTALL.md) · [Documentation](docs/index.md) · [Quick Start](docs/QUICKSTART.md) · [Contributing](CONTRIBUTING.md)

---

## Why Helix?

Most AI agent frameworks assume that adding more agents produces better code. In practice, uncoordinated multi-agent swarms multiply token consumption by 3x–4x and increase regression rates through conversational drift.

Helix enforces a disciplined, evidence-based engineering philosophy:

- **Single-Agent by Default**: Routine tasks run in a single session at minimum token cost (~815 tokens/task).
- **Mechanical Validation Over Claims**: An agent claiming "all tests pass" is ignored; success is determined solely by zero-token verification gates (`.helix/gate.mjs`).
- **Worktree Isolation**: Ephemeral Git worktrees prevent workspace corruption and dirty working trees.
- **Independent Adversarial Review**: For complex or sensitive tasks, an isolated reviewer inspects only the diff and requirements, eliminating 100% of regressions at a modest +61% token premium.

---

## Features

- **Harness Pack Generation**: Emits deterministic, minimal instruction packs (`AGENTS.md` ≤ 300 tokens) tailored per platform.
- **Autonomous Task Execution (`helix run`)**: Drives coding tasks with progressive context assembly, worktree isolation, and bounded retries.
- **Zero-Token Verification Gate (`helix gate`)**: Mechanically scans secrets, checks linting, runs typecheck, and executes affected tests.
- **Repeatable Benchmark Suite (`helix bench`)**: Evaluates pass rates, regression tracking, and costs across 10 task categories and 5 execution strategies.
- **Security & Least-Privilege Sandboxing**: Path jail confinement, secret redaction, untrusted content framing, and role-based permissions.
- **Observability & Diagnostics**: Real-time event streaming, structured `--json` reports, token counting via `gpt-tokenizer`, and `helix doctor`.

---

## Installation

Install Helix without cloning its source repository:

### Global npm (Recommended)

```sh
npm install -g @sm-me-dev/helix
```

Or execute directly with zero install:

```sh
npx @sm-me-dev/helix --help
```

### Universal Standalone Installer (Linux & macOS)

Downloads a self-contained application bundle with an embedded Node runtime (no system Node installation required):

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh
```

### Homebrew (macOS & Linux)

```sh
brew install sm-me-dev/tap/helix
```

### Debian / Ubuntu (APT)

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install-apt.sh | sudo sh
```

### Windows (PowerShell)

```powershell
irm https://sm-me-dev.github.io/helix/install.ps1 | iex
```

### Contributor & Development Installation

For developers working directly on the Helix codebase:

```sh
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix && npm ci
./cli/helix.mjs link
```

For complete distribution details, see [Installation Guide](docs/INSTALL.md) · [Updating](docs/UPDATING.md) · [Uninstalling](docs/UNINSTALLING.md) · [Platform Support](docs/PLATFORM_SUPPORT.md).

---

## Quick Start

### 1. Initialize a Harness Pack for Your Repository

```sh
helix init ~/your-repo --platform claude-code,cursor
```

### 2. Verify Repository Health

```sh
helix doctor ~/your-repo
```

### 3. Execute a Coding Task

```sh
helix run "Fix division by zero error in src/calc.ts and update test suite"
```

For advanced workflows, strategy selection, and configuration options, see the [Developer Quickstart Guide](docs/QUICKSTART.md).

---

## Platform Matrix

Helix emits configurations only where vendor documentation was verified.

<!-- matrix:start -->

| Platform           | verified   | instructions | mcp        | skills     | subagents  | hooks                  | plugin     | structured-output | session-continuation | sandboxing | lsp        |
| ------------------ | ---------- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---------- | ----------------- | -------------------- | ---------- | ---------- |
| Claude Code        | 2026-10-11 | emitted      | emitted    | emitted    | emitted    | emitted                | emitted    | unverified        | unverified           | unverified | unverified |
| Cursor             | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Codex              | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | emitted                | unverified | unverified        | unverified           | unverified | unverified |
| Gemini CLI         | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| GitHub Copilot     | 2026-10-10 | emitted      | emitted    | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Windsurf           | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Cline              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Aider              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| OpenCode           | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Google Antigravity | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | supported, not emitted | unverified | unverified        | unverified           | unverified | unverified |
| Devin CLI          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Factory Droid      | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kiro               | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Amp                | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kilo Code          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |

<!-- matrix:end -->

---

## Documentation

- **[Documentation Index](docs/index.md)**: Master documentation hub.
- **[Installation Guide](docs/INSTALL.md)**: Prerequisites, shell linking, verification, and uninstallation.
- **[Quickstart Guide](docs/QUICKSTART.md)**: First task walkthrough and core workflow options.
- **[CLI Reference](docs/CLI.md)**: Comprehensive command, flag, and exit code reference.
- **[Configuration Reference](docs/CONFIGURATION.md)**: Config file schemas, environment variables, and pricing tables.
- **[Architecture Guide](docs/ARCHITECTURE.md)**: Engine boundaries, the 13 components, and execution lifecycle.
- **[Troubleshooting & FAQ](docs/TROUBLESHOOTING.md)**: Diagnostics, common failure modes, and answers to common questions.
- **[Distribution Guide](docs/DISTRIBUTION.md)**: Release channels, npm, Homebrew, and supply-chain security.
- **[Architectural Decisions](docs/DECISIONS.md)**: Append-only design records and rejected alternatives.
- **[Empirical Evidence](docs/EVIDENCE.md)**: Measured benchmark findings and statistical evaluation data.

---

## Development

Helix enforces strict quality gates on every commit:

```sh
npm run lint && npm run typecheck && npm test
```

For developer setup, coding standards, and PR workflows, read the [Contributing Guide](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
