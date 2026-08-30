#!/usr/bin/env bash
# TeamVault — Go one-liner installer (local process, no Docker)
#
#   curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
#
# Optional env:
#   TEAMVAULT_DIR   install directory (default: $HOME/teamvault)
#   TEAMVAULT_REPO  git URL
#   TEAMVAULT_REF   branch/tag (default: main)
#   TEAMVAULT_PORT  listen port (default: 8080)
#   TEAMVAULT_SKIP_RUN=1  only prepare; do not start the server

set -euo pipefail

REPO_URL="${TEAMVAULT_REPO:-https://github.com/TimUx/TeamVault.git}"
REPO_REF="${TEAMVAULT_REF:-main}"
DEST="${TEAMVAULT_DIR:-$HOME/teamvault}"
PORT="${TEAMVAULT_PORT:-8080}"
SKIP_RUN="${TEAMVAULT_SKIP_RUN:-0}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Fehlt: $1 — bitte installieren und erneut ausführen." >&2
    exit 1
  }
}

need git
need go

GO_VER="$(go env GOVERSION 2>/dev/null || go version | awk '{print $3}')"
GO_VER="${GO_VER#go}"
# Require Go 1.23+
MAJOR="${GO_VER%%.*}"
REST="${GO_VER#*.}"
MINOR="${REST%%.*}"
if [[ "${MAJOR:-0}" -lt 1 ]] || { [[ "${MAJOR:-0}" -eq 1 ]] && [[ "${MINOR:-0}" -lt 23 ]]; }; then
  echo "Go 1.23+ erforderlich (gefunden: ${GO_VER:-unbekannt})." >&2
  echo "Install: https://go.dev/dl/" >&2
  exit 1
fi

rand_key() {
  local out="$1"
  mkdir -p "$(dirname "$out")"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -out "$out" 48
  else
    head -c 48 /dev/urandom >"$out"
  fi
  chmod 600 "$out"
}

echo "==> TeamVault Go-Installation"
echo "    Ziel: $DEST (Go ${GO_VER})"

if [[ -d "$DEST/.git" ]]; then
  echo "==> Repo vorhanden — aktualisiere ($REPO_REF) …"
  git -C "$DEST" fetch --depth 1 origin "$REPO_REF"
  git -C "$DEST" checkout --force -B "$REPO_REF" "FETCH_HEAD"
else
  echo "==> Clone $REPO_URL ($REPO_REF) …"
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$DEST"
fi

cd "$DEST"

KEY_HOST="./secrets/teamvault_unlock"
mkdir -p data secrets
if [[ ! -f "$KEY_HOST" ]]; then
  echo "==> Erzeuge Unlock-Keyfile ($KEY_HOST) …"
  rand_key "$KEY_HOST"
  echo "    WICHTIG: Keyfile getrennt sichern — ohne Key keine Config."
else
  echo "==> Unlock-Keyfile vorhanden — belasse unverändert."
fi

if [[ ! -f .env ]]; then
  echo "==> Schreibe .env …"
  if [[ -f .env.example ]]; then
    cp .env.example .env
  fi
fi
cat >.env <<EOF
TEAMVAULT_PUBLISH_PORT=${PORT}
TEAMVAULT_UNLOCK_KEY_HOST=${KEY_HOST}
TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest
TEAMVAULT_ADDR=:${PORT}
TEAMVAULT_DATA_DIR=./data
TEAMVAULT_MASTER_UNLOCK_KEY_FILE=${KEY_HOST}
EOF

echo "==> Lade Go-Module …"
go mod download

BIN="./bin/teamvault"
mkdir -p bin
echo "==> Baue ${BIN} …"
go build -trimpath -o "$BIN" ./cmd/teamvault

echo ""
echo "Vorbereitung fertig."
echo "  Unlock-Key: ${DEST}/${KEY_HOST#./}"
echo "  Data-Dir:   ${DEST}/data"
echo "  Env:        ${DEST}/.env"
echo ""

if [[ "$SKIP_RUN" == "1" ]]; then
  echo "Start manuell:"
  echo "  cd ${DEST}"
  echo "  set -a; source .env; set +a"
  echo "  ./bin/teamvault"
  exit 0
fi

echo "==> Starte TeamVault auf :${PORT} …"
echo "    Browser: http://127.0.0.1:${PORT}/setup"
echo "    Stoppen: Ctrl+C"
echo ""
set -a
# shellcheck disable=SC1091
source .env
set +a
exec ./bin/teamvault
