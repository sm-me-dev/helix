#!/bin/bash
# scripts/build-deb.sh — Package standalone Helix into official Debian / Ubuntu .deb package
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json")).version || "0.1.0")')
ARCH="${1:-amd64}"

case "$ARCH" in
  amd64|x86_64|x64)
    DEB_ARCH="amd64"
    BUNDLE_ARCH="linux-x64"
    ;;
  arm64|aarch64)
    DEB_ARCH="arm64"
    BUNDLE_ARCH="linux-arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH (use amd64 or arm64)" >&2
    exit 1
    ;;
esac

TARBALL="$ROOT/dist/packages/helix-v${VERSION}-${BUNDLE_ARCH}.tar.gz"
if [ ! -f "$TARBALL" ]; then
  echo "Bundle archive $TARBALL not found. Building bundle..."
  node "$ROOT/scripts/build-bundles.mjs" "$BUNDLE_ARCH" --use-system-node
fi

STAGING=$(mktemp -d)
cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT

echo "==> Building Debian package for $DEB_ARCH..."
PKG_ROOT="$STAGING/helix_${VERSION}_linux_${DEB_ARCH}"
mkdir -p "$PKG_ROOT/DEBIAN"
mkdir -p "$PKG_ROOT/usr/lib/helix"
mkdir -p "$PKG_ROOT/usr/bin"

# Extract payload into /usr/lib/helix
tar -xzf "$TARBALL" -C "$STAGING"
cp -r "$STAGING/helix/"* "$PKG_ROOT/usr/lib/helix/"

# Create symlink in /usr/bin/helix
ln -sf /usr/lib/helix/bin/helix "$PKG_ROOT/usr/bin/helix"

# Compute installed size in KB
INSTALLED_SIZE=$(du -sk "$PKG_ROOT/usr" | awk '{print $1}')

# Write DEBIAN/control
cat <<EOF > "$PKG_ROOT/DEBIAN/control"
Package: helix
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: ${DEB_ARCH}
Installed-Size: ${INSTALLED_SIZE}
Maintainer: Helix Project <dev@sm-me.dev>
Homepage: https://github.com/sm-me-dev/helix
Description: AI coding harness with bounded context, ephemeral worktrees, and mechanical gates
 Helix is an autonomous coding harness engineered to maximize coding agent
 success while strictly controlling token consumption, execution latency,
 and coordination overhead.
EOF

# Build package
OUT_DIR="$ROOT/dist/packages"
mkdir -p "$OUT_DIR"
DEB_FILE="$OUT_DIR/helix_${VERSION}_linux_${DEB_ARCH}.deb"
dpkg-deb --build --root-owner-group "$PKG_ROOT" "$DEB_FILE"

echo "Debian package created: $DEB_FILE"
dpkg-deb --info "$DEB_FILE"

# Update checksum
SHA=$(sha256sum "$DEB_FILE" | awk '{print $1}')
echo "$SHA  $(basename "$DEB_FILE")" >> "$OUT_DIR/SHA256SUMS.txt"
sort -u -k2,2 "$OUT_DIR/SHA256SUMS.txt" -o "$OUT_DIR/SHA256SUMS.txt"
echo "Checksum recorded: $SHA"
