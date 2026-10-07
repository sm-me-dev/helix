# Helix contributor rules

Helix is an AI coding harness. The product is the generated file pack in
`src/lib/harness/` — the configurator website around it is scaffolding.

## Gates (run on Node 22 to match CI; Node 24 also accepted)

```sh
npm run lint && npm run typecheck && npm test
```

Keep every commit green. Small commits, Conventional Commits.

## Where things live

- Pack generation: `src/lib/harness/generate.ts` (product).
- Catalogs: `src/lib/harness/{crew,skills,mcps,lsps,platforms,practices}.ts`.
- Token math: `src/lib/harness/tokens.ts` — no hardcoded constants; every
  number shown in the UI must come from a script in this repo, with the
  method and date stored beside it.

## Verification rule (non-negotiable)

Every platform fact (hook protocol, agent frontmatter fields, MCP config
schema and key names, skill locations) must be checked against the vendor's
current docs before it ships. Record each as a catalog entry with `source`
(URL) and `verifiedAt` (date). If you cannot verify a fact, say so in
`docs/DECISIONS.md` and do not ship it as fact.

## Graphify first

Use `graphify query/path/explain` before broad reads; run `graphify update .`
after edits. Read only cited line ranges.

## Ignore list

- `.grok/skills` (game/sprite/3D generation skills) is Grok App Builder
  platform chrome — irrelevant to this project. Never import from it, and
  keep it out of the graph via `.graphifyignore`.
- Do not touch `public/__grok/`, `server/`, `scripts/grok-pwa-*`,
  `.vercel/`, the branding injector, or the root `AGENTS.md` (Grok sandbox
  contract).
