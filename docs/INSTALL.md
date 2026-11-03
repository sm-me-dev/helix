# Installing Helix

Helix is an AI coding harness engineered to maximize coding agent success while strictly controlling token consumption, execution latency, and coordination overhead.

Helix can be installed and updated without cloning its source repository.

---

## 1. Quick Installation Channels

### 1.1 Global npm (Recommended for Node Users)

Install globally via npm:

```sh
npm install -g @sm-me-dev/helix
```

Or execute directly without a permanent installation:

```sh
npx @sm-me-dev/helix --help
```

**Requirements**: Node.js >= 22.6, Git >= 2.30.

---

### 1.2 Universal Standalone Installer (Linux & macOS)

For systems without Node.js installed, the universal installer downloads a self-contained application bundle with an embedded Node runtime:

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh
```

#### Installer Features:

- Automatically detects OS (`linux`, `darwin`) and CPU architecture (`x64`, `arm64`).
- Downloads the official release bundle and verifies its SHA-256 digest against `SHA256SUMS.txt`.
- Installs to `~/.local/lib/helix` (or `/usr/local/lib/helix` if run as root) and creates an executable symlink in `~/.local/bin/helix`.
- Requires zero system dependencies beyond `curl`/`wget` and standard shell utilities.

#### Customizing Installation:

```sh
# Specify explicit release version
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh -s -- --version 0.1.0

# Custom binary and library directories
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh -s -- --dir /opt/helix --bin-dir /usr/local/bin
```

---

### 1.3 Homebrew (macOS & Linux)

Install via official tap:

```sh
brew install sm-me-dev/tap/helix
```

Updates are managed through Homebrew:

```sh
brew update && brew upgrade helix
```

---

### 1.4 Debian & Ubuntu (APT)

Add the signed repository and install:

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install-apt.sh | sudo sh
```

Or download the `.deb` package directly from [GitHub Releases](https://github.com/sm-me-dev/helix/releases/latest):

```sh
sudo dpkg -i helix_0.1.0_linux_amd64.deb
```

---

### 1.5 Fedora & RHEL (RPM)

Download the `.rpm` package from [GitHub Releases](https://github.com/sm-me-dev/helix/releases/latest) and install via `dnf`:

```sh
sudo dnf install helix-0.1.0-1.x86_64.rpm
```

---

### 1.6 Windows (PowerShell)

Install via the official PowerShell installer:

```powershell
irm https://sm-me-dev.github.io/helix/install.ps1 | iex
```

Or using Windows package managers:

```powershell
# WinGet
winget install sm-me-dev.Helix

# Scoop
scoop bucket add helix https://github.com/sm-me-dev/helix
scoop install helix
```

---

## 2. Standalone Release Archives (Manual Download)

Pre-built self-contained archives are published with every release on [GitHub Releases](https://github.com/sm-me-dev/helix/releases):

| Platform    | Architecture                | Release Artifact                   |
| ----------- | --------------------------- | ---------------------------------- |
| **Linux**   | x64 (AMD64)                 | `helix-v0.1.0-linux-x64.tar.gz`    |
| **Linux**   | ARM64 (aarch64)             | `helix-v0.1.0-linux-arm64.tar.gz`  |
| **macOS**   | Apple Silicon (M1/M2/M3/M4) | `helix-v0.1.0-darwin-arm64.tar.gz` |
| **macOS**   | Intel (x86_64)              | `helix-v0.1.0-darwin-x64.tar.gz`   |
| **Windows** | x64 (AMD64)                 | `helix-v0.1.0-windows-x64.zip`     |

### Manual Verification and Extraction:

```sh
# 1. Download release archive and checksums
curl -LO https://github.com/sm-me-dev/helix/releases/download/v0.1.0/helix-v0.1.0-linux-x64.tar.gz
curl -LO https://github.com/sm-me-dev/helix/releases/download/v0.1.0/SHA256SUMS.txt

# 2. Verify SHA-256 checksum
sha256sum --check --ignore-missing SHA256SUMS.txt

# 3. Extract and link
mkdir -p ~/.local/lib/helix ~/.local/bin
tar -xzf helix-v0.1.0-linux-x64.tar.gz -C ~/.local/lib/helix --strip-components=1
ln -sf ~/.local/lib/helix/bin/helix ~/.local/bin/helix
```

---

## 3. Contributor & Source Installation

For developers contributing directly to Helix:

```sh
git clone https://github.com/sm-me-dev/helix.git ~/helix
cd ~/helix
npm ci
./cli/helix.mjs link
```

`helix link` creates an executable shim in `~/.local/bin/helix` that delegates to your checkout. Running `git pull` instantly updates your development installation.

---

## 4. Verifying Installation

Verify that the CLI is correctly installed:

```sh
# Verify version
helix --version

# Check help and subcommands
helix --help

# Verify environment and health
helix doctor
```

---

## 5. Next Steps

- [Updating Helix](UPDATING.md) — How to upgrade your installation.
- [Uninstalling Helix](UNINSTALLING.md) — Clean removal without data loss.
- [Platform Support Matrix](PLATFORM_SUPPORT.md) — Tested architectures and features.
- [Quick Start Guide](QUICKSTART.md) — Running your first autonomous coding task.
