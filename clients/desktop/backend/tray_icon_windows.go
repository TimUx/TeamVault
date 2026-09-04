//go:build windows

package backend

import _ "embed"

// Windows systray requires .ico bytes.
//
//go:embed assets/tray.ico
var trayIconPNG []byte
