#!/bin/sh
# scripts/verify-release.sh — Comprehensive verification of Helix release packages
set -eu

PACKAGES_DIR="${1:-dist/packages}"

if [ ! -d "$PACKAGES_DIR" ]; then
  echo "Error: Packages directory $PACKAGES_DIR does not exist." >&2
  exit 1
fi

echo "==> Verifying release artifacts in $PACKAGES_DIR..."

SUMS_FILE="$PACKAGES_DIR/SHA256SUMS.txt"
if [ ! -f "$SUMS_FILE" ]; then
  echo "Error: $SUMS_FILE missing!" >&2
  exit 1
fi

# 1. Verify SHA-256 Checksums
echo "--> Validating SHA-256 digests..."
(cd "$PACKAGES_DIR" && sha256sum --check SHA256SUMS.txt)
echo "✓ Checksums verified."

# 2. Smoke test standalone tarball extraction and execution
TEST_TMP=$(mktemp -d)
cleanup() {
  rm -rf "$TEST_TMP"
}
trap cleanup EXIT

# Find any tar.gz matching host architecture
HOST_ARCH="x64"
if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
  HOST_ARCH="arm64"
fi
HOST_TARBALL=$(find "$PACKAGES_DIR" -name "*linux-${HOST_ARCH}.tar.gz" | head -n 1)

if [ -n "$HOST_TARBALL" ]; then
  echo "--> Smoke testing standalone package: $HOST_TARBALL"
  tar -xzf "$HOST_TARBALL" -C "$TEST_TMP"
  STANDALONE_BIN="$TEST_TMP/helix/bin/helix"
  if [ ! -x "$STANDALONE_BIN" ]; then
    echo "Error: Extracted binary $STANDALONE_BIN is not executable!" >&2
    exit 1
  fi

  # Run basic commands without system node
  VERSION_OUT=$("$STANDALONE_BIN" --version)
  echo "✓ Output: $VERSION_OUT"
  "$STANDALONE_BIN" --help >/dev/null
  echo "✓ --help passed"
  "$STANDALONE_BIN" run "Smoke test from verify-release.sh" --dry >/dev/null
  echo "✓ run --dry passed"
  "$STANDALONE_BIN" update >/dev/null
  echo "✓ update passed"
fi

echo "==> All release artifact verifications passed successfully!"
