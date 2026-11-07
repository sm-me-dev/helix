# Architectural Audit — Helix AI Coding Harness

> **Historical snapshot:** This audit records the repository before the Helix v2 architecture and provider runtime landed. Its package, CLI, provider, and runtime observations are superseded by the current [architecture](ARCHITECTURE.md), [configuration](CONFIGURATION.md), and [CLI reference](CLI.md). The dated findings below are retained as audit history, not current documentation.

**Date:** 2026-11-03  
**Repository:** `/home/sm-me/Codes/Typescript/helix`  
**Branch:** `remediation/architectural-remediation` (from `main`)  
**Node:** v26.12.1 (CI targets Node 22; Node 24 also accepted)  
**Package:** `@sm-me-dev/helix@0.1.0`, ESM (`"type": "module"`), engines `>=22.6`

---

## Stack

- **Language:** TypeScript / Node.js ESM (not Python).
- **Only runtime dependency:** `gpt-tokenizer@^4.1.0` (token counting).
- **Dev tooling:** `eslint`, `prettier`, `typescript`, `tsx`-style type stripping via `node --experimental-strip-types`.
- **No LLM SDK installed** (no `anthropic`, `openai`, `google-genai`, etc.).
- **No credential loading** (no dotenv, no keychain, no `base_url`/`api_key` plumbing).

## Entrypoints

| File                        | Role                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/helix.mjs`             | Universal bin entry; imports `dist/cli/helix.mjs` if present, else `cli/helix.mjs`                                                                            |
| `cli/helix.mjs` (942 lines) | Main CLI dispatch: `init`, `doctor`, `measure`, `export`, `eval`, `run`, `ui`, `gate`, `report`, `bench`, `link`, `learn`, `knowledge`, `update`, `uninstall` |
| `cli/run.ts`                | `helix run` implementation — task definition, config load, runner/provider setup, event listener, output rendering                                            |
| `cli/ui.ts`                 | `helix ui` — localhost-only HTTP view over CLI commands (127.0.0.1, random port, token cookie, whitelisted actions) — **not a chat UI**                       |

## Core engine (`src/engine/`)

| File                              | Role                                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/types.ts` (803 lines) | All core contracts: `TaskDefinition`, `TaskResult`, `ExecutionEvent`, `AgentRunner`, `ModelProvider`, `EngineConfig`, `ValidationEngine`, `ObservabilityCollector`, etc. `ProviderId = "anthropic"         | "openai" | "google" | "local" | "generic"` (line 221). |
| `src/engine/config.ts`            | `loadEngineConfig` / `saveEngineConfig` for `.helix/config.json` + `HELIX_*` env + runtime overrides. Precedence: defaults → file → env → overrides.                                                       |
| `src/engine/provider.ts`          | `DefaultModelProvider` implements `ModelProvider` — **token counting + cost estimation only**. Pricing table + default models per provider. No `base_url`, no `api_key`, no LLM calls.                     |
| `src/engine/engine.ts`            | `HelixExecutionEngine.execute()` — worktree provisioning, context assembly, agent run, retry loop (max 2), mechanical gate, state events.                                                                  |
| `src/engine/runner.ts`            | `MockAgentRunner` (tests) + `SubprocessAgentRunner` (shells out to platform CLI via `child_process.spawn`, pipes system prompt/messages to stdin). `PLATFORM_DEFAULT_BINARIES` maps platforms to binaries. |
| `src/engine/state.ts`             | `FileExecutionStateManager` — persists `state-<taskId>.json` + `.helix-work/state.json` mirror under `.helix-work/`.                                                                                       |
| `src/engine/index.ts`             | Barrel export of all engine modules.                                                                                                                                                                       |

## Where stdio is coupled to the agent loop (the coupling point)

**`cli/run.ts`**, function `cmdRun`, the `onEvent` listener (lines 299–378):

```ts
const onEvent = (event: ExecutionEvent) => {
  if (jsonOutput) return;
  ...
  process.stdout.write(`\x1b[36m[${time}] [start]\x1b[0m ...\n`);
  ...
};
```

Every execution event is rendered as ANSI-colored text written directly to `process.stdout`. Additionally, the agent subprocess (`SubprocessAgentRunner`, `cli/runner.ts` lines 186–195) uses `stdio: ["pipe", "pipe", "pipe"]`, but its stdout/stderr are captured into strings, **not** forwarded to the terminal — so the only live stdio coupling is the CLI's `onEvent` → `process.stdout`.

Consequences:

- No daemon mode; no SSE/WebSocket; no session persistence beyond `.helix-work/`.
- TUI and any Web UI would have to duplicate this `process.stdout` coupling or parse CLI output.
- Agent stdout/stderr never reach the user in real time.

## Where LLM credentials/endpoints are loaded

**Nowhere.**

- `src/engine/provider.ts`: `DefaultModelProvider` only counts tokens (`countTokens`) and estimates cost (`calculateCost`) from a hardcoded pricing table (`MODEL_PRICING_TABLE`). Constructor takes only `providerId` and `customPricing` — **no `apiKey`, no `baseUrl`**.
- `src/engine/config.ts`: `ExtendedEngineConfig` has no `baseUrl`, `apiKey`, or provider profiles. Env vars supported: `HELIX_PLATFORM`, `HELIX_SINGLE_AGENT`, `HELIX_WORKTREE_DIR`, `HELIX_REPORT_DIR`, `HELIX_TIMEOUT_SEC`, `HELIX_MAX_RETRIES`, `HELIX_PROVIDER`, `HELIX_MODEL`, `HELIX_LOG_LEVEL`. **No `HELIX_API_KEY`, no `HELIX_BASE_URL`.**
- `src/engine/types.ts`: `ModelProvider` interface declares only `countTokens` and `calculateCost`. No `completion`/`chat` method.
- `cli/run.ts`: `createModelProvider(config.defaultProvider)` — provider selected but never used for an actual LLM call; the agent is a subprocess of a platform CLI (Claude Code, Codex, etc.), which brings its own credentials from the environment.

**Gap summary:** Helix cannot yet drive an LLM itself. It relies entirely on the platform CLI binary (e.g. `claude`, `codex`) being installed and authenticated on `PATH`. There is no provider abstraction for direct API calls, no credential resolution, and no base_url override.

## Events / state

- `ExecutionEvent` (`src/engine/types.ts:673`): `eventId, taskId, timestamp, type, workflowState, payload`. 18 event types (`task_started` … `integration_completed`).
- `ExecutionStateSnapshot` persisted to `.helix-work/state-<taskId>.json` (+ `.helix-work/state.json` mirror).
- `.helix-work/` and `.helix/cache/` are already gitignored.

## Tests / gates

- `npm test` → `node scripts/run-tests.mjs`
- `test:ts` → `node --experimental-strip-types --test 'src/**/*.test.ts'`
- `test:mjs` → `node --test 'scripts/**/*.test.mjs' 'cli/**/*.test.mjs' 'evals/**/*.test.mjs'`
- `lint` → `eslint .` ; `typecheck` → `tsc --noEmit`
- **Gate (non-negotiable):** `npm run lint && npm run typecheck && npm test` on Node 22.
- Existing tests: `cli/run.test.mjs`, `cli/ui.test.mjs`, `src/engine/*.test.ts`.

## .gitignore status (setup)

- Had **no root-only `/tmp/` rule**. Added `/tmp/` (root-anchored, so only the repo-root `tmp/` directory is ignored, not nested `tmp/` dirs).
- `.helix-work/` and `.helix/cache/` already ignored.

## Planned file tree changes (Phases 1–4)

```
src/engine/
  config.ts           (+ baseUrl/apiKey/providerProfiles; ExtendedEngineConfig)
  provider.ts         (+ LLM client abstraction: chat/completion; apiKey, baseUrl)
  llm-client.ts       (new)  provider-specific HTTP clients (anthropic/openai/google/local/generic)
  credentials.ts      (new)  credential resolution: env (HELIX_API_KEY/HELIX_BASE_URL), keychain, .env
  types.ts            (+ LLM request/response types, ProviderCredentials)
cli/
  run.ts              (onEvent → UICallback/EventEmitter instead of process.stdout; decoupled)
  ui.ts               (unchanged shape; becomes a stateless view over the event stream)
  helixd.ts           (new)  daemon: SSE/WebSocket event stream + UICallback approval contract
tmp/                  (new, gitignored) phase report drafts
docs/
  ARCHITECTURAL_AUDIT.md   (this document)
  DECISIONS.md             (append: platform-fact verifications with source + verifiedAt)
```

Phase gate rule: complete and test each phase sequentially; no Phase N+1 until Phase N gate passes. No `// TODO`/`pass` stubs in routing, config parsing, or event streaming. Platform facts (hook protocol, config schema, key names) verified against current docs before shipping; recorded in `docs/DECISIONS.md` with `source` URL and `verifiedAt`.

## Verification (Phase 0 gate)

- `git status` shows only `.gitignore` (setup-sanctioned) and `docs/ARCHITECTURAL_AUDIT.md` (new).
- `npm run lint && npm run typecheck` green (confirmed baseline before this doc; no source files touched).

## Handoff to Phase 1

Confirmed file paths to touch: `src/engine/config.ts`, `src/engine/provider.ts`, `src/engine/types.ts`, `src/engine/engine.ts`, `src/engine/runner.ts`, `cli/helix.mjs`, `cli/run.ts`, `cli/ui.ts`, `package.json`. New files: `src/engine/llm-client.ts`, `src/engine/credentials.ts`, `cli/helixd.ts`.
