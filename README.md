# Helix — a crew for every agent

Helix is a drop-in harness for AI coding agents (Claude Code, Cursor, Codex, Gemini,
Copilot, and the rest of the AGENTS.md family): six specialized roles, Graphify-first
context, skills that load on demand — tuned so the model spends attention on the change,
not the repo.

**This app is the configurator.** Toggle the crew, stack, and playbook rails, watch the
always-on token index move, scrub a simulated fix on `/run`, then export a file pack on
`/export` and drop it at any repo root.

## Routes

| Route       | Purpose                                                              |
| ----------- | -------------------------------------------------------------------- |
| `/` Studio  | Pitch + live token stats + crew/graph previews                       |
| `/crew`     | The six roles — enable, inspect, read each contract                  |
| `/stack`    | Skills / MCP / LSP toggles with schema-token costs                   |
| `/playbook` | Four doctrine flags that rewrite the generated AGENTS.md             |
| `/run`      | **Simulated** fix (LED-1841) — scripted timeline, live-scaled tokens |
| `/export`   | Generated pack: preview, copy, or download per file or as text       |

Token figures are **illustrative estimates** computed live from your toggles
(see the methodology note on `/run`), not measured runs.

## Install the harness pack (the product)

On `/export`: copy or download the pack, drop the files at a repo root, then:

```
uv tool install graphifyy
graphify install
```

then inside the assistant: `/graphify .` (Codex: `$graphify`).

## Run this website (the demo)

```bash
npm install
cp .env.example .env   # local only, never commit .env
npm run dev            # http://localhost:8080
```

Full installer options (one-liner, Windows PowerShell, flags, troubleshooting):
see [`docs/INSTALL.md`](docs/INSTALL.md) — it covers **this website only**.

## Scripts

| Script              | Purpose                        |
| ------------------- | ------------------------------ |
| `npm run dev`       | Dev server on `:8080`          |
| `npm run build`     | Production build + DB migrate  |
| `npm run typecheck` | `tsc --noEmit`                 |
| `npm run lint`      | ESLint                         |
| `npm run test`      | Node tests (scripts + harness) |
| `npm run format`    | Prettier write                 |

## Env

See `.env.example`. Only `VITE_`-prefixed vars reach the browser.
Never commit `.env` or secrets. Production injects `DATABASE_URL` + auth creds.

Auth and database are pre-wired but **opt-in**: the configurator itself runs entirely
client-side (zustand + `localStorage`) with no login required.

## Git workflow

- Trunk-based: `main` always deployable, short-lived branches, merge in 1–3 days.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Hooks (Husky + lint-staged): ESLint + Prettier on commit, typecheck on push.
- CI: lint → typecheck → test → build, plus ShellCheck on `scripts/`.

## Going public checklist

- [ ] Confirm `LICENSE` (MIT) + copyright holder
- [ ] Remove any internal URLs / screenshots from docs
- [ ] Rotate any credentials ever committed (none should exist)
- [ ] Enable branch protection on `main` + secret scanning + Dependabot
- [ ] Add `CODEOWNERS` if needed

## License

MIT — see `LICENSE`.
