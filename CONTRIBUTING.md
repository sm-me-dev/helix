# Contributing to Helix

## Prerequisites

- **Node 22** (matches CI; 24+ also works): `node --version`
- Git. Optional: `uv tool install graphifyy` (repo-map backend),
  Playwright Chromium (`npx playwright install chromium`) for browser tests.

## Setup

```sh
git clone https://github.com/sm-me-dev/helix.git && cd helix
npm ci
```

## Gates (every commit must stay green)

```sh
npm run lint && npm run typecheck && npm test
npm run check:auth   # needs the dev server on :8080; exit 2 = could not observe
npm run build
```

Conventions: small commits, [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Do not commit secrets, build
output, or `.env` (see `.env.example`). Never touch `AGENTS.md` (root),
`public/__grok/`, `server/`, or `scripts/grok-pwa-*` — platform chrome.

## How to make a change

1. Branch from `main`, keep the diff focused (~100 lines ideal).
2. Follow `AGENTS.project.md`: the product is `src/lib/harness/`; use
   `graphify query/path/explain` before broad reads where available.
3. Add or update tests first for behavior changes (`cli/*.test.mjs` for CLI
   workflows, `src/lib/harness/*.test.ts` for generation logic).
4. Update `docs/DECISIONS.md` (append-only: date, evidence, rejected
   alternatives) for architectural choices.
5. Run the gates above; inspect `git diff --check`, `git status --short`.

## Adding or updating a verified platform adapter

1. Check the vendor's current docs (Context7 + web fetch).
2. Add the adapter under `src/lib/harness/adapters/` emitting only at paths
   the platform reads; add the catalog entry with `source` (URL) and
   `verifiedAt` (today's date).
3. Add a golden-file test that fails if the fact is wrong (emitted paths,
   config schema, hook protocol).
4. If you cannot verify it, mark it unverified and emit the minimal surface —
   never ship an unverified claim as fact.
5. `npm test` regenerates the README matrix and fails on drift — do not
   hand-edit the matrix.
6. Record the decision in `docs/DECISIONS.md`.

Real agent evaluations (`evals/run.mjs` without `--dry-run`) are opt-in and
must never be wired into CI or ordinary tests.
