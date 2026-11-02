# Platform Support Matrix

This document outlines the operating systems, architectures, and distribution channels officially supported by Helix.

---

## 1. Operating System & Architecture Matrix

| Platform                           | Architecture            | Tier   | Status              | Verification Method                                                                          |
| ---------------------------------- | ----------------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------- |
| **Linux (Debian, Ubuntu)**         | `x86_64` (AMD64)        | Tier 1 | **Fully Supported** | Tested in CI (Ubuntu 22/24 runners), Debian package validation, standalone bundle execution. |
| **Linux (Fedora, RHEL, CentOS)**   | `x86_64` (AMD64)        | Tier 1 | **Fully Supported** | RPM build verification, standalone bundle execution.                                         |
| **Linux (Debian, Ubuntu, Alpine)** | `aarch64` (ARM64)       | Tier 1 | **Fully Supported** | Native Node 22 runtime bundle, dpkg verification.                                            |
| **macOS (Sonoma, Sequoia)**        | Apple Silicon (`arm64`) | Tier 1 | **Fully Supported** | Homebrew formula testing, standalone bundle testing.                                         |
| **macOS (Ventura, Sonoma)**        | Intel (`x86_64`)        | Tier 1 | **Fully Supported** | Homebrew formula testing, standalone bundle testing.                                         |
| **Windows 10/11 (WSL2)**           | `x86_64` (AMD64)        | Tier 1 | **Fully Supported** | Linux bundles and npm packages run identically under WSL2.                                   |
| **Windows 10/11 (Native)**         | `x86_64` (AMD64)        | Tier 2 | **Supported**       | `helix.cmd` portable launcher and PowerShell installer.                                      |
| **Windows (ARM64)**                | `arm64`                 | Tier 3 | **Experimental**    | Requires emulation or manual Node installation.                                              |

---

## 2. Distribution Channel Matrix

| Distribution Channel                               | Target OS              | Runtime Prerequisite    | Status     | Verification Status                                         |
| -------------------------------------------------- | ---------------------- | ----------------------- | ---------- | ----------------------------------------------------------- |
| **npm Global Package**                             | Cross-platform         | Node.js >= 22.6         | **Active** | Verified via clean prefix install and smoke tests.          |
| **Universal Shell Installer (`install.sh`)**       | Linux, macOS           | None (embedded Node 22) | **Active** | Verified in clean isolated environment without system Node. |
| **Universal PowerShell Installer (`install.ps1`)** | Windows                | None (embedded Node 22) | **Active** | Verified script syntax and extraction.                      |
| **Homebrew Tap (`sm-me-dev/tap/helix`)**           | macOS, Linux           | None (embedded Node 22) | **Active** | Verified Formula syntax and test block.                     |
| **Debian / Ubuntu Package (`.deb`)**               | Linux (Debian, Ubuntu) | None (embedded Node 22) | **Active** | Verified via `dpkg-deb` build, info, and contents checks.   |
| **Fedora / RHEL Package (`.rpm`)**                 | Linux (Fedora, RHEL)   | None (embedded Node 22) | **Active** | Verified via `rpmbuild` execution and checksum generation.  |
| **WinGet Manifest (`sm-me-dev.Helix`)**            | Windows                | None (embedded Node 22) | **Staged** | Schema-validated YAML manifest.                             |
| **Scoop Manifest (`helix.json`)**                  | Windows                | None (embedded Node 22) | **Staged** | Validated JSON bucket manifest.                             |
| **Git PATH Link (`helix link`)**                   | Cross-platform         | Node.js >= 22.6, Git    | **Active** | Verified development workflow.                              |

---

## 3. Prerequisite & Dependency Policy

- **No System Node Required for Bundles**: Standalone archives, `.deb`, `.rpm`, Homebrew, and curl installers bundle an official Node.js 22 LTS runtime into `runtime/`. Users do not need to install or configure Node.js.
- **Git Requirement**: Helix requires Git >= 2.30 for ephemeral worktree management (`git worktree add`).
- **Graphify Requirement (Optional)**: If `graphify` (`uv tool install graphifyy`) is absent, Helix automatically falls back to its built-in structural outline map with zero performance penalty.
