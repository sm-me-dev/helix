# Helix — a coding harness that earns its tokens

Helix is a drop-in harness for AI coding agents: tier-routed roles, repo-map
first context (Graphify when present, a built-in outline otherwise), skills that
load on demand, and one portable gate command. Full support exists only where the
vendor docs were checked: see the platform matrix below. Everywhere else the pack
is AGENTS.md plus at most a pointer file.
The product is the generated file pack; this repo holds the generator, the CLI
and the evals that test whether the pack helps.

## 60-second install

```sh
git clone <this-repo> && cd helix && npm ci
./cli/helix.mjs init ~/your-repo --platform claude-code,codex
```

`helix init` detects the stack (language, package manager, test/lint/format
commands, existing agent files), then writes the pack. It never overwrites an
existing file without showing a diff and asking — pass `--force` to skip the
prompt. Requires Node 22.6+ (type stripping, no build step).
When an `opencode.json` already exists, the CLI merges MCP entries into it and
preserves unrelated settings (existing same-name MCP definitions take precedence).

### Claude Code as a plugin

```sh
./cli/helix.mjs plugin --out ~/helix-marketplace
claude plugin marketplace add ~/helix-marketplace && claude plugin install helix@helix-harness
./cli/helix.mjs init ~/your-repo --platform claude-code --claude-plugin
```

The plugin carries the agents, skills, hooks and MCP config, so updates are
versioned in one place. A plugin cannot ship `CLAUDE.md` or `permissions`, so
`init --claude-plugin` still writes `AGENTS.md`, the gate and the secret denies
into the repo, and nothing else (no second copy of the hooks, which would run
twice). `claude plugin details helix` reports its projected token cost;
`scripts/measure-plugin.mjs` stores that figure.

## What is verified and what is not

- **Verified against vendor docs (dates per platform matrix)**: Claude hooks,
  subagents and skills; Cursor rules, native subagents, skills and MCP; Codex
  agents, skills, hooks and MCP; OpenCode subagents, skills and MCP; Antigravity
  subagents, skills and MCP; VS Code MCP schema. Each catalog entry carries
  `source` + `verifiedAt`.
- **Measured, not invented**: token counts use o200k_base BPE (an
  approximation, labeled everywhere); MCP schemas come from live `tools/list`
  captures (`scripts/measure-mcp.mjs`) or are flagged as estimates; practice
  statistics carry a confidence label and sources in `src/practices.ts`.
- **Not verified**: see the matrix. Unverified cells emit nothing and claim
  nothing; "all agents" is not a claim this project makes.
- **Illustrative, not measured**: `src/simulation.ts` is a scripted demo of the
  tier routing, not a measurement. Real head-to-head numbers are the committed
  reports in `evals/results/`.

## Evidence so far (read this before trusting any saving)

Nothing yet shows a significant win. Paired runs on a generated 356-file fixture
(opencode free tier, n=5 per cell, 2026-10-09, script `evals/run.mjs`, results in
`evals/results/2026-10-09T11-24-31-opencode.md`): pass rate tied at 30/30, uncached
tokens -8.1% for the Helix arm overall but inside the noise in every cell, total
tokens +2.0%. Model subagents never spawned in either arm, so the role split is
untested there. Full method, caveats and the open follow-up are in
`docs/DECISIONS.md`.

## Platform matrix

Generated from the adapter catalog (`npm test` fails if this drifts). "emitted"
means vendor docs were checked on the date shown and Helix writes real files;
"supported, not emitted" means the vendor documents it but Helix does not write it
yet; "unverified" means neither. Gemini CLI note: Google's own pages confirm it
stopped serving consumer tiers on 2026-06-18 in favor of Antigravity CLI
(discussion 28017 + developers deprecation page, both checked 2026-10-10);
`gemini` is no longer in the default platform list (explicit `--platform gemini`
still works) and its pack paths stay unverified.

<!-- matrix:start -->

| Platform           | verified   | instructions | mcp        | skills     | subagents  | hooks                  | plugin     | structured-output | session-continuation | sandboxing | lsp        |
| ------------------ | ---------- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---------- | ----------------- | -------------------- | ---------- | ---------- |
| Claude Code        | 2026-10-11 | emitted      | emitted    | emitted    | emitted    | emitted                | emitted    | unverified        | unverified           | unverified | unverified |
| Cursor             | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Codex              | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | emitted                | unverified | unverified        | unverified           | unverified | unverified |
| Gemini CLI         | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| GitHub Copilot     | 2026-10-10 | emitted      | emitted    | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Windsurf           | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Cline              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Aider              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| OpenCode           | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Google Antigravity | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | supported, not emitted | unverified | unverified        | unverified           | unverified | unverified |
| Devin CLI          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Factory Droid      | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kiro               | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Amp                | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kilo Code          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |

<!-- matrix:end -->

## How the tiers work

The main session classifies every task and orchestrates (no dispatcher):
**trivial** (one file / question) → main session only; **standard** (known
files, one module) → build, then a fresh-window reviewer; **complex**
(unknown surface or cross-module) → scout → architect → builder → reviewer.
Handoffs are 12-line cards; the Stop hook re-runs the repo suite; the
reviewer answers PASS or FAIL with `file:line`.

## Verify, measure, evaluate

```sh
./cli/helix.mjs doctor ~/your-repo     # exit non-zero on any failure
./cli/helix.mjs measure ~/your-repo    # real token breakdown (method labeled)
node evals/run.mjs --self-check        # grading pipeline, no agent, no cost
```

Doctor checks the AGENTS.md budget (60 lines / ~500 tokens), config schemas,
hook scripts, Graphify freshness, and version pins. Real agent comparisons
are opt-in and never run in CI — details: `evals/README.md`. Full command
reference: `docs/CLI.md`; architecture: `docs/ARCHITECTURE.md`.

## Adding or updating a catalog entry

1. Check the vendor's current docs (Context7 + web fetch).
2. Add `source` (URL) and `verifiedAt` (today's date) to the entry.
3. Add or update a test that would fail if the fact were wrong (golden-file
   tests for generated output, stdin-driven tests for hooks).
4. If you cannot verify it, mark it unverified in notes and emit the minimal
   surface — never ship an unverified claim as fact.
5. Record the decision in `docs/DECISIONS.md` (date, evidence, rejected
   alternatives).

Gates for every commit: `npm run lint && npm run typecheck && npm test`
(Node 22 to match CI). Contributing: `CONTRIBUTING.md`.

## License

MIT — see `LICENSE`.
