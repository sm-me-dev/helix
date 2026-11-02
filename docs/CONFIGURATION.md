# Helix Configuration Reference

Helix supports flexible, hierarchical configuration that adapts to individual developer workflows, project-level standards, and automated CI/CD pipelines.

---

## 1. Configuration Precedence

Helix resolves configuration settings in the following strict order of precedence (highest to lowest):

1. **Runtime CLI Flags**: Flags passed directly to commands (e.g., `helix run --strategy chain --timeout 300`).
2. **Project Configuration File**: `.helix/config.json` in your repository root or ascending parent directories.
3. **Environment Variables**: System environment variables prefixed with `HELIX_` (e.g., `export HELIX_PROVIDER=anthropic`).
4. **Engine Defaults**: Built-in production defaults defined in `src/engine/config.ts`.

---

## 2. Project Configuration (`.helix/config.json`)

To establish shared project defaults, create a `.helix/config.json` file in your repository root:

```json
{
  "defaultPlatform": "claude-code",
  "defaultSingleAgent": true,
  "defaultProvider": "anthropic",
  "defaultModelId": "claude-3-5-sonnet-20241022",
  "defaultTimeoutSec": 600,
  "maxRetries": 2,
  "worktreeDir": ".helix-work/worktrees",
  "reportDir": ".helix-work/reports"
}
```

### Configuration Options Schema

| Field                | Type      | Default                        | Description                                                                                                           |
| -------------------- | --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `defaultPlatform`    | `string`  | `"claude-code"`                | Default agent platform: `claude-code`, `opencode`, `codex`, `cursor`, `gemini`, `copilot`, `antigravity`.             |
| `defaultSingleAgent` | `boolean` | `true`                         | When `true`, tasks execute in a single agent session by default. Orchestrator engages only when explicitly requested. |
| `defaultProvider`    | `string`  | `"anthropic"`                  | LLM provider for token counting and cost modeling: `anthropic`, `openai`, `google`, `local`.                          |
| `defaultModelId`     | `string`  | `"claude-3-5-sonnet-20241022"` | Default LLM model identifier.                                                                                         |
| `defaultTimeoutSec`  | `number`  | `600`                          | Task execution timeout in seconds. Subprocesses exceeding this limit receive `SIGKILL`.                               |
| `maxRetries`         | `number`  | `2`                            | Maximum mechanical gate validation retries. Clamped to a hard architectural ceiling of `2` to prevent token runaway.  |
| `worktreeDir`        | `string`  | `".helix-work/worktrees"`      | Base directory where ephemeral Git worktrees are provisioned.                                                         |
| `reportDir`          | `string`  | `".helix-work/reports"`        | Base directory where execution JSON reports and benchmark results are saved.                                          |

---

## 3. Environment Variables Reference

Every engine setting can be configured via environment variables. Environment variables take precedence over `.helix/config.json`.

| Variable               | Matching Config Field | Description                           | Example                                    |
| ---------------------- | --------------------- | ------------------------------------- | ------------------------------------------ |
| `HELIX_PLATFORM`       | `defaultPlatform`     | Target agent platform CLI             | `export HELIX_PLATFORM=cursor`             |
| `HELIX_PROVIDER`       | `defaultProvider`     | LLM provider for token math & pricing | `export HELIX_PROVIDER=openai`             |
| `HELIX_MODEL`          | `defaultModelId`      | Model identifier string               | `export HELIX_MODEL=gpt-4o`                |
| `HELIX_TIMEOUT_SEC`    | `defaultTimeoutSec`   | Execution timeout in seconds          | `export HELIX_TIMEOUT_SEC=300`             |
| `HELIX_MAX_RETRIES`    | `maxRetries`          | Maximum gate retries (0, 1, or 2)     | `export HELIX_MAX_RETRIES=1`               |
| `HELIX_SINGLE_AGENT`   | `defaultSingleAgent`  | Force single-agent default (`1`/`0`)  | `export HELIX_SINGLE_AGENT=1`              |
| `HELIX_WORKTREE_DIR`   | `worktreeDir`         | Custom ephemeral worktree path        | `export HELIX_WORKTREE_DIR=/tmp/worktrees` |
| `HELIX_REPORT_DIR`     | `reportDir`           | Custom execution reports path         | `export HELIX_REPORT_DIR=/tmp/reports`     |
| `HELIX_SIMULATION`     | N/A                   | Enable deterministic mock agent (CI)  | `export HELIX_SIMULATION=1`                |
| `HELIX_RUNNER_COMMAND` | N/A                   | Custom subprocess command override    | `export HELIX_RUNNER_COMMAND=my-agent`     |

---

## 4. Model Pricing & Token Accounting

Helix includes verified pricing tables in `src/engine/provider.ts` to compute sub-cent execution costs across input, output, and cache-read tokens:

### Anthropic Pricing Table

| Model ID                     | Input ($/M) | Output ($/M) | Cache Read ($/M) |
| ---------------------------- | ----------- | ------------ | ---------------- |
| `claude-3-5-sonnet-20241022` | $3.00       | $15.00       | $0.30            |
| `claude-3-7-sonnet`          | $3.00       | $15.00       | $0.30            |
| `claude-3-5-haiku`           | $1.00       | $5.00        | $0.10            |
| `claude-3-opus`              | $15.00      | $75.00       | $1.50            |

### OpenAI Pricing Table

| Model ID      | Input ($/M) | Output ($/M) | Cache Read ($/M) |
| ------------- | ----------- | ------------ | ---------------- |
| `gpt-4o`      | $2.50       | $10.00       | $1.25            |
| `gpt-4o-mini` | $0.15       | $0.60        | $0.075           |
| `o1`          | $15.00      | $60.00       | $7.50            |
| `o3-mini`     | $1.10       | $4.40        | $0.55            |

### Google Gemini Pricing Table

| Model ID           | Input ($/M) | Output ($/M) | Cache Read ($/M) |
| ------------------ | ----------- | ------------ | ---------------- |
| `gemini-2.5-flash` | $0.15       | $0.60        | $0.0375          |
| `gemini-2.5-pro`   | $1.25       | $5.00        | $0.3125          |

---

## 5. Validating Configuration

You can verify your configuration at any time using `helix doctor`:

```sh
helix doctor
```

`helix doctor` inspects your configuration files, validates platform schemas, checks hook permissions, verifies tool integrity, and reports any invalid options with actionable fixes.
