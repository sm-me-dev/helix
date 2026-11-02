#!/bin/bash
# scripts/build-rpm.sh — Package standalone Helix into official Fedora / RHEL .rpm package
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json")).version || "0.9.0")')
ARCH="${1:-x86_64}"

case "$ARCH" in
  x86_64|amd64|x64)
    RPM_ARCH="x86_64"
    BUNDLE_ARCH="linux-x64"
    ;;
  aarch64|arm64)
    RPM_ARCH="aarch64"
    BUNDLE_ARCH="linux-arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH (use x86_64 or aarch64)" >&2
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

echo "==> Building RPM package for $RPM_ARCH..."
mkdir -p "$STAGING/BUILD" "$STAGING/RPMS" "$STAGING/SOURCES" "$STAGING/SPECS" "$STAGING/SRPMS"

# Extract payload into SOURCES/helix
mkdir -p "$STAGING/SOURCES/helix"
tar -xzf "$TARBALL" -C "$STAGING"
cp -r "$STAGING/helix/"* "$STAGING/SOURCES/helix/"

# Create RPM spec file
SPEC_FILE="$STAGING/SPECS/helix.spec"
cat <<EOF > "$SPEC_FILE"
# Suppress binary stripping and debug package generation for self-contained runtime
%global debug_package %{nil}
%global __strip /bin/true
%global __os_install_post %{nil}

Name:           helix
Version:        ${VERSION}
Release:        1
Summary:        AI coding harness with bounded context, ephemeral worktrees, and mechanical gates
License:        MIT
URL:            https://github.com/sm-me-dev/helix
AutoReqProv:    no

%description
Helix is an autonomous coding harness engineered to maximize coding agent
success while strictly controlling token consumption, execution latency,
and coordination overhead.

%install
mkdir -p %{buildroot}/usr/lib/helix
mkdir -p %{buildroot}/usr/bin
cp -r %{_sourcedir}/helix/* %{buildroot}/usr/lib/helix/
ln -sf /usr/lib/helix/bin/helix %{buildroot}/usr/bin/helix

%files
/usr/lib/helix
/usr/bin/helix

%changelog
* Sun Nov 02 2026 Helix Project <dev@sm-me.dev> - ${VERSION}-1
- Release v${VERSION}
EOF

# Build RPM
rpmbuild --define "_topdir $STAGING" --target "$RPM_ARCH" -bb "$SPEC_FILE"

OUT_DIR="$ROOT/dist/packages"
mkdir -p "$OUT_DIR"
RPM_GENERATED=$(find "$STAGING/RPMS" -name "*.rpm" | head -n 1)

if [ -n "$RPM_GENERATED" ]; then
  RPM_DEST="$OUT_DIR/$(basename "$RPM_GENERATED")"
  cp "$RPM_GENERATED" "$RPM_DEST"
  echo "RPM package created: $RPM_DEST"

  # Update checksum
  SHA=$(sha256sum "$RPM_DEST" | awk '{print $1}')
  echo "$SHA  $(basename "$RPM_DEST")" >> "$OUT_DIR/SHA256SUMS.txt"
  sort -u -k2,2 "$OUT_DIR/SHA256SUMS.txt" -o "$OUT_DIR/SHA256SUMS.txt"
  echo "Checksum recorded: $SHA"
else
  echo "Error: RPM build failed to output artifact" >&2
  exit 1
fi
