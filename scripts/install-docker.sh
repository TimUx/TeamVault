#!/usr/bin/env bash
# TeamVault — Docker one-liner installer
#
#   curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash
#
# Optional env:
#   TEAMVAULT_DIR   install directory (default: $HOME/teamvault)
#   TEAMVAULT_REPO  git URL (default: https://github.com/TimUx/TeamVault.git)
#   TEAMVAULT_REF   branch/tag (default: main)
#   TEAMVAULT_PORT  host port (default: 8080)
#   TEAMVAULT_BUILD=1  force local image build instead of GHCR pull

set -euo pipefail

REPO_URL="${TEAMVAULT_REPO:-https://github.com/TimUx/TeamVault.git}"
REPO_REF="${TEAMVAULT_REF:-main}"
DEST="${TEAMVAULT_DIR:-$HOME/teamvault}"
PORT="${TEAMVAULT_PORT:-8080}"
FORCE_BUILD="${TEAMVAULT_BUILD:-0}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Fehlt: $1 — bitte installieren und erneut ausführen." >&2
    exit 1
  }
}

need git
need docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Fehlt: Docker Compose v2 (docker compose)." >&2
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

echo "==> TeamVault Docker-Installation"
echo "    Ziel: $DEST"

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
if [[ ! -f "$KEY_HOST" ]]; then
  echo "==> Erzeuge Unlock-Keyfile ($KEY_HOST) …"
  rand_key "$KEY_HOST"
  echo "    WICHTIG: Keyfile getrennt sichern — ohne Key keine Config."
else
  echo "==> Unlock-Keyfile vorhanden — belasse unverändert."
fi

if [[ ! -f .env ]]; then
  echo "==> Schreibe .env aus .env.example …"
  if [[ -f .env.example ]]; then
    cp .env.example .env
  else
    cat >.env <<EOF
TEAMVAULT_PUBLISH_PORT=${PORT}
TEAMVAULT_UNLOCK_KEY_HOST=${KEY_HOST}
TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest
EOF
  fi
fi

# Honour TEAMVAULT_PORT for published port
if grep -q '^TEAMVAULT_PUBLISH_PORT=' .env 2>/dev/null; then
  sed -i.bak "s|^TEAMVAULT_PUBLISH_PORT=.*|TEAMVAULT_PUBLISH_PORT=${PORT}|" .env && rm -f .env.bak
else
  echo "TEAMVAULT_PUBLISH_PORT=${PORT}" >>.env
fi

echo "==> Starte Container (GHCR-Image) …"
COMPOSE=(docker compose -f docker-compose.yml)
if [[ "$FORCE_BUILD" == "1" ]]; then
  echo "==> TEAMVAULT_BUILD=1 — lokaler Build via docker-compose.build.yml"
  if grep -q '^TEAMVAULT_IMAGE=' .env; then
    sed -i.bak 's|^TEAMVAULT_IMAGE=.*|TEAMVAULT_IMAGE=teamvault:local|' .env && rm -f .env.bak
  else
    echo "TEAMVAULT_IMAGE=teamvault:local" >>.env
  fi
  COMPOSE+=(-f docker-compose.build.yml)
  "${COMPOSE[@]}" up -d --build
else
  # Prefer CI-published images from ghcr.io/timux/teamvault
  if ! grep -q '^TEAMVAULT_IMAGE=' .env; then
    echo "TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest" >>.env
  elif grep -q '^TEAMVAULT_IMAGE=teamvault:local' .env; then
    sed -i.bak 's|^TEAMVAULT_IMAGE=.*|TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest|' .env && rm -f .env.bak
  fi
  if ! "${COMPOSE[@]}" pull; then
    echo "" >&2
    echo "GHCR-Pull fehlgeschlagen." >&2
    echo "  • Öffentliches Package? Sonst: docker login ghcr.io" >&2
    echo "  • Oder lokal bauen: TEAMVAULT_BUILD=1 $0" >&2
    exit 1
  fi
  "${COMPOSE[@]}" up -d
fi

echo ""
echo "Fertig. Browser öffnen:"
echo "  http://127.0.0.1:${PORT}/setup"
echo ""
echo "Daten: Docker-Volume teamvault_data"
echo "Unlock-Key: ${DEST}/${KEY_HOST#./}"
echo "Konfig:     ${DEST}/.env"
echo ""
echo "Stoppen:  cd ${DEST} && docker compose down"
echo "Logs:     cd ${DEST} && docker compose logs -f"
echo "Doku:     https://github.com/TimUx/TeamVault/blob/main/docs/install-guide.md"
