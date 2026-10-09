# Helix architecture

The product is the **generated file pack** (`AGENTS.md` + per-platform files

- `.helix/`). The configurator website and the CLI are two thin front ends
  over one generator.

```text
catalogs ──► generatePack ──► pack files ──► repo root
(crew/skills/   (pure: config               CLI init · export ·
 mcps/hooks/     in, files out)             web /export
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

- **Harness core** (`src/lib/harness/`): pure pack generation (`generate.ts`),
  catalogs (`crew/skills/mcps/platforms/practices`), token math (`tokens.ts`,
  measured — never constants), verification gate source (`gate.ts`), repo map
  (`repomap.ts`), measurement (`measure.ts`), evaluation grading (`evals/`).
  No I/O, no framework imports.
- **Platform adapters** (`src/lib/harness/adapters/`): one module per agent.
  Each emits **only** at paths its platform reads; a `seen` set dedupes shared
  paths (e.g. `GEMINI.md`). Every platform fact carries `source` (vendor URL)
  - `verifiedAt`; unverified capabilities emit nothing and claim nothing.
- **CLI** (`cli/`): `helix.mjs` (argv, filesystem, prompts) over pure helpers
  in `cli/lib.ts` (detection, doctor, measure, merge, export). Always runs the
  bundled gate source, never a repo-supplied script. Covered by `cli/*.test.mjs`
  end-to-end in scratch dirs.
- **Web configurator** (`src/routes/`): `/` pitch, `/crew` roles, `/stack`
  skills/MCP/LSP toggles, `/playbook` doctrine flags, `/run` **illustrative**
  timeline, `/evals` committed reports only, `/export` live pack preview. The
  store (`src/lib/store.ts`) builds a `HarnessConfig`; `/export` calls the
  same `generatePack` as the CLI — parity is regression-tested.
- **Hooks & gate**: shipped as `.helix/` scripts. Hooks own format/lint/secret
  denies (no model tokens); the Stop hook re-runs the repo suite. The gate is
  deterministic: secret scan → lint → typecheck → affected tests, exit
  0/1/2. Secret denies cover editor reads, not subprocess file access — the OS
  sandbox is the only enforcement there.
- **Tokens & evals**: `measure`/`report` describe real counts or labeled
  estimates; `/run` simulation is illustrative. Real agent comparisons live in
  `evals/` (opt-in, never CI) and render on `/evals` only from committed JSON.

## Extension points

- **New platform**: verify behavior against current vendor docs, add an
  adapter + catalog entry with `source`/`verifiedAt`, add golden-file tests
  for emitted paths, let the README matrix regenerate (`npm test` fails on
  drift), record in `docs/DECISIONS.md`.
- **New skill / MCP / role**: add the catalog entry, wire the toggle through
  the store and both front ends, keep token math measured.
- **New doctrine flag**: add to `practices.ts` with a confidence badge and
  source; surface on `/playbook`, never as an unverified claim.
