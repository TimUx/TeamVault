#!/usr/bin/env bash
# TeamVault tvcli installer (Linux/macOS)
# Usage:
#   curl -fsSL https://vault.example/help/install/tvcli.sh | TEAMVAULT_URL=https://vault.example bash

set -euo pipefail

BASE="${TEAMVAULT_URL:-}"
if [[ -z "$BASE" ]]; then
  read -r -p "TeamVault-URL (z.B. https://vault.firma.local): " BASE
fi
BASE="${BASE%/}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Nicht unterstützte Architektur: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
  linux) NAME="tvcli-linux-${ARCH}" ;;
  darwin)
    echo "macOS-Binary ist optional; aktuell werden Windows/Linux-Builds ausgeliefert." >&2
    echo "Bitte linux-Binary auf Linux nutzen oder selbst mit Go bauen: go build -o tvcli ./cmd/tvcli" >&2
    exit 1
    ;;
  *) echo "Nicht unterstütztes OS: $OS" >&2; exit 1 ;;
esac

URL="${BASE}/downloads/${NAME}"
DEST_DIR="${HOME}/.local/bin"
mkdir -p "$DEST_DIR"
DEST="${DEST_DIR}/tvcli"

echo "Lade ${URL} …"
if ! curl -fsSL "$URL" -o "$DEST"; then
  echo "" >&2
  echo "Download fehlgeschlagen. Liegt die Datei unter ${URL}?" >&2
  echo "Admin: scripts/build-tvcli.sh und nach <data-dir>/downloads/ kopieren." >&2
  exit 1
fi
chmod +x "$DEST"

echo "Installiert: $DEST"
if ! echo ":$PATH:" | grep -q ":${DEST_DIR}:"; then
  echo "Hinweis: ${DEST_DIR} ist nicht in PATH. Für diese Sitzung:"
  echo "  export PATH=\"${DEST_DIR}:\$PATH\""
fi
echo "Test:"
echo "  tvcli -base ${BASE} version"
echo "  tvcli -base ${BASE} login -tenant IHR-TENANT -user IHR-USER"
