//go:build !windows

package backend

import _ "embed"

// Linux/macOS systray accepts .png bytes.
//
//go:embed assets/tray.png
var trayIconPNG []byte
