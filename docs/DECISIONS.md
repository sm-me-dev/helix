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
