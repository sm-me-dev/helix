# Helix — a coding harness that earns its tokens

Helix is a drop-in harness for AI coding agents: tier-routed roles, repo-map
first context (Graphify when present, a built-in outline otherwise), skills that
load on demand, and one portable gate command. Full support exists only where the
vendor docs were checked: see the platform matrix below. Everywhere else the pack
is AGENTS.md plus at most a pointer file.
The product is the generated file pack; this repo's website is the
configurator that builds it.

## 60-second install

```sh
git clone <this-repo> && cd helix && npm ci
./cli/helix.mjs init ~/your-repo --platform claude-code,codex
```

`helix init` detects the stack (language, package manager, test/lint/format
commands, existing agent files), then writes the pack. It never overwrites an
existing file without showing a diff and asking — pass `--force` to skip the
prompt. Requires Node 22.6+ (type stripping, no build step).

## What is verified and what is not

- **Verified 2026-10-07 against vendor docs**: Claude hook protocol (stdin
  JSON, exit codes), subagent frontmatter (`tools`, `model`, delegating
  `description`), skill paths, MCP config keys per platform (VS Code
  `servers`+`type`, Claude/Cursor `mcpServers`, Codex `config.toml`), Cursor
  rules/MCP, Codex skills. Each catalog entry carries `source` + `verifiedAt`.
- **Measured, not invented**: token counts use o200k_base BPE (an
  approximation, labeled everywhere); MCP schemas come from live `tools/list`
  captures (`scripts/measure-mcp.mjs`) or are flagged as estimates; practice
  statistics carry confidence badges on `/playbook`.
- **Not verified**: see the matrix. Unverified cells emit nothing and claim
  nothing; "all agents" is not a claim this project makes.
- **Illustrative, not measured**: the `/run` timeline and the sample graph.
  Real head-to-head numbers live on `/evals` once a report is committed.

## Platform matrix

Generated from the adapter catalog (`npm test` fails if this drifts). "emitted"
means vendor docs were checked on the date shown and Helix writes real files;
"supported, not emitted" means the vendor documents it but Helix does not write it
yet; "unverified" means neither. Gemini CLI note: press reports say it was shut
down for consumer tiers on 2026-06-18 in favor of Antigravity CLI; no Google
primary page was checked, so those paths stay unverified.

<!-- matrix:start -->

| Platform           | verified   | instructions | mcp        | skills     | subagents              | hooks      | plugin     |
| ------------------ | ---------- | ------------ | ---------- | ---------- | ---------------------- | ---------- | ---------- |
| Claude Code        | 2026-10-07 | emitted      | emitted    | emitted    | emitted                | emitted    | unverified |
| Cursor             | 2026-10-07 | emitted      | emitted    | unverified | unverified             | unverified | unverified |
| Codex              | 2026-10-07 | emitted      | emitted    | emitted    | supported, not emitted | unverified | unverified |
| Gemini CLI         | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| GitHub Copilot     | 2026-10-07 | emitted      | emitted    | unverified | unverified             | unverified | unverified |
| Windsurf           | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Cline              | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Aider              | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| OpenCode           | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Google Antigravity | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Devin CLI          | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Factory Droid      | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Kiro               | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Amp                | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |
| Kilo Code          | no         | unverified   | unverified | unverified | unverified             | unverified | unverified |

<!-- matrix:end -->

## How the tiers work

The main session classifies every task and orchestrates — there is no
dispatcher subagent:

| Tier     | When                               | Flow                                   |
| -------- | ---------------------------------- | -------------------------------------- |
| trivial  | one file, clear ask, or a question | main session only                      |
| standard | known files, one module            | build, then a fresh-window reviewer    |
| complex  | unknown surface or cross-module    | scout → architect → builder → reviewer |

Handoffs are 12-line cards (goal, constraints, cited files, done-means, out
of scope). The builder writes the smallest failing test first; the Stop hook
re-runs the repo suite; the reviewer checks plan vs diff vs test output in a
fresh window and answers PASS or FAIL with `file:line`.

## Reading `helix doctor` output

```sh
./cli/helix.mjs doctor ~/your-repo
```

Checks: `AGENTS.md` parses and stays under 60 lines / ~500 tokens; every
emitted JSON/TOML config parses and matches its platform shape; hook scripts
referenced by settings exist and run clean on sample input; no duplicate
skills; MCP count with per-server measured-vs-estimate tokens; Graphify index
freshness vs `git rev-parse HEAD`; unpinned versions flagged. Exit non-zero on
any failure. `helix measure` prints the token breakdown; `helix export
--platform <id>` prints the pack as JSON for scripted use.

## Running evals

Real runs cost money and wall time: opt-in only, never in CI.

```sh
node evals/run.mjs --agent codex --arms none,helix --runs 3 --dry-run  # plan only
node evals/run.mjs --self-check   # grading pipeline, no agent
node evals/run.mjs --agent codex --arms none,helix --runs 3
```

Six tasks (bug fix, feature, cross-module refactor, ambiguous ask, docs-only
spec, secret-file trap) run headless in clean fixture copies. Reports land in
`evals/results/` and render on `/evals`. Details: `evals/README.md`.

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
(needs Node 22 to match CI; green on 24/26 too).

## Routes (configurator)

| Route       | Purpose                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `/` Studio  | Pitch + live token stats                                                       |
| `/crew`     | The four roles — enable, inspect, read each contract                           |
| `/stack`    | Skills / MCP / LSP toggles with measured-or-labeled costs + leanness checklist |
| `/playbook` | Doctrine flags with confidence badges and sources                              |
| `/run`      | **Illustrative** fix timeline — scripted, live-scaled tokens                   |
| `/evals`    | Real eval reports (empty until one is committed)                               |
| `/export`   | Generated pack: preview, copy, or download per file or as text                 |

## License

MIT — see `LICENSE`.
