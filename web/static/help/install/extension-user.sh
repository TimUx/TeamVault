#!/usr/bin/env bash
# TeamVault extension — user installer (Chrome / Edge policy hint + Firefox info)
set -euo pipefail
BASE="${TEAMVAULT_URL:-}"
if [[ -z "$BASE" ]]; then read -r -p "TeamVault-URL: " BASE; fi
BASE="${BASE%/}"
META=$(curl -fsSL "$BASE/api/client-downloads")
EXT_ID=$(echo "$META" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)
echo "TeamVault Extension"
echo "Extension-ID (Chrome): ${EXT_ID:-?}"
echo ""
echo "Chrome / Edge:"
echo "  IT muss ExtensionSettings + ExtensionInstallSources setzen."
echo "  Vorlagen: $BASE/downloads/extension/chrome-policy.json"
echo "            $BASE/downloads/extension/chrome-install-sources.json"
echo "  Windows (Admin): extension-policy.ps1 von $BASE/help/install/"
echo ""
echo "Firefox (ID teamvault@local):"
echo "  Test: ZIP entpacken → about:debugging → Temporäres Add-on → manifest.json"
echo "  Firma: policies.json mit $BASE/downloads/extension/firefox-policy.json"
echo "         XPI: $BASE/downloads/teamvault-extension.xpi"
echo ""
echo "Ohne IT-Richtlinie: Entwicklermodus — $BASE/help/extension#fallback"
echo "Installationshilfe: $BASE/help/extension#install"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$BASE/help/extension#install" || true
fi
