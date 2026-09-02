#!/usr/bin/env bash
# CI-friendly screenshot capture (Ubuntu / GitHub Actions, no Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${TV_CAPTURE_PORT:-8099}"
DATA="${TV_CAPTURE_DATA:-$(mktemp -d)}"
SECRETS="${TV_CAPTURE_SECRETS:-$(mktemp -d)}"

mkdir -p "$DATA" "$SECRETS"
if [[ ! -f "$SECRETS/unlock" ]]; then
  openssl rand -out "$SECRETS/unlock" 48
  chmod 644 "$SECRETS/unlock"
fi

export TEAMVAULT_ADDR=":${PORT}"
export TEAMVAULT_DATA_DIR="$DATA"
export TEAMVAULT_MASTER_UNLOCK_KEY_FILE="$SECRETS/unlock"

echo "Packing client artifacts for screenshots…"
go run ./cmd/pack-extension
bash ./scripts/build-tvcli.sh
export TEAMVAULT_BUNDLED_DOWNLOADS="$ROOT/dist"

SERVER_BIN="$(mktemp)"
echo "Building server binary for go:embed…"
go build -trimpath -o "$SERVER_BIN" ./cmd/teamvault

echo "Starting TeamVault on :${PORT}…"
"$SERVER_BIN" &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$SERVER_BIN"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "TeamVault did not become ready on :${PORT}" >&2
  exit 1
fi

export TV_URL="http://127.0.0.1:${PORT}"
export TV_CAPTURE_DATA="$DATA"

npm ci --prefix "$ROOT/scripts" --no-fund --no-audit
npx --prefix "$ROOT/scripts" playwright install chromium
node "$ROOT/scripts/capture-docs-screenshots.mjs"
echo "Screenshots written to docs/images/ and web/static/help/img/"
