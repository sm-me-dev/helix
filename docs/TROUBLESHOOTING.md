# Helix Troubleshooting & FAQ

This guide provides diagnostic workflows, actionable resolutions for common failure modes, and answers to frequently asked questions.

---

## 1. Quick Diagnostic Toolkit

When an unexpected issue occurs, run the built-in diagnostic commands:

```sh
# 1. Audit pack health, schema validity, and tool definitions
helix doctor

# 2. Dry-run mechanical verification without modifying files
helix gate --dry

# 3. Inspect real token consumption and transcript anomalies
helix report

# 4. Plan and validate a task without invoking an agent
helix run "Your task description" --dry
```

---

## 2. Common Failure Modes & Solutions

### 2.1 Installation & PATH Issues

#### `helix: command not found`

- **Cause**: `~/.local/bin` is not present in your shell's `PATH` environment variable.
- **Resolution**:
  Run `helix link` from your checkout:
  ```sh
  node cli/helix.mjs link --modify-rc
  ```
  Then reload your shell (`source ~/.bashrc` or `source ~/.zshrc`). Alternatively, run `node cli/helix.mjs` directly.

#### `permission denied: ./cli/helix.mjs`

- **Cause**: Missing POSIX execute bit on the entry script.
- **Resolution**:
  ```sh
  chmod +x cli/helix.mjs
  ```

---

### 2.2 Node.js Version Incompatibilities

#### `SyntaxError: Unexpected token ':'` or type-stripping failure

- **Cause**: Node.js version is older than `22.6.0`. Helix uses Node's native TypeScript type-stripping without global compilation.
- **Resolution**:
  Verify your Node version:
  ```sh
  node --version
  ```
  Install Node 22 LTS or newer using your preferred version manager:
  ```sh
  # Using fnm
  fnm install 22 && fnm use 22

  # Using nvm
  nvm install 22 && nvm use 22
  ```

---

### 2.3 Workspace Concurrency & Locking

#### `WorkspaceLockedError: Workspace is currently locked by PID <n>`

- **Cause**: Another Helix instance is actively executing in the same repository, or a previous run crashed without releasing `.helix-work/workspace.lock`.
- **Resolution**:
  1. Check if the process is actually running:
     ```sh
     ps aux | grep <PID>
     ```
  2. If the process is no longer alive (orphaned lock), remove the stale lock file:
     ```sh
     rm -f .helix-work/workspace.lock
     ```

---

### 2.4 Ephemeral Git Worktree Failures

#### `fatal: A branch named 'helix/<task-id>' already exists`

- **Cause**: An interrupted run left an ephemeral Git branch in git metadata.
- **Resolution**:
  Prune stale worktree references and remove transient branches:
  ```sh
  git worktree prune
  git branch -D helix/<task-id>
  ```

#### Working tree is dirty / uncommitted changes

- **Cause**: You ran `helix run --no-worktree` in a dirty working directory.
- **Resolution**:
  Helix defaults to ephemeral worktrees to leave your primary workspace untouched. If running without worktree isolation, commit or stash your changes first:
  ```sh
  git stash
  helix run "Your task"
  ```

---

### 2.5 Validation Gate Failures

#### Task fails with `Status: FAILED` and exit code 1

- **Cause**: The agent finished its edits, but mechanical verification (`.helix/gate.mjs`) failed (e.g. failing tests, TypeScript errors, or linter violations) and exhausted all retry attempts.
- **Resolution**:
  1. Inspect the execution report saved at `.helix-work/reports/run-<task-id>.json`.
  2. Look at the `diagnostics` section: Helix strips passing noise and extracts only the failing test assertions and stack traces.
  3. Increase retries if the task is complex:
     ```sh
     helix run "Your task" --max-retries 2
     ```
  4. Consider enabling independent review to catch regressions:
     ```sh
     helix run "Your task" --strategy review
     ```

---

### 2.6 Subprocess Timeouts

#### Task aborted with exit code `124` / `ETIMEDOUT`

- **Cause**: The agent subprocess exceeded `defaultTimeoutSec` (default: 600s).
- **Resolution**:
  Increase the timeout for long-running builds or large tasks:
  ```sh
  helix run "Refactor database models" --timeout 1200
  ```

---

### 2.7 Security & Path Traversal Denials

#### `SecurityViolationError: Access to forbidden path '<path>' denied`

- **Cause**: The agent attempted to read, write, or modify a restricted path (`secrets/`, `.env*`, `.git/`, or `.helix/gate.mjs`).
- **Resolution**:
  This is an intentional security invariant. Helix prevents AI agents from exfiltrating credentials or tampering with verification gates. If a legitimate project path was falsely blocked, adjust `constraints.forbiddenPaths` in your task definition.

---

## 3. Frequently Asked Questions (FAQ)

### What does Helix do?

Helix is an AI coding harness designed to make AI coding agents more reliable while strictly controlling token consumption, execution latency, and coordination overhead. It provides pack generation for vendor platforms (`AGENTS.md`, hooks, skills, MCPs) and an autonomous execution engine (`helix run`) that validates code with mechanical gates.

### Can I run Helix with a single agent?

**Yes.** In fact, single-agent execution is Helix's default and recommended mode. Empirical benchmarks show that single-agent execution with mechanical validation is token-optimal (~815 tokens/task) and succeeds on over 80% of routine engineering tasks.

### When should I use multiple agents?

Multi-agent execution is justified in two specific scenarios:

1. **High-Assurance / Sensitive Changes**: Use `--strategy review` (Implementer + Reviewer). The independent reviewer operates in a clean context with only the diff and requirements, eliminating 100% of regressions for a modest +61% token premium.
2. **Independent Subtasks**: Use `--strategy parallel` when subtasks modify disjoint files.

Do **not** use uncoordinated multi-agent swarms for simple tasks; empirical testing proved they waste +251% tokens and increase regressions to 20%.

### Which model providers and platforms are supported?

- **Platforms**: Claude Code, Cursor, Codex, OpenCode, Google Antigravity, GitHub Copilot.
- **Model Providers**: Anthropic, OpenAI, Google Gemini, and local mock runners.

### Does Helix require API credentials?

Helix does not require vendor API credentials for pack generation (`helix init`, `doctor`, `gate`, `measure`). When running coding tasks (`helix run`), credentials depend on the target agent CLI (e.g. `claude`, `opencode`) or your configured `HELIX_PROVIDER`.

### Where are configuration and execution data stored?

- Configuration: `.helix/config.json` and `.helix/` inside the target project.
- Runtime data & reports: `.helix-work/` in the project root. This directory is strictly ignored by Git and stores ephemeral worktrees, locks, and JSON execution reports.

### How do I update Helix?

```sh
cd ~/helix && git pull --ff-only && npm ci
```

Since `helix link` creates a symlink shim pointing directly to your checkout, updating your git clone immediately updates the CLI.

### How do I report a bug or vulnerability?

- Bug reports: Open an issue at [GitHub Issues](https://github.com/sm-me-dev/helix/issues).
- Security vulnerabilities: Please report privately via GitHub Security Advisories or as detailed in [Security Policy](SECURITY.md).
