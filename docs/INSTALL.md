# Install helix

> **Which install do you want?**
>
> - **The harness pack** (the product: `AGENTS.md` + skills + hooks for your repo) —
>   `git clone` this repo, `npm ci`, then `./cli/helix.mjs init ~/your-repo`
>   (see README for flags). Or open `/export` in the app, copy or download the
>   pack, and follow its README (`uv tool install graphifyy`, `graphify install`,
>   `/graphify .`).
> - **This website** (the configurator demo) — continue below.

The `helix` CLI needs Node 22.6+ (it runs TypeScript directly via type
stripping); the website itself runs on Node 20+ with 22 LTS recommended.

Two supported paths: the **one-liner** (fastest) and the **download → inspect → run** path (safest).
Both end in the same place: a user-space checkout (default `~/helix`) with dependencies installed.

> While this repo is **private**, the `raw.githubusercontent.com` URLs below return 404
> for anyone without access. Use the **private-repo path** (git clone) until it goes public.

## Requirements

| Tool         | Minimum         | Recommended | Notes                                                  |
| ------------ | --------------- | ----------- | ------------------------------------------------------ |
| Git          | any recent      | —           | `git --version`                                        |
| Node.js      | v20             | v22 LTS     | `node --version` — installer offers user-space options |
| npm          | ships with Node | —           | no sudo needed                                         |
| curl or wget | one of them     | curl        | installer uses whichever exists                        |

OS support: **Linux** (apt/dnf/apk + fnm path), **macOS** (Homebrew path),
**WSL2** (Linux path), **Git Bash** (Node via winget note), and **native Windows**
via `scripts/install.ps1` (PowerShell 5.1+/7+, winget path).

## Option A — one-liner (once public)

```bash
curl --fail --proto '=https' --tlsv1.2 -sSL \
  https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | bash
```

With options (passed after `--`):

```bash
curl --fail --proto '=https' --tlsv1.2 -sSL \
  https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh \
  | bash -s -- --dir ~/code/helix --ref main --skip-playwright
```

## Option B — download, inspect, run (recommended)

```bash
curl --fail --proto '=https' --tlsv1.2 -sSL \
  https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh \
  -o /tmp/helix-install.sh
less /tmp/helix-install.sh   # read it — 5 minutes that matter
bash /tmp/helix-install.sh --dry-run   # preview, changes nothing
bash /tmp/helix-install.sh
rm /tmp/helix-install.sh
```

Pin to a reviewed commit for auditability:

```bash
# replace <sha> with a commit you reviewed
curl --fail --proto '=https' --tlsv1.2 -sSL \
  https://raw.githubusercontent.com/sm-me-dev/helix/<sha>/scripts/install.sh \
  -o /tmp/helix-install.sh
bash /tmp/helix-install.sh --ref <sha>
```

## Private repo (works today)

```bash
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix
bash scripts/install.sh --dir ~/helix --yes
```

`GH_TOKEN` is honored for HTTPS clone auth. Or `gh auth login` first.

## Windows (native PowerShell)

```powershell
# Inspect first, then run:
notepad .\scripts\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Dir "$HOME\helix"

# Common variants:
powershell -File .\scripts\install.ps1 -DryRun
powershell -File .\scripts\install.ps1 -SkipPlaywright -Yes
```

Missing toolchain on Windows:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
```

## Flags

| Flag                                    | Script(s) | Effect                                                    |
| --------------------------------------- | --------- | --------------------------------------------------------- |
| `--dir PATH` / `-Dir`                   | both      | Install location (env: `HELIX_DIR`)                       |
| `--ref REF` / `-Ref`                    | both      | Branch, tag, or commit (env: `HELIX_REF`, default `main`) |
| `--yes` / `-Yes`                        | both      | Non-interactive                                           |
| `--dry-run` / `-DryRun`                 | both      | Print actions, change nothing                             |
| `--skip-node` / `-SkipNode`             | both      | Leave Node.js alone                                       |
| `--skip-deps` / `-SkipDeps`             | both      | Skip `npm ci`                                             |
| `--skip-playwright` / `-SkipPlaywright` | both      | Skip Chromium download                                    |
| `--no-verify` / `-NoVerify`             | both      | Skip `npm run typecheck`                                  |
| `--trace`                               | bash only | `set -x` debugging                                        |
| `--help` / `--version`                  | both      | Help / version                                            |

## What the installer does

1. Detects OS (`Linux` / `macOS` / `WSL` / `Git Bash`) and architecture.
2. Checks `git`, `curl`/`wget`, `node (>=20, prefers 22)`, `npm`.
   - macOS: offers Homebrew `node@22`.
   - Linux: prefers user-space `fnm`; system package managers are flagged (need sudo).
   - Git Bash / Windows: points at `winget` (PowerShell script does the rest natively).
3. Clones (`--depth 1`) or fast-forward-updates the checkout. Never deletes a non-git directory.
4. Copies `.env.example` → `.env` **only if `.env` is missing**.
5. Runs `npm ci` (fallback: `npm install`), then Playwright **Chromium only**, then `npm run typecheck`.
6. Prints next steps. Re-running is safe (idempotent).

The installer never uses `sudo`, never writes outside the target dir (plus `~/.local/bin` fallbacks avoided entirely — no binaries are installed globally), and never overwrites `.env`.

## Verify it worked

```bash
cd ~/helix
node --version   # want v22.x
npm run typecheck
npm run lint
npm run dev      # http://localhost:8080
```

## Update

```bash
cd ~/helix
git pull --ff-only
npm ci --no-audit --no-fund
npm run typecheck
# or: bash scripts/install.sh --dir ~/helix  (updates in place)
```

## Uninstall

No system changes were made, so removal is deletion:

```bash
rm -rf ~/helix
# optional caches:
rm -rf ~/.npm ~/.cache/ms-playwright
```

## Troubleshooting

| Symptom                          | Fix                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `curl: (22) 404` on the raw URL  | Repo is still private — use the git-clone path above                                                  |
| `git clone` → auth failure       | `gh auth login`, or `GH_TOKEN=ghp_... bash scripts/install.sh`                                        |
| Node too old / missing           | Install Node 22 LTS (https://nodejs.org), or `fnm install 22`, or re-run with `--skip-node`           |
| `npm ci` fails on lockfile drift | Installer auto-falls-back to `npm install`; commit the updated lockfile                               |
| Playwright download fails        | Offline or restricted network — `--skip-playwright`, install later: `npx playwright install chromium` |
| `port 8080 in use`               | `npm run dev -- --port 8081`, or free the port: `lsof -i :8080`                                       |
| Windows `ExecutionPolicy` error  | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` (current process only)                 |

## Security notes

- `curl | bash` trusts the server, TLS, and every byte in between. TLS stops passive
  tampering but not a compromised origin. Prefer **Option B** for anything you care about.
- Always fetch over HTTPS with `--fail --proto '=https' --tlsv1.2` (as in the examples).
- The installer runs in user space only. If any step ever asks for `sudo`, stop and inspect.
- Never commit `.env`. The installer will not overwrite it, CI never prints it.
- For high-value machines, pin `--ref` to a reviewed commit SHA instead of `main`.
