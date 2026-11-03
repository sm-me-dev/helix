# Helix CLI reference

Binary: `cli/helix.mjs` (executable; run as `./cli/helix.mjs` or
`node cli/helix.mjs`). Requires **Node 22.6+** (runs TypeScript directly via
type stripping). No dependencies beyond the repo checkout.

Exit codes everywhere: `0` success · `1` a check failed · `2` usage error.

## `helix init [dir] [--platform a,b|all] [--force] [--crew [--lean-subagents]] [--ci|--no-ci] [--no-index]`

Detect the stack and installed agents, write the harness pack.

- Default is the universal pack: no model subagents. `--crew` adds scout,
  architect, builder and reviewer (Claude Code agents get `maxTurns`; the
  reviewer may run only `node .helix/gate.mjs` through a PreToolUse hook that
  ships with it). `--lean-subagents` (needs `--crew`) sets `omitClaudeMd` on
  scout, architect and reviewer; it is off by default because its effect on pass
  rate is unmeasured.
- `--ci` / `--no-ci`: write `.github/workflows/helix-gate.yml` (runs the gate on
  every push and PR, actions pinned to SHAs). Default: when the repo already has
  `.github/`. Skipped, with a note, for stacks it cannot install (non-Node, bun).
- With Graphify on `PATH` and no `graphify-out/GRAPH_REPORT.md`, init runs
  `graphify update .`; `--no-index` skips that. No usable index means the outline
  map, never a pack that says "query the graph" over a missing graph.

- Detects language, package manager, test/lint/format commands, file count,
  UI presence, and existing agent config (repo markers first, agent CLIs on
  `PATH` second). Small repos (< 20 files) or missing Graphify select the
  built-in outline map; non-UI repos skip Playwright.
- Safe and repeatable: existing files are never overwritten silently. A diff
  is shown and confirmation asked; with closed stdin (CI, pipes) the answer
  is always no. `--force` overwrites without asking.
- An existing `opencode.json` is **merged**: Helix MCP entries are added,
  unrelated settings kept, same-name existing servers win.
- Unknown `--platform` ids print the known list and exit `2`.
- Side effects: writes `AGENTS.md`, `.helix/`, and one file group per
  platform at the target root. Never touches top-level `README.md`.
- Pack paths are validated before writing (relative only, no `..`, no
  absolute paths); unsafe entries are skipped with a warning.

```sh
node cli/helix.mjs init ~/your-repo --platform claude-code,codex
node cli/helix.mjs init . --platform all --force
```

## `helix doctor [dir] [--utilization] [--json]`

Check the installed harness. Exit `1` on any failure, else prints `healthy`.

- Fails when `AGENTS.md` is missing or over budget (60 lines / ~500 tokens),
  when emitted JSON/TOML configs do not parse or match their platform shape,
  when hook scripts referenced by settings are missing or exit non-zero on
  sample input, when `.helix/gate.mjs --dry` fails, or when configs float on
  `@latest` / unpinned refs.
- Also prints the MCP inventory (measured vs estimate tokens per server).
- `--utilization`: displays an ASCII harness utilization dashboard (token efficiency,
  active worktree concurrency, resource saturation status).
- `--json`: outputs machine-readable JSON status including health checks and system
  utilization metrics.

```sh
node cli/helix.mjs doctor ~/your-repo
node cli/helix.mjs doctor --utilization
node cli/helix.mjs doctor --json
```

## `helix telemetry [dir] [--json] [--ascii]`

Surface harness resource utilization, concurrency levels, and token efficiency charts.

- **Token efficiency tracking**: uncached context tokens vs. cumulative tokens saved by mechanical gates.
- **Concurrency & queue depth**: inspects active ephemeral git worktrees and queue load.
- **Resource saturation**: tracks CPU, memory pressure against heap limits, and process health (`nominal`, `elevated`, `saturated`).
- **Visualizations**: exports formatted ASCII charts and dashboards or JSON-ready timeseries structures.

```sh
node cli/helix.mjs telemetry
node cli/helix.mjs telemetry --json
```

## `helix measure [dir]`

Print the real token breakdown (o200k_base BPE approximation, labeled as
such): always-on cost by part, naive baseline from committed fixtures, lean
score with passing checks, per-platform MCP cost, and the method line.
Per-task tokens are **not** included — run `helix report` on real sessions.
Exits `0`. Without a pack in `dir`, measures the default config and says so.

## `helix gate [dir] [--all] [--dry] [--json]`

Secrets, lint, typecheck, affected tests on changed files. Exit `0` pass ·
`1` a check failed · `2` usage error. Runs the **bundled** gate source with
the target repo's `.helix/gate.json` pins; a repo-supplied `gate.mjs` is
never executed.

- Default scope is changed files (`git status`); `--all` scans every tracked
  file and runs the full suite. `--dry` prints the plan and runs nothing.
- Secret scan flags AWS keys, private keys, GitHub/Slack tokens, `sk-`
  keys, assigned secrets, and committed `.env` files (placeholders like
  `example` / `process.env` are ignored). Outside a git repo the step skips.
- Runners without a verified related-test mode (anything but Jest/Vitest)
  run the full configured test command.
- `--json` steps carry `name`, `status` (`pass`/`fail`/`skip`), `command`
  (null when skipped), `code`, `ms`, and `tail`. The gate is deterministic;
  enforcement depends on wiring (Stop hook, git hook, CI) — untriggered, it
  is advisory. It runs repo-configured lint/test commands: only run it in
  repos you trust.

## `helix report [dir] [--claude <path>] [--opencode <db>] [--limit n] [--json]`

Tokens, repeated reads, oversized outputs, and retries from **real** session
transcripts (Claude Code JSONL, OpenCode SQLite). Missing sources are listed
as skipped, never invented. `--limit` needs a positive integer (else exit
`2`). Read-only; writes nothing.

## `helix export --platform <id>`

Print the pack as JSON (`{ files: [{ path, language, body }] }`) for scripted
use. Uses the same `generatePack` as `init`: for one
platform the output is deterministic (byte-identical across runs). Missing or
unknown `--platform` exits `2`.

## `helix run [task-prompt-or-file] [options]`

Execute a coding task with ephemeral git worktree isolation, progressive context assembly,
and mechanical gate validation. Single agent is the default execution strategy.

- **Arguments:**
  - `task-prompt-or-file`: Direct prompt string, path to a `.md` or `.json` task specification, or piped via stdin.
- **Key Options:**
  - `--strategy <single|chain|parallel|full-crew>`: Execution strategy (default: `single`).
  - `--platform <id>`: Target agent platform (e.g. `claude-code`, `opencode`, `codex`, `cursor`).
  - `--provider <id>`: LLM provider for token and dollar cost tracking (`anthropic`, `openai`, `google`).
  - `--dry`: Plan only; do not launch agent or modify files.
  - `--no-worktree`: Execute directly in current workspace instead of an ephemeral worktree.
  - `--timeout <sec>`: Task timeout in seconds (default: 600).
  - `--max-retries <n>`: Maximum gate verification retries on failure (default: 2, ceiling: 2).
  - `--pass <command>`: Verification test/gate command.
  - `--target <files>`: Comma-separated target files expected to be modified.
  - `--simulation`: Deterministic simulation mode for testing and CI.
  - `--json`: Output structured JSON result and metrics.
  - `--out <path>`: Save execution report JSON to a custom file path.
- **Exit Codes:**
  - `0`: Task succeeded and passed mechanical validation.
  - `1`: Task failed execution or verification (retries exhausted).
  - `2`: Invalid CLI arguments or malformed task specification.
  - `3`: Task blocked by workflow policy (e.g. ambiguity or missing facts).
  - `130`: Interrupted by user signal (SIGINT / SIGTERM).

```sh
helix run "Fix null check in src/auth.ts"
helix run examples/tasks/01-bugfix-calculation.json --dry
helix run "Refactor payment module" --strategy chain --pass "npm test"
```

## `helix bench [--strategy s1,s2] [--category c1,c2] [--runs n] [--utilization] [--json] [--standard-json] [--out <path>]`

Execute the repeatable benchmark evaluation suite across 10 task categories and 5 execution
strategies, computing regression rates, cost per successful task, and strategy comparison matrices.
Use `--utilization` to append harness telemetry and utilization charts.

```sh
helix bench --strategy single,chain --category bugfix,feature --runs 1
helix bench --strategy all --utilization
helix bench --strategy all --json --out .helix-work/reports/bench-matrix.json
```

## `helix eval [options]`

Opt-in head-to-head agent evaluations. Costs money and wall time — never runs
in CI. See `evals/README.md`. `--dry-run` plans without launching anything;
`--self-check` validates the grading pipeline with no agent.

## `helix learn <sub> [dir] [flags]`

Opt-in Learning Ledger (evidence-gated, default off). Subcommands: `init`
(never overwrites), `capture`, `accept`, `confirm`, `human-accept`, `list`,
`compile`, `decay`. Lessons can never write hooks, settings, or permissions.
`helix learn` with no subcommand prints the subcommand reference.

## `helix link [--bin-dir <dir>] [--modify-rc|--no-modify-rc] [--force]` · `helix unlink`

Install or remove a `helix` command. The shim (`cli/link.ts`) is a POSIX script in `~/.local/bin`
(or `--bin-dir`) that runs this checkout with Node's type stripping, using the `node` on `PATH` at run
time and falling back to the one that ran `link`. It is idempotent, and it never replaces a `helix`
file it did not write unless `--force` is given. When the directory is not on `PATH`, `link` asks
before appending a marked block to `.zshrc` or `.bashrc` (no prompt without a terminal: it prints the
line instead); `unlink` removes the shim and exactly that block. Windows: not supported.

## `helix ui [dir] [--port <n>] [--open]`

A local web view (`cli/ui.ts`) for `doctor`, `measure`, `gate`, `gate --all`, `report` and `init`. It
runs the same CLI commands as child processes in `dir` and shows their exit code and output.

- Listens on `127.0.0.1` only. Default port 4317 (a free one if that is taken; `--port` fails
  instead). Prints a URL with a one-time token; open it, or pass `--open`.
- The token is traded for an HttpOnly, SameSite=Strict cookie. Requests need that cookie, a loopback
  `Host`, a same-origin `Origin` when one is sent, and an `X-Helix` header on actions.
- The browser cannot pick the directory, the command or free-form arguments: actions are a fixed
  list, and `init` accepts only a platform list and a crew flag. `gate` runs the repo's own test and
  lint commands, so only point `ui` at a repo you trust.
- The page loads nothing from the network (CSP `default-src 'none'`). One action runs at a time.

## Global Options

- `--version`, `-v`: Print the installed Helix version and exit `0`.
- `--help`, `-h`: Print command syntax, options, and exit `0`.

For full configuration and troubleshooting details, see [Configuration Reference](CONFIGURATION.md) and [Troubleshooting Guide](TROUBLESHOOTING.md).
