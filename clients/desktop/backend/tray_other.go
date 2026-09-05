//go:build !linux

package backend

import (
	"github.com/getlantern/systray"
)

// Start runs the systray event loop on its own goroutine. On Windows/macOS
// systray owns its event loop and does not conflict with the Wails frontend.
func (t *Tray) Start() {
	t.started = true
	go systray.Run(t.onReady, t.onExit)
}

func setTrayLabels() {
	systray.SetTitle("")
	systray.SetTooltip("TeamVault")
}
