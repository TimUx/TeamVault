#!/usr/bin/env bash
# TeamVault extension — user installer (Firefox enterprise / manual)
set -euo pipefail
BASE="${TEAMVAULT_URL:-}"
if [[ -z "$BASE" ]]; then read -r -p "TeamVault-URL: " BASE; fi
BASE="${BASE%/}"
META=$(curl -fsSL "$BASE/api/client-downloads")
EXT_ID=$(echo "$META" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)
echo "Extension-ID: ${EXT_ID:-?}"
echo ""
echo "Chrome / Edge (Linux): IT muss ExtensionSettings + ExtensionInstallSources setzen."
echo "  Policy-Vorlagen: $BASE/downloads/extension/chrome-policy.json"
echo ""
echo "Firefox: policies.json mit Extensions.Install = $BASE/downloads/teamvault-extension.xpi"
echo "  (oder temporär about:debugging für Tests)"
echo ""
echo "Installationshilfe: $BASE/help/extension#install"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$BASE/help/extension#install" || true
fi
