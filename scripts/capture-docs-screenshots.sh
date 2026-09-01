#!/usr/bin/env bash
# Regenerates docs/images/*.png from the current web/static (via go:embed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${TV_CAPTURE_DATA:-$(mktemp -d /tmp/tv-screenshot-data.XXXXXX)}"
SECRETS="${TV_CAPTURE_SECRETS:-$(mktemp -d /tmp/tv-screenshot-secrets.XXXXXX)}"
PORT="${TV_CAPTURE_PORT:-8099}"
CONTAINER="tv-docs-screenshots"

mkdir -p "$DATA" "$SECRETS"
if [[ ! -f "$SECRETS/unlock" ]]; then
  openssl rand -out "$SECRETS/unlock" 48
  chmod 644 "$SECRETS/unlock"
fi

echo "Packing client artifacts for screenshots…"
(cd "$ROOT" && go run ./cmd/pack-extension && ./scripts/build-tvcli.sh)

docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d --name "$CONTAINER" \
  -v "$ROOT:/src" \
  -v "$ROOT/dist:/bundled:ro" \
  -v "$DATA:/data" \
  -v "$SECRETS/unlock:/run/secrets/teamvault_unlock:ro" \
  -p "${PORT}:8099" \
  -e TEAMVAULT_ADDR=:8099 \
  -e TEAMVAULT_DATA_DIR=/data \
  -e TEAMVAULT_MASTER_UNLOCK_KEY_FILE=/run/secrets/teamvault_unlock \
  -e TEAMVAULT_BUNDLED_DOWNLOADS=/bundled \
  golang:1.23.3 sh -c 'cd /src && go run ./cmd/teamvault'

cleanup() { docker rm -f "$CONTAINER" 2>/dev/null || true; }
trap cleanup EXIT

echo "Waiting for TeamVault on :${PORT}…"
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "Server did not become ready" >&2
  docker logs "$CONTAINER" 2>&1 | tail -30
  exit 1
fi

export TV_URL="http://127.0.0.1:${PORT}"
export TV_CAPTURE_DATA="/data"
SCRIPTS_NM="$ROOT/scripts/node_modules"
if [[ ! -d "$SCRIPTS_NM/playwright" ]]; then
  echo "Installing Playwright (scripts/package.json)…"
  npm install --prefix "$ROOT/scripts" --no-fund --no-audit
  npx --prefix "$ROOT/scripts" playwright install chromium
fi
node "$ROOT/scripts/capture-docs-screenshots.mjs"
echo "Screenshots written to docs/images/"
