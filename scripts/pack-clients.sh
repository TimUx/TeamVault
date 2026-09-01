#!/usr/bin/env bash
# Pack client artifacts into dist/ for <data-dir>/downloads/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/build-tvcli.sh

echo "Packing extension (crx/xpi)…"
go run ./cmd/pack-extension

echo ""
echo "Fertig. Nach <data-dir>/downloads/ kopieren, z.B.:"
echo "  mkdir -p data/downloads"
echo "  cp dist/tvcli-* data/downloads/"
echo "  cp dist/teamvault-extension.* data/downloads/"
echo "  cp -r dist/extension data/downloads/"
