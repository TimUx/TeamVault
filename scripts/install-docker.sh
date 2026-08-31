#!/usr/bin/env bash
# TeamVault — Docker one-liner installer (Compose + GHCR only; no full git clone)
#
#   curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash
#
# Optional env (skips interactive prompts when set):
#   TEAMVAULT_DIR   install directory (default prompt: $HOME/teamvault)
#   TEAMVAULT_REF   branch/tag for raw file fetch (default: main)
#   TEAMVAULT_PORT  host port (default: first free from 8080)
#   TEAMVAULT_BUILD=1  local image build (clones full repo — needs source + Dockerfile)
#   TEAMVAULT_RAW_BASE  override raw URL prefix (advanced)

set -euo pipefail

REPO_REF="${TEAMVAULT_REF:-main}"
FORCE_BUILD="${TEAMVAULT_BUILD:-0}"
RAW_BASE="${TEAMVAULT_RAW_BASE:-https://raw.githubusercontent.com/TimUx/TeamVault/${REPO_REF}}"
REPO_URL="${TEAMVAULT_REPO:-https://github.com/TimUx/TeamVault.git}"
DEFAULT_DIR="${HOME}/teamvault"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Fehlt: $1 — bitte installieren und erneut ausführen." >&2
    exit 1
  }
}

# Ask for install path (works with `curl | bash` via /dev/tty).
# TEAMVAULT_DIR set → no prompt. Non-interactive without tty → default.
prompt_install_dir() {
  local default="$1" reply=""
  if [[ -n "${TEAMVAULT_DIR:-}" ]]; then
    reply="$TEAMVAULT_DIR"
  elif [[ -r /dev/tty ]]; then
    printf "\nInstallationspfad [%s]: " "$default" >/dev/tty
    IFS= read -r reply </dev/tty || true
  elif [[ -t 0 ]]; then
    printf "\nInstallationspfad [%s]: " "$default"
    IFS= read -r reply || true
  else
    reply=""
  fi
  # trim
  reply="${reply#"${reply%%[![:space:]]*}"}"
  reply="${reply%"${reply##*[![:space:]]}"}"
  if [[ -z "$reply" ]]; then
    reply="$default"
  fi
  # expand leading ~
  if [[ "$reply" == "~" ]]; then
    reply="$HOME"
  elif [[ "$reply" == "~/"* ]]; then
    reply="${HOME}/${reply#~/}"
  fi
  # absolute path
  if [[ "$reply" != /* ]]; then
    reply="$(pwd)/$reply"
  fi
  # normalize .. and .
  if command -v realpath >/dev/null 2>&1; then
    mkdir -p "$reply" 2>/dev/null || true
    reply="$(realpath -m "$reply" 2>/dev/null || echo "$reply")"
  fi
  printf '%s\n' "$reply"
}

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${p}$"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  (echo >/dev/tcp/127.0.0.1/"$p") >/dev/null 2>&1
}

pick_free_port() {
  local start="$1" p
  for ((p = start; p < start + 100; p++)); do
    if ! port_in_use "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

resolve_port() {
  local preferred=8080 existing="" picked
  if [[ -n "${TEAMVAULT_PORT:-}" ]]; then
    if port_in_use "$TEAMVAULT_PORT"; then
      echo "Port ${TEAMVAULT_PORT} ist belegt. Anderen Port setzen: TEAMVAULT_PORT=…" >&2
      exit 1
    fi
    echo "$TEAMVAULT_PORT"
    return 0
  fi
  if [[ -f .env ]]; then
    existing="$(grep -E '^TEAMVAULT_PUBLISH_PORT=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
    existing="${existing//[$' \t\r\n\"']/}"
  fi
  if [[ -n "$existing" ]] && [[ "$existing" =~ ^[0-9]+$ ]] && ! port_in_use "$existing"; then
    echo "$existing"
    return 0
  fi
  if [[ -n "$existing" ]] && [[ "$existing" =~ ^[0-9]+$ ]]; then
    preferred="$existing"
  fi
  picked="$(pick_free_port "$preferred")" || {
    echo "Kein freier Host-Port im Bereich ${preferred}–$((preferred + 99))." >&2
    exit 1
  }
  if [[ "$picked" != "8080" ]]; then
    echo "==> Verwende freien Host-Port ${picked}" >&2
  fi
  echo "$picked"
}

set_env_key() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    echo "${key}=${value}" >>.env
  fi
}

fetch_raw() {
  local rel="$1" out="$2"
  local url="${RAW_BASE}/${rel}"
  echo "    ← ${rel}"
  curl -fsSL "$url" -o "${out}.tmp"
  mv "${out}.tmp" "$out"
}

# Keyfile must be readable by container user (distroless nonroot = UID 65532).
# Keep secrets/ at 700 so other host users cannot traverse to the file.
rand_key() {
  local out="$1" dir
  dir="$(dirname "$out")"
  mkdir -m 700 -p "$dir"
  chmod 700 "$dir"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -out "$out" 48
  else
    head -c 48 /dev/urandom >"$out"
  fi
  chmod 644 "$out"
}

# Repair perms if an older install left the key at 600 (restart loop).
ensure_key_readable() {
  local out="$1" dir
  dir="$(dirname "$out")"
  [[ -d "$dir" ]] && chmod 700 "$dir"
  if [[ -f "$out" ]]; then
    chmod 644 "$out"
  fi
}

# Full source tree only when building the image locally.
ensure_source_for_build() {
  need git
  if [[ -f Dockerfile ]] && [[ -f docker-compose.build.yml ]]; then
    if [[ -d .git ]]; then
      echo "==> Quellcode vorhanden — aktualisiere ($REPO_REF) …"
      git fetch --depth 1 origin "$REPO_REF"
      git checkout --force -B "$REPO_REF" FETCH_HEAD
    fi
    return 0
  fi
  if [[ -f docker-compose.yml ]] || [[ -f .env ]] || [[ -d secrets ]]; then
    echo "TEAMVAULT_BUILD=1 braucht den Quellcode (Dockerfile)." >&2
    echo "Dieses Verzeichnis ist eine Slim-Installation (nur Compose)." >&2
    echo "Entweder anderes TEAMVAULT_DIR wählen oder:" >&2
    echo "  git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} && cd TeamVault && TEAMVAULT_BUILD=1 …" >&2
    exit 1
  fi
  echo "==> TEAMVAULT_BUILD=1 — klone Quellcode für lokalen Image-Build …"
  local parent tmp
  parent="$(dirname "$DEST")"
  mkdir -p "$parent"
  tmp="$(mktemp -d "${parent}/teamvault-src.XXXXXX")"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$tmp"
  shopt -s dotglob nullglob
  mv "$tmp"/* "$DEST"/
  shopt -u dotglob nullglob
  rmdir "$tmp" 2>/dev/null || rm -rf "$tmp"
}

need curl
need docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Fehlt: Docker Compose v2 (docker compose)." >&2
  exit 1
fi

echo "==> TeamVault Docker-Installation"
DEST="$(prompt_install_dir "$DEFAULT_DIR")"
echo "    Ziel: $DEST (ohne vollständigen Repo-Clone)"
echo "    Ref:  $REPO_REF"

mkdir -p "$DEST"
cd "$DEST"

if [[ "$FORCE_BUILD" == "1" ]]; then
  ensure_source_for_build
else
  echo "==> Lade Docker-Dateien (${RAW_BASE}) …"
  fetch_raw "docker-compose.yml" "docker-compose.yml"
  fetch_raw ".env.example" ".env.example"
fi

PORT="$(resolve_port)"
echo "==> Host-Port: ${PORT}"

KEY_HOST="./secrets/teamvault_unlock"
if [[ ! -f "$KEY_HOST" ]]; then
  echo "==> Erzeuge Unlock-Keyfile ($KEY_HOST) …"
  rand_key "$KEY_HOST"
  echo "    WICHTIG: Keyfile getrennt sichern — ohne Key keine Config."
else
  echo "==> Unlock-Keyfile vorhanden — stelle Container-Leserechte sicher."
  ensure_key_readable "$KEY_HOST"
fi

if [[ ! -f .env ]]; then
  echo "==> Schreibe .env …"
  if [[ -f .env.example ]]; then
    cp .env.example .env
  else
    cat >.env <<EOF
TEAMVAULT_PUBLISH_PORT=${PORT}
TEAMVAULT_UNLOCK_KEY_HOST=${KEY_HOST}
TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest
TEAMVAULT_PULL_POLICY=always
EOF
  fi
fi

set_env_key "TEAMVAULT_PUBLISH_PORT" "${PORT}"
set_env_key "TEAMVAULT_UNLOCK_KEY_HOST" "${KEY_HOST}"

echo "==> Starte Container …"
COMPOSE=(docker compose -f docker-compose.yml)
if [[ "$FORCE_BUILD" == "1" ]]; then
  echo "==> TEAMVAULT_BUILD=1 — lokaler Build via docker-compose.build.yml"
  set_env_key "TEAMVAULT_IMAGE" "teamvault:local"
  COMPOSE+=(-f docker-compose.build.yml)
  "${COMPOSE[@]}" up -d --build
else
  set_env_key "TEAMVAULT_IMAGE" "ghcr.io/timux/teamvault:latest"
  if ! "${COMPOSE[@]}" pull; then
    echo "" >&2
    echo "GHCR-Pull fehlgeschlagen." >&2
    echo "  • Package öffentlich? Sonst: docker login ghcr.io" >&2
    echo "  • Oder lokal bauen: TEAMVAULT_BUILD=1 (klont dann den Quellcode)" >&2
    exit 1
  fi
  "${COMPOSE[@]}" up -d
fi

echo ""
echo "Fertig. Browser öffnen:"
echo "  http://127.0.0.1:${PORT}/setup"
echo ""
echo "Daten:      Docker-Volume teamvault_data"
echo "Unlock-Key: ${DEST}/${KEY_HOST#./}"
echo "Konfig:     ${DEST}/.env"
echo "Compose:    ${DEST}/docker-compose.yml"
echo ""
echo "Stoppen:  cd ${DEST} && docker compose down"
echo "Logs:     cd ${DEST} && docker compose logs -f"
echo "Update:   gleichen One-Liner erneut ausführen (zieht Compose + Image)"
echo "Doku:     https://github.com/TimUx/TeamVault/blob/main/docs/install-guide.md"
