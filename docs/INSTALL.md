# Install Helix

Helix is a CLI that writes an agent harness pack into your repo. It needs
**Node 22.6+** (it runs TypeScript directly via type stripping; there is no build
step) and git. Optional: `uv tool install graphifyy` for the repo-map backend.

```sh
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix && npm ci
./cli/helix.mjs link                         # puts a `helix` command on your PATH
helix init ~/your-repo                      # detects agents and stack
helix doctor ~/your-repo                    # exits non-zero on any failure
helix ui ~/your-repo                        # local web view
```

`helix link` writes a small shim, `~/.local/bin/helix`, that runs this checkout (the CLI needs the
repo's `node_modules`, so keep the checkout where it is). If `~/.local/bin` is not on your `PATH`, it
offers to add one marked line to your `.zshrc`/`.bashrc` (`--modify-rc` says yes, `--no-modify-rc` says
no; other shells get the line to paste). `helix unlink` removes both. Windows is not supported yet.

`init` never overwrites a differing file without `--force`. Flags and every other
command: `docs/CLI.md`. What gets written, and why: `README.md`.

## Claude Code as a plugin

See "Claude Code as a plugin" in `README.md` (`helix plugin`, `helix init --claude-plugin`).

## Update

```sh
cd ~/helix && git pull --ff-only && npm ci
helix init ~/your-repo                      # keeps differing files unless --force
```

## Uninstall

Run `helix unlink` (removes the shim and the PATH line), delete the checkout (`rm -rf ~/helix`) and
the files `init` wrote into your repo (listed in `.helix/README.md` there). Without `helix link`,
Helix makes no system changes.

## Troubleshooting

| Symptom                                | Fix                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `permission denied` on `cli/helix.mjs` | `chmod +x cli/helix.mjs`, or run `node cli/helix.mjs`                   |
| `npm ci` skips dev dependencies        | `NODE_ENV=production` is exported in your shell: `npm ci --include=dev` |
| `doctor` reports the graph missing     | Install Graphify, then run `graphify update .` in your repo             |
| Node too old                           | Install Node 22 LTS (https://nodejs.org) or `fnm install 22`            |
