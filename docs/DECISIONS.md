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
