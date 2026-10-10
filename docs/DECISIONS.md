# Helix decision log

Append-only. Date, decision, evidence, alternatives rejected.
Token/method rule: anything shown as a measurement must name the script + date.

## 2026-10-07 — Phase 0 baseline (no code changes yet)

- Branch: `fix/pack-correctness` (from `main@0deebd5`).
- `npm run lint` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` (Node v26.10.0) → 77 pass / 0 fail (24 suites).
- `src/lib/app-data/app-data.test.ts` alone under Node v24.14.1 → 25 pass / 0 fail.
- The cited failing test `app-data.test.ts:189` ("treats a gate 401 in the preview as pending…")
  passes in this environment on Node 26 and Node 24. Node 22 (CI version) is not
  installed locally (`~/.nvm/versions/node` has only v24.14.1), so a Node-22-only
  failure cannot be ruled out yet. Decision: keep the test active, do not skip;
  CI on Node 22 is the arbiter. If CI is green, record as environment-only.
- Default pack (from `DEFAULT_HARNESS_CONFIG`) written to `/tmp/helix-pack-baseline`:
  34 files. `AGENTS.md` = 66 lines, 3653 chars (~913 rough tokens at chars/4).
  Target for 1.7 is <60 lines and <500 tokens — currently over on both.
- Duplicate-skill finding confirmed: `skills/<name>/SKILL.md` and
  `.claude/skills/<name>/SKILL.md` carry identical bodies (8 skills × 2 copies).
- Graphify: 1029 nodes, 144 matching sprite/game/grok-skills; report lists
  "2D Sprite Sheet Generator", "Game & Skill Documentation", etc. Decision: add
  `.graphifyignore` for `.grok/skills/**`, `.vercel/**`, `screenshots/**`,
  `artifacts/**`, `public/__grok/**` per 1.8, then re-run `graphify update .`.
- Alternatives rejected: skipping `npm ci` (will run before GATE 1); skipping the
  failing test as "flaky" without Node 22 evidence.

## 2026-10-07 — 1.8 repo identity

- Renamed package `app-builder-workspace` → `helix`; lockfile re-resolved with
  `npm install --package-lock-only` (also picked up unrelated registry drift in
  `@tailwindcss/oxide` entries — accepted, no dependency added/removed).
- Added `AGENTS.project.md` (Helix contributor rules; root `AGENTS.md` untouched).
- Added `.graphifyignore` (excludes `.grok/skills/**`, `.vercel/**`,
  `screenshots/**`, `artifacts/**`, `public/__grok/**`, plus `node_modules/**`
  and `graphify-out/cache/**`).
- Graphify artifacts decision: ignore `graphify-out/cache/` (612K, regenerable)
  and `graphify-out/graph.html` (888K, regenerable view); keep `graph.json`,
  `GRAPH_REPORT.md`, `manifest.json` tracked as the index + freshness evidence
  (`helix doctor` will compare the report's commit against `git rev-parse HEAD`).
- Pinned `ludeeus/action-shellcheck` to SHA `00b27aa7…2bca` (master HEAD from
  `git ls-remote`, 2026-10-07); added `.github/dependabot.yml` for npm + actions.
- Verified vendor facts (all `verifiedAt: 2026-10-07`):
  - Hooks: command hooks get event JSON on stdin (`tool_name`/`tool_input`);
    exit 0 = allow (stdout JSON parsed), exit 2 = block with stderr feedback;
    PreToolUse decides via `hookSpecificOutput.permissionDecision`
    (allow/deny/ask) or `updatedInput`; PostToolUse cannot block (tool already
    ran); Stop can block to continue the conversation; a Stop hook inside a
    subagent becomes SubagentStop; matcher matches `tool_name`.
    Sources: `https://code.claude.com/docs/en/hooks`,
    `https://docs.claude.com/en/docs/claude-code/hooks`.
  - Subagents: Markdown + YAML frontmatter in `.claude/agents/`; only `name`
    and `description` required; `tools` allow-list (inherits all if omitted),
    `model` (sonnet/opus/haiku/inherit or full ID). `description` is what the
    parent sees — one delegating sentence. Combined descriptions over 15k
    tokens warn at startup.
    Sources: `https://code.claude.com/docs/en/subagents`,
    `https://docs.claude.com/en/docs/claude-code/sub-agents`.
  - CORRECTION to the prompt's premise (§1.2 "subagents cannot spawn
    subagents"): as of Claude Code v2.1.172 nested subagents ARE supported
    ("Spawn nested subagents", depth cap default 3 via
    `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). Older issues (#19077, #60763)
    describe the previous limitation. Decision: still move dispatch into the
    always-on file (one fewer hop, cheaper parent), but record the current
    fact — do not ship "cannot nest" as a claim.
    Source: `https://docs.claude.com/en/docs/claude-code/sub-agents`
    ("Spawn nested subagents").
  - Skills: project skills live at `.claude/skills/<name>/SKILL.md`; body loads
    only when used. Source: `https://code.claude.com/docs/en/skills`.
  - MCP: `.vscode/mcp.json` uses top-level `servers` (+ required `type`:
    `"stdio"` with `command`, or `"http"`/`"sse"` with `url`); portable
    `.mcp.json` (Claude Code project scope, repo root) uses `mcpServers`.
    Sources: `https://code.visualstudio.com/docs/agents/reference/mcp-configuration`,
    `https://code.claude.com/docs/en/mcp-quickstart`.
  - Pinned versions (npm registry, 2026-10-07): `@playwright/mcp@0.0.83`,
    `chrome-devtools-mcp@1.10.1`.
  - Non-Claude platforms (Cursor/Codex/Gemini/Copilot/Windsurf/Cline/Aider/…):
    NOT yet individually verified this turn — 1.6 will emit only verified
    surfaces and mark the rest `unverified` in catalog notes.

## 2026-10-07 — 1.1 real hooks (verified protocol above)

- `src/lib/harness/hooks.ts` is the single source of truth; `generate.ts` embeds
  the sources verbatim. `src/lib/harness/hooks.test.ts` pipes sample JSON to
  stdin and asserts exit codes/output (11 tests).
- `prefer-graph.mjs` (PreToolUse): reads stdin JSON, hints on wide Glob/Grep
  (`**`, `./`) or large/unranged Reads (>400 lines); exit 0 always (advice).
- `format-lint.mjs` (PostToolUse): detects prettier/eslint/biome (package.json +
  config files) plus gofmt/rustfmt/ruff, runs on the edited file only, 20s
  timeout; silent when nothing detected; fail-open with `.helix/hooks/hooks.log`.
- `test-on-stop.mjs` (Stop, no matcher): scans the transcript for Edit/Write,
  detects the test command (package.json scripts / Makefile / justfile, package
  manager from lockfile), exit 2 with a 30-line tail on failure (the documented
  Stop channel), exit 0 otherwise. Timeouts/missing binaries fail open.
- Secret protection stays fail-closed in `permissions.deny`. Settings JSON is
  built with `JSON.stringify`, not string surgery.
- All hooks: zero deps, node: only, <100 lines (enforced by test).

## 2026-10-07 — 1.2/1.3/1.4 orchestrator, routing, skills + 1.7 lean file

- No `conductor` agent file is emitted (main session orchestrates); dispatch
  tiers live in AGENTS.md. Correction recorded above: nested subagents ARE
  supported since v2.1.172, so the rationale is cost (one fewer hop), not
  impossibility.
- Agent frontmatter now carries `tools:` (allow-list) and `model:` (tier from
  the catalog: scout/prover haiku, builder sonnet, architect/auditor opus).
  Scout and auditor tool lists contain no Edit/Write (test-enforced).
  Descriptions use the "Use proactively when…" style (test-enforced).
- Skills emit once per reader: `.claude/skills/` for Claude, `.agents/skills/`
  for Codex; the unconditional root `skills/` copy is gone.
- AGENTS.md rewritten: 43 lines, ~462 rough tokens (chars/4), no skills
  section, no Do/Don't table. A test enforces <60 lines and <500 rough tokens
  on the default pack (chars/4 until the 4.1 tokenizer exists).

## 2026-10-07 — 1.5/1.6 MCP correctness + adapters (verified 2026-10-07)

- MCP catalog entries are structured (`servers` objects); serializers build
  each platform's shape with `JSON.stringify`: portable `mcpServers` (Claude
  .mcp.json, Cursor .cursor/mcp.json), VS Code `servers` with required `type`,
  Codex `.codex/config.toml` with `[mcp_servers.*]`.
- Pins looked up today: `@playwright/mcp@0.0.83`, `chrome-devtools-mcp@1.10.1`,
  serena `@v1.7.0` (latest tag via `git ls-remote`). No `@latest`, no bare git
  ref remains (test-enforced). GitHub keeps read-only toolsets
  (`issues,pull_requests`). Remote endpoint URLs (context7/sentry/linear/github)
  were carried over, not re-fetched — marked `verifiedAt: null` in the catalog.
- `filesForPlatform` is now one adapter per platform behind
  `PlatformAdapter { id, files(config), verifiedAt, sources[] }`
  (`src/lib/harness/adapters/`; a shared factory covers the 10 unverified
  platforms so each still has an explicit entry — recorded choice vs 10
  copy-paste modules).
- Corrected two real bugs against vendor docs: Codex MCP is `config.toml`
  `[mcp_servers.*]`, not `.mcp.json` (https://developers.openai.com/codex/mcp);
  Codex skills live in `.agents/skills`, not `skills/`
  (https://developers.openai.com/codex/skills). Cursor `.cursor/mcp.json` +
  `.mdc` rules confirmed (https://cursor.com/docs/mcp, /docs/rules).
- Unverified platforms (opencode/devin/factory/kiro/amp/kilo/…) emit only the
  instructions file; catalog notes say the crew runs as sequential prompts.
  Default pack: 35 files, every JSON parses, no duplicate paths.
- Alternatives rejected: hand-rolled TOML quoting beyond `JSON.stringify`
  (field values are vendor-controlled, no user input); network validation of
  remote MCP endpoints in tests (pack must build offline).
- Amendment: the sandbox appended a blanket `graphify-out/` ignore; replaced
  with targeted ignores (`cache/`, `graph.html`, dated `20*/` snapshots,
  `.graphify_*` dotfiles) so `graph.json` + `GRAPH_REPORT.md` + `manifest.json`
  stay tracked as the index and freshness evidence.

## 2026-10-07 — 1.9 failing-test verdict

- `src/lib/app-data/app-data.test.ts:189` passes on Node v26.10.0 (full suite:
  197 + 98 green) and on Node v24.14.1 (file suite: 25 green). Node 22 (CI) is
  not installed locally, so CI is the arbiter. No skip added; if CI is green the
  report is closed as environment-only. Cause of the original report unknown —
  possibly a stale worktree or an older revision.

## 2026-10-07 — Phase 2 honest measurement

- 4.1 `src/lib/harness/measure.ts`: `countTokens` = o200k_base BPE via
  `gpt-tokenizer@4.0.0` (new dep; justification: real BPE counts with a named
  method instead of chars/4; UI and code state it approximates frontier
  tokenizers, not the serving model's own). `tokens.ts` constants are gone:
  helix side counts generated output (frontmatter-only for skills/crew),
  naive side counts fixtures + full inline bodies.
- 4.2 fixtures under `fixtures/baseline/`: `bloated-agents-md.ts` (authored
  composite of bloat patterns, provenance in-file) and
  `fifteen-mcp-schemas.ts` (127-tool tools/list composite across 15 servers;
  playwright names are the real captured set, asserted by test; per-tool
  weight calibrated against 4 live captures taken the same day).
  Headline ratio is now 1.97× computed, labeled "fixture baseline" everywhere.
- 4.3 `scripts/measure-mcp.mjs` speaks MCP JSON-RPC over stdio and wrote real
  captures 2026-10-07: graphify 1336t/10 tools, playwright 4413t/25, serena
  8204t/29, chrome-devtools 5914t/30. Findings: catalog estimates were 2–10×
  low. Remote servers stay null with reasons; entries go stale after 60 days
  (`mcpMeasurementFresh`); unmeasured parts are listed in `breakdown.estimates`.
  Raw captures committed under `fixtures/captures/`.
- 4.4 `leanScore` = % of 5 pass/fail checks (AGENTS budget, no duplicates,
  hooks wired, ≤5 MCPs, all MCP schemas measured). Checklist + estimates +
  method render on /stack; score displays show n/m.
- 4.5 every practice has `sources[]` + `confidence`. Corrected against primary
  sources: ETH Zurich/SRI (no success gain, +20% cost — the old "every file
  raised steps" was overstated), Vercel d0 (80→100%, 37% fewer tokens — not
  "halved" — 3.5× faster avg, n=5), Graphify 71.5× (vendor benchmark, 52-file
  corpus, scales with size), Anthropic ~15× (plus "most coding tasks go
  single-agent" — supports the tier design), Claude 15k description warning.
  Dropped unverifiable attributions (HumanLayer/OpenAI collapse, Microsoft-100,
  Google recap, LF donation). 14–22% is `reported` (secondary synthesis), not
  confirmed. Confidence badges + source links render on /playbook.
- 4.6 /run badge is now "Illustrative simulation" with a scripted-not-measured
  note and an /evals pointer; the sample graph is titled "illustrative sample".
- Incidental: disclosure-off now genuinely inlines skill/agent bodies into
  AGENTS.md (the toggle means something again); removed dead catalog estimate
  fields (`alwaysOnTokens`, `bodyTokens`, `schemaTokens` displays now measured
  or labeled estimate; LSP catalog weights remain estimates, flagged).
- Alternatives rejected: vendoring a second tokenizer for Claude/Gemini
  (no stable server-side lib; the approximation label is the honest fix);
  async/lazy tokenizer loading (2.4 MB ranks are noise next to pglite/recharts
  already in the bundle).

## 2026-10-07 — Phase 3 tiered crew

- Roles are now scout → architect → builder → reviewer, picked by tier
  (trivial: main session only; standard: build + fresh reviewer; complex: full
  chain). `pickTier` in `simulation.ts` encodes the rule, with tests.
- Retired: conductor as an emittable role (main session orchestrates) and
  prover as a role (Stop hook + builder test-first rule). `auditor` renamed to
  `reviewer` with strictly read-only tools (Read + graphify only — Bash went
  too, since the input is contract/plan/diff/test-output only).
- Store bumped to version 2 with an exported, tested `migratePersisted`:
  auditor→reviewer, conductor/prover dropped, unknown ids dropped so
  `requireKnownIds` cannot crash on old storage.
- /crew, /run, the simulation, and the index copy follow the tiers; UI and
  typecheck clean. Default pack: 34 files, AGENTS.md 42 lines.
- Justification for names (per prompt): kept scout/architect/builder (already
  in the dispatch text and tests) and chose reviewer over auditor because the
  job is PASS/FAIL verification, not a general audit.

## 2026-10-08 — First real eval + 6.3 iteration (opencode free tier)

- Agent: `opencode/muse-spark-1.3-contributor-free`, clean HOME
  (`~/.cache/helix-eval-home`, auth.json only), 6 tasks × 2 arms × 1 run.
  Report: `evals/results/2026-10-08T18-46-00-opencode.{json,md}` + per-cell
  logs. Cost $0, ~50 min wall. Result: 10/12 pass both arms; ambiguous failed
  both (neither asked); tokens 13–32k/cell; no canary leak anywhere.
- Debugging the path there earned three runner fixes, each from a failure:
  1. headless agents need stdin closed (`stdio: ignore`) — an open pipe hangs
     any agent that asks a follow-up, with zero output;
  2. opencode needs a pty (`script -qec`) — verified 45s hang vs 8s completion
     on the identical command; ANSI stripped before JSONL parsing;
  3. commit the helix pack into the eval copy's baseline, or the helix arm is
     born dirty and `clean`-gated grading can never pass it.
- 6.3 iteration from the ambiguous failure: the v1 task was defective (live
  red tests made "fix the bug" the dominant move — both arms behaved
  sensibly). Fixed the task (Acme variant with genuinely two readings),
  added the earned AGENTS.md line ("Two product readings: ask…", +1 line,
  budget still 43/60), added `requireDiff` grading, and broadened
  `askedProperly` past literal "?" (both v2 answers asked in substance;
  helix quoted the earned line nearly verbatim and read AGENTS.md —
  suggestive at n=1, not proof). Validation rerun
  (`evals/results/2026-10-08T19-21-14-*`): both arms ask properly.
- Caveats committed alongside: n=1 per cell (no variance); trap/none passed
  the 18-46 report by inaction (pre-`requireDiff` grading — kept as measured,
  rule tightened after); free-tier model, not frontier.
- Supersedes the "no viable agent" probe note above: the user pointed at the
  free `opencode/*` models, which worked.

## 2026-10-07 — Phase 4 CLI and evals

- 6.1 choice: single `cli/` dir (not `packages/cli`) — no split needed: the
  harness core (`src/lib/harness/*`) is already UI-free (verified: no
  React/store/browser imports in the chain), so the CLI imports it directly
  and runs on Node 22.6+ type stripping with zero dependencies.
  `helix init` detects stack from files only (never executes the target repo)
  and diff-prompts before overwriting; `doctor` validates configs, hook
  wiring + live sample runs, budgets, pins, and graph freshness with
  non-zero exit; `measure`/`export` are thin over the same tested core
  (`cli/lib.ts`, 12 tests). One-line dep justification: none added for the CLI.
- 6.2 evals: `evals/fixture` (21 files, 9 tests — 7 green, 2 failing by
  design as task targets), 6 task YAMLs (bug/feature/refactor/ambiguous/docs/
  trap) with a tested subset parser, `evals/run.mjs` (codex + claude-code
  adapters, clean-copy isolation, per-task timeouts, canary/ask/diff grading,
  JSON + Markdown reports). Validated via `--dry-run` (36-cell plan) and
  `--self-check` (7 grading assertions, no agent). Trap grading is
  output-canary + file-hash based so it works for any agent adapter.
- 6.3 earn-from-failure loop: armed (failures → one line/skill + DECISIONS
  entry) but unfired — no real runs happened here (see probe note above).
- /evals route renders only committed `evals/results/*.json` via
  `import.meta.glob` (empty state otherwise); /run links to it.
- Doctor ordering: a fresh `helix init` target fails the graph check until the
  user runs graphify (README install flow is init → graphify → doctor green).
  Verified: init + default pack + measured MCP inventory pass; only the
  graph-index step stays red pre-index, which is the check working as designed.
- Alternatives rejected: YAML library dep (subset parser is 60 lines, tested);
  capturing transcripts for the trap (canary-in-output is adapter-agnostic);
  `.codex/config.toml` in the helix eval arm (could shadow runner MCP/auth —
  AGENTS.md + skills only, documented in code).
- Caught by browser smoke: selecting a whole `breakdown()` object in a zustand
  selector re-renders forever (fresh identity every call) — always select
  primitives out of computed stores.

## 2026-10-07 — Eval agent probes (no viable agent in this environment)

- Codex 0.142.5 via the user's ChatGPT plan: default and `gpt-5` models both
  rejected (`'gpt-6-luna'/'gpt-5' not supported with a ChatGPT account`). The
  `OPENAI_API_KEY` in the environment is a placeholder (401 Unauthorized).
  Personal `~/.codex/config.toml` pins those models — not overridden (not my
  config to fight, and quota is not mine to spend).
- Gemini 0.60.0: personal hooks intercept every run (`caveman-proxy` missing,
  "Agent execution blocked") — any run here would measure the user's broken
  env, not the harness. Not used.
- Claude Code 2.1.233 present but no `ANTHROPIC_API_KEY`.
- Consequence: the eval harness ships implemented, dry-runnable, and
  grading-self-checked, but no paid agent run was executed. The committed
  `evals/results/` report is therefore absent — the one Definition-of-Done
  item not met. Exact command to produce it (where credentials exist) is in
  evals/README.md. No quota was spent from this environment.

## 2026-10-09 — Phase 0 correctness (audit-driven, all 10 suspects resolved)

Vendor sources re-fetched 2026-10-09: https://code.claude.com/docs/en/subagents,
/hooks, /permissions. Prior 2026-10-07 hook/MCP claims re-verified against the
same pages (behavior unchanged; PreToolUse additionalContext + Stop exit-2 +
stop_hook_active semantics confirmed).

1. Subagent `tools:` — CONFIRMED. `graphify.query_graph` dot-notation appears
   nowhere in the docs; MCP tools are `mcp__<server>__<tool>` (exact names) or
   `mcp__<server>` / `mcp__<server>__*` (whole server). Scout/Architect/Reviewer
   now use exact names. Rejected: server-level `mcp__graphify` for Scout (too
   broad — Scout needs 4 read tools, not PR triage).
2. `graphify.explain` — CONFIRMED, and worse than suspected: capture has 10
   tools, catalog listed 8 with 1 phantom (explain) and missed get_community,
   god_nodes, graph_stats. Catalog now equals the capture; playwright/serena/
   chrome-devtools subsets also corrected to real names (e.g. `rename` ->
   `rename_symbol`). Guard: `tool-surface.test.ts` fails on any catalog/crew
   tool missing from `fixtures/captures/*.tools.json`.
3. prefer-graph stderr — CONFIRMED. "Stderr from a hook that exits 0 goes to
   the debug log only, never the transcript, and Claude never sees it."
   Advisory hints now travel as `hookSpecificOutput.additionalContext` JSON on
   stdout. Stop-hook exit-2 + stderr was already the documented channel.
4. test-on-stop — CONFIRMED both halves. Honors `stop_hook_active` (blocks at
   most once per turn; pre-existing failures can't loop) and scans only edits
   since the last `user` transcript line instead of the last 4000 lines.
5. `Read(.env)` vs Bash — PARTLY DISPROVED. Recognized Bash file commands
   (cat/head/tail/sed/tee) and redirects ARE covered by Read/Edit denies, and
   Grep/Glob get best-effort coverage; the real gap was NotebookEdit (needs an
   Edit deny — added for .env/.env.*/secrets). Uncoverable by rule syntax:
   subprocess reads (script opening files itself) and `grep -r .` from the
   dir — documented in the pack README, OS sandbox is the only enforcement.
6. Pins — CONFIRMED. graphifyy[mcp] pinned to ==0.9.82 (PyPI, 2026-10-09);
   context7/github/sentry/linear endpoints probed live (HTTP 406/401 to
   unauthenticated initialize — alive, tool lists not enumerated, stamped as
   exactly that). Doctor now flags unpinned `uvx --from` specs.
7. detectStack — CONFIRMED. `helix init` printed the stack and threw it away;
   AGENTS.md now carries exact test/lint/format commands when init detected
   them, generic advice otherwise. File was already 43 lines, now 37–38 (≤40
   guard in generate.test.ts, measured on the full 4-role crew). Trimmed the
   Always-on tagline and merged budget bullets; dropped the standalone
   Reviewer-isolation line (kept in the role's own file where it loads).
8. LSP toggle — CONFIRMED cosmetic: no adapter ever emitted LSP config, and no
   platform reads an LSP pack file (editor-level; Serena MCP already fronts
   language servers and IS emitted). Removed end-to-end: catalog, config
   field, token math, UI tab, CLI defaults. Old persisted configs stay safe
   (sanitizePersisted ignores the dropped key). Rejected: keeping it as
   "advisory" (a toggle that changes nothing is the defect).
9. packaging/CI — CONFIRMED. engines >=22.6 (CLI shebang needs
   --experimental-strip-types), typescript moved to devDependencies,
   actions/checkout + setup-node SHA-pinned (SHAs resolved via git ls-remote
   2026-10-09, Dependabot keeps them fresh). Guard: scripts/repo-hygiene.test.mjs.
10. schemaTokens — CONFIRMED, 1.4–9.5x low (serena 860 vs 8204, devtools 1100
    vs 5914, playwright 1320 vs 4413, graphify 980 vs 1336; measured 2026-10-07
    via scripts/measure-mcp.mjs). Catalog fallbacks now equal the measurements
    (live value still wins when fresh); guard asserts catalog within 2x of any
    fresh measurement. Unmeasured remotes (github/context7/sentry/linear) stay
    flagged estimates.

No new dependencies. No disproved-as-false suspects beyond #5's narrowed scope.

## 2026-10-09 — Phase 1.1 detection-based defaults

- `helix init` now derives MCPs from repo facts via `configForStack`
  (cli/lib.ts): Graphify off and graph-first off under 20 files (its own
  skipIf: the graph costs more than it saves); Playwright off unless a UI is
  detected (UI framework dep, or .tsx/.jsx/.vue/.svelte/.html files).
  Evidence: unit tests in cli/lib.test.mjs plus a manual `helix init` on a
  2-file scratch repo (enabled only context7, graph-first off), 2026-10-09.
- Crew stays whole at init time. Rejected: dropping subagents at init —
  isolation (fresh-window review) and breadth (scout on a large surface) are
  per-task decisions, not repo-time ones; single-agent routing for small tasks
  is already the orchestrator's default tier (see Phase 3 tiered crew).
- The 20-file threshold is the catalog's existing skipIf, not a new
  measurement. No new dependencies.
- Test hygiene: app-data.test.ts "gate 401 in the preview" failed whenever
  NODE_ENV=production (the env-token preview path is deliberately off in
  production), turning the gate red from shells that export it. The test now
  pins NODE_ENV=test. Cause confirmed by running it with NODE_ENV unset (25/25)
  vs production (24/25). Test-only change; product code untouched.

## 2026-10-09 — Phase 1.2 merge tiny skills

- Rule: a skill is kept only if it is shared by 2+ roles or conditionally
  needed outside a role run. Role-exclusive skills cost an index entry every
  session plus an extra load turn, to deliver ~60 tokens. Enforced by a test
  in generate.test.ts.
- Folded into role bodies: decision-table (architect), scoped-diff and
  prove-behavior (builder), clarify-brief (scout), independent-audit
  (reviewer). lean-handoff folded into the AGENTS.md dispatch section (the
  12-line card was already there; added "never paste transcripts"). Kept:
  graph-first (scout + builder), hook-guards (harness configuration).
  Went one step past the four named in the brief because clarify-brief and
  independent-audit met the same criterion (body ≈ 2x its index entry, one user).
- Measured with scripts/measure-skills.mjs (o200k_base, static size, 2026-10-09;
  raw output in fixtures/measurements/skills.{before,after}.json):
  skill index 249 -> 74 tokens always-on; skill bodies 522 -> 169; crew files
  900 -> 1072 (load only when a role runs); AGENTS.md 403 -> 410.
- NOT claimed: a per-task saving. Always-on drops ~168 tokens, but the role
  text that used to sit in optional skill bodies now loads whenever the role
  runs. Net effect on total tokens per task is unmeasured until `helix report`
  (Phase 2) exists.
- Rejected: keeping the skills and just shortening descriptions (still pays a
  load turn per use). Old persisted configs stay safe (sanitizePersisted drops
  unknown skill ids). No new dependencies.

## 2026-10-09 — Phase 1.3 `helix gate`

- One deterministic, agent-agnostic command: secret scan, lint, typecheck,
  affected tests. Source of truth is `src/lib/harness/gate.ts` (`GATE_SOURCE`,
  node: only), shipped as `.helix/gate.mjs` in every pack and run by
  `helix gate [dir]` (the CLI always runs the bundled source, never a
  `gate.mjs` the target repo supplied). `.helix/gate.json` pins the detected
  package manager/test/lint commands so the gate never re-detects.
- Exit codes: 0 = all checks passed or nothing changed; 1 = a check failed;
  2 = usage error. Passing steps print one line; failing steps print a tail
  capped at 25 lines / 2000 chars; secret hits print file:line + pattern name
  and never the value. Flags: `--all`, `--dry`, `--json`.
- Wiring: AGENTS.md tells every agent to run it before finishing (one line,
  40-line budget held); Claude's Stop hook runs it when `.helix/gate.mjs`
  exists (still honoring stop_hook_active and edits-since-last-prompt) and
  falls back to the bare test command otherwise; `helix doctor` runs
  `gate.mjs --dry` and flags an AGENTS.md that demands a missing gate. Git
  hooks/CI call `node .helix/gate.mjs`.
- Affected tests: only where the runner has a documented related-test mode,
  verified 2026-10-09: Jest `--passWithNoTests --findRelatedTests <files>`
  (https://jestjs.io/docs/cli) and Vitest `related <files> --run
--passWithNoTests` (vitest docs/guide/cli.md). Every other runner (node:test,
  pytest, go, cargo, ...) runs the full configured test command: no verified
  related mode, so no guessed flags. Helix's own `npm test` is a full-suite run.
- Evidence: 13 new tests in gate.test.ts (temp git repos: pass/fail/exit codes,
  output cap, secrets, .env vs .env.example, untracked + spaced paths, --dry,
  --json, gate.json pins, jest/vitest flags, pack emission) plus a Stop-hook
  test that the hook surfaces the gate's FAIL output. Dogfood: `helix gate` on
  this repo, 2026-10-09: PASS (lint 7.9s, typecheck 11.5s, test 9.2s, one run,
  not a benchmark).
- NOT claimed: any token saving. The gate removes the model's decision of which
  commands to run and compacts failure output, but total tokens per task stay
  unmeasured until `helix report` (Phase 2).
- Limits: the secret scan is a small regex set (AWS, private key, GitHub, Slack,
  sk- keys, assigned secrets), not a replacement for gitleaks; the Stop hook
  keeps its 55s timeout, so a slow suite is skipped there (logged) and caught by
  CI. Rejected: shelling out to gitleaks/trufflehog (new dependency, absent on
  most machines); a per-platform gate (the point is one portable file).
- No new dependencies.

## 2026-10-09 — Phase 1.4 repo-map provider fallback

- `src/lib/harness/repomap.ts` defines the provider interface (`graphify` |
  `outline`) and `selectRepoMap`: Graphify when it is on PATH and the repo has
  20+ files, otherwise the built-in outline. `helix init` probes PATH, prints
  the fallback and the install command, and never fails for lack of Graphify.
- The fallback is `.helix/map.mjs` (dependency-free, shipped only when
  graph-first is off): files plus top-level symbols for TS/JS, Python, Go, Rust,
  capped at 6000 chars (~1.5k tokens) by default, narrowed by a subdir argument.
  It is a regex outline: no references, no call edges, no cross-file
  resolution. It is not tree-sitter and not an LSP, and the docs say so.
- AGENTS.md on the fallback path no longer mentions graph tools (it did: the
  Commands section listed query_graph unconditionally). Tested.
- `helix doctor` checks graph freshness only when AGENTS.md tells agents to use
  the graph; an outline pack passes without graphify-out/, and a pack pointing at
  a missing map.mjs fails (`map` check).
- Rejected: ctags (not guaranteed installed; flag set not verified against its
  docs), tree-sitter (native/WASM dependency per language), LSP (needs a running
  server per language and platform support is unverified; see the earlier
  decision that LSP toggles were cosmetic). No new dependencies.
- Evidence: repomap.test.ts (provider choice, symbols per language, cap,
  subdir, node_modules skip, option errors, pack wiring) and cli/lib.test.mjs
  (configForStack without graphify, doctor on an outline pack). Not measured:
  how often agents use the map versus broad reads (needs Phase 2 telemetry).

## 2026-10-09 — Phase 1.5 per-platform honesty

- Each adapter now carries a `capabilities` matrix (instructions, mcp, skills,
  subagents, hooks, plugin), each `emitted` | `supported` | `unverified`. Tests
  (platforms.test.ts): no claim without `verifiedAt` and a source; boolean flags
  consistent with the matrix; no skill/agent/hook/MCP file is generated for a
  platform whose capability is not `emitted` (probed over all 15 platforms with
  a full crew); README's matrix is generated (`platformMatrixMarkdown`) and a
  test fails on drift. README's "and the rest of the AGENTS.md family" claim is
  gone.
- Result today: Claude Code emits everything but plugins (plugin = unverified
  until the packaging investigation); Codex emits instructions/MCP/skills,
  subagents documented but not emitted; Cursor and Copilot emit instructions
  and MCP only; 11 platforms are unverified, so their pack is AGENTS.md plus at
  most a pointer file. No new capability was promoted: the 2026-10-07 vendor
  checks still stand and nothing newer was re-verified for them in this pass.
  Not re-verifying them is a known gap, not an assertion that they are current.
- Finding (secondary sources only): Gemini CLI was reported shut down for free,
  Pro and Ultra users on 2026-06-18, replaced by the closed-source Antigravity
  CLI (`agy`); sources: 9to5google 2026-06-17 quoting Google's announcement,
  The Register via dealroom (May 2026), The New Stack. Enterprise users keep
  Gemini CLI. I could not fetch Google's primary migration page, so the Gemini
  and Antigravity adapters stay `unverified` and their notes say so. `gemini`
  remains in DEFAULT_PLATFORMS (changing defaults is a user-visible decision;
  flagged for the owner). Antigravity's config paths seen in third-party docs
  (~/.gemini/antigravity/mcp_config.json) are NOT used.
- Rejected: marking unverified platforms "unsupported" (also a claim we cannot
  back); emitting Codex subagent files from the cross-tool `.agents/` layouts
  seen in third-party repos (not vendor docs).

## 2026-10-09 — Phase 1.6/1.7 token measurement honesty and cache layout

- MCP cost is now reported per platform (`helix measure`, `mcp-cost.ts`): the
  static schema total is measured (tools/list captures, o200k_base approximation);
  whether a client loads it on every request is a platform fact. Verified
  2026-10-09 against https://code.claude.com/docs/en/agent-sdk/tool-search.md:
  Claude Code defers MCP tool definitions by default (ENABLE_TOOL_SEARCH unset =
  on, `auto` defers only above 10% of the window, `false` loads everything), costs
  one search round-trip the first time a tool is discovered, and Haiku models do
  not support it. Every other platform is labeled "unverified: assume loaded".
  Consequence: the "always-on" MCP number in the UI/report is the worst case
  (full schemas); on Claude Code with deferral the prefix cost is lower but a
  retrieval turn is added. A third-party measurement (dev.to, one install,
  88 tools: 20.8k deferred vs 61.0k loaded first-request input tokens) is
  consistent with this but is NOT used as a number anywhere.
- Per-task totals are NOT measured by `measure`; the report says so and points to
  `helix report` (Phase 2). Static reductions can raise real totals (skill loads,
  graph queries and tool searches add turns), so no per-task saving is claimed
  by any phase 1 change.
- Cache layout (cache-layout.test.ts): generated output is byte-identical across
  runs (checked across a 1.1s gap) with a stable file order; always-on files
  (AGENTS.md, pointers, agent and skill frontmatter files, Copilot/Cursor rules)
  contain no timestamps, absolute paths or UUIDs. Caching lowers cost, not token
  counts, and is reported nowhere as a token reduction. Known imperfection: the
  detected "Repo facts" sit mid-file in AGENTS.md, so editing a test command
  invalidates the cache from that line on; moving them last would reorder the
  file for little gain and was not done.

## 2026-10-09 — Smoke-test fixes and repo-driven platform selection

[Token percentages in this paragraph are INVALID: see the Phase B entry below; pass rates stand.] Evidence that the pack was not yet doing its job (script: `evals/run.mjs`;
results: `evals/results/2026-10-08T18-46-00-opencode.md`; opencode free tier,
n=1 per cell, 20-file fixture): the helix arm used more tokens than the
no-harness arm in 5 of 6 cells (ambiguous +22%, feature +14%, trap +11%,
docs +6%, refactor +1%; bug-fix -9%) with equal pass rates, and `ambiguous`
flipped between two runs of the same arm. On a 20-file repo there is nothing
for retrieval to save, so this fixture cannot show a benefit; it does show a
cost. No saving is claimed. A larger fixture with n>=5 is the open Phase 4 item.

Running the CLI end to end (the unit suite never did) found three defects, each
now covered by `cli/cli.test.mjs`:

- `init --help` ran init (the help flag fell through to `evalArgs`).
- Re-running `init` prompted `overwrite? [y/N]`; with stdin closed the promise
  never settled (exit 13) and interactively it hung. Now: no prompt without a
  TTY, differing files are kept, `--force` overwrites.
- The pack wrote a top-level `README.md`, clobbering the user's. Moved to
  `.helix/README.md`.

Platform selection: the fixed five-platform default wrote seven agent
directories into a 2-file repo. Now `init` emits for agents whose config is
already in the repo (CLAUDE.md/.claude/, .cursor/, .codex/, GEMINI.md/.gemini/,
copilot instructions, opencode.json, windsurf, cline, aider), else for agent
CLIs found on PATH, else the universal pack only (AGENTS.md + .helix/gate +
.helix/map). `--platform a,b` overrides; `--platform all` restores the old
five. AGENTS.md alone is not a marker (it is the cross-agent standard). Native
directories are kept for each agent, since each reads only its own. Rejected:
always emitting all platforms (cost and noise for agents the user does not
run); detecting only from PATH (machine-dependent, wrong for team repos).
Roles: model subagents exist for context, plan, build and verify; testing is
the deterministic `helix gate` (zero tokens), not a model role. Unverified:
whether the role split lowers total tokens on large repos.

## 2026-10-09 — Phase A: measure and doctor agree on estimates

Reproduced on a scratch repo (`helix init --yes`, then `doctor` and `measure`):
`doctor` printed "healthy" and labeled context7 "(estimate)", while `measure`
printed `FAIL unmeasured MCP schemas: context7` and a lean score of 80.
context7 is a remote server that `scripts/measure-mcp.mjs` cannot launch
(streamable-HTTP is out of scope there), so it cannot be measured by that
script today. The `mcp-measured` check was removed from the lean checks: an
unmeasured schema is reported as a labeled estimate (the `estimate:` line in
`measure`, `(estimate)` in `doctor`), not a failure. Lean score is now 4 checks.
Rejected: keeping the check and making `doctor` fail on it (fails every default
pack for a disclosed estimate); hardcoding a measured context7 number (never
measured, so it would be invented). Test: `tokens.test.ts`.

## 2026-10-09 — Untrack graphify-out/

`graphify-out/` (graph.json 1.2 MB, GRAPH_REPORT.md, manifest.json; 1.3 MB
total) was tracked and rewritten by every `graphify update .`, roughly 6000
lines of churn per refresh and 2 commits touching it in the last 14 days. It is
generated from the source, so it is now ignored (files stay on disk; run
`graphify update .` to regenerate). Rejected: keeping it tracked so a fresh
clone has a graph (the graph is rebuilt in seconds and a stale committed graph
misleads agents more than a missing one). Approved by the user 2026-10-09.

## 2026-10-09 — Phase A: measure and doctor read the installed pack

Reproduced on scratch repos (`helix init --yes --platform <id>` then `helix
measure`): every pack reported always-on 6.9k tokens (mcp 6.2k, 3 servers),
including an opencode pack that wrote no MCP config and a claude-code pack whose
`.mcp.json` holds only context7. Cause: `reconstructConfig` (cli/lib.ts) took
skills and MCP servers from the catalog defaults and crew from defaults when none
were found, so `measure` and `doctor` described the catalog, not the files on
disk. Fix: crew, skills and MCP servers are now read from the installed files
(`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` by key, `.codex/config.toml`
`[mcp_servers.*]` tables, `.agents|.claude/skills/<id>/SKILL.md`,
`.claude/agents/<id>.md`); unknown keys are ignored and an empty set is a valid
answer. Tests: three new cases in `cli/lib.test.mjs` (failed first).

Always-on tokens per pack, 2026-10-09, script `helix measure` (o200k_base BPE,
approximation of frontier tokenizers; MCP figure is the catalog estimate for
context7, not measured), scratch repo with 2 files, before the fix (all packs
6.9k) vs after:

| pack                 | always-on | AGENTS.md | skills | mcp | crew |
| -------------------- | --------- | --------- | ------ | --- | ---- |
| opencode (universal) | 327       | 327       | 0      | 0   | 0    |
| gemini               | 327       | 327       | 0      | 0   | 0    |
| cursor, copilot      | 747       | 327       | 0      | 420 | 0    |
| codex                | 821       | 327       | 74     | 420 | 0    |
| claude-code          | 1.2k      | 446       | 74     | 420 | 216  |

Caveats: measure counts only files the pack wrote. Platform-owned files that
Helix does not write (for example Gemini settings) are not counted, so the gemini
row is a lower bound. Always-on size is not per-task cost; per-task totals need
`helix report` (Phase B).

What this does and does not show: the earlier 6.9k figure was a measurement
error, not the real size of the packs, so it is not the explanation for the
eval result (evals/results/2026-10-08T18-46-00-opencode.md). Which files the
eval's helix arm actually wrote is not recorded there; that is unverified. No
saving is claimed.

Lean default for small repos (open question, behavior unchanged): the universal
pack is already small (327 tokens); subagents and the longer AGENTS.md only
appear with the claude-code pack (+119 AGENTS.md, +216 crew). Whether to drop
them under a size threshold must come from the Phase D eval, not intuition.
Rejected: picking a file-count threshold now (no measurement supports any value).

## 2026-10-09 — Phase B: helix report, and the eval token bug it exposed

`helix report [dir] [--claude <path>] [--opencode <db>] [--limit n] [--json]`
(cli/report.ts, cli/report.test.mjs) parses Claude Code session JSONL and the
OpenCode SQLite database (node:sqlite, no new dependency; skipped with a message
when unavailable) and reports tokens, subagent tokens, repeated reads, oversized
tool outputs (over 20k characters), retries (a call identical to an earlier call
that errored) and wasted turns (turns whose every tool call errored). Transcript
formats are observed locally, not vendor-documented; parsing ignores unknown
records. Message contents are never read into the report. Tests use synthetic
transcripts only, including one that fails if usage is summed per record
(Claude Code writes one record per content block; blocks of one API message share
message.id and usage). Cost is shown only where the agent reports it (OpenCode);
Claude Code cost is "not reported" because the repo has no price table and none
is invented.

Validated on 8 real OpenCode sessions, 2026-10-09 (numbers only, no content):
message-level token sums equal step-finish sums exactly in all 8, so using one
source is right and using both would double count.

Defect found: `parseAgentOutput` in evals/run.mjs set opencode `tokens` to the
last step-finish event, overwriting at each event. On the 8 sampled sessions the
last step was 0.1% to 8% of the run total, and on one re-measured eval run the
agent-reported figure was 23,113 against a transcript total of 322,622 (7%). So
the "+22% / +14% / +11% / +6% / +1% / -9%" token comparison recorded in the
2026-10-09 smoke-test entry above and in
evals/results/2026-10-08T18-46-00-opencode.md compared final-step context size,
not total tokens, and must not be cited. Pass rates and the observation that one
cell flipped between two runs of the same arm are unaffected. Consequence: the
claim "the helix arm used more tokens" is UNVERIFIED, not disproved; Phase D
re-measures it properly.

Fix: evals/run.mjs now reads tokens from the agent's transcript with the same
parsers (`transcriptTokens`), keeps the agent-reported value as
`agentReportedTokens` for audit only, and the report table adds avg uncached
(excludes cache reads, which dominate long sessions), sd, per-run raw values and
pass rate per 1k uncached tokens. Codex has no verified transcript parser, so its
tokens are n/a rather than guessed. Checked end to end with one free-tier opencode
cell (bug-fix, none arm, pass): transcript total 322,622, uncached 27,724.
Rejected: summing step-finish events (equals the message sum, but a second source
invites double counting); using agent-reported totals for Claude Code (excludes
cache tokens).

## 2026-10-09 — Phase C.3 Claude Code plugin packaging (investigation only)

- Source (vendor docs, fetched 2026-10-09, verifiedAt 2026-10-09):
  code.claude.com/docs/en/plugins-reference and /plugin-marketplaces.
- Verified: a plugin is a directory with optional `.claude-plugin/plugin.json`
  (only `name` required, kebab-case). Components: `skills/`, `agents/`,
  `commands/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `bin/` (put on the
  Bash tool PATH while enabled), `settings.json` (only `agent` and
  `subagentStatusLine` take effect). Components are namespaced
  (`helix:reviewer`). `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` resolve
  in hook commands and MCP configs. Setting `version` pins users until it
  changes. A marketplace is a git repo with `.claude-plugin/marketplace.json`;
  plugin sources can be a relative path, `github`, `git-subdir`, `url`,
  `archive`, `npm` or `command`. `claude plugin validate` checks manifests.
  Plugin names starting with `claude-` or `anthropic-` are reserved (`helix`
  is fine).
- Verified limitation that shapes the design: a `CLAUDE.md` at the plugin root
  is NOT loaded as context. A plugin therefore cannot ship the always-on
  AGENTS.md block. Repo facts (gate command, layout, three rules) must still
  live in the repo's own instructions file; the plugin can carry the
  versioned, repo-independent parts: skills, subagents, hooks, MCP config and a
  `helix` binary in `bin/`.
- Consequence: packaging is a partial win only. It removes copied
  skills/agents/hooks (versioned updates, one place to fix a hook bug) but
  `helix init` still writes the small repo-specific instructions file.
- NOT verified (not read): namespacing effect on subagent names used in our
  AGENTS.md text (we reference `scout`, a plugin would expose `helix:scout`),
  and behavior of hooks from plugins versus `.claude/settings.json` ordering.
  Both must be tested against a real `claude` install before shipping.
- Decision: do not implement yet. Next step is a failing test for
  `helix plugin` that emits `plugin.json`, `skills/`, `agents/`,
  `hooks/hooks.json`, `.mcp.json` and a marketplace entry from the existing
  generator, plus `claude plugin validate` run in a scratch dir if `claude` is
  on PATH. Equivalents for other platforms stay `unverified`; the capability
  matrix keeps `plugin: unverified` for all but Claude Code.
- Rejected: shipping AGENTS.md via the plugin (not loaded); npm-only
  distribution (adds a publish step and no benefit over a git marketplace).

## 2026-10-09 — Phase D.1 deterministic large fixture generator

- `evals/fixture-large/generate.mjs` builds a repo from templates and a seeded
  PRNG (mulberry32), no LLM text. Defaults (seed 1): 16 modules, 356 files
  (measured by the script, sha256 printed by the CLI), 81 tests that run in
  about 3 s. Each module has 10 rule files, a service that calls up to two
  earlier modules (a DAG), a store, validate/format helpers, a doc table of its
  rule constants, and 3 test files. Expected values in the tests come from a
  reference model in the generator, so the pristine repo is green by
  construction.
- `plantRuleBug` changes one constant in one rule file. Failures then show up
  in that module's service test and every dependent module's, never in
  earlier modules, so finding the root cause needs navigation (follow the
  dependency chain, then diff the rule file against `docs/<module>.md`).
- Test caught a harness trap: a child process spawned inside `node --test`
  inherits `NODE_TEST_CONTEXT` and exits 0 without running anything. The test
  now strips it and asserts the test count, so a vacuous pass cannot hide.
- Not done yet (next): fixture selection and per-task setup in `evals/run.mjs`,
  the navigation tasks, and the held-out task set. Nothing here is an eval
  result; no savings are claimed.
- Rejected: committing the generated 356 files (churn, and the hash makes
  drift visible); LLM-written filler (violates the no-fabricated-content rule).

## 2026-10-09 — Phase C: Codex + Antigravity adapters emit real files

- Codex (verified 2026-10-09): custom agents are `.codex/agents/<id>.toml`
  with required `name`, `description`, `developer_instructions`
  (https://learn.chatgpt.com/docs/agent-configuration/subagents); model
  omitted so the agent inherits the parent's (vendor model slugs change too
  often to pin); read-only roles get `sandbox_mode = "read-only"`. Hooks are
  `.codex/hooks.json` with a Stop hook resolving from the git root
  (https://learn.chatgpt.com/docs/hooks); project hooks run only after review
  in /hooks. Only the Stop hook is emitted: Codex has no Read/Grep/Glob
  tools and passes edits as apply_patch, so prefer-graph/format-lint have no
  matcher to attach to. AGENTS.md discovery verified (https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- Antigravity (verified 2026-10-09): skills `.agents/skills/<skill>/SKILL.md`
  (/docs/skills), MCP `.agents/mcp_config.json` with `serverUrl` for remote
  (/docs/mcp — `url`/`httpUrl` unsupported), subagents
  `.agents/agents/<id>.md` with required name+description, tools from the
  documented set, `subagent: true`, `mainAgent: false`, model
  inherit|flash|pro (/docs/subagents), rules AGENTS.md/GEMINI.md read natively
  with no frontmatter (/docs/rules — so no GEMINI.md pointer is emitted).
  Hooks verified (/docs/hooks: `.agents/hooks.json`, Stop returns
  `{decision: continue}`) but NOT emitted: unlike Claude/Codex there is no
  documented loop guard, so a failing Stop gate could loop.
- Evidence: `src/lib/harness/codex-antigravity.test.ts` (13 tests: TOML
  fields, sandboxing, Stop hook behavior in temp git repos, Antigravity
  frontmatter/tools, shared `.agents/skills` dedupe); CLI smoke 2026-10-09
  (`helix init --platform codex,antigravity` on a scratch repo: 19 files,
  shared skills written once). `npm run lint`, `typecheck`, `npm test`
  (146 + 252) green. README matrix regenerated from the catalog.
- Rejected: pinning Codex vendor model slugs (they change; inherit instead);
  emitting Antigravity hooks without a loop guard (could loop); emitting
  GEMINI.md for Antigravity (AGENTS.md is read natively).

## 2026-10-09 — Phase D.2 large-fixture tasks + runner (tuning set + held-out set)

- `evals/tasks-large/`: trace-bug (shipment r4; customer/warehouse/pricing red,
  ledger/invoice/catalog green), call-chain (invoice r7), cross-module (tax r2).
  `evals/tasks-heldout/`: heldout-bug (pricing r5, seed 1), heldout-trace
  (warehouse r3, seed 7). Every task carries `fixture: large` plus
  `setup: {seed, module, rule}`; held-out files carry `heldout: true` and the
  runner excludes them unless `--include-heldout` is passed.
- `evals/run.mjs`: `--fixture small|large|all` (default small, current behavior
  unchanged), `--include-heldout` (default off). `freshCopy(task)` generates the
  356-file repo from the seeded PRNG and plants the task's bug instead of copying
  the 20-file fixture. Verified per task (2026-10-09): pristine green, planted
  red on the task's own pass command (script: `evals/large-tasks.test.mjs`,
  which also enforces held-out ID separation).
- Pilot (opencode free tier, `trace-bug`, none arm, n=2 across two runs):
  2/2 pass, wall 99s/135s, transcript total 238k/302k, uncached 21k/31k
  (results: `evals/results/2026-10-09T11-1*-opencode.{json,md}`). Pipeline
  validated end to end; full n>=5 paired eval still to run.
- Rejected: committing generated repos (hash makes drift visible); putting
  held-out tasks in the default set (they would stop being held out).

## 2026-10-09 — Phase D hygiene audit (proposal only, no changes)

- `.graphifyignore` already keeps `.grok/skills/**` out of the graph, but the
  repo-root `AGENTS.md` is still the Grok sandbox contract: any coding agent in
  this repo loads ~100 lines of game/sprite/preview instructions that are
  irrelevant to Helix and compete with `AGENTS.project.md`. The root file is
  platform-owned (do not touch), so the fix cannot be deletion. Proposed:
  a two-line header pointer is also a code change to a platform-owned file —
  ask the owner before any edit; until then contributors must point their agent
  at `AGENTS.project.md` explicitly.
- Template-dep prune (better-auth, @electric-sql/pglite, ~20 @radix-ui/*) and
  the core/cli/evals/site split are proposed but NOT executed: both need owner
  approval and a green site build afterwards (`npm run build`). No new
  dependency added by any Phase C/D work in this session.
- Full Phase D eval (3 large tasks x none/helix x 5 runs, opencode free tier)
  launched 2026-10-09 ~11:21 UTC as background pid; results land in
  `evals/results/`. Pilot cells (trace-bug none, 2/2 pass) are committed as
  measured pilot data, not as the eval result.

## 2026-10-09 — Phase D.3 large-fixture result (paired, n=5, opencode free tier)

- Script `evals/run.mjs` (`--fixture large`), tokens from transcripts
  (`cli/report.ts` parsers), method+date in
  `evals/results/2026-10-09T11-24-31-opencode.{json,md}`. 30/30 cells pass
  (both arms 15/15 — ceiling, no discrimination on pass rate). Subagent tokens
  are 0 in all 30 runs: the opencode agent never spawned model subagents in
  either arm, so the with/without-subagents comparison is vacuous here.
- Uncached tokens (primary metric), mean ± sd over 5 runs:
  call-chain none 28,293±3,007 vs helix 23,410±7,032 (-17%, t≈1.4);
  cross-module none 22,170±10,179 vs helix 17,595±7,646 (-21%, t≈0.8, one none
  outlier at 38,867); trace-bug none 28,034±1,357 vs helix 31,128±5,933 (+11%,
  t≈1.1). No cell is significant at n=5. Overall uncached mean -8.1% for helix;
  total tokens (incl. cache reads) +2.0% for helix (trace-bug total +35%:
  the helix arm re-reads more). Pass rate per 1k uncached favors helix 2 of 3
  cells (0.043 vs 0.035; 0.057 vs 0.045; 0.032 vs 0.036).
- Verdict under the decision rule: pass tied at ceiling with a small uncached
  token cut overall, so no redesign is triggered — but this is NOT a
  demonstrated win. The tasks are too easy to separate the arms (30/30 pass),
  variance overlaps everywhere, and total tokens are flat. Stated plainly: the
  pack still does not beat the no-harness baseline convincingly.
- Consequences, all recorded as open: (1) the small-repo lean threshold
  (Phase A.2) cannot be derived from this data; behavior stays unchanged.
  (2) No tuning was done (no failures to tune on) and the held-out set was
  never run — it stays unspent. (3) Harder tasks (redder failures, tighter
  pass criteria) or larger n are needed before any saving may be claimed.

## 2026-10-09 — Phase E: Learning Ledger core behind a flag (gate: stays opt-in)

- Implemented the deterministic, zero-model-token core only:
  `src/lib/harness/learn.ts` (pure, no node: imports) — entry schema (id,
  type, text <= 280 chars / 2 lines, anchor glob + optional node/hash,
  evidence pointers, used/helped/hurt, confirmations, timestamps, status
  candidate|active|demoted, origin repo+trusted); deterministic ids so
  independent confirmations dedupe; capture of session-end facts into
  observations (never lessons); human accept into quarantine; promotion after
  2 distinct helping sessions or human accept via diff review; decay on
  symbol-hash change, reverted commit, or 20 unused sessions; untrusted
  origins treated as data (skipped without --trust-untrusted, sizes capped,
  control chars stripped, hook/settings/permission-writing lessons refused);
  compile to the cheapest form (<=3 lines toward AGENTS.md, repo-wide
  procedure/decision as gate-rule candidates in prose, path-scoped rules)
  under a hard 300-token cap with an omitted count; graph-conditioned
  retrieval (glob + node match, most-helped first, capped).
- `helix learn` CLI (`cli/learn.ts`): init (never overwrites), capture,
  accept, confirm, human-accept, list, compile (writes COMPILED.md, warns on
  every skip/refusal), decay. Pack wiring is one conditional line in AGENTS.md
  behind `learnOptIn` (optional flag, default off; default pack byte-identical,
  flag-on pack 39 lines). Lessons can never write hooks/settings/permissions
  (refused by regex + compile output is prose, never code).
- Explicitly NOT implemented: model-based offline reflection (deferred;
  "save nothing" is the outcome until a human accepts), N-confirmation
  auto-promotion beyond helped>=2, and the replay-eval gate run.
- Gate result (negative, as the spec allows): the decision gate needs a replay
  eval over chronological per-repo task streams with ledger content, which does
  not exist yet — no ledger has ever been populated from a real session, and
  Phase D gives no per-task saving to project forward. So the ledger stays
  opt-in (default off) and no enabling claim is made. Rejected: enabling by
  default on theory; auto-applying untrusted-repo content; letting lessons
  touch hooks/settings/permissions.
- Evidence: `src/lib/harness/learn.test.ts` (11 tests, synthetic entries only,
  including one red-then-green on the compile cap) plus CLI end-to-end on
  scratch dirs (init→capture→accept→2 confirms→active→compile 10 tokens→decay
  demotes). `npm run lint`, typecheck, `npm test` (255 + 157) green.

## 2026-10-09 — Native Cursor and OpenCode adapters

- Added native Cursor custom-agent files under `.cursor/agents/*.md`, lazy
  skills under `.cursor/skills/<name>/SKILL.md`, and refreshed the capability
  matrix from vendor docs. Cursor subagent models inherit the selected parent
  model; pinning model IDs would age badly and can be unavailable by plan.
- Added an OpenCode adapter for `.opencode/agents/*.md`,
  `.opencode/skills/<name>/SKILL.md`, and the native `opencode.json` `mcp`
  schema. The CLI merges Helix MCP entries into an existing OpenCode JSON file,
  preserves unrelated settings, and keeps same-name existing MCP definitions.
  A pack downloaded outside the CLI still contains a fragment that needs merging.
- Official sources checked 2026-10-09:
  - https://cursor.com/docs/subagents
  - https://cursor.com/help/customization/skills
  - https://cursor.com/docs/mcp
  - https://opencode.ai/docs/agents/
  - https://opencode.ai/docs/skills/
  - https://opencode.ai/docs/mcp-servers/
  - https://opencode.ai/docs/rules/
- Added adapter tests for emitted paths, read-only role metadata, and OpenCode
  local/remote MCP serialization. Tests have not been executed locally through
  the connected GitHub file workflow; CI must be the final arbiter.
- Evaluation caveat: the committed five-run large-fixture report shows Helix
  reducing tokens on call-chain and cross-module tasks, but increasing tokens
  on trace-bug despite equal pass counts (5/5 per arm). Do not present token
  savings as a universal guarantee; repeat across agents and task families.
- Alternatives rejected: making all non-trivial work multi-agent (higher cost
  without proven benefit); adding vendor model IDs for Cursor (less portable);
  replacing an existing full OpenCode config with a generated partial config.

## 2026-10-09 — Production-readiness: CLI errors, executable bit, E2E tests, compact docs

- `cli/helix.mjs` was mode 644, so the documented `./cli/helix.mjs init`
  failed with permission denied. Set the executable bit (tracked by git).
- Unknown `--platform` ids in `init`/`export` threw a raw stack trace (exit 1).
  Now: `helix: unknown platform "x"` + known-platform list on stderr, exit 2.
  Evidence: `cli/e2e-workflows.test.mjs` ("unknown platforms fail clean").
- Added `cli/e2e-workflows.test.mjs` (10 tests): install, safe repeat,
  doctor pass/fail/oversize, export determinism + init/export byte-parity on
  platform files for a full-default repo, gate pass/fail-on-secret/flag
  errors, measure, missing-flag usage. Gate tests use a system PATH (the
  hermetic node-only PATH hides npm/sh); detection tests keep it.
- Parity note found during testing: `init` narrows the config by detected
  repo facts (outline map, no Playwright without UI), while `export` uses full
  defaults — both through the same `generatePack`, so same config ⇒ identical
  bytes (asserted). AGENTS.md alone embeds detected stack commands by design.
- Docs: new `docs/CLI.md` (every command verified against the implementation),
  `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`; README trimmed 144 → 116 lines
  with the generated matrix markers untouched.
- Alternatives rejected: rewriting the CLI arg parser (targeted validation
  covers the user-controlled ids); byte-parity on AGENTS.md between init and
  export (would erase the detected stack facts agents rely on).

## 2026-10-09 — /evals added to the main nav

- Browser QA found `/evals` reachable only via a link buried in `/run`,
  while the README advertises it as a route. Added it to `Shell` NAV with a
  FlaskConical icon; re-ran the Chromium nav check (`/evals` present, zero
  console errors) plus a 390px overflow pass on `/`, `/export`, `/stack`.
- Alternatives rejected: leaving it linked only from `/run` (advertised
  routes must all be navigable).

## 2026-10-10 — Canonical capability model, workflow engine, gate + writer hardening

- Capabilities grow 6 → 10 (`structured-output`, `session-continuation`,
  `sandboxing`, `lsp`). All four start `unverified` on every adapter: no
  vendor page was re-checked this turn, so nothing is emitted or claimed for
  them. README matrix regenerated from `platformMatrixMarkdown` (`npm test`
  fails on drift). Next step is per-platform verification with `source` +
  `verifiedAt` before any of the four promotes past `unverified`.
- New `src/lib/harness/workflow.ts`: `selectWorkflow` (trivial/standard/
  complex + ambiguous→blocked + securitySensitive forces reviewer),
  `canTransition` over classified/discovered/planned/implemented/verifying/
  completed/blocked with legitimate skips, and `validateHandoff` (12-line
  cited card). The main session is the manager; roles are logical, not
  mandatory model calls. Tests: `workflow.test.ts` (10 tests).
- Gate `--json` steps now include `command` (null when skipped) alongside
  `status`/`code`/`ms`/`tail`; docs state the enforcement boundary (hook/CI
  wiring) and the trust boundary (gate runs repo-configured commands).
- CLI writer validates every pack path (`assertSafePackPath`: relative only,
  no `..`, no absolute) and skips unsafe entries; covered in `cli/lib.test.mjs`.
- No new dependencies. `npm run lint`, `typecheck`, `npm test` (168 pass) green.

## 2026-10-10 — Workflow policy single source of truth + lockfile sync

- `src/lib/harness/workflow.ts` is now the single source of truth for
  workflow policy: `TIER_POLICY` (tier table), `SECURITY_POLICY`
  (security-sensitive scope, min tier `standard`, reviewer + full chain),
  `HANDOFF_MAX_LINES` (12). `selectWorkflow` (executable decision),
  `simulation.pickTier` (demo, via shared `classifyTier`), and the Dispatch
  rules in generated AGENTS.md (via `dispatchRules`) all derive from it;
  tests assert the three agree so they cannot drift.
- Security invariant enforced at runtime: a security-sensitive change is
  raised to at least `standard` with reviewer + full chain whatever its file
  count; malformed facts and ambiguous asks block fail-closed; only a literal
  `isQuestion: true` is informational (a security question answers only and
  must reclassify before editing). `independentReview` is a requirement on
  the host agent, stated as such — prompt text cannot prove a separate
  reviewer ran; only `helix gate` is mechanical evidence.
- Handoff counting fixed against its blind spot: the limit applies to the
  serialized card (`serializeHandoff` is the single counting source,
  newline-normalized incl. CRLF/CR/Unicode separators), not to the input
  fields — short fields plus many files no longer pass.
- `package-lock.json`: synced `eslint-plugin-react-hooks` 7.1.1 → 5.2.0 to
  match the declared `^5.2.0` range in `package.json` (the committed lock had
  drifted outside the range; `npm ls` confirms 5.2.0). No dependency
  added/removed by intent.
- Evidence: `npm run lint` 0, `typecheck` 0, `npm test` 193 pass / 0 fail,
  `helix gate` PASS (secrets, lint, typecheck, test) on the changed tree.

## 2026-10-10 — F0: test hermeticity audit

- Reproduced on this machine (Node v24.14.1 via nvm, `NODE_ENV=production` exported
  by the shell). Run with PATH `<nvm bin>:/usr/bin:/bin` (no yarn/pnpm/bun) and
  `NODE_ENV` unset: `cli/cli.test.mjs` "no agent config in the repo: universal pack
  only" FAILED. Cause: the CLI tests used `dirname(process.execPath)` as a
  "hermetic" PATH, but nvm keeps global npm installs next to node
  (`~/.nvm/versions/node/v24.14.1/bin/codex`), so `helix init` detected Codex.
  Same defect in `cli/e2e-workflows.test.mjs` and `codex-antigravity.test.ts`.
- Fix: `cli/test-env.mjs#nodeOnlyBin()` (temp dir holding only a `node` symlink),
  guarded by `cli/test-env.test.mjs` (written first; failed on missing module).
  The TS test inlines the same helper (no .mjs import into typechecked code).
- Second finding: `src/lib/harness/codex-antigravity.test.ts` (14 tests) was not in
  the `npm test` file list, so it never ran. `scripts/test-coverage.test.mjs`
  (written first, failed naming that file) now asserts every `src/**/*.test.ts` is
  listed; the file was added to `package.json`.
- `hooks.test.ts` spawned `node` from PATH instead of `process.execPath`
  (Node-version dependence); now uses `process.execPath`. No failing test written:
  the effect only shows on hosts with several Node versions on PATH.
- F0's own `gate.test.ts` diff (`yarn.lock` -> `deps.lock`) verified as described.
- Not found: tests that read `NODE_ENV`, depend on cwd, or use the network
  (grep of all test files for `process.env|NODE_ENV|cwd|fetch(|http`). `deps.lock`
  fix verified only by reasoning plus runs on a PATH without yarn.
- Residual (not changed): `GATE_PATH` in the e2e test still appends `/usr/bin:/bin:
/usr/local/bin`, so gate-picking tests depend on those dirs having no yarn/pnpm.
- Evidence (Node 24.14.1; CI is Node 22, NOT run here): `npm run lint` 0 errors /
  12 warnings, `typecheck` 0, `npm test` 306 + 207 pass, 0 fail, under (a) PATH
  without yarn/pnpm/bun + NODE_ENV unset, (b) same PATH + NODE_ENV=production,
  (c) full PATH + NODE_ENV=production.

## 2026-10-10 — F4: lean generated pack

- Measured with `helix measure` (o200k_base via gpt-tokenizer, 2026-10-10) on a scratch
  repo (`helix init --platform claude-code,codex`, package.json with only `test`):
  AGENTS.md 472 -> 341 tokens (38 -> 29 lines); crew frontmatter 216 -> 172;
  always-on 1.18k -> 1.01k (agents.md + skills 74 + mcp 420 estimate + crew). Counts are
  deterministic (single run, no variance). MCP figure is the catalog estimate, unchanged.
- Crew table removed from AGENTS.md when every selected platform writes agent files
  (claude-code, codex, opencode, cursor, antigravity): they load each description
  themselves (Claude Code: https://code.claude.com/docs/en/sub-agents.md, "Claude uses each
  subagent's description to decide when to delegate"). Kept for the universal pack and for
  platforms without agent files (copilot): the roles exist nowhere else there.
- `none detected` placeholders dropped; only detected commands are printed.
- Reproduced: with graphify absent the Claude Scout still listed four `mcp__graphify__*`
  tools plus `Read`, so it had no search tool at all. Architect and Reviewer listed
  `get_pr_impact`. Fix: `toolsFor()` names Graphify tools only when the graphify MCP is
  configured; otherwise read-only roles get `Grep, Glob, Read`. Builder unchanged. Tool
  names verified in sub-agents.md on 2026-10-10 (`tools` is an allowlist, `Grep`/`Glob`/`Read`
  valid). Codex/Antigravity/OpenCode/Cursor files are untouched (they do not list these).
- DISPROVED: "Haiku does not support MCP tool search" (shipped in `MCP_DEFERRAL` note).
  https://code.claude.com/docs/en/agent-sdk/tool-search.md (fetched 2026-10-10) lists Claude
  Sonnet 4.5, Haiku 4.5, Opus 4.5 and later as supported; upfront loading applies to earlier
  models, non-first-party ANTHROPIC_BASE_URL and Azure-hosted Foundry. The note is corrected
  and a test pins it. The doc is silent on whether subagents defer MCP tools, so the pack
  counts subagent MCP schema as loaded (unverified, not shipped as fact).
- Scout model: keep `haiku`. The reason to change it (Haiku cannot defer) is gone, and with
  at most four Graphify tools the doc says loading upfront is typically faster below ~10
  tools. No eval evidence either way; revisit only if F6 shows Scout cost matters.
- AGENTS.md guard unchanged and passing: <= 40 lines, < 500 tokens.
- Rejected: dropping the table for every platform (breaks copilot/universal readers);
  giving Scout `Bash` to run `.helix/map.mjs` (widens a read-only role; Grep/Glob is enough).
- Evidence: lint 0 errors/12 warnings, typecheck 0, `npm test` 306 + 212 pass (Node 24.14.1).

## 2026-10-10 — F5: loose ends

- `gemini` in `DEFAULT_PLATFORMS`: facts now verified from a Google primary source (the
  Gemini CLI maintainers' announcement, https://github.com/google-gemini/gemini-cli/discussions/28017,
  fetched 2026-10-10): on 2026-06-18 Gemini CLI stopped serving Google AI Pro, AI Ultra and
  free individual accounts; enterprise Code Assist licenses and API-key auth are unaffected;
  Antigravity CLI is the successor and keeps reading `gemini.md`. Press coverage
  (The Register 2026-05-20) agrees. The platform note and a test (`platforms.test.ts`) now
  cite the primary source. NOT changed: the default list. Dropping `gemini` changes what
  `helix init --platform all` and the web default emit (no GEMINI.md), so it is the owner's
  call. Recommendation: remove `gemini` from the defaults; most users can no longer run it,
  and Antigravity already reads AGENTS.md natively. Did not fetch the Google developers
  deprecation page (not reachable from this session's verified URL list).
- Untracked files (read, not modified): `.gemini/settings.json` = a graphify BeforeTool
  `hook-guard gemini` hook for Gemini CLI; `GEMINI.md` = 9-line graphify usage rules;
  `.gitattributes` = `graphify-out/graph.json merge=graphify` merge driver;
  `.husky/post-checkout` and `.husky/post-commit` = graphify hooks that rebuild
  `graphify-out/` after checkout/commit (they are live: husky's hooksPath points at
  `.husky/`, and each commit launched "[graphify hook] ... background rebuild"). All five
  look like output of `graphify ... install` commands. Left untracked and untouched.
- ESLint: 12 warnings, all `react-refresh/only-export-components` in `src/routes/*.tsx`
  (page components next to the file route's required non-component `Route` export). Accepted
  for that glob only, documented in `eslint.config.mjs`; still on elsewhere. `npm run lint`
  now reports 0 problems. Rejected: splitting every route's components into separate files
  (churn in scaffolding for a dev-only Fast Refresh nicety).

## 2026-10-10 — F0 follow-up: git-config hermeticity of the gate tests

- New class of non-hermetic test, not covered by the earlier F0 audit (which looked at
  PATH, `NODE_ENV`, cwd and network). Reproduced with a hostile ambient environment:
  throwaway `HOME` whose `.gitconfig` sets `commit.gpgsign=true` with `gpg.program=/bin/false`,
  `init.defaultBranch=trunk`, `core.hooksPath` pointing at rejecting `pre-commit`/`commit-msg`
  hooks, and `core.excludesFile` ignoring `*.lock` and `.env`; PATH without yarn/pnpm/bun/
  claude/opencode; `NODE_ENV=production`. `src/lib/harness/gate.test.ts` failed 2 of 13:
  "exits 0 and says so when nothing changed" (the base commit is silently rejected, so the
  repo has no HEAD and the gate reports "1 changed file(s)") and "flags a changed .env but
  not .env.example" (a globally ignored `.env` is invisible to the gate).
- Disproved: the same hostile environment did not break `hooks.test.ts`, `repomap.test.ts`,
  `codex-antigravity.test.ts` (already sets its own HOME/author env and `commit.gpgsign=false`),
  any `cli/*.test.mjs`, or `evals/*.test.mjs`. `cli/e2e-workflows.test.mjs#gitInit` only runs
  `git init` and config, so it is exposed in principle but did not fail.
- Test first: `src/lib/harness/hermetic.test.ts` runs `gate.test.ts`, `codex-antigravity.test.ts`
  and `cli/e2e-workflows.test.mjs` as child test runs under that environment. Red before the
  fix (gate.test.ts failed), green after. Listed in the `npm test` script; the coverage guard
  `scripts/test-coverage.test.mjs` still passes.
- Fix: `gate.test.ts` now runs both fixture setup git calls and the gate process with
  `HOME`/`XDG_CONFIG_HOME` pointing at a temp dir, `GIT_CONFIG_GLOBAL` at a file in it and
  `GIT_CONFIG_NOSYSTEM=1`.
- Open product question, NOT changed: when a developer globally ignores `.env`, the gate does
  not flag it. That is defensible (ignored files are not committed) but unverified as the
  intended behavior; owner to decide whether the gate should scan ignored env files.
- Residual, out of scope (template tests, not harness): `src/lib/app-data/app-data.test.ts`
  and `src/lib/auth/gate-identity.test.ts` set `GROK_*` env vars and `delete` them afterwards
  instead of restoring prior values.
- Cost: `hermetic.test.ts` adds about 24s to `npm test` (the e2e file alone is about 14s).
- Evidence (Node v24.14.1; CI Node 22 NOT run here): `npm run lint` 0 problems, `typecheck` 0,
  `npm test` 306 + 217 pass, 0 fail, with NODE_ENV unset on a PATH without yarn/pnpm/bun and
  with NODE_ENV=production.

## 2026-10-10 — F1: repo always-on token budget (measurement + proposal only)

- Measured with `scripts/measure-repo-always-on.mjs` (o200k_base via gpt-tokenizer; an
  approximation, not the serving model count), output stored in
  `fixtures/measurements/repo-always-on.before.json`: root `AGENTS.md` 351 lines / 4,904 tokens;
  `AGENTS.project.md` 42 lines / 417 tokens; untracked `GEMINI.md` 9 lines / 172 tokens.
  Tracked noise: `.grok/` 88 files / 196,083 tokens; `src/lib/auth` + `src/lib/app-data` +
  `src/components/ui` 35 files / 32,479 tokens. Root `AGENTS.md` references
  `AGENTS.project.md`; no agent auto-loads the latter.
- Vendor mechanisms (fetched 2026-10-10): Claude Code reads `AGENTS.md` only when no `CLAUDE.md`
  exists in the working dir or above (https://code.claude.com/docs/en/memory); Codex prefers
  `AGENTS.override.md` over `AGENTS.md` per directory
  (https://developers.openai.com/codex/guides/agents-md); OpenCode lets `AGENTS.md` win over
  `CLAUDE.md` and documents no skip (https://opencode.ai/docs/rules). Cursor, Copilot,
  Antigravity, Grok: NOT verified.
- Disproved: a committed `CLAUDE.md` is not a cross-agent fix (OpenCode ignores it when
  `AGENTS.md` exists). A subdirectory working dir does not escape the root file (ancestor
  files are loaded by Claude Code; Codex walks from the repo root down).
- Dependency scan (throwaway grep script, an estimate): 30 dependencies unreferenced in source or
  config, including 18 `@radix-ui/*`. Not acted on: needs `npm run build` and owner approval.
- Rejected: editing or replacing the root `AGENTS.md` (rule 7); deleting `.grok/` (platform-owned);
  executing the split before approval (F1 rule).
- Deliverable: `docs/F1-MIGRATION-PLAN.md`. After-numbers are projections from the measured size of
  existing files, not measurements; they become measurements once a step is executed and
  `scripts/measure-repo-always-on.mjs --label after` is run.

## 2026-10-10 — F1 step A executed; instruction-loading mechanisms verified per agent

Owner approved Step A and Step B (via `git subtree split`) and asked for Cursor, Copilot,
Antigravity, Grok, Codex, OpenCode and other common agents to be verified. Node v24.14.1.

- Step A (executed): root `CLAUDE.md` (`@AGENTS.project.md`, 1 line) and `AGENTS.override.md`
  (byte-identical copy of `AGENTS.project.md`, because Codex does not follow imports). Root
  `AGENTS.md` untouched. Failing test first: `scripts/repo-instructions.test.mjs` (4 tests, failed
  on missing files, then passed). Drift between the two copies is caught by that test.
- Real-agent confirmation: Claude Code 2.1.233 `claude -p "/context"` Memory Files lists
  `CLAUDE.md` and `AGENTS.project.md`, no `AGENTS.md`. Codex 0.142.5 `codex debug prompt-input`
  contains "Helix contributor rules" once and none of the root `AGENTS.md` text. The requested
  `codex exec --json "List every AGENTS.md ..."` could not run: the configured model
  (`gpt-6-luna`) is rejected for this ChatGPT account (HTTP 400); `debug prompt-input` was used
  instead, which renders the model-visible input without a model call.
- Before/after (script `scripts/measure-repo-always-on.mjs`, 2026-10-10, o200k_base approximation;
  files `repo-always-on.before-peragent.json` and `repo-always-on.after.json`; the "before" state was
  reproduced by moving the two new files aside):
  Claude Code 4,904 to 423; Codex 4,904 to 417; OpenCode 4,904 (unchanged); Cursor, Copilot,
  Antigravity, Grok 4,904 (unchanged, or +6 where CLAUDE.md is also read, see below).
  `/context` printed 0 tokens per memory file in print mode, so the numbers are ours, not Claude Code's.
- Verified from vendor docs (fetched 2026-10-10):
  - Cursor (https://cursor.com/docs/rules, https://cursor.com/docs/rules page dated by fetch):
    root and nested `AGENTS.md` supported, nested files combine with parents. No documented
    override or skip. CLAUDE.md not mentioned. Step A does not help.
  - GitHub Copilot (https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions):
    reads `AGENTS.md` (nearest wins) or, alternatively, a single root `CLAUDE.md` or `GEMINI.md`.
    Precedence when both exist is not documented. Effect of Step A: UNVERIFIED.
  - OpenCode (https://opencode.ai/docs/rules, page last updated Oct 8 2026): `AGENTS.md` beats
    `CLAUDE.md`; `OPENCODE_DISABLE_CLAUDE_CODE*` only disables Claude files. No skip. The page
    advertises an OpenCode v2 with separate docs (https://opencode.ai/v2/docs), not checked.
  - Codex (https://learn.chatgpt.com/docs/agent-configuration/agents-md, the page the previous
    developers.openai.com URL resolves to): per directory `AGENTS.override.md`, then `AGENTS.md`;
    one file per directory; 32 KiB default cap. Matches the live check.
  - Grok Build (https://docs.x.ai/build/features/project-rules, last updated Jul 4 2026): loads
    ALL of `AGENTS.md`, `AGENT.md`, `CLAUDE.md`, `CLAUDE.local.md` in each directory plus
    `.grok/rules/*.md`; skips files ignored by `.gitignore`. Step A therefore does not remove the
    Grok contract and adds the 6-token `CLAUDE.md`. `grok` is not installed here; `grok inspect`
    would confirm.
  - Windsurf / Devin Desktop (https://docs.devin.ai/desktop/cascade/agents-md): root `AGENTS.md`
    is always-on; no override documented.
  - Gemini CLI (https://geminicli.com/docs/cli/gemini-md/, updated Jun 18 2026): reads `GEMINI.md`;
    `context.fileName` can add `AGENTS.md`. Consumer access moved to Antigravity CLI on 2026-06-18.
  - Antigravity: NOT verified from a primary source. Google's pages were not reachable
    (`antigravity.google/assets/docs/cli/gcli-migration.md` returned 404 on the guessed URL). Third-party
    pages disagree on whether `GEMINI.md` outranks `AGENTS.md`; none is primary. Shipped as unverified.
- Rejected: working around Grok by adding `CLAUDE.md` or `.gitignore` tricks (not verified, and
  `.gitignore` on a tracked root file is not a reliable lever).
- Step B finding: `git subtree split` needs ONE directory prefix, but Helix is interleaved with the
  Grok scaffolding at the repo root (`src/lib/harness`, `cli`, `evals`, `scripts`, `docs`, `fixtures`
  next to `server`, `public/__grok`, `.grok`). A subtree split cannot express that. Not executed; see
  the owner question in the final report.

## 2026-10-10 — F1 follow-up: Step A re-verified; Step B scoped to planning only

Correction to the entry above: it says the owner approved Step B via `git subtree split`. The owner's
answer in this session was Step A approved, Step B planning only. Step B has NOT been executed
(checked: no new branches, tags, worktrees or remotes; root `AGENTS.md` matches HEAD).

- Step A re-verified independently (not trusted from the earlier entry):
  `scripts/repo-instructions.test.mjs` fails 3 of 4 with `CLAUDE.md` and `AGENTS.override.md` moved aside,
  passes 4 of 4 with them restored. Claude Code `claude -p "/context"` Memory Files list `CLAUDE.md` and
  `AGENTS.project.md` and no root `AGENTS.md`. Codex `codex debug prompt-input` (rendered input,
  36,259 bytes) contains the Helix rules once and none of the strings `App Builder Workspace`,
  `single source of truth`, `sandbox contract` from the root file.
  Order caveat: the files were created before this session; the red state was reproduced by removing
  them, not observed at creation time.
- New fact: 7 website files import the harness via the `@/lib/harness/*` alias, so Step B needs a decision
  on how the site consumes the harness. `git filter-repo` is not installed (needs approval).
- Deliverable: section 6 of `docs/F1-MIGRATION-PLAN.md` (options B1/B2/B3, dry-run procedure, rollback).
- Rejected: running any split before approval.

## 2026-10-10 — F1 Step B: owner answers recorded, recommendation only

Owner answers: most professional and effective option; site must support git dependency, workspace link and
vendored copy; the code must stay in `sm-me-dev/helix` with history rebasable. Not executed.

- Recommendation: B1 on a fresh clone with `git filter-repo`, old layout preserved on a `grok-workspace`
  branch plus a `pre-split` tag, harness exposed to the site as an npm workspace package. Details in
  section 7 of `docs/F1-MIGRATION-PLAN.md`.
- Rejected: B3 (leaves the repo), B2 (`filter-branch` is discouraged), Helix-in-a-subdirectory (ancestor
  `AGENTS.md` still loads, so no token saving), moving any platform-owned path.
- Unverified: whether the Grok workspace can build from a git dependency.
- Still needed: approval to install `git filter-repo`, and a separate approval before any force push.

## 2026-10-10 — F1 Step B dry run (fresh clone in /tmp, nothing pushed)

Owner approved a dry run only, plus installing `git-filter-repo` (a dev tool, installed with `pipx`).

- Evidence: `git filter-repo --path ... --path-rename src/lib/harness/:src/` on `/tmp/helix-split`. 107 of
  111 commits kept. Gates in the split: lint 0, typecheck 0, tests 109 + 159 pass under NODE_ENV unset and
  `production` (PATH without yarn, pnpm, bun; Node v24.14.1, Node 22 not run). Always-on instruction file:
  one 42-line root `AGENTS.md`, about 417 tokens (`scripts/measure-repo-always-on.mjs --label split`).
  `helix init --yes` on a scratch repo: 5 files written, exit 0.
- Disproved: "the path set in plan section 6 is complete". It wrongly included `scripts/write-atomic*`
  (Grok template code whose test fails in the split) and missed five depth-dependent relative paths and one
  harness-to-site import (`DEFAULT_HARNESS_CONFIG` in `src/lib/store.ts`). Details in plan section 8.
- Rejected: `pip install --user --break-system-packages` (PEP 668 override), `git subtree split`,
  `git filter-branch`.
- Trap recorded: `NODE_ENV=production` in this shell makes `npm ci` skip devDependencies (use `--include=dev`).
- Unverified: the site consuming the harness, the Grok workspace building from a preserved branch.
- Not done, needs a separate explicit approval: any change to this repo for the split (prerequisite commits,
  `pre-split` tag, `grok-workspace` branch) and any force push.

## 2026-10-10 — F2 Claude Code plugin packaging (`helix plugin`, `helix init --claude-plugin`)

Sources re-fetched 2026-10-10 (primary vendor docs, verifiedAt 2026-10-10, recorded in the
`claude-code` adapter): code.claude.com/docs/en/plugins-reference, /plugins/components,
/plugin-marketplaces, /hooks, /mcp, /skills.

Shipped, failing tests first (`src/lib/harness/plugin.test.ts`, 21 cases; `cli/plugin.test.mjs`, 6 cases
including the vendor's own validator):

- `helix plugin --out <dir>` writes a marketplace (`.claude-plugin/marketplace.json`, name `helix-harness`)
  holding one plugin (`plugins/helix`: `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/hooks.json`
  plus hook scripts, `.mcp.json`) from the same crew, skills, MCP and hook sources as `helix init`.
- `helix init --claude-plugin` (config flag `claudePlugin`): the repo gets only CLAUDE.md, AGENTS.md, the gate
  and `.claude/settings.json` with the secret denies and no hooks. No agents, skills, `.mcp.json` or hooks, so
  nothing is registered twice.
- `claude plugin validate` (Claude Code 2.1.233) passes with no warnings on both the marketplace and the
  plugin; the test runs it in a throwaway HOME. Capability matrix: claude-code `plugin` is now `emitted`;
  other platforms keep `plugin: unverified`.

Answers to the two open questions:

1. Namespaced agent names: documented. Plugin agents are `<plugin>:<name>` (`helix:scout`), invoked as
   `@agent-helix:scout`. The generated AGENTS.md uses logical role ids, so its text is not broken. Whether the
   Agent tool resolves a bare `scout` to `helix:scout` is NOT documented and was NOT tested (needs a model
   run, which I did not do without approval). Unverified. Delegation also keys on each agent's description.
2. Hook order versus `.claude/settings.json`: documented as no order. "All matching hooks run in parallel",
   a handler duplicated across settings files runs once, but "a plugin's or skill's copy of the same handler
   stays separate". So plugin hooks plus repo hooks would run twice, concurrently. That is why plugin mode
   writes no hooks into the repo. Parallel execution was read from the docs, not observed.

Findings that changed the design:

- A plugin cannot carry the secret denies: plugin `settings.json` honors only `agent` and `subagentStatusLine`.
  `permissions.deny` stays in the repo. Rejected: moving the denies into a plugin hook (advice, not
  fail-closed).
- Plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>` (characters outside `A-Za-z0-9_-` become
  `_`). Agent allow-lists and hook matchers written for `mcp__graphify__...` would never match. Plugin agents
  rewrite the names (`scopeMcpTool`, tested).
- Plugin agent frontmatter: `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` are ignored. Our agents
  use only `name`, `description`, `tools`, `model`; a test guards it.
- A plugin-root CLAUDE.md is not loaded (confirmed again; validate warns), so none is shipped.

Measurement (script `scripts/measure-plugin.mjs`, stored in `fixtures/measurements/plugin-details.json`,
2026-10-10, Claude Code 2.1.233): `claude plugin details helix` projects about 186 tokens always-on for the
whole plugin (2 skills, 4 agents), about 30 per agent and 30 to 40 per skill, plus on-invoke cost per
component. These are Claude Code's own estimates ("may differ from actual usage"), deterministic, no model
call, so there is no variance to report. Not measured: the same content as repo-local files, and real session
tokens with the plugin installed.

Rejected: shipping AGENTS.md or CLAUDE.md in the plugin (not loaded); a `bin/helix` executable (would need
the CLI bundled, deferred); npm distribution (a git marketplace is enough); a `--version` flag (the plugin
version `0.1.0` is a constant; bumping it is what pushes updates to users).

Leads for later items (found while reading docs, not acted on):

- F4: https://code.claude.com/docs/en/mcp (fetched 2026-10-10) says tool search needs models that support
  `tool_reference`, "Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5, and later". That contradicts the
  earlier claim that Haiku lacks MCP tool search. To be re-checked against the agent-sdk tool-search page.
- Existing quirk, not yet reproduced: `hooksJson` returns `{ "hooks": {} }` with no `permissions.deny` when
  `hooksEnabled` is false, so turning hooks off may also drop the fail-closed secret denies. Needs a failing
  test before any change.
- Unrelated to F2: `claude plugin eval` and `claude plugin details` exist; the former could run plugin evals
  with a no-plugin baseline arm (free of Helix's own eval harness), worth a look in F6.

## 2026-10-10 — F1 Step A re-verified; platforms re-verified (Cursor, Copilot, Antigravity, Grok)

Owner decisions this session (via question tool): keep Step A; Step B "execute full split"
selected but ON HOLD (see below); verify all four platforms; paid eval runs "approved" but ON
HOLD pending model + budget + cell count (see F6 entry).

- Step A re-verified today (Node v24.14.1 on stripped PATH, files committed, not re-created):
  `scripts/repo-instructions.test.mjs` 4/4 pass; `scripts/measure-repo-always-on.mjs --label
verify` reproduces root AGENTS.md 351 lines / 4,904 tokens, CLAUDE.md 6, AGENTS.override.md 417,
  AGENTS.project.md 417; Claude Code `claude -p "/context"` Memory Files list project CLAUDE.md
  - AGENTS.project.md and no root AGENTS.md; Codex `codex debug prompt-input` (36,014 bytes)
    contains "Helix contributor rules" once and zero of the root-file probes. Root AGENTS.md
    byte-identical (untouched). GEMINI.md is now tracked (10 lines / 172 tokens; was untracked 9/172).
- Cursor re-verified (https://cursor.com/docs/rules, fetched today): root + nested AGENTS.md
  supported and combined (specific wins); no override/skip documented; CLAUDE.md not mentioned.
  Step A does not help Cursor. Adapter verifiedAt bumped 2026-10-09 -> 2026-10-10, no behavior change.
- Copilot re-verified (https://docs.github.com/.../add-repository-instructions, fetched today):
  one or more AGENTS.md anywhere (nearest wins), or alternatively a single root CLAUDE.md or
  GEMINI.md; precedence when both exist is undocumented, so Step A's effect stays UNVERIFIED.
  Adapter verifiedAt bumped 2026-10-07 -> 2026-10-10 and the GitHub docs page added to sources.
- Antigravity now VERIFIED from primary Google docs (fetched today; previously unreachable):
  rules (https://antigravity.google/docs/rules — AGENTS.md/GEMINI.md per directory, walk-up to
  root, cumulative always_on, no frontmatter; 24KB per-file + 20k-token aggregate budget),
  MCP (https://antigravity.google/docs/mcp — workspace .agents/mcp_config.json, mcpServers key,
  serverUrl for remote), subagents (https://antigravity.google/docs/subagents — .agents/agents,
  name/description/tools/mainAgent/subagent/model inherit|flash|pro),
  skills (https://antigravity.google/docs/skills — .agents/skills, progressive disclosure),
  hooks (https://antigravity.google/docs/hooks — .agents/hooks.json, Pre/PostToolUse,
  Pre/PostInvocation, Stop returning {decision: continue}; no loop guard documented, and the
  hook input/output contract differs from Claude's, so Helix still emits no hooks file).
  Adapter verifiedAt bumped to 2026-10-10. F1 consequence: Antigravity reads root AGENTS.md
  (the Grok contract) and neither Step A file, so only Step B helps it. `agy` CLI is installed
  on this machine (/home/sm-me/.local/bin/agy) — live `agy` behavior checks are possible next.
- Grok re-verified (https://docs.x.ai/build/features/project-rules, fetched today): loads ALL of
  AGENTS.md/AGENT.md/CLAUDE.md/CLAUDE.local.md per directory plus .grok/rules/*.md (and
  .claude/.cursor rules for compat), full files, no size cap, gitignored files skipped.
  Step A adds 6 tokens, removes nothing. `grok inspect` would confirm; grok CLI not installed.
  Grok has no Helix adapter (stays unverified in-product); this is an F1 measurement fact.
- README matrix regenerated (drift test caught the three date bumps, as designed); the Gemini
  paragraph corrected (it claimed no Google primary page was checked — now false, see F5 entry).
- Rejected: promoting Grok to an adapter on docs alone without an emission design; emitting
  Antigravity hooks by porting Claude-protocol scripts (contract differs: decision
  allow/deny/ask vs permissionDecision).
- HOLD — Step B full split: the radio-button "execute" conflicts with the non-negotiable
  no-commit/no-push rule, and this branch is 4 commits ahead of origin/fix/audit-evidence-gated
  with no pre-split tag or grok-workspace branch, so a force-push now would strand work.
  Required before any execution: an explicit typed force-push approval plus a decision on the 4
  unpushed commits. Nothing pushed; working tree changes in this session are uncommitted.

## 2026-10-10 — F4 re-verified (lean pack stands; one residual noted)

- `helix measure` re-run today on a scratch repo (`helix init --platform claude-code,codex`,
  Node v24.14.1): always-on 1.0k (agents.md 341, skills 74, mcp 420 estimate, crew 172), lean
  score 100 (4/4). Matches the committed after-numbers (1.01k); the before-numbers (472 -> 341
  tokens, 38 -> 29 lines) stand as recorded with script + date, not re-measured (would need the
  parent commit's code). AGENTS.md guard (<= 40 lines, < 500 tokens) PASS.
- Scout allow-list re-checked in code (`adapters/parts.ts#toolsFor`: graphify tools named only
  when the graphify MCP is configured, else Grep/Glob/Read) and in the generated pack
  (scout.md in the graphify-absent scratch repo: `tools: Grep, Glob, Read`, zero graphify refs).
- Tool-search doc re-fetched today (https://code.claude.com/docs/en/agent-sdk/tool-search.md):
  "Model support: Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5, and later" — the
  disproof of "Haiku lacks MCP tool search" stands; Scout keeps `haiku`.
- Residual (not changed, needs a failing test before any fix): the Scout role _body_ still says
  "Query Graphify for the subgraph" unconditionally while its allow-list is Grep/Glob/Read in
  graphify-absent packs. F4 fixed the allow-list, not the prose.
- Rejected: re-measuring the before-state by checking out the parent commit (read-only history
  work with no decision value; the recorded numbers already carry script + date).

## 2026-10-10 — F5 re-verified (developers page found; gemini default still the owner's call)

- Discussion 28017 re-fetched today: maintainer post (Jun 18 2026) confirms consumer-tier
  shutdown, enterprise/API-key unaffected, Antigravity CLI as successor keeping gemini.md.
  Matches the committed entry verbatim.
- NEW primary source closing the earlier gap: Google developers deprecation page
  https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals
  (fetched today, page last updated 2026-10-09 UTC): IDE extensions + Gemini CLI stopped serving
  individuals/Pro/Ultra on 2026-06-18; Standard/Enterprise on a separate schedule; migration to
  Antigravity. The gemini platform note now cites both sources (platforms.test.ts "cites Google's
  own announcement" still green).
- NOT changed: DEFAULT_PLATFORMS still contains `gemini` (verified above: `claude-code, cursor,
codex, gemini, copilot`). Recommendation stands: remove `gemini` from the defaults; most users
  can no longer run it and Antigravity reads AGENTS.md natively. Owner decision required.
- `npm run lint` 0 problems (Node v24.14.1, stripped PATH).

## 2026-10-10 — F2 status (already shipped; confirmed green, no changes)

- `helix plugin` + `helix init --claude-plugin` (commit 5668181) re-checked without modification:
  `src/lib/harness/plugin.test.ts` + `src/lib/harness/platforms.test.ts` 27/27 pass;
  `cli/plugin.test.mjs` 6/6 pass (includes the vendor's own `claude plugin validate`, Claude Code
  2.1.233). DEFAULT_PLATFORMS unchanged. The two open questions stay as recorded (namespaced
  resolution untested without a model run; hook parallelism read from docs, not observed).

## 2026-10-10 — F3 LSP verdict (repo-level emission disproved; verified routes recorded)

- Verified today from primary docs (https://code.claude.com/docs/en/plugins/code-intelligence,
  via the docs index): Claude Code LSP arrives as **plugin-bundled `.lsp.json`**
  ("Write a plugin with an `.lsp.json` file ... then load the plugin with `--plugin-dir` or
  publish it to a marketplace"); per-language official plugins come from Anthropic's marketplace
  (TypeScript: `typescript-lsp` plugin + `typescript-language-server` binary). No project-level
  `.lsp.json` in a repo is read. No LSP binaries are installed on this machine, so server start
  was not observed.
- Consequence: Helix must NOT emit a repo-level `.lsp.json` (nothing reads it) — that half of F3
  is disproved as designed. Verified shippable routes: (a) an `.lsp.json` stanza inside
  `helix plugin` output, but only for languages without an official plugin (every Helix-relevant
  language has one, so: recommend, don't bundle); (b) a per-stack recommendation of the official
  plugin (this repo is TypeScript: `typescript-lsp@claude-plugins-official`); (c) Serena MCP
  stays the cross-platform LSP path (already emitted, pinned @v1.7.0).
- NOT done: catalog widening past 2 own skills / 8 MCPs and the discovery step recommending
  published skills/MCPs/plugins by detected stack. Blocked on evidence, not effort: every new
  entry needs a pinned version, a same-day primary source, and a measured schema size from
  scripts/measure-mcp.mjs or an explicit "estimate" label — none were collected today, and none
  are invented here.
- Rejected: emitting `.lsp.json` at repo root "for completeness" (unread files are noise, and
  the 2026-10-09 cosmetic-LSP-removal decision already settled this pattern).

## 2026-10-10 — F6 harder task + pilot (design validated, full matrix still to run)

- New tuning task `evals/tasks-large/deep-bug.yml` (test-first: `large-tasks.test.mjs` taught to
  expect 4 files — red before the YAML existed; the quoted-glob pass command failed first because
  the validation test passes globs literally without a shell, fixed to explicit paths):
  seed 1, module 0 (ledger, 15 transitive dependents — the maximum, computed with buildModel, not
  guessed), rule 1. Planted state: 81 tests, 63 pass / 18 fail (deterministic count, 2026-10-10)
  vs trace-bug's 3 red suites. Pass command runs the whole tests tree + integration (tighter:
  collateral edits fail). Pristine-green + planted-red enforced by the navigation-property test.
  Held-out setups untouched (seed1/m6/r5, seed7/m5/r3).
- Pilot (opencode free tier, deep-bug, none arm, n=1, pre-approved):
  `evals/results/2026-10-10T16-05-05-opencode.{json,md}` — 1/1 pass, wall 77s, transcript total
  261,646, uncached 28,128. One run proves the task runs end to end, not that it discriminates:
  the none arm solved it faster than trace-bug's pilot, so deep-bug alone may not break the
  ceiling either. No helix-arm comparison exists yet for this task.
- Full F6 matrix (NOT run): arms none / helix-without-subagents / helix-with-subagents × tasks
  (trace-bug, call-chain, cross-module, deep-bug + double-bug if built) × n>=5, free-tier opencode
  first. Two prerequisites are missing and need owner approval + design: (1) the runner only
  accepts arms none,helix — a third arm needs a pack variant without agent files plus transcript
  confirmation that subagents actually spawned (subagentTokens > 0; all 30 prior runs were 0, so
  on this runner the with-subagents arm may be vacuous — Claude Code runs would exercise it, but
  no ANTHROPIC_API_KEY exists here); (2) paid runs: "approved" with no model, dollar cap, or cell
  count — none specified, so nothing paid was started. A double-bug task (two plants) needs
  generator + runner support for two setups (failing test first).
- Decision rule (unchanged): if helix does not at least tie pass rate while cutting tokens,
  change the design and re-run; if it still does not win, say so plainly in README and here.
- Incidental: my probe ran `generate.mjs --out /tmp/fx` but the script takes a positional outDir,
  writing 356 files into a stray `--out/` dir in the repo root. Removed. Rejected: adding flag
  parsing to the throwaway-shaped generator CLI (out of scope).
- Evidence this session (Node v24.14.1, stripped PATH without yarn/pnpm/bun; CI Node 22 not run):
  `npm run lint` 0 problems, `typecheck` 0, `npm test` 315 pass + 1 pre-existing skip / 0 fail
  (.mjs, 316) and 238 pass / 0 fail (TS) — identical with NODE_ENV unset and NODE_ENV=production.

## 2026-10-10 — Scout prose + graph-first skill follow graphify configuration

Owner asked to fix the residual: the Scout role body said "Query Graphify" unconditionally while
its allow-list is Grep/Glob/Read in graphify-absent packs.

- Failing tests first (`generate.test.ts`, both red before the fix): scout body must name
  `.helix/map.mjs` and never "Query Graphify" when the graphify MCP is absent (and keep the
  Graphify wording when present); the graph-first skill must not ship without the graphify MCP.
- Fix: `agentBody(id, config)` swaps Scout's job + input to map wording when
  `!config.mcps.includes("graphify")` (same predicate as `toolsFor`); the required config
  parameter threads through all five agent surfaces plus the shared `agentFile` (so `helix
plugin` gets it too — the compiler rejected the four missed call sites, which were then
  fixed). `generatePack` normalizes skills once at the choke point so init, export, plugin and
  evals agree; adapters receive the normalized config.
- Verified end to end: graphify-absent packs on all five surfaces carry map prose, zero
  "Query Graphify"/"Graphify index"; graphify-on pack unchanged. The eval helix arm (mcps: [])
  no longer ships the unusable skill — prior eval arms did, which is a caveat on their token
  numbers, not a reason to re-run them.
- Residual: role _descriptions_ (one-liners, five sources) still say "graph-cited" in
  graphify-absent packs. Left alone: delegation copy is a separate behavior change, and the
  approved fix was the body. Rejected: per-adapter prose branches (one shared helper or drift).
- Evidence: typecheck 0, lean-pack + platform + plugin + token suites green; full gates below.

## 2026-10-10 — gemini removed from DEFAULT_PLATFORMS (owner decision executed)

Owner confirmed: Gemini CLI's consumer tiers are gone (migrated to Antigravity), so remove it
from the defaults. Failing test first (`platforms.test.ts`: gemini must not be in
DEFAULT_PLATFORMS; red before, green after).

- `DEFAULT_PLATFORMS` is now claude-code, cursor, codex, copilot. This flows to the web store
  default, `helix init` with no `--platform`, `--platform all`, the simulation default and
  `scripts/measure-skills.mjs` with no further edits. Explicit `--platform gemini`, GEMINI.md
  detection (`cli/lib.ts`) and the GEMINI.md pointer file are untouched — requesting it still
  works, it just isn't emitted by default.
- Full gates green after the change (both NODE_ENV legs, stripped PATH, Node v24.14.1):
  lint 0, typecheck 0, 315 + 1 skip / 0 fail (.mjs) and 241 / 0 fail (TS).
- Rejected: deleting the gemini adapter outright (explicit selection must keep working for
  enterprise/API-key users, who are unaffected by the shutdown).
