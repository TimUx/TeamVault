//go:build windows

package backend

import (
	"github.com/getlantern/systray"
)

// Start registers the tray icon and lets Wails/WebView2 own the Windows
// message loop. Running a second systray loop in a goroutine can leave the
// Wails process alive after selecting "Beenden" from the tray menu.
func (t *Tray) Start() {
	t.started = true
	systray.Register(t.onReady, t.onExit)
}

func setTrayLabels() {
	systray.SetTitle("")
	systray.SetTooltip("TeamVault")
}
