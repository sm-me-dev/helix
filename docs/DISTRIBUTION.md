# Helix Distribution & Packaging Architecture

This document outlines the distribution strategy, supported package channels, release automation, and supply chain security for Helix.

---

## 1. Supported Installation & Distribution Channels

| Distribution Channel                      | Target Platform               | Current Status             | Verification Level                                            |
| ----------------------------------------- | ----------------------------- | -------------------------- | ------------------------------------------------------------- |
| **Direct PATH Link (`helix link`)**       | Linux, macOS, WSL             | **Implemented & Verified** | Primary recommended local method; tested end-to-end.          |
| **Source Checkout (`git clone`)**         | Cross-platform (Node >= 22.6) | **Implemented & Verified** | Clean git checkout + `npm ci`; zero global compile step.      |
| **npm Registry (`npx helix` / global)**   | Cross-platform                | **Staged for Release**     | `package.json` configured with `bin`, `engines`, and `files`. |
| **GitHub Releases (Tarball + Checksums)** | Linux, macOS                  | **Automated via CI/CD**    | Artifact packaging on `v*` tags with SHA-256 digests.         |
| **Homebrew Tap (`brew install helix`)**   | macOS, Linux                  | **Staged Formula**         | Formula template prepared for GitHub Release tarballs.        |
| **Debian/Ubuntu APT Repository**          | Linux (Debian, Ubuntu)        | **Evaluated (Post-v1.0)**  | Requires hosted APT repository and GPG signing keys.          |
| **Container Distribution (Docker)**       | Cross-platform containers     | **Evaluated & Rejected**   | Impairs local git worktrees and file permissions.             |

---

## 2. Channel Deep-Dives

### 2.1 Direct PATH Link (`helix link`) — Recommended

The primary installation method for developers is `helix link`. It creates an executable shell shim at `~/.local/bin/helix` that delegates to your local checkout:

```sh
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix && npm ci
./cli/helix.mjs link
```

**Advantages**:

- Zero build or compilation step needed (Node 22.6+ strips TypeScript types natively).
- Immediate, frictionless updates: running `git pull` instantly updates your CLI.
- Safe uninstallation: `helix unlink` cleans up the shim and PATH entries.

---

### 2.2 npm Package Distribution

Helix is configured for npm registry distribution under `@sm-me/helix` or `helix`:

```sh
# One-shot execution
npx helix init ~/my-repo

# Global installation
npm install -g helix
```

#### npm Packaging Specifications:

- **Executable**: `cli/helix.mjs` mapped via `"bin": { "helix": "cli/helix.mjs" }`.
- **Runtime Dependencies**: Strictly bounded to `gpt-tokenizer` (`o200k_base` BPE).
- **Engine Constraint**: Enforces `"engines": { "node": ">=22.6" }`.
- **Whitelisted Files**: Only `cli/`, `src/`, `LICENSE`, and `README.md` are published; tests, reports, and scratch files are omitted.

---

### 2.3 GitHub Releases & Standalone Archives

For continuous delivery, every tagged release (`v*`) triggers GitHub Actions to produce platform-agnostic source archives and platform-specific tarballs:

- `helix-vX.Y.Z.tar.gz`
- `helix-vX.Y.Z.zip`
- `SHA256SUMS.txt` (SHA-256 digests of all released assets)

#### Verification Procedure:

```sh
# 1. Download archive and checksums
curl -LO https://github.com/sm-me-dev/helix/releases/download/v0.1.0/helix-v0.1.0.tar.gz
curl -LO https://github.com/sm-me-dev/helix/releases/download/v0.1.0/SHA256SUMS.txt

# 2. Verify integrity
sha256sum --check --ignore-missing SHA256SUMS.txt

# 3. Extract and link
tar -xzf helix-v0.1.0.tar.gz -C ~/helix
cd ~/helix && npm ci --production
./cli/helix.mjs link
```

---

### 2.4 Homebrew Tap Specification

A dedicated Homebrew tap (`sm-me-dev/homebrew-helix`) provides native installation for macOS and Linux users:

```sh
brew tap sm-me-dev/helix
brew install helix
```

#### Formula Specification (`Formula/helix.rb`):

```ruby
class Helix < Formula
  desc "AI coding harness with bounded context and zero-token mechanical gates"
  homepage "https://github.com/sm-me-dev/helix"
  url "https://github.com/sm-me-dev/helix/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "<INSERT_COMPUTED_SHA256>"
  license "MIT"

  depends_on "node" => "22.6"

  def install
    system "npm", "ci", "--include=dev"
    libexec.install Dir["*"]
    bin.install_symlink libexec/"cli/helix.mjs" => "helix"
  end

  test do
    assert_match "helix 0.1.0", shell_output("#{bin}/helix --version")
    assert_match "helix — AI coding harness", shell_output("#{bin}/helix --help")
  end
end
```

---

### 2.5 Containerization (Docker) Trade-off Analysis

Distributing Helix as a standalone Docker image was evaluated and **rejected for primary local development** for the following technical reasons:

1. **Filesystem & Permission Mappings**: Helix relies on Git worktrees (`git worktree add`) and real file modifications in the user's repository. Mounting arbitrary host directories into containers creates severe UID/GID ownership mismatches.
2. **Local Agent CLI Integration**: Helix interacts with local agent CLIs (`claude`, `opencode`, `cursor`) installed on the user's host machine. Running Helix in a container disconnects it from host-authenticated agent binaries and native tools.
3. **Recommendation**: Docker is appropriate for headless CI/CD evaluation runners, but local development should use native Node 22.

---

## 3. Supply-Chain Security & Release Protections

Helix enforces strict supply-chain security invariants across all distribution workflows:

1. **SHA-Pinned GitHub Actions**: Every third-party GitHub Action in `.github/workflows/` must be pinned to a full 40-character commit SHA (verified by `scripts/repo-hygiene.test.mjs`). Floating on `@v4` tags is forbidden.
2. **OIDC Tokenless Publishing**: npm publication uses GitHub Actions OIDC (`id-token: write`) instead of long-lived, high-risk NPM tokens.
3. **Least-Privilege Permissions**: Workflows default to `permissions: { contents: read }`. Elevated permissions are granted solely to specific jobs that create releases or publish packages.
4. **Mandatory Quality Gates**: No release artifact can be built or published unless `npm run lint`, `npm run typecheck`, and `npm test` all pass with 100% green status.
5. **No Release on PRs**: Pull requests cannot publish packages or create releases.
