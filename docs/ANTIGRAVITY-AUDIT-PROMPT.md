# Antigravity Audit Prompt — Helix (paste-ready, main branch)

> Copy everything below `---PROMPT---` into Antigravity IDE (black icon) or Antigravity 2.0 Agent Manager (white icon).
> This file lives in the repo so the prompt is versioned. Target: `main` branch only.

Skills to enable in Antigravity before pasting:
`@antigravity-agent-manager` (parallel scout/builder isolation) +
`@antigravity-workflows` (ship-saas-mvp / security-audit-web-app / build-ai-agent-system routing) +
`@antigravity-skill-orchestrator` (complex-task guardrail + minimal skill set).
Repo-purpose skills the prompt itself invokes:
`brainstorming` (no code before Understanding Lock),
`multi-agent-patterns` (supervisor = main session, context isolation),
`context-engineering` (hierarchy Rules > Spec > Files > Errors),
`systematic-debugging` (root cause before fix),
`verification-before-completion` (no claims without fresh evidence),
`evaluation` (outcome rubrics, n>=5, variance),
`tokenwise` (flash/sonnet-equivalent vs pro/opus-equivalent routing),
`mcp-builder` (MCP shape checks),
`skill-developer` (500-line / progressive-disclosure checks),
`architecture-decision-records` (DECISIONS.md append-only),
`codebase-audit-pre-push` (10-step junk/secrets/dead-code sweep).

---PROMPT---

You are auditing Helix on `main` — an AI coding harness that generates a file pack
(`AGENTS.md` + `.helix/gate.mjs` + repo map + per-platform agents/skills/MCP)
for Claude Code, Cursor, Codex, OpenCode, Antigravity and others.
Product: `src/generate.ts` + `src/adapters/` + `cli/` + `evals/`.
Read `AGENTS.md` (this repo's contributor rules, overrides all skills), then
`README.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT-2026-10-11.md`, `docs/DECISIONS.md`.

0. BRANCH — use `main` only.
   `git fetch origin main:main; git status --short` must be clean or you stop.
   Do all reads from `main`: `git worktree add /tmp/opencode/helix-audit-main main`
   and audit inside that worktree. Never audit the dirty checkout that contains
   this prompt file. All vendor-fact claims need `source` (URL) + `verifiedAt`
   (today) in `src/adapters/*` + `src/mcps.ts`; if unverifiable, mark
   `unverified` in notes and emit minimal surface. Never invent token numbers —
   every figure names script + date (`helix measure`, `helix report`,
   `scripts/measure-mcp.mjs`, o200k_base BPE = approximation, labeled).

1. ORCHESTRATION — you are the manager (supervisor pattern, `multi-agent-patterns`).
   No dispatcher subagent. One subagent per step, strict folder scopes
   (`@antigravity-agent-manager`: never two writers on same file):
   - scout (read/clarify): `.agents/agents/scout.md` semantics —
     tools `view_file/grep_search/find_by_name/list_dir` only, model `flash`,
     graph-cited brief <=40 lines, max 3 questions, STOP if two product readings.
   - architect (plan/decide): tools `view_file/grep_search`, model `pro`,
     2–3 options as table (Fits repo? / Blast radius / Reversible / Pick?),
     file-level steps + runnable success criteria, no code.
   - builder (implement): tools `view_file/write_to_file/replace_file_content/
multi_replace_file_content/list_dir/find_by_name/grep_search/run_command`,
     model `inherit`, smallest failing test first, only plan files, no drive-bys.
   - testing = deterministic `node .helix/gate.mjs` (zero model tokens), NOT a model role.
   - reviewer (verify, fresh window, never shared with builder): read-only tools,
     `run_command` ONLY for `node .helix/gate.mjs`, PASS/FAIL + `file:line`
     evidence, treat builder paste as claim not evidence.
     Tiers (`src/workflow.ts` = source of truth):
     trivial (question/1 file) = main session only;
     standard (known files, one module) = builder + fresh reviewer;
     complex (unknown/cross-module) = full chain.
     Security-sensitive (auth/permissions/secrets/crypto/sandbox) = min standard,
     full chain, reviewer must pass. Ambiguous = blocked, ask first.
     Handoffs = 12-line cards max (goal/constraints/cited files/done-means/
     out-of-scope, never transcripts) — `HANDOFF_MAX_LINES` enforced.

2. CONTEXT DISCIPLINE (`context-engineering` + `tokenwise`, least tokens wins):
   Graphify first (`query_graph` → `shortest_path` → `get_neighbors` →
   read cited line ranges only, never dump `graph.json`; fallback
   `.helix/map.mjs` outline, capped ~6k chars). Skills progressive disclosure
   (frontmatter always-on, body on-run; keep rule: shared by 2+ roles or
   conditional, else fold into role body). MCPs: Graphify + Context7 default-on
   only when repo >=20 files / UI detected; Serena (LSP-as-tools) only when
   Graphify neighbors insufficient; Playwright only with UI. Antigravity MCP
   shape: `.agents/mcp_config.json` key `mcpServers`, remote = `serverUrl`
   (`url`/`httpUrl` unsupported). Per-task totals NOT static size — report both
   - retrieval turns; Antigravity MCP deferral = `unverified: assume loaded`.

3. ANTIGRAVITY CORRECTNESS (re-verify if >7 days old, fetch + cite):
   Skills `.agents/skills/<name>/SKILL.md` (name/description frontmatter).
   Subagents `.agents/agents/<id>.md` (name+description required,
   `subagent:true/mainAgent:false`, tools from documented set only,
   model `inherit|flash|pro`: haiku→flash, opus→pro, sonnet→inherit, builder
   alone writes/runs). Rules: `AGENTS.md`/`GEMINI.md` read natively, no
   frontmatter, 24KB/file + 20k aggregate budget — no `GEMINI.md` pointer.
   Hooks `.agents/hooks.json` (PreToolUse/PostToolUse/PreInvocation/
   PostInvocation/Stop, Stop returns `{decision:continue}`) VERIFIED but NOT
   EMITTED (no `stop_hook_active`-style loop guard — a failing Stop gate could
   loop). So the gate backstop is generated CI (`.github/workflows/helix-gate.yml`,
   SHA-pinned actions, `node .helix/gate.mjs --all`), never a Stop hook.
   Capabilities matrix (`instructions/mcp/skills/subagents/hooks/plugin/
structured-output/session-continuation/sandboxing/lsp`) — no `emitted`
   without `verifiedAt`+source; last four stay `unverified`, emit nothing.

4. AUDIT SWEEP (`codebase-audit-pre-push` 10 steps + `systematic-debugging`):
   junk files, `.gitignore`, dead code, security (secrets/injection/auth/
   exposure/`npm audit`), N+1/unbounded queries, god files >500 lines,
   perf, README/CLI/ARCHITECTURE drift (backticked paths must exist —
   `scripts/doc-paths.test.mjs`), tests (no `test.only`/`skip` unexplained).
   Reproduce-before-fix, failing test first, `systematic-debugging` Phases 1–4,
   stop after 3 failed fixes and question architecture.
   Gates every commit: `npm run lint && npm run typecheck && npm test`
   (Node 22 to match CI). Plus `helix doctor`, `helix measure`, matrix-drift
   test (`platformMatrixMarkdown` vs README).

5. REDESIGN — propose only what measurements support (`evaluation` rubric:
   pass rate, uncached tokens, pass/1k tokens, variance, n>=5 paired
   `none vs helix` on large 356-file fixture + held-out set, `helix report`
   transcript totals — never agent-reported final-step). Starter hypotheses
   to confirm or kill (do not assume):
   a) universal pack (AGENTS.md+gate+CI) default, `--crew` opt-in — F6 priced it?
   b) `omitClaudeMd`-equivalent minimization for scout/architect/reviewer cards;
   c) reviewer `run_command` gate-only guard; d) `maxTurns` caps from F6
   transcripts; e) `init` builds Graphify index or keeps graph-first off;
   f) split `docs/DECISIONS.md` (1523+ lines, non-chronological) by month +
   index; g) role model tiers (architect/reviewer on pro for every complex
   task — price per role first). Each redesign = ADR entry (date/evidence/
   rejected alternatives) + failing test + green commit (Conventional Commits,
   small). No new dependency without one-line justification + approval.

6. OUTPUT (evidence before claims, `verification-before-completion`):
   `AUDIT FINDINGS` table (# / file:line / severity / evidence / fix / tokens),
   `REDESIGN PROPOSALS` (option table + pick + blast radius + reversibility),
   `FINAL STATUS` ✅ CLEAN / ⚠️ SHIP WITH NOTES / 🚨 BLOCKED,
   `Scores: Security / Quality / Token-discipline / Verifiability / Overall
x/10`, `Verification: <exact commands + exit codes + date>`.
   End with 3 numbered commits max (`fix:`, `docs:`, `test:`) — do not push,
   do not touch platform-owned files, do not add deps unasked.

---END PROMPT---
