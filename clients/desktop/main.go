// Command teamvault-desktop is the TeamVault Desktop client: a lean,
// vault-only native app (Wails v2) for Linux and Windows. It has no
// account/backup or tenant administration screens — only the same
// Zero-Knowledge vault the Web-UI/CLI/extension expose, plus a system
// tray icon and optional autostart.
package main

import (
	"context"
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"

	"github.com/teamvault/teamvault/clients/desktop/backend"
)

//go:embed all:frontend
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	app := NewApp()

	hidden := false
	for _, a := range os.Args[1:] {
		if a == "--hidden" || a == "-hidden" {
			hidden = true
		}
	}

	tray := &backend.Tray{
		OnOpen: app.ShowWindow,
		OnLock: app.Lock,
		OnQuit: app.Quit,
	}
	app.tray = tray
	// Must run before wails.Run(): on Linux the tray shares the GTK main
	// loop of the Wails frontend and has to be registered on the main thread.
	tray.Start()

	err := wails.Run(&options.App{
		Title:             "TeamVault",
		Width:             1180,
		Height:            760,
		MinWidth:          860,
		MinHeight:         560,
		StartHidden:       hidden,
		HideWindowOnClose: false,
		BackgroundColour:  &options.RGBA{R: 15, G: 21, B: 32, A: 1},
		OnStartup:         app.startup,
		OnBeforeClose:     app.beforeClose,
		OnShutdown: func(ctx context.Context) {
			app.Lock()
			tray.Quit()
		},
		Bind: []interface{}{
			app,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Linux: &linux.Options{
			Icon: appIcon,
		},
	})
	if err != nil {
		println("Error:", err.Error())
		os.Exit(1)
	}
}
