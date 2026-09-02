package server

import (
	"net/http"
	"path/filepath"

	"github.com/teamvault/teamvault/internal/clients"
)

func (a *API) seedClientDownloads() {
	bundled := clients.ResolveBundledDir()
	target := filepath.Join(a.App.DataDir, "downloads")
	_ = clients.SeedDownloads(bundled, target)
}

func (a *API) handleClientDownloads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	dir := filepath.Join(a.App.DataDir, "downloads")
	m := clients.BuildManifest(dir, a.effectivePublicURL(r))
	p := a.bundle().Policy
	m.Features = clients.IntegrationFeatures{
		CLI:              p.ShowCLIIntegration(),
		BrowserExtension: p.ShowBrowserIntegration(),
	}
	writeJSON(w, http.StatusOK, m)
}
