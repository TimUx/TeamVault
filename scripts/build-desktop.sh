#!/usr/bin/env bash
# Build the TeamVault Desktop client (Wails v2) for the current OS, plus
# an AppImage on Linux. Produces a *portable* binary — no installer, no
# admin/root rights needed to run it.
#
# Usage (from repo root):
#   ./scripts/build-desktop.sh
#
# Requirements:
#   - Linux: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev
#   - Windows: run natively on Windows (WebView2, see build-desktop.ps1)
#   - `wails` CLI (auto-installed into a local tmp GOBIN if missing)
#
# Output: dist/teamvault-desktop-linux-amd64[.AppImage]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/clients/desktop"

VERSION="$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)"
PRODUCT_VERSION="0.0.0"
if [[ "$VERSION" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  PRODUCT_VERSION="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
fi
OUTDIR="${ROOT}/dist"
mkdir -p "${ROOT}/.tmp"
mkdir -p "$OUTDIR"

WAILS_JSON="${ROOT}/clients/desktop/wails.json"
WAILS_JSON_BAK="${ROOT}/.tmp/wails.json.bak"
cp "$WAILS_JSON" "$WAILS_JSON_BAK"
cleanup() {
  cp "$WAILS_JSON_BAK" "$WAILS_JSON"
  rm -f "$WAILS_JSON_BAK"
}
trap cleanup EXIT

sed -i -E "s/\"productVersion\": \"[^\"]+\"/\"productVersion\": \"${PRODUCT_VERSION}\"/" "$WAILS_JSON"

WAILS_BIN="${WAILS_BIN:-wails}"
if ! command -v "$WAILS_BIN" >/dev/null 2>&1; then
  echo "Installing wails CLI..."
  GOBIN="${ROOT}/.tmp/gobin" go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0
  WAILS_BIN="${ROOT}/.tmp/gobin/wails"
fi

echo "Building teamvault-desktop (linux/amd64, version=${VERSION})..."
"$WAILS_BIN" build -clean -platform linux/amd64 -tags webkit2_41 -ldflags "-X main.version=${VERSION}"

BIN="build/bin/teamvault-desktop"
if [ ! -f "$BIN" ]; then
  echo "Build output not found at $BIN" >&2
  exit 1
fi
cp "$BIN" "${OUTDIR}/teamvault-desktop-linux-amd64"
chmod +x "${OUTDIR}/teamvault-desktop-linux-amd64"

# --- AppImage (portable, no install/root needed) ---------------------------
if command -v linuxdeploy >/dev/null 2>&1 || [ -x "${ROOT}/.tmp/linuxdeploy.AppImage" ]; then
  LINUXDEPLOY="${ROOT}/.tmp/linuxdeploy.AppImage"
  if command -v linuxdeploy >/dev/null 2>&1; then
    LINUXDEPLOY="$(command -v linuxdeploy)"
  fi
else
  echo "Downloading linuxdeploy..."
  mkdir -p "${ROOT}/.tmp"
  curl -fsSL -o "${ROOT}/.tmp/linuxdeploy.AppImage" \
    https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
  chmod +x "${ROOT}/.tmp/linuxdeploy.AppImage"
  LINUXDEPLOY="${ROOT}/.tmp/linuxdeploy.AppImage"
fi

APPDIR="${ROOT}/.tmp/TeamVaultDesktop.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
cp "$BIN" "$APPDIR/usr/bin/teamvault-desktop"
cp "${ROOT}/clients/desktop/build/appicon.png" "$APPDIR/teamvault-desktop.png"
cat > "$APPDIR/teamvault-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TeamVault Desktop
GenericName=Password Manager
Comment=Native TeamVault vault client
Exec=teamvault-desktop
Icon=teamvault-desktop
StartupNotify=true
StartupWMClass=TeamVault
Keywords=password;secrets;vault;totp;teamvault;
X-AppImage-Version=${PRODUCT_VERSION}
Categories=Utility;Security;
Terminal=false
EOF

(
  cd "${ROOT}/.tmp"
  ARCH=x86_64 "$LINUXDEPLOY" --appdir "$APPDIR" --output appimage \
    --desktop-file "$APPDIR/teamvault-desktop.desktop" \
    --icon-file "$APPDIR/teamvault-desktop.png"
)
APPIMAGE="$(find "${ROOT}/.tmp" -maxdepth 1 -name '*.AppImage' ! -name 'linuxdeploy*' | head -1)"
if [ -n "$APPIMAGE" ]; then
  cp "$APPIMAGE" "${OUTDIR}/teamvault-desktop-linux-amd64.AppImage"
  chmod +x "${OUTDIR}/teamvault-desktop-linux-amd64.AppImage"
fi

echo
echo "Portable binary + AppImage (no admin/root rights required to run):"
ls -la "${OUTDIR}"/teamvault-desktop-*
echo "version=${VERSION}"
