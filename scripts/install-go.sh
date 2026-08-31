#!/usr/bin/env bash
# TeamVault — Go one-liner installer (slim dir; no full git clone)
#
#   curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
#
# Optional env (skips interactive prompts when set):
#   TEAMVAULT_DIR        install directory (default prompt: $HOME/teamvault)
#   TEAMVAULT_REF        release tag or branch (default: latest GitHub release, else main)
#   TEAMVAULT_PORT       listen port (default: first free from 8080)
#   TEAMVAULT_SKIP_RUN=1 only prepare; do not start the server
#   TEAMVAULT_BUILD=1    keep full source tree in install dir (dev; needs git clone)

set -euo pipefail

REPO_REF="${TEAMVAULT_REF:-}"
FORCE_BUILD="${TEAMVAULT_BUILD:-0}"
SKIP_RUN="${TEAMVAULT_SKIP_RUN:-0}"
REPO_URL="${TEAMVAULT_REPO:-https://github.com/TimUx/TeamVault.git}"
GITHUB_REPO="${TEAMVAULT_GITHUB:-TimUx/TeamVault}"
DEFAULT_DIR="${HOME}/teamvault"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Fehlt: $1 — bitte installieren und erneut ausführen." >&2
    exit 1
  }
}

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
  reply="${reply#"${reply%%[![:space:]]*}"}"
  reply="${reply%"${reply##*[![:space:]]}"}"
  if [[ -z "$reply" ]]; then
    reply="$default"
  fi
  if [[ "$reply" == "~" ]]; then
    reply="$HOME"
  elif [[ "$reply" == "~/"* ]]; then
    reply="${HOME}/${reply#~/}"
  fi
  if [[ "$reply" != /* ]]; then
    reply="$(pwd)/$reply"
  fi
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
    if [[ -z "$existing" ]]; then
      existing="$(grep -E '^TEAMVAULT_ADDR=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
      existing="${existing#:}"
      existing="${existing//[$' \t\r\n\"']/}"
    fi
  fi
  if [[ -n "$existing" ]] && [[ "$existing" =~ ^[0-9]+$ ]] && ! port_in_use "$existing"; then
    echo "$existing"
    return 0
  fi
  if [[ -n "$existing" ]] && [[ "$existing" =~ ^[0-9]+$ ]]; then
    preferred="$existing"
  fi
  picked="$(pick_free_port "$preferred")" || {
    echo "Kein freier Listen-Port im Bereich ${preferred}–$((preferred + 99))." >&2
    exit 1
  }
  if [[ "$picked" != "8080" ]]; then
    echo "==> Verwende freien Listen-Port ${picked}" >&2
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
  local base="$1" rel="$2" out="$3"
  local url="${base}/${rel}"
  echo "    ← ${rel}"
  curl -fsSL "$url" -o "${out}.tmp"
  mv "${out}.tmp" "$out"
}

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

resolve_source_ref() {
  if [[ -n "$REPO_REF" ]]; then
    printf '%s\n' "$REPO_REF"
    return 0
  fi
  local tag=""
  tag="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  if [[ -n "$tag" ]]; then
    printf '%s\n' "$tag"
  else
    printf '%s\n' "main"
  fi
}

raw_base_for_ref() {
  local ref="$1"
  local branch="${ref#v}"
  if [[ "$ref" == "main" ]] || [[ "$ref" == "master" ]] || [[ "$ref" == "develop" ]]; then
    printf 'https://raw.githubusercontent.com/%s/%s\n' "$GITHUB_REPO" "$ref"
  elif [[ "$ref" == v* ]]; then
    printf 'https://raw.githubusercontent.com/%s/%s\n' "$GITHUB_REPO" "$ref"
  else
    printf 'https://raw.githubusercontent.com/%s/%s\n' "$GITHUB_REPO" "$ref"
  fi
}

archive_url_for_ref() {
  local ref="$1"
  if [[ "$ref" == "main" ]] || [[ "$ref" == "master" ]] || [[ "$ref" == "develop" ]]; then
    printf 'https://github.com/%s/archive/refs/heads/%s.tar.gz\n' "$GITHUB_REPO" "$ref"
  elif [[ "$ref" == v* ]]; then
    printf 'https://github.com/%s/archive/refs/tags/%s.tar.gz\n' "$GITHUB_REPO" "$ref"
  else
    printf 'https://github.com/%s/archive/refs/heads/%s.tar.gz\n' "$GITHUB_REPO" "$ref"
  fi
}

archive_top_dir() {
  local ref="$1"
  if [[ "$ref" == v* ]]; then
    printf 'TeamVault-%s\n' "${ref#v}"
  else
    printf 'TeamVault-%s\n' "$ref"
  fi
}

release_asset_name() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *)
      echo "Nicht unterstützte Architektur: $(uname -m)" >&2
      return 1
      ;;
  esac
  case "$os" in
    linux) printf 'teamvault-linux-%s\n' "$arch" ;;
    darwin) printf 'teamvault-darwin-%s\n' "$arch" ;;
    *)
      echo "Nicht unterstütztes OS: $os (nutze Docker-One-Liner oder Windows-Installer)." >&2
      return 1
      ;;
  esac
}

release_download_url() {
  local ref="$1" asset="$2" tag="$ref"
  if [[ "$tag" != v* ]]; then
    tag="v${tag}"
  fi
  printf 'https://github.com/%s/releases/download/%s/%s\n' "$GITHUB_REPO" "$tag" "$asset"
}

need_go_version() {
  need go
  local GO_VER
  GO_VER="$(go env GOVERSION 2>/dev/null || go version | awk '{print $3}')"
  GO_VER="${GO_VER#go}"
  local MAJOR="${GO_VER%%.*}" REST="${GO_VER#*.}" MINOR="${REST%%.*}"
  if [[ "${MAJOR:-0}" -lt 1 ]] || { [[ "${MAJOR:-0}" -eq 1 ]] && [[ "${MINOR:-0}" -lt 23 ]]; }; then
    echo "Go 1.23+ erforderlich (gefunden: ${GO_VER:-unbekannt})." >&2
    echo "Install: https://go.dev/dl/" >&2
    exit 1
  fi
  printf '%s\n' "$GO_VER"
}

build_binary_in_dir() {
  local src="$1" out="$2"
  echo "==> Baue Binary (Go) …"
  (
    cd "$src"
    go mod download
    go build -trimpath -o "$out" ./cmd/teamvault
  )
}

download_release_binary() {
  local ref="$1" dest="$2"
  local asset url
  asset="$(release_asset_name)" || return 1
  url="$(release_download_url "$ref" "$asset")"
  echo "==> Lade Release-Binary (${ref}) …"
  echo "    ← ${asset}"
  if curl -fsSL "$url" -o "${dest}.tmp"; then
    mv "${dest}.tmp" "$dest"
    chmod +x "$dest"
    return 0
  fi
  rm -f "${dest}.tmp"
  return 1
}

build_binary_from_archive() {
  local ref="$1" dest="$2"
  local url top tmpdir extracted
  url="$(archive_url_for_ref "$ref")"
  top="$(archive_top_dir "$ref")"
  tmpdir="$(mktemp -d)"
  echo "==> Lade Quell-Archiv (${ref}) — temporär, kein Repo-Clone …"
  echo "    ← ${url##*/}"
  curl -fsSL "$url" | tar -xz -C "$tmpdir"
  extracted="${tmpdir}/${top}"
  if [[ ! -d "$extracted" ]]; then
    extracted="$(find "$tmpdir" -mindepth 1 -maxdepth 1 -type d | head -1)"
  fi
  if [[ ! -f "${extracted}/go.mod" ]]; then
    echo "Archiv unvollständig (go.mod fehlt)." >&2
    rm -rf "$tmpdir"
    return 1
  fi
  build_binary_in_dir "$extracted" "${tmpdir}/teamvault.bin"
  mkdir -p "$(dirname "$dest")"
  mv "${tmpdir}/teamvault.bin" "$dest"
  chmod +x "$dest"
  rm -rf "$tmpdir"
}

ensure_source_for_build() {
  need git
  if [[ -f go.mod ]] && [[ -d cmd/teamvault ]]; then
    if [[ -d .git ]]; then
      echo "==> Quellcode vorhanden — aktualisiere (${SOURCE_REF}) …"
      git fetch --depth 1 origin "$SOURCE_REF"
      git checkout --force -B "$SOURCE_REF" FETCH_HEAD
    fi
    return 0
  fi
  if [[ -f .env ]] || [[ -d secrets ]] || [[ -x ./bin/teamvault ]]; then
    echo "TEAMVAULT_BUILD=1 braucht ein leeres Verzeichnis oder bestehenden Quell-Checkout." >&2
    echo "Anderes TEAMVAULT_DIR wählen oder ohne TEAMVAULT_BUILD=1 (Slim-Install)." >&2
    exit 1
  fi
  echo "==> TEAMVAULT_BUILD=1 — klone Quellcode für Entwicklung …"
  local parent tmp
  parent="$(dirname "$DEST")"
  mkdir -p "$parent"
  tmp="$(mktemp -d "${parent}/teamvault-src.XXXXXX")"
  git clone --depth 1 --branch "$SOURCE_REF" "$REPO_URL" "$tmp"
  shopt -s dotglob nullglob
  mv "$tmp"/* "$DEST"/
  shopt -u dotglob nullglob
  rmdir "$tmp" 2>/dev/null || rm -rf "$tmp"
}

ensure_binary() {
  local ref="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"

  if [[ "$FORCE_BUILD" == "1" ]]; then
    need_go_version >/dev/null
    ensure_source_for_build
    build_binary_in_dir "$(pwd)" "$dest"
    return 0
  fi

  if [[ -x "$dest" ]] && [[ -f "$dest" ]]; then
    echo "==> Binary vorhanden — belasse unverändert."
    return 0
  fi

  if download_release_binary "$ref" "$dest"; then
    return 0
  fi

  echo "    (Kein Release-Binary — baue einmalig aus Quell-Archiv …)"
  need_go_version >/dev/null
  build_binary_from_archive "$ref" "$dest"
}

need curl

SOURCE_REF="$(resolve_source_ref)"
RAW_BASE="$(raw_base_for_ref "$SOURCE_REF")"
GO_VER=""
if command -v go >/dev/null 2>&1; then
  GO_VER="$(go env GOVERSION 2>/dev/null || go version | awk '{print $3}')"
  GO_VER="${GO_VER#go}"
fi

echo "==> TeamVault Go-Installation"
DEST="$(prompt_install_dir "$DEFAULT_DIR")"
echo "    Ziel: $DEST (ohne vollständigen Repo-Clone)"
if [[ -n "$GO_VER" ]]; then
  echo "    Ref:  ${SOURCE_REF} (Go ${GO_VER})"
else
  echo "    Ref:  ${SOURCE_REF}"
fi

mkdir -p "$DEST"
cd "$DEST"

if [[ "$FORCE_BUILD" != "1" ]]; then
  echo "==> Lade Betriebsdateien (${RAW_BASE}) …"
  fetch_raw "$RAW_BASE" ".env.example" ".env.example"
fi

PORT="$(resolve_port)"
echo "==> Listen-Port: ${PORT}"

KEY_HOST="./secrets/teamvault_unlock"
mkdir -p data secrets bin
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
  else
    cat >.env <<EOF
TEAMVAULT_PUBLISH_PORT=${PORT}
TEAMVAULT_UNLOCK_KEY_HOST=${KEY_HOST}
TEAMVAULT_ADDR=:${PORT}
TEAMVAULT_DATA_DIR=./data
TEAMVAULT_MASTER_UNLOCK_KEY_FILE=${KEY_HOST}
EOF
  fi
fi

set_env_key "TEAMVAULT_PUBLISH_PORT" "${PORT}"
set_env_key "TEAMVAULT_UNLOCK_KEY_HOST" "${KEY_HOST}"
set_env_key "TEAMVAULT_ADDR" ":${PORT}"
set_env_key "TEAMVAULT_DATA_DIR" "./data"
set_env_key "TEAMVAULT_MASTER_UNLOCK_KEY_FILE" "${KEY_HOST}"

BIN="./bin/teamvault"
ensure_binary "$SOURCE_REF" "$BIN"

echo ""
echo "Vorbereitung fertig."
echo "  Binary:     ${DEST}/${BIN#./}"
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
