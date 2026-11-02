# Uninstalling Helix

Helix can be removed cleanly without deleting your projects, repositories, or workspace files.

---

## 1. Quick Uninstall (`helix uninstall`)

Run:

```sh
helix uninstall
```

Helix will detect your installation channel and either automatically remove its executable symlinks and application bundle, or display the exact package manager uninstallation command.

---

## 2. Uninstallation by Distribution Channel

### 2.1 Standalone Installer (Linux & macOS)

To remove the standalone bundle and symlink:

```sh
# Remove executable symlink
rm -f ~/.local/bin/helix

# Remove application bundle and embedded runtime
rm -rf ~/.local/lib/helix
```

Or run the bundled uninstallation script:

```sh
curl -fsSL https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/uninstall.sh | sh
```

_If installed with root privileges, the files are at `/usr/local/bin/helix` and `/usr/local/lib/helix`._

---

### 2.2 npm Global Installation

```sh
npm uninstall -g @sm-me-dev/helix
```

---

### 2.3 Homebrew

```sh
brew uninstall helix
```

---

### 2.4 Debian & Ubuntu (APT)

```sh
sudo apt remove helix
```

To also remove repository configuration:

```sh
sudo rm -f /etc/apt/sources.list.d/helix.list /etc/apt/keyrings/helix-archive-keyring.gpg
```

---

### 2.5 Fedora, RHEL & CentOS (RPM)

```sh
sudo dnf remove helix
```

---

### 2.6 Windows

#### PowerShell / Manual:

```powershell
Remove-Item -Path "$env:LOCALAPPDATA\Programs\helix" -Recurse -Force
```

#### WinGet:

```powershell
winget uninstall sm-me-dev.Helix
```

#### Scoop:

```powershell
scoop uninstall helix
```

---

### 2.7 Contributor / Git Checkout

Remove the `PATH` shim and shell configuration:

```sh
./cli/helix.mjs unlink
```

---

## 3. Data Preservation Guarantee

Uninstalling Helix removes only the CLI executable and application bundle.

The uninstallation process **never** deletes or modifies:

- Target project repositories.
- Commits, branches, or Git worktrees created during tasks.
- Target `.helix/` harness packs generated in your projects.
- Learning Ledgers or project knowledge databases.
