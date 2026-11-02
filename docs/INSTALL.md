# Installing Helix

Helix is an AI coding harness engineered to maximize coding agent success while strictly controlling token consumption, execution latency, and coordination overhead.

---

## 1. System Requirements

- **Runtime**: **Node.js 22.6+** (Helix executes TypeScript natively via Node's experimental type stripping; no global build or transpilation step is required).
- **VCS**: **Git 2.30+** (required for ephemeral worktree isolation and diff extraction).
- **Operating System**: Linux, macOS, or Windows via WSL2.
- **Optional Knowledge Graph**: `uv tool install graphifyy` (for semantic graph retrieval; built-in structural outline fallback is used if absent).

---

## 2. Recommended Installation: Direct PATH Link

The fastest and most maintainable way to use Helix is by linking a local repository checkout to your system `PATH`:

```sh
# 1. Clone the repository
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix

# 2. Install dependencies
npm ci

# 3. Create a PATH link
./cli/helix.mjs link
```

### What `helix link` Does:

- Creates an executable shim at `~/.local/bin/helix` that delegates to your checkout.
- If `~/.local/bin` is not already in your `PATH`, it offers to add an exported line to your shell configuration (`~/.bashrc` or `~/.zshrc`).
- Pass `--modify-rc` to approve automatic shell file configuration, or `--no-modify-rc` to configure it manually.

---

## 3. Alternative Installation Methods

### Option A: Direct Repository Checkout (No System Changes)

You can run Helix directly without modifying your system `PATH`:

```sh
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix && npm ci
node cli/helix.mjs --help
```

### Option B: npm Global Installation (Staged)

Once published to npm:

```sh
npm install -g helix
```

### Option C: Claude Code Plugin

Install Helix as a native Claude Code plugin marketplace bundle:

```sh
node cli/helix.mjs plugin --out ~/helix-marketplace
claude plugin marketplace add ~/helix-marketplace
claude plugin install helix@helix-harness
```

---

## 4. Verifying Installation

Verify that the CLI is correctly installed and accessible:

```sh
# Check version
helix --version

# Check help and available subcommands
helix --help
```

Expected output:

```text
helix 0.9.0
```

---

## 5. First-Time Execution

Once installed, try running Helix on a repository:

```sh
# 1. Initialize a harness pack for your target project
helix init ~/your-project --platform claude-code

# 2. Verify repository health and pack integrity
helix doctor ~/your-project

# 3. Execute a dry-run task planning test
helix run "Fix bug in calculation module" --dry
```

---

## 6. Upgrading

Because `helix link` delegates to your local checkout, updating is as simple as pulling the latest changes:

```sh
cd ~/helix
git pull --ff-only
npm ci
```

---

## 7. Uninstallation

To cleanly remove Helix from your system:

```sh
# 1. Remove the ~/.local/bin/helix shim and shell PATH additions
cd ~/helix && helix unlink

# 2. Delete the repository checkout
cd ~ && rm -rf ~/helix
```

Without `helix link`, Helix makes zero persistent changes to your operating system.

---

## 8. Common Installation Issues

For detailed solutions to common installation and runtime errors, see [Troubleshooting & FAQ](docs/TROUBLESHOOTING.md).

| Symptom                    | Cause                           | Solution                                                      |
| -------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `helix: command not found` | `~/.local/bin` not in `$PATH`   | Run `node cli/helix.mjs link --modify-rc` and restart shell.  |
| `permission denied`        | Missing execute permission      | Run `chmod +x cli/helix.mjs`.                                 |
| `Node too old`             | Node version is older than 22.6 | Install Node 22 LTS via `fnm install 22` or `nvm install 22`. |
| `npm ci` skips dev deps    | `NODE_ENV=production` set       | Run `npm ci --include=dev`.                                   |
