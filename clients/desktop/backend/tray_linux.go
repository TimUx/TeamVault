//go:build linux

package backend

import (
	"os"
	"runtime"

	"github.com/getlantern/systray"
)

// Start registers the tray icon with GTK. On Linux systray and the Wails
// frontend share a single GTK instance, so systray.Run() must not be used:
// it would call gtk_init()/gtk_main() from a second OS thread in parallel to
// the gtk_init() of the Wails frontend, which crashes the process with
// SIGSEGV. Instead we only register the tray – from the main OS thread and
// before Wails initialises GTK – and let the gtk_main() loop of Wails
// dispatch the tray events.
//
// Start must be called from the main goroutine before wails.Run(). Setting
// TEAMVAULT_NO_TRAY=1 disables the tray icon completely, e.g. on desktops
// without AppIndicator support.
func (t *Tray) Start() {
	if os.Getenv("TEAMVAULT_NO_TRAY") == "1" {
		return
	}
	// Pin the main goroutine to the OS thread that initialises GTK; Wails
	// does the same for its own frontend thread.
	runtime.LockOSThread()

	// Mirror the GDK backend default of the Wails Linux frontend so both
	// share the same backend once gtk_init() runs.
	if os.Getenv("GDK_BACKEND") == "" {
		switch os.Getenv("XDG_SESSION_TYPE") {
		case "", "unspecified", "x11":
			_ = os.Setenv("GDK_BACKEND", "x11")
		}
	}

	systray.Register(t.onReady, t.onExit)
	t.started = true
}

// setTrayLabels is a no-op on Linux: systray applies title/tooltip changes
// directly (not via the GTK idle queue), so calling them from the onReady
// goroutine would touch GTK from a foreign thread. The AppIndicator label is
// empty anyway.
func setTrayLabels() {}
