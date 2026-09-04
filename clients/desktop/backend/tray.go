package backend

import (
	"github.com/getlantern/systray"
)

// Tray wires up the systray icon with Open / Lock / Quit actions. It is
// started via systray.Run from main() and must run on the main OS thread
// on some platforms, so callers should invoke it directly from main().
type Tray struct {
	OnOpen func()
	OnLock func()
	OnQuit func()
}

func (t *Tray) onReady() {
	systray.SetIcon(trayIconPNG)
	systray.SetTitle("")
	systray.SetTooltip("TeamVault")

	mOpen := systray.AddMenuItem("Öffnen", "Fenster anzeigen")
	mLock := systray.AddMenuItem("Sperren", "Vault sperren")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Beenden", "TeamVault Desktop beenden")

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				if t.OnOpen != nil {
					t.OnOpen()
				}
			case <-mLock.ClickedCh:
				if t.OnLock != nil {
					t.OnLock()
				}
			case <-mQuit.ClickedCh:
				if t.OnQuit != nil {
					t.OnQuit()
				}
				systray.Quit()
				return
			}
		}
	}()
}

func (t *Tray) onExit() {}

// Run starts the systray event loop (blocking). Call in its own goroutine
// (or on the main thread, per-platform requirement) from main().
func (t *Tray) Run() {
	systray.Run(t.onReady, t.onExit)
}

// Quit stops the systray loop programmatically (e.g. app-initiated quit).
func (t *Tray) Quit() {
	systray.Quit()
}
