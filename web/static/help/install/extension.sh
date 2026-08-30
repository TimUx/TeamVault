#!/usr/bin/env bash
# TeamVault extension unpacker (Linux/macOS)
# Usage:
#   curl -fsSL https://vault.example/help/install/extension.sh | TEAMVAULT_URL=https://vault.example bash

set -euo pipefail

BASE="${TEAMVAULT_URL:-}"
if [[ -z "$BASE" ]]; then
  read -r -p "TeamVault-URL (z.B. https://vault.firma.local): " BASE
fi
BASE="${BASE%/}"

URL="${BASE}/downloads/teamvault-extension.zip"
DEST_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/teamvault"
DEST="${DEST_ROOT}/extension"
ZIP="${TMPDIR:-/tmp}/teamvault-extension.zip"

echo "Lade ${URL} …"
if ! curl -fsSL "$URL" -o "$ZIP"; then
  echo "Download fehlgeschlagen. Admin: scripts/pack-clients.ps1 / pack-clients.sh" >&2
  echo "Fallback: Git-Checkout → clients/extension manuell laden." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST_ROOT"
unzip -q -o "$ZIP" -d "$DEST"

if [[ ! -f "${DEST}/manifest.json" ]]; then
  inner="$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | head -n1 || true)"
  if [[ -n "$inner" && -f "${inner}/manifest.json" ]]; then
    DEST="$inner"
  fi
fi

echo ""
echo "Extension entpackt nach: $DEST"
echo ""
echo "Chrome / Chromium / Edge:"
echo "  1. chrome://extensions (Entwicklermodus)"
echo "  2. Entpackte Erweiterung laden → $DEST"
echo ""
echo "Firefox:"
echo "  about:debugging → Temporäres Add-on → ${DEST}/manifest.json"
echo ""
echo "Im Popup Server-URL setzen: $BASE"
