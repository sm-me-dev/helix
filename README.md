# helix

Private workspace — TypeScript + React 19 + TanStack Start/Router + Tailwind v4.
May become public in the future; repo is already hardened for that
(`.gitignore`, `LICENSE`, `SECURITY.md`, no secrets in history).

## Stack

- React 19, TanStack Start / Router / Query / Table, zustand, zod
- Tailwind CSS v4, Radix UI
- Vite 8, TypeScript 5.7, ESLint + Prettier
- Postgres (Neon-ready) via `pg` + Kysely, Better Auth (opt-in)

## Install (one-liner, once public)

```bash
curl --fail --proto '=https' --tlsv1.2 -sSL \
  https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | bash
```

Safer (download → inspect → run), Windows PowerShell, flags, private-repo path,
and troubleshooting: see [`docs/INSTALL.md`](docs/INSTALL.md).

## Getting started (manual)

```bash
npm install
cp .env.example .env   # local only, never commit .env
npm run dev            # http://localhost:8080
```

## Scripts

| Script              | Purpose                       |
| ------------------- | ----------------------------- |
| `npm run dev`       | Dev server on `:8080`         |
| `npm run build`     | Production build + DB migrate |
| `npm run typecheck` | `tsc --noEmit`                |
| `npm run lint`      | ESLint                        |
| `npm run test`      | Node tests                    |
| `npm run format`    | Prettier write                |

## Env

See `.env.example`. Only `VITE_`-prefixed vars reach the browser.
Never commit `.env` or secrets. Production injects `DATABASE_URL` + auth creds.

## Git workflow

- Trunk-based: `main` always deployable, short-lived branches (`feature/…`, `fix/…`, `chore/…`), merge in 1–3 days.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Hooks (Husky + lint-staged): ESLint + Prettier + typecheck on commit, tests on push.
- CI (`.github/workflows/ci.yml`): lint → typecheck → test → build.

## Going public checklist

- [ ] Confirm `LICENSE` (MIT) + copyright holder
- [ ] Remove any internal URLs / screenshots from `README`
- [ ] Rotate any credentials ever committed (none should exist)
- [ ] Enable branch protection on `main` + secret scanning + Dependabot
- [ ] Add `CODEOWNERS` if needed

## License

MIT — see `LICENSE`.
