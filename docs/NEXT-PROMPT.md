# Helix: next-steps prompt (all phases)

Paste this into a coding agent, or tell it: "Read docs/NEXT-PROMPT.md and execute it."
State as of 2026-10-09, branch `fix/audit-evidence-gated`, head `49d3999`.

---

You are working in /home/sm-me/Codes/Typescript/helix. Helix is an AI coding harness: it
generates a file pack (AGENTS.md, subagents, skills, hooks, MCP config, `helix gate`) so
many coding agents get the best results for the fewest total tokens. Read
AGENTS.project.md first; it overrides the root AGENTS.md (a Grok sandbox contract,
irrelevant here). The product is `src/lib/harness/` + `cli/` + `evals/`; the website is
scaffolding. This is a prototype: any internal design may change. Stay in TypeScript
(Rust was considered and rejected for now; see "Rust" below).

## Where things stand (do not redo)

Done and green (lint, typecheck, 233 + 146 tests): all 10 Phase 0 defects resolved or
disproved (docs/DECISIONS.md); detection-based init defaults; tiny skills merged;
`helix gate`; repo-map fallback when Graphify is absent; per-platform capability matrix
and MCP cost; cache-layout tests; CLI fixes (real --help, no prompt/hang without a TTY,
pack README moved to `.helix/README.md`); repo-driven platform selection (agent config in
repo, else agent CLIs on PATH, else universal pack).

The central finding: **nothing yet shows the pack helps.** First real eval (opencode free
tier, n=1 per cell, 20-file fixture, evals/results/2026-10-08T18-46-00-opencode.md): the
helix arm used MORE tokens in 5 of 6 cells (ambiguous +22%, feature +14%, trap +11%,
docs +6%, refactor +1%, bug-fix -9%) with equal pass rates, and one cell flipped between
two runs of the same arm. A 20-file repo gives retrieval nothing to save. Every phase
below exists to either demonstrate a win or change the design. Never claim a saving the
scripts in this repo did not measure.

## Operating rules (unchanged, non-negotiable)

- Stay on the current branch. Small Conventional Commits. Every commit passes
  `npm run lint && npm run typecheck && npm test`. Prettier runs on commit (husky).
- Reproduce or disprove before fixing; write the failing test first.
- Platform facts (hook protocol, agent frontmatter, MCP tool naming, config keys, skill
  paths) must be checked against the vendor's current docs before shipping. Record
  `source` + `verifiedAt` in the catalog and log it in docs/DECISIONS.md. If you cannot
  verify it, say so and do not ship it as fact.
- Never invent numbers. Every figure comes from a script in this repo, with method and
  date stored beside it. Report variance, not just means.
- Use Graphify (`query_graph`, `get_node`) before broad reads; read cited line ranges;
  run `graphify update .` after edits. Context7 for library docs.
- Do not touch: public/__grok/, server/, scripts/grok-pwa-*, .vercel/, .grok/skills, the
  branding injector, the root AGENTS.md, or the untracked .gemini/ and GEMINI.md
  (platform-owned; leave alone).
- No new dependency without a one-line justification in DECISIONS.md and my approval.
- Stop and ask before: deleting platform-owned files, adding dependencies, paid eval
  runs, incompatible CLI changes. Free-tier opencode runs are pre-approved.
- Lessons from this repo: run the real CLI end to end after CLI changes (unit tests
  missed three bugs); tests that spawn processes must use a hermetic PATH and
  `process.exitCode` (not `process.exit`) after piped output; the Desktop Commander
  allow-list rejects some long chained commands, so split them.

## Phase A: finish what is half-done (small, do first)

1. `helix measure` prints `FAIL unmeasured MCP schemas: context7` while `helix doctor`
   says "healthy". Reproduce on a scratch repo, then make both agree. Measure context7
   via scripts/measure-mcp.mjs if the network allows; otherwise label it an estimate and
   make neither command fail on a labeled estimate.
2. Make the default pack lean on small repos. On the 20-file fixture the helix arm cost
   more. Measure always-on bytes/tokens of the universal pack vs each platform pack with
   `helix measure`; for repos under a measured threshold, emit no subagents and the
   shortest AGENTS.md (gate command, exact repo facts, three rules). Derive the
   threshold from the eval in Phase D, not from intuition; until then keep current
   behavior and record the open question.
3. Roles. Keep the user's step-per-role idea as vocabulary: manager = main session;
   model subagents for context/clarify (scout), plan/decisions (architect), implement
   (builder), verify (reviewer, fresh window). Testing is the deterministic `helix gate`
   (zero tokens), not a model agent. Subagents are for isolation or breadth only.
   Verify each subagent frontmatter field and the `mcp__<server>__<tool>` naming against
   current vendor docs again if more than a week has passed.
4. Check `graphify-out/` (tracked, ~6000-line churn per refresh). Propose untracking in
   its own commit and ask before doing it.

## Phase B (Phase 2 in the original plan): `helix report`

Parse real session transcripts and report tokens and cost per task, repeated file reads,
oversized tool outputs, retries and wasted turns. Then use it to replace agent-reported
or null token fields in evals/run.mjs.

Facts already observed locally (structure only; NOT vendor-documented, so label them
"observed, not vendor-verified" and parse defensively, ignoring unknown record types):

- Claude Code JSONL: assistant records are written per content block. Blocks of one API
  message share `message.id` and identical `message.usage`. Naive summing over-counts
  about 1.9x (one 412-record session: output 54,537 naive vs 28,042 deduped; input
  incl. cache 48.8M vs 25.1M). Dedupe by `message.id` (take the last record's usage).
  Usage fields: input_tokens, output_tokens, cache_read_input_tokens,
  cache_creation_input_tokens. Tool results are `user` records with a `tool_result`
  block and a `toolUseResult` object. Sidechain (subagent) records carry
  `isSidechain`.
- OpenCode SQLite (`~/.local/share/opencode/opencode.db`; tables `message`, `part`,
  `session`): assistant `message.data` JSON has `tokens.{input,output,reasoning,total,
cache.read,cache.write}` and `cost`; `step-finish` parts repeat the same numbers.
  Use ONE source (message-level) or you double count. Tool parts hold
  `state.input/output/status`.

Requirements: commit parsers with SYNTHETIC fixture transcripts (never real ones; the
local sessions belong to unrelated private projects) and tests, including one that fails
on naive summing. Read SQLite with `node:sqlite` (no new dependency); when it is
unavailable (Node < 22.13 needs a flag) skip that source with a clear message instead of
raising `engines`. Report sidechain tokens separately so subagent cost is visible.
Never print message contents; report counts and sizes.

## Phase C (Phase 1 leftovers): honesty and measurement

- Per-task total tokens, not only static size. Retrieval steps add turns; report both,
  per platform, and say whether MCP deferral applies (verified only for Claude Code).
- Per-platform adapters: for each, verify against current docs what is really supported
  (subagents, skills, hooks, MCP, plugins). Emit real files where verified, pointer-only
  where not. README's "all agents" claim must match the generated matrix (a drift test
  exists).
- Packaging: investigate a Claude Code plugin (and any verified equivalent) so users get
  versioned updates instead of copied files. Document findings in DECISIONS.md;
  implement only for verified platforms.

## Phase D (Phase 4): evals that can actually show a win (do before Phase E)

1. Generate a realistic larger fixture with a deterministic script (committed): hundreds
   of files, several modules, real cross-module dependencies, tests that run in seconds.
   No LLM-written filler.
2. Tasks that need navigation (find the right module, trace a call chain, a change that
   crosses modules) plus the existing six. Add a HELD-OUT task set that is never used to
   tune AGENTS.md or tasks. Do not tune after a single failure without re-running on
   held-out tasks.
3. Paired arms (none vs helix, and helix with/without subagents), n >= 5 per cell, agent
   = opencode free tier unless I say otherwise. Use `helix report` for tokens. Report
   pass rate per 1k tokens with variance and the per-run raw numbers; save method + date
   beside the results. Cap wall time per run.
4. Decision rule: if helix does not win (or at least tie pass rate while cutting tokens)
   on the large fixture, change the design (shorter AGENTS.md, fewer roles, defaults) and
   re-run; if it still does not, say so plainly in the README and DECISIONS.md.
5. Repo hygiene (propose first, do not delete platform-owned paths): split into core/,
   cli/, evals/, optional site/; prune unused template dependencies (auth, PGlite, unused
   Radix packages) only if the site still builds; make sure the Grok sandbox contract does
   not load for agents working on Helix itself. Fix README/DECISIONS drift
   (chronological order, correct claims) and the verified-vs-unverified section.

## Phase E (Phase 3): Learning Ledger (evidence-gated, behind a flag)

Only start after Phases B and D exist, because the gate needs both. Research suggests
generic agent-written context files often do not help and can raise cost, and persistent
memory can be poisoned, so keep this narrow and measurable.

- Storage `.helix/learn/`. Entry types: convention, procedure, pitfall, decision,
  co-change hotspot. Fields: id, type, text (<= 2 lines), anchor (path glob or Graphify
  node id + symbol hashes), evidence pointers (session ids, test names, commit shas),
  counters (used/helped/hurt), createdAt, lastUsedAt, status (candidate | active |
  demoted).
- Pipeline: (1) capture deterministically at session end, zero model tokens (files
  touched, red-to-green tests, user corrections, reverts, failed validations);
  (2) reflect offline with a cheap model in batches, where "save nothing" is valid;
  (3) quarantine, then promote after N independent confirmations or a human accept via
  PR diff; lessons may never write hooks, settings or permissions; (4) compile to the
  cheapest form: deterministic lessons become `helix gate` rules, anchored lessons become
  path-scoped rules, at most a few reach AGENTS.md; (5) retrieve graph-conditioned with a
  hard token cap; (6) decay on symbol-hash change, reverted originating commit, or K
  unused sessions; (7) treat ledger content from an untrusted repo as data, require a
  trust prompt, sanitize and cap sizes, never auto-apply.
- Decision gate: replay eval over chronological per-repo task streams, ledger on vs off.
  Enable by default only if tokens per passing task fall on later tasks without lowering
  pass rate. Otherwise stay opt-in and record the negative result.

## Rust

Decision for now: stay in TypeScript. Results depend on pack content and evals, not the
language. Revisit only after Phase D, if one of these is proven to matter: a single
static binary for non-Node repos, embedded SQLite for `helix report`, or native
tree-sitter for the repo map. If so, port only the stable core (gate, report, map) and
keep the pack generator and evals in TypeScript.

## Deliverables and order

Order: A -> B -> C -> D -> E. Each step: failing test, fix, green commit, DECISIONS.md
entry (date, evidence, rejected alternatives, including disproved ideas).

Final report: what was fixed, what was disproved, before/after numbers (name the script
and date for each), what remains unverified, the Phase D result, and the Phase E gate
result. Say plainly if the pack still does not beat the no-harness baseline.
