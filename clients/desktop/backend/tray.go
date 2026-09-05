package backend

import (
	"github.com/getlantern/systray"
)

// Tray wires up the systray icon with Open / Lock / Quit actions. Start it
// via Start() from main(); the platform specific implementations take care
// of the threading requirements (on Linux systray shares the GTK main loop
// with the Wails frontend, elsewhere it runs its own loop).
type Tray struct {
	OnOpen func()
	OnLock func()
	OnQuit func()

	started bool
}

func (t *Tray) onReady() {
	systray.SetIcon(trayIconPNG)
	setTrayLabels()

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
				t.Quit()
				return
			}
		}
	}()
}

func (t *Tray) onExit() {}

// Quit stops/hides the systray icon (e.g. app-initiated quit). It is a no-op
// when the tray was never started.
func (t *Tray) Quit() {
	if !t.started {
		return
	}
	systray.Quit()
}
