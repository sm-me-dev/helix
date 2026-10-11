# Helix architecture

The product is the **generated file pack** (`AGENTS.md` + per-platform files +
`.helix/`). The CLI is a thin front end over one pure generator.

```text
catalogs ──► generatePack ──► pack files ──► repo root
(crew/skills/   (pure: config               CLI init · export ·
 mcps/hooks/     in, files out)             plugin
 platforms/
 practices)
     ▲                  │
     │                  ▼
vendor docs      gate.mjs · hooks · map
(source +        (run in the target repo,
 verifiedAt       zero model tokens)
 per entry)
```

## Boundaries

- **Harness core** (`src/`): pure pack generation (`generate.ts`),
  catalogs (`crew/skills/mcps/platforms/practices`), token math (`tokens.ts`,
  measured — never constants), verification gate source (`gate.ts`), repo map
  (`repomap.ts`), measurement (`measure.ts`), evaluation grading (`evals/`).
  No I/O, no framework imports.
- **Platform adapters** (`src/adapters/`): one module per agent.
  Each emits **only** at paths its platform reads; a `seen` set dedupes shared
  paths (e.g. `GEMINI.md`). Every platform fact carries `source` (vendor URL)
  - `verifiedAt`; unverified capabilities emit nothing and claim nothing.
    The canonical matrix covers instructions, MCP, skills, subagents, hooks,
    plugin, structured-output, session-continuation, sandboxing, and LSP. The
    last four are tracked as `unverified` until checked against vendor docs —
    they shape the README matrix but emit no files today.
- **Workflows** (`src/workflow.ts`): risk-aware selection over
  `trivial` / `standard` / `complex` plus `ambiguous` (blocks for a question)
  and `securitySensitive` (forces independent verification). States
  `classified → discovered → planned → implemented → verifying → completed`
  with legitimate skips and a `blocked` escape; handoffs are validated
  12-line cards (goal, constraints, cited files, done-means, out of scope).
- **CLI** (`cli/`): `helix.mjs` (argv, filesystem, prompts) over pure helpers
  in `cli/lib.ts` (detection, doctor, measure, merge, export). Always runs the
  bundled gate source, never a repo-supplied script. Covered by `cli/*.test.mjs`
  end-to-end in scratch dirs.
- **Website**: gone from this repo. The old website lives on the
  `grok-workspace` branch (tag `pre-split` marks the last shared commit). Any
  future front end consumes `generatePack` as a library.
- **Hooks & gate**: shipped as `.helix/` scripts. Hooks own format/lint/secret
  denies (no model tokens); the Stop hook re-runs the repo suite. The gate is
  deterministic: secret scan → lint → typecheck → affected tests, exit
  0/1/2. Secret denies cover editor reads, not subprocess file access — the OS
  sandbox is the only enforcement there.
- **Tokens & evals**: `measure`/`report` describe real counts or labeled
  estimates; `src/simulation.ts` is an illustrative demo. Real agent comparisons
  live in `evals/` (opt-in, never CI); only committed JSON under `evals/results/`
  may back a headline number.

## Extension points

- **New platform**: verify behavior against current vendor docs, add an
  adapter + catalog entry with `source`/`verifiedAt`, add golden-file tests
  for emitted paths, let the README matrix regenerate (`npm test` fails on
  drift), record in `docs/DECISIONS.md`.
- **New skill / MCP / role**: add the catalog entry, wire it through
  `generate.ts` and the CLI defaults, keep token math measured.
- **New doctrine flag**: add to `practices.ts` with a confidence badge and
  source; never as an unverified claim.
