# Helix CLI reference

Binary: `cli/helix.mjs` (executable; run as `./cli/helix.mjs` or
`node cli/helix.mjs`). Requires **Node 22.6+** (runs TypeScript directly via
type stripping). No dependencies beyond the repo checkout.

Exit codes everywhere: `0` success · `1` a check failed · `2` usage error.

## `helix init [dir] [--platform a,b|all] [--force]`

Detect the stack and installed agents, write the harness pack.

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

## `helix doctor [dir]`

Check the installed harness. Exit `1` on any failure, else prints `healthy`.

- Fails when `AGENTS.md` is missing or over budget (60 lines / ~500 tokens),
  when emitted JSON/TOML configs do not parse or match their platform shape,
  when hook scripts referenced by settings are missing or exit non-zero on
  sample input, when `.helix/gate.mjs --dry` fails, or when configs float on
  `@latest` / unpinned refs.
- Also prints the MCP inventory (measured vs estimate tokens per server).

```sh
node cli/helix.mjs doctor ~/your-repo
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
use. Uses the same `generatePack` as `init` and the web configurator: for one
platform the output is deterministic (byte-identical across runs). Missing or
unknown `--platform` exits `2`.

## `helix eval [options]`

Opt-in head-to-head agent evaluations. Costs money and wall time — never runs
in CI. See `evals/README.md`. `--dry-run` plans without launching anything;
`--self-check` validates the grading pipeline with no agent.

## `helix learn <sub> [dir] [flags]`

Opt-in Learning Ledger (evidence-gated, default off). Subcommands: `init`
(never overwrites), `capture`, `accept`, `confirm`, `human-accept`, `list`,
`compile`, `decay`. Lessons can never write hooks, settings, or permissions.
`helix learn` with no subcommand prints the subcommand reference.
