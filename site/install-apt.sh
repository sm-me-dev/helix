#!/bin/sh
# scripts/apt/install-apt.sh — Configure official Helix APT repository and install package
set -eu

REPO="sm-me-dev/helix"
KEYRING="/etc/apt/keyrings/helix-archive-keyring.gpg"
SOURCES_LIST="/etc/apt/sources.list.d/helix.list"

echo "==> Configuring official Helix APT repository..."

# Ensure curl and gpg are present
sudo apt-get update -qq
sudo apt-get install -y -qq curl gnupg

# Download and install public GPG signing key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL "https://${REPO%%/*}.github.io/${REPO##*/}/helix-archive-keyring.asc" | gpg --dearmor | sudo tee "$KEYRING" > /dev/null

# Add repository source entry
echo "deb [signed-by=$KEYRING] https://${REPO%%/*}.github.io/${REPO##*/}/ stable main" | sudo tee "$SOURCES_LIST" > /dev/null

# Refresh and install
sudo apt-get update -qq
sudo apt-get install -y helix

echo "==> Helix installed successfully via APT!"
helix --version
