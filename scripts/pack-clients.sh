#!/usr/bin/env bash
# Pack client artifacts into dist/ for <data-dir>/downloads/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/build-tvcli.sh

EXT="$ROOT/clients/extension"
OUT="$ROOT/dist/teamvault-extension.zip"
rm -f "$OUT"
( cd "$EXT" && zip -qr "$OUT" . )

echo ""
echo "Fertig. Nach <data-dir>/downloads/ kopieren, z.B.:"
echo "  mkdir -p data/downloads"
echo "  cp dist/tvcli-* data/downloads/"
echo "  cp dist/teamvault-extension.zip data/downloads/"
echo "ZIP: $OUT"
