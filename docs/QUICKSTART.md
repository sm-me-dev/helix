# Helix Developer Quickstart Guide

Helix is an AI coding harness engineered to maximize coding agent success rates while strictly controlling token consumption, execution latency, and coordination overhead.

---

## 1. Quick Installation & Setup

Helix requires **Node 26.4+** (OpenTUI's native FFI runtime and Node's native TypeScript type-stripping). No global compilation is needed.

### Option A: Direct PATH Link (Recommended)

From your Helix checkout:

```sh
node cli/helix.mjs link
```

This installs a fast shim at `~/.local/bin/helix` and ensures `helix` is on your `PATH`.

Verify installation:

```sh
helix --help
```

### Option B: Local Repository Usage

You can execute Helix directly from the checkout:

```sh
node cli/helix.mjs --help
```

For the full web and terminal clients, install the repository dependencies and
build the SPA:

```sh
npm install
npm run build
helix tui
# In another terminal, share the same daemon session:
helix web
```

---

## 2. Configuring an LLM Provider

Helix works with any standard coding agent CLI (Claude Code, OpenCode, Codex, Cursor) or API provider (Anthropic, OpenAI, Google Gemini).

### Platform Selection

Helix automatically detects installed platforms on your system `PATH`. You can override your target platform via `.helix/config.json` or environment variables:

```sh
export HELIX_PLATFORM="claude-code" # options: claude-code, opencode, codex, cursor
```

### Provider & Model Configuration

To track token expenditures and dollar costs accurately:

```sh
export HELIX_PROVIDER="anthropic"   # options: anthropic, openai, google, local
export HELIX_MODEL="claude-3-5-sonnet-20241022"
```

### Project Configuration (`.helix/config.json`)

You can persist project-level defaults in `.helix/config.json`:

```json
{
  "defaultPlatform": "claude-code",
  "defaultSingleAgent": true,
  "defaultProvider": "anthropic",
  "defaultModelId": "claude-3-5-sonnet-20241022",
  "defaultTimeoutSec": 600,
  "maxRetries": 2
}
```

---

## 3. Executing Coding Tasks (`helix run`)

Helix executes tasks with **single-agent default simplicity**, isolated **ephemeral git worktrees**, and **mechanical validation gates**.

### Basic Usage: Passing a Prompt

```sh
helix run "Fix division by zero error in src/calc.ts and update test suite"
```

### Passing a Markdown Task Spec

```sh
helix run examples/tasks/02-feature-rate-limiter.md
```

### Passing a Structured JSON Task

```sh
helix run examples/tasks/01-bugfix-calculation.json
```

### Piping from Stdin

```sh
echo "Refactor auth middleware to use bearer token" | helix run
```

---

## 4. Key Execution Flags

| Flag                | Purpose                                                         | Default                |
| ------------------- | --------------------------------------------------------------- | ---------------------- |
| `--strategy <name>` | Execution strategy (`single`, `chain`, `parallel`, `full-crew`) | `single`               |
| `--dry`             | Plan task, compute context, and verify without modifying files  | `false`                |
| `--no-worktree`     | Run directly in repository instead of ephemeral worktree        | `false` (isolated)     |
| `--pass <cmd>`      | Override pass validation command (e.g. `npm test`)              | Detected stack gate    |
| `--target <files>`  | Comma-separated target files expected to change                 | Automatic              |
| `--timeout <sec>`   | Task timeout in seconds                                         | `600`                  |
| `--max-retries <n>` | Max gate retry attempts on validation failure (0 to 2)          | `2`                    |
| `--simulation`      | Deterministic simulation mode for testing & CI                  | `false`                |
| `--json`            | Output execution result and metrics as JSON                     | `false`                |
| `--out <path>`      | Save full execution report JSON to file                         | `.helix-work/reports/` |

---

## 5. Observing Execution Progress

When running a task, Helix streams real-time status:

```text
Helix AI Coding Harness
Task:        task-example-bugfix
Strategy:    single
Platform:    claude-code
Isolation:   Ephemeral Git Worktree
────────────────────────────────────────────────────────────
[3:30:00 PM] [start] Task started: task-example-bugfix (Fix division by zero)
[3:30:01 PM] [plan] Classified as standard tier
[3:30:01 PM] [worktree] Isolated workspace provisioned: .helix-work/worktrees/task-example-bugfix
[3:30:02 PM] [agent] Executing single-agent...
[3:30:05 PM] [agent] Agent completed in 3.1s (exit 0)
[3:30:05 PM] [gate] Running mechanical verification...
[3:30:06 PM] [gate] Mechanical verification passed (3 checks)
[3:30:06 PM] [done] Task execution completed successfully!
────────────────────────────────────────────────────────────
Status:      SUCCEEDED
Summary:     Task executed successfully and verified by mechanical gate.
Duration:    4.12s (agent: 3.10s, gate: 0.95s)
Tokens:      1,450 in / 320 out / 1,770 total ($0.0091 USD)
Affected:    src/calc.ts, src/calc.test.ts

Modifications:
@@ -10,3 +10,6 @@
+  if (b === 0) {
+    throw new RangeError("Division by zero");
+  }

Artifact:    .helix-work/reports/run-task-example-bugfix.json
```

---

## 6. Understanding Multi-Agent Strategies

Helix adheres to a strict engineering principle: **Single capable agent by default.**

Only introduce additional agents when justified by task complexity:

- **`--strategy single` (Default):** Minimal overhead, fastest execution, lowest token consumption. Ideal for 80%+ of development tasks.
- **`--strategy chain`:** Scout/Architect plans first, Builder implements, Reviewer inspects. Best for complex, ambiguous, or security-sensitive code.
- **`--strategy parallel`:** Independent subtasks run concurrently in isolated worktrees and merge. Best for multi-module or decoupled features.

---

## 7. Exit Codes

Helix uses predictable, standard exit codes:

- `0`: Task succeeded and passed all mechanical gate checks.
- `1`: Task failed execution or gate validation (retries exhausted).
- `2`: CLI usage error, invalid argument, or malformed task.
- `3`: Task blocked by workflow policy (e.g. ambiguity or missing facts).
- `130`: Interrupted by user (SIGINT / Ctrl+C).
