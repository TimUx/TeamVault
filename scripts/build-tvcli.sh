#!/usr/bin/env bash
# Cross-compile standalone tvcli binaries (Windows + Linux, amd64/arm64).
# Pure Go / CGO_ENABLED=0 — no libc or Go toolchain needed at runtime.
#
# Usage (from repo root):
#   ./scripts/build-tvcli.sh
#
# Output: dist/tvcli-{windows,linux}-{amd64,arm64}[.exe]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CGO_ENABLED=0
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
LDFLAGS="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}"
OUTDIR="${ROOT}/dist"
mkdir -p "$OUTDIR"

build() {
  local goos="$1" goarch="$2" name="$3"
  echo "Building ${name} ..."
  GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags "$LDFLAGS" -o "${OUTDIR}/${name}" ./cmd/tvcli
}

build windows amd64 tvcli-windows-amd64.exe
build linux   amd64 tvcli-linux-amd64
build windows arm64 tvcli-windows-arm64.exe
build linux   arm64 tvcli-linux-arm64

echo
echo "Standalone binaries (CGO_ENABLED=0):"
ls -la "${OUTDIR}"/tvcli-*
echo "version=${VERSION} commit=${COMMIT}"
