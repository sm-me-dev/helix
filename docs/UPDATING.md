# Updating Helix

Helix includes built-in installation detection and upgrade guidance via `helix update`.

---

## 1. Automatic Update Check (`helix update`)

To inspect your current installation channel and check for updates, run:

```sh
helix update
```

Helix will detect whether it was installed via npm, Homebrew, APT, RPM, the standalone universal installer, or a Git development checkout, and output the exact update command.

---

## 2. Updating by Distribution Channel

### 2.1 npm Global Installation

```sh
npm install -g @sm-me-dev/helix@latest
```

To verify the updated version:

```sh
helix --version
```

---

### 2.2 Standalone Universal Installer (Linux & macOS)

Re-run the universal installer to download and replace the application bundle with the latest version:

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh
```

Or specify an exact version:

```sh
curl -fsSL https://sm-me-dev.github.io/helix/install.sh | sh -s -- --version 0.2.0
```

_Note: Your project worktrees and configuration are never touched during upgrades._

---

### 2.3 Homebrew

```sh
brew update
brew upgrade helix
```

---

### 2.4 Debian & Ubuntu (APT)

```sh
sudo apt update
sudo apt install --only-upgrade helix
```

---

### 2.5 Fedora, RHEL & AlmaLinux (RPM)

```sh
sudo dnf upgrade helix
```

---

### 2.6 Windows

#### PowerShell Installer:

```powershell
irm https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.ps1 | iex
```

#### WinGet:

```powershell
winget upgrade sm-me-dev.Helix
```

#### Scoop:

```powershell
scoop update helix
```

---

### 2.7 Contributor / Git Checkout

For local checkouts configured via `helix link`:

```sh
cd ~/helix
git pull origin main
npm ci
```

---

## 3. Rollback Procedure

If you need to roll back to a prior version:

### Standalone Installer:

```sh
curl -fsSL https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | sh -s -- --version <PREVIOUS_VERSION>
```

### npm:

```sh
npm install -g @sm-me-dev/helix@<PREVIOUS_VERSION>
```
