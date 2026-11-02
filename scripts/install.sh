#!/bin/sh
# Universal Helix Installer
# Installs standalone Helix application with embedded Node runtime.
# Works without pre-installed Node.js or Git repository clone.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | sh
# Or with options:
#   curl -fsSL ... | sh -s -- --version 0.9.0
#   curl -fsSL ... | sh -s -- --dir ~/.helix-app --bin-dir ~/.local/bin

set -eu

REPO="sm-me-dev/helix"
DEFAULT_BIN_DIR="$HOME/.local/bin"
DEFAULT_INSTALL_DIR="$HOME/.local/lib/helix"

# Colors
if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  BLUE='\033[0;34m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  NC='\033[0m'
else
  BOLD=''
  GREEN=''
  BLUE=''
  YELLOW=''
  RED=''
  NC=''
fi

info() { printf "${BLUE}==>${NC} ${BOLD}%s${NC}\n" "$*"; }
success() { printf "${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$*"; }
warn() { printf "${YELLOW}WARNING:${NC} %s\n" "$*"; }
error() { printf "${RED}ERROR:${NC} %s\n" "$*" >&2; }

# Parse arguments
TARGET_VERSION="${HELIX_VERSION:-latest}"
INSTALL_DIR="${HELIX_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BIN_DIR="${HELIX_BIN_DIR:-$DEFAULT_BIN_DIR}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version|-v)
      TARGET_VERSION="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    --help|-h)
      echo "Helix Installer"
      echo "Usage: install.sh [--version <v>] [--dir <install_path>] [--bin-dir <bin_path>]"
      exit 0
      ;;
    *)
      warn "Unknown option: $1"
      shift
      ;;
  esac
done

# If root, adjust defaults
if [ "$(id -u)" -eq 0 ]; then
  INSTALL_DIR="/usr/local/lib/helix"
  BIN_DIR="/usr/local/bin"
fi

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux*)  PLATFORM="linux" ;;
  darwin*) PLATFORM="darwin" ;;
  *)
    error "Unsupported operating system: $OS. Helix standalone bundle supports Linux and macOS."
    exit 1
    ;;
esac

# Detect Architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    error "Unsupported CPU architecture: $ARCH. Helix supports x64 and arm64."
    exit 1
    ;;
esac

info "Detected platform: $PLATFORM-$ARCH"

# Determine version
if [ "$TARGET_VERSION" = "latest" ]; then
  info "Fetching latest Helix release tag from GitHub..."
  LATEST_API="https://api.github.com/repos/$REPO/releases/latest"
  if command -v curl >/dev/null 2>&1; then
    TAG=$(curl -fsSL "$LATEST_API" 2>/dev/null | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/') || true
  elif command -v wget >/dev/null 2>&1; then
    TAG=$(wget -qO- "$LATEST_API" 2>/dev/null | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/') || true
  else
    error "curl or wget is required to install Helix"
    exit 1
  fi

  if [ -z "$TAG" ]; then
    warn "Could not determine latest release tag via GitHub API; falling back to v0.9.0"
    TAG="v0.9.0"
  fi
else
  case "$TARGET_VERSION" in
    v*) TAG="$TARGET_VERSION" ;;
    *)  TAG="v$TARGET_VERSION" ;;
  esac
fi

VERSION="${TAG#v}"
info "Installing Helix $TAG ($PLATFORM-$ARCH)..."

ASSET="helix-v${VERSION}-${PLATFORM}-${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
SUMS_URL="https://github.com/$REPO/releases/download/$TAG/SHA256SUMS.txt"

# Create clean temporary staging directory
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'helix-install')
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

cd "$TMP_DIR"

# Download archive
info "Downloading $ASSET..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --progress-bar -o "$ASSET" "$DOWNLOAD_URL" || {
    error "Failed to download $DOWNLOAD_URL"
    exit 1
  }
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$ASSET" "$DOWNLOAD_URL" || {
    error "Failed to download $DOWNLOAD_URL"
    exit 1
  }
fi

# Download and verify checksum
info "Verifying SHA-256 checksum..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "SHA256SUMS.txt" "$SUMS_URL" || true
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "SHA256SUMS.txt" "$SUMS_URL" || true
fi

if [ -s "SHA256SUMS.txt" ]; then
  EXPECTED=$(grep "$ASSET" SHA256SUMS.txt | awk '{print $1}' | head -n 1)
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "$ASSET" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "$ASSET" | awk '{print $1}')
    else
      ACTUAL=""
      warn "sha256sum/shasum not available; skipped checksum verification"
    fi

    if [ -n "$ACTUAL" ]; then
      if [ "$EXPECTED" != "$ACTUAL" ]; then
        error "Checksum mismatch!"
        error "  Expected: $EXPECTED"
        error "  Actual:   $ACTUAL"
        exit 1
      fi
      info "Checksum verified: $ACTUAL"
    fi
  else
    warn "Checksum for $ASSET not listed in SHA256SUMS.txt"
  fi
else
  warn "SHA256SUMS.txt could not be retrieved; proceeding with downloaded archive"
fi

# Extract
info "Extracting to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
# Clean previous installation files inside target directory if upgrading
rm -rf "$INSTALL_DIR/bin" "$INSTALL_DIR/runtime" "$INSTALL_DIR/app"

tar -xzf "$ASSET" -C "$TMP_DIR"
if [ ! -d "$TMP_DIR/helix" ]; then
  error "Archive did not contain expected 'helix' directory"
  exit 1
fi

cp -r "$TMP_DIR/helix/"* "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/bin/helix"
if [ -f "$INSTALL_DIR/runtime/bin/node" ]; then
  chmod +x "$INSTALL_DIR/runtime/bin/node"
elif [ -f "$INSTALL_DIR/runtime/node" ]; then
  chmod +x "$INSTALL_DIR/runtime/node"
fi

# Create symlink in bin directory
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/helix" "$BIN_DIR/helix"
chmod +x "$BIN_DIR/helix"

# Verification
info "Verifying installed executable..."
if [ -x "$BIN_DIR/helix" ]; then
  INSTALLED_VER=$("$BIN_DIR/helix" --version 2>/dev/null || echo "helix $VERSION")
  success "Successfully installed: $INSTALLED_VER"
else
  error "Installed binary at $BIN_DIR/helix is not executable"
  exit 1
fi

# PATH guidance
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    warn "$BIN_DIR is not in your current PATH."
    printf "\nTo run 'helix' from anywhere, add it to your shell configuration:\n"
    if [ -f "$HOME/.zshrc" ]; then
      printf "  echo 'export PATH=\"%s:\$PATH\"' >> ~/.zshrc\n" "$BIN_DIR"
      printf "  source ~/.zshrc\n\n"
    elif [ -f "$HOME/.bashrc" ]; then
      printf "  echo 'export PATH=\"%s:\$PATH\"' >> ~/.bashrc\n" "$BIN_DIR"
      printf "  source ~/.bashrc\n\n"
    fi
    ;;
esac

echo "Get started with Helix:"
echo "  helix --help"
echo "  helix init /path/to/project"
echo "  helix run \"Fix the failing test\""
