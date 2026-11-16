#!/bin/sh
# scripts/uninstall.sh — Clean standalone uninstaller for Helix
set -eu

BIN_PATH="${HELIX_BIN_DIR:-$HOME/.local/bin/helix}"
INSTALL_DIR="${HELIX_INSTALL_DIR:-$HOME/.local/lib/helix}"

if [ "$(id -u)" -eq 0 ]; then
  BIN_PATH="/usr/local/bin/helix"
  INSTALL_DIR="/usr/local/lib/helix"
fi

REMOVED=0

if [ -L "$BIN_PATH" ] || [ -f "$BIN_PATH" ]; then
  rm -f "$BIN_PATH"
  echo "Removed binary: $BIN_PATH"
  REMOVED=1
fi

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "Removed application directory: $INSTALL_DIR"
  REMOVED=1
fi

if [ "$REMOVED" -eq 1 ]; then
  echo "Helix uninstalled successfully."
  echo "Note: Your repositories, workspaces, and project data were preserved."
else
  echo "No Helix installation found at $INSTALL_DIR or $BIN_PATH."
fi
