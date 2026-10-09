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

Evidence that the pack was not yet doing its job (script: `evals/run.mjs`;
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
