# Helix contributor rules

Helix is an AI coding harness. The product is the generated file pack
(`src/generate.ts` + `src/adapters/`), the CLI (`cli/`) and the evals (`evals/`).

## Gates (run on Node 22 to match CI; Node 24 also accepted)

```sh
npm run lint && npm run typecheck && npm test
```

Keep every commit green. Small commits, Conventional Commits.

## Where things live

- Pack generation: `src/generate.ts` (product); one adapter per platform in `src/adapters/`.
- Catalogs: `src/{crew,skills,mcps,platforms,practices}.ts`.
- Token math: `src/tokens.ts` — no hardcoded constants; every number shown
  anywhere must come from a script in this repo, with the method and date
  stored beside it.

## Verification rule (non-negotiable)

Every platform fact (hook protocol, agent frontmatter fields, MCP config
schema and key names, skill locations) must be checked against the vendor's
current docs before it ships. Record each as a catalog entry with `source`
(URL) and `verifiedAt` (date). If you cannot verify a fact, say so in
`docs/DECISIONS.md` and do not ship it as fact.

## Graphify first

Use `graphify query/path/explain` before broad reads; run `graphify update .`
after edits. Read only cited line ranges.
