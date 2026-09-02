#!/usr/bin/env bash
# Mirror GitHub (github remote) -> Gitea (origin remote). Run on firm network only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${1:-main}"
GITHUB_REMOTE="${GITHUB_REMOTE:-github}"
GITEA_REMOTE="${GITEA_REMOTE:-origin}"
PROXY="${TV_CORP_CONNECT_PROXY:-http://127.0.0.1:18081}"

echo "==> Fetch ${GITHUB_REMOTE} (${BRANCH} + tags) via proxy..."
git -c "http.proxy=${PROXY}" fetch "$GITHUB_REMOTE" "$BRANCH" --tags

SRC="${GITHUB_REMOTE}/${BRANCH}"
git rev-parse --verify "$SRC" >/dev/null

echo "==> Push ${SRC} -> ${GITEA_REMOTE}/${BRANCH} (no proxy)..."
git -c http.proxy= push "$GITEA_REMOTE" "${SRC}:${BRANCH}"

echo "==> Push tags to ${GITEA_REMOTE}..."
git -c http.proxy= push "$GITEA_REMOTE" --tags

echo "Done. Gitea (${GITEA_REMOTE}) at $(git rev-parse --short "$SRC")."
